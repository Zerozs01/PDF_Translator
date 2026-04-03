import { describe, expect, test, vi } from 'vitest';
import {
  isImportedCachePath,
  resolveCompatibleDocumentIdentity,
  resolveDocumentPathForLoad,
  type DocumentIdentityDB,
} from './documentIdentity';

const createDB = (overrides?: Partial<DocumentIdentityDB>): DocumentIdentityDB => ({
  getDocument: vi.fn(async () => null),
  getLatestOCR: vi.fn(async () => null),
  findDocumentsByFilename: vi.fn(async () => []),
  ...overrides,
});

describe('documentIdentity', () => {
  test('detects imported cache paths', () => {
    expect(isImportedCachePath('C:\\app\\imports\\abc123def4567890.pdf')).toBe(true);
    expect(isImportedCachePath('C:\\docs\\chapter-01.pdf')).toBe(false);
  });

  test('keeps source path when legacy document already exists', async () => {
    const db = createDB({
      getDocument: vi.fn(async (filepath: string) => (
        filepath.endsWith('source.pdf') ? { id: 10, total_pages: 1 } : null
      )),
    });

    const resolved = await resolveDocumentPathForLoad({
      db,
      filename: 'chapter.pdf',
      sourcePath: 'C:\\docs\\source.pdf',
      importedPath: 'C:\\imports\\aaaaaaaaaaaaaaaa.pdf',
    });

    expect(resolved.resolvedPath).toBe('C:\\docs\\source.pdf');
    expect(resolved.reusedCacheCandidate).toBeNull();
  });

  test('reuses a single OCR-backed candidate for imported files without current cache', async () => {
    const importedPath = 'C:\\repo\\imports\\aaaaaaaaaaaaaaaa.pdf';
    const db = createDB({
      getDocument: vi.fn(async (filepath: string) => (
        filepath === importedPath ? { id: 22, total_pages: 1 } : null
      )),
      findDocumentsByFilename: vi.fn(async () => ([
        {
          id: 11,
          filepath: 'C:\\legacy\\chapter.pdf',
          filename: 'chapter.pdf',
          total_pages: 1,
          last_accessed: 10,
          cache_pages: 3,
          last_cache_update: 100,
        },
      ])),
    });

    const resolved = await resolveDocumentPathForLoad({
      db,
      filename: 'chapter.pdf',
      sourcePath: null,
      importedPath,
    });

    expect(resolved.resolvedPath).toBe('C:\\legacy\\chapter.pdf');
    expect(resolved.reusedCacheCandidate?.id).toBe(11);
  });

  test('does not switch imported path when multiple cache candidates exist', async () => {
    const importedPath = 'C:\\repo\\imports\\aaaaaaaaaaaaaaaa.pdf';
    const db = createDB({
      getDocument: vi.fn(async (filepath: string) => (
        filepath === importedPath ? { id: 22, total_pages: 1 } : null
      )),
      findDocumentsByFilename: vi.fn(async () => ([
        {
          id: 11,
          filepath: 'C:\\legacy\\chapter-a.pdf',
          filename: 'chapter.pdf',
          total_pages: 1,
          last_accessed: 10,
          cache_pages: 3,
          last_cache_update: 100,
        },
        {
          id: 12,
          filepath: 'C:\\legacy\\chapter-b.pdf',
          filename: 'chapter.pdf',
          total_pages: 1,
          last_accessed: 9,
          cache_pages: 2,
          last_cache_update: 90,
        },
      ])),
    });

    const resolved = await resolveDocumentPathForLoad({
      db,
      filename: 'chapter.pdf',
      sourcePath: null,
      importedPath,
    });

    expect(resolved.resolvedPath).toBe(importedPath);
    expect(resolved.ambiguousCacheCandidates).toBe(2);
  });

  test('switches document identity to a single compatible cache candidate', async () => {
    const resolved = await resolveCompatibleDocumentIdentity({
      db: createDB({
        findDocumentsByFilename: vi.fn(async () => ([
          {
            id: 44,
            filepath: 'C:\\legacy\\chapter.pdf',
            filename: 'chapter.pdf',
            total_pages: 1,
            last_accessed: 12,
            cache_pages: 5,
            last_cache_update: 120,
          },
        ])),
      }),
      documentId: 22,
      filename: 'chapter.pdf',
      filePath: 'C:\\repo\\imports\\aaaaaaaaaaaaaaaa.pdf',
    });

    expect(resolved).toEqual({
      documentId: 44,
      filePath: 'C:\\legacy\\chapter.pdf',
      reusedCacheCandidate: {
        id: 44,
        filepath: 'C:\\legacy\\chapter.pdf',
        filename: 'chapter.pdf',
        total_pages: 1,
        last_accessed: 12,
        cache_pages: 5,
        last_cache_update: 120,
      },
      ambiguousCacheCandidates: 0,
    });
  });
});
