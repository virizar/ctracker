import {
  extractFoodItemsFromJson,
  extractJsonArray,
  getRelevantCatalogContext,
  parseFoodInput,
  optimizeFoodCatalogBatch,
} from '../src/services/gemini';
import { OptimizedFoodMapping, FoodCatalogItem } from '../src/types';
import * as keychain from '../src/services/keychain';
import * as queries from '../src/db/queries';

jest.mock('../src/services/keychain');
jest.mock('../src/db/queries');

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
    expect(result[0].original_name).toBe(
      '2 slices of torta di mele italian (relatively thin)'
    );
    expect(result[0].clean_name).toBe('Torta di Mele');
    expect(result[0].base_calories).toBe(204);

    expect(result[1].original_name).toBe('3 knaeckebroed crackers');
    expect(result[1].clean_name).toBe('Knækbrød');
    expect(result[1].base_calories).toBe(35);
  });

  it('parses brand and variant fields for branded / fast food items', () => {
    const raw = JSON.stringify([
      {
        food_name: 'Big Mac',
        canonical_name: "McDonald's Big Mac",
        brand: "McDonald's",
        variant: 'Original',
        serving_size: '1 burger (215g)',
        calories: 590,
        protein: 25,
        carbs: 46,
        fat: 34,
      },
      {
        food_name: 'Cream Cheese',
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

describe('getRelevantCatalogContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty string for short words or stop words', async () => {
    const res1 = await getRelevantCatalogContext('and with the for');
    expect(res1).toBe('');

    const res2 = await getRelevantCatalogContext('hi a b');
    expect(res2).toBe('');
  });

  it('returns formatted context string when items match in catalog', async () => {
    const mockItem: FoodCatalogItem = {
      id: 1,
      username: 'user',
      canonical_name: 'Whole Milk',
      default_serving: '250ml',
      calories: 150,
      protein: 8,
      carbs: 12,
      fat: 8,
      usage_count: 5,
    };

    (queries.searchFoodCatalog as jest.Mock).mockResolvedValue([mockItem]);

    const res = await getRelevantCatalogContext('milk with coffee', 'user');

    expect(queries.searchFoodCatalog).toHaveBeenCalledWith('user', 'milk', 2);
    expect(res).toContain('USER KNOWN FOOD CATALOG');
    expect(res).toContain('"Whole Milk": 250ml -> 150 kcal');
  });

  it('handles database search exceptions gracefully and returns empty string', async () => {
    (queries.searchFoodCatalog as jest.Mock).mockRejectedValue(new Error('DB Locked'));

    const res = await getRelevantCatalogContext('banana pancake', 'user');
    expect(res).toBe('');
  });
});

describe('parseFoodInput API interaction', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    (keychain.getGeminiModel as jest.Mock).mockResolvedValue('gemini-1.5-flash');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('throws an error if Gemini API key is missing', async () => {
    (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue(null);

    await expect(parseFoodInput('2 scrambled eggs')).rejects.toThrow(
      'Gemini API key is not set. Please configure your API key in Settings.'
    );
  });

  it('successfully calls API and parses candidates', async () => {
    (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue('fake-api-key');

    const fakeResponseBody = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify([
                  {
                    food_name: 'Scrambled Eggs',
                    canonical_name: 'Scrambled Eggs',
                    serving_size: '2 eggs',
                    calories: 140,
                    protein: 12,
                    carbs: 2,
                    fat: 10,
                  },
                ]),
              },
            ],
          },
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponseBody,
    } as any);

    const items = await parseFoodInput('2 scrambled eggs', 'user');
    expect(items).toHaveLength(1);
    expect(items[0].food_name).toBe('Scrambled Eggs');
    expect(items[0].calories).toBe(140);
  });

  it('returns empty array if candidate text is missing', async () => {
    (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue('fake-api-key');

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [] }),
    } as any);

    const items = await parseFoodInput('nothing', 'user');
    expect(items).toEqual([]);
  });

  it('throws when Gemini API returns an HTTP error status', async () => {
    (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue('fake-api-key');

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Quota Exceeded',
    } as any);

    await expect(parseFoodInput('2 scrambled eggs')).rejects.toThrow(
      'Gemini API error (403): Quota Exceeded'
    );
  });
});

describe('optimizeFoodCatalogBatch API interaction', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    (keychain.getGeminiModel as jest.Mock).mockResolvedValue('gemini-2.5-flash');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns empty array when items array is empty', async () => {
    const res = await optimizeFoodCatalogBatch([]);
    expect(res).toEqual([]);
  });

  it('throws an error if Gemini API key is missing', async () => {
    (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue(null);

    await expect(
      optimizeFoodCatalogBatch([
        {
          canonical_name: 'Apple',
          calories: 95,
          protein: 0.5,
          carbs: 25,
          fat: 0.3,
        },
      ])
    ).rejects.toThrow('Gemini API key is not set. Please configure your API key in Settings.');
  });

  it('successfully optimizes a batch of items and cleans tags', async () => {
    (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue('fake-api-key');

    const fakeResponseBody = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify([
                  {
                    original_name: 'Apple',
                    clean_name: 'Apple',
                    brand: 'None',
                    variant: 'null',
                    base_serving: '1 medium (182g)',
                    base_weight_g: 182,
                    base_calories: 95,
                    base_protein: 0.5,
                    base_carbs: 25,
                    base_fat: 0.3,
                  },
                ]),
              },
            ],
          },
        },
      ],
    };

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => fakeResponseBody,
    } as any);

    const mappings = await optimizeFoodCatalogBatch([
      {
        canonical_name: 'Apple',
        calories: 95,
        protein: 0.5,
        carbs: 25,
        fat: 0.3,
      },
    ]);

    expect(mappings).toHaveLength(1);
    expect(mappings[0].clean_name).toBe('Apple');
    expect(mappings[0].brand).toBeNull();
    expect(mappings[0].variant).toBeNull();
  });

  it('returns empty array if candidate text is missing', async () => {
    (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue('fake-api-key');

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [] }),
    } as any);

    const mappings = await optimizeFoodCatalogBatch([
      {
        canonical_name: 'Apple',
        calories: 95,
        protein: 0.5,
        carbs: 25,
        fat: 0.3,
      },
    ]);

    expect(mappings).toEqual([]);
  });

  it('throws when API returns an HTTP error status', async () => {
    (keychain.getGeminiApiKey as jest.Mock).mockResolvedValue('fake-api-key');

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as any);

    await expect(
      optimizeFoodCatalogBatch([
        {
          canonical_name: 'Apple',
          calories: 95,
          protein: 0.5,
          carbs: 25,
          fat: 0.3,
        },
      ])
    ).rejects.toThrow('Gemini API error (500): Internal Server Error');
  });
});
