import { extractFoodItemsFromJson } from '../src/services/gemini';

describe('Gemini AI Response Parsing Tests', () => {
  it('parses valid JSON food array correctly', () => {
    const raw = JSON.stringify([
      {
        food_name: '2 scrambled eggs',
        canonical_name: 'Scrambled eggs',
        serving_size: '2 large',
        calories: 140,
        protein: 12,
        carbs: 2,
        fat: 10,
      },
    ]);

    const result = extractFoodItemsFromJson(raw);
    expect(result).toHaveLength(1);
    expect(result[0].canonical_name).toBe('Scrambled eggs');
    expect(result[0].calories).toBe(140);
  });

  it('strips markdown ```json codeblock markers', () => {
    const raw = `\`\`\`json
[
  {
    "food_name": "Espresso",
    "canonical_name": "Espresso",
    "serving_size": "1 shot",
    "calories": 5,
    "protein": 0,
    "carbs": 1,
    "fat": 0
  }
]
\`\`\``;

    const result = extractFoodItemsFromJson(raw);
    expect(result).toHaveLength(1);
    expect(result[0].food_name).toBe('Espresso');
  });

  it('returns empty array when input is empty or whitespace', () => {
    expect(extractFoodItemsFromJson('')).toEqual([]);
    expect(extractFoodItemsFromJson('   ')).toEqual([]);
  });

  it('throws descriptive error on malformed JSON', () => {
    expect(() => extractFoodItemsFromJson('not-json')).toThrow(
      'Could not parse nutrition data returned by Gemini.'
    );
  });
});
