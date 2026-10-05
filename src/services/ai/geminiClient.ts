import { AICompletionRequest, AIConnectionTestResult, AIProviderClient, AIProviderConfig, AIProviderType } from './types';
import { AI_PROVIDERS } from './constants';

export class GeminiClient implements AIProviderClient {
  readonly provider: AIProviderType = 'gemini';
  readonly model: string;
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(config: AIProviderConfig) {
    this.model = config.model || AI_PROVIDERS.gemini.defaultModel;
    this.apiKey = config.apiKey || null;
    this.baseUrl = config.customBaseUrl || AI_PROVIDERS.gemini.defaultBaseUrl;
  }

  async complete(request: AICompletionRequest): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Gemini API key is not set. Please configure your API key in Settings.');
    }

    const trimmedBase = this.baseUrl.replace(/\/+$/, '');
    const url = `${trimmedBase}/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    const payload: any = {
      contents: [
        {
          role: 'user',
          parts: [{ text: request.userPrompt }],
        },
      ],
      systemInstruction: {
        parts: [{ text: request.systemPrompt }],
      },
      generationConfig: {
        temperature: request.temperature ?? 0.1,
        responseMimeType: 'application/json',
        ...(request.jsonSchema ? { responseSchema: request.jsonSchema } : {}),
        ...(this.model.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();
    return result?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  async testConnection(): Promise<AIConnectionTestResult> {
    const startTime = Date.now();
    try {
      if (!this.apiKey) {
        return { success: false, error: 'API key is missing' };
      }

      await this.complete({
        systemPrompt: 'Respond with a JSON array ["OK"]',
        userPrompt: 'Ping',
        temperature: 0.1,
      });

      const latencyMs = Date.now() - startTime;
      return {
        success: true,
        latencyMs,
        message: `Connected successfully (${latencyMs}ms)`,
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: err.message || 'Connection test failed',
      };
    }
  }
}
