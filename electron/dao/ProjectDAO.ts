import type Database from 'better-sqlite3-multiple-ciphers';

export interface ProjectRow {
  id: number;
  name: string;
  description: string | null;
  icon: string;
  color: string;
  parent_id: number | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectStatsResult {
  projectId: number;
  projectName: string;
  totalDocuments: number;
  totalPages: number;
  totalOcrPages: number;
  totalTranslationPages: number;
  totalCacheSizeBytes: number;
  documents: Array<{
    id: number;
    filename: string;
    totalPages: number;
    ocrPages: number;
    translationPages: number;
    cacheSizeBytes: number;
    lastAccessed: number | null;
  }>;
}

export class ProjectDAO {
  private static db: Database.Database | null = null;
  private static stmtCache = new Map<string, Database.Statement>();

  static init(database: Database.Database) {
    this.db = database;
    this.stmtCache.clear();
  }

  private static getStmt(sql: string): Database.Statement {
    if (!this.db) throw new Error('ProjectDAO: DB not initialized');
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  static getAll(): ProjectRow[] {
    const stmt = this.getStmt('SELECT * FROM projects ORDER BY name');
    return stmt.all() as ProjectRow[];
  }

  static getChildren(parentId: number | null): ProjectRow[] {
    if (parentId === null) {
      const stmt = this.getStmt('SELECT * FROM projects WHERE parent_id IS NULL ORDER BY name');
      return stmt.all() as ProjectRow[];
    }
    const stmt = this.getStmt('SELECT * FROM projects WHERE parent_id = ? ORDER BY name');
    return stmt.all(parentId) as ProjectRow[];
  }

  static create(data: { name: string; description?: string; parent_id?: number | null; icon?: string; color?: string }) {
    const stmt = this.getStmt(`
      INSERT INTO projects (name, description, parent_id, icon, color, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    const now = Date.now();
    return stmt.get(
      data.name, 
      data.description || null, 
      data.parent_id || null, 
      data.icon || '📁', 
      data.color || '#6366f1', 
      now, 
      now
    );
  }

  static update(id: number, data: { name?: string; description?: string; parent_id?: number | null; icon?: string; color?: string }): boolean {
    if (!this.db) throw new Error('ProjectDAO: DB not initialized');
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    
    if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); values.push(data.description); }
    if (data.parent_id !== undefined) { sets.push('parent_id = ?'); values.push(data.parent_id); }
    if (data.icon !== undefined) { sets.push('icon = ?'); values.push(data.icon); }
    if (data.color !== undefined) { sets.push('color = ?'); values.push(data.color); }
    
    if (sets.length === 0) return true;

    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    
    this.getStmt(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return true;
  }

  static delete(id: number): boolean {
    const stmt = this.getStmt('DELETE FROM projects WHERE id = ?');
    return stmt.run(id).changes > 0;
  }

  static getProjectStats(projectId: number): ProjectStatsResult {
    if (!this.db) throw new Error('ProjectDAO: DB not initialized');
    
    const project = this.getStmt('SELECT id, name FROM projects WHERE id = ?').get(projectId) as { id: number; name: string } | undefined;
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const docRows = this.getStmt(`
      WITH RECURSIVE project_tree AS (
        SELECT id FROM projects WHERE id = ?
        UNION ALL
        SELECT p.id FROM projects p JOIN project_tree pt ON p.parent_id = pt.id
      ),
      project_docs AS (
        SELECT d.id, d.filename, d.total_pages, d.last_accessed
        FROM documents d
        WHERE d.project_id IN (SELECT id FROM project_tree)
      )
      SELECT 
        d.id,
        d.filename,
        d.total_pages,
        d.last_accessed,
        (SELECT COUNT(DISTINCT page_number) FROM ocr_cache_engine WHERE document_id = d.id) as ocr_pages,
        (SELECT COUNT(DISTINCT page_number) FROM translation_cache WHERE document_id = d.id) as translation_pages,
        (
          (SELECT COALESCE(SUM(LENGTH(ocr_data)), 0) FROM ocr_cache_engine WHERE document_id = d.id) +
          (SELECT COALESCE(SUM(LENGTH(translated_by_index) + LENGTH(translated_text)), 0) FROM translation_cache WHERE document_id = d.id)
        ) as cache_size_bytes
      FROM project_docs d
      ORDER BY d.filename;
    `).all(projectId) as Array<{
      id: number;
      filename: string;
      total_pages: number;
      last_accessed: number | null;
      ocr_pages: number;
      translation_pages: number;
      cache_size_bytes: number;
    }>;

    let totalPages = 0;
    let totalOcrPages = 0;
    let totalTranslationPages = 0;
    let totalCacheSizeBytes = 0;

    const documents = docRows.map((r) => {
      const docTotalPages = Number(r.total_pages || 0);
      const ocrPages = Number(r.ocr_pages || 0);
      const transPages = Number(r.translation_pages || 0);
      const cacheBytes = Number(r.cache_size_bytes || 0);

      totalPages += docTotalPages;
      totalOcrPages += ocrPages;
      totalTranslationPages += transPages;
      totalCacheSizeBytes += cacheBytes;

      return {
        id: r.id,
        filename: r.filename,
        totalPages: docTotalPages,
        ocrPages,
        translationPages: transPages,
        cacheSizeBytes: cacheBytes,
        lastAccessed: r.last_accessed,
      };
    });

    return {
      projectId: project.id,
      projectName: project.name,
      totalDocuments: documents.length,
      totalPages,
      totalOcrPages,
      totalTranslationPages,
      totalCacheSizeBytes,
      documents,
    };
  }

  // Aliases for domain models
  static getAllProjects(): ProjectRow[] {
    return this.getAll();
  }

  static getProjectById(id: number): ProjectRow | undefined {
    const stmt = this.getStmt('SELECT * FROM projects WHERE id = ?');
    return stmt.get(id) as ProjectRow | undefined;
  }

  static getSubprojects(parentId: number | null): ProjectRow[] {
    return this.getChildren(parentId);
  }

  static insertProject(project: {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    parent_id?: number | null;
  }): ProjectRow {
    return this.create(project) as ProjectRow;
  }

  static updateProject(
    id: number,
    updates: {
      name?: string;
      description?: string;
      icon?: string;
      color?: string;
      parent_id?: number | null;
    }
  ): ProjectRow | undefined {
    this.update(id, updates);
    return this.getProjectById(id);
  }
}
