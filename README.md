# CTracker 🍏

A local-first, privacy-first mobile calorie and weight tracker built with **Expo (React Native)** and **TypeScript**. 

CTracker runs 100% locally on your phone using an embedded SQLite database (`expo-sqlite`). It features an adherence-neutral dynamic Total Daily Energy Expenditure (TDEE) estimation algorithm inspired by metabolic literature, continuous exponential trend smoothing, interactive SVG charts, direct Gemini AI food parsing, and high-speed CSV/Excel imports.

---

## 🌟 Key Features

* **📱 100% Local-First & Private**:
  * All weight records, meals, and expenditure calculations are stored directly on your device in embedded SQLite with WAL mode and Full-Text Search (FTS5).
  * No remote backend server or subscription required. Works completely offline.

* **📈 Dynamic TDEE & Weight Trend Engine**:
  * **Exponential Moving Average (EMA)**: Strips out water retention, sodium fluctuations, and digestive noise from scale weight.
  * **Adherence-Neutral Metabolic Burn Rate**: Automatically adapts your daily expenditure based on logged intake vs. weight trend.
  * **Gap Resilience**: Gracefully handles missed days or vacations with time-decay factors ($\Delta t$).

* **📊 Interactive Metabolic & Trend Charts**:
  * **Weight Trend**: Scale weight dots, smooth trend line, under-curve gradient, and dashed goal reference line.
  * **Expenditure vs. Intake**: Daily calorie intake columns alongside a continuous flowing TDEE curve.
  * **Timeframe Filters**: View periods across `30D`, `90D`, `180D`, and `All`.

* **✨ Instant AI Meal Logging**:
  * Powered by Google's **Gemini 2.5 Flash Free Tier** via direct client-side requests using your personal Gemini API key.
  * Speak or type natural language: *"Had 2 scrambled eggs, slice of sourdough toast with butter, and a flat white"*.
  * Automatically parses foods, quantities, calories, and macronutrients.

* **📥 Data Import & Migration**:
  * Full-fidelity import support for multi-sheet fitness exports, MyFitnessPal, Cronometer, and custom CSV/Excel spreadsheets.
  * Auto-detects column schemas and calculates retroactive daily expenditure.

---

## 🚀 Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (v20 or newer)
* [Expo Go](https://expo.dev/go) app installed on your Android device (or Google Chrome for web mode)

### Running for Development

#### Option A: Run on Physical Phone via Expo Go
```bash
npm start
```
Scan the QR code shown in your terminal using the Expo Go app. Hot-reloads instantly upon file save.

#### Option B: Run in Web Browser
```bash
npm run web
```
Opens http://localhost:8081 in Google Chrome with standard Chrome DevTools (Console, Inspect Element, Network). Uses WebAssembly SQLite (`wa-sqlite.wasm`) and `localStorage` for offline web debugging.

---

## 🖥️ Laptop Debugging & Device Control (`scrcpy`)

To debug your phone directly from your laptop without consuming laptop CPU/RAM with a heavy emulator:

1. **Install and run `scrcpy`** (low-latency screen mirroring):
   ```bash
   sudo apt install scrcpy
   scrcpy
   ```
   Controls your phone with your laptop's mouse and keyboard in real time.

2. **Stream Live App Logs**:
   ```bash
   adb logcat -s ReactNativeJS:V
   ```
   Filter for errors only:
   ```bash
   adb logcat "*:E" | grep -i ctracker
   ```

---

## 🏷️ Release & Versioning Workflow

CTracker uses Semantic Versioning driven by Conventional Commits (`feat:` for minor, `fix:` for patch, `BREAKING CHANGE:` for major).

### Creating a New Release
```bash
npm run release          # Auto-detects bump (patch, minor, or major) from git log
npm run release minor    # Or specify bump explicitly: patch, minor, or major
```

**What this does automatically**:
1. Checks that your working tree has no uncommitted changes.
2. Executes strict typecheck (`tsc --noEmit`) and all unit tests (`jest`).
3. Computes the next version number based on commits since the previous tag.
4. Bumps `version` in `package.json`, `package-lock.json`, and `app.json` (`expo.version`).
5. Commits `chore(release): bump version to vX.Y.Z` and creates Git tag `vX.Y.Z`.
6. Prompts you to push tags:
   ```bash
   git push origin main --tags
   ```

---

## 📲 Building Standalone Android APKs (Local Docker)

CTracker compiles standalone Android release APKs locally inside a clean Docker container using OpenJDK 17 and Android Gradle. No cloud accounts, EAS tokens, or local Android SDK installs are required.

### 1. Build Current Code (`HEAD`)
```bash
npm run build:apk
```
Builds your active workspace and saves the installer to:
* `dist/CTracker-v1.1.2.apk`
* `dist/CTracker.apk` (convenience link)

### 2. Build a Specific Release Tag or Commit
You can compile any previous git tag or commit hash without disrupting or checking out your active working tree:
```bash
npm run build:apk -- v1.1.2
# or specify a commit hash:
npm run build:apk -- a1b2c3d
```
The script uses `git archive` to stream that exact code snapshot into the isolated Docker builder and saves `dist/CTracker-v1.1.2.apk`.

---

## 🔌 Installing & Updating on Phone via ADB

### In-Place Reinstall & Updates (Data Preserved)
When installing an updated build over an existing installation, use the **`-r`** (reinstall) flag:
```bash
adb install -r dist/CTracker-v1.1.2.apk
```
* **Preserves all app data**: Your local SQLite database (`ctracker.db`), logged foods, weigh-ins, and Gemini API keys are **not** touched or erased.
* Takes 2–3 seconds and completes silently.

### Testing Older Versions (Downgrade)
If testing an older version than what is currently installed on the device, add **`-d`**:
```bash
adb install -r -d dist/CTracker-v1.1.0.apk
```

### Wireless ADB (Android 11+)
To install without a USB cable over the same Wi-Fi network:
1. Phone: **Developer Options > Wireless debugging > Pair device with pairing code**.
2. Laptop:
   ```bash
   adb pair <ip-address>:<pairing-port>
   adb connect <ip-address>:<main-port>
   adb install -r dist/CTracker-v1.1.2.apk
   ```

---

## ℹ️ In-App Version & Build Inspection

You can verify the currently running build on any device at any time:
1. Open the app and tap the gear icon ⚙️ in the top-right header on the **Today** or **Trends** screen.
2. Scroll to the bottom **About CTracker** card:
   * **App Version** (e.g. `v1.1.2`)
   * **Build Profile** (`Standalone (Release)` vs `Development (Debug)`)
   * **Platform** (`Android (Native)`, `iOS (Native)`, or `Web (Browser)`)
   * **Runtime Engine** (`Hermes Engine` vs `JavaScriptCore`)
   * **Package ID** (`com.victor.ctracker`)
   * **Active AI Model** (`gemini-2.5-flash`)

---

## 🛠️ Verification & Quality Gates

* **Typecheck**: `npm run typecheck` or `npx tsc --noEmit`
* **Unit Tests**: `npm test`
* **Test Coverage**: `npm run test:coverage`
* **Dependency Health**: `npx expo-doctor`
