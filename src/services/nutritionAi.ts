import { FoodCatalogItem, ParsedFoodItem, OptimizedFoodMapping, DEFAULT_USERNAME } from '../types';
import { searchFoodCatalog } from '../db/queries';
import { cleanTag } from './serving';
import { getActiveAIClient } from './ai/clientFactory';
import { parseJsonArray } from './ai/cleaner';

const FOOD_PARSER_SYSTEM_PROMPT = `You are an intelligent nutrition and calorie tracking assistant.
Your task is to analyze user text or transcripts describing what they ate or drank and extract structured meal logs with realistic calorie and macronutrient estimates (protein, carbs, fat in grams).

Guidelines:
- Decompose complex meal descriptions, combos, or bundles into individual recognizable food items (e.g. "Big Mac combo from McDonald's" must be decomposed into "Big Mac", "French Fries", and drink). Every food or beverage mentioned must be extracted as its own entry in the array.
- brand: If the food is from a specific brand, restaurant chain, or manufacturer (e.g. "McDonald's", "Philadelphia", "Chobani", "Coca-Cola", "Starbucks", "Barilla", "Subway"), extract the brand name in the 'brand' field. For generic, homemade, or whole foods (e.g. "Banana", "Eggs", "Chicken Breast", "Olive Oil"), set brand to null.
- variant: If the food has a specific formulation or variant that affects nutritional values (e.g. "Light", "Original", "Zero Sugar", "Fat Free", "Low Fat", "Medium", "Large"), extract it in 'variant'. Otherwise set to null.
- food_name: Clean product or dish name (e.g. 'Big Mac', 'French Fries', 'Cream Cheese', 'Greek Yogurt', 'Chicken Breast'). NEVER echo raw user descriptions or full sentences in food_name.
- canonical_name: The complete distinct searchable food name preserving brand and variant when present (e.g. 'McDonald\\'s Big Mac', 'Philadelphia Cream Cheese (Light)', 'Chicken Breast').
- serving_size: The specific portion consumed by the user, including estimated weight in grams if possible (e.g. '1 burger (215g)', '1 medium order (117g)', '2 thin slices (approx. 160g)', '2 tbsp (30g)').
- calories and macronutrients: Use official published manufacturer/restaurant values whenever a specific brand or restaurant is identified (e.g. McDonald's Big Mac has approx 590 kcal, 25g protein, 46g carbs, 34g fat). Calories must equal approx (protein * 4) + (carbs * 4) + (fat * 9) for the consumed portion.
- Return a JSON array matching the required schema. If the input does not describe any food or beverage, return an empty array [].`;

const FOOD_PARSER_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      food_name: {
        type: 'STRING',
        description: 'Clean product or dish title, e.g. "Big Mac", "French Fries", "Cream Cheese", "Sourdough Bread"',
      },
      canonical_name: {
        type: 'STRING',
        description: 'Standardized distinct food name for catalog indexing (e.g. "McDonald\'s Big Mac", "Philadelphia Cream Cheese (Light)")',
      },
      brand: {
        type: 'STRING',
        description: 'Manufacturer, restaurant chain, or brand name if applicable (e.g. "McDonald\'s", "Philadelphia", "Chobani"), or null for generic foods',
      },
      variant: {
        type: 'STRING',
        description: 'Product formulation or variant if applicable (e.g. "Light", "Original", "Zero Sugar", "Medium"), or null',
      },
      serving_size: {
        type: 'STRING',
        description: 'Specific portion consumed by user, e.g. "1 burger (215g)", "2 slices (160g)", "3 crackers (30g)"',
      },
      calories: {
        type: 'NUMBER',
        description: 'Total estimated calories for the consumed portion (kcal)',
      },
      protein: {
        type: 'NUMBER',
        description: 'Protein content for consumed portion in grams',
      },
      carbs: {
        type: 'NUMBER',
        description: 'Carbohydrates content for consumed portion in grams',
      },
      fat: {
        type: 'NUMBER',
        description: 'Fat content for consumed portion in grams',
      },
    },
    required: ['food_name', 'canonical_name', 'serving_size', 'calories', 'protein', 'carbs', 'fat'],
  },
};

