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
} = require("@whiskeysockets/baileys");

const { Boom } = require("@hapi/boom");
const readline = require("readline");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const config = require("./config");

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
};
const DEFAULT_COMMAND_REACT = "✅"; // used for commands not listed above

// In-memory store for antidelete feature (keeps last 500 messages)
const messageStore = new Map();
function rememberMessage(key, content) {
    messageStore.set(key, content);
    if (messageStore.size > 500) {
        const oldestKey = messageStore.keys().next().value;
        messageStore.delete(oldestKey);
    }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// Holds the live Baileys socket once created, so the HTTP routes below
// (used for browser-based pairing when there's no interactive terminal) can reach it.
let sockRef = null;
let latestQR = null;

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
// Start WhatsApp Connection
// ============================================
async function startBot() {
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
            const shouldReconnect =
                new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Connection band ho gayi. Reconnect:", shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === "open") {
            console.log("✅ Bot successfully connect ho gaya WhatsApp se!");
            latestQR = null;
            if (config.ALWAYS_ONLINE === "true" || config.ALWAYS_ONLINE === true) {
                setInterval(() => {
                    sock.sendPresenceUpdate("available").catch(() => {});
                }, 30000);
            }
        }
    });

    // ============================================
    // Handle Incoming Messages -> Route to Commands
    // ============================================
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

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

        if (!text.startsWith(PREFIX)) {
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
                        text: `📞 Ji zaroor, aap seedha baat kar sakte hain:\n*${OWNER_PERSONAL_NAME}*\n*${OWNER_PERSONAL_NUMBER}*`,
                    },
                    { quoted: msg }
                );
                return;
            }

            // AI auto-chat: reply like an assistant to private messages only
            // (not groups, not your own outgoing messages, not empty text)
            if (
                !isGroup &&
                !msg.key.fromMe &&
                text.trim() &&
                (config.CHATBOT === "on" || config.CHATBOT === "true" || config.CHATBOT === true)
            ) {
                const geminiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
                const groqKey = config.OPENAI_API_KEY || process.env.OPENAI_API_KEY;

                if (geminiKey || groqKey) {
                    try {
                        // No canned "I'm an AI" intro here on purpose — the bot
                        // should just chat naturally like a person. AI_PERSONA
                        // (config.js) already tells the model itself to
                        // mention .menu for downloads and to hand out the
                        // owner's number only if directly asked/urgent.
                        let answer = null;

                        if (geminiKey) {
                            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
                            const controller = new AbortController();
                            setTimeout(() => controller.abort(), 30000);
                            const response = await fetch(url, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    system_instruction: { parts: [{ text: config.AI_PERSONA || "" }] },
                                    contents: [{ parts: [{ text }] }],
                                }),
                                signal: controller.signal,
                            });
                            const data = await response.json();
                            answer = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                        } else if (groqKey) {
                            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json",
                                    "Authorization": `Bearer ${groqKey}`,
                                },
                                body: JSON.stringify({
                                    model: "llama-3.3-70b-versatile",
                                    messages: [
                                        { role: "system", content: config.AI_PERSONA || "You are a helpful assistant." },
                                        { role: "user", content: text },
                                    ],
                                }),
                            });
                            const data = await response.json();
                            answer = data.choices?.[0]?.message?.content;
                        }

                        if (answer) {
                            await sock.sendMessage(from, { text: answer }, { quoted: msg });
                        }
                    } catch (err) {
                        console.log("Auto-chat error:", err.message);
                    }
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
            await sock.sendMessage(from, { text: `❌ Command mein error aaya: ${err.message}` });
        }
    });

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
