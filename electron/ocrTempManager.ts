import path from 'path';
import fs from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';

let externalOcrTempRoot: string | null = null;

export function getExternalOcrTempRoot(): string {
  const tempRoot = externalOcrTempRoot || path.join(os.tmpdir(), 'pdf-translator-ocr');
  if (!fs.existsSync(tempRoot)) {
    fs.mkdirSync(tempRoot, { recursive: true });
  }
  externalOcrTempRoot = tempRoot;
  return tempRoot;
}

export function mimeTypeToExtension(mimeType: string): string {
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

export function coerceImageBuffer(raw: Uint8Array | ArrayBuffer): Buffer {
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw));
  }
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw);
  }
  throw new Error('Invalid OCR image payload');
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
  await fs.promises.mkdir(tempRoot, { recursive: true });
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

/**
 * Clean up orphaned temp files older than maxAgeMs (default: 1 hour)
 */
export async function cleanupOrphanedOcrTempFiles(maxAgeMs: number = 3600000): Promise<number> {
  const tempRoot = getExternalOcrTempRoot();
  let deletedCount = 0;
  try {
    const files = await fs.promises.readdir(tempRoot);
    const now = Date.now();
    for (const file of files) {
      if (
        !file.startsWith('ocr-tmp-') &&
        !file.startsWith('raw-') &&
        !file.startsWith('paddleocr-') &&
        !file.startsWith('easyocr-')
      ) {
        continue;
      }
      const filePath = path.join(tempRoot, file);
      try {
        const stat = await fs.promises.stat(filePath);
        if (now - stat.mtimeMs > maxAgeMs) {
          await fs.promises.rm(filePath, { force: true });
          deletedCount++;
        }
      } catch {
        // file may be in use or removed concurrently
      }
    }
  } catch (err) {
    console.warn('[ocrTempManager] Failed to clean orphaned temp files:', err);
  }
  return deletedCount;
}
