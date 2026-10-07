import {
  CURRENT_BACKUP_FORMAT_VERSION,
  validateBackupPayload,
  migrateBackupPayloadIfNeeded,
  generateBackupPayload,
  exportBackupJson,
  saveBackupToDevice,
  exportCsvSpreadsheets,
  saveCsvToDevice,
  createAutoSafetySnapshot,
  getLatestAutoSafetySnapshot,
  restoreAutoSafetySnapshot,
  restoreBackup,
  BackupPayloadV1,
} from '../src/services/backupService';
import * as dbMod from '../src/db/database';
import * as queries from '../src/db/queries';
import * as tdee from '../src/services/tdee';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

jest.mock('../src/db/database');
jest.mock('../src/db/queries');
jest.mock('../src/services/tdee');
jest.mock('expo-sharing');
jest.mock('expo-file-system', () => {
  const mockFile = {
    uri: 'file:///cache/test',
    create: jest.fn(),
    write: jest.fn(),
  };
  const mockDir = {
    uri: 'file:///device/Documents',
    createFile: jest.fn().mockReturnValue(mockFile),
  };
  return {
    Paths: { cache: 'file:///cache' },
    File: jest.fn().mockImplementation((path, filename) => ({
      uri: `${path}/${filename}`,
      create: jest.fn(),
      write: jest.fn(),
    })),
    Directory: Object.assign(
      jest.fn().mockImplementation(() => mockDir),
      {
        pickDirectoryAsync: jest.fn().mockResolvedValue(mockDir),
      }
    ),
  };
});

