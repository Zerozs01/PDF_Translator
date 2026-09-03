import type Database from 'better-sqlite3-multiple-ciphers';

export class OCRCacheDAO {
  private static db: Database.Database | null = null;
  private static stmtCache = new Map<string, Database.Statement>();

  static init(database: Database.Database) {
    this.db = database;
    this.stmtCache.clear();
  }

  private static getStmt(sql: string): Database.Statement {
    if (!this.db) throw new Error('OCRCacheDAO: DB not initialized');
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  static save(documentId: number, pageNumber: number, data: any, engine: string = 'paddleocr') {
    const normalizedEngine = String(engine || 'paddleocr').toLowerCase();
    const stmt = this.getStmt(`
      INSERT INTO ocr_cache_engine (document_id, page_number, ocr_engine, ocr_data, updated_at)
      VALUES (@documentId, @pageNumber, @engine, @json, @now)
      ON CONFLICT(document_id, page_number, ocr_engine) DO UPDATE SET
        ocr_data = @json,
        updated_at = @now
    `);
    stmt.run({
      documentId,
      pageNumber,
      engine: normalizedEngine,
      json: JSON.stringify(data),
      now: Date.now()
    });
  }

  static saveBatch(
    items: Array<{ documentId: number; pageNumber: number; data: any; engine?: string }>
  ) {
    if (!this.db) throw new Error('OCRCacheDAO: DB not initialized');
    if (!items || items.length === 0) return;
    const now = Date.now();
    const stmt = this.getStmt(`
      INSERT INTO ocr_cache_engine (document_id, page_number, ocr_engine, ocr_data, updated_at)
      VALUES (@documentId, @pageNumber, @engine, @json, @now)
      ON CONFLICT(document_id, page_number, ocr_engine) DO UPDATE SET
        ocr_data = @json,
        updated_at = @now
    `);
    const insertMany = this.db.transaction((rows: typeof items) => {
      for (const item of rows) {
        stmt.run({
          documentId: item.documentId,
          pageNumber: item.pageNumber,
          engine: String(item.engine || 'paddleocr').toLowerCase(),
          json: JSON.stringify(item.data),
          now,
        });
      }
    });
    insertMany(items);
  }

  static get(documentId: number, pageNumber: number, engine: string = 'paddleocr') {
    const normalizedEngine = String(engine || 'paddleocr').toLowerCase();
    const row = this.getStmt('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?')
      .get(documentId, pageNumber, normalizedEngine) as { ocr_data: string } | undefined;

    if (row) {
      return JSON.parse(row.ocr_data);
    }

    // Legacy fallback (single cache row per page).
    const legacyRow = this.getStmt('SELECT ocr_data FROM ocr_cache WHERE document_id = ? AND page_number = ?')
      .get(documentId, pageNumber) as { ocr_data: string } | undefined;

    if (!legacyRow) return null;
    const parsed = JSON.parse(legacyRow.ocr_data);
    const legacyEngine = String(parsed?.ocrEngine || 'paddleocr').toLowerCase();
    if (legacyEngine !== normalizedEngine) return null;
    return parsed;
  }

  static clear(documentId: number, pageNumber: number, engine: string = 'paddleocr') {
    const normalizedEngine = String(engine || 'paddleocr').toLowerCase();
    
    // 1. Clear new engine-specific cache
    const res1 = this.getStmt('DELETE FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?')
      .run(documentId, pageNumber, normalizedEngine);
      
    // 2. Clear legacy cache if it matches the current engine
    const legacyRow = this.getStmt('SELECT ocr_data FROM ocr_cache WHERE document_id = ? AND page_number = ?')
      .get(documentId, pageNumber) as { ocr_data: string } | undefined;

    let res2 = { changes: 0 };
    if (legacyRow) {
      try {
        const parsed = JSON.parse(legacyRow.ocr_data);
        const legacyEngine = String(parsed?.ocrEngine || 'paddleocr').toLowerCase();
        if (legacyEngine === normalizedEngine) {
          res2 = this.getStmt('DELETE FROM ocr_cache WHERE document_id = ? AND page_number = ?').run(documentId, pageNumber);
        }
      } catch {
        res2 = this.getStmt('DELETE FROM ocr_cache WHERE document_id = ? AND page_number = ?').run(documentId, pageNumber);
      }
    }
    
    return res1.changes > 0 || res2.changes > 0;
  }

  static getLatestForDocument(documentId: number) {
    if (!this.db) throw new Error('OCRCacheDAO: DB not initialized');
    const engineRow = this.db.prepare(`
      SELECT page_number, ocr_data, updated_at
      FROM ocr_cache_engine
      WHERE document_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(documentId) as { page_number: number; ocr_data: string; updated_at: number } | undefined;

    const legacyRow = this.db.prepare(`
      SELECT page_number, ocr_data, updated_at
      FROM ocr_cache
      WHERE document_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(documentId) as { page_number: number; ocr_data: string; updated_at: number } | undefined;

    const row = (() => {
      if (!engineRow && !legacyRow) return null;
      if (!engineRow) return legacyRow!;
      if (!legacyRow) return engineRow;
      return engineRow.updated_at >= legacyRow.updated_at ? engineRow : legacyRow;
    })();

    if (!row) return null;

    return {
      page_number: row.page_number,
      updated_at: row.updated_at,
      ocr_data: JSON.parse(row.ocr_data)
    };
  }

  static getAggregatedCacheStatsByDocumentIds(documentIds: number[]) {
    if (!this.db) throw new Error('OCRCacheDAO: DB not initialized');
    const ids = documentIds.filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) {
      return [] as Array<{ document_id: number; cache_pages: number; last_cache_update: number | null }>;
    }
    const placeholders = ids.map(() => '?').join(', ');
    return this.db
      .prepare(
        `
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
    `
      )
      .all(...ids) as Array<{ document_id: number; cache_pages: number; last_cache_update: number | null }>;
  }
}

// Alias for backwards compatibility
export const OCRDAO = OCRCacheDAO;
