import { Platform } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Papa from 'papaparse';
import appConfig from '../../app.json';
import { getDatabase } from '../db/database';
import {
  getUserProfile,
  updateUserProfile,
  getAllScaleWeights,
  getAllMealLogs,
  getCustomAndUsedFoodCatalogItems,
  getAllAppMetadata,
  getAppMetadata,
  setAppMetadata,
} from '../db/queries';
import { recalculateUserTdee, formatDate } from './tdee';
import {
  UserProfile,
  ScaleWeight,
  MealLog,
  FoodCatalogItem,
  DEFAULT_USERNAME,
} from '../types';

export const CURRENT_BACKUP_FORMAT_VERSION = 1;
export const METADATA_KEY_AUTO_SAFETY_SNAPSHOT = 'last_safety_snapshot_json';
export const METADATA_KEY_AUTO_SAFETY_SNAPSHOT_META = 'last_safety_snapshot_meta';

export interface BackupDataV1 {
  profile: UserProfile | null;
  weights: Array<{
    date: string;
    raw_weight: number;
    created_at?: string;
  }>;
  meals: Array<{
    date: string;
    food_name: string;
    canonical_name?: string | null;
    brand?: string | null;
    variant?: string | null;
    serving_size?: string | null;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    client_event_id?: string | null;
    created_at?: string;
  }>;
  custom_catalog: Array<
    Partial<FoodCatalogItem> & {
      canonical_name: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }
  >;
  app_metadata?: Record<string, string>;
}

export interface BackupPayloadV1 {
  app: 'ctracker';
  backup_format_version: number;
  app_version: string;
  exported_at: string;
  device_platform: string;
  data: BackupDataV1;
  snapshot_reason?: string;
}

export interface BackupValidationResult {
  valid: boolean;
  error?: string;
  payload?: BackupPayloadV1;
  summary?: {
    formatVersion: number;
    appVersion: string;
    exportedAt: string;
    weightsCount: number;
    mealsCount: number;
    customFoodsCount: number;
    hasProfile: boolean;
  };
}

export interface RestoreSummary {
  weightsRestored: number;
  mealsRestored: number;
  customFoodsRestored: number;
  profileRestored: boolean;
  mode: 'merge' | 'replace';
}

/**
 * Validates a candidate backup JSON structure and checks format compatibility.
 */
export function validateBackupPayload(raw: any): BackupValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Backup content is not a valid JSON object.' };
  }

  if (raw.app !== 'ctracker') {
    return {
      valid: false,
      error: 'Unrecognized backup file. Missing CTracker application signature.',
    };
  }

  const formatVersion = Number(raw.backup_format_version);
  if (isNaN(formatVersion) || formatVersion < 1) {
    return { valid: false, error: 'Invalid or missing backup_format_version.' };
  }

  if (formatVersion > CURRENT_BACKUP_FORMAT_VERSION) {
    return {
      valid: false,
      error: `This backup was created with a newer version of CTracker (backup format v${formatVersion}). Please update CTracker to restore this file.`,
    };
  }

  if (!raw.data || typeof raw.data !== 'object') {
    return { valid: false, error: 'Backup is missing payload data section.' };
  }

  const weights = Array.isArray(raw.data.weights) ? raw.data.weights : [];
  const meals = Array.isArray(raw.data.meals) ? raw.data.meals : [];
  const customCatalog = Array.isArray(raw.data.custom_catalog) ? raw.data.custom_catalog : [];
  const profile = raw.data.profile && typeof raw.data.profile === 'object' ? raw.data.profile : null;

  return {
    valid: true,
    payload: raw as BackupPayloadV1,
    summary: {
      formatVersion,
      appVersion: String(raw.app_version || 'unknown'),
      exportedAt: String(raw.exported_at || new Date().toISOString()),
      weightsCount: weights.length,
      mealsCount: meals.length,
      customFoodsCount: customCatalog.length,
      hasProfile: profile !== null,
    },
  };
}

/**
 * Normalizes legacy backup fields into current schema representations.
 */
