import baseCatalogJson from './baseCatalog.json';

export interface BaseFoodItem {
  canonical_name: string;
  brand?: string | null;
  variant?: string | null;
  default_serving: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  base_weight_g?: number;
}

/**
 * Curated laboratory baseline dataset sourced and normalized from USDA FoodData Central,
 * UK CoFID, French CIQUAL, and Dutch NEVO.
 * All entries represent standard whole foods, kitchen staples, cuts, and foundational ingredients.
 * Portion defaults are set to standard 100g metrics or universally recognized unit portions.
 */
export const BASE_FOOD_CATALOG: BaseFoodItem[] = baseCatalogJson as BaseFoodItem[];
