import fs from 'fs'
import path from 'path'

declare const __DEV_PROJECT_ROOT__: string | undefined;

export const normalizePythonOverride = (value: string | undefined): string | null => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  if (/[\\/]/.test(trimmed) || path.isAbsolute(trimmed)) {
    const resolved = path.isAbsolute(trimmed) ? trimmed : path.resolve(trimmed);
    return fs.existsSync(resolved) ? resolved : null;
  }
  return trimmed;
};

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
