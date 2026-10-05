import { UserProfile, DailySummary, ScaleWeight, MealLog, DEFAULT_USERNAME } from '../types';
import {
  getUserProfile,
  getScaleWeights,
  getMealsByDate,
  upsertDailySummary,
} from '../db/queries';
import { getDatabase } from '../db/database';

export const CONSTANTS = {
  TAU_W: 14.0, // Weight trend time constant (days)
  TAU_E: 28.0, // Expenditure trend time constant (days)
  WINDOW_DAYS: 14, // Rolling window size (days)
  MIN_FOOD_LOGGED_DAYS: 5, // Data density requirement
  FAT_KCAL_PER_KG: 7700.0, // Energy content of pure fat tissue (kcal/kg) - used for expenditure estimation
  REALISTIC_TISSUE_KCAL_PER_KG: 6500.0, // Realistic tissue loss mix (fat + glycogen + water) - used for deficit calibration
  DAYS_PER_MONTH: 30.4375, // Average days in a month
  DEFAULT_MIN_DAILY_CALORIES: 1500.0,
};

export interface PhysiologicalTargetResult {
  targetCalories: number;
  dailyDeficit: number; // positive for deficit, negative for surplus, 0 for maintenance
  isCapped: boolean;
  mode: 'loss' | 'gain' | 'maintain';
  bmi: number;
  weeklyRateKg: number;
  weeklyRatePercent: number;
  minFloor: number;
}

/**
 * Context-aware physiological daily target calculation.
 * Accounts for current weight, target weight, height, age, sex, BMI, and TDEE.
 * Replaces the rigid 3,500 kcal (7,700 kcal/kg) linear model with an adaptive,
 * muscle-sparing energy density and leanness-scaled pace.
 */
