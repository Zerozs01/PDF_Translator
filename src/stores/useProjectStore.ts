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
  loadProject: (file: File, fileData?: Uint8Array | null) => Promise<void>;
  ensureDocumentId: () => Promise<number | null>;
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

  loadProject: async (file, fileData) => {
    // Clear OCR cache when loading a new file to avoid cross-file reuse
    useOCRTextLayerStore.getState().reset();
    // Save document to database for recent files tracking
    // We need filepath - for dropped/selected files we can try to get path
    const filePath = (file as unknown as { path?: string }).path ?? null;
    if (!filePath) {
      console.warn('[DB] File path not available. Recent list will not be saved for this file.');
    }

    const previousUrl = get().fileUrl;
    if (previousUrl) {
      // Revoke after state update to avoid revoking while components still render.
      setTimeout(() => URL.revokeObjectURL(previousUrl), 0);
    }

    const url = URL.createObjectURL(file);
    const type = file.type === 'application/pdf' ? 'pdf' : 'image';
    set({ 
      file, 
      fileUrl: url, 
      fileType: type, 
      fileName: file.name,
      filePath,
      documentId: null,
      fileData: fileData ?? null,
      currentPage: 1,
      totalPages: 0
    });

    if (filePath && dbService.isAvailable()) {
      try {
        await get().ensureDocumentId();
      } catch (error) {
        console.error('[DB] Failed to ensure documentId:', error);
      }
    }
  },

  ensureDocumentId: async () => {
    if (!dbService.isAvailable()) return null;
    const { documentId, file, filePath } = get();
    if (documentId) return documentId;

    const path = filePath ?? (file as unknown as { path?: string }).path ?? null;
    if (!path || !file) {
      throw new Error('File path not available. Cannot ensure document_id.');
    }

    let doc = await dbService.getDocument(path);
    if (!doc?.id) {
      await dbService.saveDocument(path, file.name, 0);
      doc = await dbService.getDocument(path);
    }

    if (!doc?.id) {
      throw new Error('Failed to create document entry for OCR cache.');
    }

    const currentPath = get().filePath;
    if (currentPath !== path) {
      return null;
    }

    set({ documentId: doc.id, filePath: path });
    return doc.id;
  },

  closeProject: () => set((state) => {
    if (state.fileUrl) {
      // Revoke after unmount to avoid interrupting PDF.js loads.
      setTimeout(() => URL.revokeObjectURL(state.fileUrl!), 0);
    }
    useOCRTextLayerStore.getState().reset();
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
