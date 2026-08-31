import type Database from 'better-sqlite3-multiple-ciphers';

export class OCRDAO {
  private static db: Database.Database | null = null;
  private static stmtCache = new Map<string, Database.Statement>();

  static init(database: Database.Database) {
    this.db = database;
    this.stmtCache.clear();
  }

  private static getStmt(sql: string): Database.Statement {
    if (!this.db) throw new Error('OCRDAO: DB not initialized');
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  static getOCR(documentId: number, pageNumber: number): string | null {
    const stmt = this.getStmt(`
      SELECT ocr_data FROM ocr_cache 
      WHERE document_id = ? AND page_number = ?
    `);
    const row = stmt.get(documentId, pageNumber) as { ocr_data: string } | undefined;
    return row ? row.ocr_data : null;
  }

  static setOCR(documentId: number, pageNumber: number, ocrData: string): void {
    const now = Date.now();
    const stmt = this.getStmt(`
      INSERT INTO ocr_cache (document_id, page_number, ocr_data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(document_id, page_number) DO UPDATE SET
        ocr_data = excluded.ocr_data,
        updated_at = excluded.updated_at
    `);
    stmt.run(documentId, pageNumber, ocrData, now);
  }

  static getEngineOCR(documentId: number, pageNumber: number, engine: string): string | null {
    const stmt = this.getStmt(`
      SELECT ocr_data FROM ocr_cache_engine 
      WHERE document_id = ? AND page_number = ? AND ocr_engine = ?
    `);
    const row = stmt.get(documentId, pageNumber, engine) as { ocr_data: string } | undefined;
    return row ? row.ocr_data : null;
  }

  static setEngineOCR(documentId: number, pageNumber: number, engine: string, ocrData: string): void {
    const now = Date.now();
    const stmt = this.getStmt(`
      INSERT INTO ocr_cache_engine (document_id, page_number, ocr_engine, ocr_data, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(document_id, page_number, ocr_engine) DO UPDATE SET
        ocr_data = excluded.ocr_data,
        updated_at = excluded.updated_at
    `);
    stmt.run(documentId, pageNumber, engine, ocrData, now);
  }

  static clearOCR(documentId: number, pageNumber?: number, engine?: string): void {
    if (pageNumber !== undefined && engine !== undefined) {
      this.getStmt('DELETE FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?')
        .run(documentId, pageNumber, engine);
    } else if (pageNumber !== undefined) {
      this.getStmt('DELETE FROM ocr_cache WHERE document_id = ? AND page_number = ?').run(documentId, pageNumber);
      this.getStmt('DELETE FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').run(documentId, pageNumber);
    } else {
      this.getStmt('DELETE FROM ocr_cache WHERE document_id = ?').run(documentId);
      this.getStmt('DELETE FROM ocr_cache_engine WHERE document_id = ?').run(documentId);
    }
  }
}
