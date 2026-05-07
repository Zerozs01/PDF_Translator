import Database from 'better-sqlite3';

let db: Database.Database | null = null;

export const BenchmarkDAO = {
  init: (database: Database.Database) => {
    db = database;
  },

  save: (docId: number, pageNum: number, key: string, jsonPayload: string): boolean => {
    if (!db) return false;
    try {
      const now = Date.now();
      const stmt = db.prepare(`
        INSERT INTO benchmarks (document_id, page_number, config_hash, results, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id, page_number, config_hash)
        DO UPDATE SET results = excluded.results, updated_at = excluded.updated_at
      `);
      return Boolean(stmt.run(docId, pageNum, key, jsonPayload, now, now).changes);
    } catch (err) {
      console.error('[BenchmarkDAO] save error:', err);
      return false;
    }
  },

  get: (docId: number, pageNum: number, key: string): string | null => {
    if (!db) return null;
    try {
      const row = db.prepare(`
        SELECT results FROM benchmarks
        WHERE document_id = ? AND page_number = ? AND config_hash = ?
      `).get(docId, pageNum, key) as { results?: string } | undefined;
      return row?.results ?? null;
    } catch (err) {
      console.error('[BenchmarkDAO] get error:', err);
      return null;
    }
  },

  clear: (docId: number, pageNum: number, key?: string): boolean => {
    if (!db) return false;
    try {
      if (key) {
        const res = db.prepare('DELETE FROM benchmarks WHERE document_id = ? AND page_number = ? AND config_hash = ?').run(docId, pageNum, key);
        return res.changes > 0;
      }
      const res = db.prepare('DELETE FROM benchmarks WHERE document_id = ? AND page_number = ?').run(docId, pageNum);
      return res.changes > 0;
    } catch (err) {
      console.error('[BenchmarkDAO] clear error:', err);
      return false;
    }
  },

  list: (docId: number, pageNum: number): Array<{
    document_id: number;
    page_number: number;
    config_hash: string;
    results: string;
    created_at: number;
    updated_at: number;
  }> => {
    if (!db) return [];
    try {
      return db.prepare(`
        SELECT document_id, page_number, config_hash, results, created_at, updated_at
        FROM benchmarks
        WHERE document_id = ? AND page_number = ?
        ORDER BY updated_at DESC
      `).all(docId, pageNum) as Array<{
        document_id: number;
        page_number: number;
        config_hash: string;
        results: string;
        created_at: number;
        updated_at: number;
      }>;
    } catch (err) {
      console.error('[BenchmarkDAO] list error:', err);
      return [];
    }
  }
};

