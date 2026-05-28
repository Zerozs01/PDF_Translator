"use strict";
const electron = require("electron");
const ALLOWED_INVOKE_CHANNELS = [
  "db:save-document",
  "db:get-document",
  "db:find-documents-by-filename",
  "db:save-ocr",
  "db:get-ocr",
  "db:clear-ocr",
  "db:get-latest-ocr",
  "db:get-ocr-cache-stats-for-document-ids",
  "db:save-translation-cache",
  "db:get-translation-cache-page",
  "db:clear-translation-cache-by-engine",
  "db:save-sentence-translation",
  "db:get-sentence-translation",
  "db:save-benchmark",
  "db:get-benchmark",
  "db:clear-benchmark",
  "db:list-benchmarks",
  // Document management
  "db:get-recent-documents",
  "db:get-documents-by-project",
  "db:get-favorite-documents",
  "db:search-documents",
  "db:update-document",
  "db:delete-document",
  "db:toggle-favorite",
  "db:get-documents-by-tag",
  "db:add-document-tag",
  "db:remove-document-tag",
  "db:get-document-tags",
  "db:touch-document",
  "db:update-last-page",
  // Tag management
  "db:get-all-tags",
  "db:create-tag",
  "db:delete-tag",
  // Project management
  "db:get-all-projects",
  "db:get-project-children",
  "db:create-project",
  "db:update-project",
  "db:delete-project",
  // File system
  "fs:read-file",
  "fs:open-file",
  "fs:import-file",
  // OCR
  "ocr:get-engine-status",
  "ocr:prewarm-engine",
  "ocr:run-external",
  "ocr:cancel-external",
  // Gemini
  "gemini:get-api-key-status",
  "gemini:set-api-key",
  "gemini:clear-api-key",
  "gemini:translate",
  // For secure Gemini API calls via main process
  // Offline translation
  "translate:offline",
  "translate:offline-batch",
  // Startup
  "db:startup-load",
  // Model Management
  "models:get-status",
  "models:download"
];
const ALLOWED_RECEIVE_CHANNELS = [
  "main-process-message"
];
const safeInvoke = (channel, ...args) => {
  if (!ALLOWED_INVOKE_CHANNELS.includes(channel)) {
    throw new Error(`[Preload Security Exception] Blocked invoke on unauthorized channel: ${channel}`);
  }
  return electron.ipcRenderer.invoke(channel, ...args);
};
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // Document operations (validated channels only)
  db: {
    // Basic operations
    saveDocument: (filepath, filename, totalPages) => safeInvoke("db:save-document", { filepath, filename, totalPages }),
    getDocument: (filepath) => safeInvoke("db:get-document", filepath),
    findDocumentsByFilename: (filename) => safeInvoke("db:find-documents-by-filename", filename),
    saveOCR: (docId, pageNum, data, engine) => safeInvoke("db:save-ocr", { docId, pageNum, data, engine }),
    getOCR: (docId, pageNum, engine) => safeInvoke("db:get-ocr", { docId, pageNum, engine }),
    clearOCR: (docId, pageNum, engine) => safeInvoke("db:clear-ocr", { docId, pageNum, engine }),
    getLatestOCR: (docId) => safeInvoke("db:get-latest-ocr", { docId }),
    getOcrCacheStatsForDocumentIds: (documentIds) => safeInvoke("db:get-ocr-cache-stats-for-document-ids", { documentIds }),
    saveTranslationCache: (docId, pageNum, cacheKey, entry) => safeInvoke("db:save-translation-cache", { docId, pageNum, cacheKey, entry }),
    getTranslationCachePage: (docId, pageNum) => safeInvoke("db:get-translation-cache-page", { docId, pageNum }),
    clearTranslationCacheByEngine: (docId, pageNum, engine) => safeInvoke("db:clear-translation-cache-by-engine", { docId, pageNum, engine }),
    saveSentenceTranslation: (sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode, translatedText) => safeInvoke("db:save-sentence-translation", { sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode, translatedText }),
    getSentenceTranslation: (sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode) => safeInvoke("db:get-sentence-translation", { sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode }),
    // Benchmark CRUD (Phase 1.3)
    saveBenchmark: (params) => safeInvoke("db:save-benchmark", params),
    getBenchmark: (params) => safeInvoke("db:get-benchmark", params),
    clearBenchmark: (params) => safeInvoke("db:clear-benchmark", params),
    listBenchmarks: (params) => safeInvoke("db:list-benchmarks", params),
    // Document management
    getRecentDocuments: (limit) => safeInvoke("db:get-recent-documents", limit),
    getDocumentsByProject: (projectId) => safeInvoke("db:get-documents-by-project", projectId),
    getFavoriteDocuments: () => safeInvoke("db:get-favorite-documents"),
    searchDocuments: (query) => safeInvoke("db:search-documents", query),
    updateDocument: (id, updates) => safeInvoke("db:update-document", { id, updates }),
    deleteDocument: (id) => safeInvoke("db:delete-document", id),
    toggleFavorite: (id) => safeInvoke("db:toggle-favorite", id),
    getDocumentsByTag: (tagId) => safeInvoke("db:get-documents-by-tag", tagId),
    addDocumentTag: (documentId, tagId) => safeInvoke("db:add-document-tag", { documentId, tagId }),
    removeDocumentTag: (documentId, tagId) => safeInvoke("db:remove-document-tag", { documentId, tagId }),
    getDocumentTags: (documentId) => safeInvoke("db:get-document-tags", documentId),
    touchDocument: (id) => safeInvoke("db:touch-document", id),
    updateLastPage: (id, pageNum) => safeInvoke("db:update-last-page", { id, pageNum })
  },
  // Tag operations
  tags: {
    getAll: () => safeInvoke("db:get-all-tags"),
    create: (name, color) => safeInvoke("db:create-tag", { name, color }),
    delete: (id) => safeInvoke("db:delete-tag", id)
  },
  // Project operations
  projects: {
    getAll: () => safeInvoke("db:get-all-projects"),
    getChildren: (parentId) => safeInvoke("db:get-project-children", parentId),
    create: (project) => safeInvoke("db:create-project", project),
    update: (id, updates) => safeInvoke("db:update-project", { id, updates }),
    delete: (id) => safeInvoke("db:delete-project", id)
  },
  // Gemini translation (SECURE: API key stays in main process)
  gemini: {
    getApiKeyStatus: () => safeInvoke("gemini:get-api-key-status"),
    setApiKey: (apiKey) => safeInvoke("gemini:set-api-key", { apiKey }),
    clearApiKey: () => safeInvoke("gemini:clear-api-key"),
    translate: (text, context) => safeInvoke("gemini:translate", { text, context })
  },
  translate: {
    offline: (text, context) => safeInvoke("translate:offline", { text, context }),
    offlineBatch: (texts, context) => safeInvoke("translate:offline-batch", { texts, context })
  },
  // 🚀 Startup batch load (1 round-trip instead of 3+ separate IPC calls)
  startupLoad: () => safeInvoke("db:startup-load"),
  // 🚀 Batch OCR cache stats for multiple docIds in 1 call
  getOcrCacheStatsForDocumentIds: (documentIds) => safeInvoke("db:get-ocr-cache-stats-for-document-ids", { documentIds }),
  // File system operations (SECURE: validated in main process)
  fs: {
    readFile: (filepath) => safeInvoke("fs:read-file", filepath),
    openFile: () => safeInvoke("fs:open-file"),
    importFile: (payload) => safeInvoke("fs:import-file", payload)
  },
  ocr: {
    getEngineStatus: () => safeInvoke("ocr:get-engine-status"),
    prewarmEngine: (payload) => safeInvoke("ocr:prewarm-engine", payload),
    cancelExternal: (payload) => safeInvoke("ocr:cancel-external", payload),
    runExternal: (payload) => safeInvoke("ocr:run-external", payload)
  },
  models: {
    getStatus: (payload) => safeInvoke("models:get-status", payload),
    download: (payload) => safeInvoke("models:download", payload)
  },
  // Message handling (restricted to allowed channels)
  on: (channel, callback) => {
    if (ALLOWED_RECEIVE_CHANNELS.includes(channel)) {
      const subscription = (_event, ...args) => callback(...args);
      electron.ipcRenderer.on(channel, subscription);
      return () => electron.ipcRenderer.removeListener(channel, subscription);
    }
    console.warn(`[Preload] Blocked subscription to unauthorized channel: ${channel}`);
    return () => {
    };
  }
});
