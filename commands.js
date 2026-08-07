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
const islamicdb = require("./lib/islamicdb");
const { ASMA_UL_HUSNA, DUAS } = require("./lib/islamicdata");

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

// Shared by .analyze / .ocr / .imgurl — grabs the image whether it was sent
// directly with the command as caption, or the command was used as a reply
// to an earlier image.
function getTargetImageMessage(msg) {
    const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
    const targetMsg = quoted ? { message: quoted, key: msg.key } : msg;
    if (!targetMsg.message?.imageMessage) return null;
    return targetMsg;
}

// Shared by .pdf / .pdfsummary — grabs a PDF whether it was sent directly
// with the command as caption, or the command was used as a reply to an
// earlier PDF document.
function getTargetDocumentMessage(msg) {
    const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
    const targetMsg = quoted ? { message: quoted, key: msg.key } : msg;
    if (!targetMsg.message?.documentMessage) return null;
    return targetMsg;
}

async function extractPdfText(buffer) {
    let pdfParse;
    try {
        pdfParse = require("pdf-parse");
    } catch {
        throw new Error("PDF support install nahi hui — server par 'npm install' chala kar 'pm2 restart' karein.");
    }
    const data = await pdfParse(buffer);
    return data.text || "";
}

// Shared TTS engine — turns text into an .ogg/opus voice-note buffer.
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

// Shared with index.js
const OWNER_PERSONAL_NUMBER = "03423899407";
const OWNER_PERSONAL_NAME = "Tasmee ul Hasnain";
const URGENT_CONTACT_REGEX =
    /\b(urgent|emergency)\b|\btalk\s*to\s*(the\s*)?(owner|tasmee)\b|\bcontact\s*(the\s*)?(owner|tasmee)\b|\breal\s*person\b|tasmee\s*se\s*baat|zaroor[ia]\s*(baat|kaam)|lazmi\s*baat|owner\s*se\s*baat|tasmee\s*se\s*contact|(owner|tasmee)('?s)?\s*(ka|ki)?\s*(number|naam|name)|please.*\bnumber\b|\bnumber\b.*please/i;

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

const REALTIME_INFO_REGEX =
    /\b(today|aaj|abhi|is\s*waqt|current|currently|latest|newest|update[ds]?|breaking|news|khabr|price|rate|score|match|result|kal|kaun\s*hai|who\s*is|when\s*is|kab\s*hai|is\s*saal|this\s*year)\b/i;

async function buildSystemPrompt(basePersona, question) {
    let systemPrompt = `Aaj ki tareekh aur waqt: ${getPakistanDateTimeString()}.\n\n${basePersona || "You are a helpful assistant."}`;
    
    // --- NEW ADDITION FOR SERVICES INTRODUCTION ---
    systemPrompt += `\n\nIMPORTANT RULE: If the user asks about what you can do, your services, your features, or who you are (e.g., "what can you do", "tum kya kar sakte ho", "apni services batao", "what are your features"), you MUST reply with a comprehensive but friendly introduction. Do NOT just tell them to type .menu. Your reply should be structured similarly to this:
"Hello! I am **Tasmee AI Assistant**, your smart companion. I can speak and understand multiple languages! 🌍\n\nHere are some of the cool things I can do for you:\n\n📥 **Media Downloads:** I can download songs, videos, and reels from YouTube, TikTok, Instagram, Facebook, and Twitter.\n🎨 **AI & Media:** I can generate AI images, read text from pictures, convert your text into voice notes, and make stylish name graphics.\n🕌 **Islamic Features:** I provide Namaz timings, Qibla direction, daily Hadith, Quranic ayats, and have a built-in Tasbeeh counter.\n📚 **Education:** I can read and summarize PDF files, solve your homework step-by-step, and even search for free PDF books.\n🌦️ **Live Info:** Ask me for live weather, latest news headlines, cricket scores, or today's gold and petrol prices.\n\nYou can talk to me naturally, and I'll do my best to assist you! If you want to see a manual list of all my specific commands, just type *.menu* at any time."`;
    // ---------------------------------------------

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

async function fetchOrGenerateImage(sock, from, msg, prompt) {
    await sock.sendMessage(from, { text: `🔎 "${prompt}" ki real photo dhoondh raha hoon...` }, { quoted: msg });

    const urls = await searchRealImages(prompt, 3);
    let sentAny = false;
    for (const url of urls) {
        try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.length < 3000) continue; 
            await sock.sendMessage(from, { image: buffer, caption: `📷 *${prompt}*` }, { quoted: msg });
            sentAny = true;
        } catch {
            // skip
        }
    }
    if (sentAny) return;

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

// ----------------------------------------------------
// THE ULTIMATE YT-DLP FIX: Completely Bypass Web Client
// ----------------------------------------------------
function buildYtdlpArgs({ format, outTemplate, wantsVideo, target, useCookies, playerClient }) {
    const args = [
        "-f", format,
        "-o", outTemplate,
        "--no-playlist",
        "--geo-bypass",
        "--no-check-certificates",
    ];
    
    if (useCookies) {
        args.push("--cookies", path.join(__dirname, "cookies.txt"));
    }
    
    // Yahan hum STRICTLY web aur mweb ko skip kar rahe hain. 
    // Official Music Videos par "n-challenge" sirf web client par aata hai.
    // Android/TV/iOS client direct link return karte hain.
    args.push("--extractor-args", `youtube:player_client=${playerClient || "android,tv"}`);
    args.push("--extractor-args", `youtube:player_skip=web,mweb`);

    if (!wantsVideo) {
        args.push("--extract-audio", "--audio-format", "mp3", "--audio-quality", "0");
    }
    
    args.push(target);
    return args;
}

function runYtDlpOnce(args) {
    const { spawn } = require("child_process");
    return new Promise((resolve, reject) => {
        const proc = spawn("/usr/local/bin/yt-dlp", args, { env: process.env });
        let stderr = "";
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("error", (err) => reject(new Error(`yt-dlp error: ${err.message}`)));
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(stderr.slice(-500) || `exited with code ${code}`));
        });
    });
}

