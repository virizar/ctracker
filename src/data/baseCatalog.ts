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
 * All entries represent standard whole foods, kitchen staples, and foundational ingredients.
 * Portion defaults are set to standard 100g metrics or universally recognized unit portions.
 */
export const BASE_FOOD_CATALOG: BaseFoodItem[] = [
  // --- Dairy, Eggs & Plant Milks ---
  { canonical_name: 'Egg, Whole, Cooked', variant: 'Boiled', default_serving: '1 large (50g)', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, base_weight_g: 50 },
  { canonical_name: 'Egg, Whole, Raw', variant: 'Raw', default_serving: '1 large (50g)', calories: 71, protein: 6.3, carbs: 0.4, fat: 4.7, base_weight_g: 50 },
  { canonical_name: 'Egg White, Raw', variant: 'Raw', default_serving: '1 large (33g)', calories: 17, protein: 3.6, carbs: 0.2, fat: 0.1, base_weight_g: 33 },
  { canonical_name: 'Egg White, Cooked', variant: 'Cooked', default_serving: '100g', calories: 52, protein: 10.9, carbs: 0.7, fat: 0.2, base_weight_g: 100 },
  { canonical_name: 'Whole Milk (3.5% Fat)', variant: 'Whole', default_serving: '1 cup (240ml)', calories: 149, protein: 7.7, carbs: 11.7, fat: 7.9, base_weight_g: 244 },
  { canonical_name: 'Semi-Skimmed Milk (1.5% Fat)', variant: 'Semi-skimmed', default_serving: '1 cup (240ml)', calories: 122, protein: 8.2, carbs: 12.0, fat: 4.8, base_weight_g: 244 },
  { canonical_name: 'Skimmed Milk (0.1% Fat)', variant: 'Skimmed', default_serving: '1 cup (240ml)', calories: 83, protein: 8.3, carbs: 12.2, fat: 0.2, base_weight_g: 245 },
  { canonical_name: 'Greek Yogurt, Nonfat (0%)', variant: '0% Fat Plain', default_serving: '100g', calories: 59, protein: 10.2, carbs: 3.6, fat: 0.4, base_weight_g: 100 },
  { canonical_name: 'Greek Yogurt, 2% Fat', variant: '2% Plain', default_serving: '100g', calories: 73, protein: 9.9, carbs: 3.9, fat: 2.0, base_weight_g: 100 },
  { canonical_name: 'Greek Yogurt, Whole (5% Fat)', variant: 'Plain', default_serving: '100g', calories: 97, protein: 9.0, carbs: 3.8, fat: 5.0, base_weight_g: 100 },
  { canonical_name: 'Skyr, Plain, Nonfat', variant: '0% Plain', default_serving: '100g', calories: 63, protein: 11.0, carbs: 4.0, fat: 0.2, base_weight_g: 100 },
  { canonical_name: 'Cottage Cheese, Low-Fat (1%)', variant: '1% Fat', default_serving: '100g', calories: 72, protein: 12.4, carbs: 2.7, fat: 1.0, base_weight_g: 100 },
  { canonical_name: 'Cottage Cheese, Regular (4%)', variant: '4% Fat', default_serving: '100g', calories: 98, protein: 11.1, carbs: 3.4, fat: 4.3, base_weight_g: 100 },
  { canonical_name: 'Cheddar Cheese', variant: 'Regular', default_serving: '1 slice (28g)', calories: 115, protein: 6.5, carbs: 0.6, fat: 9.4, base_weight_g: 28 },
  { canonical_name: 'Mozzarella, Fresh', variant: 'Fresh', default_serving: '100g', calories: 280, protein: 22.2, carbs: 2.2, fat: 22.0, base_weight_g: 100 },
  { canonical_name: 'Mozzarella, Low-Moisture Part-Skim', variant: 'Part-Skim', default_serving: '100g', calories: 295, protein: 24.0, carbs: 2.8, fat: 21.0, base_weight_g: 100 },
  { canonical_name: 'Parmesan Cheese, Grated', variant: 'Hard Cheese', default_serving: '1 tbsp (10g)', calories: 43, protein: 3.8, carbs: 0.4, fat: 2.9, base_weight_g: 10 },
  { canonical_name: 'Feta Cheese', variant: 'Traditional', default_serving: '100g', calories: 264, protein: 14.2, carbs: 4.1, fat: 21.3, base_weight_g: 100 },
  { canonical_name: 'Ricotta Cheese, Part-Skim', variant: 'Part-Skim', default_serving: '100g', calories: 138, protein: 11.4, carbs: 5.1, fat: 7.9, base_weight_g: 100 },
  { canonical_name: 'Butter, Salted', variant: 'Salted', default_serving: '1 pat (10g)', calories: 72, protein: 0.1, carbs: 0.0, fat: 8.1, base_weight_g: 10 },
  { canonical_name: 'Butter, Unsalted', variant: 'Unsalted', default_serving: '1 pat (10g)', calories: 72, protein: 0.1, carbs: 0.0, fat: 8.1, base_weight_g: 10 },
  { canonical_name: 'Soy Milk, Unsweetened', variant: 'Unsweetened', default_serving: '1 cup (240ml)', calories: 80, protein: 7.0, carbs: 4.0, fat: 4.0, base_weight_g: 240 },
  { canonical_name: 'Almond Milk, Unsweetened', variant: 'Unsweetened', default_serving: '1 cup (240ml)', calories: 30, protein: 1.0, carbs: 1.0, fat: 2.5, base_weight_g: 240 },
  { canonical_name: 'Oat Milk, Plain', variant: 'Regular', default_serving: '1 cup (240ml)', calories: 120, protein: 3.0, carbs: 16.0, fat: 5.0, base_weight_g: 240 },

  // --- Poultry & Meats ---
  { canonical_name: 'Chicken Breast, Skinless, Raw', variant: 'Raw', default_serving: '100g', calories: 120, protein: 22.5, carbs: 0.0, fat: 2.6, base_weight_g: 100 },
  { canonical_name: 'Chicken Breast, Skinless, Cooked', variant: 'Cooked/Grilled', default_serving: '100g', calories: 165, protein: 31.0, carbs: 0.0, fat: 3.6, base_weight_g: 100 },
  { canonical_name: 'Chicken Thigh, Skinless, Raw', variant: 'Raw', default_serving: '100g', calories: 144, protein: 19.3, carbs: 0.0, fat: 7.5, base_weight_g: 100 },
  { canonical_name: 'Chicken Thigh, Skinless, Cooked', variant: 'Cooked/Roasted', default_serving: '100g', calories: 209, protein: 26.0, carbs: 0.0, fat: 10.9, base_weight_g: 100 },
  { canonical_name: 'Turkey Breast, Skinless, Raw', variant: 'Raw', default_serving: '100g', calories: 114, protein: 24.1, carbs: 0.0, fat: 1.6, base_weight_g: 100 },
  { canonical_name: 'Turkey Breast, Skinless, Cooked', variant: 'Cooked/Roasted', default_serving: '100g', calories: 147, protein: 30.1, carbs: 0.0, fat: 2.1, base_weight_g: 100 },
  { canonical_name: 'Lean Beef Mince (5% Fat), Raw', variant: '5% Fat Raw', default_serving: '100g', calories: 137, protein: 21.4, carbs: 0.0, fat: 5.0, base_weight_g: 100 },
  { canonical_name: 'Lean Beef Mince (5% Fat), Cooked', variant: '5% Fat Cooked', default_serving: '100g', calories: 172, protein: 27.0, carbs: 0.0, fat: 6.5, base_weight_g: 100 },
  { canonical_name: 'Beef Mince (10%–12% Fat), Raw', variant: '10% Fat Raw', default_serving: '100g', calories: 176, protein: 20.0, carbs: 0.0, fat: 10.0, base_weight_g: 100 },
  { canonical_name: 'Regular Beef Mince (20% Fat), Raw', variant: '20% Fat Raw', default_serving: '100g', calories: 254, protein: 17.2, carbs: 0.0, fat: 20.0, base_weight_g: 100 },
  { canonical_name: 'Beef Sirloin Steak, Lean, Cooked', variant: 'Grilled', default_serving: '100g', calories: 183, protein: 30.5, carbs: 0.0, fat: 6.8, base_weight_g: 100 },
  { canonical_name: 'Beef Ribeye Steak, Lean, Cooked', variant: 'Grilled', default_serving: '100g', calories: 242, protein: 27.3, carbs: 0.0, fat: 14.8, base_weight_g: 100 },
  { canonical_name: 'Pork Tenderloin, Cooked', variant: 'Roasted', default_serving: '100g', calories: 143, protein: 26.2, carbs: 0.0, fat: 3.5, base_weight_g: 100 },
  { canonical_name: 'Pork Chop, Boneless, Cooked', variant: 'Grilled', default_serving: '100g', calories: 196, protein: 28.0, carbs: 0.0, fat: 8.5, base_weight_g: 100 },
  { canonical_name: 'Bacon, Pork, Cooked', variant: 'Crispy', default_serving: '2 slices (24g)', calories: 110, protein: 7.4, carbs: 0.3, fat: 8.7, base_weight_g: 24 },
  { canonical_name: 'Lamb Leg, Lean, Cooked', variant: 'Roasted', default_serving: '100g', calories: 191, protein: 28.3, carbs: 0.0, fat: 8.6, base_weight_g: 100 },

  // --- Fish & Seafood ---
  { canonical_name: 'Salmon, Atlantic, Raw', variant: 'Raw', default_serving: '100g', calories: 208, protein: 20.4, carbs: 0.0, fat: 13.4, base_weight_g: 100 },
  { canonical_name: 'Salmon, Atlantic, Cooked', variant: 'Baked/Grilled', default_serving: '100g', calories: 206, protein: 22.1, carbs: 0.0, fat: 12.3, base_weight_g: 100 },
  { canonical_name: 'Tuna, Canned in Water, Drained', variant: 'Canned Spring Water', default_serving: '1 can (130g)', calories: 130, protein: 29.0, carbs: 0.0, fat: 1.0, base_weight_g: 130 },
  { canonical_name: 'Tuna, Canned in Olive Oil, Drained', variant: 'Canned Oil Drained', default_serving: '100g', calories: 198, protein: 29.1, carbs: 0.0, fat: 8.2, base_weight_g: 100 },
  { canonical_name: 'Cod, Atlantic, Raw', variant: 'Raw', default_serving: '100g', calories: 82, protein: 17.8, carbs: 0.0, fat: 0.7, base_weight_g: 100 },
  { canonical_name: 'Cod, Atlantic, Cooked', variant: 'Baked', default_serving: '100g', calories: 105, protein: 22.8, carbs: 0.0, fat: 0.9, base_weight_g: 100 },
  { canonical_name: 'Shrimp / Prawns, Cooked', variant: 'Steamed/Boiled', default_serving: '100g', calories: 99, protein: 24.0, carbs: 0.2, fat: 0.3, base_weight_g: 100 },
  { canonical_name: 'Tilapia, Cooked', variant: 'Baked', default_serving: '100g', calories: 128, protein: 26.2, carbs: 0.0, fat: 2.7, base_weight_g: 100 },
  { canonical_name: 'Sardines, Canned in Tomato Sauce', variant: 'Canned', default_serving: '100g', calories: 185, protein: 20.9, carbs: 1.5, fat: 10.5, base_weight_g: 100 },
  { canonical_name: 'Mackerel, Atlantic, Cooked', variant: 'Baked', default_serving: '100g', calories: 262, protein: 23.9, carbs: 0.0, fat: 17.8, base_weight_g: 100 },

  // --- Grains, Pasta, Cereals & Breads ---
  { canonical_name: 'Rolled Oats, Dry', variant: 'Raw/Dry', default_serving: '1/2 cup (40g)', calories: 152, protein: 5.3, carbs: 27.4, fat: 2.6, base_weight_g: 40 },
  { canonical_name: 'Oatmeal / Porridge, Cooked in Water', variant: 'Cooked with Water', default_serving: '1 cup (234g)', calories: 158, protein: 6.0, carbs: 28.1, fat: 3.2, base_weight_g: 234 },
  { canonical_name: 'White Rice, Long Grain, Raw', variant: 'Dry/Raw', default_serving: '100g', calories: 365, protein: 7.1, carbs: 79.9, fat: 0.7, base_weight_g: 100 },
  { canonical_name: 'White Rice, Cooked', variant: 'Steamed/Cooked', default_serving: '1 cup (158g)', calories: 205, protein: 4.2, carbs: 44.5, fat: 0.4, base_weight_g: 158 },
  { canonical_name: 'Brown Rice, Long Grain, Raw', variant: 'Dry/Raw', default_serving: '100g', calories: 367, protein: 7.5, carbs: 76.2, fat: 2.8, base_weight_g: 100 },
  { canonical_name: 'Brown Rice, Cooked', variant: 'Steamed/Cooked', default_serving: '1 cup (195g)', calories: 216, protein: 5.0, carbs: 44.8, fat: 1.8, base_weight_g: 195 },
  { canonical_name: 'Basmati Rice, Cooked', variant: 'Cooked', default_serving: '1 cup (160g)', calories: 205, protein: 4.3, carbs: 45.0, fat: 0.5, base_weight_g: 160 },
  { canonical_name: 'Jasmine Rice, Cooked', variant: 'Cooked', default_serving: '1 cup (160g)', calories: 210, protein: 4.0, carbs: 46.0, fat: 0.4, base_weight_g: 160 },
  { canonical_name: 'Quinoa, Raw', variant: 'Dry/Raw', default_serving: '100g', calories: 368, protein: 14.1, carbs: 64.2, fat: 6.1, base_weight_g: 100 },
  { canonical_name: 'Quinoa, Cooked', variant: 'Cooked', default_serving: '1 cup (185g)', calories: 222, protein: 8.1, carbs: 39.4, fat: 3.6, base_weight_g: 185 },
  { canonical_name: 'Couscous, Cooked', variant: 'Cooked', default_serving: '1 cup (157g)', calories: 176, protein: 6.0, carbs: 36.5, fat: 0.3, base_weight_g: 157 },
  { canonical_name: 'Pasta, Wheat, Regular, Dry', variant: 'Dry/Raw', default_serving: '100g', calories: 371, protein: 13.0, carbs: 74.7, fat: 1.5, base_weight_g: 100 },
  { canonical_name: 'Pasta, Wheat, Regular, Cooked', variant: 'Boiled/Al Dente', default_serving: '1 cup (140g)', calories: 221, protein: 8.1, carbs: 43.2, fat: 1.3, base_weight_g: 140 },
  { canonical_name: 'Whole Wheat Pasta, Cooked', variant: 'Boiled', default_serving: '1 cup (140g)', calories: 174, protein: 7.5, carbs: 37.2, fat: 0.8, base_weight_g: 140 },
  { canonical_name: 'White Bread', variant: 'Standard Slice', default_serving: '1 slice (35g)', calories: 93, protein: 3.1, carbs: 17.5, fat: 1.1, base_weight_g: 35 },
  { canonical_name: 'Whole Wheat Bread', variant: '100% Whole Wheat', default_serving: '1 slice (40g)', calories: 99, protein: 4.0, carbs: 17.5, fat: 1.4, base_weight_g: 40 },
  { canonical_name: 'Sourdough Bread', variant: 'Crusty Slice', default_serving: '1 slice (50g)', calories: 140, protein: 5.0, carbs: 26.0, fat: 1.0, base_weight_g: 50 },
  { canonical_name: 'Tortilla Wrap, Flour (8-inch)', variant: 'Medium Wrap', default_serving: '1 wrap (49g)', calories: 147, protein: 3.9, carbs: 24.3, fat: 3.5, base_weight_g: 49 },
  { canonical_name: 'Bagel, Plain', variant: 'Standard', default_serving: '1 bagel (95g)', calories: 250, protein: 9.8, carbs: 48.0, fat: 1.5, base_weight_g: 95 },
  { canonical_name: 'Corn Tortilla', variant: 'Yellow/White Corn', default_serving: '1 tortilla (28g)', calories: 60, protein: 1.4, carbs: 12.0, fat: 0.7, base_weight_g: 28 },

  // --- Legumes & Vegetarian Proteins ---
  { canonical_name: 'Lentils, Cooked', variant: 'Boiled', default_serving: '1 cup (198g)', calories: 230, protein: 17.9, carbs: 39.9, fat: 0.8, base_weight_g: 198 },
  { canonical_name: 'Chickpeas, Canned, Drained', variant: 'Canned', default_serving: '1 cup (164g)', calories: 210, protein: 10.7, carbs: 35.0, fat: 3.8, base_weight_g: 164 },
  { canonical_name: 'Black Beans, Canned, Drained', variant: 'Canned', default_serving: '1 cup (172g)', calories: 218, protein: 14.5, carbs: 39.8, fat: 0.7, base_weight_g: 172 },
  { canonical_name: 'Red Kidney Beans, Canned, Drained', variant: 'Canned', default_serving: '1 cup (177g)', calories: 215, protein: 13.4, carbs: 40.4, fat: 1.5, base_weight_g: 177 },
  { canonical_name: 'Edamame, Shelled, Cooked', variant: 'Boiled', default_serving: '1 cup (155g)', calories: 188, protein: 18.5, carbs: 13.8, fat: 8.1, base_weight_g: 155 },
  { canonical_name: 'Tofu, Firm', variant: 'Raw/Pressed', default_serving: '100g', calories: 83, protein: 10.0, carbs: 1.2, fat: 5.3, base_weight_g: 100 },
  { canonical_name: 'Tofu, Extra Firm', variant: 'Raw', default_serving: '100g', calories: 91, protein: 10.9, carbs: 2.0, fat: 5.5, base_weight_g: 100 },
  { canonical_name: 'Tempeh', variant: 'Cooked', default_serving: '100g', calories: 192, protein: 20.3, carbs: 7.6, fat: 10.8, base_weight_g: 100 },

  // --- Vegetables & Tubers ---
  { canonical_name: 'Potato, Raw, Russet/White', variant: 'Raw with Skin', default_serving: '1 medium (173g)', calories: 137, protein: 4.3, carbs: 31.0, fat: 0.2, base_weight_g: 173 },
  { canonical_name: 'Potato, Boiled, without Skin', variant: 'Boiled', default_serving: '100g', calories: 87, protein: 1.9, carbs: 20.1, fat: 0.1, base_weight_g: 100 },
  { canonical_name: 'Sweet Potato, Raw', variant: 'Raw with Skin', default_serving: '1 medium (130g)', calories: 112, protein: 2.0, carbs: 26.2, fat: 0.1, base_weight_g: 130 },
  { canonical_name: 'Sweet Potato, Baked', variant: 'Baked with Skin', default_serving: '100g', calories: 90, protein: 2.0, carbs: 20.7, fat: 0.1, base_weight_g: 100 },
  { canonical_name: 'Broccoli, Raw', variant: 'Raw Florets', default_serving: '100g', calories: 34, protein: 2.8, carbs: 6.6, fat: 0.4, base_weight_g: 100 },
  { canonical_name: 'Broccoli, Cooked', variant: 'Steamed/Boiled', default_serving: '100g', calories: 35, protein: 2.4, carbs: 7.2, fat: 0.4, base_weight_g: 100 },
  { canonical_name: 'Spinach, Raw', variant: 'Raw Leaves', default_serving: '100g', calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4, base_weight_g: 100 },
  { canonical_name: 'Spinach, Cooked', variant: 'Boiled/Steamed', default_serving: '100g', calories: 23, protein: 3.0, carbs: 3.8, fat: 0.3, base_weight_g: 100 },
  { canonical_name: 'Tomato, Red, Ripe', variant: 'Raw', default_serving: '1 medium (123g)', calories: 22, protein: 1.1, carbs: 4.8, fat: 0.2, base_weight_g: 123 },
  { canonical_name: 'Cucumber, with Peel', variant: 'Raw', default_serving: '100g', calories: 15, protein: 0.7, carbs: 3.6, fat: 0.1, base_weight_g: 100 },
  { canonical_name: 'Bell Pepper, Red', variant: 'Raw', default_serving: '1 medium (119g)', calories: 37, protein: 1.2, carbs: 7.2, fat: 0.4, base_weight_g: 119 },
  { canonical_name: 'Bell Pepper, Green', variant: 'Raw', default_serving: '1 medium (119g)', calories: 24, protein: 1.0, carbs: 5.5, fat: 0.2, base_weight_g: 119 },
  { canonical_name: 'Carrot, Raw', variant: 'Raw', default_serving: '1 medium (61g)', calories: 25, protein: 0.6, carbs: 5.8, fat: 0.1, base_weight_g: 61 },
  { canonical_name: 'Yellow Onion, Raw', variant: 'Raw', default_serving: '1 medium (110g)', calories: 44, protein: 1.2, carbs: 10.3, fat: 0.1, base_weight_g: 110 },
  { canonical_name: 'Garlic, Raw', variant: 'Raw Clove', default_serving: '1 clove (3g)', calories: 4, protein: 0.2, carbs: 1.0, fat: 0.0, base_weight_g: 3 },
  { canonical_name: 'Zucchini / Courgette, Raw', variant: 'Raw', default_serving: '100g', calories: 17, protein: 1.2, carbs: 3.1, fat: 0.3, base_weight_g: 100 },
  { canonical_name: 'Cauliflower, Raw', variant: 'Raw', default_serving: '100g', calories: 25, protein: 1.9, carbs: 5.0, fat: 0.3, base_weight_g: 100 },
  { canonical_name: 'White Mushrooms, Raw', variant: 'Raw Sliced', default_serving: '100g', calories: 22, protein: 3.1, carbs: 3.3, fat: 0.3, base_weight_g: 100 },
  { canonical_name: 'Green Beans, Cooked', variant: 'Boiled/Steamed', default_serving: '100g', calories: 35, protein: 1.9, carbs: 7.9, fat: 0.3, base_weight_g: 100 },
  { canonical_name: 'Asparagus, Cooked', variant: 'Steamed', default_serving: '100g', calories: 22, protein: 2.4, carbs: 4.1, fat: 0.2, base_weight_g: 100 },
  { canonical_name: 'Mixed Salad Greens', variant: 'Raw', default_serving: '100g', calories: 17, protein: 1.5, carbs: 2.8, fat: 0.2, base_weight_g: 100 },

  // --- Fruits ---
  { canonical_name: 'Banana, Raw', variant: 'Fresh', default_serving: '1 medium (118g)', calories: 105, protein: 1.3, carbs: 27.0, fat: 0.4, base_weight_g: 118 },
  { canonical_name: 'Apple, with Skin', variant: 'Fresh', default_serving: '1 medium (182g)', calories: 95, protein: 0.5, carbs: 25.1, fat: 0.3, base_weight_g: 182 },
  { canonical_name: 'Orange, Fresh', variant: 'Navel/Fresh', default_serving: '1 medium (131g)', calories: 62, protein: 1.2, carbs: 15.4, fat: 0.2, base_weight_g: 131 },
  { canonical_name: 'Strawberries, Fresh', variant: 'Whole', default_serving: '1 cup (152g)', calories: 49, protein: 1.0, carbs: 11.7, fat: 0.5, base_weight_g: 152 },
  { canonical_name: 'Blueberries, Fresh', variant: 'Fresh', default_serving: '1 cup (148g)', calories: 84, protein: 1.1, carbs: 21.4, fat: 0.5, base_weight_g: 148 },
  { canonical_name: 'Raspberries, Fresh', variant: 'Fresh', default_serving: '1 cup (123g)', calories: 64, protein: 1.5, carbs: 14.7, fat: 0.8, base_weight_g: 123 },
  { canonical_name: 'Grapes, Red or Green', variant: 'Seedless', default_serving: '1 cup (151g)', calories: 104, protein: 1.1, carbs: 27.3, fat: 0.2, base_weight_g: 151 },
  { canonical_name: 'Avocado, Hass, Fresh', variant: 'Raw', default_serving: '1/2 medium (100g)', calories: 160, protein: 2.0, carbs: 8.5, fat: 14.7, base_weight_g: 100 },
  { canonical_name: 'Watermelon, Fresh', variant: 'Diced', default_serving: '1 cup (152g)', calories: 46, protein: 0.9, carbs: 11.5, fat: 0.2, base_weight_g: 152 },
  { canonical_name: 'Mango, Fresh', variant: 'Pieces', default_serving: '1 cup (165g)', calories: 99, protein: 1.4, carbs: 24.7, fat: 0.6, base_weight_g: 165 },
  { canonical_name: 'Pineapple, Fresh', variant: 'Chunks', default_serving: '1 cup (165g)', calories: 82, protein: 0.9, carbs: 21.6, fat: 0.2, base_weight_g: 165 },
  { canonical_name: 'Peach, Fresh', variant: 'Medium', default_serving: '1 medium (150g)', calories: 59, protein: 1.4, carbs: 14.3, fat: 0.4, base_weight_g: 150 },
  { canonical_name: 'Pear, Fresh', variant: 'Medium', default_serving: '1 medium (178g)', calories: 101, protein: 0.6, carbs: 27.1, fat: 0.2, base_weight_g: 178 },
  { canonical_name: 'Kiwi Fruit, Fresh', variant: 'Peeled', default_serving: '1 fruit (69g)', calories: 42, protein: 0.8, carbs: 10.1, fat: 0.4, base_weight_g: 69 },
  { canonical_name: 'Lemon Juice, Fresh', variant: 'Fresh squeezed', default_serving: '1 tbsp (15g)', calories: 3, protein: 0.1, carbs: 1.0, fat: 0.0, base_weight_g: 15 },

  // --- Nuts, Seeds & Nut Butters ---
  { canonical_name: 'Almonds, Whole', variant: 'Raw/Dry Roasted', default_serving: '1 oz (28g)', calories: 164, protein: 6.0, carbs: 6.1, fat: 14.2, base_weight_g: 28 },
  { canonical_name: 'Walnuts, Halves', variant: 'Raw', default_serving: '1 oz (28g)', calories: 185, protein: 4.3, carbs: 3.9, fat: 18.5, base_weight_g: 28 },
  { canonical_name: 'Cashews, Raw', variant: 'Dry Roasted/Raw', default_serving: '1 oz (28g)', calories: 157, protein: 5.2, carbs: 8.6, fat: 12.4, base_weight_g: 28 },
  { canonical_name: 'Peanuts, Roasted, Salted', variant: 'Dry Roasted', default_serving: '1 oz (28g)', calories: 166, protein: 6.7, carbs: 6.0, fat: 14.1, base_weight_g: 28 },
  { canonical_name: 'Peanut Butter, 100% Peanuts', variant: 'Smooth/Crunchy Natural', default_serving: '2 tbsp (32g)', calories: 188, protein: 8.0, carbs: 6.3, fat: 16.1, base_weight_g: 32 },
  { canonical_name: 'Almond Butter, 100% Almonds', variant: 'Natural', default_serving: '2 tbsp (32g)', calories: 196, protein: 6.7, carbs: 6.0, fat: 17.8, base_weight_g: 32 },
  { canonical_name: 'Chia Seeds', variant: 'Dry Whole', default_serving: '1 tbsp (12g)', calories: 58, protein: 2.0, carbs: 5.0, fat: 3.7, base_weight_g: 12 },
  { canonical_name: 'Flaxseed, Ground', variant: 'Milled Meal', default_serving: '1 tbsp (7g)', calories: 37, protein: 1.3, carbs: 2.0, fat: 3.0, base_weight_g: 7 },
  { canonical_name: 'Pumpkin Seeds, Shelled', variant: 'Pepitas Raw', default_serving: '1 oz (28g)', calories: 158, protein: 8.6, carbs: 3.0, fat: 13.9, base_weight_g: 28 },
  { canonical_name: 'Sunflower Seeds, Kernels', variant: 'Roasted', default_serving: '1 oz (28g)', calories: 165, protein: 5.5, carbs: 6.8, fat: 14.1, base_weight_g: 28 },

  // --- Oils, Fats & Condiments ---
  { canonical_name: 'Extra Virgin Olive Oil', variant: '100% Pure EVOO', default_serving: '1 tbsp (14g)', calories: 119, protein: 0.0, carbs: 0.0, fat: 13.5, base_weight_g: 14 },
  { canonical_name: 'Canola / Rapeseed Oil', variant: 'Refined', default_serving: '1 tbsp (14g)', calories: 124, protein: 0.0, carbs: 0.0, fat: 14.0, base_weight_g: 14 },
  { canonical_name: 'Coconut Oil', variant: 'Virgin', default_serving: '1 tbsp (14g)', calories: 121, protein: 0.0, carbs: 0.0, fat: 13.5, base_weight_g: 14 },
  { canonical_name: 'Honey, Pure', variant: 'Raw/Pure', default_serving: '1 tbsp (21g)', calories: 64, protein: 0.1, carbs: 17.3, fat: 0.0, base_weight_g: 21 },
  { canonical_name: 'Maple Syrup, Pure', variant: 'Grade A', default_serving: '1 tbsp (20g)', calories: 52, protein: 0.0, carbs: 13.4, fat: 0.0, base_weight_g: 20 },
  { canonical_name: 'Balsamic Vinegar', variant: 'Traditional', default_serving: '1 tbsp (16g)', calories: 14, protein: 0.1, carbs: 2.7, fat: 0.0, base_weight_g: 16 },
  { canonical_name: 'Soy Sauce', variant: 'Regular/Brewed', default_serving: '1 tbsp (16g)', calories: 9, protein: 1.3, carbs: 0.8, fat: 0.0, base_weight_g: 16 },
  { canonical_name: 'Mayonnaise, Regular', variant: 'Traditional', default_serving: '1 tbsp (14g)', calories: 94, protein: 0.1, carbs: 0.1, fat: 10.3, base_weight_g: 14 },
  { canonical_name: 'Dijon Mustard', variant: 'Dijon', default_serving: '1 tsp (5g)', calories: 5, protein: 0.3, carbs: 0.3, fat: 0.3, base_weight_g: 5 },
  { canonical_name: 'Ketchup, Tomato', variant: 'Standard', default_serving: '1 tbsp (17g)', calories: 17, protein: 0.2, carbs: 4.5, fat: 0.0, base_weight_g: 17 },

  // --- Supplements & Beverages ---
  { canonical_name: 'Whey Protein Powder, Unflavored', variant: 'Isolate/Concentrate', default_serving: '1 scoop (30g)', calories: 115, protein: 24.0, carbs: 1.5, fat: 1.2, base_weight_g: 30 },
  { canonical_name: 'Dark Chocolate (70%–85% Cocoa)', variant: '70%–85%', default_serving: '1 oz (28g)', calories: 170, protein: 2.2, carbs: 13.0, fat: 12.0, base_weight_g: 28 },
  { canonical_name: 'Coffee, Black, Brewed', variant: 'No sugar/milk', default_serving: '1 cup (240ml)', calories: 2, protein: 0.3, carbs: 0.0, fat: 0.0, base_weight_g: 240 },
  { canonical_name: 'Espresso', variant: 'Single Shot', default_serving: '1 shot (30ml)', calories: 3, protein: 0.1, carbs: 0.5, fat: 0.1, base_weight_g: 30 },
  { canonical_name: 'Green Tea, Brewed', variant: 'Unsweetened', default_serving: '1 cup (240ml)', calories: 2, protein: 0.0, carbs: 0.0, fat: 0.0, base_weight_g: 240 },
];
