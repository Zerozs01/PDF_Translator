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

const isImportedCachePath = (value: string | null): boolean =>
  typeof value === 'string'
  && /[\\/]imports[\\/][a-f0-9]{16,}\.[^\\/]+$/i.test(value);

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
    // Save document to database for recent files tracking.
    // Use a canonical imported filepath when possible so OCR cache keys are stable
    // across open methods (browse, drag/drop, recent list).
    const sourcePath = (file as unknown as { path?: string }).path ?? null;
    let resolvedPath = sourcePath;
    let resolvedFileData = fileData ?? null;
    let importedPath: string | null = null;

    if (window.electronAPI?.fs?.importFile) {
      try {
        if (!resolvedFileData) {
          const buffer = await file.arrayBuffer();
          resolvedFileData = new Uint8Array(buffer);
        }
        const dataForImport = new Uint8Array(resolvedFileData);
        const imported = await window.electronAPI.fs.importFile({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          data: dataForImport
        });
        if (imported?.filepath) {
          // Canonical stable path (content-hash based in main process).
          importedPath = imported.filepath;
        }
      } catch (error) {
        console.warn('[DB] Failed to import canonical file path, fallback to source path:', error);
      }
    }

    // Keep legacy/source path if it already exists in DB (preserve old OCR cache/doc_id).
    if (sourcePath && dbService.isAvailable()) {
      try {
        const existingSourceDoc = await dbService.getDocument(sourcePath);
        if (existingSourceDoc?.id) {
          resolvedPath = sourcePath;
        } else if (importedPath) {
          resolvedPath = importedPath;
        }
      } catch {
        if (importedPath) resolvedPath = importedPath;
      }
    } else if (importedPath) {
      resolvedPath = importedPath;
    }

    // Migration fallback:
    // If we opened an imported (hash-path) file that has no OCR rows yet,
    // but there is exactly one older document with the same filename and OCR cache,
    // reuse that path so cache lookup remains backward compatible.
    if (resolvedPath && dbService.isAvailable() && isImportedCachePath(resolvedPath)) {
      try {
        const activeDoc = await dbService.getDocument(resolvedPath);
        const hasCurrentCache = Boolean(activeDoc?.id && await dbService.getLatestOCR(activeDoc.id));
        if (!hasCurrentCache) {
          const candidates = await dbService.findDocumentsByFilename(file.name);
          const cacheCandidates = candidates.filter(
            candidate => candidate.cache_pages > 0 && candidate.filepath !== resolvedPath
          );
          if (cacheCandidates.length === 1) {
            resolvedPath = cacheCandidates[0].filepath;
            console.log(
              `[DB] Reusing OCR-backed document ${cacheCandidates[0].id} for "${file.name}" (cache pages: ${cacheCandidates[0].cache_pages})`
            );
          } else if (cacheCandidates.length > 1) {
            console.warn(
              `[DB] Multiple OCR-backed candidates found for "${file.name}". Keeping current imported path to avoid ambiguity.`
            );
          }
        }
      } catch (error) {
        console.warn('[DB] Failed OCR cache fallback by filename:', error);
      }
    }

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
        await get().ensureDocumentId();
      } catch (error) {
        console.error('[DB] Failed to ensure documentId:', error);
      }
    }
  },

  ensureDocumentId: async () => {
    if (!dbService.isAvailable()) return null;
    const { documentId, file, filePath } = get();

    if (documentId) {
      if (file && filePath && isImportedCachePath(filePath)) {
        try {
          const hasCurrentCache = Boolean(await dbService.getLatestOCR(documentId));
          if (!hasCurrentCache) {
            const candidates = await dbService.findDocumentsByFilename(file.name);
            const cacheCandidates = candidates.filter(
              candidate => candidate.cache_pages > 0 && candidate.id !== documentId
            );
            if (cacheCandidates.length === 1) {
              const preferred = cacheCandidates[0];
              console.log(
                `[DB] Switching documentId ${documentId} -> ${preferred.id} for OCR cache compatibility`
              );
              set({ documentId: preferred.id, filePath: preferred.filepath });
              return preferred.id;
            }
          }
        } catch (error) {
          console.warn('[DB] Failed to resolve legacy OCR cache document id:', error);
        }
      }
      return documentId;
    }

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
