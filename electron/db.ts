import Database from 'better-sqlite3-multiple-ciphers';
import path from 'path';
import { app } from 'electron';
import {
  initAllDAOs,
  DocumentDAO,
  ProjectDAO,
  TagDAO,
  OCRCacheDAO,
  OCRDAO,
  TranslationCacheDAO,
  SentenceTranslationDAO,
  TranslationDAO,
  GlossaryDAO,
  BenchmarkDAO,
} from './dao';

export {
  DocumentDAO,
  ProjectDAO,
  TagDAO,
  OCRCacheDAO,
  OCRDAO,
  TranslationCacheDAO,
  SentenceTranslationDAO,
  TranslationDAO,
  GlossaryDAO,
  BenchmarkDAO,
  // Domain aliases for backwards compatibility
  DocumentDAO as DomainDocumentDAO,
  ProjectDAO as DomainProjectDAO,
  TagDAO as DomainTagDAO,
  GlossaryDAO as DomainGlossaryDAO,
};

export type {
  DocumentRow,
  StartupDocumentRow,
  StartupDocument,
  StartupTag,
  StartupProject,
  DocumentStartupBatch,
} from './dao/DocumentDAO';

export type { ProjectRow, ProjectStatsResult } from './dao/ProjectDAO';
export type { TagRow } from './dao/TagDAO';
export type { TranslationCacheEntryRecord } from './dao/TranslationDAO';
export type { DBGlossaryEntry } from './dao/GlossaryDAO';
export type { BenchmarkRecord, BenchmarkMode } from './dao/BenchmarkDAO';

let db: Database.Database | null = null;

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
  }
}

// Get active Database connection (if needed)
export function getDB(): Database.Database | null {
  return db;
}

// Initialize Database
export function initDB(key?: string): Database.Database | null {
  if (db) return db;

  if (!key) {
    console.warn('[SQLite] Attempted to initialize database without encryption key. Deferring.');
    return null;
  }

  const dbPath = path.join(app.getPath('userData'), 'pdf_translator.db');
  console.log('[SQLite] Database path:', dbPath);

  try {
    db = new Database(dbPath);
    
    // Explicitly configure SQLCipher cipher and apply the encryption key via native Buffer API
    // Why: Passing Buffer directly to db.key() invokes the underlying C API sqlite3_key,
    // completely eliminating SQL injection and quote escaping vulnerabilities while preserving PBKDF2 derivation.
    db.pragma("cipher='sqlcipher'");
    db.key(Buffer.from(key, 'utf8'));
    
    // Force SQLite to run a fast query to verify if the key is valid.
    db.pragma('user_version');
    
    // 🚀 Performance Optimization
    db.pragma('page_size = 4096');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000');
    db.pragma('mmap_size = 134217728');
    db.pragma('temp_store = MEMORY');
    db.pragma('busy_timeout = 5000');
    db.pragma('wal_autocheckpoint = 10000');
    db.pragma('foreign_keys = ON');

    // Benchmarks table
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
        is_thumbnail_hidden INTEGER DEFAULT 0,
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

      -- Table for User Translation Glossary / Custom Terms & SFX
      CREATE TABLE IF NOT EXISTS translation_glossary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_text TEXT NOT NULL,
        target_text TEXT NOT NULL,
        source_lang TEXT DEFAULT 'all',
        target_lang TEXT DEFAULT 'th',
        type TEXT CHECK(type IN ('TERM', 'SFX')) DEFAULT 'TERM',
        is_active INTEGER DEFAULT 1,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        UNIQUE(source_text, source_lang, target_lang, type)
      );

      CREATE INDEX IF NOT EXISTS idx_glossary_lookup ON translation_glossary(source_text, source_lang, target_lang);
      CREATE INDEX IF NOT EXISTS idx_glossary_active ON translation_glossary(is_active);

      -- Initial populate of search table if empty (one-time migration)
      INSERT INTO document_search(document_id, search_text)
      SELECT id, filename FROM documents 
      WHERE id NOT IN (SELECT document_id FROM document_search);
    `;

    db.exec(schema);

    // Migrations
    try {
      db.exec('ALTER TABLE documents ADD COLUMN rating INTEGER DEFAULT 0');
    } catch {
      // Column exists
    }

    try {
      db.exec('ALTER TABLE documents ADD COLUMN is_thumbnail_hidden INTEGER DEFAULT 0');
    } catch {
      // Column exists
    }

    try {
      db.exec('ALTER TABLE translation_cache ADD COLUMN width INTEGER DEFAULT 0');
      db.exec('ALTER TABLE translation_cache ADD COLUMN height INTEGER DEFAULT 0');
    } catch {
      // Column exists
    }

    // Initialize all modular DAOs with the database connection
    initAllDAOs(db);

    console.log('[SQLite] Database initialized successfully with modular DAOs, WAL, FTS5 & MMap');
    return db;
  } catch (err) {
    console.error('[SQLite] Failed to initialize database:', err);
    throw err;
  }
}

// ─── Utility: manual WAL checkpoint ──────────────────────────────────────────
export function checkpointDB(mode: 'PASSIVE' | 'FULL' | 'RESTART' = 'PASSIVE'): void {
  if (!db) return;
  try {
    db.pragma(`wal_checkpoint(${mode})`);
  } catch (err) {
    console.warn('[SQLite] WAL checkpoint failed:', err);
  }
}
