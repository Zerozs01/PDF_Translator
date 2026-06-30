import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, exec } from 'child_process';
import { randomUUID } from 'crypto';
import { findLocalPythonExecutable, normalizePythonOverride } from './pythonRuntime';

declare const __DEV_PROJECT_ROOT__: string | undefined;

// Load local .env file from project root if it exists
function loadLocalEnv() {
  try {
    let envPath = path.join(app.getAppPath(), '.env');
    if (!fs.existsSync(envPath) && typeof __DEV_PROJECT_ROOT__ !== 'undefined' && __DEV_PROJECT_ROOT__) {
      envPath = path.join(__DEV_PROJECT_ROOT__, '.env');
    }
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (!(key in process.env)) {
            process.env[key] = value;
          }
        }
      }
    }
  } catch (err) {
    console.error('[ocrBridge] Failed to load .env file:', err);
  }
}

loadLocalEnv();

type ExternalBridgeEngine = 'paddleocr' | 'easyocr';

export interface ExternalOcrEngineStatus {
  engine: ExternalBridgeEngine;
  available: boolean;
  runtime: string;
  description: string;
}

export interface ExternalOcrWarmupResponse {
  ok: boolean;
  engine: ExternalBridgeEngine;
  runtime: string;
  description: string;
}

export interface ExternalOcrRequestPayload {
  id?: string;
  engine: string;
  chunkIndex?: number;
  totalChunks?: number;
  /**
   * Absolute path to a temp image file already written to disk.
   * Preferred over imageData — avoids heavy buffer serialization across the IPC bridge.
   * When provided, runExternalOcr bypasses the writeFile step entirely.
   */
  imagePath?: string;
  /**
   * @deprecated Provide imagePath instead to eliminate IPC buffer copy overhead.
   * Still supported for backward-compatibility but will be removed in a future version.
   */
  imageData?: Uint8Array | ArrayBuffer;
  imageMimeType: string;
  imageWidth: number;
  imageHeight: number;
  language: string;
  dpi: number;
  pageSegMode?: number;
  pipelineProfile?: string;
  ocrQualityProfile?: string;
  /**
   * Override PaddleOCR det_limit_side_len (pixels) for this request.
   * Defaults to 4800 when omitted — optimal for dense academic PDFs.
   * Use up to 6000 for tall financial spreadsheets or receipts.
   * Hard-capped at 6000 to prevent the DB++ "Donut Effect".
   */
  maxSideLen?: number;
  maxPixels?: number;
  useAngleCls?: boolean;
  use_angle_cls?: boolean;
}

interface ExternalOcrBridgeResponse {
  ok: boolean;
  id?: string;
  engine?: string;
  words?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  lines?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number }; words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }>;
  text?: string;
  confidence?: number;
  pageSegMode?: number;
  debug?: unknown;
  runtime?: string;
  description?: string;
  available?: boolean;
  reason?: string;
}

const EXTERNAL_ENGINES: ExternalBridgeEngine[] = ['paddleocr', 'easyocr'];
const bridgeDaemons = new Map<ExternalBridgeEngine, BridgeDaemon>();
const daemonIdleTimers = new Map<ExternalBridgeEngine, NodeJS.Timeout>();
let externalOcrTempRoot: string | null = null;
const BENIGN_BRIDGE_STDERR_PATTERNS = [
  /pin_memory.*no accelerator/i,
  /connectivity check to the model hoster has been skipped/i,
  /creating model:/i,
  /model files already exist/i,
  /no ccache found/i,
  /resized image size .* exceeds max_side_limit/i,
  /info:\s*could not find files for the given pattern/i,
  /lang.*ocr_version.*will be ignored when model names/i,
  // PaddlePaddle / ppocr DEBUG noise
  /ppocr\s+DEBUG:/i,
  /ppocr\s+INFO:/i,
  /ppocr\s+WARNING:/i,
  /^\s*Namespace\(/i,
  /\[0-9]{4}\/[0-9]{2}\/[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\] ppocr/i,
  /W[0-9]+.*paddle/i,
  /I[0-9]+.*paddle/i,
  /^W[0-9]{4}\s/,
  /^I[0-9]{4}\s/,
  // GPU / CUDA / ZLUDA init messages
  /paddle.*use_gpu/i,
  /paddle.*gpu_id/i,
  /gpu.*successfully/i,
  /cuda.*successfully/i,
  /^.*ZLUDA.*(loaded|initialized|version)/i,
  /registering.*hook/i,
  /model.*warmup/i,
  /^.*nvinfer.*[Ii]nfo/i,
  // Electron / DirectComposition noise (not from bridge, but suppress at bridge level too)
  /direct_composition/i,
  /AMD VideoProcessor/i,
];


interface BridgeDaemonRequest {
  resolve: (response: ExternalOcrBridgeResponse) => void;
  reject: (error: Error) => void;
  payload?: Record<string, unknown>;
}

interface BridgeDaemon {
  engine: ExternalBridgeEngine;
  child: ReturnType<typeof spawn>;
  stdoutBuffer: string;
  pending: Map<string, BridgeDaemonRequest>;
  scriptPath: string;
  scriptSignature: string;
  queue: Array<{
    payload: Record<string, unknown>;
    resolve: (response: ExternalOcrBridgeResponse) => void;
    reject: (error: Error) => void;
    timeoutMs: number;
  }>;
  running: boolean;
}

function resolveBridgeScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ocr-bridge', 'external_ocr_bridge.py')
    : path.join(app.getAppPath(), 'scripts', 'external_ocr_bridge.py');
}

