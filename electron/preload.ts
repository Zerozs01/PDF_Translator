import { ipcRenderer, contextBridge } from 'electron'

// --------- SECURITY: Whitelist-based API Exposure ---------
// Only expose specific, validated functions to the renderer process

// Allowed IPC channels (whitelist)
const ALLOWED_INVOKE_CHANNELS = [
  'db:save-document',
  'db:get-document',
  'db:find-documents-by-filename',
  'db:save-ocr',
  'db:get-ocr',
  'db:get-latest-ocr',
  // Document management
  'db:get-recent-documents',
  'db:get-documents-by-project',
  'db:get-favorite-documents',
  'db:search-documents',
  'db:update-document',
  'db:delete-document',
  'db:toggle-favorite',
  'db:get-documents-by-tag',
  'db:add-document-tag',
  'db:remove-document-tag',
  'db:get-document-tags',
  'db:update-last-page',
  // Tag management
  'db:get-all-tags',
  'db:create-tag',
  'db:delete-tag',
  // Project management
  'db:get-all-projects',
  'db:get-project-children',
  'db:create-project',
  'db:update-project',
  'db:delete-project',
  // File system
  'fs:read-file',
  'fs:open-file',
  'gemini:translate', // For secure Gemini API calls via main process
] as const;

const ALLOWED_SEND_CHANNELS = [
  'main-process-message',
] as const;

const ALLOWED_RECEIVE_CHANNELS = [
  'main-process-message',
] as const;

type AllowedInvokeChannel = typeof ALLOWED_INVOKE_CHANNELS[number];
type AllowedSendChannel = typeof ALLOWED_SEND_CHANNELS[number];
type AllowedReceiveChannel = typeof ALLOWED_RECEIVE_CHANNELS[number];

// Type definitions
interface DocumentUpdate {
  filename?: string;
  project_id?: number | null;
  thumbnail_path?: string;
  is_favorite?: boolean;
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
      ipcRenderer.invoke('db:save-document', { filepath, filename, totalPages }),
    getDocument: (filepath: string) =>
      ipcRenderer.invoke('db:get-document', filepath),
    findDocumentsByFilename: (filename: string) =>
      ipcRenderer.invoke('db:find-documents-by-filename', filename),
    saveOCR: (docId: number, pageNum: number, data: unknown) =>
      ipcRenderer.invoke('db:save-ocr', { docId, pageNum, data }),
    getOCR: (docId: number, pageNum: number) =>
      ipcRenderer.invoke('db:get-ocr', { docId, pageNum }),
    getLatestOCR: (docId: number) =>
      ipcRenderer.invoke('db:get-latest-ocr', { docId }),
    
    // Document management
    getRecentDocuments: (limit?: number) =>
      ipcRenderer.invoke('db:get-recent-documents', limit),
    getDocumentsByProject: (projectId: number | null) =>
      ipcRenderer.invoke('db:get-documents-by-project', projectId),
    getFavoriteDocuments: () =>
      ipcRenderer.invoke('db:get-favorite-documents'),
    searchDocuments: (query: string) =>
      ipcRenderer.invoke('db:search-documents', query),
    updateDocument: (id: number, updates: DocumentUpdate) =>
      ipcRenderer.invoke('db:update-document', { id, updates }),
    deleteDocument: (id: number) =>
      ipcRenderer.invoke('db:delete-document', id),
    toggleFavorite: (id: number) =>
      ipcRenderer.invoke('db:toggle-favorite', id),
    getDocumentsByTag: (tagId: number) =>
      ipcRenderer.invoke('db:get-documents-by-tag', tagId),
    addDocumentTag: (documentId: number, tagId: number) =>
      ipcRenderer.invoke('db:add-document-tag', { documentId, tagId }),
    removeDocumentTag: (documentId: number, tagId: number) =>
      ipcRenderer.invoke('db:remove-document-tag', { documentId, tagId }),
    getDocumentTags: (documentId: number) =>
      ipcRenderer.invoke('db:get-document-tags', documentId),
    updateLastPage: (id: number, pageNum: number) =>
      ipcRenderer.invoke('db:update-last-page', { id, pageNum }),
  },

  // Tag operations
  tags: {
    getAll: () => ipcRenderer.invoke('db:get-all-tags'),
    create: (name: string, color?: string) =>
      ipcRenderer.invoke('db:create-tag', { name, color }),
    delete: (id: number) => ipcRenderer.invoke('db:delete-tag', id),
  },

  // Project operations
  projects: {
    getAll: () => ipcRenderer.invoke('db:get-all-projects'),
    getChildren: (parentId: number | null) =>
      ipcRenderer.invoke('db:get-project-children', parentId),
    create: (project: ProjectCreate) =>
      ipcRenderer.invoke('db:create-project', project),
    update: (id: number, updates: ProjectUpdate) =>
      ipcRenderer.invoke('db:update-project', { id, updates }),
    delete: (id: number) => ipcRenderer.invoke('db:delete-project', id),
  },

  // Gemini translation (SECURE: API key stays in main process)
  gemini: {
    translate: (text: string, context: { mode: string; sourceType: string }) =>
      ipcRenderer.invoke('gemini:translate', { text, context }),
  },

  // File system operations (SECURE: validated in main process)
  fs: {
    readFile: (filepath: string) => ipcRenderer.invoke('fs:read-file', filepath),
    openFile: () => ipcRenderer.invoke('fs:open-file'),
    importFile: (payload: { name: string; mimeType: string; data: Uint8Array | ArrayBuffer }) =>
      ipcRenderer.invoke('fs:import-file', payload),
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

// Legacy support: Keep ipcRenderer for backward compatibility during migration
// TODO: Remove this after migrating all code to use electronAPI
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

