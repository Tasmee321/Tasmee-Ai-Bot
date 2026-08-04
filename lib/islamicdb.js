// ============================================
// Islamic features storage — Tasbeeh counters + Azaan reminder
// subscriptions. Same simple JSON-file pattern as lib/configdb.js so it
// survives restarts without needing a real database.
// ============================================
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const TASBEEH_FILE = path.join(DATA_DIR, "tasbeeh.json");
const AZAAN_FILE = path.join(DATA_DIR, "azaan.json");

function ensureFile(file, def) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(def, null, 2));
}

function readJson(file, def) {
    ensureFile(file, def);
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return { ...def };
    }
}

function writeJson(file, data) {
    ensureFile(file, {});
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ---------- Tasbeeh ----------
// { "<chatId>": { count: number, label: string, updatedAt: number } }
function getTasbeeh(chatId) {
    const db = readJson(TASBEEH_FILE, {});
    return db[chatId] || { count: 0, label: "SubhanAllah" };
}

function bumpTasbeeh(chatId, by = 1, label = null) {
    const db = readJson(TASBEEH_FILE, {});
    const cur = db[chatId] || { count: 0, label: "SubhanAllah" };
    cur.count += by;
    if (label) cur.label = label;
    cur.updatedAt = Date.now();
    db[chatId] = cur;
    writeJson(TASBEEH_FILE, db);
    return cur;
}

function resetTasbeeh(chatId) {
    const db = readJson(TASBEEH_FILE, {});
    db[chatId] = { count: 0, label: (db[chatId] && db[chatId].label) || "SubhanAllah", updatedAt: Date.now() };
    writeJson(TASBEEH_FILE, db);
    return db[chatId];
}

// ---------- Azaan reminder subscriptions ----------
// { "<chatId>": { city: string, lastSent: { Fajr: "YYYY-MM-DD", ... } } }
function getAzaanSubs() {
    return readJson(AZAAN_FILE, {});
}

function subscribeAzaan(chatId, city) {
    const db = readJson(AZAAN_FILE, {});
    db[chatId] = { city, lastSent: (db[chatId] && db[chatId].lastSent) || {} };
    writeJson(AZAAN_FILE, db);
}

function unsubscribeAzaan(chatId) {
    const db = readJson(AZAAN_FILE, {});
    delete db[chatId];
    writeJson(AZAAN_FILE, db);
}

function markAzaanSent(chatId, prayerName, dateStr) {
    const db = readJson(AZAAN_FILE, {});
    if (!db[chatId]) return;
    db[chatId].lastSent = db[chatId].lastSent || {};
    db[chatId].lastSent[prayerName] = dateStr;
    writeJson(AZAAN_FILE, db);
}

module.exports = {
    getTasbeeh,
    bumpTasbeeh,
    resetTasbeeh,
    getAzaanSubs,
    subscribeAzaan,
    unsubscribeAzaan,
    markAzaanSent,
};
