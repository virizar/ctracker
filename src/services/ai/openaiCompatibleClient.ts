import { AICompletionRequest, AIConnectionTestResult, AIProviderClient, AIProviderConfig, AIProviderType } from './types';
import { AI_PROVIDERS } from './constants';
import { stripThinking } from './cleaner';

export class OpenAICompatibleClient implements AIProviderClient {
  readonly provider: AIProviderType;
  readonly model: string;
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(config: AIProviderConfig) {
    this.provider = config.provider;
    const meta = AI_PROVIDERS[config.provider] || AI_PROVIDERS.openai;
    this.model = config.model || meta.defaultModel;
    this.apiKey = config.apiKey || null;
    this.baseUrl = config.customBaseUrl || meta.defaultBaseUrl;
  }

  private getChatCompletionsUrl(): string {
    const trimmed = this.baseUrl.replace(/\/+$/, '');
    if (trimmed.endsWith('/chat/completions')) {
      return trimmed;
    }
    return `${trimmed}/chat/completions`;
  }

  async complete(request: AICompletionRequest): Promise<string> {
    const meta = AI_PROVIDERS[this.provider];
    if (meta.requiresApiKey && !this.apiKey) {
      throw new Error(`${meta.name} API key is not configured. Please set your API key in Settings.`);
    }

    const url = this.getChatCompletionsUrl();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    if (this.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/ctracker';
      headers['X-Title'] = 'CTracker';
    }

    const payload: any = {
      model: this.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      temperature: request.temperature ?? 0.1,
    };

    // DeepSeek Reasoner does not support json_object mode, all other models do
    if (!this.model.includes('reasoner')) {
      payload.response_format = { type: 'json_object' };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`${meta?.name || 'AI'} API error (${response.status}): ${errorBody}`);
    }

    const result = await response.json();
    const rawContent = result?.choices?.[0]?.message?.content || '';
    return stripThinking(rawContent);
  }

  async testConnection(): Promise<AIConnectionTestResult> {
    const startTime = Date.now();
    try {
      const meta = AI_PROVIDERS[this.provider];
      if (meta.requiresApiKey && !this.apiKey) {
        return { success: false, error: 'API key is missing' };
      }

      await this.complete({
        systemPrompt: 'You are a test ping bot. Respond with JSON: {"status": "ok"}',
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
