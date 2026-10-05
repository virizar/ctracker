import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { UserProfile, DEFAULT_USERNAME } from '../types';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export const DB_NAME = 'ctracker.db';

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = (async () => {
    try {
      const db = await SQLite.openDatabaseAsync(DB_NAME);

      // Enable WAL mode on native (web OPFS uses its own synchronous access locking)
      if (Platform.OS !== 'web') {
        await db.execAsync(`
          PRAGMA journal_mode = WAL;
          PRAGMA foreign_keys = ON;
        `);
      } else {
        await db.execAsync(`
          PRAGMA foreign_keys = ON;
        `);
      }

      await initializeSchema(db);
      dbInstance = db;
      return db;
    } catch (err) {
      dbPromise = null;
      throw err;
    }
  })();

  return dbPromise;
}

export async function initializeSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      dob TEXT NOT NULL,
      height_cm REAL NOT NULL,
      sex TEXT NOT NULL,
      activity_multiplier REAL NOT NULL DEFAULT 1.2,
      target_rate_kg_per_week REAL NOT NULL DEFAULT -0.5,
      target_weight_kg REAL,
      target_monthly_rate_kg REAL NOT NULL DEFAULT -2.0,
      min_daily_calories REAL NOT NULL DEFAULT 1500.0,
      protein_ratio REAL NOT NULL DEFAULT 0.30,
      carbs_ratio REAL NOT NULL DEFAULT 0.40,
      fat_ratio REAL NOT NULL DEFAULT 0.30,
      name TEXT,
      loss_pace TEXT DEFAULT 'balanced',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS scale_weights (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      date TEXT NOT NULL,
      raw_weight REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(username, date)
    );

    CREATE TABLE IF NOT EXISTS meal_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      date TEXT NOT NULL,
      food_name TEXT NOT NULL,
      canonical_name TEXT,
      brand TEXT,
      variant TEXT,
      serving_size TEXT,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      client_event_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      date TEXT NOT NULL,
      total_calories REAL NOT NULL DEFAULT 0.0,
      total_protein REAL NOT NULL DEFAULT 0.0,
      total_carbs REAL NOT NULL DEFAULT 0.0,
      total_fat REAL NOT NULL DEFAULT 0.0,
      raw_weight REAL,
      trend_weight REAL,
      tdee REAL,
      target_calories REAL,
      is_rate_capped_by_safety_floor INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(username, date)
    );

    CREATE TABLE IF NOT EXISTS food_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      brand TEXT,
      variant TEXT,
      barcode TEXT,
      default_serving TEXT,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      base_weight_g REAL,
      last_used_qty REAL DEFAULT 1.0,
      last_used_unit TEXT,
      usage_count INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(username, canonical_name)
    );

    CREATE INDEX IF NOT EXISTS idx_meal_logs_user_date ON meal_logs(username, date);
    CREATE INDEX IF NOT EXISTS idx_scale_weights_user_date ON scale_weights(username, date);
    CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date ON daily_summaries(username, date);
  `);

  // Full-text search table for Food Catalog (available on native SQLite; falls back on Web)
  try {
    await db.execAsync(`
      CREATE VIRTUAL TABLE IF NOT EXISTS food_catalog_fts USING fts5(
        canonical_name,
        username UNINDEXED,
        content='food_catalog',
        tokenize='porter unicode61'
      );

      CREATE TRIGGER IF NOT EXISTS food_catalog_ai AFTER INSERT ON food_catalog BEGIN
        INSERT INTO food_catalog_fts(rowid, canonical_name, username)
        VALUES (new.id, new.canonical_name, new.username);
      END;

      CREATE TRIGGER IF NOT EXISTS food_catalog_ad AFTER DELETE ON food_catalog BEGIN
        INSERT INTO food_catalog_fts(food_catalog_fts, rowid, canonical_name, username)
        VALUES ('delete', old.id, old.canonical_name, old.username);
      END;

      CREATE TRIGGER IF NOT EXISTS food_catalog_au AFTER UPDATE ON food_catalog BEGIN
        INSERT INTO food_catalog_fts(food_catalog_fts, rowid, canonical_name, username)
        VALUES ('delete', old.id, old.canonical_name, old.username);
        INSERT INTO food_catalog_fts(rowid, canonical_name, username)
        VALUES (new.id, new.canonical_name, new.username);
      END;
    `);
  } catch (err) {
    console.warn('FTS5 virtual table not supported on this platform/engine, using standard SQL fallback:', err);
  }

  // Safe migrations for food_catalog extra columns
  try {
    await db.execAsync('ALTER TABLE food_catalog ADD COLUMN base_weight_g REAL;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE food_catalog ADD COLUMN last_used_qty REAL DEFAULT 1.0;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE food_catalog ADD COLUMN last_used_unit TEXT;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE food_catalog ADD COLUMN brand TEXT;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE food_catalog ADD COLUMN variant TEXT;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE food_catalog ADD COLUMN barcode TEXT;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE meal_logs ADD COLUMN brand TEXT;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE meal_logs ADD COLUMN variant TEXT;');
  } catch {}
  try {
    await db.execAsync('ALTER TABLE user_profiles ADD COLUMN name TEXT;');
  } catch {}
  try {
    await db.execAsync("ALTER TABLE user_profiles ADD COLUMN loss_pace TEXT DEFAULT 'balanced';");
  } catch {}

  // Clean up any literal 'null', 'undefined', 'none' placeholder strings from brand or variant
  try {
    await db.execAsync(`
      UPDATE food_catalog SET brand = NULL WHERE LOWER(TRIM(brand)) IN ('null', 'undefined', 'none', 'n/a', 'generic', '');
      UPDATE food_catalog SET variant = NULL WHERE LOWER(TRIM(variant)) IN ('null', 'undefined', 'none', 'n/a', 'generic', '');
      UPDATE meal_logs SET brand = NULL WHERE LOWER(TRIM(brand)) IN ('null', 'undefined', 'none', 'n/a', 'generic', '');
      UPDATE meal_logs SET variant = NULL WHERE LOWER(TRIM(variant)) IN ('null', 'undefined', 'none', 'n/a', 'generic', '');
    `);
  } catch {}

  // Migrate any legacy 'victor' user records to DEFAULT_USERNAME
  try {
    await db.execAsync(`
      UPDATE user_profiles SET username = '${DEFAULT_USERNAME}' WHERE username = 'victor';
      UPDATE meal_logs SET username = '${DEFAULT_USERNAME}' WHERE username = 'victor';
      UPDATE scale_weights SET username = '${DEFAULT_USERNAME}' WHERE username = 'victor';
      UPDATE daily_summaries SET username = '${DEFAULT_USERNAME}' WHERE username = 'victor';
      UPDATE food_catalog SET username = '${DEFAULT_USERNAME}' WHERE username = 'victor';
    `);
  } catch {}

  // Seed default user profile if none exists
  const existingUser = await db.getFirstAsync<UserProfile>(
    'SELECT * FROM user_profiles ORDER BY id ASC LIMIT 1'
  );

  if (!existingUser) {
    await db.runAsync(
      `INSERT INTO user_profiles (
        username, name, dob, height_cm, sex, activity_multiplier,
        target_weight_kg, target_monthly_rate_kg, min_daily_calories,
        protein_ratio, carbs_ratio, fat_ratio
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_USERNAME,
        'User',
        '1990-01-01',
        175.0,
        'male',
        1.2,
        75.0,
        -2.0,
        1500.0,
        0.30,
        0.40,
        0.30,
      ]
    );
  }
}

export async function wipeAllUserData(): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM meal_logs');
    await db.runAsync('DELETE FROM scale_weights');
    await db.runAsync('DELETE FROM daily_summaries');
    await db.runAsync('DELETE FROM food_catalog');
    try {
      await db.runAsync('DELETE FROM food_catalog_fts');
    } catch {}
    // Reset user profile to defaults
    await db.runAsync('DELETE FROM user_profiles');
    await db.runAsync(
      `INSERT INTO user_profiles (
        username, name, dob, height_cm, sex, activity_multiplier,
        target_weight_kg, target_monthly_rate_kg, min_daily_calories,
        protein_ratio, carbs_ratio, fat_ratio
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        DEFAULT_USERNAME,
        'User',
        '1990-01-01',
        175.0,
        'male',
        1.2,
        75.0,
        -2.0,
        1500.0,
        0.30,
        0.40,
        0.30,
      ]
    );
  });
}
