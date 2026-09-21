# TDEE Engine & System Knowledge Base (`KNOWLEDGE.md`)

This document serves as the open knowledge repository for `ctracker_api`. It details the reverse-engineering methodology, mathematical equations, algorithm parameters, and edge-case behaviors derived from benchmarking against **985 days (2024 to 2026)** of real-world data_export export data.

---

## 1. data_export Reverse-Engineering Findings

### Dataset Analysis (985 Days)
From the exported data_export dataset (`drive-download-20260917T151205Z-1-001.zip`):
* **Scale Weight Entries**: 582 days logged
* **Food Intake Logs**: 707 days logged (calories, macros, micronutrients)
* **data_export Expenditure Curve**: 985 consecutive daily TDEE values

---

## 2. Dynamic TDEE Mathematical Engine

The core TDEE engine consists of a **Two-Stage Continuous Time-Decay Exponential Moving Average (EMA)** model.

### A. Cold-Start BMR & Initial TDEE Baseline
When starting without prior historical logs, the engine uses the **Mifflin-St Jeor Equation** to establish the initial expenditure baseline:

$$\text{BMR} = 10 \cdot \text{weight (kg)} + 6.25 \cdot \text{height (cm)} - 5 \cdot \text{age (years)} + s$$

Where:
* $s = +5$ for males, $-161$ for females.
* Initial TDEE is estimated as: $\text{Initial TDEE} = \text{BMR} \times \text{Activity Multiplier}$ ($\sim 1.61$).

**Validation**: For a 38-year-old male, 185 cm tall, weighing 104.4 kg:
* Calculated BMR: **2,024.8 kcal**
* Estimated Initial TDEE ($2,024.8 \times 1.613$): **3,266 kcal**
* data_export Actual Day 1 Expenditure: **3,253 kcal** (Deviation < 0.4%).

---

### B. Weight Trend Smoothing ($\text{Trend Weight}_t$)
Raw scale weight fluctuates daily due to sodium intake, hydration, glycogen, and gut volume. The trend weight is updated using continuous time-decay exponential smoothing:

$$\alpha_w = 1 - e^{-\frac{\Delta t}{\tau_w}}$$

$$\text{Trend Weight}_t = \alpha_w \cdot \text{Scale Weight}_t + (1 - \alpha_w) \cdot \text{Trend Weight}_{t - \Delta t}$$

* **Time Constant ($\tau_w$)**: 14 days.
* **Gap Handling ($\Delta t$)**: Measures the actual number of days elapsed since the last scale entry. If 5 days are missed, $\Delta t = 5$, automatically scaling $\alpha_w$ gracefully without creating artificial sharp steps.

---

### C. Energy Balance & Daily Expenditure ($\text{TDEE}_t$)
Over a rolling window $k = 14$ days:

1. **Weight Change Rate**:
   $$\Delta W_k = \text{Trend Weight}_t - \text{Trend Weight}_{t - k}$$

2. **Daily Caloric Imbalance**:
   $$\text{Energy Delta}_k = \frac{\Delta W_k \times 7,700\text{ kcal/kg}}{k}$$
   *(Assuming $1\text{ kg of fat tissue} \approx 7,700\text{ kcal}$)*.

3. **Unsmoothed Raw TDEE**:
   $$\text{Raw TDEE}_t = \text{Average Daily Calorie Intake}_k - \text{Energy Delta}_k$$

4. **Expenditure Trend Smoothing**:
   $$\alpha_e = 1 - e^{-\frac{1}{\tau_e}}$$

   $$\text{Expenditure}_t = \alpha_e \cdot \text{Raw TDEE}_t + (1 - \alpha_e) \cdot \text{Expenditure}_{t-1}$$

* **Expenditure Time Constant ($\tau_e$)**: 28 days (dampens rapid wild swings in burn estimation).

---

## 3. Data Density & Edge Case Handling Rules

### Rule 1: Fasted Days vs. Unlogged / Missing Days
* **Unlogged / Missing Days**: If no food is logged on day $t$, day $t$ is **omitted** from average intake calculations. Treating missing days as 0 kcal would falsely collapse the calculated TDEE.
* **Fasting Days**: Explicitly tagged as `is_fasted = True` with `0` calories. Fasting days are included in intake averages.