export function calculatePhysiologicalDailyTarget(options: {
  tdee: number;
  currentWeightKg: number;
  targetWeightKg?: number | null;
  heightCm: number;
  ageYears: number;
  sex?: 'male' | 'female';
  pace?: 'gentle' | 'balanced' | 'ambitious';
  userMinCalories?: number | null;
}): PhysiologicalTargetResult {
  const {
    tdee,
    currentWeightKg,
    targetWeightKg,
    heightCm,
    ageYears,
    sex = 'male',
    pace = 'balanced',
    userMinCalories,
  } = options;

  const heightM = Math.max(1.0, heightCm / 100);
  const bmi = currentWeightKg / (heightM * heightM);
  const targetW = targetWeightKg ?? currentWeightKg;
  const weightDelta = targetW - currentWeightKg;

  // Physiological Minimum Calorie Floor (Protects endocrine health and basal metabolic function)
  const bmr = mifflinStJeor(currentWeightKg, heightCm, ageYears, sex);
  const physiologicalFloor =
    sex === 'female'
      ? Math.max(1200, Math.round(bmr * 0.85))
      : Math.max(1500, Math.round(bmr * 0.85));
  const minFloor = Math.max(physiologicalFloor, userMinCalories || 0);

  // Case 1: Maintenance (Within 0.35 kg of goal weight)
  if (Math.abs(weightDelta) <= 0.35) {
    const targetCalories = Math.max(minFloor, Math.round(tdee));
    return {
      targetCalories,
      dailyDeficit: 0,
      isCapped: targetCalories === minFloor && tdee < minFloor,
      mode: 'maintain',
      bmi: Math.round(bmi * 10) / 10,
      weeklyRateKg: 0,
      weeklyRatePercent: 0,
      minFloor,
    };
  }

  // Case 2: Controlled Muscle Gain / Bulking
  if (weightDelta > 0.35) {
    const surplusRatio = pace === 'gentle' ? 0.05 : pace === 'ambitious' ? 0.12 : 0.08;
    // Surplus capped between 100 kcal and 350 kcal/day to prevent excessive adipose accumulation
    const dailySurplus = Math.round(Math.min(350, Math.max(100, tdee * surplusRatio)));
    const targetCalories = Math.round(tdee + dailySurplus);
    const weeklyRateKg = (dailySurplus * 7) / CONSTANTS.REALISTIC_TISSUE_KCAL_PER_KG;
    const weeklyRatePercent = (weeklyRateKg / currentWeightKg) * 100;

    return {
      targetCalories,
      dailyDeficit: -dailySurplus,
      isCapped: false,
      mode: 'gain',
      bmi: Math.round(bmi * 10) / 10,
      weeklyRateKg: Math.round(weeklyRateKg * 100) / 100,
      weeklyRatePercent: Math.round(weeklyRatePercent * 100) / 100,
      minFloor,
    };
  }

  // Case 3: Adaptive Fat Loss
  // Leanness & Reserve Factor (Alpert's Law: energy transfer from fat depends on fat mass)
  // Higher BMI bodies carry more adipose reserves and can comfortably support a higher % loss rate.
  // Leaner bodies have fewer fat stores and must reduce the deficit to prevent muscle catabolism.
  let baseWeeklyRatePercent = 0.55;
  let maxTdeeDeficitPercent = 0.18;

  if (sex === 'male') {
    // Men: healthy BMI baseline ~20 to ~32
    const norm = Math.max(0, Math.min(1, (bmi - 20) / 12));
    baseWeeklyRatePercent = 0.35 + norm * (0.80 - 0.35); // 0.35% (lean) to 0.80% (high adipose)
    maxTdeeDeficitPercent = 0.12 + norm * (0.23 - 0.12); // 12% to 23% of TDEE
  } else {
    // Women: essential fat is ~8-10% higher; healthy BMI baseline ~22 to ~34
    const norm = Math.max(0, Math.min(1, (bmi - 22) / 12));
    baseWeeklyRatePercent = 0.35 + norm * (0.80 - 0.35);
    maxTdeeDeficitPercent = 0.12 + norm * (0.23 - 0.12);
  }

  // Age Guardrail: Anabolic resistance above age 50 increases sarcopenia risk during steep cuts
  if (ageYears > 50) {
    const ageFactor = Math.max(0.85, 1.0 - (ageYears - 50) * 0.005);
    baseWeeklyRatePercent *= ageFactor;
    maxTdeeDeficitPercent *= ageFactor;
  }

  // Pace Multiplier
  const paceMult = pace === 'gentle' ? 0.75 : pace === 'ambitious' ? 1.25 : 1.0;
  const effectiveWeeklyRatePercent = baseWeeklyRatePercent * paceMult;

  // Calculate required weekly loss in kg
  const weeklyRateKg = currentWeightKg * (effectiveWeeklyRatePercent / 100);

  // Convert to daily calorie deficit using realistic tissue mix (6,500 kcal/kg)
  const rawDailyDeficit = (weeklyRateKg * CONSTANTS.REALISTIC_TISSUE_KCAL_PER_KG) / 7;

  // TDEE Guardrail: Never exceed the safe fraction of total daily expenditure
  const maxDeficitKcal = tdee * maxTdeeDeficitPercent * (pace === 'ambitious' ? 1.15 : pace === 'gentle' ? 0.85 : 1.0);
  const dailyDeficit = Math.round(Math.min(rawDailyDeficit, maxDeficitKcal));

  // Compute final target
  let rawTarget = Math.round(tdee - dailyDeficit);
  let isCapped = false;

  if (rawTarget < minFloor) {
    rawTarget = minFloor;
    isCapped = true;
  }

  return {
    targetCalories: rawTarget,
    dailyDeficit,
    isCapped,
    mode: 'loss',
    bmi: Math.round(bmi * 10) / 10,
    weeklyRateKg: Math.round(weeklyRateKg * 100) / 100,
    weeklyRatePercent: Math.round(effectiveWeeklyRatePercent * 100) / 100,
    minFloor,
  };
}

export function mifflinStJeor(
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: 'male' | 'female' = 'male'
): number {
  const s = sex.toLowerCase() === 'male' ? 5.0 : -161.0;
  return 10.0 * weightKg + 6.25 * heightCm - 5.0 * ageYears + s;
}

export function calculateAgeYears(dobStr: string, currentDateStr: string): number {
  try {
    const dob = new Date(dobStr);
    const curr = new Date(currentDateStr);
    const diffMs = curr.getTime() - dob.getTime();
    if (isNaN(diffMs)) return 38.0;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return Math.max(18.0, diffDays / 365.25);
  } catch {
    return 38.0;
  }
}

