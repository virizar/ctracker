import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { AIProviderType } from './ai/types';
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER } from './ai/constants';

const ACTIVE_PROVIDER_STORAGE = 'CTRACKER_ACTIVE_AI_PROVIDER';
const CUSTOM_BASE_URL_STORAGE = 'CTRACKER_AI_CUSTOM_BASE_URL';

// Helper for storage get
async function getStorageItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }
  return await SecureStore.getItemAsync(key);
}

// Helper for storage set
async function setStorageItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } catch {}
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

// Helper for storage delete
async function deleteStorageItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
    } catch {}
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

// --- Active Provider ---
export async function getActiveAIProvider(): Promise<AIProviderType> {
  const stored = await getStorageItem(ACTIVE_PROVIDER_STORAGE);
  if (stored && Object.keys(AI_PROVIDERS).includes(stored)) {
    return stored as AIProviderType;
  }
  return DEFAULT_AI_PROVIDER;
}

export async function setActiveAIProvider(provider: AIProviderType): Promise<void> {
  await setStorageItem(ACTIVE_PROVIDER_STORAGE, provider);
}

// --- Per-Provider API Keys ---
export async function getAIProviderApiKey(provider: AIProviderType): Promise<string | null> {
  const keyStorageName = `CTRACKER_AI_KEY_${provider.toUpperCase()}`;
  const key = await getStorageItem(keyStorageName);
  if (key) return key;

  // Backwards compatibility migration for legacy Gemini key
  if (provider === 'gemini') {
    const legacyKey = await getStorageItem('CTRACKER_GEMINI_API_KEY');
    if (legacyKey) {
      await setStorageItem(keyStorageName, legacyKey);
      return legacyKey;
    }
  }
  return null;
}

export async function setAIProviderApiKey(provider: AIProviderType, apiKey: string): Promise<void> {
  const keyStorageName = `CTRACKER_AI_KEY_${provider.toUpperCase()}`;
  const trimmed = apiKey.trim();
  if (!trimmed) {
    await deleteStorageItem(keyStorageName);
  } else {
    await setStorageItem(keyStorageName, trimmed);
  }

  // Also sync legacy key if gemini
  if (provider === 'gemini') {
    if (!trimmed) {
      await deleteStorageItem('CTRACKER_GEMINI_API_KEY');
    } else {
      await setStorageItem('CTRACKER_GEMINI_API_KEY', trimmed);
    }
  }
}

export async function deleteAIProviderApiKey(provider: AIProviderType): Promise<void> {
  const keyStorageName = `CTRACKER_AI_KEY_${provider.toUpperCase()}`;
  await deleteStorageItem(keyStorageName);
  if (provider === 'gemini') {
    await deleteStorageItem('CTRACKER_GEMINI_API_KEY');
  }
}

// --- Per-Provider Models ---
export async function getAIProviderModel(provider: AIProviderType): Promise<string> {
  const modelStorageName = `CTRACKER_AI_MODEL_${provider.toUpperCase()}`;
  const model = await getStorageItem(modelStorageName);
  if (model && model.trim()) return model.trim();

  // Legacy fallback for Gemini
  if (provider === 'gemini') {
    const legacyModel = await getStorageItem('CTRACKER_GEMINI_MODEL');
    if (legacyModel && legacyModel.trim()) return legacyModel.trim();
  }

  return AI_PROVIDERS[provider]?.defaultModel || 'gemini-2.0-flash';
}

export async function setAIProviderModel(provider: AIProviderType, model: string): Promise<void> {
  const modelStorageName = `CTRACKER_AI_MODEL_${provider.toUpperCase()}`;
  const trimmed = model.trim();
  await setStorageItem(modelStorageName, trimmed);

  if (provider === 'gemini') {
    await setStorageItem('CTRACKER_GEMINI_MODEL', trimmed);
  }
}

// --- Custom Endpoint URL ---
export async function getCustomAIBaseUrl(): Promise<string> {
  const url = await getStorageItem(CUSTOM_BASE_URL_STORAGE);
  return url && url.trim() ? url.trim() : AI_PROVIDERS.custom.defaultBaseUrl;
}

export async function setCustomAIBaseUrl(url: string): Promise<void> {
  await setStorageItem(CUSTOM_BASE_URL_STORAGE, url.trim());
}

// --- Backwards-Compatible Helpers for Gemini ---
export async function getGeminiApiKey(): Promise<string | null> {
  return getAIProviderApiKey('gemini');
}

export async function setGeminiApiKey(key: string): Promise<void> {
  return setAIProviderApiKey('gemini', key);
}

export async function deleteGeminiApiKey(): Promise<void> {
  return deleteAIProviderApiKey('gemini');
}

export async function getGeminiModel(): Promise<string> {
  return getAIProviderModel('gemini');
}

export async function setGeminiModel(model: string): Promise<void> {
  return setAIProviderModel('gemini', model);
}
