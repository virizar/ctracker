import { getAllFoodCatalogItems, applyFoodCatalogOptimizations } from '../db/queries';
import { optimizeFoodCatalogBatch } from './gemini';
import { FoodOptimizationResult, DEFAULT_USERNAME } from '../types';
import { recalculateUserTdee } from './tdee';

export interface CatalogOptimizationExecutionResult extends FoodOptimizationResult {
  aborted?: boolean;
}

/**
 * Runs the AI-driven food catalog optimizer across all items in a user's food catalog.
 * Normalizes verbose food names, deduces 1-unit baseline portions, deduplicates entries,
 * and safely cascades name migrations to historical meal logs without altering recorded calorie sums.
 * Supports cancellation via AbortSignal.
 */
export async function runFoodCatalogOptimization(
  username = DEFAULT_USERNAME,
  onProgress?: (processed: number, total: number) => void,
  signal?: AbortSignal
): Promise<CatalogOptimizationExecutionResult> {
  const allItems = await getAllFoodCatalogItems(username);
  if (allItems.length === 0) {
    return {
      totalProcessed: 0,
      updatedCount: 0,
      mergedCount: 0,
      migratedMealsCount: 0,
      aborted: false,
    };
  }

  let totalUpdated = 0;
  let totalMerged = 0;
  let totalMigratedMeals = 0;
  let wasAborted = false;

  const BATCH_SIZE = 25;
  for (let i = 0; i < allItems.length; i += BATCH_SIZE) {
    if (signal?.aborted) {
      wasAborted = true;
      break;
    }

    const chunk = allItems.slice(i, i + BATCH_SIZE);
    try {
      const mappings = await optimizeFoodCatalogBatch(chunk);
      if (signal?.aborted) {
        wasAborted = true;
        break;
      }
      if (mappings.length > 0) {
        const res = await applyFoodCatalogOptimizations(username, mappings);
        totalUpdated += res.updatedCount;
        totalMerged += res.mergedCount;
        totalMigratedMeals += res.migratedMealsCount;
      }
    } catch (err) {
      console.warn(`Error optimizing catalog batch [${i}..${i + BATCH_SIZE}]:`, err);
    }

    onProgress?.(Math.min(i + BATCH_SIZE, allItems.length), allItems.length);

    if (signal?.aborted) {
      wasAborted = true;
      break;
    }
  }

  if (totalMigratedMeals > 0) {
    await recalculateUserTdee(username);
  }

  return {
    totalProcessed: allItems.length,
    updatedCount: totalUpdated,
    mergedCount: totalMerged,
    migratedMealsCount: totalMigratedMeals,
    aborted: wasAborted,
  };
}
