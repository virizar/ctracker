import { getDatabase } from './database';
import {
  UserProfile,
  ScaleWeight,
  MealLog,
  DailySummary,
  FoodCatalogItem,
} from '../types';

export async function getUserProfile(username = 'victor'): Promise<UserProfile | null> {
  const db = await getDatabase();
  const user = await db.getFirstAsync<UserProfile>(
    'SELECT * FROM user_profiles WHERE username = ?',
    [username]
  );
  if (user) return user;
  return await db.getFirstAsync<UserProfile>(
    'SELECT * FROM user_profiles ORDER BY id ASC LIMIT 1'
  );
}

export async function updateUserProfile(
  username: string,
  updates: Partial<UserProfile>
): Promise<void> {
  const db = await getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && key !== 'id' && key !== 'username') {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return;

  fields.push("updated_at = datetime('now')");
  values.push(username);

  await db.runAsync(
    `UPDATE user_profiles SET ${fields.join(', ')} WHERE username = ?`,
    values
  );
}

export async function logScaleWeight(
  username: string,
  date: string,
  rawWeight: number
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO scale_weights (username, date, raw_weight)
     VALUES (?, ?, ?)
     ON CONFLICT(username, date) DO UPDATE SET raw_weight = excluded.raw_weight`,
    [username, date, rawWeight]
  );
}

export async function getScaleWeights(
  username = 'victor',
  limit = 90
): Promise<ScaleWeight[]> {
  const db = await getDatabase();
  return await db.getAllAsync<ScaleWeight>(
    'SELECT * FROM scale_weights WHERE username = ? ORDER BY date DESC LIMIT ?',
    [username, limit]
  );
}

export async function logMeal(
  username: string,
  meal: Omit<MealLog, 'id' | 'created_at' | 'username'>
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO meal_logs (
      username, date, food_name, canonical_name, serving_size,
      calories, protein, carbs, fat, client_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      username,
      meal.date,
      meal.food_name,
      meal.canonical_name || null,
      meal.serving_size || null,
      meal.calories,
      meal.protein,
      meal.carbs,
      meal.fat,
      meal.client_event_id || null,
    ]
  );

  // Auto-record / update into food catalog
  const canonical = meal.canonical_name || meal.food_name;
  await upsertFoodCatalog({
    username,
    canonical_name: canonical,
    default_serving: meal.serving_size || null,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    usage_count: 1,
  });

  return result.lastInsertRowId;
}

export async function deleteMeal(mealId: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM meal_logs WHERE id = ?', [mealId]);
}

export async function getMealsByDate(
  username = 'victor',
  date: string
): Promise<MealLog[]> {
  const db = await getDatabase();
  return await db.getAllAsync<MealLog>(
    'SELECT * FROM meal_logs WHERE username = ? AND date = ? ORDER BY id ASC',
    [username, date]
  );
}

export async function getDailySummary(
  username = 'victor',
  date: string
): Promise<DailySummary | null> {
  const db = await getDatabase();
  return await db.getFirstAsync<DailySummary>(
    'SELECT * FROM daily_summaries WHERE username = ? AND date = ?',
    [username, date]
  );
}

export async function getLatestDailySummary(
  username = 'victor',
  upToDate?: string
): Promise<DailySummary | null> {
  const db = await getDatabase();
  if (upToDate) {
    return await db.getFirstAsync<DailySummary>(
      'SELECT * FROM daily_summaries WHERE username = ? AND date <= ? AND target_calories IS NOT NULL ORDER BY date DESC LIMIT 1',
      [username, upToDate]
    );
  }
  return await db.getFirstAsync<DailySummary>(
    'SELECT * FROM daily_summaries WHERE username = ? AND target_calories IS NOT NULL ORDER BY date DESC LIMIT 1',
    [username]
  );
}

export async function getDailySummariesRange(
  username = 'victor',
  days = 30
): Promise<DailySummary[]> {
  const db = await getDatabase();
  return await db.getAllAsync<DailySummary>(
    `SELECT * FROM daily_summaries
     WHERE username = ?
     ORDER BY date DESC
     LIMIT ?`,
    [username, days]
  );
}

export async function upsertDailySummary(
  summary: Omit<DailySummary, 'id' | 'updated_at'>
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO daily_summaries (
      username, date, total_calories, total_protein, total_carbs, total_fat,
      raw_weight, trend_weight, tdee, target_calories, is_rate_capped_by_safety_floor
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(username, date) DO UPDATE SET
      total_calories = excluded.total_calories,
      total_protein = excluded.total_protein,
      total_carbs = excluded.total_carbs,
      total_fat = excluded.total_fat,
      raw_weight = excluded.raw_weight,
      trend_weight = excluded.trend_weight,
      tdee = excluded.tdee,
      target_calories = excluded.target_calories,
      is_rate_capped_by_safety_floor = excluded.is_rate_capped_by_safety_floor,
      updated_at = datetime('now')`,
    [
      summary.username,
      summary.date,
      summary.total_calories,
      summary.total_protein,
      summary.total_carbs,
      summary.total_fat,
      summary.raw_weight,
      summary.trend_weight,
      summary.tdee,
      summary.target_calories,
      summary.is_rate_capped_by_safety_floor ? 1 : 0,
    ]
  );
}

