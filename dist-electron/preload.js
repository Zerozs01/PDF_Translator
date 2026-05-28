"use strict";
const electron = require("electron");
const ALLOWED_RECEIVE_CHANNELS = [
  "main-process-message"
];
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // Document operations (validated channels only)
  db: {
    // Basic operations
    saveDocument: (filepath, filename, totalPages) => electron.ipcRenderer.invoke("db:save-document", { filepath, filename, totalPages }),
    getDocument: (filepath) => electron.ipcRenderer.invoke("db:get-document", filepath),
    findDocumentsByFilename: (filename) => electron.ipcRenderer.invoke("db:find-documents-by-filename", filename),
    saveOCR: (docId, pageNum, data, engine) => electron.ipcRenderer.invoke("db:save-ocr", { docId, pageNum, data, engine }),
    getOCR: (docId, pageNum, engine) => electron.ipcRenderer.invoke("db:get-ocr", { docId, pageNum, engine }),
    clearOCR: (docId, pageNum, engine) => electron.ipcRenderer.invoke("db:clear-ocr", { docId, pageNum, engine }),
    getLatestOCR: (docId) => electron.ipcRenderer.invoke("db:get-latest-ocr", { docId }),
    getOcrCacheStatsForDocumentIds: (documentIds) => electron.ipcRenderer.invoke("db:get-ocr-cache-stats-for-document-ids", { documentIds }),
    saveTranslationCache: (docId, pageNum, cacheKey, entry) => electron.ipcRenderer.invoke("db:save-translation-cache", { docId, pageNum, cacheKey, entry }),
    getTranslationCachePage: (docId, pageNum) => electron.ipcRenderer.invoke("db:get-translation-cache-page", { docId, pageNum }),
    clearTranslationCacheByEngine: (docId, pageNum, engine) => electron.ipcRenderer.invoke("db:clear-translation-cache-by-engine", { docId, pageNum, engine }),
    // Benchmark CRUD (Phase 1.3)
    saveBenchmark: (params) => electron.ipcRenderer.invoke("db:save-benchmark", params),
    getBenchmark: (params) => electron.ipcRenderer.invoke("db:get-benchmark", params),
    clearBenchmark: (params) => electron.ipcRenderer.invoke("db:clear-benchmark", params),
    listBenchmarks: (params) => electron.ipcRenderer.invoke("db:list-benchmarks", params),
    // Document management
    getRecentDocuments: (limit) => electron.ipcRenderer.invoke("db:get-recent-documents", limit),
    getDocumentsByProject: (projectId) => electron.ipcRenderer.invoke("db:get-documents-by-project", projectId),
    getFavoriteDocuments: () => electron.ipcRenderer.invoke("db:get-favorite-documents"),
    searchDocuments: (query) => electron.ipcRenderer.invoke("db:search-documents", query),
    updateDocument: (id, updates) => electron.ipcRenderer.invoke("db:update-document", { id, updates }),
    deleteDocument: (id) => electron.ipcRenderer.invoke("db:delete-document", id),
    toggleFavorite: (id) => electron.ipcRenderer.invoke("db:toggle-favorite", id),
    getDocumentsByTag: (tagId) => electron.ipcRenderer.invoke("db:get-documents-by-tag", tagId),
    addDocumentTag: (documentId, tagId) => electron.ipcRenderer.invoke("db:add-document-tag", { documentId, tagId }),
    removeDocumentTag: (documentId, tagId) => electron.ipcRenderer.invoke("db:remove-document-tag", { documentId, tagId }),
    getDocumentTags: (documentId) => electron.ipcRenderer.invoke("db:get-document-tags", documentId),
    touchDocument: (id) => electron.ipcRenderer.invoke("db:touch-document", id),
    updateLastPage: (id, pageNum) => electron.ipcRenderer.invoke("db:update-last-page", { id, pageNum })
  },
  // Tag operations
  tags: {
    getAll: () => electron.ipcRenderer.invoke("db:get-all-tags"),
    create: (name, color) => electron.ipcRenderer.invoke("db:create-tag", { name, color }),
    delete: (id) => electron.ipcRenderer.invoke("db:delete-tag", id)
  },
  // Project operations
  projects: {
    getAll: () => electron.ipcRenderer.invoke("db:get-all-projects"),
    getChildren: (parentId) => electron.ipcRenderer.invoke("db:get-project-children", parentId),
    create: (project) => electron.ipcRenderer.invoke("db:create-project", project),
    update: (id, updates) => electron.ipcRenderer.invoke("db:update-project", { id, updates }),
    delete: (id) => electron.ipcRenderer.invoke("db:delete-project", id)
  },
  // Gemini translation (SECURE: API key stays in main process)
  gemini: {
    getApiKeyStatus: () => electron.ipcRenderer.invoke("gemini:get-api-key-status"),
    setApiKey: (apiKey) => electron.ipcRenderer.invoke("gemini:set-api-key", { apiKey }),
    clearApiKey: () => electron.ipcRenderer.invoke("gemini:clear-api-key"),
    translate: (text, context) => electron.ipcRenderer.invoke("gemini:translate", { text, context })
  },
  translate: {
    offline: (text, context) => electron.ipcRenderer.invoke("translate:offline", { text, context }),
    offlineBatch: (texts, context) => electron.ipcRenderer.invoke("translate:offline-batch", { texts, context })
  },
  // 🚀 Startup batch load (1 round-trip instead of 3+ separate IPC calls)
  startupLoad: () => electron.ipcRenderer.invoke("db:startup-load"),
  // 🚀 Batch OCR cache stats for multiple docIds in 1 call
  getOcrCacheStatsForDocumentIds: (documentIds) => electron.ipcRenderer.invoke("db:get-ocr-cache-stats-for-document-ids", { documentIds }),
  // File system operations (SECURE: validated in main process)
  fs: {
    readFile: (filepath) => electron.ipcRenderer.invoke("fs:read-file", filepath),
    openFile: () => electron.ipcRenderer.invoke("fs:open-file"),
    importFile: (payload) => electron.ipcRenderer.invoke("fs:import-file", payload)
  },
  ocr: {
    getEngineStatus: () => electron.ipcRenderer.invoke("ocr:get-engine-status"),
    prewarmEngine: (payload) => electron.ipcRenderer.invoke("ocr:prewarm-engine", payload),
    cancelExternal: (payload) => electron.ipcRenderer.invoke("ocr:cancel-external", payload),
    runExternal: (payload) => electron.ipcRenderer.invoke("ocr:run-external", payload)
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
