"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const child_process = require("child_process");
const Database = require("better-sqlite3");
const os = require("os");
let db = null;
function initDB() {
  if (db) return db;
  const dbPath = path.join(electron.app.getPath("userData"), "pdf_translator.db");
  console.log("[SQLite] Database path:", dbPath);
  try {
    db = new Database(dbPath);
    db.pragma("page_size = 4096");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -64000");
    db.pragma("mmap_size = 134217728");
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
    console.log("[SQLite] Database initialized successfully with WAL, FTS5 & MMap");
    return db;
  } catch (err) {
    console.error("[SQLite] Failed to initialize database:", err);
    throw err;
  }
}
const TagDAO = {
  getAll: () => {
    if (!db) throw new Error("DB not initialized");
    return db.prepare("SELECT * FROM tags ORDER BY name").all();
  },
  create: (name, color = "#6366f1") => {
    if (!db) throw new Error("DB not initialized");
    const stmt = db.prepare("INSERT INTO tags (name, color) VALUES (?, ?) RETURNING *");
    return stmt.get(name, color);
  },
  delete: (id) => {
    if (!db) throw new Error("DB not initialized");
    db.prepare("DELETE FROM tags WHERE id = ?").run(id);
  }
};
const ProjectDAO = {
  getAll: () => {
    if (!db) throw new Error("DB not initialized");
    return db.prepare("SELECT * FROM projects ORDER BY name").all();
  },
  getChildren: (parentId) => {
    if (!db) throw new Error("DB not initialized");
    if (parentId === null) {
      return db.prepare("SELECT * FROM projects WHERE parent_id IS NULL ORDER BY name").all();
    }
    return db.prepare("SELECT * FROM projects WHERE parent_id = ? ORDER BY name").all(parentId);
  },
  create: (data) => {
    if (!db) throw new Error("DB not initialized");
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
      data.icon || "📁",
      data.color || "#6366f1",
      now,
      now
    );
  },
  update: (id, data) => {
    if (!db) throw new Error("DB not initialized");
    const sets = [];
    const values = [];
    if (data.name !== void 0) {
      sets.push("name = ?");
      values.push(data.name);
    }
    if (data.description !== void 0) {
      sets.push("description = ?");
      values.push(data.description);
    }
    if (data.icon !== void 0) {
      sets.push("icon = ?");
      values.push(data.icon);
    }
    if (data.color !== void 0) {
      sets.push("color = ?");
      values.push(data.color);
    }
    sets.push("updated_at = ?");
    values.push(Date.now());
    values.push(id);
    db.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  },
  delete: (id) => {
    if (!db) throw new Error("DB not initialized");
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }
};
const DocumentDAO = {
  upsert: (filepath, filename, totalPages, fileSize = 0, fileType = "pdf") => {
    if (!db) throw new Error("DB not initialized");
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
  get: (filepath) => {
    if (!db) throw new Error("DB not initialized");
    return db.prepare("SELECT * FROM documents WHERE filepath = ?").get(filepath);
  },
  findByFilenameWithCacheStats: (filename, limit = 20) => {
    if (!db) throw new Error("DB not initialized");
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
  getById: (id) => {
    if (!db) throw new Error("DB not initialized");
    return db.prepare("SELECT * FROM documents WHERE id = ?").get(id);
  },
  getRecent: (limit = 20) => {
    if (!db) throw new Error("DB not initialized");
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
  getByProject: (projectId) => {
    if (!db) throw new Error("DB not initialized");
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
    if (!db) throw new Error("DB not initialized");
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
  search: (query) => {
    if (!db) throw new Error("DB not initialized");
    const trimmed = query.trim();
    if (!trimmed) return DocumentDAO.getRecent(50);
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
  updateLastAccessed: (id, lastPage = 1) => {
    if (!db) throw new Error("DB not initialized");
    db.prepare("UPDATE documents SET last_accessed = ?, last_page = ? WHERE id = ?").run(Date.now(), lastPage, id);
  },
  setFavorite: (id, isFavorite) => {
    if (!db) throw new Error("DB not initialized");
    db.prepare("UPDATE documents SET is_favorite = ? WHERE id = ?").run(isFavorite ? 1 : 0, id);
  },
  setProject: (id, projectId) => {
    if (!db) throw new Error("DB not initialized");
    db.prepare("UPDATE documents SET project_id = ? WHERE id = ?").run(projectId, id);
  },
  addTag: (documentId, tagId) => {
    if (!db) throw new Error("DB not initialized");
    db.prepare("INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)").run(documentId, tagId);
  },
  removeTag: (documentId, tagId) => {
    if (!db) throw new Error("DB not initialized");
    db.prepare("DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?").run(documentId, tagId);
  },
  getByTag: (tagId) => {
    if (!db) throw new Error("DB not initialized");
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
  update: (id, data) => {
    if (!db) throw new Error("DB not initialized");
    const sets = [];
    const values = [];
    if (data.filename !== void 0) {
      sets.push("filename = ?");
      values.push(data.filename);
    }
    if (data.project_id !== void 0) {
      sets.push("project_id = ?");
      values.push(data.project_id);
    }
    if (data.thumbnail_path !== void 0) {
      sets.push("thumbnail_path = ?");
      values.push(data.thumbnail_path);
    }
    if (data.is_favorite !== void 0) {
      sets.push("is_favorite = ?");
      values.push(data.is_favorite ? 1 : 0);
    }
    if (data.total_pages !== void 0) {
      sets.push("total_pages = ?");
      values.push(data.total_pages);
    }
    if (sets.length === 0) return;
    values.push(id);
    db.prepare(`UPDATE documents SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  },
  toggleFavorite: (id) => {
    if (!db) throw new Error("DB not initialized");
    const doc = db.prepare("SELECT is_favorite FROM documents WHERE id = ?").get(id);
    if (doc) {
      const newValue = doc.is_favorite ? 0 : 1;
      db.prepare("UPDATE documents SET is_favorite = ? WHERE id = ?").run(newValue, id);
      return newValue === 1;
    }
    return false;
  },
  getTags: (documentId) => {
    if (!db) throw new Error("DB not initialized");
    return db.prepare(`
      SELECT t.*
      FROM tags t
      JOIN document_tags dt ON t.id = dt.tag_id
      WHERE dt.document_id = ?
      ORDER BY t.name
    `).all(documentId);
  },
  touch: (id) => {
    if (!db) throw new Error("DB not initialized");
    db.prepare("UPDATE documents SET last_accessed = ? WHERE id = ?").run(Date.now(), id);
  },
  updateLastPage: (id, pageNum) => {
    if (!db) throw new Error("DB not initialized");
    db.prepare("UPDATE documents SET last_page = ?, last_accessed = ? WHERE id = ?").run(pageNum, Date.now(), id);
  },
  delete: (id) => {
    if (!db) throw new Error("DB not initialized");
    db.prepare("DELETE FROM documents WHERE id = ?").run(id);
  }
};
const OCRCacheDAO = {
  save: (documentId, pageNumber, data, engine = "tesseract") => {
    if (!db) throw new Error("DB not initialized");
    const normalizedEngine = String(engine || "tesseract").toLowerCase();
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
  get: (documentId, pageNumber, engine = "tesseract") => {
    if (!db) throw new Error("DB not initialized");
    const normalizedEngine = String(engine || "tesseract").toLowerCase();
    const row = db.prepare("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?").get(documentId, pageNumber, normalizedEngine);
    if (row) {
      return JSON.parse(row.ocr_data);
    }
    const legacyRow = db.prepare("SELECT ocr_data FROM ocr_cache WHERE document_id = ? AND page_number = ?").get(documentId, pageNumber);
    if (!legacyRow) return null;
    const parsed = JSON.parse(legacyRow.ocr_data);
    const legacyEngine = String(parsed?.ocrEngine || "tesseract").toLowerCase();
    if (legacyEngine !== normalizedEngine) return null;
    return parsed;
  },
  clear: (documentId, pageNumber, engine = "tesseract") => {
    if (!db) throw new Error("DB not initialized");
    const normalizedEngine = String(engine || "tesseract").toLowerCase();
    const res1 = db.prepare("DELETE FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?").run(documentId, pageNumber, normalizedEngine);
    const legacyRow = db.prepare("SELECT ocr_data FROM ocr_cache WHERE document_id = ? AND page_number = ?").get(documentId, pageNumber);
    let res2 = { changes: 0 };
    if (legacyRow) {
      try {
        const parsed = JSON.parse(legacyRow.ocr_data);
        const legacyEngine = String(parsed?.ocrEngine || "tesseract").toLowerCase();
        if (legacyEngine === normalizedEngine) {
          res2 = db.prepare("DELETE FROM ocr_cache WHERE document_id = ? AND page_number = ?").run(documentId, pageNumber);
        }
      } catch {
        if (normalizedEngine === "tesseract") {
          res2 = db.prepare("DELETE FROM ocr_cache WHERE document_id = ? AND page_number = ?").run(documentId, pageNumber);
        }
      }
    }
    return res1.changes > 0 || res2.changes > 0;
  },
  getLatestForDocument: (documentId) => {
    if (!db) throw new Error("DB not initialized");
    const engineRow = db.prepare(`
      SELECT page_number, ocr_data, updated_at
      FROM ocr_cache_engine
      WHERE document_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(documentId);
    const legacyRow = db.prepare(`
      SELECT page_number, ocr_data, updated_at
      FROM ocr_cache
      WHERE document_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(documentId);
    const row = (() => {
      if (!engineRow && !legacyRow) return null;
      if (!engineRow) return legacyRow;
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
const TranslationCacheDAO = {
  save: (documentId, pageNumber, cacheKey, entry) => {
    if (!db) throw new Error("DB not initialized");
    const now = Date.now();
    const normalizedEngine = String(entry.ocrEngine || "tesseract").toLowerCase();
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
      ocrLanguage: String(entry.ocrLanguage || "eng"),
      sourceLanguage: String(entry.sourceLanguage || "eng").toLowerCase(),
      targetLanguage: String(entry.targetLanguage || "th").toLowerCase(),
      translationMode: String(entry.translationMode || "manga").toLowerCase(),
      translatorEngine: String(entry.translatorEngine || "offline").toLowerCase(),
      sourceFingerprint: String(entry.sourceFingerprint || ""),
      translatedByIndex: JSON.stringify(Array.isArray(entry.translatedByIndex) ? entry.translatedByIndex : []),
      translatedText: String(entry.translatedText || ""),
      lineCount: Number(entry.lineCount || 0),
      groupCount: Number(entry.groupCount || 0),
      createdAt: Number(entry.createdAt || now),
      updatedAt: now
    });
  },
  getByPage: (documentId, pageNumber) => {
    if (!db) throw new Error("DB not initialized");
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
    `).all(documentId, pageNumber);
    return rows.map((row) => {
      let translatedByIndex = [];
      try {
        const parsed = JSON.parse(row.translated_by_index);
        if (Array.isArray(parsed)) {
          translatedByIndex = parsed.map((item) => ({
            index: Number(item.index || 0),
            text: String(item.text || "")
          })).filter((item) => Number.isFinite(item.index));
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
        createdAt: Number(row.created_at || Date.now())
      };
    });
  },
  clearByEngine: (documentId, pageNumber, engine = "tesseract") => {
    if (!db) throw new Error("DB not initialized");
    const normalizedEngine = String(engine || "tesseract").toLowerCase();
    const result = db.prepare("DELETE FROM translation_cache WHERE document_id = ? AND page_number = ? AND ocr_engine = ?").run(documentId, pageNumber, normalizedEngine);
    return result.changes > 0;
  }
};
const SUPPORTED_DOCUMENT_EXTENSIONS = /* @__PURE__ */ new Map([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"]
]);
const SUPPORTED_IMPORT_MIME_TYPES = /* @__PURE__ */ new Map([
  ["application/pdf", ".pdf"],
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/tiff", ".tiff"]
]);
const getRequestedDocumentPath = (filepath) => {
  if (!path.isAbsolute(filepath)) {
    throw new Error("Filepath must be absolute");
  }
  if (filepath.includes("\0")) {
    throw new Error("Invalid filepath");
  }
  return path.resolve(filepath);
};
const tryResolveRealDocumentPath = async (filepath) => {
  try {
    return await fs.promises.realpath(filepath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return filepath;
    }
    throw error;
  }
};
const getDocumentMimeType = (filepath) => SUPPORTED_DOCUMENT_EXTENSIONS.get(path.extname(filepath).toLowerCase()) ?? null;
const isPathWithinDirectory = (parentPath, childPath) => {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === "" || !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
};
const inspectExistingDocumentFile = async (filepath) => {
  const requestedPath = getRequestedDocumentPath(filepath);
  const canonicalPath = await tryResolveRealDocumentPath(requestedPath);
  const mimeType = getDocumentMimeType(canonicalPath);
  if (!mimeType) {
    throw new Error("Unsupported file type");
  }
  const stats = await fs.promises.stat(canonicalPath);
  if (!stats.isFile()) {
    throw new Error("Path is not a file");
  }
  return {
    canonicalPath,
    mimeType,
    size: stats.size,
    name: path.basename(canonicalPath)
  };
};
const resolveImportedDocumentName = (name, mimeType) => {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").trim();
  const extFromName = path.extname(safeName).toLowerCase();
  const normalizedMimeType = String(mimeType || "").toLowerCase();
  const fallbackExt = SUPPORTED_IMPORT_MIME_TYPES.get(normalizedMimeType) ?? "";
  const finalExt = SUPPORTED_DOCUMENT_EXTENSIONS.has(extFromName) ? extFromName : fallbackExt;
  const resolvedMimeType = SUPPORTED_DOCUMENT_EXTENSIONS.get(finalExt);
  if (!finalExt || !resolvedMimeType) {
    throw new Error("Unsupported file type");
  }
  const baseName = extFromName ? safeName.slice(0, safeName.length - extFromName.length) : safeName;
  return {
    finalName: `${baseName || "document"}${finalExt}`,
    finalExt,
    resolvedMimeType
  };
};
const EXTERNAL_ENGINES = ["paddleocr", "easyocr"];
const bridgeDaemons = /* @__PURE__ */ new Map();
let externalOcrTempRoot = null;
const BENIGN_BRIDGE_STDERR_PATTERNS = [
  /pin_memory.*no accelerator/i,
  /connectivity check to the model hoster has been skipped/i,
  /creating model:/i,
  /model files already exist/i,
  /no ccache found/i,
  /resized image size .* exceeds max_side_limit/i,
  /info:\s*could not find files for the given pattern/i,
  /lang.*ocr_version.*will be ignored when model names/i
];
function resolveBridgeScriptPath() {
  return electron.app.isPackaged ? path.join(process.resourcesPath, "ocr-bridge", "external_ocr_bridge.py") : path.join(electron.app.getAppPath(), "scripts", "external_ocr_bridge.py");
}
function resolveBridgeScriptSignature(scriptPath) {
  try {
    const stat = fs.statSync(scriptPath);
    return `${scriptPath}:${Math.floor(stat.mtimeMs)}`;
  } catch {
    return `${scriptPath}:unknown`;
  }
}
function normalizePythonOverride(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (/[\\/]/.test(trimmed) || path.isAbsolute(trimmed)) {
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
    return fs.existsSync(resolved) ? resolved : null;
  }
  return trimmed;
}
function findLocalPythonExecutable(roots) {
  const pythonRelativePath = process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"];
  const seen = /* @__PURE__ */ new Set();
  for (const root of roots) {
    if (!root) continue;
    const resolvedRoot = path.resolve(root);
    if (seen.has(resolvedRoot)) continue;
    seen.add(resolvedRoot);
    for (const venvDir of [".venv-ocr", ".venv"]) {
      const candidate = path.join(resolvedRoot, venvDir, ...pythonRelativePath);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}
function resolvePythonExecutable(engine) {
  const engineOverride = engine === "paddleocr" ? normalizePythonOverride(process.env.PADDLE_OCR_PYTHON_PATH) : normalizePythonOverride(process.env.EASY_YOLO_OCR_PYTHON_PATH);
  if (engineOverride) return engineOverride;
  const sharedOverride = normalizePythonOverride(process.env.OCR_PYTHON_PATH);
  if (sharedOverride) return sharedOverride;
  const localVenvPython = findLocalPythonExecutable([
    process.cwd(),
    electron.app.getAppPath(),
    path.resolve(electron.app.getAppPath(), ".."),
    path.resolve(__dirname, ".."),
    path.dirname(process.execPath),
    process.resourcesPath,
    process.resourcesPath ? path.resolve(process.resourcesPath, "..") : null
  ]);
  if (localVenvPython) return localVenvPython;
  return "python";
}
function resolveBridgeEnv() {
  return {
    ...process.env,
    PYTHONUNBUFFERED: "1"
  };
}
function getExternalOcrTempRoot() {
  if (externalOcrTempRoot) {
    return externalOcrTempRoot;
  }
  const tempRoot = path.join(os.tmpdir(), "pdf-translator-ocr");
  fs.mkdirSync(tempRoot, { recursive: true });
  externalOcrTempRoot = tempRoot;
  return tempRoot;
}
function isBenignBridgeStderr(message) {
  const trimmed = message.trim();
  if (!trimmed) return true;
  return BENIGN_BRIDGE_STDERR_PATTERNS.some((pattern) => pattern.test(trimmed));
}
async function runBridgeOnce(engine, args) {
  const scriptPath = resolveBridgeScriptPath();
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`OCR bridge script not found: ${scriptPath}`);
  }
  const pythonCmd = resolvePythonExecutable(engine);
  return await new Promise((resolve, reject) => {
    const child = child_process.spawn(pythonCmd, [scriptPath, ...args], {
      cwd: path.dirname(scriptPath),
      stdio: ["ignore", "pipe", "pipe"],
      env: resolveBridgeEnv(),
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(error);
    });
    child.on("close", (code) => {
      const trimmed = stdout.trim();
      if (code !== 0) {
        reject(new Error(stderr.trim() || trimmed || `OCR bridge exited with code ${code}`));
        return;
      }
      if (!trimmed) {
        reject(new Error(stderr.trim() || "OCR bridge returned an empty response"));
        return;
      }
      try {
        resolve(JSON.parse(trimmed));
      } catch (error) {
        reject(new Error(`Failed to parse OCR bridge response: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}
function teardownDaemon(engine, reason) {
  const daemon = bridgeDaemons.get(engine);
  if (!daemon) return;
  bridgeDaemons.delete(engine);
  for (const [, pending] of daemon.pending) {
    pending.reject(reason ?? new Error(`OCR daemon for ${engine} stopped unexpectedly`));
  }
  daemon.pending.clear();
  if (!daemon.child.killed) {
    daemon.child.kill();
  }
}
function handleDaemonStdout(engine, chunk) {
  const daemon = bridgeDaemons.get(engine);
  if (!daemon) return;
  daemon.stdoutBuffer += chunk.toString();
  const lines = daemon.stdoutBuffer.split(/\r?\n/);
  daemon.stdoutBuffer = lines.pop() ?? "";
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      console.warn(`[ocrBridge] Ignoring non-JSON stdout from ${engine}: ${line}`);
      continue;
    }
    if (!payload.id) {
      console.warn(`[ocrBridge] Ignoring daemon response without request id from ${engine}`);
      continue;
    }
    const pending = daemon.pending.get(payload.id);
    if (!pending) {
      console.warn(`[ocrBridge] Received orphaned daemon response ${payload.id} from ${engine}`);
      continue;
    }
    daemon.pending.delete(payload.id);
    if (payload.ok) {
      pending.resolve(payload);
    } else {
      pending.reject(new Error(payload.reason || `External OCR engine "${engine}" failed`));
    }
  }
}
function ensureDaemon(engine) {
  const scriptPath = resolveBridgeScriptPath();
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`OCR bridge script not found: ${scriptPath}`);
  }
  const scriptSignature = resolveBridgeScriptSignature(scriptPath);
  const existing = bridgeDaemons.get(engine);
  if (existing && !existing.child.killed) {
    if (existing.scriptPath === scriptPath && existing.scriptSignature === scriptSignature) {
      return existing;
    }
    teardownDaemon(engine, new Error(`OCR bridge script changed for ${engine}; restarting daemon`));
  }
  const pythonCmd = resolvePythonExecutable(engine);
  const child = child_process.spawn(pythonCmd, [scriptPath, "--stdio-server", "--action", "ocr", "--engine", engine], {
    cwd: path.dirname(scriptPath),
    stdio: ["pipe", "pipe", "pipe"],
    env: resolveBridgeEnv(),
    windowsHide: true
  });
  const daemon = {
    engine,
    child,
    stdoutBuffer: "",
    pending: /* @__PURE__ */ new Map(),
    scriptPath,
    scriptSignature
  };
  child.stdout.on("data", (chunk) => {
    handleDaemonStdout(engine, chunk);
  });
  child.stderr.on("data", (chunk) => {
    const message = chunk.toString().trim();
    if (message && !isBenignBridgeStderr(message)) {
      console.warn(`[ocrBridge:${engine}] ${message}`);
    }
  });
  child.on("error", (error) => {
    teardownDaemon(engine, error);
  });
  child.on("close", (code, signal) => {
    teardownDaemon(
      engine,
      new Error(`OCR daemon for ${engine} exited (code=${code ?? "null"}, signal=${signal ?? "null"})`)
    );
  });
  bridgeDaemons.set(engine, daemon);
  return daemon;
}
async function requestDaemon(engine, payload) {
  const daemon = ensureDaemon(engine);
  const id = crypto.randomUUID();
  return await new Promise((resolve, reject) => {
    daemon.pending.set(id, { resolve, reject });
    try {
      const stdin = daemon.child.stdin;
      if (!stdin) {
        throw new Error(`OCR daemon stdin is unavailable for ${engine}`);
      }
      stdin.write(`${JSON.stringify({ id, ...payload })}
`);
    } catch (error) {
      daemon.pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
      teardownDaemon(
        engine,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  });
}
function isRecoverableDaemonError(error) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("daemon") || message.includes("stdin is unavailable") || message.includes("parse ocr bridge response");
}
function isNoTextBoxesError(error) {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes("no text boxes returned from paddleocr");
}
function mimeTypeToExtension(mimeType) {
  switch ((mimeType || "").toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/tiff":
      return ".tiff";
    case "image/bmp":
      return ".bmp";
    default:
      return ".png";
  }
}
function coerceImageBuffer(raw) {
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw));
  }
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw);
  }
  throw new Error("Invalid OCR image payload");
}
async function getExternalOcrEngineStatuses() {
  return await Promise.all(EXTERNAL_ENGINES.map(async (engine) => {
    try {
      const response = await runBridgeOnce(engine, ["--action", "status", "--engine", engine]);
      return {
        engine,
        available: Boolean(response.available),
        runtime: response.runtime || (engine === "paddleocr" ? "Python bridge" : "REST/adapter bridge"),
        description: response.description || response.reason || "No status details returned"
      };
    } catch (error) {
      return {
        engine,
        available: false,
        runtime: engine === "paddleocr" ? "Python bridge" : "REST/adapter bridge",
        description: error instanceof Error ? error.message : String(error)
      };
    }
  }));
}
async function runExternalOcr(payload) {
  if (payload.engine !== "paddleocr" && payload.engine !== "easyocr") {
    throw new Error(`Unsupported external OCR engine: ${payload.engine}`);
  }
  const engine = payload.engine;
  const imagePath = path.join(
    getExternalOcrTempRoot(),
    `${engine}-${crypto.randomUUID()}${mimeTypeToExtension(payload.imageMimeType)}`
  );
  try {
    await fs.promises.writeFile(imagePath, coerceImageBuffer(payload.imageData));
    const requestPayload = {
      action: "ocr",
      engine,
      image: imagePath,
      language: payload.language,
      width: Math.round(payload.imageWidth),
      height: Math.round(payload.imageHeight),
      dpi: Math.round(payload.dpi),
      ...typeof payload.pageSegMode === "number" ? { pageSegMode: payload.pageSegMode } : {},
      ...payload.pipelineProfile ? { pipelineProfile: payload.pipelineProfile } : {},
      ...payload.ocrQualityProfile ? { qualityProfile: payload.ocrQualityProfile } : {}
    };
    let response;
    const emptyNoTextResponse = {
      ok: true,
      engine,
      words: [],
      lines: [],
      text: "",
      confidence: 0,
      ...typeof payload.pageSegMode === "number" ? { pageSegMode: payload.pageSegMode } : {},
      debug: {
        dropCounts: {},
        droppedWords: [],
        skipReason: "noTextBoxesFromPaddleOCR"
      }
    };
    try {
      response = await requestDaemon(engine, requestPayload);
    } catch (error) {
      if (isNoTextBoxesError(error)) {
        return emptyNoTextResponse;
      }
      if (!isRecoverableDaemonError(error)) {
        throw error;
      }
      teardownDaemon(
        engine,
        error instanceof Error ? error : new Error(String(error))
      );
      try {
        response = await requestDaemon(engine, requestPayload);
      } catch (retryError) {
        if (isNoTextBoxesError(retryError)) {
          return emptyNoTextResponse;
        }
        throw retryError;
      }
    }
    if (!response.ok) {
      throw new Error(response.reason || `External OCR engine "${engine}" failed`);
    }
    return response;
  } finally {
    await fs.promises.rm(imagePath, { force: true });
  }
}
async function prewarmExternalOcrEngine(engine, language = "eng") {
  const response = await requestDaemon(engine, {
    action: "prewarm",
    engine,
    language
  });
  if (!response.ok) {
    throw new Error(response.reason || `Failed to prewarm external OCR engine "${engine}"`);
  }
  return {
    ok: true,
    engine,
    runtime: response.runtime || "Python bridge",
    description: response.description || `${engine} warmed`
  };
}
function cancelExternalOcr(engine) {
  if (engine) {
    teardownDaemon(engine, new Error(`External OCR canceled for ${engine}`));
    return;
  }
  disposeExternalOcrDaemons();
}
function disposeExternalOcrDaemons() {
  for (const engine of Array.from(bridgeDaemons.keys())) {
    teardownDaemon(engine);
  }
}
const SECURE_SETTINGS_DIR = "secure-settings";
const GEMINI_API_KEY_FILE = "gemini-api-key.bin";
const getSecureSettingsDir = () => {
  return path.join(electron.app.getPath("userData"), SECURE_SETTINGS_DIR);
};
const getGeminiApiKeyFilePath = () => {
  return path.join(getSecureSettingsDir(), GEMINI_API_KEY_FILE);
};
const getEnvironmentGeminiApiKey = () => {
  return String(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || "").trim();
};
const ensureSecureSettingsDir = () => {
  fs.mkdirSync(getSecureSettingsDir(), { recursive: true });
};
const getGeminiApiKeyStatus = () => {
  const secureFilePath = getGeminiApiKeyFilePath();
  if (fs.existsSync(secureFilePath)) {
    return {
      configured: true,
      source: "secure-storage",
      supportsSecureStorage: electron.safeStorage.isEncryptionAvailable()
    };
  }
  if (getEnvironmentGeminiApiKey()) {
    return {
      configured: true,
      source: "environment",
      supportsSecureStorage: electron.safeStorage.isEncryptionAvailable()
    };
  }
  return {
    configured: false,
    source: "none",
    supportsSecureStorage: electron.safeStorage.isEncryptionAvailable()
  };
};
const readStoredGeminiApiKey = () => {
  const secureFilePath = getGeminiApiKeyFilePath();
  if (!fs.existsSync(secureFilePath)) {
    return null;
  }
  if (!electron.safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level secure storage is not available.");
  }
  const encrypted = fs.readFileSync(secureFilePath);
  if (!encrypted || encrypted.length === 0) {
    return null;
  }
  return electron.safeStorage.decryptString(encrypted).trim() || null;
};
const resolveGeminiApiKey = () => {
  const storedKey = readStoredGeminiApiKey();
  if (storedKey) {
    return storedKey;
  }
  const envKey = getEnvironmentGeminiApiKey();
  return envKey || null;
};
const setStoredGeminiApiKey = (apiKey) => {
  const trimmed = String(apiKey || "").trim();
  if (!trimmed) {
    throw new Error("Gemini API key cannot be empty.");
  }
  if (!electron.safeStorage.isEncryptionAvailable()) {
    throw new Error("OS-level secure storage is not available on this device.");
  }
  ensureSecureSettingsDir();
  const encrypted = electron.safeStorage.encryptString(trimmed);
  fs.writeFileSync(getGeminiApiKeyFilePath(), encrypted);
  return getGeminiApiKeyStatus();
};
const clearStoredGeminiApiKey = () => {
  const secureFilePath = getGeminiApiKeyFilePath();
  if (fs.existsSync(secureFilePath)) {
    fs.unlinkSync(secureFilePath);
  }
  return getGeminiApiKeyStatus();
};
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = electron.app.isPackaged ? process.env.DIST : path.join(process.env.DIST, "../public");
let win;
let disposeArgosTranslateRuntime = null;
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
function createWindow() {
  electron.Menu.setApplicationMenu(null);
  win = new electron.BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC || "", "electron-vite.svg"),
    show: false,
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 780,
    autoHideMenuBar: true,
    // Hide menu bar
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      // SECURITY: Explicit security settings
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  });
  win.once("ready-to-show", () => {
    win?.maximize();
    win?.show();
  });
  win.webContents.on("before-input-event", (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === "i" || input.key === "F12") {
      win?.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (VITE_DEV_SERVER_URL && (input.control && input.key.toLowerCase() === "r" || input.key === "F5")) {
      win?.webContents.reload();
      event.preventDefault();
    }
  });
  win.webContents.on("did-finish-load", () => {
    win?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(process.env.DIST || "", "index.html"));
  }
}
electron.app.on("window-all-closed", () => {
  disposeExternalOcrDaemons();
  disposeArgosTranslateRuntime?.();
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
electron.app.on("before-quit", () => {
  disposeExternalOcrDaemons();
  disposeArgosTranslateRuntime?.();
});
electron.app.whenReady().then(() => {
  initDB();
  const isValidString = (value) => typeof value === "string" && value.length > 0 && value.length < 1e4;
  const isValidNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const isValidEngine = (value) => typeof value === "string" && ["tesseract", "paddleocr", "easyocr"].includes(value);
  const getImportsDirectory = () => path.join(electron.app.getPath("userData"), "imports");
  const assertAuthorizedDocumentRead = async (requestedPath, canonicalPath) => {
    const importDir = getImportsDirectory();
    const normalizedImportDir = await fs.promises.realpath(importDir).catch(() => path.resolve(importDir));
    if (isPathWithinDirectory(normalizedImportDir, canonicalPath)) {
      return;
    }
    if (DocumentDAO.get(requestedPath) || DocumentDAO.get(canonicalPath)) {
      return;
    }
    throw new Error("File access denied");
  };
  const ARGOS_LANG_ALIASES = {
    en: "en",
    eng: "en",
    english: "en",
    th: "th",
    tha: "th",
    thai: "th",
    ja: "ja",
    jpn: "ja",
    ko: "ko",
    kor: "ko",
    zh: "zh",
    chi: "zh",
    chi_sim: "zh",
    chi_tra: "zh",
    vi: "vi",
    vie: "vi",
    de: "de",
    deu: "de",
    fr: "fr",
    fra: "fr",
    ru: "ru",
    rus: "ru",
    es: "es",
    spa: "es"
  };
  const LANGUAGE_DISPLAY_NAMES = {
    en: "English",
    th: "Thai",
    ja: "Japanese",
    ko: "Korean",
    zh: "Chinese",
    vi: "Vietnamese",
    de: "German",
    fr: "French",
    ru: "Russian",
    es: "Spanish"
  };
  const normalizeArgosLanguage = (value, fallback) => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return fallback;
    return ARGOS_LANG_ALIASES[raw] || raw.split("-")[0] || fallback;
  };
  const normalizePythonOverride2 = (value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return null;
    if (/[\\/]/.test(trimmed) || path.isAbsolute(trimmed)) {
      const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
      return fs.existsSync(resolved) ? resolved : null;
    }
    return trimmed;
  };
  const findLocalPythonExecutable2 = (roots) => {
    const pythonRelativePath = process.platform === "win32" ? ["Scripts", "python.exe"] : ["bin", "python"];
    const seen = /* @__PURE__ */ new Set();
    for (const root of roots) {
      if (!root) continue;
      const resolvedRoot = path.resolve(root);
      if (seen.has(resolvedRoot)) continue;
      seen.add(resolvedRoot);
      for (const venvDir of [".venv-ocr", ".venv"]) {
        const candidate = path.join(resolvedRoot, venvDir, ...pythonRelativePath);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }
    return null;
  };
  const resolvePythonExecutable2 = () => {
    const argosOverride = normalizePythonOverride2(process.env.ARGOS_PYTHON_PATH);
    if (argosOverride) return argosOverride;
    const appOverride = normalizePythonOverride2(process.env.PDF_TRANSLATOR_PYTHON);
    if (appOverride) return appOverride;
    const sharedOverride = normalizePythonOverride2(process.env.OCR_PYTHON_PATH);
    if (sharedOverride) return sharedOverride;
    const localVenvPython = findLocalPythonExecutable2([
      process.cwd(),
      electron.app.getAppPath(),
      path.resolve(electron.app.getAppPath(), ".."),
      path.resolve(__dirname, ".."),
      path.dirname(process.execPath),
      process.resourcesPath,
      process.resourcesPath ? path.resolve(process.resourcesPath, "..") : null
    ]);
    if (localVenvPython) return localVenvPython;
    const virtualEnv = process.env.VIRTUAL_ENV;
    if (virtualEnv) {
      const windowsPython = path.join(virtualEnv, "Scripts", "python.exe");
      if (fs.existsSync(windowsPython)) return windowsPython;
      const posixPython = path.join(virtualEnv, "bin", "python");
      if (fs.existsSync(posixPython)) return posixPython;
    }
    return process.platform === "win32" ? "python" : "python3";
  };
  const resolveArgosBridgePath = () => {
    const candidates = [
      path.join(process.cwd(), "scripts", "argos_translate_bridge.py"),
      path.join(__dirname, "../scripts/argos_translate_bridge.py"),
      path.join(process.resourcesPath, "ocr-bridge", "argos_translate_bridge.py")
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) {
      throw new Error("Argos bridge script not found. Expected scripts/argos_translate_bridge.py");
    }
    return found;
  };
  const resolveArgosBridgeEnv = () => {
    const userDataRoot = path.join(electron.app.getPath("userData"), "argos-runtime");
    const configHome = process.env.XDG_CONFIG_HOME || path.join(userDataRoot, "config");
    const cacheHome = process.env.XDG_CACHE_HOME || path.join(userDataRoot, "cache");
    fs.mkdirSync(configHome, { recursive: true });
    fs.mkdirSync(cacheHome, { recursive: true });
    const packageDirCandidates = [
      process.env.ARGOS_PACKAGES_DIR,
      process.env.ARGOS_TRANSLATE_PACKAGE_DIR,
      path.join(electron.app.getPath("home"), ".local", "share", "argos-translate", "packages"),
      path.join(userDataRoot, "packages")
    ].filter((candidate) => Boolean(candidate));
    const packageDir = packageDirCandidates.find((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });
    return {
      ...process.env,
      PYTHONUTF8: "1",
      XDG_CONFIG_HOME: configHome,
      XDG_CACHE_HOME: cacheHome,
      ...packageDir ? {
        ARGOS_PACKAGES_DIR: packageDir,
        ARGOS_TRANSLATE_PACKAGE_DIR: packageDir
      } : {}
    };
  };
  const argosBridgeScriptSignature = (bridgePath) => {
    try {
      const stat = fs.statSync(bridgePath);
      return `${bridgePath}:${Math.floor(stat.mtimeMs)}`;
    } catch {
      return `${bridgePath}:unknown`;
    }
  };
  let argosBridgeDaemon = null;
  const teardownArgosDaemon = (reason) => {
    const daemon = argosBridgeDaemon;
    if (!daemon) return;
    argosBridgeDaemon = null;
    for (const [, pending] of daemon.pending) {
      clearTimeout(pending.timeout);
      pending.reject(reason ?? new Error("Argos translation daemon stopped unexpectedly"));
    }
    daemon.pending.clear();
    if (!daemon.child.killed) {
      daemon.child.kill();
    }
  };
  disposeArgosTranslateRuntime = () => {
    teardownArgosDaemon(new Error("Argos translation runtime disposed"));
  };
  const handleArgosDaemonStdout = (chunk) => {
    const daemon = argosBridgeDaemon;
    if (!daemon) return;
    daemon.stdoutBuffer += chunk.toString();
    const lines = daemon.stdoutBuffer.split(/\r?\n/);
    daemon.stdoutBuffer = lines.pop() ?? "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      let payload;
      try {
        payload = JSON.parse(line);
      } catch {
        console.warn(`[argosBridge] Ignoring non-JSON stdout: ${line}`);
        continue;
      }
      if (!payload.id) {
        console.warn("[argosBridge] Ignoring daemon response without request id");
        continue;
      }
      const pending = daemon.pending.get(payload.id);
      if (!pending) {
        console.warn(`[argosBridge] Received orphaned daemon response ${payload.id}`);
        continue;
      }
      daemon.pending.delete(payload.id);
      clearTimeout(pending.timeout);
      if (payload.ok === false) {
        pending.reject(new Error(payload.reason || "Argos translation bridge failed"));
        continue;
      }
      pending.resolve(payload);
    }
  };
  const ensureArgosDaemon = () => {
    const pythonExecutable = resolvePythonExecutable2();
    const bridgePath = resolveArgosBridgePath();
    const bridgeSignature = argosBridgeScriptSignature(bridgePath);
    const env = {
      ...resolveArgosBridgeEnv(),
      // Keep offline translation deterministic and avoid runtime Stanza resource fetches.
      ARGOS_CHUNK_TYPE: process.env.ARGOS_CHUNK_TYPE || "MINISBD"
    };
    if (argosBridgeDaemon && !argosBridgeDaemon.child.killed && argosBridgeDaemon.pythonExecutable === pythonExecutable && argosBridgeDaemon.bridgePath === bridgePath && argosBridgeDaemon.bridgeSignature === bridgeSignature) {
      return argosBridgeDaemon;
    }
    if (argosBridgeDaemon) {
      teardownArgosDaemon(new Error("Argos bridge runtime changed; restarting daemon"));
    }
    const child = child_process.spawn(pythonExecutable, [bridgePath, "--stdio-server"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env
    });
    const daemon = {
      child,
      stdoutBuffer: "",
      pending: /* @__PURE__ */ new Map(),
      pythonExecutable,
      bridgePath,
      bridgeSignature
    };
    child.stdout.on("data", (chunk) => {
      handleArgosDaemonStdout(chunk);
    });
    child.stderr.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        console.warn(`[argosBridge] ${message}`);
      }
    });
    child.on("error", (error) => {
      teardownArgosDaemon(error);
    });
    child.on("close", (code, signal) => {
      teardownArgosDaemon(new Error(`Argos bridge exited (code=${code ?? "null"}, signal=${signal ?? "null"})`));
    });
    argosBridgeDaemon = daemon;
    return daemon;
  };
  const requestArgosDaemon = async (payload, requestTimeoutMs) => {
    const daemon = ensureArgosDaemon();
    const id = crypto.randomUUID();
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        daemon.pending.delete(id);
        teardownArgosDaemon(new Error(`Argos translation timed out after ${requestTimeoutMs}ms`));
        reject(new Error(`Argos translation timed out after ${requestTimeoutMs}ms`));
      }, requestTimeoutMs);
      daemon.pending.set(id, { resolve, reject, timeout });
      try {
        const stdin = daemon.child.stdin;
        if (!stdin) {
          throw new Error("Argos daemon stdin is unavailable");
        }
        stdin.write(`${JSON.stringify({ id, ...payload })}
`);
      } catch (error) {
        daemon.pending.delete(id);
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
        teardownArgosDaemon(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };
  const runArgosTranslateBatch = async (texts, context) => {
    if (!Array.isArray(texts)) {
      throw new Error("Invalid input: texts must be an array");
    }
    if (texts.length === 0) return [];
    const timeoutMs = Math.max(3e3, Math.min(12e4, Number(context?.timeoutMs || 45e3)));
    const sourceLanguage = normalizeArgosLanguage(context?.sourceLanguage, "en");
    const targetLanguage = normalizeArgosLanguage(context?.targetLanguage, "th");
    if (sourceLanguage === targetLanguage) {
      return texts.map((text) => String(text || ""));
    }
    const payload = {
      texts: texts.map((text) => String(text || "")),
      sourceLanguage,
      targetLanguage,
      mode: String(context?.mode || "manga"),
      sourceType: String(context?.sourceType || "text")
    };
    const dedupedTexts = [];
    const dedupeIndexByText = /* @__PURE__ */ new Map();
    const textOrder = [];
    for (const text of payload.texts) {
      const key = String(text);
      const existing = dedupeIndexByText.get(key);
      if (existing !== void 0) {
        textOrder.push(existing);
        continue;
      }
      const nextIndex = dedupedTexts.length;
      dedupeIndexByText.set(key, nextIndex);
      dedupedTexts.push(key);
      textOrder.push(nextIndex);
    }
    const dedupedPayload = {
      ...payload,
      texts: dedupedTexts
    };
    let response;
    try {
      response = await requestArgosDaemon(dedupedPayload, timeoutMs);
    } catch (error) {
      teardownArgosDaemon(
        error instanceof Error ? error : new Error(String(error))
      );
      response = await requestArgosDaemon(dedupedPayload, timeoutMs);
    }
    if (!Array.isArray(response.translations)) {
      throw new Error("Argos translation bridge returned invalid payload");
    }
    const dedupedTranslations = response.translations.map((item) => String(item ?? ""));
    if (dedupedTranslations.length !== dedupedTexts.length) {
      throw new Error(`Argos translation count mismatch: expected ${dedupedTexts.length}, got ${dedupedTranslations.length}`);
    }
    return textOrder.map((index) => dedupedTranslations[index] ?? "");
  };
  electron.ipcMain.handle("db:save-document", async (_, { filepath, filename, totalPages }) => {
    if (!isValidString(filepath) || !isValidString(filename)) {
      throw new Error("Invalid input: filepath and filename must be non-empty strings");
    }
    if (!isValidNumber(totalPages)) {
      throw new Error("Invalid input: totalPages must be a positive number");
    }
    try {
      const requestedPath = getRequestedDocumentPath(filepath);
      const documentFile = await inspectExistingDocumentFile(requestedPath);
      const storagePath = DocumentDAO.get(requestedPath) ? requestedPath : documentFile.canonicalPath;
      const fileType = documentFile.mimeType === "application/pdf" ? "pdf" : "image";
      const row = DocumentDAO.upsert(storagePath, filename, totalPages, documentFile.size, fileType);
      return row?.id ?? 0;
    } catch (error) {
      console.error("db:save-document error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("db:get-document", async (_, filepath) => {
    if (!isValidString(filepath)) {
      throw new Error("Invalid input: filepath must be a non-empty string");
    }
    try {
      const requestedPath = getRequestedDocumentPath(filepath);
      return DocumentDAO.get(requestedPath) ?? DocumentDAO.get(await tryResolveRealDocumentPath(requestedPath));
    } catch (error) {
      console.error("db:get-document error:", error);
      return null;
    }
  });
  electron.ipcMain.handle("db:find-documents-by-filename", async (_, filename) => {
    if (!isValidString(filename)) {
      throw new Error("Invalid input: filename must be a non-empty string");
    }
    try {
      return DocumentDAO.findByFilenameWithCacheStats(filename);
    } catch (error) {
      console.error("db:find-documents-by-filename error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("db:save-ocr", async (_, { docId, pageNum, data, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error("Invalid input: docId and pageNum must be positive numbers");
    }
    try {
      const selectedEngine = isValidEngine(engine) ? engine : isValidEngine(data?.ocrEngine) ? data.ocrEngine : "tesseract";
      OCRCacheDAO.save(docId, pageNum, data, selectedEngine);
      return true;
    } catch (error) {
      console.error("db:save-ocr error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:get-ocr", async (_, { docId, pageNum, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error("Invalid input: docId and pageNum must be positive numbers");
    }
    try {
      const selectedEngine = isValidEngine(engine) ? engine : "tesseract";
      return OCRCacheDAO.get(docId, pageNum, selectedEngine);
    } catch (error) {
      console.error("db:get-ocr error:", error);
      return null;
    }
  });
  electron.ipcMain.handle("db:clear-ocr", async (_, { docId, pageNum, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error("Invalid input: docId and pageNum must be positive numbers");
    }
    try {
      const selectedEngine = isValidEngine(engine) ? engine : "tesseract";
      return OCRCacheDAO.clear(docId, pageNum, selectedEngine);
    } catch (error) {
      console.error("db:clear-ocr error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:get-latest-ocr", async (_, { docId }) => {
    if (!isValidNumber(docId)) {
      throw new Error("Invalid input: docId must be a positive number");
    }
    try {
      return OCRCacheDAO.getLatestForDocument(docId);
    } catch (error) {
      console.error("db:get-latest-ocr error:", error);
      return null;
    }
  });
  electron.ipcMain.handle("db:save-translation-cache", async (_, { docId, pageNum, cacheKey, entry }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error("Invalid input: docId and pageNum must be positive numbers");
    }
    if (!isValidString(cacheKey) || !entry || typeof entry !== "object") {
      throw new Error("Invalid input: cacheKey and entry are required");
    }
    try {
      TranslationCacheDAO.save(docId, pageNum, cacheKey, entry);
      return true;
    } catch (error) {
      console.error("db:save-translation-cache error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:get-translation-cache-page", async (_, { docId, pageNum }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error("Invalid input: docId and pageNum must be positive numbers");
    }
    try {
      return TranslationCacheDAO.getByPage(docId, pageNum);
    } catch (error) {
      console.error("db:get-translation-cache-page error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("db:clear-translation-cache-by-engine", async (_, { docId, pageNum, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error("Invalid input: docId and pageNum must be positive numbers");
    }
    try {
      const selectedEngine = isValidEngine(engine) ? engine : "tesseract";
      return TranslationCacheDAO.clearByEngine(docId, pageNum, selectedEngine);
    } catch (error) {
      console.error("db:clear-translation-cache-by-engine error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:get-recent-documents", async (_, limit = 50) => {
    try {
      return DocumentDAO.getRecent(limit);
    } catch (error) {
      console.error("db:get-recent-documents error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("db:get-documents-by-project", async (_, projectId) => {
    try {
      return DocumentDAO.getByProject(projectId);
    } catch (error) {
      console.error("db:get-documents-by-project error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("db:get-favorite-documents", async () => {
    try {
      return DocumentDAO.getFavorites();
    } catch (error) {
      console.error("db:get-favorite-documents error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("db:search-documents", async (_, query) => {
    if (!isValidString(query)) {
      return [];
    }
    try {
      return DocumentDAO.search(query);
    } catch (error) {
      console.error("db:search-documents error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("db:update-document", async (_, { id, updates }) => {
    if (!isValidNumber(id)) {
      throw new Error("Invalid input: id must be a positive number");
    }
    try {
      return DocumentDAO.update(id, updates);
    } catch (error) {
      console.error("db:update-document error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:delete-document", async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error("Invalid input: id must be a positive number");
    }
    try {
      return DocumentDAO.delete(id);
    } catch (error) {
      console.error("db:delete-document error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:toggle-favorite", async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error("Invalid input: id must be a positive number");
    }
    try {
      return DocumentDAO.toggleFavorite(id);
    } catch (error) {
      console.error("db:toggle-favorite error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("fs:open-file", async () => {
    try {
      const result = await electron.dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [
          { name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg", "tif", "tiff"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      const filepath = result.filePaths[0];
      const documentFile = await inspectExistingDocumentFile(filepath);
      const buffer = await fs.promises.readFile(documentFile.canonicalPath);
      return {
        filepath: documentFile.canonicalPath,
        data: buffer,
        mimeType: documentFile.mimeType,
        size: documentFile.size,
        name: documentFile.name
      };
    } catch (error) {
      console.error("fs:open-file error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("fs:read-file", async (_, filepath) => {
    if (!isValidString(filepath)) {
      throw new Error("Invalid filepath");
    }
    try {
      const requestedPath = getRequestedDocumentPath(filepath);
      const documentFile = await inspectExistingDocumentFile(requestedPath);
      await assertAuthorizedDocumentRead(requestedPath, documentFile.canonicalPath);
      const buffer = await fs.promises.readFile(documentFile.canonicalPath);
      return {
        data: buffer,
        mimeType: documentFile.mimeType,
        size: documentFile.size,
        name: documentFile.name
      };
    } catch (error) {
      console.error("fs:read-file error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("fs:import-file", async (_event, payload) => {
    try {
      if (!payload || typeof payload.name !== "string" || !payload.name) {
        throw new Error("Invalid payload: name is required");
      }
      const rawData = payload.data instanceof ArrayBuffer ? new Uint8Array(payload.data) : payload.data;
      if (!(rawData instanceof Uint8Array)) {
        throw new Error("Invalid payload: data must be Uint8Array or ArrayBuffer");
      }
      const { finalName, finalExt, resolvedMimeType } = resolveImportedDocumentName(
        payload.name,
        payload.mimeType
      );
      const importDir = getImportsDirectory();
      await fs.promises.mkdir(importDir, { recursive: true });
      const contentHash = crypto.createHash("sha256").update(Buffer.from(rawData)).digest("hex").slice(0, 24);
      const hashedPath = path.join(importDir, `${contentHash}${finalExt}`);
      let targetPath = hashedPath;
      if (!fs.existsSync(hashedPath)) {
        try {
          const entries = await fs.promises.readdir(importDir, { withFileTypes: true });
          const candidates = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).filter((name) => {
            if (name === path.basename(hashedPath)) return false;
            if (name.endsWith(`-${finalName}`)) return true;
            if (!finalExt) return true;
            return path.extname(name).toLowerCase() === finalExt.toLowerCase();
          });
          for (const name of candidates) {
            const candidatePath = path.join(importDir, name);
            let stats2;
            try {
              stats2 = await fs.promises.stat(candidatePath);
            } catch {
              continue;
            }
            if (stats2.size !== rawData.byteLength) continue;
            try {
              const candidateBytes = await fs.promises.readFile(candidatePath);
              const candidateHash = crypto.createHash("sha256").update(candidateBytes).digest("hex").slice(0, 24);
              if (candidateHash === contentHash) {
                targetPath = candidatePath;
                break;
              }
            } catch {
            }
          }
        } catch {
        }
      }
      if (!fs.existsSync(targetPath)) {
        await fs.promises.writeFile(targetPath, Buffer.from(rawData));
      }
      const stats = await fs.promises.stat(targetPath);
      return {
        filepath: targetPath,
        mimeType: resolvedMimeType,
        size: stats.size,
        name: finalName
      };
    } catch (error) {
      console.error("fs:import-file error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("ocr:get-engine-status", async () => {
    try {
      return await getExternalOcrEngineStatuses();
    } catch (error) {
      console.error("ocr:get-engine-status error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("ocr:prewarm-engine", async (_, payload) => {
    if (!payload || typeof payload !== "object" || !isValidString(payload.engine)) {
      throw new Error("Invalid OCR prewarm payload");
    }
    if (payload.engine !== "paddleocr" && payload.engine !== "easyocr") {
      throw new Error(`Unsupported OCR engine: ${payload.engine}`);
    }
    try {
      return await prewarmExternalOcrEngine(payload.engine, isValidString(payload.language) ? payload.language : "eng");
    } catch (error) {
      console.error("ocr:prewarm-engine error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("ocr:run-external", async (_, payload) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("Invalid OCR payload");
    }
    if (!isValidString(payload.engine) || !isValidString(payload.imageMimeType) || !isValidString(payload.language)) {
      throw new Error("Invalid OCR payload: engine, imageMimeType, and language are required");
    }
    if (!isValidNumber(payload.imageWidth) || !isValidNumber(payload.imageHeight) || !isValidNumber(payload.dpi)) {
      throw new Error("Invalid OCR payload: imageWidth, imageHeight, and dpi must be positive numbers");
    }
    try {
      return await runExternalOcr(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/External OCR canceled for (paddleocr|easyocr)/i.test(message)) {
        console.warn(`ocr:run-external canceled: ${message}`);
      } else {
        console.error("ocr:run-external error:", error);
      }
      throw error;
    }
  });
  electron.ipcMain.handle("ocr:cancel-external", async (_, payload) => {
    try {
      const engine = payload?.engine;
      if (engine && engine !== "paddleocr" && engine !== "easyocr") {
        throw new Error(`Unsupported OCR engine: ${engine}`);
      }
      cancelExternalOcr(engine);
      return true;
    } catch (error) {
      console.error("ocr:cancel-external error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:get-documents-by-tag", async (_, tagId) => {
    if (!isValidNumber(tagId)) {
      throw new Error("Invalid input: tagId must be a positive number");
    }
    try {
      return DocumentDAO.getByTag(tagId);
    } catch (error) {
      console.error("db:get-documents-by-tag error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("db:add-document-tag", async (_, { documentId, tagId }) => {
    if (!isValidNumber(documentId) || !isValidNumber(tagId)) {
      throw new Error("Invalid input: documentId and tagId must be positive numbers");
    }
    try {
      return DocumentDAO.addTag(documentId, tagId);
    } catch (error) {
      console.error("db:add-document-tag error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:remove-document-tag", async (_, { documentId, tagId }) => {
    if (!isValidNumber(documentId) || !isValidNumber(tagId)) {
      throw new Error("Invalid input: documentId and tagId must be positive numbers");
    }
    try {
      return DocumentDAO.removeTag(documentId, tagId);
    } catch (error) {
      console.error("db:remove-document-tag error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:get-document-tags", async (_, documentId) => {
    if (!isValidNumber(documentId)) {
      throw new Error("Invalid input: documentId must be a positive number");
    }
    try {
      return DocumentDAO.getTags(documentId);
    } catch (error) {
      console.error("db:get-document-tags error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("db:touch-document", async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error("Invalid input: id must be a positive number");
    }
    try {
      DocumentDAO.touch(id);
      return true;
    } catch (error) {
      console.error("db:touch-document error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:update-last-page", async (_, { id, pageNum }) => {
    if (!isValidNumber(id) || !isValidNumber(pageNum)) {
      throw new Error("Invalid input: id and pageNum must be positive numbers");
    }
    try {
      return DocumentDAO.updateLastPage(id, pageNum);
    } catch (error) {
      console.error("db:update-last-page error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:get-all-tags", async () => {
    try {
      return TagDAO.getAll();
    } catch (error) {
      console.error("db:get-all-tags error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("db:create-tag", async (_, { name, color }) => {
    if (!isValidString(name)) {
      throw new Error("Invalid input: name must be a non-empty string");
    }
    try {
      return TagDAO.create(name, color);
    } catch (error) {
      console.error("db:create-tag error:", error);
      return null;
    }
  });
  electron.ipcMain.handle("db:delete-tag", async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error("Invalid input: id must be a positive number");
    }
    try {
      return TagDAO.delete(id);
    } catch (error) {
      console.error("db:delete-tag error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:get-all-projects", async () => {
    try {
      return ProjectDAO.getAll();
    } catch (error) {
      console.error("db:get-all-projects error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("db:get-project-children", async (_, parentId) => {
    try {
      return ProjectDAO.getChildren(parentId);
    } catch (error) {
      console.error("db:get-project-children error:", error);
      return [];
    }
  });
  electron.ipcMain.handle("db:create-project", async (_, project) => {
    if (!isValidString(project?.name)) {
      throw new Error("Invalid input: name must be a non-empty string");
    }
    try {
      return ProjectDAO.create(project);
    } catch (error) {
      console.error("db:create-project error:", error);
      return null;
    }
  });
  electron.ipcMain.handle("db:update-project", async (_, { id, updates }) => {
    if (!isValidNumber(id)) {
      throw new Error("Invalid input: id must be a positive number");
    }
    try {
      return ProjectDAO.update(id, updates);
    } catch (error) {
      console.error("db:update-project error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:delete-project", async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error("Invalid input: id must be a positive number");
    }
    try {
      return ProjectDAO.delete(id);
    } catch (error) {
      console.error("db:delete-project error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("translate:offline", async (_, payload) => {
    if (!payload || typeof payload !== "object" || !isValidString(payload.text)) {
      throw new Error("Invalid input: text must be a non-empty string");
    }
    try {
      const translated = await runArgosTranslateBatch([payload.text], payload.context);
      return translated[0] || "";
    } catch (error) {
      console.error("translate:offline error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("translate:offline-batch", async (_, payload) => {
    if (!payload || typeof payload !== "object" || !Array.isArray(payload.texts)) {
      throw new Error("Invalid input: texts must be an array");
    }
    const hasInvalidText = payload.texts.some((text) => typeof text !== "string");
    if (hasInvalidText) {
      throw new Error("Invalid input: all texts must be strings");
    }
    try {
      return await runArgosTranslateBatch(payload.texts, payload.context);
    } catch (error) {
      console.error("translate:offline-batch error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("gemini:get-api-key-status", async () => {
    return getGeminiApiKeyStatus();
  });
  electron.ipcMain.handle("gemini:set-api-key", async (_, payload) => {
    if (!payload || typeof payload !== "object" || !isValidString(payload.apiKey)) {
      throw new Error("Invalid input: apiKey must be a non-empty string");
    }
    return setStoredGeminiApiKey(payload.apiKey);
  });
  electron.ipcMain.handle("gemini:clear-api-key", async () => {
    return clearStoredGeminiApiKey();
  });
  electron.ipcMain.handle("gemini:translate", async (_, { text, context }) => {
    if (!isValidString(text)) {
      throw new Error("Invalid input: text must be a non-empty string");
    }
    if (!context || typeof context !== "object") {
      throw new Error("Invalid input: context must be an object");
    }
    const {
      mode = "manga",
      sourceType = "text",
      sourceLanguage,
      targetLanguage,
      baseSystemPrompt
    } = context;
    const normalizedMode = mode === "official" ? "official" : mode === "manhwa" ? "manhwa" : "manga";
    const normalizedSource = normalizeArgosLanguage(sourceLanguage, "en");
    const normalizedTarget = normalizeArgosLanguage(targetLanguage, "th");
    const sourceName = LANGUAGE_DISPLAY_NAMES[normalizedSource] || normalizedSource;
    const targetName = LANGUAGE_DISPLAY_NAMES[normalizedTarget] || normalizedTarget;
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) {
      throw new Error("Gemini API key is not configured. Save it once in Settings or provide GEMINI_API_KEY locally.");
    }
    const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const modePrompt = normalizedMode === "official" ? `You are a professional document translator. Translate from ${sourceName} to ${targetName}. Use clear, formal, and accurate wording suitable for official documents.` : normalizedMode === "manhwa" ? `You are a professional manhwa translator. Translate from ${sourceName} to ${targetName}. Keep mature dialogue natural and emotionally accurate while preserving intent and relationship dynamics.` : `You are a professional manga translator. Translate from ${sourceName} to ${targetName}. Use informal and emotional wording that matches manga tone. If the type is "sfx", explain the sound in brackets.`;
    const systemPrompt = isValidString(baseSystemPrompt) ? baseSystemPrompt : modePrompt;
    const promptText = sourceType === "batch-markdown" ? String(text) : `Translate this text: "${text}" (Type: ${sourceType})`;
    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] }
    };
    let delay = 1e3;
    for (let i = 0; i < 5; i++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
      } catch (error) {
        if (i === 4) throw error;
        await new Promise((res) => setTimeout(res, delay));
        delay *= 2;
      }
    }
  });
  createWindow();
});
