// ============================================
// Groq multi-key helper
// ------------------------------------------------
// Supports up to 3 Groq API keys (OPENAI_API_KEY, OPENAI_API_KEY_2,
// OPENAI_API_KEY_3 in config.js / config.env). Every request is tried
// against the first key; if that key looks exhausted or invalid
// (401 / 403 / 429, or an error message mentioning quota / credit /
// rate limit / token), the same request is retried on the next key
// automatically. A genuine bad request on a working key still throws
// right away instead of burning through the remaining keys.
// ============================================

const config = require("../config");

const CHAT_URL = "https://api.groq.com/openai/v1/chat/completions";
const TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

function getKeys() {
    const keys = [];
    for (let i = 1; i <= 10; i++) {
        const envName = i === 1 ? "OPENAI_API_KEY" : `OPENAI_API_KEY_${i}`;
        const key = config[envName] || process.env[envName];
        if (key) keys.push(key);
    }
    return keys;
}

function looksExhausted(status, data) {
    if (status === 401 || status === 403 || status === 429) return true;
    const msg = ((data && data.error && data.error.message) || "").toLowerCase();
    return (
        msg.includes("quota") ||
        msg.includes("credit") ||
        msg.includes("rate limit") ||
        msg.includes("token") ||
        msg.includes("invalid api key")
    );
}

// buildOptions(key) must return a fresh fetch() options object each call
// (important for FormData bodies, which can only be read once).
async function groqFetch(url, buildOptions) {
    const keys = getKeys();
    if (keys.length === 0) {
        const err = new Error("No Groq API key set in config.");
        err.noKeys = true;
        throw err;
    }

    let lastErr;
    for (let i = 0; i < keys.length; i++) {
        let res, data = {};
        try {
            res = await fetch(url, buildOptions(keys[i]));
            try {
                data = await res.json();
            } catch {
                data = {};
            }
        } catch (networkErr) {
            lastErr = networkErr;
            if (i < keys.length - 1) continue; // network hiccup — try next key too
            throw lastErr;
        }

        if (res.ok) return data;

        lastErr = new Error((data && data.error && data.error.message) || `Groq API Error (${res.status})`);
        if (looksExhausted(res.status, data) && i < keys.length - 1) {
            console.log(`⚠️ Groq key #${i + 1} failed (${res.status}), trying next key...`);
            continue;
        }
        throw lastErr;
    }
    throw lastErr;
}

function groqChat(body) {
    return groqFetch(CHAT_URL, (key) => ({
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify(body),
    }));
}

// Tries the request on `body.model` (all 3 keys). Only if every key is
// exhausted on that model does it retry the exact same request on
// `fallbackModel` — so we get the better model's quality by default, and
// the higher-limit model only kicks in as a true last resort instead of
// being used for everything.
let allKeysFailedHandler = null;
let lastAllKeysFailedNotify = 0;
const ALL_KEYS_FAILED_COOLDOWN_MS = 30 * 60 * 1000; // don't notify more than once per 30 min

// Register a callback (sock, config already bound by the caller) to run
// when every configured key + every fallback model has been exhausted.
// Best-effort, fire-and-forget — never throws into the caller's flow.
function onAllKeysFailed(handler) {
    allKeysFailedHandler = handler;
}

function notifyAllKeysFailed(err) {
    if (!allKeysFailedHandler) return;
    const now = Date.now();
    if (now - lastAllKeysFailedNotify < ALL_KEYS_FAILED_COOLDOWN_MS) return;
    lastAllKeysFailedNotify = now;
    Promise.resolve(allKeysFailedHandler(err)).catch(() => {});
}

async function groqChatWithFallback(body, fallbackModel = "llama-3.1-8b-instant") {
    try {
        return await groqChat(body);
    } catch (err) {
        if (err.noKeys || body.model === fallbackModel) {
            notifyAllKeysFailed(err);
            throw err;
        }
        console.log(`⚠️ All keys exhausted on ${body.model}, falling back to ${fallbackModel}...`);
        try {
            return await groqChat({ ...body, model: fallbackModel });
        } catch (err2) {
            notifyAllKeysFailed(err2);
            throw err2;
        }
    }
}

// Vision (image understanding) chat — used by .analyze / .ocr / .homework
// (photo mode). Groq's vision-capable models change from time to time; if
// the primary one stops working, update VISION_MODEL / VISION_FALLBACK.
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const VISION_FALLBACK = "meta-llama/llama-4-maverick-17b-128e-instruct";

async function groqVisionChat(base64Image, prompt, mimeType = "image/jpeg") {
    const buildBody = (model) => ({
        model,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
                ],
            },
        ],
    });

    try {
        return await groqChat(buildBody(VISION_MODEL));
    } catch (err) {
        if (err.noKeys) throw err;
        console.log(`⚠️ Vision model ${VISION_MODEL} failed, trying ${VISION_FALLBACK}...`);
        return await groqChat(buildBody(VISION_FALLBACK));
    }
}

function groqTranscribe(buildForm) {
    return groqFetch(TRANSCRIBE_URL, (key) => ({
        method: "POST",
        headers: { "Authorization": `Bearer ${key}` },
        body: buildForm(),
    }));
}

module.exports = { getKeys, groqChat, groqChatWithFallback, groqTranscribe, groqVisionChat, onAllKeysFailed };
