/**
 * Translation Bridge — IPC wrappers สำหรับเรียก Gemini และ Argos Translate ผ่าน Electron Main Process
 *
 * ย้ายจาก App.tsx เพื่อแยก I/O layer ออกจาก React component
 */
import type { TranslationMode } from '../../stores/useProjectStore';

/**
 * Translate text using Gemini API via secure IPC
 */
export async function translateWithGemini(
  text: string,
  type: string,
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string,
  contextOverrides?: {
    baseSystemPrompt?: string;
  }
): Promise<string> {
  try {
    const result = await window.electronAPI.gemini.translate(text, {
      mode,
      sourceType: type,
      sourceLanguage,
      targetLanguage,
      baseSystemPrompt: contextOverrides?.baseSystemPrompt,
    });
    return result;
  } catch (error) {
    console.error('Gemini translation error:', error);
    throw error;
  }
}

/**
 * Translate a batch of texts using offline Argos engine via secure IPC
 */
export async function translateBatchOfflineBridge(
  texts: string[],
  type: string,
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string,
  profileTag?: string
): Promise<string[]> {
  if (!window.electronAPI?.translate?.offlineBatch) {
    throw new Error('Offline translation bridge is not available.');
  }

  const translated = await window.electronAPI.translate.offlineBatch(texts, {
    mode,
    sourceType: type,
    sourceLanguage,
    targetLanguage,
    profileTag,
  });

  if (!Array.isArray(translated) || translated.length !== texts.length) {
    throw new Error('Offline translation returned an invalid result length.');
  }

  return translated;
}

/**
 * Wrapper ที่รองรับ options object format (ใช้ภายใน translationCoordinator)
 */
export const offlineBatchBridgeWrapper = async (texts: string[], options: any): Promise<string[]> => {
  return translateBatchOfflineBridge(
    texts,
    options.sourceType || 'text',
    options.mode || 'adaptive',
    options.sourceLanguage || 'eng',
    options.targetLanguage || 'tha',
    options.profileTag
  );
};

/**
 * Translate a batch of texts using Gemini API with bounded concurrency (5 concurrent requests)
 */
export async function translateBatchGemini(
  texts: string[],
  type: string,
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string,
  contextOverrides?: {
    baseSystemPrompt?: string;
  }
): Promise<string[]> {
  if (texts.length === 0) return [];
  const CONCURRENCY_LIMIT = 5;
  const results: string[] = new Array(texts.length).fill('');

  for (let i = 0; i < texts.length; i += CONCURRENCY_LIMIT) {
    const chunk = texts.slice(i, i + CONCURRENCY_LIMIT);
    const chunkResults = await Promise.all(
      chunk.map((text) =>
        translateWithGemini(text, type, mode, sourceLanguage, targetLanguage, contextOverrides)
      )
    );
    chunkResults.forEach((res, offset) => {
      results[i + offset] = res;
    });
  }

  return results;
}