export function migrateBackupPayloadIfNeeded(payload: BackupPayloadV1): BackupPayloadV1 {
  const migrated = JSON.parse(JSON.stringify(payload)) as BackupPayloadV1;

  // Clean meals
  migrated.data.meals = (migrated.data.meals || []).map((m) => ({
    date: String(m.date),
    food_name: String(m.food_name || 'Food'),
    canonical_name: m.canonical_name ?? null,
    brand: m.brand ?? null,
    variant: m.variant ?? null,
    serving_size: m.serving_size ?? '1 serving',
    calories: Math.max(0, Number(m.calories) || 0),
    protein: Math.max(0, Number(m.protein) || 0),
    carbs: Math.max(0, Number(m.carbs) || 0),
    fat: Math.max(0, Number(m.fat) || 0),
    client_event_id: m.client_event_id ?? null,
    created_at: m.created_at ?? undefined,
  }));

  // Clean weights
  migrated.data.weights = (migrated.data.weights || []).map((w) => ({
    date: String(w.date),
    raw_weight: Number(w.raw_weight) || 0,
    created_at: w.created_at ?? undefined,
  }));

  // Clean custom catalog items
  migrated.data.custom_catalog = (migrated.data.custom_catalog || []).map((c) => ({
    ...c,
    canonical_name: String(c.canonical_name || ''),
    calories: Math.max(0, Number(c.calories) || 0),
    protein: Math.max(0, Number(c.protein) || 0),
    carbs: Math.max(0, Number(c.carbs) || 0),
    fat: Math.max(0, Number(c.fat) || 0),
    source: c.source ?? 'custom',
    usage_count: Math.max(1, Number(c.usage_count) || 1),
  }));

  return migrated;
}

/**
 * Assembles the full versioned backup envelope from local SQLite database.
 */
export async function generateBackupPayload(
  username = DEFAULT_USERNAME
): Promise<BackupPayloadV1> {
  const profile = await getUserProfile(username);
  const weights = await getAllScaleWeights(username);
  const meals = await getAllMealLogs(username);
  const customCatalog = await getCustomAndUsedFoodCatalogItems(username);
  const rawMetadata = await getAllAppMetadata();

  // Strip internal/sensitive keys from metadata
  const safeMetadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawMetadata)) {
    if (
      !k.includes('secret') &&
      !k.includes('api_key') &&
      k !== METADATA_KEY_AUTO_SAFETY_SNAPSHOT &&
      k !== METADATA_KEY_AUTO_SAFETY_SNAPSHOT_META
    ) {
      safeMetadata[k] = v;
    }
  }

  const appVersion = appConfig?.expo?.version || '1.8.0';

  return {
    app: 'ctracker',
    backup_format_version: CURRENT_BACKUP_FORMAT_VERSION,
    app_version: appVersion,
    exported_at: new Date().toISOString(),
    device_platform: Platform.OS,
    data: {
      profile,
      weights: weights.map((w) => ({
        date: w.date,
        raw_weight: w.raw_weight,
        created_at: w.created_at,
      })),
      meals: meals.map((m) => ({
        date: m.date,
        food_name: m.food_name,
        canonical_name: m.canonical_name,
        brand: m.brand,
        variant: m.variant,
        serving_size: m.serving_size,
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        client_event_id: m.client_event_id,
        created_at: m.created_at,
      })),
      custom_catalog: customCatalog,
      app_metadata: safeMetadata,
    },
  };
}

/**
 * Downloads a string file in web browser.
 */
function downloadWebFile(filename: string, content: string, mimeType: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function getExportDateString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Exports complete application state as a versioned JSON file.
 */
export async function exportBackupJson(
  username = DEFAULT_USERNAME
): Promise<{ success: boolean; filename: string; uri?: string }> {
  const payload = await generateBackupPayload(username);
  const jsonStr = JSON.stringify(payload, null, 2);
  const dateStr = getExportDateString();
  const filename = `ctracker_backup_${dateStr}.json`;

  if (Platform.OS === 'web') {
    downloadWebFile(filename, jsonStr, 'application/json');
    return { success: true, filename };
  }

  // Native iOS / Android
  try {
    const file = new File(Paths.cache, filename);
    file.create({ overwrite: true });
    file.write(jsonStr);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Export CTracker Backup',
        UTI: 'public.json',
      });
    }

    return { success: true, filename, uri: file.uri };
  } catch (err) {
    console.error('Failed to export backup file on native:', err);
    throw err;
  }
}

/**
 * Saves complete backup directly to a user-selected folder on the device (Downloads/Documents/Internal Storage).
 */
