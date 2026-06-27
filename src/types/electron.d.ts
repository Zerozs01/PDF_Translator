/**
 * Type declarations for Electron APIs exposed via preload script
 */

import { OCREngine, OCRPageResult, OCRPipelineProfile, OCRQualityProfile } from './index';

// Document type from database
export interface DBDocument {
  id: number;
  filepath: string;
  filename: string;
  file_type: string;
  file_size: number;
  total_pages: number;
  thumbnail_path: string | null;
  project_id: number | null;
  is_favorite: boolean;
  last_page: number;
  created_at: string;
  last_accessed: string;
}

// Tag type
export interface DBTag {
  id: number;
  name: string;
  color: string;
  created_at: string;
}

// Project type
export interface DBProject {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  parent_id: number | null;
  created_at: string;
}

export interface DBDocumentCacheCandidate {
  id: number;
  filepath: string;
  filename: string;
  total_pages: number;
  last_accessed: number | null;
  cache_pages: number;
  last_cache_update: number | null;
}

export interface DBOcrCacheStatsRow {
  document_id: number;
  cache_pages: number;
  last_cache_update: number | null;
}

export interface DBOCRTranslationCacheEntry {
  key: string;
  pageNum: number;
  ocrEngine: OCREngine;
  ocrLanguage: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationMode: 'adaptive' | 'manga' | 'manhwa' | 'official';
  translatorEngine: 'offline' | 'ai';
  sourceFingerprint: string;
  translatedByIndex: Array<{ index: number; text: string }>;
  translatedText: string;
  lineCount: number;
  groupCount: number;
  createdAt: number;
}

// Update types
export interface DocumentUpdate {
  filename?: string;
  project_id?: number | null;
  thumbnail_path?: string;
  is_favorite?: boolean;
  total_pages?: number;
}

export interface ProjectCreate {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  parent_id?: number | null;
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  parent_id?: number | null;
}

export interface ExternalOCREngineStatus {
  engine: OCREngine;
  available: boolean;
  runtime: string;
  description: string;
}

export interface ExternalOCRWarmupStatus {
  ok: boolean;
  engine: OCREngine;
  runtime: string;
  description: string;
}

export interface ExternalOCRRequest {
  engine: OCREngine;
  imageData?: Uint8Array | ArrayBuffer;
  imagePath?: string;
  imageMimeType: string;
  imageWidth: number;
  imageHeight: number;
  language: string;
  dpi: number;
  pageSegMode?: number;
  pipelineProfile?: OCRPipelineProfile;
  ocrQualityProfile?: OCRQualityProfile;
  maxSideLen?: number;
  maxPixels?: number;
  chunkIndex?: number;
  totalChunks?: number;
  useAngleCls?: boolean;
  use_angle_cls?: boolean;
}

export interface ExternalOCRResult {
  words: OCRPageResult['words'];
  lines: OCRPageResult['lines'];
  text: string;
  confidence: number;
  pageSegMode?: number;
  debug?: OCRPageResult['debug'];
}

export interface OfflineTranslationContext {
  mode?: string;
  sourceType?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  timeoutMs?: number;
}

export type GeminiApiKeySource = 'secure-storage' | 'environment' | 'none';

export interface GeminiApiKeyStatus {
  configured: boolean;
  source: GeminiApiKeySource;
  supportsSecureStorage: boolean;
}

export interface GeminiTranslationContext {
  mode: 'adaptive' | 'manga' | 'manhwa' | 'official';
  sourceType: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  baseSystemPrompt?: string;
}

// Electron API interface (secure whitelist-based)
export interface ElectronAPI {
  db: {
    // Basic operations
    saveDocument: (filepath: string, filename: string, totalPages: number) => Promise<number>;
    getDocument: (filepath: string) => Promise<{ id: number; total_pages: number } | null>;
    findDocumentsByFilename: (filename: string) => Promise<DBDocumentCacheCandidate[]>;
    saveOCR: (docId: number, pageNum: number, data: OCRPageResult, engine?: OCREngine) => Promise<boolean>;
    getOCR: (docId: number, pageNum: number, engine?: OCREngine) => Promise<OCRPageResult | null>;
    clearOCR: (docId: number, pageNum: number, engine?: OCREngine) => Promise<boolean>;
    clearDocumentCache: (docId: number) => Promise<boolean>;
    getLatestOCR: (docId: number) => Promise<{
      page_number: number;
      updated_at: number;
      ocr_data: OCRPageResult;
    } | null>;
    getOcrCacheStatsForDocumentIds: (documentIds: number[]) => Promise<DBOcrCacheStatsRow[]>;
    saveTranslationCache: (
      docId: number,
      pageNum: number,
      cacheKey: string,
      entry: DBOCRTranslationCacheEntry
    ) => Promise<boolean>;
    getTranslationCachePage: (docId: number, pageNum: number) => Promise<DBOCRTranslationCacheEntry[]>;
    clearTranslationCacheByEngine: (docId: number, pageNum: number, engine?: OCREngine) => Promise<boolean>;
    saveSentenceTranslation?: (
      sourceText: string,
      sourceLanguage: string,
      targetLanguage: string,
      translatorEngine: string,
      translationMode: string,
      translatedText: string
    ) => Promise<boolean>;
    getSentenceTranslation?: (
      sourceText: string,
      sourceLanguage: string,
      targetLanguage: string,
      translatorEngine: string,
      translationMode: string
    ) => Promise<string | null>;
    
    // Benchmark CRUD
    saveBenchmark?: (params: { docId: number; pageNum: number; key: string; payload: string }) => Promise<boolean>;
    getBenchmark?: (params: { docId: number; pageNum: number; key: string }) => Promise<string | null>;
    clearBenchmark?: (params: { docId: number; pageNum: number; key?: string }) => Promise<boolean>;
    listBenchmarks?: (params: { docId: number; pageNum: number }) => Promise<any[]>;

    // Document management
    getRecentDocuments: (limit?: number) => Promise<DBDocument[]>;
    getDocumentsByProject: (projectId: number | null) => Promise<DBDocument[]>;
    getFavoriteDocuments: () => Promise<DBDocument[]>;
    searchDocuments: (query: string) => Promise<DBDocument[]>;
    updateDocument: (id: number, updates: DocumentUpdate) => Promise<boolean>;
    deleteDocument: (id: number) => Promise<boolean>;
    toggleFavorite: (id: number) => Promise<boolean>;
    getDocumentCacheSize?: (id: number) => Promise<number>;
    getDocumentsByTag: (tagId: number) => Promise<DBDocument[]>;
    addDocumentTag: (documentId: number, tagId: number) => Promise<boolean>;
    removeDocumentTag: (documentId: number, tagId: number) => Promise<boolean>;
    getDocumentTags: (documentId: number) => Promise<DBTag[]>;
    touchDocument: (id: number) => Promise<boolean>;
    updateLastPage: (id: number, pageNum: number) => Promise<boolean>;
  };
  
