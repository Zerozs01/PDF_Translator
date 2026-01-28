import { ipcRenderer, contextBridge } from 'electron'

// --------- SECURITY: Whitelist-based API Exposure ---------
// Only expose specific, validated functions to the renderer process

// Allowed IPC channels (whitelist)
const ALLOWED_INVOKE_CHANNELS = [
  'db:save-document',
  'db:get-document',
  'db:save-ocr',
  'db:get-ocr',
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

contextBridge.exposeInMainWorld('electronAPI', {
  // Database operations (validated channels only)
  db: {
    saveDocument: (filepath: string, filename: string, totalPages: number) =>
      ipcRenderer.invoke('db:save-document', { filepath, filename, totalPages }),
    getDocument: (filepath: string) =>
      ipcRenderer.invoke('db:get-document', filepath),
    saveOCR: (docId: number, pageNum: number, data: unknown) =>
      ipcRenderer.invoke('db:save-ocr', { docId, pageNum, data }),
    getOCR: (docId: number, pageNum: number) =>
      ipcRenderer.invoke('db:get-ocr', { docId, pageNum }),
  },

  // Gemini translation (SECURE: API key stays in main process)
  gemini: {
    translate: (text: string, context: { mode: string; sourceType: string }) =>
      ipcRenderer.invoke('gemini:translate', { text, context }),
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

