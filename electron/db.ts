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

    // Create Tables
    const schema = `
      -- Table for Documents (Books/PDFs)
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filepath TEXT UNIQUE NOT NULL,
        filename TEXT NOT NULL,
        total_pages INTEGER DEFAULT 0,
        last_accessed INTEGER,
        created_at INTEGER
      );

      -- Table for OCR Cache
      CREATE TABLE IF NOT EXISTS ocr_cache (
        document_id INTEGER,
        page_number INTEGER,
        ocr_data TEXT, -- JSON string of OCRPageResult
        updated_at INTEGER,
        PRIMARY KEY (document_id, page_number),
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      -- 🚀 B-Tree Indexes for O(log N) lookup
      CREATE INDEX IF NOT EXISTS idx_documents_filepath ON documents(filepath);
      CREATE INDEX IF NOT EXISTS idx_ocr_cache_lookup ON ocr_cache(document_id, page_number);
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

export const DocumentDAO = {
  upsert: (filepath: string, filename: string, totalPages: number) => {
    if (!db) throw new Error('DB not initialized');
    const stmt = db.prepare(`
      INSERT INTO documents (filepath, filename, total_pages, last_accessed, created_at)
      VALUES (@filepath, @filename, @totalPages, @now, @now)
      ON CONFLICT(filepath) DO UPDATE SET
        last_accessed = @now,
        total_pages = @totalPages
      RETURNING id
    `);
    const result = stmt.get({ 
      filepath, 
      filename, 
      totalPages, 
      now: Date.now() 
    }) as { id: number };
    return result.id;
  },

  get: (filepath: string) => {
    if (!db) throw new Error('DB not initialized');
    return db.prepare('SELECT * FROM documents WHERE filepath = ?').get(filepath);
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
  }
};
