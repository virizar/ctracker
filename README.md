# Calorie & TDEE Tracker API (`ctracker_api`)

A lightweight, self-hosted calorie and weight tracking API. It features an adherence-neutral dynamic Total Daily Energy Expenditure (TDEE) estimation engine based on scientific metabolic literature, a built-in zero-cost Telegram AI Bot powered by Gemini 2.5 Flash, and an offline-resilient outbox architecture. Managed modernly using `uv` and containerized with `Docker`.

---

## 🌟 Key Features

* **Adherence-Neutral Dynamic TDEE Engine**: Continuously updates your daily burn rate based on actual food intake vs scale weight trend using continuous time-decay Exponential Moving Average (EMA) smoothing (Holt 1957, Hall 2008).
* **Smart Data Gating & Noise Filtering**:
  * **Spiky Weight Dampening**: Low-pass filter strips out temporary water retention, salt, and gut content noise.
  * **Gap Resilience**: Time-decay factor ($\Delta t$) handles multi-day weight logging gaps gracefully.
  * **Density Rules**: Freezes expenditure updates if fewer than 5 food logging days exist in a rolling 14-day window.
  * **Fasted vs Unlogged Days**: Explicitly handles zero-calorie fasting days while ignoring unlogged days.
* **Built-in Zero-Cost Telegram AI Bot (`bot/`)**:
  * Powered by Google's **Gemini 2.5 Flash Free Tier** ($0/month, 1,500 requests/day).
  * **📸 Food Photo Vision**: Take a picture of your plate in Telegram to identify items, search catalog, and calculate macros.
  * **🎙️ Voice & Text Input**: State food intake or daily scale weight via voice notes or text.
  * **📊 Instant Progress Reports**: `/status` queries daily calorie budget, protein targets, and updated trend weight.
* **Offline Resilience & Idempotent API**:
  * Outbox queue pattern support for clients (PWA, mobile app, or bot gateway).
  * Unique `client_event_id` idempotency keys prevent duplicate calorie counting or weight entries during network retries.
* **Self-Hosted Privacy**: Full ownership of your data stored in SQLite (WAL Mode & FTS5 Search).

---

## 🏗️ System Architecture

```
   ┌────────────────────────────────────────────────────────┐
   │              Telegram Mobile App / PWA                 │
   │   • Voice, food photo vision, & text meal logging      │
   │   • Weight entry & progress querying                   │
   └──────────────────────────┬─────────────────────────────┘
                              │ Telegram API / Webhooks
                              ▼
   ┌────────────────────────────────────────────────────────┐
   │          `ctracker-bot` (Telegram + Gemini 2.5)        │
   │   • Co-located container running in Docker Compose     │
   │   • Gemini multimodal vision & native function calling │
   └──────────────────────────┬─────────────────────────────┘
                              │ HTTP (Internal Docker Network)
                              ▼
   ┌────────────────────────────────────────────────────────┐
   │             `ctracker-api` (FastAPI + SQLite)          │
   │                                                        │
   │  ├── Pure REST Routes (/v1/weight, /v1/food, /v1/auth)  │
   │  ├── Idempotency Filter (processed_events)             │
   │  ├── TDEE Engine (Time-decay EMA & density gate)       │
   │  └── Food Catalog & Search (/v1/food/search)           │
   └────────────────────────────────────────────────────────┘
```

---

## 🤖 Built-In AI Telegram Bot Setup

`ctracker_api` includes a **co-located Telegram Bot (`bot/`)** in `docker-compose.yml`.

### 🚀 Quickstart

1. **Create Telegram Bot**: Chat with `@BotFather` on Telegram, run `/newbot`, and copy your `TELEGRAM_BOT_TOKEN`.
2. **Get Free Gemini API Key**: Grab a free API key at [Google AI Studio](https://aistudio.google.com/) (`GEMINI_API_KEY`).
3. **Provision API Key**:
   ```bash
   curl -X POST "http://localhost:8000/v1/admin/keys" \
     -H "X-Master-Key: dev_master_key_12345" \
     -H "Content-Type: application/json" \
     -d '{"username": "default_user", "key_name": "Telegram Bot"}'
   ```
4. **Configure & Launch Stack**:
   Add your keys to `.env` and start the stack:
   ```bash
   docker compose up -d --build
   ```

For detailed bot configuration, security whitelist options, and photo logging, see [bot/README.md](./bot/README.md).

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
* **[bot/README.md](./bot/README.md)**: Telegram Bot setup guide, voice note processing, multimodal food photo logging, and security settings.

---

## 🐳 Self-Hosting & Docker Setup

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
