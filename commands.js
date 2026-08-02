// ============================================
// commands.js - All bot commands in ONE file
// To add a new command: just add a new object to the array below
// ============================================

const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");
const memory = require("./lib/memory");
const groq = require("./lib/groq");
const { setConfig: persistConfig } = require("./lib/configdb");

// Every toggle/setting command below should use this instead of a plain
// `config.X = Y` assignment — it updates the in-memory config the bot is
// using right now AND writes it to data/config.json, so the setting
// survives a restart/crash instead of silently resetting to the default.
function updateConfig(config, key, value) {
    config[key] = value;
    try {
        persistConfig(key, value);
    } catch (err) {
        console.log(`⚠️ Failed to persist config.${key}:`, err.message);
    }
}

const fetch = global.fetch;

// Shared TTS engine — turns text into an .ogg/opus voice-note buffer.
// Used by the .tts command AND by the automatic "reply to voice notes
// with voice" feature in index.js, so both stay in sync.
async function synthesizeSpeech(text) {
    const { spawn } = require("child_process");
    const os = require("os");
    const jobId = `tts_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const tmpDir = os.tmpdir();
    const chunkPaths = [];

    const chunks = text.match(/.{1,180}(?:\s|$)/g)?.map((s) => s.trim()).filter(Boolean) || [text];
    for (let i = 0; i < chunks.length; i++) {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encodeURIComponent(chunks[i])}`;
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                Referer: "https://translate.google.com/",
            },
        });
        if (!response.ok || !response.headers.get("content-type")?.includes("audio")) {
            throw new Error(`TTS service did not return valid audio (status ${response.status}).`);
        }
        const buf = Buffer.from(await response.arrayBuffer());
        const chunkPath = path.join(tmpDir, `${jobId}_${i}.mp3`);
        fs.writeFileSync(chunkPath, buf);
        chunkPaths.push(chunkPath);
    }
    const mergedPath = path.join(tmpDir, `${jobId}_merged.mp3`);
    const listPath = path.join(tmpDir, `${jobId}_list.txt`);
    fs.writeFileSync(listPath, chunkPaths.map((p) => `file '${p}'`).join("\n"));

    await new Promise((resolve, reject) => {
        const proc = spawn("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", mergedPath]);
        let stderr = "";
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("error", (err) => reject(new Error(`ffmpeg failed: ${err.message}`)));
        proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-300)))));
    });

    const outPath = path.join(tmpDir, `${jobId}.ogg`);
    await new Promise((resolve, reject) => {
        const proc = spawn("ffmpeg", ["-y", "-i", mergedPath, "-c:a", "libopus", "-ar", "48000", "-ac", "1", outPath]);
        let stderr = "";
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("error", (err) => reject(new Error(`ffmpeg failed: ${err.message}`)));
        proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(stderr.slice(-300)))));
    });

    const oggBuffer = fs.readFileSync(outPath);
    [...chunkPaths, mergedPath, listPath, outPath].forEach((p) => fs.unlink(p, () => {}));
    return oggBuffer;
}

// Shared with index.js: hand out the owner's personal number when someone
// urgently needs to talk to them directly, or asks for it by name.
const OWNER_PERSONAL_NUMBER = "03423899407";
const OWNER_PERSONAL_NAME = "Tasmee ul Hasnain";
const URGENT_CONTACT_REGEX =
    /\b(urgent|emergency)\b|\btalk\s*to\s*(the\s*)?(owner|tasmee)\b|\bcontact\s*(the\s*)?(owner|tasmee)\b|\breal\s*person\b|tasmee\s*se\s*baat|zaroor[ia]\s*(baat|kaam)|lazmi\s*baat|owner\s*se\s*baat|tasmee\s*se\s*contact|(owner|tasmee)('?s)?\s*(ka|ki)?\s*(number|naam|name)|please.*\bnumber\b|\bnumber\b.*please/i;

// Current date/time in Pakistan, used so the AI always knows "today" and
// "abhi ka waqt" correctly instead of relying on stale training data.
function getPakistanDateTimeString() {
    try {
        return new Date().toLocaleString("en-US", {
            timeZone: "Asia/Karachi",
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
        }) + " (PKT)";
    } catch {
        return new Date().toISOString();
    }
}

// Lightweight, no-API-key web search via DuckDuckGo's HTML results page.
// Returns up to `maxResults` { title, snippet, url } objects, or [] on failure.
async function webSearch(query, maxResults = 4) {
    try {
        const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            },
        });
        const html = await res.text();
        const stripTags = (s) =>
            s.replace(/<[^>]+>/g, "")
                .replace(/&#x27;/g, "'")
                .replace(/&amp;/g, "&")
                .replace(/&quot;/g, '"')
                .trim();

        const blockRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        const results = [];
        let match;
        while ((match = blockRegex.exec(html)) && results.length < maxResults) {
            let url = match[1];
            const uddgMatch = url.match(/uddg=([^&]+)/);
            if (uddgMatch) url = decodeURIComponent(uddgMatch[1]);
            results.push({ title: stripTags(match[2]), snippet: stripTags(match[3]), url });
        }
        return results;
    } catch (err) {
        console.log("Web search error:", err.message);
        return [];
    }
}

// Questions that likely need live/current info — triggers an automatic
// web-search context injection for the AI, in addition to the always-on
// current-date info.
const REALTIME_INFO_REGEX =
    /\b(today|aaj|abhi|is\s*waqt|current|currently|latest|newest|update[ds]?|breaking|news|khabr|price|rate|score|match|result|kal|kaun\s*hai|who\s*is|when\s*is|kab\s*hai|is\s*saal|this\s*year)\b/i;

// Builds the final system prompt: base persona + today's date, and (when the
// question looks time-sensitive) a block of live web search results for the
// model to answer from in its own words.
async function buildSystemPrompt(basePersona, question) {
    let systemPrompt = `Aaj ki tareekh aur waqt: ${getPakistanDateTimeString()}.\n\n${basePersona || "You are a helpful assistant."}`;
    if (REALTIME_INFO_REGEX.test(question || "")) {
        const results = await webSearch(question, 3);
        if (results.length > 0) {
            const context = results
                .map((r, i) => `[${i + 1}] ${r.title} — ${r.snippet} (${r.url})`)
                .join("\n");
            systemPrompt += `\n\nNeeche is sawaal ke liye live web search results diye gaye hain — inko apne alfaz mein use karke sahi aur up-to-date jawab dein, kisi source ko lafz-ba-lafz copy na karein:\n${context}`;
        }
    }
    return systemPrompt;
}

// WMO weather codes -> short Roman Urdu description, used by the .weather command.
const WEATHER_CODES = {
    0: "Saaf aasman ☀️", 1: "Kaafi saaf 🌤️", 2: "Halki badal 🌥️", 3: "Badal chaya hua ☁️",
    45: "Dhund 🌫️", 48: "Barfeeli dhund 🌫️",
    51: "Halki boonda baandi 🌦️", 53: "Boonda baandi 🌦️", 55: "Tez boonda baandi 🌧️",
    61: "Halki baarish 🌧️", 63: "Baarish 🌧️", 65: "Tez baarish ⛈️",
    71: "Halki barfbaari ❄️", 73: "Barfbaari ❄️", 75: "Tez barfbaari ❄️",
    80: "Halki bauchaar 🌦️", 81: "Bauchaar 🌧️", 82: "Tez bauchaar ⛈️",
    95: "Aandhi/toofan ⛈️", 96: "Aandhi (olay ke saath) ⛈️", 99: "Shadeed aandhi ⛈️",
};
function describeWeatherCode(code) {
    return WEATHER_CODES[code] || "Mausam ka data mojood";
}

