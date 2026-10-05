import * as SecureStore from 'expo-secure-store';
import {
  getActiveAIProvider,
  setActiveAIProvider,
  getAIProviderApiKey,
  setAIProviderApiKey,
  deleteAIProviderApiKey,
  getAIProviderModel,
  setAIProviderModel,
  getCustomAIBaseUrl,
  setCustomAIBaseUrl,
  getGeminiApiKey,
  setGeminiApiKey,
  deleteGeminiApiKey,
  getGeminiModel,
  setGeminiModel,
} from '../src/services/keychain';
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER } from '../src/services/ai/constants';

jest.mock('expo-secure-store');

describe('Keychain AI Multi-Provider Service', () => {
  const store = new Map<string, string>();

  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();

    (SecureStore.getItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      return store.get(key) || null;
    });

    (SecureStore.setItemAsync as jest.Mock).mockImplementation(async (key: string, val: string) => {
      store.set(key, val);
    });

    (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(async (key: string) => {
      store.delete(key);
    });
  });

  describe('Active Provider', () => {
    it('returns default provider when none is stored', async () => {
      const p = await getActiveAIProvider();
      expect(p).toBe(DEFAULT_AI_PROVIDER);
    });

    it('stores and retrieves active provider', async () => {
      await setActiveAIProvider('groq');
      const p = await getActiveAIProvider();
      expect(p).toBe('groq');
    });

    it('falls back to default if stored provider is invalid', async () => {
      store.set('CTRACKER_ACTIVE_AI_PROVIDER', 'invalid_provider');
      const p = await getActiveAIProvider();
      expect(p).toBe(DEFAULT_AI_PROVIDER);
    });
  });

  describe('API Keys', () => {
    it('sets, gets, and deletes API keys per provider', async () => {
      await setAIProviderApiKey('groq', 'gsk_test123');
      expect(await getAIProviderApiKey('groq')).toBe('gsk_test123');

      await deleteAIProviderApiKey('groq');
      expect(await getAIProviderApiKey('groq')).toBeNull();
    });

    it('deletes API key if empty string is passed to setAIProviderApiKey', async () => {
      await setAIProviderApiKey('openai', 'sk-initial');
      expect(await getAIProviderApiKey('openai')).toBe('sk-initial');

      await setAIProviderApiKey('openai', '   ');
      expect(await getAIProviderApiKey('openai')).toBeNull();
    });

    it('migrates legacy Gemini key to new key storage', async () => {
      store.set('CTRACKER_GEMINI_API_KEY', 'legacy-key-xyz');

      const migratedKey = await getAIProviderApiKey('gemini');
      expect(migratedKey).toBe('legacy-key-xyz');
      expect(store.get('CTRACKER_AI_KEY_GEMINI')).toBe('legacy-key-xyz');
    });

    it('keeps backwards-compatible getGeminiApiKey / setGeminiApiKey working', async () => {
      await setGeminiApiKey('gemini-sync-key');
      expect(await getGeminiApiKey()).toBe('gemini-sync-key');
      expect(store.get('CTRACKER_GEMINI_API_KEY')).toBe('gemini-sync-key');
      expect(store.get('CTRACKER_AI_KEY_GEMINI')).toBe('gemini-sync-key');

      await deleteGeminiApiKey();
      expect(await getGeminiApiKey()).toBeNull();
      expect(store.get('CTRACKER_GEMINI_API_KEY')).toBeUndefined();
      expect(store.get('CTRACKER_AI_KEY_GEMINI')).toBeUndefined();
    });
  });

  describe('Models', () => {
    it('returns default model when none is configured', async () => {
      const defaultGemini = await getAIProviderModel('gemini');
      expect(defaultGemini).toBe(AI_PROVIDERS.gemini.defaultModel);

      const defaultGroq = await getAIProviderModel('groq');
      expect(defaultGroq).toBe(AI_PROVIDERS.groq.defaultModel);
    });

    it('stores and retrieves custom model per provider', async () => {
      await setAIProviderModel('groq', 'llama-3.1-8b-instant');
      expect(await getAIProviderModel('groq')).toBe('llama-3.1-8b-instant');
    });

    it('falls back to legacy Gemini model if present', async () => {
      store.set('CTRACKER_GEMINI_MODEL', 'gemini-1.5-pro');
      expect(await getGeminiModel()).toBe('gemini-1.5-pro');
      expect(await getAIProviderModel('gemini')).toBe('gemini-1.5-pro');
    });

    it('sets Gemini model through backwards-compatible setGeminiModel', async () => {
      await setGeminiModel('gemini-2.0-flash');
      expect(await getGeminiModel()).toBe('gemini-2.0-flash');
      expect(store.get('CTRACKER_GEMINI_MODEL')).toBe('gemini-2.0-flash');
      expect(store.get('CTRACKER_AI_MODEL_GEMINI')).toBe('gemini-2.0-flash');
    });
  });

  describe('Custom Base URL', () => {
    it('returns default base url for custom provider when not set', async () => {
      expect(await getCustomAIBaseUrl()).toBe(AI_PROVIDERS.custom.defaultBaseUrl);
    });

    it('stores and retrieves custom base url', async () => {
      await setCustomAIBaseUrl('http://192.168.0.42:11434/v1');
      expect(await getCustomAIBaseUrl()).toBe('http://192.168.0.42:11434/v1');
    });
  });
});
