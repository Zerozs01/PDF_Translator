import { create } from 'zustand';
import { dbService } from '../services/dbService';
import {
  ensureProjectDocumentRecord,
  persistProjectDocumentPage,
  persistProjectDocumentTotalPages,
  prepareProjectDocumentLoad,
  touchProjectDocumentActivity,
} from '../services/projectDocumentService';
import { useOCRTextLayerStore } from './useOCRTextLayerStore';
import { useLayerStore } from './useLayerStore';
import { useUIStore } from './useUIStore';
import {
  DEFAULT_OVERLAY_FONT_PRESET,
  OverlayFontPreset,
  isOverlayFontPreset,
} from '../constants/overlayFonts';
import type { GeminiApiKeySource } from '../types/electron.d';

export type TranslationMode = 'adaptive' | 'manga' | 'manhwa' | 'official';
export type ViewMode = 'single' | 'continuous';

const LEGACY_GEMINI_API_KEY_STORAGE_KEY = 'pdf_translator.gemini_api_key';
const OVERLAY_THAI_FONT_ENABLED_STORAGE_KEY = 'pdf_translator.overlay_thai_font_enabled';
const OVERLAY_FONT_PRESET_STORAGE_KEY = 'pdf_translator.overlay_font_preset';
const OVERLAY_FONT_SIZE_SCALE_STORAGE_KEY = 'pdf_translator.overlay_font_size_scale';
const OVERLAY_FONT_SIZE_SCALE_MIN = 0.7;
const OVERLAY_FONT_SIZE_SCALE_MAX = 1.6;
const THAI_TARGET_LANGUAGE_KEYS = new Set(['th', 'tha', 'thai']);

const clampOverlayFontSizeScale = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  if (value < OVERLAY_FONT_SIZE_SCALE_MIN) return OVERLAY_FONT_SIZE_SCALE_MIN;
  if (value > OVERLAY_FONT_SIZE_SCALE_MAX) return OVERLAY_FONT_SIZE_SCALE_MAX;
  return Math.round(value * 100) / 100;
};

const isThaiTargetLanguage = (value: string): boolean => {
  const normalized = String(value || '').trim().toLowerCase().split('-')[0];
  return THAI_TARGET_LANGUAGE_KEYS.has(normalized);
};

const readLegacyPersistedGeminiApiKey = (): string => {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem(LEGACY_GEMINI_API_KEY_STORAGE_KEY) || '');
  } catch {
    return '';
  }
};

const clearLegacyPersistedGeminiApiKey = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_GEMINI_API_KEY_STORAGE_KEY);
  } catch {
    // Ignore local storage failures.
  }
};

const readPersistedOverlayThaiFontEnabled = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    const raw = String(window.localStorage.getItem(OVERLAY_THAI_FONT_ENABLED_STORAGE_KEY) || '').trim().toLowerCase();
    if (!raw) return true;
    if (raw === '0' || raw === 'false') return false;
    return true;
  } catch {
    return true;
  }
};

const persistOverlayThaiFontEnabled = (enabled: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OVERLAY_THAI_FONT_ENABLED_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Ignore local storage failures.
  }
};

const readPersistedOverlayFontPreset = (): OverlayFontPreset => {
  if (typeof window === 'undefined') return DEFAULT_OVERLAY_FONT_PRESET;
  try {
    const raw = String(window.localStorage.getItem(OVERLAY_FONT_PRESET_STORAGE_KEY) || '').trim();
    return isOverlayFontPreset(raw) ? raw : DEFAULT_OVERLAY_FONT_PRESET;
  } catch {
    return DEFAULT_OVERLAY_FONT_PRESET;
  }
};

const persistOverlayFontPreset = (preset: OverlayFontPreset): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OVERLAY_FONT_PRESET_STORAGE_KEY, preset);
  } catch {
    // Ignore local storage failures.
  }
};

const readPersistedOverlayFontSizeScale = (): number => {
  if (typeof window === 'undefined') return 1;
  try {
    const raw = Number.parseFloat(String(window.localStorage.getItem(OVERLAY_FONT_SIZE_SCALE_STORAGE_KEY) || '').trim());
    if (!Number.isFinite(raw)) return 1;
    return clampOverlayFontSizeScale(raw);
  } catch {
    return 1;
  }
};

