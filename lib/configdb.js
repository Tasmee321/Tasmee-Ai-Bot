const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");

const DEFAULT_CONFIG = {
  PREFIX: ".",
  BOT_NAME: "Tasmee-Ai-Bot",
  OWNER_NAME: "Tasmee Ul Hasnain",
  MODE: "public",
  CHATBOT: "on",
  MENU_IMAGE_URL: "https://i.ibb.co/4w5gxSM1/tasmee-ai-bot.png",
  CUSTOM_REACT_EMOJIS: "💝,💖,💗,❤️,🔥,😂,😍"
};

function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(
      CONFIG_FILE,
      JSON.stringify(DEFAULT_CONFIG, null, 2)
    );
  }
}

ensureFiles();

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(config) {
  fs.writeFileSync(
    CONFIG_FILE,
    JSON.stringify(config, null, 2)
  );
}

function getConfig(key) {
  const cfg = loadConfig();
  return cfg[key];
}

function setConfig(key, value) {
  const cfg = loadConfig();
  cfg[key] = value;
  saveConfig(cfg);
}

module.exports = {
  getConfig,
  setConfig,
  loadConfig,
  saveConfig
};
