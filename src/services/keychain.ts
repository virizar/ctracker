import * as SecureStore from 'expo-secure-store';

const GEMINI_API_KEY_STORAGE = 'CTRACKER_GEMINI_API_KEY';
const GEMINI_MODEL_STORAGE = 'CTRACKER_GEMINI_MODEL';

export async function getGeminiApiKey(): Promise<string | null> {
  return await SecureStore.getItemAsync(GEMINI_API_KEY_STORAGE);
}

export async function setGeminiApiKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(GEMINI_API_KEY_STORAGE, key.trim());
}

export async function deleteGeminiApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(GEMINI_API_KEY_STORAGE);
}

export async function getGeminiModel(): Promise<string> {
  const model = await SecureStore.getItemAsync(GEMINI_MODEL_STORAGE);
  return model || 'gemini-2.5-flash';
}

export async function setGeminiModel(model: string): Promise<void> {
  await SecureStore.setItemAsync(GEMINI_MODEL_STORAGE, model.trim());
}