function resolveBridgeScriptSignature(scriptPath: string): string {
  try {
    const stat = fs.statSync(scriptPath);
    return `${scriptPath}:${Math.floor(stat.mtimeMs)}`;
  } catch {
    return `${scriptPath}:unknown`;
  }
}

function resolvePythonExecutable(engine: ExternalBridgeEngine): string {
  const engineOverride = engine === 'paddleocr'
    ? normalizePythonOverride(process.env.PADDLE_OCR_PYTHON_PATH)
    : normalizePythonOverride(process.env.EASY_YOLO_OCR_PYTHON_PATH);
  if (engineOverride) return engineOverride;

  const sharedOverride = normalizePythonOverride(process.env.OCR_PYTHON_PATH);
  if (sharedOverride) return sharedOverride;

  const localVenvPython = findLocalPythonExecutable([
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
  ]);
  if (localVenvPython) return localVenvPython;

  return 'python';
}

function resolveBridgeEnv(engine?: ExternalBridgeEngine): NodeJS.ProcessEnv {
  // If ZLUDA is enabled, prepend the ZLUDA directory to PATH so that
  // Python/PaddlePaddle can find all cudnn*.dll files at runtime.
  // ZLUDA replaces CUDA DLLs — all cudnn_*.dll must be on PATH.
  const baseEnv = { ...process.env };
  const useZluda = baseEnv.OCR_USE_ZLUDA === '1' || baseEnv.USE_ZLUDA === '1';
  const engineAllowsZluda = engine !== 'paddleocr' && engine !== 'easyocr';
  
  const isWin = process.platform === 'win32';
  const sep = isWin ? ';' : ':';
  
  let currentPath = '';
  let pathKey = 'PATH';
  for (const k of Object.keys(baseEnv)) {
    if (k.toUpperCase() === 'PATH') {
      currentPath = baseEnv[k] || '';
      pathKey = k;
      break;
    }
  }
  
  const priorityPaths: string[] = [];
  
  // 1. Python Virtual Environment directory (e.g., .venv-ocr/Scripts or bin)
  if (engine) {
    try {
      const pythonExe = resolvePythonExecutable(engine);
      if (pythonExe && pythonExe !== 'python') {
        const pythonDir = path.dirname(pythonExe);
        if (fs.existsSync(pythonDir)) {
          priorityPaths.push(pythonDir);
        }
      }
    } catch (err) {
      console.warn('[ocrBridge] Failed to resolve python directory for PATH cleanup:', err);
    }
  }
  
  // 2. Windows system directories (system32, Windows, etc.)
  if (isWin) {
    const windir = baseEnv.windir || 'C:\\Windows';
    const system32 = path.join(windir, 'System32');
    const wbem = path.join(system32, 'Wbem');
    const powershell = path.join(system32, 'WindowsPowerShell', 'v1.0');
    
    [system32, windir, wbem, powershell].forEach(dir => {
      if (fs.existsSync(dir)) {
        priorityPaths.push(dir);
      }
    });
  }
  
  // 3. ZLUDA directory if enabled
  if (useZluda && engineAllowsZluda) {
    const zludaExe = baseEnv.ZLUDA_PATH || '';
    const zludaDir = zludaExe ? path.dirname(zludaExe) : '';
    if (zludaDir && fs.existsSync(zludaDir)) {
      priorityPaths.push(zludaDir);
    }
  }
  
  const existingPaths = currentPath.split(sep).map(p => p.trim()).filter(Boolean);
  const finalPaths: string[] = [];
  const seen = new Set<string>();
  const norm = (p: string) => isWin ? p.toLowerCase() : p;
  
  for (const p of priorityPaths) {
    const n = norm(p);
    if (!seen.has(n)) {
      seen.add(n);
      finalPaths.push(p);
    }
  }
  
  for (const p of existingPaths) {
    const n = norm(p);
    if (!seen.has(n)) {
      seen.add(n);
      finalPaths.push(p);
    }
  }
  
  baseEnv[pathKey] = finalPaths.join(sep);
  // Remove other casings of PATH to avoid duplicates
  for (const k of Object.keys(baseEnv)) {
    if (k.toUpperCase() === 'PATH' && k !== pathKey) {
      delete baseEnv[k];
    }
  }
  
  return {
    ...baseEnv,
    PYTHONUNBUFFERED: '1',
  };
}

