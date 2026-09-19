# Calorie & TDEE Tracker API (`ctracker_api`)

A lightweight, self-hosted calorie and weight tracking API inspired by data_export. It features an adherence-neutral dynamic Total Daily Energy Expenditure (TDEE) estimation engine, decoupled Gemini AI frontend tool integration, and an offline-resilient outbox architecture.

---

## 🌟 Key Features

* **Adherence-Neutral Dynamic TDEE Engine**: Continuously updates your daily burn rate based on actual food intake vs scale weight trend using continuous time-decay Exponential Moving Average (EMA) smoothing.
* **Smart Data Gating & Noise Filtering**:
  * **Spiky Weight Dampening**: Low-pass filter strips out temporary water retention, salt, and gut content noise.
  * **Gap Resilience**: Time-decay factor ($\Delta t$) handles multi-day weight logging gaps gracefully.
  * **Density Rules**: Freezes expenditure updates if fewer than 5 food logging days exist in a rolling 14-day window.
  * **Fasted vs Unlogged Days**: Explicitly handles zero-calorie fasting days while ignoring unlogged days.
* **Offline Resilience & Idempotent API**:
  * Outbox queue pattern support for clients (PWA, mobile app, or bot gateway).
  * Unique `client_event_id` idempotency keys prevent duplicate calorie counting or weight entries during network retries across Cloudflare Tunnels.
* **Decoupled AI Assistant Frontend Integration**: Designed for Gemini Custom Gems & Chat Apps using OpenAPI specs with zero backend LLM API token costs.
* **Self-Hosted Privacy**: Full ownership of your data stored in SQLite.

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
   │  ├── Pure REST Routes (/v1/weight, /v1/food, /v1/auth) │
   │  ├── Idempotency Filter (processed_events)             │
   │  ├── TDEE Engine (Time-decay EMA & density gate)       │
   │  └── Food Catalog & Search (/v1/food/search)           │
   └────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

* **Framework**: Python 3.10+ / FastAPI
* **Database**: SQLite with SQLAlchemy / SQLModel
* **Data Validation**: Pydantic v2
* **TDEE & Trend Calculations**: Custom dynamic EMA engine

---

## 📑 Documentation & Research

* **[KNOWLEDGE.md](./KNOWLEDGE.md)**: Comprehensive technical breakdown of the reverse-engineered TDEE algorithm, mathematical equations, benchmark results against 985 days of data_export export data, and edge-case rules.
* **[agent/SYSTEM_PROMPT.md](./agent/SYSTEM_PROMPT.md)**: System instructions for configuring your Gemini Custom Gem / ChatGPT Custom GPT.
* **[agent/OPENAPI_GUIDE.md](./agent/OPENAPI_GUIDE.md)**: Cloudflare Tunnel & OpenAPI tool connection guide.
* **[agent/COMMAND_FLOWS.md](./agent/COMMAND_FLOWS.md)**: Conversational command flows for meal logging, weight entries, and status updates.

---

## 🚀 Quickstart Development Setup

### 1. Clone & Environment Setup
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
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
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Visit API docs at `http://localhost:8000/docs`.

---

## 📜 License
MIT License
