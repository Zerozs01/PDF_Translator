import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { findLocalPythonExecutable, normalizePythonOverride } from './pythonRuntime'

export type TranslationContext = {
  mode?: string;
  sourceType?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  timeoutMs?: number;
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

export const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
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

export const normalizeArgosLanguage = (value: unknown, fallback: string): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  return ARGOS_LANG_ALIASES[raw] || raw.split('-')[0] || fallback;
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
    path.resolve(path.dirname(process.execPath), '..'),
    path.resolve(path.dirname(process.execPath), '../..'),
    process.resourcesPath,
    process.resourcesPath ? path.resolve(process.resourcesPath, '..') : null,
    process.env.PORTABLE_EXECUTABLE_DIR,
  ], ['.venv-ocr', '.venv-easy-yolo', '.venv', '.venv-argos']);
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

export const disposeArgosTranslateRuntime = (): void => {
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

export const runArgosTranslateBatch = async (
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
