import {
  parseOffNutriments,
  fetchProductFromOpenFoodFacts,
  lookupFoodByBarcode,
} from '../src/services/openFoodFacts';
import * as queries from '../src/db/queries';

jest.mock('../src/db/queries');

describe('Open Food Facts Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseOffNutriments', () => {
    it('prefers energy-kcal_serving over 100g metrics', () => {
      const nutriments = {
        'energy-kcal_serving': 150,
        'energy-kcal_100g': 100,
        proteins_serving: 12.5,
        proteins_100g: 8.3,
        carbohydrates_serving: 20.0,
        carbohydrates_100g: 13.3,
        fat_serving: 3.2,
        fat_100g: 2.1,
      };

      const result = parseOffNutriments(nutriments);
      expect(result).toEqual({
        calories: 150,
        protein: 12.5,
        carbs: 20.0,
        fat: 3.2,
      });
    });

    it('falls back to energy-kcal_100g when serving metric is missing', () => {
      const nutriments = {
        'energy-kcal_100g': 250,
        proteins_100g: 15.0,
        carbohydrates_100g: 30.0,
        fat_100g: 5.0,
      };

      const result = parseOffNutriments(nutriments);
      expect(result).toEqual({
        calories: 250,
        protein: 15.0,
        carbs: 30.0,
        fat: 5.0,
      });
    });

    it('converts energy_100g (kJ) to kcal when kcal fields are missing', () => {
      const nutriments = {
        energy_100g: 1046, // ~250 kcal
        proteins_100g: 10.0,
        carbohydrates_100g: 20.0,
        fat_100g: 2.0,
      };

      const result = parseOffNutriments(nutriments);
      expect(result.calories).toBe(250);
    });

    it('uses general energy-kcal when specific 100g or serving fields are missing', () => {
      const nutriments = {
        'energy-kcal': 180,
        proteins: 5,
        carbohydrates: 25,
        fat: 7,
      };

      const result = parseOffNutriments(nutriments);
      expect(result).toEqual({
        calories: 180,
        protein: 5.0,
        carbs: 25.0,
        fat: 7.0,
      });
    });

    it('handles empty or missing nutriments gracefully with zeros', () => {
      expect(parseOffNutriments({})).toEqual({
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
      });
      expect(parseOffNutriments(undefined)).toEqual({
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
      });
    });
  });

  describe('fetchProductFromOpenFoodFacts', () => {
    it('returns null for empty barcode', async () => {
      const result = await fetchProductFromOpenFoodFacts('   ');
      expect(result).toBeNull();
    });

    it('returns null when API response status is not 200', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as any);

      const result = await fetchProductFromOpenFoodFacts('012345678905');
      expect(result).toBeNull();
    });

    it('returns null when product status is not 1 (not found in OFF database)', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 0, status_verbose: 'product not found' }),
      } as any);

      const result = await fetchProductFromOpenFoodFacts('012345678905');
      expect(result).toBeNull();
    });

    it('parses and returns valid Open Food Facts product', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 1,
          product: {
            product_name: 'Total Greek Yogurt 0%',
            brands: 'Fage, Fage Dairy',
            serving_size: '170g',
            serving_quantity: 170,
            nutriments: {
              'energy-kcal_100g': 54,
              proteins_100g: 10.3,
              carbohydrates_100g: 3.0,
              fat_100g: 0.0,
            },
          },
        }),
      } as any);

      const result = await fetchProductFromOpenFoodFacts('5201051001077');
      expect(result).toEqual({
        barcode: '5201051001077',
        food_name: 'Total Greek Yogurt 0%',
        brand: 'Fage',
        serving_size: '170g',
        calories: 54,
        protein: 10.3,
        carbs: 3.0,
        fat: 0.0,
        base_weight_g: 170,
      });
    });

    it('handles network exceptions gracefully and returns null', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      global.fetch = jest.fn().mockRejectedValue(new Error('Network timeout'));

      const result = await fetchProductFromOpenFoodFacts('5201051001077');
      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe('lookupFoodByBarcode', () => {
    it('returns local catalog item immediately without network fetch', async () => {
      const localItem = {
        id: 42,
        username: 'user',
        canonical_name: 'Cached Oats',
        barcode: '123456789012',
        calories: 380,
        protein: 13,
        carbs: 68,
        fat: 7,
        usage_count: 5,
        source: 'off',
        is_verified: 1,
      };

      (queries.getFoodCatalogItemByBarcode as jest.Mock).mockResolvedValue(localItem);
      global.fetch = jest.fn();

      const result = await lookupFoodByBarcode('user', '123456789012');

      expect(result).toEqual(localItem);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('fetches from Open Food Facts and caches into food_catalog with source=off', async () => {
      (queries.getFoodCatalogItemByBarcode as jest.Mock).mockResolvedValue(null);

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 1,
          product: {
            product_name: 'Barilla Spaghetti No 5',
            brands: 'Barilla',
            serving_size: '100g',
            serving_quantity: 100,
            nutriments: {
              'energy-kcal_100g': 359,
              proteins_100g: 12.0,
              carbohydrates_100g: 71.2,
              fat_100g: 2.0,
            },
          },
        }),
      } as any);

      const cachedFoodItem = {
        id: 99,
        username: 'user',
        canonical_name: 'Barilla Spaghetti No 5',
        brand: 'Barilla',
        barcode: '8076809513753',
        default_serving: '100g',
        calories: 359,
        protein: 12.0,
        carbs: 71.2,
        fat: 2.0,
        base_weight_g: 100,
        usage_count: 1,
        source: 'off',
        is_verified: 1,
      };

      (queries.upsertFoodCatalog as jest.Mock).mockResolvedValue(undefined);
      (queries.getFoodCatalogItem as jest.Mock).mockResolvedValue(cachedFoodItem);

      const result = await lookupFoodByBarcode('user', '8076809513753');

      expect(queries.upsertFoodCatalog).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'user',
          canonical_name: 'Barilla Spaghetti No 5',
          brand: 'Barilla',
          barcode: '8076809513753',
          source: 'off',
          is_verified: 1,
        })
      );
      expect(result).toEqual(cachedFoodItem);
    });

    it('returns null when product is not found locally or on Open Food Facts', async () => {
      (queries.getFoodCatalogItemByBarcode as jest.Mock).mockResolvedValue(null);
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 0 }),
      } as any);

      const result = await lookupFoodByBarcode('user', '999999999999');
      expect(result).toBeNull();
      expect(queries.upsertFoodCatalog).not.toHaveBeenCalled();
    });
  });
});
