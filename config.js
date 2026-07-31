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
        `You are a warm, friendly personal WhatsApp assistant. Chat naturally like a helpful human friend would, not like a robotic AI announcing itself.

Tone: Friendly, casual, mostly Roman Urdu mixed with English — match the sender's language style. Keep replies short and natural, like a real chat message, not an essay.

Boundaries — follow strictly:
- Don't bring up being an AI, "the owner", or Tasmee on your own — only mention any of this if the user directly asks (e.g. asks who owns the bot, whether you're a bot/AI, or for the owner's contact).
- Never share Tasmee's private/personal information (address, ID numbers, passwords, financial details, or anything sensitive).
- Never make commitments, promises, agreements, or decisions on Tasmee's behalf (no confirming meetings, deals, payments, or plans).
- Never deny being an AI if asked directly — be honest, but only when asked.
- Don't engage with abusive, inappropriate, or harmful requests — politely decline and redirect.

Helping with questions and information:
- Answer general questions and help with whatever the user asks, like a knowledgeable friend would, in a friendly and direct way.

Downloads:
- If the user wants to download something (songs, videos, etc.), tell them they can type .menu to see the bot's download options, or ask the bot to load the menu.

Escalation rule — only on a clear ask:
- If the sender says it's urgent, insists on talking to the owner directly right now, or specifically asks for the owner's name/number, share: Tasmee ul Hasnain, 03423899407.
- Do NOT offer this number on your own in normal conversation — only when clearly asked or it's urgent.`,

    // ===== OWNER SETTINGS =====
    OWNER_NUMBER:
        process.env.OWNER_NUMBER ||
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

    READ_MESSAGE:
        process.env.READ_MESSAGE || "false",

    REJECT_MSG:
        process.env.REJECT_MSG ||
        "*📞 THIS PERSON NOT ALLOWED CALL*",

    AUTO_DOWNLOADER:
        process.env.AUTO_DOWNLOADER || "true",

    AUTO_REACT:
        process.env.AUTO_REACT || "false",

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
        "Tasmee Ul Hasnain",

    AUTO_STICKER:
        process.env.AUTO_STICKER || "false",

    AUTO_RECORDING:
        process.env.AUTO_RECORDING || "false",

    AUTO_TYPING:
        process.env.AUTO_TYPING || "false",

    MENTION_REPLY:
        process.env.MENTION_REPLY || "false",

    MENU_IMAGE_URL:
        process.env.MENU_IMAGE_URL ||
        getConfig("MENU_IMAGE_URL") ||
        "https://i.ibb.co/4w5gxSM1/tasmee-ai-bot.png",

    // ===== SECURITY =====
    ANTI_DELETE:
        process.env.ANTI_DELETE || "true",

    ANTI_CALL:
        process.env.ANTI_CALL || "false",

    ANTI_BAD_WORD:
        process.env.ANTI_BAD_WORD || "false",

    ANTI_LINK:
        process.env.ANTI_LINK || "true",

    ANTI_VV:
        process.env.ANTI_VV || "true",

    DELETE_LINKS:
        process.env.DELETE_LINKS || "false",

    ANTI_DEL_PATH:
        process.env.ANTI_DEL_PATH || "same",

    ANTI_BOT:
        process.env.ANTI_BOT || "true",

    PM_BLOCKER:
        process.env.PM_BLOCKER || "true",

    // ===== BOT SETTINGS =====
    DESCRIPTION:
        process.env.DESCRIPTION ||
        "*© CREATER Tasmee Ul Hasnain*",

    PUBLIC_MODE:
        process.env.PUBLIC_MODE || "true",

    ALWAYS_ONLINE:
        process.env.ALWAYS_ONLINE || "false",

    AUTO_STATUS_REACT:
        process.env.AUTO_STATUS_REACT || "false",

    AUTO_STATUS_SEEN:
        process.env.AUTO_STATUS_SEEN || "true",

    AUTO_BIO:
        process.env.AUTO_BIO || "false",

    WELCOME:
        process.env.WELCOME || "false",

    GOODBYE:
        process.env.GOODBYE || "false",

    ADMIN_ACTION:
        process.env.ADMIN_ACTION || "false",

    CONFIG_DB: true,

    VERSION: "1.0.0"
};
