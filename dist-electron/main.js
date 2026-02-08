"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
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
    console.log("[SQLite] Database initialized successfully with WAL & Indexes");
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
  electron.Menu.setApplicationMenu(null);
  win = new electron.BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC || "", "electron-vite.svg"),
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
  win.webContents.on("before-input-event", (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === "i" || input.key === "F12") {
      win?.webContents.toggleDevTools();
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
      const safePath = sanitizePath(filepath);
      if (!fs.existsSync(safePath)) {
        throw new Error("File not found");
      }
      const buffer = await fs.promises.readFile(safePath);
      const stats = await fs.promises.stat(safePath);
      const ext = path.extname(safePath).toLowerCase();
      const mimeType = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".tif" || ext === ".tiff" ? "image/tiff" : "application/octet-stream";
      return {
        filepath: safePath,
        data: buffer,
        mimeType,
        size: stats.size,
        name: path.basename(safePath)
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
      const safePath = sanitizePath(filepath);
      if (!fs.existsSync(safePath)) {
        throw new Error("File not found");
      }
      const buffer = await fs.promises.readFile(safePath);
      const stats = await fs.promises.stat(safePath);
      const ext = path.extname(safePath).toLowerCase();
      const mimeType = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".tif" || ext === ".tiff" ? "image/tiff" : "application/octet-stream";
      return {
        data: buffer,
        mimeType,
        size: stats.size,
        name: path.basename(safePath)
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
      const safeName = payload.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const ext = path.extname(safeName);
      const fallbackExt = payload.mimeType === "application/pdf" ? ".pdf" : payload.mimeType === "image/png" ? ".png" : payload.mimeType === "image/jpeg" ? ".jpg" : "";
      const finalName = ext ? safeName : `${safeName}${fallbackExt}`;
      const userDataDir = electron.app.getPath("userData");
      const importDir = path.join(userDataDir, "imports");
      await fs.promises.mkdir(importDir, { recursive: true });
      const uniqueId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const targetPath = path.join(importDir, `${uniqueId}-${finalName}`);
      await fs.promises.writeFile(targetPath, Buffer.from(rawData));
      const stats = await fs.promises.stat(targetPath);
      return {
        filepath: targetPath,
        mimeType: payload.mimeType,
        size: stats.size,
        name: finalName
      };
    } catch (error) {
      console.error("fs:import-file error:", error);
      throw error;
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
