import { parseServingString, scaleNutrition } from '../src/services/serving';

describe('Food Serving & Unit Conversion Engine Tests', () => {
  describe('parseServingString', () => {
    it('parses standard gram format "150g"', () => {
      const parsed = parseServingString('150g');
      expect(parsed.initialQty).toBe(150);
      expect(parsed.initialUnit).toBe('g');
      expect(parsed.baseWeightG).toBe(150);
    });

    it('parses units with weight in parentheses "1 cup (240g)"', () => {
      const parsed = parseServingString('1 cup (240g)');
      expect(parsed.initialQty).toBe(1);
      expect(parsed.initialUnit).toBe('cup');
      expect(parsed.baseWeightG).toBe(240);
    });

    it('parses discrete portion strings "2 large"', () => {
      const parsed = parseServingString('2 large');
      expect(parsed.initialQty).toBe(2);
      expect(parsed.initialUnit).toBe('large');
    });

    it('falls back gracefully to 1 serving when empty', () => {
      const parsed = parseServingString('');
      expect(parsed.initialQty).toBe(1);
      expect(parsed.initialUnit).toBe('serving');
      expect(parsed.baseWeightG).toBe(100);
    });
  });

  describe('scaleNutrition', () => {
    const baseFood = {
      calories: 300,
      protein: 30,
      carbs: 20,
      fat: 10,
      baseQty: 150,
      baseWeightG: 150, // 150g = 300 kcal (2 kcal/g)
    };

    it('scales linearly when reducing gram weight (150g -> 50g)', () => {
      // 50g should be exactly 1/3 of 300 kcal = 100 kcal
      const scaled = scaleNutrition(baseFood, 50, 'g');
      expect(scaled.calories).toBe(100);
      expect(scaled.protein).toBe(10);
      expect(scaled.carbs).toBeCloseTo(6.7, 1);
      expect(scaled.fat).toBeCloseTo(3.3, 1);
      expect(scaled.servingSizeStr).toBe('50 g');
    });

    it('scales linearly when increasing gram weight (150g -> 300g)', () => {
      const scaled = scaleNutrition(baseFood, 300, 'g');
      expect(scaled.calories).toBe(600);
      expect(scaled.protein).toBe(60);
      expect(scaled.carbs).toBe(40);
      expect(scaled.fat).toBe(20);
    });

    it('converts ounces correctly (1 oz = 28.35g)', () => {
      // 1 oz = 28.3495g at 2 kcal/g = ~56.7 kcal -> 57 kcal
      const scaled = scaleNutrition(baseFood, 1, 'oz');
      expect(scaled.calories).toBe(57);
      expect(scaled.protein).toBeCloseTo(5.7, 1);
      expect(scaled.servingSizeStr).toContain('1 oz (28g)');
    });

    it('handles discrete servings (e.g. 2 servings at 150 base)', () => {
      const discreteBase = {
        calories: 140,
        protein: 12,
        carbs: 2,
        fat: 10,
        baseQty: 2, // 2 eggs
      };

      // Change to 1 egg (0.5x)
      const scaled = scaleNutrition(discreteBase, 1, 'egg');
      expect(scaled.calories).toBe(70);
      expect(scaled.protein).toBe(6);
      expect(scaled.carbs).toBe(1);
      expect(scaled.fat).toBe(5);
    });

    it('handles zero or negative quantity gracefully', () => {
      const scaled = scaleNutrition(baseFood, 0, 'g');
      expect(scaled.calories).toBe(0);
      expect(scaled.protein).toBe(0);
    });
  });
});