const persistOverlayFontSizeScale = (scale: number): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OVERLAY_FONT_SIZE_SCALE_STORAGE_KEY, String(clampOverlayFontSizeScale(scale)));
  } catch {
    // Ignore local storage failures.
  }
};

export interface SafetySettings {
  harassment: 'off' | 'low' | 'medium' | 'high';
  hate: 'off' | 'low' | 'medium' | 'high';
  sexual: 'off' | 'low' | 'medium' | 'high';
  dangerous: 'off' | 'low' | 'medium' | 'high';
}

const DEFAULT_SAFETY_SETTINGS_BY_MODE: Record<TranslationMode, SafetySettings> = {
  adaptive: {
    harassment: 'low',
    hate: 'low',
    sexual: 'medium',
    dangerous: 'low',
  },
  manga: {
    harassment: 'low',
    hate: 'low',
    sexual: 'low',
    dangerous: 'low',
  },
  manhwa: {
    harassment: 'low',
    hate: 'low',
    sexual: 'off',
    dangerous: 'low',
  },
  official: {
    harassment: 'medium',
    hate: 'medium',
    sexual: 'medium',
    dangerous: 'medium',
  },
};

const getDefaultSafetySettingsForMode = (mode: TranslationMode): SafetySettings => ({
  ...DEFAULT_SAFETY_SETTINGS_BY_MODE[mode],
});

interface ProjectState {
  // File Data
  file: File | null;
  fileUrl: string | null;
  fileType: 'pdf' | 'image' | null;
  fileName: string;
  filePath: string | null;
  documentId: number | null;
  fileData: Uint8Array | null;

  // Navigation
  currentPage: number;
  totalPages: number;
  viewMode: ViewMode;

  // Settings
  translationMode: TranslationMode;
  safetySettings: SafetySettings;
  sourceLanguage: string;
  targetLanguage: string;
  geminiApiKeyDraft: string;
  hasGeminiApiKey: boolean;
  geminiApiKeySource: GeminiApiKeySource;
  isGeminiApiKeyLoaded: boolean;
  isGeminiApiKeySaving: boolean;
  geminiApiKeyError: string | null;
  overlayThaiFontEnabled: boolean;
  overlayFontPreset: OverlayFontPreset;
  overlayFontSizeScale: number;

  // Actions
  hydrateGeminiApiKey: () => Promise<void>;
  loadProject: (file: File, fileData?: Uint8Array | null) => Promise<void>;
  ensureDocumentId: () => Promise<number | null>;
  closeProject: () => void;
  setFileData: (data: Uint8Array | null) => void;
  setPage: (page: number, options?: { persist?: boolean }) => void;
  setTotalPages: (total: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setTranslationMode: (mode: TranslationMode) => void;
  setSourceLanguage: (lang: string) => void;
  setTargetLanguage: (lang: string) => void;
  setGeminiApiKeyDraft: (apiKey: string) => void;
  saveGeminiApiKey: () => Promise<boolean>;
  clearGeminiApiKey: () => Promise<boolean>;
  setOverlayThaiFontEnabled: (enabled: boolean) => void;
  setOverlayFontPreset: (preset: OverlayFontPreset) => void;
  setOverlayFontSizeScale: (scale: number) => void;
  updateSafetySettings: (settings: Partial<SafetySettings>) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  file: null,
  fileUrl: null,
  fileType: null,
  fileName: '',
  filePath: null,
  documentId: null,
  fileData: null,
  
  currentPage: 1,
  totalPages: 0,
  viewMode: 'single',

  translationMode: 'adaptive',
  safetySettings: getDefaultSafetySettingsForMode('adaptive'),
  sourceLanguage: 'eng',
  targetLanguage: 'th',
  geminiApiKeyDraft: '',
  hasGeminiApiKey: false,
  geminiApiKeySource: 'none',
  isGeminiApiKeyLoaded: false,
  isGeminiApiKeySaving: false,
  geminiApiKeyError: null,
  overlayThaiFontEnabled: true,
  overlayFontPreset: readPersistedOverlayFontPreset(),
  overlayFontSizeScale: readPersistedOverlayFontSizeScale(),

  hydrateGeminiApiKey: async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.gemini?.getApiKeyStatus) {
      set({
        isGeminiApiKeyLoaded: true,
        geminiApiKeyError: 'Gemini secure storage bridge is not available.',
      });
      return;
    }

