import { describe, it, expect, beforeEach, vi } from 'vitest';
import type Database from 'better-sqlite3-multiple-ciphers';
import { TranslationCacheDAO, SentenceTranslationDAO } from './TranslationDAO';

describe('TranslationDAO & SentenceTranslationDAO', () => {
  let preparedSqls: string[] = [];
  let runCalls: any[] = [];
  let mockDb: any;
  let mockGetReturn: any = null;
  let mockAllReturn: any[] = [];

  beforeEach(() => {
    preparedSqls = [];
    runCalls = [];
    mockGetReturn = null;
    mockAllReturn = [];

    mockDb = {
      prepare: vi.fn((sql: string) => {
        preparedSqls.push(sql);
        return {
          run: vi.fn((params: any) => {
            runCalls.push(params);
            return { changes: 1 };
          }),
          get: vi.fn((...args: any[]) => (typeof mockGetReturn === 'function' ? mockGetReturn(...args) : mockGetReturn)),
          all: vi.fn(() => mockAllReturn),
        };
      }),
      transaction: vi.fn((fn: any) => fn),
    };

    TranslationCacheDAO.init(mockDb as Database.Database);
    SentenceTranslationDAO.init(mockDb as Database.Database);
  });

  describe('TranslationCacheDAO', () => {
    it('preserves sentence_translation_cache when clearByEngine is called', () => {
      const cleared = TranslationCacheDAO.clearByEngine(1, 1, 'offline');
      expect(cleared).toBe(true);

      expect(preparedSqls.some(sql => sql.includes('DELETE FROM translation_cache'))).toBe(true);
      expect(preparedSqls.some(sql => sql.includes('DELETE FROM sentence_translation_cache'))).toBe(false);
    });

    it('saves an entry with normalized fields and serialized translatedByIndex', () => {
      TranslationCacheDAO.save(1, 2, 'page_1_ver:v64_algo:v230', {
        key: 'page_1_ver:v64_algo:v230',
        pageNum: 2,
        ocrEngine: 'PaddleOCR',
        ocrLanguage: 'jpn',
        sourceLanguage: 'JPN',
        targetLanguage: 'TH',
        translationMode: 'MANGA',
        translatorEngine: 'OFFLINE',
        sourceFingerprint: 'fp_12345',
        translatedByIndex: [
          { index: 0, text: 'สวัสดี', sourceText: 'こんにちは' }
        ],
        translatedText: 'สวัสดี',
        lineCount: 1,
        groupCount: 1,
        createdAt: 1000,
      });

      expect(runCalls.length).toBe(1);
      const params = runCalls[0];
      expect(params.documentId).toBe(1);
      expect(params.pageNumber).toBe(2);
      expect(params.ocrEngine).toBe('paddleocr');
      expect(params.sourceLanguage).toBe('jpn');
      expect(params.targetLanguage).toBe('th');
      expect(params.translationMode).toBe('manga');
      expect(params.translatorEngine).toBe('offline');
      expect(JSON.parse(params.translatedByIndex)).toEqual([
        { index: 0, text: 'สวัสดี', sourceText: 'こんにちは' }
      ]);
    });

    it('handles saveBatch via db.transaction', () => {
      const items = [
        {
          documentId: 1,
          pageNumber: 1,
          cacheKey: 'k1_ver:v64',
          entry: {
            key: 'k1_ver:v64',
            pageNum: 1,
            ocrEngine: 'paddleocr',
            ocrLanguage: 'eng',
            sourceLanguage: 'eng',
            targetLanguage: 'th',
            translationMode: 'manga',
            translatorEngine: 'offline',
            sourceFingerprint: 'fp1',
            translatedByIndex: [],
            translatedText: 'Hello',
            lineCount: 1,
            groupCount: 1,
            createdAt: 1000,
          },
        },
        {
          documentId: 1,
          pageNumber: 2,
          cacheKey: 'k2_ver:v64',
          entry: {
            key: 'k2_ver:v64',
            pageNum: 2,
            ocrEngine: 'paddleocr',
            ocrLanguage: 'eng',
            sourceLanguage: 'eng',
            targetLanguage: 'th',
            translationMode: 'manga',
            translatorEngine: 'offline',
            sourceFingerprint: 'fp2',
            translatedByIndex: [],
            translatedText: 'World',
            lineCount: 1,
            groupCount: 1,
            createdAt: 1000,
          },
        },
      ];

      TranslationCacheDAO.saveBatch(items);
      expect(mockDb.transaction).toHaveBeenCalled();
      expect(runCalls.length).toBe(2);
    });

    it('filters out stale cache versions (< v40) in getByPage and parses JSON', () => {
      mockAllReturn = [
        {
          cache_key: 'page_1_ver:v39_old',
          ocr_engine: 'paddleocr',
          ocr_language: 'eng',
          source_language: 'eng',
          target_language: 'th',
          translation_mode: 'manga',
          translator_engine: 'offline',
          source_fingerprint: 'fp_old',
          translated_by_index: JSON.stringify([{ index: 0, text: 'เก่า' }]),
          translated_text: 'เก่า',
          line_count: 1,
          group_count: 1,
          created_at: 100,
        },
        {
          cache_key: 'page_1_ver:v64_valid',
          ocr_engine: 'paddleocr',
          ocr_language: 'eng',
          source_language: 'eng',
          target_language: 'th',
          translation_mode: 'manga',
          translator_engine: 'offline',
          source_fingerprint: 'fp_valid',
          translated_by_index: JSON.stringify([{ lineIndex: 1, text: 'ใหม่', rawText: 'New' }]),
          translated_text: 'ใหม่',
          line_count: 1,
          group_count: 1,
          created_at: 200,
        },
      ];

      const results = TranslationCacheDAO.getByPage(1, 1);
      // v39 must be excluded, only v64 returned
      expect(results.length).toBe(1);
      expect(results[0].key).toBe('page_1_ver:v64_valid');
      expect(results[0].translatedByIndex).toEqual([
        { index: 1, text: 'ใหม่', sourceText: 'New', bbox: undefined }
      ]);
    });

    it('safely handles corrupted JSON in translated_by_index', () => {
      mockAllReturn = [
        {
          cache_key: 'page_1_ver:v64_corrupt',
          ocr_engine: 'paddleocr',
          ocr_language: 'eng',
          source_language: 'eng',
          target_language: 'th',
          translation_mode: 'manga',
          translator_engine: 'offline',
          source_fingerprint: 'fp_corrupt',
          translated_by_index: '{not-json}',
          translated_text: 'Test',
          line_count: 1,
          group_count: 1,
          created_at: 200,
        },
      ];

      const results = TranslationCacheDAO.getByPage(1, 1);
      expect(results.length).toBe(1);
      expect(results[0].translatedByIndex).toEqual([]);
    });
  });

  describe('SentenceTranslationDAO', () => {
    it('allows explicitly clearing sentence_translation_cache with clearAll', () => {
      const result = SentenceTranslationDAO.clearAll();
      expect(result).toBe(true);
      expect(preparedSqls.some(sql => sql.includes('DELETE FROM sentence_translation_cache'))).toBe(true);
    });

    it('saves a sentence translation and queries it back', () => {
      const saved = SentenceTranslationDAO.save('Hello', 'ENG', 'TH', 'OFFLINE', 'MANGA', 'สวัสดี');
      expect(saved).toBe(true);
      expect(preparedSqls.some(sql => sql.includes('INSERT INTO sentence_translation_cache'))).toBe(true);

      mockGetReturn = { translated_text: 'สวัสดี' };
      const text = SentenceTranslationDAO.get('Hello', 'eng', 'th', 'offline', 'manga');
      expect(text).toBe('สวัสดี');
    });

    it('fetches sentence translations batch correctly', () => {
      const dict: Record<string, string> = {
        'One': 'หนึ่ง',
        'Two': 'สอง',
      };
      mockGetReturn = (text: string) => {
        return dict[text] ? { translated_text: dict[text] } : undefined;
      };

      const result = SentenceTranslationDAO.getBatch(
        ['One', 'Two', 'Three'],
        'eng',
        'th',
        'offline',
        'manga'
      );

      expect(result).toEqual({
        'One': 'หนึ่ง',
        'Two': 'สอง',
      });
    });
  });
});
