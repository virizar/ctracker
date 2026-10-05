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
  calculatePhysiologicalDailyTarget,
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

  describe('calculatePhysiologicalDailyTarget', () => {
    it('automatically transitions to maintenance when within 0.35kg of target', () => {
      const result = calculatePhysiologicalDailyTarget({
        tdee: 2400,
        currentWeightKg: 80.2,
        targetWeightKg: 80.0,
        heightCm: 180,
        ageYears: 30,
        sex: 'male',
        pace: 'balanced',
      });

      expect(result.mode).toBe('maintain');
      expect(result.targetCalories).toBe(2400);
      expect(result.dailyDeficit).toBe(0);
      expect(result.weeklyRateKg).toBe(0);
    });

    it('calculates controlled surplus for muscle gain when target is above current weight', () => {
      const result = calculatePhysiologicalDailyTarget({
        tdee: 2200,
        currentWeightKg: 75.0,
        targetWeightKg: 80.0,
        heightCm: 180,
        ageYears: 25,
        sex: 'male',
        pace: 'balanced',
      });

      expect(result.mode).toBe('gain');
      expect(result.targetCalories).toBeGreaterThan(2200);
      expect(result.dailyDeficit).toBeLessThan(0); // negative deficit = surplus
      expect(result.weeklyRateKg).toBeGreaterThan(0);
    });

    it('protects lean individuals by scaling deficit with BMI and leanness', () => {
      // Very lean male: 68kg at 185cm (BMI ~19.9)
      const lean = calculatePhysiologicalDailyTarget({
        tdee: 2400,
        currentWeightKg: 68.0,
        targetWeightKg: 64.0,
        heightCm: 185,
        ageYears: 30,
        sex: 'male',
        pace: 'balanced',
      });

      // Higher adipose male: 95kg at 185cm (BMI ~27.8)
      const higherAdipose = calculatePhysiologicalDailyTarget({
        tdee: 2400,
        currentWeightKg: 95.0,
        targetWeightKg: 85.0,
        heightCm: 185,
        ageYears: 30,
        sex: 'male',
        pace: 'balanced',
      });

      // The lean individual must have a lower % BW rate of loss to protect muscle
      expect(lean.weeklyRatePercent).toBeLessThan(higherAdipose.weeklyRatePercent);
      expect(lean.dailyDeficit).toBeLessThan(higherAdipose.dailyDeficit);
    });

    it('differentiates height for identical weight (85kg at 155cm vs 85kg at 218cm)', () => {
      // Short person (BMI ~35.4 - high adipose reserves)
      const shortPerson = calculatePhysiologicalDailyTarget({
        tdee: 2400,
        currentWeightKg: 85.0,
        targetWeightKg: 75.0,
        heightCm: 155,
        ageYears: 30,
        sex: 'male',
        pace: 'balanced',
      });

      // Tall person (BMI ~17.9 - severely lean/underweight)
      const tallPerson = calculatePhysiologicalDailyTarget({
        tdee: 2400,
        currentWeightKg: 85.0,
        targetWeightKg: 75.0,
        heightCm: 218,
        ageYears: 30,
        sex: 'male',
        pace: 'balanced',
      });

      // Tall lean individual gets a safer, smaller deficit to prevent organ/muscle loss
      expect(tallPerson.weeklyRatePercent).toBeLessThan(shortPerson.weeklyRatePercent);
      expect(tallPerson.dailyDeficit).toBeLessThan(shortPerson.dailyDeficit);
    });

    it('applies age sarcopenia guardrails for older adults (>50yo)', () => {
      const youngAdult = calculatePhysiologicalDailyTarget({
        tdee: 2500,
        currentWeightKg: 85.0,
        targetWeightKg: 75.0,
        heightCm: 180,
        ageYears: 28,
        sex: 'male',
        pace: 'balanced',
      });

      const olderAdult = calculatePhysiologicalDailyTarget({
        tdee: 2500,
        currentWeightKg: 85.0,
        targetWeightKg: 75.0,
        heightCm: 180,
        ageYears: 65,
        sex: 'male',
        pace: 'balanced',
      });

      expect(olderAdult.dailyDeficit).toBeLessThan(youngAdult.dailyDeficit);
    });

    it('enforces sex-specific metabolic safety floors', () => {
      // Female with low TDEE
      const femaleResult = calculatePhysiologicalDailyTarget({
        tdee: 1350,
        currentWeightKg: 60.0,
        targetWeightKg: 52.0,
        heightCm: 160,
        ageYears: 30,
        sex: 'female',
        pace: 'ambitious',
      });

      // Target should never drop below physiological floor
      expect(femaleResult.targetCalories).toBeGreaterThanOrEqual(femaleResult.minFloor);
      expect(femaleResult.isCapped).toBe(true);

      // Male with low TDEE
      const maleResult = calculatePhysiologicalDailyTarget({
        tdee: 1600,
        currentWeightKg: 80.0,
        targetWeightKg: 70.0,
        heightCm: 175,
        ageYears: 30,
        sex: 'male',
        pace: 'ambitious',
      });

      expect(maleResult.targetCalories).toBeGreaterThanOrEqual(1500);
      expect(maleResult.isCapped).toBe(true);
    });

    it('scales deficit appropriately across gentle, balanced, and ambitious paces', () => {
      const baseParams = {
        tdee: 2500,
        currentWeightKg: 85.0,
        targetWeightKg: 75.0,
        heightCm: 180,
        ageYears: 30,
        sex: 'male' as const,
      };

      const gentle = calculatePhysiologicalDailyTarget({ ...baseParams, pace: 'gentle' });
      const balanced = calculatePhysiologicalDailyTarget({ ...baseParams, pace: 'balanced' });
      const ambitious = calculatePhysiologicalDailyTarget({ ...baseParams, pace: 'ambitious' });

      expect(gentle.dailyDeficit).toBeLessThan(balanced.dailyDeficit);
      expect(balanced.dailyDeficit).toBeLessThan(ambitious.dailyDeficit);
      expect(gentle.targetCalories).toBeGreaterThan(balanced.targetCalories);
      expect(balanced.targetCalories).toBeGreaterThan(ambitious.targetCalories);
    });
  });

  describe('Alpha EMA calculations', () => {
    it('calculates expenditure EMA alpha correctly', () => {
      const alpha = calculateExpenditureEmaAlpha(14);
      expect(alpha).toBeCloseTo(1 - Math.exp(-1 / 14), 4);
    });

    it('calculates weight EMA alpha correctly', () => {
      const alpha = calculateWeightEmaAlpha(10);
      expect(alpha).toBeCloseTo(1 - Math.exp(-1 / 10), 4);
    });
  });

  describe('recalculateUserTdee integration', () => {
    it('returns early when user profile is not found', async () => {
      const { recalculateUserTdee } = require('../src/services/tdee');
      const queries = require('../src/db/queries');
      jest.spyOn(queries, 'getUserProfile').mockResolvedValueOnce(null);

      await expect(recalculateUserTdee('unknown_user')).resolves.toBeUndefined();
    });

    it('returns early when no weight or food logs exist', async () => {
      const { recalculateUserTdee } = require('../src/services/tdee');
      const queries = require('../src/db/queries');
      const dbMod = require('../src/db/database');

      jest.spyOn(queries, 'getUserProfile').mockResolvedValueOnce({
        username: 'user',
        dob: '1990-01-01',
        height_cm: 180,
        sex: 'male',
        activity_multiplier: 1.4,
        target_weight_kg: 75,
        target_monthly_rate_kg: -2,
        min_daily_calories: 1500,
        protein_ratio: 0.3,
        carbs_ratio: 0.4,
        fat_ratio: 0.3,
      });

      const mockDb = {
        getAllAsync: jest.fn().mockResolvedValue([]),
        withTransactionAsync: jest.fn(),
      };
      jest.spyOn(dbMod, 'getDatabase').mockResolvedValueOnce(mockDb as any);

      await expect(recalculateUserTdee('user')).resolves.toBeUndefined();
      expect(mockDb.withTransactionAsync).not.toHaveBeenCalled();
    });

    it('computes trend weights, rolling TDEE window, and upserts daily summaries across date range', async () => {
      const { recalculateUserTdee } = require('../src/services/tdee');
      const queries = require('../src/db/queries');
      const dbMod = require('../src/db/database');

      jest.spyOn(queries, 'getUserProfile').mockResolvedValueOnce({
        username: 'user',
        dob: '1990-01-01',
        height_cm: 180,
        sex: 'male',
        activity_multiplier: 1.4,
        target_weight_kg: 75,
        target_monthly_rate_kg: -2,
        loss_pace: 'balanced',
        min_daily_calories: 1500,
        protein_ratio: 0.3,
        carbs_ratio: 0.4,
        fat_ratio: 0.3,
      });

      const upsertMock = jest.spyOn(queries, 'upsertDailySummary').mockResolvedValue(undefined as any);

      // 18 days of weight & meals
      const mockWeights = [
        { date: '2026-09-01', raw_weight: 85.0 },
        { date: '2026-09-10', raw_weight: 84.0 },
        { date: '2026-09-18', raw_weight: 83.0 },
      ];

      const mockMeals: Array<{ date: string; total_calories: number; total_protein: number; total_carbs: number; total_fat: number }> = [];
      for (let day = 1; day <= 18; day++) {
        const dStr = `2026-09-${String(day).padStart(2, '0')}`;
        mockMeals.push({
          date: dStr,
          total_calories: 2200,
          total_protein: 150,
          total_carbs: 220,
          total_fat: 60,
        });
      }

      const mockDb = {
        getAllAsync: jest.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('scale_weights')) return mockWeights;
          if (sql.includes('meal_logs')) return mockMeals;
          return [];
        }),
        withTransactionAsync: jest.fn().mockImplementation(async (cb: () => Promise<void>) => {
          await cb();
        }),
      };
      jest.spyOn(dbMod, 'getDatabase').mockResolvedValueOnce(mockDb as any);

      await recalculateUserTdee('user');

      expect(mockDb.withTransactionAsync).toHaveBeenCalledTimes(1);
      expect(upsertMock).toHaveBeenCalled();
      // Ensure daily summary was upserted with non-zero trend_weight and target_calories
      const lastCallArg = upsertMock.mock.calls[upsertMock.mock.calls.length - 1][0] as any;
      expect(lastCallArg.username).toBe('user');
      expect(lastCallArg.trend_weight).toBeGreaterThan(80);
      expect(lastCallArg.target_calories).toBeGreaterThan(1200);
      expect(lastCallArg.tdee).toBeGreaterThan(1500);
    });
  });
});
