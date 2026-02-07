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
    saveOCR: (docId, pageNum, data) => electron.ipcRenderer.invoke("db:save-ocr", { docId, pageNum, data }),
    getOCR: (docId, pageNum) => electron.ipcRenderer.invoke("db:get-ocr", { docId, pageNum }),
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
    translate: (text, context) => electron.ipcRenderer.invoke("gemini:translate", { text, context })
  },
  // File system operations (SECURE: validated in main process)
  fs: {
    readFile: (filepath) => electron.ipcRenderer.invoke("fs:read-file", filepath),
    openFile: () => electron.ipcRenderer.invoke("fs:open-file"),
    importFile: (payload) => electron.ipcRenderer.invoke("fs:import-file", payload)
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
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
  on(...args) {
    const [channel, listener] = args;
    return electron.ipcRenderer.on(channel, (event, ...args2) => listener(event, ...args2));
  },
  off(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.off(channel, ...omit);
  },
  send(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.send(channel, ...omit);
  },
  invoke(...args) {
    const [channel, ...omit] = args;
    return electron.ipcRenderer.invoke(channel, ...omit);
  }
});
