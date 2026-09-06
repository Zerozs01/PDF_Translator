/**
 * OCR Text Layer Store - State management for OCR Text Layer feature
 */

import { create } from 'zustand';
import { OCRPageResult, OCROptions, OCREngine, OCRLine, BBox } from '../types';
import { ProcessingProgress } from '../services/pdf';
import { OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT } from '../services/vision/ocr-timeout';
import { isBoilerplateHallucination, applyKoreanConversationalFallback } from '../services/translation/koreanTranslationPolicy';
import { lookupShortPhraseTh } from '../services/translation/offlineTranslationService';
import { processOCRPageResult } from '../services/ocr/ocrPostProcessingPipeline';

export type TranslatorEngine = 'offline' | 'ai' | 'm2m100';
export type OCRPreviewMode = 'translated' | 'original';

export type OCRTranslationCacheKeyParts = {
  ocrEngine: OCREngine;
  ocrLanguage: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationMode: 'adaptive' | 'manga' | 'manhwa' | 'official';
  translatorEngine: TranslatorEngine;
};

export interface OCRTranslationCacheEntry {
  key: string;
  pageNum: number;
  ocrEngine: OCREngine;
  ocrLanguage: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationMode: 'adaptive' | 'manga' | 'manhwa' | 'official';
  translatorEngine: TranslatorEngine;
  sourceFingerprint: string;
  translatedByIndex: Array<{ index: number; text: string; bbox?: BBox; sourceText?: string }>;
  translatedText: string;
  lineCount: number;
  groupCount: number;
  createdAt: number;
  width?: number;
  height?: number;
}

export const OCR_TRANSLATION_CACHE_VERSION = 'v64'; // v64: Compare mode split-sync fix, Korean dictionary deduplication & new dojin phrases

const normalizeKeyPart = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');

export const buildOCRTranslationCacheKey = (parts: OCRTranslationCacheKeyParts): string => {
  const normalizedOcrLanguage = String(parts.ocrLanguage || '')
    .split('+')
    .map((part) => normalizeKeyPart(part))
    .filter(Boolean)
    .sort()
    .join('+') || 'eng';
  return [
    `ver:${OCR_TRANSLATION_CACHE_VERSION}`,
    `ocr:${normalizeKeyPart(parts.ocrEngine)}`,
    `ocrLang:${normalizedOcrLanguage}`,
    `src:${normalizeKeyPart(parts.sourceLanguage)}`,
    `dst:${normalizeKeyPart(parts.targetLanguage)}`,
    `mode:${normalizeKeyPart(parts.translationMode)}`,
    `translator:${normalizeKeyPart(parts.translatorEngine)}`,
  ].join('|');
};

export const hasCurrentOCRTranslationCacheVersion = (key: string): boolean =>
  String(key || '').includes(`ver:${OCR_TRANSLATION_CACHE_VERSION}`);

// Re-export filterGhostOcrData from domain service for backwards compatibility
export { filterGhostOcrData } from '../services/ocr/ghostFilter';

interface OCRTextLayerState {
  // OCR Options
  options: OCROptions;
  setOptions: (options: Partial<OCROptions>) => void;

  // Processing State
  isProcessing: boolean;
  progress: ProcessingProgress | null;
  setProgress: (progress: ProcessingProgress | null) => void;
  setIsProcessing: (isProcessing: boolean) => void;

  // Results - All pages OCR data
  allPagesOCR: Map<number, OCRPageResult>;
  ocrByPageEngine: Map<number, Map<OCREngine, OCRPageResult>>;
  setPageOCR: (pageNum: number, result: OCRPageResult) => void;
  setPageOCRForEngine: (pageNum: number, engine: OCREngine, result: OCRPageResult) => void;
  removePageOCR: (pageNum: number) => void;
  removePageOCRForEngine: (pageNum: number, engine: OCREngine) => void;
  getPageOCR: (pageNum: number) => OCRPageResult | undefined;
  clearAllOCR: () => void;

  // Current page OCR (for preview)
  currentPageOCR: OCRPageResult | null;
  setCurrentPageOCR: (result: OCRPageResult | null) => void;

  // Export
  searchablePDFBlob: Blob | null;
  setSearchablePDFBlob: (blob: Blob | null) => void;

  // Debug overlay
  showDebugOverlay: boolean;
  setShowDebugOverlay: (show: boolean) => void;

