import { FoodCatalogItem, ParsedFoodItem, OptimizedFoodMapping } from '../types';
import { getGeminiApiKey, getGeminiModel } from './keychain';
import { searchFoodCatalog } from '../db/queries';

const FOOD_PARSER_SYSTEM_PROMPT = `You are an intelligent nutrition and calorie tracking assistant.
Your task is to analyze user text or transcripts describing what they ate or drank and extract structured meal logs with realistic calorie and macronutrient estimates (protein, carbs, fat in grams).

Guidelines:
- Decompose complex meal descriptions into individual recognizable food items. Every food or beverage mentioned must be extracted as its own entry in the array (e.g. if the user lists 6 foods, return all 6 foods).
- food_name: Clean, concise, standardized food name without quantities, preparation notes, or adjectives (e.g. 'Torta di Mele', 'Knækbrød', 'Sourdough Bread', 'Butter', 'Banana', 'Milk Chocolate with Hazelnut'). NEVER echo raw user descriptions or full sentences in food_name.
- canonical_name: The clean standardized food name suitable for catalog indexing.
- serving_size: The specific portion consumed by the user, including estimated weight in grams if possible (e.g. '2 thin slices (approx. 160g)', '3 crackers (30g)', '1 medium (118g)', '2 tbsp (28g)').
- calories must equal approx (protein * 4) + (carbs * 4) + (fat * 9) for the consumed portion.
- Return a JSON array matching the required schema. If the input does not describe any food or beverage, return an empty array [].`;

const FOOD_PARSER_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      food_name: {
        type: 'STRING',
        description: 'Clean generic food title, e.g. "Torta di Mele", "Knækbrød", "Butter", "Sourdough Bread"',
      },
      canonical_name: {
        type: 'STRING',
        description: 'Standardized generic food name for catalog indexing',
      },
      serving_size: {
        type: 'STRING',
        description: 'Specific portion consumed by user, e.g. "2 slices (160g)", "3 crackers (30g)"',
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
  if (!candidateText || !candidateText.trim()) {
    return [];
  }
  let clean = candidateText.trim();
  if (clean.startsWith('```json')) {
    clean = clean.slice(7);
  } else if (clean.startsWith('```')) {
    clean = clean.slice(3);
  }
  if (clean.endsWith('```')) {
    clean = clean.slice(0, -3);
  }
  clean = clean.trim();

  try {
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error('Could not parse nutrition data returned by Gemini.');
  }
}

export function extractFoodItemsFromJson(candidateText: string): ParsedFoodItem[] {
  return extractJsonArray<ParsedFoodItem>(candidateText);
}


export async function getRelevantCatalogContext(
  userInput: string,
  username = 'victor'
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
  _username = 'victor'
): Promise<ParsedFoodItem[]> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is not set. Please configure your API key in Settings.');
  }

  const model = await getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userInput }],
      },
    ],
    systemInstruction: {
      parts: [{ text: FOOD_PARSER_SYSTEM_PROMPT }],
    },
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: FOOD_PARSER_SCHEMA,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
  }

  const result = await response.json();
  const candidateText =
    result?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!candidateText) {
    return [];
  }

  return extractFoodItemsFromJson(candidateText);
}

const CATALOG_OPTIMIZER_SYSTEM_PROMPT = `You are an expert nutrition database curator.
Your task is to review a batch of existing food items from a user's food catalog and standardize/normalize them for a reusable, clean personal food library.

Guidelines:
- Clean and simplify messy, verbose, or conversational names (e.g., "2 slices of torta di mele italian (relatively thin)" -> "Torta di Mele"; "3 knaeckebroed crackers" -> "Knækbrød"; "Fresh organic honey crisp apple" -> "Apple").
- Deduplicate and normalize capitalization (e.g. Title Case: "Whole Milk", "Greek Yogurt 0%").
- Extract a clean 1-unit baseline serving for the food library (e.g. "1 slice (80g)", "1 cracker (10g)", "1 egg (50g)", "100g", "1 tbsp (15ml)").
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
        description: 'Clean, standardized generic food name, e.g. "Torta di Mele"',
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

  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is not set. Please configure your API key in Settings.');
  }

  const model = await getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

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

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: promptText }],
      },
    ],
    systemInstruction: {
      parts: [{ text: CATALOG_OPTIMIZER_SYSTEM_PROMPT }],
    },
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: CATALOG_OPTIMIZER_SCHEMA,
      ...(model.includes('2.5')
        ? { thinkingConfig: { thinkingBudget: 0 } }
        : {}),
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
  }

  const result = await response.json();
  const candidateText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!candidateText) {
    return [];
  }

  return extractJsonArray<OptimizedFoodMapping>(candidateText);
}
