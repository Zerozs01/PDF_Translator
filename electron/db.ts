import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';

let db: Database.Database | null = null;

// Initialize Database
export function initDB() {
  if (db) return db;

  const dbPath = path.join(app.getPath('userData'), 'pdf_translator.db');
  console.log('[SQLite] Database path:', dbPath);

  try {
    db = new Database(dbPath);
    
    // 🚀 Performance Optimization (The "Locus" Magic)
    // 1. WAL Mode: Write-Ahead Logging (Concurrency)
    db.pragma('journal_mode = WAL');
    
    // 2. Synchronous Normal: Faster writes, safe enough for desktop app
    db.pragma('synchronous = NORMAL');
    
    // 3. Cache Size: -64000 pages (~64MB RAM)
    db.pragma('cache_size = -64000');

    // Create Tables with comprehensive schema
    const schema = `
      -- Table for Tags
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        color TEXT DEFAULT '#6366f1',
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      -- Table for Projects (Folders for organizing documents)
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        icon TEXT DEFAULT '📁',
        color TEXT DEFAULT '#6366f1',
        parent_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      -- Table for Documents (Files - Recent Files source)
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filepath TEXT UNIQUE NOT NULL,
        filename TEXT NOT NULL,
        file_type TEXT DEFAULT 'pdf',
        file_size INTEGER DEFAULT 0,
        total_pages INTEGER DEFAULT 0,
        thumbnail_path TEXT,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        is_favorite INTEGER DEFAULT 0,
        last_page INTEGER DEFAULT 1,
        last_accessed INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );

      -- Junction table for Document-Tags (Many-to-Many)
      CREATE TABLE IF NOT EXISTS document_tags (
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (document_id, tag_id)
      );

      -- Table for OCR Cache
      CREATE TABLE IF NOT EXISTS ocr_cache (
        document_id INTEGER,
        page_number INTEGER,
        ocr_data TEXT,
        updated_at INTEGER,
        PRIMARY KEY (document_id, page_number),
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      -- 🚀 B-Tree Indexes for O(log N) lookup
      CREATE INDEX IF NOT EXISTS idx_documents_filepath ON documents(filepath);
      CREATE INDEX IF NOT EXISTS idx_documents_last_accessed ON documents(last_accessed DESC);
      CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
      CREATE INDEX IF NOT EXISTS idx_documents_favorite ON documents(is_favorite);
      CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);
      CREATE INDEX IF NOT EXISTS idx_ocr_cache_lookup ON ocr_cache(document_id, page_number);
      CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

      -- Insert default tags if not exists
      INSERT OR IGNORE INTO tags (name, color) VALUES 
        ('Manga', '#ef4444'),
        ('Document', '#3b82f6'),
        ('Novel', '#8b5cf6'),
        ('Textbook', '#10b981'),
        ('Work', '#f59e0b'),
        ('Personal', '#ec4899');
    `;

    db.exec(schema);
    console.log('[SQLite] Database initialized successfully with WAL & Indexes');
    
    return db;
  } catch (err) {
    console.error('[SQLite] Failed to initialize database:', err);
    throw err;
  }
}

// --- Data Access Objects (DAO) ---

// ===== Tag DAO =====
export const TagDAO = {
  getAll: () => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare('SELECT * FROM tags ORDER BY name').all();
  },

  create: (name: string, color: string = '#6366f1') => {
    if (!db) throw new Error('DB not initialized');
    const stmt = db.prepare('INSERT INTO tags (name, color) VALUES (?, ?) RETURNING *');
    return stmt.get(name, color);
  },

  delete: (id: number) => {
    if (!db) throw new Error('DB not initialized');
    db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  }
};