  // Translation cache per page / model / language pair
  translationPreviewMode: OCRPreviewMode;
  setTranslationPreviewMode: (mode: OCRPreviewMode) => void;
  translationCacheByPage: Map<number, Map<string, OCRTranslationCacheEntry>>;
  activeTranslationKeyByPage: Map<number, string>;
  setTranslationCacheEntry: (pageNum: number, cacheKey: string, entry: OCRTranslationCacheEntry) => void;
  getTranslationCacheEntry: (pageNum: number, cacheKey: string) => OCRTranslationCacheEntry | undefined;
  getTranslationCacheEntries: (pageNum: number) => OCRTranslationCacheEntry[];
  setActiveTranslationCacheKey: (pageNum: number, cacheKey: string | null) => void;
  getActiveTranslationCacheKey: (pageNum: number) => string | undefined;
  clearTranslationCache: (pageNum?: number) => void;
  clearTranslationCacheForEngine: (pageNum: number, engine: OCREngine) => void;
  updateOCRLineText: (pageNum: number, lineIndex: number, newText: string) => void;
  updateTranslationCacheText: (pageNum: number, lineIndex: number, newText: string) => void;
  addOCRLine: (pageNum: number, line: OCRLine) => number;
  deleteOCRLine: (pageNum: number, lineIndex: number) => void;

  // OCR result search (shared with document overlays)
  ocrResultSearchQuery: string;
  setOcrResultSearchQuery: (query: string) => void;

  // Actions
  reset: () => void;
}

// Supported languages for OCR
export const SUPPORTED_LANGUAGES = [
  { code: 'eng', name: 'English' },
  { code: 'jpn', name: 'Japanese' },
  { code: 'jpn_vert', name: 'Japanese (Vertical)' },
  { code: 'kor', name: 'Korean' },
  { code: 'chi_sim', name: 'Chinese (Simplified)' },
  { code: 'chi_tra', name: 'Chinese (Traditional)' },
  { code: 'tha', name: 'Thai' },
  { code: 'vie', name: 'Vietnamese' },
  { code: 'deu', name: 'German' },
  { code: 'fra', name: 'French' },
  { code: 'spa', name: 'Spanish' },
  { code: 'rus', name: 'Russian' },
] as const;

export const OCR_ENGINES: Array<{
  id: OCREngine;
  name: string;
  runtime: string;
  description: string;
  available: boolean;
}> = [
  {
    id: 'paddleocr',
    name: 'PaddleOCR',
    runtime: 'Python bridge',
    description: 'Python-side bridge for PaddleOCR. Availability depends on the local Python runtime and model environment.',
    available: false,
  },
  {
    id: 'easyocr',
    name: 'EasyOCR',
    runtime: 'Python/adapter bridge',
    description: 'Runs EasyOCR directly from a local Python env, with optional Easy-Yolo adapter/service fallback.',
    available: false,
  },
] as const;

function applyUpdatedPageOCR(
  state: OCRTextLayerState,
  pageNum: number,
  updatedOCR: OCRPageResult
): Pick<OCRTextLayerState, 'allPagesOCR' | 'ocrByPageEngine' | 'currentPageOCR'> {
  const nextAllPages = new Map(state.allPagesOCR);
  nextAllPages.set(pageNum, updatedOCR);

  const engine = (updatedOCR.ocrEngine || state.options.engine || 'paddleocr') as OCREngine;
  const nextByPageEngine = new Map(state.ocrByPageEngine);
  const perPage = new Map(nextByPageEngine.get(pageNum) || new Map<OCREngine, OCRPageResult>());
  perPage.set(engine, updatedOCR);
  nextByPageEngine.set(pageNum, perPage);

  return {
    allPagesOCR: nextAllPages,
    ocrByPageEngine: nextByPageEngine,
    currentPageOCR: state.currentPageOCR && state.currentPageOCR.pageNumber === pageNum ? updatedOCR : state.currentPageOCR,
  };
}

