import {
  normalizeDate,
  findRowDate,
  buildServingSize,
  askGeminiForColumnMapping,
  pickAndInspectFile,
} from '../src/services/importer';
import * as DocumentPicker from 'expo-document-picker';
import * as keychain from '../src/services/keychain';
import * as dbMod from '../src/db/database';
import * as tdee from '../src/services/tdee';
import * as XLSX from 'xlsx';

jest.mock('expo-document-picker');
jest.mock('../src/services/keychain');
jest.mock('../src/db/database');
jest.mock('../src/services/tdee');

describe('Data Importer Parsing & Normalization Tests', () => {
  describe('normalizeDate', () => {
    it('preserves valid YYYY-MM-DD strings', () => {
      expect(normalizeDate('2024-03-21')).toBe('2024-03-21');
      expect(normalizeDate('  2023-12-31  ')).toBe('2023-12-31');
    });

    it('parses Excel serial date numbers', () => {
      // 45372 in Excel corresponds to March 21, 2024
      const result = normalizeDate(45372);
      expect(result).toMatch(/^2024-03-\d{2}$/);
    });

    it('parses MM/DD/YYYY dates with format hint or auto-detection', () => {
      expect(normalizeDate('04/18/2024', 'MM/DD/YYYY')).toBe('2024-04-18');
      expect(normalizeDate('11/05/2023')).toBe('2023-11-05');
    });

    it('parses DD/MM/YYYY dates when month exceeds 12 or hint provided', () => {
      // Day 25 > 12, so auto-detects DD/MM/YYYY
      expect(normalizeDate('25/08/2024')).toBe('2024-08-25');
      expect(normalizeDate('05/11/2023', 'DD/MM/YYYY')).toBe('2023-11-05');
    });

    it('returns null for empty or invalid date strings', () => {
      expect(normalizeDate('')).toBeNull();
      expect(normalizeDate(null)).toBeNull();
      expect(normalizeDate('not-a-date')).toBeNull();
    });
  });

  describe('findRowDate', () => {
    it('detects date column with standard header', () => {
      const row = { Date: '2024-03-21', Food: 'Apple', Calories: 95 };
      expect(findRowDate(row)).toBe('2024-03-21');
    });

    it('strips UTF-8 BOM characters and quotes from header keys', () => {
      const row = { '\uFEFF"Date"': '2024-05-10', Food: 'Banana' };
      expect(findRowDate(row)).toBe('2024-05-10');
    });

    it('detects case-insensitive date columns', () => {
      const row = { log_date: '2024-01-01', calories: 500 };
      expect(findRowDate(row)).toBe('2024-01-01');
    });

    it('returns null if no date header is present', () => {
      const row = { Food: 'Oatmeal', Calories: 150 };
      expect(findRowDate(row)).toBeNull();
    });
  });

  describe('buildServingSize', () => {
    it('formats quantity and unit nicely', () => {
      const row = {
        'Serving Qty': 2,
        'Serving Size': 'large egg',
      };
      expect(buildServingSize(row)).toBe('2 large egg');
    });

    it('includes weight in grams if available and unit is not already grams', () => {
      const row = {
        Quantity: '1',
        Unit: 'cup',
        'Weight (g)': '240',
      };
      expect(buildServingSize(row)).toBe('1 cup (240g)');
    });

    it('does not duplicate grams when unit is already grams', () => {
      const row = {
        Quantity: '150',
        Unit: 'g',
        'Weight (g)': '150',
      };
      expect(buildServingSize(row)).toBe('150 g');
    });

    it('falls back to "1 serving" when no quantity or unit columns are present', () => {
      const row = {
        'Food Name': 'Black Coffee',
        Calories: 5,
      };
      expect(buildServingSize(row)).toBe('1 serving');
    });
  });

  describe('askGeminiForColumnMapping', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      jest.clearAllMocks();
      (keychain.getGeminiModel as jest.Mock).mockResolvedValue('gemini-1.5-flash');
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('throws if Gemini API key is not configured', async () => {
      (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue(null);

      await expect(askGeminiForColumnMapping(['Date', 'Food'], [{ Date: '2024-01-01' }])).rejects.toThrow(
        'Gemini API key is required to detect custom spreadsheet formats.'
      );
    });

    it('successfully calls Gemini and returns parsed ColumnMapping', async () => {
      (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue('test-key');

      const mockMapping = {
        dataType: 'meals',
        dateColumn: 'Date',
        dateFormat: 'YYYY-MM-DD',
        foodNameColumn: 'Food',
        caloriesColumn: 'Cals',
        caloriesUnit: 'kcal',
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(mockMapping) }] } }],
        }),
      } as any);

      const res = await askGeminiForColumnMapping(['Date', 'Food', 'Cals'], [{ Date: '2024-01-01', Food: 'Apple', Cals: 95 }]);
      expect(res).toEqual(mockMapping);
    });

    it('throws if Gemini API returns HTTP error', async () => {
      (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue('test-key');

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
      } as any);

      await expect(askGeminiForColumnMapping(['Date'], [])).rejects.toThrow('Gemini mapping failed (403)');
    });
  });

  describe('pickAndInspectFile', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('returns null if document picker is cancelled', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: true,
      });

      const preview = await pickAndInspectFile('user');
      expect(preview).toBeNull();
    });

    it('parses JSON backup format with weights and meals and executes import', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            name: 'backup.json',
            uri: 'file:///path/to/backup.json',
          },
        ],
      });

      const jsonData = {
        weights: [{ date: '2026-09-01', raw_weight: 82.5 }],
        meals: [
          {
            date: '2026-09-01',
            food_name: 'Eggs',
            canonical_name: 'Whole Eggs',
            serving_size: '2 eggs',
            calories: 140,
            protein: 12,
            carbs: 1,
            fat: 10,
          },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        text: async () => JSON.stringify(jsonData),
      } as any);

      const mockStmt = {
        executeAsync: jest.fn().mockResolvedValue(undefined),
        finalizeAsync: jest.fn().mockResolvedValue(undefined),
      };

      const mockDb = {
        prepareAsync: jest.fn().mockResolvedValue(mockStmt),
        runAsync: jest.fn().mockResolvedValue(undefined),
        withTransactionAsync: jest.fn().mockImplementation(async (cb) => cb()),
      };
      (dbMod.getDatabase as jest.Mock).mockResolvedValue(mockDb);

      const preview = await pickAndInspectFile('user');
      expect(preview).not.toBeNull();
      expect(preview?.sourceFormat).toBe('CTRACKER JSON Export');
      expect(preview?.weightsCount).toBe(1);
      expect(preview?.mealsCount).toBe(1);
      expect(preview?.startDate).toBe('2026-09-01');
      expect(preview?.endDate).toBe('2026-09-01');

      const importResult = await preview!.executeImport();
      expect(importResult).toEqual({ weightsImported: 1, mealsImported: 1 });
      expect(tdee.recalculateUserTdee).toHaveBeenCalledWith('user');
    });

    it('parses Multi-Sheet Fitness Excel format (.xlsx)', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            name: 'fitness_log.xlsx',
            uri: 'file:///path/to/fitness_log.xlsx',
          },
        ],
      });

      const wb = XLSX.utils.book_new();
      const weightData = [{ Date: '2026-09-01', Weight: 80.5 }];
      const foodData = [
        {
          Date: '2026-09-01',
          'Food Name': 'Chicken Breast',
          'Calories (kcal)': 165,
          'Protein (g)': 31,
          'Carbs (g)': 0,
          'Fat (g)': 3.6,
          'Serving Qty': 100,
          'Serving Size': 'g',
        },
      ];

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(weightData), 'Scale Weight');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(foodData), 'Nutrition');
      const arrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      global.fetch = jest.fn().mockResolvedValue({
        arrayBuffer: async () => arrayBuffer,
      } as any);

      const preview = await pickAndInspectFile('user');
      expect(preview).not.toBeNull();
      expect(preview?.sourceFormat).toBe('Multi-Sheet Fitness Spreadsheet');
      expect(preview?.weightsCount).toBe(1);
      expect(preview?.mealsCount).toBe(1);
    });

    it('parses Standard Nutrition CSV format', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            name: 'nutrition.csv',
            uri: 'file:///path/to/nutrition.csv',
          },
        ],
      });

      const csvContent =
        'Date,Food Name,Serving Qty,Serving Size,Calories (kcal),Protein (g),Carbs (g),Fat (g)\n' +
        '2026-09-01,Oatmeal,1,cup,150,5,27,3\n';

      global.fetch = jest.fn().mockResolvedValue({
        text: async () => csvContent,
      } as any);

      const preview = await pickAndInspectFile('user');
      expect(preview).not.toBeNull();
      expect(preview?.sourceFormat).toBe('Standard Nutrition CSV');
      expect(preview?.mealsCount).toBe(1);
    });

    it('parses MyFitnessPal CSV format', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            name: 'mfp.csv',
            uri: 'file:///path/to/mfp.csv',
          },
        ],
      });

      const csvContent =
        'Date,Meal,Calories,Protein (g),Carbohydrates (g),Fat (g)\n' +
        '2026-09-01,Breakfast Burrito,450,22,48,18\n';

      global.fetch = jest.fn().mockResolvedValue({
        text: async () => csvContent,
      } as any);

      const preview = await pickAndInspectFile('user');
      expect(preview).not.toBeNull();
      expect(preview?.sourceFormat).toBe('MyFitnessPal CSV');
      expect(preview?.mealsCount).toBe(1);
    });

    it('parses Cronometer CSV format', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            name: 'cronometer.csv',
            uri: 'file:///path/to/cronometer.csv',
          },
        ],
      });

      const csvContent =
        'Date,Food Name,Energy (kcal),Protein (g),Carbs (g),Fat (g)\n' +
        '2026-09-01,Salmon,208,20,0,13\n';

      global.fetch = jest.fn().mockResolvedValue({
        text: async () => csvContent,
      } as any);

      const preview = await pickAndInspectFile('user');
      expect(preview).not.toBeNull();
      expect(preview?.sourceFormat).toBe('Cronometer CSV');
      expect(preview?.mealsCount).toBe(1);
    });

    it('parses Scale Weight CSV format', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            name: 'weights.csv',
            uri: 'file:///path/to/weights.csv',
          },
        ],
      });

      const csvContent =
        'Date,Weight (kg)\n' +
        '2026-09-01,81.4\n' +
        '2026-09-02,81.2\n';

      global.fetch = jest.fn().mockResolvedValue({
        text: async () => csvContent,
      } as any);

      const preview = await pickAndInspectFile('user');
      expect(preview).not.toBeNull();
      expect(preview?.sourceFormat).toBe('Scale Weight CSV');
      expect(preview?.weightsCount).toBe(2);
    });

    it('parses unrecognized CSV using AI mapping with unit conversions (kJ -> kcal, lbs -> kg)', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            name: 'custom_export.csv',
            uri: 'file:///path/to/custom_export.csv',
          },
        ],
      });

      const csvContent =
        'Timestamp,Item,Category,Notes,Energy_kJ,Protein_g,Carb_g,Fat_g,Weight_lbs\n' +
        '2026-09-01,Energy Bar,Snacks,Post-workout,1000,15,40,8,180\n';

      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('googleapis')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          dataType: 'both',
                          dateColumn: 'Timestamp',
                          dateFormat: 'YYYY-MM-DD',
                          foodNameColumn: 'Item',
                          caloriesColumn: 'Energy_kJ',
                          caloriesUnit: 'kJ',
                          weightColumn: 'Weight_lbs',
                          weightUnit: 'lbs',
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          text: async () => csvContent,
        });
      });

      (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue('test-key');
      (keychain.getGeminiModel as jest.Mock).mockResolvedValue('gemini-1.5-flash');

      const preview = await pickAndInspectFile('user');
      expect(preview).not.toBeNull();
      expect(preview?.sourceFormat).toBe('Smart CSV (AI Detected)');
      expect(preview?.weightsCount).toBe(1);
      expect(preview?.mealsCount).toBe(1);
    });

    it('parses General Single-Sheet Excel using AI mapping', async () => {
      (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
        canceled: false,
        assets: [
          {
            name: 'custom_sheet.xlsx',
            uri: 'file:///path/to/custom_sheet.xlsx',
          },
        ],
      });

      const wb = XLSX.utils.book_new();
      const customData = [{ LogDate: '2026-09-01', Dish: 'Pizza', Energy: 600 }];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(customData), 'Sheet1');
      const arrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('googleapis')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          dataType: 'meals',
                          dateColumn: 'LogDate',
                          dateFormat: 'YYYY-MM-DD',
                          foodNameColumn: 'Dish',
                          caloriesColumn: 'Energy',
                          caloriesUnit: 'kcal',
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          arrayBuffer: async () => arrayBuffer,
        });
      });

      (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue('test-key');
      (keychain.getGeminiModel as jest.Mock).mockResolvedValue('gemini-1.5-flash');

      const preview = await pickAndInspectFile('user');
      expect(preview).not.toBeNull();
      expect(preview?.sourceFormat).toBe('Smart Excel (meals)');
      expect(preview?.mealsCount).toBe(1);
    });
  });
});
