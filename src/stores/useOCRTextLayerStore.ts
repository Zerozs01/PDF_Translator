/**
 * OCR Text Layer Store - State management for OCR Text Layer feature
 */

import { create } from 'zustand';
import { OCRPageResult, OCROptions, OCREngine } from '../types';
import { ProcessingProgress } from '../services/pdf';
import { OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT } from '../services/vision/ocr-timeout';

export type TranslatorEngine = 'offline' | 'ai';
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
  translatedByIndex: Array<{ index: number; text: string }>;
  translatedText: string;
  lineCount: number;
  groupCount: number;
  createdAt: number;
}

export const OCR_TRANSLATION_CACHE_VERSION = 'v45';

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
    id: 'tesseract',
    name: 'Tesseract',
    runtime: 'Built-in WASM',
    description: 'Current in-app OCR engine running the best-quality pipeline by default.',
    available: true,
  },
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

export const useOCRTextLayerStore = create<OCRTextLayerState>((set, get) => ({
  // Default options
  options: {
    language: 'eng',
    dpi: 300,
    engine: 'tesseract',
    skipIfTextExists: true,
    perPageTimeoutSec: OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT,
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
    const newMap = new Map(state.allPagesOCR);
    newMap.set(pageNum, result);
    const engine = (result.ocrEngine || state.options.engine || 'tesseract') as OCREngine;
    const byPageEngine = new Map(state.ocrByPageEngine);
    const perPage = new Map(byPageEngine.get(pageNum) || new Map<OCREngine, OCRPageResult>());
    perPage.set(engine, result);
    byPageEngine.set(pageNum, perPage);
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
    const existingEngine = (existing?.ocrEngine || state.options.engine || 'tesseract') as OCREngine;
    if (existing && existingEngine === engine) {
      nextAllPages.delete(pageNum);
      const fallback = perPage.get(state.options.engine || 'tesseract') || Array.from(perPage.values())[0];
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
  showDebugOverlay: true,
  setShowDebugOverlay: (show) => set({ showDebugOverlay: show }),

  // Translation cache
  translationPreviewMode: 'translated',
  setTranslationPreviewMode: (mode) => set({ translationPreviewMode: mode }),
  translationCacheByPage: new Map(),
  activeTranslationKeyByPage: new Map(),
  setTranslationCacheEntry: (pageNum, cacheKey, entry) => set((state) => {
    const pageMap = new Map(state.translationCacheByPage.get(pageNum) || new Map<string, OCRTranslationCacheEntry>());
    pageMap.set(cacheKey, entry);
    const nextByPage = new Map(state.translationCacheByPage);
    nextByPage.set(pageNum, pageMap);

    const nextActiveByPage = new Map(state.activeTranslationKeyByPage);
    nextActiveByPage.set(pageNum, cacheKey);

    return {
      translationCacheByPage: nextByPage,
      activeTranslationKeyByPage: nextActiveByPage,
      translationPreviewMode: 'translated' as OCRPreviewMode,
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

  // OCR result search
  ocrResultSearchQuery: '',
  setOcrResultSearchQuery: (query) => set({ ocrResultSearchQuery: String(query || '') }),

  // Actions
  reset: () => set({
    isProcessing: false,
    progress: null,
    currentPageOCR: null,
    searchablePDFBlob: null,
    showDebugOverlay: true,
    allPagesOCR: new Map(),
    ocrByPageEngine: new Map(),
    translationPreviewMode: 'translated',
    translationCacheByPage: new Map(),
    activeTranslationKeyByPage: new Map(),
    ocrResultSearchQuery: '',
  }),
}));
