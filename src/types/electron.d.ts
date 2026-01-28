/**
 * Type declarations for Electron APIs exposed via preload script
 */

import { OCRPageResult } from './index';

// Electron API interface (secure whitelist-based)
export interface ElectronAPI {
  db: {
    saveDocument: (filepath: string, filename: string, totalPages: number) => Promise<number>;
    getDocument: (filepath: string) => Promise<{ id: number; total_pages: number } | null>;
    saveOCR: (docId: number, pageNum: number, data: OCRPageResult) => Promise<boolean>;
    getOCR: (docId: number, pageNum: number) => Promise<OCRPageResult | null>;
  };
  gemini: {
    translate: (text: string, context: { mode: string; sourceType: string }) => Promise<string>;
  };
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void;
}

// Legacy IPC interface (for backward compatibility, will be deprecated)
export interface LegacyIpcRenderer {
  on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
  off: (channel: string, listener?: (...args: unknown[]) => void) => void;
  send: (channel: string, ...args: unknown[]) => void;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

// Extend Window interface
declare global {
  interface Window {
    electronAPI: ElectronAPI;
    ipcRenderer: LegacyIpcRenderer;
  }
}

export {};
