import {
  normalizeDate,
  findRowDate,
  buildServingSize,
} from '../src/services/importer';

describe('Data Importer Parsing & Normalization Tests', () => {
  describe('normalizeDate', () => {
    it('preserves valid YYYY-MM-DD strings', () => {
      expect(normalizeDate('2024-03-21')).toBe('2024-03-21');
      expect(normalizeDate('  2023-12-31  ')).toBe('2023-12-31');
    });

    it('parses Excel serial date numbers', () => {
      // 45372 in Excel corresponds to March 21, 2024
      const result = normalizeDate(45372);
      expect(result).toMatch(/^2024-03-\d{2}$/);
    });

    it('parses MM/DD/YYYY dates with format hint or auto-detection', () => {
      expect(normalizeDate('04/18/2024', 'MM/DD/YYYY')).toBe('2024-04-18');
      expect(normalizeDate('11/05/2023')).toBe('2023-11-05');
    });

    it('parses DD/MM/YYYY dates when month exceeds 12 or hint provided', () => {
      // Day 25 > 12, so auto-detects DD/MM/YYYY
      expect(normalizeDate('25/08/2024')).toBe('2024-08-25');
      expect(normalizeDate('05/11/2023', 'DD/MM/YYYY')).toBe('2023-11-05');
    });

    it('returns null for empty or invalid date strings', () => {
      expect(normalizeDate('')).toBeNull();
      expect(normalizeDate(null)).toBeNull();
      expect(normalizeDate('not-a-date')).toBeNull();
    });
  });

  describe('findRowDate', () => {
    it('detects date column with standard header', () => {
      const row = { Date: '2024-03-21', Food: 'Apple', Calories: 95 };
      expect(findRowDate(row)).toBe('2024-03-21');
    });

    it('strips UTF-8 BOM characters and quotes from header keys', () => {
      const row = { '\uFEFF"Date"': '2024-05-10', Food: 'Banana' };
      expect(findRowDate(row)).toBe('2024-05-10');
    });

    it('detects case-insensitive date columns', () => {
      const row = { log_date: '2024-01-01', calories: 500 };
      expect(findRowDate(row)).toBe('2024-01-01');
    });

    it('returns null if no date header is present', () => {
      const row = { Food: 'Oatmeal', Calories: 150 };
      expect(findRowDate(row)).toBeNull();
    });
  });

  describe('buildServingSize', () => {
    it('formats quantity and unit nicely', () => {
      const row = {
        'Serving Qty': 2,
        'Serving Size': 'large egg',
      };
      expect(buildServingSize(row)).toBe('2 large egg');
    });

    it('includes weight in grams if available and unit is not already grams', () => {
      const row = {
        Quantity: '1',
        Unit: 'cup',
        'Weight (g)': '240',
      };
      expect(buildServingSize(row)).toBe('1 cup (240g)');
    });

    it('does not duplicate grams when unit is already grams', () => {
      const row = {
        Quantity: '150',
        Unit: 'g',
        'Weight (g)': '150',
      };
      expect(buildServingSize(row)).toBe('150 g');
    });

    it('falls back to "1 serving" when no quantity or unit columns are present', () => {
      const row = {
        'Food Name': 'Black Coffee',
        Calories: 5,
      };
      expect(buildServingSize(row)).toBe('1 serving');
    });
  });
});
