import { getDatabase } from './database';
import {
  UserProfile,
  ScaleWeight,
  MealLog,
  DailySummary,
  FoodCatalogItem,
  OptimizedFoodMapping,
  FoodSource,
  DEFAULT_USERNAME,
} from '../types';
import { cleanTag } from '../services/serving';

export async function getUserProfile(username = DEFAULT_USERNAME): Promise<UserProfile | null> {
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
  username = DEFAULT_USERNAME,
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
  meal: Omit<MealLog, 'id' | 'created_at' | 'username'>,
  source?: FoodSource
): Promise<number> {
  const cleanBrand = cleanTag(meal.brand);
  const cleanVariant = cleanTag(meal.variant);

  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO meal_logs (
      username, date, food_name, canonical_name, brand, variant, serving_size,
      calories, protein, carbs, fat, client_event_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      username,
      meal.date,
      meal.food_name,
      meal.canonical_name || null,
      cleanBrand,
      cleanVariant,
      meal.serving_size || null,
      meal.calories,
      meal.protein,
      meal.carbs,
      meal.fat,
      meal.client_event_id || null,
    ]
  );

  // Auto-record / update into food catalog (unless it's a fasting entry)
  const isFastingLog =
    meal.food_name.toLowerCase().includes('fasted') ||
    meal.canonical_name?.toLowerCase().includes('fasting');

  if (!isFastingLog) {
    const canonical = meal.canonical_name || meal.food_name;
    await upsertFoodCatalog({
      username,
      canonical_name: canonical,
      brand: cleanBrand,
      variant: cleanVariant,
      default_serving: meal.serving_size || null,
      calories: meal.calories,
      protein: meal.protein,
      carbs: meal.carbs,
      fat: meal.fat,
      usage_count: 1,
      source: source || 'custom',
    });
  }

  return result.lastInsertRowId;
}

export async function deleteMeal(mealId: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM meal_logs WHERE id = ?', [mealId]);
}

export async function updateMealLog(
  mealId: number,
  updates: Partial<Omit<MealLog, 'id' | 'created_at'>>
): Promise<void> {
  const db = await getDatabase();
  const fields: string[] = [];
  const values: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && key !== 'id') {
      let finalVal = value;
      if (key === 'brand' || key === 'variant') {
        finalVal = cleanTag(value as string);
      }
      fields.push(`${key} = ?`);
      values.push(finalVal);
    }
  }

  if (fields.length === 0) return;

  values.push(mealId);
  await db.runAsync(
    `UPDATE meal_logs SET ${fields.join(', ')} WHERE id = ?`,
    values
  );
}

export async function getMealsByDate(
  username = DEFAULT_USERNAME,
  date: string
): Promise<MealLog[]> {
  const db = await getDatabase();
  return await db.getAllAsync<MealLog>(
    'SELECT * FROM meal_logs WHERE username = ? AND date = ? ORDER BY id ASC',
    [username, date]
  );
}

export async function getDailySummary(
  username = DEFAULT_USERNAME,
  date: string
): Promise<DailySummary | null> {
  const db = await getDatabase();
  return await db.getFirstAsync<DailySummary>(
    'SELECT * FROM daily_summaries WHERE username = ? AND date = ?',
    [username, date]
  );
}

