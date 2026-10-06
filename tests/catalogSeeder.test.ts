import {
  seedBaseCatalogIfNeeded,
  CURRENT_BASE_CATALOG_VERSION,
  METADATA_KEY_BASE_CATALOG_VERSION,
} from '../src/services/catalogSeeder';
import * as dbMod from '../src/db/database';
import * as queries from '../src/db/queries';
import { BASE_FOOD_CATALOG } from '../src/data/baseCatalog';

jest.mock('../src/db/database');
jest.mock('../src/db/queries');

describe('Catalog Seeder Service', () => {
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      execAsync: jest.fn().mockResolvedValue(undefined),
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
      withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => {
        await cb();
      }),
    };
    (dbMod.getDatabase as jest.Mock).mockResolvedValue(mockDb);
  });

  it('skips seeding when catalog version already matches and force is false', async () => {
    (queries.getAppMetadata as jest.Mock).mockResolvedValue(CURRENT_BASE_CATALOG_VERSION);

    const result = await seedBaseCatalogIfNeeded('user', false);

    expect(result).toEqual({
      seeded: false,
      count: 0,
      version: CURRENT_BASE_CATALOG_VERSION,
    });
    expect(queries.getAppMetadata).toHaveBeenCalledWith(METADATA_KEY_BASE_CATALOG_VERSION);
    expect(dbMod.getDatabase).not.toHaveBeenCalled();
  });

  it('seeds baseline catalog when version is missing', async () => {
    (queries.getAppMetadata as jest.Mock).mockResolvedValue(null);

    const result = await seedBaseCatalogIfNeeded('user', false);

    expect(result.seeded).toBe(true);
    expect(result.count).toBe(BASE_FOOD_CATALOG.length);
    expect(result.version).toBe(CURRENT_BASE_CATALOG_VERSION);

    // Dropped triggers before insert
    expect(mockDb.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('DROP TRIGGER IF EXISTS food_catalog_ai')
    );

    // Transaction ran inserts
    expect(mockDb.withTransactionAsync).toHaveBeenCalled();
    expect(mockDb.runAsync).toHaveBeenCalledTimes(BASE_FOOD_CATALOG.length);

    // Rebuilt FTS5 in 1 pass
    expect(mockDb.execAsync).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO food_catalog_fts(food_catalog_fts) VALUES('rebuild')")
    );

    // Recreated triggers
    expect(mockDb.execAsync).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TRIGGER IF NOT EXISTS food_catalog_ai')
    );

    // Stored new version in metadata
    expect(queries.setAppMetadata).toHaveBeenCalledWith(
      METADATA_KEY_BASE_CATALOG_VERSION,
      CURRENT_BASE_CATALOG_VERSION
    );
  });

  it('forces re-seed when force=true even if version matches', async () => {
    (queries.getAppMetadata as jest.Mock).mockResolvedValue(CURRENT_BASE_CATALOG_VERSION);

    const result = await seedBaseCatalogIfNeeded('user', true);

    expect(result.seeded).toBe(true);
    expect(result.count).toBe(BASE_FOOD_CATALOG.length);
    expect(mockDb.withTransactionAsync).toHaveBeenCalled();
  });

  it('handles FTS5 rebuild errors gracefully on unsupported platforms', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (queries.getAppMetadata as jest.Mock).mockResolvedValue('old_version');

    // Make FTS rebuild fail
    mockDb.execAsync.mockImplementation(async (sql: string) => {
      if (sql.includes('food_catalog_fts')) {
        throw new Error('FTS5 not supported');
      }
    });

    const result = await seedBaseCatalogIfNeeded('user');

    expect(result.seeded).toBe(true);
    expect(result.count).toBe(BASE_FOOD_CATALOG.length);
    expect(queries.setAppMetadata).toHaveBeenCalledWith(
      METADATA_KEY_BASE_CATALOG_VERSION,
      CURRENT_BASE_CATALOG_VERSION
    );
    consoleSpy.mockRestore();
  });

  it('handles trigger drop error gracefully before seeding', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (queries.getAppMetadata as jest.Mock).mockResolvedValue(null);

    mockDb.execAsync.mockRejectedValueOnce(new Error('Cannot drop trigger'));

    const result = await seedBaseCatalogIfNeeded('user');

    expect(result.seeded).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not drop FTS triggers before catalog seed:'),
      expect.any(Error)
    );
    consoleSpy.mockRestore();
  });
});
