import { stripThinking, cleanJsonPayload, parseJsonArray } from '../src/services/ai/cleaner';

describe('AI Cleaner and Parser Utilities', () => {
  describe('stripThinking', () => {
    it('returns empty string for null, undefined, or empty text', () => {
      expect(stripThinking('')).toBe('');
      expect(stripThinking(null as any)).toBe('');
      expect(stripThinking(undefined as any)).toBe('');
    });

    it('strips <think>...</think> blocks from reasoning models', () => {
      const input = '<think>I need to parse the user input for eggs.</think>[{"food_name": "Eggs"}]';
      expect(stripThinking(input)).toBe('[{"food_name": "Eggs"}]');
    });

    it('strips multiline and case-insensitive <THINK> tags', () => {
      const input = `<THINK>
Step 1: Calculate calories
Step 2: Format JSON
</THINK>
{"status": "ok"}`;
      expect(stripThinking(input)).toBe('{"status": "ok"}');
    });

    it('strips unclosed <think> tag if model stream cuts off', () => {
      const input = '<think>Thinking about what food was eaten...';
      expect(stripThinking(input)).toBe('');
    });

    it('preserves clean text without think tags', () => {
      const input = '[{"food_name": "Apple"}]';
      expect(stripThinking(input)).toBe('[{"food_name": "Apple"}]');
    });
  });

  describe('cleanJsonPayload', () => {
    it('returns empty string for empty inputs', () => {
      expect(cleanJsonPayload('')).toBe('');
    });

    it('strips markdown json fences', () => {
      const input = '```json\n[{"food_name": "Banana"}]\n```';
      expect(cleanJsonPayload(input)).toBe('[{"food_name": "Banana"}]');
    });

    it('strips general markdown code fences', () => {
      const input = '```\n[{"food_name": "Banana"}]\n```';
      expect(cleanJsonPayload(input)).toBe('[{"food_name": "Banana"}]');
    });

    it('extracts JSON array if surrounded by conversational explanation', () => {
      const input = 'Here is the meal breakdown:\n[{"food_name": "Oatmeal"}]\nEnjoy your tracking!';
      expect(cleanJsonPayload(input)).toBe('[{"food_name": "Oatmeal"}]');
    });

    it('extracts JSON object if surrounded by conversational explanation', () => {
      const input = 'Sure, here is your object: {"status": "ok"}. Hope this helps!';
      expect(cleanJsonPayload(input)).toBe('{"status": "ok"}');
    });
  });

  describe('parseJsonArray', () => {
    it('returns empty array for empty candidate text', () => {
      expect(parseJsonArray('')).toEqual([]);
      expect(parseJsonArray('   ')).toEqual([]);
    });

    it('parses valid JSON array correctly', () => {
      const input = '[{"item": "Coffee", "calories": 5}]';
      expect(parseJsonArray(input)).toEqual([{ item: 'Coffee', calories: 5 }]);
    });

    it('returns empty array if parsed JSON is not an array', () => {
      const input = '{"error": "not an array"}';
      expect(parseJsonArray(input)).toEqual([]);
    });

    it('throws custom or fallback error on invalid JSON', () => {
      expect(() => parseJsonArray('invalid json string', 'Custom parse error')).toThrow(
        'Custom parse error'
      );
    });
  });
});
