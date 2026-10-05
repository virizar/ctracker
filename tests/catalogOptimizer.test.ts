import { runFoodCatalogOptimization } from '../src/services/catalogOptimizer';
import * as queries from '../src/db/queries';
import * as nutritionAi from '../src/services/nutritionAi';
import * as tdee from '../src/services/tdee';
import { FoodCatalogItem, OptimizedFoodMapping } from '../src/types';

jest.mock('../src/db/queries');
jest.mock('../src/services/nutritionAi');
jest.mock('../src/services/tdee');

describe('Catalog Optimizer Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns zero counts when food catalog is empty', async () => {
    (queries.getOptimizableFoodCatalogItems as jest.Mock).mockResolvedValue([]);

    const result = await runFoodCatalogOptimization('user');

    expect(result).toEqual({
      totalProcessed: 0,
      updatedCount: 0,
      mergedCount: 0,
      migratedMealsCount: 0,
      aborted: false,
    });
    expect(nutritionAi.optimizeFoodCatalogBatch).not.toHaveBeenCalled();
    expect(tdee.recalculateUserTdee).not.toHaveBeenCalled();
  });

  it('processes items in batches and invokes progress callback', async () => {
    const mockItems: FoodCatalogItem[] = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      username: 'user',
      canonical_name: `Food Item ${i + 1}`,
      default_serving: '1 serving',
      calories: 100 + i,
      protein: 10,
      carbs: 10,
      fat: 2,
      usage_count: 1,
      source: 'ai',
      is_verified: 0,
    }));

    (queries.getOptimizableFoodCatalogItems as jest.Mock).mockResolvedValue(mockItems);
    (nutritionAi.optimizeFoodCatalogBatch as jest.Mock).mockImplementation((chunk) => {
      return chunk.map((item: FoodCatalogItem) => ({
        original_name: item.canonical_name,
        clean_name: item.canonical_name.trim(),
        base_serving: '1 unit',
        base_calories: item.calories,
        base_protein: item.protein,
        base_carbs: item.carbs,
        base_fat: item.fat,
      }));
    });

    (queries.applyFoodCatalogOptimizations as jest.Mock)
      .mockResolvedValueOnce({ updatedCount: 20, mergedCount: 5, migratedMealsCount: 8 })
      .mockResolvedValueOnce({ updatedCount: 4, mergedCount: 1, migratedMealsCount: 2 });

    const progressReports: Array<{ processed: number; total: number }> = [];
    const onProgress = (processed: number, total: number) => {
      progressReports.push({ processed, total });
    };

    const result = await runFoodCatalogOptimization('user', onProgress);

    expect(queries.getOptimizableFoodCatalogItems).toHaveBeenCalledWith('user');
    expect(nutritionAi.optimizeFoodCatalogBatch).toHaveBeenCalledTimes(2);
    expect(queries.applyFoodCatalogOptimizations).toHaveBeenCalledTimes(2);
    expect(tdee.recalculateUserTdee).toHaveBeenCalledWith('user');

    expect(result).toEqual({
      totalProcessed: 30,
      updatedCount: 24,
      mergedCount: 6,
      migratedMealsCount: 10,
      aborted: false,
    });

    expect(progressReports).toEqual([
      { processed: 25, total: 30 },
      { processed: 30, total: 30 },
    ]);
  });

  it('handles batch optimization errors gracefully and continues', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mockItems: FoodCatalogItem[] = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      username: 'user',
      canonical_name: `Food Item ${i + 1}`,
      default_serving: '1 serving',
      calories: 100,
      protein: 10,
      carbs: 10,
      fat: 2,
      usage_count: 1,
      source: 'imported',
    }));

    (queries.getOptimizableFoodCatalogItems as jest.Mock).mockResolvedValue(mockItems);
    (nutritionAi.optimizeFoodCatalogBatch as jest.Mock)
      .mockRejectedValueOnce(new Error('AI Rate Limit'))
      .mockResolvedValueOnce([
        {
          original_name: 'Food Item 26',
          clean_name: 'Food Item 26',
          base_serving: '1 serving',
          base_calories: 100,
          base_protein: 10,
          base_carbs: 10,
          base_fat: 2,
        },
      ]);

    (queries.applyFoodCatalogOptimizations as jest.Mock).mockResolvedValue({
      updatedCount: 1,
      mergedCount: 0,
      migratedMealsCount: 0,
    });

    const result = await runFoodCatalogOptimization('user');

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Error optimizing catalog batch [0..25]:'),
      expect.any(Error)
    );
    expect(result.updatedCount).toBe(1);
    expect(tdee.recalculateUserTdee).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('aborts early when AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    (queries.getOptimizableFoodCatalogItems as jest.Mock).mockResolvedValue([
      {
        id: 1,
        username: 'user',
        canonical_name: 'Apple',
        default_serving: '1 medium',
        calories: 95,
        protein: 0.5,
        carbs: 25,
        fat: 0.3,
        usage_count: 5,
        source: 'ai',
      },
    ]);

    const result = await runFoodCatalogOptimization('user', undefined, controller.signal);

    expect(result.aborted).toBe(true);
    expect(nutritionAi.optimizeFoodCatalogBatch).not.toHaveBeenCalled();
  });

  it('aborts during processing when AbortSignal is aborted during batch execution', async () => {
    const controller = new AbortController();

    const mockItems: FoodCatalogItem[] = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      username: 'user',
      canonical_name: `Food Item ${i + 1}`,
      default_serving: '1 serving',
      calories: 100,
      protein: 10,
      carbs: 10,
      fat: 2,
      usage_count: 1,
      source: 'ai',
    }));

    (queries.getOptimizableFoodCatalogItems as jest.Mock).mockResolvedValue(mockItems);
    (nutritionAi.optimizeFoodCatalogBatch as jest.Mock).mockImplementation(async () => {
      controller.abort();
      return [];
    });

    const result = await runFoodCatalogOptimization('user', undefined, controller.signal);

    expect(result.aborted).toBe(true);
    expect(nutritionAi.optimizeFoodCatalogBatch).toHaveBeenCalledTimes(1);
  });

  it('aborts when AbortSignal is triggered during progress reporting', async () => {
    const controller = new AbortController();

    const mockItems: FoodCatalogItem[] = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      username: 'user',
      canonical_name: `Food Item ${i + 1}`,
      default_serving: '1 serving',
      calories: 100,
      protein: 10,
      carbs: 10,
      fat: 2,
      usage_count: 1,
      source: 'imported',
    }));

    (queries.getOptimizableFoodCatalogItems as jest.Mock).mockResolvedValue(mockItems);
    (nutritionAi.optimizeFoodCatalogBatch as jest.Mock).mockResolvedValue([]);

    const onProgress = () => {
      controller.abort();
    };

    const result = await runFoodCatalogOptimization('user', onProgress, controller.signal);

    expect(result.aborted).toBe(true);
    expect(nutritionAi.optimizeFoodCatalogBatch).toHaveBeenCalledTimes(1);
  });

  it('queries only optimizable food catalog items, strictly shielding base and verified items', async () => {
    const optimizableMockItems: FoodCatalogItem[] = [
      {
        id: 1,
        username: 'user',
        canonical_name: 'Raw oats from import',
        default_serving: '100g',
        calories: 389,
        protein: 16.9,
        carbs: 66.3,
        fat: 6.9,
        usage_count: 2,
        source: 'imported',
        is_verified: 0,
      },
    ];

    (queries.getOptimizableFoodCatalogItems as jest.Mock).mockResolvedValue(optimizableMockItems);
    (nutritionAi.optimizeFoodCatalogBatch as jest.Mock).mockResolvedValue([
      {
        original_name: 'Raw oats from import',
        clean_name: 'Rolled Oats',
        base_serving: '100g',
        base_calories: 389,
        base_protein: 16.9,
        base_carbs: 66.3,
        base_fat: 6.9,
      },
    ]);
    (queries.applyFoodCatalogOptimizations as jest.Mock).mockResolvedValue({
      updatedCount: 1,
      mergedCount: 0,
      migratedMealsCount: 1,
    });

    const result = await runFoodCatalogOptimization('user');

    expect(queries.getOptimizableFoodCatalogItems).toHaveBeenCalledWith('user');
    expect(nutritionAi.optimizeFoodCatalogBatch).toHaveBeenCalledWith(optimizableMockItems);
    expect(result.updatedCount).toBe(1);
  });
});
