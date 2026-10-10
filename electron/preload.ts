import { ipcRenderer, contextBridge } from 'electron'

// --------- SECURITY: Whitelist-based API Exposure ---------
// Only expose specific, validated functions to the renderer process

// Allowed IPC channels (whitelist)
const ALLOWED_INVOKE_CHANNELS = [
  'db:save-document',
  'db:get-document',
  'db:find-documents-by-filename',
  'db:save-ocr',
  'db:save-ocr-batch',
  'db:get-ocr',
  'db:clear-ocr',
  'db:clear-document-cache',
  'db:get-latest-ocr',
  'db:get-ocr-cache-stats-for-document-ids',
  'db:save-translation-cache',
  'db:save-translation-cache-batch',
  'db:get-translation-cache-page',
  'db:clear-translation-cache-by-engine',
  'db:save-sentence-translation',
  'db:save-sentence-translation-batch',
  'db:get-sentence-translation',
  'db:get-sentence-translation-batch',
  'db:save-benchmark',
  'db:get-benchmark',
  'db:clear-benchmark',
  'db:list-benchmarks',
  // Document management
  'db:get-recent-documents',
  'db:get-documents-by-project',
  'db:get-favorite-documents',
  'db:search-documents',
  'db:update-document',
  'db:delete-document',
  'db:toggle-favorite',
  'db:toggle-thumbnail-hidden',
  'db:get-document-cache-size',
  'db:get-documents-by-tag',
  'db:add-document-tag',
  'db:remove-document-tag',
  'db:get-document-tags',
  'db:touch-document',
  'db:update-last-page',
  // Tag management
  'db:get-all-tags',
  'db:create-tag',
  'db:update-tag',
  'db:delete-tag',
  // Project management
  'db:get-all-projects',
  'db:get-project-children',
  'db:create-project',
  'db:update-project',
  'db:delete-project',
  'db:get-project-stats',
  // Glossary management
  'db:glossary-get-all',
  'db:glossary-save',
  'db:glossary-delete',
  'db:glossary-toggle',
  'db:glossary-import',
  // Window management
  'window:toggle-fullscreen',
  'window:is-fullscreen',
  // File system
  'fs:read-file',
  'fs:open-file',
  'fs:import-file',
  // OCR
  'ocr:get-engine-status',
  'ocr:get-gpu-info',
  'ocr:prewarm-engine',
  'ocr:write-temp-image',
  'ocr:delete-temp-image',
  'ocr:run-raw-direct',
  'ocr:run-external',
  'ocr:cancel-external',
  'ocr:clear-cuda-cache',
  // Gemini
  'gemini:get-api-key-status',
  'gemini:set-api-key',
  'gemini:clear-api-key',
  'gemini:translate', // For secure Gemini API calls via main process
  // Offline translation
  'translate:offline',
  'translate:offline-batch',
  // Startup
  'db:startup-load',
  // Model Management
  'models:get-status',
  'models:download',
  // PDF export
  'pdf-export:start',
  'pdf-export:cancel',
  // Auth channels
  'auth:check-status',
  'auth:setup',
  'auth:login',
  'auth:auto-login',
  'auth:hard-reset',
  'auth:set-mode',
  // Power sleep prevention
  'power:prevent-sleep',
  'power:allow-sleep',
] as const;

const ALLOWED_SEND_CHANNELS = [
  'main-process-message',
] as const;

const ALLOWED_RECEIVE_CHANNELS = [
  'main-process-message',
  'ocr:progress',
  'pdf-export:progress',
] as const;

type AllowedInvokeChannel = typeof ALLOWED_INVOKE_CHANNELS[number];
type AllowedSendChannel = typeof ALLOWED_SEND_CHANNELS[number];
type AllowedReceiveChannel = typeof ALLOWED_RECEIVE_CHANNELS[number];

