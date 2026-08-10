// ============================================
// Tasmee-Ai-Bot - Main File
// Auto-loads all commands from /commands folder
// To add a new command: just drop a new .js file in /commands
// ============================================

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    downloadMediaMessage,
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");
const readline = require("readline");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const config = require("./config");
const memory = require("./lib/memory");
const groq = require("./lib/groq");

// ============================================
// Crash-safety net. Without this, a single unhandled promise rejection
// anywhere (even deep inside a dependency, not our own code) kills the
// whole Node process — PM2 then restarts it, which can interrupt an
// in-progress write to the session/ auth files and corrupt them. That
// corruption is what actually causes real "Bad MAC" / session errors
// later on, not just noise from them. This makes sure the process only
// ever dies on purpose, never by accident.
// ============================================
process.on("unhandledRejection", (reason) => {
    console.log("⚠️ Unhandled promise rejection (ignored, bot keeps running):", reason?.message || reason);
});
process.on("uncaughtException", (err) => {
    console.log("⚠️ Uncaught exception (ignored, bot keeps running):", err?.message || err);
});

// ============================================
// libsignal (the low-level crypto lib Baileys uses under the hood) logs
// "Session error: Bad MAC" straight to the console itself, bypassing the
// pino logger we pass to makeWASocket (set to "silent" below) entirely —
// so it can't be turned off through Baileys' own options.
//
// This specific error is normal, expected noise in any Baileys bot: it
// fires whenever an incoming message's encryption session is out of sync
// (missed messages while offline, sender reinstalled WhatsApp, a big
// group's key state drifting, etc.), and Baileys/libsignal recover from
// it automatically by requesting a fresh prekey bundle — that's what the
// "Closing open session in favor of incoming prekey bundle" line means.
// It does NOT mean the bot crashed or that messages stopped working.
//
// We only filter this one known-benign pattern so it stops drowning out
// real errors in `pm2 logs --err` — everything else still prints as-is.
// ============================================
const NOISY_LIBSIGNAL_PATTERNS = [/^Session error:Error: Bad MAC/, /^Failed to decrypt message with any known session/];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const filterNoisyLog = (original) => (...args) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (NOISY_LIBSIGNAL_PATTERNS.some((re) => re.test(first))) return;
    original(...args);
};
console.log = filterNoisyLog(originalConsoleLog);
console.error = filterNoisyLog(originalConsoleError);

const SESSION_FOLDER = "./session";
const PREFIX = config.PREFIX || ".";

// Personal number to hand out when someone urgently needs to reach the
// owner directly (not through the bot). Used by the "urgent contact"
// keyword check below.
const OWNER_PERSONAL_NUMBER = "03423899407";
const OWNER_PERSONAL_NAME = "Tasmee ul Hasnain";

