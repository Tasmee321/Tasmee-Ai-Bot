// ============================================
// lib/memory.js - Short-term per-user conversation memory
//
// Remembers a small amount of recent conversation + simple facts
// (like the user's name) per WhatsApp chat, so the AI can hold a
// natural conversation instead of repeating itself or forgetting
// who it's talking to mid-chat.
//
// This is intentionally NOT permanent: if a chat goes quiet for
// longer than MEMORY_EXPIRY_MS, it's wiped automatically the next
// time that user writes in. No manual cleanup needed.
// ============================================

const fs = require("fs");
const path = require("path");

const MEMORY_FILE = path.join(__dirname, "..", "data", "memory.json");
const DATA_DIR = path.join(__dirname, "..", "data");

// How long a chat can sit idle before its memory is forgotten.
const MEMORY_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

// How many messages (user+assistant combined) to keep per chat.
const MAX_HISTORY = 10;

let memory = {};

function load() {
    try {
        if (fs.existsSync(MEMORY_FILE)) {
            memory = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf-8"));
        }
    } catch {
        memory = {};
    }
}
load();

function save() {
    try {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory, null, 2));
    } catch {
        // memory is best-effort; never crash the bot over this
    }
}

function isExpired(entry) {
    return !entry || Date.now() - entry.lastActive > MEMORY_EXPIRY_MS;
}

// Roman Urdu + English patterns for picking up a stated name.
// Deliberately conservative — only grabs a single clean word so we
// don't accidentally store a whole sentence as someone's "name".
const NAME_PATTERNS = [
    /\bmera\s+naam\s+([a-zA-Z\u0600-\u06FF]{2,20})\b/i,
    /\bmy\s+name\s+is\s+([a-zA-Z]{2,20})\b/i,
    /\bmujhe\s+([a-zA-Z\u0600-\u06FF]{2,20})\s+kehte\s*hain\b/i,
    /\bi\s*'?am?\s+([a-zA-Z]{2,20})\s*(?:hoon|hun|here)?\b/i,
];

function extractName(text) {
    for (const re of NAME_PATTERNS) {
        const m = text.match(re);
        if (m && m[1]) return m[1].trim();
    }
    return null;
}

// Returns { name, history } for a given chat id. Auto-resets if expired.
function getContext(id) {
    const entry = memory[id];
    if (isExpired(entry)) {
        delete memory[id];
        return { name: null, history: [] };
    }
    return { name: entry.name || null, history: entry.history || [] };
}

// Call after every AI exchange to store it + refresh the idle timer.
function remember(id, userText, botReply) {
    if (isExpired(memory[id])) delete memory[id];
    if (!memory[id]) memory[id] = { name: null, history: [] };

    const entry = memory[id];
    entry.lastActive = Date.now();

    const name = extractName(userText);
    if (name) entry.name = name;

    entry.history.push({ role: "user", content: userText });
    entry.history.push({ role: "assistant", content: botReply });
    if (entry.history.length > MAX_HISTORY) {
        entry.history = entry.history.slice(-MAX_HISTORY);
    }

    save();
}

function forget(id) {
    delete memory[id];
    save();
}

module.exports = { getContext, remember, forget };