// Shared image generator (Pollinations AI — free, no API key). Used by both
// the .image command and the natural "image bana do" -> "kaisi image?" flow.
async function generateAndSendImage(sock, from, msg, prompt) {
    await sock.sendMessage(from, { text: "🎨 Image bana raha hoon, thoda wait karein..." }, { quoted: msg });
    try {
        const seed = Math.floor(Math.random() * 1000000);
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Image service ne error diya (status ${res.status})`);
        const buffer = Buffer.from(await res.arrayBuffer());
        await sock.sendMessage(from, { image: buffer, caption: `🎨 *${prompt}*` }, { quoted: msg });
    } catch (err) {
        await sock.sendMessage(from, { text: `❌ Image nahi ban saki: ${err.message}` }, { quoted: msg });
    }
}

// Bing image search scrape (no API key). Returns an array of direct image URLs.
async function bingImageSearch(query, max = 4) {
    try {
        const res = await fetch(`https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2`, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            },
        });
        const html = await res.text();
        const raw = [
            ...[...html.matchAll(/murl&quot;:&quot;(https?:\/\/[^&]+?)&quot;/g)].map((m) => m[1]),
            ...[...html.matchAll(/"murl":"(https?:\/\/[^"]+?)"/g)].map((m) => m[1]),
        ].map((u) => u.replace(/\\u0026/g, "&").replace(/\\\//g, "/"));
        return [...new Set(raw)].slice(0, max);
    } catch (err) {
        console.log("Bing image search error:", err.message);
        return [];
    }
}

// Pinterest search scrape (no API key). Returns an array of direct image URLs.
async function pinterestImageSearch(query, max = 4) {
    try {
        const res = await fetch(`https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            },
        });
        const html = await res.text();
        const found = (html.match(/https:\/\/i\.pinimg\.com\/[^"'\\ ]+?\.(?:jpg|jpeg|png)/g) || [])
            .map((u) => u.replace(/\/\d+x\d*\//, "/736x/"))
            .filter((u) => !u.includes("75x75_RS") && !u.includes("avatar"));
        return [...new Set(found)].slice(0, max);
    } catch (err) {
        console.log("Pinterest search error:", err.message);
        return [];
    }
}

// Tries hard to find a REAL photo from the web before ever resorting to AI
// generation: Bing first, then Pinterest, then again with a shorter/simpler
// version of the query if the first pass found nothing.
async function searchRealImages(query, max = 4) {
    let urls = await bingImageSearch(query, max);
    if (urls.length === 0) urls = await pinterestImageSearch(query, max);

    if (urls.length === 0) {
        const simplified = query.split(/\s+/).slice(0, 3).join(" ");
        if (simplified && simplified.toLowerCase() !== query.toLowerCase()) {
            urls = await bingImageSearch(simplified, max);
            if (urls.length === 0) urls = await pinterestImageSearch(simplified, max);
        }
    }
    return urls;
}

// Main entry point for "I want an image": maximum effort to find and send a
// REAL photo from the web first. Only if nothing real can be found after
// trying multiple sources/queries does it fall back to AI generation.
async function fetchOrGenerateImage(sock, from, msg, prompt) {
    await sock.sendMessage(from, { text: `🔎 "${prompt}" ki real photo dhoondh raha hoon...` }, { quoted: msg });

    const urls = await searchRealImages(prompt, 3);
    let sentAny = false;
    for (const url of urls) {
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.length < 3000) continue; // skip tiny/broken placeholder responses
            await sock.sendMessage(from, { image: buffer, caption: `📷 *${prompt}*` }, { quoted: msg });
            sentAny = true;
        } catch {
            // skip broken image, try the next one
        }
    }
    if (sentAny) return;

    // Nothing real found after maximum effort — only now fall back to AI.
    await sock.sendMessage(from, { text: "📷 Koi real photo nahi mil saki, is liye AI se bana raha hoon..." }, { quoted: msg });
    await generateAndSendImage(sock, from, msg, prompt);
}

function loadJSON(filePath, fallback) {
    try {
        const fullPath = path.join(__dirname, filePath);
        if (!fs.existsSync(fullPath)) return fallback;
        return JSON.parse(fs.readFileSync(fullPath, "utf-8"));
    } catch {
        return fallback;
    }
}
function saveJSON(filePath, data) {
    const fullPath = path.join(__dirname, filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
}

function isOwner(msg, config) {
    if (msg.key.fromMe) return true;
    const sender = msg.key.participant || msg.key.remoteJid || "";
    const senderDigits = sender.replace(/[^0-9]/g, "");
    const ownerNumbers = [config.OWNER_NUMBER, config.DEV]
        .filter(Boolean)
        .map((n) => String(n).replace(/[^0-9]/g, ""));
    return ownerNumbers.some((num) => num && (senderDigits === num || senderDigits.endsWith(num)));
}

async function downloadYt(sock, { from, msg, target, label, wantsVideo, config }) {
    const { spawn } = require("child_process");
    const os = require("os");

    const jobId = `yt_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const tmpDir = os.tmpdir();
    const outTemplate = path.join(tmpDir, `${jobId}.%(ext)s`);
    const format = wantsVideo ? "best[ext=mp4]/best" : "bestaudio";

    await sock.sendMessage(from, { text: `⏳ Downloading *${label}* as ${wantsVideo ? "video" : "audio"}, please wait...` });

    const ytdlpArgs = [
        "-f",
        format,
        "-o",
        outTemplate,
        "--no-playlist",
        "--geo-bypass",
        "--no-check-certificates",
        "--cookies",
        path.join(__dirname, "cookies.txt"),
        "--js-runtimes",
        "bun",
        ...(wantsVideo ? [] : ["--extract-audio", "--audio-format", "mp3", "--audio-quality", "0"]),
        target,
    ];

    const runYtDlp = () =>
        new Promise((resolve, reject) => {
            const proc = spawn("/usr/local/bin/yt-dlp", ytdlpArgs, { env: process.env });
            let stderr = "";
            proc.stderr.on("data", (d) => (stderr += d.toString()));
            proc.on("error", (err) => reject(new Error(`yt-dlp not found or failed to start: ${err.message}`)));
            proc.on("close", (code) => {
                if (code === 0) resolve();
                else reject(new Error(stderr.slice(-500) || `yt-dlp exited with code ${code}`));
            });
        });

    try {
        await runYtDlp();
        const matchFile = fs.readdirSync(tmpDir).find((f) => f.startsWith(jobId));
        if (!matchFile) throw new Error("Download finished but output file was not found.");
        const filePath = path.join(tmpDir, matchFile);
        const buffer = fs.readFileSync(filePath);
        const title = matchFile.replace(/^yt_\d+_\d+\./, "").replace(/\.[^/.]+$/, "") || "media";

        if (wantsVideo) {
            await sock.sendMessage(from, { video: buffer, caption: `🎬 ${title}`, mimetype: "video/mp4" }, { quoted: msg });
        } else {
            await sock.sendMessage(from, { audio: buffer, mimetype: "audio/mpeg", fileName: `${title}.mp3` }, { quoted: msg });
        }
        fs.unlink(filePath, () => {});
    } catch (err) {
        console.log("❌ YT download error:", err.message);
        if (isOwner(msg, config)) {
            await sock.sendMessage(from, { text: `❌ Download failed: ${err.message}` });
        } else {
            await sock.sendMessage(from, { text: "❌ Sorry, couldn't download that right now. Please try again later." });
        }
    }
}

async function startYtFlow(sock, { from, msg, query, wantsVideo, config }) {
    const trimmed = (query || "").trim();
    if (!trimmed) {
        await sock.sendMessage(from, { text: "❌ Konsa gana/video chahiye? Naam ya link bhej dein." }, { quoted: msg });
        return;
    }

    const directUrl = /youtube\.com|youtu\.be/i.test(trimmed) ? trimmed : null;
    const target = directUrl || `ytsearch1:${trimmed}`;
    const label = directUrl ? "this link" : trimmed;

    if (wantsVideo === true || wantsVideo === false) {
        await downloadYt(sock, { from, msg, target, label, wantsVideo, config });
        return;
    }

    module.exports.pendingYt.set(from, { target, label });
    setTimeout(() => {
        const pending = module.exports.pendingYt.get(from);
        if (pending && pending.target === target) module.exports.pendingYt.delete(from);
    }, 60000);

    await sock.sendMessage(from, {
        text: `🎬 Download *${label}* as:\n\n1️⃣ Reply *audio*\n2️⃣ Reply *video*`,
    }, { quoted: msg });
}

// ============================================
// AI tool-use: lets the .ai command / normal chat AI actually TRIGGER the
// bot's own content commands (download, image, weather, news, pinterest,
// tts, stylish text, web search) on the user's behalf, instead of just
// talking about them. Uses Groq's OpenAI-compatible function-calling.
//
// Admin/config commands (ban, sudo, mode, prefix, botname, etc.) are
// deliberately NOT exposed here and stay owner-only — letting the AI (or
// any random user) trigger those would let strangers rename the bot,
// change its settings, or ban other people.
// ============================================
const AI_TOOLS = [
    {
        type: "function",
        function: {
            name: "download_media",
            description: "Download a song or video from YouTube/TikTok and send it to the user.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Song/video name, or a direct YouTube/TikTok link" },
                    format: { type: "string", enum: ["audio", "video"], description: "Whether the user wants audio or video" },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "find_or_generate_image",
            description: "Find a real photo online for a topic and send it. Only generates an AI image as a last resort if no real photo is found.",
            parameters: {
                type: "object",
                properties: { prompt: { type: "string", description: "What the image should show" } },
                required: ["prompt"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "text_to_voice",
            description: "Convert text into a spoken WhatsApp voice note and send it.",
            parameters: {
                type: "object",
                properties: { text: { type: "string", description: "The text to speak" } },
                required: ["text"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "stylish_text_image",
            description: "Turn a short name/word (under 24 characters) into a stylish graphic image and send it.",
            parameters: {
                type: "object",
                properties: { text: { type: "string", description: "The short name/word to stylize" } },
                required: ["text"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_weather",
            description: "Get the current live weather for a city and send it to the user.",
            parameters: {
                type: "object",
                properties: { city: { type: "string", description: "City name; omit for the user's default city" } },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_news",
            description: "Get the latest news headlines, optionally about a specific topic, and send them.",
            parameters: {
                type: "object",
                properties: { topic: { type: "string", description: "News topic, e.g. 'cricket' or 'Pakistan economy'; omit for top headlines" } },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "pinterest_images",
            description: "Search Pinterest for pictures matching a query and send them.",
            parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "web_search",
            description: "Search the live web for a fact-based or time-sensitive question (e.g. today's price, latest news, current status) and answer it.",
            parameters: {
                type: "object",
                properties: { query: { type: "string" } },
                required: ["query"],
            },
        },
    },
];

// Runs the real command behind an AI tool call and returns a short status
// string that gets fed back to the AI so it can give a natural closing reply.
async function runAiTool(sock, { from, msg, config }, toolName, toolArgs) {
    const findCmd = (name) => allCommands.find((c) => c.name === name);
    try {
        switch (toolName) {
            case "download_media": {
                const wantsVideo = toolArgs.format === "video" ? true : toolArgs.format === "audio" ? false : null;
                await startYtFlow(sock, { from, msg, query: toolArgs.query || "", wantsVideo, config });
                return "Download shuru kar diya (ya audio/video poocha gaya).";
            }
            case "find_or_generate_image": {
                await fetchOrGenerateImage(sock, from, msg, toolArgs.prompt || "");
                return "Image dhoondh kar bhej di.";
            }
            case "text_to_voice": {
                const oggBuffer = await synthesizeSpeech(toolArgs.text || "");
                await sock.sendMessage(from, { audio: oggBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: msg });
                return "Voice note bhej diya.";
            }
            case "stylish_text_image": {
                const cmd = findCmd("text");
                if (cmd) await cmd.execute(sock, { from, args: (toolArgs.text || "").split(" "), msg });
                return "Stylish image bhej di.";
            }
            case "get_weather": {
                const cmd = findCmd("weather");
                if (cmd) await cmd.execute(sock, { from, args: toolArgs.city ? toolArgs.city.split(" ") : [], msg });
                return "Weather bhej di.";
            }
            case "get_news": {
                const cmd = findCmd("news");
                if (cmd) await cmd.execute(sock, { from, args: toolArgs.topic ? toolArgs.topic.split(" ") : [], msg });
                return "News headlines bhej din.";
            }
            case "pinterest_images": {
                const cmd = findCmd("pinterest");
                if (cmd) await cmd.execute(sock, { from, args: (toolArgs.query || "").split(" "), msg });
                return "Pinterest images bhej din.";
            }
            case "web_search": {
                const cmd = findCmd("search");
                if (cmd) await cmd.execute(sock, { from, args: (toolArgs.query || "").split(" "), config, msg });
                return "Web search ka jawab bhej diya.";
            }
            default:
                return "Yeh tool mojood nahi.";
        }
    } catch (err) {
        return `Tool chalane mein error aaya: ${err.message}`;
    }
}

// Sends one Groq chat-completions request with tool definitions attached,
// executes any tools the model chooses to call (each tool sends its own
// WhatsApp message directly), then asks the model for one short natural
// closing reply. Returns that closing reply string, or a plain answer
// string if no tool was called, or null on failure.
const KNOWN_TOOL_NAMES = [
    "download_media", "find_or_generate_image", "text_to_voice", "stylish_text_image",
    "get_weather", "get_news", "pinterest_images", "web_search",
];

// Some models occasionally print a fake/malformed function-call as plain
// text instead of using the real tool_calls field, e.g.:
//   </function>download_media>{"format": "audio", "query": "Pal pal"}<function>
//   Text_to_voice: "Kya haal hai"
// This tries to recognise that pattern and recover the intended tool call
// instead of showing the garbled text straight to the user.
function parseMalformedToolCall(text) {
    if (!text) return null;
    for (const toolName of KNOWN_TOOL_NAMES) {
        const escaped = toolName.replace(/_/g, "[_ ]?");
        const jsonPattern = new RegExp(`${escaped}\\s*[:>]?\\s*(\\{[^}]*\\})`, "i");
        const jsonMatch = text.match(jsonPattern);
        if (jsonMatch) {
            try {
                return { name: toolName, args: JSON.parse(jsonMatch[1]) };
            } catch {}
        }
        // Simpler form: `text_to_voice: "some text"` (no JSON object at all)
        const plainPattern = new RegExp(`${escaped}\\s*[:>]\\s*"([^"]+)"`, "i");
        const plainMatch = text.match(plainPattern);
        if (plainMatch) {
            const key = toolName === "text_to_voice" ? "text" : toolName === "download_media" ? "query" : "query";
            return { name: toolName, args: { [key]: plainMatch[1] } };
        }
    }
    return null;
}

