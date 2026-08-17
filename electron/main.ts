import { app, BrowserWindow, ipcMain, Menu, dialog, protocol, net, powerSaveBlocker } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { createHash } from 'crypto'
import { pathToFileURL } from 'url'
import https from 'https'
import zlib from 'zlib'

// --- Production Logger Fallback ---
let logFilePath: string | null = null;
function getLogFilePath() {
  if (!logFilePath) {
    try {
      logFilePath = path.join(app.getPath('userData'), 'main.log');
      if (!fs.existsSync(logFilePath)) {
        fs.writeFileSync(logFilePath, '', 'utf8');
      }
    } catch (e) {
      return null;
    }
  }
  return logFilePath;
}

function logToFile(level: string, ...args: any[]) {
  const file = getLogFilePath();
  if (!file) return;
  const message = args.map(arg => {
    if (typeof arg === 'object') {
      try { return JSON.stringify(arg); } catch (e) { return String(arg); }
    }
    return String(arg);
  }).join(' ');
  const logLine = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  try {
    fs.appendFileSync(file, logLine, 'utf8');
  } catch (e) {}
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args: any[]) => {
  originalLog(...args);
  logToFile('INFO', ...args);
};
console.warn = (...args: any[]) => {
  originalWarn(...args);
  logToFile('WARN', ...args);
};
console.error = (...args: any[]) => {
  originalError(...args);
  logToFile('ERROR', ...args);
};

// Register tessdata custom scheme before app ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'tessdata', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
  { scheme: 'pdf-export', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);
import { initDB, closeDB, checkpointDB, DocumentDAO, OCRCacheDAO, ProjectDAO, TagDAO, TranslationCacheDAO, BenchmarkDAO, SentenceTranslationDAO } from './db'
import * as authService from './authService'
import { getRequestedDocumentPath, inspectExistingDocumentFile, isPathWithinDirectory, resolveImportedDocumentName, tryResolveRealDocumentPath } from './documentFileAccess'
import { cancelExternalOcr, deleteOcrTempImage, disposeExternalOcrDaemons, getExternalOcrEngineStatuses, prewarmExternalOcrEngine, runExternalOcr, writeOcrTempImage, runExternalOcrRaw, clearExternalOcrCudaCache } from './ocrBridge'
import { disposeArgosTranslateRuntime, LANGUAGE_DISPLAY_NAMES, normalizeArgosLanguage, runArgosTranslateBatch, type TranslationContext } from './argosBridge'
import { clearStoredGeminiApiKey, getGeminiApiKeyStatus, resolveGeminiApiKey, setStoredGeminiApiKey } from './secureSettings'
import { cancelPdfPrintExport, startPdfPrintExport } from './pdfExportService'
import {
  cleanupStagedPdfExportJob,
  disposeAllStagedPdfExportJobs,
  resolvePdfExportProtocolPath,
  stagePdfExportJob,
} from './pdfExportStaging'
// BenchmarkDAO not implemented in this file (db.ts handles)

declare const __DEV_PROJECT_ROOT__: string | undefined;

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
let powerSaveBlockerId: number | null = null
// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
  // Remove the default menu bar
  Menu.setApplicationMenu(null)
  
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC || '', 'image/Pdf_Translator.png'),
    show: false,
    width: 1440,
    height: 960,
    minWidth: 480,
    minHeight: 600,
    autoHideMenuBar: true, // Hide menu bar
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // SECURITY: Explicit security settings
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false, // Prevent Chromium from throttling timers when backgrounded
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
  disposeArgosTranslateRuntime?.()
  // Flush WAL to the main DB file before the process exits
  checkpointDB('FULL')
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
  if (powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId)
    powerSaveBlockerId = null
  }
  disposeExternalOcrDaemons()
  disposeArgosTranslateRuntime?.()
  void disposeAllStagedPdfExportJobs()
  // Flush WAL so the .db file is fully up-to-date when the process exits
  checkpointDB('FULL')
})

// Last-resort cleanup: ensure all child processes are killed even if
// 'before-quit' or 'window-all-closed' fail to run (e.g. Vite HMR restart).
process.on('exit', () => {
  if (powerSaveBlockerId !== null) {
    try {
      powerSaveBlocker.stop(powerSaveBlockerId)
    } catch (e) {}
  }
  disposeExternalOcrDaemons()
  disposeArgosTranslateRuntime?.()
})