// SECURITY WRAPPER: Enforces strict channel validation at dynamic runtime
const safeInvoke = <T = unknown>(channel: AllowedInvokeChannel, ...args: unknown[]): Promise<T> => {
  if (!ALLOWED_INVOKE_CHANNELS.includes(channel)) {
    throw new Error(`[Preload Security Exception] Blocked invoke on unauthorized channel: ${channel}`);
  }
  return ipcRenderer.invoke(channel, ...args);
};

// Type definitions
interface DocumentUpdate {
  filename?: string;
  project_id?: number | null;
  thumbnail_path?: string;
  is_favorite?: boolean;
  is_thumbnail_hidden?: boolean | number;
  total_pages?: number;
  rating?: number;
}

interface ProjectCreate {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  parent_id?: number | null;
}

interface ProjectUpdate {
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  parent_id?: number | null;
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Document operations (validated channels only)
  db: {
    // Basic operations
    saveDocument: (filepath: string, filename: string, totalPages: number) =>
      safeInvoke('db:save-document', { filepath, filename, totalPages }),
    getDocument: (filepath: string) =>
      safeInvoke('db:get-document', filepath),
    findDocumentsByFilename: (filename: string) =>
      safeInvoke('db:find-documents-by-filename', filename),
    saveOCR: (docId: number, pageNum: number, data: unknown, engine?: string) =>
      safeInvoke('db:save-ocr', { docId, pageNum, data, engine }),
    saveOCRBatch: (items: Array<{ docId: number; pageNum: number; data: unknown; engine?: string }>) =>
      safeInvoke('db:save-ocr-batch', items.map((i) => ({ documentId: i.docId, pageNumber: i.pageNum, data: i.data, engine: i.engine }))),
    getOCR: (docId: number, pageNum: number, engine?: string) =>
      safeInvoke('db:get-ocr', { docId, pageNum, engine }),
    clearOCR: (docId: number, pageNum: number, engine?: string) =>
      safeInvoke('db:clear-ocr', { docId, pageNum, engine }),
    clearDocumentCache: (docId: number) =>
      safeInvoke('db:clear-document-cache', docId),
    getLatestOCR: (docId: number) =>
      safeInvoke('db:get-latest-ocr', { docId }),
    getOcrCacheStatsForDocumentIds: (documentIds: number[]) =>
      safeInvoke('db:get-ocr-cache-stats-for-document-ids', { documentIds }),
    saveTranslationCache: (docId: number, pageNum: number, cacheKey: string, entry: unknown) =>
      safeInvoke('db:save-translation-cache', { docId, pageNum, cacheKey, entry }),
    saveTranslationCacheBatch: (items: Array<{ docId: number; pageNum: number; cacheKey: string; entry: unknown }>) =>
      safeInvoke('db:save-translation-cache-batch', items.map((i) => ({ documentId: i.docId, pageNumber: i.pageNum, cacheKey: i.cacheKey, entry: i.entry }))),
    getTranslationCachePage: (docId: number, pageNum: number) =>
      safeInvoke('db:get-translation-cache-page', { docId, pageNum }),
    clearTranslationCacheByEngine: (docId: number, pageNum: number, engine?: string) =>
      safeInvoke('db:clear-translation-cache-by-engine', { docId, pageNum, engine }),
    saveSentenceTranslation: (sourceText: string, sourceLanguage: string, targetLanguage: string, translatorEngine: string, translationMode: string, translatedText: string) =>
      safeInvoke('db:save-sentence-translation', { sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode, translatedText }),
    saveSentenceTranslationBatch: (items: Array<{ sourceText: string; sourceLanguage: string; targetLanguage: string; translatorEngine: string; translationMode: string; translatedText: string }>) =>
      safeInvoke('db:save-sentence-translation-batch', { items }),
    getSentenceTranslation: (sourceText: string, sourceLanguage: string, targetLanguage: string, translatorEngine: string, translationMode: string) =>
      safeInvoke('db:get-sentence-translation', { sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode }),
    getSentenceTranslationBatch: (sourceTexts: string[], sourceLanguage: string, targetLanguage: string, translatorEngine: string, translationMode: string) =>
      safeInvoke('db:get-sentence-translation-batch', { sourceTexts, sourceLanguage, targetLanguage, translatorEngine, translationMode }),

    // Benchmark CRUD (Phase 1.3)
    saveBenchmark: (params: { docId: number; pageNum: number; mode?: 'baseline' | 'improve'; key: string; payload: string }) =>
      safeInvoke('db:save-benchmark', params),
    getBenchmark: (params: { docId: number; pageNum: number; mode?: 'baseline' | 'improve'; key: string }) =>
      safeInvoke('db:get-benchmark', params),
    clearBenchmark: (params: { docId: number; pageNum: number; mode?: 'baseline' | 'improve'; key?: string }) =>
      safeInvoke('db:clear-benchmark', params),
    listBenchmarks: (params: { docId: number; pageNum: number; mode?: 'baseline' | 'improve' }) =>
      safeInvoke('db:list-benchmarks', params),

    // Document management
    getRecentDocuments: (limit?: number) =>
      safeInvoke('db:get-recent-documents', limit),
    getDocumentsByProject: (projectId: number | null) =>
      safeInvoke('db:get-documents-by-project', projectId),
    getFavoriteDocuments: () =>
      safeInvoke('db:get-favorite-documents'),
    searchDocuments: (query: string) =>
      safeInvoke('db:search-documents', query),
    updateDocument: (id: number, updates: DocumentUpdate) =>
      safeInvoke('db:update-document', { id, updates }),
    deleteDocument: (id: number) =>
      safeInvoke('db:delete-document', id),
    toggleFavorite: (id: number) =>
      safeInvoke('db:toggle-favorite', id),
    toggleThumbnailHidden: (id: number) =>
      safeInvoke('db:toggle-thumbnail-hidden', id),
    getDocumentCacheSize: (id: number) =>
      safeInvoke('db:get-document-cache-size', id),
    getDocumentsByTag: (tagId: number) =>
      safeInvoke('db:get-documents-by-tag', tagId),
    addDocumentTag: (documentId: number, tagId: number) =>
      safeInvoke('db:add-document-tag', { documentId, tagId }),
    removeDocumentTag: (documentId: number, tagId: number) =>
      safeInvoke('db:remove-document-tag', { documentId, tagId }),
    getDocumentTags: (documentId: number) =>
      safeInvoke('db:get-document-tags', documentId),
    touchDocument: (id: number) =>
      safeInvoke('db:touch-document', id),
    updateLastPage: (id: number, pageNum: number) =>
      safeInvoke('db:update-last-page', { id, pageNum }),
  },

