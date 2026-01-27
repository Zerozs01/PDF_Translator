"use strict";
const electron = require("electron");
const path = require("path");
const Database = require("better-sqlite3");
let db = null;
function initDB() {
  if (db) return db;
  const dbPath = path.join(electron.app.getPath("userData"), "pdf_translator.db");
  console.log("[SQLite] Database path:", dbPath);
  try {
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -64000");
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
    console.log("[SQLite] Database initialized successfully with WAL & Indexes");
    return db;
  } catch (err) {
    console.error("[SQLite] Failed to initialize database:", err);
    throw err;
  }
}
const DocumentDAO = {
  upsert: (filepath, filename, totalPages) => {
    if (!db) throw new Error("DB not initialized");
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
    });
    return result.id;
  },
  get: (filepath) => {
    if (!db) throw new Error("DB not initialized");
    return db.prepare("SELECT * FROM documents WHERE filepath = ?").get(filepath);
  }
};
const OCRCacheDAO = {
  save: (documentId, pageNumber, data) => {
    if (!db) throw new Error("DB not initialized");
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
  get: (documentId, pageNumber) => {
    if (!db) throw new Error("DB not initialized");
    const row = db.prepare("SELECT ocr_data FROM ocr_cache WHERE document_id = ? AND page_number = ?").get(documentId, pageNumber);
    return row ? JSON.parse(row.ocr_data) : null;
  }
};
process.env.DIST = path.join(__dirname, "../dist");
process.env.VITE_PUBLIC = electron.app.isPackaged ? process.env.DIST : path.join(process.env.DIST, "../public");
let win;
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
function createWindow() {
  win = new electron.BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC || "", "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
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
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("activate", () => {
  if (electron.BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
electron.app.whenReady().then(() => {
  initDB();
  electron.ipcMain.handle("db:save-document", async (_, { filepath, filename, totalPages }) => {
    try {
      return DocumentDAO.upsert(filepath, filename, totalPages);
    } catch (error) {
      console.error("db:save-document error:", error);
      throw error;
    }
  });
  electron.ipcMain.handle("db:get-document", async (_, filepath) => {
    try {
      return DocumentDAO.get(filepath);
    } catch (error) {
      console.error("db:get-document error:", error);
      return null;
    }
  });
  electron.ipcMain.handle("db:save-ocr", async (_, { docId, pageNum, data }) => {
    try {
      OCRCacheDAO.save(docId, pageNum, data);
      return true;
    } catch (error) {
      console.error("db:save-ocr error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:get-ocr", async (_, { docId, pageNum }) => {
    try {
      return OCRCacheDAO.get(docId, pageNum);
    } catch (error) {
      console.error("db:get-ocr error:", error);
      return null;
    }
  });
  createWindow();
});
