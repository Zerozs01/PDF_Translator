import type Database from 'better-sqlite3-multiple-ciphers';

export interface TagRow {
  id: number;
  name: string;
  color: string;
  created_at: number;
}

export class TagDAO {
  private static db: Database.Database | null = null;
  private static stmtCache = new Map<string, Database.Statement>();

  static init(database: Database.Database) {
    this.db = database;
    this.stmtCache.clear();
  }

  private static getStmt(sql: string): Database.Statement {
    if (!this.db) throw new Error('TagDAO: DB not initialized');
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  static getAllTags(): TagRow[] {
    const stmt = this.getStmt('SELECT * FROM tags ORDER BY name ASC');
    return stmt.all() as TagRow[];
  }

  static getTagById(id: number): TagRow | undefined {
    const stmt = this.getStmt('SELECT * FROM tags WHERE id = ?');
    return stmt.get(id) as TagRow | undefined;
  }

  static getTagByName(name: string): TagRow | undefined {
    const stmt = this.getStmt('SELECT * FROM tags WHERE name = ?');
    return stmt.get(name) as TagRow | undefined;
  }

  static insertTag(tag: { name: string; color?: string }): TagRow {
    const now = Date.now();
    const stmt = this.getStmt(`
      INSERT INTO tags (name, color, created_at)
      VALUES (?, ?, ?)
    `);

    const info = stmt.run(tag.name, tag.color || '#6366f1', now);
    return this.getTagById(Number(info.lastInsertRowid))!;
  }

  static updateTag(id: number, updates: { name?: string; color?: string }): TagRow | undefined {
    const existing = this.getTagById(id);
    if (!existing) return undefined;

    const name = updates.name !== undefined ? updates.name : existing.name;
    const color = updates.color !== undefined ? updates.color : existing.color;

    const stmt = this.getStmt('UPDATE tags SET name = ?, color = ? WHERE id = ?');
    stmt.run(name, color, id);
    return this.getTagById(id);
  }

  static deleteTag(id: number): void {
    const stmt = this.getStmt('DELETE FROM tags WHERE id = ?');
    stmt.run(id);
  }

  static getTagsForDocument(documentId: number): TagRow[] {
    const stmt = this.getStmt(`
      SELECT t.* FROM tags t
      JOIN document_tags dt ON t.id = dt.tag_id
      WHERE dt.document_id = ?
      ORDER BY t.name ASC
    `);
    return stmt.all(documentId) as TagRow[];
  }

  static addTagToDocument(documentId: number, tagId: number): void {
    const stmt = this.getStmt(`
      INSERT OR IGNORE INTO document_tags (document_id, tag_id)
      VALUES (?, ?)
    `);
    stmt.run(documentId, tagId);
  }

  static removeTagFromDocument(documentId: number, tagId: number): void {
    const stmt = this.getStmt('DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?');
    stmt.run(documentId, tagId);
  }
}