export function calculateWeightEmaAlpha(tauDays: number = CONSTANTS.TAU_W): number {
  return 1.0 - Math.exp(-1.0 / tauDays);
}

export function calculateExpenditureEmaAlpha(tauDays: number = CONSTANTS.TAU_E): number {
  return 1.0 - Math.exp(-1.0 / tauDays);
}

export function calculateTrendWeightStep(
  previousTrend: number,
  rawWeight: number,
  alpha: number
): number {
  return previousTrend + alpha * (rawWeight - previousTrend);
}

export function calculateTdeeStep(
  previousTdee: number,
  avgIntake: number,
  weightChangeKg: number,
  windowDays: number = CONSTANTS.WINDOW_DAYS,
  alpha: number = 1.0 - Math.exp(-1.0 / CONSTANTS.TAU_E)
): number {
  const energyDelta = (weightChangeKg * CONSTANTS.FAT_KCAL_PER_KG) / windowDays;
  let rawTdee = avgIntake - energyDelta;
  rawTdee = Math.max(1000.0, Math.min(5000.0, rawTdee));
  return alpha * rawTdee + (1.0 - alpha) * previousTdee;
}

export function calculateDailyTarget(
  tdee: number,
  targetMonthlyRateKg: number,
  minFloor: number = CONSTANTS.DEFAULT_MIN_DAILY_CALORIES
): { targetCalories: number; isCapped: boolean } {
  const dailyDeficit =
    (targetMonthlyRateKg * CONSTANTS.FAT_KCAL_PER_KG) / CONSTANTS.DAYS_PER_MONTH;
  const rawTarget = tdee + dailyDeficit;
  let targetCalories = Math.round(rawTarget);
  let isCapped = false;

  if (targetCalories < minFloor) {
    targetCalories = minFloor;
    isCapped = true;
  }

  return { targetCalories, isCapped };
}

