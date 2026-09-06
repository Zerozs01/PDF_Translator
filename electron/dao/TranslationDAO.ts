import type Database from 'better-sqlite3-multiple-ciphers';

export type TranslationCacheEntryRecord = {
  key: string;
  pageNum: number;
  ocrEngine: string;
  ocrLanguage: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationMode: string;
  translatorEngine: string;
  sourceFingerprint: string;
  translatedByIndex: Array<{ index: number; text: string; sourceText?: string; bbox?: any }>;
  translatedText: string;
  lineCount: number;
  groupCount: number;
  createdAt: number;
};

export class TranslationCacheDAO {
  private static db: Database.Database | null = null;
  private static stmtCache = new Map<string, Database.Statement>();

  static init(database: Database.Database) {
    this.db = database;
    this.stmtCache.clear();
  }

  private static getStmt(sql: string): Database.Statement {
    if (!this.db) throw new Error('TranslationCacheDAO: DB not initialized');
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  static save(
    documentId: number,
    pageNumber: number,
    cacheKey: string,
    entry: TranslationCacheEntryRecord
  ) {
    const now = Date.now();
    const normalizedEngine = String(entry.ocrEngine || 'paddleocr').toLowerCase();
    const stmt = this.getStmt(`
      INSERT INTO translation_cache (
        document_id,
        page_number,
        cache_key,
        ocr_engine,
        ocr_language,
        source_language,
        target_language,
        translation_mode,
        translator_engine,
        source_fingerprint,
        translated_by_index,
        translated_text,
        line_count,
        group_count,
        created_at,
        updated_at
      )
      VALUES (
        @documentId,
        @pageNumber,
        @cacheKey,
        @ocrEngine,
        @ocrLanguage,
        @sourceLanguage,
        @targetLanguage,
        @translationMode,
        @translatorEngine,
        @sourceFingerprint,
        @translatedByIndex,
        @translatedText,
        @lineCount,
        @groupCount,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(document_id, page_number, cache_key) DO UPDATE SET
        ocr_engine = @ocrEngine,
        ocr_language = @ocrLanguage,
        source_language = @sourceLanguage,
        target_language = @targetLanguage,
        translation_mode = @translationMode,
        translator_engine = @translatorEngine,
        source_fingerprint = @sourceFingerprint,
        translated_by_index = @translatedByIndex,
        translated_text = @translatedText,
        line_count = @lineCount,
        group_count = @groupCount,
        created_at = @createdAt,
        updated_at = @updatedAt
    `);

    stmt.run({
      documentId,
      pageNumber,
      cacheKey,
      ocrEngine: normalizedEngine,
      ocrLanguage: String(entry.ocrLanguage || 'eng'),
      sourceLanguage: String(entry.sourceLanguage || 'eng').toLowerCase(),
      targetLanguage: String(entry.targetLanguage || 'th').toLowerCase(),
      translationMode: String(entry.translationMode || 'manga').toLowerCase(),
      translatorEngine: String(entry.translatorEngine || 'offline').toLowerCase(),
      sourceFingerprint: String(entry.sourceFingerprint || ''),
      translatedByIndex: JSON.stringify(Array.isArray(entry.translatedByIndex) ? entry.translatedByIndex : []),
      translatedText: String(entry.translatedText || ''),
      lineCount: Number(entry.lineCount || 0),
      groupCount: Number(entry.groupCount || 0),
      createdAt: Number(entry.createdAt || now),
      updatedAt: now,
    });
  }

  static saveBatch(
    items: Array<{ documentId: number; pageNumber: number; cacheKey: string; entry: TranslationCacheEntryRecord }>
  ) {
    if (!this.db) throw new Error('TranslationCacheDAO: DB not initialized');
    if (!items || items.length === 0) return;
    const now = Date.now();
    const stmt = this.getStmt(`
      INSERT INTO translation_cache (
        document_id,
        page_number,
        cache_key,
        ocr_engine,
        ocr_language,
        source_language,
        target_language,
        translation_mode,
        translator_engine,
        source_fingerprint,
        translated_by_index,
        translated_text,
        line_count,
        group_count,
        created_at,
        updated_at
      )
      VALUES (
        @documentId,
        @pageNumber,
        @cacheKey,
        @ocrEngine,
        @ocrLanguage,
        @sourceLanguage,
        @targetLanguage,
        @translationMode,
        @translatorEngine,
        @sourceFingerprint,
        @translatedByIndex,
        @translatedText,
        @lineCount,
        @groupCount,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(document_id, page_number, cache_key) DO UPDATE SET
        ocr_engine = @ocrEngine,
        ocr_language = @ocrLanguage,
        source_language = @sourceLanguage,
        target_language = @targetLanguage,
        translation_mode = @translationMode,
        translator_engine = @translatorEngine,
        source_fingerprint = @sourceFingerprint,
        translated_by_index = @translatedByIndex,
        translated_text = @translatedText,
        line_count = @lineCount,
        group_count = @groupCount,
        created_at = @createdAt,
        updated_at = @updatedAt
    `);

    const insertMany = this.db.transaction((rows: typeof items) => {
      for (const item of rows) {
        const entry = item.entry;
        stmt.run({
          documentId: item.documentId,
          pageNumber: item.pageNumber,
          cacheKey: item.cacheKey,
          ocrEngine: String(entry.ocrEngine || 'paddleocr').toLowerCase(),
          ocrLanguage: String(entry.ocrLanguage || 'eng'),
          sourceLanguage: String(entry.sourceLanguage || 'eng').toLowerCase(),
          targetLanguage: String(entry.targetLanguage || 'th').toLowerCase(),
          translationMode: String(entry.translationMode || 'manga').toLowerCase(),
          translatorEngine: String(entry.translatorEngine || 'offline').toLowerCase(),
          sourceFingerprint: String(entry.sourceFingerprint || ''),
          translatedByIndex: JSON.stringify(Array.isArray(entry.translatedByIndex) ? entry.translatedByIndex : []),
          translatedText: String(entry.translatedText || ''),
          lineCount: Number(entry.lineCount || 0),
          groupCount: Number(entry.groupCount || 0),
          createdAt: Number(entry.createdAt || now),
          updatedAt: now,
        });
      }
    });
    insertMany(items);
  }

  static getByPage(documentId: number, pageNumber: number) {
    const rows = this.getStmt(`
      SELECT
        cache_key,
        ocr_engine,
        ocr_language,
        source_language,
        target_language,
        translation_mode,
        translator_engine,
        source_fingerprint,
        translated_by_index,
        translated_text,
        line_count,
        group_count,
        created_at
      FROM translation_cache
      WHERE document_id = ?
        AND page_number = ?
      ORDER BY created_at DESC, updated_at DESC
    `).all(documentId, pageNumber) as Array<{
      cache_key: string;
      ocr_engine: string;
      ocr_language: string;
      source_language: string;
      target_language: string;
      translation_mode: string;
      translator_engine: string;
      source_fingerprint: string;
      translated_by_index: string;
      translated_text: string;
      line_count: number;
      group_count: number;
      created_at: number;
    }>;

    const hasValidTranslationVersion = (key: string): boolean => {
      const strKey = String(key || '');
      const match = strKey.match(/ver:v(\d+)/);
      if (!match) return false;
      const versionNum = parseInt(match[1], 10);
      return versionNum >= 40;
    };

    return rows
      .filter((row) => hasValidTranslationVersion(row.cache_key))
      .map((row) => {
        let translatedByIndex: Array<{ index: number; text: string; sourceText?: string; bbox?: any }> = [];
        try {
          const parsed = JSON.parse(row.translated_by_index);
          if (Array.isArray(parsed)) {
            translatedByIndex = parsed
              .map((item: any) => {
                const indexVal = item.index !== undefined ? item.index : item.lineIndex;
                const sourceTextVal = item.sourceText !== undefined ? item.sourceText : item.rawText;
                return {
                  index: Number(indexVal !== undefined ? indexVal : 0),
                  text: String(item.text || ''),
                  sourceText: sourceTextVal !== undefined ? String(sourceTextVal) : undefined,
                  bbox: item.bbox,
                };
              })
              .filter((item) => Number.isFinite(item.index));
          }
        } catch {
          translatedByIndex = [];
        }

        return {
          key: row.cache_key,
          pageNum: pageNumber,
          ocrEngine: row.ocr_engine,
          ocrLanguage: row.ocr_language,
          sourceLanguage: row.source_language,
          targetLanguage: row.target_language,
          translationMode: row.translation_mode,
          translatorEngine: row.translator_engine,
          sourceFingerprint: row.source_fingerprint,
          translatedByIndex,
          translatedText: row.translated_text,
          lineCount: Number(row.line_count || 0),
          groupCount: Number(row.group_count || 0),
          createdAt: Number(row.created_at || Date.now()),
        };
      });
  }

  static clearByEngine(documentId: number, pageNumber: number, engine: string = 'offline') {
    if (!this.db) throw new Error('TranslationCacheDAO: DB not initialized');
    const normalizedEngine = String(engine || 'offline').toLowerCase();
    const result = this.getStmt('DELETE FROM translation_cache WHERE document_id = ? AND page_number = ? AND ocr_engine = ?')
      .run(documentId, pageNumber, normalizedEngine);
    return result.changes > 0;
  }
}

export class SentenceTranslationDAO {
  private static db: Database.Database | null = null;
  private static stmtCache = new Map<string, Database.Statement>();