function getExternalOcrTempRoot(): string {
  if (externalOcrTempRoot) {
    return externalOcrTempRoot;
  }

  const tempRoot = path.join(os.tmpdir(), 'pdf-translator-ocr');
  fs.mkdirSync(tempRoot, { recursive: true });
  externalOcrTempRoot = tempRoot;
  return tempRoot;
}

function isBenignBridgeStderr(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  return BENIGN_BRIDGE_STDERR_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function getSpawnCommandAndArgs(pythonCmd: string, scriptPath: string, args: string[], engine?: string): { cmd: string; args: string[] } {
  const useZluda = process.env.OCR_USE_ZLUDA === '1' || process.env.USE_ZLUDA === '1';
  // CRITICAL: PaddleOCR must NOT run under ZLUDA.
  // ZLUDA only stubs cuBLAS but NOT cuBLASLt (cublasLt64_11.dll) which PaddlePaddle-GPU requires.
  // Running paddle under ZLUDA causes fused_conv2d / OneDNN context crashes.
  // EasyOCR (PyTorch-based) handles GPU via DirectML instead.
  const engineAllowsZluda = engine !== 'paddleocr' && engine !== 'easyocr';
  if (useZluda && engineAllowsZluda) {
    const zludaPath = process.env.ZLUDA_PATH || 'zluda.exe';
    return {
      cmd: zludaPath,
      args: ['--', pythonCmd, scriptPath, ...args],
    };
  }
  return {
    cmd: pythonCmd,
    args: [scriptPath, ...args],
  };
}

async function runBridgeOnce(
  engine: ExternalBridgeEngine,
  args: string[],
  timeoutMs: number = 30000
): Promise<ExternalOcrBridgeResponse> {
  const scriptPath = resolveBridgeScriptPath();
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`OCR bridge script not found: ${scriptPath}`);
  }

  const pythonCmd = resolvePythonExecutable(engine);
  const { cmd, args: spawnArgs } = getSpawnCommandAndArgs(pythonCmd, scriptPath, args, engine);
  return await new Promise<ExternalOcrBridgeResponse>((resolve, reject) => {
    const child = spawn(cmd, spawnArgs, {
      cwd: path.dirname(scriptPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: resolveBridgeEnv(engine),
      windowsHide: true,
    });

    let timeoutId: NodeJS.Timeout | null = null;
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        const pid = child.pid;
        if (!child.killed) {
          if (process.platform === 'win32' && pid) {
            try {
              spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
                stdio: 'ignore',
                windowsHide: true,
              });
            } catch {
              child.kill('SIGKILL');
            }
          } else {
            child.kill('SIGKILL');
          }
        }
        reject(new Error(`OCR bridge status run timed out after ${timeoutMs / 1000} seconds`));
      }, timeoutMs);
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    });
    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      const trimmed = stdout.trim();
      if (code !== 0) {
        reject(new Error(stderr.trim() || trimmed || `OCR bridge exited with code ${code}`));
        return;
      }

      if (!trimmed) {
        reject(new Error(stderr.trim() || 'OCR bridge returned an empty response'));
        return;
      }

      try {
        resolve(JSON.parse(trimmed) as ExternalOcrBridgeResponse);
      } catch (error) {
        reject(new Error(`Failed to parse OCR bridge response: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

export function resetDaemonIdleTimer(engine: ExternalBridgeEngine): void {
  const existingTimer = daemonIdleTimers.get(engine);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    const daemon = bridgeDaemons.get(engine);
    if (daemon) {
      console.log(`[ocrBridge] Idle timeout reached. Releasing ${engine} daemon due to 5 minutes of inactivity.`);
      teardownDaemon(engine, new Error(`OCR daemon released due to 5 minutes of inactivity`));
    }
    daemonIdleTimers.delete(engine);
  }, 300000); // 5 minutes

  daemonIdleTimers.set(engine, timer);
}

const daemonWatchdogs = new Map<ExternalBridgeEngine, NodeJS.Timeout>();

function getProcessMemory(pid: number): Promise<number> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec(`powershell -NoProfile -Command "Get-Process -Id ${pid} | Select-Object -ExpandProperty WorkingSet64"`, (err, stdout) => {
        if (err) {
          resolve(0);
        } else {
          const bytes = parseInt(stdout.trim(), 10);
          resolve(isNaN(bytes) ? 0 : bytes);
        }
      });
    } else {
      exec(`ps -o rss= -p ${pid}`, (err, stdout) => {
        if (err) {
          resolve(0);
        } else {
          const kb = parseInt(stdout.trim(), 10);
          resolve(isNaN(kb) ? 0 : kb * 1024);
        }
      });
    }
  });
}

function getDynamicMemoryLimitMB(engine: ExternalBridgeEngine): number {
  const totalMemBytes = os.totalmem();
  const totalMemGB = totalMemBytes / (1024 * 1024 * 1024);

  if (engine === 'easyocr') {
    if (totalMemGB >= 31) {
      return 8000; // 8.0 GB for 32GB+ systems
    }
    if (totalMemGB >= 15) {
      return 4500; // 4.5 GB for 16GB systems
    }
    return 2400; // 2.4 GB fallback for 8GB or less
  } else {
    // paddleocr
    if (totalMemGB >= 31) {
      return 4000; // 4.0 GB for 32GB+ systems
    }
    if (totalMemGB >= 15) {
      return 2500; // 2.5 GB for 16GB systems
    }
    return 1200; // 1.2 GB fallback for 8GB or less
  }
}

function startWatchdog(engine: ExternalBridgeEngine, daemon: BridgeDaemon) {
  stopWatchdog(engine);
  const timer = setInterval(async () => {
    const pid = daemon.child.pid;
    if (!pid || daemon.child.killed) {
      stopWatchdog(engine);
      return;
    }

    // 1. Check active state
    let isAlive = false;
    try {
      process.kill(pid, 0);
      isAlive = true;
    } catch {
      isAlive = false;
    }

    if (!isAlive) {
      console.warn(`[ocrBridge] Watchdog detected that ${engine} process ${pid} is dead.`);
      teardownDaemon(engine, new Error(`OCR daemon process died`));
      stopWatchdog(engine);
      return;
    }

    // 2. Check memory footprint
    const memBytes = await getProcessMemory(pid);
    if (memBytes > 0) {
      const memMB = memBytes / (1024 * 1024);
      console.log(`[ocrBridge] Watchdog: ${engine} process ${pid} memory usage: ${memMB.toFixed(2)} MB`);
      const MEMORY_LIMIT_MB = getDynamicMemoryLimitMB(engine);
      if (memMB > MEMORY_LIMIT_MB) {
        console.warn(`[ocrBridge] Watchdog: ${engine} memory usage (${memMB.toFixed(2)} MB) exceeded limit (${MEMORY_LIMIT_MB} MB). Terminating daemon to prevent fragmentation.`);
        teardownDaemon(engine, new Error(`OCR daemon memory limit exceeded`));
        stopWatchdog(engine);
      }
    }
  }, 15000); // Check every 15 seconds
  daemonWatchdogs.set(engine, timer);
}

function stopWatchdog(engine: ExternalBridgeEngine) {
  const timer = daemonWatchdogs.get(engine);
  if (timer) {
    clearInterval(timer);
    daemonWatchdogs.delete(engine);
  }
}

function killProcessPact(child: ReturnType<typeof spawn>, pid: number) {
  console.log(`[ocrBridge] Initiating death pact for process ${pid} using SIGTERM`);
  
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/T', '/PID', String(pid)], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }

  setTimeout(() => {
    let isAlive = false;
    try {
      process.kill(pid, 0);
      isAlive = true;
    } catch {
      isAlive = false;
    }

    if (isAlive) {
      console.warn(`[ocrBridge] Heartbeat did not flatline for process ${pid} after 2000ms. Forcing SIGKILL.`);
      if (process.platform === 'win32') {
        try {
          spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } catch {
          child.kill('SIGKILL');
        }
      } else {
        child.kill('SIGKILL');
      }
    } else {
      console.log(`[ocrBridge] Process ${pid} successfully terminated within 2000ms.`);
    }
  }, 2000);
}

function teardownDaemon(engine: ExternalBridgeEngine, reason?: Error, daemonToKill?: BridgeDaemon): void {
  const daemon = bridgeDaemons.get(engine);

  if (daemonToKill && daemon !== daemonToKill) {
    // If the daemon we want to tear down is not the one currently in the bridgeDaemons map,
    // it means it's an old/outdated daemon (e.g. timed out). We only terminate its child process,
    // but do NOT modify the active daemon or clear the active daemon's queue/pending tasks.
    if (!daemonToKill.child.killed) {
      const pid = daemonToKill.child.pid;
      if (pid) {
        killProcessPact(daemonToKill.child, pid);
      }
    }
    return;
  }

  if (!daemon) return;

  bridgeDaemons.delete(engine);
  stopWatchdog(engine);

  const existingTimer = daemonIdleTimers.get(engine);
  if (existingTimer) {
    clearTimeout(existingTimer);
    daemonIdleTimers.delete(engine);
  }

  if (daemon.queue) {
    for (const task of daemon.queue) {
      task.reject(reason ?? new Error(`OCR daemon for ${engine} stopped unexpectedly`));
    }
    daemon.queue = [];
  }
  daemon.running = false;

  for (const [, pending] of daemon.pending) {
    pending.reject(reason ?? new Error(`OCR daemon for ${engine} stopped unexpectedly`));
  }
  daemon.pending.clear();

  if (!daemon.child.killed) {
    const pid = daemon.child.pid;
    if (pid) {
      killProcessPact(daemon.child, pid);
    }
  }
}

function handleDaemonStdout(engine: ExternalBridgeEngine, chunk: Buffer): void {
  const daemon = bridgeDaemons.get(engine);
  if (!daemon) return;

  daemon.stdoutBuffer += chunk.toString();
  const lines = daemon.stdoutBuffer.split(/\r?\n/);
  daemon.stdoutBuffer = lines.pop() ?? '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let payload: any;
    try {
      payload = JSON.parse(line);
    } catch {
      // Only warn if it's not a known benign PaddleOCR debug/info line
      if (!isBenignBridgeStderr(line)) {
        console.warn(`[ocrBridge] Ignoring non-JSON stdout from ${engine}: ${line}`);
      }
      continue;
    }

    if (payload.type === 'progress') {
      const progressPayload = payload as { id?: string; progress?: number; value?: number };
      const progressId = progressPayload.id;
      let progressVal = typeof progressPayload.progress === 'number' ? progressPayload.progress : progressPayload.value;
      if (progressId && typeof progressVal === 'number') {
        const pending = daemon.pending.get(progressId);
        let loggedScaling = false;
        const originalVal = progressVal;
        if (pending && pending.payload) {
          const reqPayload = pending.payload;
          const total = Number(reqPayload.totalChunks ?? reqPayload.total_chunks);
          const idx = Number(reqPayload.chunkIndex ?? reqPayload.chunk_index);
          
          console.log(`[ocrBridge] Progress raw: ${originalVal}, totalChunks: ${reqPayload.totalChunks} (parsed: ${total}), chunkIndex: ${reqPayload.chunkIndex} (parsed: ${idx})`);
          
          if (!Number.isNaN(total) && !Number.isNaN(idx) && total > 0) {
            const chunkPct = (progressVal / 90) * 100;
            progressVal = Math.round(((idx + chunkPct / 100) / total) * 90);
            console.log(`[ocrBridge] Scaled progress to: ${progressVal} (idx: ${idx}/${total}, pct: ${chunkPct})`);
            loggedScaling = true;
          }
        }
        if (!loggedScaling) {
          console.log(`[ocrBridge] Dispatching UNSCALED progress: ${progressVal} (pending found: ${!!pending})`);
        }
        BrowserWindow.getAllWindows().forEach((w) => {
          w.webContents.send('ocr:progress', { id: progressId, progress: progressVal });
        });
      }
      continue;
    }

    if (!payload.id) {
      console.warn(`[ocrBridge] Ignoring daemon response without request id from ${engine}`);
      continue;
    }

    const pending = daemon.pending.get(payload.id);
    if (!pending) {
      console.warn(`[ocrBridge] Received orphaned daemon response ${payload.id} from ${engine}`);
      continue;
    }

    daemon.pending.delete(payload.id);
    if (payload.ok) {
      pending.resolve(payload);
    } else {
      pending.reject(new Error(payload.reason || `External OCR engine "${engine}" failed`));
    }
  }
}

function ensureDaemon(engine: ExternalBridgeEngine): BridgeDaemon {
  const scriptPath = resolveBridgeScriptPath();
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`OCR bridge script not found: ${scriptPath}`);
  }
  const scriptSignature = resolveBridgeScriptSignature(scriptPath);

  const existing = bridgeDaemons.get(engine);
  if (existing && !existing.child.killed) {
    if (existing.scriptPath === scriptPath && existing.scriptSignature === scriptSignature) {
      console.log(`[ocrBridge] Reusing existing daemon for ${engine} (sig=${scriptSignature})`);
      return existing;
    }
    console.log(`[ocrBridge] Script changed for ${engine}: old=${existing.scriptSignature} new=${scriptSignature}; restarting`);
    teardownDaemon(engine, new Error(`OCR bridge script changed for ${engine}; restarting daemon`));
  }

  const pythonCmd = resolvePythonExecutable(engine);
  const { cmd, args: spawnArgs } = getSpawnCommandAndArgs(pythonCmd, scriptPath, ['--stdio-server', '--action', 'ocr', '--engine', engine], engine);
  console.log(`[ocrBridge] Spawning NEW daemon for ${engine}: python=${pythonCmd} script=${scriptPath} sig=${scriptSignature} zluda=${process.env.OCR_USE_ZLUDA === '1' && engine !== 'paddleocr' && engine !== 'easyocr'}`);
  const child = spawn(cmd, spawnArgs, {
    cwd: path.dirname(scriptPath),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: resolveBridgeEnv(engine),
    windowsHide: true,
  });

  const daemon: BridgeDaemon = {
    engine,
    child,
    stdoutBuffer: '',
    pending: new Map(),
    scriptPath,
    scriptSignature,
    queue: [],
    running: false,
  };

  child.stdout.on('data', (chunk: Buffer) => {
    handleDaemonStdout(engine, chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const message = chunk.toString().trim();
    if (message && !isBenignBridgeStderr(message)) {
      console.warn(`[ocrBridge:${engine}] ${message}`);
    }
  });
  child.on('error', (error) => {
    teardownDaemon(engine, error, daemon);
  });
  child.on('close', (code, signal) => {
    teardownDaemon(
      engine,
      new Error(`OCR daemon for ${engine} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`),
      daemon
    );
  });

  bridgeDaemons.set(engine, daemon);
  startWatchdog(engine, daemon);
  return daemon;
}

async function requestDaemonInternal(
  daemon: BridgeDaemon,
  payload: Record<string, unknown>,
  timeoutMs: number
): Promise<ExternalOcrBridgeResponse> {
  const id = (payload.id as string) || randomUUID();

  return await new Promise<ExternalOcrBridgeResponse>((resolve, reject) => {
    let timeoutId: NodeJS.Timeout | null = null;

    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        daemon.pending.delete(id);
        const timeoutError = new Error(`OCR daemon request timed out after ${timeoutMs / 1000} seconds`);
        reject(timeoutError);
        // Forcefully terminate the daemon process to prevent it from hanging/blocking subsequent requests.
        teardownDaemon(daemon.engine, timeoutError, daemon);
      }, timeoutMs);
    }

    const cleanResolve = (response: ExternalOcrBridgeResponse) => {
      if (timeoutId) clearTimeout(timeoutId);
      resolve(response);
    };

    const cleanReject = (error: Error) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    };

    daemon.pending.set(id, { resolve: cleanResolve, reject: cleanReject, payload });

    try {
      const stdin = daemon.child.stdin;
      if (!stdin) {
        throw new Error(`OCR daemon stdin is unavailable for ${daemon.engine}`);
      }
      stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      daemon.pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
      teardownDaemon(
        daemon.engine,
        error instanceof Error ? error : new Error(String(error)),
        daemon
      );
    }
  });
}

function processQueue(daemon: BridgeDaemon): void {
  if (daemon.running || daemon.queue.length === 0) {
    if (!daemon.running && daemon.queue.length === 0 && daemon.pending.size === 0) {
      resetDaemonIdleTimer(daemon.engine);
    }
    return;
  }

  daemon.running = true;
  const task = daemon.queue.shift()!;

  // Clear idle timer since a request has started
  const existingTimer = daemonIdleTimers.get(daemon.engine);
  if (existingTimer) {
    clearTimeout(existingTimer);
    daemonIdleTimers.delete(daemon.engine);
  }

  requestDaemonInternal(daemon, task.payload, task.timeoutMs)
    .then(task.resolve)
    .catch(task.reject)
    .finally(() => {
      daemon.running = false;
      processQueue(daemon);
    });
}

async function requestDaemon(
  engine: ExternalBridgeEngine,
  payload: Record<string, unknown>,
  timeoutMs: number = 30000
): Promise<ExternalOcrBridgeResponse> {
  // Clear the idle timer since we are initiating a new request
  const existingTimer = daemonIdleTimers.get(engine);
  if (existingTimer) {
    clearTimeout(existingTimer);
    daemonIdleTimers.delete(engine);
  }

  const daemon = ensureDaemon(engine);

  return await new Promise<ExternalOcrBridgeResponse>((resolve, reject) => {
    daemon.queue.push({ payload, resolve, reject, timeoutMs });
    processQueue(daemon);
  });
}

function isRecoverableDaemonError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('daemon') ||
    message.includes('stdin is unavailable') ||
    message.includes('parse ocr bridge response')
  );
}

function isNoTextBoxesError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes('no text boxes returned from paddleocr');
}

function mimeTypeToExtension(mimeType: string): string {
  switch ((mimeType || '').toLowerCase()) {
    case 'image/png':
      return '.png';
    case 'image/jpeg':
      return '.jpg';
    case 'image/webp':
      return '.webp';
    case 'image/tiff':
      return '.tiff';
    case 'image/bmp':
      return '.bmp';
    default:
      return '.png';
  }
}

function coerceImageBuffer(raw: Uint8Array | ArrayBuffer): Buffer {
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw));
  }
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw);
  }
  throw new Error('Invalid OCR image payload');
}

export async function getExternalOcrEngineStatuses(): Promise<ExternalOcrEngineStatus[]> {
  return await Promise.all(EXTERNAL_ENGINES.map(async (engine) => {
    try {
      const response = await requestDaemon(engine, { action: 'status', engine });
      return {
        engine,
        available: Boolean(response.available),
        runtime: response.runtime || (engine === 'paddleocr' ? 'Python bridge' : 'REST/adapter bridge'),
        description: response.description || response.reason || 'No status details returned',
      };
    } catch (error) {
      return {
        engine,
        available: false,
        runtime: engine === 'paddleocr' ? 'Python bridge' : 'REST/adapter bridge',
        description: error instanceof Error ? error.message : String(error),
      };
    }
  }));
}

/**
 * Write raw image bytes to a unique temp file and return its absolute path.
 * Call this from the Main process on behalf of the Renderer so that the buffer
 * is written once (locally) and only a lightweight string crosses the IPC bridge.
 */
export async function writeOcrTempImage(
  imageData: Uint8Array | ArrayBuffer,
  mimeType: string
): Promise<string> {
  const tempRoot = getExternalOcrTempRoot();
  const ext = mimeTypeToExtension(mimeType);
  const imagePath = path.join(tempRoot, `ocr-tmp-${randomUUID()}${ext}`);
  await fs.promises.writeFile(imagePath, coerceImageBuffer(imageData));
  return imagePath;
}

/**
 * Delete a temporary image file explicitly.
 * Validates that the path lies within the OCR temp directory to prevent directory traversal.
 */
export async function deleteOcrTempImage(imagePath: string): Promise<void> {
  const tempRoot = getExternalOcrTempRoot();
  const resolvedPath = path.resolve(imagePath);
  const relativePath = path.relative(tempRoot, resolvedPath);
  const isWithin = relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
  if (!isWithin) {
    throw new Error('deleteOcrTempImage: path is outside OCR temp directory');
  }
  await fs.promises.rm(resolvedPath, { force: true });
}


export async function runExternalOcr(payload: ExternalOcrRequestPayload): Promise<ExternalOcrBridgeResponse> {
  if (payload.engine !== 'paddleocr' && payload.engine !== 'easyocr') {
    throw new Error(`Unsupported external OCR engine: ${payload.engine}`);
  }
  if (!payload.imagePath && !payload.imageData) {
    throw new Error('ExternalOcrRequestPayload must provide either imagePath or imageData');
  }

  const engine = payload.engine;

  // --- Zero-copy path: reuse a temp file that was already written by the caller ---
  // When imagePath is supplied we skip writeFile entirely, saving one full buffer
  // clone and dramatically reducing IPC serialization pressure.
  let resolvedImagePath: string;
  let ownsTempFile: boolean;

  if (payload.imagePath) {
    resolvedImagePath = payload.imagePath;
    ownsTempFile = false; // Caller is responsible for cleanup
  } else {
    // Legacy path: write buffer to disk here (backward-compat, triggers GC pressure)
    resolvedImagePath = path.join(
      getExternalOcrTempRoot(),
      `${engine}-${randomUUID()}${mimeTypeToExtension(payload.imageMimeType)}`
    );
    await fs.promises.writeFile(resolvedImagePath, coerceImageBuffer(payload.imageData!));
    ownsTempFile = true;
  }

  try {
    const requestPayload: Record<string, unknown> = {
      id: payload.id,
      action: 'ocr',
      engine,
      ...(typeof payload.chunkIndex === 'number' ? { chunkIndex: payload.chunkIndex } : {}),
      ...(typeof payload.totalChunks === 'number' ? { totalChunks: payload.totalChunks } : {}),
      image: resolvedImagePath,
      language: payload.language,
      width: Math.round(payload.imageWidth),
      height: Math.round(payload.imageHeight),
      dpi: Math.round(payload.dpi),
      ...(typeof payload.pageSegMode === 'number' ? { pageSegMode: payload.pageSegMode } : {}),
      ...(payload.pipelineProfile ? { pipelineProfile: payload.pipelineProfile } : {}),
      ...(payload.ocrQualityProfile ? { qualityProfile: payload.ocrQualityProfile } : {}),
      // Forward maxSideLen to Python bridge (capped at 6000 to prevent Donut Effect)
      ...(typeof payload.maxSideLen === 'number'
        ? { maxSideLen: Math.min(Math.max(1, payload.maxSideLen), 6000) }
        : {}),
      ...(typeof payload.maxPixels === 'number' ? { maxPixels: payload.maxPixels } : {}),
      ...(typeof payload.useAngleCls === 'boolean' ? { useAngleCls: payload.useAngleCls } : {}),
      ...(typeof payload.use_angle_cls === 'boolean' ? { use_angle_cls: payload.use_angle_cls } : {}),
    };

    let response: ExternalOcrBridgeResponse;
    const emptyNoTextResponse: ExternalOcrBridgeResponse = {
      ok: true,
      engine,
      words: [],
      lines: [],
      text: '',
      confidence: 0,
      ...(typeof payload.pageSegMode === 'number' ? { pageSegMode: payload.pageSegMode } : {}),
      debug: {
        dropCounts: {},
        droppedWords: [],
        skipReason: 'noTextBoxesFromPaddleOCR',
      },
    };

    const daemon = ensureDaemon(engine);
    try {
      try {
        response = await requestDaemon(engine, requestPayload, 90000);
      } catch (error) {
        if (isNoTextBoxesError(error)) {
          return emptyNoTextResponse;
        }
        if (!isRecoverableDaemonError(error)) {
          throw error;
        }
        teardownDaemon(
          engine,
          error instanceof Error ? error : new Error(String(error)),
          daemon
        );
        try {
          response = await requestDaemon(engine, requestPayload, 90000);
        } catch (retryError) {
          if (isNoTextBoxesError(retryError)) {
            return emptyNoTextResponse;
          }
          throw retryError;
        }
      }

      if (!response.ok) {
        throw new Error(response.reason || `External OCR engine "${engine}" failed`);
      }
    } catch (primaryError) {
      if (engine === 'paddleocr') {
        console.warn(`[ocrBridge] paddleocr failed with error: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}. Performing seamless auto-fallback to easyocr...`);
        try {
          const fallbackPayload = {
            ...requestPayload,
            engine: 'easyocr',
          };
          response = await requestDaemon('easyocr', fallbackPayload);
          if (response.ok) {
            response.engine = 'easyocr';
            if (response.debug && typeof response.debug === 'object') {
              (response.debug as Record<string, unknown>).fallbackFromEngine = 'paddleocr';
              (response.debug as Record<string, unknown>).fallbackReason = primaryError instanceof Error ? primaryError.message : String(primaryError);
            }
            return response;
          }
        } catch (fallbackError) {
          console.error(`[ocrBridge] easyocr fallback also failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        }
      }
      throw primaryError;
    }

    return response;
  } finally {
    // Only delete the temp file if we created it ourselves.
    // When imagePath was caller-supplied (ownsTempFile=false) the caller handles cleanup.
    if (ownsTempFile) {
      await fs.promises.rm(resolvedImagePath, { force: true });
    }
  }
}


