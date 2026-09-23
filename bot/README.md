# 🤖 Built-In Telegram Bot Integration (`bot/`)

`ctracker` includes a built-in Telegram Bot powered by Google's **Gemini 3.6 Flash** (Free Tier). It runs co-located alongside your API container in `docker-compose.yml` with **zero hosting costs**.

---

### ✨ Features
* 💬 **Natural Text Meal Logging**: Type e.g., *"Ate 3 scrambled eggs, sourdough toast, and coffee with cream"*.
* 📸 **Food Photo Vision**: Take a picture of your plate in Telegram $\rightarrow$ Gemini identifies the food items, searches your database catalog, calculates macros, and logs the meal!
* 🎙️ **Voice Notes**: Send a voice note in Telegram detailing your meal or weight.
* ⚖️ **Scale Weight Logging**: Type *"Weighed 84.2 kg today"*.
* 📁 **Smart Data File Import**: Send `.json`, `.json.gz`, or CSV dumps from third-party apps (MyFitnessPal, LoseIt, Apple Health). Gemini parses column structures, asks for clarification if needed, and imports records into `ctracker`.
* 📊 **Dashboard Updates**: Type `/status` or *"How am I doing today?"* to get your remaining calorie budget, protein target, and updated trend weight.
* 🔒 **User Security Whitelist**: Restrict bot access to your Telegram User ID using `ALLOWED_TELEGRAM_USER_IDS`.

---

### 🚀 3-Minute Quickstart

#### 1. Create a Telegram Bot
1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the prompts to choose a name and username for your bot.
3. Copy the HTTP API token provided by BotFather (e.g. `7890123456:AA...`).

#### 2. Get a Free Gemini API Key
1. Visit [Google AI Studio](https://aistudio.google.com/).
2. Click **Get API key** $\rightarrow$ **Create API key**.
3. Copy your key (starts with `AIzaSy...`).

#### 3. Find Your Telegram User ID (Security)
1. Open Telegram and search for `@userinfobot`.
2. Send any message. It will reply with your numeric `Id` (e.g. `12345678`).

#### 4. Generate a Shared API Key
Generate a secure API key for your installation:
```bash
echo "ctk_live_$(openssl rand -hex 16)"
```

#### 5. Configure `.env` and Deploy
Add your keys to `.env`:
```env
TELEGRAM_BOT_TOKEN=7890123456:AA...
GEMINI_API_KEY=AIzaSy...
CTRACKER_API_KEY=ctk_live_4f8a9b2c3d1e5f6a7b8c9d0e1f2a3b4c
ALLOWED_TELEGRAM_USER_IDS=12345678
```

Start the stack:
```bash
docker compose up -d --build
```
*(On first startup, `ctracker-api` automatically seeds the database with `CTRACKER_API_KEY`, enabling `ctracker-bot` to connect out-of-the-box with zero extra configuration!)*

Your Telegram bot is now live! Open Telegram, search for your bot username, click `/start`, and enjoy zero-cost meal tracking on your phone!
