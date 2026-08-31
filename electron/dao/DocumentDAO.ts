import type Database from 'better-sqlite3-multiple-ciphers';

export interface DocumentRow {
  id: number;
  filepath: string;
  filename: string;
  file_type: string;
  file_size: number;
  total_pages: number;
  thumbnail_path: string | null;
  project_id: number | null;
  is_favorite: number;
  is_thumbnail_hidden: number;
  rating: number;
  last_page: number;
  last_accessed: number | null;
  created_at: number;
}

export class DocumentDAO {
  private static db: Database.Database | null = null;
  private static stmtCache = new Map<string, Database.Statement>();

  static init(database: Database.Database) {
    this.db = database;
    this.stmtCache.clear();
  }

  private static getStmt(sql: string): Database.Statement {
    if (!this.db) throw new Error('DocumentDAO: DB not initialized');
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  static getRecentDocuments(limit = 20): DocumentRow[] {
    const stmt = this.getStmt(`
      SELECT * FROM documents 
      ORDER BY last_accessed DESC, created_at DESC 
      LIMIT ?
    `);
    return stmt.all(limit) as DocumentRow[];
  }

  static getDocumentById(id: number): DocumentRow | undefined {
    const stmt = this.getStmt('SELECT * FROM documents WHERE id = ?');
    return stmt.get(id) as DocumentRow | undefined;
  }

  static getDocumentByPath(filepath: string): DocumentRow | undefined {
    const stmt = this.getStmt('SELECT * FROM documents WHERE filepath = ?');
    return stmt.get(filepath) as DocumentRow | undefined;
  }

  static getDocumentsByProject(projectId: number | null): DocumentRow[] {
    if (projectId === null) {
      const stmt = this.getStmt(`
        SELECT * FROM documents 
        WHERE project_id IS NULL 
        ORDER BY last_accessed DESC, created_at DESC
      `);
      return stmt.all() as DocumentRow[];
    }
    const stmt = this.getStmt(`
      SELECT * FROM documents 
      WHERE project_id = ? 
      ORDER BY last_accessed DESC, created_at DESC
    `);
    return stmt.all(projectId) as DocumentRow[];
  }

  static getFavoriteDocuments(): DocumentRow[] {
    const stmt = this.getStmt(`
      SELECT * FROM documents 
      WHERE is_favorite = 1 
      ORDER BY last_accessed DESC, created_at DESC
    `);
    return stmt.all() as DocumentRow[];
  }

  static searchDocuments(query: string): DocumentRow[] {
    if (!this.db) throw new Error('DB not initialized');
    const trimmed = query.trim();
    if (!trimmed) return [];

    const ftsQuery = trimmed
      .split(/\s+/)
      .map((w) => `"${w.replace(/"/g, '""')}*"` )
      .join(' AND ');

    try {
      const stmt = this.getStmt(`
        SELECT d.* FROM documents d
        JOIN document_search ds ON d.id = ds.document_id
        WHERE document_search MATCH ?
        ORDER BY bm25(document_search), d.last_accessed DESC
      `);
      return stmt.all(ftsQuery) as DocumentRow[];
    } catch {
      const fallbackStmt = this.getStmt(`
        SELECT * FROM documents 
        WHERE filename LIKE ? OR filepath LIKE ?
        ORDER BY last_accessed DESC
      `);
      const likeParam = `%${trimmed}%`;
      return fallbackStmt.all(likeParam, likeParam) as DocumentRow[];
    }
  }

  static insertDocument(doc: {
    filepath: string;
    filename: string;
    file_type?: string;
    file_size?: number;
    total_pages?: number;
    thumbnail_path?: string | null;
    project_id?: number | null;
  }): DocumentRow {
    const now = Date.now();
    const stmt = this.getStmt(`
      INSERT INTO documents (
        filepath, filename, file_type, file_size, total_pages, 
        thumbnail_path, project_id, is_favorite, is_thumbnail_hidden, rating, last_page, last_accessed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 1, ?, ?)
    `);

    const info = stmt.run(
      doc.filepath,
      doc.filename,
      doc.file_type || 'pdf',
      doc.file_size || 0,
      doc.total_pages || 0,
      doc.thumbnail_path || null,
      doc.project_id || null,
      now,
      now
    );

    return this.getDocumentById(Number(info.lastInsertRowid))!;
  }

  static updateLastAccessed(id: number, lastPage?: number): void {
    const now = Date.now();
    if (lastPage !== undefined) {
      const stmt = this.getStmt(`
        UPDATE documents 
        SET last_accessed = ?, last_page = ? 
        WHERE id = ?
      `);
      stmt.run(now, lastPage, id);
    } else {
      const stmt = this.getStmt(`
        UPDATE documents 
        SET last_accessed = ? 
        WHERE id = ?
      `);
      stmt.run(now, id);
    }
  }

  static updateThumbnail(id: number, thumbnailPath: string): void {
    const stmt = this.getStmt('UPDATE documents SET thumbnail_path = ? WHERE id = ?');
    stmt.run(thumbnailPath, id);
  }

  static toggleFavorite(id: number): boolean {
    const doc = this.getDocumentById(id);
    if (!doc) return false;
    const newFav = doc.is_favorite ? 0 : 1;
    const stmt = this.getStmt('UPDATE documents SET is_favorite = ? WHERE id = ?');
    stmt.run(newFav, id);
    return Boolean(newFav);
  }

  static setRating(id: number, rating: number): void {
    const stmt = this.getStmt('UPDATE documents SET rating = ? WHERE id = ?');
    stmt.run(Math.max(0, Math.min(5, rating)), id);
  }

  static toggleThumbnailHidden(id: number): boolean {
    const doc = this.getDocumentById(id);
    if (!doc) return false;
    const newHidden = doc.is_thumbnail_hidden ? 0 : 1;
    const stmt = this.getStmt('UPDATE documents SET is_thumbnail_hidden = ? WHERE id = ?');
    stmt.run(newHidden, id);
    return Boolean(newHidden);
  }

  static moveToProject(documentId: number, projectId: number | null): void {
    const stmt = this.getStmt('UPDATE documents SET project_id = ? WHERE id = ?');
    stmt.run(projectId, documentId);
  }

  static deleteDocument(id: number): void {
    const stmt = this.getStmt('DELETE FROM documents WHERE id = ?');
    stmt.run(id);
  }
}
