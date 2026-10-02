import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const GEMINI_API_KEY_STORAGE = 'CTRACKER_GEMINI_API_KEY';
const GEMINI_MODEL_STORAGE = 'CTRACKER_GEMINI_MODEL';

export async function getGeminiApiKey(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(GEMINI_API_KEY_STORAGE) : null;
    } catch {
      return null;
    }
  }
  return await SecureStore.getItemAsync(GEMINI_API_KEY_STORAGE);
}

export async function setGeminiApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(GEMINI_API_KEY_STORAGE, trimmed);
      }
    } catch {}
    return;
  }
  await SecureStore.setItemAsync(GEMINI_API_KEY_STORAGE, trimmed);
}

export async function deleteGeminiApiKey(): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(GEMINI_API_KEY_STORAGE);
      }
    } catch {}
    return;
  }
  await SecureStore.deleteItemAsync(GEMINI_API_KEY_STORAGE);
}

export async function getGeminiModel(): Promise<string> {
  if (Platform.OS === 'web') {
    try {
      const model = typeof localStorage !== 'undefined' ? localStorage.getItem(GEMINI_MODEL_STORAGE) : null;
      return model || 'gemini-2.5-flash';
    } catch {
      return 'gemini-2.5-flash';
    }
  }
  const model = await SecureStore.getItemAsync(GEMINI_MODEL_STORAGE);
  return model || 'gemini-2.5-flash';
}

export async function setGeminiModel(model: string): Promise<void> {
  const trimmed = model.trim();
  if (Platform.OS === 'web') {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(GEMINI_MODEL_STORAGE, trimmed);
      }
    } catch {}
    return;
  }
  await SecureStore.setItemAsync(GEMINI_MODEL_STORAGE, trimmed);
}