export async function runExternalOcrRaw(payload: {
  imagePath?: string;
  imageData?: Uint8Array | ArrayBuffer;
  imageMimeType: string;
  imageWidth: number;
  imageHeight: number;
  language: string;
  engine?: string;
}): Promise<ExternalOcrBridgeResponse> {
  if (!payload.imagePath && !payload.imageData) {
    throw new Error('ExternalOcrRequestPayload must provide either imagePath or imageData');
  }

  const engine = payload.engine === 'easyocr' ? 'easyocr' : 'paddleocr';

  let resolvedImagePath: string;
  let ownsTempFile: boolean;

  if (payload.imagePath) {
    resolvedImagePath = payload.imagePath;
    ownsTempFile = false;
  } else {
    resolvedImagePath = path.join(
      getExternalOcrTempRoot(),
      `raw-${engine}-${randomUUID()}${mimeTypeToExtension(payload.imageMimeType)}`
    );
    await fs.promises.writeFile(resolvedImagePath, coerceImageBuffer(payload.imageData!));
    ownsTempFile = true;
  }

  try {
    const requestPayload: Record<string, unknown> = {
      action: 'raw_ocr',
      engine,
      image: resolvedImagePath,
      language: payload.language,
      width: Math.round(payload.imageWidth),
      height: Math.round(payload.imageHeight),
    };

    const daemon = ensureDaemon(engine);
    let response: ExternalOcrBridgeResponse;
    try {
      response = await requestDaemon(engine, requestPayload, 90000);
    } catch (error) {
      if (!isRecoverableDaemonError(error)) {
        throw error;
      }
      teardownDaemon(
        engine,
        error instanceof Error ? error : new Error(String(error)),
        daemon
      );
      try {
        response = await requestDaemon(engine, requestPayload, 90000);
      } catch (retryError) {
        throw retryError;
      }
    }

    if (!response.ok) {
      throw new Error(response.reason || `External OCR engine "${engine}" failed`);
    }

    return response;
  } finally {
    if (ownsTempFile) {
      await fs.promises.rm(resolvedImagePath, { force: true });
    }
  }
}


export async function prewarmExternalOcrEngine(
  engine: ExternalBridgeEngine,
  language: string = 'eng'
): Promise<ExternalOcrWarmupResponse> {
  const response = await requestDaemon(engine, {
    action: 'prewarm',
    engine,
    language,
  });

  if (!response.ok) {
    throw new Error(response.reason || `Failed to prewarm external OCR engine "${engine}"`);
  }

  return {
    ok: true,
    engine,
    runtime: response.runtime || 'Python bridge',
    description: response.description || `${engine} warmed`,
  };
}

export function cancelExternalOcr(engine?: ExternalBridgeEngine): void {
  if (engine) {
    teardownDaemon(engine, new Error(`External OCR canceled for ${engine}`));
    return;
  }
  disposeExternalOcrDaemons();
}

export async function clearExternalOcrCudaCache(engine: ExternalBridgeEngine): Promise<void> {
  const response = await requestDaemon(engine, { action: 'cleanup', engine });
  if (!response.ok) {
    throw new Error(response.reason || `Failed to clear CUDA cache for engine "${engine}"`);
  }
}

export function disposeExternalOcrDaemons(): void {
  for (const engine of Array.from(bridgeDaemons.keys())) {
    teardownDaemon(engine);
  }
}