  tags: {
    getAll: () => Promise<DBTag[]>;
    create: (name: string, color?: string) => Promise<DBTag | null>;
    delete: (id: number) => Promise<boolean>;
  };
  
  projects: {
    getAll: () => Promise<DBProject[]>;
    getChildren: (parentId: number | null) => Promise<DBProject[]>;
    create: (project: ProjectCreate) => Promise<DBProject | null>;
    update: (id: number, updates: ProjectUpdate) => Promise<boolean>;
    delete: (id: number) => Promise<boolean>;
  };
  
  gemini: {
    getApiKeyStatus: () => Promise<GeminiApiKeyStatus>;
    setApiKey: (apiKey: string) => Promise<GeminiApiKeyStatus>;
    clearApiKey: () => Promise<GeminiApiKeyStatus>;
    translate: (text: string, context: GeminiTranslationContext) => Promise<string>;
  };

  translate: {
    offline: (text: string, context?: OfflineTranslationContext) => Promise<string>;
    offlineBatch: (texts: string[], context?: OfflineTranslationContext) => Promise<string[]>;
  };
  
  fs: {
    readFile: (filepath: string) => Promise<{
      data: Uint8Array | ArrayBuffer | string;
      mimeType: string;
      size: number;
      name: string;
    }>;
    openFile: () => Promise<{
      filepath: string;
      data: Uint8Array | ArrayBuffer | string;
      mimeType: string;
      size: number;
      name: string;
    } | null>;
    importFile: (payload: {
      name: string;
      mimeType: string;
      data?: Uint8Array | ArrayBuffer;
      filePath?: string;
    }) => Promise<{
      filepath: string;
      mimeType: string;
      size: number;
      name: string;
    }>;
  };

  ocr: {
    getEngineStatus: () => Promise<ExternalOCREngineStatus[]>;
    prewarmEngine: (payload: { engine: OCREngine; language?: string }) => Promise<ExternalOCRWarmupStatus>;
    cancelExternal: (payload?: { engine?: OCREngine }) => Promise<boolean>;
    clearCudaCache: (payload: { engine: OCREngine }) => Promise<boolean>;
    runExternal: (request: ExternalOCRRequest) => Promise<ExternalOCRResult>;
    runRawDirect?: (payload: {
      imagePath?: string;
      imageData?: Uint8Array | ArrayBuffer;
      imageMimeType: string;
      imageWidth: number;
      imageHeight: number;
      language: string;
      engine?: string;
    }) => Promise<any>;
    writeTempImage: (payload: { imageData: Uint8Array | ArrayBuffer; imageMimeType: string }) => Promise<{ imagePath: string }>;
    deleteTempImage: (payload: { imagePath: string }) => Promise<{ ok: boolean }>;
  };

  models: {
    getStatus: (payload: { engine: string; language: string }) => Promise<{ installed: boolean }>;
    download: (payload: { engine: string; language: string }) => Promise<boolean>;
  };

  startupLoad?: () => Promise<{
    recentDocuments: DBDocument[];
    allTags: DBTag[];
    allProjects: DBProject[];
    latestOcrDocId: number | null;
  }>;

  pdfExport: {
    start: (job: import('./pdfExport').PdfPrintExportJob) => Promise<import('./pdfExport').PdfPrintExportResult>;
    cancel: (jobId: string) => Promise<{ ok: boolean }>;
    onProgress: (callback: (progress: import('./pdfExport').PdfPrintExportProgress) => void) => () => void;
  };

  auth: {
    checkStatus: () => Promise<{ isSetup: boolean; mode: 'RELAX' | 'SECURITY' }>;
    setup: (payload: { password: string; emergencyPin: string }) => Promise<{ success: boolean; error?: string }>;
    login: (payload: { password: string }) => Promise<{ success: boolean; error?: string }>;
    autoLogin: () => Promise<{ success: boolean; error?: string }>;
    hardReset: (payload: { emergencyPin: string }) => Promise<{ success: boolean; error?: string }>;
    setMode: (payload: { mode: 'RELAX' | 'SECURITY'; password?: string }) => Promise<{ success: boolean; error?: string }>;
  };

  power?: {
    preventSleep: () => Promise<number>;
    allowSleep: () => Promise<boolean>;
  };
  
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
}

// Extend Window interface
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
