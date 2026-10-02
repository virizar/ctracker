import { FoodCatalogItem, ParsedFoodItem } from '../types';
import { getGeminiApiKey, getGeminiModel } from './keychain';
import { searchFoodCatalog } from '../db/queries';

const FOOD_PARSER_SYSTEM_PROMPT = `You are an intelligent nutrition and calorie tracking assistant.
Your task is to analyze user text or transcripts describing what they ate or drank and extract structured meal logs with realistic calorie and macronutrient estimates (protein, carbs, fat in grams).

Guidelines:
- Decompose complex meal descriptions into individual recognizable food items.
- food_name: Clean, concise, standardized food name without quantities, preparation notes, or adjectives (e.g. 'Torta di Mele', 'Knækbrød', 'Sourdough Bread', 'Butter', 'Banana'). NEVER echo raw user descriptions or full sentences in food_name.
- canonical_name: The clean standardized food name suitable for catalog indexing.
- serving_size: The specific portion consumed by the user, including estimated weight in grams if possible (e.g. '2 thin slices (approx. 160g)', '3 crackers (30g)', '1 medium (118g)').
- calories must equal approx (protein * 4) + (carbs * 4) + (fat * 9) for the consumed portion.
- Catalog normalization: Provide base_serving (a standard 1-unit baseline such as '1 slice (80g)', '1 cracker (10g)', '1 tbsp (14g)', or '100g') and the corresponding base_calories, base_protein, base_carbs, base_fat for that single unit so the food can be stored in the user's permanent catalog.
- If the user's input matches any item in the USER'S EXISTING FOOD CATALOG, prioritize that food's identity and scale its established macros to the consumed portion.
- Return a JSON array matching the required schema. If the input does not describe any food or beverage, return an empty array [].`;

const FOOD_PARSER_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      food_name: {
        type: 'STRING',
        description: 'Clean generic food title, e.g. "Torta di Mele" or "Knækbrød" without quantities or sentence notes',
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
      base_serving: {
        type: 'STRING',
        description: 'Standardized 1-unit baseline serving for library reuse, e.g. "1 slice (80g)" or "1 cracker (10g)"',
      },
      base_weight_g: {
        type: 'NUMBER',
        description: 'Weight of 1 unit in grams, e.g. 80 or 10',
      },
      base_calories: {
        type: 'NUMBER',
        description: 'Calories in 1 baseline unit (kcal)',
      },
      base_protein: {
        type: 'NUMBER',
        description: 'Protein in 1 baseline unit in grams',
      },
      base_carbs: {
        type: 'NUMBER',
        description: 'Carbohydrates in 1 baseline unit in grams',
      },
      base_fat: {
        type: 'NUMBER',
        description: 'Fat in 1 baseline unit in grams',
      },
    },
    required: ['food_name', 'canonical_name', 'serving_size', 'calories', 'protein', 'carbs', 'fat'],
  },
};

export function extractFoodItemsFromJson(candidateText: string): ParsedFoodItem[] {
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

    for (const w of words.slice(0, 6)) {
      const items = await searchFoodCatalog(username, w, 3);
      for (const item of items) {
        if (!matchedMap.has(item.canonical_name.toLowerCase())) {
          matchedMap.set(item.canonical_name.toLowerCase(), item);
        }
      }
    }

    if (matchedMap.size === 0) return '';

    const lines: string[] = ['USER KNOWN FOOD CATALOG (Prioritize matching these if applicable):'];
    Array.from(matchedMap.values())
      .slice(0, 8)
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
  username = 'victor'
): Promise<ParsedFoodItem[]> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is not set. Please configure your API key in Settings.');
  }

  const model = await getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const catalogContext = await getRelevantCatalogContext(userInput, username);
  const fullSystemPrompt = FOOD_PARSER_SYSTEM_PROMPT + catalogContext;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userInput }],
      },
    ],
    systemInstruction: {
      parts: [{ text: fullSystemPrompt }],
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
