import { describe, expect, test, vi } from 'vitest';
import type { DBDocument, ElectronAPI } from '../types/electron.d';
import {
  applyLibraryFavoriteToggle,
  applyLibraryProjectMove,
  filterLibraryDocuments,
  loadLibraryDocumentTags,
  loadRecentLibraryDocuments,
  moveLibraryDocumentToProject,
  patchLibraryDocuments,
  sortLibraryDocuments,
} from './libraryService';

const createDocument = (overrides?: Partial<DBDocument>): DBDocument => ({
  id: 1,
  filepath: 'C:\\docs\\chapter-a.pdf',
  filename: 'chapter-a.pdf',
  file_type: 'pdf',
  file_size: 100,
  total_pages: 10,
  thumbnail_path: null,
  project_id: null,
  is_favorite: false,
  last_page: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  last_accessed: '2026-01-02T00:00:00.000Z',
  ...overrides,
});

const createDbClient = (overrides?: Partial<ElectronAPI['db']>): Pick<ElectronAPI, 'db'> => ({
  db: {
    saveDocument: vi.fn(async () => 1),
    getDocument: vi.fn(async () => null),
    findDocumentsByFilename: vi.fn(async () => []),
    saveOCR: vi.fn(async () => true),
    getOCR: vi.fn(async () => null),
    clearOCR: vi.fn(async () => true),
    getLatestOCR: vi.fn(async () => null),
    saveTranslationCache: vi.fn(async () => true),
    getTranslationCachePage: vi.fn(async () => []),
    clearTranslationCacheByEngine: vi.fn(async () => true),
    getRecentDocuments: vi.fn(async () => []),
    getDocumentsByProject: vi.fn(async () => []),
    getFavoriteDocuments: vi.fn(async () => []),
    searchDocuments: vi.fn(async () => []),
    updateDocument: vi.fn(async () => true),
    deleteDocument: vi.fn(async () => true),
    toggleFavorite: vi.fn(async () => true),
    getDocumentsByTag: vi.fn(async () => []),
    addDocumentTag: vi.fn(async () => true),
    removeDocumentTag: vi.fn(async () => true),
    getDocumentTags: vi.fn(async () => []),
    touchDocument: vi.fn(async () => true),
    updateLastPage: vi.fn(async () => true),
    ...overrides,
  },
});

describe('libraryService', () => {
  test('filters virtual documents out of library lists', () => {
    const documents = [
      createDocument({ id: 1, filepath: 'virtual://tmp/preview.pdf' }),
      createDocument({ id: 2, filepath: 'C:\\docs\\chapter-b.pdf' }),
    ];

    expect(filterLibraryDocuments(documents).map((doc) => doc.id)).toEqual([2]);
  });

  test('sorts documents by date descending', () => {
    const documents = [
      createDocument({ id: 1, last_accessed: '2026-01-01T00:00:00.000Z' }),
      createDocument({ id: 2, last_accessed: '2026-01-03T00:00:00.000Z' }),
    ];

    expect(sortLibraryDocuments(documents, 'date', 'desc').map((doc) => doc.id)).toEqual([2, 1]);
  });

  test('applies favorite toggle removal for favorites filter', () => {
    const documents = [
      createDocument({ id: 1, is_favorite: true }),
      createDocument({ id: 2, is_favorite: true }),
    ];

    expect(
      applyLibraryFavoriteToggle({
        documents,
        filterType: 'favorites',
        documentId: 1,
        nextFavorite: false,
      }).map((doc) => doc.id)
    ).toEqual([2]);
  });

  test('removes moved documents from active project filter when needed', () => {
    const documents = [
      createDocument({ id: 1, project_id: 5 }),
      createDocument({ id: 2, project_id: 5 }),
    ];

    expect(
      applyLibraryProjectMove({
        documents,
        filterType: 'project',
        selectedProjectId: 5,
        documentId: 1,
        projectId: 9,
      }).map((doc) => doc.id)
    ).toEqual([2]);
  });

  test('patches document metadata in place by id', () => {
    const documents = [
      createDocument({ id: 1, thumbnail_path: null }),
      createDocument({ id: 2, thumbnail_path: null }),
    ];

    const patched = patchLibraryDocuments(documents, 2, { thumbnail_path: 'data:image/png;base64,abc' });

    expect(patched[1].thumbnail_path).toBe('data:image/png;base64,abc');
    expect(patched[0].thumbnail_path).toBeNull();
  });

  test('loads recent documents through db client and filters virtual paths', async () => {
    const client = createDbClient({
      getRecentDocuments: vi.fn(async () => ([
        createDocument({ id: 1, filepath: 'virtual://tmp/preview.pdf' }),
        createDocument({ id: 2, filepath: 'C:\\docs\\chapter-b.pdf' }),
      ])),
    });

    const documents = await loadRecentLibraryDocuments(50, client);

    expect(documents.map((doc) => doc.id)).toEqual([2]);
  });

  test('forwards project move through document update channel', async () => {
    const updateDocument = vi.fn(async () => true);
    const client = createDbClient({ updateDocument });

    const result = await moveLibraryDocumentToProject(7, 3, client);

    expect(result).toBe(true);
    expect(updateDocument).toHaveBeenCalledWith(7, { project_id: 3 });
  });

  test('loads document tags through db client', async () => {
    const tags = [{ id: 3, name: 'Action', color: '#FF8705', created_at: '2026-01-01T00:00:00.000Z' }];
    const client = createDbClient({
      getDocumentTags: vi.fn(async () => tags),
    });

    await expect(loadLibraryDocumentTags(11, client)).resolves.toEqual(tags);
  });
});
