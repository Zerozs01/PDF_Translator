import { app, BrowserWindow, ipcMain, Menu, dialog, protocol, net } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { createHash, randomUUID } from 'crypto'
import { spawn } from 'child_process'
import { pathToFileURL } from 'url'
import https from 'https'
import zlib from 'zlib'

// Register tessdata custom scheme before app ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'tessdata', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);
import { initDB, checkpointDB, DocumentDAO, OCRCacheDAO, ProjectDAO, TagDAO, TranslationCacheDAO, BenchmarkDAO, SentenceTranslationDAO } from './db'
import { getRequestedDocumentPath, inspectExistingDocumentFile, isPathWithinDirectory, resolveImportedDocumentName, tryResolveRealDocumentPath } from './documentFileAccess'
import { cancelExternalOcr, deleteOcrTempImage, disposeExternalOcrDaemons, getExternalOcrEngineStatuses, prewarmExternalOcrEngine, runExternalOcr, writeOcrTempImage, runExternalOcrRaw } from './ocrBridge'
import { clearStoredGeminiApiKey, getGeminiApiKeyStatus, resolveGeminiApiKey, setStoredGeminiApiKey } from './secureSettings'
// BenchmarkDAO not implemented in this file (db.ts handles)

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
let disposeArgosTranslateRuntime: (() => void) | null = null
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
  disposeExternalOcrDaemons()
  disposeArgosTranslateRuntime?.()
  // Flush WAL so the .db file is fully up-to-date when the process exits
  checkpointDB('FULL')
})

// Last-resort cleanup: ensure all child processes are killed even if
// 'before-quit' or 'window-all-closed' fail to run (e.g. Vite HMR restart).
process.on('exit', () => {
  disposeExternalOcrDaemons()
  disposeArgosTranslateRuntime?.()
})

// ─── Chromium / GPU flags (must be set before app.whenReady) ────────────────
// Disable GPU shader disk cache to prevent "Access is denied" / "Unable to move
// the cache" errors that appear on every launch when the cache dir is locked.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
// Suppress AMD DirectComposition VideoProcessorGetOutputExtension error spam
app.commandLine.appendSwitch('disable-direct-composition-video-overlays');
// ─────────────────────────────────────────────────────────────────────────────