    try {
      let status = await window.electronAPI.gemini.getApiKeyStatus();
      const legacyKey = readLegacyPersistedGeminiApiKey().trim();
      let draft = '';
      let errorMessage: string | null = null;

      if (!status.configured && legacyKey) {
        try {
          status = await window.electronAPI.gemini.setApiKey(legacyKey);
          clearLegacyPersistedGeminiApiKey();
        } catch (error) {
          draft = legacyKey;
          errorMessage = error instanceof Error
            ? error.message
            : 'Failed to migrate legacy Gemini API key into secure storage.';
        }
      } else if (legacyKey) {
        clearLegacyPersistedGeminiApiKey();
      }

      set({
        geminiApiKeyDraft: draft,
        hasGeminiApiKey: status.configured,
        geminiApiKeySource: status.source,
        isGeminiApiKeyLoaded: true,
        geminiApiKeyError: errorMessage,
      });
    } catch (error) {
      set({
        isGeminiApiKeyLoaded: true,
        geminiApiKeyError: error instanceof Error
          ? error.message
          : 'Failed to load Gemini API key status.',
      });
    }
  },

  loadProject: async (file, fileData) => {
    // Clear OCR cache when loading a new file to avoid cross-file reuse
    useOCRTextLayerStore.getState().reset();
    useLayerStore.getState().clearLayers();
    useUIStore.getState().resetView();
    // Save document to database for recent files tracking.
    // Use a canonical imported filepath when possible so OCR cache keys are stable
    // across open methods (browse, drag/drop, recent list).
    const prepared = await prepareProjectDocumentLoad({
      db: dbService,
      file: file as File & { path?: string },
      fileData,
      importFile: window.electronAPI?.fs?.importFile,
    });
    const resolvedPath = prepared.resolvedPath;
    const resolvedFileData = prepared.resolvedFileData;

    if (!resolvedPath) {
      console.warn('[DB] File path not available. Recent list will not be saved for this file.');
    }

    const previousUrl = get().fileUrl;
    if (previousUrl) {
      // Revoke after state update to avoid revoking while components still render.
      setTimeout(() => URL.revokeObjectURL(previousUrl), 0);
    }

    const url = URL.createObjectURL(file);
    const type = file.type === 'application/pdf' ? 'pdf' : 'image';
    const initialTotalPages = type === 'image' ? 1 : 0;
    set({ 
      file, 
      fileUrl: url, 
      fileType: type, 
      fileName: file.name,
      filePath: resolvedPath,
      documentId: null,
      fileData: resolvedFileData ?? null,
      currentPage: 1,
      totalPages: initialTotalPages
    });

    if (resolvedPath && dbService.isAvailable()) {
      try {
        const ensuredId = await get().ensureDocumentId();
        if (ensuredId) {
          await touchProjectDocumentActivity(dbService, ensuredId);
        }
      } catch (error) {
        console.error('[DB] Failed to ensure documentId:', error);
      }
    }

    // เรียกคืนการตั้งค่า OCR ล่าสุดของไฟล์นี้
    const fileKey = get().filePath || resolvedPath || file.name;
    let savedOcrLang = 'eng';
    let savedOcrEngine = 'paddleocr';
    let savedOcrQualityProfile = 'best';
    try {
      savedOcrLang = localStorage.getItem(`pdf_translator.ocr_lang.${fileKey}`) || 'eng';
      savedOcrEngine = localStorage.getItem(`pdf_translator.ocr_engine.${fileKey}`) || 'paddleocr';
      savedOcrQualityProfile = localStorage.getItem(`pdf_translator.ocr_quality_profile.${fileKey}`) || 'best';
    } catch (e) {
      console.warn('[Storage] Failed to read OCR options:', e);
    }
    useOCRTextLayerStore.getState().setOptions({ 
      language: savedOcrLang,
      engine: savedOcrEngine as any,
      ocrQualityProfile: savedOcrQualityProfile as any
    });
  },

  ensureDocumentId: async () => {
    if (!dbService.isAvailable()) return null;
    const { documentId, file, filePath } = get();
    if (documentId) {
      return documentId;
    }
    const hadDocumentId = Boolean(documentId);

    const ensured = await ensureProjectDocumentRecord({
      db: dbService,
      documentId,
      file: file as (File & { path?: string }) | null,
      filePath,
    });

    const currentPath = get().filePath;
    if (!hadDocumentId && currentPath !== ensured.filePath) {
      return null;
    }

    set({ documentId: ensured.documentId, filePath: ensured.filePath });
    return ensured.documentId;
  },

  closeProject: () => set((state) => {
    if (state.fileUrl) {
      // Revoke after unmount to avoid interrupting PDF.js loads.
      setTimeout(() => URL.revokeObjectURL(state.fileUrl!), 0);
    }
    useOCRTextLayerStore.getState().reset();
    useLayerStore.getState().clearLayers();
    useUIStore.getState().resetView();

    // Kill external OCR engines immediately when project is closed
    if (window.electronAPI?.ocr?.cancelExternal) {
      window.electronAPI.ocr.cancelExternal().catch((err) => {
        console.error('[useProjectStore] Failed to cancel external OCR:', err);
      });
    }

    return { 
      file: null,
      fileUrl: null,
      fileType: null,
      fileName: '',
      filePath: null,
      documentId: null,
      fileData: null,
      currentPage: 1,
      totalPages: 0
    };
  }),
  setFileData: (data) => set({ fileData: data }),

  setPage: (page, options) => {
    set({ currentPage: page });
    const documentId = get().documentId;
    if (documentId && options?.persist !== false) {
      void persistProjectDocumentPage(dbService, documentId, page);
    }
  },
  setTotalPages: (total) => {
    set({ totalPages: total });
    const documentId = get().documentId;
    if (documentId && total > 0) {
      void persistProjectDocumentTotalPages(dbService, documentId, total);
    }
  },
  setViewMode: (mode) => set({ viewMode: mode }),
  setTranslationMode: (mode) => set({
    translationMode: mode,
    safetySettings: getDefaultSafetySettingsForMode(mode),
  }),
  setSourceLanguage: (lang) => set({ sourceLanguage: lang }),
  setTargetLanguage: (lang) => {
    const shouldEnableThaiOverlay = isThaiTargetLanguage(lang);
    persistOverlayThaiFontEnabled(shouldEnableThaiOverlay);
    set({
      targetLanguage: lang,
      overlayThaiFontEnabled: shouldEnableThaiOverlay,
    });
  },
  setGeminiApiKeyDraft: (apiKey) => set({
    geminiApiKeyDraft: String(apiKey || ''),
    geminiApiKeyError: null,
  }),
  saveGeminiApiKey: async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.gemini?.setApiKey) {
      set({ geminiApiKeyError: 'Gemini secure storage bridge is not available.' });
      return false;
    }

    const trimmed = String(get().geminiApiKeyDraft || '').trim();
    if (!trimmed) {
      set({ geminiApiKeyError: 'Gemini API key cannot be empty.' });
      return false;
    }

    set({ isGeminiApiKeySaving: true, geminiApiKeyError: null });
    try {
      const status = await window.electronAPI.gemini.setApiKey(trimmed);
      clearLegacyPersistedGeminiApiKey();
      set({
        geminiApiKeyDraft: '',
        hasGeminiApiKey: status.configured,
        geminiApiKeySource: status.source,
        isGeminiApiKeyLoaded: true,
        isGeminiApiKeySaving: false,
        geminiApiKeyError: null,
      });
      return true;
    } catch (error) {
      set({
        isGeminiApiKeySaving: false,
        geminiApiKeyError: error instanceof Error
          ? error.message
          : 'Failed to save Gemini API key.',
      });
      return false;
    }
  },
  clearGeminiApiKey: async () => {
    if (typeof window === 'undefined' || !window.electronAPI?.gemini?.clearApiKey) {
      set({ geminiApiKeyError: 'Gemini secure storage bridge is not available.' });
      return false;
    }

    set({ isGeminiApiKeySaving: true, geminiApiKeyError: null });
    try {
      const status = await window.electronAPI.gemini.clearApiKey();
      clearLegacyPersistedGeminiApiKey();
      set({
        geminiApiKeyDraft: '',
        hasGeminiApiKey: status.configured,
        geminiApiKeySource: status.source,
        isGeminiApiKeyLoaded: true,
        isGeminiApiKeySaving: false,
        geminiApiKeyError: null,
      });
      return true;
    } catch (error) {
      set({
        isGeminiApiKeySaving: false,
        geminiApiKeyError: error instanceof Error
          ? error.message
          : 'Failed to clear Gemini API key.',
      });
      return false;
    }
  },
  setOverlayThaiFontEnabled: (enabled) => {
    persistOverlayThaiFontEnabled(enabled);
    set({ overlayThaiFontEnabled: Boolean(enabled) });
  },
  setOverlayFontPreset: (preset) => {
    persistOverlayFontPreset(preset);
    set({ overlayFontPreset: preset });
  },
  setOverlayFontSizeScale: (scale) => {
    const normalized = clampOverlayFontSizeScale(scale);
    persistOverlayFontSizeScale(normalized);
    set({ overlayFontSizeScale: normalized });
  },
  updateSafetySettings: (newSettings) => set((state) => ({
    safetySettings: { ...state.safetySettings, ...newSettings }
  }))
}));

