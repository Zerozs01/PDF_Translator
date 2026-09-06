import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import { TranslationCacheDAO, SentenceTranslationDAO } from './TranslationDAO';

describe('TranslationDAO & SentenceTranslationDAO', () => {
  let preparedSqls: string[] = [];
  let mockDb: any;

  beforeEach(() => {
    preparedSqls = [];
    mockDb = {
      prepare: vi.fn((sql: string) => {
        preparedSqls.push(sql);
        return {
          run: vi.fn().mockReturnValue({ changes: 1 }),
          get: vi.fn(),
          all: vi.fn().mockReturnValue([]),
        };
      }),
      transaction: vi.fn((fn: any) => fn),
    };

    TranslationCacheDAO.init(mockDb as Database.Database);
    SentenceTranslationDAO.init(mockDb as Database.Database);
  });

  it('preserves sentence_translation_cache when clearByEngine is called', () => {
    const cleared = TranslationCacheDAO.clearByEngine(1, 1, 'offline');
    expect(cleared).toBe(true);

    // Verify it prepares DELETE FROM translation_cache
    expect(preparedSqls.some(sql => sql.includes('DELETE FROM translation_cache'))).toBe(true);

    // Critical check: sentence_translation_cache MUST NOT be deleted!
    expect(preparedSqls.some(sql => sql.includes('DELETE FROM sentence_translation_cache'))).toBe(false);
  });

  it('allows explicitly clearing sentence_translation_cache with clearAll', () => {
    const result = SentenceTranslationDAO.clearAll();
    expect(result).toBe(true);
    expect(preparedSqls.some(sql => sql.includes('DELETE FROM sentence_translation_cache'))).toBe(true);
  });
});
