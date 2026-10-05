import { GeminiClient } from '../src/services/ai/geminiClient';
import { OpenAICompatibleClient } from '../src/services/ai/openaiCompatibleClient';
import { AnthropicClient } from '../src/services/ai/anthropicClient';
import { createAIClient, getActiveAIClient } from '../src/services/ai/clientFactory';
import * as keychain from '../src/services/keychain';

jest.mock('../src/services/keychain');

describe('AI Clients Unit Tests', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('GeminiClient', () => {
    it('throws if API key is missing', async () => {
      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        apiKey: null,
      });

      await expect(
        client.complete({ systemPrompt: 'System', userPrompt: 'User' })
      ).rejects.toThrow('Gemini API key is not set. Please configure your API key in Settings.');
    });

    it('sends correct payload including responseSchema and extracts candidate', async () => {
      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        apiKey: 'test-gemini-key',
      });

      let requestedUrl = '';
      let requestedBody: any = null;

      global.fetch = jest.fn().mockImplementation(async (url, opts) => {
        requestedUrl = url as string;
        requestedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: '[{"food": "egg"}]' }] } }],
          }),
        };
      });

      const response = await client.complete({
        systemPrompt: 'System instruction',
        userPrompt: 'User prompt',
        jsonSchema: { type: 'ARRAY' },
        temperature: 0.2,
      });

      expect(response).toBe('[{"food": "egg"}]');
      expect(requestedUrl).toContain('models/gemini-2.5-flash:generateContent?key=test-gemini-key');
      expect(requestedBody.generationConfig.temperature).toBe(0.2);
      expect(requestedBody.generationConfig.responseSchema).toEqual({ type: 'ARRAY' });
      expect(requestedBody.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    });

    it('throws when Gemini returns an HTTP error code', async () => {
      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        apiKey: 'test-gemini-key',
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      } as any);

      await expect(
        client.complete({ systemPrompt: 'Sys', userPrompt: 'User' })
      ).rejects.toThrow('Gemini API error (429): Rate limit exceeded');
    });

    it('testConnection returns success with latency', async () => {
      const client = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        apiKey: 'test-gemini-key',
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '["OK"]' }] } }],
        }),
      } as any);

      const result = await client.testConnection();
      expect(result.success).toBe(true);
      expect(typeof result.latencyMs).toBe('number');
      expect(result.message).toContain('Connected successfully');
    });

    it('testConnection returns failure on error or missing key', async () => {
      const clientNoKey = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        apiKey: null,
      });
      const resNoKey = await clientNoKey.testConnection();
      expect(resNoKey.success).toBe(false);
      expect(resNoKey.error).toBe('API key is missing');

      const clientErr = new GeminiClient({
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        apiKey: 'key',
      });
      global.fetch = jest.fn().mockRejectedValue(new Error('Network offline'));
      const resErr = await clientErr.testConnection();
      expect(resErr.success).toBe(false);
      expect(resErr.error).toBe('Network offline');
    });
  });

  describe('OpenAICompatibleClient', () => {
    it('throws if API key is required and missing', async () => {
      const client = new OpenAICompatibleClient({
        provider: 'openai',
        model: 'gpt-4o-mini',
        apiKey: null,
      });

      await expect(
        client.complete({ systemPrompt: 'Sys', userPrompt: 'User' })
      ).rejects.toThrow('OpenAI API key is not configured. Please set your API key in Settings.');
    });

    it('allows custom endpoint without API key and calls custom URL', async () => {
      const client = new OpenAICompatibleClient({
        provider: 'custom',
        model: 'llama3.2',
        apiKey: null,
        customBaseUrl: 'http://192.168.1.50:11434/v1',
      });

      let requestedUrl = '';
      let requestedHeaders: any = {};
      let requestedBody: any = null;

      global.fetch = jest.fn().mockImplementation(async (url, opts) => {
        requestedUrl = url as string;
        requestedHeaders = opts.headers;
        requestedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '<think>Analyzing</think>[{"food": "apple"}]' } }],
          }),
        };
      });

      const response = await client.complete({ systemPrompt: 'Sys', userPrompt: 'User' });
      expect(requestedUrl).toBe('http://192.168.1.50:11434/v1/chat/completions');
      expect(requestedHeaders['Authorization']).toBeUndefined();
      expect(requestedBody.response_format).toEqual({ type: 'json_object' });
      expect(response).toBe('[{"food": "apple"}]');
    });

    it('attaches OpenRouter specific headers', async () => {
      const client = new OpenAICompatibleClient({
        provider: 'openrouter',
        model: 'meta-llama/llama-3.3-70b-instruct',
        apiKey: 'or-key',
      });

      let requestedHeaders: any = {};
      global.fetch = jest.fn().mockImplementation(async (url, opts) => {
        requestedHeaders = opts.headers;
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"ok": true}' } }],
          }),
        };
      });

      await client.complete({ systemPrompt: 'Sys', userPrompt: 'User' });
      expect(requestedHeaders['Authorization']).toBe('Bearer or-key');
      expect(requestedHeaders['HTTP-Referer']).toBe('https://github.com/ctracker');
      expect(requestedHeaders['X-Title']).toBe('CTracker');
    });

    it('omits response_format for deepseek reasoner models', async () => {
      const client = new OpenAICompatibleClient({
        provider: 'deepseek',
        model: 'deepseek-reasoner',
        apiKey: 'ds-key',
      });

      let requestedBody: any = null;
      global.fetch = jest.fn().mockImplementation(async (url, opts) => {
        requestedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"ok": true}' } }],
          }),
        };
      });

      await client.complete({ systemPrompt: 'Sys', userPrompt: 'User' });
      expect(requestedBody.response_format).toBeUndefined();
    });

    it('handles testConnection for OpenAI compatible providers', async () => {
      const client = new OpenAICompatibleClient({
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        apiKey: 'groq-key',
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"status": "ok"}' } }],
        }),
      } as any);

      const res = await client.testConnection();
      expect(res.success).toBe(true);
      expect(typeof res.latencyMs).toBe('number');
    });
  });

  describe('AnthropicClient', () => {
    it('throws if API key is missing', async () => {
      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-haiku-20241022',
        apiKey: null,
      });

      await expect(
        client.complete({ systemPrompt: 'Sys', userPrompt: 'User' })
      ).rejects.toThrow('Anthropic API key is not configured. Please set your API key in Settings.');
    });

    it('sends correct headers and messages format to Anthropic', async () => {
      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-haiku-20241022',
        apiKey: 'sk-ant-test',
      });

      let requestedUrl = '';
      let requestedHeaders: any = {};
      let requestedBody: any = null;

      global.fetch = jest.fn().mockImplementation(async (url, opts) => {
        requestedUrl = url as string;
        requestedHeaders = opts.headers;
        requestedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            content: [{ type: 'text', text: '{"parsed": true}' }],
          }),
        };
      });

      const response = await client.complete({
        systemPrompt: 'System Anthropic',
        userPrompt: 'User Anthropic',
      });

      expect(requestedUrl).toBe('https://api.anthropic.com/v1/messages');
      expect(requestedHeaders['x-api-key']).toBe('sk-ant-test');
      expect(requestedHeaders['anthropic-version']).toBe('2023-06-01');
      expect(requestedHeaders['anthropic-dangerous-direct-browser-access']).toBe('true');
      expect(requestedBody.max_tokens).toBe(4096);
      expect(requestedBody.system).toBe('System Anthropic');
      expect(requestedBody.messages).toEqual([{ role: 'user', content: 'User Anthropic' }]);
      expect(response).toBe('{"parsed": true}');
    });

    it('handles testConnection for Anthropic', async () => {
      const client = new AnthropicClient({
        provider: 'anthropic',
        model: 'claude-3-5-haiku-20241022',
        apiKey: 'sk-ant-test',
      });

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ text: '{"status": "ok"}' }],
        }),
      } as any);

      const res = await client.testConnection();
      expect(res.success).toBe(true);
      expect(typeof res.latencyMs).toBe('number');
    });
  });

  describe('Factory Functions', () => {
    it('creates appropriate client instances based on provider type', () => {
      const gemini = createAIClient({ provider: 'gemini', model: 'm' });
      expect(gemini).toBeInstanceOf(GeminiClient);

      const anthropic = createAIClient({ provider: 'anthropic', model: 'm' });
      expect(anthropic).toBeInstanceOf(AnthropicClient);

      const groq = createAIClient({ provider: 'groq', model: 'm' });
      expect(groq).toBeInstanceOf(OpenAICompatibleClient);

      const custom = createAIClient({ provider: 'custom', model: 'm' });
      expect(custom).toBeInstanceOf(OpenAICompatibleClient);
    });

    it('getActiveAIClient retrieves active config from keychain', async () => {
      (keychain.getActiveAIProvider as jest.Mock).mockResolvedValue('groq');
      (keychain.getAIProviderApiKey as jest.Mock).mockResolvedValue('active-groq-key');
      (keychain.getAIProviderModel as jest.Mock).mockResolvedValue('llama-3.3-70b-versatile');

      const client = await getActiveAIClient();
      expect(client.provider).toBe('groq');
      expect(client.model).toBe('llama-3.3-70b-versatile');
    });
  });
});
