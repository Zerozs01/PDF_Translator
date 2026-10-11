import { create } from 'zustand';
import { ToolType } from '../types';

export interface GlobalLoadingState {
  active: boolean;
  message: string;
  progress?: number;
}

interface UIState {
  // Sidebar
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;
  isRightSidebarOpen: boolean;
  toggleRightSidebar: () => void;
  setRightSidebarOpen: (isOpen: boolean) => void;

  // Canvas State
  zoom: number;
  pan: { x: number; y: number };
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  /** Atomic update for both pan and zoom in a single Zustand set (avoids double re-render) */
  setView: (pan: { x: number; y: number }, zoom: number) => void;
  resetView: () => void;
  isUserInteracting: boolean;
  setIsUserInteracting: (isInteracting: boolean) => void;

  // Tools
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;

  // Global Loading State
  loadingState: GlobalLoadingState | null;
  setLoadingState: (state: GlobalLoadingState | null) => void;

  // Split View & Page Modes
  viewMode: 'overlay' | 'split';
  setViewMode: (mode: 'overlay' | 'split') => void;
  pageMode: 'single' | 'scroll';
  setPageMode: (mode: 'single' | 'scroll') => void;

  // OCR Panel Accordion Toggles (Persisted in localStorage)
  isOcrLanguagesSectionOpen: boolean;
  setOcrLanguagesSectionOpen: (isOpen: boolean) => void;
  toggleOcrLanguagesSection: () => void;

  isOcrModelSectionOpen: boolean;
  setOcrModelSectionOpen: (isOpen: boolean) => void;
  toggleOcrModelSection: () => void;

  isOcrTextLayerSectionOpen: boolean;
  setOcrTextLayerSectionOpen: (isOpen: boolean) => void;
  toggleOcrTextLayerSection: () => void;
}

const OCR_LANGUAGES_SECTION_OPEN_KEY = 'pdf_translator.ocr_languages_section_open';
const OCR_MODEL_SECTION_OPEN_KEY = 'pdf_translator.ocr_model_section_open';
const OCR_TEXT_LAYER_OPEN_KEY = 'pdf_translator.ocr_text_layer_open';

const readPersistedToggle = (key: string, defaultValue: boolean): boolean => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const raw = String(window.localStorage.getItem(key) || '').trim().toLowerCase();
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
};

const persistToggle = (key: string, value: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {}
};

export const useUIStore = create<UIState>((set) => ({
  // Sidebar
  isSidebarOpen: true,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),
  isRightSidebarOpen: true,
  toggleRightSidebar: () => set((state) => ({ isRightSidebarOpen: !state.isRightSidebarOpen })),
  setRightSidebarOpen: (isOpen) => set({ isRightSidebarOpen: isOpen }),

  // Canvas
  zoom: 1,
  pan: { x: 0, y: 0 },
  setZoom: (zoom) => set({ zoom }),
  setPan: (x, y) => set({ pan: { x, y } }),
  setView: (pan, zoom) => set({ pan, zoom }),
  resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 }, viewMode: 'overlay' }),
  isUserInteracting: false,
  setIsUserInteracting: (isUserInteracting) => set({ isUserInteracting }),

  // Tools
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool }),

  // Global Loading State
  loadingState: null,
  setLoadingState: (loadingState) => set({ loadingState }),

  // Split View & Page Modes
  viewMode: 'overlay',
  setViewMode: (viewMode) => set({ viewMode }),
  pageMode: 'single',
  setPageMode: (pageMode) => set({ pageMode }),

  // OCR Panel Accordion Toggles
  isOcrLanguagesSectionOpen: readPersistedToggle(OCR_LANGUAGES_SECTION_OPEN_KEY, false),
  setOcrLanguagesSectionOpen: (isOpen) => {
    persistToggle(OCR_LANGUAGES_SECTION_OPEN_KEY, isOpen);
    set({ isOcrLanguagesSectionOpen: isOpen });
  },
  toggleOcrLanguagesSection: () => set((state) => {
    const next = !state.isOcrLanguagesSectionOpen;
    persistToggle(OCR_LANGUAGES_SECTION_OPEN_KEY, next);
    return { isOcrLanguagesSectionOpen: next };
  }),

  isOcrModelSectionOpen: readPersistedToggle(OCR_MODEL_SECTION_OPEN_KEY, false),
  setOcrModelSectionOpen: (isOpen) => {
    persistToggle(OCR_MODEL_SECTION_OPEN_KEY, isOpen);
    set({ isOcrModelSectionOpen: isOpen });
  },
  toggleOcrModelSection: () => set((state) => {
    const next = !state.isOcrModelSectionOpen;
    persistToggle(OCR_MODEL_SECTION_OPEN_KEY, next);
    return { isOcrModelSectionOpen: next };
  }),

  isOcrTextLayerSectionOpen: readPersistedToggle(OCR_TEXT_LAYER_OPEN_KEY, false),
  setOcrTextLayerSectionOpen: (isOpen) => {
    persistToggle(OCR_TEXT_LAYER_OPEN_KEY, isOpen);
    set({ isOcrTextLayerSectionOpen: isOpen });
  },
  toggleOcrTextLayerSection: () => set((state) => {
    const next = !state.isOcrTextLayerSectionOpen;
    persistToggle(OCR_TEXT_LAYER_OPEN_KEY, next);
    return { isOcrTextLayerSectionOpen: next };
  }),
}));