// Matches messages (Roman Urdu + English) where the user is either asking
// urgently to reach the owner, OR directly asking for the owner's
// name/number, e.g. "tasmee se baat karni hai", "zaroori baat", "urgent",
// "owner ka number do", "tasmee ka naam kya hai".
const URGENT_CONTACT_REGEX =
    /\b(urgent|emergency)\b|\btalk\s*to\s*(the\s*)?(owner|tasmee)\b|\bcontact\s*(the\s*)?(owner|tasmee)\b|\breal\s*person\b|tasmee\s*se\s*baat|zaroor[ia]\s*(baat|kaam)|lazmi\s*baat|owner\s*se\s*baat|tasmee\s*se\s*contact|(owner|tasmee)('?s)?\s*(ka|ki)?\s*(number|naam|name)|please.*\bnumber\b|\bnumber\b.*please/i

// ============================================
// Type-based command react (always ON)
// Maps a command's canonical name -> emoji to react with.
// Uses command.name (not the alias typed by the user), so
// .gpt / .gemini / .ai all map to the same "ai" entry, etc.
// Add more entries here any time you add a new command.
// ============================================
const TYPE_REACT_MAP = {
    ai: "🤖",
    yt: "🎵",
    tiktok: "🎬",
    sticker: "🖼️",
    tts: "🗣️",
    help: "📜",
    image: "🎨",
    weather: "🌦️",
    news: "📰",
    pinterest: "📌",
    search: "🔎",
};
const DEFAULT_COMMAND_REACT = "✅"; // used for commands not listed above

// In-memory store for antidelete feature (keeps last 500 messages)
const messageStore = new Map();
// Per-sender cooldown for AI auto-chat replies — stops one chatty user/group
// from burning the whole day's Groq token budget by themselves.
const aiCooldown = new Map();
const AI_COOLDOWN_MS = 8000;

// ============================================
// Session backup — every few hours, copy the live `session` folder into
// `session_backups/<timestamp>/`, keeping only the last 5. If the live
// session ever gets corrupted, one of these can be copied back over
// `session/` as a recovery attempt instead of always needing a full re-scan.
// ============================================
const SESSION_DIR = path.join(__dirname, "session");
const SESSION_BACKUP_ROOT = path.join(__dirname, "session_backups");
const SESSION_BACKUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const SESSION_BACKUPS_TO_KEEP = 5;

function backupSession() {
    try {
        if (!fs.existsSync(SESSION_DIR)) return;
        if (!fs.existsSync(SESSION_BACKUP_ROOT)) fs.mkdirSync(SESSION_BACKUP_ROOT, { recursive: true });

        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const dest = path.join(SESSION_BACKUP_ROOT, stamp);
        fs.cpSync(SESSION_DIR, dest, { recursive: true });

        const backups = fs.readdirSync(SESSION_BACKUP_ROOT).sort();
        while (backups.length > SESSION_BACKUPS_TO_KEEP) {
            const oldest = backups.shift();
            fs.rmSync(path.join(SESSION_BACKUP_ROOT, oldest), { recursive: true, force: true });
        }
        console.log(`💾 Session backed up (${stamp})`);
    } catch (err) {
        console.log("⚠️ Session backup failed:", err.message);
    }
}
function rememberMessage(key, content) {
    messageStore.set(key, content);
    if (messageStore.size > 500) {
        const oldestKey = messageStore.keys().next().value;
        messageStore.delete(oldestKey);
    }
}

// ============================================
// Natural-language intent detection (no "." prefix needed)
// Lets people just ask normally — "mujhe ek gana chahiye" or
// "voice note bana do" — and the bot ACTUALLY runs the real
// download / TTS command instead of just talking about it.
// Each is a simple two-step ask -> act flow, mirroring how a
// person would naturally ask a follow-up question.
// ============================================
const pendingSongRequest = new Map(); // from -> timestamp
const pendingTTSRequest = new Map(); // from -> timestamp
const PENDING_INTENT_TTL = 2 * 60 * 1000; // 2 minutes

function setPending(map, id) {
    map.set(id, Date.now());
    setTimeout(() => {
        const ts = map.get(id);
        if (ts && Date.now() - ts >= PENDING_INTENT_TTL) map.delete(id);
    }, PENDING_INTENT_TTL);
}

function consumePending(map, id) {
    const ts = map.get(id);
    if (!ts) return false;
    map.delete(id);
    if (Date.now() - ts > PENDING_INTENT_TTL) return false;
    return true;
}

const DOWNLOAD_TOPIC_REGEX = /\b(song|gana|gaana|track|music|video)\b/i;
const WANT_REGEX = /\b(chahiye|chaiye|chahye|chahiy|do|bhejo|send|download|dedo|kardo)\b/i;
function isDownloadRequest(text) {
    return DOWNLOAD_TOPIC_REGEX.test(text) && WANT_REGEX.test(text);
}

// If a natural-language download request already includes the actual
// song/video name in the same message (e.g. "song download moonrise",
// "moonrise gana bhej do"), strip out the trigger/filler words and use
// whatever's left as the search query directly — instead of asking
// "which song?" again when the user already told us.
const DOWNLOAD_FILLER_WORDS_REGEX =
    /\b(song|gana|gaana|track|music|video|chahiye|chaiye|chahye|chahiy|do|bhejo|send|download|dedo|kardo|krdo|krado|karo|kro|karain|karain|kar|koi|please|plz|mujhe|muje|ek|ka|ki|ke|se|mein|mai)\b/gi;
function extractDownloadQuery(text) {
    return text
        .replace(DOWNLOAD_FILLER_WORDS_REGEX, " ")
        .replace(/[.]{2,}/g, " ") // trailing "..." ellipsis some people type
        .replace(/\s+/g, " ")
        .trim();
}

const TTS_TOPIC_REGEX = /\bvoice\s*note\b|\bawaaz\s*mein\b|\bbol\s*kar\s*sunao\b|\bpadh\s*kar\s*sunao\b/i;
const TTS_ACTION_REGEX = /\b(bana|bnao|bnado|bna|karo|kardo|bhejo|chahiye|chaiye)\b/i;
function isTtsRequest(text) {
    return TTS_TOPIC_REGEX.test(text) && TTS_ACTION_REGEX.test(text);
}

const IMAGE_TOPIC_REGEX = /\b(image|img|photo|pic|picture|tasveer|wallpaper)\b/i;
const IMAGE_ACTION_REGEX = /\b(bana|bnao|bnado|bna|banado|generate|create|chahiye|chaiye|do|bhejo|dedo)\b/i;
function isImageRequest(text) {
    return IMAGE_TOPIC_REGEX.test(text) && IMAGE_ACTION_REGEX.test(text);
}

const WEATHER_TOPIC_REGEX = /\b(mausam|weather|temperature)\b/i;
const WEATHER_QUESTION_REGEX = /\b(kaisa|kesa|kya|how|what|batao|btao|btio)\b/i;
function isWeatherRequest(text) {
    return WEATHER_TOPIC_REGEX.test(text) && WEATHER_QUESTION_REGEX.test(text);
}

// ============================================
// Guard for the pending song/TTS/image "what exactly do you want?" follow-up
// flows below. Without this, ANY next message from the user — even an
// unrelated "ok thanks", a greeting, or a totally different request — was
// being blindly swallowed as if it were the song name / TTS text / image
// description, because consumePending() doesn't know what the reply text
// actually says. This checks for the obvious signs that the user has
// moved on to something else, so we can cancel the pending flow instead
// of misinterpreting their new message.
// ============================================
const CASUAL_FILLER_REGEX =
    /^(hi+|hello+|hey+|salam|assalam[o]?\s*alaikum|walaikum\s*(as)?salam|ok(ay)?|thik\s*hai|theek\s*hai|thanks|thank\s*you|shukriya|haan|han|nahi|nai|no+|yes|kya|kese\s*ho|kaisay\s*ho|kaise\s*ho|kya\s*haal\s*hai|acha|accha)[.!?\s]*$/i;

// A reply that DECLINES our own follow-up question ("no need", "forget
// it", "cancel"...) — must not be swallowed as if it were the actual song
// name / TTS text / image description, even when it also happens to allow
// trailing filler words like "song"/"gana" (e.g. "no need song" is someone
// declining, not naming a song called "no need song").
const DECLINE_REPLY_REGEX =
    /^(no\s*need|nevermind|never\s*mind|forget\s*it|cancel|skip|nahi\s*chahiye|nai\s*chahiye|nahi\s*chaiye|chodo|choro|rehne\s*do|kuch\s*nahi|bas)\b/i;

function looksLikeUnrelatedReply(text, prefix) {
    const trimmed = (text || "").trim();
    if (!trimmed) return true;
    return (
        trimmed.startsWith(prefix) || // they typed an actual command
        isWeatherRequest(trimmed) ||
        isImageRequest(trimmed) ||
        isTtsRequest(trimmed) ||
        isDownloadRequest(trimmed) || // a fresh "gana chahiye" isn't itself a song NAME
        URGENT_CONTACT_REGEX.test(trimmed) ||
        CASUAL_FILLER_REGEX.test(trimmed) ||
        DECLINE_REPLY_REGEX.test(trimmed)
    );
}

// ============================================
// Very lightweight language check for the few hardcoded follow-up prompts
// below ("which song?", "what text?", "what image?") — these fire directly
// from plain regex matches (no AI call), so they can't otherwise pick up
// on the user having said "talk in English" earlier. If the message has
// no Roman-Urdu marker words AND is plain ASCII, reply in English;
// otherwise default to Roman Urdu as before.
// ============================================
const ROMAN_URDU_MARKER_REGEX =
    /\b(hai|hy|hoon|hun|ho|kya|chahiye|chaiye|chahye|kar|karo|kardo|bhejo|dedo|mujhe|muje|nahi|nai|acha|accha|theek|thik|zaroor|wala|wali|mein|main|ka|ki|ke|se|aap|tum|kaisay|kaisa|kese|kesa|gana|gaana|tasveer|awaaz)\b/i;
function preferEnglishReply(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return false;
    const isPlainAscii = /^[\x00-\x7F]*$/.test(trimmed);
    return isPlainAscii && !ROMAN_URDU_MARKER_REGEX.test(trimmed);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// Holds the live Baileys socket once created, so the HTTP routes below
// (used for browser-based pairing when there's no interactive terminal) can reach it.
let sockRef = null;
let latestQR = null;

// ============================================
// Reconnect guard — prevents the "reconnect storm" bug where a close
// event fires startBot() again with zero delay, spinning up a second
// socket on the SAME session while the first is still tearing down.
// WhatsApp then sees two clients on one session, treats it as a
// conflict, and kills both — which triggers another close, another
// startBot(), and so on, dozens of times per second. We fix this with:
//   1. isReconnecting flag — never allow two startBot() calls in flight.
//   2. Exponential backoff — wait longer after each consecutive failure,
//      reset back to the minimum once a connection stays open.
//   3. One backupSession interval total, not one added per reconnect.
// ============================================
let isReconnecting = false;
let reconnectAttempts = 0;
let backupIntervalHandle = null;
const RECONNECT_BASE_DELAY_MS = 3000; // 3s
const RECONNECT_MAX_DELAY_MS = 60000; // cap at 60s

// ============================================
// Load all commands from commands.js
// ============================================
const commandList = require("./commands");
const commands = new Map();

for (const command of commandList) {
    if (!command.name || typeof command.execute !== "function") {
        console.log(`⚠️  Skipping a command — missing "name" or "execute" function.`);
        continue;
    }
    commands.set(command.name, command);
    if (Array.isArray(command.aliases)) {
        for (const alias of command.aliases) {
            commands.set(alias, command);
        }
    }
}

console.log(`✅ Loaded ${commandList.length} command(s), ${commands.size} total with aliases.`);

// ============================================
// Restore session from SESSION_ID env var (for server deployments like Render)
// If a SESSION_ID is provided and no local session/creds.json exists yet,
// decode it and write it into the session folder so useMultiFileAuthState
// picks it up automatically — no interactive pairing needed.
// ============================================
function restoreSessionFromEnv() {
    const credsPath = path.join(SESSION_FOLDER, "creds.json");
    if (fs.existsSync(credsPath)) return; // already have a session on disk

    const sessionId = config.SESSION_ID || process.env.SESSION_ID;
    if (!sessionId) return;

    try {
        if (!fs.existsSync(SESSION_FOLDER)) fs.mkdirSync(SESSION_FOLDER, { recursive: true });
        const decoded = Buffer.from(sessionId.trim(), "base64").toString("utf-8");
        JSON.parse(decoded); // validate it's proper JSON before writing
        fs.writeFileSync(credsPath, decoded);
        console.log("✅ Session restored from SESSION_ID.");
    } catch (err) {
        console.log("❌ Failed to restore session from SESSION_ID:", err.message);
    }
}

// ============================================
// Azaan reminder scheduler — checks every minute whether it's namaz time
// for any subscribed chat (.azaan on <city>) and sends a one-time reminder
// per prayer per day. Prayer times are cached per city per day so we don't
// hammer the Aladhan API every minute.
// ============================================
const islamicdbForAzaan = require("./lib/islamicdb");
const prayerTimesCache = new Map(); // "city|YYYY-MM-DD" -> timings object

function getPakistanDateKey() {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Karachi",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());
    const val = (type) => parts.find((p) => p.type === type)?.value;
    return `${val("year")}-${val("month")}-${val("day")}`;
}

async function getPrayerTimesCached(city) {
    const dateKey = getPakistanDateKey();
    const cacheKey = `${city.toLowerCase()}|${dateKey}`;
    if (prayerTimesCache.has(cacheKey)) return prayerTimesCache.get(cacheKey);
    try {
        const res = await fetch(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Pakistan&method=1`);
        const data = await res.json();
        const t = data?.data?.timings || null;
        prayerTimesCache.set(cacheKey, t);
        return t;
    } catch {
        return null;
    }
}

function startAzaanScheduler() {
    setInterval(async () => {
        if (!sockRef) return;
        const subs = islamicdbForAzaan.getAzaanSubs();
        const chatIds = Object.keys(subs);
        if (!chatIds.length) return;

        const now = new Date();
        // IMPORTANT: the server (Oracle Cloud) runs in UTC, but namaz timings
        // from Aladhan are in Pakistan local time. Always compute the
        // current date/time explicitly in Asia/Karachi so reminders fire at
        // the correct real-world moment regardless of server timezone.
        const pktParts = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Karachi",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        }).formatToParts(now);
        const partVal = (type) => pktParts.find((p) => p.type === type)?.value;
        const dateKey = `${partVal("year")}-${partVal("month")}-${partVal("day")}`;
        const hhmm = `${partVal("hour")}:${partVal("minute")}`;
        const PRAYERS = [
            ["Fajr", "🌅"],
            ["Dhuhr", "☀️"],
            ["Asr", "🌤️"],
            ["Maghrib", "🌇"],
            ["Isha", "🌙"],
        ];

        for (const chatId of chatIds) {
            const sub = subs[chatId];
            if (!sub?.city) continue;
            const timings = await getPrayerTimesCached(sub.city);
            if (!timings) continue;

            for (const [name, emoji] of PRAYERS) {
                const raw = (timings[name] || "").slice(0, 5); // "HH:MM"
                if (!raw || raw !== hhmm) continue;
                if (sub.lastSent?.[name] === dateKey) continue; // already sent today
                try {
                    await sockRef.sendMessage(chatId, {
                        text: `${emoji} *${name} ki Namaz ka waqt ho gaya hai!*\n📍 ${sub.city}\n⏰ ${raw}`,
                    });
                } catch (err) {
                    console.log(`⚠️ Azaan reminder send failed for ${chatId}:`, err.message);
                }
                islamicdbForAzaan.markAzaanSent(chatId, name, dateKey);
            }
        }
    }, 60 * 1000);
}
startAzaanScheduler();

// ============================================
// Reads the text of whichever message the incoming message is quoting
// (replying to), if any. WhatsApp/Baileys stores this under
// contextInfo.quotedMessage on the message type that was actually sent
// (extendedTextMessage for a text reply, but also image/video/audio
// messages when someone replies with a caption). Returns null if this
// message isn't a reply to anything.
// ============================================
function getQuotedText(msg) {
    const contextInfo =
        msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        msg.message?.audioMessage?.contextInfo ||
        msg.message?.documentMessage?.contextInfo ||
        msg.message?.buttonsResponseMessage?.contextInfo ||
        msg.message?.listResponseMessage?.contextInfo;

    const quoted = contextInfo?.quotedMessage;
    if (!quoted) return null;

    return (
        quoted.conversation ||
        quoted.extendedTextMessage?.text ||
        quoted.imageMessage?.caption ||
        quoted.videoMessage?.caption ||
        quoted.documentMessage?.caption ||
        (quoted.audioMessage ? "[voice note / audio message]" : null) ||
        (quoted.stickerMessage ? "[sticker]" : null) ||
        (quoted.imageMessage ? "[image, no caption]" : null) ||
        (quoted.videoMessage ? "[video, no caption]" : null) ||
        null
    );
}

// ============================================
// Shared AI reply helper — used for both normal text auto-chat and
// transcribed voice-note replies, so they behave identically and both
// benefit from per-chat memory (recent history + remembered name).
// Returns the answer string, or null if no API key / no answer.
// ============================================
async function getAiReply(text, from, sock, msg) {
    const geminiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    const hasGroqKey = groq.getKeys().length > 0;
    if (!geminiKey && !hasGroqKey) return null;

    // When the Groq tool-calling path will be used below, the AI already
    // has a real `web_search` tool it can call itself when it decides a
    // question genuinely needs live info — so we skip the blunt keyword-regex
    // auto-search here to stop it firing on ordinary chat messages that
    // happen to contain words like "abhi", "kal", "update", etc. Only the
    // no-tool-calling paths (Gemini, or Groq without a live sock/msg) still
    // need this proactive injection since they have no other way to search.
    const willUseToolCalling = hasGroqKey && !!sock && !!msg;

    const { name, history } = memory.getContext(from);
    const commandsModule = require("./commands");
    let systemPrompt = await commandsModule.buildSystemPrompt(config.AI_PERSONA || "", text, !willUseToolCalling);
    if (name) systemPrompt += `\n\nThe user's name in this chat is "${name}" — you were told this earlier, use it naturally when it fits.`;

    // If this message is a reply to an earlier message (quoted/swipe-reply),
    // tell the AI what that earlier message said so it actually understands
    // what "yeh", "iska", "isko" etc. are pointing at instead of guessing.
    const quotedText = msg ? getQuotedText(msg) : null;
    if (quotedText) {
        systemPrompt += `\n\nThe user is replying directly to an earlier message in the chat. That earlier (quoted) message said: "${quotedText}"\nUse it as context to understand what the user's new message is referring to.`;
    }
    const aiInputText = quotedText ? `[Reply to: "${quotedText}"]\n${text}` : text;

    let answer = null;
    try {
        if (hasGroqKey && sock && msg) {
            // Groq path: supports tool-calling, so the AI can actually
            // trigger real commands (download, image, weather, etc.).
            answer = await commandsModule.chatWithTools(sock, {
                from,
                msg,
                config,
                systemPrompt,
                history,
                question: aiInputText,
            });
        } else if (geminiKey) {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 30000);
            // Gemini's history format: alternating user/model turns.
            const geminiHistory = history.map((h) => ({
                role: h.role === "assistant" ? "model" : "user",
                parts: [{ text: h.content }],
            }));
            const response = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: [...geminiHistory, { role: "user", parts: [{ text: aiInputText }] }],
                }),
                signal: controller.signal,
            });
            const data = await response.json();
            answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        } else if (hasGroqKey) {
            const data = await groq.groqChatWithFallback({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: systemPrompt || "You are a helpful assistant." },
                    ...history,
                    { role: "user", content: aiInputText },
                ],
            });
            answer = data.choices?.[0]?.message?.content;
        }
    } catch (err) {
        console.log("AI reply error:", err.message);
        return null;
    }

    // Guard against leaked tool-call syntax slipping through on any path
    // (chatWithTools already sanitizes its own output; this covers the
    // plain Groq/Gemini no-tool-calling paths above too).
    answer = commandsModule.sanitizeAiText(answer);

    if (answer) memory.remember(from, text, answer);
    return answer || null;
}

