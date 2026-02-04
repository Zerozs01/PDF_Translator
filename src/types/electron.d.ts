/**
 * Type declarations for Electron APIs exposed via preload script
 */

import { OCRPageResult } from './index';

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

// Update types
export interface DocumentUpdate {
  filename?: string;
  project_id?: number | null;
  thumbnail_path?: string;
  is_favorite?: boolean;
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

// Electron API interface (secure whitelist-based)
export interface ElectronAPI {
  db: {
    // Basic operations
    saveDocument: (filepath: string, filename: string, totalPages: number) => Promise<number>;
    getDocument: (filepath: string) => Promise<{ id: number; total_pages: number } | null>;
    saveOCR: (docId: number, pageNum: number, data: OCRPageResult) => Promise<boolean>;
    getOCR: (docId: number, pageNum: number) => Promise<OCRPageResult | null>;
    
    // Document management
    getRecentDocuments: (limit?: number) => Promise<DBDocument[]>;
    getDocumentsByProject: (projectId: number | null) => Promise<DBDocument[]>;
    getFavoriteDocuments: () => Promise<DBDocument[]>;
    searchDocuments: (query: string) => Promise<DBDocument[]>;
    updateDocument: (id: number, updates: DocumentUpdate) => Promise<boolean>;
    deleteDocument: (id: number) => Promise<boolean>;
    toggleFavorite: (id: number) => Promise<boolean>;
    getDocumentsByTag: (tagId: number) => Promise<DBDocument[]>;
    addDocumentTag: (documentId: number, tagId: number) => Promise<boolean>;
    removeDocumentTag: (documentId: number, tagId: number) => Promise<boolean>;
    getDocumentTags: (documentId: number) => Promise<DBTag[]>;
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
    translate: (text: string, context: { mode: string; sourceType: string }) => Promise<string>;
  };
  
  fs: {
    readFile: (filepath: string) => Promise<{
      data: string;
      mimeType: string;
      size: number;
      name: string;
    }>;
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
