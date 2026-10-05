import { AICompletionRequest, AIConnectionTestResult, AIProviderClient, AIProviderConfig, AIProviderType } from './types';
import { AI_PROVIDERS } from './constants';
import { stripThinking } from './cleaner';

export class AnthropicClient implements AIProviderClient {
  readonly provider: AIProviderType = 'anthropic';
  readonly model: string;
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(config: AIProviderConfig) {
    this.model = config.model || AI_PROVIDERS.anthropic.defaultModel;
    this.apiKey = config.apiKey || null;
    this.baseUrl = config.customBaseUrl || AI_PROVIDERS.anthropic.defaultBaseUrl;
  }

  private getMessagesUrl(): string {
    const trimmed = this.baseUrl.replace(/\/+$/, '');
    if (trimmed.endsWith('/messages')) {
      return trimmed;
    }
    return `${trimmed}/messages`;
  }

  async complete(request: AICompletionRequest): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key is not configured. Please set your API key in Settings.');
    }

    const url = this.getMessagesUrl();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };

    const payload = {
      model: this.model,
      max_tokens: 4096,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userPrompt }],
      temperature: request.temperature ?? 0.1,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();
    const rawContent = result?.content?.[0]?.text || '';
    return stripThinking(rawContent);
  }

  async testConnection(): Promise<AIConnectionTestResult> {
    const startTime = Date.now();
    try {
      if (!this.apiKey) {
        return { success: false, error: 'API key is missing' };
      }

      await this.complete({
        systemPrompt: 'Respond with a JSON object: {"status": "ok"}',
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
