"use strict";
const electron = require("electron");
const ALLOWED_RECEIVE_CHANNELS = [
  "main-process-message"
];
electron.contextBridge.exposeInMainWorld("electronAPI", {
  // Database operations (validated channels only)
  db: {
    saveDocument: (filepath, filename, totalPages) => electron.ipcRenderer.invoke("db:save-document", { filepath, filename, totalPages }),
    getDocument: (filepath) => electron.ipcRenderer.invoke("db:get-document", filepath),
    saveOCR: (docId, pageNum, data) => electron.ipcRenderer.invoke("db:save-ocr", { docId, pageNum, data }),
    getOCR: (docId, pageNum) => electron.ipcRenderer.invoke("db:get-ocr", { docId, pageNum })
  },
  // Gemini translation (SECURE: API key stays in main process)
  gemini: {
    translate: (text, context) => electron.ipcRenderer.invoke("gemini:translate", { text, context })
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