// ===== Project DAO =====
export const ProjectDAO = {
  getAll: () => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare('SELECT * FROM projects ORDER BY name').all();
  },

  getChildren: (parentId: number | null) => {
    if (!db) throw new Error('DB not initialized');
    if (parentId === null) {
      return db.prepare('SELECT * FROM projects WHERE parent_id IS NULL ORDER BY name').all();
    }
    return db.prepare('SELECT * FROM projects WHERE parent_id = ? ORDER BY name').all(parentId);
  },

  create: (data: { name: string; description?: string; parent_id?: number | null; icon?: string; color?: string }) => {
    if (!db) throw new Error('DB not initialized');
    const stmt = db.prepare(`
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
  },

  update: (id: number, data: { name?: string; description?: string; icon?: string; color?: string }) => {
    if (!db) throw new Error('DB not initialized');
    const sets: string[] = [];
    const values: any[] = [];
    
    if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); values.push(data.description); }
    if (data.icon !== undefined) { sets.push('icon = ?'); values.push(data.icon); }
    if (data.color !== undefined) { sets.push('color = ?'); values.push(data.color); }
    
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    
    db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  delete: (id: number) => {
    if (!db) throw new Error('DB not initialized');
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }
};

// ===== Document DAO =====
export const DocumentDAO = {
  upsert: (filepath: string, filename: string, totalPages: number, fileSize: number = 0, fileType: string = 'pdf') => {
    if (!db) throw new Error('DB not initialized');
    const stmt = db.prepare(`
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
  },

  get: (filepath: string) => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare('SELECT * FROM documents WHERE filepath = ?').get(filepath);
  },

  getById: (id: number) => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
  },

  getRecent: (limit: number = 20) => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare(`
      SELECT d.*, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
      FROM documents d
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      GROUP BY d.id
      ORDER BY d.last_accessed DESC
      LIMIT ?
    `).all(limit);
  },

  getByProject: (projectId: number | null) => {
    if (!db) throw new Error('DB not initialized');
    if (projectId === null) {
      return db.prepare(`
        SELECT d.*, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
        FROM documents d
        LEFT JOIN document_tags dt ON d.id = dt.document_id
        LEFT JOIN tags t ON dt.tag_id = t.id
        WHERE d.project_id IS NULL
        GROUP BY d.id
        ORDER BY d.filename
      `).all();
    }
    return db.prepare(`
      SELECT d.*, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
      FROM documents d
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      WHERE d.project_id = ?
      GROUP BY d.id
      ORDER BY d.filename
    `).all(projectId);
  },

  getFavorites: () => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare(`
      SELECT d.*, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
      FROM documents d
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      WHERE d.is_favorite = 1
      GROUP BY d.id
      ORDER BY d.last_accessed DESC
    `).all();
  },

  search: (query: string) => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare(`
      SELECT d.*, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
      FROM documents d
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      WHERE d.filename LIKE ?
      GROUP BY d.id
      ORDER BY d.last_accessed DESC
    `).all(`%${query}%`);
  },

  updateLastAccessed: (id: number, lastPage: number = 1) => {
    if (!db) throw new Error('DB not initialized');
    db.prepare('UPDATE documents SET last_accessed = ?, last_page = ? WHERE id = ?').run(Date.now(), lastPage, id);
  },

  setFavorite: (id: number, isFavorite: boolean) => {
    if (!db) throw new Error('DB not initialized');
    db.prepare('UPDATE documents SET is_favorite = ? WHERE id = ?').run(isFavorite ? 1 : 0, id);
  },

  setProject: (id: number, projectId: number | null) => {
    if (!db) throw new Error('DB not initialized');
    db.prepare('UPDATE documents SET project_id = ? WHERE id = ?').run(projectId, id);
  },

  addTag: (documentId: number, tagId: number) => {
    if (!db) throw new Error('DB not initialized');
    db.prepare('INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)').run(documentId, tagId);
  },

  removeTag: (documentId: number, tagId: number) => {
    if (!db) throw new Error('DB not initialized');
    db.prepare('DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?').run(documentId, tagId);
  },

  getByTag: (tagId: number) => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare(`
      SELECT d.*, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
      FROM documents d
      JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      WHERE dt.tag_id = ?
      GROUP BY d.id
      ORDER BY d.last_accessed DESC
    `).all(tagId);
  },

  update: (id: number, data: { filename?: string; project_id?: number | null; thumbnail_path?: string; is_favorite?: boolean }) => {
    if (!db) throw new Error('DB not initialized');
    const sets: string[] = [];
    const values: any[] = [];
    
    if (data.filename !== undefined) { sets.push('filename = ?'); values.push(data.filename); }
    if (data.project_id !== undefined) { sets.push('project_id = ?'); values.push(data.project_id); }
    if (data.thumbnail_path !== undefined) { sets.push('thumbnail_path = ?'); values.push(data.thumbnail_path); }
    if (data.is_favorite !== undefined) { sets.push('is_favorite = ?'); values.push(data.is_favorite ? 1 : 0); }
    
    if (sets.length === 0) return;
    values.push(id);
    
    db.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  toggleFavorite: (id: number) => {
    if (!db) throw new Error('DB not initialized');
    const doc = db.prepare('SELECT is_favorite FROM documents WHERE id = ?').get(id) as { is_favorite: number } | undefined;
    if (doc) {
      const newValue = doc.is_favorite ? 0 : 1;
      db.prepare('UPDATE documents SET is_favorite = ? WHERE id = ?').run(newValue, id);
      return newValue === 1;
    }
    return false;
  },

  getTags: (documentId: number) => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare(`
      SELECT t.*
      FROM tags t
      JOIN document_tags dt ON t.id = dt.tag_id
      WHERE dt.document_id = ?
      ORDER BY t.name
    `).all(documentId);
  },

  updateLastPage: (id: number, pageNum: number) => {
    if (!db) throw new Error('DB not initialized');
    db.prepare('UPDATE documents SET last_page = ?, last_accessed = ? WHERE id = ?').run(pageNum, Date.now(), id);
  },

  delete: (id: number) => {
    if (!db) throw new Error('DB not initialized');
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  }
};

export const OCRCacheDAO = {
  save: (documentId: number, pageNumber: number, data: any) => {
    if (!db) throw new Error('DB not initialized');
    const stmt = db.prepare(`
      INSERT INTO ocr_cache (document_id, page_number, ocr_data, updated_at)
      VALUES (@documentId, @pageNumber, @json, @now)
      ON CONFLICT(document_id, page_number) DO UPDATE SET
        ocr_data = @json,
        updated_at = @now
    `);
    stmt.run({
      documentId,
      pageNumber,
      json: JSON.stringify(data),
      now: Date.now()
    });
  },

  get: (documentId: number, pageNumber: number) => {
    if (!db) throw new Error('DB not initialized');
    const row = db.prepare('SELECT ocr_data FROM ocr_cache WHERE document_id = ? AND page_number = ?').get(documentId, pageNumber) as { ocr_data: string } | undefined;
    return row ? JSON.parse(row.ocr_data) : null;
  },

  getLatestForDocument: (documentId: number) => {
    if (!db) throw new Error('DB not initialized');
    const row = db.prepare(`
      SELECT page_number, ocr_data, updated_at
      FROM ocr_cache
      WHERE document_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(documentId) as { page_number: number; ocr_data: string; updated_at: number } | undefined;
    if (!row) return null;
    return {
      page_number: row.page_number,
      updated_at: row.updated_at,
      ocr_data: JSON.parse(row.ocr_data)
    };
  }
};