export const useOCRTextLayerStore = create<OCRTextLayerState>((set, get) => ({
  // Default options
  options: {
    language: 'eng',
    dpi: 300,
    engine: 'paddleocr',
    skipIfTextExists: true,
    perPageTimeoutSec: OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT,
    ocrQualityProfile: 'best',
  },
  
  setOptions: (newOptions) => set((state) => ({
    options: { ...state.options, ...newOptions }
  })),

  // Processing
  isProcessing: false,
  progress: null,
  setProgress: (progress) => set({ progress }),
  setIsProcessing: (isProcessing) => set({ isProcessing }),

  // All pages OCR results
  allPagesOCR: new Map(),
  ocrByPageEngine: new Map(),
  setPageOCR: (pageNum, result) => set((state) => {
    const engine = (result.ocrEngine || state.options.engine || 'paddleocr') as OCREngine;
    // [Scrutinize M2]: ใช้ pipeline กลางแทน inline logic เพื่อป้องกัน divergence
    const processedResult = processOCRPageResult(result, {
      engine,
      dpi: state.options.dpi || 300,
      storeLanguage: state.options.language || 'eng',
    });

    const newMap = new Map(state.allPagesOCR);
    newMap.set(pageNum, processedResult);
    const byPageEngine = new Map(state.ocrByPageEngine);
    const perPage = new Map(byPageEngine.get(pageNum) || new Map<OCREngine, OCRPageResult>());
    perPage.set(engine, processedResult);
    byPageEngine.set(pageNum, perPage);
    return {
      allPagesOCR: newMap,
      ocrByPageEngine: byPageEngine,
    };
  }),
  setPageOCRForEngine: (pageNum, engine, result) => set((state) => {
    // [Scrutinize M2]: ใช้ pipeline กลางแทน inline logic เพื่อป้องกัน divergence
    const processedResult = processOCRPageResult(result, {
      engine,
      dpi: state.options.dpi || 300,
      storeLanguage: state.options.language || 'eng',
    });

    const byPageEngine = new Map(state.ocrByPageEngine);
    const perPage = new Map(byPageEngine.get(pageNum) || new Map<OCREngine, OCRPageResult>());
    perPage.set(engine, processedResult);
    byPageEngine.set(pageNum, perPage);

    // Sync to allPagesOCR only if allPagesOCR doesn't have an entry for this page,
    // OR if the engine being set matches the active/selected options engine.
    const newMap = new Map(state.allPagesOCR);
    const activeEngine = state.options.engine || 'paddleocr';
    if (!newMap.has(pageNum) || engine.toLowerCase() === activeEngine.toLowerCase()) {
      newMap.set(pageNum, processedResult);
    }

    return {
      allPagesOCR: newMap,
      ocrByPageEngine: byPageEngine,
    };
  }),
  removePageOCR: (pageNum) => set((state) => {
    const newMap = new Map(state.allPagesOCR);
    newMap.delete(pageNum);
    return { allPagesOCR: newMap };
  }),
  removePageOCRForEngine: (pageNum, engine) => set((state) => {
    const byPageEngine = new Map(state.ocrByPageEngine);
    const perPage = new Map(byPageEngine.get(pageNum) || new Map<OCREngine, OCRPageResult>());
    perPage.delete(engine);
    if (perPage.size === 0) {
      byPageEngine.delete(pageNum);
    } else {
      byPageEngine.set(pageNum, perPage);
    }

    const nextAllPages = new Map(state.allPagesOCR);
    const existing = nextAllPages.get(pageNum);
    const existingEngine = (existing?.ocrEngine || state.options.engine || 'paddleocr') as OCREngine;
    if (existing && existingEngine === engine) {
      nextAllPages.delete(pageNum);
      const fallback = perPage.get(state.options.engine || 'paddleocr') || Array.from(perPage.values())[0];
      if (fallback) {
        nextAllPages.set(pageNum, fallback);
      }
    }

    return {
      ocrByPageEngine: byPageEngine,
      allPagesOCR: nextAllPages,
    };
  }),
  getPageOCR: (pageNum) => get().allPagesOCR.get(pageNum),
  clearAllOCR: () => set({
    allPagesOCR: new Map(),
    ocrByPageEngine: new Map(),
    translationCacheByPage: new Map(),
    activeTranslationKeyByPage: new Map(),
    translationPreviewMode: 'translated',
    ocrResultSearchQuery: '',
  }),

  // Current page OCR (for preview)
  currentPageOCR: null,
  setCurrentPageOCR: (result) => set({ currentPageOCR: result }),

  // Export
  searchablePDFBlob: null,
  setSearchablePDFBlob: (blob) => set({ searchablePDFBlob: blob }),

  // Debug overlay
  showDebugOverlay: false,
  setShowDebugOverlay: (show) => set({ showDebugOverlay: show }),

  // Translation cache
  translationPreviewMode: 'translated',
  setTranslationPreviewMode: (mode) => set({ translationPreviewMode: mode }),
  translationCacheByPage: new Map(),
  activeTranslationKeyByPage: new Map(),
  setTranslationCacheEntry: (pageNum, cacheKey, entry) => set((state) => {
    const sanitizedEntry = { ...entry };
    let hasChanges = false;

    // Find OCR result to get the original source text if not present in items
    const ocr = state.ocrByPageEngine.get(pageNum)?.get(entry.ocrEngine) || state.allPagesOCR.get(pageNum);

    // Regex helpers for CJK carryover detection
    const HANGUL_REGEX = /[\uAC00-\uD7AF]/;
    const KANA_REGEX = /[\u3040-\u30FF]/;
    const THAI_REGEX = /[\u0E00-\u0E7F]/;

    sanitizedEntry.translatedByIndex = entry.translatedByIndex.map((item) => {
      const ocrLine = ocr?.lines[item.index];
      const sourceText = item.sourceText || ocrLine?.text || '';

      // Guard 1: Boilerplate hallucination (existing check)
      if (sourceText && isBoilerplateHallucination(sourceText, item.text)) {
        const fallback = applyKoreanConversationalFallback(sourceText, item.text);
        const nextText = fallback !== null ? fallback : sourceText;
        if (nextText !== item.text) {
          hasChanges = true;
          return { ...item, text: nextText, sourceText };
        }
      }

      // Guard 2: CJK/Hangul carryover — translation result still contains the source script
      // This catches cases where Argos failed and returned the original Korean/Japanese text
      // without translating it (e.g. "안갔지" → "안갔지", "코토미" → "코토미")
      const translatedHasHangul = HANGUL_REGEX.test(item.text);
      const translatedHasKana = KANA_REGEX.test(item.text);
      const translatedHasThai = THAI_REGEX.test(item.text);
      const sourceHasHangul = HANGUL_REGEX.test(sourceText);
      const sourceHasKana = KANA_REGEX.test(sourceText);

      // If translation contains CJK script from source but no Thai → untranslated carryover
      const isHangulCarryover = translatedHasHangul && !translatedHasThai && sourceHasHangul;
      const isKanaCarryover = translatedHasKana && !translatedHasThai && sourceHasKana;

      if (isHangulCarryover || isKanaCarryover) {
        // Try conversational fallback dict first
        const fallback = sourceText ? applyKoreanConversationalFallback(sourceText, item.text) : null;
        const nextText = fallback !== null ? fallback : (sourceText || item.text);
        if (nextText !== item.text) {
          hasChanges = true;
          console.warn(`[setTranslationCacheEntry] CJK carryover detected on page ${pageNum} index ${item.index}: "${item.text}" → "${nextText}" (source: "${sourceText}")`);
          return { ...item, text: nextText, sourceText };
        }
      }

      // Guard 3: Spanish / Latin short phrase dictionary fallback (e.g. "MENTE CALIENTES Y" -> "รู้สึกอุ่นและ...")
      const isLatinCarryover = !translatedHasThai && /[a-zA-Z]/.test(item.text);
      if ((isLatinCarryover || !item.text) && sourceText) {
        const dictHit = lookupShortPhraseTh(sourceText) || lookupShortPhraseTh(sourceText.replace(/[^A-Za-z0-9]/g, ''));
        if (dictHit && /[\u0E00-\u0E7F]/.test(dictHit) && dictHit !== item.text) {
          hasChanges = true;
          console.log(`[setTranslationCacheEntry] Short phrase dictionary upgrade on page ${pageNum} index ${item.index}: "${item.text}" → "${dictHit}" (source: "${sourceText}")`);
          return { ...item, text: dictHit, sourceText };
        }
      }

      return item;
    });

    if (hasChanges) {
      console.warn(`[setTranslationCacheEntry] Sanitized boilerplate hallucinations on page ${pageNum}`);
      // Rebuild translatedText
      sanitizedEntry.translatedText = sanitizedEntry.translatedByIndex.map((item) => item.text).join('\n');
    }

    const pageMap = new Map(state.translationCacheByPage.get(pageNum) || new Map<string, OCRTranslationCacheEntry>());
    pageMap.set(cacheKey, sanitizedEntry);
    const nextByPage = new Map(state.translationCacheByPage);
    nextByPage.set(pageNum, pageMap);

    const nextActiveByPage = new Map(state.activeTranslationKeyByPage);
    nextActiveByPage.set(pageNum, cacheKey);

    return {
      translationCacheByPage: nextByPage,
      activeTranslationKeyByPage: nextActiveByPage,
    };
  }),
  getTranslationCacheEntry: (pageNum, cacheKey) => get().translationCacheByPage.get(pageNum)?.get(cacheKey),
  getTranslationCacheEntries: (pageNum) => {
    const pageMap = get().translationCacheByPage.get(pageNum);
    if (!pageMap) return [];
    return Array.from(pageMap.values()).sort((a, b) => b.createdAt - a.createdAt);
  },
  setActiveTranslationCacheKey: (pageNum, cacheKey) => set((state) => {
    const next = new Map(state.activeTranslationKeyByPage);
    if (!cacheKey) {
      next.delete(pageNum);
    } else {
      next.set(pageNum, cacheKey);
    }
    return { activeTranslationKeyByPage: next };
  }),
  getActiveTranslationCacheKey: (pageNum) => get().activeTranslationKeyByPage.get(pageNum),
  clearTranslationCache: (pageNum) => set((state) => {
    if (typeof pageNum === 'number') {
      const nextByPage = new Map(state.translationCacheByPage);
      nextByPage.delete(pageNum);
      const nextActive = new Map(state.activeTranslationKeyByPage);
      nextActive.delete(pageNum);
      return {
        translationCacheByPage: nextByPage,
        activeTranslationKeyByPage: nextActive,
      };
    }
    return {
      translationCacheByPage: new Map(),
      activeTranslationKeyByPage: new Map(),
    };
  }),
  clearTranslationCacheForEngine: (pageNum, engine) => set((state) => {
    const currentPageMap = state.translationCacheByPage.get(pageNum);
    if (!currentPageMap) return {};

    const filtered = new Map(
      Array.from(currentPageMap.entries()).filter(([, entry]) => entry.ocrEngine !== engine)
    );

    const nextByPage = new Map(state.translationCacheByPage);
    if (filtered.size > 0) {
      nextByPage.set(pageNum, filtered);
    } else {
      nextByPage.delete(pageNum);
    }

    const nextActive = new Map(state.activeTranslationKeyByPage);
    const activeKey = nextActive.get(pageNum);
    if (!activeKey || !filtered.has(activeKey)) {
      if (filtered.size > 0) {
        const newest = Array.from(filtered.values()).sort((a, b) => b.createdAt - a.createdAt)[0];
        nextActive.set(pageNum, newest.key);
      } else {
        nextActive.delete(pageNum);
      }
    }

    return {
      translationCacheByPage: nextByPage,
      activeTranslationKeyByPage: nextActive,
    };
  }),

  updateOCRLineText: (pageNum, lineIndex, newText) => set((state) => {
    const pageOCR = state.allPagesOCR.get(pageNum);
    if (!pageOCR) return {};

    const nextLines = [...(pageOCR.lines || [])];
    if (nextLines[lineIndex]) {
      nextLines[lineIndex] = { ...nextLines[lineIndex], text: newText };
    }

    const updatedOCR = { ...pageOCR, lines: nextLines };
    return applyUpdatedPageOCR(state, pageNum, updatedOCR);
  }),

  updateTranslationCacheText: (pageNum, lineIndex, newText) => set((state) => {
    let activeKey = state.activeTranslationKeyByPage.get(pageNum);
    const pageMap = state.translationCacheByPage.get(pageNum);
    if (!pageMap) return {};

    if (!activeKey || !pageMap.has(activeKey)) {
      // Robust Fallback: find the newest or first available entry on this page
      const entries = Array.from(pageMap.values()).sort((a, b) => b.createdAt - a.createdAt);
      if (entries.length > 0) {
        activeKey = entries[0].key;
      }
    }

    if (!activeKey) return {};
    const entry = pageMap.get(activeKey);
    if (!entry) return {};

    const ocrLine = state.allPagesOCR.get(pageNum)?.lines?.[lineIndex];
    const nextTranslated = [...entry.translatedByIndex];
    const idx = nextTranslated.findIndex(t => t.index === lineIndex);
    if (idx >= 0) {
      nextTranslated[idx] = { 
        ...nextTranslated[idx], 
        text: newText,
        bbox: nextTranslated[idx].bbox || ocrLine?.bbox,
        sourceText: nextTranslated[idx].sourceText || ocrLine?.text
      };
    } else {
      nextTranslated.push({ 
        index: lineIndex, 
        text: newText,
        bbox: ocrLine?.bbox,
        sourceText: ocrLine?.text
      });
    }

    const updatedEntry = {
      ...entry,
      translatedByIndex: nextTranslated,
    };

    const nextPageMap = new Map(pageMap);
    nextPageMap.set(activeKey, updatedEntry);

    const nextByPage = new Map(state.translationCacheByPage);
    nextByPage.set(pageNum, nextPageMap);

    const nextActiveByPage = new Map(state.activeTranslationKeyByPage);
    nextActiveByPage.set(pageNum, activeKey);

    return { 
      translationCacheByPage: nextByPage,
      activeTranslationKeyByPage: nextActiveByPage,
    };
  }),

  addOCRLine: (pageNum, line) => {
    let lineIndex = 0;
    set((state) => {
      const pageOCR: OCRPageResult = state.allPagesOCR.get(pageNum) || {
        pageNumber: pageNum,
        width: 800,
        height: 1100,
        dpi: state.options.dpi || 300,
        language: state.options.language || 'eng',
        algorithmVersion: 1,
        lines: [],
        words: [],
        text: '',
        ocrEngine: state.options.engine || 'paddleocr',
        confidence: 100,
      };

      const nextLines = [...(pageOCR.lines || [])];
      lineIndex = nextLines.length;
      nextLines.push(line);
      
      const updatedOCR = { ...pageOCR, lines: nextLines };
      const updatedPageMaps = applyUpdatedPageOCR(state, pageNum, updatedOCR);

      // Also update translation cache if there is an active translation
      const nextTranslationCache = new Map(state.translationCacheByPage);
      const activeKey = state.activeTranslationKeyByPage.get(pageNum);
      if (activeKey) {
        const pageMap = nextTranslationCache.get(pageNum);
        if (pageMap) {
          const entry = pageMap.get(activeKey);
          if (entry) {
            const nextTranslated = [...entry.translatedByIndex, { 
              index: lineIndex, 
              text: line.text,
              bbox: line.bbox,
              sourceText: line.text
            }];
            const updatedEntry = {
              ...entry,
              translatedByIndex: nextTranslated,
              lineCount: nextLines.length,
            };
            const nextPageMap = new Map(pageMap);
            nextPageMap.set(activeKey, updatedEntry);
            nextTranslationCache.set(pageNum, nextPageMap);
          }
        }
      }

      return {
        ...updatedPageMaps,
        translationCacheByPage: nextTranslationCache,
      };
    });
    return lineIndex;
  },

  deleteOCRLine: (pageNum, lineIndex) => set((state) => {
    const pageOCR = state.allPagesOCR.get(pageNum);
    if (!pageOCR) return {};

    const nextLines = (pageOCR.lines || []).filter((_, idx) => idx !== lineIndex);
    const updatedOCR = { ...pageOCR, lines: nextLines };
    const updatedPageMaps = applyUpdatedPageOCR(state, pageNum, updatedOCR);

    // Sync with translationCacheByPage
    const nextTranslationCache = new Map(state.translationCacheByPage);
    const activeKey = state.activeTranslationKeyByPage.get(pageNum);
    if (activeKey) {
      const pageMap = nextTranslationCache.get(pageNum);
      if (pageMap) {
        const entry = pageMap.get(activeKey);
        if (entry) {
          const nextTranslated = entry.translatedByIndex
            .filter((t) => t.index !== lineIndex)
            .map((t) => t.index > lineIndex ? { ...t, index: t.index - 1 } : t);

          const updatedEntry = {
            ...entry,
            translatedByIndex: nextTranslated,
            lineCount: nextLines.length,
          };
          const nextPageMap = new Map(pageMap);
          nextPageMap.set(activeKey, updatedEntry);
          nextTranslationCache.set(pageNum, nextPageMap);
        }
      }
    }

    return {
      ...updatedPageMaps,
      translationCacheByPage: nextTranslationCache,
    };
  }),

  // OCR result search
  ocrResultSearchQuery: '',
  setOcrResultSearchQuery: (query) => set({ ocrResultSearchQuery: String(query || '') }),

  // Actions
  reset: () => set((state) => ({
    isProcessing: false,
    progress: null,
    currentPageOCR: null,
    searchablePDFBlob: null,
    showDebugOverlay: false,
    allPagesOCR: new Map(),
    ocrByPageEngine: new Map(),
    translationPreviewMode: 'translated',
    translationCacheByPage: new Map(),
    activeTranslationKeyByPage: new Map(),
    ocrResultSearchQuery: '',
    options: {
      ...state.options,
      language: 'eng',
    }
  })),
}));
