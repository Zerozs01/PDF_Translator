import { create } from 'zustand';
import { dbService } from '../services/dbService';
import { useOCRTextLayerStore } from './useOCRTextLayerStore';

export type TranslationMode = 'manga' | 'official';
export type ViewMode = 'single' | 'continuous';

export interface SafetySettings {
  harassment: 'off' | 'low' | 'medium' | 'high';
  hate: 'off' | 'low' | 'medium' | 'high';
  sexual: 'off' | 'low' | 'medium' | 'high';
  dangerous: 'off' | 'low' | 'medium' | 'high';
}

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

  // Actions
  loadProject: (file: File) => void;
  closeProject: () => void;
  setFileData: (data: Uint8Array | null) => void;
  setPage: (page: number) => void;
  setTotalPages: (total: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setTranslationMode: (mode: TranslationMode) => void;
  setSourceLanguage: (lang: string) => void;
  setTargetLanguage: (lang: string) => void;
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

  translationMode: 'manga',
  safetySettings: {
    harassment: 'off',
    hate: 'off',
    sexual: 'off',
    dangerous: 'off'
  },
  sourceLanguage: 'eng',
  targetLanguage: 'th',

  loadProject: (file) => {
    // Clear OCR cache when loading a new file to avoid cross-file reuse
    useOCRTextLayerStore.getState().reset();
    // Save document to database for recent files tracking
    // We need filepath - for dropped/selected files we can try to get path
    const filePath = (file as unknown as { path?: string }).path ?? null;
    if (!filePath) {
      console.warn('[DB] File path not available. Recent list will not be saved for this file.');
    }
    if (filePath && dbService.isAvailable()) {
      // Save asynchronously (don't block UI)
      dbService.saveDocument(filePath, file.name, 0)
        .then(() => dbService.getDocument(filePath))
        .then((doc) => {
          if (!doc?.id) return;
          const currentPath = get().filePath;
          if (currentPath === filePath) {
            set({ documentId: doc.id });
          }
        })
        .catch(err => console.error('Failed to save document to DB:', err));
    }
    
    return set((state) => {
      // IMPORTANT: Revoke old URL to prevent memory leak
      if (state.fileUrl) {
        URL.revokeObjectURL(state.fileUrl);
      }
      
      const url = URL.createObjectURL(file);
      const type = file.type === 'application/pdf' ? 'pdf' : 'image';
      return { 
        file, 
        fileUrl: url, 
        fileType: type, 
        fileName: file.name,
        filePath,
        documentId: null,
        fileData: null,
        currentPage: 1 
      };
    });
  },

  closeProject: () => set((state) => {
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    useOCRTextLayerStore.getState().reset();
    return { file: null, fileUrl: null, fileType: null, fileName: '', filePath: null, documentId: null, fileData: null };
  }),
  setFileData: (data) => set({ fileData: data }),

  setPage: (page) => set({ currentPage: page }),
  setTotalPages: (total) => set({ totalPages: total }),
  setViewMode: (mode) => set({ viewMode: mode }),
  setTranslationMode: (mode) => set({ translationMode: mode }),
  setSourceLanguage: (lang) => set({ sourceLanguage: lang }),
  setTargetLanguage: (lang) => set({ targetLanguage: lang }),
  updateSafetySettings: (newSettings) => set((state) => ({
    safetySettings: { ...state.safetySettings, ...newSettings }
  }))
}));