export async function getLatestDailySummary(
  username = DEFAULT_USERNAME,
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
  username = DEFAULT_USERNAME,
  days = 30
): Promise<DailySummary[]> {
  const db = await getDatabase();
  return await db.getAllAsync<DailySummary>(
    `SELECT ds.*,
            EXISTS(SELECT 1 FROM meal_logs ml WHERE ml.username = ds.username AND ml.date = ds.date) as has_meal_log,
            EXISTS(SELECT 1 FROM meal_logs ml WHERE ml.username = ds.username AND ml.date = ds.date AND (ml.food_name = 'Fasted Day' OR ml.canonical_name = 'Fasting')) as is_fasted
     FROM daily_summaries ds
     WHERE ds.username = ?
     ORDER BY ds.date DESC
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
  username = DEFAULT_USERNAME,
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

  // Tokenize using Unicode word matching (e.g. "egg, fried" -> ["egg", "fried"])
  const tokens = trimmed.toLowerCase().match(/[\p{L}\p{N}%]+/gu) || [];
  if (tokens.length === 0) {
    return await db.getAllAsync<FoodCatalogItem>(
      'SELECT * FROM food_catalog WHERE username = ? ORDER BY usage_count DESC, last_used_at DESC LIMIT ?',
      [username, limit]
    );
  }

  const firstToken: string = tokens[0] || '';
  const lowerTrimmed = trimmed.toLowerCase();

  // 1. Try native FTS5 search (available on native platforms with food_catalog_fts)
  try {
    const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
    const ftsResults = await db.getAllAsync<FoodCatalogItem>(
      `SELECT fc.* FROM food_catalog fc
       JOIN food_catalog_fts fts ON fc.id = fts.rowid
       WHERE food_catalog_fts MATCH ? AND fts.username = ?
       ORDER BY 
         (CASE WHEN fc.usage_count > 1 THEN fc.usage_count * 100 ELSE 0 END) +
         (CASE 
           WHEN LOWER(fc.canonical_name) = ? THEN 50
           WHEN LOWER(fc.canonical_name) LIKE ? || '%' THEN 30
           WHEN LOWER(fc.canonical_name) LIKE '% ' || ? || '%' THEN 20
           WHEN LOWER(COALESCE(fc.aliases, '')) LIKE '%' || ? || '%' THEN 15
           ELSE 0 
          END) DESC,
         bm25(food_catalog_fts),
         fc.usage_count DESC,
         fc.last_used_at DESC
       LIMIT ?`,
      [ftsQuery, username, lowerTrimmed, firstToken, firstToken, firstToken, limit]
    );
    if (ftsResults.length > 0) {
      return ftsResults;
    }
  } catch {
    // Fallback to cross-field multi-token SQL LIKE search
  }

  // 2. Cross-field multi-token search across canonical_name, variant, brand, and aliases (for Web & LIKE fallback)
  // Ensures every token matches somewhere across the composite text, regardless of word order or punctuation
  const likeConditions = tokens
    .map(
      () =>
        "(LOWER(canonical_name || ' ' || COALESCE(variant, '') || ' ' || COALESCE(brand, '') || ' ' || COALESCE(aliases, '')) LIKE ?)"
    )
    .join(' AND ');

  const likeParams: string[] = tokens.map((t) => `%${t}%`);
  const bindValues: (string | number)[] = [
    username,
    ...likeParams,
    lowerTrimmed,
    firstToken,
    firstToken,
    firstToken,
    limit,
  ];

  return await db.getAllAsync<FoodCatalogItem>(
    `SELECT * FROM food_catalog
     WHERE username = ? AND ${likeConditions}
     ORDER BY 
       (CASE WHEN usage_count > 1 THEN usage_count * 100 ELSE 0 END) +
       (CASE 
         WHEN LOWER(canonical_name) = ? THEN 50
         WHEN LOWER(canonical_name) LIKE ? || '%' THEN 30
         WHEN LOWER(canonical_name) LIKE '% ' || ? || '%' THEN 20
         WHEN LOWER(COALESCE(aliases, '')) LIKE '%' || ? || '%' THEN 15
         ELSE 0 
        END) DESC,
       usage_count DESC,
       last_used_at DESC
     LIMIT ?`,
    bindValues
  );
}

export async function getFoodCatalogItem(
  username = DEFAULT_USERNAME,
  canonicalName: string
): Promise<FoodCatalogItem | null> {
  const db = await getDatabase();
  return await db.getFirstAsync<FoodCatalogItem>(
    'SELECT * FROM food_catalog WHERE username = ? AND canonical_name = ?',
    [username, canonicalName.trim()]
  );
}

export async function getFoodCatalogItemByBarcode(
  username = DEFAULT_USERNAME,
  barcode: string
): Promise<FoodCatalogItem | null> {
  const db = await getDatabase();
  const cleanBarcode = barcode.trim();
  if (!cleanBarcode) return null;
  return await db.getFirstAsync<FoodCatalogItem>(
    'SELECT * FROM food_catalog WHERE username = ? AND barcode = ? LIMIT 1',
    [username, cleanBarcode]
  );
}

export async function getAllFoodCatalogItems(
  username = DEFAULT_USERNAME
): Promise<FoodCatalogItem[]> {
  const db = await getDatabase();
  return await db.getAllAsync<FoodCatalogItem>(
    'SELECT * FROM food_catalog WHERE username = ? ORDER BY usage_count DESC',
    [username]
  );
}

export async function getOptimizableFoodCatalogItems(
  username = DEFAULT_USERNAME
): Promise<FoodCatalogItem[]> {
  const db = await getDatabase();
  return await db.getAllAsync<FoodCatalogItem>(
    `SELECT * FROM food_catalog 
     WHERE username = ? 
       AND (source IS NULL OR source NOT IN ('base', 'off', 'custom')) 
       AND (is_verified IS NULL OR is_verified = 0)
     ORDER BY usage_count DESC`,
    [username]
  );
}

export async function upsertFoodCatalog(
  item: Omit<FoodCatalogItem, 'id' | 'last_used_at' | 'created_at'>
): Promise<void> {
  const cleanBrand = cleanTag(item.brand);
  const cleanVariant = cleanTag(item.variant);
  const source = item.source || 'custom';
  const isVerified = item.is_verified ? 1 : (source === 'base' || source === 'off' ? 1 : 0);

  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO food_catalog (
      username, canonical_name, brand, variant, barcode, default_serving, calories, protein, carbs, fat,
      base_weight_g, last_used_qty, last_used_unit, usage_count, source, is_verified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(username, canonical_name) DO UPDATE SET
      brand = CASE
        WHEN excluded.source IN ('base', 'off') THEN COALESCE(excluded.brand, food_catalog.brand)
        ELSE COALESCE(excluded.brand, food_catalog.brand)
      END,
      variant = CASE
        WHEN excluded.source IN ('base', 'off') THEN COALESCE(excluded.variant, food_catalog.variant)
        ELSE COALESCE(excluded.variant, food_catalog.variant)
      END,
      barcode = COALESCE(excluded.barcode, food_catalog.barcode),
      default_serving = CASE 
        WHEN food_catalog.source IN ('base', 'off') THEN food_catalog.default_serving
        WHEN excluded.source IN ('base', 'off') THEN COALESCE(excluded.default_serving, food_catalog.default_serving)
        ELSE COALESCE(excluded.default_serving, food_catalog.default_serving)
      END,
      calories = CASE 
        WHEN food_catalog.source IN ('base', 'off') THEN food_catalog.calories
        WHEN excluded.source IN ('base', 'off') THEN excluded.calories
        ELSE food_catalog.calories
      END,
      protein = CASE 
        WHEN food_catalog.source IN ('base', 'off') THEN food_catalog.protein
        WHEN excluded.source IN ('base', 'off') THEN excluded.protein
        ELSE food_catalog.protein
      END,
      carbs = CASE 
        WHEN food_catalog.source IN ('base', 'off') THEN food_catalog.carbs
        WHEN excluded.source IN ('base', 'off') THEN excluded.carbs
        ELSE food_catalog.carbs
      END,
      fat = CASE 
        WHEN food_catalog.source IN ('base', 'off') THEN food_catalog.fat
        WHEN excluded.source IN ('base', 'off') THEN excluded.fat
        ELSE food_catalog.fat
      END,
      base_weight_g = CASE 
        WHEN food_catalog.source IN ('base', 'off') THEN food_catalog.base_weight_g
        WHEN excluded.source IN ('base', 'off') THEN COALESCE(excluded.base_weight_g, food_catalog.base_weight_g)
        ELSE COALESCE(excluded.base_weight_g, food_catalog.base_weight_g)
      END,
      source = CASE
        WHEN food_catalog.source IN ('base', 'off') THEN food_catalog.source
        WHEN excluded.source IN ('base', 'off') THEN excluded.source
        WHEN food_catalog.source IS NOT NULL AND food_catalog.source != 'custom' THEN food_catalog.source
        ELSE COALESCE(excluded.source, food_catalog.source, 'custom')
      END,
      is_verified = CASE
        WHEN food_catalog.source IN ('base', 'off') OR food_catalog.is_verified = 1 THEN 1
        WHEN excluded.source IN ('base', 'off') OR excluded.is_verified = 1 THEN 1
        ELSE 0
      END,
      usage_count = food_catalog.usage_count + 1,
      last_used_qty = COALESCE(excluded.last_used_qty, food_catalog.last_used_qty),
      last_used_unit = COALESCE(excluded.last_used_unit, food_catalog.last_used_unit),
      last_used_at = datetime('now')`,
    [
      item.username,
      item.canonical_name,
      cleanBrand,
      cleanVariant,
      item.barcode || null,
      item.default_serving || null,
      item.calories,
      item.protein,
      item.carbs,
      item.fat,
      item.base_weight_g ?? null,
      item.last_used_qty ?? null,
      item.last_used_unit ?? null,
      source,
      isVerified,
    ]
  );
}

