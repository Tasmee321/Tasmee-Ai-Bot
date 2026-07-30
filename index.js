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

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// ============================================
// Load all commands from /commands folder automatically
// ============================================
const commands = new Map();

function loadCommands() {
    commands.clear();
    const commandsPath = path.join(__dirname, "commands");
    if (!fs.existsSync(commandsPath)) fs.mkdirSync(commandsPath);

    const files = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

    for (const file of files) {
        try {
            delete require.cache[require.resolve(`./commands/${file}`)];
            const command = require(`./commands/${file}`);

            if (!command.name || typeof command.execute !== "function") {
                console.log(`⚠️  Skipping ${file} — missing "name" or "execute" function.`);
                continue;
            }

            commands.set(command.name, command);

            // Support multiple aliases per command
            if (Array.isArray(command.aliases)) {
                for (const alias of command.aliases) {
                    commands.set(alias, command);
                }
            }
        } catch (err) {
            console.log(`❌ Error loading command ${file}:`, err.message);
        }
    }

    console.log(`✅ Loaded ${files.length} command file(s), ${commands.size} total command(s)/alias(es).`);
}

loadCommands();

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
        }
    });

    // ============================================
    // Handle Incoming Messages -> Route to Commands
    // ============================================
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith("@g.us");
        const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            msg.message.imageMessage?.caption ||
            msg.message.videoMessage?.caption ||
            "";

        if (!text.startsWith(PREFIX)) return;

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

    return sock;
}

startBot();

// Hot-reload commands if you add new files while bot is running (optional dev convenience)
module.exports = { loadCommands, commands };