app.whenReady().then(() => {

  // Initialize SQLite Database with Performance Pragmas
  initDB();

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

  // Model Management IPC Handlers
  ipcMain.handle('models:get-status', async (_, { engine, language }) => {
    if (!isValidString(language)) {
      throw new Error('Invalid language code');
    }
    
    const lang = language.trim().toLowerCase();
    
    if (engine === 'tesseract') {
      const fileName = `${lang}.traineddata`;
      
      // Check in userData/tessdata
      const userPath = path.join(app.getPath('userData'), 'tessdata', fileName);
      if (fs.existsSync(userPath)) return { installed: true };
      
      // Check in dist/tessdata
      const appPath = path.join(process.env.DIST || '', 'tessdata', fileName);
      if (fs.existsSync(appPath)) return { installed: true };
      
      // Check in public/tessdata (dev mode)
      const devPath = path.join(process.cwd(), 'public', 'tessdata', fileName);
      if (fs.existsSync(devPath)) return { installed: true };
      
      return { installed: false };
    }
    
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
    
    if (engine === 'tesseract') {
      const url = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`;
      const destDir = path.join(app.getPath('userData'), 'tessdata');
      await fs.promises.mkdir(destDir, { recursive: true });
      const gzPath = path.join(destDir, `${lang}.traineddata.gz`);
      const finalPath = path.join(destDir, `${lang}.traineddata`);
      
      return new Promise<boolean>((resolve, reject) => {
        https.get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Tesseract CDN returned HTTP ${res.statusCode}`));
            return;
          }
          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let downloadedBytes = 0;
          const file = fs.createWriteStream(gzPath);
          
          res.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            if (totalBytes > 0) {
              const progress = Math.round((downloadedBytes / totalBytes) * 100);
              event.sender.send('main-process-message', {
                type: 'model-download-progress',
                engine: 'tesseract',
                language: lang,
                progress,
              });
            }
          });

          res.pipe(file);
          file.on('finish', () => {
            file.close(async () => {
              try {
                const gzBytes = await fs.promises.readFile(gzPath);
                const rawBytes = zlib.gunzipSync(gzBytes);
                await fs.promises.writeFile(finalPath, rawBytes);
                // Also keep gz final path
                const gzFinalPath = path.join(destDir, `${lang}.traineddata.gz`);
                await fs.promises.rename(gzPath, gzFinalPath);
                resolve(true);
              } catch (err) {
                reject(err);
              }
            });
          });

          file.on('error', (err) => {
            reject(err);
          });
        }).on('error', reject);
      });
    }

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
    typeof value === 'string' && ['tesseract', 'paddleocr', 'easyocr'].includes(value);

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

  const normalizePythonOverride = (value: string | undefined): string | null => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    if (/[\\/]/.test(trimmed) || path.isAbsolute(trimmed)) {
      const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
      return fs.existsSync(resolved) ? resolved : null;
    }
    return trimmed;
  };

  const findLocalPythonExecutable = (
    roots: Array<string | null | undefined>,
    venvDirs: string[] = ['.venv-ocr', '.venv']
  ): string | null => {
    const pythonRelativePath = process.platform === 'win32'
      ? ['Scripts', 'python.exe']
      : ['bin', 'python'];
    const seen = new Set<string>();

    for (const root of roots) {
      if (!root) continue;
      const resolvedRoot = path.resolve(root);
      if (seen.has(resolvedRoot)) continue;
      seen.add(resolvedRoot);

      for (const venvDir of venvDirs) {
        const candidate = path.join(resolvedRoot, venvDir, ...pythonRelativePath);
        if (fs.existsSync(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  };

  const resolvePythonExecutable = (): string => {
    const argosOverride = normalizePythonOverride(process.env.ARGOS_PYTHON_PATH);
    if (argosOverride) return argosOverride;

    const appOverride = normalizePythonOverride(process.env.PDF_TRANSLATOR_PYTHON);
    if (appOverride) return appOverride;

    const localVenvPython = findLocalPythonExecutable([
      process.cwd(),
      app.getAppPath(),
      path.resolve(app.getAppPath(), '..'),
      path.resolve(__dirname, '..'),
      path.dirname(process.execPath),
      process.resourcesPath,
      process.resourcesPath ? path.resolve(process.resourcesPath, '..') : null,
    ], ['.venv', '.venv-argos']);
    if (localVenvPython) return localVenvPython;

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

  const resolveArgosBridgeEnv = (): NodeJS.ProcessEnv => {
    const userDataRoot = path.join(app.getPath('userData'), 'argos-runtime');
    const configHome = process.env.XDG_CONFIG_HOME || path.join(userDataRoot, 'config');
    const cacheHome = process.env.XDG_CACHE_HOME || path.join(userDataRoot, 'cache');
    fs.mkdirSync(configHome, { recursive: true });
    fs.mkdirSync(cacheHome, { recursive: true });

    const packageDirCandidates = [
      process.env.ARGOS_PACKAGES_DIR,
      process.env.ARGOS_TRANSLATE_PACKAGE_DIR,
      path.join(app.getPath('home'), '.local', 'share', 'argos-translate', 'packages'),
      path.join(userDataRoot, 'packages'),
    ].filter((candidate): candidate is string => Boolean(candidate));

    const packageDir = packageDirCandidates.find((candidate) => {
      try {
        return fs.existsSync(candidate);
      } catch {
        return false;
      }
    });

    return {
      ...process.env,
      PYTHONUTF8: '1',
      XDG_CONFIG_HOME: configHome,
      XDG_CACHE_HOME: cacheHome,
      ...(packageDir ? {
        ARGOS_PACKAGES_DIR: packageDir,
        ARGOS_TRANSLATE_PACKAGE_DIR: packageDir,
      } : {}),
    };
  };

  interface ArgosBridgeResponse {
    ok?: boolean;
    id?: string;
    translations?: unknown;
    reason?: string;
    warning?: string;
    fallbackReason?: string;
  }

  interface ArgosPendingRequest {
    resolve: (response: ArgosBridgeResponse) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }

  interface ArgosBridgeDaemon {
    child: ReturnType<typeof spawn>;
    stdoutBuffer: string;
    stderrBuffer: string;
    pending: Map<string, ArgosPendingRequest>;
    pythonExecutable: string;
    bridgePath: string;
    bridgeSignature: string;
  }

  const argosBridgeScriptSignature = (bridgePath: string): string => {
    try {
      const stat = fs.statSync(bridgePath);
      return `${bridgePath}:${Math.floor(stat.mtimeMs)}`;
    } catch {
      return `${bridgePath}:unknown`;
    }
  };

  let argosBridgeDaemon: ArgosBridgeDaemon | null = null;

  const teardownArgosDaemon = (reason?: Error, targetDaemon?: ArgosBridgeDaemon | null): void => {
    const daemon = targetDaemon || argosBridgeDaemon;
    if (!daemon) return;

    if (daemon === argosBridgeDaemon) {
      argosBridgeDaemon = null;
    }

    for (const [, pending] of daemon.pending) {
      clearTimeout(pending.timeout);
      pending.reject(reason ?? new Error('Argos translation daemon stopped unexpectedly'));
    }
    daemon.pending.clear();
    if (!daemon.child.killed) {
      daemon.child.kill();
    }
  };

  disposeArgosTranslateRuntime = () => {
    teardownArgosDaemon(new Error('Argos translation runtime disposed'));
  };

  const handleArgosDaemonStdout = (chunk: Buffer, targetDaemon?: ArgosBridgeDaemon | null): void => {
    const daemon = targetDaemon || argosBridgeDaemon;
    if (!daemon) return;

    daemon.stdoutBuffer += chunk.toString();
    const lines = daemon.stdoutBuffer.split(/\r?\n/);
    daemon.stdoutBuffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      let payload: ArgosBridgeResponse;
      try {
        payload = JSON.parse(line) as ArgosBridgeResponse;
      } catch {
        console.warn(`[argosBridge] Ignoring non-JSON stdout: ${line}`);
        continue;
      }

      if (!payload.id) {
        console.warn('[argosBridge] Ignoring daemon response without request id');
        continue;
      }

      const pending = daemon.pending.get(payload.id);
      if (!pending) {
        console.warn(`[argosBridge] Received orphaned daemon response ${payload.id}`);
        continue;
      }

      daemon.pending.delete(payload.id);
      clearTimeout(pending.timeout);
      if (payload.ok === false) {
        pending.reject(new Error(payload.reason || 'Argos translation bridge failed'));
        continue;
      }
      pending.resolve(payload);
    }
  };

  const ensureArgosDaemon = (): ArgosBridgeDaemon => {
      const pythonExecutable = resolvePythonExecutable();
      const bridgePath = resolveArgosBridgePath();
      const bridgeSignature = argosBridgeScriptSignature(bridgePath);
      const env = {
        ...resolveArgosBridgeEnv(),
        // Keep offline translation deterministic and avoid runtime Stanza resource fetches.
        ARGOS_CHUNK_TYPE: process.env.ARGOS_CHUNK_TYPE || 'MINISBD',
      };

      // Reuse existing daemon if: not killed, path/executable/signature unchanged, and process still alive
      if (
        argosBridgeDaemon
        && !argosBridgeDaemon.child.killed
        && argosBridgeDaemon.pythonExecutable === pythonExecutable
        && argosBridgeDaemon.bridgePath === bridgePath
        && argosBridgeDaemon.bridgeSignature === bridgeSignature
      ) {
        // Double-check: is the child process actually alive? (handles orphaned state)
        try {
          process.kill(argosBridgeDaemon.child.pid!, 0); // Signal 0 = check-only, doesn't kill
          return argosBridgeDaemon; // Process is alive, reuse it
        } catch {
          // Process is dead (pid doesn't exist or already exited), continue to spawn new
        }
      }

      if (argosBridgeDaemon) {
        teardownArgosDaemon(new Error('Argos bridge runtime changed or process died; restarting daemon'));
      }

      const child = spawn(pythonExecutable, [bridgePath, '--stdio-server'], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });

      const daemon: ArgosBridgeDaemon = {
        child,
        stdoutBuffer: '',
        stderrBuffer: '',
        pending: new Map(),
        pythonExecutable,
        bridgePath,
        bridgeSignature,
      };

      child.stdout.on('data', (chunk: Buffer) => {
        handleArgosDaemonStdout(chunk, daemon);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        daemon.stderrBuffer += chunk.toString();
        const message = chunk.toString().trim();
        if (argosBridgeDaemon && argosBridgeDaemon.child === child && message) {
          console.warn(`[argosBridge] ${message}`);
        }
      });
      child.on('error', (error) => {
        teardownArgosDaemon(error, daemon);
      });
      child.on('close', (code, signal) => {
        const stderr = daemon.stderrBuffer.trim();
        const exitMessage = `Argos bridge exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
        teardownArgosDaemon(
          new Error(stderr ? `${exitMessage}: ${stderr}` : exitMessage),
          daemon
        );
      });

      argosBridgeDaemon = daemon;
      return daemon;
    };

  const requestArgosDaemon = async (
    payload: Record<string, unknown>,
    requestTimeoutMs: number
  ): Promise<ArgosBridgeResponse> => {
    const daemon = ensureArgosDaemon();
    const id = randomUUID();

    return await new Promise<ArgosBridgeResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        daemon.pending.delete(id);
        teardownArgosDaemon(new Error(`Argos translation timed out after ${requestTimeoutMs}ms`));
        reject(new Error(`Argos translation timed out after ${requestTimeoutMs}ms`));
      }, requestTimeoutMs);

      daemon.pending.set(id, { resolve, reject, timeout });

      try {
        const stdin = daemon.child.stdin;
        if (!stdin) {
          throw new Error('Argos daemon stdin is unavailable');
        }
        stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
      } catch (error) {
        daemon.pending.delete(id);
        clearTimeout(timeout);
        reject(error instanceof Error ? error : new Error(String(error)));
        teardownArgosDaemon(error instanceof Error ? error : new Error(String(error)));
      }
    });
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

    const payload = {
      texts: texts.map((text) => String(text || '')),
      sourceLanguage,
      targetLanguage,
      mode: String(context?.mode || 'manga'),
      sourceType: String(context?.sourceType || 'text'),
    };

    const dedupedTexts: string[] = [];
    const dedupeIndexByText = new Map<string, number>();
    const textOrder: number[] = [];
    for (const text of payload.texts) {
      const key = String(text);
      const existing = dedupeIndexByText.get(key);
      if (existing !== undefined) {
        textOrder.push(existing);
        continue;
      }
      const nextIndex = dedupedTexts.length;
      dedupeIndexByText.set(key, nextIndex);
      dedupedTexts.push(key);
      textOrder.push(nextIndex);
    }

    const dedupedPayload = {
      ...payload,
      texts: dedupedTexts,
    };

    let response: ArgosBridgeResponse;
    try {
      response = await requestArgosDaemon(dedupedPayload, timeoutMs);
    } catch (error) {
      teardownArgosDaemon(
        error instanceof Error ? error : new Error(String(error))
      );
      response = await requestArgosDaemon(dedupedPayload, timeoutMs);
    }

    if (!Array.isArray(response.translations)) {
      throw new Error('Argos translation bridge returned invalid payload');
    }

    const dedupedTranslations = response.translations.map((item) => String(item ?? ''));
    if (dedupedTranslations.length !== dedupedTexts.length) {
      throw new Error(`Argos translation count mismatch: expected ${dedupedTexts.length}, got ${dedupedTranslations.length}`);
    }

    return textOrder.map((index) => dedupedTranslations[index] ?? '');
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

  // ============================================
    // Document Management IPC Handlers
    // ============================================

    // 🚀 Startup optimization: batch load all needed data in 1 round-trip
      ipcMain.handle('db:startup-load', async () => {
        try {
          const db = initDB();
          // Run all queries in parallel — SQLite with WAL handles concurrency well
          const [recentDocs, allTags, allProjects, latestOcr] = await Promise.all([
            Promise.resolve().then(() => {
              // Fast path: get recent docs WITHOUT tags join (hydrate in JS instead)
              if (!db) throw new Error('DB not initialized');
              return db.prepare(`
                SELECT d.id, d.filepath, d.filename, d.total_pages, d.last_accessed,
                       d.is_favorite, d.project_id, d.last_page, d.file_type, d.file_size
                FROM documents d
                ORDER BY d.last_accessed DESC
                LIMIT 50
              `).all();
            }),
            Promise.resolve().then(() => TagDAO.getAll()),
            Promise.resolve().then(() => ProjectDAO.getAll()),
            Promise.resolve().then(() => {
              if (!db) return null;
              const latestDoc = db.prepare(`
                SELECT id FROM documents ORDER BY last_accessed DESC LIMIT 1
              `).get() as { id: number } | undefined;
              return latestDoc ? OCRCacheDAO.getLatestForDocument(latestDoc.id) : null;
            }),
          ]);

          // Hydrate tag_names/tag_colors from document_tags in JS (faster than SQL JOIN per row)
          const docIds = (recentDocs as Array<{ id: number }>).map(d => d.id);
          let tagMap: Map<number, { names: string[]; colors: string[] }> = new Map();
          if (docIds.length > 0 && db) {
            const placeholders = docIds.map(() => '?').join(', ');
            const tagRows = db.prepare(`
              SELECT dt.document_id, t.name, t.color
              FROM document_tags dt
              JOIN tags t ON t.id = dt.tag_id
              WHERE dt.document_id IN (${placeholders})
              ORDER BY t.name
            `).all(...docIds) as Array<{ document_id: number; name: string; color: string }>;
            for (const row of tagRows) {
              if (!tagMap.has(row.document_id)) {
                tagMap.set(row.document_id, { names: [], colors: [] });
              }
              const entry = tagMap.get(row.document_id)!;
              entry.names.push(row.name);
              entry.colors.push(row.color);
            }
          }

          const hydratedDocs = (recentDocs as Array<{ id: number }>).map(doc => {
            const tags = tagMap.get(doc.id);
            return {
              ...doc,
              tag_names: tags ? tags.names.join(',') : null,
              tag_colors: tags ? tags.colors.join(',') : null,
            };
          });

          return {
            recentDocuments: hydratedDocs,
            allTags,
            allProjects,
            latestOcrDocId: (recentDocs as Array<{ id: number }>)?.[0]?.id ?? null,
          };
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
      const documentFile = await inspectExistingDocumentFile(filepath)
      const buffer = await fs.promises.readFile(documentFile.canonicalPath)

      return {
        filepath: documentFile.canonicalPath,
        data: buffer,
        mimeType: documentFile.mimeType,
        size: documentFile.size,
        name: documentFile.name,
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