async function chatWithTools(sock, { from, msg, config, systemPrompt, history, question }) {
    const baseMessages = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: question },
    ];

    const firstData = await groq.groqChatWithFallback({ model: "llama-3.3-70b-versatile", messages: baseMessages, tools: AI_TOOLS, tool_choice: "auto" });

    const choiceMsg = firstData.choices?.[0]?.message;
    let toolCalls = choiceMsg?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
        const recovered = parseMalformedToolCall(choiceMsg?.content);
        if (recovered) {
            const resultText = await runAiTool(sock, { from, msg, config }, recovered.name, recovered.args);
            return resultText || "✅ Ho gaya!";
        }
        return choiceMsg?.content || null;
    }

    const toolResultMessages = [];
    for (const call of toolCalls) {
        let argsObj = {};
        try { argsObj = JSON.parse(call.function.arguments || "{}"); } catch {}
        const resultText = await runAiTool(sock, { from, msg, config }, call.function.name, argsObj);
        toolResultMessages.push({ tool_call_id: call.id, role: "tool", name: call.function.name, content: resultText });
    }

    const followData = await groq.groqChatWithFallback({
        model: "llama-3.3-70b-versatile",
        messages: [...baseMessages, choiceMsg, ...toolResultMessages],
    });
    return followData.choices?.[0]?.message?.content || "✅ Ho gaya!";
}