### Rule 2: 5-Day Minimum Logging Density Gate
* Within any 14-day rolling window, the engine checks the number of valid food logging days ($N_{\text{food}}$).
* **Gate Requirement**: If $N_{\text{food}} < 5$, the expenditure update is **frozen**:
  $$\text{Expenditure}_t = \text{Expenditure}_{t-1}$$
* This prevents inaccurate TDEE adjustments when user logging adherence drops.

---

## 4. Benchmark Validation Results

Running this exact algorithm against the 985-day data_export export yields:
* **Mean Absolute Error (MAE)**: **87.10 kcal/day**
* **Root Mean Square Error (RMSE)**: **112.4 kcal/day**

---

## 5. Offline Resilience & API Idempotency Architecture

To safely allow clients (mobile app, web PWA, Telegram bot) to retry failed network calls through Cloudflare Tunnels:

```
┌────────────────────────────────────────────────────────┐
│                   Client Outbox Queue                  │
│                                                        │
│  User Action ──► Generate `client_event_id` (UUIDv4)   │
│              ──► Save to Local Storage (PENDING)       │
└──────────────────────────┬─────────────────────────────┘
                           │
             HTTP POST with `client_event_id`
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│                  FastAPI Backend Server                │
│                                                        │
│   1. SELECT FROM processed_events WHERE id = :event_id │
│   2. IF EXISTS: Return cached 200 OK (Do nothing)     │
│   3. IF NEW: Run DB insert/upsert + update TDEE       │
│      INSERT INTO processed_events (id, processed_at)   │
│      Return 200 OK                                     │
└────────────────────────────────────────────────────────┘
```

### Key Outbox Principles
1. **Client Event IDs**: All mutations (logging a meal, updating scale weight) must include a unique `client_event_id`.
2. **Upsert Semantics**: Scale weight logs for the same date overwrite the previous raw weight entry for that date rather than appending duplicate rows.
3. **Double-Count Protection**: Resent requests dropped by network timeouts are safely ignored if the server already processed their `client_event_id`.

---

## 6. API Endpoint Specification (`/v1`)

### 🔐 Authentication & Administration
* `GET /v1/auth/me` — Retrieve profile settings, BMR, baseline activity, and target parameters for the authenticated user.
* `PATCH /v1/auth/me` — Update profile settings (height, DOB, sex, target loss/gain rate, macro ratios).
* `POST /v1/admin/keys` — Provision new user API key *(Requires `X-Master-Key`)*.
* `GET /v1/admin/keys` — List all provisioned API keys *(Requires `X-Master-Key`)*.
* `DELETE /v1/admin/keys/{key_id}` — Revoke API key *(Requires `X-Master-Key`)*.

### 🥗 Food & Meal Logging
* `POST /v1/food/meals` — Log single OR batch meal items array *(Supports `canonical_name` auto-linking & `client_event_id`)*.
* `GET /v1/food/search?q=query` — Search standardized food catalog by usage frequency.
* `POST /v1/food/interpret` — Raw text/voice input $\rightarrow$ Gemini NLP parsing $\rightarrow$ Macro calculation $\rightarrow$ Log meal events.
* `GET /v1/food/meals?date=YYYY-MM-DD` — List meals logged on a given date.
* `DELETE /v1/food/meals/{meal_id}` — Delete a meal.

### ⚖️ Scale Weight Tracking
* `POST /v1/weight` — Log or upsert daily scale weight *(Requires `client_event_id`)*.
* `GET /v1/weight?start_date=...&end_date=...` — Retrieve weight history & trend values.
* `DELETE /v1/weight/{date}` — Remove scale weight log for a given date.

### 📊 Dashboard & Analytics
* `GET /v1/dashboard/summary?date=YYYY-MM-DD` — Daily summary (Total calories, macros breakdown, current Trend Weight, live TDEE, target calorie budget, dual goal projections, safety floor capping status).
* `GET /v1/dashboard/trends?days=30` — Historical trend array for charts (`date`, `raw_weight`, `trend_weight`, `logged_calories`, `tdee`).