export function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseDate(dStr: string): Date {
  const [y, m, d] = dStr.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export async function recalculateUserTdee(username = DEFAULT_USERNAME): Promise<void> {
  const profile = await getUserProfile(username);
  if (!profile) return;

  const db = await getDatabase();

  // Fetch all weight logs
  const weightsDb = await db.getAllAsync<{ date: string; raw_weight: number }>(
    'SELECT date, raw_weight FROM scale_weights WHERE username = ? ORDER BY date ASC',
    [username]
  );
  const weightMap = new Map<string, number>();
  for (const w of weightsDb) {
    weightMap.set(w.date, w.raw_weight);
  }

  // Fetch all meal logs aggregated by date
  const mealsDb = await db.getAllAsync<{
    date: string;
    total_calories: number;
    total_protein: number;
    total_carbs: number;
    total_fat: number;
  }>(
    `SELECT date,
            SUM(calories) as total_calories,
            SUM(protein) as total_protein,
            SUM(carbs) as total_carbs,
            SUM(fat) as total_fat
     FROM meal_logs
     WHERE username = ?
     GROUP BY date
     ORDER BY date ASC`,
    [username]
  );

  const foodDays = new Map<
    string,
    { calories: number; protein: number; carbs: number; fat: number; hasLog: boolean }
  >();

  for (const m of mealsDb) {
    foodDays.set(m.date, {
      calories: m.total_calories || 0,
      protein: m.total_protein || 0,
      carbs: m.total_carbs || 0,
      fat: m.total_fat || 0,
      hasLog: true,
    });
  }

  const allDatesSet = new Set<string>([...weightMap.keys(), ...foodDays.keys()]);
  if (allDatesSet.size === 0) return;

  const allDates = Array.from(allDatesSet).sort();
  const startDt = parseDate(allDates[0]);
  const todayStr = formatDate(new Date());
  const todayDt = parseDate(todayStr);
  const latestLoggedDt = parseDate(allDates[allDates.length - 1]);
  const endDt = latestLoggedDt > todayDt ? latestLoggedDt : todayDt;

  // Generate full contiguous date range
  const datesContiguous: string[] = [];
  const curr = new Date(startDt);
  while (curr <= endDt) {
    datesContiguous.push(formatDate(curr));
    curr.setDate(curr.getDate() + 1);
  }

  // 1. Initial Baseline TDEE & Trend Weight
  const initialW = weightsDb.length > 0 ? weightsDb[0].raw_weight : 80.0;
  const initialAgeYr = calculateAgeYears(profile.dob, datesContiguous[0]);
  const bmrInit = mifflinStJeor(initialW, profile.height_cm, initialAgeYr, profile.sex);
  let currTdee = bmrInit * profile.activity_multiplier;
  let currTw = initialW;

  const alphaW = 1.0 - Math.exp(-1.0 / CONSTANTS.TAU_W);
  const alphaE = 1.0 - Math.exp(-1.0 / CONSTANTS.TAU_E);
  const trendWeights = new Map<string, number>();

  // Pass 1: Compute Trend Weights with EMA
  for (const d of datesContiguous) {
    const rawW = weightMap.get(d);
    if (rawW !== undefined) {
      currTw = currTw + alphaW * (rawW - currTw);
    }
    trendWeights.set(d, currTw);
  }

  // Pass 2: Compute Rolling TDEE and Daily Summaries
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < datesContiguous.length; i++) {
      const d = datesContiguous[i];
      const trendW = trendWeights.get(d) ?? initialW;

      // Check rolling 14-day window for TDEE update
      if (i >= CONSTANTS.WINDOW_DAYS) {
        const windowDates = datesContiguous.slice(i - CONSTANTS.WINDOW_DAYS, i);
        const validIntakes = windowDates
          .map((dt) => foodDays.get(dt))
          .filter((entry): entry is { calories: number; protein: number; carbs: number; fat: number; hasLog: boolean } =>
            Boolean(entry && entry.hasLog)
          );

        if (validIntakes.length >= CONSTANTS.MIN_FOOD_LOGGED_DAYS) {
          const totalCals = validIntakes.reduce((acc, curr) => acc + curr.calories, 0);
          const avgIntake = totalCals / validIntakes.length;

          const startWindowDate = datesContiguous[i - CONSTANTS.WINDOW_DAYS];
          const wStart = trendWeights.get(startWindowDate) ?? trendW;
          const wChange = trendW - wStart;
          const energyDelta = (wChange * CONSTANTS.FAT_KCAL_PER_KG) / CONSTANTS.WINDOW_DAYS;
          let rawTdee = avgIntake - energyDelta;

          // Realistic bounds
          rawTdee = Math.max(1000.0, Math.min(5000.0, rawTdee));
          currTdee = alphaE * rawTdee + (1.0 - alphaE) * currTdee;
        }
        // If validIntakes < 5, currTdee retains its previous converged value!
      }

      // Daily Calorie Target computed via physiological context-aware engine
      const ageYr = calculateAgeYears(profile.dob, d);
      const targetResult = calculatePhysiologicalDailyTarget({
        tdee: currTdee,
        currentWeightKg: trendW,
        targetWeightKg: profile.target_weight_kg,
        heightCm: profile.height_cm,
        ageYears: ageYr,
        sex: profile.sex,
        pace: profile.loss_pace || 'balanced',
        userMinCalories: profile.min_daily_calories,
      });

      const targetCalories = targetResult.targetCalories;
      const isCapped = targetResult.isCapped;

      const dayFood = foodDays.get(d);

      await upsertDailySummary({
        username,
        date: d,
        total_calories: dayFood ? Math.round(dayFood.calories * 10) / 10 : 0.0,
        total_protein: dayFood ? Math.round(dayFood.protein * 10) / 10 : 0.0,
        total_carbs: dayFood ? Math.round(dayFood.carbs * 10) / 10 : 0.0,
        total_fat: dayFood ? Math.round(dayFood.fat * 10) / 10 : 0.0,
        raw_weight: weightMap.get(d) ?? null,
        trend_weight: Math.round(trendW * 100) / 100,
        tdee: Math.round(currTdee * 10) / 10,
        target_calories: targetCalories,
        is_rate_capped_by_safety_floor: isCapped,
      });
    }
  });
}
