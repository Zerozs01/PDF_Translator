import { describe, expect, test, vi } from 'vitest';
import {
  ensureProjectDocumentRecord,
  importCanonicalProjectFile,
  prepareProjectDocumentLoad,
  type ProjectDocumentDB,
} from './projectDocumentService';

type MockFile = File & { path?: string };

const createFile = (overrides?: Partial<MockFile>): MockFile => ({
  name: 'chapter.pdf',
  type: 'application/pdf',
  path: 'C:\\docs\\chapter.pdf',
  arrayBuffer: vi.fn(async () => Uint8Array.from([1, 2, 3]).buffer),
  ...overrides,
} as unknown as MockFile);

const createDB = (overrides?: Partial<ProjectDocumentDB>): ProjectDocumentDB => ({
  isAvailable: () => true,
  getDocument: vi.fn(async () => null),
  saveDocument: vi.fn(async () => 1),
  getLatestOCR: vi.fn(async () => null),
  findDocumentsByFilename: vi.fn(async () => []),
  touchDocument: vi.fn(async () => true),
  updateLastPage: vi.fn(async () => true),
  updateDocument: vi.fn(async () => true),
  ...overrides,
});

describe('projectDocumentService', () => {
  test('imports canonical file data when bridge is available', async () => {
    const file = createFile();
    const importFile = vi.fn(async () => ({ filepath: 'C:\\imports\\aaaaaaaaaaaaaaaa.pdf' }));

    const result = await importCanonicalProjectFile({ file, importFile });

    expect(result.importedPath).toBe('C:\\imports\\aaaaaaaaaaaaaaaa.pdf');
    expect(result.resolvedFileData).toEqual(Uint8Array.from([1, 2, 3]));
    expect(importFile).toHaveBeenCalledTimes(1);
  });

  test('resolves imported path through document identity lookup', async () => {
    const file = createFile({ path: undefined });
    const db = createDB({
      findDocumentsByFilename: vi.fn(async () => ([
        {
          id: 7,
          filepath: 'C:\\legacy\\chapter.pdf',
          filename: 'chapter.pdf',
          total_pages: 1,
          last_accessed: 10,
          cache_pages: 4,
          last_cache_update: 100,
        },
      ])),
      getDocument: vi.fn(async (filepath: string) => (
        filepath.endsWith('aaaaaaaaaaaaaaaa.pdf') ? { id: 3, total_pages: 1 } : null
      )),
    });

    const result = await prepareProjectDocumentLoad({
      db,
      file,
      importFile: vi.fn(async () => ({ filepath: 'C:\\imports\\aaaaaaaaaaaaaaaa.pdf' })),
    });

    expect(result.resolvedPath).toBe('C:\\legacy\\chapter.pdf');
    expect(result.resolvedFileData).toEqual(Uint8Array.from([1, 2, 3]));
  });

  test('creates a document record when none exists yet', async () => {
    const file = createFile();
    const db = createDB({
      getDocument: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 42, total_pages: 0 }),
      saveDocument: vi.fn(async () => 42),
    });

    const result = await ensureProjectDocumentRecord({
      db,
      documentId: null,
      file,
      filePath: 'C:\\docs\\chapter.pdf',
    });

    expect(result).toEqual({
      documentId: 42,
      filePath: 'C:\\docs\\chapter.pdf',
    });
  });

  test('switches to compatible OCR-backed document identity when needed', async () => {
    const db = createDB({
      findDocumentsByFilename: vi.fn(async () => ([
        {
          id: 99,
          filepath: 'C:\\legacy\\chapter.pdf',
          filename: 'chapter.pdf',
          total_pages: 1,
          last_accessed: 12,
          cache_pages: 3,
          last_cache_update: 120,
        },
      ])),
    });

    const result = await ensureProjectDocumentRecord({
      db,
      documentId: 22,
      file: createFile({ path: 'C:\\repo\\imports\\aaaaaaaaaaaaaaaa.pdf' }),
      filePath: 'C:\\repo\\imports\\aaaaaaaaaaaaaaaa.pdf',
    });

    expect(result).toEqual({
      documentId: 99,
      filePath: 'C:\\legacy\\chapter.pdf',
    });
  });

  test('keeps existing identity when no compatible cache candidate is found', async () => {
    const result = await ensureProjectDocumentRecord({
      db: createDB(),
      documentId: 22,
      file: createFile({ path: 'C:\\repo\\imports\\aaaaaaaaaaaaaaaa.pdf' }),
      filePath: 'C:\\repo\\imports\\aaaaaaaaaaaaaaaa.pdf',
    });

    expect(result).toEqual({
      documentId: 22,
      filePath: 'C:\\repo\\imports\\aaaaaaaaaaaaaaaa.pdf',
    });
  });
});
