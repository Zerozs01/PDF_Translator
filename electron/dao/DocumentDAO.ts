import type Database from 'better-sqlite3-multiple-ciphers';
import { TagDAO } from './TagDAO';

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

export type StartupDocumentRow = {
  id: number;
  filepath: string;
  filename: string;
  total_pages: number;
  last_accessed: number | null;
  is_favorite: number;
  is_thumbnail_hidden?: number;
  thumbnail_path?: string | null;
  project_id: number | null;
  last_page: number;
  file_type: string;
  file_size: number;
  rating?: number;
};

export type StartupDocument = StartupDocumentRow & {
  tag_names: string | null;
  tag_colors: string | null;
  tag_ids?: string | null;
};

export type StartupTag = {
  id: number;
  name: string;
  color: string;
  created_at: number | null;
};

export type StartupProject = {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  parent_id: number | null;
  created_at: number | null;
  updated_at: number | null;
};

export type DocumentStartupBatch = {
  recentDocuments: StartupDocument[];
  allTags: StartupTag[];
  allProjects: StartupProject[];
  latestOcrDocId: number | null;
};

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

  static upsert(filepath: string, filename: string, totalPages: number, fileSize: number = 0, fileType: string = 'pdf') {
    const stmt = this.getStmt(`
      INSERT INTO documents (filepath, filename, total_pages, file_size, file_type, last_accessed, created_at)
      VALUES (@filepath, @filename, @totalPages, @fileSize, @fileType, @now, @now)
      ON CONFLICT(filepath) DO UPDATE SET
        last_accessed = @now,
        total_pages = @totalPages,
        file_size = @fileSize
      RETURNING *
    `);
    return stmt.get({ 
      filepath, 
      filename, 
      totalPages,
      fileSize,
      fileType,
      now: Date.now() 
    });
  }

  static get(filepath: string) {
    const stmt = this.getStmt('SELECT * FROM documents WHERE filepath = ?');
    return stmt.get(filepath);
  }

  static getById(id: number) {
    const stmt = this.getStmt('SELECT * FROM documents WHERE id = ?');
    return stmt.get(id);
  }

  static clearDocumentCache(documentId: number): boolean {
    if (!this.db) throw new Error('DocumentDAO: DB not initialized');
    const deleteOcr = this.getStmt('DELETE FROM ocr_cache WHERE document_id = ?');
    const deleteEngine = this.getStmt('DELETE FROM ocr_cache_engine WHERE document_id = ?');
    const deleteTrans = this.getStmt('DELETE FROM translation_cache WHERE document_id = ?');
    const deleteBench = this.getStmt('DELETE FROM benchmarks WHERE document_id = ?');

    const clearTx = this.db.transaction(() => {
      deleteOcr.run(documentId);
      deleteEngine.run(documentId);
      deleteTrans.run(documentId);
      deleteBench.run(documentId);
    });
    clearTx();
    return true;
  }

  static findByFilenameWithCacheStats(filename: string, limit: number = 20) {
    const stmt = this.getStmt(`
      SELECT
        d.id,
        d.filepath,
        d.filename,
        d.total_pages,
        d.last_accessed,
        CAST(COUNT(o.page_number) AS INTEGER) AS cache_pages,
        MAX(o.updated_at) AS last_cache_update
      FROM documents d
      LEFT JOIN (
        SELECT document_id, page_number, MAX(updated_at) AS updated_at
        FROM (
          SELECT document_id, page_number, updated_at FROM ocr_cache
          UNION ALL
          SELECT document_id, page_number, updated_at FROM ocr_cache_engine
        ) merged_cache
        GROUP BY document_id, page_number
      ) o ON o.document_id = d.id
      WHERE d.filename = ?
      GROUP BY d.id
      ORDER BY cache_pages DESC, last_cache_update DESC, d.last_accessed DESC
      LIMIT ?
    `);
    return stmt.all(filename, limit);
  }

  static getDocumentCacheSize(documentId: number): number {
    const stmt = this.getStmt(`
      SELECT (
        SELECT COALESCE(SUM(LENGTH(ocr_data)), 0) 
        FROM ocr_cache_engine 
        WHERE document_id = ?
      ) + (
        SELECT COALESCE(SUM(LENGTH(ocr_data)), 0) 
        FROM ocr_cache 
        WHERE document_id = ?
      ) + (
        SELECT COALESCE(SUM(LENGTH(translated_by_index) + LENGTH(translated_text)), 0) 
        FROM translation_cache 
        WHERE document_id = ?
      ) AS cache_size
    `);
    const row = stmt.get(documentId, documentId, documentId) as { cache_size: number } | undefined;
    return row ? row.cache_size : 0;
  }

  static getRecent(limit: number = 20) {
    const stmt = this.getStmt(`
      SELECT d.*, GROUP_CONCAT(t.id, ',') as tag_ids, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
      FROM documents d
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      GROUP BY d.id
      ORDER BY d.last_accessed DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  static getStartupBatch(): DocumentStartupBatch {
    if (!this.db) throw new Error('DocumentDAO: DB not initialized');

    const recentDocs = this.getStmt(`
      SELECT d.id, d.filepath, d.filename, d.total_pages, d.last_accessed,
             d.is_favorite, d.is_thumbnail_hidden, d.thumbnail_path, d.project_id,
             d.last_page, d.file_type, d.file_size, d.rating
      FROM documents d
      ORDER BY d.last_accessed DESC
      LIMIT 50
    `).all() as StartupDocumentRow[];

    const allTags = TagDAO.getAll() as StartupTag[];
    const allProjects = this.getStmt('SELECT * FROM projects ORDER BY name').all() as StartupProject[];

    const docIds = recentDocs.map(d => d.id);
    const tagMap: Map<number, { ids: number[]; names: string[]; colors: string[] }> = new Map();
    if (docIds.length > 0) {
      const placeholders = docIds.map(() => '?').join(', ');
      const tagRows = this.db.prepare(`
        SELECT dt.document_id, dt.tag_id, t.name, t.color
        FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id IN (${placeholders})
        ORDER BY t.name
      `).all(...docIds) as Array<{ document_id: number; tag_id: number; name: string; color: string }>;
      for (const row of tagRows) {
        if (!tagMap.has(row.document_id)) {
          tagMap.set(row.document_id, { ids: [], names: [], colors: [] });
        }
        const entry = tagMap.get(row.document_id)!;
        entry.ids.push(row.tag_id);
        entry.names.push(row.name);
        entry.colors.push(row.color);
      }
    }

    const hydratedDocs: StartupDocument[] = recentDocs.map(doc => {
      const tags = tagMap.get(doc.id);
      return {
        ...doc,
        tag_ids: tags ? tags.ids.join(',') : null,
        tag_names: tags ? tags.names.join(',') : null,
        tag_colors: tags ? tags.colors.join(',') : null,
      };
    });

    return {
      recentDocuments: hydratedDocs,
      allTags,
      allProjects,
      latestOcrDocId: recentDocs?.[0]?.id ?? null,
    };
  }

  static getByProject(projectId: number | null) {
    if (projectId === null) {
      const stmt = this.getStmt(`
        SELECT d.*, GROUP_CONCAT(t.id, ',') as tag_ids, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
        FROM documents d
        LEFT JOIN document_tags dt ON d.id = dt.document_id
        LEFT JOIN tags t ON dt.tag_id = t.id
        WHERE d.project_id IS NULL
        GROUP BY d.id
        ORDER BY d.filename
      `);
      return stmt.all();
    }
    const stmt = this.getStmt(`
      SELECT d.*, GROUP_CONCAT(t.id, ',') as tag_ids, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
      FROM documents d
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      WHERE d.project_id = ?
      GROUP BY d.id
      ORDER BY d.filename
    `);
    return stmt.all(projectId);
  }

  static getFavorites() {
    const stmt = this.getStmt(`
      SELECT d.*, GROUP_CONCAT(t.id, ',') as tag_ids, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
      FROM documents d
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      WHERE d.is_favorite = 1
      GROUP BY d.id
      ORDER BY d.last_accessed DESC
    `);
    return stmt.all();
  }

  static search(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return this.getRecent(50);
    const sanitized = trimmed.replace(/"/g, '""');
    
    const stmt = this.getStmt(`
      SELECT d.*, GROUP_CONCAT(t.id, ',') as tag_ids, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
      FROM documents d
      JOIN document_search ds ON d.id = ds.document_id
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      WHERE ds.search_text MATCH '"' || ? || '"*'
      GROUP BY d.id
      ORDER BY d.last_accessed DESC
    `);
    return stmt.all(sanitized);
  }

  static updateLastAccessed(id: number, lastPage: number = 1) {
    const stmt = this.getStmt('UPDATE documents SET last_accessed = ?, last_page = ? WHERE id = ?');
    stmt.run(Date.now(), lastPage, id);
  }

  static setFavorite(id: number, isFavorite: boolean) {
    const stmt = this.getStmt('UPDATE documents SET is_favorite = ? WHERE id = ?');
    stmt.run(isFavorite ? 1 : 0, id);
  }

  static setProject(id: number, projectId: number | null) {
    const stmt = this.getStmt('UPDATE documents SET project_id = ? WHERE id = ?');
    stmt.run(projectId, id);
  }

  static addTag(documentId: number, tagId: number) {
    const stmt = this.getStmt('INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)');
    stmt.run(documentId, tagId);
  }

  static removeTag(documentId: number, tagId: number) {
    const stmt = this.getStmt('DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?');
    stmt.run(documentId, tagId);
  }

  static getByTag(tagId: number) {
    if (tagId === 0) {
      const stmt = this.getStmt(`
        SELECT d.*, NULL as tag_names, NULL as tag_colors
        FROM documents d
        LEFT JOIN document_tags dt ON d.id = dt.document_id
        WHERE dt.document_id IS NULL
        ORDER BY d.last_accessed DESC
      `);
      return stmt.all();
    }
    const stmt = this.getStmt(`
      SELECT d.*, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
      FROM documents d
      JOIN document_tags dt ON d.id = dt.document_id
      JOIN tags t ON dt.tag_id = t.id
      WHERE dt.tag_id = ?
      GROUP BY d.id
      ORDER BY d.last_accessed DESC
    `);
    return stmt.all(tagId);
  }

  static update(id: number, data: { filename?: string; project_id?: number | null; thumbnail_path?: string; is_favorite?: boolean; is_thumbnail_hidden?: boolean | number; total_pages?: number; rating?: number }) {
    if (!this.db) throw new Error('DocumentDAO: DB not initialized');
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    
    if (data.filename !== undefined) { sets.push('filename = ?'); values.push(data.filename); }
    if (data.project_id !== undefined) { sets.push('project_id = ?'); values.push(data.project_id); }
    if (data.thumbnail_path !== undefined) { sets.push('thumbnail_path = ?'); values.push(data.thumbnail_path); }
    if (data.is_favorite !== undefined) { sets.push('is_favorite = ?'); values.push(data.is_favorite ? 1 : 0); }
    if (data.is_thumbnail_hidden !== undefined) { sets.push('is_thumbnail_hidden = ?'); values.push(data.is_thumbnail_hidden ? 1 : 0); }
    if (data.total_pages !== undefined) { sets.push('total_pages = ?'); values.push(data.total_pages); }
    if (data.rating !== undefined) { sets.push('rating = ?'); values.push(data.rating); }
    
    if (sets.length === 0) return true;
    values.push(id);
    
    const result = this.getStmt(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return result.changes > 0;
  }

  static toggleThumbnailHidden(id: number): boolean {
    const doc = this.getStmt('SELECT is_thumbnail_hidden FROM documents WHERE id = ?').get(id) as { is_thumbnail_hidden: number } | undefined;
    if (doc) {
      const newValue = doc.is_thumbnail_hidden ? 0 : 1;
      this.getStmt('UPDATE documents SET is_thumbnail_hidden = ? WHERE id = ?').run(newValue, id);
      return newValue === 1;
    }
    return false;
  }

  static toggleFavorite(id: number): boolean {
    const doc = this.getStmt('SELECT is_favorite FROM documents WHERE id = ?').get(id) as { is_favorite: number } | undefined;
    if (doc) {
      const newValue = doc.is_favorite ? 0 : 1;
      this.getStmt('UPDATE documents SET is_favorite = ? WHERE id = ?').run(newValue, id);
      return newValue === 1;
    }
    return false;
  }

  static getTags(documentId: number) {
    const stmt = this.getStmt(`
      SELECT t.*
      FROM tags t
      JOIN document_tags dt ON t.id = dt.tag_id
      WHERE dt.document_id = ?
      ORDER BY t.name
    `);
    return stmt.all(documentId);
  }

  static touch(id: number) {
    const stmt = this.getStmt('UPDATE documents SET last_accessed = ? WHERE id = ?');
    return stmt.run(Date.now(), id);
  }

  static updateLastPage(id: number, pageNum: number) {
    const stmt = this.getStmt('UPDATE documents SET last_page = ?, last_accessed = ? WHERE id = ?');
    return stmt.run(pageNum, Date.now(), id);
  }

  static delete(id: number) {
    const stmt = this.getStmt('DELETE FROM documents WHERE id = ?');
    return stmt.run(id);
  }
}