// ============================================
// Speech-to-text for incoming voice notes, via Groq's Whisper endpoint
// (same API key already used for the .ai / auto-chat text feature).
// Returns the transcribed text, or null if it couldn't be transcribed.
// ============================================
async function transcribeVoice(buffer) {
    if (groq.getKeys().length === 0) return null;

    try {
        const data = await groq.groqTranscribe(() => {
            const form = new FormData();
            form.append("file", new Blob([buffer], { type: "audio/ogg" }), "voice.ogg");
            form.append("model", "whisper-large-v3-turbo");
            return form;
        });
        return data?.text?.trim() || null;
    } catch (err) {
        console.log("Transcription error:", err.message);
        return null;
    }
}

// ============================================
// Start WhatsApp Connection
// ============================================
async function startBot() {
    if (isReconnecting) {
        console.log("⏳ startBot() already in progress — skipping duplicate call.");
        return;
    }
    isReconnecting = true;

    restoreSessionFromEnv();

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
    });
    sockRef = sock;

    groq.onAllKeysFailed(async (err) => {
        const ownerJid = (config.OWNER_NUMBER || "").replace(/[^0-9]/g, "") + "@s.whatsapp.net";
        await sock.sendMessage(ownerJid, {
            text: `⚠️ *AI keys exhaust ho gayi hain!*\n\nSaari Groq API keys ne apni limit khatam kar di hai — AI features (\`.ai\`, auto-chat, \`.search\`) abhi kaam nahi karenge jab tak limit reset na ho.\n\nError: ${err.message}`,
        }).catch(() => {});
    });

    if (!sock.authState.creds.registered) {
        if (process.stdin.isTTY) {
            const phoneNumber = await question(
                "Apna WhatsApp number likhein (country code ke sath, e.g. 923001234567): "
            );
            const code = await sock.requestPairingCode(phoneNumber.trim());
            console.log(`\nYeh raha aapka Pairing Code: ${code}\n`);
            console.log("WhatsApp > Linked Devices > Link with phone number > yeh code enter karein.\n");
        } else {
            // No interactive terminal (e.g. Render) and no valid SESSION_ID.
            // Don't exit — the /pair and /session HTTP routes (see below) let
            // you complete pairing from a browser instead.
            console.log(
                "❌ No valid session found and no interactive terminal available.\n" +
                "Open <your-render-url>/qr in a browser to scan a QR code, " +
                "or /pair for a pairing code, or set a SESSION_ID environment variable and restart."
            );
        }
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            latestQR = qr;
        }

        if (connection === "close") {
            isReconnecting = false; // this attempt is over, next startBot() call may proceed
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            const loggedOut = statusCode === DisconnectReason.loggedOut;

            if (loggedOut) {
                // Session is permanently invalid (unlinked from phone, banned,
                // or replaced by another device). Reconnecting with the same
                // creds.json would just loop forever with "conflict" errors.
                // Wipe the local session so the bot falls back to fresh
                // QR/pairing-code mode instead of storming reconnects.
                console.log("🚪 Session logged out ho gaya (WhatsApp se unlink). Local session clear kar raha hoon — dobara /qr ya /pair se link karein.");
                try {
                    fs.rmSync(SESSION_FOLDER, { recursive: true, force: true });
                } catch (err) {
                    console.log("⚠️ Session folder clear karne mein error:", err.message);
                }
                reconnectAttempts = 0;
                setTimeout(startBot, RECONNECT_BASE_DELAY_MS);
                return;
            }

            reconnectAttempts++;
            const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (reconnectAttempts - 1), RECONNECT_MAX_DELAY_MS);
            console.log(`Connection band ho gayi. ${Math.round(delay / 1000)}s mein reconnect karunga (attempt ${reconnectAttempts})...`);
            setTimeout(startBot, delay);
        } else if (connection === "open") {
            console.log("✅ Bot successfully connect ho gaya WhatsApp se!");
            latestQR = null;
            reconnectAttempts = 0; // connection is healthy again, reset backoff
            if (config.ALWAYS_ONLINE === "true" || config.ALWAYS_ONLINE === true) {
                setInterval(() => {
                    sock.sendPresenceUpdate("available").catch(() => {});
                }, 30000);
            }
            backupSession();
            if (!backupIntervalHandle) {
                // Only ever create ONE recurring backup interval, no matter how
                // many times the bot reconnects over its lifetime.
                backupIntervalHandle = setInterval(backupSession, SESSION_BACKUP_INTERVAL_MS);
            }
        }
    });

    // ============================================
    // Handle Incoming Messages -> Route to Commands
    //
    // Per-chat queue: without this, if a second message from the SAME chat
    // arrives while the first one is still mid-flight (e.g. waiting on a
    // slow Groq call, a YouTube search, a retry after a 429), both handlers
    // run concurrently and their replies can interleave/arrive out of
    // order — e.g. a reply meant for an earlier voice note landing after a
    // completely unrelated later text message. Chaining each chat's work
    // through a promise queue keyed by `from` guarantees messages from the
    // same chat are always handled one at a time, in the order they
    // arrived, while different chats still run fully in parallel.
    // ============================================
    const chatMessageQueues = new Map();

    sock.ev.on("messages.upsert", ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const previous = chatMessageQueues.get(from) || Promise.resolve();
        const current = previous
            .then(() => handleIncomingMessage(msg))
            .catch((err) => console.log("❌ Message handler error:", err.message))
            .finally(() => {
                // Avoid an ever-growing Map: only clear the slot if nothing
                // newer queued up behind us while we were running.
                if (chatMessageQueues.get(from) === current) chatMessageQueues.delete(from);
            });
        chatMessageQueues.set(from, current);
    });

    async function handleIncomingMessage(msg) {
        const from = msg.key.remoteJid;

        // 🔍 DEBUG LOG — remove this once everything is confirmed working
        const debugText =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            "[non-text message]";
        console.log(
            `📩 Message received | from: ${from} | participant: ${msg.key.participant || "(none)"} | fromMe: ${msg.key.fromMe} | text: "${debugText}"`
        );

        // Auto-read messages if enabled
        if ((config.READ_MESSAGE === "true" || config.READ_MESSAGE === true) && !msg.key.fromMe) {
            await sock.readMessages([msg.key]).catch(() => {});
        }

        // Store message content for antidelete feature
        if (config.ANTI_DELETE === "true" || config.ANTI_DELETE === true) {
            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                "[Media message]";
            rememberMessage(`${from}_${msg.key.id}`, { text, sender: msg.key.participant || from });
        }

        // Handle deleted message (revocation)
        if (msg.message.protocolMessage?.type === 0) {
            if (config.ANTI_DELETE === "true" || config.ANTI_DELETE === true) {
                const revokedId = msg.message.protocolMessage.key.id;
                const stored = messageStore.get(`${from}_${revokedId}`);
                if (stored) {
                    const destination = config.ANTI_DEL_PATH === "same" ? from : (config.OWNER_NUMBER + "@s.whatsapp.net");
                    await sock.sendMessage(destination, {
                        text: `🗑️ *Deleted message detected*\n👤 From: ${stored.sender.split("@")[0]}\n💬 ${stored.text}`,
                    }).catch(() => {});
                }
            }
            return;
        }

        // Reveal "View Once" photos/videos/voice notes automatically (if enabled).
        // WhatsApp normally hides these after one open; we grab the media the
        // moment it arrives and resend it in the same chat as a normal message.
        const vvMessage =
            msg.message.viewOnceMessageV2?.message ||
            msg.message.viewOnceMessageV2Extension?.message ||
            msg.message.viewOnceMessage?.message;
        if (vvMessage && (config.ANTI_VV === "true" || config.ANTI_VV === true)) {
            try {
                const fakeMsg = { ...msg, message: vvMessage };
                const buffer = await downloadMediaMessage(fakeMsg, "buffer", {});
                const senderTag = (msg.key.participant || from).split("@")[0];
                const caption = `👁️ *View-once message revealed*\n👤 From: ${senderTag}`;
                if (vvMessage.imageMessage) {
                    await sock.sendMessage(from, { image: buffer, caption }).catch(() => {});
                } else if (vvMessage.videoMessage) {
                    await sock.sendMessage(from, { video: buffer, caption }).catch(() => {});
                } else if (vvMessage.audioMessage) {
                    await sock.sendMessage(from, { audio: buffer, mimetype: "audio/ogg; codecs=opus", ptt: true }).catch(() => {});
                    await sock.sendMessage(from, { text: caption }).catch(() => {});
                }
            } catch (err) {
                console.log("Anti-viewonce error:", err.message);
            }
        }

        // WhatsApp Status broadcasts are NOT a chat with the bot — people are
        // just posting a status update, not messaging it. The anti-delete /
        // view-once handling above is intentionally allowed to run on Status
        // content, but nothing past this point should treat someone's status
        // post as if they were talking to the bot: no voice-note replies, no
        // natural-language intent detection, no AI auto-chat, no commands.
        // Without this, the bot was replying to random people's personal
        // status updates (e.g. "dua for my father" -> bot sent an AI reply)
        // and even running tool-triggered searches off status captions.
        if (from === "status@broadcast") return;

        // Note: we no longer return early on fromMe, so commands sent from your own
        // WhatsApp (self-chat / testing) still get processed.

        // Note: the old random auto-react (config.AUTO_REACT / .autoreact command)
        // has been replaced by the type-based react below, which fires once the
        // command is identified and always reacts with an emoji that matches the
        // command's type (yt -> 🎵, ai -> 🤖, sticker -> 🖼️, etc.) instead of a
        // random emoji on every message. The .autoreact toggle command still
        // exists for the old on/off setting but no longer does anything by
        // itself; the type-based react below always runs.
        const isGroup = from.endsWith("@g.us");
        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        // Commands require the prefix (e.g. "."). Anything without it falls
        // through to natural-language detection / AI auto-chat below.

        // ============================================
        // Group moderation: anti-link + anti-bad-word.
        // Both already had .antilink / .antibadword toggle commands, but
        // neither was ever actually checked anywhere — wiring that up here.
        // Skipped for group admins (they can post links/curse freely).
        // ============================================
        if (isGroup && !msg.key.fromMe && text.trim()) {
            const senderJid = msg.key.participant || from;
            let senderIsAdmin = false;
            try {
                const meta = await sock.groupMetadata(from);
                const participant = meta.participants.find((p) => p.id === senderJid);
                senderIsAdmin = participant?.admin === "admin" || participant?.admin === "superadmin";
            } catch {}

            if (!senderIsAdmin) {
                let antilinkOn = false;
                try {
                    const settings = JSON.parse(fs.readFileSync(path.join(__dirname, "data/antilink.json"), "utf8"));
                    antilinkOn = settings[from] === true;
                } catch {}
                const hasLink = /(https?:\/\/|chat\.whatsapp\.com\/|wa\.me\/)/i.test(text);
                if (antilinkOn && hasLink) {
                    await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                    await sock.sendMessage(from, {
                        text: `🔗 Links allowed nahi hain is group mein.`,
                        mentions: [senderJid],
                    }).catch(() => {});
                    return;
                }

                if (config.ANTI_BAD_WORD === "true" || config.ANTI_BAD_WORD === true) {
                    let badWords = [];
                    try {
                        badWords = JSON.parse(fs.readFileSync(path.join(__dirname, "data/badwords.json"), "utf8"));
                    } catch {
                        badWords = [];
                    }
                    const lower = text.toLowerCase();
                    const matched = badWords.some((w) => w && lower.includes(w.toLowerCase()));
                    if (matched) {
                        await sock.sendMessage(from, { delete: msg.key }).catch(() => {});
                        await sock.sendMessage(from, {
                            text: `🚫 Bad language allowed nahi hai is group mein, meherbani se dhyan rakhein.`,
                            mentions: [senderJid],
                        }).catch(() => {});
                        return;
                    }
                }
            }
        }

        // Voice notes: transcribe them and reply like a normal chat message
        // (text + a spoken reply back), private chats only.
        const voiceMessage = msg.message.audioMessage;
        if (
            voiceMessage &&
            !isGroup &&
            !msg.key.fromMe &&
            (config.CHATBOT === "on" || config.CHATBOT === "true" || config.CHATBOT === true)
        ) {
            try {
                await sock.sendPresenceUpdate("recording", from).catch(() => {});
                const buffer = await downloadMediaMessage(msg, "buffer", {});
                const transcript = await transcribeVoice(buffer);

                if (!transcript) {
                    await sock.sendMessage(from, {
                        text: "🎙️ Sorry, voice note samajh nahi aayi — thora clear bol kar dobara bhejein.",
                    }, { quoted: msg });
                    return;
                }

                const answer = await getAiReply(transcript, from, sock, msg);
                if (answer) {
                    await sock.sendPresenceUpdate("composing", from).catch(() => {});
                    await new Promise((r) => setTimeout(r, 5000));
                    await sock.sendMessage(from, { text: answer }, { quoted: msg });
                    // Bonus: also reply with a spoken voice note, best-effort.
                    try {
                        const commandsModule = require("./commands");
                        const oggBuffer = await commandsModule.synthesizeSpeech(answer);
                        await sock.sendMessage(from, { audio: oggBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true });
                    } catch (err) {
                        console.log("Voice reply synth skipped:", err.message);
                    }
                }
            } catch (err) {
                console.log("Voice note handling error:", err.message);
            }
            return;
        }

        if (!text.startsWith(PREFIX)) {
            // Check if this is a reply picking a number from a YouTube search
            // results list (from .yt / .audio / .video / AI song requests).
            const pendingChoice = commandList.pendingYtChoice?.get(from);
            if (pendingChoice) {
                const num = parseInt(text.trim(), 10);
                if (!isNaN(num) && num >= 1 && num <= pendingChoice.results.length) {
                    commandList.pendingYtChoice.delete(from);
                    const chosen = pendingChoice.results[num - 1];
                    const target = `https://www.youtube.com/watch?v=${chosen.id}`;

                    if (pendingChoice.wantsVideo === true || pendingChoice.wantsVideo === false) {
                        await commandList.downloadYt(sock, {
                            from,
                            msg,
                            target,
                            label: chosen.title,
                            wantsVideo: pendingChoice.wantsVideo,
                            config,
                        });
                    } else {
                        commandList.pendingYt.set(from, { target, label: chosen.title });
                        await sock.sendMessage(from, {
                            text: `🎬 Download *${chosen.title}* as:\n\n1️⃣ Reply *audio*\n2️⃣ Reply *video*`,
                        });
                    }
                    return;
                }
                // Not a valid number — let it fall through so a normal
                // message/other pending flow can still be handled.
            }

            // Check if this is a reply picking a number from a PDF/book
            // search results list (.pdfsearch).
            const pendingPdf = commandList.pendingPdfChoice?.get(from);
            if (pendingPdf) {
                const num = parseInt(text.trim(), 10);
                if (!isNaN(num) && num >= 1 && num <= pendingPdf.results.length) {
                    commandList.pendingPdfChoice.delete(from);
                    const chosen = pendingPdf.results[num - 1];
                    try {
                        await sock.sendMessage(from, { text: `📥 *${chosen.title}* download ho rahi hai...` });
                        const { buffer, fileName } = await commandList.fetchArchivePdf(chosen.identifier);
                        await sock.sendMessage(from, {
                            document: buffer,
                            fileName: fileName.endsWith(".pdf") ? fileName : `${fileName}.pdf`,
                            mimetype: "application/pdf",
                            caption: `📚 ${chosen.title}`,
                        });
                    } catch (err) {
                        await sock.sendMessage(from, { text: `❌ ${err.message}` });
                    }
                    return;
                }
            }

            // Check if this is a reply to a pending "audio or video?" question
            const pending = commandList.pendingYt?.get(from);
            const choice = text.trim().toLowerCase();
            const wantsVideo =
                choice === "2" ||
                choice === "video";
            const wantsAudio =
                choice === "1" ||
                choice === "audio";
            
            if (pending && (wantsAudio || wantsVideo)) {
                commandList.pendingYt.delete(from);

                await commandList.downloadYt(sock, {
                    from,
                    msg,
                    target: pending.target,
                    label: pending.label,
                    wantsVideo,
                    config,
                });

                return;
            }

            // Follow-up to "kaisi image chahiye?" — actually generates and
            // sends the real AI image once they describe it (unless they've
            // clearly moved on to something else, e.g. a greeting or a
            // totally different request — then cancel the pending flow).
            const pendingImg = commandList.pendingImage?.get(from);
            if (pendingImg && !isGroup && !msg.key.fromMe && text.trim()) {
                commandList.pendingImage.delete(from);
                if (!looksLikeUnrelatedReply(text, PREFIX)) {
                    await commandList.fetchOrGenerateImage(sock, from, msg, text.trim());
                    return;
                }
                // else: fall through to normal handling below for this message
            }

            // Follow-up to "which song/video?" — actually starts the real
            // download flow (reuses the same .yt logic, incl. audio/video ask),
            // but only if the reply actually looks like a song/link and not
            // an unrelated message — otherwise we cancel the pending flow
            // instead of mistakenly searching YouTube for random chat.
            if (!isGroup && !msg.key.fromMe && text.trim() && pendingSongRequest.has(from)) {
                const isUnrelated = looksLikeUnrelatedReply(text, PREFIX);
                const consumed = consumePending(pendingSongRequest, from); // always clears the entry
                if (consumed && !isUnrelated) {
                    const explicitVideo = /\bvideo\b/i.test(text);
                    const explicitAudio = /\baudio\b/i.test(text);
                    await commandList.startYtFlow(sock, {
                        from,
                        msg,
                        query: text,
                        wantsVideo: explicitVideo ? true : explicitAudio ? false : null,
                        config,
                    });
                    return;
                }
                // else: unrelated reply — pending cleared, fall through to normal handling
            }

            // Follow-up to "what text should I turn into a voice note?" —
            // actually generates and sends a real voice note, unless the
            // reply looks unrelated (then cancel instead of TTS-ing it).
            if (!isGroup && !msg.key.fromMe && text.trim() && pendingTTSRequest.has(from)) {
                const isUnrelated = looksLikeUnrelatedReply(text, PREFIX);
                const consumed = consumePending(pendingTTSRequest, from); // always clears the entry
                if (consumed && !isUnrelated) {
                    try {
                        const oggBuffer = await commandList.synthesizeSpeech(text);
                        await sock.sendMessage(from, { audio: oggBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: msg });
                    } catch (err) {
                        await sock.sendMessage(from, { text: `❌ Voice note nahi ban saka: ${err.message}` }, { quoted: msg });
                    }
                    return;
                }
                // else: unrelated reply — pending cleared, fall through to normal handling
            }

            // Urgent-contact shortcut: if the user is privately asking to
            // reach the owner directly / urgently, skip the AI reply and
            // hand out the personal number right away.
            if (
                !isGroup &&
                !msg.key.fromMe &&
                text.trim() &&
                URGENT_CONTACT_REGEX.test(text)
            ) {
                await sock.sendMessage(
                    from,
                    {
                        text: `📞 Ji zaroor, aap seedha baat kar sakte hain:\n*${OWNER_PERSONAL_NAME}*\n${OWNER_PERSONAL_NUMBER} (wa.me/923423899407)`,
                    },
                    { quoted: msg }
                );
                return;
            }

            // Natural "mujhe gana chahiye" / "video chahiye" style request.
            // If the name/link is already in this same message (e.g. "song
            // download moonrise"), skip asking and search directly. Only
            // ask "which one?" when nothing usable is left after stripping
            // the trigger words.
            if (!isGroup && !msg.key.fromMe && text.trim() && isDownloadRequest(text)) {
                const explicitVideo = /\bvideo\b/i.test(text);
                const extractedQuery = extractDownloadQuery(text);
                if (extractedQuery.length >= 2) {
                    await commandList.startYtFlow(sock, {
                        from,
                        msg,
                        query: extractedQuery,
                        wantsVideo: explicitVideo ? true : null,
                        config,
                    });
                    return;
                }
                setPending(pendingSongRequest, from);
                await sock.sendMessage(from, {
                    text: preferEnglishReply(text)
                        ? "🎵 Sure! Which song or video do you need? Send the name or a link."
                        : "🎵 Zaroor! Konsa gana ya video chahiye? Naam ya link bhej dein.",
                }, { quoted: msg });
                return;
            }

            // Natural "voice note bana do" style request — ask for the
            // text, then actually generate it (handled by the
            // pendingTTSRequest check above).
            if (!isGroup && !msg.key.fromMe && text.trim() && isTtsRequest(text)) {
                setPending(pendingTTSRequest, from);
                await sock.sendMessage(from, {
                    text: preferEnglishReply(text)
                        ? "🎙️ Sure! What text should I turn into a voice note? Type it out."
                        : "🎙️ Theek hai! Kaunsa text voice note mein chahiye? Likh dein.",
                }, { quoted: msg });
                return;
            }

            // Natural "image bana do" / "picture chahiye" style request —
            // ask what kind of image, then actually generate it (handled by
            // the pendingImg check above).
            if (!isGroup && !msg.key.fromMe && text.trim() && isImageRequest(text)) {
                commandList.pendingImage.set(from, Date.now());
                setTimeout(() => {
                    const ts = commandList.pendingImage.get(from);
                    if (ts && Date.now() - ts >= PENDING_INTENT_TTL) commandList.pendingImage.delete(from);
                }, PENDING_INTENT_TTL);
                await sock.sendMessage(from, {
                    text: preferEnglishReply(text)
                        ? "🖼️ Sure! What should the image be of? Tell me what you need."
                        : "🖼️ Zaroor! Kis cheez ki image chahiye? Naam bata dein.",
                }, { quoted: msg });
                return;
            }

            // Natural "mausam kaisa hai" / "weather kya hai" style request —
            // runs the real .weather command directly.
            if (!isGroup && !msg.key.fromMe && text.trim() && isWeatherRequest(text)) {
                const weatherCmd = commands.get("weather");
                if (weatherCmd) {
                    const cityMatch = text.match(/\b(?:mausam|weather|temperature)\b\s*(?:of|mein|ka|main)?\s*([a-zA-Z\u0600-\u06FF]{2,30})?/i);
                    const cityArg = cityMatch?.[1]?.trim();
                    await weatherCmd.execute(sock, { from, args: cityArg ? [cityArg] : [], msg, config });
                    return;
                }
            }

            // AI auto-chat: reply like an assistant to private messages only
            // (not groups, not your own outgoing messages, not empty text).
            // No canned "I'm an AI" intro here on purpose — the bot should
            // just chat naturally like a person. AI_PERSONA (config.js)
            // already tells the model itself to mention .menu for downloads
            // and to hand out the owner's number only if directly asked/urgent.
            if (
                !isGroup &&
                !msg.key.fromMe &&
                text.trim() &&
                (config.CHATBOT === "on" || config.CHATBOT === "true" || config.CHATBOT === true)
            ) {
                const lastReply = aiCooldown.get(from) || 0;
                if (Date.now() - lastReply < AI_COOLDOWN_MS) return;
                aiCooldown.set(from, Date.now());

                const answer = await getAiReply(text, from, sock, msg);
                if (answer) {
                    await sock.sendPresenceUpdate("composing", from).catch(() => {});
                    await new Promise((r) => setTimeout(r, 5000));
                    await sock.sendMessage(from, { text: answer }, { quoted: msg });
                }
            }
            return;
        }

        // Show typing/recording indicator if enabled
        try {
            if (config.AUTO_TYPING === "true" || config.AUTO_TYPING === true) {
                await sock.sendPresenceUpdate("composing", from);
            } else if (config.AUTO_RECORDING === "true" || config.AUTO_RECORDING === true) {
                await sock.sendPresenceUpdate("recording", from);
            }
        } catch {}

        const args = text.slice(PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = commands.get(commandName);

        console.log(`🔎 Parsed command: "${commandName}" | found: ${!!command}`);

        if (!command) return;

        // Type-based react — always ON. Reacts with an emoji that matches the
        // command's type, using command.name so all aliases (.gpt/.gemini/.ai)
        // react the same way.
        if (!msg.key.fromMe) {
            const reactEmoji = TYPE_REACT_MAP[command.name] || DEFAULT_COMMAND_REACT;
            await sock.sendMessage(from, {
                react: { text: reactEmoji, key: msg.key },
            }).catch(() => {});
        }

        try {
            await command.execute(sock, {
                from,
                isGroup,
                args,
                text,
                msg,
                config,
                allCommands: commandList,
            });
        } catch (err) {
            console.log(`❌ Error running command "${commandName}":`, err.message);
            await sock.sendMessage(from, {
                text: `❌ Command mein error aaya: ${err.message}\n\n🛠️ Agar yeh problem barqarar rahe to developer ko batayein: wa.me/923423899407`,
            });
        }
    }

    // ============================================
    // Welcome / Goodbye messages
    // ============================================
    sock.ev.on("group-participants.update", async (update) => {
        if (config.WELCOME !== "true" && config.WELCOME !== true) return;

        const groupMeta = await sock.groupMetadata(update.id).catch(() => null);
        const groupName = groupMeta?.subject || "the group";

        for (const participant of update.participants) {
            const name = participant.split("@")[0];

            if (update.action === "add") {
                const template = config.WELCOME_MSG || "👋 Welcome @{name} to *{group}*!";
                const finalText = template.replace("{name}", `@${name}`).replace("{group}", groupName);
                await sock.sendMessage(update.id, {
                    text: finalText,
                    mentions: [participant],
                });
            } else if (update.action === "remove") {
                const template = config.GOODBYE_MSG || "👋 @{name} left *{group}*. Goodbye!";
                const finalText = template.replace("{name}", `@${name}`).replace("{group}", groupName);
                await sock.sendMessage(update.id, {
                    text: finalText,
                    mentions: [participant],
                });
            }
        }
    });

    // ============================================
    // Anti-Call - reject incoming calls if enabled
    // ============================================
    sock.ev.on("call", async (calls) => {
        if (config.ANTI_CALL !== "true" && config.ANTI_CALL !== true) return;
        for (const call of calls) {
            const callerJid = call.from;
            if (!callerJid || call.status !== "offer") continue;
            try {
                await sock.rejectCall(call.id, callerJid);
                const msgText = config.REJECT_MSG || "📵 Calls are not allowed. Your call was rejected.";
                await sock.sendMessage(callerJid, { text: msgText });
            } catch {}
        }
    });

    // ============================================
    // Admin Action notifications (promote/demote)
    // ============================================
    sock.ev.on("group-participants.update", async (update) => {
        if (config.ADMIN_ACTION === "true" || config.ADMIN_ACTION === true) {
            if (update.action === "promote" || update.action === "demote") {
                const names = update.participants.map((p) => p.split("@")[0]).join(", ");
                await sock.sendMessage(update.id, {
                    text: `⚙️ ${names} was ${update.action}d.`,
                }).catch(() => {});
            }
        }
    });

    return sock;
}

