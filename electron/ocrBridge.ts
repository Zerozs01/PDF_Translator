import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

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
];

interface BridgeDaemonRequest {
  resolve: (response: ExternalOcrBridgeResponse) => void;
  reject: (error: Error) => void;
}

interface BridgeDaemon {
  engine: ExternalBridgeEngine;
  child: ReturnType<typeof spawn>;
  stdoutBuffer: string;
  pending: Map<string, BridgeDaemonRequest>;
  scriptPath: string;
  scriptSignature: string;
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

function normalizePythonOverride(value: string | undefined): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (/[\\/]/.test(trimmed) || path.isAbsolute(trimmed)) {
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
    return fs.existsSync(resolved) ? resolved : null;
  }
  return trimmed;
}

function findLocalPythonExecutable(roots: Array<string | null | undefined>): string | null {
  const pythonRelativePath = process.platform === 'win32'
    ? ['Scripts', 'python.exe']
    : ['bin', 'python'];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!root) continue;
    const resolvedRoot = path.resolve(root);
    if (seen.has(resolvedRoot)) continue;
    seen.add(resolvedRoot);

    for (const venvDir of ['.venv-ocr', '.venv']) {
      const candidate = path.join(resolvedRoot, venvDir, ...pythonRelativePath);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
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
    process.resourcesPath,
    process.resourcesPath ? path.resolve(process.resourcesPath, '..') : null,
  ]);
  if (localVenvPython) return localVenvPython;

  return 'python';
}

function resolveBridgeEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
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

async function runBridgeOnce(engine: ExternalBridgeEngine, args: string[]): Promise<ExternalOcrBridgeResponse> {
  const scriptPath = resolveBridgeScriptPath();
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`OCR bridge script not found: ${scriptPath}`);
  }

  const pythonCmd = resolvePythonExecutable(engine);
  return await new Promise<ExternalOcrBridgeResponse>((resolve, reject) => {
    const child = spawn(pythonCmd, [scriptPath, ...args], {
      cwd: path.dirname(scriptPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: resolveBridgeEnv(),
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      reject(error);
    });
    child.on('close', (code) => {
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

function teardownDaemon(engine: ExternalBridgeEngine, reason?: Error): void {
  const daemon = bridgeDaemons.get(engine);
  if (!daemon) return;

  bridgeDaemons.delete(engine);
  for (const [, pending] of daemon.pending) {
    pending.reject(reason ?? new Error(`OCR daemon for ${engine} stopped unexpectedly`));
  }
  daemon.pending.clear();

  if (!daemon.child.killed) {
    const pid = daemon.child.pid;
    // On Windows, child.kill() only sends SIGTERM which Python may ignore.
    // Use taskkill /F /T to forcefully terminate the entire process tree.
    if (process.platform === 'win32' && pid) {
      try {
        spawn('taskkill', ['/F', '/T', '/PID', String(pid)], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        daemon.child.kill('SIGKILL');
      }
    } else {
      daemon.child.kill('SIGKILL');
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

    let payload: ExternalOcrBridgeResponse;
    try {
      payload = JSON.parse(line) as ExternalOcrBridgeResponse;
    } catch {
      console.warn(`[ocrBridge] Ignoring non-JSON stdout from ${engine}: ${line}`);
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
  console.log(`[ocrBridge] Spawning NEW daemon for ${engine}: python=${pythonCmd} script=${scriptPath} sig=${scriptSignature}`);
  const child = spawn(pythonCmd, [scriptPath, '--stdio-server', '--action', 'ocr', '--engine', engine], {
    cwd: path.dirname(scriptPath),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: resolveBridgeEnv(),
    windowsHide: true,
  });

  const daemon: BridgeDaemon = {
    engine,
    child,
    stdoutBuffer: '',
    pending: new Map(),
    scriptPath,
    scriptSignature,
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
    teardownDaemon(engine, error);
  });
  child.on('close', (code, signal) => {
    teardownDaemon(
      engine,
      new Error(`OCR daemon for ${engine} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
    );
  });

  bridgeDaemons.set(engine, daemon);
  return daemon;
}

async function requestDaemon(
  engine: ExternalBridgeEngine,
  payload: Record<string, unknown>
): Promise<ExternalOcrBridgeResponse> {
  const daemon = ensureDaemon(engine);
  const id = randomUUID();

  return await new Promise<ExternalOcrBridgeResponse>((resolve, reject) => {
    daemon.pending.set(id, { resolve, reject });

    try {
      const stdin = daemon.child.stdin;
      if (!stdin) {
        throw new Error(`OCR daemon stdin is unavailable for ${engine}`);
      }
      stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
    } catch (error) {
      daemon.pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
      teardownDaemon(
        engine,
        error instanceof Error ? error : new Error(String(error))
      );
    }
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
      const response = await runBridgeOnce(engine, ['--action', 'status', '--engine', engine]);
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

export async function runExternalOcr(payload: ExternalOcrRequestPayload): Promise<ExternalOcrBridgeResponse> {
  if (payload.engine !== 'paddleocr' && payload.engine !== 'easyocr') {
    throw new Error(`Unsupported external OCR engine: ${payload.engine}`);
  }

  const engine = payload.engine;
  const imagePath = path.join(
    getExternalOcrTempRoot(),
    `${engine}-${randomUUID()}${mimeTypeToExtension(payload.imageMimeType)}`
  );

  try {
    await fs.promises.writeFile(imagePath, coerceImageBuffer(payload.imageData));

    const requestPayload = {
      action: 'ocr',
      engine,
      image: imagePath,
      language: payload.language,
      width: Math.round(payload.imageWidth),
      height: Math.round(payload.imageHeight),
      dpi: Math.round(payload.dpi),
      ...(typeof payload.pageSegMode === 'number' ? { pageSegMode: payload.pageSegMode } : {}),
      ...(payload.pipelineProfile ? { pipelineProfile: payload.pipelineProfile } : {}),
      ...(payload.ocrQualityProfile ? { qualityProfile: payload.ocrQualityProfile } : {}),
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

    try {
      response = await requestDaemon(engine, requestPayload);
    } catch (error) {
      if (isNoTextBoxesError(error)) {
        return emptyNoTextResponse;
      }
      if (!isRecoverableDaemonError(error)) {
        throw error;
      }
      teardownDaemon(
        engine,
        error instanceof Error ? error : new Error(String(error))
      );
      try {
        response = await requestDaemon(engine, requestPayload);
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

    return response;
  } finally {
    await fs.promises.rm(imagePath, { force: true });
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

export function disposeExternalOcrDaemons(): void {
  for (const engine of Array.from(bridgeDaemons.keys())) {
    teardownDaemon(engine);
  }
}