export async function saveBackupToDevice(
  username = DEFAULT_USERNAME
): Promise<{ success: boolean; canceled?: boolean; filename: string }> {
  const payload = await generateBackupPayload(username);
  const jsonStr = JSON.stringify(payload, null, 2);
  const dateStr = getExportDateString();
  const filename = `ctracker_backup_${dateStr}.json`;

  if (Platform.OS === 'web') {
    downloadWebFile(filename, jsonStr, 'application/json');
    return { success: true, filename };
  }

  try {
    const dir = await Directory.pickDirectoryAsync();
    const file = dir.createFile(filename, 'application/json');
    file.write(jsonStr);
    return { success: true, filename };
  } catch (err: any) {
    if (
      err?.message?.includes('cancel') ||
      err?.name === 'PickerCancelledException' ||
      err?.message?.includes('User canceled')
    ) {
      return { success: false, canceled: true, filename };
    }
    console.warn('Directory picker failed, falling back to share sheet:', err);
    return await exportBackupJson(username);
  }
}

/**
 * Exports user health data into flat CSV tables suitable for Excel or Google Sheets.
 */
export async function exportCsvSpreadsheets(
  username = DEFAULT_USERNAME,
  mode: 'weights' | 'meals' | 'both' = 'both'
): Promise<{ success: boolean; filenames: string[] }> {
  const dateStr = getExportDateString();
  const filenames: string[] = [];

  // 1. Export Scale Weights CSV
  if (mode === 'weights' || mode === 'both') {
    const weights = await getAllScaleWeights(username);
    const weightRows = weights.map((w) => ({
      Date: w.date,
      'Weight (kg)': w.raw_weight,
      'Recorded At': w.created_at || w.date,
    }));

    const csvContent = Papa.unparse(weightRows);
    const filename = `ctracker_weights_${dateStr}.csv`;
    filenames.push(filename);

    if (Platform.OS === 'web') {
      downloadWebFile(filename, csvContent, 'text/csv');
    } else {
      const file = new File(Paths.cache, filename);
      file.create({ overwrite: true });
      file.write(csvContent);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: 'Export Weights CSV',
          UTI: 'public.comma-separated-values-text',
        });
      }
    }
  }

  // 2. Export Meal Logs CSV
  if (mode === 'meals' || mode === 'both') {
    const meals = await getAllMealLogs(username);
    const mealRows = meals.map((m) => ({
      Date: m.date,
      'Food Name': m.food_name,
      Brand: m.brand || '',
      Variant: m.variant || '',
      'Serving Size': m.serving_size || '',
      'Calories (kcal)': m.calories,
      'Protein (g)': m.protein,
      'Carbs (g)': m.carbs,
      'Fat (g)': m.fat,
      'Logged At': m.created_at || m.date,
    }));

    const csvContent = Papa.unparse(mealRows);
    const filename = `ctracker_meals_${dateStr}.csv`;
    filenames.push(filename);

    if (Platform.OS === 'web') {
      downloadWebFile(filename, csvContent, 'text/csv');
    } else {
      const file = new File(Paths.cache, filename);
      file.create({ overwrite: true });
      file.write(csvContent);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'text/csv',
          dialogTitle: 'Export Meal Logs CSV',
          UTI: 'public.comma-separated-values-text',
        });
      }
    }
  }

  return { success: true, filenames };
}

/**
 * Saves flat CSV spreadsheets directly to a user-selected folder on the device (Downloads/Documents).
 */
export async function saveCsvToDevice(
  username = DEFAULT_USERNAME,
  mode: 'weights' | 'meals' | 'both' = 'both'
): Promise<{ success: boolean; canceled?: boolean; filenames: string[] }> {
  const dateStr = getExportDateString();
  const filenames: string[] = [];

  if (Platform.OS === 'web') {
    return await exportCsvSpreadsheets(username, mode);
  }

  try {
    const dir = await Directory.pickDirectoryAsync();

    if (mode === 'weights' || mode === 'both') {
      const weights = await getAllScaleWeights(username);
      const weightRows = weights.map((w) => ({
        Date: w.date,
        'Weight (kg)': w.raw_weight,
        'Recorded At': w.created_at || w.date,
      }));

      const csvContent = Papa.unparse(weightRows);
      const filename = `ctracker_weights_${dateStr}.csv`;
      const file = dir.createFile(filename, 'text/csv');
      file.write(csvContent);
      filenames.push(filename);
    }

    if (mode === 'meals' || mode === 'both') {
      const meals = await getAllMealLogs(username);
      const mealRows = meals.map((m) => ({
        Date: m.date,
        'Food Name': m.food_name,
        Brand: m.brand || '',
        Variant: m.variant || '',
        'Serving Size': m.serving_size || '',
        'Calories (kcal)': m.calories,
        'Protein (g)': m.protein,
        'Carbs (g)': m.carbs,
        'Fat (g)': m.fat,
        'Logged At': m.created_at || m.date,
      }));

      const csvContent = Papa.unparse(mealRows);
      const filename = `ctracker_meals_${dateStr}.csv`;
      const file = dir.createFile(filename, 'text/csv');
      file.write(csvContent);
      filenames.push(filename);
    }

    return { success: true, filenames };
  } catch (err: any) {
    if (
      err?.message?.includes('cancel') ||
      err?.name === 'PickerCancelledException' ||
      err?.message?.includes('User canceled')
    ) {
      return { success: false, canceled: true, filenames };
    }
    console.warn('Directory picker failed, falling back to share sheet:', err);
    return await exportCsvSpreadsheets(username, mode);
  }
}

