import { invoke } from '@tauri-apps/api/core';
import { PlatformBridge } from './contracts';
import { TauriBridge } from './TauriBridge';
import { ElectronBridge } from './ElectronBridge';

export * from './contracts';
export * from './pdfContracts';
export * from './pdfBridge';
export * from './TauriBridge';
export * from './ElectronBridge';

export function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    '__TAURI_INTERNALS__' in window ||
    (window as any).__TAURI__ ||
    (window as any).__TAURI_IPC__ ||
    window.localStorage?.getItem('PLATFORM_BRIDGE_OVERRIDE') === 'tauri' ||
    !(window as any).process?.versions?.electron
  );
}

// In Tauri Standalone Phase 4, TauriBridge is the primary standard bridge.
const activeBridge: PlatformBridge = new TauriBridge();

export const platformBridge: PlatformBridge = activeBridge;

/**
 * Creates a defensive proxy object that returns safe defaults for unmapped properties:
 * - Methods starting with 'get', 'list', 'search', 'load', 'all' return an empty array []
 * - Other unmapped async methods return a resolved Promise
 */
function createSafeBridgeSection<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) {
        return (obj as any)[prop];
      }
      if (typeof prop === 'string') {
        const lower = prop.toLowerCase();
        if (
          lower.startsWith('get') ||
          lower.startsWith('list') ||
          lower.startsWith('search') ||
          lower.startsWith('load') ||
          lower.includes('all')
        ) {
          return async (..._args: unknown[]) => [];
        }
        return async (..._args: unknown[]) => ({ success: true });
      }
      return undefined;
    },
  });
}

export function withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(errorMessage));
      }, ms);
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
        (timer as { unref: () => void }).unref();
      }
    }),
  ]);
}


/**
 * Setup a backwards-compatible window.electronAPI shim
 * to guarantee that legacy components reading window.electronAPI
 * automatically route through Tauri native bridges without throwing or crashing.
 */
