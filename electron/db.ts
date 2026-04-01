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
    // 0. Page Size: 4KB is optimal for modern SSD/Filesystems
    db.pragma('page_size = 4096');
    
    // 1. WAL Mode: Write-Ahead Logging (Concurrency)
    db.pragma('journal_mode = WAL');
    
    // 2. Synchronous Normal: Faster writes, safe enough for desktop app
    db.pragma('synchronous = NORMAL');
    
    // 3. Cache Size: -64000 pages (~64MB RAM)
    db.pragma('cache_size = -64000');

    // 4. Memory-Mapped I/O: Map up to 128MB of DB into RAM for instant reads
    db.pragma('mmap_size = 134217728');

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

      -- Table for Document-Tags (Many-to-Many)
      CREATE TABLE IF NOT EXISTS document_tags (
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (document_id, tag_id)
      );

      -- 🚀 FTS5 Search Table (Crow Explorer Pattern)
      -- This table stores a denormalized text blob of (filename + tags) for instant search
      CREATE VIRTUAL TABLE IF NOT EXISTS document_search USING fts5(
        document_id UNINDEXED,
        search_text,
        tokenize='unicode61'
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

      -- Table for OCR Cache (per engine, v2)
      CREATE TABLE IF NOT EXISTS ocr_cache_engine (
        document_id INTEGER,
        page_number INTEGER,
        ocr_engine TEXT NOT NULL,
        ocr_data TEXT,
        updated_at INTEGER,
        PRIMARY KEY (document_id, page_number, ocr_engine),
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      -- Table for Translation Cache (per page/context/engine)
      CREATE TABLE IF NOT EXISTS translation_cache (
        document_id INTEGER NOT NULL,
        page_number INTEGER NOT NULL,
        cache_key TEXT NOT NULL,
        ocr_engine TEXT NOT NULL,
        ocr_language TEXT NOT NULL,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        translation_mode TEXT NOT NULL,
        translator_engine TEXT NOT NULL,
        source_fingerprint TEXT NOT NULL,
        translated_by_index TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        line_count INTEGER DEFAULT 0,
        group_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (document_id, page_number, cache_key),
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      -- 🚀 B-Tree Indexes for O(log N) lookup
      CREATE INDEX IF NOT EXISTS idx_documents_filepath ON documents(filepath);
      CREATE INDEX IF NOT EXISTS idx_documents_last_accessed ON documents(last_accessed DESC);
      CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
      CREATE INDEX IF NOT EXISTS idx_documents_favorite ON documents(is_favorite);
      CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);
      CREATE INDEX IF NOT EXISTS idx_ocr_cache_lookup ON ocr_cache(document_id, page_number);
      CREATE INDEX IF NOT EXISTS idx_ocr_cache_engine_lookup ON ocr_cache_engine(document_id, page_number, ocr_engine);
      CREATE INDEX IF NOT EXISTS idx_ocr_cache_engine_latest ON ocr_cache_engine(document_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_translation_cache_lookup ON translation_cache(document_id, page_number, ocr_engine, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

      -- 🚀 Automatic Search Sync Triggers
      -- Keeps document_search in sync with documents table
      CREATE TRIGGER IF NOT EXISTS trg_documents_insert AFTER INSERT ON documents
      BEGIN
        INSERT INTO document_search(document_id, search_text) 
        VALUES (new.id, new.filename);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_documents_update AFTER UPDATE ON documents
      BEGIN
        UPDATE document_search SET search_text = new.filename WHERE document_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_documents_delete AFTER DELETE ON documents
      BEGIN
        DELETE FROM document_search WHERE document_id = old.id;
      END;

      -- Initial populate of search table if empty (one-time migration)
      INSERT INTO document_search(document_id, search_text)
      SELECT id, filename FROM documents 
      WHERE id NOT IN (SELECT document_id FROM document_search);

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
    console.log('[SQLite] Database initialized successfully with WAL, FTS5 & MMap');
    
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

  findByFilenameWithCacheStats: (filename: string, limit: number = 20) => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare(`
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
    `).all(filename, limit);
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
    const trimmed = query.trim();
    if (!trimmed) return DocumentDAO.getRecent(50);
    
    // FTS5 requires special characters to be quoted. 
    // We sanitize by doubling existing quotes and wrapping the whole term.
    const sanitized = trimmed.replace(/"/g, '""');
    
    return db.prepare(`
      SELECT d.*, GROUP_CONCAT(t.name, ',') as tag_names, GROUP_CONCAT(t.color, ',') as tag_colors
      FROM documents d
      JOIN document_search ds ON d.id = ds.document_id
      LEFT JOIN document_tags dt ON d.id = dt.document_id
      LEFT JOIN tags t ON dt.tag_id = t.id
      WHERE ds.search_text MATCH '"' || ? || '"*'
      GROUP BY d.id
      ORDER BY rank, d.last_accessed DESC
    `).all(sanitized);
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

  update: (id: number, data: { filename?: string; project_id?: number | null; thumbnail_path?: string; is_favorite?: boolean; total_pages?: number }) => {
    if (!db) throw new Error('DB not initialized');
    const sets: string[] = [];
    const values: any[] = [];
    
    if (data.filename !== undefined) { sets.push('filename = ?'); values.push(data.filename); }
    if (data.project_id !== undefined) { sets.push('project_id = ?'); values.push(data.project_id); }
    if (data.thumbnail_path !== undefined) { sets.push('thumbnail_path = ?'); values.push(data.thumbnail_path); }
    if (data.is_favorite !== undefined) { sets.push('is_favorite = ?'); values.push(data.is_favorite ? 1 : 0); }
    if (data.total_pages !== undefined) { sets.push('total_pages = ?'); values.push(data.total_pages); }
    
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

  touch: (id: number) => {
    if (!db) throw new Error('DB not initialized');
    db.prepare('UPDATE documents SET last_accessed = ? WHERE id = ?').run(Date.now(), id);
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
  save: (documentId: number, pageNumber: number, data: any, engine: string = 'tesseract') => {
    if (!db) throw new Error('DB not initialized');
    const normalizedEngine = String(engine || 'tesseract').toLowerCase();
    const stmt = db.prepare(`
      INSERT INTO ocr_cache_engine (document_id, page_number, ocr_engine, ocr_data, updated_at)
      VALUES (@documentId, @pageNumber, @engine, @json, @now)
      ON CONFLICT(document_id, page_number, ocr_engine) DO UPDATE SET
        ocr_data = @json,
        updated_at = @now
    `);
    stmt.run({
      documentId,
      pageNumber,
      engine: normalizedEngine,
      json: JSON.stringify(data),
      now: Date.now()
    });
  },

  get: (documentId: number, pageNumber: number, engine: string = 'tesseract') => {
    if (!db) throw new Error('DB not initialized');
    const normalizedEngine = String(engine || 'tesseract').toLowerCase();
    const row = db
      .prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?')
      .get(documentId, pageNumber, normalizedEngine) as { ocr_data: string } | undefined;

    if (row) {
      return JSON.parse(row.ocr_data);
    }

    // Legacy fallback (single cache row per page).
    const legacyRow = db
      .prepare('SELECT ocr_data FROM ocr_cache WHERE document_id = ? AND page_number = ?')
      .get(documentId, pageNumber) as { ocr_data: string } | undefined;

    if (!legacyRow) return null;
    const parsed = JSON.parse(legacyRow.ocr_data);
    const legacyEngine = String(parsed?.ocrEngine || 'tesseract').toLowerCase();
    if (legacyEngine !== normalizedEngine) return null;
    return parsed;
  },

  clear: (documentId: number, pageNumber: number, engine: string = 'tesseract') => {
    if (!db) throw new Error('DB not initialized');
    const normalizedEngine = String(engine || 'tesseract').toLowerCase();
    
    // 1. Clear new engine-specific cache
    const res1 = db
      .prepare('DELETE FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?')
      .run(documentId, pageNumber, normalizedEngine);
      
    // 2. Clear legacy cache if it matches the current engine
    const legacyRow = db
      .prepare('SELECT ocr_data FROM ocr_cache WHERE document_id = ? AND page_number = ?')
      .get(documentId, pageNumber) as { ocr_data: string } | undefined;

    let res2 = { changes: 0 };
    if (legacyRow) {
      try {
        const parsed = JSON.parse(legacyRow.ocr_data);
        const legacyEngine = String(parsed?.ocrEngine || 'tesseract').toLowerCase();
        if (legacyEngine === normalizedEngine) {
          res2 = db.prepare('DELETE FROM ocr_cache WHERE document_id = ? AND page_number = ?').run(documentId, pageNumber);
        }
      } catch {
        // If unparseable but we are clearing tesseract (default), assume it's okay to delete
        if (normalizedEngine === 'tesseract') {
          res2 = db.prepare('DELETE FROM ocr_cache WHERE document_id = ? AND page_number = ?').run(documentId, pageNumber);
        }
      }
    }
    
    return res1.changes > 0 || res2.changes > 0;
  },

  getLatestForDocument: (documentId: number) => {
    if (!db) throw new Error('DB not initialized');
    const engineRow = db.prepare(`
      SELECT page_number, ocr_data, updated_at
      FROM ocr_cache_engine
      WHERE document_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(documentId) as { page_number: number; ocr_data: string; updated_at: number } | undefined;

    const legacyRow = db.prepare(`
      SELECT page_number, ocr_data, updated_at
      FROM ocr_cache
      WHERE document_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(documentId) as { page_number: number; ocr_data: string; updated_at: number } | undefined;

    const row = (() => {
      if (!engineRow && !legacyRow) return null;
      if (!engineRow) return legacyRow!;
      if (!legacyRow) return engineRow;
      return engineRow.updated_at >= legacyRow.updated_at ? engineRow : legacyRow;
    })();

    if (!row) return null;

    return {
      page_number: row.page_number,
      updated_at: row.updated_at,
      ocr_data: JSON.parse(row.ocr_data)
    };
  }
};

type TranslationCacheEntryRecord = {
  key: string;
  pageNum: number;
  ocrEngine: string;
  ocrLanguage: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationMode: string;
  translatorEngine: string;
  sourceFingerprint: string;
  translatedByIndex: Array<{ index: number; text: string }>;
  translatedText: string;
  lineCount: number;
  groupCount: number;
  createdAt: number;
};

export const TranslationCacheDAO = {
  save: (
    documentId: number,
    pageNumber: number,
    cacheKey: string,
    entry: TranslationCacheEntryRecord
  ) => {
    if (!db) throw new Error('DB not initialized');
    const now = Date.now();
    const normalizedEngine = String(entry.ocrEngine || 'tesseract').toLowerCase();
    const stmt = db.prepare(`
      INSERT INTO translation_cache (
        document_id,
        page_number,
        cache_key,
        ocr_engine,
        ocr_language,
        source_language,
        target_language,
        translation_mode,
        translator_engine,
        source_fingerprint,
        translated_by_index,
        translated_text,
        line_count,
        group_count,
        created_at,
        updated_at
      )
      VALUES (
        @documentId,
        @pageNumber,
        @cacheKey,
        @ocrEngine,
        @ocrLanguage,
        @sourceLanguage,
        @targetLanguage,
        @translationMode,
        @translatorEngine,
        @sourceFingerprint,
        @translatedByIndex,
        @translatedText,
        @lineCount,
        @groupCount,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(document_id, page_number, cache_key) DO UPDATE SET
        ocr_engine = @ocrEngine,
        ocr_language = @ocrLanguage,
        source_language = @sourceLanguage,
        target_language = @targetLanguage,
        translation_mode = @translationMode,
        translator_engine = @translatorEngine,
        source_fingerprint = @sourceFingerprint,
        translated_by_index = @translatedByIndex,
        translated_text = @translatedText,
        line_count = @lineCount,
        group_count = @groupCount,
        created_at = @createdAt,
        updated_at = @updatedAt
    `);

    stmt.run({
      documentId,
      pageNumber,
      cacheKey,
      ocrEngine: normalizedEngine,
      ocrLanguage: String(entry.ocrLanguage || 'eng'),
      sourceLanguage: String(entry.sourceLanguage || 'eng').toLowerCase(),
      targetLanguage: String(entry.targetLanguage || 'th').toLowerCase(),
      translationMode: String(entry.translationMode || 'manga').toLowerCase(),
      translatorEngine: String(entry.translatorEngine || 'offline').toLowerCase(),
      sourceFingerprint: String(entry.sourceFingerprint || ''),
      translatedByIndex: JSON.stringify(Array.isArray(entry.translatedByIndex) ? entry.translatedByIndex : []),
      translatedText: String(entry.translatedText || ''),
      lineCount: Number(entry.lineCount || 0),
      groupCount: Number(entry.groupCount || 0),
      createdAt: Number(entry.createdAt || now),
      updatedAt: now,
    });
  },

  getByPage: (documentId: number, pageNumber: number) => {
    if (!db) throw new Error('DB not initialized');
    const rows = db.prepare(`
      SELECT
        cache_key,
        ocr_engine,
        ocr_language,
        source_language,
        target_language,
        translation_mode,
        translator_engine,
        source_fingerprint,
        translated_by_index,
        translated_text,
        line_count,
        group_count,
        created_at
      FROM translation_cache
      WHERE document_id = ?
        AND page_number = ?
      ORDER BY created_at DESC, updated_at DESC
    `).all(documentId, pageNumber) as Array<{
      cache_key: string;
      ocr_engine: string;
      ocr_language: string;
      source_language: string;
      target_language: string;
      translation_mode: string;
      translator_engine: string;
      source_fingerprint: string;
      translated_by_index: string;
      translated_text: string;
      line_count: number;
      group_count: number;
      created_at: number;
    }>;

    return rows.map((row) => {
      let translatedByIndex: Array<{ index: number; text: string }> = [];
      try {
        const parsed = JSON.parse(row.translated_by_index);
        if (Array.isArray(parsed)) {
          translatedByIndex = parsed
            .map((item) => ({
              index: Number((item as { index?: unknown }).index || 0),
              text: String((item as { text?: unknown }).text || ''),
            }))
            .filter((item) => Number.isFinite(item.index));
        }
      } catch {
        translatedByIndex = [];
      }

      return {
        key: row.cache_key,
        pageNum: pageNumber,
        ocrEngine: row.ocr_engine,
        ocrLanguage: row.ocr_language,
        sourceLanguage: row.source_language,
        targetLanguage: row.target_language,
        translationMode: row.translation_mode,
        translatorEngine: row.translator_engine,
        sourceFingerprint: row.source_fingerprint,
        translatedByIndex,
        translatedText: row.translated_text,
        lineCount: Number(row.line_count || 0),
        groupCount: Number(row.group_count || 0),
        createdAt: Number(row.created_at || Date.now()),
      };
    });
  },

  clearByEngine: (documentId: number, pageNumber: number, engine: string = 'tesseract') => {
    if (!db) throw new Error('DB not initialized');
    const normalizedEngine = String(engine || 'tesseract').toLowerCase();
    const result = db
      .prepare('DELETE FROM translation_cache WHERE document_id = ? AND page_number = ? AND ocr_engine = ?')
      .run(documentId, pageNumber, normalizedEngine);
    return result.changes > 0;
  },
};
