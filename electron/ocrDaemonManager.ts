import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, exec } from 'child_process';
import { randomUUID } from 'crypto';
import {
  normalizePythonOverride,
  findLocalPythonExecutable,
  getDefaultPythonSearchRoots,
} from './pythonRuntime';
import {
  ExternalBridgeEngine,
  ExternalOcrBridgeResponse,
  BridgeDaemon,
  BridgeDaemonRequest,
  BENIGN_BRIDGE_STDERR_PATTERNS,
} from './ocrBridgeTypes';

const bridgeDaemons = new Map<ExternalBridgeEngine, BridgeDaemon>();
const daemonIdleTimers = new Map<ExternalBridgeEngine, NodeJS.Timeout>();
const daemonWatchdogs = new Map<ExternalBridgeEngine, NodeJS.Timeout>();

export function resolveBridgeScriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'ocr-bridge', 'external_ocr_bridge.py')
    : path.join(app.getAppPath(), 'scripts', 'external_ocr_bridge.py');
}

export function resolveBridgeScriptSignature(scriptPath: string): string {
  try {
    const stat = fs.statSync(scriptPath);
    return `${scriptPath}:${Math.floor(stat.mtimeMs)}`;
  } catch {
    return `${scriptPath}:unknown`;
  }
}

export function resolvePythonExecutable(engine: ExternalBridgeEngine): string {
  const engineOverride = engine === 'paddleocr'
    ? normalizePythonOverride(process.env.PADDLE_OCR_PYTHON_PATH)
    : normalizePythonOverride(process.env.EASY_YOLO_OCR_PYTHON_PATH);
  if (engineOverride) return engineOverride;

  const sharedOverride = normalizePythonOverride(process.env.OCR_PYTHON_PATH);
  if (sharedOverride) return sharedOverride;

  const localVenvPython = findLocalPythonExecutable(getDefaultPythonSearchRoots());
  if (localVenvPython) return localVenvPython;

  return 'python';
}