export async function updateFoodCatalogNutrition(
  username = DEFAULT_USERNAME,
  canonicalName: string,
  nutrition: {
    default_serving?: string | null;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    base_weight_g?: number | null;
  }
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE food_catalog
     SET default_serving = COALESCE(?, default_serving),
         calories = ?,
         protein = ?,
         carbs = ?,
         fat = ?,
         base_weight_g = COALESCE(?, base_weight_g),
         last_used_at = datetime('now')
     WHERE username = ? AND canonical_name = ?`,
    [
      nutrition.default_serving || null,
      nutrition.calories,
      nutrition.protein,
      nutrition.carbs,
      nutrition.fat,
      nutrition.base_weight_g ?? null,
      username,
      canonicalName.trim(),
    ]
  );
}

export async function renameFoodCatalogItem(
  username = DEFAULT_USERNAME,
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

  // Cascade name change to meal_logs
  await db.runAsync(
    `UPDATE meal_logs
     SET canonical_name = ?, food_name = ?
     WHERE username = ? AND (canonical_name = ? OR (canonical_name IS NULL AND food_name = ?))`,
    [newName, newName, username, oldName, oldName]
  );
}

export async function applyFoodCatalogOptimizations(
  username = DEFAULT_USERNAME,
  optimizations: OptimizedFoodMapping[]
): Promise<{ updatedCount: number; mergedCount: number; migratedMealsCount: number }> {
  const db = await getDatabase();
  let updatedCount = 0;
  let mergedCount = 0;
  let migratedMealsCount = 0;

  await db.withTransactionAsync(async () => {
    for (const opt of optimizations) {
      const originalName = opt.original_name?.trim();
      const cleanName = opt.clean_name?.trim();
      if (!originalName || !cleanName) continue;

      const baseServing = opt.base_serving || '1 serving';
      const baseCals = Math.round(opt.base_calories);
      const baseP = Math.round(opt.base_protein * 10) / 10;
      const baseC = Math.round(opt.base_carbs * 10) / 10;
      const baseF = Math.round(opt.base_fat * 10) / 10;
      const baseWeight = opt.base_weight_g ?? null;
      const cleanBrand = cleanTag(opt.brand);
      const cleanVariant = cleanTag(opt.variant);

      // 1. Migrate historical meal_logs:
      // Update canonical_name, food_name, brand, and variant, PRESERVING existing serving_size and macros!
      if (originalName !== cleanName || opt.brand !== undefined || opt.variant !== undefined) {
        const mealUpdateResult = await db.runAsync(
          `UPDATE meal_logs
           SET canonical_name = ?, food_name = ?,
               brand = COALESCE(?, brand),
               variant = COALESCE(?, variant)
           WHERE username = ? AND (canonical_name = ? OR (canonical_name IS NULL AND food_name = ?))`,
          [cleanName, cleanName, cleanBrand, cleanVariant, username, originalName, originalName]
        );
        migratedMealsCount += mealUpdateResult.changes;
      }

      // 2. Update or merge in food_catalog
      const existingClean = await db.getFirstAsync<{
        id: number;
        usage_count: number;
        source?: string;
        is_verified?: number;
      }>(
        `SELECT id, usage_count, source, is_verified FROM food_catalog WHERE username = ? AND canonical_name = ?`,
        [username, cleanName]
      );

      const oldItem = await db.getFirstAsync<{
        id: number;
        usage_count: number;
        source?: string;
        is_verified?: number;
      }>(
        `SELECT id, usage_count, source, is_verified FROM food_catalog WHERE username = ? AND canonical_name = ?`,
        [username, originalName]
      );

      // Never mutate authoritative base or verified barcode items
      if (oldItem && (oldItem.source === 'base' || oldItem.source === 'off' || oldItem.is_verified === 1)) {
        continue;
      }

      if (existingClean && oldItem && existingClean.id !== oldItem.id) {
        // Merge / Deduplication
        const isCleanProtected =
          existingClean.source === 'base' ||
          existingClean.source === 'off' ||
          existingClean.is_verified === 1;

        if (isCleanProtected) {
          // Destination is an authoritative base/verified item.
          // Merge usage count and adopt brand/variant if clean has none, but PRESERVE verified laboratory nutrition!
          await db.runAsync(
            `UPDATE food_catalog
             SET usage_count = usage_count + ?,
                 brand = COALESCE(brand, ?),
                 variant = COALESCE(variant, ?)
             WHERE id = ?`,
            [oldItem.usage_count, cleanBrand, cleanVariant, existingClean.id]
          );
        } else {
          await db.runAsync(
            `UPDATE food_catalog
             SET usage_count = usage_count + ?,
                 brand = COALESCE(?, brand),
                 variant = COALESCE(?, variant),
                 default_serving = COALESCE(?, default_serving),
                 calories = ?,
                 protein = ?,
                 carbs = ?,
                 fat = ?,
                 base_weight_g = COALESCE(?, base_weight_g)
              WHERE id = ?`,
            [oldItem.usage_count, cleanBrand, cleanVariant, baseServing, baseCals, baseP, baseC, baseF, baseWeight, existingClean.id]
          );
        }

        await db.runAsync(
          `DELETE FROM food_catalog WHERE id = ?`,
          [oldItem.id]
        );
        mergedCount++;
      } else {
        // Single item update or rename
        await db.runAsync(
          `UPDATE food_catalog
           SET canonical_name = ?,
               brand = COALESCE(?, brand),
               variant = COALESCE(?, variant),
               default_serving = ?,
               calories = ?,
               protein = ?,
               carbs = ?,
               fat = ?,
               base_weight_g = COALESCE(?, base_weight_g)
           WHERE username = ? AND canonical_name = ? AND (source IS NULL OR (source NOT IN ('base', 'off') AND is_verified = 0))`,
          [cleanName, cleanBrand, cleanVariant, baseServing, baseCals, baseP, baseC, baseF, baseWeight, username, originalName]
        );
        updatedCount++;
      }
    }
  });

  return { updatedCount, mergedCount, migratedMealsCount };
}


export async function updateCatalogLastUsedMeasurement(
  username = DEFAULT_USERNAME,
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
  isFasted?: boolean;
  totalCalories: number;
}

export async function logFastedDay(
  username = DEFAULT_USERNAME,
  date: string
): Promise<number> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM meal_logs WHERE username = ? AND date = ?', [username, date]);

  return await logMeal(username, {
    date,
    food_name: 'Fasted Day',
    canonical_name: 'Fasting',
    serving_size: 'Fasted',
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  });
}

export async function getMonthLogStatus(
  username = DEFAULT_USERNAME,
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

  // 3. Fetch directly from meal_logs (to detect meals, meal counts, and fasting)
  const meals = await db.getAllAsync<{
    date: string;
    total_calories: number;
    meal_count: number;
    is_fasted: number;
  }>(
    `SELECT date,
            SUM(calories) as total_calories,
            COUNT(*) as meal_count,
            MAX(CASE WHEN food_name = 'Fasted Day' OR canonical_name = 'Fasting' THEN 1 ELSE 0 END) as is_fasted
     FROM meal_logs
     WHERE username = ? AND date LIKE ?
     GROUP BY date`,
    [username, pattern]
  );
  for (const m of meals) {
    const cals = m.total_calories || 0;
    const isFasted = Boolean(m.is_fasted);
    const hasFood = cals > 0 || isFasted || m.meal_count > 0;

    if (!result[m.date]) {
      result[m.date] = {
        date: m.date,
        hasWeight: false,
        rawWeight: null,
        hasFood,
        isFasted,
        totalCalories: cals,
      };
    } else {
      result[m.date].hasFood = hasFood;
      result[m.date].isFasted = isFasted;
      result[m.date].totalCalories = cals;
    }
  }

  return result;
}

export async function getAppMetadata(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    [key]
  );
  return row ? row.value : null;
}

export async function setAppMetadata(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [key, value]
  );
}

export async function getAllScaleWeights(
  username = DEFAULT_USERNAME
): Promise<ScaleWeight[]> {
  const db = await getDatabase();
  return await db.getAllAsync<ScaleWeight>(
    'SELECT * FROM scale_weights WHERE username = ? ORDER BY date ASC',
    [username]
  );
}

export async function getAllMealLogs(
  username = DEFAULT_USERNAME
): Promise<MealLog[]> {
  const db = await getDatabase();
  return await db.getAllAsync<MealLog>(
    'SELECT * FROM meal_logs WHERE username = ? ORDER BY date ASC, id ASC',
    [username]
  );
}

export async function getCustomAndUsedFoodCatalogItems(
  username = DEFAULT_USERNAME
): Promise<FoodCatalogItem[]> {
  const db = await getDatabase();
  return await db.getAllAsync<FoodCatalogItem>(
    `SELECT * FROM food_catalog 
     WHERE username = ? 
       AND (source IS NULL OR source != 'base' OR usage_count > 1)
     ORDER BY usage_count DESC`,
    [username]
  );
}

export async function getAllAppMetadata(): Promise<Record<string, string>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM app_metadata'
  );
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

