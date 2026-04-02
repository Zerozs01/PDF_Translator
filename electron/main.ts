import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { initDB, DocumentDAO, OCRCacheDAO, ProjectDAO, TagDAO, TranslationCacheDAO } from './db'
import { cancelExternalOcr, disposeExternalOcrDaemons, getExternalOcrEngineStatuses, prewarmExternalOcrEngine, runExternalOcr } from './ocrBridge'

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
    show: false,
    width: 1440,
    height: 960,
    minWidth: 1200,
    minHeight: 780,
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

  win.once('ready-to-show', () => {
    win?.maximize();
    win?.show();
  });

  // Enable DevTools shortcut (Ctrl+Shift+I or F12) and page refresh (Ctrl+R / F5) in dev mode
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
      win?.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (VITE_DEV_SERVER_URL && ((input.control && input.key.toLowerCase() === 'r') || input.key === 'F5')) {
      win?.webContents.reload();
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
  disposeExternalOcrDaemons()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', () => {
  disposeExternalOcrDaemons()
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

  const isValidEngine = (value: unknown): value is string =>
    typeof value === 'string' && ['tesseract', 'paddleocr', 'easyocr'].includes(value);

  const sanitizePath = (filepath: string): string => {
    // Remove dangerous path traversal patterns
    return filepath.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');
  };

  type TranslationContext = {
    mode?: string;
    sourceType?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    timeoutMs?: number;
  };

  const ARGOS_LANG_ALIASES: Record<string, string> = {
    en: 'en',
    eng: 'en',
    english: 'en',
    th: 'th',
    tha: 'th',
    thai: 'th',
    ja: 'ja',
    jpn: 'ja',
    ko: 'ko',
    kor: 'ko',
    zh: 'zh',
    chi: 'zh',
    chi_sim: 'zh',
    chi_tra: 'zh',
    vi: 'vi',
    vie: 'vi',
    de: 'de',
    deu: 'de',
    fr: 'fr',
    fra: 'fr',
    ru: 'ru',
    rus: 'ru',
    es: 'es',
    spa: 'es',
  };

  const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
    en: 'English',
    th: 'Thai',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese',
    vi: 'Vietnamese',
    de: 'German',
    fr: 'French',
    ru: 'Russian',
    es: 'Spanish',
  };

  const normalizeArgosLanguage = (value: unknown, fallback: string): string => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return fallback;
    return ARGOS_LANG_ALIASES[raw] || raw.split('-')[0] || fallback;
  };

  const resolvePythonExecutable = (): string => {
    if (isValidString(process.env.PDF_TRANSLATOR_PYTHON)) {
      return process.env.PDF_TRANSLATOR_PYTHON;
    }
    const virtualEnv = process.env.VIRTUAL_ENV;
    if (virtualEnv) {
      const windowsPython = path.join(virtualEnv, 'Scripts', 'python.exe');
      if (fs.existsSync(windowsPython)) return windowsPython;
      const posixPython = path.join(virtualEnv, 'bin', 'python');
      if (fs.existsSync(posixPython)) return posixPython;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
  };

  const resolveArgosBridgePath = (): string => {
    const candidates = [
      path.join(process.cwd(), 'scripts', 'argos_translate_bridge.py'),
      path.join(__dirname, '../scripts/argos_translate_bridge.py'),
      path.join(process.resourcesPath, 'ocr-bridge', 'argos_translate_bridge.py'),
    ];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (!found) {
      throw new Error('Argos bridge script not found. Expected scripts/argos_translate_bridge.py');
    }
    return found;
  };

  const runArgosTranslateBatch = async (
    texts: string[],
    context?: TranslationContext
  ): Promise<string[]> => {
    if (!Array.isArray(texts)) {
      throw new Error('Invalid input: texts must be an array');
    }
    if (texts.length === 0) return [];

    const timeoutMs = Math.max(3000, Math.min(120000, Number(context?.timeoutMs || 45000)));
    const sourceLanguage = normalizeArgosLanguage(context?.sourceLanguage, 'en');
    const targetLanguage = normalizeArgosLanguage(context?.targetLanguage, 'th');
    if (sourceLanguage === targetLanguage) {
      return texts.map((text) => String(text || ''));
    }

    const pythonExecutable = resolvePythonExecutable();
    const bridgePath = resolveArgosBridgePath();
    const payload = {
      texts: texts.map((text) => String(text || '')),
      sourceLanguage,
      targetLanguage,
      mode: String(context?.mode || 'manga'),
      sourceType: String(context?.sourceType || 'text'),
    };

    return new Promise<string[]>((resolve, reject) => {
      const child = spawn(pythonExecutable, [bridgePath], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUTF8: '1',
          // Keep offline translation deterministic and avoid runtime Stanza resource fetches.
          ARGOS_CHUNK_TYPE: process.env.ARGOS_CHUNK_TYPE || 'MINISBD',
        },
      });

      let stdout = '';
      let stderr = '';

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Argos translation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to launch Python for Argos translation: ${error.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          reject(new Error(`Argos translation bridge failed (${code}): ${(stderr || stdout).trim() || 'Unknown error'}`));
          return;
        }

        try {
          const parsed = JSON.parse(stdout || '{}') as { translations?: unknown };
          if (!Array.isArray(parsed.translations)) {
            reject(new Error('Argos translation bridge returned invalid payload'));
            return;
          }
          const translations = parsed.translations.map((item) => String(item ?? ''));
          if (translations.length !== texts.length) {
            reject(new Error(`Argos translation count mismatch: expected ${texts.length}, got ${translations.length}`));
            return;
          }
          resolve(translations);
        } catch (error) {
          reject(new Error(`Failed to parse Argos translation payload: ${error instanceof Error ? error.message : String(error)}`));
        }
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
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
      const row = DocumentDAO.upsert(safePath, filename, totalPages) as { id?: number } | undefined;
      return row?.id ?? 0;
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

  ipcMain.handle('db:find-documents-by-filename', async (_, filename) => {
    if (!isValidString(filename)) {
      throw new Error('Invalid input: filename must be a non-empty string');
    }

    try {
      return DocumentDAO.findByFilenameWithCacheStats(filename);
    } catch (error) {
      console.error('db:find-documents-by-filename error:', error);
      return [];
    }
  });

  ipcMain.handle('db:save-ocr', async (_, { docId, pageNum, data, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      const selectedEngine = isValidEngine(engine)
        ? engine
        : isValidEngine((data as { ocrEngine?: unknown } | null)?.ocrEngine)
          ? (data as { ocrEngine: string }).ocrEngine
          : 'tesseract';
      OCRCacheDAO.save(docId, pageNum, data, selectedEngine);
      return true;
    } catch (error) {
      console.error('db:save-ocr error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-ocr', async (_, { docId, pageNum, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      const selectedEngine = isValidEngine(engine) ? engine : 'tesseract';
      return OCRCacheDAO.get(docId, pageNum, selectedEngine);
    } catch (error) {
      console.error('db:get-ocr error:', error);
      return null;
    }
  });

  ipcMain.handle('db:clear-ocr', async (_, { docId, pageNum, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      const selectedEngine = isValidEngine(engine) ? engine : 'tesseract';
      return OCRCacheDAO.clear(docId, pageNum, selectedEngine);
    } catch (error) {
      console.error('db:clear-ocr error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-latest-ocr', async (_, { docId }) => {
    if (!isValidNumber(docId)) {
      throw new Error('Invalid input: docId must be a positive number');
    }

    try {
      return OCRCacheDAO.getLatestForDocument(docId);
    } catch (error) {
      console.error('db:get-latest-ocr error:', error);
      return null;
    }
  });

  ipcMain.handle('db:save-translation-cache', async (_, { docId, pageNum, cacheKey, entry }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }
    if (!isValidString(cacheKey) || !entry || typeof entry !== 'object') {
      throw new Error('Invalid input: cacheKey and entry are required');
    }

    try {
      TranslationCacheDAO.save(docId, pageNum, cacheKey, entry as {
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
      });
      return true;
    } catch (error) {
      console.error('db:save-translation-cache error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-translation-cache-page', async (_, { docId, pageNum }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      return TranslationCacheDAO.getByPage(docId, pageNum);
    } catch (error) {
      console.error('db:get-translation-cache-page error:', error);
      return [];
    }
  });

  ipcMain.handle('db:clear-translation-cache-by-engine', async (_, { docId, pageNum, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      const selectedEngine = isValidEngine(engine) ? engine : 'tesseract';
      return TranslationCacheDAO.clearByEngine(docId, pageNum, selectedEngine);
    } catch (error) {
      console.error('db:clear-translation-cache-by-engine error:', error);
      return false;
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
          { name: 'Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'] },
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
                       ext === '.tif' || ext === '.tiff' ? 'image/tiff' :
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
                       ext === '.tif' || ext === '.tiff' ? 'image/tiff' :
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

      // Use deterministic content-hash path so repeated imports hit the same DB document_id/cache key.
      const contentHash = createHash('sha256').update(Buffer.from(rawData)).digest('hex').slice(0, 24);
      const finalExt = ext || fallbackExt || path.extname(finalName) || '';
      const hashedPath = path.join(importDir, `${contentHash}${finalExt}`);
      let targetPath = hashedPath;

      if (!fs.existsSync(hashedPath)) {
        // Backward-compat: try to reuse previously imported UUID-style file with identical content
        // so existing document_id/OCR cache keeps working.
        try {
          const entries = await fs.promises.readdir(importDir, { withFileTypes: true });
          const candidates = entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((name) => {
              if (name === path.basename(hashedPath)) return false;
              if (name.endsWith(`-${finalName}`)) return true;
              if (!finalExt) return true;
              return path.extname(name).toLowerCase() === finalExt.toLowerCase();
            });

          for (const name of candidates) {
            const candidatePath = path.join(importDir, name);
            let stats: fs.Stats;
            try {
              stats = await fs.promises.stat(candidatePath);
            } catch {
              continue;
            }
            if (stats.size !== rawData.byteLength) continue;

            try {
              const candidateBytes = await fs.promises.readFile(candidatePath);
              const candidateHash = createHash('sha256').update(candidateBytes).digest('hex').slice(0, 24);
              if (candidateHash === contentHash) {
                targetPath = candidatePath;
                break;
              }
            } catch {
              // Ignore unreadable candidate files and continue searching.
            }
          }
        } catch {
          // Ignore migration scan failures and fall back to hashed path write.
        }
      }

      if (!fs.existsSync(targetPath)) {
        await fs.promises.writeFile(targetPath, Buffer.from(rawData));
      }
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

  ipcMain.handle('ocr:get-engine-status', async () => {
    try {
      return await getExternalOcrEngineStatuses();
    } catch (error) {
      console.error('ocr:get-engine-status error:', error);
      return [];
    }
  });

  ipcMain.handle('ocr:prewarm-engine', async (_, payload: { engine: string; language?: string }) => {
    if (!payload || typeof payload !== 'object' || !isValidString(payload.engine)) {
      throw new Error('Invalid OCR prewarm payload');
    }

    if (payload.engine !== 'paddleocr' && payload.engine !== 'easyocr') {
      throw new Error(`Unsupported OCR engine: ${payload.engine}`);
    }

    try {
      return await prewarmExternalOcrEngine(payload.engine, isValidString(payload.language) ? payload.language : 'eng');
    } catch (error) {
      console.error('ocr:prewarm-engine error:', error);
      throw error;
    }
  });

  ipcMain.handle('ocr:run-external', async (_, payload: {
    engine: string;
    imageData: Uint8Array | ArrayBuffer;
    imageMimeType: string;
    imageWidth: number;
    imageHeight: number;
    language: string;
    dpi: number;
    pageSegMode?: number;
    pipelineProfile?: string;
    ocrQualityProfile?: string;
  }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid OCR payload');
    }
    if (!isValidString(payload.engine) || !isValidString(payload.imageMimeType) || !isValidString(payload.language)) {
      throw new Error('Invalid OCR payload: engine, imageMimeType, and language are required');
    }
    if (!isValidNumber(payload.imageWidth) || !isValidNumber(payload.imageHeight) || !isValidNumber(payload.dpi)) {
      throw new Error('Invalid OCR payload: imageWidth, imageHeight, and dpi must be positive numbers');
    }

    try {
      return await runExternalOcr(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/External OCR canceled for (paddleocr|easyocr)/i.test(message)) {
        console.warn(`ocr:run-external canceled: ${message}`);
      } else {
        console.error('ocr:run-external error:', error);
      }
      throw error;
    }
  });

  ipcMain.handle('ocr:cancel-external', async (_, payload?: { engine?: string }) => {
    try {
      const engine = payload?.engine;
      if (engine && engine !== 'paddleocr' && engine !== 'easyocr') {
        throw new Error(`Unsupported OCR engine: ${engine}`);
      }
      cancelExternalOcr(engine as 'paddleocr' | 'easyocr' | undefined);
      return true;
    } catch (error) {
      console.error('ocr:cancel-external error:', error);
      return false;
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

  ipcMain.handle('db:touch-document', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      DocumentDAO.touch(id);
      return true;
    } catch (error) {
      console.error('db:touch-document error:', error);
      return false;
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
  // Offline Translation IPC Handlers (Argos Translate)
  // ============================================
  ipcMain.handle('translate:offline', async (_, payload: { text: string; context?: TranslationContext }) => {
    if (!payload || typeof payload !== 'object' || !isValidString(payload.text)) {
      throw new Error('Invalid input: text must be a non-empty string');
    }

    try {
      const translated = await runArgosTranslateBatch([payload.text], payload.context);
      return translated[0] || '';
    } catch (error) {
      console.error('translate:offline error:', error);
      throw error;
    }
  });

  ipcMain.handle('translate:offline-batch', async (_, payload: { texts: string[]; context?: TranslationContext }) => {
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.texts)) {
      throw new Error('Invalid input: texts must be an array');
    }
    const hasInvalidText = payload.texts.some((text) => typeof text !== 'string');
    if (hasInvalidText) {
      throw new Error('Invalid input: all texts must be strings');
    }

    try {
      return await runArgosTranslateBatch(payload.texts, payload.context);
    } catch (error) {
      console.error('translate:offline-batch error:', error);
      throw error;
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

    const {
      mode = 'manga',
      sourceType = 'text',
      sourceLanguage,
      targetLanguage,
      apiKey: apiKeyOverride,
      baseSystemPrompt,
    } = context as {
      mode?: string;
      sourceType?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      apiKey?: string;
      baseSystemPrompt?: string;
    };

    const normalizedMode = mode === 'official' ? 'official' : mode === 'manhwa' ? 'manhwa' : 'manga';

    const normalizedSource = normalizeArgosLanguage(sourceLanguage, 'en');
    const normalizedTarget = normalizeArgosLanguage(targetLanguage, 'th');
    const sourceName = LANGUAGE_DISPLAY_NAMES[normalizedSource] || normalizedSource;
    const targetName = LANGUAGE_DISPLAY_NAMES[normalizedTarget] || normalizedTarget;

    // Get API key from environment (NEVER expose to renderer)
    const apiKeyFromContext = String(apiKeyOverride || '').trim();
    const apiKey = apiKeyFromContext || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured. Please set it in .env file.');
    }

    const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const modePrompt = normalizedMode === 'official'
      ? `You are a professional document translator. Translate from ${sourceName} to ${targetName}. Use clear, formal, and accurate wording suitable for official documents.`
      : normalizedMode === 'manhwa'
        ? `You are a professional manhwa translator. Translate from ${sourceName} to ${targetName}. Keep mature dialogue natural and emotionally accurate while preserving intent and relationship dynamics.`
        : `You are a professional manga translator. Translate from ${sourceName} to ${targetName}. Use informal and emotional wording that matches manga tone. If the type is "sfx", explain the sound in brackets.`;

    const systemPrompt = isValidString(baseSystemPrompt)
      ? baseSystemPrompt
      : modePrompt;

    const promptText = sourceType === 'batch-markdown'
      ? String(text)
      : `Translate this text: "${text}" (Type: ${sourceType})`;

    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
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