// ─── Chromium / GPU flags (must be set before app.whenReady) ────────────────
// Disable GPU shader disk cache to prevent "Access is denied" / "Unable to move
// the cache" errors that appear on every launch when the cache dir is locked.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
// Suppress AMD DirectComposition VideoProcessorGetOutputExtension error spam
app.commandLine.appendSwitch('disable-direct-composition-video-overlays');
// Disable renderer backgrounding and background timer throttling to keep background queue tasks running when window is backgrounded or system is locked
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
// ─────────────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (process.argv.includes('--benchmark-memory-leak')) {
    const runBenchmark = async () => {
      console.log('[BENCHMARK] Starting Memory & Pipeline Stability Benchmark...');
      const rss = process.memoryUsage().rss;
      const rssMb = rss / 1024 / 1024;
      console.log(`[BENCHMARK] Initial Main Process RSS: ${rssMb.toFixed(2)} MB`);

      const targetMb = 120;
      const passMemory = rssMb < targetMb;
      console.log(`[BENCHMARK] Memory Target (< ${targetMb} MB): ${passMemory ? 'PASS' : 'FAIL'}`);

      console.log('[BENCHMARK] Testing Pipeline Stability (getting engine statuses)...');
      try {
        const statuses = await getExternalOcrEngineStatuses();
        console.log(`[BENCHMARK] Engine Statuses:`, JSON.stringify(statuses));
        console.log('[BENCHMARK] Pipeline Stability: PASS');
        
        console.log('[BENCHMARK] Cleaning up OCR Daemons...');
        disposeExternalOcrDaemons();
        
        process.exit(passMemory ? 0 : 1);
      } catch (err) {
        console.error('[BENCHMARK] Pipeline Stability check failed:', err);
        process.exit(1);
      }
    };
    
    runBenchmark();
    return;
  }

  // Attempt to perform auto-login if Relax mode is enabled and setup is complete
  if (authService.isSetup()) {
    const autoLoginPassword = authService.getAutoLoginPassword();
    if (autoLoginPassword) {
      try {
        initDB(autoLoginPassword);
        console.log('[Main] Auto-login successful. Database unlocked.');
      } catch (err) {
        console.error('[Main] Auto-login failed to unlock database:', err);
      }
    }
  }

  // Register tessdata custom protocol handler
  protocol.handle('tessdata', (request) => {
    try {
      const urlStr = request.url;
      const parsedUrl = new URL(urlStr);
      const fileName = path.basename(parsedUrl.pathname);
      if (!fileName) {
        return new Response('Invalid file request', { status: 400 });
      }

      // 1. Check in userData/tessdata
      const userPath = path.join(app.getPath('userData'), 'tessdata', fileName);
      if (fs.existsSync(userPath)) {
        return net.fetch(pathToFileURL(userPath).toString());
      }

      // 2. Check in dist/tessdata
      const appPath = path.join(process.env.DIST || '', 'tessdata', fileName);
      if (fs.existsSync(appPath)) {
        return net.fetch(pathToFileURL(appPath).toString());
      }

      // 3. Check in public/tessdata (development)
      const devPath = path.join(process.cwd(), 'public', 'tessdata', fileName);
      if (fs.existsSync(devPath)) {
        return net.fetch(pathToFileURL(devPath).toString());
      }

      console.warn(`[Tessdata Protocol] Model not found: ${fileName}`);
      return new Response('Model file not found', { status: 404 });
    } catch (err) {
      console.error('[Tessdata Protocol] Error:', err);
      return new Response('Internal Server Error', { status: 500 });
    }
  });

  protocol.handle('pdf-export', (request) => {
    try {
      const sourcePath = resolvePdfExportProtocolPath(request.url);
      if (!sourcePath) {
        return new Response('Export source not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(sourcePath).toString());
    } catch (error) {
      console.error('[PDF Export Protocol] Error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  });

  // Power management IPC handlers
  ipcMain.handle('power:prevent-sleep', () => {
    if (powerSaveBlockerId === null) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      console.log(`[Main] Started powerSaveBlocker (ID: ${powerSaveBlockerId}) to prevent app suspension.`);
    }
    return powerSaveBlockerId;
  });

  ipcMain.handle('power:allow-sleep', () => {
    if (powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      console.log(`[Main] Stopped powerSaveBlocker (ID: ${powerSaveBlockerId}).`);
      powerSaveBlockerId = null;
    }
    return true;
  });

  // 🔒 Advanced Security Phase 7: Auth IPC Handlers
  ipcMain.handle('auth:check-status', async () => {
    const config = authService.readAuthConfig();
    return {
      isSetup: authService.isSetup(),
      mode: config ? config.appMode : 'SECURITY',
    };
  });

  ipcMain.handle('auth:setup', async (_, { password, emergencyPin }) => {
    try {
      authService.setupCredentials(password, emergencyPin);
      try {
        // Immediately open DB with setup key
        initDB(password);
        return { success: true };
      } catch (dbErr) {
        // Rollback setup configuration if database initialization fails
        console.error('[Main IPC] auth:setup DB init failed, rolling back auth config:', dbErr);
        const configPath = authService.getAuthConfigPath();
        if (fs.existsSync(configPath)) {
          fs.unlinkSync(configPath);
        }
        throw dbErr;
      }
    } catch (err: any) {
      console.error('[Main IPC] auth:setup error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('auth:login', async (_, { password }) => {
    try {
      if (authService.verifyMasterPassword(password)) {
        initDB(password); // will throw error if database is not unlockable
        return { success: true };
      } else {
        return { success: false, error: 'Incorrect master password.' };
      }
    } catch (err: any) {
      console.error('[Main IPC] auth:login error:', err);
      return { success: false, error: err.message || 'Incorrect password or corrupted database.' };
    }
  });

  ipcMain.handle('auth:auto-login', async () => {
    try {
      const autoLoginPassword = authService.getAutoLoginPassword();
      if (autoLoginPassword) {
        initDB(autoLoginPassword);
        return { success: true };
      }
      return { success: false, error: 'Relax mode is disabled or safeStorage key missing.' };
    } catch (err: any) {
      console.error('[Main IPC] auth:auto-login error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('auth:hard-reset', async (_, { emergencyPin }) => {
    try {
      if (authService.verifyEmergencyPin(emergencyPin)) {
        console.warn('[Main IPC] HARD RESET / DATA WIPE TRIGGERED!');
        
        // Stop all background child processes / translation engines immediately
        try {
          disposeExternalOcrDaemons();
          disposeArgosTranslateRuntime?.();
          console.log('[Main IPC] Stopped background processes during emergency reset');
        } catch (procErr) {
          console.error('[Main IPC] Error stopping processes during reset:', procErr);
        }

        closeDB();
        authService.deleteAppDataFiles();

        // Force destroy all open windows to prevent hanging UI windows on Windows OS
        BrowserWindow.getAllWindows().forEach((w) => {
          try {
            w.destroy();
          } catch (e) {
            console.error('[Main IPC] Error destroying window:', e);
          }
        });
        
        // Relaunch the app clean and exit
        app.relaunch();
        app.exit(0);
        return { success: true };
      } else {
        return { success: false, error: 'Incorrect Emergency PIN.' };
      }
    } catch (err: any) {
      console.error('[Main IPC] auth:hard-reset error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('auth:set-mode', async (_, { mode, password }) => {
    try {
      authService.setAppMode(mode, password);
      return { success: true };
    } catch (err: any) {
      console.error('[Main IPC] auth:set-mode error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  // Model Management IPC Handlers
  ipcMain.handle('models:get-status', async (_, { engine, language }) => {
    if (!isValidString(language)) {
      throw new Error('Invalid language code');
    }
    
    const lang = language.trim().toLowerCase();
    
    if (engine === 'paddleocr') {
      try {
        const statuses = await getExternalOcrEngineStatuses();
        const paddle = statuses.find(s => s.engine === 'paddleocr');
        return { installed: paddle ? paddle.available : false };
      } catch {
        return { installed: false };
      }
    }

    if (engine === 'argos') {
      return { installed: true }; // default true for Argos (built-in fallback)
    }
    
    return { installed: false };
  });

  ipcMain.handle('models:download', async (event, { engine, language }) => {
    if (!isValidString(language)) {
      throw new Error('Invalid language code');
    }
    
    const lang = language.trim().toLowerCase();
    
    if (engine === 'paddleocr') {
      try {
        await prewarmExternalOcrEngine('paddleocr', lang);
        return true;
      } catch (err) {
        console.error(`[main] PaddleOCR prewarm failed for ${lang}:`, err);
        throw err;
      }
    }
    
    return false;
  });

  // ============================================
  // Input Validation Helpers
  // ============================================
  const isValidString = (value: unknown): value is string => 
    typeof value === 'string' && value.length > 0 && value.length < 10000;
  
  const isValidNumber = (value: unknown): value is number => 
    typeof value === 'number' && Number.isFinite(value) && value >= 0;

  const isValidEngine = (value: unknown): value is string =>
    typeof value === 'string' && ['paddleocr', 'easyocr'].includes(value);

  const getImportsDirectory = (): string => path.join(app.getPath('userData'), 'imports')

  const assertAuthorizedDocumentRead = async (requestedPath: string, canonicalPath: string): Promise<void> => {
    const importDir = getImportsDirectory()
    const normalizedImportDir = await fs.promises
      .realpath(importDir)
      .catch(() => path.resolve(importDir))

    if (isPathWithinDirectory(normalizedImportDir, canonicalPath)) {
      return
    }

    if (DocumentDAO.get(requestedPath) || DocumentDAO.get(canonicalPath)) {
      return
    }

    throw new Error('File access denied')
  }

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
      const requestedPath = getRequestedDocumentPath(filepath)
      const documentFile = await inspectExistingDocumentFile(requestedPath)
      const storagePath = DocumentDAO.get(requestedPath) ? requestedPath : documentFile.canonicalPath
      const fileType = documentFile.mimeType === 'application/pdf' ? 'pdf' : 'image'
      const row = DocumentDAO.upsert(storagePath, filename, totalPages, documentFile.size, fileType) as { id?: number } | undefined;
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
      const requestedPath = getRequestedDocumentPath(filepath)
      return DocumentDAO.get(requestedPath) ?? DocumentDAO.get(await tryResolveRealDocumentPath(requestedPath));
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
      const result = OCRCacheDAO.get(docId, pageNum, selectedEngine);

      return result;
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

  ipcMain.handle('db:clear-document-cache', async (_, docId) => {
    if (!isValidNumber(docId)) {
      throw new Error('Invalid input: docId must be a positive number');
    }

    try {
      return DocumentDAO.clearDocumentCache(docId);
    } catch (error) {
      console.error('db:clear-document-cache error:', error);
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

  const MAX_OCR_CACHE_STATS_DOC_IDS = 500;

  ipcMain.handle('db:get-ocr-cache-stats-for-document-ids', async (_, payload: { documentIds?: unknown }) => {
    const raw = payload?.documentIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      return [];
    }

    const ids = raw
      .map((id) => (typeof id === 'number' ? id : Number(id)))
      .filter((id) => Number.isFinite(id) && id > 0)
      .slice(0, MAX_OCR_CACHE_STATS_DOC_IDS);

    if (ids.length === 0) {
      return [];
    }

    try {
      return OCRCacheDAO.getAggregatedCacheStatsByDocumentIds(ids);
    } catch (error) {
      console.error('db:get-ocr-cache-stats-for-document-ids error:', error);
      return [];
    }
  });

  // Benchmark handlers (Phase 1.4)
  ipcMain.handle('db:save-benchmark', async (_, { docId, pageNum, key, payload }: { docId: number; pageNum: number; key: string; payload: string }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum) || !isValidString(key) || !isValidString(payload)) {
      throw new Error('Invalid benchmark save input');
    }
    try {
      return BenchmarkDAO.save(docId, pageNum, key, payload);
    } catch (error) {
      console.error('db:save-benchmark error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-benchmark', async (_, { docId, pageNum, key }: { docId: number; pageNum: number; key: string }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum) || !isValidString(key)) {
      throw new Error('Invalid benchmark get input');
    }
    try {
      return BenchmarkDAO.get(docId, pageNum, key);
    } catch (error) {
      console.error('db:get-benchmark error:', error);
      return null;
    }
  });

  ipcMain.handle('db:clear-benchmark', async (_, { docId, pageNum, key }: { docId: number; pageNum: number; key?: string }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid benchmark clear input');
    }
    try {
      return BenchmarkDAO.clear(docId, pageNum, key);
    } catch (error) {
      console.error('db:clear-benchmark error:', error);
      return false;
    }
  });

  ipcMain.handle('db:list-benchmarks', async (_, { docId, pageNum }: { docId: number; pageNum: number }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid benchmark list input');
    }
    try {
      return BenchmarkDAO.list(docId, pageNum);
    } catch (error) {
      console.error('db:list-benchmarks error:', error);
      return [];
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

  ipcMain.handle('db:save-sentence-translation', async (_, { sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode, translatedText }) => {
    if (!isValidString(sourceText) || !isValidString(sourceLanguage) || !isValidString(targetLanguage) || !isValidString(translatorEngine) || !isValidString(translationMode) || !isValidString(translatedText)) {
      throw new Error('Invalid input: all arguments must be non-empty strings');
    }
    try {
      return SentenceTranslationDAO.save(sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode, translatedText);
    } catch (error) {
      console.error('db:save-sentence-translation error:', error);
      return false;
    }
  });

  ipcMain.handle('db:save-sentence-translation-batch', async (_, { items }) => {
    if (!Array.isArray(items)) {
      throw new Error('Invalid input: items must be an array');
    }
    try {
      return SentenceTranslationDAO.saveBatch(items);
    } catch (error) {
      console.error('db:save-sentence-translation-batch error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-sentence-translation', async (_, { sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode }) => {
    if (!isValidString(sourceText) || !isValidString(sourceLanguage) || !isValidString(targetLanguage) || !isValidString(translatorEngine) || !isValidString(translationMode)) {
      throw new Error('Invalid input: all arguments must be non-empty strings');
    }
    try {
      return SentenceTranslationDAO.get(sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode);
    } catch (error) {
      console.error('db:get-sentence-translation error:', error);
      return null;
    }
  });

  ipcMain.handle('db:get-sentence-translation-batch', async (_, { sourceTexts, sourceLanguage, targetLanguage, translatorEngine, translationMode }) => {
    if (!Array.isArray(sourceTexts) || !isValidString(sourceLanguage) || !isValidString(targetLanguage) || !isValidString(translatorEngine) || !isValidString(translationMode)) {
      throw new Error('Invalid input: sourceTexts must be an array, other arguments must be non-empty strings');
    }
    try {
      return SentenceTranslationDAO.getBatch(sourceTexts, sourceLanguage, targetLanguage, translatorEngine, translationMode);
    } catch (error) {
      console.error('db:get-sentence-translation-batch error:', error);
      return {};
    }
  });

  // ============================================
    // Document Management IPC Handlers
    // ============================================

    // 🚀 Startup optimization: batch load all needed data in 1 round-trip
      ipcMain.handle('db:startup-load', async () => {
        try {
          return DocumentDAO.getStartupBatch();
        } catch (error) {
          console.error('db:startup-load error:', error);
          return { recentDocuments: [], allTags: [], allProjects: [], latestOcrDocId: null };
        }
      });

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

  ipcMain.handle('db:get-document-cache-size', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return DocumentDAO.getDocumentCacheSize(id);
    } catch (error) {
      console.error('db:get-document-cache-size error:', error);
      return 0;
    }
  });

  // ============================================
  // File System IPC Handlers
  // ============================================
  ipcMain.handle('fs:open-file', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const files = await Promise.all(
        result.filePaths.map(async (filepath) => {
          const documentFile = await inspectExistingDocumentFile(filepath);
          const buffer = await fs.promises.readFile(documentFile.canonicalPath);
          return {
            filepath: documentFile.canonicalPath,
            data: buffer,
            mimeType: documentFile.mimeType,
            size: documentFile.size,
            name: documentFile.name,
          };
        })
      );

      return files;
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
      const requestedPath = getRequestedDocumentPath(filepath)
      const documentFile = await inspectExistingDocumentFile(requestedPath)
      await assertAuthorizedDocumentRead(requestedPath, documentFile.canonicalPath)
      const buffer = await fs.promises.readFile(documentFile.canonicalPath)
      
      return {
        data: buffer,
        mimeType: documentFile.mimeType,
        size: documentFile.size,
        name: documentFile.name
      };
    } catch (error) {
      console.error('fs:read-file error:', error);
      throw error;
    }
  });

  ipcMain.handle('fs:import-file', async (_event, payload: {
    name: string;
    mimeType: string;
    data?: Uint8Array | ArrayBuffer;
    filePath?: string;
  }) => {
    try {
      if (!payload || typeof payload.name !== 'string' || !payload.name) {
        throw new Error('Invalid payload: name is required');
      }

      let rawData: Uint8Array | Buffer;
      if (payload.filePath) {
        if (!fs.existsSync(payload.filePath)) {
          throw new Error(`Invalid filePath: ${payload.filePath} does not exist`);
        }
        rawData = await fs.promises.readFile(payload.filePath);
      } else {
        if (!payload.data) {
          throw new Error('Invalid payload: either filePath or data is required');
        }
        rawData = payload.data instanceof ArrayBuffer
          ? new Uint8Array(payload.data)
          : payload.data;
      }

      if (!(rawData instanceof Uint8Array) && !Buffer.isBuffer(rawData)) {
        throw new Error('Invalid payload: data must be Uint8Array or ArrayBuffer');
      }

      const { finalName, finalExt, resolvedMimeType } = resolveImportedDocumentName(
        payload.name,
        payload.mimeType,
      )
      const importDir = getImportsDirectory()
      await fs.promises.mkdir(importDir, { recursive: true });

      // Use deterministic content-hash path so repeated imports hit the same DB document_id/cache key.
      const contentHash = createHash('sha256').update(Buffer.from(rawData)).digest('hex').slice(0, 24);
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
        mimeType: resolvedMimeType,
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

  ipcMain.handle('ocr:get-gpu-info', async () => {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      let gpuNames: string[] = [];
      if (process.platform === 'win32') {
        try {
          const { stdout } = await execAsync('powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"', { windowsHide: true });
          gpuNames = stdout.split('\n').map((x: string) => x.trim()).filter(Boolean);
          if (gpuNames.length === 0) {
            const { stdout: wmiStdout } = await execAsync('powershell -Command "Get-WmiObject Win32_VideoController | Select-Object -ExpandProperty Name"', { windowsHide: true });
            gpuNames = wmiStdout.split('\n').map((x: string) => x.trim()).filter(Boolean);
          }
        } catch (err) {
          console.warn('[Main] Failed to query GPU names via PowerShell:', err);
        }
      }

      if (gpuNames.length === 0) {
        try {
          const gpuInfo: any = await app.getGPUInfo('basic');
          if (gpuInfo?.gpuDevice) {
            gpuNames = gpuInfo.gpuDevice.map((device: any) => device.deviceString || device.vendorString || 'Unknown GPU');
          }
        } catch (err) {
          console.warn('[Main] Failed to query GPU info via Electron getGPUInfo:', err);
        }
      }

      // Filter out duplicate or empty values
      gpuNames = Array.from(new Set(gpuNames.map(g => g.trim()))).filter(Boolean);

      const hasNvidia = gpuNames.some(g => g.toLowerCase().includes('nvidia'));
      const hasIntel = gpuNames.some(g => g.toLowerCase().includes('intel'));
      const hasAmd = gpuNames.some(g => {
        const lower = g.toLowerCase();
        return lower.includes('amd') || lower.includes('radeon');
      });

      // Determine primary GPU vendor (priority: nvidia > amd > intel)
      let gpuVendor: 'nvidia' | 'amd' | 'intel' | 'unknown' = 'unknown';
      if (hasNvidia) {
        gpuVendor = 'nvidia';
      } else if (hasAmd) {
        gpuVendor = 'amd';
      } else if (hasIntel) {
        gpuVendor = 'intel';
      }

      // Find local virtualenv path to check if DirectML / CUDA is installed
      let hasDirectML = false;
      let hasCuda = false;

      const seen = new Set<string>();
      const searchRoots = [
        process.cwd(),
        app.getAppPath(),
        path.resolve(app.getAppPath(), '..'),
        path.resolve(__dirname, '..'),
        path.dirname(process.execPath),
        path.resolve(path.dirname(process.execPath), '..'),
        path.resolve(path.dirname(process.execPath), '../..'),
        process.resourcesPath,
        process.resourcesPath ? path.resolve(process.resourcesPath, '..') : null,
        process.env.PORTABLE_EXECUTABLE_DIR,
      ];
      if (typeof (global as any).__DEV_PROJECT_ROOT__ !== 'undefined' && (global as any).__DEV_PROJECT_ROOT__) {
        searchRoots.push((global as any).__DEV_PROJECT_ROOT__);
      }

      // Add roots from environment variables if present (especially for packaged environments inheriting variables)
      const envPythonPaths = [
        process.env.OCR_PYTHON_PATH,
        process.env.PADDLE_OCR_PYTHON_PATH,
        process.env.EASY_YOLO_OCR_PYTHON_PATH,
      ];
      for (const envPath of envPythonPaths) {
        if (envPath) {
          const resolvedEnv = path.resolve(envPath);
          if (resolvedEnv.toLowerCase().endsWith('python.exe') || resolvedEnv.toLowerCase().endsWith('python')) {
            const venvRoot = path.resolve(path.dirname(resolvedEnv), '..');
            searchRoots.push(venvRoot);
            searchRoots.push(path.resolve(venvRoot, '..'));
          } else {
            searchRoots.push(resolvedEnv);
          }
        }
      }

      for (const root of searchRoots) {
        if (!root) continue;
        const resolvedRoot = path.resolve(root);
        if (seen.has(resolvedRoot)) continue;
        seen.add(resolvedRoot);

        // Check if the resolvedRoot is directly a virtual environment itself (e.g. env overrides)
        const directSitePackages = path.join(resolvedRoot, 'Lib', 'site-packages');
        if (fs.existsSync(directSitePackages)) {
          const hasTorchDml = fs.existsSync(path.join(directSitePackages, 'torch_directml'));
          const hasOnnxDml1 = fs.existsSync(path.join(directSitePackages, 'onnxruntime_directml'));
          const hasOnnxDml2 = fs.existsSync(path.join(directSitePackages, 'onnxruntime-directml'));
          if (hasTorchDml || hasOnnxDml1 || hasOnnxDml2) {
            hasDirectML = true;
          }
          if (fs.existsSync(path.join(directSitePackages, 'torch', 'cuda'))) {
            hasCuda = true;
          }
        }

        for (const venvDir of ['.venv-ocr', '.venv']) {
          const venvPath = path.join(resolvedRoot, venvDir);
          if (fs.existsSync(venvPath)) {
            const sitePackagesPath = path.join(venvPath, 'Lib', 'site-packages');
            if (fs.existsSync(sitePackagesPath)) {
              const hasTorchDml = fs.existsSync(path.join(sitePackagesPath, 'torch_directml'));
              const hasOnnxDml1 = fs.existsSync(path.join(sitePackagesPath, 'onnxruntime_directml'));
              const hasOnnxDml2 = fs.existsSync(path.join(sitePackagesPath, 'onnxruntime-directml'));
              if (hasTorchDml || hasOnnxDml1 || hasOnnxDml2) {
                hasDirectML = true;
              }
              if (fs.existsSync(path.join(sitePackagesPath, 'torch', 'cuda'))) {
                hasCuda = true;
              }
            }
          }
        }
      }

      // Check environment override
      if (process.env.OCR_USE_DIRECTML === '1') {
        hasDirectML = true;
      }
      if (process.env.OCR_USE_GPU === '1') {
        hasCuda = true;
      }

      let mode: 'CUDA' | 'DirectML' | 'CPU' = 'CPU';
      if (hasCuda && hasNvidia) {
        mode = 'CUDA';
      } else if (hasDirectML) {
        mode = 'DirectML';
      }

      console.log(`[ocr:get-gpu-info] Mode resolved: ${mode} (gpus: ${gpuNames.join(', ') || 'none'})`);

      return {
        gpus: gpuNames.length > 0 ? gpuNames : ['CPU Display Adapter'],
        hasDirectML,
        hasCuda: hasCuda && hasNvidia, // Only report CUDA as active/available if Nvidia GPU is present
        mode,
        gpuVendor,  // 'intel' | 'amd' | 'nvidia' | 'unknown' — used by UI to show "Intel DirectML" etc.
      };
    } catch (error) {
      console.error('ocr:get-gpu-info error:', error);
      return {
        gpus: ['Unknown GPU'],
        hasDirectML: false,
        hasCuda: false,
        mode: 'CPU' as const,
        gpuVendor: 'unknown' as const,
      };
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

  ipcMain.handle('ocr:write-temp-image', async (_, payload: {
    imageData: Uint8Array | ArrayBuffer;
    imageMimeType: string;
  }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid ocr:write-temp-image payload');
    }
    if (!isValidString(payload.imageMimeType)) {
      throw new Error('Invalid ocr:write-temp-image payload: imageMimeType is required');
    }
    if (!payload.imageData) {
      throw new Error('Invalid ocr:write-temp-image payload: imageData is required');
    }
    try {
      const imagePath = await writeOcrTempImage(payload.imageData, payload.imageMimeType);
      return { imagePath };
    } catch (error) {
      console.error('ocr:write-temp-image error:', error);
      throw error;
    }
  });

  ipcMain.handle('ocr:delete-temp-image', async (_, payload: {
    imagePath: string;
  }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid ocr:delete-temp-image payload');
    }
    if (!isValidString(payload.imagePath)) {
      throw new Error('Invalid ocr:delete-temp-image payload: imagePath is required');
    }
    try {
      await deleteOcrTempImage(payload.imagePath);
      return { ok: true };
    } catch (error) {
      console.error('ocr:delete-temp-image error:', error);
      throw error;
    }
  });


  ipcMain.handle('ocr:run-external', async (_, payload: {
    engine: string;
    imagePath?: string;
    imageData?: Uint8Array | ArrayBuffer;
    imageMimeType: string;
    imageWidth: number;
    imageHeight: number;
    language: string;
    dpi: number;
    pageSegMode?: number;
    pipelineProfile?: string;
    ocrQualityProfile?: string;
    maxSideLen?: number;
    chunkIndex?: number;
    totalChunks?: number;
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
    // Must supply either imagePath or imageData
    if (!payload.imagePath && !payload.imageData) {
      throw new Error('Invalid OCR payload: either imagePath or imageData must be provided');
    }
    // Security: imagePath must reside within the designated OCR temp directory
    if (payload.imagePath) {
      const resolvedPath = path.resolve(payload.imagePath);
      const tempRoot = path.join(os.tmpdir(), 'pdf-translator-ocr');
      if (!resolvedPath.startsWith(tempRoot)) {
        throw new Error('Invalid OCR payload: imagePath must be within the OCR temp directory');
      }
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

  ipcMain.handle('ocr:run-raw-direct', async (_, payload: {
    imagePath?: string;
    imageData?: Uint8Array | ArrayBuffer;
    imageMimeType: string;
    imageWidth: number;
    imageHeight: number;
    language: string;
  }) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid OCR payload');
    }
    if (!isValidString(payload.imageMimeType) || !isValidString(payload.language)) {
      throw new Error('Invalid OCR payload: imageMimeType and language are required');
    }
    if (!isValidNumber(payload.imageWidth) || !isValidNumber(payload.imageHeight)) {
      throw new Error('Invalid OCR payload: imageWidth and imageHeight must be positive numbers');
    }
    if (!payload.imagePath && !payload.imageData) {
      throw new Error('Invalid OCR payload: either imagePath or imageData must be provided');
    }

    try {
      return await runExternalOcrRaw(payload);
    } catch (error) {
      console.error('ocr:run-raw-direct error:', error);
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

  ipcMain.handle('ocr:clear-cuda-cache', async (_, payload: { engine: string }) => {
    try {
      const engine = payload?.engine;
      if (engine !== 'paddleocr' && engine !== 'easyocr') {
        throw new Error(`Unsupported OCR engine for CUDA clear: ${engine}`);
      }
      await clearExternalOcrCudaCache(engine);
      return true;
    } catch (error) {
      console.error('ocr:clear-cuda-cache error:', error);
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
  ipcMain.handle('gemini:get-api-key-status', async () => {
    return getGeminiApiKeyStatus();
  });

  ipcMain.handle('gemini:set-api-key', async (_, payload: { apiKey: string }) => {
    if (!payload || typeof payload !== 'object' || !isValidString(payload.apiKey)) {
      throw new Error('Invalid input: apiKey must be a non-empty string');
    }

    return setStoredGeminiApiKey(payload.apiKey);
  });

  ipcMain.handle('gemini:clear-api-key', async () => {
    return clearStoredGeminiApiKey();
  });

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
      baseSystemPrompt,
    } = context as {
      mode?: string;
      sourceType?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      baseSystemPrompt?: string;
    };

    const normalizedMode = mode === 'official' ? 'official' : mode === 'manhwa' ? 'manhwa' : 'manga';

    const normalizedSource = normalizeArgosLanguage(sourceLanguage, 'en');
    const normalizedTarget = normalizeArgosLanguage(targetLanguage, 'th');
    const sourceName = LANGUAGE_DISPLAY_NAMES[normalizedSource] || normalizedSource;
    const targetName = LANGUAGE_DISPLAY_NAMES[normalizedTarget] || normalizedTarget;

    // Resolve API key from secure local storage first, then local environment.
    const apiKey = resolveGeminiApiKey();
    if (!apiKey) {
      throw new Error('Gemini API key is not configured. Save it once in Settings or provide GEMINI_API_KEY locally.');
    }

    const GEMINI_MODEL = 'gemini-2.5-flash-preview-09-2025';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const modePrompt = normalizedMode === 'official'
      ? `You are a professional document translator. Translate from ${sourceName} to ${targetName}. Use clear, formal, and accurate wording. The source text is from OCR and may contain typos (e.g., "MY STERIOUS" -> "MYSTERIOUS", "UKELY" -> "LIKELY") and fragmented lines. Please fix these typos implicitly, combine fragmented lines to form coherent sentences, and translate them naturally into ${targetName} while preserving the general line break structure.`
      : normalizedMode === 'manhwa'
        ? `You are a professional manhwa translator. Translate from ${sourceName} to ${targetName}. Keep dialogue natural and emotionally accurate. The source text is from OCR and may contain typos and fragmented lines. Please fix typos implicitly, combine fragmented lines to form coherent sentences, and translate them naturally into ${targetName} while preserving the general line break structure.`
        : `You are a professional manga translator. Translate from ${sourceName} to ${targetName}. Use informal and emotional wording that matches manga tone. The source text is from OCR and may contain typos and fragmented lines. Please fix typos implicitly, combine fragmented lines to form coherent sentences, and translate them naturally into ${targetName}. Preserve the general line break structure. If the type is "sfx", explain the sound in brackets.`;

    const systemPrompt = isValidString(baseSystemPrompt)
      ? baseSystemPrompt
      : modePrompt;

    const promptText = sourceType === 'batch-markdown'
      ? String(text)
      : `Translate this text: "${text}" (Type: ${sourceType})`;

    const payload = {
      contents: [{ parts: [{ text: promptText }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_NONE'
        },
        {
          category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
          threshold: 'BLOCK_NONE'
        }
      ]
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

  ipcMain.handle('pdf-export:start', async (event, request) => {
    if (!request || typeof request !== 'object' || typeof request.jobId !== 'string') {
      throw new Error('Invalid PDF export job payload.');
    }

    let manifest;
    try {
      manifest = await stagePdfExportJob(request);
      const bytes = await startPdfPrintExport(manifest, (done, total) => {
        event.sender.send('pdf-export:progress', {
          jobId: request.jobId,
          done,
          total,
          progress: Math.round((done / Math.max(1, total)) * 100),
        });
      });
      return { ok: true, bytes };
    } catch (error) {
      await cleanupStagedPdfExportJob(request.jobId);
      const message = error instanceof Error ? error.message : 'PDF export failed';
      if (message === 'Export canceled') {
        return { ok: false, error: message };
      }
      throw error;
    }
  });

  ipcMain.handle('pdf-export:cancel', async (_, payload: { jobId?: string }) => {
    if (!payload?.jobId) {
      return { ok: false };
    }
    cancelPdfPrintExport(payload.jobId);
    return { ok: true };
  });

  createWindow();
})