export function extractJsonArray<T = any>(candidateText: string): T[] {
  return parseJsonArray<T>(candidateText, 'Could not parse nutrition data returned by Gemini.');
}

export function extractFoodItemsFromJson(candidateText: string): ParsedFoodItem[] {
  const items = extractJsonArray<ParsedFoodItem>(candidateText);
  return items.map((item) => ({
    ...item,
    brand: cleanTag(item.brand),
    variant: cleanTag(item.variant),
  }));
}

export async function getRelevantCatalogContext(
  userInput: string,
  username = DEFAULT_USERNAME
): Promise<string> {
  try {
    const words = userInput
      .toLowerCase()
      .replace(/[^\w\s\u00C0-\u017F]/g, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length >= 3 &&
          !['and', 'the', 'with', 'for', 'slices', 'piece', 'pieces', 'approx', 'grams', 'some', 'about'].includes(w)
      );

    if (words.length === 0) return '';

    const matchedMap = new Map<string, FoodCatalogItem>();

    const searchResults = await Promise.all(
      words.slice(0, 5).map((w) => searchFoodCatalog(username, w, 2))
    );
    for (const items of searchResults) {
      for (const item of items) {
        if (!matchedMap.has(item.canonical_name.toLowerCase())) {
          matchedMap.set(item.canonical_name.toLowerCase(), item);
        }
      }
    }

    if (matchedMap.size === 0) return '';

    const lines: string[] = ['USER KNOWN FOOD CATALOG (Prioritize matching these if applicable):'];
    Array.from(matchedMap.values())
      .slice(0, 6)
      .forEach((item) => {
        lines.push(
          `- "${item.canonical_name}": ${item.default_serving || '1 serving'} -> ${Math.round(
            item.calories
          )} kcal (P: ${Math.round(item.protein)}g, C: ${Math.round(item.carbs)}g, F: ${Math.round(
            item.fat
          )}g)`
        );
      });

    return '\n\n' + lines.join('\n');
  } catch {
    return '';
  }
}

export async function parseFoodInput(
  userInput: string,
  _username = DEFAULT_USERNAME
): Promise<ParsedFoodItem[]> {
  const client = await getActiveAIClient();
  const candidateText = await client.complete({
    systemPrompt: FOOD_PARSER_SYSTEM_PROMPT,
    userPrompt: userInput,
    jsonSchema: FOOD_PARSER_SCHEMA,
    temperature: 0.1,
  });

  if (!candidateText) {
    return [];
  }

  return extractFoodItemsFromJson(candidateText);
}

const CATALOG_OPTIMIZER_SYSTEM_PROMPT = `You are an expert nutrition database curator.
Your task is to review a batch of existing food items from a user's food catalog and standardize/normalize them for a reusable, clean personal food library.

Guidelines:
- Clean and simplify messy, verbose, or conversational names (e.g., "2 slices of torta di mele italian (relatively thin)" -> "Torta di Mele"; "3 knaeckebroed crackers" -> "Knækbrød"). Strip pure marketing buzzwords (e.g. "Artisanal", "Farm Fresh", "Delicious").
- PRESERVE BRANDS & RESTAURANTS: If a food is from a specific brand, manufacturer, or restaurant (e.g. "Philadelphia", "McDonald's", "Chobani", "Kirkland", "Barilla", "Oreo"), preserve the brand in 'clean_name' and extract it into 'brand' (e.g. clean_name: "Philadelphia Cream Cheese", brand: "Philadelphia"). NEVER convert branded foods into generic foods (e.g. DO NOT turn "Philadelphia Cream Cheese" into "Cream cheese" or "Big Mac" into "Hamburger").
- PRESERVE NUTRITIONAL FORMULATIONS & VARIANTS: NEVER strip words that fundamentally alter calories or macronutrients (e.g. "Light", "Zero", "Low Fat", "Fat Free", "Original", "Diet", "Whole Milk" vs "Skim Milk"). Extract them in 'variant'. Different variants of a product must remain distinct catalog foods.
- Deduplicate and normalize capitalization (e.g. Title Case: "Whole Milk", "Greek Yogurt 0%").
- Extract a clean 1-unit baseline serving for the food library (e.g. "1 slice (80g)", "1 cracker (10g)", "1 egg (50g)", "100g", "1 tbsp (15g)").
- Scale or determine the base_calories, base_protein, base_carbs, and base_fat accurately for this single 1-unit baseline.
- For foods that are already clean, standardized, and have a good 1-unit serving, keep them as-is.
- original_name must EXACTLY match the input item's name so we can map it back to the database.
- Return a JSON array matching the required schema.`;