  // Tag operations
  tags: {
    getAll: () => safeInvoke('db:get-all-tags'),
    create: (name: string, color?: string) =>
      safeInvoke('db:create-tag', { name, color }),
    update: (id: number, updates: { name?: string; color?: string }) =>
      safeInvoke('db:update-tag', { id, updates }),
    delete: (id: number) => safeInvoke('db:delete-tag', id),
  },

  // Project operations
  projects: {
    getAll: () => safeInvoke('db:get-all-projects'),
    getChildren: (parentId: number | null) =>
      safeInvoke('db:get-project-children', parentId),
    create: (project: ProjectCreate) =>
      safeInvoke('db:create-project', project),
    update: (id: number, updates: ProjectUpdate) =>
      safeInvoke('db:update-project', { id, updates }),
    delete: (id: number) => safeInvoke('db:delete-project', id),
    getStats: (projectId: number) => safeInvoke('db:get-project-stats', projectId),
  },

  // Glossary operations
  glossary: {
    getAll: () => safeInvoke('db:glossary-get-all'),
    save: (entry: {
      id?: number;
      sourceText: string;
      targetText: string;
      sourceLang?: string;
      targetLang?: string;
      type?: 'TERM' | 'SFX';
      isActive?: boolean | number;
    }) => safeInvoke('db:glossary-save', entry),
    delete: (id: number) => safeInvoke('db:glossary-delete', id),
    toggle: (id: number, isActive?: boolean) => safeInvoke('db:glossary-toggle', { id, isActive }),
    importBatch: (entries: Array<{
      sourceText: string;
      targetText: string;
      sourceLang?: string;
      targetLang?: string;
      type?: 'TERM' | 'SFX';
      isActive?: boolean;
    }>) => safeInvoke('db:glossary-import', entries),
  },