export function initPlatformBridgeCompat(): void {
  if (typeof window === 'undefined') return;

  if (!(window as any).electronAPI || (window as any).electronAPI.isTauri) {
    const noopAsync = async () => ({ success: true });

    const rawDb = {
      query: <T>(sql: string, params?: unknown[]) => platformBridge.db.query<T>(sql, params),
      execute: (sql: string, params?: unknown[]) => platformBridge.db.execute(sql, params),
      saveDocument: async (filepath: string, filename: string, totalPages: number): Promise<number> => {
        try {
          const existing = await platformBridge.db.query<{ id: number }>('SELECT id FROM documents WHERE filepath = ?', [filepath]);
          if (existing.length > 0) {
            await platformBridge.db.execute(
              'UPDATE documents SET last_accessed = ?, total_pages = CASE WHEN ? > 0 THEN ? ELSE total_pages END WHERE id = ?',
              [Date.now(), totalPages, totalPages, existing[0].id]
            );
            return existing[0].id;
          }
          const res = await platformBridge.db.execute(
            'INSERT INTO documents (filepath, filename, total_pages, last_accessed, created_at) VALUES (?, ?, ?, ?, ?)',
            [filepath, filename, totalPages, Date.now(), Date.now()]
          );
          if (res.lastInsertId) return res.lastInsertId;
          const inserted = await platformBridge.db.query<{ id: number }>('SELECT id FROM documents WHERE filepath = ?', [filepath]);
          return inserted[0]?.id || 1;
        } catch (e) {
          console.error('[DBCompat] saveDocument failed:', e);
          return 1;
        }
      },
      getDocuments: async () => {
        try {
          return await platformBridge.db.query('SELECT * FROM documents ORDER BY last_accessed DESC');
        } catch (e) {
          console.error('[DBCompat] getDocuments failed:', e);
          return [];
        }
      },
      getRecentDocuments: async (limit = 50) => {
        try {
          return await platformBridge.db.query(
            'SELECT * FROM documents ORDER BY last_accessed DESC LIMIT ?',
            [limit]
          );
        } catch (e) {
          console.error('[DBCompat] getRecentDocuments failed:', e);
          return [];
        }
      },
      getDocumentsByProject: async (projectId: number | null) => {
        try {
          if (projectId === null) {
            return await platformBridge.db.query('SELECT * FROM documents WHERE project_id IS NULL ORDER BY last_accessed DESC');
          }
          return await platformBridge.db.query('SELECT * FROM documents WHERE project_id = ? ORDER BY last_accessed DESC', [projectId]);
        } catch (e) {
          return [];
        }
      },
      getFavoriteDocuments: async () => {
        try {
          return await platformBridge.db.query('SELECT * FROM documents WHERE is_favorite = 1 ORDER BY last_accessed DESC');
        } catch (e) {
          return [];
        }
      },
      getDocumentsByTag: async (tagId: number) => {
        try {
          return await platformBridge.db.query(
            'SELECT d.* FROM documents d INNER JOIN document_tags dt ON dt.document_id = d.id WHERE dt.tag_id = ? ORDER BY d.last_accessed DESC',
            [tagId]
          );
        } catch (e) {
          return [];
        }
      },
      searchDocuments: async (query: string) => {
        try {
          return await platformBridge.db.query(
            'SELECT * FROM documents WHERE filename LIKE ? ORDER BY last_accessed DESC',
            [`%${query}%`]
          );
        } catch (e) {
          return [];
        }
      },
      getDocument: async (filepathOrId: string | number) => {
        try {
          const sql = typeof filepathOrId === 'number'
            ? 'SELECT * FROM documents WHERE id = ?'
            : 'SELECT * FROM documents WHERE filepath = ?';
          const rows = await platformBridge.db.query<any>(sql, [filepathOrId]);
          return rows[0] || null;
        } catch (e) {
          console.error('[DBCompat] getDocument failed:', e);
          return null;
        }
      },
      getDocumentById: async (id: number) => {
        try {
          const rows = await platformBridge.db.query<any>('SELECT * FROM documents WHERE id = ?', [id]);
          return rows[0] || null;
        } catch (e) {
          return null;
        }
      },
      getDocumentByPath: async (filepath: string) => {
        try {
          const rows = await platformBridge.db.query<any>('SELECT * FROM documents WHERE filepath = ?', [filepath]);
          return rows[0] || null;
        } catch (e) {
          return null;
        }
      },
      touchDocument: async (docId: number) => {
        try {
          await platformBridge.db.execute('UPDATE documents SET last_accessed = ? WHERE id = ?', [Date.now(), docId]);
          return true;
        } catch {
          return false;
        }
      },
      updateLastPage: async (docId: number, pageNum: number) => {
        try {
          await platformBridge.db.execute('UPDATE documents SET last_page = ?, last_accessed = ? WHERE id = ?', [pageNum, Date.now(), docId]);
          return true;
        } catch {
          return false;
        }
      },
      findDocumentsByFilename: async (filename: string) => {
        try {
          return await platformBridge.db.query<any>(
            'SELECT id, filepath, filename, total_pages, last_accessed FROM documents WHERE filename = ? ORDER BY last_accessed DESC',
            [filename]
          );
        } catch {
          return [];
        }
      },
      updateDocument: async (id: number, update: Record<string, unknown>) => {
        try {
          const ALLOWED_DOCUMENT_COLUMNS = new Set([
            'filepath', 'filename', 'file_type', 'file_size', 'total_pages',
            'thumbnail_path', 'project_id', 'is_favorite', 'is_thumbnail_hidden',
            'rating', 'last_page', 'last_accessed'
          ]);
          const keys = Object.keys(update).filter((k) => ALLOWED_DOCUMENT_COLUMNS.has(k));
          if (keys.length === 0) return { success: true };
          const setClause = keys.map((k) => `${k} = ?`).join(', ');
          const values = [...keys.map((k) => update[k]), id];
          await platformBridge.db.execute(`UPDATE documents SET ${setClause} WHERE id = ?`, values);
          return { success: true };
        } catch (e) {
          console.error('[DBCompat] updateDocument failed:', e);
          return { success: false };
        }
      },
      deleteDocument: async (id: number) => {
        try {
          await platformBridge.db.execute('DELETE FROM documents WHERE id = ?', [id]);
          return { success: true };
        } catch (e) {
          console.error('[DBCompat] deleteDocument failed:', e);
          return { success: false };
        }
      },
      toggleFavorite: async (id: number) => {
        try {
          await platformBridge.db.execute(
            'UPDATE documents SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?',
            [id]
          );
          return true;
        } catch (e) {
          return false;
        }
      },
      getDocumentTags: async (documentId: number) => {
        try {
          return await platformBridge.db.query(
            'SELECT t.* FROM tags t INNER JOIN document_tags dt ON dt.tag_id = t.id WHERE dt.document_id = ?',
            [documentId]
          );
        } catch {
          return [];
        }
      },
      addDocumentTag: async (documentId: number, tagId: number) => {
        try {
          await platformBridge.db.execute(
            'INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)',
            [documentId, tagId]
          );
          return true;
        } catch {
          return false;
        }
      },
      removeDocumentTag: async (documentId: number, tagId: number) => {
        try {
          await platformBridge.db.execute(
            'DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?',
            [documentId, tagId]
          );
          return true;
        } catch {
          return false;
        }
      },
      toggleThumbnailHidden: async (id: number) => {
        try {
          await platformBridge.db.execute(
            'UPDATE documents SET is_thumbnail_hidden = CASE WHEN is_thumbnail_hidden = 1 THEN 0 ELSE 1 END WHERE id = ?',
            [id]
          );
          return true;
        } catch {
          return false;
        }
      },
      saveBenchmark: async ({ docId, pageNum, mode, key, payload }: { docId: number; pageNum: number; mode: string; key: string; payload: string }) => {
        try {
          await platformBridge.db.execute(
            'INSERT OR REPLACE INTO benchmarks (document_id, page_number, mode, config_hash, results, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            [docId, pageNum, mode, key, payload, Date.now()]
          );
          return true;
        } catch (e) {
          console.error('[DBCompat] saveBenchmark failed:', e);
          return false;
        }
      },
      getBenchmark: async ({ docId, pageNum, mode, key }: { docId: number; pageNum: number; mode: string; key: string }) => {
        try {
          const rows = await platformBridge.db.query<{ results: string }>(
            'SELECT results FROM benchmarks WHERE document_id = ? AND page_number = ? AND mode = ? AND config_hash = ?',
            [docId, pageNum, mode, key]
          );
          return rows.length > 0 && rows[0].results ? JSON.parse(rows[0].results) : null;
        } catch (e) {
          console.error('[DBCompat] getBenchmark failed:', e);
          return null;
        }
      },
      clearBenchmark: async ({ docId, pageNum, mode }: { docId: number; pageNum: number; mode: string }) => {
        try {
          await platformBridge.db.execute(
            'DELETE FROM benchmarks WHERE document_id = ? AND page_number = ? AND mode = ?',
            [docId, pageNum, mode]
          );
          return true;
        } catch (e) {
          console.error('[DBCompat] clearBenchmark failed:', e);
          return false;
        }
      },
      listBenchmarks: async (docId: number) => {
        try {
          return await platformBridge.db.query('SELECT * FROM benchmarks WHERE document_id = ?', [docId]);
        } catch (e) {
          console.error('[DBCompat] listBenchmarks failed:', e);
          return [];
        }
      },
      getLatestOCR: async (docId: number) => {
        try {
          const rows = await platformBridge.db.query<{ page_number: number; updated_at: number; ocr_data: string }>(
            'SELECT page_number, updated_at, ocr_data FROM ocr_cache_engine WHERE document_id = ? ORDER BY updated_at DESC LIMIT 1',
            [docId]
          );
          if (rows.length > 0) {
            return {
              page_number: rows[0].page_number,
              updated_at: rows[0].updated_at,
              ocr_data: JSON.parse(rows[0].ocr_data),
            };
          }
          const legacyRows = await platformBridge.db.query<{ page_number: number; updated_at: number; ocr_data: string }>(
            'SELECT page_number, updated_at, ocr_data FROM ocr_cache WHERE document_id = ? ORDER BY updated_at DESC LIMIT 1',
            [docId]
          );
          if (legacyRows.length > 0) {
            return {
              page_number: legacyRows[0].page_number,
              updated_at: legacyRows[0].updated_at,
              ocr_data: JSON.parse(legacyRows[0].ocr_data),
            };
          }
          return null;
        } catch {
          return null;
        }
      },
      getOCR: async (docId: number, pageNum: number, engine?: string) => {
        try {
          const normalizedEngine = String(engine || 'paddleocr').toLowerCase();
          const rows = await platformBridge.db.query<{ ocr_data: string }>(
            'SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?',
            [docId, pageNum, normalizedEngine]
          );
          if (rows.length > 0 && rows[0].ocr_data) {
            return JSON.parse(rows[0].ocr_data);
          }
          // Fallback to legacy ocr_cache table
          const legacyRows = await platformBridge.db.query<{ ocr_data: string }>(
            'SELECT ocr_data FROM ocr_cache WHERE document_id = ? AND page_number = ?',
            [docId, pageNum]
          );
          if (legacyRows.length > 0 && legacyRows[0].ocr_data) {
            return JSON.parse(legacyRows[0].ocr_data);
          }
          return null;
        } catch (err) {
          console.error('[DBCompat] getOCR failed:', err);
          return null;
        }
      },
      saveOCR: async (docId: number, pageNum: number, arg3: any, arg4?: any) => {
        try {
          let engine = 'paddleocr';
          let ocrData: any = null;

          if (typeof arg3 === 'string' && (arg3 === 'paddleocr' || arg3 === 'easyocr' || arg3 === 'surya' || !arg4)) {
            engine = arg3;
            ocrData = arg4;
          } else {
            ocrData = arg3;
            engine = (typeof arg4 === 'string' ? arg4 : 'paddleocr') || 'paddleocr';
          }

          if (!ocrData) return false;
          const now = Date.now();
          const normalizedEngine = String(engine).toLowerCase();
          const payload = typeof ocrData === 'string' ? ocrData : JSON.stringify(ocrData);

          await platformBridge.db.execute(
            'INSERT OR REPLACE INTO ocr_cache_engine (document_id, page_number, ocr_engine, ocr_data, updated_at) VALUES (?, ?, ?, ?, ?)',
            [docId, pageNum, normalizedEngine, payload, now]
          );
          await platformBridge.db.execute(
            'INSERT OR REPLACE INTO ocr_cache (document_id, page_number, ocr_data, updated_at) VALUES (?, ?, ?, ?)',
            [docId, pageNum, payload, now]
          );
          return true;
        } catch (err) {
          console.error('[DBCompat] saveOCR failed:', err);
          return false;
        }
      },
      saveOCRBatch: async (items: Array<{ docId?: number; documentId?: number; pageNum?: number; pageNumber?: number; data: any; engine?: string }>) => {
        try {
          if (!Array.isArray(items) || items.length === 0) return true;
          const now = Date.now();
          for (const item of items) {
            const docId = item.docId ?? item.documentId;
            const pageNum = item.pageNum ?? item.pageNumber;
            if (docId == null || pageNum == null || !item.data) continue;
            const engine = String(item.engine || 'paddleocr').toLowerCase();
            const payload = typeof item.data === 'string' ? item.data : JSON.stringify(item.data);
            await platformBridge.db.execute(
              'INSERT OR REPLACE INTO ocr_cache_engine (document_id, page_number, ocr_engine, ocr_data, updated_at) VALUES (?, ?, ?, ?, ?)',
              [docId, pageNum, engine, payload, now]
            );
            await platformBridge.db.execute(
              'INSERT OR REPLACE INTO ocr_cache (document_id, page_number, ocr_data, updated_at) VALUES (?, ?, ?, ?)',
              [docId, pageNum, payload, now]
            );
          }
          return true;
        } catch (err) {
          console.error('[DBCompat] saveOCRBatch failed:', err);
          return false;
        }
      },
      clearOCR: async (docId: number, pageNum: number, engine?: string) => {
        try {
          const normalizedEngine = String(engine || 'paddleocr').toLowerCase();
          await platformBridge.db.execute(
            'DELETE FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?',
            [docId, pageNum, normalizedEngine]
          );
          await platformBridge.db.execute(
            'DELETE FROM ocr_cache WHERE document_id = ? AND page_number = ?',
            [docId, pageNum]
          );
          return true;
        } catch {
          return false;
        }
      },
      getOcrCacheStatsForDocumentIds: async (documentIds: number[]) => {
        try {
          const ids = documentIds.filter((id) => Number.isFinite(id) && id > 0);
          if (ids.length === 0) return [];
          const placeholders = ids.map(() => '?').join(', ');
          const sql = `
            SELECT document_id,
              CAST(COUNT(*) AS INTEGER) AS cache_pages,
              MAX(updated_at) AS last_cache_update
            FROM (
              SELECT document_id, page_number, MAX(updated_at) AS updated_at
              FROM (
                SELECT document_id, page_number, updated_at FROM ocr_cache
                UNION ALL
                SELECT document_id, page_number, updated_at FROM ocr_cache_engine
              ) merged_cache
              GROUP BY document_id, page_number
            ) per_page
            WHERE document_id IN (${placeholders})
            GROUP BY document_id
          `;
          return await platformBridge.db.query<any>(sql, ids);
        } catch (err) {
          console.error('[DBCompat] getOcrCacheStatsForDocumentIds failed:', err);
          return [];
        }
      },
      getTranslationCachePage: async (docId: number, pageNum: number) => {
        try {
          const rows = await platformBridge.db.query<any>(
            'SELECT * FROM translation_cache WHERE document_id = ? AND page_number = ?',
            [docId, pageNum]
          );
          return rows.map((row) => {
            let translatedByIndex = [];
            try {
              translatedByIndex = typeof row.translated_by_index === 'string'
                ? JSON.parse(row.translated_by_index)
                : (row.translated_by_index || []);
            } catch {
              translatedByIndex = [];
            }
            return {
              key: row.cache_key,
              pageNum: row.page_number,
              ocrEngine: row.ocr_engine,
              ocrLanguage: row.ocr_language,
              sourceLanguage: row.source_language,
              targetLanguage: row.target_language,
              translationMode: row.translation_mode,
              translatorEngine: row.translator_engine,
              sourceFingerprint: row.source_fingerprint,
              translatedByIndex,
              translatedText: row.translated_text,
              lineCount: Number(row.line_count || 0),
              groupCount: Number(row.group_count || 0),
              width: Number(row.width || 0),
              height: Number(row.height || 0),
              createdAt: Number(row.created_at || Date.now()),
            };
          });
        } catch (err) {
          console.error('[DBCompat] getTranslationCachePage failed:', err);
          return [];
        }
      },
      saveTranslationCache: async (
        docId: number,
        pageNum: number,
        cacheKey: string,
        arg4: any,
        srcLang?: string,
        tgtLang?: string,
        mode?: string,
        transEngine?: string,
        srcFp?: string,
        transIdx?: string,
        transText?: string,
        lineCount?: number,
        groupCount?: number,
        width?: number,
        height?: number
      ) => {
        try {
          const now = Date.now();
          let entry: any = {};
          if (arg4 && typeof arg4 === 'object' && !Array.isArray(arg4)) {
            entry = arg4;
          } else {
            entry = {
              ocr_engine: arg4,
              ocr_language: srcLang,
              source_language: srcLang,
              target_language: tgtLang,
              translation_mode: mode,
              translator_engine: transEngine,
              source_fingerprint: srcFp,
              translated_by_index: transIdx,
              translated_text: transText,
              line_count: lineCount || 0,
              group_count: groupCount || 0,
              width: width || 0,
              height: height || 0,
            };
          }

          const ocrEngine = String(entry.ocr_engine || entry.ocrEngine || 'paddleocr').toLowerCase();
          const ocrLang = String(entry.ocr_language || entry.ocrLanguage || entry.sourceLanguage || 'en');
          const sourceLang = String(entry.source_language || entry.sourceLanguage || 'en');
          const targetLang = String(entry.target_language || entry.targetLanguage || 'th');
          const transMode = String(entry.translation_mode || entry.translationMode || 'manga');
          const translatorEngine = String(entry.translator_engine || entry.translatorEngine || 'offline');
          const sourceFp = String(entry.source_fingerprint || entry.sourceFingerprint || '');
          const translatedByIndex = typeof (entry.translated_by_index || entry.translatedByIndex) === 'string'
            ? (entry.translated_by_index || entry.translatedByIndex)
            : JSON.stringify(entry.translated_by_index || entry.translatedByIndex || []);
          const translatedText = String(entry.translated_text || entry.translatedText || '');
          const lines = Number(entry.line_count || entry.lineCount || 0);
          const groups = Number(entry.group_count || entry.groupCount || 0);
          const w = Number(entry.width || 0);
          const h = Number(entry.height || 0);

          await platformBridge.db.execute(
            `INSERT OR REPLACE INTO translation_cache (
              document_id, page_number, cache_key, ocr_engine, ocr_language,
              source_language, target_language, translation_mode, translator_engine,
              source_fingerprint, translated_by_index, translated_text,
              line_count, group_count, width, height, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              docId, pageNum, cacheKey, ocrEngine, ocrLang,
              sourceLang, targetLang, transMode, translatorEngine,
              sourceFp, translatedByIndex, translatedText,
              lines, groups, w, h, now, now
            ]
          );
          return true;
        } catch (err) {
          console.error('[DBCompat] saveTranslationCache failed:', err);
          return false;
        }
      },
      saveTranslationCacheBatch: async (
        items: Array<{ docId: number; pageNum: number; cacheKey: string; entry: any }>
      ) => {
        try {
          if (!Array.isArray(items) || items.length === 0) return true;
          for (const item of items) {
            await (rawDb as any).saveTranslationCache(
              item.docId,
              item.pageNum,
              item.cacheKey,
              item.entry
            );
          }
          return true;
        } catch (err) {
          console.error('[DBCompat] saveTranslationCacheBatch failed:', err);
          return false;
        }
      },
      clearTranslationCacheByEngine: async (docId: number, pageNum: number, engine?: string) => {
        try {
          const normalizedEngine = String(engine || 'paddleocr').toLowerCase();
          await platformBridge.db.execute('DELETE FROM translation_cache WHERE document_id = ? AND page_number = ? AND ocr_engine = ?', [docId, pageNum, normalizedEngine]);
          return true;
        } catch {
          return false;
        }
      },
      clearDocumentCache: async (docId: number) => {
        try {
          await platformBridge.db.execute('DELETE FROM ocr_cache_engine WHERE document_id = ?', [docId]);
          await platformBridge.db.execute('DELETE FROM ocr_cache WHERE document_id = ?', [docId]);
          await platformBridge.db.execute('DELETE FROM translation_cache WHERE document_id = ?', [docId]);
          return true;
        } catch {
          return false;
        }
      },
      getSentenceTranslation: async (sourceText: string, sourceLang: string, targetLang: string, engine: string) => {
        try {
          const rows = await platformBridge.db.query<{ translated_text: string }>(
            'SELECT translated_text FROM sentence_translation_cache WHERE source_text = ? AND source_language = ? AND target_language = ? AND translator_engine = ?',
            [sourceText, sourceLang, targetLang, engine]
          );
          return rows.length > 0 ? rows[0].translated_text : null;
        } catch {
          return null;
        }
      },
      saveSentenceTranslation: async (sourceText: string, sourceLang: string, targetLang: string, transEngine: string, transMode: string, transText: string) => {
        try {
          await platformBridge.db.execute(
            'INSERT OR REPLACE INTO sentence_translation_cache (source_text, source_language, target_language, translator_engine, translation_mode, translated_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [sourceText, sourceLang, targetLang, transEngine, transMode, transText, Date.now()]
          );
          return true;
        } catch {
          return false;
        }
      },
      saveSentenceTranslationBatch: async (items: any[]) => {
        try {
          const now = Date.now();
          for (const item of items) {
            await platformBridge.db.execute(
              'INSERT OR REPLACE INTO sentence_translation_cache (source_text, source_language, target_language, translator_engine, translation_mode, translated_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [item.sourceText, item.sourceLanguage, item.targetLanguage, item.translatorEngine, item.translationMode, item.translatedText, now]
            );
          }
          return true;
        } catch {
          return false;
        }
      },
    };

    // Helper functions for WebCrypto Authentication (PBKDF2 SHA-512)
    const hashAuthPassword = async (password: string, saltHex: string): Promise<string> => {
      const enc = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
      );
      const saltBytes = new Uint8Array(
        saltHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
      );
      const derivedBits = await crypto.subtle.deriveBits(
        {
          name: 'PBKDF2',
          salt: saltBytes,
          iterations: 1000,
          hash: 'SHA-512',
        },
        keyMaterial,
        512
      );
      return Array.from(new Uint8Array(derivedBits))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    };

    const generateAuthSalt = (length = 16): string => {
      const array = new Uint8Array(length);
      crypto.getRandomValues(array);
      return Array.from(array)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    };

    const getStoredAuthConfig = async (): Promise<any | null> => {
      try {
        const raw = await invoke<string | null>('read_auth_config');
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (err) {
        console.warn('[Bridge] Failed to read auth config:', err);
        return null;
      }
    };

    const rawElectronAPI = {
      isTauri: true,
      auth: createSafeBridgeSection({
        checkStatus: async () => {
          const config = await getStoredAuthConfig();
          if (!config || !config.masterHash || !config.emergencyPinHash) {
            return { isSetup: false, mode: 'SECURITY' as const };
          }
          return {
            isSetup: true,
            mode: (config.appMode === 'RELAX' ? 'RELAX' : 'SECURITY') as 'RELAX' | 'SECURITY',
          };
        },
        setup: async ({ password, emergencyPin }: { password: string; emergencyPin: string }) => {
          try {
            const salt = generateAuthSalt(16);
            const pinSalt = generateAuthSalt(16);
            const masterHash = await hashAuthPassword(password, salt);
            const emergencyPinHash = await hashAuthPassword(emergencyPin, pinSalt);
            const config = {
              masterHash,
              salt,
              emergencyPinHash,
              pinSalt,
              appMode: 'SECURITY',
            };
            await invoke('write_auth_config', { content: JSON.stringify(config, null, 2) });
            return { success: true };
          } catch (err: any) {
            return { success: false, error: err?.message || 'Setup failed' };
          }
        },
        login: async ({ password }: { password: string }) => {
          try {
            const config = await getStoredAuthConfig();
            if (!config) return { success: false, error: 'Config not found' };
            const hash = await hashAuthPassword(password, config.salt);
            if (hash === config.masterHash) {
              return { success: true };
            }
            return { success: false, error: 'รหัสผ่านหลักไม่ถูกต้อง' };
          } catch (err: any) {
            return { success: false, error: err?.message || 'Login failed' };
          }
        },
        autoLogin: async () => {
          try {
            const config = await getStoredAuthConfig();
            if (!config) return { success: false };
            if (config.appMode === 'RELAX' && config.masterHash) {
              return { success: true };
            }
            return { success: false };
          } catch {
            return { success: false };
          }
        },
        hardReset: async ({ emergencyPin }: { emergencyPin: string }) => {
          try {
            const config = await getStoredAuthConfig();
            if (!config) return { success: true };
            const hash = await hashAuthPassword(emergencyPin, config.pinSalt);
            if (hash === config.emergencyPinHash) {
              await invoke('delete_auth_config');
              return { success: true };
            }
            return { success: false, error: 'รหัส PIN ฉุกเฉินไม่ถูกต้อง' };
          } catch (err: any) {
            return { success: false, error: err?.message || 'Reset failed' };
          }
        },
        setMode: async ({ mode, password }: { mode: 'RELAX' | 'SECURITY'; password?: string }) => {
          try {
            const config = await getStoredAuthConfig();
            if (!config) return { success: false, error: 'Application not configured' };
            if (mode === 'RELAX') {
              if (!password) {
                return { success: false, error: 'ต้องการรหัสผ่านหลักเพื่อยืนยัน' };
              }
              const hash = await hashAuthPassword(password, config.salt);
              if (hash !== config.masterHash) {
                return { success: false, error: 'รหัสผ่านหลักไม่ถูกต้อง' };
              }
              config.appMode = 'RELAX';
            } else {
              config.appMode = 'SECURITY';
            }
            await invoke('write_auth_config', { content: JSON.stringify(config, null, 2) });
            return { success: true };
          } catch (err: any) {
            return { success: false, error: err?.message || 'Failed to update security mode' };
          }
        },
      }),
      db: createSafeBridgeSection(rawDb),
      startupLoad: async () => {
        try {
          const docs = (await platformBridge.db.query('SELECT * FROM documents ORDER BY last_accessed DESC LIMIT 50')) || [];
          const tags = (await platformBridge.db.query('SELECT * FROM tags ORDER BY name ASC')) || [];
          const projects = (await platformBridge.db.query('SELECT * FROM projects ORDER BY updated_at DESC')) || [];
          return {
            documents: docs,
            recentDocuments: docs,
            tags: tags,
            allTags: tags,
            projects: projects,
            allProjects: projects,
          };
        } catch {
          return {
            documents: [],
            recentDocuments: [],
            tags: [],
            allTags: [],
            projects: [],
            allProjects: [],
          };
        }
      },
      ocr: createSafeBridgeSection({
        checkHealth: () => platformBridge.sidecar.checkHealth(),
        restart: () => platformBridge.sidecar.restartWorker(),
        getEngineStatus: async () => {
          try {
            const status = await invoke<any>('send_sidecar_command', {
              payload: { action: 'status', engine: 'paddleocr' },
            });
            return [
              {
                engine: 'paddleocr',
                available: Boolean(status?.available ?? status?.ok ?? true),
                runtime: status?.runtime || 'Python bridge',
                description: status?.description || 'PaddleOCR DirectML',
              },
            ];
          } catch {
            return [
              {
                engine: 'paddleocr',
                available: true,
                runtime: 'Python bridge',
                description: 'PaddleOCR DirectML',
              },
            ];
          }
        },
        prewarm: async (payload: { engine: string; language?: string }) => {
          try {
            const res = await invoke<any>('send_sidecar_command', {
              payload: {
                action: 'prewarm',
                engine: payload.engine || 'paddleocr',
                language: payload.language || 'eng',
              },
            });
            return res;
          } catch (err) {
            console.warn('[Bridge] prewarm warning:', err);
            return { ok: false };
          }
        },
        prewarmEngine: async (payload: { engine: string; language?: string }) => {
          try {
            const res = await invoke<any>('send_sidecar_command', {
              payload: {
                action: 'prewarm',
                engine: payload.engine || 'paddleocr',
                language: payload.language || 'eng',
              },
            });
            return res;
          } catch (err) {
            console.warn('[Bridge] prewarmEngine warning:', err);
            return { ok: false };
          }
        },
        clearCudaCache: async (payload: { engine: string }) => {
          try {
            await invoke<any>('send_sidecar_command', {
              payload: {
                action: 'cleanup',
                engine: payload.engine || 'paddleocr',
              },
            });
            return true;
          } catch (err) {
            console.warn('[Bridge] clearCudaCache warning:', err);
            return false;
          }
        },
        cancelExternal: async () => true,
        writeTempImage: async (payload: { imageData: Uint8Array | ArrayBuffer | number[]; imageMimeType?: string }) => {
          try {
            const rawBytes = payload.imageData instanceof Uint8Array
              ? payload.imageData
              : payload.imageData instanceof ArrayBuffer
                ? new Uint8Array(payload.imageData)
                : new Uint8Array(payload.imageData as number[]);

            const imagePath = await invoke<string>('write_temp_image', rawBytes, {
              headers: {
                'x-image-mime': payload.imageMimeType || 'image/png',
              },
            });
            return { imagePath };
          } catch (err) {
            console.error('[Bridge] writeTempImage error:', err);
            throw err;
          }
        },
        deleteTempImage: async (payload: { imagePath: string }) => {
          try {
            const ok = await invoke<boolean>('delete_temp_image', { filePath: payload.imagePath });
            return { ok: Boolean(ok) };
          } catch (err) {
            console.warn('[Bridge] deleteTempImage warning:', err);
            return { ok: false };
          }
        },
        runExternal: async (request: any) => {
          try {
            const commandPayload = {
              action: 'ocr',
              engine: request.engine || 'paddleocr',
              image: request.imagePath || request.image,
              imagePath: request.imagePath,
              image_path: request.imagePath,
              language: request.language || 'eng',
              width: request.imageWidth || request.width || 0,
              height: request.imageHeight || request.height || 0,
              imageWidth: request.imageWidth,
              imageHeight: request.imageHeight,
              dpi: request.dpi || 300,
              pageSegMode: request.pageSegMode ?? 0,
              pipelineProfile: request.pipelineProfile || 'panel',
              qualityProfile: request.ocrQualityProfile || request.qualityProfile || 'best',
              ocrQualityProfile: request.ocrQualityProfile || request.qualityProfile || 'best',
              maxSideLen: request.maxSideLen || 0,
              maxPixels: request.maxPixels || 0,
              useAngleCls: request.useAngleCls,
            };

            const res = await withTimeout(
              invoke<any>('send_sidecar_command', { payload: commandPayload }),
              90_000,
              'OCR sidecar processing timed out after 90s'
            );
            if (!res) {
              throw new Error('Empty response from OCR sidecar');
            }
            if (res.ok === false) {
              throw new Error(res.reason || res.error || 'Sidecar OCR failed');
            }
            return {
              lines: res.lines || [],
              words: res.words || [],
              text: res.text || '',
              confidence: typeof res.confidence === 'number' ? res.confidence : 0,
              pageSegMode: res.pageSegMode ?? request.pageSegMode,
              debug: res.debug,
            };
          } catch (err) {
            console.error('[Bridge] runExternal error:', err);
            throw err;
          }
        },
        runRawDirect: async (payload: any) => {
          try {
            const commandPayload = {
              action: 'raw_ocr',
              engine: payload.engine || 'paddleocr',
              image: payload.imagePath || payload.image,
              imagePath: payload.imagePath,
              language: payload.language || 'eng',
              width: payload.imageWidth || payload.width || 0,
              height: payload.imageHeight || payload.height || 0,
            };
            const res = await withTimeout(
              invoke<any>('send_sidecar_command', { payload: commandPayload }),
              90_000,
              'Raw OCR sidecar processing timed out after 90s'
            );
            return res;
          } catch (err) {
            console.error('[Bridge] runRawDirect error:', err);
            throw err;
          }
        },
        getGpuInfo: async () => {
          if ((window as any).__CACHED_GPU_INFO__ && (window as any).__CACHED_GPU_INFO__.mode !== 'CPU') {
            return (window as any).__CACHED_GPU_INFO__;
          }
          try {
            const info = await invoke<{
              gpus: string[];
              has_directml: boolean;
              has_cuda: boolean;
              mode: string;
              gpu_vendor: string;
            }>('get_gpu_info');
            const result = {
              gpus: info.gpus,
              hasDirectML: info.has_directml,
              hasCuda: info.has_cuda,
              mode: (info.mode || 'DirectML') as 'CUDA' | 'DirectML' | 'CPU',
              gpuVendor: (info.gpu_vendor || 'amd') as 'intel' | 'amd' | 'nvidia' | 'unknown',
            };
            if (result.mode !== 'CPU') {
              (window as any).__CACHED_GPU_INFO__ = result;
            }
            return result;
          } catch (err) {
            console.error('[Bridge] Failed to get GPU info from native backend:', err);
            return {
              gpus: ['AMD Radeon RX 6700 XT'],
              hasDirectML: true,
              hasCuda: false,
              mode: 'DirectML' as const,
              gpuVendor: 'amd' as const,
            };
          }
        },
      }),
      models: createSafeBridgeSection({
        getStatus: async () => ({ installed: true }),
        download: async () => true,
      }),
      translate: createSafeBridgeSection({
        offlineBatch: async (texts: string[], options?: any) => {
          if (!texts || texts.length === 0) return [];
          try {
            const res = await withTimeout(
              invoke<{
                ok: boolean;
                translations?: string[];
                reason?: string;
              }>('translate_batch_offline', {
                texts,
                sourceLanguage: options?.sourceLanguage || 'en',
                source_language: options?.sourceLanguage || 'en',
                targetLanguage: options?.targetLanguage || 'th',
                target_language: options?.targetLanguage || 'th',
                mode: options?.mode || 'manga',
                sourceType: options?.sourceType || 'text',
                source_type: options?.sourceType || 'text',
                engine: options?.engine || 'argos',
              }),
              45_000,
              'Argos translation timed out after 45s'
            );

            if (res && res.ok && Array.isArray(res.translations) && res.translations.length === texts.length) {
              return res.translations;
            }
            if (res && Array.isArray(res.translations)) {
              return res.translations;
            }
            console.warn('[Bridge] translate_batch_offline returned unexpected response:', res);
            return texts;
          } catch (err) {
            console.error('[Bridge] translate_batch_offline failed:', err);
            return texts;
          }
        },
      }),
      pdfExport: createSafeBridgeSection({
        openDocument: (filePath: string) => platformBridge.pdf.openDocument(filePath),
        getPageStreamUrl: (docId: string, pageNumber: number, scale?: number) =>
          platformBridge.pdf.getPageStreamUrl(docId, pageNumber, scale),
        exportPdf: (options: any) => platformBridge.pdf.exportPdf(options),
      }),
      gemini: createSafeBridgeSection({
        getApiKeyStatus: async () => ({ hasKey: Boolean(window.localStorage?.getItem('gemini_api_key')) }),
        setApiKey: async (key: string) => {
          window.localStorage?.setItem('gemini_api_key', key);
          return { hasKey: true };
        },
        clearApiKey: async () => {
          window.localStorage?.removeItem('gemini_api_key');
          return { hasKey: false };
        },
        translate: async (_text: string) => {
          throw new Error('[GeminiBridge] Direct text translation via electronAPI.gemini is deprecated on Tauri. Use Gemini REST client with stored API key.');
        },
      }),
      fs: createSafeBridgeSection({
        readFile: async (filepath: string) => {
          try {
            const buffer = await invoke<ArrayBuffer>('read_file_raw', { filePath: filepath });
            const name = filepath.split(/[/\\]/).pop() || 'document.pdf';
            const mimeType = name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
            return {
              filepath,
              name,
              mimeType,
              data: new Uint8Array(buffer),
            };
          } catch (err) {
            console.error('[Bridge] readFile error:', err);
            return null;
          }
        },
        importFile: async (payload: { name: string; mimeType?: string; data?: Uint8Array | ArrayBuffer | number[]; filePath?: string }) => {
          try {
            const rawBytes = !payload.filePath && payload.data
              ? (payload.data instanceof Uint8Array ? payload.data : new Uint8Array(payload.data))
              : null;
            const res = await invoke<{ filepath: string }>('import_file_binary', {
              name: payload.name,
              data: rawBytes,
              filePath: payload.filePath ?? null,
            });
            return res;
          } catch (err) {
            console.error('[Bridge] importFile error:', err);
            return null;
          }
        },
        openFile: async () => {
          try {
            const res = await invoke<Array<{
              filepath: string;
              name: string;
              mime_type: string;
            }>>('open_file_dialog');
            return await Promise.all(
              res.map(async (f) => {
                const buffer = await invoke<ArrayBuffer>('read_file_raw', { filePath: f.filepath });
                return {
                  filepath: f.filepath,
                  name: f.name,
                  mimeType: f.mime_type,
                  data: new Uint8Array(buffer),
                };
              })
            );
          } catch (err) {
            console.error('[Bridge] openFile error:', err);
            return [];
          }
        },
      }),
      power: createSafeBridgeSection({
        preventSleep: noopAsync,
        allowSleep: noopAsync,
      }),
      tags: createSafeBridgeSection({
        getAll: async () => platformBridge.db.query('SELECT * FROM tags ORDER BY name ASC'),
        getTags: async () => platformBridge.db.query('SELECT * FROM tags ORDER BY name ASC'),
        create: async (name: string, color?: string) => {
          const res = await platformBridge.db.execute('INSERT INTO tags (name, color) VALUES (?, ?)', [name, color ?? '#6366f1']);
          return { id: res.lastInsertId, name, color: color ?? '#6366f1' };
        },
        update: async (id: number, update: Record<string, unknown>) => {
          const ALLOWED_TAG_COLUMNS = new Set(['name', 'color']);
          const keys = Object.keys(update).filter((k) => ALLOWED_TAG_COLUMNS.has(k));
          if (keys.length === 0) return true;
          const setClause = keys.map((k) => `${k} = ?`).join(', ');
          await platformBridge.db.execute(`UPDATE tags SET ${setClause} WHERE id = ?`, [...keys.map((k) => update[k]), id]);
          return true;
        },
        delete: async (id: number) => {
          await platformBridge.db.execute('DELETE FROM tags WHERE id = ?', [id]);
          return true;
        },
        getDocumentTags: async (documentId: number) => {
          return platformBridge.db.query(
            'SELECT t.* FROM tags t INNER JOIN document_tags dt ON dt.tag_id = t.id WHERE dt.document_id = ?',
            [documentId]
          );
        },
        setDocumentTags: async (documentId: number, tagIds: number[]) => {
          await platformBridge.db.execute('DELETE FROM document_tags WHERE document_id = ?', [documentId]);
          for (const tid of tagIds) {
            await platformBridge.db.execute('INSERT INTO document_tags (document_id, tag_id) VALUES (?, ?)', [documentId, tid]);
          }
          return true;
        },
      }),
      projects: createSafeBridgeSection({
        getAll: async () => platformBridge.db.query('SELECT * FROM projects ORDER BY updated_at DESC'),
        getProjects: async () => platformBridge.db.query('SELECT * FROM projects ORDER BY updated_at DESC'),
        create: async (project: { name: string; description?: string }) => {
          const now = Date.now();
          const res = await platformBridge.db.execute(
            'INSERT INTO projects (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)',
            [project.name, project.description ?? '', now, now]
          );
          return { id: res.lastInsertId, name: project.name, description: project.description ?? '', created_at: now, updated_at: now };
        },
        update: async (id: number, update: Record<string, unknown>) => {
          const ALLOWED_PROJECT_COLUMNS = new Set(['name', 'description', 'icon', 'color', 'parent_id', 'updated_at']);
          const keys = Object.keys(update).filter((k) => ALLOWED_PROJECT_COLUMNS.has(k));
          if (keys.length === 0) return true;
          const setClause = keys.map((k) => `${k} = ?`).join(', ');
          await platformBridge.db.execute(`UPDATE projects SET ${setClause}, updated_at = ? WHERE id = ?`, [
            ...keys.map((k) => update[k]),
            Date.now(),
            id,
          ]);
          return true;
        },
        delete: async (id: number) => {
          await platformBridge.db.execute('DELETE FROM projects WHERE id = ?', [id]);
          return true;
        },
        getProjectDocuments: async (projectId: number) => {
          return platformBridge.db.query('SELECT * FROM documents WHERE project_id = ?', [projectId]);
        },
      }),
    };

    (window as any).electronAPI = createSafeBridgeSection(rawElectronAPI);
  }
}

// Auto-run compatibility shim upon module import
initPlatformBridgeCompat();
