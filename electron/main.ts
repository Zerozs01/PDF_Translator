import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { initDB, DocumentDAO, OCRCacheDAO, TagDAO, ProjectDAO } from './db'

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.js
// │
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null
// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  // Remove the default menu bar
  Menu.setApplicationMenu(null)
  
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC || '', 'electron-vite.svg'),
    autoHideMenuBar: true, // Hide menu bar
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // SECURITY: Explicit security settings
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })

  // Enable DevTools shortcut (Ctrl+Shift+I or F12)
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
      win?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(process.env.DIST || '', 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  // Initialize SQLite Database with Performance Pragmas
  initDB();

  // ============================================
  // Input Validation Helpers
  // ============================================
  const isValidString = (value: unknown): value is string => 
    typeof value === 'string' && value.length > 0 && value.length < 10000;
  
  const isValidNumber = (value: unknown): value is number => 
    typeof value === 'number' && Number.isFinite(value) && value >= 0;

  const sanitizePath = (filepath: string): string => {
    // Remove dangerous path traversal patterns
    return filepath.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');
  };

  // ============================================
  // Database IPC Handlers (with validation)
  // ============================================
  ipcMain.handle('db:save-document', async (_, { filepath, filename, totalPages }) => {
    // Input validation
    if (!isValidString(filepath) || !isValidString(filename)) {
      throw new Error('Invalid input: filepath and filename must be non-empty strings');
    }
    if (!isValidNumber(totalPages)) {
      throw new Error('Invalid input: totalPages must be a positive number');
    }

    try {
      const safePath = sanitizePath(filepath);
      return DocumentDAO.upsert(safePath, filename, totalPages);
    } catch (error) {
      console.error('db:save-document error:', error);
      throw error;
    }
  });

  ipcMain.handle('db:get-document', async (_, filepath) => {
    if (!isValidString(filepath)) {
      throw new Error('Invalid input: filepath must be a non-empty string');
    }

    try {
      const safePath = sanitizePath(filepath);
      return DocumentDAO.get(safePath);
    } catch (error) {
      console.error('db:get-document error:', error);
      return null;
    }
  });

  ipcMain.handle('db:save-ocr', async (_, { docId, pageNum, data }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      OCRCacheDAO.save(docId, pageNum, data);
      return true;
    } catch (error) {
      console.error('db:save-ocr error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-ocr', async (_, { docId, pageNum }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      return OCRCacheDAO.get(docId, pageNum);
    } catch (error) {
      console.error('db:get-ocr error:', error);
      return null;
    }
  });

  // ============================================
  // Document Management IPC Handlers
  // ============================================
  ipcMain.handle('db:get-recent-documents', async (_, limit = 50) => {
    try {
      return DocumentDAO.getRecent(limit);
    } catch (error) {
      console.error('db:get-recent-documents error:', error);
      return [];
    }
  });

  ipcMain.handle('db:get-documents-by-project', async (_, projectId) => {
    try {
      return DocumentDAO.getByProject(projectId);
    } catch (error) {
      console.error('db:get-documents-by-project error:', error);
      return [];
    }
  });

  ipcMain.handle('db:get-favorite-documents', async () => {
    try {
      return DocumentDAO.getFavorites();
    } catch (error) {
      console.error('db:get-favorite-documents error:', error);
      return [];
    }
  });

  ipcMain.handle('db:search-documents', async (_, query) => {
    if (!isValidString(query)) {
      return [];
    }
    try {
      return DocumentDAO.search(query);
    } catch (error) {
      console.error('db:search-documents error:', error);
      return [];
    }
  });

  ipcMain.handle('db:update-document', async (_, { id, updates }) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return DocumentDAO.update(id, updates);
    } catch (error) {
      console.error('db:update-document error:', error);
      return false;
    }
  });

  ipcMain.handle('db:delete-document', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return DocumentDAO.delete(id);
    } catch (error) {
      console.error('db:delete-document error:', error);
      return false;
    }
  });

  ipcMain.handle('db:toggle-favorite', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return DocumentDAO.toggleFavorite(id);
    } catch (error) {
      console.error('db:toggle-favorite error:', error);
      return false;
    }
  });

  // ============================================
  // File System IPC Handlers
  // ============================================
  ipcMain.handle('fs:open-file', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const filepath = result.filePaths[0];
      const safePath = sanitizePath(filepath);

      if (!fs.existsSync(safePath)) {
        throw new Error('File not found');
      }

      const buffer = await fs.promises.readFile(safePath);
      const stats = await fs.promises.stat(safePath);
      const ext = path.extname(safePath).toLowerCase();
      const mimeType = ext === '.pdf' ? 'application/pdf' :
                       ext === '.png' ? 'image/png' :
                       ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
                       'application/octet-stream';

      return {
        filepath: safePath,
        data: buffer,
        mimeType,
        size: stats.size,
        name: path.basename(safePath),
      };
    } catch (error) {
      console.error('fs:open-file error:', error);
      throw error;
    }
  });

  ipcMain.handle('fs:read-file', async (_, filepath: string) => {
    if (!isValidString(filepath)) {
      throw new Error('Invalid filepath');
    }
    try {
      const safePath = sanitizePath(filepath);
      // Check if file exists
      if (!fs.existsSync(safePath)) {
        throw new Error('File not found');
      }
      // Read file as buffer and return base64
      const buffer = await fs.promises.readFile(safePath);
      const stats = await fs.promises.stat(safePath);
      const ext = path.extname(safePath).toLowerCase();
      const mimeType = ext === '.pdf' ? 'application/pdf' : 
                       ext === '.png' ? 'image/png' :
                       ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 
                       'application/octet-stream';
      
      return {
        data: buffer,
        mimeType,
        size: stats.size,
        name: path.basename(safePath)
      };
    } catch (error) {
      console.error('fs:read-file error:', error);
      throw error;
    }
  });

  ipcMain.handle('fs:import-file', async (_event, payload: { name: string; mimeType: string; data: Uint8Array | ArrayBuffer }) => {
    try {
      if (!payload || typeof payload.name !== 'string' || !payload.name) {
        throw new Error('Invalid payload: name is required');
      }

      const rawData = payload.data instanceof ArrayBuffer
        ? new Uint8Array(payload.data)
        : payload.data;

      if (!(rawData instanceof Uint8Array)) {
        throw new Error('Invalid payload: data must be Uint8Array or ArrayBuffer');
      }

      const safeName = payload.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const ext = path.extname(safeName);
      const fallbackExt = payload.mimeType === 'application/pdf'
        ? '.pdf'
        : payload.mimeType === 'image/png'
        ? '.png'
        : payload.mimeType === 'image/jpeg'
        ? '.jpg'
        : '';

      const finalName = ext ? safeName : `${safeName}${fallbackExt}`;
      const userDataDir = app.getPath('userData');
      const importDir = path.join(userDataDir, 'imports');
      await fs.promises.mkdir(importDir, { recursive: true });

      const uniqueId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      console.error('fs:import-file error:', error);
      throw error;
    }
  });

  ipcMain.handle('db:get-documents-by-tag', async (_, tagId) => {
    if (!isValidNumber(tagId)) {
      throw new Error('Invalid input: tagId must be a positive number');
    }
    try {
      return DocumentDAO.getByTag(tagId);
    } catch (error) {
      console.error('db:get-documents-by-tag error:', error);
      return [];
    }
  });

  ipcMain.handle('db:add-document-tag', async (_, { documentId, tagId }) => {
    if (!isValidNumber(documentId) || !isValidNumber(tagId)) {
      throw new Error('Invalid input: documentId and tagId must be positive numbers');
    }
    try {
      return DocumentDAO.addTag(documentId, tagId);
    } catch (error) {
      console.error('db:add-document-tag error:', error);
      return false;
    }
  });

  ipcMain.handle('db:remove-document-tag', async (_, { documentId, tagId }) => {
    if (!isValidNumber(documentId) || !isValidNumber(tagId)) {
      throw new Error('Invalid input: documentId and tagId must be positive numbers');
    }
    try {
      return DocumentDAO.removeTag(documentId, tagId);
    } catch (error) {
      console.error('db:remove-document-tag error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-document-tags', async (_, documentId) => {
    if (!isValidNumber(documentId)) {
      throw new Error('Invalid input: documentId must be a positive number');
    }
    try {
      return DocumentDAO.getTags(documentId);
    } catch (error) {
      console.error('db:get-document-tags error:', error);
      return [];
    }
  });

  ipcMain.handle('db:update-last-page', async (_, { id, pageNum }) => {
    if (!isValidNumber(id) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: id and pageNum must be positive numbers');
    }
    try {
      return DocumentDAO.updateLastPage(id, pageNum);
    } catch (error) {
      console.error('db:update-last-page error:', error);
      return false;
    }
  });

  // ============================================
  // Tag Management IPC Handlers
  // ============================================
  ipcMain.handle('db:get-all-tags', async () => {
    try {
      return TagDAO.getAll();
    } catch (error) {
      console.error('db:get-all-tags error:', error);
      return [];
    }
  });

  ipcMain.handle('db:create-tag', async (_, { name, color }) => {
    if (!isValidString(name)) {
      throw new Error('Invalid input: name must be a non-empty string');
    }
    try {
      return TagDAO.create(name, color);
    } catch (error) {
      console.error('db:create-tag error:', error);
      return null;
    }
  });

  ipcMain.handle('db:delete-tag', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return TagDAO.delete(id);
    } catch (error) {
      console.error('db:delete-tag error:', error);
      return false;
    }
  });

  // ============================================
  // Project Management IPC Handlers
  // ============================================
  ipcMain.handle('db:get-all-projects', async () => {
    try {
      return ProjectDAO.getAll();
    } catch (error) {
      console.error('db:get-all-projects error:', error);
      return [];
    }
  });

  ipcMain.handle('db:get-project-children', async (_, parentId) => {
    try {
      return ProjectDAO.getChildren(parentId);
    } catch (error) {
      console.error('db:get-project-children error:', error);
      return [];
    }
  });

  ipcMain.handle('db:create-project', async (_, project) => {
    if (!isValidString(project?.name)) {
      throw new Error('Invalid input: name must be a non-empty string');
    }
    try {
      return ProjectDAO.create(project);
    } catch (error) {
      console.error('db:create-project error:', error);
      return null;
    }
  });

  ipcMain.handle('db:update-project', async (_, { id, updates }) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return ProjectDAO.update(id, updates);
    } catch (error) {
      console.error('db:update-project error:', error);
      return false;
    }
  });

  ipcMain.handle('db:delete-project', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return ProjectDAO.delete(id);
    } catch (error) {
      console.error('db:delete-project error:', error);
      return false;
    }
  });

  // ============================================
  // Gemini API Handler (SECURE: API key in main process only)
  // ============================================
  ipcMain.handle('gemini:translate', async (_, { text, context }) => {
    // Input validation
    if (!isValidString(text)) {
      throw new Error('Invalid input: text must be a non-empty string');
    }
    if (!context || typeof context !== 'object') {
      throw new Error('Invalid input: context must be an object');
    }

    const { mode = 'manga', sourceType = 'text' } = context as { mode?: string; sourceType?: string };

    // Get API key from environment (NEVER expose to renderer)
    const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured. Please set it in .env file.');
    }

    const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const systemPrompt = mode === 'manga' 
      ? `You are a professional manga translator. Translate to Thai. Use informal, emotional language with particles like "นะ", "โว้ย". If the type is "sfx", explain the sound in brackets like [เสียงสั่นสะเทือน].`
      : `You are a professional document translator. Translate to Thai. Use formal, polite language suitable for official documents.`;

    const payload = {
      contents: [{ parts: [{ text: `Translate this text: "${text}" (Type: ${sourceType})` }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] }
    };

    // Exponential backoff retry
    let delay = 1000;
    for (let i = 0; i < 5; i++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        return result.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
      } catch (error) {
        if (i === 4) throw error;
        await new Promise(res => setTimeout(res, delay));
        delay *= 2;
      }
    }
  });

  createWindow();
})

