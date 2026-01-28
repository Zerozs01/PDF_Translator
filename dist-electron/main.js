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
      preload: path.join(__dirname, "preload.js"),
      // SECURITY: Explicit security settings
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
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
  const isValidString = (value) => typeof value === "string" && value.length > 0 && value.length < 1e4;
  const isValidNumber = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const sanitizePath = (filepath) => {
    return filepath.replace(/\.\.\//g, "").replace(/\.\.\\/g, "");
  };
  electron.ipcMain.handle("db:save-document", async (_, { filepath, filename, totalPages }) => {
    if (!isValidString(filepath) || !isValidString(filename)) {
      throw new Error("Invalid input: filepath and filename must be non-empty strings");
    }
    if (!isValidNumber(totalPages)) {
      throw new Error("Invalid input: totalPages must be a positive number");
    }
    try {
      const safePath = sanitizePath(filepath);
      return DocumentDAO.upsert(safePath, filename, totalPages);
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
      const safePath = sanitizePath(filepath);
      return DocumentDAO.get(safePath);
    } catch (error) {
      console.error("db:get-document error:", error);
      return null;
    }
  });
  electron.ipcMain.handle("db:save-ocr", async (_, { docId, pageNum, data }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error("Invalid input: docId and pageNum must be positive numbers");
    }
    try {
      OCRCacheDAO.save(docId, pageNum, data);
      return true;
    } catch (error) {
      console.error("db:save-ocr error:", error);
      return false;
    }
  });
  electron.ipcMain.handle("db:get-ocr", async (_, { docId, pageNum }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error("Invalid input: docId and pageNum must be positive numbers");
    }
    try {
      return OCRCacheDAO.get(docId, pageNum);
    } catch (error) {
      console.error("db:get-ocr error:", error);
      return null;
    }
  });
  electron.ipcMain.handle("gemini:translate", async (_, { text, context }) => {
    if (!isValidString(text)) {
      throw new Error("Invalid input: text must be a non-empty string");
    }
    if (!context || typeof context !== "object") {
      throw new Error("Invalid input: context must be an object");
    }
    const { mode = "manga", sourceType = "text" } = context;
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY not configured. Please set it in .env file.");
    }
    const GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
    const systemPrompt = mode === "manga" ? `You are a professional manga translator. Translate to Thai. Use informal, emotional language with particles like "นะ", "โว้ย". If the type is "sfx", explain the sound in brackets like [เสียงสั่นสะเทือน].` : `You are a professional document translator. Translate to Thai. Use formal, polite language suitable for official documents.`;
    const payload = {
      contents: [{ parts: [{ text: `Translate this text: "${text}" (Type: ${sourceType})` }] }],
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
