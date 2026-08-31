import { ipcMain } from 'electron';
import { isValidString } from './ipcUtils';
import {
  runArgosTranslateBatch,
  type TranslationContext,
  normalizeArgosLanguage,
  LANGUAGE_DISPLAY_NAMES
} from '../argosBridge';
import {
  getGeminiApiKeyStatus,
  setStoredGeminiApiKey,
  clearStoredGeminiApiKey,
  resolveGeminiApiKey
} from '../secureSettings';

export function registerTranslationIpcHandlers() {
  // ============================================
  // Offline Translation IPC Handlers (Argos Translate)
  // ============================================
  ipcMain.handle('translate:offline', async (_, payload: { text: string; context?: TranslationContext }) => {
    if (!payload || typeof payload !== 'object' || !isValidString(payload.text)) {
      throw new Error('Invalid input: text must be a non-empty string');
    }

    try {
      const translated = await runArgosTranslateBatch([payload.text], payload.context);
      return translated[0] || '';
    } catch (error) {
      console.error('translate:offline error:', error);
      throw error;
    }
  });

  ipcMain.handle('translate:offline-batch', async (_, payload: { texts: string[]; context?: TranslationContext }) => {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.texts)) {
      throw new Error('Invalid input: texts must be an array');
    }
    const hasInvalidText = payload.texts.some((text) => typeof text !== 'string');
    if (hasInvalidText) {
      throw new Error('Invalid input: all texts must be strings');
    }

    try {
      return await runArgosTranslateBatch(payload.texts, payload.context);
    } catch (error) {
      console.error('translate:offline-batch error:', error);
      throw error;
    }
  });

  // ============================================
  // Gemini API Handler (SECURE: API key in main process only)
  // ============================================
  ipcMain.handle('gemini:get-api-key-status', async () => {
    return getGeminiApiKeyStatus();
  });

  ipcMain.handle('gemini:set-api-key', async (_, payload: { apiKey: string }) => {
    if (!payload || typeof payload !== 'object' || !isValidString(payload.apiKey)) {
      throw new Error('Invalid input: apiKey must be a non-empty string');
    }

    return setStoredGeminiApiKey(payload.apiKey);
  });

  ipcMain.handle('gemini:clear-api-key', async () => {
    return clearStoredGeminiApiKey();
  });

  ipcMain.handle('gemini:translate', async (_, { text, context }) => {
    // Input validation
    if (!isValidString(text)) {
      throw new Error('Invalid input: text must be a non-empty string');
    }
    if (!context || typeof context !== 'object') {
      throw new Error('Invalid input: context must be an object');
    }

    const {
      mode = 'manga',
      sourceType = 'text',
      sourceLanguage,
      targetLanguage,
      baseSystemPrompt,
    } = context as {
      mode?: string;
      sourceType?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      baseSystemPrompt?: string;
    };

    const normalizedMode = mode === 'official' ? 'official' : mode === 'manhwa' ? 'manhwa' : 'manga';

    const normalizedSource = normalizeArgosLanguage(sourceLanguage, 'en');
    const normalizedTarget = normalizeArgosLanguage(targetLanguage, 'th');
    const sourceName = LANGUAGE_DISPLAY_NAMES[normalizedSource] || normalizedSource;
    const targetName = LANGUAGE_DISPLAY_NAMES[normalizedTarget] || normalizedTarget;

    // Resolve API key from secure local storage first, then local environment.
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) {
      throw new Error('Gemini API key is not configured. Save it once in Settings or provide GEMINI_API_KEY locally.');
    }

    const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const modePrompt = normalizedMode === 'official'
      ? `You are a professional document translator. Translate from ${sourceName} to ${targetName}. Use clear, formal, and accurate wording. The source text is from OCR and may contain typos (e.g., "MY STERIOUS" -> "MYSTERIOUS", "UKELY" -> "LIKELY") and fragmented lines. Please fix these typos implicitly, combine fragmented lines to form coherent sentences, and translate them naturally into ${targetName} while preserving the general line break structure.`
      : normalizedMode === 'manhwa'
        ? `You are a professional manhwa translator. Translate from ${sourceName} to ${targetName}. Keep dialogue natural and emotionally accurate. The source text is from OCR and may contain typos and fragmented lines. Please fix typos implicitly, combine fragmented lines to form coherent sentences, and translate them naturally into ${targetName} while preserving the general line break structure.`
        : `You are a professional manga translator. Translate from ${sourceName} to ${targetName}. Use informal and emotional wording that matches manga tone. The source text is from OCR and may contain typos and fragmented lines. Please fix typos implicitly, combine fragmented lines to form coherent sentences, and translate them naturally into ${targetName}. Preserve the general line break structure. If the type is "sfx", explain the sound in brackets.`;

    const systemPrompt = isValidString(baseSystemPrompt)
      ? baseSystemPrompt
      : modePrompt;

    const promptText = sourceType === 'batch-markdown'
      ? String(text)
      : `Translate this text: "${text}" (Type: ${sourceType})`;

    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
          threshold: 'BLOCK_NONE'
        }
      ]
    };

    // Exponential backoff retry
    let delay = 1000;
    for (let i = 0; i < 5; i++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
      } catch (error) {
        if (i === 4) throw error;
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
      }
    }
  });
}