export async function searchFoodCatalog(
  username = 'victor',
  query: string,
  limit = 20
): Promise<FoodCatalogItem[]> {
  const db = await getDatabase();
  const trimmed = query.trim();
  if (!trimmed) {
    return await db.getAllAsync<FoodCatalogItem>(
      'SELECT * FROM food_catalog WHERE username = ? ORDER BY usage_count DESC, last_used_at DESC LIMIT ?',
      [username, limit]
    );
  }

  // Tokenize for FTS5 (e.g. "greek yogurt" -> "greek* yogurt*")
  const tokens = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(' ');

  try {
    return await db.getAllAsync<FoodCatalogItem>(
      `SELECT fc.* FROM food_catalog fc
       JOIN food_catalog_fts fts ON fc.id = fts.rowid
       WHERE food_catalog_fts MATCH ? AND fts.username = ?
       ORDER BY bm25(food_catalog_fts), fc.usage_count DESC
       LIMIT ?`,
      [tokens, username, limit]
    );
  } catch {
    // Fallback to LIKE if FTS expression has syntax error
    return await db.getAllAsync<FoodCatalogItem>(
      `SELECT * FROM food_catalog
       WHERE username = ? AND canonical_name LIKE ?
       ORDER BY usage_count DESC
       LIMIT ?`,
      [username, `%${trimmed}%`, limit]
    );
  }
}

