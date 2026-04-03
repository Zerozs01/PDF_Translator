import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';

export type GeminiApiKeySource = 'secure-storage' | 'environment' | 'none';

export type GeminiApiKeyStatus = {
  configured: boolean;
  source: GeminiApiKeySource;
  supportsSecureStorage: boolean;
};

const SECURE_SETTINGS_DIR = 'secure-settings';
const GEMINI_API_KEY_FILE = 'gemini-api-key.bin';

const getSecureSettingsDir = (): string => {
  return path.join(app.getPath('userData'), SECURE_SETTINGS_DIR);
};

const getGeminiApiKeyFilePath = (): string => {
  return path.join(getSecureSettingsDir(), GEMINI_API_KEY_FILE);
};

const getEnvironmentGeminiApiKey = (): string => {
  return String(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '').trim();
};

const ensureSecureSettingsDir = (): void => {
  fs.mkdirSync(getSecureSettingsDir(), { recursive: true });
};

export const getGeminiApiKeyStatus = (): GeminiApiKeyStatus => {
  const secureFilePath = getGeminiApiKeyFilePath();
  if (fs.existsSync(secureFilePath)) {
    return {
      configured: true,
      source: 'secure-storage',
      supportsSecureStorage: safeStorage.isEncryptionAvailable(),
    };
  }

  if (getEnvironmentGeminiApiKey()) {
    return {
      configured: true,
      source: 'environment',
      supportsSecureStorage: safeStorage.isEncryptionAvailable(),
    };
  }

  return {
    configured: false,
    source: 'none',
    supportsSecureStorage: safeStorage.isEncryptionAvailable(),
  };
};

export const readStoredGeminiApiKey = (): string | null => {
  const secureFilePath = getGeminiApiKeyFilePath();
  if (!fs.existsSync(secureFilePath)) {
    return null;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level secure storage is not available.');
  }

  const encrypted = fs.readFileSync(secureFilePath);
  if (!encrypted || encrypted.length === 0) {
    return null;
  }

  return safeStorage.decryptString(encrypted).trim() || null;
};

export const resolveGeminiApiKey = (): string | null => {
  const storedKey = readStoredGeminiApiKey();
  if (storedKey) {
    return storedKey;
  }

  const envKey = getEnvironmentGeminiApiKey();
  return envKey || null;
};

export const setStoredGeminiApiKey = (apiKey: string): GeminiApiKeyStatus => {
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) {
    throw new Error('Gemini API key cannot be empty.');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level secure storage is not available on this device.');
  }

  ensureSecureSettingsDir();
  const encrypted = safeStorage.encryptString(trimmed);
  fs.writeFileSync(getGeminiApiKeyFilePath(), encrypted);

  return getGeminiApiKeyStatus();
};

export const clearStoredGeminiApiKey = (): GeminiApiKeyStatus => {
  const secureFilePath = getGeminiApiKeyFilePath();
  if (fs.existsSync(secureFilePath)) {
    fs.unlinkSync(secureFilePath);
  }
  return getGeminiApiKeyStatus();
};