/**
 * Creates an automatic safety snapshot and persists it locally.
 */
export async function createAutoSafetySnapshot(
  username = DEFAULT_USERNAME,
  reason = 'manual'
): Promise<void> {
  try {
    const payload = await generateBackupPayload(username);
    payload.snapshot_reason = reason;
    const jsonStr = JSON.stringify(payload);

    await setAppMetadata(METADATA_KEY_AUTO_SAFETY_SNAPSHOT, jsonStr);
    await setAppMetadata(
      METADATA_KEY_AUTO_SAFETY_SNAPSHOT_META,
      JSON.stringify({
        date: payload.exported_at,
        reason,
        weightsCount: payload.data.weights.length,
        mealsCount: payload.data.meals.length,
      })
    );
  } catch (err) {
    console.warn('Could not record auto safety snapshot:', err);
  }
}

/**
 * Retrieves information about the last recorded safety snapshot.
 */
export async function getLatestAutoSafetySnapshot(): Promise<{
  exists: boolean;
  date?: string;
  reason?: string;
  weightsCount?: number;
  mealsCount?: number;
  payload?: BackupPayloadV1;
}> {
  try {
    const metaStr = await getAppMetadata(METADATA_KEY_AUTO_SAFETY_SNAPSHOT_META);
    const jsonStr = await getAppMetadata(METADATA_KEY_AUTO_SAFETY_SNAPSHOT);

    if (!jsonStr) {
      return { exists: false };
    }

    const payload = JSON.parse(jsonStr) as BackupPayloadV1;
    const meta = metaStr ? JSON.parse(metaStr) : null;

    return {
      exists: true,
      date: meta?.date || payload.exported_at,
      reason: meta?.reason || payload.snapshot_reason || 'automatic',
      weightsCount: meta?.weightsCount ?? payload.data.weights.length,
      mealsCount: meta?.mealsCount ?? payload.data.meals.length,
      payload,
    };
  } catch {
    return { exists: false };
  }
}

/**
 * Restores application state from a verified backup payload.
 */
