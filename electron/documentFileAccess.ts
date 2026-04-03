import fs from 'fs'
import path from 'path'

export const SUPPORTED_DOCUMENT_EXTENSIONS = new Map<string, string>([
  ['.pdf', 'application/pdf'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.tif', 'image/tiff'],
  ['.tiff', 'image/tiff'],
])

export const SUPPORTED_IMPORT_MIME_TYPES = new Map<string, string>([
  ['application/pdf', '.pdf'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/tiff', '.tiff'],
])

export type ExistingDocumentFile = {
  canonicalPath: string;
  mimeType: string;
  size: number;
  name: string;
}

export const getRequestedDocumentPath = (filepath: string): string => {
  if (!path.isAbsolute(filepath)) {
    throw new Error('Filepath must be absolute')
  }
  if (filepath.includes('\0')) {
    throw new Error('Invalid filepath')
  }
  return path.resolve(filepath)
}

export const tryResolveRealDocumentPath = async (filepath: string): Promise<string> => {
  try {
    return await fs.promises.realpath(filepath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return filepath
    }
    throw error
  }
}

export const getDocumentMimeType = (filepath: string): string | null =>
  SUPPORTED_DOCUMENT_EXTENSIONS.get(path.extname(filepath).toLowerCase()) ?? null

export const isPathWithinDirectory = (parentPath: string, childPath: string): boolean => {
  const relativePath = path.relative(parentPath, childPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

export const inspectExistingDocumentFile = async (filepath: string): Promise<ExistingDocumentFile> => {
  const requestedPath = getRequestedDocumentPath(filepath)
  const canonicalPath = await tryResolveRealDocumentPath(requestedPath)
  const mimeType = getDocumentMimeType(canonicalPath)
  if (!mimeType) {
    throw new Error('Unsupported file type')
  }

  const stats = await fs.promises.stat(canonicalPath)
  if (!stats.isFile()) {
    throw new Error('Path is not a file')
  }

  return {
    canonicalPath,
    mimeType,
    size: stats.size,
    name: path.basename(canonicalPath),
  }
}

export const resolveImportedDocumentName = (
  name: string,
  mimeType: string,
): {
  finalName: string;
  finalExt: string;
  resolvedMimeType: string;
} => {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_').trim()
  const extFromName = path.extname(safeName).toLowerCase()
  const normalizedMimeType = String(mimeType || '').toLowerCase()
  const fallbackExt = SUPPORTED_IMPORT_MIME_TYPES.get(normalizedMimeType) ?? ''
  const finalExt = SUPPORTED_DOCUMENT_EXTENSIONS.has(extFromName) ? extFromName : fallbackExt
  const resolvedMimeType = SUPPORTED_DOCUMENT_EXTENSIONS.get(finalExt)

  if (!finalExt || !resolvedMimeType) {
    throw new Error('Unsupported file type')
  }

  const baseName = extFromName
    ? safeName.slice(0, safeName.length - extFromName.length)
    : safeName

  return {
    finalName: `${baseName || 'document'}${finalExt}`,
    finalExt,
    resolvedMimeType,
  }
}