// Generic downloader for Instagram/Facebook/Twitter via cobalt.tools (a free,
// actively-maintained public API that handles many platforms in one place).
async function cobaltDownload(url) {
    const res = await fetch("https://api.cobalt.tools/api/json", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (data.status === "error") throw new Error(data.text || "Download failed.");
    return data.url || null;
}

const MENU_CATEGORIES = {
    "🤖 AI & SMART": ["ai", "search", "translate", "shayari", "joke", "quote"],
    "📥 DOWNLOAD": ["yt", "tiktok", "pinterest", "instagram", "facebook", "twitter", "statusdl"],
    "🎨 MEDIA": ["sticker", "toimg", "tts", "text", "image"],
    "🕌 ISLAMIC": ["prayertimes", "qibla", "hijri"],
    "🌦️ LIVE INFO": ["weather", "news", "cricket", "petrol", "gold", "currency", "define"],
    "🎉 FUN": ["truthordare", "compatibility", "riddle", "poll"],
    "🛠️ UTILITY": ["qr", "calc", "remind", "clearchat"],
    "👥 GROUP TOOLS": ["tagall", "kick", "antilink", "antidelete", "antiviewonce", "antibadword"],
    "👑 OWNER": ["ban", "unban", "banlist", "block", "unblock", "sudo", "delsudo", "listsudo", "mode", "autoread", "broadcast"],
    "⚙️ SETTINGS": [
        "welcome", "goodbye", "setwelcome", "setgoodbye",
        "editpath", "recording", "autotyping", "online", "autoreact", "anticall",
        "anticallmsg", "adminaction", "statuslike", "prefix", "botname", "ownername",
        "ownernumber", "description", "stickername", "settings",
    ],
    "🏠 MAIN": ["ping", "help", "alive", "owner", "repo", "developer"],
};

const allCommands = [
    {
        name: "ping",
        aliases: ["p"],
        description: "Check if the bot is online",
        async execute(sock, { from }) {
            const start = Date.now();
            await sock.sendMessage(from, { text: "🏓 Pinging..." });
            const latency = Date.now() - start;
            await sock.sendMessage(from, { text: `🏓 Pong! ${latency}ms` });
        },
    },
    {
        name: "help",
        aliases: ["menu"],
        description: "Show all available commands",
        async execute(sock, { from, config, allCommands }) {
            const uptimeSec = Math.floor(process.uptime());
            const mins = Math.floor(uptimeSec / 60);
            const secs = uptimeSec % 60;

            const categories = MENU_CATEGORIES;

            let menu = `◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤\n`;
            menu += `　　⟦ SYSTEM ONLINE ⟧\n`;
            menu += `◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤\n\n`;
            menu += `🤖 *${config.BOT_NAME || "Tasmee-Ai-Bot"}*\n`;
            menu += `⚡ Advanced Neural Assistant — v2.0\n\n`;
            menu += `┌─────────────────────\n`;
            menu += `│ 👑 ᴏᴡɴᴇʀ    : ${config.OWNER_NAME || "Tasmee"}\n`;
            menu += `│ 📜 ᴄᴏᴍᴍᴀɴᴅs : ${allCommands.length}\n`;
            menu += `│ ⏱️ ᴜᴘᴛɪᴍᴇ   : ${mins}m ${secs}s\n`;
            menu += `│ ⚙️ ᴍᴏᴅᴇ     : ${config.MODE || "public"}\n`;
            menu += `│ 🧠 ᴀɪ ᴄᴏʀᴇ  : Groq — Llama 3.3 (70B)\n`;
            menu += `│ 📦 ᴘʀᴇғɪx   : optional — "${config.PREFIX || "."}" ya bilkul bina prefix bhi chalega\n`;
            menu += `│ 📱 ᴏᴡɴᴇʀ    : wa.me/${config.OWNER_NUMBER || "N/A"}\n`;
            menu += `└─────────────────────`;

            const prefix = config.PREFIX || ".";
            for (const [category, cmdNames] of Object.entries(categories)) {
                menu += `\n\n╭━━━ ${category} ━━━╮`;
                for (const cmdName of cmdNames) {
                    const cmd = allCommands.find((c) => c.name === cmdName);
                    if (!cmd) continue;
                    const aliasText = cmd.aliases && cmd.aliases.length ? ` (${cmd.aliases.map((a) => a).join(", ")})` : "";
                    menu += `\n  ➤ ${cmd.name}${aliasText}`;
                }
                menu += `\n╰${"━".repeat(category.length + 8)}╯`;
            }

            menu += `\n\n◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤`;
            menu += `\n🤝 Main 24/7 aapki madad ke liye yahan hoon!`;
            menu += `\n💬 Prefix (${prefix}) laga kar ya bina lagaye, kisi bhi command ka naam likh dein.`;
            menu += `\n©️ ᴘᴏᴡᴇʀᴇᴅ ʙʏ ${config.OWNER_NAME || "Tasmee ul Hasnain"}`;

            if (config.MENU_IMAGE_URL) {
                await sock.sendMessage(from, {
                    image: { url: config.MENU_IMAGE_URL },
                    caption: menu,
                }).catch(async () => {
                    await sock.sendMessage(from, { text: menu });
                });
            } else {
                await sock.sendMessage(from, { text: menu });
            }
        },
    },
    {
        name: "tts",
        aliases: ["speak"],
        description: "Convert text to voice. Usage: .tts <text>",
        async execute(sock, { from, args, msg }) {
            const text = args.join(" ");
            if (!text) {
                await sock.sendMessage(from, { text: "❓ Please provide text. Example: *.tts Hello world*" });
                return;
            }
            try {
                const oggBuffer = await synthesizeSpeech(text);
                await sock.sendMessage(from, { audio: oggBuffer, mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ TTS failed: ${err.message}` });
            }
        },
    },
    {
        name: "alive",
        aliases: [],
        description: "Check if bot is alive with uptime + system info",
        async execute(sock, { from, config }) {
            const uptimeSec = Math.floor(process.uptime());
            const hrs = Math.floor(uptimeSec / 3600);
            const mins = Math.floor((uptimeSec % 3600) / 60);
            const secs = uptimeSec % 60;
            const memMB = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
            const text =
                `⚡ *${config.BOT_NAME || "Tasmee-Ai-Bot"}* — ONLINE\n\n` +
                `🟢 Status: Active & Running\n` +
                `⏱️ Uptime: ${hrs}h ${mins}m ${secs}s\n` +
                `🧠 AI Engine: Groq (Llama 3.3 70B)\n` +
                `💾 Memory: ${memMB} MB\n` +
                `📦 Node.js: ${process.version}\n` +
                `🏷️ Version: 2.0 — Advanced\n\n` +
                `_Sab systems normal — kuch bhi pooch sakte hain!_`;
            const content = config.MENU_IMAGE_URL
                ? { image: { url: config.MENU_IMAGE_URL }, caption: text }
                : { text };
            await sock.sendMessage(from, content).catch(async () => {
                await sock.sendMessage(from, { text });
            });
        },
    },
    {
        name: "owner",
        aliases: [],
        description: "Show the bot owner's contact",
        async execute(sock, { from, config }) {
            const number = (config.OWNER_NUMBER || "").replace(/[^0-9]/g, "");
            const ownerName = config.OWNER_NAME || "Tasmee";
            if (!number) {
                await sock.sendMessage(from, { text: `👑 Owner: ${ownerName}` });
                return;
            }
            const vcard =
                `BEGIN:VCARD\n` +
                `VERSION:3.0\n` +
                `FN:${ownerName}\n` +
                `TEL;type=CELL;type=VOICE;waid=${number}:+${number}\n` +
                `END:VCARD`;
            await sock.sendMessage(from, {
                contacts: { displayName: ownerName, contacts: [{ vcard }] },
            });
        },
    },
    {
        name: "repo",
        aliases: ["github", "sc", "script"],
        description: "Show the bot's source code repository",
        async execute(sock, { from, config }) {
            await sock.sendMessage(from, {
                text: `📂 Source code: ${config.REPO || "https://github.com/Tasmee321/Tasmee-Ai-Bot"}`,
            });
        },
    },
    {
        name: "goodbye",
        aliases: [],
        description: "Turn goodbye messages on/off",
        async execute(sock, { from, args, config }) {
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") {
                await sock.sendMessage(from, {
                    text: `Goodbye messages use the same setting as welcome.\nCurrent status: *${config.WELCOME === "true" || config.WELCOME === true ? "ON" : "OFF"}*\n\nUsage: *.goodbye on* or *.goodbye off*`,
                });
                return;
            }
            updateConfig(config, "WELCOME", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Goodbye messages are now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "mode",
        aliases: [],
        description: "Set bot mode. Usage: .mode public/private",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) {
                await sock.sendMessage(from, { text: "❌ Only the owner can use this command." });
                return;
            }
            const choice = args[0]?.toLowerCase();
            if (choice !== "public" && choice !== "private") {
                await sock.sendMessage(from, {
                    text: `Current mode: *${config.MODE || "public"}*\n\nUsage: *.mode public* or *.mode private*`,
                });
                return;
            }
            updateConfig(config, "MODE", choice);
            await sock.sendMessage(from, { text: `✅ Bot mode set to *${choice}*.` });
        },
    },
    {
        name: "autoread",
        aliases: [],
        description: "Toggle auto-read for all messages",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) {
                await sock.sendMessage(from, { text: "❌ Only the owner can use this command." });
                return;
            }
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") {
                await sock.sendMessage(from, {
                    text: `Current status: *${config.READ_MESSAGE === "true" ? "ON" : "OFF"}*\n\nUsage: *.autoread on/off*`,
                });
                return;
            }
            updateConfig(config, "READ_MESSAGE", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Auto-read is now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "ban",
        aliases: [],
        description: "Ban a user from using the bot",
        async execute(sock, { from, args, msg, config }) {
            if (!isOwner(msg, config)) {
                await sock.sendMessage(from, { text: "❌ Only the owner can use this command." });
                return;
            }
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const target = mentioned || (args[0] ? `${args[0].replace(/[^0-9]/g, "")}@s.whatsapp.net` : null);
            if (!target) {
                await sock.sendMessage(from, { text: "❌ Mention a user or provide a number to ban." });
                return;
            }
            const banned = loadJSON("./data/banned.json", []);
            if (!banned.includes(target)) banned.push(target);
            saveJSON("./data/banned.json", banned);
            await sock.sendMessage(from, { text: `🚫 Banned: ${target.split("@")[0]}` });
        },
    },
    {
        name: "unban",
        aliases: [],
        description: "Unban a user",
        async execute(sock, { from, args, msg, config }) {
            if (!isOwner(msg, config)) {
                await sock.sendMessage(from, { text: "❌ Only the owner can use this command." });
                return;
            }
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const target = mentioned || (args[0] ? `${args[0].replace(/[^0-9]/g, "")}@s.whatsapp.net` : null);
            if (!target) {
                await sock.sendMessage(from, { text: "❌ Mention a user or provide a number to unban." });
                return;
            }
            let banned = loadJSON("./data/banned.json", []);
            banned = banned.filter((j) => j !== target);
            saveJSON("./data/banned.json", banned);
            await sock.sendMessage(from, { text: `✅ Unbanned: ${target.split("@")[0]}` });
        },
    },
    {
        name: "banlist",
        aliases: [],
        description: "Show list of banned users",
        async execute(sock, { from }) {
            const banned = loadJSON("./data/banned.json", []);
            if (banned.length === 0) {
                await sock.sendMessage(from, { text: "✅ No banned users." });
                return;
            }
            const list = banned.map((j) => `• ${j.split("@")[0]}`).join("\n");
            await sock.sendMessage(from, { text: `🚫 Banned users:\n${list}` });
        },
    },
    {
        name: "sudo",
        aliases: [],
        description: "Add a trusted sudo user",
        async execute(sock, { from, args, msg, config }) {
            if (!isOwner(msg, config)) {
                await sock.sendMessage(from, { text: "❌ Only the owner can use this command." });
                return;
            }
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const target = mentioned || (args[0] ? `${args[0].replace(/[^0-9]/g, "")}@s.whatsapp.net` : null);
            if (!target) {
                await sock.sendMessage(from, { text: "❌ Mention a user or provide a number." });
                return;
            }
            const sudoList = loadJSON("./data/sudo.json", []);
            if (!sudoList.includes(target)) sudoList.push(target);
            saveJSON("./data/sudo.json", sudoList);
            await sock.sendMessage(from, { text: `✅ Added as sudo: ${target.split("@")[0]}` });
        },
    },
    {
        name: "delsudo",
        aliases: [],
        description: "Remove a sudo user",
        async execute(sock, { from, args, msg, config }) {
            if (!isOwner(msg, config)) {
                await sock.sendMessage(from, { text: "❌ Only the owner can use this command." });
                return;
            }
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const target = mentioned || (args[0] ? `${args[0].replace(/[^0-9]/g, "")}@s.whatsapp.net` : null);
            let sudoList = loadJSON("./data/sudo.json", []);
            sudoList = sudoList.filter((j) => j !== target);
            saveJSON("./data/sudo.json", sudoList);
            await sock.sendMessage(from, { text: `✅ Removed sudo access.` });
        },
    },
    {
        name: "listsudo",
        aliases: [],
        description: "Show list of sudo users",
        async execute(sock, { from }) {
            const sudoList = loadJSON("./data/sudo.json", []);
            if (sudoList.length === 0) {
                await sock.sendMessage(from, { text: "No sudo users set." });
                return;
            }
            const list = sudoList.map((j) => `• ${j.split("@")[0]}`).join("\n");
            await sock.sendMessage(from, { text: `👤 Sudo users:\n${list}` });
        },
    },
    {
        name: "antilink",
        aliases: [],
        description: "Toggle auto-removal of group links",
        async execute(sock, { from, args, isGroup, config }) {
            if (!isGroup) {
                await sock.sendMessage(from, { text: "❌ This command only works in groups." });
                return;
            }
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") {
                await sock.sendMessage(from, { text: `Usage: *.antilink on* or *.antilink off*` });
                return;
            }
            const settings = loadJSON("./data/antilink.json", {});
            settings[from] = choice === "on";
            saveJSON("./data/antilink.json", settings);
            await sock.sendMessage(from, { text: `✅ Anti-link is now *${choice.toUpperCase()}* for this group.` });
        },
    },
    {
        name: "settings",
        aliases: [],
        description: "Show current bot settings",
        async execute(sock, { from, config }) {
            const text = `⚙️ *Current Settings*\n\n` +
                `Bot Name: ${config.BOT_NAME}\n` +
                `Owner: ${config.OWNER_NAME}\n` +
                `Prefix: ${config.PREFIX}\n` +
                `Mode: ${config.MODE || "public"}\n` +
                `Welcome/Goodbye: ${config.WELCOME === "true" || config.WELCOME === true ? "ON" : "OFF"}\n` +
                `Auto-read: ${config.READ_MESSAGE === "true" ? "ON" : "OFF"}`;
            await sock.sendMessage(from, { text });
        },
    },
    {
        name: "block",
        aliases: [],
        description: "Block a user",
        async execute(sock, { from, args, msg, config }) {
            if (!isOwner(msg, config)) {
                await sock.sendMessage(from, { text: "❌ Only the owner can use this command." });
                return;
            }
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const target = mentioned || (args[0] ? `${args[0].replace(/[^0-9]/g, "")}@s.whatsapp.net` : null);
            if (!target) {
                await sock.sendMessage(from, { text: "❌ Mention a user or provide a number." });
                return;
            }
            await sock.updateBlockStatus(target, "block");
            await sock.sendMessage(from, { text: `🚫 Blocked: ${target.split("@")[0]}` });
        },
    },
    {
        name: "unblock",
        aliases: [],
        description: "Unblock a user",
        async execute(sock, { from, args, msg, config }) {
            if (!isOwner(msg, config)) {
                await sock.sendMessage(from, { text: "❌ Only the owner can use this command." });
                return;
            }
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
            const target = mentioned || (args[0] ? `${args[0].replace(/[^0-9]/g, "")}@s.whatsapp.net` : null);
            if (!target) {
                await sock.sendMessage(from, { text: "❌ Mention a user or provide a number." });
                return;
            }
            await sock.updateBlockStatus(target, "unblock");
            await sock.sendMessage(from, { text: `✅ Unblocked: ${target.split("@")[0]}` });
        },
    },
    {
        name: "tiktok",
        aliases: ["tt"],
        description: "Download a TikTok video",
        async execute(sock, { from, args, msg }) {
            const url = args[0];
            if (!url || !url.includes("tiktok.com")) {
                await sock.sendMessage(from, { text: "❌ Please provide a valid TikTok link." });
                return;
            }
            await sock.sendMessage(from, { text: "⏳ Downloading..." });
            try {
                const res = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
                const data = await res.json();
                const videoUrl = data?.data?.play;
                if (!videoUrl) throw new Error("Could not fetch video.");
                await sock.sendMessage(from, { video: { url: videoUrl }, caption: "🎵 TikTok" }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Failed: ${err.message}` });
            }
        },
    },
    {
        name: "prefix",
        aliases: [],
        description: "Change command prefix",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            if (!args[0]) return sock.sendMessage(from, { text: `Current prefix: *${config.PREFIX}*` });
            updateConfig(config, "PREFIX", args[0]);
            await sock.sendMessage(from, { text: `✅ Prefix changed to: *${args[0]}*` });
        },
    },
    {
        name: "botname",
        aliases: [],
        description: "Change bot name",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const name = args.join(" ");
            if (!name) return sock.sendMessage(from, { text: `Current bot name: *${config.BOT_NAME}*` });
            updateConfig(config, "BOT_NAME", name);
            await sock.sendMessage(from, { text: `✅ Bot name changed to: *${name}*` });
        },
    },
    {
        name: "ownername",
        aliases: [],
        description: "Change owner name",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const name = args.join(" ");
            if (!name) return sock.sendMessage(from, { text: `Current owner name: *${config.OWNER_NAME}*` });
            updateConfig(config, "OWNER_NAME", name);
            await sock.sendMessage(from, { text: `✅ Owner name changed to: *${name}*` });
        },
    },
    {
        name: "ownernumber",
        aliases: [],
        description: "Change owner number",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const number = args[0]?.replace(/[^0-9]/g, "");
            if (!number) return sock.sendMessage(from, { text: `Current owner number: *${config.OWNER_NUMBER}*` });
            updateConfig(config, "OWNER_NUMBER", number);
            await sock.sendMessage(from, { text: `✅ Owner number updated.` });
        },
    },
    {
        name: "description",
        aliases: [],
        description: "Change bot description",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const desc = args.join(" ");
            if (!desc) return sock.sendMessage(from, { text: `Current description: *${config.DESCRIPTION}*` });
            updateConfig(config, "DESCRIPTION", desc);
            await sock.sendMessage(from, { text: `✅ Description updated.` });
        },
    },
    {
        name: "stickername",
        aliases: [],
        description: "Change sticker pack name",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const name = args.join(" ");
            if (!name) return sock.sendMessage(from, { text: `Current sticker name: *${config.STICKER_NAME}*` });
            updateConfig(config, "STICKER_NAME", name);
            await sock.sendMessage(from, { text: `✅ Sticker pack name updated.` });
        },
    },
    {
        name: "setwelcome",
        aliases: [],
        description: "Set welcome message",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const text = args.join(" ");
            if (!text) return sock.sendMessage(from, { text: `Current: *${config.WELCOME_MSG || "(default)"}*` });
            updateConfig(config, "WELCOME_MSG", text);
            await sock.sendMessage(from, { text: `✅ Welcome message updated.` });
        },
    },
    {
        name: "setgoodbye",
        aliases: [],
        description: "Set goodbye message",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const text = args.join(" ");
            if (!text) return sock.sendMessage(from, { text: `Current: *${config.GOODBYE_MSG || "(default)"}*` });
            updateConfig(config, "GOODBYE_MSG", text);
            await sock.sendMessage(from, { text: `✅ Goodbye message updated.` });
        },
    },
    {
        name: "broadcast",
        aliases: ["bc"],
        description: "Owner-only: send a message to every group the bot is in",
        async execute(sock, { from, args, text, msg, config }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const message = text.slice(text.indexOf(args[0])).trim();
            if (!message) return sock.sendMessage(from, { text: "Usage: .broadcast <message>" });

            const groups = await sock.groupFetchAllParticipating().catch(() => ({}));
            const groupIds = Object.keys(groups);
            if (groupIds.length === 0) return sock.sendMessage(from, { text: "⚠️ Bot kisi group mein nahi hai." });

            await sock.sendMessage(from, { text: `📢 Broadcasting to ${groupIds.length} group(s)...` });
            let sent = 0;
            for (const gid of groupIds) {
                const ok = await sock.sendMessage(gid, { text: `📢 *Announcement*\n\n${message}` }).then(() => true).catch(() => false);
                if (ok) sent++;
                await new Promise((r) => setTimeout(r, 1500)); // small delay to avoid spam-flagging
            }
            await sock.sendMessage(from, { text: `✅ Broadcast bhej diya ${sent}/${groupIds.length} group(s) mein.` });
        },
    },
    {
        name: "antibadword",
        aliases: ["antibad"],
        description: "Toggle auto-deleting messages with bad words (edit data/badwords.json to set the word list)",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") {
                return sock.sendMessage(from, { text: `Current: *${config.ANTI_BAD_WORD === "true" ? "ON" : "OFF"}*\n\nUsage: .antibadword on/off\nWord list: data/badwords.json (empty by default — add words there).` });
            }
            updateConfig(config, "ANTI_BAD_WORD", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Anti bad-word is now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "antiviewonce",
        aliases: ["antivv", "vv"],
        description: "Toggle auto-revealing view-once photos/videos/voice notes",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") return sock.sendMessage(from, { text: `Current: *${config.ANTI_VV === "true" ? "ON" : "OFF"}*` });
            updateConfig(config, "ANTI_VV", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Anti view-once is now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "antidelete",
        aliases: [],
        description: "Toggle deleted messages",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") return sock.sendMessage(from, { text: `Current: *${config.ANTI_DELETE === "true" ? "ON" : "OFF"}*` });
            updateConfig(config, "ANTI_DELETE", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Anti-delete is now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "editpath",
        aliases: ["delpath"],
        description: "Where deleted messages go",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "same" && choice !== "inbox") return sock.sendMessage(from, { text: `Current: *${config.ANTI_DEL_PATH || "inbox"}*` });
            updateConfig(config, "ANTI_DEL_PATH", choice);
            await sock.sendMessage(from, { text: `✅ Deleted messages go to: *${choice}*` });
        },
    },
    {
        name: "recording",
        aliases: [],
        description: "Toggle recording indicator",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") return sock.sendMessage(from, { text: `Current: *${config.AUTO_RECORDING === "true" ? "ON" : "OFF"}*` });
            updateConfig(config, "AUTO_RECORDING", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Recording indicator is now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "autotyping",
        aliases: [],
        description: "Toggle typing indicator",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") return sock.sendMessage(from, { text: `Current: *${config.AUTO_TYPING === "true" ? "ON" : "OFF"}*` });
            updateConfig(config, "AUTO_TYPING", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Auto-typing is now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "online",
        aliases: [],
        description: "Toggle always-online mode",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") return sock.sendMessage(from, { text: `Current: *${config.ALWAYS_ONLINE === "true" ? "ON" : "OFF"}*` });
            updateConfig(config, "ALWAYS_ONLINE", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Always-online is now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "autoreact",
        aliases: [],
        description: "Toggle auto-reacting",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") return sock.sendMessage(from, { text: `Current: *${config.AUTO_REACT === "true" ? "ON" : "OFF"}*` });
            updateConfig(config, "AUTO_REACT", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Auto-react is now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "anticall",
        aliases: [],
        description: "Toggle rejecting incoming calls",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") return sock.sendMessage(from, { text: `Current: *${config.ANTI_CALL === "true" ? "ON" : "OFF"}*` });
            updateConfig(config, "ANTI_CALL", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Anti-call is now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "anticallmsg",
        aliases: [],
        description: "Set rejected call message",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const text = args.join(" ");
            if (!text) return sock.sendMessage(from, { text: `Current: *${config.REJECT_MSG || "(default)"}*` });
            updateConfig(config, "REJECT_MSG", text);
            await sock.sendMessage(from, { text: `✅ Anti-call message updated.` });
        },
    },
    {
        name: "adminaction",
        aliases: [],
        description: "Toggle admin notifications",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") return sock.sendMessage(from, { text: `Current: *${config.ADMIN_ACTION === "true" ? "ON" : "OFF"}*` });
            updateConfig(config, "ADMIN_ACTION", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Admin notifications are now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "statuslike",
        aliases: [],
        description: "Toggle auto-liking statuses",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") return sock.sendMessage(from, { text: `Current: *${config.AUTO_STATUS_REACT === "true" ? "ON" : "OFF"}*` });
            updateConfig(config, "AUTO_STATUS_REACT", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Status auto-like is now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "ai",
        aliases: ["gemini", "gpt", "ask"],
        description: "Ask the AI a question. Usage: .ai <your question>",
        async execute(sock, { from, args, config, msg }) {
            const question = args.join(" ");
            if (!question) {
                await sock.sendMessage(from, {
                    text: `❓ Please ask something. Example: *${config.PREFIX || "."}ai What is the capital of Pakistan?*`,
                });
                return;
            }

            // Urgent-contact shortcut: skip the AI call and hand out the
            // owner's personal number right away if clearly asked/urgent.
            if (URGENT_CONTACT_REGEX.test(question)) {
                await sock.sendMessage(from, {
                    text: `📞 Ji zaroor, aap seedha baat kar sakte hain:\n*${OWNER_PERSONAL_NAME}*\n${OWNER_PERSONAL_NUMBER} (wa.me/923423899407)`,
                });
                return;
            }

            if (groq.getKeys().length === 0) {
                await sock.sendMessage(from, { text: "⚠️ API key not set in config." });
                return;
            }

            await sock.sendMessage(from, { text: "🤖 Thinking..." });

            try {
                const { name, history } = memory.getContext(from);
                let systemPrompt = await buildSystemPrompt(config.AI_PERSONA, question);
                if (name) systemPrompt += `\n\nThe user's name in this chat is "${name}" — you were told this earlier, use it naturally when it fits.`;

                const answer = await chatWithTools(sock, { from, msg, config, systemPrompt, history, question });
                if (!answer) throw new Error("Sorry, I couldn't generate a response.");

                await sock.sendMessage(from, { text: `🤖 ${answer}` });
                memory.remember(from, question, answer);
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ AI error: ${err.message}` });
            }
        },
    },
    {
        name: "yt",
        aliases: ["youtube", "ytmp3", "ytmp4"],
        description: "Download YouTube audio/video",
        async execute(sock, { from, args, text, msg, config }) {
            const explicitVideo = /\bvideo\b/i.test(text) || text.includes("ytmp4");
            const explicitAudio = /\baudio\b/i.test(text) || text.includes("ytmp3");
            const cleanArgs = args.filter((a) => !/^(audio|video)$/i.test(a));
            const query = cleanArgs.join(" ");

            if (!query) {
                await sock.sendMessage(from, {
                    text: "❌ Please provide a YouTube link or a song/video name.\nExample: *.yt Attention Charlie Puth*",
                });
                return;
            }

            await startYtFlow(sock, {
                from,
                msg,
                query,
                wantsVideo: explicitVideo ? true : explicitAudio ? false : null,
                config,
            });
        },
    },
    {
        name: "welcome",
        aliases: [],
        description: "Turn welcome/goodbye messages on or off",
        async execute(sock, { from, args, config }) {
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") {
                await sock.sendMessage(from, {
                    text: `Current status: *${config.WELCOME === "true" || config.WELCOME === true ? "ON" : "OFF"}*\n\nUsage: *.welcome on* or *.welcome off*`,
                });
                return;
            }
            updateConfig(config, "WELCOME", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Welcome/goodbye messages are now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "sticker",
        aliases: ["s", "stiker"],
        description: "Convert an image to a sticker",
        async execute(sock, { from, msg }) {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMsg = quoted ? { message: quoted, key: msg.key } : msg;
            const hasImage = targetMsg.message?.imageMessage;

            if (!hasImage) {
                await sock.sendMessage(from, { text: "❌ Please send or reply to an image with *.sticker*." });
                return;
            }

            try {
                const buffer = await downloadMediaMessage(targetMsg, "buffer", {});
                const webpBuffer = await sharp(buffer)
                    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .webp()
                    .toBuffer();
                await sock.sendMessage(from, { sticker: webpBuffer });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Sticker conversion failed: ${err.message}` });
            }
        },
    },
    {
        name: "text",
        aliases: ["stylish", "name"],
        description: "Turn a name/word into a stylish image. Usage: .text <name>",
        async execute(sock, { from, args, msg }) {
            const raw = args.join(" ").trim();
            if (!raw) {
                await sock.sendMessage(from, { text: "❓ Please provide a name/word. Example: *.text Shahzad*" });
                return;
            }
            if (raw.length > 24) {
                await sock.sendMessage(from, { text: "❌ Please keep it under 24 characters for a clean-looking image." });
                return;
            }

            // Escape XML special chars so the name can't break the SVG.
            const safeText = raw
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");

            // Pick a font size that shrinks for longer names so it still fits.
            const width = 900;
            const height = 500;
            let fontSize = 110;
            if (raw.length > 8) fontSize = 90;
            if (raw.length > 12) fontSize = 70;
            if (raw.length > 18) fontSize = 55;

            // Random-ish but deterministic-per-word gradient pick, so the
            // same name always looks the same but different names differ.
            const palettes = [
                ["#ff6a00", "#ee0979"],
                ["#00c6ff", "#0072ff"],
                ["#f7971e", "#ffd200"],
                ["#8e2de2", "#4a00e0"],
                ["#11998e", "#38ef7d"],
                ["#fc466b", "#3f5efb"],
            ];
            let seed = 0;
            for (const ch of raw) seed += ch.charCodeAt(0);
            const [colorA, colorB] = palettes[seed % palettes.length];

            const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f0c29"/>
      <stop offset="50%" stop-color="#302b63"/>
      <stop offset="100%" stop-color="#24243e"/>
    </linearGradient>
    <linearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${colorA}"/>
      <stop offset="100%" stop-color="${colorB}"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="10" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bgGrad)"/>
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="url(#textGrad)" stroke-width="4" rx="24"/>
  <text x="50%" y="52%" font-family="Georgia, 'DejaVu Serif', serif" font-weight="bold" font-size="${fontSize}"
        fill="url(#textGrad)" stroke="#ffffff" stroke-width="1.5" text-anchor="middle" dominant-baseline="middle"
        filter="url(#glow)">${safeText}</text>
  <text x="50%" y="90%" font-family="Arial, sans-serif" font-size="18" fill="#ffffffaa" text-anchor="middle">Tasmee-Ai-Bot</text>
</svg>`.trim();

            try {
                const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
                await sock.sendMessage(from, { image: pngBuffer, caption: `✨ *${raw}*` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Couldn't generate the image: ${err.message}` });
            }
        },
    },
    {
        name: "image",
        aliases: ["img", "imagine", "generate", "photo"],
        description: "Real photo dhoondein (na mile to AI image banayein). Usage: .image <cheez ka naam>",
        async execute(sock, { from, args, msg }) {
            const prompt = args.join(" ").trim();
            if (!prompt) {
                module.exports.pendingImage.set(from, Date.now());
                setTimeout(() => {
                    const ts = module.exports.pendingImage.get(from);
                    if (ts && Date.now() - ts >= 120000) module.exports.pendingImage.delete(from);
                }, 120000);
                await sock.sendMessage(from, {
                    text: "🖼️ Zaroor! Kis cheez ki image chahiye? Naam bata dein.",
                }, { quoted: msg });
                return;
            }
            await fetchOrGenerateImage(sock, from, msg, prompt);
        },
    },
    {
        name: "weather",
        aliases: ["mausam", "temperature"],
        description: "Kisi bhi shehar ka live mausam. Usage: .weather <city>",
        async execute(sock, { from, args, msg }) {
            const city = args.join(" ").trim() || "Faisalabad";
            try {
                const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
                const geoData = await geoRes.json();
                const place = geoData.results?.[0];
                if (!place) {
                    await sock.sendMessage(from, { text: `❌ "${city}" nahi mila. Sahi shehar ka naam try karein.` }, { quoted: msg });
                    return;
                }
                const wRes = await fetch(
                    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`
                );
                const wData = await wRes.json();
                const c = wData.current;
                if (!c) throw new Error("Weather data mojood nahi.");
                const desc = describeWeatherCode(c.weather_code);
                const location = `${place.name}${place.admin1 ? ", " + place.admin1 : ""}, ${place.country}`;
                const text =
                    `📍 *${location}*\n\n${desc}\n` +
                    `🌡️ Temperature: ${c.temperature_2m}°C (feels like ${c.apparent_temperature}°C)\n` +
                    `💧 Humidity: ${c.relative_humidity_2m}%\n` +
                    `💨 Hawa: ${c.wind_speed_10m} km/h\n\n` +
                    `🕒 ${getPakistanDateTimeString()}`;
                await sock.sendMessage(from, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Mausam ka data nahi mil saka: ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "news",
        aliases: ["khabrain", "khabar"],
        description: "Latest news headlines. Usage: .news [topic]",
        async execute(sock, { from, args, msg }) {
            const topic = args.join(" ").trim();
            const rssUrl = topic
                ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-PK&gl=PK&ceid=PK:en`
                : `https://news.google.com/rss?hl=en-PK&gl=PK&ceid=PK:en`;
            try {
                const res = await fetch(rssUrl);
                const xml = await res.text();
                const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6);
                if (items.length === 0) {
                    await sock.sendMessage(from, { text: "❌ Abhi news nahi mil saki, thori dair baad try karein." }, { quoted: msg });
                    return;
                }
                const decode = (s) =>
                    (s || "")
                        .replace(/&#39;/g, "'")
                        .replace(/&quot;/g, '"')
                        .replace(/&amp;/g, "&")
                        .replace(/&lt;/g, "<")
                        .replace(/&gt;/g, ">")
                        .trim();
                const lines = items.map((m, i) => {
                    const block = m[1];
                    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/);
                    const linkMatch = block.match(/<link>(.*?)<\/link>/);
                    const title = decode(titleMatch?.[1]);
                    const link = linkMatch?.[1] || "";
                    return `${i + 1}. *${title}*\n${link}`;
                });
                const header = topic ? `📰 *News: ${topic}*` : `📰 *Aaj ki Top Headlines*`;
                await sock.sendMessage(from, { text: `${header}\n\n${lines.join("\n\n")}` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ News fetch nahi ho saki: ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "pinterest",
        aliases: ["pin", "pins"],
        description: "Pinterest se pictures download karein. Usage: .pinterest <query>",
        async execute(sock, { from, args, msg }) {
            const query = args.join(" ").trim();
            if (!query) {
                await sock.sendMessage(from, { text: "❓ Kis cheez ki image chahiye? Example: *.pinterest sunset wallpaper*" }, { quoted: msg });
                return;
            }
            await sock.sendMessage(from, { text: `📌 "${query}" search kar raha hoon...` }, { quoted: msg });
            try {
                const unique = await pinterestImageSearch(query, 4);

                if (unique.length === 0) {
                    await sock.sendMessage(from, { text: "❌ Koi image nahi mili, dusra keyword try karein." }, { quoted: msg });
                    return;
                }

                let sent = 0;
                for (const imgUrl of unique) {
                    try {
                        const imgRes = await fetch(imgUrl);
                        if (!imgRes.ok) continue;
                        const buffer = Buffer.from(await imgRes.arrayBuffer());
                        await sock.sendMessage(from, { image: buffer, caption: `📌 ${query}` });
                        sent++;
                    } catch {
                        // skip broken image, try the next one
                    }
                }
                if (sent === 0) {
                    await sock.sendMessage(from, { text: "❌ Images mil to gayin lekin download nahi ho sakin, dobara try karein." }, { quoted: msg });
                }
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Pinterest se images nahi mil sakin: ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "search",
        aliases: ["google", "websearch"],
        description: "Live web se jawab dhoondein. Usage: .search <sawaal>",
        async execute(sock, { from, args, config, msg }) {
            const query = args.join(" ").trim();
            if (!query) {
                await sock.sendMessage(from, { text: "❓ Kya search karna hai? Example: *.search aaj USD to PKR rate*" }, { quoted: msg });
                return;
            }

            await sock.sendMessage(from, { text: "🔎 Web par search kar raha hoon..." }, { quoted: msg });
            const results = await webSearch(query, 5);
            if (results.length === 0) {
                await sock.sendMessage(from, { text: "❌ Web search se kuch nahi mila, dobara try karein." }, { quoted: msg });
                return;
            }

            if (groq.getKeys().length === 0) {
                const list = results.map((r, i) => `${i + 1}. *${r.title}*\n${r.snippet}\n${r.url}`).join("\n\n");
                await sock.sendMessage(from, { text: `🔎 *Results:*\n\n${list}` }, { quoted: msg });
                return;
            }

            try {
                const context = results.map((r, i) => `[${i + 1}] ${r.title} — ${r.snippet} (${r.url})`).join("\n");
                const systemPrompt =
                    `Aaj ki tareekh: ${getPakistanDateTimeString()}. Neeche live web search results diye gaye hain — inhe apne alfaz mein use karke, Roman Urdu mein, seedha aur mukhtasar jawab dein. Aakhir mein 1-2 source links bhi de dein.\n\n${context}`;
                const data = await groq.groqChatWithFallback({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: query },
                    ],
                });
                const answer = data.choices?.[0]?.message?.content;
                if (answer) {
                    await sock.sendMessage(from, { text: `🔎 ${answer}` }, { quoted: msg });
                } else {
                    throw new Error("AI se jawab nahi mila");
                }
            } catch (err) {
                const list = results.map((r, i) => `${i + 1}. *${r.title}*\n${r.snippet}\n${r.url}`).join("\n\n");
                await sock.sendMessage(from, { text: `🔎 *Results:*\n\n${list}` }, { quoted: msg });
            }
        },
    },
    {
        name: "developer",
        aliases: ["dev", "bug", "report", "support"],
        description: "Bug report ya madad ke liye developer se contact karein",
        async execute(sock, { from, msg }) {
            await sock.sendMessage(from, {
                text:
                    `🛠️ Koi bug mila ya koi command kaam nahi kar raha?\n` +
                    `Developer ko seedha message karein:\n` +
                    `👨‍💻 *Tasmee ul Hasnain*\n` +
                    `📞 wa.me/923423899407`,
            }, { quoted: msg });
        },
    },

    // ============================================
    // Islamic / prayer utilities
    // ============================================
    {
        name: "prayertimes",
        aliases: ["namaz", "salah"],
        description: "Namaz ke aaj ke timings. Usage: .namaz <city>",
        async execute(sock, { from, args, msg }) {
            const city = args.join(" ").trim() || "Faisalabad";
            try {
                const res = await fetch(`https://api.aladhan.com/v1/timingsByCity?city=${encodeURIComponent(city)}&country=Pakistan&method=1`);
                const data = await res.json();
                const t = data?.data?.timings;
                if (!t) throw new Error("Timings nahi mile.");
                const text =
                    `🕌 *Namaz Timings — ${city}*\n\n` +
                    `🌅 Fajr: ${t.Fajr}\n` +
                    `☀️ Zuhr: ${t.Dhuhr}\n` +
                    `🌤️ Asr: ${t.Asr}\n` +
                    `🌇 Maghrib: ${t.Maghrib}\n` +
                    `🌙 Isha: ${t.Isha}\n\n` +
                    `📅 ${data.data.date?.readable || ""}`;
                await sock.sendMessage(from, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Namaz timings nahi mil sake: ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "qibla",
        aliases: [],
        description: "Qibla ki direction. Usage: .qibla <city>",
        async execute(sock, { from, args, msg }) {
            const city = args.join(" ").trim() || "Faisalabad";
            try {
                const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
                const geoData = await geoRes.json();
                const place = geoData.results?.[0];
                if (!place) throw new Error(`"${city}" nahi mila.`);
                const qRes = await fetch(`https://api.aladhan.com/v1/qibla/${place.latitude}/${place.longitude}`);
                const qData = await qRes.json();
                const direction = qData?.data?.direction;
                if (direction === undefined) throw new Error("Qibla direction nahi mili.");
                await sock.sendMessage(from, {
                    text: `🕋 *Qibla Direction — ${place.name}*\n\n📐 ${direction.toFixed(1)}° (North se, clockwise)\n\nCompass app mein ye angle set karein.`,
                }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "hijri",
        aliases: ["islamicdate"],
        description: "Aaj ki Hijri/Islamic tareekh",
        async execute(sock, { from, msg }) {
            try {
                const now = new Date();
                const dd = String(now.getDate()).padStart(2, "0");
                const mm = String(now.getMonth() + 1).padStart(2, "0");
                const yyyy = now.getFullYear();
                const res = await fetch(`https://api.aladhan.com/v1/gToH?date=${dd}-${mm}-${yyyy}`);
                const data = await res.json();
                const h = data?.data?.hijri;
                if (!h) throw new Error("Hijri date nahi mili.");
                await sock.sendMessage(from, {
                    text: `📅 *Aaj ki Islamic Tareekh*\n\n${h.day} ${h.month?.en} ${h.year} AH\n(${h.weekday?.en})`,
                }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },

    // ============================================
    // Group management
    // ============================================
    {
        name: "tagall",
        aliases: ["everyone"],
        description: "Group ke sab members ko tag karein (admin only). Usage: .tagall [message]",
        async execute(sock, { from, args, isGroup, msg, config }) {
            if (!isGroup) return sock.sendMessage(from, { text: "❌ Sirf groups mein kaam karta hai." });
            const senderJid = msg.key.participant || from;
            const meta = await sock.groupMetadata(from).catch(() => null);
            if (!meta) return sock.sendMessage(from, { text: "❌ Group info nahi mil saki." });
            const senderParticipant = meta.participants.find((p) => p.id === senderJid);
            const senderIsAdmin = senderParticipant?.admin === "admin" || senderParticipant?.admin === "superadmin";
            if (!senderIsAdmin && !isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Sirf group admins ye command use kar sakte hain." });

            const message = args.join(" ").trim() || "📢 Attention everyone!";
            const mentions = meta.participants.map((p) => p.id);
            const mentionText = mentions.map((id) => `@${id.split("@")[0]}`).join(" ");
            await sock.sendMessage(from, { text: `${message}\n\n${mentionText}`, mentions });
        },
    },
    {
        name: "kick",
        aliases: ["remove"],
        description: "Group se member remove karein (admin only, reply karein us member ke message pe)",
        async execute(sock, { from, args, isGroup, msg, config }) {
            if (!isGroup) return sock.sendMessage(from, { text: "❌ Sirf groups mein kaam karta hai." });
            const senderJid = msg.key.participant || from;
            const meta = await sock.groupMetadata(from).catch(() => null);
            if (!meta) return sock.sendMessage(from, { text: "❌ Group info nahi mil saki." });
            const senderParticipant = meta.participants.find((p) => p.id === senderJid);
            const senderIsAdmin = senderParticipant?.admin === "admin" || senderParticipant?.admin === "superadmin";
            if (!senderIsAdmin && !isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Sirf group admins ye command use kar sakte hain." });

            let targetJid = msg.message?.extendedTextMessage?.contextInfo?.participant;
            if (!targetJid && args[0]) targetJid = args[0].replace(/[^0-9]/g, "") + "@s.whatsapp.net";
            if (!targetJid) return sock.sendMessage(from, { text: "❓ Kis ko remove karna hai? Us ke message pe reply karein ya number dein." });

            try {
                await sock.groupParticipantsUpdate(from, [targetJid], "remove");
                await sock.sendMessage(from, { text: `✅ Member remove kar diya.` });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Remove nahi ho saka (bot ko group admin banayein): ${err.message}` });
            }
        },
    },

    // ============================================
    // AI-assisted utilities
    // ============================================
    {
        name: "clearchat",
        aliases: ["resetai", "forget"],
        description: "Is chat ki AI memory reset karein",
        async execute(sock, { from, msg }) {
            memory.forget(from);
            await sock.sendMessage(from, { text: "🧹 AI memory clear kar di is chat ki — naye sirey se baat karte hain!" }, { quoted: msg });
        },
    },
    {
        name: "translate",
        aliases: ["tr"],
        description: "Text translate karein. Usage: .translate <language> <text>",
        async execute(sock, { from, args, msg }) {
            if (groq.getKeys().length === 0) return sock.sendMessage(from, { text: "⚠️ API key not set." });
            const targetLang = args[0];
            const text = args.slice(1).join(" ");
            if (!targetLang || !text) return sock.sendMessage(from, { text: "Usage: .translate <language> <text>\nExample: .translate english mera naam ali hai" });
            try {
                const data = await groq.groqChatWithFallback({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: `Translate the user's text into ${targetLang}. Reply with ONLY the translation, nothing else.` },
                        { role: "user", content: text },
                    ],
                });
                const translated = data.choices?.[0]?.message?.content;
                await sock.sendMessage(from, { text: `🌐 ${translated || "Translate nahi ho saka."}` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "shayari",
        aliases: ["poetry"],
        description: "AI se Urdu shayari. Usage: .shayari [topic]",
        async execute(sock, { from, args, msg }) {
            if (groq.getKeys().length === 0) return sock.sendMessage(from, { text: "⚠️ API key not set." });
            const topic = args.join(" ").trim() || "mohabbat";
            try {
                const data = await groq.groqChatWithFallback({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: "You write short, beautiful 2-4 line Urdu shayari in Roman Urdu script. Reply with ONLY the shayari, nothing else." },
                        { role: "user", content: `Shayari likho "${topic}" ke topic par.` },
                    ],
                });
                const shayari = data.choices?.[0]?.message?.content;
                await sock.sendMessage(from, { text: `✨ ${shayari || "Shayari nahi ban saki."}` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "joke",
        aliases: ["lateefa"],
        description: "Ek random joke",
        async execute(sock, { from, msg }) {
            if (groq.getKeys().length === 0) return sock.sendMessage(from, { text: "⚠️ API key not set." });
            try {
                const data = await groq.groqChatWithFallback({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: "Tell one short, clean, funny joke in Roman Urdu/English mix. Reply with ONLY the joke." },
                        { role: "user", content: "Ek joke sunao." },
                    ],
                });
                const joke = data.choices?.[0]?.message?.content;
                await sock.sendMessage(from, { text: `😂 ${joke || "Joke nahi soch saka abhi."}` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "quote",
        aliases: ["motivation"],
        description: "Motivational ya Islamic quote",
        async execute(sock, { from, msg }) {
            if (groq.getKeys().length === 0) return sock.sendMessage(from, { text: "⚠️ API key not set." });
            try {
                const data = await groq.groqChatWithFallback({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: "Share one short motivational quote (Islamic wisdom or general life advice) in Roman Urdu or English. Reply with ONLY the quote." },
                        { role: "user", content: "Aaj ka ek quote do." },
                    ],
                });
                const quote = data.choices?.[0]?.message?.content;
                await sock.sendMessage(from, { text: `💭 ${quote || "Quote nahi mil saka."}` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },

    // ============================================
    // Fun / entertainment
    // ============================================
    {
        name: "truthordare",
        aliases: ["tod"],
        description: "Truth ya dare khelein. Usage: .truthordare [truth|dare]",
        async execute(sock, { from, args, msg }) {
            const truths = [
                "Aapki sabse embarrassing memory kya hai?",
                "Kisi se jhoot bola ho recently, kya tha?",
                "Aapka crush kaun hai (ya tha)?",
                "Aapki sabse buri aadat kya hai?",
            ];
            const dares = [
                "Apni akhri message zor se parh kar sunayein.",
                "Ek minute tak bina hansay rahein.",
                "Group ke kisi member ko abhi ek compliment dein.",
                "Apni voice mein ek gaana ga kar bhejein.",
            ];
            const choice = args[0]?.toLowerCase();
            const pick =
                choice === "dare" ? dares[Math.floor(Math.random() * dares.length)]
                : choice === "truth" ? truths[Math.floor(Math.random() * truths.length)]
                : Math.random() > 0.5 ? `TRUTH: ${truths[Math.floor(Math.random() * truths.length)]}`
                : `DARE: ${dares[Math.floor(Math.random() * dares.length)]}`;
            await sock.sendMessage(from, { text: `🎲 ${pick}` }, { quoted: msg });
        },
    },
    {
        name: "compatibility",
        aliases: ["lovemeter"],
        description: "Fun love compatibility (sirf timepass!). Usage: .compatibility <naam1> <naam2>",
        async execute(sock, { from, args, msg }) {
            if (args.length < 2) return sock.sendMessage(from, { text: "Usage: .compatibility Ali Sara" });
            const [name1, name2] = args;
            const combined = (name1 + name2).toLowerCase();
            let hash = 0;
            for (let i = 0; i < combined.length; i++) hash = (hash * 31 + combined.charCodeAt(i)) % 101;
            const bar = "█".repeat(Math.round(hash / 10)) + "░".repeat(10 - Math.round(hash / 10));
            await sock.sendMessage(from, { text: `💘 *${name1} + ${name2}*\n\n${bar} ${hash}%\n\n(Sirf timepass ke liye! 😄)` }, { quoted: msg });
        },
    },
    {
        name: "riddle",
        aliases: ["paheli"],
        description: "Ek random riddle/paheli",
        async execute(sock, { from, msg }) {
            const riddles = [
                { q: "Woh kya cheez hai jo bolti hai lekin muh nahi hai?", a: "Echo (Awaz ki goonj)" },
                { q: "Jo cheez jitni zyada nikaali jaye, utna bara gaddha ban jata hai. Kya hai wo?", a: "Kuwan (Well)" },
                { q: "Do behnain hain, ek dusri ko dekhti nahi. Kaun hain?", a: "Aankhein" },
                { q: "Woh kya hai jo raat ko aata hai bina bulaye, aur din mein chala jata hai bina kahe?", a: "Sitaray" },
            ];
            const pick = riddles[Math.floor(Math.random() * riddles.length)];
            await sock.sendMessage(from, { text: `🧩 *Paheli:*\n${pick.q}\n\n_Jawab: reply karein ".riddle answer" — ya khud sochein!_` }, { quoted: msg });
        },
    },

    // ============================================
    // Utilities
    // ============================================
    {
        name: "currency",
        aliases: ["convert", "exchangerate"],
        description: "Currency convert karein. Usage: .currency <amount> <from> <to>",
        async execute(sock, { from, args, msg }) {
            const [amountStr, fromCur, toCur] = args;
            const amount = parseFloat(amountStr);
            if (!amount || !fromCur || !toCur) return sock.sendMessage(from, { text: "Usage: .currency 100 USD PKR" });
            try {
                const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${fromCur.toUpperCase()}`);
                const data = await res.json();
                const rate = data?.rates?.[toCur.toUpperCase()];
                if (!rate) throw new Error("Currency code galat hai ya rate nahi mila.");
                const result = (amount * rate).toFixed(2);
                await sock.sendMessage(from, { text: `💱 ${amount} ${fromCur.toUpperCase()} = *${result} ${toCur.toUpperCase()}*` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "qr",
        aliases: ["qrcode"],
        description: "QR code banayein. Usage: .qr <text/link>",
        async execute(sock, { from, args, msg }) {
            const text = args.join(" ").trim();
            if (!text) return sock.sendMessage(from, { text: "Usage: .qr <text ya link>" });
            const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(text)}`;
            await sock.sendMessage(from, { image: { url: qrUrl }, caption: `📱 QR Code: ${text}` }, { quoted: msg });
        },
    },
    {
        name: "calc",
        aliases: ["calculate"],
        description: "Calculator. Usage: .calc 25*4+10",
        async execute(sock, { from, args, msg }) {
            const expr = args.join(" ");
            if (!expr) return sock.sendMessage(from, { text: "Usage: .calc 25*4+10" });
            if (!/^[0-9+\-*/().\s%]+$/.test(expr)) {
                return sock.sendMessage(from, { text: "❌ Sirf numbers aur + - * / ( ) use karein." }, { quoted: msg });
            }
            try {
                const result = Function(`"use strict"; return (${expr})`)();
                await sock.sendMessage(from, { text: `🧮 ${expr} = *${result}*` }, { quoted: msg });
            } catch {
                await sock.sendMessage(from, { text: "❌ Expression samajh nahi aayi." }, { quoted: msg });
            }
        },
    },
    {
        name: "remind",
        aliases: ["reminder"],
        description: "Reminder set karein. Usage: .remind <minutes> <message>",
        async execute(sock, { from, args, msg }) {
            const minutes = parseFloat(args[0]);
            const message = args.slice(1).join(" ");
            if (!minutes || minutes <= 0 || !message) return sock.sendMessage(from, { text: "Usage: .remind 30 namaz ka waqt ho gaya" });
            if (minutes > 1440) return sock.sendMessage(from, { text: "❌ Max 1440 minutes (24 ghante) tak ka reminder set kar sakte hain." });
            await sock.sendMessage(from, { text: `⏰ Theek hai, ${minutes} minute mein yaad dila dunga: "${message}"` }, { quoted: msg });
            setTimeout(() => {
                sock.sendMessage(from, { text: `⏰ *Reminder:* ${message}` }).catch(() => {});
            }, minutes * 60 * 1000);
        },
    },
    {
        name: "poll",
        aliases: ["vote"],
        description: "Poll banayein. Usage: .poll Question | Option1 | Option2",
        async execute(sock, { from, text, msg }) {
            const body = text.slice(text.indexOf(" ") + 1);
            const parts = body.split("|").map((p) => p.trim()).filter(Boolean);
            if (parts.length < 3) return sock.sendMessage(from, { text: "Usage: .poll Question | Option1 | Option2\nExample: .poll Lunch kahan karein? | Pizza | Biryani | BBQ" }, { quoted: msg });
            const [question, ...options] = parts;
            await sock.sendMessage(from, { poll: { name: question, values: options.slice(0, 12), selectableCount: 1 } });
        },
    },
    {
        name: "define",
        aliases: ["dictionary", "meaning"],
        description: "English word ka meaning. Usage: .define <word>",
        async execute(sock, { from, args, msg }) {
            const word = args[0];
            if (!word) return sock.sendMessage(from, { text: "Usage: .define <word>" });
            try {
                const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
                const data = await res.json();
                if (!Array.isArray(data)) throw new Error("Word nahi mila.");
                const entry = data[0];
                const meaning = entry.meanings?.[0];
                const def = meaning?.definitions?.[0];
                const text = `📖 *${entry.word}* (${meaning?.partOfSpeech || ""})\n\n${def?.definition || "Definition nahi mili."}` +
                    (def?.example ? `\n\n_Example: ${def.example}_` : "");
                await sock.sendMessage(from, { text }, { quoted: msg });
            } catch {
                await sock.sendMessage(from, { text: `❌ "${word}" ka meaning nahi mila.` }, { quoted: msg });
            }
        },
    },
    {
        name: "toimg",
        aliases: ["take"],
        description: "Sticker ko wapas image mein convert karein (sticker pe reply karein)",
        async execute(sock, { from, msg }) {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMsg = quoted ? { message: quoted, key: msg.key } : msg;
            if (!targetMsg.message?.stickerMessage) return sock.sendMessage(from, { text: "❌ Kisi sticker pe reply karein *.toimg* ke sath." });
            try {
                const buffer = await downloadMediaMessage(targetMsg, "buffer", {});
                await sock.sendMessage(from, { image: buffer, caption: "✅ Converted!" }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Convert nahi ho saka: ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "statusdl",
        aliases: ["savestatus"],
        description: "Kisi forward hui status ko save karein — us message pe reply karein",
        async execute(sock, { from, msg }) {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return sock.sendMessage(from, { text: "❓ Status wale message pe reply karein *.statusdl* ke sath." });
            const targetMsg = { message: quoted, key: msg.key };
            try {
                const buffer = await downloadMediaMessage(targetMsg, "buffer", {});
                if (quoted.imageMessage) {
                    await sock.sendMessage(from, { image: buffer, caption: "✅ Status saved!" }, { quoted: msg });
                } else if (quoted.videoMessage) {
                    await sock.sendMessage(from, { video: buffer, caption: "✅ Status saved!" }, { quoted: msg });
                } else {
                    await sock.sendMessage(from, { text: "❌ Ye media type support nahi hoti." }, { quoted: msg });
                }
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Save nahi ho saka: ${err.message}` }, { quoted: msg });
            }
        },
    },

    // ============================================
    // Social media downloaders (best-effort — please test these live;
    // third-party download APIs occasionally change their response format)
    // ============================================
    {
        name: "instagram",
        aliases: ["ig", "insta"],
        description: "Instagram reel/post download karein. Usage: .instagram <link>",
        async execute(sock, { from, args, msg }) {
            const url = args[0];
            if (!url || !url.includes("instagram.com")) return sock.sendMessage(from, { text: "❌ Valid Instagram link dein." });
            await sock.sendMessage(from, { text: "⏳ Downloading..." });
            try {
                const mediaUrl = await cobaltDownload(url);
                if (!mediaUrl) throw new Error("Media nahi mila.");
                await sock.sendMessage(from, { video: { url: mediaUrl }, caption: "📸 Instagram" }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Failed: ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "facebook",
        aliases: ["fb"],
        description: "Facebook video download karein. Usage: .facebook <link>",
        async execute(sock, { from, args, msg }) {
            const url = args[0];
            if (!url || (!url.includes("facebook.com") && !url.includes("fb.watch"))) return sock.sendMessage(from, { text: "❌ Valid Facebook link dein." });
            await sock.sendMessage(from, { text: "⏳ Downloading..." });
            try {
                const mediaUrl = await cobaltDownload(url);
                if (!mediaUrl) throw new Error("Media nahi mila.");
                await sock.sendMessage(from, { video: { url: mediaUrl }, caption: "📘 Facebook" }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Failed: ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "twitter",
        aliases: ["x"],
        description: "Twitter/X video download karein. Usage: .twitter <link>",
        async execute(sock, { from, args, msg }) {
            const url = args[0];
            if (!url || (!url.includes("twitter.com") && !url.includes("x.com"))) return sock.sendMessage(from, { text: "❌ Valid Twitter/X link dein." });
            await sock.sendMessage(from, { text: "⏳ Downloading..." });
            try {
                const mediaUrl = await cobaltDownload(url);
                if (!mediaUrl) throw new Error("Media nahi mila.");
                await sock.sendMessage(from, { video: { url: mediaUrl }, caption: "🐦 Twitter/X" }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Failed: ${err.message}` }, { quoted: msg });
            }
        },
    },

    // ============================================
    // Informative (news-based, no AI tokens spent)
    // ============================================
    {
        name: "cricket",
        aliases: ["score"],
        description: "Latest cricket score/news",
        async execute(sock, { from, args, msg }) {
            const query = args.join(" ").trim() || "Pakistan cricket score";
            try {
                const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-PK&gl=PK&ceid=PK:en`);
                const xml = await res.text();
                const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5);
                if (items.length === 0) return sock.sendMessage(from, { text: "❌ Koi score/news nahi mili." }, { quoted: msg });
                const decode = (s) => (s || "").replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
                const lines = items.map((m) => `🏏 ${decode(m[1].match(/<title>(.*?)<\/title>/)?.[1] || "")}`);
                await sock.sendMessage(from, { text: `🏏 *Cricket Updates*\n\n${lines.join("\n\n")}` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "petrol",
        aliases: ["fuelprice"],
        description: "Pakistan mein aaj ki petrol/diesel price news",
        async execute(sock, { from, msg }) {
            try {
                const res = await fetch(`https://news.google.com/rss/search?q=petrol+price+pakistan&hl=en-PK&gl=PK&ceid=PK:en`);
                const xml = await res.text();
                const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 4);
                const decode = (s) => (s || "").replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
                const lines = items.map((m) => `⛽ ${decode(m[1].match(/<title>(.*?)<\/title>/)?.[1] || "")}`);
                await sock.sendMessage(from, { text: `⛽ *Petrol Price Updates*\n\n${lines.join("\n\n") || "Nahi mili."}\n\n_(Ye news headlines hain — exact rate confirm kar lein.)_` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "gold",
        aliases: ["goldrate"],
        description: "Pakistan mein aaj ka gold rate news",
        async execute(sock, { from, msg }) {
            try {
                const res = await fetch(`https://news.google.com/rss/search?q=gold+rate+pakistan+today&hl=en-PK&gl=PK&ceid=PK:en`);
                const xml = await res.text();
                const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 4);
                const decode = (s) => (s || "").replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
                const lines = items.map((m) => `🪙 ${decode(m[1].match(/<title>(.*?)<\/title>/)?.[1] || "")}`);
                await sock.sendMessage(from, { text: `🪙 *Gold Rate Updates*\n\n${lines.join("\n\n") || "Nahi mila."}\n\n_(Ye news headlines hain — exact rate confirm kar lein.)_` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },
];

module.exports = allCommands;
module.exports.pendingYt = new Map();
module.exports.pendingImage = new Map();
module.exports.downloadYt = downloadYt;
module.exports.isOwner = isOwner;
module.exports.synthesizeSpeech = synthesizeSpeech;
module.exports.startYtFlow = startYtFlow;
module.exports.generateAndSendImage = generateAndSendImage;
module.exports.fetchOrGenerateImage = fetchOrGenerateImage;
module.exports.webSearch = webSearch;
module.exports.buildSystemPrompt = buildSystemPrompt;
module.exports.getPakistanDateTimeString = getPakistanDateTimeString;
module.exports.chatWithTools = chatWithTools;
module.exports.AI_TOOLS = AI_TOOLS;
module.exports.runAiTool = runAiTool;
module.exports.MENU_CATEGORIES = MENU_CATEGORIES;