export async function upsertFoodCatalog(
  item: Omit<FoodCatalogItem, 'id' | 'last_used_at' | 'created_at'>
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO food_catalog (
      username, canonical_name, default_serving, calories, protein, carbs, fat,
      base_weight_g, last_used_qty, last_used_unit, usage_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(username, canonical_name) DO UPDATE SET
      default_serving = COALESCE(excluded.default_serving, food_catalog.default_serving),
      calories = excluded.calories,
      protein = excluded.protein,
      carbs = excluded.carbs,
      fat = excluded.fat,
      base_weight_g = COALESCE(excluded.base_weight_g, food_catalog.base_weight_g),
      last_used_qty = COALESCE(excluded.last_used_qty, food_catalog.last_used_qty),
      last_used_unit = COALESCE(excluded.last_used_unit, food_catalog.last_used_unit),
      usage_count = food_catalog.usage_count + 1,
      last_used_at = datetime('now')`,
    [
      item.username,
      item.canonical_name,
      item.default_serving || null,
      item.calories,
      item.protein,
      item.carbs,
      item.fat,
      item.base_weight_g ?? null,
      item.last_used_qty ?? null,
      item.last_used_unit ?? null,
    ]
  );
}

export async function renameFoodCatalogItem(
  username = 'victor',
  oldCanonicalName: string,
  newCanonicalName: string
): Promise<void> {
  const oldName = oldCanonicalName.trim();
  const newName = newCanonicalName.trim();
  if (!newName || oldName === newName) return;

  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ id: number; usage_count: number }>(
    `SELECT id, usage_count FROM food_catalog WHERE username = ? AND canonical_name = ?`,
    [username, newName]
  );

  if (existing) {
    await db.runAsync(
      `UPDATE food_catalog SET usage_count = usage_count + 1 WHERE id = ?`,
      [existing.id]
    );
    await db.runAsync(
      `DELETE FROM food_catalog WHERE username = ? AND canonical_name = ?`,
      [username, oldName]
    );
  } else {
    await db.runAsync(
      `UPDATE food_catalog 
       SET canonical_name = ?
       WHERE username = ? AND canonical_name = ?`,
      [newName, username, oldName]
    );
  }
}


export async function updateCatalogLastUsedMeasurement(
  username = 'victor',
  canonicalName: string,
  qty: number,
  unit: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE food_catalog
     SET last_used_qty = ?,
         last_used_unit = ?,
         usage_count = usage_count + 1,
         last_used_at = datetime('now')
     WHERE username = ? AND canonical_name = ?`,
    [qty, unit, username, canonicalName.trim()]
  );
}

export interface DayLogStatus {
  date: string;
  hasWeight: boolean;
  rawWeight?: number | null;
  hasFood: boolean;
  totalCalories: number;
}

export async function getMonthLogStatus(
  username = 'victor',
  year: number,
  month: number // 1-12
): Promise<Record<string, DayLogStatus>> {
  const db = await getDatabase();
  const monthStr = `${year}-${String(month).padStart(2, '0')}`;
  const pattern = `${monthStr}-%`;

  const result: Record<string, DayLogStatus> = {};

  // 1. Fetch from daily_summaries (covers calculated & imported history)
  const summaries = await db.getAllAsync<{
    date: string;
    raw_weight: number | null;
    total_calories: number;
  }>(
    'SELECT date, raw_weight, total_calories FROM daily_summaries WHERE username = ? AND date LIKE ?',
    [username, pattern]
  );

  for (const s of summaries) {
    result[s.date] = {
      date: s.date,
      hasWeight: s.raw_weight !== null && s.raw_weight > 0,
      rawWeight: s.raw_weight,
      hasFood: s.total_calories > 0,
      totalCalories: s.total_calories || 0,
    };
  }

  // 2. Fetch directly from scale_weights (in case not yet recalculated)
  const weights = await db.getAllAsync<{ date: string; raw_weight: number }>(
    'SELECT date, raw_weight FROM scale_weights WHERE username = ? AND date LIKE ?',
    [username, pattern]
  );
  for (const w of weights) {
    if (!result[w.date]) {
      result[w.date] = {
        date: w.date,
        hasWeight: true,
        rawWeight: w.raw_weight,
        hasFood: false,
        totalCalories: 0,
      };
    } else {
      result[w.date].hasWeight = true;
      result[w.date].rawWeight = w.raw_weight;
    }
  }

  // 3. Fetch directly from meal_logs (in case not yet recalculated)
  const meals = await db.getAllAsync<{ date: string; total_calories: number }>(
    `SELECT date, SUM(calories) as total_calories
     FROM meal_logs
     WHERE username = ? AND date LIKE ?
     GROUP BY date`,
    [username, pattern]
  );
  for (const m of meals) {
    const cals = m.total_calories || 0;
    if (!result[m.date]) {
      result[m.date] = {
        date: m.date,
        hasWeight: false,
        rawWeight: null,
        hasFood: cals > 0,
        totalCalories: cals,
      };
    } else {
      result[m.date].hasFood = cals > 0;
      result[m.date].totalCalories = cals;
    }
  }

  return result;
}
