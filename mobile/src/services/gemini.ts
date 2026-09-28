import { ParsedFoodItem } from '../types';
import { getGeminiApiKey, getGeminiModel } from './keychain';

const FOOD_PARSER_SYSTEM_PROMPT = `You are an intelligent nutrition and calorie tracking assistant.
Your task is to analyze user text or transcripts describing what they ate or drank and extract structured meal logs with realistic calorie and macronutrient estimates (protein, carbs, fat in grams).

Guidelines:
- Decompose complex descriptions into individual recognizable items when appropriate.
- Estimate realistic portion sizes if not explicitly stated.
- calories must equal approx (protein * 4) + (carbs * 4) + (fat * 9).
- Canonical name should be a standardized clean name (e.g. 'Scrambled eggs', 'Whole wheat toast', 'Espresso').
- Return a JSON array matching the required schema. If the input does not describe any food or beverage, return an empty array [].`;

const FOOD_PARSER_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      food_name: {
        type: 'STRING',
        description: 'Specific description as entered by user, including quantities',
      },
      canonical_name: {
        type: 'STRING',
        description: 'Standardized generic food name for catalog indexing',
      },
      serving_size: {
        type: 'STRING',
        description: 'Serving size or quantity (e.g., 2 large eggs, 250g, 1 cup)',
      },
      calories: {
        type: 'NUMBER',
        description: 'Total estimated calories (kcal)',
      },
      protein: {
        type: 'NUMBER',
        description: 'Protein content in grams',
      },
      carbs: {
        type: 'NUMBER',
        description: 'Carbohydrates content in grams',
      },
      fat: {
        type: 'NUMBER',
        description: 'Fat content in grams',
      },
    },
    required: ['food_name', 'canonical_name', 'serving_size', 'calories', 'protein', 'carbs', 'fat'],
  },
};

export async function parseFoodInput(userInput: string): Promise<ParsedFoodItem[]> {
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

  try {
    const parsed = JSON.parse(candidateText);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to parse Gemini JSON output:', err, candidateText);
    throw new Error('Could not parse nutrition data returned by Gemini.');
  }
}