export function resolveBridgeEnv(engine?: ExternalBridgeEngine): NodeJS.ProcessEnv {
  const baseEnv = { ...process.env };
  const useZluda = baseEnv.OCR_USE_ZLUDA === '1' || baseEnv.USE_ZLUDA === '1';
  const engineAllowsZluda = engine !== 'paddleocr' && engine !== 'easyocr';

  const isWin = process.platform === 'win32';
  const sep = isWin ? ';' : ':';
  const currentPath = baseEnv.PATH || '';

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
      console.warn('[ocrDaemonManager] Failed to resolve python directory for PATH cleanup:', err);
    }
  }

  // 2. Windows system directories (system32, Windows, etc.)
  if (isWin) {
    const windir = baseEnv.windir || 'C:\\Windows';
    const system32 = path.join(windir, 'System32');
    const wbem = path.join(system32, 'Wbem');
    const powershell = path.join(system32, 'WindowsPowerShell', 'v1.0');

    [system32, windir, wbem, powershell].forEach((dir) => {
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

  const existingPaths = currentPath.split(sep).map((p) => p.trim()).filter(Boolean);
  const finalPaths: string[] = [];
  const seen = new Set<string>();
  const norm = (p: string) => (isWin ? p.toLowerCase() : p);

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

  baseEnv.PATH = finalPaths.join(sep);

  return {
    ...baseEnv,
    PYTHONUNBUFFERED: '1',
  };
}

export function isBenignBridgeStderr(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  return BENIGN_BRIDGE_STDERR_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function getSpawnCommandAndArgs(
  pythonCmd: string,
  scriptPath: string,
  args: string[],
  engine?: string
): { cmd: string; args: string[] } {
  const useZluda = process.env.OCR_USE_ZLUDA === '1' || process.env.USE_ZLUDA === '1';
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

export function resetDaemonIdleTimer(engine: ExternalBridgeEngine): void {
  const existingTimer = daemonIdleTimers.get(engine);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    const daemon = bridgeDaemons.get(engine);
    if (daemon && daemon.queue.length === 0 && daemon.pending.size === 0 && !daemon.running) {
      console.log(`[ocrDaemonManager] Idle timeout reached. Releasing ${engine} daemon due to 5 minutes of inactivity.`);
      teardownDaemon(engine, new Error(`OCR daemon released due to 5 minutes of inactivity`));
    }
    daemonIdleTimers.delete(engine);
  }, 300000); // 5 minutes

  daemonIdleTimers.set(engine, timer);
}

export function getProcessMemory(pid: number): Promise<number> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec(`tasklist /fi "PID eq ${pid}" /fo csv /nh`, { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) {
          resolve(0);
          return;
        }
        const trimmed = stdout.trim();
        if (trimmed.startsWith('INFO:')) {
          resolve(0);
          return;
        }
        const parts = trimmed.split('","');
        if (parts.length > 0) {
          const memStr = parts[parts.length - 1];
          const kb = parseInt(memStr.replace(/[^0-9]/g, ''), 10);
          resolve(isNaN(kb) ? 0 : kb * 1024);
        } else {
          resolve(0);
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

export function getDynamicMemoryLimitMB(engine: ExternalBridgeEngine): number {
  const totalMemBytes = os.totalmem();
  const totalMemGB = totalMemBytes / (1024 * 1024 * 1024);

  if (engine === 'easyocr') {
    if (totalMemGB >= 31) return 8000;
    if (totalMemGB >= 15) return 4500;
    return 2400;
  } else {
    // paddleocr
    if (totalMemGB >= 31) return 4000;
    if (totalMemGB >= 15) return 2500;
    return 1200;
  }
}

export function startWatchdog(engine: ExternalBridgeEngine, daemon: BridgeDaemon): void {
  stopWatchdog(engine);
  const timer = setInterval(async () => {
    const pid = daemon.child.pid;
    if (!pid || daemon.child.killed) {
      stopWatchdog(engine);
      return;
    }

    // 1. Check active state (fast native Win32 check, 0 process spawn)
    let isAlive = false;
    try {
      process.kill(pid, 0);
      isAlive = true;
    } catch {
      isAlive = false;
    }

    if (!isAlive) {
      console.warn(`[ocrDaemonManager] Watchdog detected that ${engine} process ${pid} is dead.`);
      teardownDaemon(engine, new Error(`OCR daemon process died`));
      stopWatchdog(engine);
      return;
    }

    // 2. Check memory footprint only if work was processed since last check (eliminates idle tasklist spawns)
    if (!daemon.hasProcessedSinceLastMemCheck) {
      return;
    }

    const memBytes = await getProcessMemory(pid);
    daemon.hasProcessedSinceLastMemCheck = false;

    if (memBytes > 0) {
      const memMB = memBytes / (1024 * 1024);
      console.log(`[ocrDaemonManager] Watchdog: ${engine} process ${pid} memory usage: ${memMB.toFixed(2)} MB`);
      const MEMORY_LIMIT_MB = getDynamicMemoryLimitMB(engine);
      if (memMB > MEMORY_LIMIT_MB) {
        console.warn(`[ocrDaemonManager] Watchdog: ${engine} memory usage (${memMB.toFixed(2)} MB) exceeded limit (${MEMORY_LIMIT_MB} MB). Terminating daemon to prevent fragmentation.`);
        teardownDaemon(engine, new Error(`OCR daemon memory limit exceeded`));
        stopWatchdog(engine);
      }
    }
  }, 30000);

  daemonWatchdogs.set(engine, timer);
}

export function stopWatchdog(engine: ExternalBridgeEngine): void {
  const timer = daemonWatchdogs.get(engine);
  if (timer) {
    clearInterval(timer);
    daemonWatchdogs.delete(engine);
  }
}

function killProcessPact(child: ReturnType<typeof spawn>, pid: number): void {
  console.log(`[ocrDaemonManager] Initiating death pact for process ${pid} using SIGTERM`);

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
      console.warn(`[ocrDaemonManager] Heartbeat did not flatline for process ${pid} after 2000ms. Forcing SIGKILL.`);
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
      console.log(`[ocrDaemonManager] Process ${pid} successfully terminated within 2000ms.`);
    }
  }, 2000);
}

export function teardownDaemon(engine: ExternalBridgeEngine, reason?: Error): void {
  const daemon = bridgeDaemons.get(engine);
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
      if (!isBenignBridgeStderr(line)) {
        console.warn(`[ocrDaemonManager] Ignoring non-JSON stdout from ${engine}: ${line}`);
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

          console.log(`[ocrDaemonManager] Progress raw: ${originalVal}, totalChunks: ${reqPayload.totalChunks} (parsed: ${total}), chunkIndex: ${reqPayload.chunkIndex} (parsed: ${idx})`);

          if (!Number.isNaN(total) && !Number.isNaN(idx) && total > 0) {
            const chunkPct = (progressVal / 90) * 100;
            progressVal = Math.round(((idx + chunkPct / 100) / total) * 90);
            console.log(`[ocrDaemonManager] Scaled progress to: ${progressVal} (idx: ${idx}/${total}, pct: ${chunkPct})`);
            loggedScaling = true;
          }
        }
        if (!loggedScaling) {
          console.log(`[ocrDaemonManager] Dispatching UNSCALED progress: ${progressVal} (pending found: ${!!pending})`);
        }
        BrowserWindow.getAllWindows().forEach((w) => {
          w.webContents.send('ocr:progress', { id: progressId, progress: progressVal });
        });
      }
      continue;
    }

    if (!payload.id) {
      console.warn(`[ocrDaemonManager] Ignoring daemon response without request id from ${engine}`);
      continue;
    }

    const pending = daemon.pending.get(payload.id);
    if (!pending) {
      console.warn(`[ocrDaemonManager] Received orphaned daemon response ${payload.id} from ${engine}`);
      continue;
    }

    daemon.hasProcessedSinceLastMemCheck = true;
    daemon.pending.delete(payload.id);
    if (payload.ok) {
      pending.resolve(payload);
    } else {
      pending.reject(new Error(payload.reason || `External OCR engine "${engine}" failed`));
    }
  }
}

