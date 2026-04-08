import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  getDocumentMimeType,
  getRequestedDocumentPath,
  inspectExistingDocumentFile,
  isPathWithinDirectory,
  resolveImportedDocumentName,
  tryResolveRealDocumentPath,
} from './documentFileAccess'

const tempRoots: string[] = []

const createTempDir = async (): Promise<string> => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-translator-file-access-'))
  tempRoots.push(tempDir)
  return tempDir
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const tempDir = tempRoots.pop()
    if (!tempDir) continue
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
})

describe('documentFileAccess', () => {
  test('rejects non-absolute document paths', () => {
    expect(() => getRequestedDocumentPath('relative/input.pdf')).toThrow('Filepath must be absolute')
  })

  test('returns the original path when realpath target does not exist', async () => {
    const tempDir = await createTempDir()
    const missingPath = path.join(tempDir, 'missing.pdf')

    await expect(tryResolveRealDocumentPath(missingPath)).resolves.toBe(missingPath)
  })

  test('detects supported document mime types', () => {
    expect(getDocumentMimeType('/tmp/sample.pdf')).toBe('application/pdf')
    expect(getDocumentMimeType('/tmp/sample.jpeg')).toBe('image/jpeg')
    expect(getDocumentMimeType('/tmp/sample.txt')).toBeNull()
  })

  test('checks directory boundaries without path traversal false positives', async () => {
    const tempDir = await createTempDir()
    const rootDir = path.join(tempDir, 'imports')
    expect(isPathWithinDirectory(rootDir, path.join(rootDir, 'file.pdf'))).toBe(true)
    expect(isPathWithinDirectory(rootDir, path.join(rootDir, 'nested', 'file.pdf'))).toBe(true)
    expect(isPathWithinDirectory(rootDir, path.join(path.dirname(rootDir), 'other', 'file.pdf'))).toBe(false)
  })

  test('inspects existing supported files', async () => {
    const tempDir = await createTempDir()
    const filePath = path.join(tempDir, 'panel.pdf')
    await fs.promises.writeFile(filePath, Buffer.from('pdf'))

    await expect(inspectExistingDocumentFile(filePath)).resolves.toMatchObject({
      canonicalPath: filePath,
      mimeType: 'application/pdf',
      size: 3,
      name: 'panel.pdf',
    })
  })

  test('rejects unsupported file types during inspection', async () => {
    const tempDir = await createTempDir()
    const filePath = path.join(tempDir, 'notes.txt')
    await fs.promises.writeFile(filePath, Buffer.from('text'))

    await expect(inspectExistingDocumentFile(filePath)).rejects.toThrow('Unsupported file type')
  })

  test('builds import names from supported extensions and mime fallback', () => {
    expect(resolveImportedDocumentName('chapter 01.PNG', '')).toEqual({
      finalName: 'chapter_01.png',
      finalExt: '.png',
      resolvedMimeType: 'image/png',
    })

    expect(resolveImportedDocumentName('scan upload', 'application/pdf')).toEqual({
      finalName: 'scan_upload.pdf',
      finalExt: '.pdf',
      resolvedMimeType: 'application/pdf',
    })
  })

  test('rejects unsupported imports', () => {
    expect(() => resolveImportedDocumentName('archive.zip', 'application/zip')).toThrow('Unsupported file type')
  })
})
