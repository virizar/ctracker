/**
 * Utility functions for cleaning and parsing LLM outputs across providers.
 * Handles thought tags (<think>...</think>), markdown code blocks, and JSON extraction.
 */

export function stripThinking(text: string): string {
  if (!text) return '';
  // Remove matched <think>...</think>
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Remove any dangling unclosed <think> tag if model cut off before ending it
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');
  return cleaned.trim();
}

export function cleanJsonPayload(text: string): string {
  if (!text) return '';
  let clean = stripThinking(text).trim();

  // Strip markdown code block wrappers
  if (clean.startsWith('```json')) {
    clean = clean.slice(7);
  } else if (clean.startsWith('```')) {
    clean = clean.slice(3);
  }
  if (clean.endsWith('```')) {
    clean = clean.slice(0, -3);
  }
  clean = clean.trim();

  // If text has text around a JSON block, extract the JSON substring
  const firstBracket = clean.indexOf('[');
  const firstBrace = clean.indexOf('{');
  
  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    const lastBracket = clean.lastIndexOf(']');
    if (lastBracket > firstBracket) {
      clean = clean.substring(firstBracket, lastBracket + 1);
    }
  } else if (firstBrace !== -1) {
    const lastBrace = clean.lastIndexOf('}');
    if (lastBrace > firstBrace) {
      clean = clean.substring(firstBrace, lastBrace + 1);
    }
  }

  return clean.trim();
}

export function parseJsonArray<T = any>(
  candidateText: string,
  fallbackErrorMessage = 'Could not parse nutrition data returned by AI model.'
): T[] {
  if (!candidateText || !candidateText.trim()) {
    return [];
  }

  const cleaned = cleanJsonPayload(candidateText);

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error(fallbackErrorMessage);
  }
}