export async function restoreBackup(
  rawPayload: BackupPayloadV1,
  username = DEFAULT_USERNAME,
  mode: 'merge' | 'replace' = 'merge'
): Promise<RestoreSummary> {
  const validation = validateBackupPayload(rawPayload);
  if (!validation.valid || !validation.payload) {
    throw new Error(validation.error || 'Invalid backup payload.');
  }

  // Pre-snapshot safety capture
  await createAutoSafetySnapshot(username, `pre-restore-${mode}`);

  const payload = migrateBackupPayloadIfNeeded(validation.payload);
  const db = await getDatabase();

  let weightsRestored = 0;
  let mealsRestored = 0;
  let customFoodsRestored = 0;
  let profileRestored = false;

  await db.withTransactionAsync(async () => {
    if (mode === 'replace') {
      // Clean previous user records while preserving verified baseline catalog
      await db.runAsync('DELETE FROM meal_logs WHERE username = ?', [username]);
      await db.runAsync('DELETE FROM scale_weights WHERE username = ?', [username]);
      await db.runAsync('DELETE FROM daily_summaries WHERE username = ?', [username]);
      await db.runAsync("DELETE FROM food_catalog WHERE username = ? AND source = 'custom'", [
        username,
      ]);
    }

    // 1. Restore User Profile
    if (payload.data.profile) {
      const p = payload.data.profile;
      await updateUserProfile(username, {
        name: p.name,
        dob: p.dob,
        height_cm: p.height_cm,
        sex: p.sex,
        activity_multiplier: p.activity_multiplier,
        target_weight_kg: p.target_weight_kg,
        target_monthly_rate_kg: p.target_monthly_rate_kg,
        min_daily_calories: p.min_daily_calories,
        protein_ratio: p.protein_ratio,
        carbs_ratio: p.carbs_ratio,
        fat_ratio: p.fat_ratio,
        loss_pace: p.loss_pace,
      });
      profileRestored = true;
    }

    // 2. Restore Scale Weights
    for (const w of payload.data.weights) {
      await db.runAsync(
        `INSERT INTO scale_weights (username, date, raw_weight, created_at)
         VALUES (?, ?, ?, COALESCE(?, datetime('now')))
         ON CONFLICT(username, date) DO UPDATE SET
           raw_weight = excluded.raw_weight`,
        [username, w.date, w.raw_weight, w.created_at || null]
      );
      weightsRestored++;
    }

    // 3. Restore Meal Logs
    for (const m of payload.data.meals) {
      if (mode === 'merge') {
        // Prevent exact duplicates during merge
        const existing = await db.getFirstAsync<{ id: number }>(
          `SELECT id FROM meal_logs 
           WHERE username = ? AND date = ? AND food_name = ? AND calories = ? AND protein = ?
           LIMIT 1`,
          [username, m.date, m.food_name, m.calories, m.protein]
        );
        if (existing) {
          continue;
        }
      }

      await db.runAsync(
        `INSERT INTO meal_logs (
          username, date, food_name, canonical_name, brand, variant,
          serving_size, calories, protein, carbs, fat, client_event_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
        [
          username,
          m.date,
          m.food_name,
          m.canonical_name || null,
          m.brand || null,
          m.variant || null,
          m.serving_size || '1 serving',
          m.calories,
          m.protein,
          m.carbs,
          m.fat,
          m.client_event_id || null,
          m.created_at || null,
        ]
      );
      mealsRestored++;
    }

    // 4. Restore Custom Foods Library & Catalog Usage
    for (const item of payload.data.custom_catalog) {
      const aliasStr =
        Array.isArray((item as any).aliases) && (item as any).aliases.length > 0
          ? (item as any).aliases.join(', ')
          : typeof (item as any).aliases === 'string'
          ? (item as any).aliases
          : null;

      await db.runAsync(
        `INSERT INTO food_catalog (
          username, canonical_name, brand, variant, barcode, aliases, default_serving,
          calories, protein, carbs, fat, base_weight_g, usage_count, source, is_verified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(username, canonical_name) DO UPDATE SET
          usage_count = MAX(food_catalog.usage_count, excluded.usage_count),
          calories = CASE WHEN food_catalog.source = 'custom' THEN excluded.calories ELSE food_catalog.calories END,
          protein = CASE WHEN food_catalog.source = 'custom' THEN excluded.protein ELSE food_catalog.protein END,
          carbs = CASE WHEN food_catalog.source = 'custom' THEN excluded.carbs ELSE food_catalog.carbs END,
          fat = CASE WHEN food_catalog.source = 'custom' THEN excluded.fat ELSE food_catalog.fat END`,
        [
          username,
          item.canonical_name,
          item.brand || null,
          item.variant || null,
          item.barcode || null,
          aliasStr,
          item.default_serving || '100 g',
          item.calories,
          item.protein,
          item.carbs,
          item.fat,
          item.base_weight_g ?? null,
          item.usage_count || 1,
          item.source || 'custom',
          item.is_verified ? 1 : 0,
        ]
      );
      customFoodsRestored++;
    }
  });

  // Rebuild TDEE, trend weights, and daily targets from restored raw logs
  try {
    await recalculateUserTdee(username);
  } catch (err) {
    console.warn('Could not recalculate TDEE after backup restore:', err);
  }

  return {
    weightsRestored,
    mealsRestored,
    customFoodsRestored,
    profileRestored,
    mode,
  };
}

/**
 * Restores the latest local auto safety snapshot.
 */
export async function restoreAutoSafetySnapshot(
  username = DEFAULT_USERNAME,
  mode: 'merge' | 'replace' = 'replace'
): Promise<RestoreSummary> {
  const snapshot = await getLatestAutoSafetySnapshot();
  if (!snapshot.exists || !snapshot.payload) {
    throw new Error('No safety snapshot found on this device.');
  }

  return await restoreBackup(snapshot.payload, username, mode);
}
