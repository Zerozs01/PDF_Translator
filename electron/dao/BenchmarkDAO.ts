import type Database from 'better-sqlite3-multiple-ciphers';

export type BenchmarkMode = 'baseline' | 'improve';

export interface BenchmarkRecord {
  document_id: number;
  page_number: number;
  mode: BenchmarkMode;
  config_hash: string;
  results: string;
  created_at: number;
  updated_at: number;
}

export class BenchmarkDAO {
  private static db: Database.Database | null = null;
  private static stmtCache = new Map<string, Database.Statement>();

  static init(database: Database.Database) {
    this.db = database;
    this.stmtCache.clear();
  }

  private static getStmt(sql: string): Database.Statement {
    if (!this.db) throw new Error('BenchmarkDAO: DB not initialized');
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  static save(docId: number, pageNum: number, mode: BenchmarkMode, configHash: string, jsonPayload: string): boolean {
    if (!this.db) return false;
    try {
      const now = Date.now();
      const stmt = this.getStmt(`
        INSERT INTO benchmarks (document_id, page_number, mode, config_hash, results, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id, page_number, mode, config_hash)
        DO UPDATE SET results = excluded.results, updated_at = excluded.updated_at
      `);
      return Boolean(stmt.run(docId, pageNum, mode, configHash, jsonPayload, now, now).changes);
    } catch (err) {
      console.error('[BenchmarkDAO] save error:', err);
      return false;
    }
  }

  static get(docId: number, pageNum: number, mode: BenchmarkMode, configHash: string): string | null {
    if (!this.db) return null;
    try {
      const stmt = this.getStmt(`
        SELECT results FROM benchmarks
        WHERE document_id = ? AND page_number = ? AND mode = ? AND config_hash = ?
      `);
      const row = stmt.get(docId, pageNum, mode, configHash) as { results?: string } | undefined;
      return row?.results ?? null;
    } catch (err) {
      console.error('[BenchmarkDAO] get error:', err);
      return null;
    }
  }

  static clear(docId: number, pageNum: number, mode?: BenchmarkMode, configHash?: string): boolean {
    if (!this.db) return false;
    try {
      if (mode && configHash) {
        const stmt = this.getStmt('DELETE FROM benchmarks WHERE document_id = ? AND page_number = ? AND mode = ? AND config_hash = ?');
        const res = stmt.run(docId, pageNum, mode, configHash);
        return res.changes > 0;
      }
      if (mode) {
        const stmt = this.getStmt('DELETE FROM benchmarks WHERE document_id = ? AND page_number = ? AND mode = ?');
        const res = stmt.run(docId, pageNum, mode);
        return res.changes > 0;
      }
      const stmt = this.getStmt('DELETE FROM benchmarks WHERE document_id = ? AND page_number = ?');
      const res = stmt.run(docId, pageNum);
      return res.changes > 0;
    } catch (err) {
      console.error('[BenchmarkDAO] clear error:', err);
      return false;
    }
  }

  static list(docId: number, pageNum: number, mode?: BenchmarkMode): BenchmarkRecord[] {
    if (!this.db) return [];
    try {
      if (mode) {
        const stmt = this.getStmt(`
          SELECT document_id, page_number, mode, config_hash, results, created_at, updated_at
          FROM benchmarks
          WHERE document_id = ? AND page_number = ? AND mode = ?
          ORDER BY updated_at DESC
        `);
        return stmt.all(docId, pageNum, mode) as BenchmarkRecord[];
      }
      const stmt = this.getStmt(`
        SELECT document_id, page_number, mode, config_hash, results, created_at, updated_at
        FROM benchmarks
        WHERE document_id = ? AND page_number = ?
        ORDER BY updated_at DESC
      `);
      return stmt.all(docId, pageNum) as BenchmarkRecord[];
    } catch (err) {
      console.error('[BenchmarkDAO] list error:', err);
      return [];
    }
  }
}
