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
// Start WhatsApp Connection
// ============================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_FOLDER);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
    });

    if (!sock.authState.creds.registered) {
        const phoneNumber = await question(
            "Apna WhatsApp number likhein (country code ke sath, e.g. 923001234567): "
        );
        const code = await sock.requestPairingCode(phoneNumber.trim());
        console.log(`\nYeh raha aapka Pairing Code: ${code}\n`);
        console.log("WhatsApp > Linked Devices > Link with phone number > yeh code enter karein.\n");
    }

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "close") {
            const shouldReconnect =
                new Boom(lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Connection band ho gayi. Reconnect:", shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === "open") {
            console.log("✅ Bot successfully connect ho gaya WhatsApp se!");
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

        // Auto-read messages if enabled
        if ((config.AUTOREAD === "true" || config.AUTOREAD === true) && !msg.key.fromMe) {
            await sock.readMessages([msg.key]).catch(() => {});
        }

        // Store message content for antidelete feature
        if (config.ANTIDELETE === "true" || config.ANTIDELETE === true) {
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
            if (config.ANTIDELETE === "true" || config.ANTIDELETE === true) {
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

        if (msg.key.fromMe) return;
        const isGroup = from.endsWith("@g.us");
        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        if (!text.startsWith(PREFIX)) return;

        // Show typing/recording indicator if enabled
        try {
            if (config.AUTOTYPING === "true" || config.AUTOTYPING === true) {
                await sock.sendPresenceUpdate("composing", from);
            } else if (config.RECORDING === "true" || config.RECORDING === true) {
                await sock.sendPresenceUpdate("recording", from);
            }
        } catch {}

        const args = text.slice(PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = commands.get(commandName);

        if (!command) return;

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
                await sock.sendMessage(update.id, {
                    text: `👋 Welcome @${name} to *${groupName}*!`,
                    mentions: [participant],
                });
            } else if (update.action === "remove") {
                await sock.sendMessage(update.id, {
                    text: `👋 @${name} left *${groupName}*. Goodbye!`,
                    mentions: [participant],
                });
            }
        }
    });

    // ============================================
    // Anti-Call - reject incoming calls if enabled
    // ============================================
    sock.ev.on("call", async (calls) => {
        if (config.ANTICALL !== "true" && config.ANTICALL !== true) return;
        for (const call of calls) {
            const callerJid = call.from;
            if (!callerJid || call.status !== "offer") continue;
            try {
                await sock.rejectCall(call.id, callerJid);
                const msgText = config.ANTICALL_MSG || "📵 Calls are not allowed. Your call was rejected.";
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

startBot();
