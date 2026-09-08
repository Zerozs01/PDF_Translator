import { app } from 'electron';
import fs from 'fs';
import path from 'path';

declare const __DEV_PROJECT_ROOT__: string | undefined;

/**
 * Loads local .env file from project root into process.env if not already present.
 */
export function loadLocalEnv(): void {
  try {
    const appPath = typeof app !== 'undefined' && app?.getAppPath ? app.getAppPath() : process.cwd();
    let envPath = path.join(appPath, '.env');
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
    console.error('[pythonRuntime] Failed to load .env file:', err);
  }
}

export const normalizePythonOverride = (value: string | undefined): string | null => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (/[\\/]/.test(trimmed) || path.isAbsolute(trimmed)) {
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
    return fs.existsSync(resolved) ? resolved : null;
  }
  return trimmed;
};

/**
 * Returns standard candidates for locating Python executable in dev, portable, or installed Electron modes.
 */
export function getDefaultPythonSearchRoots(): Array<string | null | undefined> {
  const appPath = typeof app !== 'undefined' && app?.getAppPath ? app.getAppPath() : process.cwd();
  const execPath = process.execPath || '';
  const resourcesPath = typeof process.resourcesPath !== 'undefined' ? process.resourcesPath : null;

  return [
    process.cwd(),
    appPath,
    path.resolve(appPath, '..'),
    path.resolve(__dirname, '..'),
    path.dirname(execPath),
    path.resolve(path.dirname(execPath), '..'),
    path.resolve(path.dirname(execPath), '../..'),
    resourcesPath,
    resourcesPath ? path.resolve(resourcesPath, '..') : null,
    process.env.PORTABLE_EXECUTABLE_DIR,
  ];
}

export const findLocalPythonExecutable = (
  roots: Array<string | null | undefined>,
  venvDirs: string[] = ['.venv-ocr', '.venv']
): string | null => {
  const pythonRelativePath = process.platform === 'win32'
    ? ['Scripts', 'python.exe']
    : ['bin', 'python'];
  const seen = new Set<string>();

  const searchRoots = [...roots];
  if (typeof __DEV_PROJECT_ROOT__ !== 'undefined' && __DEV_PROJECT_ROOT__) {
    searchRoots.push(__DEV_PROJECT_ROOT__);
  }

  for (const root of searchRoots) {
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
