import { create } from 'zustand';

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
  setPage: (page: number) => void;
  setTotalPages: (total: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setTranslationMode: (mode: TranslationMode) => void;
  setSourceLanguage: (lang: string) => void;
  setTargetLanguage: (lang: string) => void;
  updateSafetySettings: (settings: Partial<SafetySettings>) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  file: null,
  fileUrl: null,
  fileType: null,
  fileName: '',
  
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

  loadProject: (file) => set((state) => {
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
      currentPage: 1 
    };
  }),

  closeProject: () => set((state) => {
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    return { file: null, fileUrl: null, fileType: null, fileName: '' };
  }),

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
