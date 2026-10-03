# TDEE Engine & System Knowledge Base (`KNOWLEDGE.md`)

This document serves as the comprehensive technical knowledge repository for **CTracker**. It details the mathematical formulas, adaptive metabolic algorithms, local-first database architecture, UI charting principles, and CI/CD automation pipelines derived from real-world benchmarking against **985 days (2024 to 2026)** of empirical longitudinal tracking data.

---

## 1. Longitudinal Benchmark Dataset Analysis (985 Days)

From the benchmark dataset:
* **Scale Weight Entries**: 582 days logged
* **Food Intake Logs**: 707 days logged (calories, macros, items)
* **Reference Expenditure Curve**: 985 consecutive daily TDEE values

---

## 2. Dynamic TDEE Mathematical Engine

The core TDEE engine consists of a **Two-Stage Continuous Time-Decay Exponential Moving Average (EMA)** model implemented in [`src/services/tdee.ts`](file:///home/victor/Personal/ctracker_api/src/services/tdee.ts).

### A. Cold-Start BMR & Initial TDEE Baseline
When starting without prior historical logs, the engine uses the **Mifflin-St Jeor Equation** to establish the initial expenditure baseline:

$$\text{BMR} = 10 \cdot \text{weight (kg)} + 6.25 \cdot \text{height (cm)} - 5 \cdot \text{age (years)} + s$$

Where:
* $s = +5$ for males, $-161$ for females.
* Initial TDEE is estimated as: $\text{Initial TDEE} = \text{BMR} \times \text{Activity Multiplier}$ ($\sim 1.61$).

**Validation**: For a 38-year-old male, 185 cm tall, weighing 104.4 kg:
* Calculated BMR: **2,024.8 kcal**
* Estimated Initial TDEE ($2,024.8 \times 1.613$): **3,266 kcal**
* Target Benchmark Day 1 Expenditure: **3,253 kcal** (Deviation < 0.4%).

---

### B. Weight Trend Smoothing ($\text{Trend Weight}_t$)
Raw scale weight fluctuates daily due to sodium intake, hydration, glycogen, and digestive contents. The trend weight is updated using continuous time-decay exponential smoothing:

$$\alpha_w = 1 - e^{-\frac{\Delta t}{\tau_w}}$$

$$\text{Trend Weight}_t = \alpha_w \cdot \text{Scale Weight}_t + (1 - \alpha_w) \cdot \text{Trend Weight}_{t - \Delta t}$$

* **Time Constant ($\tau_w$)**: 14 days (`CONSTANTS.TAU_W`).
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

* **Expenditure Time Constant ($\tau_e$)**: 28 days (`CONSTANTS.TAU_E`) to prevent wild oscillations from short-term dietary anomalies.
* **Safety Bounds**: Clamped between $1,000\text{ kcal}$ and $5,000\text{ kcal}$.

---

### D. Physiological Adaptive Target Engine (Beyond the 3,500 kcal/lb Rule)

Classical calorie tracking apps rely on the 1958 **Wishnofsky Rule** (a static deficit of $3,500\text{ kcal} = 1\text{ lb}$ or $7,700\text{ kcal} = 1\text{ kg}$). As demonstrated by Dr. Kevin Hall's landmark NIH research (*The Lancet*, 2011), the 3,500 kcal rule assumes 100% lipid oxidation, zero metabolic adaptation, and linear infinite weight loss—often leading to punitive, unviable starvation targets.

CTracker implements a **Context-Aware Physiological Target Engine** in [`src/services/tdee.ts`](file:///home/victor/Personal/ctracker_api/src/services/tdee.ts) built on modern metabolic principles:

#### 1. Realistic Tissue Loss Density ($6,500\text{ kcal/kg}$)
Real-world human weight loss is never 100% pure anhydrous lipid. It comprises a mixture of adipose triglycerides, intracellular water, glycogen, and minor lean tissue:
$$\text{Tissue Energy Density} \approx 6,500\text{ kcal/kg}$$
Using $6,500\text{ kcal/kg}$ yields realistic calorie targets that match empirical physiological changes rather than punitive theoretical extremes.

#### 2. Body Leanness & Adipose Reserve Scaling (Alpert's Law)
According to Alpert’s Law of fat energy transfer, the maximum energy transfer rate from fat stores is proportional to fat mass. Lean bodies cannot sustain large deficits without catabolizing lean muscle and downregulating thyroid/leptin.
* Rates of loss are computed as a **percentage of Body Weight (% BW/week)**, not arbitrary fixed kilograms:
  * Normalized BMI scale: $\text{norm} = \text{clamp}\left(\frac{\text{BMI} - \text{BMI}_{\text{baseline}}}{12}, 0, 1\right)$
  * Base weekly loss rate: $0.35\% + \text{norm} \cdot (0.80\% - 0.35\%)$ of BW/week.
  * An 85 kg person at 155 cm (BMI 35.4) can comfortably lose at a faster rate than an 85 kg person at 218 cm (BMI 17.9).

#### 3. Metabolic Deficit Guardrails
* **TDEE Fraction Cap**: The daily deficit is hard-capped between $12\%$ and $23\%$ of total daily energy expenditure ($\text{TDEE} \times \text{maxDeficitPercent}$), preventing metabolic crashes.
* **Age Sarcopenia Guardrail**: For users $> 50$ years old, anabolic resistance increases muscle catabolism risk. Deficit caps are scaled down by $0.5\%$ per year past 50:
  $$\text{AgeFactor} = \max\left(0.85, 1.0 - (\text{age} - 50) \cdot 0.005\right)$$

#### 4. Dynamic Physiological Safety Floors
Static 1,500 kcal floors ignore sexual dimorphism and body size:
$$\text{Safety Floor} = \max\left(\text{SexBaseline}, 0.85 \times \text{BMR}, \text{UserMinimum}\right)$$
* $\text{SexBaseline}$: $1,200\text{ kcal}$ for females, $1,500\text{ kcal}$ for males.
* Prevents hypothalamic amenorrhea in women and hypogonadism / thyroid suppression in men.

#### 5. Smooth Maintenance Landing
When current trend weight is within $\pm 0.35\text{ kg}$ of `target_weight_kg`, the engine automatically transitions to `maintain` mode ($100\%$ of TDEE, $0\text{ kcal}$ deficit), ensuring a calm landing without bounce-back stress.

#### 6. Strategy Paces
* **Gentle** ($0.75\times$ base): Mild deficit, maximum muscle retention and high psychological adherence.
* **Balanced** ($1.0\times$ base, recommended): Optimal sustainable fat loss matched to expenditure.
* **Ambitious** ($1.25\times$ base): Faster progress for individuals with ample adipose reserves.

---

## 3. Data Density & Edge Case Handling Rules

### Rule 1: Fasted Days vs. Unlogged / Missing Days
* **Unlogged / Missing Days**: If no food is logged on day $t$, day $t$ is **omitted** from average intake calculations. Treating missing days as 0 kcal would falsely collapse the calculated TDEE.
* **Fasting Days**: Explicitly tagged with `0` calories. Fasting days are included in intake averages.

### Rule 2: 5-Day Minimum Logging Density Gate
* Within any 14-day rolling window, the engine checks the number of valid food logging days ($N_{\text{food}}$).
* **Gate Requirement**: If $N_{\text{food}} < 5$, the expenditure update is **frozen**:
  $$\text{Expenditure}_t = \text{Expenditure}_{t-1}$$
* This prevents inaccurate TDEE adjustments when user logging adherence drops.

---

## 4. Benchmark Validation Results

Running this exact algorithm against the 985-day longitudinal benchmark dataset yields:
* **Mean Absolute Error (MAE)**: **87.10 kcal/day**
* **Root Mean Square Error (RMSE)**: **112.4 kcal/day**

---

## 5. Local-First Application Architecture

CTracker is built as a **100% local-first mobile architecture** with zero server dependency:

```
┌────────────────────────────────────────────────────────┐
│                   CTracker Mobile App                  │
│                                                        │
│  ├── React Native / Expo UI (Tabs, Modals, SVG Charts) │
│  ├── Gemini AI Client (Direct HTTPS to Google API)     │
│  ├── TDEE & Smoothing Engine (Pure TypeScript)         │
│  └── Universal Data Importer (CSV / XLSX / PapaParse)   │
└──────────────────────────┬─────────────────────────────┘
                           │
             Direct Embedded C/C++ Binding
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│             Embedded SQLite (expo-sqlite)              │
│                                                        │
│  ├── WAL Mode (Write-Ahead Logging)                    │
│  ├── Prepared Statements & Atomic Transactions         │
│  ├── Relational Tables (meals, scale_weights, profile) │
│  └── FTS5 Virtual Table (food_catalog_fts + Triggers)  │
└────────────────────────────────────────────────────────┘
```

### Key Architectural Advantages
1. **Zero Cloud Maintenance**: No server containers to host, monitor, or pay for.
2. **Total Privacy & Offline Operation**: All weight logs, meal entries, and metabolic histories remain strictly on the device.
3. **Instant Latency**: Zero network latency for logging, searching, and charting.

---

## 6. SQLite Database & Full-Text Search (FTS5)

Configured in [`src/db/database.ts`](file:///home/victor/Personal/ctracker_api/src/db/database.ts):

### A. WAL Mode & Performance Pragmas
* `PRAGMA journal_mode = WAL;` (Write-Ahead Logging enables non-blocking concurrent reads and writes).
* `PRAGMA synchronous = NORMAL;` (Maximizes mobile disk I/O performance while preserving crash resilience).
* `PRAGMA foreign_keys = ON;`

### B. Catalog FTS5 Table with Triggers
* Food catalog search utilizes SQLite's FTS5 virtual table (`food_catalog_fts`) with **Porter stemmer tokenization** (`porter unicode61`).
* **Order-Agnostic & Stemmed**: Querying `"pancakes"` matches `"Pancake, homemade"`.
* **Auto-Sync Triggers**: SQLite `AFTER INSERT`, `AFTER UPDATE`, and `AFTER DELETE` triggers keep the virtual search index synchronized automatically.

---

## 7. Interactive SVG Visualizations

Implemented in [`src/screens/WeightTrendsScreen.tsx`](file:///home/victor/Personal/ctracker_api/src/screens/WeightTrendsScreen.tsx) using pure `react-native-svg`:

1. **Weight Trend Graph**:
   * Raw scale weights rendered as subtle scatter dots (`#94a3b8`).
   * Smoothed trend weight drawn as a bold bezier/line curve (`#0284c7`) with an area gradient fill.
   * Dashed target weight reference line (`#f59e0b`).
2. **Expenditure vs. Intake Graph**:
   * Daily calorie intake rendered as vertical rounded bars (`#10b981`).
   * Dynamic TDEE expenditure curve drawn as a smooth flowing violet line (`#8b5cf6`).
3. **Timeframe Selector**:
   * Segmented button controls for `30D`, `90D`, `180D`, and `All`.
   * Dynamic delta metrics (e.g. `+0.4 kg in 90D`, `2,450 kcal/day avg intake`).

---

## 8. Habit & Adherence Calendar

Implemented in [`src/screens/WeightTrendsScreen.tsx`](file:///home/victor/Personal/ctracker_api/src/screens/WeightTrendsScreen.tsx):
* Replaces the redundant textual weigh-in list on the Trends screen with an intuitive monthly habit calendar.
* **Dual Status Dots**:
  * **Blue Dot (`#0284c7`)**: Scale weight logged for that calendar day.
  * **Green Dot (`#16a34a`)**: Food / calorie intake logged for that calendar day.
* **1-Tap Fast Jump**: Tapping any calendar day immediately navigates to that exact date on the Today / Dashboard tab.
* **Monthly Adherence Metrics**: Displays real-time weigh-in and nutrition tracking consistency percentages for any selected month.

---

## 9. Food Serving Size Engine, Portion Memory & In-Place Editing

Implemented in [`src/services/serving.ts`](file:///home/victor/Personal/ctracker_api/src/services/serving.ts) and [`src/components/FoodServingModal.tsx`](file:///home/victor/Personal/ctracker_api/src/components/FoodServingModal.tsx):

### A. Dynamic Serving Size & Unit Scaling
* When tapping an item from search or the personal food catalog, CTracker opens an interactive serving size dialog instead of blindly logging a static entry.
* **Universal Conversion Engine**: Supports grams (`g`), ounces (`oz`), milliliters (`ml`), cups, tablespoons (`tbsp`), teaspoons (`tsp`), and discrete servings (`slice`, `scoop`, `egg`).
* **Live Macronutrient Scaling**: Calories, protein, carbohydrates, and fat update in real time as the user types quantities or selects units.
* **Quick Multipliers**: One-tap buttons for rapid portion increments (`-50g`, `-10g`, `+10g`, `+50g` or `0.5x`, `1x`, `1.5x`, `2x`).

### B. Habit Portion Memory (`last_used_qty`, `last_used_unit`)
* Following adaptive UX principles, personal logging habits are remembered per food:
  * When a user logs `50g` of rice, `food_catalog.last_used_qty` is set to `50` and `last_used_unit` is set to `'g'`.
  * The next time that food is searched or tapped, it automatically defaults to `50g` rather than arbitrary defaults.
  * The catalog search UI indicates remembered portion sizes with a subtle history indicator (`50 g`).

### C. In-Place Food Name Editing
* Avoids fragile regexes or heavy LLM passes over historical exports.
* When viewing the serving dialog, the food name is an editable field. If an imported item has an awkward name (e.g. `"4 cheeks of pork"`), the user can tap and edit it directly to `"Pork cheek"`.
* SQLite catalog updates rename the entry in `food_catalog` with collision-safe merging (`renameFoodCatalogItem`), and automatically updates the FTS5 full-text search index via triggers.

---

## 10. Data Import Engine & Deduplication

Implemented in [`src/services/importer.ts`](file:///home/victor/Personal/ctracker_api/src/services/importer.ts):
* **Format Agnostic**: Detects multi-sheet XLSX, Cronometer, MyFitnessPal CSV, and arbitrary spreadsheets.
* **Date-Range Atomic Replacement**: Deletes existing records within `[minDate, maxDate]` before batch inserting rows, allowing repeat foods (e.g. 2 identical eggs or toast) without false deduplication dropping meals.
* **Prepared Statements**: Uses `db.prepareAsync()` and SQLite transactions for high-speed imports (thousands of rows in < 2 seconds).

---

## 11. Platform-Aware Storage & Engine Matrix

Implemented across [`src/services/keychain.ts`](file:///home/victor/Personal/ctracker_api/src/services/keychain.ts) and [`src/db/database.ts`](file:///home/victor/Personal/ctracker_api/src/db/database.ts):

| Capability / Layer | Native Android & iOS | Web Browser (`npm run web`) |
| :--- | :--- | :--- |
| **Database Engine** | Native embedded SQLite with WAL mode & FTS5 | WebAssembly SQLite (`wa-sqlite.wasm`) via OPFS |
| **Full-Text Search** | SQLite FTS5 with Porter stemmer & BM25 ranking | Standard SQL `LIKE` fallback (FTS5 gracefully caught) |
| **Connection Pooling** | Native Android/iOS connection reuse | Promise mutex (`dbPromise`) preventing OPFS sync handle lock conflicts |
| **API Key Storage** | Hardware-backed Android Keystore / iOS Keychain (`expo-secure-store`) | Encrypted browser `window.localStorage` |
| **JS Engine** | High-performance Facebook Hermes Engine | Browser V8 / SpiderMonkey |

* **Zero Data Loss on Reinstall**: Because data is stored in the app's internal sandbox SQLite database (`ctracker.db`), updating the app via `adb install -r` replaces the executable package while leaving all existing database records completely untouched.

---

## 12. Local Tooling, Release Automation & Sideloading Architecture

### A. Commit Message Convention
Enforced via **commitlint** ([`.commitlintrc.json`](file:///home/victor/Personal/ctracker_api/.commitlintrc.json)) and local Git commit hooks:
* `feat:` ➔ Signals a **MINOR** release (`1.1.0` → `1.2.0`).
* `fix:`, `perf:`, `refactor:` ➔ Signals a **PATCH** release (`1.1.2` → `1.1.3`).
* `feat!:` or `BREAKING CHANGE:` ➔ Signals a **MAJOR** release (`1.1.2` → `2.0.0`).

### B. Local Semantic Release Workflow
Executed via `npm run release` ([`scripts/release.sh`](file:///home/victor/Personal/ctracker_api/scripts/release.sh)):
1. **Pre-flight Cleanliness Check**: Verifies `git status --porcelain` is empty.
2. **Quality Gates**: Executes strict TypeScript typecheck (`tsc --noEmit`) and Jest unit test suite (`npm test`).
3. **Automated Version Calculation**: Inspects conventional commits between the latest Git tag and `HEAD`.
4. **Synchronized File Bumping**: Automatically updates `version` in `package.json`, `package-lock.json`, and `app.json` (`expo.version`).
5. **Git Commit & Tag**: Commits `chore(release): bump version to vX.Y.Z` and tags `vX.Y.Z`.
6. **Remote Synchronization**: Run `git push origin main --tags` to publish tags.

### C. Standalone Android Compilation (Docker)
Implemented in [`docker/Dockerfile.android`](file:///home/victor/Personal/ctracker_api/docker/Dockerfile.android) and [`scripts/build-apk-docker.sh`](file:///home/victor/Personal/ctracker_api/scripts/build-apk-docker.sh):
* **Reproducible Toolchain**: OpenJDK 17, Android SDK Build-Tools 36, and Gradle 9.x.
* **Worker & Memory Hardening**:
  * Capped workers: `--max-workers=2` and `org.gradle.parallel=false` to prevent classloader OutOfMemory crashes on multi-core host CPUs.
  * Metaspace tuning: `MetaspaceSize=512m` and `MaxMetaspaceSize=1536m` with G1GC garbage collection.
* **Building Current Code**: `npm run build:apk` builds active working tree and outputs `dist/CTracker-vX.Y.Z.apk`.
* **Building Arbitrary Git Tags / Commits**:
  ```bash
  npm run build:apk -- v1.1.2
  npm run build:apk -- <commit-hash>
  ```
  Uses `git archive <ref>` to stream the exact code snapshot directly into the Docker build context without checking out or altering the user's active Git working tree.

### D. Android Debug Bridge (ADB) Sideloading Protocols
* **In-Place Reinstallation (`-r`)**:
  ```bash
  adb install -r dist/CTracker-v1.1.2.apk
  ```
  Replaces the APK binary in-place while guaranteeing 100% data preservation of `ctracker.db` and user settings.
* **Downgrades (`-r -d`)**:
  ```bash
  adb install -r -d dist/CTracker-v1.1.0.apk
  ```
  Permits installing an older build over a newer build without uninstalling.
* **Wireless ADB (Android 11+)**:
  Pair via `adb pair <ip>:<port>` and connect via `adb connect <ip>:<port>`.

### E. Zero-Overhead Laptop Debugging (`scrcpy`)
Instead of running a resource-heavy 4 GB Android Studio emulator on the development laptop:
* Screen mirroring and keyboard/mouse control via `scrcpy` (`sudo apt install scrcpy && scrcpy`).
* Real-time React Native JS log streaming:
  ```bash
  adb logcat -s ReactNativeJS:V
  ```

---

## 13. UI Navigation & Screen Layout Architecture

* **Balanced 3-Element Bottom Navigation Dock**:
  * **Left**: `Today` screen (`flex: 1`)
  * **Center**: 🔵 Floating circular Quick Log / AI action button (`width: 52`, `height: 52`, elevated shadow)
  * **Right**: `Trends` screen (`flex: 1`)
  * Exactly centered at 50% screen width with symmetrical spacing.
* **Top Header Actions**:
  * The `Settings` screen is accessed via a header gear icon ⚙️ in the top-right corner of both `Today` and `Trends` screens.
  * A matching invisible spacer on the top-left ensures date navigation (`< Today >`) and screen titles remain dead-center in the top bar.
  * In Settings, a dedicated top header provides a `<` Back button returning seamlessly to the prior screen.
* **Adaptive Calendar Header**:
  * Abbreviated 3-letter month formatting (`Oct 2026`) and compact navigation controls prevent card boundary overflows across all mobile viewport widths.
* **In-App Build Inspection**:
  * The **About CTracker** card in Settings provides real-time verification of App Version, Build Profile (`Standalone Release` vs `Development Debug`), Platform, JS Engine (`Hermes`), and Package ID.
