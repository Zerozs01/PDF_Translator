/**
 * OCR Text Layer Store - State management for OCR Text Layer feature
 */

import { create } from 'zustand';
import { OCRPageResult, OCROptions } from '../types';
import { ProcessingProgress } from '../services/pdf';

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
  setPageOCR: (pageNum: number, result: OCRPageResult) => void;
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

export const OCR_PROFILES = [
  { id: 'fast', name: 'Fast', dpi: 150, description: 'Quick scan, lower accuracy' },
  { id: 'balanced', name: 'Balanced', dpi: 200, description: 'Good balance of speed and accuracy' },
  { id: 'best', name: 'Best Quality', dpi: 300, description: 'Highest accuracy, slower' },
] as const;

export const useOCRTextLayerStore = create<OCRTextLayerState>((set, get) => ({
  // Default options
  options: {
    language: 'eng',
    dpi: 300,
    profile: 'best',
    skipIfTextExists: true,
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
  setPageOCR: (pageNum, result) => set((state) => {
    const newMap = new Map(state.allPagesOCR);
    newMap.set(pageNum, result);
    return { allPagesOCR: newMap };
  }),
  getPageOCR: (pageNum) => get().allPagesOCR.get(pageNum),
  clearAllOCR: () => set({ allPagesOCR: new Map() }),

  // Current page OCR (for preview)
  currentPageOCR: null,
  setCurrentPageOCR: (result) => set({ currentPageOCR: result }),

  // Export
  searchablePDFBlob: null,
  setSearchablePDFBlob: (blob) => set({ searchablePDFBlob: blob }),

  // Debug overlay
  showDebugOverlay: true,
  setShowDebugOverlay: (show) => set({ showDebugOverlay: show }),

  // Actions
  reset: () => set({
    isProcessing: false,
    progress: null,
    currentPageOCR: null,
    searchablePDFBlob: null,
    showDebugOverlay: true,
    allPagesOCR: new Map(),
  }),
}));
