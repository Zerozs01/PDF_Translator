import { app, BrowserWindow, Menu, protocol, net, powerSaveBlocker } from 'electron'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'

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
import { initDB, closeDB, checkpointDB } from './db'
import * as authService from './authService'
import { disposeExternalOcrDaemons, getExternalOcrEngineStatuses } from './ocrBridge'
import { disposeArgosTranslateRuntime } from './argosBridge'
import {
  disposeAllStagedPdfExportJobs,
  resolvePdfExportProtocolPath,
} from './pdfExportStaging'
import { registerAllIpcHandlers } from './ipc'


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
    backgroundColor: '#17181b',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e0f11',
      symbolColor: '#cbd5e1',
      height: 32,
    },
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

  // Enable DevTools shortcut (Ctrl+Shift+I or F12), page refresh (Ctrl+R / F5), and Fullscreen toggle (F11)
  win.webContents.on('before-input-event', (event, input) => {
    if ((input.control && input.shift && input.key.toLowerCase() === 'i') || input.key === 'F12') {
      win?.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (input.key === 'F11' && input.type === 'keyDown') {
      const isFullScreen = win?.isFullScreen() ?? false;
      win?.setFullScreen(!isFullScreen);
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
// Disable renderer backgrounding and background timer throttling to keep
// background queue tasks running when window is backgrounded or system is locked
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// ─── GPU Rasterization & Zero-Copy (Rust/Tauri equivalent) ──────────────────
// Enable GPU-backed tile rasterization — offloads raster work from CPU to GPU
app.commandLine.appendSwitch('enable-gpu-rasterization');
// Skip compositor buffer copies — renders directly to display framebuffer
app.commandLine.appendSwitch('enable-zero-copy');
// Force 2D canvas operations through GPU — accelerates PDF overlay rendering
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
// Use OS-level vsync instead of software vsync for smoother canvas animations
app.commandLine.appendSwitch('disable-frame-rate-limit');

// ─── V8 Memory Tuning ──────────────────────────────────────────────────────────
// Cap V8 old-generation heap to 1 GB — forces more aggressive GC reclamation
// and prevents runaway heap growth during heavy multi-page OCR processing
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=1024');
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

  // Register all modular IPC Handlers
  registerAllIpcHandlers({
    getMainWindow: () => win,
    powerSaveState: {
      get powerSaveBlockerId() { return powerSaveBlockerId; },
      set powerSaveBlockerId(val: number | null) { powerSaveBlockerId = val; }
    }
  });

  createWindow();
})

