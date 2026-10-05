import { AIProviderClient, AIProviderConfig } from './types';
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER } from './constants';
import { GeminiClient } from './geminiClient';
import { OpenAICompatibleClient } from './openaiCompatibleClient';
import { AnthropicClient } from './anthropicClient';
import * as keychain from '../keychain';

export function createAIClient(config: AIProviderConfig): AIProviderClient {
  switch (config.provider) {
    case 'gemini':
      return new GeminiClient(config);
    case 'anthropic':
      return new AnthropicClient(config);
    case 'openai':
    case 'groq':
    case 'deepseek':
    case 'openrouter':
    case 'custom':
    default:
      return new OpenAICompatibleClient(config);
  }
}

export async function getActiveAIClient(): Promise<AIProviderClient> {
  const provider = (keychain.getActiveAIProvider ? await keychain.getActiveAIProvider() : null) || DEFAULT_AI_PROVIDER;

  let apiKey: string | null = null;
  if (provider === 'gemini' && keychain.getGeminiApiKey) {
    apiKey = await keychain.getGeminiApiKey();
  } else if (keychain.getAIProviderApiKey) {
    apiKey = await keychain.getAIProviderApiKey(provider);
  }

  let model: string = '';
  if (provider === 'gemini' && keychain.getGeminiModel) {
    model = await keychain.getGeminiModel();
  } else if (keychain.getAIProviderModel) {
    model = await keychain.getAIProviderModel(provider);
  }

  const customBaseUrl =
    provider === 'custom' && keychain.getCustomAIBaseUrl
      ? await keychain.getCustomAIBaseUrl()
      : null;

  return createAIClient({
    provider,
    apiKey,
    model: model || AI_PROVIDERS[provider]?.defaultModel || 'gemini-2.0-flash',
    customBaseUrl,
  });
}
