<div align="center">
  <img src="https://i.ibb.co/4w5gxSM1/tasmee-ai-bot.png" alt="Tasmee-Ai-Bot" width="500">
</div>

<div align="center">
  <h1 style="background-color:#4B0082; color:white; display:inline-block; padding:20px 40px; border-radius:10px; font-size:48px; font-family:Fira+Code; text-align:center;">
    TASMEE-AI-BOT
  </h1>
</div>

<h1 align="center">
  <img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code:wght@700&size=28&duration=4000&color=FF69B4&background=000000&center=true&vCenter=true&width=750&lines=MY+PERSONAL+WHATSAPP+BOT;POWERED+BY+GROQ+AI;40%2B+SMART+COMMANDS;ISLAMIC+%2B+EDUCATION+TOOLS" alt="Typing Animation">
</h1>

> **CURRENT BOT VERSION ➜ `1.1.0`**

---

<div align="center" style="margin-top:25px">

<img src="https://img.shields.io/badge/STATUS-ACTIVE-3CF2FF?style=for-the-badge&logo=vercel&logoColor=000000">
<img src="https://img.shields.io/badge/RUNTIME-Node.js%2020%2B-339933?style=for-the-badge&logo=node.js&logoColor=white">
<img src="https://img.shields.io/badge/LIBRARY-Baileys-25D366?style=for-the-badge&logo=whatsapp&logoColor=white">
<img src="https://img.shields.io/badge/AI-Groq%20%2B%20Gemini-F55036?style=for-the-badge&logo=OpenAI&logoColor=white">
<img src="https://img.shields.io/badge/PROCESS-PM2%20Managed-2B037A?style=for-the-badge&logo=pm2&logoColor=white">
<img src="https://img.shields.io/badge/HOSTED%20ON-Oracle%20Cloud%20ARM-F80000?style=for-the-badge&logo=oracle&logoColor=white">

</div>

---

## 📖 About

