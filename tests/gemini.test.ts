import { extractFoodItemsFromJson, extractJsonArray } from '../src/services/gemini';
import { OptimizedFoodMapping } from '../src/types';

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

  it('parses generalized clean name and catalog base units correctly', () => {
    const raw = JSON.stringify([
      {
        food_name: 'Torta di Mele',
        canonical_name: 'Torta di Mele',
        serving_size: '2 thin slices (approx. 160g)',
        calories: 408,
        protein: 6,
        carbs: 60,
        fat: 16,
        base_serving: '1 slice (80g)',
        base_weight_g: 80,
        base_calories: 204,
        base_protein: 3,
        base_carbs: 30,
        base_fat: 8,
      },
    ]);

    const result = extractFoodItemsFromJson(raw);
    expect(result).toHaveLength(1);
    expect(result[0].food_name).toBe('Torta di Mele');
    expect(result[0].base_serving).toBe('1 slice (80g)');
    expect(result[0].base_calories).toBe(204);
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

  it('parses catalog optimizer response correctly', () => {
    const raw = JSON.stringify([
      {
        original_name: '2 slices of torta di mele italian (relatively thin)',
        clean_name: 'Torta di Mele',
        base_serving: '1 slice (80g)',
        base_weight_g: 80,
        base_calories: 204,
        base_protein: 3,
        base_carbs: 28,
        base_fat: 9,
      },
      {
        original_name: '3 knaeckebroed crackers',
        clean_name: 'Knækbrød',
        base_serving: '1 cracker (10g)',
        base_weight_g: 10,
        base_calories: 35,
        base_protein: 1,
        base_carbs: 6,
        base_fat: 0.5,
      },
    ]);

    const result = extractJsonArray<OptimizedFoodMapping>(raw);
    expect(result).toHaveLength(2);
    expect(result[0].clean_name).toBe('Torta di Mele');
    expect(result[0].base_calories).toBe(204);
    expect(result[1].clean_name).toBe('Knækbrød');
    expect(result[1].base_serving).toBe('1 cracker (10g)');
  });

  it('parses full multi-item decomposed meal list correctly', () => {
    const raw = JSON.stringify([
      {
        food_name: 'Knækbrød',
        canonical_name: 'Knækbrød',
        serving_size: '3 crackers (30g)',
        calories: 105,
        protein: 3,
        carbs: 18,
        fat: 1.5,
      },
      {
        food_name: 'Butter',
        canonical_name: 'Butter',
        serving_size: '2 tbsp (28g)',
        calories: 204,
        protein: 0.2,
        carbs: 0,
        fat: 23,
      },
      {
        food_name: 'Sourdough Bread',
        canonical_name: 'Sourdough Bread',
        serving_size: '4 slices (160g)',
        calories: 380,
        protein: 12,
        carbs: 76,
        fat: 2,
      },
      {
        food_name: 'Torta di Mele',
        canonical_name: 'Torta di Mele',
        serving_size: '3 slices (240g)',
        calories: 612,
        protein: 9,
        carbs: 84,
        fat: 27,
      },
      {
        food_name: 'Milk Chocolate with Hazelnut',
        canonical_name: 'Milk Chocolate with Hazelnut',
        serving_size: '1 square (20g)',
        calories: 110,
        protein: 2,
        carbs: 11,
        fat: 7,
      },
    ]);

    const result = extractFoodItemsFromJson(raw);
    expect(result).toHaveLength(5);
    expect(result[0].canonical_name).toBe('Knækbrød');
    expect(result[1].canonical_name).toBe('Butter');
    expect(result[2].canonical_name).toBe('Sourdough Bread');
    expect(result[3].canonical_name).toBe('Torta di Mele');
    expect(result[4].canonical_name).toBe('Milk Chocolate with Hazelnut');
  });

  it('parses brand and variant fields correctly for branded foods', () => {
    const raw = JSON.stringify([
      {
        food_name: 'Big Mac',
        canonical_name: "McDonald's Big Mac",
        brand: "McDonald's",
        variant: 'Original',
        serving_size: '1 burger (215g)',
        calories: 563,
        protein: 26,
        carbs: 44,
        fat: 33,
      },
      {
        food_name: 'Cream Cheese Light',
        canonical_name: 'Philadelphia Cream Cheese (Light)',
        brand: 'Philadelphia',
        variant: 'Light',
        serving_size: '30g',
        calories: 45,
        protein: 2.5,
        carbs: 1.5,
        fat: 3.3,
      },
    ]);

    const result = extractFoodItemsFromJson(raw);
    expect(result).toHaveLength(2);
    expect(result[0].brand).toBe("McDonald's");
    expect(result[0].variant).toBe('Original');
    expect(result[0].canonical_name).toBe("McDonald's Big Mac");

    expect(result[1].brand).toBe('Philadelphia');
    expect(result[1].variant).toBe('Light');
    expect(result[1].canonical_name).toBe('Philadelphia Cream Cheese (Light)');
  });

  it('parses catalog optimizer response with brand and variant preserved', () => {
    const raw = JSON.stringify([
      {
        original_name: 'philadelphia light spread 30 grams',
        clean_name: 'Philadelphia Cream Cheese (Light)',
        brand: 'Philadelphia',
        variant: 'Light',
        base_serving: '30g (1 serving)',
        base_weight_g: 30,
        base_calories: 45,
        base_protein: 2.5,
        base_carbs: 1.5,
        base_fat: 3.3,
      },
    ]);

    const result = extractJsonArray<OptimizedFoodMapping>(raw);
    expect(result).toHaveLength(1);
    expect(result[0].clean_name).toBe('Philadelphia Cream Cheese (Light)');
    expect(result[0].brand).toBe('Philadelphia');
    expect(result[0].variant).toBe('Light');
  });

  it('normalizes string literals like "null", "undefined", or "none" in brand and variant to null', () => {
    const raw = JSON.stringify([
      {
        food_name: 'Apple',
        canonical_name: 'Apple',
        brand: 'null',
        variant: 'none',
        serving_size: '1 medium (182g)',
        calories: 95,
        protein: 0.5,
        carbs: 25,
        fat: 0.3,
      },
      {
        food_name: 'Boiled Egg',
        canonical_name: 'Boiled Egg',
        brand: 'None',
        variant: 'null',
        serving_size: '1 large',
        calories: 78,
        protein: 6,
        carbs: 0.6,
        fat: 5,
      },
    ]);

    const result = extractFoodItemsFromJson(raw);
    expect(result).toHaveLength(2);
    expect(result[0].brand).toBeNull();
    expect(result[0].variant).toBeNull();
    expect(result[1].brand).toBeNull();
    expect(result[1].variant).toBeNull();
  });
});
