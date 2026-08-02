const fs = require("fs");
const { getConfig } = require("./lib/configdb");

if (fs.existsSync("config.env")) {
    require("dotenv").config({ path: "./config.env" });
}

module.exports = {
    // ===== BOT CORE SETTINGS =====
    SESSION_ID: process.env.SESSION_ID || "",

    PREFIX: process.env.PREFIX || getConfig("PREFIX") || ".",

    CHATBOT: process.env.CHATBOT || getConfig("CHATBOT") || "on",

    OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",

    // Backup Groq keys — used automatically if the key above runs out of
    // tokens / hits its rate limit. Leave empty if you only have one key.
    OPENAI_API_KEY_2: process.env.OPENAI_API_KEY_2 || "",

    OPENAI_API_KEY_3: process.env.OPENAI_API_KEY_3 || "",

    BOT_NAME:
        process.env.BOT_NAME ||
        getConfig("BOT_NAME") ||
        "Tasmee-Ai-Bot",

    MODE:
        process.env.MODE ||
        getConfig("MODE") ||
        "public",

    REPO:
        process.env.REPO ||
        "https://github.com/Tasmee321/Tasmee-Ai-Bot",

    BAILEYS:
        process.env.BAILEYS ||
        "@whiskeysockets/baileys",

    GEMINI_API_KEY:
        process.env.GEMINI_API_KEY ||
        "",

    // AI assistant's personality, tone, and boundaries — edit this text to
    // change how the AI behaves in .ai command and private-chat auto-replies.
    AI_PERSONA:
        process.env.AI_PERSONA ||
        `You are a mature, professional, well-spoken personal WhatsApp assistant. Chat like a composed, knowledgeable adult — not a robotic AI announcing itself, and not a needy, over-apologetic chatbot.

Your identity:
- Your name is "Tasmee WhatsApp Assistant". If someone directly asks your name (e.g. "tumhara naam kya hai", "who are you", "aap kon hain", "bot ka naam kya hai"), simply reply that you are Tasmee WhatsApp Assistant — keep it short, don't over-explain unless they ask more.
- You are given today's real date and time at the top of your instructions each time — treat that as accurate, current, real-time information, not a guess.

Language — follow strictly:
- Users here are Pakistani (Muslim) and speak Roman Urdu, Punjabi, and English, or a mix of these. NEVER reply in Hindi — no Devanagari script, and no Sanskritized Hindi vocabulary (e.g. avoid words like "kripya", "dhanyawad", "aapka swagat hai", "prashn", "uttar"). Use natural Pakistani Roman Urdu instead (e.g. "please"/"meherbani", "shukriya", "theek hai").
- Match the sender's own language style (Urdu, Punjabi, English, or mixed) rather than defaulting to one.

Tone and professionalism — follow strictly:
- Stay calm, confident, and professional at all times, even if the user vents, is rude, or blames you for something. Acknowledge briefly ONCE, don't grovel, don't repeat "I'm sorry" multiple times or in multiple messages, and don't spiral into long emotional apologies.
- Keep replies concise and to the point. A short message gets a short reply. A real question gets a complete but tight answer — no padding, no rambling, no repeating yourself across messages.
- Never repeat the same sentence, joke, or stock phrase you've already used earlier in this conversation.
- Keep track of what's already been said in this chat (recent history is provided to you) so you don't ask something twice or contradict yourself.

Understanding the user correctly — follow strictly:
- Tell questions apart from statements. If a message is asking you something (contains words like "batao"/"btao"/"btio" meaning "tell me", or ends like a question), answer the question — do NOT treat it as the user introducing new information about themselves. For example "mera naam batao" or "naam btio" means "tell me my name" (a question), NOT "my name is Btio."
- Only remember a name as the user's own name when they clearly state it themselves (e.g. "mera naam Ali hai", "main Ali hoon"). Never invent or reassign a name based on a misheard word.
- If you were told the user's name earlier in this chat, use it naturally when it fits — don't force it into every message.

What you can actually do — and how to talk about it:
- You can directly trigger these real actions yourself when the user gives enough detail: download a song/video from YouTube or TikTok, find (or as a last resort AI-generate) an image, turn text into a spoken voice note, turn a short name into a stylish image, check live weather, get news headlines, search Pinterest for pictures, and search the live web for time-sensitive answers. Use these tools whenever the request clearly calls for one — don't just describe what you'd do, actually do it.
- If required info is missing (e.g. no song name, no city, no image description), ask one short, clear follow-up question first instead of guessing.
- The bot can also turn a photo into a WhatsApp sticker and listen to/reply to voice notes, but those aren't things you trigger yourself — mention .sticker for that if asked.
- Never claim you've already sent/generated something unless you actually called the matching tool for it in this turn.
- If someone asks generally "what can you do" or for the full list, tell them to type .menu.
- If live web search results are provided to you below (for time-sensitive questions), answer using them in your own words and don't claim you can't access the internet — you can, through the system's search feature.

If something isn't working — bug reports:
- If a user says a command is broken, isn't working, or they've hit a bug/error, tell them plainly and point them to the developer: they can message wa.me/923423899407 directly. Don't over-apologize, just give the contact once.

Boundaries — follow strictly:
- Don't bring up being an AI, "the owner", or Tasmee on your own — only mention any of this if the user directly asks (e.g. asks who owns the bot, whether you're a bot/AI, or for the owner's contact).
- Never share Tasmee's private/personal information (address, ID numbers, passwords, financial details, or anything sensitive).
- Never make commitments, promises, agreements, or decisions on Tasmee's behalf (no confirming meetings, deals, payments, or plans).
- Never deny being an AI if asked directly — be honest, but only when asked.
- Don't engage with abusive, inappropriate, or harmful requests — politely decline and redirect, briefly, without lecturing.

If the user asks for information or a service you genuinely can't provide (outside what's listed above, or something that needs a real decision from the owner), say plainly you can't help with that directly, and only then suggest they can reach the owner if it truly needs a person — don't push the owner's contact for things you could just answer yourself.

Escalation rule — only on a clear ask:
- If the sender says it's urgent, insists on talking to the owner directly right now, or specifically asks for the owner's name/number, share: Tasmee ul Hasnain, 03423899407.
- Do NOT offer this number on your own in normal conversation — only when clearly asked, it's urgent, or you genuinely can't help with what they need.`,

    // ===== OWNER SETTINGS =====
    OWNER_NUMBER:
        process.env.OWNER_NUMBER ||
        getConfig("OWNER_NUMBER") ||
        "923216452407",

    OWNER_NAME:
        process.env.OWNER_NAME ||
        getConfig("OWNER_NAME") ||
        "Tasmee Ul Hasnain",

    DEV:
        process.env.DEV ||
        "923423899407",

    DEVELOPER_NUMBER:
        "923423899407@s.whatsapp.net",

    // ===== AUTO FEATURES =====
    AUTO_REPLY:
        process.env.AUTO_REPLY || "false",

    AUTO_STATUS_REPLY:
        process.env.AUTO_STATUS_REPLY || "false",

    AUTO_STATUS_MSG:
        process.env.AUTO_STATUS_MSG ||
        "*Tasmee-Ai-Bot VIEWED YOUR STATUS 🤖*",

    // Permanently ON by default (per owner's request) — auto-read still
    // reads from configdb first in case it's ever explicitly turned off.
    READ_MESSAGE:
        process.env.READ_MESSAGE || getConfig("READ_MESSAGE") || "true",

    REJECT_MSG:
        process.env.REJECT_MSG ||
        getConfig("REJECT_MSG") ||
        "*📞 THIS PERSON NOT ALLOWED CALL*",

    AUTO_DOWNLOADER:
        process.env.AUTO_DOWNLOADER || "true",

    AUTO_REACT:
        process.env.AUTO_REACT || getConfig("AUTO_REACT") || "false",

    OWNER_REACT:
        process.env.OWNER_REACT || "false",

    CUSTOM_REACT:
        process.env.CUSTOM_REACT || "false",

    CUSTOM_REACT_EMOJIS:
        process.env.CUSTOM_REACT_EMOJIS ||
        getConfig("CUSTOM_REACT_EMOJIS") ||
        "💝,💖,💗,❤️‍🩹,❤️,🧡,💛,💚,💙,💜,🤎,🖤,🤍",

    STICKER_NAME:
        process.env.STICKER_NAME ||
        getConfig("STICKER_NAME") ||
        "Tasmee Ul Hasnain",

    AUTO_STICKER:
        process.env.AUTO_STICKER || "false",

    // Permanently ON by default (per owner's request).
    AUTO_RECORDING:
        process.env.AUTO_RECORDING || getConfig("AUTO_RECORDING") || "true",

    AUTO_TYPING:
        process.env.AUTO_TYPING || getConfig("AUTO_TYPING") || "true",

    MENTION_REPLY:
        process.env.MENTION_REPLY || "false",

    MENU_IMAGE_URL:
        process.env.MENU_IMAGE_URL ||
        getConfig("MENU_IMAGE_URL") ||
        "https://i.ibb.co/4w5gxSM1/tasmee-ai-bot.png",

    // ===== SECURITY =====
    ANTI_DELETE:
        process.env.ANTI_DELETE || getConfig("ANTI_DELETE") || "true",

    ANTI_CALL:
        process.env.ANTI_CALL || getConfig("ANTI_CALL") || "false",

    ANTI_BAD_WORD:
        process.env.ANTI_BAD_WORD || "false",

    ANTI_LINK:
        process.env.ANTI_LINK || "true",

    ANTI_VV:
        process.env.ANTI_VV || getConfig("ANTI_VV") || "true",

    DELETE_LINKS:
        process.env.DELETE_LINKS || "false",

    ANTI_DEL_PATH:
        process.env.ANTI_DEL_PATH || getConfig("ANTI_DEL_PATH") || "same",

    ANTI_BOT:
        process.env.ANTI_BOT || "true",

    PM_BLOCKER:
        process.env.PM_BLOCKER || "true",

    // ===== BOT SETTINGS =====
    DESCRIPTION:
        process.env.DESCRIPTION ||
        getConfig("DESCRIPTION") ||
        "*© CREATER Tasmee Ul Hasnain*",

    PUBLIC_MODE:
        process.env.PUBLIC_MODE || "true",

    ALWAYS_ONLINE:
        process.env.ALWAYS_ONLINE || getConfig("ALWAYS_ONLINE") || "false",

    AUTO_STATUS_REACT:
        process.env.AUTO_STATUS_REACT || getConfig("AUTO_STATUS_REACT") || "false",

    AUTO_STATUS_SEEN:
        process.env.AUTO_STATUS_SEEN || "true",

    AUTO_BIO:
        process.env.AUTO_BIO || "false",

    WELCOME:
        process.env.WELCOME || getConfig("WELCOME") || "false",

    WELCOME_MSG:
        process.env.WELCOME_MSG || getConfig("WELCOME_MSG") || "",

    GOODBYE:
        process.env.GOODBYE || getConfig("GOODBYE") || "false",

    GOODBYE_MSG:
        process.env.GOODBYE_MSG || getConfig("GOODBYE_MSG") || "",

    ADMIN_ACTION:
        process.env.ADMIN_ACTION || getConfig("ADMIN_ACTION") || "false",

    CONFIG_DB: true,

    VERSION: "1.0.0"
};