**Tasmee-Ai-Bot** is a personal, self-hosted WhatsApp automation assistant built from the ground up on the open-source [Baileys](https://github.com/WhiskeySockets/Baileys) library. It's not a wrapper around someone else's bot — every command in this repository is original, transparent, and readable. There's no hidden/obfuscated code and no external "bot mods" — just one clean `commands.js` file where every feature lives in the open.

The bot runs 24/7 on an **Oracle Cloud Always-Free ARM instance**, managed by **PM2**, and is powered by **Groq's LLM API** (with automatic multi-key fallback + Gemini backup) for anything that needs real intelligence — chat, translation, tutoring, vision, and more.

---

## 🧠 What Makes This Bot Different

| | |
|---|---|
| 🔑 **Multi-key AI fallback** | Up to 10 Groq API keys rotate automatically — if one is rate-limited or expired, the bot silently retries the next one instead of failing |
| 🧵 **Context memory** | Remembers recent conversation per-chat so the AI doesn't repeat itself or forget what was just discussed |
| 🛠️ **AI tool-calling** | The `.ai` command (and normal chat) can *actually trigger* real actions — downloading a song, generating an image, checking weather — not just talk about them |
| 🎯 **Accurate downloads** | YouTube search shows the real top-5 results so you pick the exact song/video instead of the bot guessing wrong |
| 🕋 **Built-in Deen tools** | Prayer times, Qibla, Hijri calendar, Quran lookup, Hadith, duas, tasbeeh counter, and automatic azaan reminders — no separate app needed |
| 📚 **Study companion** | Ask questions about a PDF, get instant summaries, or get homework solved step-by-step from text *or* a photo |
| 🧩 **One-file architecture** | All 45+ commands live in a single well-organized `commands.js` — no digging through a maze of folders to add a feature |

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
- Bot name, owner number, and command prefix
- Groq API key(s) — `OPENAI_API_KEY` through `OPENAI_API_KEY_10` (multi-key fallback)
- Gemini API key (secondary AI backend)
- Feature toggles (welcome messages, anti-delete, anti-viewonce, etc.)

### 3. Run the Bot

```bash
node index.js
```

On first run, you'll be asked to enter your WhatsApp number to generate a **pairing code** directly from the bot itself — no third-party website needed.

### 4. Run It Permanently (Production)

```bash
npm install -g pm2
pm2 start index.js --name Tasmee-Ai-Bot
pm2 save
pm2 startup
```

### 5. Deploying Updates (standard workflow used on this bot's live server)

```bash
git pull
npm install
pm2 restart Tasmee-Ai-Bot
pm2 logs Tasmee-Ai-Bot     # confirm it started clean
```

---

## ✨ Full Feature List — 45+ Commands

<div align="center">

| Category | Commands |
|---|---|
| 🤖 **AI & Smart** | `.ai` `.search` `.translate` `.shayari` `.joke` `.quote` |
| 📥 **Downloads** | `.yt` `.audio` `.video` `.tiktok` `.pinterest` `.instagram` `.facebook` `.twitter` `.statusdl` `.pdfsearch` |
| 🎨 **Media Tools** | `.sticker` `.toimg` `.tts` `.text` `.image` `.analyze` `.ocr` `.imgurl` |
| 🕌 **Islamic Suite** | `.prayertimes` `.qibla` `.hijri` `.quran` `.hadith` `.dua` `.tasbeeh` `.asmaulhusna` `.sehriiftar` `.azaan` |
| 📚 **Education** | `.pdf` `.pdfsummary` `.homework` |
| 🌦️ **Live Info** | `.weather` `.news` `.cricket` `.petrol` `.gold` `.currency` `.define` |
| 🎉 **Fun** | `.truthordare` `.compatibility` `.riddle` `.poll` |
| 🛠️ **Utility** | `.qr` `.calc` `.remind` `.clearchat` |
| 👥 **Group Tools** | `.tagall` `.kick` `.antilink` `.antidelete` `.antiviewonce` `.antibadword` |
| 👑 **Owner Only** | `.ban` `.unban` `.banlist` `.block` `.unblock` `.sudo` `.mode` `.broadcast` |
| ⚙️ **Settings** | `.welcome` `.prefix` `.botname` `.autoreact` `.autotyping` `.settings` |

</div>

Type **`.menu`** in the bot's chat any time for the complete, always-up-to-date list.

---

## 🎵 Smart YouTube Search — How It Works

Instead of blindly grabbing the first search result (which often downloads the *wrong* song), the bot shows you real options first:

```
You:  .audio Attention Charlie Puth
Bot:  🎵 "Attention Charlie Puth" ke top results:

      1️⃣ Charlie Puth - Attention (Official Video) (3:30)
         👤 Charlie Puth
      2️⃣ Attention - Charlie Puth (Lyrics) (3:28)
         👤 LyricsHub
      3️⃣ Charlie Puth - Attention (Live) (4:02)
         👤 Charlie Puth
      ...

      Reply karein 1-5 konsa chahiye.

You:  1
Bot:  ⏳ Downloading... → 🎧 sends the exact audio you picked
```

Works the same way whether triggered via `.yt`, `.audio`, `.video`, or by just asking the AI in plain conversation ("mujhe attention wala gana bhejo").

---

## 🕌 Islamic Suite — Deen Tools Built In

| Command | What it does |
|---|---|
| `.prayertimes <city>` | Today's Fajr/Zuhr/Asr/Maghrib/Isha timings |
| `.qibla <city>` | Exact Qibla direction in degrees |
| `.hijri` | Today's Islamic (Hijri) calendar date |
| `.quran <surah> [ayat]` | Surah info, or a specific ayat with Urdu translation |
| `.hadith [book]` | A random authentic hadith (Bukhari/Muslim/Tirmidhi) |
| `.dua [number]` | Everyday duas (Arabic + transliteration + Urdu meaning) |
| `.tasbeeh [count]` | Personal zikr counter, saved per-chat |
| `.asmaulhusna [1-99]` | Allah's 99 Names, one at a time or random |
| `.sehriiftar <city>` | Sehri end / Iftar time for Ramadan |
| `.azaan on <city>` / `.azaan off` | **Automatic reminder** sent right when each namaz time arrives |

---

## 📚 Education Suite — Study Companion

| Command | What it does |
|---|---|
| `.pdf <question>` | Reply to any PDF with a question — the bot reads it and answers |
| `.pdfsummary` | Reply to a PDF — get a clean bullet-point summary |
| `.pdfsearch <topic>` | Finds free books/PDFs on a topic (via Internet Archive) |
| `.homework <question>` | Step-by-step solving of a text question |
| `.homework` *(reply to a photo)* | Solves a question straight from a photographed page |
| `.analyze` *(reply to a photo)* | Describes/explains what's in an image |
| `.ocr` *(reply to a photo)* | Extracts all readable text from an image |

---

## 🏗️ Architecture

```
Tasmee-Ai-Bot/
├── index.js            → Connection handling, message router, schedulers (azaan, etc.)
├── commands.js          → All 45+ commands + AI tool-calling logic (single source of truth)
├── config.js             → Central config (env vars, AI persona, feature flags)
├── lib/
│   ├── groq.js            → Multi-key Groq client + chat/vision/transcription helpers
│   ├── memory.js           → Per-chat conversation memory for the AI
│   ├── configdb.js          → Persisted runtime settings (survives restarts)
│   ├── database.js           → General lightweight JSON storage
│   ├── islamicdb.js           → Tasbeeh counters + azaan reminder subscriptions
│   └── islamicdata.js          → Static Islamic reference data (99 Names, duas)
└── data/                        → Auto-generated JSON storage (gitignored)
```

**Design principles this bot follows:**
- **One file per concern** — commands are grouped logically, not scattered across dozens of folders
- **Fail gracefully** — every external API call is wrapped so one dead API never crashes the whole bot
- **No dead dependencies** — features are built on tools already proven to work reliably (e.g. reusing `yt-dlp` for Instagram/Facebook/Twitter instead of an unofficial API)
- **Free-first** — wherever a free, no-key API can do the job reliably, it's used before reaching for a paid one

---

## 🔑 Personal Pairing Site (Optional)

A small private tool to generate your `SESSION_ID` using either a QR code or a pairing code — instead of using any third-party pairing website.

**Get Your Session ID:**

<div align="center">
  <a href="https://whatsapp-session-pair-code.onrender.com" target="_blank">
    <img alt="Generate Session ID" src="https://img.shields.io/badge/Generate%20Session%20ID-FF00FF?style=for-the-badge&logo=whatsapp&logoColor=white">
  </a>
</div>

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

## ⚙️ Environment Variables Reference

| Variable | Purpose | Required? |
|---|---|---|
| `SESSION_ID` | Base64 WhatsApp session (for server deployments without interactive pairing) | Optional |
| `PREFIX` | Command prefix (default `.`) | Optional |
| `BOT_NAME` | Display name used in bot messages | Optional |
| `OPENAI_API_KEY` → `OPENAI_API_KEY_10` | Groq API keys — first one tried first, others used as automatic fallback | At least 1 recommended |
| `GEMINI_API_KEY` | Secondary AI backend | Optional |
| `MODE` | `public` or `private` bot access mode | Optional |

---

## 🛣️ Roadmap

- [x] Multi-key Groq fallback system
- [x] AI tool-calling (download/image/weather triggered from natural chat)
- [x] Accurate multi-result YouTube search & selection
- [x] Full Islamic suite (prayer times, Quran, Hadith, azaan reminders, tasbeeh)
- [x] Education suite (PDF Q&A, PDF summary, homework solver, OCR, image analysis)
- [x] Reliable Instagram/Facebook/Twitter downloads via `yt-dlp`
- [ ] Persistent database migration (JSON → SQLite) for larger scale
- [ ] Web dashboard for live command usage stats
- [ ] Voice-to-voice real-time conversation mode

---

## ⚠️ Security Note

This bot generates its own pairing code locally — it never sends your session or login data to any third-party server. Never share your `session` folder with anyone; it contains your WhatsApp login credentials. Similarly, never commit `config.env` or real API keys to a public repository.

---

## 📞 Contact

Maintained by **Tasmee ul Hasnain**.
Repo: [github.com/Tasmee321/Tasmee-Ai-Bot](https://github.com/Tasmee321/Tasmee-Ai-Bot)

---

<div align="center">
  <sub>Built with ❤️, Node.js, and way too many late-night debugging sessions.</sub>
</div>
