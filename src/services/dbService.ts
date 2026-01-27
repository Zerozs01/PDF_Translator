import { OCRPageResult } from '../types';

/**
 * Service to interact with the SQLite backend via IPC
 */
export const dbService = {
  /**
   * Register or update a document in the database
   */
  async saveDocument(filepath: string, filename: string, totalPages: number): Promise<number> {
    try {
      // @ts-ignore - ipcRenderer exposed via preload
      const id = await window.ipcRenderer.invoke('db:save-document', { filepath, filename, totalPages });
      return id;
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
      // @ts-ignore
      return await window.ipcRenderer.invoke('db:get-document', filepath);
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
      // @ts-ignore
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
      // @ts-ignore
      const data = await window.ipcRenderer.invoke('db:get-ocr', { docId, pageNum });
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
