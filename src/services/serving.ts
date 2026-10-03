export interface ParsedServing {
  initialQty: number;
  initialUnit: string;
  baseWeightG: number | null;
}

export interface ScaledNutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  servingSizeStr: string;
}

export const UNIT_CONVERSIONS_TO_GRAMS: Record<string, number> = {
  g: 1.0,
  gram: 1.0,
  grams: 1.0,
  gr: 1.0,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  kg: 1000.0,
  lb: 453.592,
  lbs: 453.592,
  ml: 1.0,
  cup: 240.0,
  cups: 240.0,
  tbsp: 15.0,
  tablespoon: 15.0,
  tablespoons: 15.0,
  tsp: 5.0,
  teaspoon: 5.0,
  teaspoons: 5.0,
};

/**
 * Parses a serving size string (e.g. "150g", "1 cup (240g)", "2 large eggs", "1 serving")
 */
export function parseServingString(
  servingStr: string | null | undefined,
  fallbackWeightG?: number | null
): ParsedServing {
  if (!servingStr || !servingStr.trim()) {
    return {
      initialQty: 1.0,
      initialUnit: 'serving',
      baseWeightG: fallbackWeightG ?? 100.0,
    };
  }

  const str = servingStr.trim();

  // Check for weight in parentheses, e.g. "1 cup (240g)" or "(150g)"
  let extractedWeightG: number | null = fallbackWeightG ?? null;
  const parenMatch = str.match(/\(([0-9.]+)\s*(g|grams|gr)\)/i);
  if (parenMatch) {
    const val = parseFloat(parenMatch[1]);
    if (!isNaN(val) && val > 0) {
      extractedWeightG = val;
    }
  }

  // Check for direct grams, e.g. "150g", "150 g", "100 grams"
  const directGramMatch = str.match(/^([0-9.]+)\s*(g|grams|gr)$/i);
  if (directGramMatch) {
    const val = parseFloat(directGramMatch[1]);
    if (!isNaN(val) && val > 0) {
      return {
        initialQty: val,
        initialUnit: 'g',
        baseWeightG: val,
      };
    }
  }

  // Check for general "qty unit", e.g. "2 slice", "1 cup", "0.5 scoop", "2 large"
  const qtyUnitMatch = str.match(/^([0-9.]+)\s*([a-zA-Z\s]+)/);
  if (qtyUnitMatch) {
    const qty = parseFloat(qtyUnitMatch[1]);
    const rawUnit = qtyUnitMatch[2].trim().toLowerCase();
    const cleanUnit = rawUnit.replace(/\(.*\)/, '').trim();

    if (!isNaN(qty) && qty > 0) {
      // If unit is in standard conversion table
      if (UNIT_CONVERSIONS_TO_GRAMS[cleanUnit]) {
        const computedGrams = extractedWeightG ?? qty * UNIT_CONVERSIONS_TO_GRAMS[cleanUnit];
        return {
          initialQty: qty,
          initialUnit: cleanUnit,
          baseWeightG: computedGrams,
        };
      }

      return {
        initialQty: qty,
        initialUnit: cleanUnit || 'serving',
        baseWeightG: extractedWeightG,
      };
    }
  }

  return {
    initialQty: 1.0,
    initialUnit: 'serving',
    baseWeightG: extractedWeightG ?? 100.0,
  };
}

/**
 * Calculates scaled calories & macros based on requested quantity & unit
 */
export function scaleNutrition(
  base: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    baseQty?: number;
    baseWeightG?: number | null;
  },
  targetQty: number,
  targetUnit: string
): ScaledNutrition {
  const safeQty = isNaN(targetQty) || targetQty <= 0 ? 0 : targetQty;
  const baseWeight = base.baseWeightG && base.baseWeightG > 0 ? base.baseWeightG : 100.0;
  const baseQty = base.baseQty && base.baseQty > 0 ? base.baseQty : 1.0;

  let ratio = 1.0;
  const unitLower = targetUnit.toLowerCase().trim();

  // 1. Grams
  if (unitLower === 'g' || unitLower === 'gram' || unitLower === 'grams') {
    ratio = safeQty / baseWeight;
  }
  // 2. Units with known fixed gram conversions (oz, kg, lbs, ml, cup, tbsp, tsp)
  else if (UNIT_CONVERSIONS_TO_GRAMS[unitLower] !== undefined) {
    const targetGrams = safeQty * UNIT_CONVERSIONS_TO_GRAMS[unitLower];
    ratio = targetGrams / baseWeight;
  }
  // 3. Discrete portions / servings (ratio against baseQty)
  else {
    ratio = safeQty / baseQty;
  }

  const calories = Math.round(base.calories * ratio);
  const protein = Math.round(base.protein * ratio * 10) / 10;
  const carbs = Math.round(base.carbs * ratio * 10) / 10;
  const fat = Math.round(base.fat * ratio * 10) / 10;

  // Format serving size string
  let servingSizeStr = `${safeQty} ${targetUnit}`;
  if (unitLower !== 'g' && UNIT_CONVERSIONS_TO_GRAMS[unitLower] !== undefined) {
    const gramWeight = Math.round(safeQty * UNIT_CONVERSIONS_TO_GRAMS[unitLower]);
    servingSizeStr += ` (${gramWeight}g)`;
  }

  return {
    calories,
    protein,
    carbs,
    fat,
    servingSizeStr,
  };
}

/**
 * Formats the serving description shown in catalog cards, ensuring quantities
 * are not duplicated (e.g. preventing "1 1 tbsp (14g)").
 */
export function formatCatalogServing(
  lastUsedQty?: number | null,
  lastUsedUnit?: string | null,
  defaultServing?: string | null
): string {
  if (lastUsedQty !== undefined && lastUsedQty !== null && lastUsedUnit && lastUsedUnit.trim()) {
    const trimmedUnit = lastUsedUnit.trim();
    // Check if unit already starts with a number (e.g. "1 tbsp (14g)", "1 slice (100g)")
    const match = trimmedUnit.match(/^([0-9.]+)\s*(.*)$/);
    if (match) {
      const unitNumber = parseFloat(match[1]);
      const rest = match[2].trim();
      if (lastUsedQty === unitNumber || lastUsedQty === 1) {
        return trimmedUnit;
      }
      return `${lastUsedQty} ${rest}`;
    }
    return `${lastUsedQty} ${trimmedUnit}`;
  }
  return defaultServing || '1 serving';
}

/**
 * Checks if a brand or variant string is valid (i.e. not empty, and not "null", "undefined", "none", etc.)
 */
export function isValidTag(tag?: string | null): boolean {
  if (!tag) return false;
  const trimmed = tag.trim().toLowerCase();
  return (
    trimmed.length > 0 &&
    trimmed !== 'null' &&
    trimmed !== 'undefined' &&
    trimmed !== 'none' &&
    trimmed !== 'n/a' &&
    trimmed !== 'generic'
  );
}

/**
 * Normalizes a brand or variant tag to a trimmed string or null.
 */
export function cleanTag(tag?: string | null): string | null {
  if (!isValidTag(tag)) return null;
  return tag!.trim();
}