  static init(database: Database.Database) {
    this.db = database;
    this.stmtCache.clear();
  }

  static clearAll(): boolean {
    if (!this.db) throw new Error('SentenceTranslationDAO: DB not initialized');
    const result = this.getStmt('DELETE FROM sentence_translation_cache').run();
    return result.changes > 0;
  }

  private static getStmt(sql: string): Database.Statement {
    if (!this.db) throw new Error('SentenceTranslationDAO: DB not initialized');
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  static save(
    sourceText: string,
    sourceLanguage: string,
    targetLanguage: string,
    translatorEngine: string,
    translationMode: string,
    translatedText: string
  ): boolean {
    const now = Date.now();
    try {
      const stmt = this.getStmt(`
        INSERT INTO sentence_translation_cache (
          source_text,
          source_language,
          target_language,
          translator_engine,
          translation_mode,
          translated_text,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_text, source_language, target_language, translator_engine, translation_mode) DO UPDATE SET
          translated_text = excluded.translated_text,
          created_at = excluded.created_at
      `);
      stmt.run(
        sourceText,
        sourceLanguage.toLowerCase(),
        targetLanguage.toLowerCase(),
        translatorEngine.toLowerCase(),
        translationMode.toLowerCase(),
        translatedText,
        now
      );
      return true;
    } catch (error) {
      console.error('[SentenceTranslationDAO] Failed to save sentence translation:', error);
      return false;
    }
  }

  static saveBatch(
    items: Array<{
      sourceText: string;
      sourceLanguage: string;
      targetLanguage: string;
      translatorEngine: string;
      translationMode: string;
      translatedText: string;
    }>
  ): boolean {
    if (!this.db) throw new Error('SentenceTranslationDAO: DB not initialized');
    if (!Array.isArray(items) || items.length === 0) return true;
    const now = Date.now();
    try {
      const stmt = this.getStmt(`
        INSERT INTO sentence_translation_cache (
          source_text,
          source_language,
          target_language,
          translator_engine,
          translation_mode,
          translated_text,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source_text, source_language, target_language, translator_engine, translation_mode) DO UPDATE SET
          translated_text = excluded.translated_text,
          created_at = excluded.created_at
      `);
      const insertMany = this.db.transaction((entries: typeof items) => {
        for (const entry of entries) {
          stmt.run(
            entry.sourceText,
            entry.sourceLanguage.toLowerCase(),
            entry.targetLanguage.toLowerCase(),
            entry.translatorEngine.toLowerCase(),
            entry.translationMode.toLowerCase(),
            entry.translatedText,
            now
          );
        }
      });
      insertMany(items);
      return true;
    } catch (error) {
      console.error('[SentenceTranslationDAO] Failed to save sentence translations batch:', error);
      return false;
    }
  }

  static get(
    sourceText: string,
    sourceLanguage: string,
    targetLanguage: string,
    translatorEngine: string,
    translationMode: string
  ): string | null {
    try {
      const stmt = this.getStmt(`
        SELECT translated_text 
        FROM sentence_translation_cache 
        WHERE source_text = ? 
          AND source_language = ? 
          AND target_language = ? 
          AND translator_engine = ? 
          AND translation_mode = ?
      `);
      const row = stmt.get(
        sourceText,
        sourceLanguage.toLowerCase(),
        targetLanguage.toLowerCase(),
        translatorEngine.toLowerCase(),
        translationMode.toLowerCase()
      ) as { translated_text: string } | undefined;

      return row ? row.translated_text : null;
    } catch (error) {
      console.error('[SentenceTranslationDAO] Failed to get sentence translation:', error);
      return null;
    }
  }

  static getBatch(
    sourceTexts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    translatorEngine: string,
    translationMode: string
  ): Record<string, string> {
    const results: Record<string, string> = {};
    if (sourceTexts.length === 0) return results;
    try {
      const stmt = this.getStmt(`
        SELECT translated_text 
        FROM sentence_translation_cache 
        WHERE source_text = ? 
          AND source_language = ? 
          AND target_language = ? 
          AND translator_engine = ? 
          AND translation_mode = ?
      `);
      const srcLang = sourceLanguage.toLowerCase();
      const tgtLang = targetLanguage.toLowerCase();
      const engine = translatorEngine.toLowerCase();
      const mode = translationMode.toLowerCase();
      
      for (const text of sourceTexts) {
        const row = stmt.get(text, srcLang, tgtLang, engine, mode) as { translated_text: string } | undefined;
        if (row) {
          results[text] = row.translated_text;
        }
      }
      return results;
    } catch (error) {
      console.error('[SentenceTranslationDAO] Failed to get sentence translations batch:', error);
      return results;
    }
  }
}

// Backwards compatibility alias
export const TranslationDAO = TranslationCacheDAO;
