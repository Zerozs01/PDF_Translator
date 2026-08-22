import Database from 'better-sqlite3-multiple-ciphers';
import path from 'path';
import { app } from 'electron';
import { BenchmarkDAO } from './BenchmarkDAO';
export { BenchmarkDAO };

let db: Database.Database | null = null;

// ─── Prepared Statement Cache ──────────────────────────────────────────────
// Avoid recompiling hot-path SQL on every call (OCR cache read/write, translation cache).
// Statements are lazily compiled once and reused across calls.
const stmtCache = new Map<string, Database.Statement>();

function getStmt(sql: string): Database.Statement {
  if (!db) throw new Error('DB not initialized');
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = db.prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}

// Close Database connection
export function closeDB() {
  if (db) {
    try {
      db.close();
      console.log('[SQLite] Database connection closed successfully');
    } catch (err) {
      console.error('[SQLite] Failed to close database:', err);
    }
    db = null;
    stmtCache.clear();
  }
}

// Initialize Database
export function initDB(key?: string) {
  if (db) return db;

  if (!key) {
    console.warn('[SQLite] Attempted to initialize database without encryption key. Deferring.');
    return null;
  }

  const dbPath = path.join(app.getPath('userData'), 'pdf_translator.db');
  console.log('[SQLite] Database path:', dbPath);

  try {
    db = new Database(dbPath);
    
    // Explicitly configure SQLCipher cipher and apply the encryption key
    db.pragma("cipher='sqlcipher'");
    const escapedKey = key.replace(/'/g, "''");
    db.pragma(`key = '${escapedKey}'`);
    
    // Force SQLite to run a fast query to verify if the key is valid.
    // If the key is wrong, this will throw SQLITE_NOTADB or equivalent error.
    db.pragma('user_version');
    
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

    // 5. Temp store in memory: sort/aggregate ops stay in RAM (no temp file I/O)
    db.pragma('temp_store = MEMORY');

    // 6. Busy timeout: wait up to 5s before throwing SQLITE_BUSY
    //    (guards against rare concurrent IPC access in Electron main process)
    db.pragma('busy_timeout = 5000');

    // 7. Reduce WAL checkpoint frequency: checkpoint every 10 000 pages instead of
    //    the default 1 000 — avoids I/O spikes during heavy OCR batch writes.
    db.pragma('wal_autocheckpoint = 10000');

    // 8. Enforce FK constraints (cascade deletes defined in schema)
    db.pragma('foreign_keys = ON');

    // NEW: Benchmarks table + indexes (Phase 1.3)
// BenchmarkDAO migration complete (Phase 1.3)
db.exec(`
  CREATE TABLE IF NOT EXISTS benchmarks (
    document_id INTEGER NOT NULL,
    page_number INTEGER NOT NULL,
    mode TEXT NOT NULL CHECK(mode IN ('baseline', 'improve')),
    config_hash TEXT NOT NULL,
    results TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    PRIMARY KEY (document_id, page_number, mode, config_hash),
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_benchmarks_doc_page ON benchmarks(document_id, page_number);
  CREATE INDEX IF NOT EXISTS idx_benchmarks_lookup ON benchmarks(document_id, page_number, mode, config_hash);
`);

console.log('[DB] BenchmarkDAO ready');
    BenchmarkDAO.init(db);
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
        rating INTEGER DEFAULT 0,
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

      -- Table for Sentence-level Translation Cache (cross-page deduplication)
      CREATE TABLE IF NOT EXISTS sentence_translation_cache (
        source_text TEXT NOT NULL,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        translator_engine TEXT NOT NULL,
        translation_mode TEXT NOT NULL,
        translated_text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source_text, source_language, target_language, translator_engine, translation_mode)
      );

      -- 🚀 B-Tree Indexes for O(log N) lookup
      CREATE INDEX IF NOT EXISTS idx_documents_filepath ON documents(filepath);
      CREATE INDEX IF NOT EXISTS idx_documents_last_accessed ON documents(last_accessed DESC);
      CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
      CREATE INDEX IF NOT EXISTS idx_documents_favorite ON documents(is_favorite);
      CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);
      CREATE INDEX IF NOT EXISTS idx_sentence_translation_lookup ON sentence_translation_cache(source_text, source_language, target_language, translator_engine);
      CREATE INDEX IF NOT EXISTS idx_ocr_cache_lookup ON ocr_cache(document_id, page_number);
      CREATE INDEX IF NOT EXISTS idx_ocr_cache_engine_lookup ON ocr_cache_engine(document_id, page_number, ocr_engine);
      CREATE INDEX IF NOT EXISTS idx_ocr_cache_engine_latest ON ocr_cache_engine(document_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_translation_cache_lookup ON translation_cache(document_id, page_number, ocr_engine, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
      CREATE INDEX IF NOT EXISTS idx_document_tags_tag_id ON document_tags(tag_id);

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
    `;

    db.exec(schema);

    // Migration: Add rating column to documents table if it doesn't exist
    try {
      db.exec('ALTER TABLE documents ADD COLUMN rating INTEGER DEFAULT 0');
      console.log('[DB] Added column "rating" to documents table');
    } catch (e) {
      // Column probably already exists, which is expected
    }

    try {
      db.exec('ALTER TABLE translation_cache ADD COLUMN width INTEGER DEFAULT 0');
      db.exec('ALTER TABLE translation_cache ADD COLUMN height INTEGER DEFAULT 0');
    } catch (e) {
      // Columns probably already exist
    }

    console.log('[SQLite] Database initialized successfully with WAL, FTS5 & MMap');
    
    return db;
  } catch (err) {
    console.error('[SQLite] Failed to initialize database:', err);
    throw err;
  }
}

// --- Data Access Objects (DAO) ---

type StartupDocumentRow = {
  id: number;
  filepath: string;
  filename: string;
  total_pages: number;
  last_accessed: number | null;
  is_favorite: number;
  project_id: number | null;
  last_page: number;
  file_type: string;
  file_size: number;
};

type StartupDocument = StartupDocumentRow & {
  tag_names: string | null;
  tag_colors: string | null;
};

type StartupTag = {
  id: number;
  name: string;
  color: string;
  created_at: number | null;
};

type StartupProject = {
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
    return db.prepare('DELETE FROM tags WHERE id = ?').run(id);
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

  update: (id: number, data: { name?: string; description?: string; parent_id?: number | null; icon?: string; color?: string }) => {
    if (!db) throw new Error('DB not initialized');
    const sets: string[] = [];
    const values: any[] = [];
    
    if (data.name !== undefined) { sets.push('name = ?'); values.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); values.push(data.description); }
    if (data.parent_id !== undefined) { sets.push('parent_id = ?'); values.push(data.parent_id); }
    if (data.icon !== undefined) { sets.push('icon = ?'); values.push(data.icon); }
    if (data.color !== undefined) { sets.push('color = ?'); values.push(data.color); }
    
    sets.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);
    
    db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return true;
  },

  delete: (id: number) => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  },

  getProjectStats: (projectId: number): ProjectStatsResult => {
    if (!db) throw new Error('DB not initialized');
    
    const project = db.prepare('SELECT id, name FROM projects WHERE id = ?').get(projectId) as { id: number; name: string } | undefined;
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const docRows = db.prepare(`
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
};

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

  clearDocumentCache: (documentId: number) => {
    if (!db) throw new Error('DB not initialized');
    const activeDb = db;
    const clearTx = activeDb.transaction(() => {
      activeDb.prepare('DELETE FROM ocr_cache WHERE document_id = ?').run(documentId);
      activeDb.prepare('DELETE FROM ocr_cache_engine WHERE document_id = ?').run(documentId);
      activeDb.prepare('DELETE FROM translation_cache WHERE document_id = ?').run(documentId);
      activeDb.prepare('DELETE FROM benchmarks WHERE document_id = ?').run(documentId);
      activeDb.prepare('DELETE FROM sentence_translation_cache').run();
    });
    clearTx();
    return true;
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

  getDocumentCacheSize: (documentId: number) => {
    if (!db) throw new Error('DB not initialized');
    const row = db.prepare(`
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
    `).get(documentId, documentId, documentId) as { cache_size: number } | undefined;
    return row ? row.cache_size : 0;
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

  getStartupBatch: (): DocumentStartupBatch => {
    if (!db) throw new Error('DB not initialized');

    const recentDocs = db.prepare(`
      SELECT d.id, d.filepath, d.filename, d.total_pages, d.last_accessed,
             d.is_favorite, d.project_id, d.last_page, d.file_type, d.file_size
      FROM documents d
      ORDER BY d.last_accessed DESC
      LIMIT 50
    `).all() as StartupDocumentRow[];

    const allTags = TagDAO.getAll() as StartupTag[];
    const allProjects = ProjectDAO.getAll() as StartupProject[];
    const latestDoc = db.prepare(`
      SELECT id FROM documents ORDER BY last_accessed DESC LIMIT 1
    `).get() as { id: number } | undefined;
    if (latestDoc) {
      OCRCacheDAO.getLatestForDocument(latestDoc.id);
    }

    const docIds = recentDocs.map(d => d.id);
    let tagMap: Map<number, { names: string[]; colors: string[] }> = new Map();
    if (docIds.length > 0) {
      const placeholders = docIds.map(() => '?').join(', ');
      const tagRows = db.prepare(`
        SELECT dt.document_id, t.name, t.color
        FROM document_tags dt
        JOIN tags t ON t.id = dt.tag_id
        WHERE dt.document_id IN (${placeholders})
        ORDER BY t.name
      `).all(...docIds) as Array<{ document_id: number; name: string; color: string }>;
      for (const row of tagRows) {
        if (!tagMap.has(row.document_id)) {
          tagMap.set(row.document_id, { names: [], colors: [] });
        }
        const entry = tagMap.get(row.document_id)!;
        entry.names.push(row.name);
        entry.colors.push(row.color);
      }
    }

    const hydratedDocs: StartupDocument[] = recentDocs.map(doc => {
      const tags = tagMap.get(doc.id);
      return {
        ...doc,
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
    if (tagId === 0) {
      return db.prepare(`
        SELECT d.*, NULL as tag_names, NULL as tag_colors
        FROM documents d
        LEFT JOIN document_tags dt ON d.id = dt.document_id
        WHERE dt.document_id IS NULL
        ORDER BY d.last_accessed DESC
      `).all();
    }
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

  update: (id: number, data: { filename?: string; project_id?: number | null; thumbnail_path?: string; is_favorite?: boolean; total_pages?: number; rating?: number }) => {
    if (!db) throw new Error('DB not initialized');
    const sets: string[] = [];
    const values: any[] = [];
    
    if (data.filename !== undefined) { sets.push('filename = ?'); values.push(data.filename); }
    if (data.project_id !== undefined) { sets.push('project_id = ?'); values.push(data.project_id); }
    if (data.thumbnail_path !== undefined) { sets.push('thumbnail_path = ?'); values.push(data.thumbnail_path); }
    if (data.is_favorite !== undefined) { sets.push('is_favorite = ?'); values.push(data.is_favorite ? 1 : 0); }
    if (data.total_pages !== undefined) { sets.push('total_pages = ?'); values.push(data.total_pages); }
    if (data.rating !== undefined) { sets.push('rating = ?'); values.push(data.rating); }
    
    if (sets.length === 0) return true;
    values.push(id);
    
    return db.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`).run(...values);
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
    return db.prepare('UPDATE documents SET last_accessed = ? WHERE id = ?').run(Date.now(), id);
  },

  updateLastPage: (id: number, pageNum: number) => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare('UPDATE documents SET last_page = ?, last_accessed = ? WHERE id = ?').run(pageNum, Date.now(), id);
  },

  delete: (id: number) => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  }
};

export const OCRCacheDAO = {
  save: (documentId: number, pageNumber: number, data: any, engine: string = 'tesseract') => {
    if (!db) throw new Error('DB not initialized');
    const normalizedEngine = String(engine || 'tesseract').toLowerCase();
    // Use cached prepared statement to avoid recompiling on every OCR save
    const stmt = getStmt(`
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

  saveBatch: (
    items: Array<{ documentId: number; pageNumber: number; data: any; engine?: string }>
  ) => {
    if (!db) throw new Error('DB not initialized');
    if (!items || items.length === 0) return;
    const now = Date.now();
    const stmt = getStmt(`
      INSERT INTO ocr_cache_engine (document_id, page_number, ocr_engine, ocr_data, updated_at)
      VALUES (@documentId, @pageNumber, @engine, @json, @now)
      ON CONFLICT(document_id, page_number, ocr_engine) DO UPDATE SET
        ocr_data = @json,
        updated_at = @now
    `);
    const insertMany = db.transaction((rows: typeof items) => {
      for (const item of rows) {
        stmt.run({
          documentId: item.documentId,
          pageNumber: item.pageNumber,
          engine: String(item.engine || 'tesseract').toLowerCase(),
          json: JSON.stringify(item.data),
          now,
        });
      }
    });
    insertMany(items);
  },

  get: (documentId: number, pageNumber: number, engine: string = 'tesseract') => {
    if (!db) throw new Error('DB not initialized');
    const normalizedEngine = String(engine || 'tesseract').toLowerCase();
    const row = getStmt('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?')
      .get(documentId, pageNumber, normalizedEngine) as { ocr_data: string } | undefined;

    if (row) {
      return JSON.parse(row.ocr_data);
    }

    // Legacy fallback (single cache row per page).
    const legacyRow = getStmt('SELECT ocr_data FROM ocr_cache WHERE document_id = ? AND page_number = ?')
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
    const res1 = getStmt('DELETE FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?')
      .run(documentId, pageNumber, normalizedEngine);
      
    // 2. Clear legacy cache if it matches the current engine
    const legacyRow = getStmt('SELECT ocr_data FROM ocr_cache WHERE document_id = ? AND page_number = ?')
      .get(documentId, pageNumber) as { ocr_data: string } | undefined;

    let res2 = { changes: 0 };
    if (legacyRow) {
      try {
        const parsed = JSON.parse(legacyRow.ocr_data);
        const legacyEngine = String(parsed?.ocrEngine || 'tesseract').toLowerCase();
        if (legacyEngine === normalizedEngine) {
          res2 = getStmt('DELETE FROM ocr_cache WHERE document_id = ? AND page_number = ?').run(documentId, pageNumber);
        }
      } catch {
        // If unparseable but we are clearing tesseract (default), assume it's okay to delete
        if (normalizedEngine === 'tesseract') {
          res2 = getStmt('DELETE FROM ocr_cache WHERE document_id = ? AND page_number = ?').run(documentId, pageNumber);
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
  },

  /** One round-trip: distinct cached pages + latest update per document (matches findByFilenameWithCacheStats semantics). */
  getAggregatedCacheStatsByDocumentIds: (documentIds: number[]) => {
    if (!db) throw new Error('DB not initialized');
    const ids = documentIds.filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) {
      return [] as Array<{ document_id: number; cache_pages: number; last_cache_update: number | null }>;
    }
    const placeholders = ids.map(() => '?').join(', ');
    return db
      .prepare(
        `
      SELECT document_id,
        CAST(COUNT(*) AS INTEGER) AS cache_pages,
        MAX(updated_at) AS last_cache_update
      FROM (
        SELECT document_id, page_number, MAX(updated_at) AS updated_at
        FROM (
          SELECT document_id, page_number, updated_at FROM ocr_cache
          UNION ALL
          SELECT document_id, page_number, updated_at FROM ocr_cache_engine
        ) merged_cache
        GROUP BY document_id, page_number
      ) per_page
      WHERE document_id IN (${placeholders})
      GROUP BY document_id
    `
      )
      .all(...ids) as Array<{ document_id: number; cache_pages: number; last_cache_update: number | null }>;
  },
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
  translatedByIndex: Array<{ index: number; text: string; sourceText?: string; bbox?: any }>;
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
    // Use cached prepared statement — translation saves happen very frequently
    const stmt = getStmt(`
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

  saveBatch: (
    items: Array<{ documentId: number; pageNumber: number; cacheKey: string; entry: TranslationCacheEntryRecord }>
  ) => {
    if (!db) throw new Error('DB not initialized');
    if (!items || items.length === 0) return;
    const now = Date.now();
    const stmt = getStmt(`
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
    const insertMany = db.transaction((rows: typeof items) => {
      for (const item of rows) {
        const entry = item.entry;
        stmt.run({
          documentId: item.documentId,
          pageNumber: item.pageNumber,
          cacheKey: item.cacheKey,
          ocrEngine: String(entry.ocrEngine || 'tesseract').toLowerCase(),
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
      }
    });
    insertMany(items);
  },

  getByPage: (documentId: number, pageNumber: number) => {
    if (!db) throw new Error('DB not initialized');
    // Cached statement: called on every page load for translation overlay
    const rows = getStmt(`
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

    const hasValidTranslationVersion = (key: string): boolean => {
      const strKey = String(key || '');
      const match = strKey.match(/ver:v(\d+)/);
      if (!match) return false;
      const versionNum = parseInt(match[1], 10);
      return versionNum >= 40;
    };

    return rows
      .filter((row) => hasValidTranslationVersion(row.cache_key))
      .map((row) => {
      let translatedByIndex: Array<{ index: number; text: string; sourceText?: string; bbox?: any }> = [];
      try {
        const parsed = JSON.parse(row.translated_by_index);
        if (Array.isArray(parsed)) {
          translatedByIndex = parsed
            .map((item: any) => {
              const indexVal = item.index !== undefined ? item.index : item.lineIndex;
              const sourceTextVal = item.sourceText !== undefined ? item.sourceText : item.rawText;
              return {
                index: Number(indexVal !== undefined ? indexVal : 0),
                text: String(item.text || ''),
                sourceText: sourceTextVal !== undefined ? String(sourceTextVal) : undefined,
                bbox: item.bbox,
              };
            })
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
    const activeDb = db;
    let changes = 0;

    const clearTx = activeDb.transaction(() => {
      const result = getStmt('DELETE FROM translation_cache WHERE document_id = ? AND page_number = ? AND ocr_engine = ?')
        .run(documentId, pageNumber, normalizedEngine);
      changes = result.changes;
      
      // Clear global sentence cache to force re-translating bad cached translations
      try {
        activeDb.prepare('DELETE FROM sentence_translation_cache').run();
      } catch (err) {
        console.warn('[DB] Failed to clear sentence translation cache:', err);
      }
    });

    clearTx();
    return changes > 0;
  },
};

export const SentenceTranslationDAO = {
  save: (
    sourceText: string,
    sourceLanguage: string,
    targetLanguage: string,
    translatorEngine: string,
    translationMode: string,
    translatedText: string
  ): boolean => {
    if (!db) throw new Error('DB not initialized');
    const now = Date.now();
    try {
      const stmt = getStmt(`
        INSERT INTO sentence_translation_cache (
          source_text,
          source_language,
          target_language,
          translator_engine,
          translation_mode,
          translated_text,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_text, source_language, target_language, translator_engine, translation_mode) DO UPDATE SET
          translated_text = excluded.translated_text,
          created_at = excluded.created_at
      `);
      stmt.run(
        sourceText,
        sourceLanguage.toLowerCase(),
        targetLanguage.toLowerCase(),
        translatorEngine.toLowerCase(),
        translationMode.toLowerCase(),
        translatedText,
        now
      );
      return true;
    } catch (error) {
      console.error('[DB] Failed to save sentence translation:', error);
      return false;
    }
  },

  saveBatch: (
    items: Array<{
      sourceText: string;
      sourceLanguage: string;
      targetLanguage: string;
      translatorEngine: string;
      translationMode: string;
      translatedText: string;
    }>
  ): boolean => {
    if (!db) throw new Error('DB not initialized');
    if (!Array.isArray(items) || items.length === 0) return true;
    const now = Date.now();
    try {
      const stmt = getStmt(`
        INSERT INTO sentence_translation_cache (
          source_text,
          source_language,
          target_language,
          translator_engine,
          translation_mode,
          translated_text,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_text, source_language, target_language, translator_engine, translation_mode) DO UPDATE SET
          translated_text = excluded.translated_text,
          created_at = excluded.created_at
      `);
      const insertMany = db.transaction((entries: typeof items) => {
        for (const entry of entries) {
          stmt.run(
            entry.sourceText,
            entry.sourceLanguage.toLowerCase(),
            entry.targetLanguage.toLowerCase(),
            entry.translatorEngine.toLowerCase(),
            entry.translationMode.toLowerCase(),
            entry.translatedText,
            now
          );
        }
      });
      insertMany(items);
      return true;
    } catch (error) {
      console.error('[DB] Failed to save sentence translations batch:', error);
      return false;
    }
  },

  get: (
    sourceText: string,
    sourceLanguage: string,
    targetLanguage: string,
    translatorEngine: string,
    translationMode: string
  ): string | null => {
    if (!db) throw new Error('DB not initialized');
    try {
      const row = getStmt(`
        SELECT translated_text 
        FROM sentence_translation_cache 
        WHERE source_text = ? 
          AND source_language = ? 
          AND target_language = ? 
          AND translator_engine = ? 
          AND translation_mode = ?
      `).get(
        sourceText,
        sourceLanguage.toLowerCase(),
        targetLanguage.toLowerCase(),
        translatorEngine.toLowerCase(),
        translationMode.toLowerCase()
      ) as { translated_text: string } | undefined;

      return row ? row.translated_text : null;
    } catch (error) {
      console.error('[DB] Failed to get sentence translation:', error);
      return null;
    }
  },

  getBatch: (
    sourceTexts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    translatorEngine: string,
    translationMode: string
  ): Record<string, string> => {
    if (!db) throw new Error('DB not initialized');
    const results: Record<string, string> = {};
    if (sourceTexts.length === 0) return results;
    try {
      const stmt = getStmt(`
        SELECT translated_text 
        FROM sentence_translation_cache 
        WHERE source_text = ? 
          AND source_language = ? 
          AND target_language = ? 
          AND translator_engine = ? 
          AND translation_mode = ?
      `);
      const srcLang = sourceLanguage.toLowerCase();
      const tgtLang = targetLanguage.toLowerCase();
      const engine = translatorEngine.toLowerCase();
      const mode = translationMode.toLowerCase();
      
      for (const text of sourceTexts) {
        const row = stmt.get(text, srcLang, tgtLang, engine, mode) as { translated_text: string } | undefined;
        if (row) {
          results[text] = row.translated_text;
        }
      }
      return results;
    } catch (error) {
      console.error('[DB] Failed to get sentence translations batch:', error);
      return results;
    }
  }
};

// ─── Utility: manual WAL checkpoint ──────────────────────────────────────────
// Call during app-idle or before quit to flush WAL pages to main DB file.
export function checkpointDB(mode: 'PASSIVE' | 'FULL' | 'RESTART' = 'PASSIVE'): void {
  if (!db) return;
  try {
    db.pragma(`wal_checkpoint(${mode})`);
  } catch (err) {
    console.warn('[SQLite] WAL checkpoint failed:', err);
  }
}
