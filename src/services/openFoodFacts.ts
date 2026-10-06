import { getFoodCatalogItemByBarcode, upsertFoodCatalog, getFoodCatalogItem } from '../db/queries';
import { FoodCatalogItem, DEFAULT_USERNAME } from '../types';
import { cleanTag } from './serving';

export interface OpenFoodFactsProduct {
  barcode: string;
  food_name: string;
  brand?: string | null;
  serving_size: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  base_weight_g?: number | null;
}

const OFF_API_BASE = 'https://world.openfoodfacts.org/api/v2/product';
const USER_AGENT = 'CTracker - Android/iOS - Version 1.8.0 - (https://github.com/personal/ctracker)';

/**
 * Parses raw nutriments returned by Open Food Facts API v2.
 * Prefers per-serving metric if available and valid; falls back to per-100g.
 */
export function parseOffNutriments(nutriments: Record<string, any> = {}): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
} {
  // Calories / Energy
  let calories = 0;
  if (typeof nutriments['energy-kcal_serving'] === 'number' && nutriments['energy-kcal_serving'] > 0) {
    calories = Math.round(nutriments['energy-kcal_serving']);
  } else if (typeof nutriments['energy-kcal_100g'] === 'number' && nutriments['energy-kcal_100g'] >= 0) {
    calories = Math.round(nutriments['energy-kcal_100g']);
  } else if (typeof nutriments['energy-kcal'] === 'number' && nutriments['energy-kcal'] >= 0) {
    calories = Math.round(nutriments['energy-kcal']);
  } else if (typeof nutriments['energy_100g'] === 'number' && nutriments['energy_100g'] >= 0) {
    // Convert kJ to kcal: 1 kcal ≈ 4.184 kJ
    calories = Math.round(nutriments['energy_100g'] / 4.184);
  }

  // Protein
  const rawProtein =
    typeof nutriments['proteins_serving'] === 'number'
      ? nutriments['proteins_serving']
      : (typeof nutriments['proteins_100g'] === 'number' ? nutriments['proteins_100g'] : (nutriments['proteins'] || 0));
  const protein = Math.round(Number(rawProtein) * 10) / 10;

  // Carbs
  const rawCarbs =
    typeof nutriments['carbohydrates_serving'] === 'number'
      ? nutriments['carbohydrates_serving']
      : (typeof nutriments['carbohydrates_100g'] === 'number' ? nutriments['carbohydrates_100g'] : (nutriments['carbohydrates'] || 0));
  const carbs = Math.round(Number(rawCarbs) * 10) / 10;

  // Fat
  const rawFat =
    typeof nutriments['fat_serving'] === 'number'
      ? nutriments['fat_serving']
      : (typeof nutriments['fat_100g'] === 'number' ? nutriments['fat_100g'] : (nutriments['fat'] || 0));
  const fat = Math.round(Number(rawFat) * 10) / 10;

  return { calories, protein, carbs, fat };
}

/**
 * Fetches product metadata directly from the public Open Food Facts API v2.
 */
export async function fetchProductFromOpenFoodFacts(
  barcode: string
): Promise<OpenFoodFactsProduct | null> {
  const cleanBarcode = barcode.trim();
  if (!cleanBarcode) return null;

  try {
    const url = `${OFF_API_BASE}/${encodeURIComponent(cleanBarcode)}.json?fields=product_name,brands,serving_size,serving_quantity,nutriments`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data || data.status !== 1 || !data.product) {
      return null;
    }

    const product = data.product;
    const foodName = product.product_name?.trim();
    if (!foodName) return null;

    const brand = cleanTag(product.brands ? product.brands.split(',')[0].trim() : null);
    const servingSize = product.serving_size?.trim() || '100g';
    const baseWeightG =
      typeof product.serving_quantity === 'number'
        ? product.serving_quantity
        : (parseFloat(product.serving_quantity) || (servingSize.toLowerCase().includes('100g') ? 100 : null));

    const { calories, protein, carbs, fat } = parseOffNutriments(product.nutriments);

    return {
      barcode: cleanBarcode,
      food_name: foodName,
      brand,
      serving_size: servingSize,
      calories,
      protein,
      carbs,
      fat,
      base_weight_g: baseWeightG,
    };
  } catch (err) {
    console.warn(`Failed to fetch Open Food Facts barcode [${cleanBarcode}]:`, err);
    return null;
  }
}

/**
 * Local-First Barcode Resolver:
 * 1. Checks local SQLite food catalog by barcode (instant O(1), offline-capable).
 * 2. If not found locally, queries Open Food Facts API.
 * 3. If found from Open Food Facts, automatically caches into food_catalog with source='off'
 *    and is_verified=1 to protect it from AI optimizer mutation.
 */
export async function lookupFoodByBarcode(
  username = DEFAULT_USERNAME,
  barcode: string
): Promise<FoodCatalogItem | null> {
  const cleanBarcode = barcode.trim();
  if (!cleanBarcode) return null;

  // 1. Local-first check
  const localItem = await getFoodCatalogItemByBarcode(username, cleanBarcode);
  if (localItem) {
    return localItem;
  }

  // 2. Open Food Facts remote lookup
  const offProduct = await fetchProductFromOpenFoodFacts(cleanBarcode);
  if (!offProduct) {
    return null;
  }

  // 3. Upsert into local catalog as verified barcode item
  await upsertFoodCatalog({
    username,
    canonical_name: offProduct.food_name,
    brand: offProduct.brand,
    barcode: offProduct.barcode,
    default_serving: offProduct.serving_size,
    calories: offProduct.calories,
    protein: offProduct.protein,
    carbs: offProduct.carbs,
    fat: offProduct.fat,
    base_weight_g: offProduct.base_weight_g,
    usage_count: 1,
    source: 'off',
    is_verified: 1,
  });

  return await getFoodCatalogItem(username, offProduct.food_name);
}
