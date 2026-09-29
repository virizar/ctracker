import {
  mifflinStJeor,
  calculateAgeYears,
  formatDate,
  parseDate,
  calculateWeightEmaAlpha,
  calculateExpenditureEmaAlpha,
  calculateTrendWeightStep,
  calculateTdeeStep,
  calculateDailyTarget,
  CONSTANTS,
} from '../src/services/tdee';

describe('TDEE & Metabolic Engine Tests', () => {
  describe('mifflinStJeor', () => {
    it('calculates male BMR correctly', () => {
      // 80kg, 180cm, 30yo male: 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
      const bmr = mifflinStJeor(80, 180, 30, 'male');
      expect(bmr).toBeCloseTo(1780, 1);
    });

    it('calculates female BMR correctly', () => {
      // 60kg, 165cm, 28yo female: 10*60 + 6.25*165 - 5*28 - 161 = 600 + 1031.25 - 140 - 161 = 1330.25
      const bmr = mifflinStJeor(60, 165, 28, 'female');
      expect(bmr).toBeCloseTo(1330.25, 1);
    });
  });

  describe('calculateAgeYears', () => {
    it('computes exact age in years from date of birth', () => {
      const age = calculateAgeYears('1990-01-01', '2020-01-01');
      expect(Math.round(age)).toBe(30);
    });

    it('enforces a minimum age of 18', () => {
      const age = calculateAgeYears('2015-01-01', '2020-01-01');
      expect(age).toBe(18.0);
    });

    it('handles invalid dates gracefully with default age 38', () => {
      const age = calculateAgeYears('invalid-date', '2020-01-01');
      expect(age).toBe(38.0);
    });
  });

  describe('Date formatting and parsing', () => {
    it('formats dates as YYYY-MM-DD', () => {
      const d = new Date(2025, 4, 15); // May 15, 2025
      expect(formatDate(d)).toBe('2025-05-15');
    });

    it('parses YYYY-MM-DD into a valid Date object', () => {
      const d = parseDate('2025-05-15');
      expect(d.getFullYear()).toBe(2025);
      expect(d.getMonth()).toBe(4);
      expect(d.getDate()).toBe(15);
    });
  });

  describe('EMA Smoothing & Trend Weight Step', () => {
    it('calculates alpha for weight (TAU_W = 14 days)', () => {
      const alpha = calculateWeightEmaAlpha(14.0);
      expect(alpha).toBeCloseTo(1.0 - Math.exp(-1.0 / 14.0), 5);
      expect(alpha).toBeGreaterThan(0.06);
      expect(alpha).toBeLessThan(0.08);
    });

    it('smoothes scale weight towards the raw measurement', () => {
      const alpha = calculateWeightEmaAlpha(CONSTANTS.TAU_W);
      const prevTrend = 80.0;
      const rawScaleWeight = 81.0; // Temporary water spike
      const newTrend = calculateTrendWeightStep(prevTrend, rawScaleWeight, alpha);

      // New trend should increase slightly, dampening the 1kg spike
      expect(newTrend).toBeGreaterThan(80.0);
      expect(newTrend).toBeLessThan(80.1);
    });
  });

  describe('calculateTdeeStep', () => {
    it('increases TDEE when weight drops despite high calorie intake', () => {
      const prevTdee = 2200;
      const avgIntake = 2500;
      const weightChangeKg = -0.5; // lost 0.5kg in 14 days
      const windowDays = 14;

      const newTdee = calculateTdeeStep(prevTdee, avgIntake, weightChangeKg, windowDays);
      expect(newTdee).toBeGreaterThan(prevTdee);
    });

    it('decreases TDEE when weight rises despite low calorie intake', () => {
      const prevTdee = 2200;
      const avgIntake = 1800;
      const weightChangeKg = 0.5; // gained 0.5kg in 14 days
      const windowDays = 14;

      const newTdee = calculateTdeeStep(prevTdee, avgIntake, weightChangeKg, windowDays);
      expect(newTdee).toBeLessThan(prevTdee);
    });

    it('clamps raw TDEE within physiological safety bounds [1000, 5000]', () => {
      const prevTdee = 2000;
      // Extreme inputs
      const ultraLow = calculateTdeeStep(prevTdee, 200, 5.0, 14);
      expect(ultraLow).toBeGreaterThanOrEqual(1000);

      const ultraHigh = calculateTdeeStep(prevTdee, 8000, -5.0, 14);
      expect(ultraHigh).toBeLessThanOrEqual(5000);
    });
  });

  describe('calculateDailyTarget', () => {
    it('calculates calorie deficit for weight loss', () => {
      const tdee = 2500;
      const targetMonthlyLossKg = -2.0; // ~2kg loss per month
      const { targetCalories, isCapped } = calculateDailyTarget(tdee, targetMonthlyLossKg);

      // 2kg fat = 15400 kcal / 30.4375 days = ~506 kcal deficit
      expect(targetCalories).toBeCloseTo(1994, -1);
      expect(isCapped).toBe(false);
    });

    it('calculates calorie surplus for weight gain', () => {
      const tdee = 2500;
      const targetMonthlyGainKg = 1.0;
      const { targetCalories, isCapped } = calculateDailyTarget(tdee, targetMonthlyGainKg);

      expect(targetCalories).toBeGreaterThan(2500);
      expect(isCapped).toBe(false);
    });

    it('enforces minimum safety calorie floor (e.g. 1500 kcal)', () => {
      const tdee = 1600;
      const aggressiveLossKg = -4.0;
      const { targetCalories, isCapped } = calculateDailyTarget(tdee, aggressiveLossKg, 1500);

      expect(targetCalories).toBe(1500);
      expect(isCapped).toBe(true);
    });
  });
});