// Subscribe to OCR options changes in OCRTextLayerStore to persist them per file and prevent targetLanguage conflicts
useOCRTextLayerStore.subscribe((state) => {
  const options = state.options;
  if (options) {
    const { filePath, fileName } = useProjectStore.getState();
    const fileKey = filePath || fileName;
    if (fileKey) {
      try {
        if (options.language) {
          localStorage.setItem(`pdf_translator.ocr_lang.${fileKey}`, options.language);
        }
        if (options.engine) {
          localStorage.setItem(`pdf_translator.ocr_engine.${fileKey}`, options.engine);
        }
        if (options.ocrQualityProfile) {
          localStorage.setItem(`pdf_translator.ocr_quality_profile.${fileKey}`, options.ocrQualityProfile);
        }
      } catch (e) {
        console.warn('[Storage] Failed to save OCR options:', e);
      }
    }

    const ocrLang = options.language;
    if (ocrLang) {
      const isThaiOcr = ocrLang.split('+').some(lang => lang.trim().toLowerCase() === 'tha' || lang.trim().toLowerCase() === 'thai');
      if (isThaiOcr) {
        const currentTarget = useProjectStore.getState().targetLanguage;
        if (currentTarget === 'th' || currentTarget === 'thai') {
          // Automatically switch destination/target language to English ('en') to prevent conflict
          useProjectStore.getState().setTargetLanguage('en');
        }
      }
    }
  }
});

// Run initial check to prevent conflicts during startup/hydration
const initialOcrLang = useOCRTextLayerStore.getState().options?.language;
if (initialOcrLang) {
  const isThaiOcr = initialOcrLang.split('+').some(lang => lang.trim().toLowerCase() === 'tha' || lang.trim().toLowerCase() === 'thai');
  if (isThaiOcr) {
    const currentTarget = useProjectStore.getState().targetLanguage;
    if (currentTarget === 'th' || currentTarget === 'thai') {
      useProjectStore.getState().setTargetLanguage('en');
    }
  }
}

// Sync viewMode from useProjectStore to pageMode in useUIStore
useProjectStore.subscribe((state) => {
  const pageMode = state.viewMode === 'continuous' ? 'scroll' : 'single';
  if (useUIStore.getState().pageMode !== pageMode) {
    useUIStore.setState({ pageMode });
  }
});

// Sync pageMode from useUIStore to viewMode in useProjectStore
useUIStore.subscribe((state) => {
  const projectViewMode = state.pageMode === 'scroll' ? 'continuous' : 'single';
  if (useProjectStore.getState().viewMode !== projectViewMode) {
    useProjectStore.setState({ viewMode: projectViewMode });
  }
});