### 📦 Data Migration & Import
* `POST /v1/import/file` — Single-purpose bulk migration endpoint. Accepts `.json` or `.json.gz` file payload containing `weights` and `meals` arrays, auto-populates food catalog, and triggers a single-pass TDEE recalculation pass.

---

## 7. Goal Projections, Safety Floor & Configuration Architecture

### A. Target Weight & Calorie Budget Calculation
The daily target calorie budget is computed from the monthly goal rate (`target_monthly_rate_kg`):

$$\text{Daily Deficit} = \frac{\text{target\_monthly\_rate\_kg} \times 7,700\text{ kcal/kg}}{30.4375\text{ days/month}}$$

$$\text{Raw Calorie Target} = \text{TDEE}_t + \text{Daily Deficit}$$

$$\text{Target Calories}_t = \max(\text{Raw Calorie Target}, \text{min\_daily\_calories})$$

* **Safety Floor (`min_daily_calories`)**: Default floor of `1500.0 kcal/day`.
* **Safety Flag (`is_rate_capped_by_safety_floor`)**: Evaluates to `True` whenever $\text{Raw Calorie Target} < \text{min\_daily\_calories}$.

---

### B. Dual Goal Projections (Target Rate vs Actual 30d Observed Pace)

1. **Target Rate Projection**:
   $$\text{Remaining Weight} = |\text{Current Trend Weight} - \text{Target Weight}|$$
   $$\text{Days to Goal (Target)} = \frac{\text{Remaining Weight}}{|\text{target\_monthly\_rate\_kg}| / 30.4375}$$
   $$\text{Projected Date (Target)} = \text{Current Date} + \text{Days to Goal (Target)}$$

2. **Actual Observed Trend Pace (30-Day Window)**:
   $$\text{Actual Monthly Loss Rate (30d)} = \left( \frac{\text{Trend Weight}_{t-30} - \text{Trend Weight}_t}{30} \right) \times 30.4375$$
   $$\text{Days to Goal (Actual)} = \frac{\text{Remaining Weight}}{\text{Actual Daily Loss Rate}}$$
   $$\text{Projected Date (Actual)} = \text{Current Date} + \text{Days to Goal (Actual)}$$

---

### C. Centralized Engine Constants & Configuration (`app/config.py`)

All algorithm constants and defaults are centralized:
* `TAU_W = 14.0` (Scale weight continuous smoothing time constant)
* `TAU_E = 28.0` (Expenditure continuous smoothing time constant)
* `WINDOW_DAYS = 14` (Rolling calculation window)
* `MIN_FOOD_LOGGED_DAYS = 5` (Data density gate)
* `FAT_KCAL_PER_KG = 7700.0` (Energy equivalent of 1 kg body mass change)
* `DAYS_PER_MONTH = 30.4375` (Average days per month)
* `DEFAULT_MIN_DAILY_CALORIES = 1500.0` (Safety floor default)

---

## 8. SQLite WAL Mode & FTS5 Search Architecture

### A. WAL Mode (Write-Ahead Logging)
To prevent `database is locked` errors during concurrent API reads and writes across Cloudflare Tunnels:
* Connection initialization executes:
  `PRAGMA journal_mode=WAL;`
  `PRAGMA synchronous=NORMAL;`
* **Benefits**: Non-blocking concurrent reads while background writes/TDEE calculations occur.

---

### B. SQLite FTS5 Full-Text Search Table & Auto-Sync Triggers
Catalog search utilizes an FTS5 virtual table (`food_catalog_fts`) with **Porter stemmer tokenization** (`porter unicode61`):

* **Capabilities**:
  * **Stemming**: Querying `"pancakes"` (plural) matches `"Pancake, homemade"`.
  * **Order-Agnostic**: Querying `"homemade pancake"` matches `"Pancake, homemade"`.
  * **Relevance & Frequency Ranking**: Results are ranked by **BM25 score** combined with `usage_count` frequency.
* **Auto-Sync Triggers**: SQLite `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` triggers keep `food_catalog_fts` synchronized automatically.
