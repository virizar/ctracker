import { UserProfile, DailySummary, ScaleWeight, MealLog } from '../types';
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
  FAT_KCAL_PER_KG: 7700.0, // Energy content of fat tissue (kcal/kg)
  DAYS_PER_MONTH: 30.4375, // Average days in a month
  DEFAULT_MIN_DAILY_CALORIES: 1500.0,
};

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
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return Math.max(18.0, diffDays / 365.25);
  } catch {
    return 38.0;
  }
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

export async function recalculateUserTdee(username = 'victor'): Promise<void> {
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
  const dailyDeficit =
    (profile.target_monthly_rate_kg * CONSTANTS.FAT_KCAL_PER_KG) / CONSTANTS.DAYS_PER_MONTH;

  for (let i = 0; i < datesContiguous.length; i++) {
    const d = datesContiguous[i];
    const trendW = trendWeights.get(d) ?? initialW;

    // Check rolling 14-day window for TDEE update
    if (i >= CONSTANTS.WINDOW_DAYS) {
      const windowDates = datesContiguous.slice(i - CONSTANTS.WINDOW_DAYS, i);
      const validIntakes = windowDates
        .map((dt) => foodDays.get(dt))
        .filter((entry): entry is { calories: number; protein: number; carbs: number; fat: number; hasLog: boolean } =>
          Boolean(entry && entry.hasLog && entry.calories > 0)
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

    // Daily Calorie Target
    const rawTarget = currTdee + dailyDeficit;
    const minFloor = profile.min_daily_calories || CONSTANTS.DEFAULT_MIN_DAILY_CALORIES;
    let targetCalories = Math.round(rawTarget);
    let isCapped = false;

    if (targetCalories < minFloor) {
      targetCalories = minFloor;
      isCapped = true;
    }

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
}
