export type AIProviderType =
  | 'gemini'
  | 'groq'
  | 'openai'
  | 'deepseek'
  | 'anthropic'
  | 'openrouter'
  | 'custom';

export interface AIProviderConfig {
  provider: AIProviderType;
  apiKey?: string | null;
  model: string;
  customBaseUrl?: string | null;
}

export interface AICompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  jsonSchema?: Record<string, any>;
  temperature?: number;
}

export interface AIConnectionTestResult {
  success: boolean;
  latencyMs?: number;
  message?: string;
  error?: string;
}

export interface AIProviderClient {
  readonly provider: AIProviderType;
  readonly model: string;
  complete(request: AICompletionRequest): Promise<string>;
  testConnection(): Promise<AIConnectionTestResult>;
}

export interface ModelPreset {
  id: string;
  label: string;
  description?: string;
}

export interface AIProviderMeta {
  id: AIProviderType;
  name: string;
  badge: string;
  description: string;
  defaultBaseUrl: string;
  requiresApiKey: boolean;
  defaultModel: string;
  modelPresets: ModelPreset[];
  consoleUrl: string;
  docsUrl: string;
}
