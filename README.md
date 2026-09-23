# Calorie & TDEE Tracker API (`ctracker_api`)

A lightweight, self-hosted calorie and weight tracking API. It features an adherence-neutral dynamic Total Daily Energy Expenditure (TDEE) estimation engine based on scientific metabolic literature, decoupled Gemini AI frontend tool integration, and an offline-resilient outbox architecture. Managed modernly using `uv` and containerized with `Docker`.

---

## 🌟 Key Features

* **Adherence-Neutral Dynamic TDEE Engine**: Continuously updates your daily burn rate based on actual food intake vs scale weight trend using continuous time-decay Exponential Moving Average (EMA) smoothing (Holt 1957, Hall 2008).
* **Smart Data Gating & Noise Filtering**:
  * **Spiky Weight Dampening**: Low-pass filter strips out temporary water retention, salt, and gut content noise.
  * **Gap Resilience**: Time-decay factor ($\Delta t$) handles multi-day weight logging gaps gracefully.
  * **Density Rules**: Freezes expenditure updates if fewer than 5 food logging days exist in a rolling 14-day window.
  * **Fasted vs Unlogged Days**: Explicitly handles zero-calorie fasting days while ignoring unlogged days.
* **Offline Resilience & Idempotent API**:
  * Outbox queue pattern support for clients (PWA, mobile app, or bot gateway).
  * Unique `client_event_id` idempotency keys prevent duplicate calorie counting or weight entries during network retries across Cloudflare Tunnels.
* **Decoupled AI Assistant Frontend Integration**: Designed for Gemini Custom Gems & Chat Apps using OpenAPI specs with zero backend LLM API token costs.
* **Self-Hosted Privacy**: Full ownership of your data stored in SQLite (WAL Mode & FTS5 Search).

---

## 🏗️ System Architecture

```
   ┌────────────────────────────────────────────────────────┐
   │                  Gemini App / Telegram / PWA           │
   │   • Natural language meal parsing & UI confirmation    │
   │   • Weight entry & progress querying                   │
   │   • Offline outbox queue with retry mechanism          │
   └──────────────────────────┬─────────────────────────────┘
                              │ HTTPS / Cloudflare Tunnel (OpenAPI)
                              ▼
   ┌────────────────────────────────────────────────────────┐
   │             `ctracker_api` (FastAPI + SQLite)          │
   │                                                        │
   │  ├── Pure REST Routes (/v1/weight, /v1/food, /v1/auth, /v1/import) │
   │  ├── Idempotency Filter (processed_events)             │
   │  ├── TDEE Engine (Time-decay EMA & density gate)       │
   │  └── Food Catalog & Search (/v1/food/search)           │
   └──────────────────────────┬─────────────────────────────┘
                              │ Containerized via Docker / Compose
                              ▼
                         Dockerfile / docker-compose.yml
```

## 🤖 How the AI Assistant Integration Works

`ctracker_api` features a **built-in Telegram Bot (`bot/`)** co-located in `docker-compose.yml` that connects directly to Google's **Gemini 2.5 Flash Free Tier** ($0/month, 1,500 requests/day).

* **📱 Flagship Interface: Built-In Telegram Bot**:
  * **Text Logging**: *"Ate 3 scrambled eggs, sourdough toast, and coffee with cream"*
  * **📸 Food Photo Vision**: Snap a photo of your plate in Telegram $\rightarrow$ Gemini identifies items, searches your database catalog, calculates macros, and logs the meal.
  * **🎙️ Voice Notes**: Hold the mic button in Telegram and state your weight or meal.
  * **📊 Progress Summaries**: Type `/status` or *"How am I doing today?"*

* **⚡ Alternative OpenAPI Assistant Options**:
  * **OpenAI ChatGPT Custom GPTs** (ChatGPT Plus Action Builder)
  * **Self-hosted Frontends** (Open WebUI, LibreChat, Ollama plugins)

---

### 🚀 Quickstart: Enabling the Built-In Telegram Bot

1. **Create Bot Token**: Chat with `@BotFather` on Telegram and run `/newbot` to get your `TELEGRAM_BOT_TOKEN`.
2. **Get Free Gemini Key**: Grab a free API key at [Google AI Studio](https://aistudio.google.com/) (`GEMINI_API_KEY`).
3. **Provision API Key**:
   ```bash
   curl -X POST "http://localhost:8000/v1/admin/keys" \
     -H "X-Master-Key: dev_master_key_12345" \
     -H "Content-Type: application/json" \
     -d '{"username": "default_user", "key_name": "Telegram Bot"}'
   ```
4. **Configure & Launch**:
   Add your keys to `.env` and start the stack:
   ```bash
   docker compose up -d --build
   ```

For detailed guides and reference documentation:
* 🤖 **[bot/README.md](./bot/README.md)**: Full Telegram Bot setup, security whitelist, and photo logging guide.
* 📖 **[agent/OPENAPI_GUIDE.md](./agent/OPENAPI_GUIDE.md)**: ChatGPT Custom GPTs & Local LLM setup guide.
* 📜 **[agent/SYSTEM_PROMPT.md](./agent/SYSTEM_PROMPT.md)**: System instructions reference and dynamic bootstrap endpoint.
* 💬 **[agent/COMMAND_FLOWS.md](./agent/COMMAND_FLOWS.md)**: Example conversational command flows.

---

## 🛠️ Tech Stack

* **Package Manager**: `uv` (`pyproject.toml` + `uv.lock`)
* **Containerization**: Docker / Docker Compose (Multi-stage build)
* **Framework**: Python 3.13 / FastAPI
* **Database**: SQLite with SQLAlchemy (WAL Mode & FTS5 Search)
* **Data Validation**: Pydantic v2
* **TDEE & Trend Calculations**: Custom dynamic EMA engine

---

## 📑 Documentation & Research

* **[KNOWLEDGE.md](./KNOWLEDGE.md)**: Comprehensive technical breakdown of the TDEE algorithm, mathematical equations (Wishnofsky 1958, Mifflin-St Jeor 1990, Hall 2008, Holt 1957), benchmark results against ~1,000 days of historical tracking data, and edge-case rules.
* **[agent/SYSTEM_PROMPT.md](./agent/SYSTEM_PROMPT.md)**: System instructions and 3-line universal bootstrap prompt.
* **[agent/OPENAPI_GUIDE.md](./agent/OPENAPI_GUIDE.md)**: Cloudflare Tunnel, OpenAPI, Gemini Custom Gems, & ChatGPT setup guide.
* **[agent/COMMAND_FLOWS.md](./agent/COMMAND_FLOWS.md)**: Conversational command flows for meal logging, weight entries, and status updates.

---

## 🐳 Self-Hosting & Docker Setup

### Option A: Docker Compose (Proxmox / VPS Stack)

```bash
# 1. Copy environment variables file
cp .env.example .env

# 2. Start the stack in detached mode
docker compose up -d

# 3. View logs
docker compose logs -f
```

---

## 🚀 Local Development Setup

### 1. Environment & Dependency Sync (`uv`)
```bash
uv sync
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```env
DATABASE_URL=sqlite:///./ctracker.db
MASTER_API_KEY=dev_master_key_12345
DEFAULT_USER_DOB=1987-12-07
DEFAULT_USER_HEIGHT_CM=185
DEFAULT_USER_SEX=male
```

### 3. Run API Server
```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Visit API docs at `http://localhost:8000/docs`.

### 4. Run Tests
```bash
uv run pytest
```

---

## 📜 License
MIT License
