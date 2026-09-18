import { app, BrowserWindow, Menu, protocol, net, powerSaveBlocker } from 'electron'
import path from 'path'
import fs from 'fs'
import { pathToFileURL } from 'url'

// --- Production Logger Fallback (Non-blocking Async Stream with Auto-Rotation & Sanitization) ---
const MAX_LOG_FILE_SIZE = 10 * 1024 * 1024; // 10MB limit per log file
const MAX_ARG_LENGTH = 4000; // Cap single-arg dumps to prevent unbounded memory/buffer usage

let logStream: fs.WriteStream | null = null;
let isShuttingDown = false;
let approxLogBytesWritten = 0;

function rotateLogFileIfNeeded(logFilePath: string): void {
  try {
    if (fs.existsSync(logFilePath)) {
      const stats = fs.statSync(logFilePath);
      if (stats.size >= MAX_LOG_FILE_SIZE) {
        const backupPath = `${logFilePath}.old`;
        if (fs.existsSync(backupPath)) {
          try { fs.unlinkSync(backupPath); } catch {}
        }
        fs.renameSync(logFilePath, backupPath);
      }
    }
  } catch {
    // Best-effort rotation; failures must not block app startup
  }
}

function getLogStream(): fs.WriteStream | null {
  if (isShuttingDown) return null;
  if (!logStream) {
    try {
      const logFilePath = path.join(app.getPath('userData'), 'main.log');
      rotateLogFileIfNeeded(logFilePath);
      if (fs.existsSync(logFilePath)) {
        try { approxLogBytesWritten = fs.statSync(logFilePath).size; } catch { approxLogBytesWritten = 0; }
      } else {
        approxLogBytesWritten = 0;
      }
      logStream = fs.createWriteStream(logFilePath, { flags: 'a', encoding: 'utf8' });
      logStream.on('error', () => {
        // Prevent unhandled stream error from crashing app
        logStream = null;
      });
    } catch {
      return null;
    }
  }
  return logStream;
}

function flushAndCloseLogger(): void {
  isShuttingDown = true;
  if (logStream) {
    try {
      logStream.end();
    } catch {}
    logStream = null;
  }
}

function sanitizeLogArg(arg: unknown): string {
  let str: string;
  if (typeof arg === 'object' && arg !== null) {
    try {
      str = JSON.stringify(arg);
    } catch {
      str = String(arg);
    }
  } else {
    str = String(arg);
  }
  if (str.length > MAX_ARG_LENGTH) {
    str = `${str.slice(0, MAX_ARG_LENGTH)}... [truncated]`;
  }
  // Neutralize newlines to prevent Log Injection (CWE-117)
  return str.replace(/\r\n|\r|\n/g, ' \\n ');
}

function logToFile(level: string, ...args: unknown[]) {
  const stream = getLogStream();
  if (!stream) return;
  const message = args.map(sanitizeLogArg).join(' ');
  const logLine = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  try {
    stream.write(logLine);
    approxLogBytesWritten += logLine.length;
    if (approxLogBytesWritten >= MAX_LOG_FILE_SIZE) {
      approxLogBytesWritten = 0;
      try { stream.end(); } catch {}
      logStream = null;
    }
  } catch {}
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args: unknown[]) => {
  originalLog(...args);
  logToFile('INFO', ...args);
};
console.warn = (...args: unknown[]) => {
  originalWarn(...args);
  logToFile('WARN', ...args);
};
console.error = (...args: unknown[]) => {
  originalError(...args);
  logToFile('ERROR', ...args);
};

// Register custom schemes before app ready
protocol.registerSchemesAsPrivileged([
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
  flushAndCloseLogger()
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
  flushAndCloseLogger()
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

