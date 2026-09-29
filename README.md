# CTracker 🍏

A local-first, privacy-first mobile calorie and weight tracker built with **Expo (React Native)** and **TypeScript**. 

CTracker runs 100% locally on your phone using an embedded SQLite database (`expo-sqlite`). It features an adherence-neutral dynamic Total Daily Energy Expenditure (TDEE) estimation algorithm inspired by metabolic literature, adaptive trend smoothing, interactive SVG charts, direct Gemini AI food parsing, and high-speed CSV/Excel imports.

---

## 🌟 Key Features

* **📱 100% Local-First & Private**:
  * All weight records, meals, and expenditure calculations are stored directly on your device in embedded SQLite with WAL mode and Full-Text Search (FTS5).
  * No remote backend server or subscription required. Works completely offline.

* **📈 Dynamic TDEE & Weight Trend Engine**:
  * **Exponential Moving Average (EMA)**: Strips out water retention, sodium fluctuations, and digestive noise from scale weight.
  * **Adherence-Neutral Metabolic Burn Rate**: Automatically adapts your daily expenditure based on logged intake vs. weight trend.
  * **Gap Resilience**: Gracefully handles missed days or vacations with time-decay factors ($\Delta t$).

* **📊 adaptive Charts**:
  * **Weight Trend**: Scale weight dots, smooth trend line, under-curve gradient, and dashed goal reference line.
  * **Expenditure vs. Intake**: Daily calorie intake columns alongside a continuous flowing TDEE curve.
  * **Timeframe Filters**: View periods across `30D`, `90D`, `180D`, and `All`.

* **✨ Instant AI Meal Logging**:
  * Powered by Google's **Gemini 2.5 Flash Free Tier** via direct client-side requests using your personal Gemini API key.
  * Speak or type natural language: *"Had 2 scrambled eggs, slice of sourdough toast with butter, and a flat white"*.
  * Automatically parses foods, quantities, calories, and macronutrients.

* **📥 Data Import & Migration**:
  * Full-fidelity import support for FitnessLog, MyFitnessPal, and custom CSV/Excel spreadsheets.
  * Auto-detects column schemas and calculates retroactive daily expenditure.

---

## 🚀 Getting Started

### Prerequisites
* [Node.js](https://nodejs.org/) (v20 or newer)
* [Expo Go](https://expo.dev/go) app installed on your Android or iOS device

### Running Locally

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the development server**:
   ```bash
   npm start
   ```

3. **Open on your device**:
   * Scan the QR code shown in your terminal using **Expo Go** (Android) or the Camera app (iOS).
   * Ensure your phone and computer are on the same Wi-Fi network.

---

## 📲 Building a Standalone Android App (APK)

CTracker is pre-configured with **EAS (Expo Application Services)** to compile direct `.apk` files for your Android phone without needing Android Studio.

### 1. Log in to Expo
```bash
npx eas-cli login
```

### 2. Build the APK
```bash
npx eas-cli build -p android --profile preview
```
* EAS will ask to generate and securely store your Android keystore in the cloud. Select **Yes**.
* When compilation finishes (~5–8 min), scan the terminal QR code or visit the download link on your phone to install `CTracker.apk`.

---

## 🔄 Over-The-Air (OTA) Updates

Once CTracker is installed on your phone, you don't need to rebuild the APK when modifying screens, styles, or algorithms:

```bash
npx eas update --auto
```
The app will automatically download and apply the updated bundle when launched on your phone!

---

## 🛠️ Verification & Development

* **Typecheck**: `npm run typecheck` or `npx tsc --noEmit`
* **Dependency Health**: `npx expo-doctor`
