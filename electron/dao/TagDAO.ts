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

  static getAll(): TagRow[] {
    const stmt = this.getStmt('SELECT * FROM tags ORDER BY name');
    return stmt.all() as TagRow[];
  }

  static create(name: string, color: string = '#6366f1'): TagRow {
    const stmt = this.getStmt('INSERT INTO tags (name, color) VALUES (?, ?) RETURNING *');
    return stmt.get(name, color) as TagRow;
  }

  static update(id: number, data: { name?: string; color?: string }): boolean {
    if (!this.db) throw new Error('TagDAO: DB not initialized');
    const sets: string[] = [];
    const values: any[] = [];
    if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
    if (data.color !== undefined) { sets.push('color = ?'); values.push(data.color); }
    if (sets.length === 0) return true;
    values.push(id);
    this.db.prepare(`UPDATE tags SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return true;
  }

  static delete(id: number): boolean {
    const stmt = this.getStmt('DELETE FROM tags WHERE id = ?');
    return stmt.run(id).changes > 0;
  }

  // Aliases for domain models
  static getAllTags(): TagRow[] {
    return this.getAll();
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
    return this.create(tag.name, tag.color);
  }

  static updateTag(id: number, updates: { name?: string; color?: string }): TagRow | undefined {
    this.update(id, updates);
    return this.getTagById(id);
  }

  static deleteTag(id: number): void {
    this.delete(id);
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
