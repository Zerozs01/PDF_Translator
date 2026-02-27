import { OCRPageResult } from '../types';
import type { DBDocumentCacheCandidate } from '../types/electron.d';
import '../types/electron.d'; // Import type declarations

type LooseDocumentRecord = {
  id: number;
  filepath: string;
  filename: string;
  total_pages?: number;
  last_accessed?: number | string | null;
};

const isDbAvailable = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.electronAPI?.db || window.ipcRenderer?.invoke);
};

const normalizeFilename = (value: string): string => value.trim().toLowerCase();

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * Service to interact with the SQLite backend via IPC
 * Uses typed electronAPI for type-safe database operations
 */
export const dbService = {
  isAvailable(): boolean {
    return isDbAvailable();
  },

  /**
   * Register or update a document in the database
   */
  async saveDocument(filepath: string, filename: string, totalPages: number): Promise<number> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] saveDocument skipped: DB not available');
        return 0;
      }
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
      if (!isDbAvailable()) {
        console.warn('[DB] getDocument skipped: DB not available');
        return null;
      }
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
   * Find candidate documents by filename, enriched with OCR cache stats.
   * Useful for deduplicating source-path vs imported-path records.
   */
  async findDocumentsByFilename(filename: string): Promise<DBDocumentCacheCandidate[]> {
    if (!isDbAvailable()) {
      console.warn('[DB] findDocumentsByFilename skipped: DB not available');
      return [];
    }

    const target = normalizeFilename(filename);

    const normalizeAndSort = (rows: DBDocumentCacheCandidate[]): DBDocumentCacheCandidate[] => {
      return rows
        .map((row) => ({
          id: row.id,
          filepath: row.filepath,
          filename: row.filename,
          total_pages: toNumberOrNull(row.total_pages) ?? 0,
          last_accessed: toNumberOrNull(row.last_accessed),
          cache_pages: toNumberOrNull(row.cache_pages) ?? 0,
          last_cache_update: toNumberOrNull(row.last_cache_update)
        }))
        .sort((a, b) => {
          if (b.cache_pages !== a.cache_pages) return b.cache_pages - a.cache_pages;
          const aCacheTime = a.last_cache_update ?? 0;
          const bCacheTime = b.last_cache_update ?? 0;
          if (bCacheTime !== aCacheTime) return bCacheTime - aCacheTime;
          return (b.last_accessed ?? 0) - (a.last_accessed ?? 0);
        });
    };

    // Preferred path: dedicated main-process query.
    try {
      if (window.electronAPI?.db?.findDocumentsByFilename) {
        const rows = await window.electronAPI.db.findDocumentsByFilename(filename);
        if (Array.isArray(rows) && rows.length > 0) {
          return normalizeAndSort(rows);
        }
      }
      const data = await window.ipcRenderer.invoke('db:find-documents-by-filename', filename) as DBDocumentCacheCandidate[] | null;
      if (Array.isArray(data) && data.length > 0) {
        return normalizeAndSort(data);
      }
    } catch (error) {
      console.warn('[DB] findDocumentsByFilename primary query failed, using fallback:', error);
    }

    // Fallback path: build candidates from existing channels so cache aliasing still works
    // even if main/preload has not picked up the new handler yet.
    try {
      const merged = new Map<number, LooseDocumentRecord>();
      const pushDocs = (docs: LooseDocumentRecord[] | null | undefined) => {
        if (!Array.isArray(docs)) return;
        for (const doc of docs) {
          if (!doc || typeof doc.id !== 'number' || !doc.filepath || !doc.filename) continue;
          if (!merged.has(doc.id)) merged.set(doc.id, doc);
        }
      };

      if (window.electronAPI?.db?.getRecentDocuments) {
        const recent = await window.electronAPI.db.getRecentDocuments(500) as unknown as LooseDocumentRecord[];
        pushDocs(recent);
      }
      if (window.electronAPI?.db?.searchDocuments) {
        const searched = await window.electronAPI.db.searchDocuments(filename) as unknown as LooseDocumentRecord[];
        pushDocs(searched);
      }

      // Legacy IPC fallback
      if (merged.size === 0 && window.ipcRenderer?.invoke) {
        try {
          const recentLegacy = await window.ipcRenderer.invoke('db:get-recent-documents', 500) as LooseDocumentRecord[] | null;
          pushDocs(recentLegacy ?? []);
        } catch {
          // ignore
        }
        try {
          const searchLegacy = await window.ipcRenderer.invoke('db:search-documents', filename) as LooseDocumentRecord[] | null;
          pushDocs(searchLegacy ?? []);
        } catch {
          // ignore
        }
      }

      const candidates = Array.from(merged.values())
        .filter((doc) => normalizeFilename(doc.filename) === target);

      if (candidates.length === 0) return [];

      const enriched = await Promise.all(
        candidates.map(async (doc): Promise<DBDocumentCacheCandidate> => {
          const latest = await dbService.getLatestOCR(doc.id);
          return {
            id: doc.id,
            filepath: doc.filepath,
            filename: doc.filename,
            total_pages: toNumberOrNull(doc.total_pages) ?? 0,
            last_accessed: toNumberOrNull(doc.last_accessed),
            cache_pages: latest ? 1 : 0,
            last_cache_update: latest?.updated_at ?? null
          };
        })
      );

      return normalizeAndSort(enriched);
    } catch (error) {
      console.error('Failed to find documents by filename (fallback):', error);
      return [];
    }
  },

  /**
   * Save OCR result for a specific page
   */
  async saveOCR(docId: number, pageNum: number, data: OCRPageResult): Promise<boolean> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] saveOCR skipped: DB not available');
        return false;
      }
      if (window.electronAPI?.db) {
        const ok = await window.electronAPI.db.saveOCR(docId, pageNum, data);
        if (!ok) {
          console.warn(`[DB] saveOCR returned false for page ${pageNum} (docId=${docId})`);
          return false;
        }
        console.log(`[DB] Saved OCR for page ${pageNum} (docId=${docId})`);
        return true;
      }
      const ok = await window.ipcRenderer.invoke('db:save-ocr', { docId, pageNum, data }) as boolean;
      if (!ok) {
        console.warn(`[DB] saveOCR returned false for page ${pageNum} (docId=${docId})`);
        return false;
      }
      console.log(`[DB] Saved OCR for page ${pageNum} (docId=${docId})`);
      return true;
    } catch (error) {
      console.error('Failed to save OCR:', error);
      return false;
    }
  },

  /**
   * Retrieve cached OCR result (returns null if not found)
   */
  async getOCR(docId: number, pageNum: number): Promise<OCRPageResult | null> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] getOCR skipped: DB not available');
        return null;
      }
      if (window.electronAPI?.db) {
        const data = await window.electronAPI.db.getOCR(docId, pageNum);
        if (data) {
          console.log(`[DB] cache hit for page ${pageNum}`);
          return data;
        }
        console.log(`[DB] cache miss for page ${pageNum} (docId=${docId})`);
        return null;
      }
      const data = await window.ipcRenderer.invoke('db:get-ocr', { docId, pageNum }) as OCRPageResult | null;
      if (data) {
        console.log(`[DB] cache hit for page ${pageNum}`);
        return data;
      }
      console.log(`[DB] cache miss for page ${pageNum} (docId=${docId})`);
      return null;
    } catch (error) {
      console.error('Failed to get OCR:', error);
      return null;
    }
  },

  /**
   * Retrieve latest OCR payload for a document (most recent page update)
   */
  async getLatestOCR(docId: number): Promise<{
    page_number: number;
    updated_at: number;
    ocr_data: OCRPageResult;
  } | null> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] getLatestOCR skipped: DB not available');
        return null;
      }
      if (window.electronAPI?.db?.getLatestOCR) {
        return await window.electronAPI.db.getLatestOCR(docId);
      }
      const data = await window.ipcRenderer.invoke('db:get-latest-ocr', { docId }) as {
        page_number: number;
        updated_at: number;
        ocr_data: OCRPageResult;
      } | null;
      return data;
    } catch (error) {
      console.error('Failed to get latest OCR:', error);
      return null;
    }
  }
};

