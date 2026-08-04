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

// Tries the request through a full cascade of Groq's free-tier chat models
// — best quality first, falling all the way down to the lightest/highest
// -limit models. Each tier is tried against every configured key before
// moving to the next tier, so a request only truly fails if every model AND
// every key is exhausted.
//
// Order (best → lightest) with each model's free-tier daily token limit:
//   1. llama-3.3-70b-versatile   — 100K TPD  (best general quality)
//   2. openai/gpt-oss-120b        — 200K TPD  (strong, higher limit)
//   3. openai/gpt-oss-20b          — 200K TPD  (lighter)
//   4. llama-3.1-8b-instant         — 500K TPD  (fast, big headroom)
//   5. allam-2-7b                    — 500K TPD  (lightest, last numeric-limit tier)
//   6. groq/compound-mini             — NO daily token limit (only 250 requests/day) — final safety net
//   7. groq/compound                   — NO daily token limit (only 250 requests/day) — absolute last resort
//
// (Prompt-guard / safeguard models are intentionally excluded — those are
// content-moderation classifiers, not chat models, and can't answer a
// normal conversation.)
const TEXT_MODEL_CHAIN = [
    "llama-3.3-70b-versatile",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "llama-3.1-8b-instant",
    "allam-2-7b",
    "groq/compound-mini",
    "groq/compound",
];

async function groqChatWithFallback(body, chain = TEXT_MODEL_CHAIN) {
    // Whatever model the caller originally asked for goes first, then the
    // rest of the chain follows (skipping the duplicate if it's already in
    // the default chain).
    const fullChain = body.model ? [body.model, ...chain.filter((m) => m !== body.model)] : chain;

    let lastErr;
    for (let i = 0; i < fullChain.length; i++) {
        const model = fullChain[i];
        try {
            return await groqChat({ ...body, model });
        } catch (err) {
            lastErr = err;
            if (err.noKeys) throw err;
            if (i < fullChain.length - 1) {
                console.log(`⚠️ All keys exhausted on ${model}, falling back to ${fullChain[i + 1]}...`);
                continue;
            }
        }
    }
    notifyAllKeysFailed(lastErr);
    throw lastErr;
}

// Vision (image understanding) chat — used by .analyze / .ocr / .homework
// (photo mode). Groq's vision-capable models change from time to time — as
// of mid-2026 the Llama 4 Scout/Maverick vision models were retired in
// favor of Qwen3.6 27B, Groq's current multimodal model. If this stops
// working again, check https://console.groq.com/docs/vision for the
// current model id and update VISION_MODEL below.
const VISION_MODEL = "qwen/qwen3.6-27b";

async function groqVisionChat(base64Image, prompt, mimeType = "image/jpeg") {
    const body = {
        model: VISION_MODEL,
        messages: [
            {
                role: "user",
                content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
                ],
            },
        ],
    };
    return await groqChat(body);
}

function groqTranscribe(buildForm) {
    return groqFetch(TRANSCRIBE_URL, (key) => ({
        method: "POST",
        headers: { "Authorization": `Bearer ${key}` },
        body: buildForm(),
    }));
}

module.exports = { getKeys, groqChat, groqChatWithFallback, groqTranscribe, groqVisionChat, onAllKeysFailed };