export function ensureDaemon(engine: ExternalBridgeEngine): BridgeDaemon {
  const scriptPath = resolveBridgeScriptPath();
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`OCR bridge script not found: ${scriptPath}`);
  }
  const scriptSignature = resolveBridgeScriptSignature(scriptPath);

  const existing = bridgeDaemons.get(engine);
  if (existing && !existing.child.killed) {
    if (existing.scriptPath === scriptPath && existing.scriptSignature === scriptSignature) {
      console.log(`[ocrDaemonManager] Reusing existing daemon for ${engine} (sig=${scriptSignature})`);
      return existing;
    }
    console.log(`[ocrDaemonManager] Script changed for ${engine}: old=${existing.scriptSignature} new=${scriptSignature}; restarting`);
    teardownDaemon(engine, new Error(`OCR bridge script changed for ${engine}; restarting daemon`));
  }

  const pythonCmd = resolvePythonExecutable(engine);
  const { cmd, args: spawnArgs } = getSpawnCommandAndArgs(
    pythonCmd,
    scriptPath,
    ['--stdio-server', '--action', 'ocr', '--engine', engine],
    engine
  );
  console.log(`[ocrDaemonManager] Spawning NEW daemon for ${engine}: python=${pythonCmd} script=${scriptPath} sig=${scriptSignature} zluda=${process.env.OCR_USE_ZLUDA === '1' && engine !== 'paddleocr' && engine !== 'easyocr'}`);
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
    lastStderrLines: [],
    hasProcessedSinceLastMemCheck: true,
  };

  child.stdout.on('data', (chunk: Buffer) => {
    handleDaemonStdout(engine, chunk);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    const raw = chunk.toString();
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (!isBenignBridgeStderr(line)) {
        daemon.lastStderrLines.push(line);
        if (daemon.lastStderrLines.length > 20) {
          daemon.lastStderrLines.shift();
        }
        console.warn(`[ocrDaemonManager:${engine}] ${line}`);
      }
    }
  });
  child.on('error', (error) => {
    teardownDaemon(engine, error);
  });
  child.on('close', (code, signal) => {
    const stderrDetails = daemon.lastStderrLines.length > 0
      ? ` | stderr: ${daemon.lastStderrLines.slice(-3).join('; ')}`
      : '';
    teardownDaemon(
      engine,
      new Error(`OCR daemon for ${engine} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})${stderrDetails}`)
    );
  });

  bridgeDaemons.set(engine, daemon);
  startWatchdog(engine, daemon);
  return daemon;
}

export function processQueue(daemon: BridgeDaemon): void {
  if (daemon.running || daemon.queue.length === 0) {
    if (!daemon.running && daemon.queue.length === 0 && daemon.pending.size === 0) {
      resetDaemonIdleTimer(daemon.engine);
    }
    return;
  }

  daemon.running = true;
  const task = daemon.queue.shift()!;

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

export async function requestDaemonInternal(
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
        teardownDaemon(daemon.engine, timeoutError);
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
        error instanceof Error ? error : new Error(String(error))
      );
    }
  });
}

export async function requestDaemon(
  engine: ExternalBridgeEngine,
  payload: Record<string, unknown>,
  timeoutMs: number = 30000
): Promise<ExternalOcrBridgeResponse> {
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

export function disposeExternalOcrDaemons(): void {
  for (const engine of Array.from(bridgeDaemons.keys())) {
    teardownDaemon(engine);
  }
}
