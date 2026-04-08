import { OCREngine, OCRPageResult } from '../types';
import type {
  DBDocumentCacheCandidate,
  DBOCRTranslationCacheEntry,
  DBOcrCacheStatsRow,
  DocumentUpdate,
} from '../types/electron.d';
import '../types/electron.d'; // Import type declarations

function isDbVerboseLoggingEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem('pdfTranslator.debugDb') === '1';
  } catch {
    return false;
  }
}

function dbLog(...args: unknown[]): void {
  if (isDbVerboseLoggingEnabled()) {
    console.log(...args);
  }
}

type LooseDocumentRecord = {
  id: number;
  filepath: string;
  filename: string;
  total_pages?: number;
  last_accessed?: number | string | null;
};

const isDbAvailable = (): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(window.electronAPI?.db);
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
      return await window.electronAPI.db.saveDocument(filepath, filename, totalPages);
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
      return await window.electronAPI.db.getDocument(filepath);
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

    try {
      const rows = await window.electronAPI.db.findDocumentsByFilename(filename);
      if (Array.isArray(rows) && rows.length > 0) {
        return normalizeAndSort(rows);
      }
    } catch (error) {
      console.warn('[DB] findDocumentsByFilename primary query failed, using fallback:', error);
    }

    // Fallback path: build candidates from existing typed channels so cache aliasing
    // still works even if the dedicated lookup query is unavailable.
    try {
      const merged = new Map<number, LooseDocumentRecord>();
      const pushDocs = (docs: LooseDocumentRecord[] | null | undefined) => {
        if (!Array.isArray(docs)) return;
        for (const doc of docs) {
          if (!doc || typeof doc.id !== 'number' || !doc.filepath || !doc.filename) continue;
          if (!merged.has(doc.id)) merged.set(doc.id, doc);
        }
      };

      const recent = await window.electronAPI.db.getRecentDocuments(500) as unknown as LooseDocumentRecord[];
      pushDocs(recent);
      const searched = await window.electronAPI.db.searchDocuments(filename) as unknown as LooseDocumentRecord[];
      pushDocs(searched);

      const candidates = Array.from(merged.values())
        .filter((doc) => normalizeFilename(doc.filename) === target);

      if (candidates.length === 0) return [];

      const ids = candidates.map((doc) => doc.id);
      const batchStats = window.electronAPI.db.getOcrCacheStatsForDocumentIds;
      let statsById = new Map<number, DBOcrCacheStatsRow>();

      if (typeof batchStats === 'function') {
        const statsRows = (await batchStats(ids)) as DBOcrCacheStatsRow[];
        if (Array.isArray(statsRows)) {
          statsById = new Map(statsRows.map((row) => [row.document_id, row]));
        }
      } else {
        const legacy = await Promise.all(
          candidates.map(async (doc): Promise<DBDocumentCacheCandidate> => {
            const latest = await dbService.getLatestOCR(doc.id);
            return {
              id: doc.id,
              filepath: doc.filepath,
              filename: doc.filename,
              total_pages: toNumberOrNull(doc.total_pages) ?? 0,
              last_accessed: toNumberOrNull(doc.last_accessed),
              cache_pages: latest ? 1 : 0,
              last_cache_update: latest?.updated_at ?? null,
            };
          })
        );
        return normalizeAndSort(legacy);
      }

      const enriched: DBDocumentCacheCandidate[] = candidates.map((doc) => {
        const row = statsById.get(doc.id);
        return {
          id: doc.id,
          filepath: doc.filepath,
          filename: doc.filename,
          total_pages: toNumberOrNull(doc.total_pages) ?? 0,
          last_accessed: toNumberOrNull(doc.last_accessed),
          cache_pages: toNumberOrNull(row?.cache_pages) ?? 0,
          last_cache_update: toNumberOrNull(row?.last_cache_update),
        };
      });

      return normalizeAndSort(enriched);
    } catch (error) {
      console.error('Failed to find documents by filename (fallback):', error);
      return [];
    }
  },

  /**
   * Save OCR result for a specific page
   */
  async saveOCR(docId: number, pageNum: number, data: OCRPageResult, engine?: OCREngine): Promise<boolean> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] saveOCR skipped: DB not available');
        return false;
      }
      const selectedEngine = engine || data.ocrEngine || 'tesseract';
      const ok = await window.electronAPI.db.saveOCR(docId, pageNum, data, selectedEngine);
      if (!ok) {
        console.warn(`[DB] saveOCR returned false for page ${pageNum} (docId=${docId}, engine=${selectedEngine})`);
        return false;
      }
      dbLog(`[DB] Saved OCR for page ${pageNum} (docId=${docId}, engine=${selectedEngine})`);
      return true;
    } catch (error) {
      console.error('Failed to save OCR:', error);
      return false;
    }
  },

  /**
   * Retrieve cached OCR result (returns null if not found)
   */
  async getOCR(docId: number, pageNum: number, engine: OCREngine = 'tesseract'): Promise<OCRPageResult | null> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] getOCR skipped: DB not available');
        return null;
      }
      const data = await window.electronAPI.db.getOCR(docId, pageNum, engine);
      if (data) {
        dbLog(`[DB] cache hit for page ${pageNum} (engine=${engine})`);
        return data;
      }
      dbLog(`[DB] cache miss for page ${pageNum} (docId=${docId}, engine=${engine})`);
      return null;
    } catch (error) {
      console.error('Failed to get OCR:', error);
      return null;
    }
  },

  async clearOCR(docId: number, pageNum: number, engine: OCREngine = 'tesseract'): Promise<boolean> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] clearOCR skipped: DB not available');
        return false;
      }
      const ok = await window.electronAPI.db.clearOCR(docId, pageNum, engine);
      if (ok) {
        dbLog(`[DB] Cleared OCR cache for page ${pageNum} (docId=${docId}, engine=${engine})`);
      }
      return ok;
    } catch (error) {
      console.error('Failed to clear OCR:', error);
      return false;
    }
  },

  async saveTranslationCache(
    docId: number,
    pageNum: number,
    cacheKey: string,
    entry: DBOCRTranslationCacheEntry
  ): Promise<boolean> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] saveTranslationCache skipped: DB not available');
        return false;
      }
      return await window.electronAPI.db.saveTranslationCache(docId, pageNum, cacheKey, entry);
    } catch (error) {
      console.error('Failed to save translation cache:', error);
      return false;
    }
  },

  async getTranslationCachePage(docId: number, pageNum: number): Promise<DBOCRTranslationCacheEntry[]> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] getTranslationCachePage skipped: DB not available');
        return [];
      }
      const rows = await window.electronAPI.db.getTranslationCachePage(docId, pageNum);
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('Failed to get translation cache page:', error);
      return [];
    }
  },

  async clearTranslationCacheByEngine(docId: number, pageNum: number, engine: OCREngine = 'tesseract'): Promise<boolean> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] clearTranslationCacheByEngine skipped: DB not available');
        return false;
      }
      return await window.electronAPI.db.clearTranslationCacheByEngine(docId, pageNum, engine);
    } catch (error) {
      console.error('Failed to clear translation cache:', error);
      return false;
    }
  },

  async touchDocument(docId: number): Promise<boolean> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] touchDocument skipped: DB not available');
        return false;
      }
      return await window.electronAPI.db.touchDocument(docId);
    } catch (error) {
      console.error('Failed to touch document:', error);
      return false;
    }
  },

  async updateLastPage(docId: number, pageNum: number): Promise<boolean> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] updateLastPage skipped: DB not available');
        return false;
      }
      return await window.electronAPI.db.updateLastPage(docId, pageNum);
    } catch (error) {
      console.error('Failed to update document page:', error);
      return false;
    }
  },

  async updateDocument(docId: number, updates: DocumentUpdate): Promise<boolean> {
    try {
      if (!isDbAvailable()) {
        console.warn('[DB] updateDocument skipped: DB not available');
        return false;
      }
      return await window.electronAPI.db.updateDocument(docId, updates);
    } catch (error) {
      console.error('Failed to update document:', error);
      return false;
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
      return await window.electronAPI.db.getLatestOCR(docId);
    } catch (error) {
      console.error('Failed to get latest OCR:', error);
      return null;
    }
  }
};