const CATALOG_OPTIMIZER_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      original_name: {
        type: 'STRING',
        description: 'The exact input food name being optimized',
      },
      clean_name: {
        type: 'STRING',
        description: 'Clean, standardized distinctive food name (e.g. "Philadelphia Cream Cheese (Light)", "Big Mac", "Torta di Mele")',
      },
      brand: {
        type: 'STRING',
        description: 'Brand, restaurant chain, or manufacturer if applicable (e.g. "Philadelphia", "McDonald\'s"), or null',
      },
      variant: {
        type: 'STRING',
        description: 'Nutritional variant if applicable (e.g. "Light", "Zero Sugar", "Fat Free"), or null',
      },
      base_serving: {
        type: 'STRING',
        description: 'Standardized 1-unit baseline serving, e.g. "1 slice (80g)" or "100g"',
      },
      base_weight_g: {
        type: 'NUMBER',
        description: 'Weight of 1 unit in grams, e.g. 80',
      },
      base_calories: {
        type: 'NUMBER',
        description: 'Calories in 1 baseline unit (kcal)',
      },
      base_protein: {
        type: 'NUMBER',
        description: 'Protein in 1 baseline unit (g)',
      },
      base_carbs: {
        type: 'NUMBER',
        description: 'Carbohydrates in 1 baseline unit (g)',
      },
      base_fat: {
        type: 'NUMBER',
        description: 'Fat in 1 baseline unit (g)',
      },
    },
    required: [
      'original_name',
      'clean_name',
      'base_serving',
      'base_calories',
      'base_protein',
      'base_carbs',
      'base_fat',
    ],
  },
};

export async function optimizeFoodCatalogBatch(
  items: Array<{
    canonical_name: string;
    default_serving?: string | null;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }>
): Promise<OptimizedFoodMapping[]> {
  if (items.length === 0) return [];

  const client = await getActiveAIClient();
  const promptText =
    `Standardize and normalize the following food catalog items into clean 1-unit library foods:\n` +
    items
      .map(
        (it, idx) =>
          `${idx + 1}. Name: "${it.canonical_name}", Current Serving: "${
            it.default_serving || '1 serving'
          }", Calories: ${Math.round(it.calories)}, P: ${Math.round(it.protein)}g, C: ${Math.round(
            it.carbs
          )}g, F: ${Math.round(it.fat)}g`
      )
      .join('\n');

  const candidateText = await client.complete({
    systemPrompt: CATALOG_OPTIMIZER_SYSTEM_PROMPT,
    userPrompt: promptText,
    jsonSchema: CATALOG_OPTIMIZER_SCHEMA,
    temperature: 0.1,
  });

  if (!candidateText) {
    return [];
  }

  const rawMappings = extractJsonArray<OptimizedFoodMapping>(candidateText);
  return rawMappings.map((m) => ({
    ...m,
    brand: cleanTag(m.brand),
    variant: cleanTag(m.variant),
  }));
}
