import { OCRPageResult } from '../types';
import '../types/electron.d'; // Import type declarations

/**
 * Service to interact with the SQLite backend via IPC
 * Uses typed electronAPI for type-safe database operations
 */
export const dbService = {
  /**
   * Register or update a document in the database
   */
  async saveDocument(filepath: string, filename: string, totalPages: number): Promise<number> {
    try {
      // Prefer new typed API, fallback to legacy for compatibility
      if (window.electronAPI?.db) {
        return await window.electronAPI.db.saveDocument(filepath, filename, totalPages);
      }
      // Legacy fallback (will be deprecated)
      return await window.ipcRenderer.invoke('db:save-document', { filepath, filename, totalPages }) as number;
    } catch (error) {
      console.error('Failed to save document:', error);
      throw error;
    }
  },

  /**
   * Get a document's ID and metadata by filepath
   */
  async getDocument(filepath: string): Promise<{ id: number; total_pages: number } | null> {
    try {
      if (window.electronAPI?.db) {
        return await window.electronAPI.db.getDocument(filepath);
      }
      return await window.ipcRenderer.invoke('db:get-document', filepath) as { id: number; total_pages: number } | null;
    } catch (error) {
      console.error('Failed to get document:', error);
      return null;
    }
  },

  /**
   * Save OCR result for a specific page
   */
  async saveOCR(docId: number, pageNum: number, data: OCRPageResult): Promise<void> {
    try {
      if (window.electronAPI?.db) {
        await window.electronAPI.db.saveOCR(docId, pageNum, data);
        console.log(`[DB] Saved OCR for page ${pageNum}`);
        return;
      }
      await window.ipcRenderer.invoke('db:save-ocr', { docId, pageNum, data });
      console.log(`[DB] Saved OCR for page ${pageNum}`);
    } catch (error) {
      console.error('Failed to save OCR:', error);
    }
  },

  /**
   * Retrieve cached OCR result (returns null if not found)
   */
  async getOCR(docId: number, pageNum: number): Promise<OCRPageResult | null> {
    try {
      if (window.electronAPI?.db) {
        const data = await window.electronAPI.db.getOCR(docId, pageNum);
        if (data) {
          console.log(`[DB] cache hit for page ${pageNum}`);
          return data;
        }
        return null;
      }
      const data = await window.ipcRenderer.invoke('db:get-ocr', { docId, pageNum }) as OCRPageResult | null;
      if (data) {
        console.log(`[DB] cache hit for page ${pageNum}`);
        return data;
      }
      return null;
    } catch (error) {
      console.error('Failed to get OCR:', error);
      return null;
    }
  }
};

