import type Database from 'better-sqlite3-multiple-ciphers';

export interface DBGlossaryEntry {
  id?: number;
  source_text: string;
  target_text: string;
  source_lang?: string;
  target_lang?: string;
  type?: 'TERM' | 'SFX';
  is_active?: number | boolean;
  created_at?: number;
  updated_at?: number;
}

export class GlossaryDAO {
  private static db: Database.Database | null = null;
  private static stmtCache = new Map<string, Database.Statement>();

  static init(database: Database.Database) {
    this.db = database;
    this.stmtCache.clear();
  }

  private static getStmt(sql: string): Database.Statement {
    if (!this.db) throw new Error('GlossaryDAO: DB not initialized');
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  static getAll(): DBGlossaryEntry[] {
    if (!this.db) throw new Error('DB not initialized');
    return this.getStmt(`
      SELECT id, source_text, target_text, source_lang, target_lang, type, is_active, created_at, updated_at
      FROM translation_glossary
      ORDER BY updated_at DESC, id DESC
    `).all() as DBGlossaryEntry[];
  }

  static upsert(entry: {
    id?: number;
    sourceText: string;
    targetText: string;
    sourceLang?: string;
    targetLang?: string;
    type?: 'TERM' | 'SFX';
    isActive?: boolean | number;
  }): DBGlossaryEntry {
    if (!this.db) throw new Error('DB not initialized');
    const sourceText = entry.sourceText.trim();
    const targetText = entry.targetText.trim();
    const sourceLang = (entry.sourceLang || 'all').toLowerCase();
    const targetLang = (entry.targetLang || 'th').toLowerCase();
    const type = entry.type || 'TERM';
    const isActive = entry.isActive === undefined ? 1 : (entry.isActive ? 1 : 0);
    const now = Date.now();

    if (entry.id) {
      const stmt = this.getStmt(`
        UPDATE translation_glossary
        SET source_text = ?, target_text = ?, source_lang = ?, target_lang = ?, type = ?, is_active = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(sourceText, targetText, sourceLang, targetLang, type, isActive, now, entry.id);
      return {
        id: entry.id,
        source_text: sourceText,
        target_text: targetText,
        source_lang: sourceLang,
        target_lang: targetLang,
        type,
        is_active: isActive,
        updated_at: now,
      };
    }

    const stmt = this.getStmt(`
      INSERT INTO translation_glossary (source_text, target_text, source_lang, target_lang, type, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_text, source_lang, target_lang, type) DO UPDATE SET
        target_text = excluded.target_text,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
      RETURNING *
    `);
    const row = stmt.get(sourceText, targetText, sourceLang, targetLang, type, isActive, now, now) as DBGlossaryEntry;
    return row;
  }

  static delete(id: number): boolean {
    if (!this.db) throw new Error('DB not initialized');
    const stmt = this.getStmt('DELETE FROM translation_glossary WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  static toggle(id: number, isActive?: boolean): boolean {
    if (!this.db) throw new Error('DB not initialized');
    const now = Date.now();
    if (isActive !== undefined) {
      const stmt = this.getStmt('UPDATE translation_glossary SET is_active = ?, updated_at = ? WHERE id = ?');
      stmt.run(isActive ? 1 : 0, now, id);
    } else {
      const stmt = this.getStmt('UPDATE translation_glossary SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?');
      stmt.run(now, id);
    }
    return true;
  }

  static importBatch(entries: Array<{
    sourceText: string;
    targetText: string;
    sourceLang?: string;
    targetLang?: string;
    type?: 'TERM' | 'SFX';
    isActive?: boolean;
  }>): { inserted: number; updated: number } {
    if (!this.db) throw new Error('DB not initialized');
    if (!entries || entries.length === 0) return { inserted: 0, updated: 0 };

    const now = Date.now();
    let count = 0;
    const insertStmt = this.getStmt(`
      INSERT INTO translation_glossary (source_text, target_text, source_lang, target_lang, type, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_text, source_lang, target_lang, type) DO UPDATE SET
        target_text = excluded.target_text,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `);

    const transaction = this.db.transaction((rows: typeof entries) => {
      for (const row of rows) {
        if (!row.sourceText || !row.targetText) continue;
        const sText = row.sourceText.trim();
        const tText = row.targetText.trim();
        const sLang = (row.sourceLang || 'all').toLowerCase();
        const tLang = (row.targetLang || 'th').toLowerCase();
        const type = row.type || 'TERM';
        const isActive = row.isActive === undefined ? 1 : (row.isActive ? 1 : 0);
        insertStmt.run(sText, tText, sLang, tLang, type, isActive, now, now);
        count++;
      }
    });

    transaction(entries);
    return { inserted: count, updated: 0 };
  }
}
