<div align="center">
  <img src="https://i.ibb.co/4w5gxSM1/tasmee-ai-bot.png" alt="Tasmee-Ai-Bot" width="500">
</div>

<div align="center">
  <h1 style="background-color:#4B0082; color:white; display:inline-block; padding:20px 40px; border-radius:10px; font-size:48px; font-family:Fira+Code; text-align:center;">
    TASMEE-AI-BOT
  </h1>
</div>

<h1 align="center">
  <img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code:wght@700&size=32&duration=6000&color=FF69B4&background=000000&center=true&vCenter=true&width=650&lines=MY+PERSONAL+WHATSAPP+BOT" alt="Typing Animation">
</h1>

> **CURRENT BOT VERSION ➜ `1.0.0`**

---

<div align="center" style="margin-top:25px">

<a href="#">
  <img src="https://img.shields.io/badge/STATUS-ACTIVE-3CF2FF?style=for-the-badge&logo=vercel&logoColor=000000">
</a>

</div>

---

## 📖 About

This is a personal WhatsApp automation bot built using the open-source [Baileys](https://github.com/WhiskeySockets/Baileys) library. All code in this repository is original and transparent — no hidden or externally-downloaded scripts.

---

## 🚀 Getting Started

### 1. Clone This Repository

```bash
git clone https://github.com/Tasmee321/Tasmee-Ai-Bot.git
cd Tasmee-Ai-Bot
npm install
```

### 2. Configure Your Bot

Edit `config.js` (or use a `config.env` file) to set your own:
- Bot name
- Owner number
- Command prefix
- Feature toggles

### 3. Run the Bot

```bash
node index.js
```

On first run, you'll be asked to enter your WhatsApp number to generate a **pairing code** directly from the bot itself — no third-party website needed.

---

## ✨ Key Features

<div align="center">

| Category | Features |
|---------|----------|
| **🌐 Core** | Multi-Device Support |
| **⚙️ Utilities** | Pairing Code Login |

</div>

*(More features will be added here as they're built.)*

---

## 🔑 Personal Pairing Site (Optional)

A small private tool to generate your `SESSION_ID` using either a QR code or a pairing code — instead of using any third-party pairing website.

**Live Link:** [whatsapp-session-pair-code.onrender.com](https://whatsapp-session-pair-code.onrender.com)

### How to Generate Your Session ID

1. Open the link above in your browser
2. Enter the access password (private — ask the bot owner if you don't have it)
3. Choose **QR Code** or **Pair Code** tab
4. **QR Code method:** Click "Generate QR Code", then open WhatsApp on your phone → **Linked Devices** → **Link a Device** → scan the QR code shown on the page
5. **Pair Code method:** Enter your WhatsApp number (with country code, no `+` or spaces), click "Generate Pair Code", then open WhatsApp → **Linked Devices** → **Link with phone number** → enter the code shown
6. Once connected, your **SESSION_ID** will appear on the page — copy it and paste it into your bot's `config.js` or environment variables

⚠️ **This tool is for personal/family use only — never share the link, access password, or your generated Session ID publicly.**

### Location

**Location:** `/pairing-site` folder in this repo

### Local Setup

```bash
cd pairing-site
npm install
node server.js
```

Then open `http://localhost:3000` in your browser.

### Deploying (Render)

1. Push the `pairing-site` folder to this repo (already included)
2. Create a new **Web Service** on [Render](https://render.com), connect this repo, and set the root directory to `pairing-site`
3. Build command: `npm install` — Start command: `node server.js`
4. Add an environment variable `ACCESS_PASSWORD` with your own private password
5. Once deployed, open the Render URL, enter the access password, and generate your pairing code or QR

---

## ⚠️ Security Note

This bot generates its own pairing code locally — it never sends your session or login data to any third-party server. Never share your `session` folder with anyone; it contains your WhatsApp login credentials.

---

## 📞 Contact

Maintained by **Tasmee ul Hasnain**.

---
