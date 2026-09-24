import { storage } from './storage';

export const GROQ_STORAGE_KEY = 'custom_groq_api_key';
export const GEMINI_STORAGE_KEY = 'custom_gemini_api_key';
export const EMIS_STORAGE_KEY = 'custom_emis_api_key';

export function getCustomGroqKey(): string {
  return (storage.getItem(GROQ_STORAGE_KEY) || '').trim();
}

export function setCustomGroqKey(key: string): void {
  const clean = key.trim();
  if (clean) {
    storage.setItem(GROQ_STORAGE_KEY, clean);
  } else {
    storage.removeItem(GROQ_STORAGE_KEY);
  }
}

export function getCustomGeminiKey(): string {
  return (storage.getItem(GEMINI_STORAGE_KEY) || '').trim();
}

export function setCustomGeminiKey(key: string): void {
  const clean = key.trim();
  if (clean) {
    storage.setItem(GEMINI_STORAGE_KEY, clean);
  } else {
    storage.removeItem(GEMINI_STORAGE_KEY);
  }
}

export function getCustomEmisKey(): string {
  return (storage.getItem(EMIS_STORAGE_KEY) || '').trim();
}

export function setCustomEmisKey(key: string): void {
  const clean = key.trim();
  if (clean) {
    storage.setItem(EMIS_STORAGE_KEY, clean);
  } else {
    storage.removeItem(EMIS_STORAGE_KEY);
  }
}

export function hasAnyCustomKey(): boolean {
  return Boolean(getCustomGroqKey() || getCustomGeminiKey() || getCustomEmisKey());
}

/**
 * Returns header dictionary to attach to every AI fetch request
 */
export function getAiRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const groq = getCustomGroqKey();
  if (groq) headers['x-groq-api-key'] = groq;

  const gemini = getCustomGeminiKey();
  if (gemini) headers['x-gemini-api-key'] = gemini;

  const emis = getCustomEmisKey();
  if (emis) {
    headers['x-emis-api-key'] = emis;
    headers['x-api-key'] = emis;
  }
  return headers;
}

export interface ServerAiStatus {
  isCloudRun: boolean;
  serverEnvKeys: {
    groq: boolean;
    gemini: boolean;
    emis: boolean;
  };
  activeKeys: {
    hasGroqKey: boolean;
    hasGeminiKey: boolean;
    hasEmisKey: boolean;
  };
}

export async function fetchAiStatus(): Promise<ServerAiStatus | null> {
  try {
    const res = await fetch('/api/ai/status', {
      headers: getAiRequestHeaders()
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.error('Failed to fetch AI status:', e);
  }
  return null;
}

export async function verifyApiKey(
  provider: 'groq' | 'gemini' | 'emis',
  key: string
): Promise<{ valid: boolean; message: string }> {
  try {
    const res = await fetch('/api/ai/verify-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, key: key.trim() })
    });
    const data = await res.json();
    return {
      valid: Boolean(data.valid),
      message: data.message || (data.valid ? 'API key is valid!' : 'Verification failed')
    };
  } catch (err: any) {
    return {
      valid: false,
      message: err?.message || 'Network error verifying API key'
    };
  }
}
