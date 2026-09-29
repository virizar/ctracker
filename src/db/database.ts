import * as SQLite from 'expo-sqlite';
import { UserProfile } from '../types';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export const DB_NAME = 'ctracker.db';

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) {
    return dbInstance;
  }

  const db = await SQLite.openDatabaseAsync(DB_NAME);

  // Enable WAL mode & foreign keys for high performance
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);

  await initializeSchema(db);
  dbInstance = db;
  return db;
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
      default_serving TEXT,
      calories REAL NOT NULL,
      protein REAL NOT NULL,
      carbs REAL NOT NULL,
      fat REAL NOT NULL,
      usage_count INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(username, canonical_name)
    );

    CREATE INDEX IF NOT EXISTS idx_meal_logs_user_date ON meal_logs(username, date);
    CREATE INDEX IF NOT EXISTS idx_scale_weights_user_date ON scale_weights(username, date);
    CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_date ON daily_summaries(username, date);

    -- Full-text search table for Food Catalog
    CREATE VIRTUAL TABLE IF NOT EXISTS food_catalog_fts USING fts5(
      canonical_name,
      username UNINDEXED,
      content='food_catalog',
      tokenize='porter unicode61'
    );

    -- Auto-sync triggers for FTS5
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

  // Seed default user profile if none exists
  const existingUser = await db.getFirstAsync<UserProfile>(
    'SELECT * FROM user_profiles WHERE username = ?',
    ['victor']
  );

  if (!existingUser) {
    await db.runAsync(
      `INSERT INTO user_profiles (
        username, dob, height_cm, sex, activity_multiplier,
        target_weight_kg, target_monthly_rate_kg, min_daily_calories,
        protein_ratio, carbs_ratio, fat_ratio
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'victor',
        '1987-12-07',
        185.0,
        'male',
        1.2,
        85.0,
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
    await db.runAsync('DELETE FROM food_catalog_fts');
    // Reset user profile to defaults
    await db.runAsync('DELETE FROM user_profiles');
    await db.runAsync(
      `INSERT INTO user_profiles (
        username, dob, height_cm, sex, activity_multiplier,
        target_weight_kg, target_monthly_rate_kg, min_daily_calories,
        protein_ratio, carbs_ratio, fat_ratio
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'victor',
        '1987-12-07',
        185.0,
        'male',
        1.2,
        85.0,
        -2.0,
        1500.0,
        0.30,
        0.40,
        0.30,
      ]
    );
  });
}