describe('Backup & Restore Service', () => {
  let mockDb: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = {
      runAsync: jest.fn().mockResolvedValue({ changes: 1, lastInsertRowId: 1 }),
      getFirstAsync: jest.fn().mockResolvedValue(null),
      getAllAsync: jest.fn().mockResolvedValue([]),
      withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => {
        await cb();
      }),
    };
    (dbMod.getDatabase as jest.Mock).mockResolvedValue(mockDb);
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
    (tdee.recalculateUserTdee as jest.Mock).mockResolvedValue(undefined);
  });

  describe('Validation & Schema Protection', () => {
    it('validates a compliant v1 backup file', () => {
      const raw: BackupPayloadV1 = {
        app: 'ctracker',
        backup_format_version: 1,
        app_version: '1.8.0',
        exported_at: '2026-10-07T21:00:00Z',
        device_platform: 'android',
        data: {
          profile: {
            username: 'victor',
            dob: '1990-01-01',
            height_cm: 180,
            sex: 'male',
            activity_multiplier: 1.2,
            target_weight_kg: 75.0,
            target_monthly_rate_kg: -2.0,
            min_daily_calories: 1500,
            protein_ratio: 0.3,
            carbs_ratio: 0.4,
            fat_ratio: 0.3,
          },
          weights: [{ date: '2026-10-01', raw_weight: 80.5 }],
          meals: [
            {
              date: '2026-10-01',
              food_name: 'Eggs',
              calories: 140,
              protein: 12,
              carbs: 1,
              fat: 10,
            },
          ],
          custom_catalog: [
            {
              canonical_name: 'Custom Shake',
              calories: 250,
              protein: 30,
              carbs: 5,
              fat: 3,
              source: 'custom',
            },
          ],
        },
      };

      const result = validateBackupPayload(raw);
      expect(result.valid).toBe(true);
      expect(result.summary).toEqual({
        formatVersion: 1,
        appVersion: '1.8.0',
        exportedAt: '2026-10-07T21:00:00Z',
        weightsCount: 1,
        mealsCount: 1,
        customFoodsCount: 1,
        hasProfile: true,
      });
    });

    it('rejects invalid or corrupted payload', () => {
      expect(validateBackupPayload(null).valid).toBe(false);
      expect(validateBackupPayload('bad string').valid).toBe(false);
      expect(validateBackupPayload({ app: 'other_app' }).valid).toBe(false);
      expect(
        validateBackupPayload({ app: 'ctracker', backup_format_version: 'invalid' }).valid
      ).toBe(false);
    });

    it('rejects backup created by newer future app version', () => {
      const future = {
        app: 'ctracker',
        backup_format_version: 99,
        data: { weights: [], meals: [], custom_catalog: [] },
      };
      const result = validateBackupPayload(future);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('newer version of CTracker (backup format v99)');
    });
  });

  describe('Migration Pipeline', () => {
    it('normalizes dirty and missing fields to safe schema defaults', () => {
      const raw: any = {
        app: 'ctracker',
        backup_format_version: 1,
        app_version: '1.0.0',
        exported_at: '2026-01-01',
        device_platform: 'ios',
        data: {
          profile: null,
          weights: [{ date: '2026-01-01', raw_weight: '75.5' }],
          meals: [
            {
              date: '2026-01-01',
              food_name: null,
              calories: '200',
              protein: null,
              carbs: undefined,
              fat: -5, // clamped to 0
            },
          ],
          custom_catalog: [
            {
              canonical_name: 'Test',
              calories: '100',
              protein: '10',
              carbs: '2',
              fat: '1',
              usage_count: null,
            },
          ],
        },
      };

      const migrated = migrateBackupPayloadIfNeeded(raw);
      expect(migrated.data.weights[0].raw_weight).toBe(75.5);
      expect(migrated.data.meals[0].food_name).toBe('Food');
      expect(migrated.data.meals[0].calories).toBe(200);
      expect(migrated.data.meals[0].protein).toBe(0);
      expect(migrated.data.meals[0].fat).toBe(0);
      expect(migrated.data.custom_catalog[0].usage_count).toBe(1);
    });
  });

  describe('Export Functions', () => {
    it('generates a complete backup payload and strips sensitive metadata', async () => {
      (queries.getUserProfile as jest.Mock).mockResolvedValue({ username: 'user', dob: '1995-01-01' });
      (queries.getAllScaleWeights as jest.Mock).mockResolvedValue([
        { date: '2026-10-01', raw_weight: 81.0 },
      ]);
      (queries.getAllMealLogs as jest.Mock).mockResolvedValue([
        { date: '2026-10-01', food_name: 'Apple', calories: 95, protein: 0.5, carbs: 25, fat: 0.3 },
      ]);
      (queries.getCustomAndUsedFoodCatalogItems as jest.Mock).mockResolvedValue([
        { canonical_name: 'Oats', calories: 350, protein: 12, carbs: 60, fat: 6 },
      ]);
      (queries.getAllAppMetadata as jest.Mock).mockResolvedValue({
        base_catalog_version: '2026.2',
        secret_api_key: 'AI_SECRET_KEY_NEVER_EXPORT',
        gemini_api_key: 'GEMINI_SECRET',
      });

      const payload = await generateBackupPayload('user');

      expect(payload.app).toBe('ctracker');
      expect(payload.backup_format_version).toBe(CURRENT_BACKUP_FORMAT_VERSION);
      expect(payload.data.weights.length).toBe(1);
      expect(payload.data.meals.length).toBe(1);
      expect(payload.data.custom_catalog.length).toBe(1);
      expect(payload.data.app_metadata).toEqual({ base_catalog_version: '2026.2' });
      expect(payload.data.app_metadata?.secret_api_key).toBeUndefined();
      expect(payload.data.app_metadata?.gemini_api_key).toBeUndefined();
    });

    it('exports JSON and shares via expo-sharing on native', async () => {
      (queries.getUserProfile as jest.Mock).mockResolvedValue(null);
      (queries.getAllScaleWeights as jest.Mock).mockResolvedValue([]);
      (queries.getAllMealLogs as jest.Mock).mockResolvedValue([]);
      (queries.getCustomAndUsedFoodCatalogItems as jest.Mock).mockResolvedValue([]);
      (queries.getAllAppMetadata as jest.Mock).mockResolvedValue({});

      const result = await exportBackupJson('user');

      expect(result.success).toBe(true);
      expect(result.filename).toMatch(/^ctracker_backup_\d{4}-\d{2}-\d{2}\.json$/);
      expect(Sharing.shareAsync).toHaveBeenCalledWith(
        expect.stringContaining(result.filename),
        expect.objectContaining({ mimeType: 'application/json' })
      );
    });

    it('exports CSV spreadsheets for weights and meals', async () => {
      (queries.getAllScaleWeights as jest.Mock).mockResolvedValue([
        { date: '2026-10-01', raw_weight: 82.3, created_at: '2026-10-01 08:00:00' },
      ]);
      (queries.getAllMealLogs as jest.Mock).mockResolvedValue([
        {
          date: '2026-10-01',
          food_name: 'Oatmeal',
          brand: 'Quaker',
          variant: 'Rolled',
          serving_size: '50 g',
          calories: 190,
          protein: 7,
          carbs: 32,
          fat: 3,
        },
      ]);

      const result = await exportCsvSpreadsheets('user', 'both');

      expect(result.success).toBe(true);
      expect(result.filenames.length).toBe(2);
      expect(result.filenames[0]).toContain('ctracker_weights_');
      expect(result.filenames[1]).toContain('ctracker_meals_');
      expect(Sharing.shareAsync).toHaveBeenCalledTimes(2);
    });

    it('saves backup directly to device directory using folder picker', async () => {
      const { Directory } = require('expo-file-system');
      const mockDir = await Directory.pickDirectoryAsync();
      const mockFile = mockDir.createFile();

      (queries.getUserProfile as jest.Mock).mockResolvedValue(null);
      (queries.getAllScaleWeights as jest.Mock).mockResolvedValue([]);
      (queries.getAllMealLogs as jest.Mock).mockResolvedValue([]);
      (queries.getCustomAndUsedFoodCatalogItems as jest.Mock).mockResolvedValue([]);
      (queries.getAllAppMetadata as jest.Mock).mockResolvedValue({});

      const result = await saveBackupToDevice('user');

      expect(result.success).toBe(true);
      expect(mockDir.createFile).toHaveBeenCalledWith(
        result.filename,
        'application/json'
      );
      expect(mockFile.write).toHaveBeenCalled();
    });

    it('saves CSV directly to device directory using folder picker', async () => {
      const { Directory } = require('expo-file-system');
      const mockDir = await Directory.pickDirectoryAsync();
      const mockFile = mockDir.createFile();

      (queries.getAllScaleWeights as jest.Mock).mockResolvedValue([
        { date: '2026-10-01', raw_weight: 80.0 },
      ]);
      (queries.getAllMealLogs as jest.Mock).mockResolvedValue([]);

      const result = await saveCsvToDevice('user', 'weights');

      expect(result.success).toBe(true);
      expect(result.filenames.length).toBe(1);
      expect(mockDir.createFile).toHaveBeenCalledWith(
        result.filenames[0],
        'text/csv'
      );
      expect(mockFile.write).toHaveBeenCalled();
    });
  });

  describe('Restore Functions', () => {
    const validPayload: BackupPayloadV1 = {
      app: 'ctracker',
      backup_format_version: 1,
      app_version: '1.8.0',
      exported_at: '2026-10-07T21:00:00Z',
      device_platform: 'android',
      data: {
        profile: {
          username: 'user',
          dob: '1990-01-01',
          height_cm: 180,
          sex: 'male',
          activity_multiplier: 1.2,
          target_weight_kg: 75.0,
          target_monthly_rate_kg: -2.0,
          min_daily_calories: 1500,
          protein_ratio: 0.3,
          carbs_ratio: 0.4,
          fat_ratio: 0.3,
        },
        weights: [{ date: '2026-10-01', raw_weight: 80.5 }],
        meals: [
          {
            date: '2026-10-01',
            food_name: 'Eggs',
            calories: 140,
            protein: 12,
            carbs: 1,
            fat: 10,
          },
        ],
        custom_catalog: [
          {
            canonical_name: 'Custom Shake',
            calories: 250,
            protein: 30,
            carbs: 5,
            fat: 3,
            source: 'custom',
          },
        ],
      },
    };

    it('performs clean replace restore', async () => {
      const summary = await restoreBackup(validPayload, 'user', 'replace');

      expect(summary.mode).toBe('replace');
      expect(summary.weightsRestored).toBe(1);
      expect(summary.mealsRestored).toBe(1);
      expect(summary.customFoodsRestored).toBe(1);
      expect(summary.profileRestored).toBe(true);

      // Verify deletion queries were run
      expect(mockDb.runAsync).toHaveBeenCalledWith('DELETE FROM meal_logs WHERE username = ?', ['user']);
      expect(mockDb.runAsync).toHaveBeenCalledWith('DELETE FROM scale_weights WHERE username = ?', ['user']);
      expect(mockDb.runAsync).toHaveBeenCalledWith('DELETE FROM daily_summaries WHERE username = ?', ['user']);

      // Verify TDEE recalculation was invoked
      expect(tdee.recalculateUserTdee).toHaveBeenCalledWith('user');
    });

    it('performs merge restore without wiping data and skips duplicate meals', async () => {
      // Simulate that the meal already exists
      mockDb.getFirstAsync.mockResolvedValueOnce({ id: 99 });

      const summary = await restoreBackup(validPayload, 'user', 'merge');

      expect(summary.mode).toBe('merge');
      expect(summary.weightsRestored).toBe(1);
      expect(summary.mealsRestored).toBe(0); // skipped duplicate
      expect(summary.customFoodsRestored).toBe(1);

      // Verify no deletions occurred
      expect(mockDb.runAsync).not.toHaveBeenCalledWith(
        'DELETE FROM meal_logs WHERE username = ?',
        ['user']
      );
      expect(tdee.recalculateUserTdee).toHaveBeenCalledWith('user');
    });

    it('creates and recovers from auto safety snapshot', async () => {
      (queries.getUserProfile as jest.Mock).mockResolvedValue({ username: 'user' });
      (queries.getAllScaleWeights as jest.Mock).mockResolvedValue([]);
      (queries.getAllMealLogs as jest.Mock).mockResolvedValue([]);
      (queries.getCustomAndUsedFoodCatalogItems as jest.Mock).mockResolvedValue([]);
      (queries.getAllAppMetadata as jest.Mock).mockResolvedValue({});

      await createAutoSafetySnapshot('user', 'pre-wipe');

      expect(queries.setAppMetadata).toHaveBeenCalledWith(
        'last_safety_snapshot_json',
        expect.any(String)
      );

      // Simulate retrieval
      (queries.getAppMetadata as jest.Mock).mockImplementation(async (key: string) => {
        if (key === 'last_safety_snapshot_meta') {
          return JSON.stringify({ date: '2026-10-07T21:00:00Z', reason: 'pre-wipe', weightsCount: 0, mealsCount: 0 });
        }
        if (key === 'last_safety_snapshot_json') {
          return JSON.stringify(validPayload);
        }
        return null;
      });

      const snapshotInfo = await getLatestAutoSafetySnapshot();
      expect(snapshotInfo.exists).toBe(true);
      expect(snapshotInfo.reason).toBe('pre-wipe');

      const restoreResult = await restoreAutoSafetySnapshot('user', 'replace');
      expect(restoreResult.weightsRestored).toBe(1);
    });
  });
});
