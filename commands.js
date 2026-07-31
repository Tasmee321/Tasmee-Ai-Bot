// ============================================
// commands.js - All bot commands in ONE file
// To add a new command: just add a new object to the array below
// ============================================

const { downloadMediaMessage } = require("@whiskeysockets/baileys");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

const fetch = global.fetch;

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
                "🤖 AI": ["ai"],
                "📥 DOWNLOAD": ["yt", "tiktok"],
                "🎨 MEDIA": ["sticker", "tts"],
                "👑 OWNER": ["ban", "unban", "banlist", "block", "unblock", "sudo", "delsudo", "listsudo", "mode", "autoread"],
                "⚙️ SETTINGS": [
                    "welcome", "goodbye", "setwelcome", "setgoodbye", "antilink", "antidelete",
                    "editpath", "recording", "autotyping", "online", "autoreact", "anticall",
                    "anticallmsg", "adminaction", "statuslike", "prefix", "botname", "ownername",
                    "ownernumber", "description", "stickername", "settings",
                ],
                "🏠 MAIN": ["ping", "help", "alive", "owner", "repo"],
            };

            let menu = `━━━━━━ 🤖 ʙᴏᴛ ɪɴғᴏ ━━━━━━\n`;
            menu += `◉ 🎉 ${config.BOT_NAME || "Tasmee-Ai-Bot"}\n`;
            menu += `◉ 👑 ᴏᴡɴᴇʀ: ${config.OWNER_NAME || "Tasmee"}\n`;
            menu += `◉ 📜 ᴄᴏᴍᴍᴀɴᴅs: ${allCommands.length}\n`;
            menu += `◉ ⏱️ ʀᴜɴᴛɪᴍᴇ: ${mins}m ${secs}s\n`;
            menu += `◉ 📦 ᴘʀᴇғɪx: ${config.PREFIX || "."}\n`;
            menu += `◉ ⚙️ ᴍᴏᴅᴇ: ${config.MODE || "public"}\n`;
            menu += `◉ 🏷️ ᴠᴇʀsɪᴏɴ: 1.0.0\n`;

            for (const [category, cmdNames] of Object.entries(categories)) {
                menu += `━━━━━『 ${category} 』━━━━━\n◉\n`;
                for (const cmdName of cmdNames) {
                    const cmd = allCommands.find((c) => c.name === cmdName);
                    if (cmd) menu += `◉ ➤ ${cmd.name}\n`;
                }
            }

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
            const { spawn } = require("child_process");
            const os = require("os");
            const jobId = `tts_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
            const tmpDir = os.tmpdir();
            const chunkPaths = [];

            try {
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

            const apiKey = config.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
            if (!apiKey) {
                await sock.sendMessage(from, { text: "⚠️ API key not set in config." });
                return;
            }

            await sock.sendMessage(from, { text: "🤖 Thinking..." });

            try {
                const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: "llama-3.3-70b-versatile",
                        messages: [
                            { role: "system", content: config.AI_PERSONA || "You are a helpful assistant." },
                            { role: "user", content: question }
                        ]
                    })
                });

                const data = await response.json();
                if (!response.ok) {
                    throw new Error(data.error?.message || `Groq API Error (${response.status})`);
                }

                const answer = data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";
                await sock.sendMessage(from, { text: `🤖 ${answer}` });
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
            const directUrl = cleanArgs.find((a) => a.includes("youtube.com") || a.includes("youtu.be"));

            if (!directUrl && cleanArgs.length === 0) {
                await sock.sendMessage(from, {
                    text: "❌ Please provide a YouTube link or a song/video name.\nExample: *.yt Attention Charlie Puth*",
                });
                return;
            }

            const target = directUrl || `ytsearch1:${cleanArgs.join(" ")}`;
            const label = directUrl ? "this link" : cleanArgs.join(" ");

            if (explicitVideo || explicitAudio) {
                await downloadYt(sock, { from, msg, target, label, wantsVideo: explicitVideo, config });
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
];

module.exports = allCommands;
module.exports.pendingYt = new Map();
module.exports.downloadYt = downloadYt;
module.exports.isOwner = isOwner;
