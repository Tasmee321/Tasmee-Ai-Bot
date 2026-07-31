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
async function chatWithTools(sock, { from, msg, config, systemPrompt, history, question }) {
    const baseMessages = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: question },
    ];

    const firstData = await groq.groqChat({ model: "llama-3.3-70b-versatile", messages: baseMessages, tools: AI_TOOLS, tool_choice: "auto" });

    const choiceMsg = firstData.choices?.[0]?.message;
    const toolCalls = choiceMsg?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
        return choiceMsg?.content || null;
    }

    const toolResultMessages = [];
    for (const call of toolCalls) {
        let argsObj = {};
        try { argsObj = JSON.parse(call.function.arguments || "{}"); } catch {}
        const resultText = await runAiTool(sock, { from, msg, config }, call.function.name, argsObj);
        toolResultMessages.push({ tool_call_id: call.id, role: "tool", name: call.function.name, content: resultText });
    }

    const followData = await groq.groqChat({
        model: "llama-3.3-70b-versatile",
        messages: [...baseMessages, choiceMsg, ...toolResultMessages],
    });
    return followData.choices?.[0]?.message?.content || "✅ Ho gaya!";
}

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

            const categories = {
                "🤖 AI": ["ai", "search"],
                "📥 DOWNLOAD": ["yt", "tiktok", "pinterest"],
                "🎨 MEDIA": ["sticker", "tts", "text", "image"],
                "🌦️ LIVE INFO": ["weather", "news"],
                "👑 OWNER": ["ban", "unban", "banlist", "block", "unblock", "sudo", "delsudo", "listsudo", "mode", "autoread"],
                "⚙️ SETTINGS": [
                    "welcome", "goodbye", "setwelcome", "setgoodbye", "antilink", "antidelete",
                    "editpath", "recording", "autotyping", "online", "autoreact", "anticall",
                    "anticallmsg", "adminaction", "statuslike", "prefix", "botname", "ownername",
                    "ownernumber", "description", "stickername", "settings",
                ],
                "🏠 MAIN": ["ping", "help", "alive", "owner", "repo", "developer"],
            };

            let menu = `━━━━━━ 🤖 ʙᴏᴛ ɪɴғᴏ ━━━━━━\n`;
            menu += `◉ 🎉 ${config.BOT_NAME || "Tasmee-Ai-Bot"}\n`;
            menu += `◉ 👑 ᴏᴡɴᴇʀ: ${config.OWNER_NAME || "Tasmee"}\n`;
            menu += `◉ 📜 ᴄᴏᴍᴍᴀɴᴅs: ${allCommands.length}\n`;
            menu += `◉ ⏱️ ʀᴜɴᴛɪᴍᴇ: ${mins}m ${secs}s\n`;
            menu += `◉ 📦 ᴘʀᴇғɪx: ${config.PREFIX || "."}\n`;
            menu += `◉ ⚙️ ᴍᴏᴅᴇ: ${config.MODE || "public"}\n`;
            menu += `◉ 🏷️ ᴠᴇʀsɪᴏɴ: 1.0.0\n`;
            menu += `◉ 📱 ᴏᴡɴᴇʀ ᴄᴏɴᴛᴀᴄᴛ: ${config.OWNER_NUMBER || "N/A"}\n`;

            for (const [category, cmdNames] of Object.entries(categories)) {
                menu += `━━━━━『 ${category} 』━━━━━\n◉\n`;
                for (const cmdName of cmdNames) {
                    const cmd = allCommands.find((c) => c.name === cmdName);
                    if (cmd) menu += `◉ ➤ ${cmd.name}\n`;
                }
            }

            menu += `\n🤝 Main aapki madad karne ke liye yahan hoon!`;
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
        description: "Check if bot is alive with uptime info",
        async execute(sock, { from, config }) {
            const uptimeSec = Math.floor(process.uptime());
            const mins = Math.floor(uptimeSec / 60);
            const secs = uptimeSec % 60;
            await sock.sendMessage(from, {
                text: `✅ ${config.BOT_NAME || "Tasmee-Ai-Bot"} is alive!\n⏱️ Uptime: ${mins}m ${secs}s`,
            });
        },
    },
    {
        name: "owner",
        aliases: [],
        description: "Show the bot owner's contact",
        async execute(sock, { from, config }) {
            const number = config.OWNER_NUMBER || "";
            await sock.sendMessage(from, {
                text: `👑 Owner: ${config.OWNER_NAME || "Tasmee"}\n📞 Contact: wa.me/${number}`,
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
            config.WELCOME = choice === "on" ? "true" : "false";
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
            config.MODE = choice;
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
            config.READ_MESSAGE = choice === "on" ? "true" : "false";
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
            config.PREFIX = args[0];
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
            config.BOT_NAME = name;
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
            config.OWNER_NAME = name;
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
            config.OWNER_NUMBER = number;
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
            config.DESCRIPTION = desc;
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
            config.STICKER_NAME = name;
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
            config.WELCOME_MSG = text;
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
            config.GOODBYE_MSG = text;
            await sock.sendMessage(from, { text: `✅ Goodbye message updated.` });
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
            config.ANTI_DELETE = choice === "on" ? "true" : "false";
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
            config.ANTI_DEL_PATH = choice;
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
            config.AUTO_RECORDING = choice === "on" ? "true" : "false";
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
            config.AUTO_TYPING = choice === "on" ? "true" : "false";
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
            config.ALWAYS_ONLINE = choice === "on" ? "true" : "false";
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
            config.AUTO_REACT = choice === "on" ? "true" : "false";
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
            config.ANTI_CALL = choice === "on" ? "true" : "false";
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
            config.REJECT_MSG = text;
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
            config.ADMIN_ACTION = choice === "on" ? "true" : "false";
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
            config.AUTO_STATUS_REACT = choice === "on" ? "true" : "false";
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
            config.WELCOME = choice === "on" ? "true" : "false";
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
                const data = await groq.groqChat({
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