async function downloadYt(sock, { from, msg, target, label, wantsVideo, config }) {
    const os = require("os");

    const jobId = `yt_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const tmpDir = os.tmpdir();
    const outTemplate = path.join(tmpDir, `${jobId}.%(ext)s`);
    const format = wantsVideo ? "best[ext=mp4]/best" : "bestaudio";

    await sock.sendMessage(from, { text: `⏳ Downloading *${label}* as ${wantsVideo ? "video" : "audio"}, please wait...` });

    // Hum 3 alag alag non-web clients try karenge. 
    // Is se 100% guarantee hai ke music videos bina kisi n-challenge error ke download honge.
    const attempts = [
        { useCookies: false, playerClient: "android" },
        { useCookies: false, playerClient: "tv" },
        { useCookies: false, playerClient: "ios" },
    ];

    let lastErr = null;
    for (const attempt of attempts) {
        const args = buildYtdlpArgs({ format, outTemplate, wantsVideo, target, ...attempt });
        try {
            await runYtDlpOnce(args);
            lastErr = null; // Success!
            break; 
        } catch (err) {
            lastErr = err;
            console.log(`❌ YT attempt failed (${attempt.playerClient}):`, err.message);
            // Move to the next client in the array
        }
    }

    if (lastErr) {
        console.log("❌ YT final error:", lastErr.message);
        if (isOwner(msg, config)) {
            await sock.sendMessage(from, { text: `❌ Download failed completely:\n\n${lastErr.message}` });
        } else {
            await sock.sendMessage(from, { text: "❌ Sorry, couldn't download that right now. Please try again later." });
        }
        return;
    }

    try {
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
        console.log("❌ YT post-download error:", err.message);
        if (isOwner(msg, config)) {
            await sock.sendMessage(from, { text: `❌ Final step failed: ${err.message}` });
        } else {
            await sock.sendMessage(from, { text: "❌ Sorry, couldn't download that right now. Please try again later." });
        }
    }
}

function formatDuration(sec) {
    if (sec === undefined || sec === null) return "";
    sec = Math.round(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

async function searchYoutubeTop5(query) {
    const { spawn } = require("child_process");
    return new Promise((resolve, reject) => {
        const args = [
            `ytsearch5:${query}`,
            "--flat-playlist",
            "--dump-json",
            "--no-warnings",
            "--skip-download",
        ];
        const proc = spawn("/usr/local/bin/yt-dlp", args, { env: process.env });
        let out = "";
        let err = "";
        proc.stdout.on("data", (d) => (out += d.toString()));
        proc.stderr.on("data", (d) => (err += d.toString()));
        proc.on("error", (e) => reject(new Error(`yt-dlp not found: ${e.message}`)));
        proc.on("close", (code) => {
            if (!out.trim()) return reject(new Error(err.slice(-400) || `yt-dlp exited with code ${code}`));
            const results = out
                .trim()
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                    try {
                        const j = JSON.parse(line);
                        return {
                            id: j.id,
                            title: j.title || "Untitled",
                            duration: formatDuration(j.duration),
                            uploader: j.uploader || j.channel || "",
                        };
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean);
            resolve(results);
        });
    });
}

async function startYtFlow(sock, { from, msg, query, wantsVideo, config }) {
    const trimmed = (query || "").trim();
    if (!trimmed) {
        await sock.sendMessage(from, { text: "❌ Konsa gana/video chahiye? Naam ya link bhej dein." }, { quoted: msg });
        return;
    }

    const directUrl = /youtube\.com|youtu\.be/i.test(trimmed) ? trimmed : null;

    if (directUrl) {
        const label = "this link";
        if (wantsVideo === true || wantsVideo === false) {
            await downloadYt(sock, { from, msg, target: directUrl, label, wantsVideo, config });
            return;
        }
        module.exports.pendingYt.set(from, { target: directUrl, label });
        await sock.sendMessage(from, {
            text: `🎬 Download *${label}* as:\n\n1️⃣ Reply *audio*\n2️⃣ Reply *video*`,
        }, { quoted: msg });
        return;
    }

    await sock.sendMessage(from, { text: `🔎 Searching *${trimmed}*...` }, { quoted: msg });
    let results;
    try {
        results = await searchYoutubeTop5(trimmed);
    } catch (err) {
        console.log("❌ YT search error:", err.message);
        await sock.sendMessage(from, { text: "❌ Search nahi ho saka, thori dair baad try karein." }, { quoted: msg });
        return;
    }
    if (!results.length) {
        await sock.sendMessage(from, { text: `❌ "${trimmed}" ke liye koi result nahi mila.` }, { quoted: msg });
        return;
    }

    let list = `🎵 *"${trimmed}"* ke top results:\n\n`;
    results.forEach((r, i) => {
        list += `${i + 1}️⃣ ${r.title}${r.duration ? ` (${r.duration})` : ""}${r.uploader ? `\n    👤 ${r.uploader}` : ""}\n\n`;
    });
    list += `Reply karein *1-${results.length}* konsa chahiye.`;

    module.exports.pendingYtChoice.set(from, { results, wantsVideo });
    await sock.sendMessage(from, { text: list }, { quoted: msg });
}

// AI tools setup
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
    {
        type: "function",
        function: {
            name: "get_prayer_times",
            description: "Get today's namaz/prayer timings (Fajr, Zuhr, Asr, Maghrib, Isha) for a city and send them.",
            parameters: {
                type: "object",
                properties: { city: { type: "string", description: "City name; omit for the user's default city" } },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_qibla_direction",
            description: "Get the Qibla direction (in degrees) for a city and send it.",
            parameters: {
                type: "object",
                properties: { city: { type: "string", description: "City name; omit for the user's default city" } },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_hijri_date",
            description: "Get today's Islamic (Hijri) calendar date and send it.",
            parameters: { type: "object", properties: {} },
        },
    },
    {
        type: "function",
        function: {
            name: "get_quran_ayat",
            description: "Get info about a Quran Surah, or a specific ayat with Urdu translation, and send it.",
            parameters: {
                type: "object",
                properties: {
                    surah: { type: "string", description: "Surah number (1-114)" },
                    ayat: { type: "string", description: "Specific ayat number within the surah (optional)" },
                },
                required: ["surah"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_hadith",
            description: "Get a random authentic Hadith and send it.",
            parameters: {
                type: "object",
                properties: { book: { type: "string", description: "bukhari, muslim, or tirmidhi; omit for bukhari" } },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_dua",
            description: "Send an everyday Islamic dua (Arabic + transliteration + meaning), or the full list if no number given.",
            parameters: {
                type: "object",
                properties: { number: { type: "string", description: "Dua number from the list; omit to show the list" } },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "tasbeeh_counter",
            description: "Increment, set, or reset the user's personal tasbeeh/zikr counter and send the current count.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["increment", "reset"], description: "increment by 1 (or by 'amount'), or reset to 0" },
                    amount: { type: "string", description: "How much to increment by; omit for 1" },
                },
                required: ["action"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_asmaulhusna",
            description: "Send one of Allah's 99 Names (Asma-ul-Husna), by number or a random one.",
            parameters: {
                type: "object",
                properties: { number: { type: "string", description: "Number 1-99; omit for a random name" } },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "get_sehri_iftar",
            description: "Get Sehri (end time) and Iftar (Maghrib) timings for a city and send them.",
            parameters: {
                type: "object",
                properties: { city: { type: "string", description: "City name; omit for the user's default city" } },
            },
        },
    },
    {
        type: "function",
        function: {
            name: "set_azaan_reminder",
            description: "Turn on or off automatic azaan/namaz-time reminders for this chat.",
            parameters: {
                type: "object",
                properties: {
                    action: { type: "string", enum: ["on", "off"] },
                    city: { type: "string", description: "City for reminder timings, only needed when turning on" },
                },
                required: ["action"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "search_pdf_book",
            description: "Search for free PDFs/books on a topic and send download links.",
            parameters: {
                type: "object",
                properties: { query: { type: "string", description: "Topic or book name to search for" } },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "solve_homework",
            description: "Solve a homework/study question step-by-step and send a clear explanation.",
            parameters: {
                type: "object",
                properties: { question: { type: "string", description: "The question to solve" } },
                required: ["question"],
            },
        },
    },
];

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
            case "get_prayer_times": {
                const cmd = findCmd("prayertimes");
                if (cmd) await cmd.execute(sock, { from, args: toolArgs.city ? toolArgs.city.split(" ") : [], msg });
                return "Namaz timings bhej din.";
            }
            case "get_qibla_direction": {
                const cmd = findCmd("qibla");
                if (cmd) await cmd.execute(sock, { from, args: toolArgs.city ? toolArgs.city.split(" ") : [], msg });
                return "Qibla direction bhej di.";
            }
            case "get_hijri_date": {
                const cmd = findCmd("hijri");
                if (cmd) await cmd.execute(sock, { from, msg });
                return "Hijri date bhej di.";
            }
            case "get_quran_ayat": {
                const cmd = findCmd("quran");
                const args = [toolArgs.surah || "1"];
                if (toolArgs.ayat) args.push(toolArgs.ayat);
                if (cmd) await cmd.execute(sock, { from, args, msg });
                return "Quran info bhej di.";
            }
            case "get_hadith": {
                const cmd = findCmd("hadith");
                if (cmd) await cmd.execute(sock, { from, args: toolArgs.book ? [toolArgs.book] : [], msg });
                return "Hadith bhej di.";
            }
            case "get_dua": {
                const cmd = findCmd("dua");
                if (cmd) await cmd.execute(sock, { from, args: toolArgs.number ? [toolArgs.number] : [], msg });
                return "Dua bhej di.";
            }
            case "tasbeeh_counter": {
                const cmd = findCmd("tasbeeh");
                const args = toolArgs.action === "reset" ? ["reset"] : [toolArgs.amount || "1"];
                if (cmd) await cmd.execute(sock, { from, args, msg });
                return "Tasbeeh count update kar di.";
            }
            case "get_asmaulhusna": {
                const cmd = findCmd("asmaulhusna");
                if (cmd) await cmd.execute(sock, { from, args: toolArgs.number ? [toolArgs.number] : [], msg });
                return "Allah ka naam bhej diya.";
            }
            case "get_sehri_iftar": {
                const cmd = findCmd("sehriiftar");
                if (cmd) await cmd.execute(sock, { from, args: toolArgs.city ? toolArgs.city.split(" ") : [], msg });
                return "Sehri/Iftar timings bhej din.";
            }
            case "set_azaan_reminder": {
                const cmd = findCmd("azaan");
                const args = toolArgs.action === "on" ? ["on", ...(toolArgs.city ? toolArgs.city.split(" ") : [])] : ["off"];
                if (cmd) await cmd.execute(sock, { from, args, msg });
                return "Azaan reminder update kar diya.";
            }
            case "search_pdf_book": {
                const cmd = findCmd("pdfsearch");
                if (cmd) await cmd.execute(sock, { from, args: (toolArgs.query || "").split(" "), msg });
                return "PDF/book results bhej diye.";
            }
            case "solve_homework": {
                const cmd = findCmd("homework");
                if (cmd) await cmd.execute(sock, { from, args: (toolArgs.question || "").split(" "), msg });
                return "Homework solve kar ke bhej diya.";
            }
            default:
                return "Yeh tool mojood nahi.";
        }
    } catch (err) {
        return `Tool chalane mein error aaya: ${err.message}`;
    }
}

const KNOWN_TOOL_NAMES = [
    "download_media", "find_or_generate_image", "text_to_voice", "stylish_text_image",
    "get_weather", "get_news", "pinterest_images", "web_search",
    "get_prayer_times", "get_qibla_direction", "get_hijri_date", "get_quran_ayat",
    "get_hadith", "get_dua", "tasbeeh_counter", "get_asmaulhusna", "get_sehri_iftar",
    "set_azaan_reminder", "search_pdf_book", "solve_homework",
];

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
        const plainPattern = new RegExp(`${escaped}\\s*[:>]\\s*"([^"]+)"`, "i");
        const plainMatch = text.match(plainPattern);
        if (plainMatch) {
            const key = toolName === "text_to_voice" ? "text" : "query";
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

async function fetchArchivePdf(identifier) {
    const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    const data = await res.json();
    const files = data?.files || [];
    const pdfFile = files.find((f) => (f.format || "").toLowerCase().includes("pdf") || (f.name || "").toLowerCase().endsWith(".pdf"));
    if (!pdfFile) throw new Error("Is item mein koi PDF file nahi mili.");

    const sizeBytes = parseInt(pdfFile.size, 10) || 0;
    if (sizeBytes > 60 * 1024 * 1024) {
        const link = `https://archive.org/download/${identifier}/${encodeURIComponent(pdfFile.name)}`;
        const err = new Error(`PDF bohat badi hai (${(sizeBytes / (1024 * 1024)).toFixed(0)}MB) seedha bhejne ke liye. Manually download karein:\n${link}`);
        err.tooLarge = true;
        throw err;
    }

    const fileUrl = `https://archive.org/download/${identifier}/${encodeURIComponent(pdfFile.name)}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) throw new Error("PDF download nahi ho saki.");
    const arrayBuffer = await fileRes.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), fileName: pdfFile.name };
}

async function genericVideoDownload(sock, { from, msg, url, label, emoji }) {
    const { spawn } = require("child_process");
    const os = require("os");

    const jobId = `dl_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const tmpDir = os.tmpdir();
    const outTemplate = path.join(tmpDir, `${jobId}.%(ext)s`);

    await sock.sendMessage(from, { text: "⏳ Downloading..." });

    const args = [
        "-f", "best[ext=mp4]/best",
        "-o", outTemplate,
        "--no-playlist",
        "--geo-bypass",
        "--no-check-certificates",
        "--cookies", path.join(__dirname, "cookies.txt"),
        url,
    ];

    await new Promise((resolve, reject) => {
        const proc = spawn("/usr/local/bin/yt-dlp", args, { env: process.env });
        let stderr = "";
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("error", (err) => reject(new Error(`yt-dlp not found or failed to start: ${err.message}`)));
        proc.on("close", (code) => {
            if (code === 0) resolve();
            else reject(new Error(stderr.slice(-500) || `yt-dlp exited with code ${code}`));
        });
    });

    const matchFile = fs.readdirSync(tmpDir).find((f) => f.startsWith(jobId));
    if (!matchFile) throw new Error("Download finished but file was not found.");
    const filePath = path.join(tmpDir, matchFile);
    const buffer = fs.readFileSync(filePath);
    await sock.sendMessage(from, { video: buffer, caption: `${emoji} ${label}`, mimetype: "video/mp4" }, { quoted: msg });
    fs.unlink(filePath, () => {});
}

const LANG_CODE_MAP = {
    english: "en", eng: "en", en: "en",
    urdu: "ur", ur: "ur",
    arabic: "ar", ar: "ar",
    hindi: "hi", hi: "hi",
    french: "fr", fr: "fr",
    spanish: "es", es: "es",
    german: "de", de: "de",
    chinese: "zh", zh: "zh",
    punjabi: "pa", pa: "pa",
    turkish: "tr", tr: "tr",
    russian: "ru", ru: "ru",
    japanese: "ja", ja: "ja",
    korean: "ko", ko: "ko",
    italian: "it", it: "it",
    portuguese: "pt", pt: "pt",
    bengali: "bn", bn: "bn",
    persian: "fa", farsi: "fa", fa: "fa",
};

async function translateFallback(text, targetLang) {
    const code = LANG_CODE_MAP[targetLang.toLowerCase()] || targetLang.toLowerCase().slice(0, 2);
    const res = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${code}`
    );
    const data = await res.json();
    return data?.responseData?.translatedText || null;
}

const MENU_CATEGORIES = {
    "🤖 AI & SMART": ["ai", "search", "translate", "shayari", "joke", "quote"],
    "📥 DOWNLOAD": ["yt", "audio", "video", "tiktok", "pinterest", "instagram", "facebook", "twitter", "statusdl", "pdfsearch"],
    "🎨 MEDIA": ["sticker", "toimg", "tts", "text", "image", "analyze", "imgurl"],
    "🕌 ISLAMIC": ["prayertimes", "qibla", "hijri", "quran", "hadith", "dua", "tasbeeh", "asmaulhusna", "sehriiftar", "azaan"],
    "📚 EDUCATION": ["pdf", "pdfsummary", "homework", "ocr"],
    "🌦️ LIVE INFO": ["weather", "news", "cricket", "petrol", "gold", "currency", "define"],
    "🎉 FUN": ["truthordare", "compatibility", "riddle", "poll"],
    "🛠️ UTILITY": ["qr", "calc", "remind", "clearchat"],
    "👥 GROUP TOOLS": ["tagall", "kick", "antilink", "antidelete", "antiviewonce", "antibadword"],
    "👑 OWNER": ["ban", "unban", "banlist", "block", "unblock", "sudo", "delsudo", "listsudo", "mode", "autoread", "broadcast", "restart"],
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
            menu += `    ⟦ SYSTEM ONLINE ⟧\n`;
            menu += `◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤\n\n`;
            menu += `🤖 *${config.BOT_NAME || "Tasmee-Ai-Bot"}*\n`;
            menu += `⚡ Advanced Neural Assistant — v2.0\n\n`;
            menu += `┌─────────────────────\n`;
            menu += `│ 👑 ᴏᴡɴᴇʀ    : ${config.OWNER_NAME || "Tasmee"}\n`;
            menu += `│ 📜 ᴄᴏᴍᴍᴀɴᴅs : ${allCommands.length}\n`;
            menu += `│ ⏱️ ᴜᴘᴛɪᴍᴇ   : ${mins}m ${secs}s\n`;
            menu += `│ ⚙️ ᴍᴏᴅᴇ     : ${config.MODE || "public"}\n`;
            menu += `│ 🧠 ᴀɪ ᴄᴏʀᴇ  : Groq — Llama 3.3 (70B)\n`;
            menu += `│ 📦 ᴘʀᴇғɪx   : "${config.PREFIX || "."}"\n`;
            menu += `│ 📱 ᴏᴡɴᴇʀ    : wa.me/${config.OWNER_NUMBER || "N/A"}\n`;
            menu += `└─────────────────────`;

            const prefix = config.PREFIX || ".";
            for (const [category, cmdNames] of Object.entries(categories)) {
                menu += `\n\n╭━━━ ${category} ━━━╮`;
                for (const cmdName of cmdNames) {
                    const cmd = allCommands.find((c) => c.name === cmdName);
                    if (!cmd) continue;
                    const aliasText = cmd.aliases && cmd.aliases.length ? ` (${cmd.aliases.map((a) => `${prefix}${a}`).join(", ")})` : "";
                    menu += `\n  ➤ ${prefix}${cmd.name}${aliasText}`;
                }
                menu += `\n╰${"━".repeat(category.length + 8)}╯`;
            }

            menu += `\n\n◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤`;
            menu += `\n🤝 Main 24/7 aapki madad ke liye yahan hoon!`;
            menu += `\n💬 Har command se pehle *${prefix}* zaroor lagayein (jaise ${prefix}yt, ${prefix}weather).`;
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
        name: "restart",
        aliases: ["reboot"],
        description: "Owner only: bot ko restart karta hai (PM2 se). Usage: .restart",
        async execute(sock, { from, msg, config }) {
            if (!isOwner(msg, config)) {
                await sock.sendMessage(from, { text: "❌ Sirf owner ye command use kar sakta hai." });
                return;
            }
            await sock.sendMessage(from, { text: "🔄 Bot restart ho raha hai, thori dair mein wapis online aa jayega..." }, { quoted: msg });
            const { exec } = require("child_process");
            exec("pm2 restart Tasmee-Ai-Bot", (err) => {
                if (err) {
                    console.log("⚠️ pm2 restart failed, exiting process instead:", err.message);
                    setTimeout(() => process.exit(0), 1000);
                }
            });
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
                await new Promise((r) => setTimeout(r, 1500));
            }
            await sock.sendMessage(from, { text: `✅ Broadcast bhej diya ${sent}/${groupIds.length} group(s) mein.` });
        },
    },
    {
        name: "antibadword",
        aliases: ["antibad"],
        description: "Toggle auto-deleting messages with bad words",
        async execute(sock, { from, args, config, msg }) {
            if (!isOwner(msg, config)) return sock.sendMessage(from, { text: "❌ Owner only." });
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") {
                return sock.sendMessage(from, { text: `Current: *${config.ANTI_BAD_WORD === "true" ? "ON" : "OFF"}*\n\nUsage: .antibadword on/off` });
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
        description: "Ask the AI a question.",
        async execute(sock, { from, args, config, msg }) {
            const question = args.join(" ");
            if (!question) {
                await sock.sendMessage(from, { text: `❓ Please ask something.` });
                return;
            }

            if (URGENT_CONTACT_REGEX.test(question)) {
                await sock.sendMessage(from, { text: `📞 Ji zaroor:\n*${OWNER_PERSONAL_NAME}*\n${OWNER_PERSONAL_NUMBER}` });
                return;
            }

            if (groq.getKeys().length === 0) {
                await sock.sendMessage(from, { text: "⚠️ API key not set." });
                return;
            }

            await sock.sendMessage(from, { text: "🤖 Thinking..." });

            try {
                const { name, history } = memory.getContext(from);
                let systemPrompt = await buildSystemPrompt(config.AI_PERSONA, question);
                if (name) systemPrompt += `\n\nThe user's name is "${name}".`;

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
        description: "Download YouTube media",
        async execute(sock, { from, args, text, msg, config }) {
            const explicitVideo = /\bvideo\b/i.test(text) || text.includes("ytmp4");
            const explicitAudio = /\baudio\b/i.test(text) || text.includes("ytmp3");
            const cleanArgs = args.filter((a) => !/^(audio|video)$/i.test(a));
            const query = cleanArgs.join(" ");

            if (!query) {
                await sock.sendMessage(from, { text: "❌ Please provide a YouTube link or name." });
                return;
            }
            await startYtFlow(sock, { from, msg, query, wantsVideo: explicitVideo ? true : explicitAudio ? false : null, config });
        },
    },
    {
        name: "audio",
        aliases: ["song", "gana"],
        description: "Download audio",
        async execute(sock, { from, args, msg, config }) {
            const query = args.join(" ").trim();
            if (!query) return sock.sendMessage(from, { text: "❌ Please provide a name/link." }, { quoted: msg });
            await startYtFlow(sock, { from, msg, query, wantsVideo: false, config });
        },
    },
    {
        name: "video",
        aliases: ["vid"],
        description: "Download video",
        async execute(sock, { from, args, msg, config }) {
            const query = args.join(" ").trim();
            if (!query) return sock.sendMessage(from, { text: "❌ Please provide a name/link." }, { quoted: msg });
            await startYtFlow(sock, { from, msg, query, wantsVideo: true, config });
        },
    },
    {
        name: "welcome",
        aliases: [],
        description: "Toggle welcome messages",
        async execute(sock, { from, args, config }) {
            const choice = args[0]?.toLowerCase();
            if (choice !== "on" && choice !== "off") return sock.sendMessage(from, { text: "Usage: .welcome on/off" });
            updateConfig(config, "WELCOME", choice === "on" ? "true" : "false");
            await sock.sendMessage(from, { text: `✅ Welcome is now *${choice.toUpperCase()}*.` });
        },
    },
    {
        name: "sticker",
        aliases: ["s", "stiker"],
        description: "Convert an image to a sticker",
        async execute(sock, { from, msg }) {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            const targetMsg = quoted ? { message: quoted, key: msg.key } : msg;
            if (!targetMsg.message?.imageMessage) return sock.sendMessage(from, { text: "❌ Send/reply to an image." });

            try {
                const buffer = await downloadMediaMessage(targetMsg, "buffer", {});
                const webpBuffer = await sharp(buffer)
                    .resize(512, 512, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
                    .webp()
                    .toBuffer();
                await sock.sendMessage(from, { sticker: webpBuffer });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Failed: ${err.message}` });
            }
        },
    },
    {
        name: "analyze",
        aliases: ["describe", "imgai", "vision"],
        description: "AI image analysis",
        async execute(sock, { from, args, msg }) {
            const targetMsg = getTargetImageMessage(msg);
            if (!targetMsg) return sock.sendMessage(from, { text: "❌ Reply to a photo." }, { quoted: msg });
            if (groq.getKeys().length === 0) return sock.sendMessage(from, { text: "⚠️ API key not set." });
            const question = args.join(" ").trim();
            const prompt = question ? `Is image ke bare mein jawab dein: ${question}` : "Tafseel bataein.";
            try {
                await sock.sendMessage(from, { text: "🔎 Analyzing..." }, { quoted: msg });
                const buffer = await downloadMediaMessage(targetMsg, "buffer", {});
                const data = await groq.groqVisionChat(buffer.toString("base64"), prompt);
                await sock.sendMessage(from, { text: data.choices?.[0]?.message?.content || "❌ Failed." }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "ocr",
        aliases: ["imgtotext", "readimg"],
        description: "Extract text from image",
        async execute(sock, { from, msg }) {
            const targetMsg = getTargetImageMessage(msg);
            if (!targetMsg) return sock.sendMessage(from, { text: "❌ Reply to a photo." }, { quoted: msg });
            if (groq.getKeys().length === 0) return sock.sendMessage(from, { text: "⚠️ API key not set." });
            try {
                await sock.sendMessage(from, { text: "🔎 Extracting..." }, { quoted: msg });
                const buffer = await downloadMediaMessage(targetMsg, "buffer", {});
                const data = await groq.groqVisionChat(buffer.toString("base64"), "Extract ALL text accurately. Reply with text only.");
                await sock.sendMessage(from, { text: `📝 *Text:*\n\n${data.choices?.[0]?.message?.content || "None"}` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "imgurl",
        aliases: ["img2url", "imagelink"],
        description: "Upload photo to catbox.moe",
        async execute(sock, { from, msg }) {
            const targetMsg = getTargetImageMessage(msg);
            if (!targetMsg) return sock.sendMessage(from, { text: "❌ Reply to a photo." }, { quoted: msg });
            try {
                await sock.sendMessage(from, { text: "⏳ Uploading..." }, { quoted: msg });
                const buffer = await downloadMediaMessage(targetMsg, "buffer", {});
                const form = new FormData();
                form.append("reqtype", "fileupload");
                form.append("fileToUpload", new Blob([buffer]), "image.jpg");
                const res = await fetch("https://catbox.moe/user/api.php", { method: "POST", body: form });
                const link = (await res.text()).trim();
                await sock.sendMessage(from, { text: `🔗 *Link:* ${link}` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Failed: ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "text",
        aliases: ["stylish", "name"],
        description: "Stylish name graphic",
        async execute(sock, { from, args, msg }) {
            const raw = args.join(" ").trim();
            if (!raw || raw.length > 24) return sock.sendMessage(from, { text: "❌ Name must be 1-24 chars." });
            
            const safeText = raw.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
            const width = 900; const height = 500;
            let fontSize = raw.length > 18 ? 55 : raw.length > 12 ? 70 : raw.length > 8 ? 90 : 110;
            
            let seed = 0; for (const ch of raw) seed += ch.charCodeAt(0);
            const palettes = [["#ff6a00", "#ee0979"], ["#00c6ff", "#0072ff"], ["#f7971e", "#ffd200"], ["#8e2de2", "#4a00e0"]];
            const [colorA, colorB] = palettes[seed % palettes.length];

            const svg = `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#0f0c29"/><stop offset="100%" stop-color="#24243e"/></linearGradient>
    <linearGradient id="txt" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="${colorA}"/><stop offset="100%" stop-color="${colorB}"/></linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <text x="50%" y="50%" font-family="Georgia" font-weight="bold" font-size="${fontSize}" fill="url(#txt)" text-anchor="middle" dominant-baseline="middle">${safeText}</text>
</svg>`.trim();
            try {
                const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
                await sock.sendMessage(from, { image: pngBuffer, caption: `✨ *${raw}*` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Failed: ${err.message}` });
            }
        },
    },
    {
        name: "image",
        aliases: ["img", "imagine", "generate", "photo"],
        description: "Image finder / generator",
        async execute(sock, { from, args, msg }) {
            const prompt = args.join(" ").trim();
            if (!prompt) return sock.sendMessage(from, { text: "🖼️ Provide a prompt." }, { quoted: msg });
            await fetchOrGenerateImage(sock, from, msg, prompt);
        },
    },
    {
        name: "weather",
        aliases: ["mausam", "temperature"],
        description: "Weather check",
        async execute(sock, { from, args, msg }) {
            const city = args.join(" ").trim() || "Faisalabad";
            try {
                const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
                const geoData = await geoRes.json();
                const place = geoData.results?.[0];
                if (!place) return sock.sendMessage(from, { text: `❌ City not found.` }, { quoted: msg });

                const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`);
                const c = (await wRes.json()).current;
                
                const desc = describeWeatherCode(c.weather_code);
                const text = `📍 *${place.name}*\n\n${desc}\n🌡️ Temp: ${c.temperature_2m}°C\n💧 Humidity: ${c.relative_humidity_2m}%\n💨 Wind: ${c.wind_speed_10m} km/h`;
                await sock.sendMessage(from, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Failed: ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "news",
        aliases: ["khabrain", "khabar"],
        description: "News headlines",
        async execute(sock, { from, args, msg }) {
            const topic = args.join(" ").trim();
            const rssUrl = topic ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=en-PK&gl=PK&ceid=PK:en` : `https://news.google.com/rss?hl=en-PK&gl=PK&ceid=PK:en`;
            try {
                const res = await fetch(rssUrl);
                const xml = await res.text();
                const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 5);
                const lines = items.map((m, i) => `${i + 1}. *${m[1].match(/<title>(.*?)<\/title>/)?.[1]}*`);
                await sock.sendMessage(from, { text: `📰 *News*\n\n${lines.join("\n\n")}` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Failed: ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "pinterest",
        aliases: ["pin", "pins"],
        description: "Pinterest search",
        async execute(sock, { from, args, msg }) {
            const query = args.join(" ").trim();
            if (!query) return sock.sendMessage(from, { text: "❓ What to search?" }, { quoted: msg });
            await sock.sendMessage(from, { text: `📌 Searching...` }, { quoted: msg });
            try {
                const unique = await pinterestImageSearch(query, 4);
                if (unique.length === 0) return sock.sendMessage(from, { text: "❌ Not found." }, { quoted: msg });
                for (const imgUrl of unique) {
                    try {
                        const imgRes = await fetch(imgUrl);
                        if (!imgRes.ok) continue;
                        await sock.sendMessage(from, { image: Buffer.from(await imgRes.arrayBuffer()), caption: query });
                    } catch {}
                }
            } catch (err) {
                await sock.sendMessage(from, { text: `❌ Failed: ${err.message}` }, { quoted: msg });
            }
        },
    },
    {
        name: "search",
        aliases: ["google", "websearch"],
        description: "Web search",
        async execute(sock, { from, args, config, msg }) {
            const query = args.join(" ").trim();
            if (!query) return sock.sendMessage(from, { text: "❓ What to search?" }, { quoted: msg });
            await sock.sendMessage(from, { text: "🔎 Searching..." }, { quoted: msg });
            
            const results = await webSearch(query, 5);
            if (results.length === 0) return sock.sendMessage(from, { text: "❌ Not found." }, { quoted: msg });

            if (groq.getKeys().length === 0) {
                const list = results.map((r, i) => `${i + 1}. *${r.title}*\n${r.snippet}\n${r.url}`).join("\n\n");
                return sock.sendMessage(from, { text: `🔎 *Results:*\n\n${list}` }, { quoted: msg });
            }

            try {
                const context = results.map((r, i) => `[${i + 1}] ${r.title} — ${r.snippet} (${r.url})`).join("\n");
                const data = await groq.groqChatWithFallback({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        { role: "system", content: `You are a helpful assistant answering from provided context in Roman Urdu.` },
                        { role: "user", content: `Context:\n${context}\n\nQuery: ${query}` },
                    ],
                });
                await sock.sendMessage(from, { text: `🔎 ${data.choices?.[0]?.message?.content}` }, { quoted: msg });
            } catch (err) {
                const list = results.map((r, i) => `${i + 1}. *${r.title}*\n${r.snippet}\n${r.url}`).join("\n\n");
                await sock.sendMessage(from, { text: `🔎 *Results:*\n\n${list}` }, { quoted: msg });
            }
        },
    },
    {
        name: "developer",
        aliases: ["dev", "bug", "report", "support"],
        description: "Developer contact",
        async execute(sock, { from, msg }) {
            await sock.sendMessage(from, { text: `👨‍💻 *Tasmee ul Hasnain*\n📞 wa.me/923423899407` }, { quoted: msg });
        },
    }
];

module.exports = allCommands;
module.exports.pendingYt = new Map();
module.exports.pendingYtChoice = new Map();
module.exports.pendingPdfChoice = new Map();
module.exports.fetchArchivePdf = fetchArchivePdf;
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