// ============================================
// Minimal HTTP server for platforms (e.g. Render Web Service) that require
// the app to bind to a port and respond to health checks. Harmless locally.
//
// Bonus: when no SESSION_ID env var is set yet (first-time server deploy,
// "bootstrap mode"), this also exposes two convenience routes so you can
// pair without an interactive terminal:
//   /pair    -> get a pairing code for config.OWNER_NUMBER
//   /session -> once linked, get the SESSION_ID string to save in Render
// These routes automatically stop responding once SESSION_ID is set, so
// there's no lingering exposure after initial setup.
// ============================================
const http = require("http");
const PORT = process.env.PORT || 9090;
const BOOTSTRAP_MODE = !(config.SESSION_ID || process.env.SESSION_ID);

http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (BOOTSTRAP_MODE && url.pathname === "/qr") {
        if (!sockRef) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            return res.end("Bot is still starting up, refresh this page in a few seconds.");
        }
        if (sockRef.authState.creds.registered) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            return res.end("Already linked to WhatsApp. Visit /session to get your SESSION_ID.");
        }
        if (!latestQR) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            return res.end("QR not generated yet, refresh this page in a few seconds.");
        }
        try {
            const QRCode = require("qrcode");
            const pngBuffer = await QRCode.toBuffer(latestQR, { width: 320 });
            res.writeHead(200, { "Content-Type": "image/png", "Refresh": "20" });
            return res.end(pngBuffer);
        } catch (err) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            return res.end(`Failed to render QR: ${err.message}`);
        }
    }

    if (BOOTSTRAP_MODE && url.pathname === "/pair") {
        if (!sockRef) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            return res.end("Bot is still starting up, refresh this page in a few seconds.");
        }
        if (sockRef.authState.creds.registered) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            return res.end("Already linked to WhatsApp. Visit /session to get your SESSION_ID.");
        }
        try {
            const number = url.searchParams.get("number") || config.OWNER_NUMBER;
            const code = await sockRef.requestPairingCode(number.trim());
            res.writeHead(200, { "Content-Type": "text/plain" });
            return res.end(
                `Pairing code for ${number}: ${code}\n\n` +
                `Open WhatsApp > Linked Devices > Link with phone number > enter this code.\n` +
                `Once linked, visit /session to get your SESSION_ID for Render.`
            );
        } catch (err) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            return res.end(`Failed to generate pairing code: ${err.message}`);
        }
    }

    if (BOOTSTRAP_MODE && url.pathname === "/session") {
        const credsPath = path.join(SESSION_FOLDER, "creds.json");
        if (!sockRef || !sockRef.authState.creds.registered || !fs.existsSync(credsPath)) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            return res.end("Not linked yet. Visit /pair first and complete linking in WhatsApp.");
        }
        const raw = fs.readFileSync(credsPath, "utf-8");
        const sessionId = Buffer.from(raw, "utf-8").toString("base64");
        res.writeHead(200, { "Content-Type": "text/plain" });
        return res.end(
            `Copy this value into Render's SESSION_ID environment variable, then redeploy:\n\n${sessionId}\n`
        );
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Tasmee-Ai-Bot is running.");
}).listen(PORT, () => {
    console.log(`🌐 Health-check server listening on port ${PORT}`);
    if (BOOTSTRAP_MODE) {
        console.log("ℹ️  No SESSION_ID set — visit /qr (scan) or /pair (code) on this server's URL to link WhatsApp from a browser.");
    }
});

startBot();

// ============================================
// Keep yt-dlp itself up to date automatically. YouTube changes its
// anti-bot checks constantly, and an old yt-dlp binary is one of the
// most common reasons downloads suddenly start failing with
// "Sign in to confirm you're not a bot" even with fresh cookies — the
// Dockerfile only pulls "latest" once, at image build time, and then
// it's frozen until the image is rebuilt. This runs an update on
// startup and once a day after that so it never silently goes stale
// on a long-running server.
// ============================================
function updateYtDlp() {
    const { spawn } = require("child_process");
    const proc = spawn("/usr/local/bin/yt-dlp", ["-U"]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (out += d.toString()));
    proc.on("close", () => {
        console.log("🔄 yt-dlp self-update check:", out.trim().split("\n").pop());
    });
    proc.on("error", () => {}); // binary not found — silently skip, downloadYt will surface it if actually used
}
updateYtDlp();
setInterval(updateYtDlp, 24 * 60 * 60 * 1000);