  // Gemini translation (SECURE: API key stays in main process)
  gemini: {
    getApiKeyStatus: () => safeInvoke('gemini:get-api-key-status'),
    setApiKey: (apiKey: string) =>
      safeInvoke('gemini:set-api-key', { apiKey }),
    clearApiKey: () => safeInvoke('gemini:clear-api-key'),
    translate: (text: string, context: {
      mode: 'adaptive' | 'manga' | 'manhwa' | 'official';
      sourceType: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      baseSystemPrompt?: string;
    }) =>
      safeInvoke('gemini:translate', { text, context }),
  },

  translate: {
    offline: (text: string, context?: {
      mode?: string;
      sourceType?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      timeoutMs?: number;
    }) => safeInvoke('translate:offline', { text, context }),
    offlineBatch: (texts: string[], context?: {
      mode?: string;
      sourceType?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      timeoutMs?: number;
    }) => safeInvoke('translate:offline-batch', { texts, context }),
  },

  // 🚀 Startup batch load (1 round-trip instead of 3+ separate IPC calls)
  startupLoad: () => safeInvoke('db:startup-load'),

  // 🚀 Batch OCR cache stats for multiple docIds in 1 call
  getOcrCacheStatsForDocumentIds: (documentIds: number[]) =>
    safeInvoke('db:get-ocr-cache-stats-for-document-ids', { documentIds }),

  // File system operations (SECURE: validated in main process)
  fs: {
    readFile: (filepath: string) => safeInvoke('fs:read-file', filepath),
    openFile: () => safeInvoke('fs:open-file'),
    importFile: (payload: { name: string; mimeType: string; data?: Uint8Array | ArrayBuffer; filePath?: string }) =>
      safeInvoke('fs:import-file', payload),
  },

  ocr: {
    getEngineStatus: () => safeInvoke('ocr:get-engine-status'),
    getGpuInfo: () => safeInvoke('ocr:get-gpu-info'),
    prewarmEngine: (payload: { engine: string; language?: string }) =>
      safeInvoke('ocr:prewarm-engine', payload),
    cancelExternal: (payload?: { engine?: string }) =>
      safeInvoke('ocr:cancel-external', payload),
    clearCudaCache: (payload: { engine: string }) =>
      safeInvoke('ocr:clear-cuda-cache', payload),
    /**
     * Write image bytes to a temp file on disk.
     * Returns { imagePath } — a string path to pass to runExternal.
     * Use this instead of embedding raw imageData in runExternal to eliminate
     * the IPC buffer serialization overhead that causes memory leaks.
     */
    writeTempImage: (payload: {
      imageData: Uint8Array | ArrayBuffer;
      imageMimeType: string;
    }) => safeInvoke<{ imagePath: string }>('ocr:write-temp-image', payload),
    deleteTempImage: (payload: {
      imagePath: string;
    }) => safeInvoke<{ ok: boolean }>('ocr:delete-temp-image', payload),
    runExternal: (payload: {
      engine: string;
      /** Preferred: absolute path to an already-written temp file (zero-copy IPC). */
      imagePath?: string;
      /** @deprecated Use writeTempImage() + imagePath to avoid buffer serialization. */
      imageData?: Uint8Array | ArrayBuffer;
      imageMimeType: string;
      imageWidth: number;
      imageHeight: number;
      language: string;
      dpi: number;
      pageSegMode?: number;
      pipelineProfile?: string;
      ocrQualityProfile?: string;
      /** PaddleOCR det_limit_side_len cap. Default 4800, max 6000. */
      maxSideLen?: number;
      chunkIndex?: number;
      totalChunks?: number;
    }) => safeInvoke('ocr:run-external', payload),
    runRawDirect: (payload: {
      /** Preferred: absolute path to an already-written temp file (zero-copy IPC). */
      imagePath?: string;
      /** @deprecated Use writeTempImage() + imagePath to avoid buffer serialization. */
      imageData?: Uint8Array | ArrayBuffer;
      imageMimeType: string;
      imageWidth: number;
      imageHeight: number;
      language: string;
    }) => safeInvoke('ocr:run-raw-direct', payload),
  },

