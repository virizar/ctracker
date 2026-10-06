import { getDatabase } from '../db/database';
import { getAppMetadata, setAppMetadata } from '../db/queries';
import { BASE_FOOD_CATALOG } from '../data/baseCatalog';
import { DEFAULT_USERNAME } from '../types';

export const CURRENT_BASE_CATALOG_VERSION = '2026.1';
export const METADATA_KEY_BASE_CATALOG_VERSION = 'base_catalog_version';

export interface SeedCatalogResult {
  seeded: boolean;
  count: number;
  version: string;
}

/**
 * Seeds or updates the verified baseline food catalog (Option C architecture).
 *
 * Performance Architecture:
 * - Checks app_metadata for CURRENT_BASE_CATALOG_VERSION (0ms on normal app boots).
 * - When an update is detected, temporarily drops per-row FTS5 triggers to prevent trigger thrashing.
 * - Executes bulk upsert inside a single atomic SQLite transaction with ON CONFLICT resolution:
 *     1. If food is new -> inserted with source='base' and is_verified=1.
 *     2. If existing food was already 'base' -> nutrition refreshed from laboratory baseline,
 *        while preserving user usage history (usage_count, last_used_at).
 *     3. If existing food is 'custom', 'ai', or 'imported' -> left untouched.
 * - Rebuilds the FTS5 virtual table in a single vectorized pass.
 * - Re-creates triggers and sets new version flag.
 */
export async function seedBaseCatalogIfNeeded(
  username = DEFAULT_USERNAME,
  force = false
): Promise<SeedCatalogResult> {
  const existingVersion = await getAppMetadata(METADATA_KEY_BASE_CATALOG_VERSION);
  if (!force && existingVersion === CURRENT_BASE_CATALOG_VERSION) {
    return {
      seeded: false,
      count: 0,
      version: existingVersion,
    };
  }

  const db = await getDatabase();

  // Temporarily disable per-row FTS triggers for high-speed bulk ingestion
  try {
    await db.execAsync(`
      DROP TRIGGER IF EXISTS food_catalog_ai;
      DROP TRIGGER IF EXISTS food_catalog_au;
      DROP TRIGGER IF EXISTS food_catalog_ad;
      PRAGMA synchronous = OFF;
    `);
  } catch (err) {
    console.warn('Could not drop FTS triggers before catalog seed:', err);
  }

  await db.withTransactionAsync(async () => {
    // Upsert baseline items in bulk
    for (const item of BASE_FOOD_CATALOG) {
      await db.runAsync(
        `INSERT INTO food_catalog (
          username, canonical_name, brand, variant, default_serving,
          calories, protein, carbs, fat, base_weight_g, usage_count, source, is_verified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'base', 1)
        ON CONFLICT(username, canonical_name) DO UPDATE SET
          calories = CASE WHEN food_catalog.source = 'base' THEN excluded.calories ELSE food_catalog.calories END,
          protein = CASE WHEN food_catalog.source = 'base' THEN excluded.protein ELSE food_catalog.protein END,
          carbs = CASE WHEN food_catalog.source = 'base' THEN excluded.carbs ELSE food_catalog.carbs END,
          fat = CASE WHEN food_catalog.source = 'base' THEN excluded.fat ELSE food_catalog.fat END,
          base_weight_g = CASE WHEN food_catalog.source = 'base' THEN excluded.base_weight_g ELSE food_catalog.base_weight_g END,
          default_serving = CASE WHEN food_catalog.source = 'base' THEN excluded.default_serving ELSE food_catalog.default_serving END,
          source = CASE WHEN food_catalog.source = 'base' THEN 'base' ELSE food_catalog.source END,
          is_verified = CASE WHEN food_catalog.source = 'base' THEN 1 ELSE food_catalog.is_verified END,
          usage_count = food_catalog.usage_count,
          last_used_at = food_catalog.last_used_at`,
        [
          username,
          item.canonical_name,
          item.brand || null,
          item.variant || null,
          item.default_serving,
          item.calories,
          item.protein,
          item.carbs,
          item.fat,
          item.base_weight_g ?? null,
        ]
      );
    }

    // Vectorized FTS5 full rebuild
    try {
      await db.execAsync(`
        INSERT INTO food_catalog_fts(food_catalog_fts) VALUES('rebuild');
      `);
    } catch {
      // Platform may not support FTS5 virtual table
    }

    // Recreate triggers for future incremental meal/custom additions
    try {
      await db.execAsync(`
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

        PRAGMA synchronous = NORMAL;
      `);
    } catch (err) {
      console.warn('Could not recreate FTS triggers after catalog seed:', err);
    }
  });

  // Record completed seed version in metadata
  await setAppMetadata(METADATA_KEY_BASE_CATALOG_VERSION, CURRENT_BASE_CATALOG_VERSION);

  return {
    seeded: true,
    count: BASE_FOOD_CATALOG.length,
    version: CURRENT_BASE_CATALOG_VERSION,
  };
}