  models: {
    getStatus: (payload: { engine: string; language: string }) =>
      safeInvoke('models:get-status', payload),
    download: (payload: { engine: string; language: string }) =>
      safeInvoke('models:download', payload),
  },

  pdfExport: {
    start: (job: unknown) =>
      safeInvoke<{ ok: boolean; bytes?: Uint8Array; error?: string }>('pdf-export:start', job).then((result) => {
        if (!result?.bytes) {
          return result;
        }
        const raw = result.bytes as Uint8Array | ArrayBuffer | { data?: number[] };
        if (raw instanceof Uint8Array) {
          return { ...result, bytes: raw };
        }
        if (raw instanceof ArrayBuffer) {
          return { ...result, bytes: new Uint8Array(raw) };
        }
        if (Array.isArray((raw as { data?: number[] }).data)) {
          return { ...result, bytes: Uint8Array.from((raw as { data: number[] }).data) };
        }
        return result;
      }),
    cancel: (jobId: string) => safeInvoke('pdf-export:cancel', { jobId }),
    onProgress: (callback: (payload: {
      jobId: string;
      done: number;
      total: number;
      progress: number;
    }) => void) => {
      const channel = 'pdf-export:progress' as AllowedReceiveChannel;
      if (!ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
        return () => {};
      }
      const subscription = (_event: Electron.IpcRendererEvent, payload: {
        jobId: string;
        done: number;
        total: number;
        progress: number;
      }) => callback(payload);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    },
  },

  auth: {
    checkStatus: () => safeInvoke<{ isSetup: boolean; mode: string }>('auth:check-status'),
    setup: (payload: { password: string; emergencyPin: string }) =>
      safeInvoke<{ success: boolean; error?: string }>('auth:setup', payload),
    login: (payload: { password: string }) =>
      safeInvoke<{ success: boolean; error?: string }>('auth:login', payload),
    autoLogin: () => safeInvoke<{ success: boolean; error?: string }>('auth:auto-login'),
    hardReset: (payload: { emergencyPin: string }) =>
      safeInvoke<{ success: boolean; error?: string }>('auth:hard-reset', payload),
    setMode: (payload: { mode: 'RELAX' | 'SECURITY'; password?: string }) =>
      safeInvoke<{ success: boolean; error?: string }>('auth:set-mode', payload),
  },

  power: {
    preventSleep: () => safeInvoke<number>('power:prevent-sleep'),
    allowSleep: () => safeInvoke<boolean>('power:allow-sleep'),
  },

  window: {
    toggleFullScreen: () => safeInvoke<boolean>('window:toggle-fullscreen'),
    isFullScreen: () => safeInvoke<boolean>('window:is-fullscreen'),
  },

  // Message handling (restricted to allowed channels)
  on: (channel: AllowedReceiveChannel, callback: (...args: unknown[]) => void) => {
    if (ALLOWED_RECEIVE_CHANNELS.includes(channel as AllowedReceiveChannel)) {
      const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    }
    console.warn(`[Preload] Blocked subscription to unauthorized channel: ${channel}`);
    return () => {};
  },
});
