import type Database from 'better-sqlite3-multiple-ciphers';

export interface TranslationCacheRow {
  document_id: number;
  page_number: number;
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
  width?: number;
  height?: number;
  created_at: number;
  updated_at: number;
}

export class TranslationDAO {
  private static db: Database.Database | null = null;
  private static stmtCache = new Map<string, Database.Statement>();

  static init(database: Database.Database) {
    this.db = database;
    this.stmtCache.clear();
  }

  private static getStmt(sql: string): Database.Statement {
    if (!this.db) throw new Error('TranslationDAO: DB not initialized');
    let stmt = this.stmtCache.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  static getTranslationCache(
    documentId: number,
    pageNumber: number,
    cacheKey?: string
  ): TranslationCacheRow[] {
    if (cacheKey) {
      const stmt = this.getStmt(`
        SELECT * FROM translation_cache 
        WHERE document_id = ? AND page_number = ? AND cache_key = ?
      `);
      const row = stmt.get(documentId, pageNumber, cacheKey) as TranslationCacheRow | undefined;
      return row ? [row] : [];
    }

    const stmt = this.getStmt(`
      SELECT * FROM translation_cache 
      WHERE document_id = ? AND page_number = ? 
      ORDER BY updated_at DESC
    `);
    return stmt.all(documentId, pageNumber) as TranslationCacheRow[];
  }

  static setTranslationCache(entry: {
    documentId: number;
    pageNumber: number;
    cacheKey: string;
    ocrEngine: string;
    ocrLanguage: string;
    sourceLanguage: string;
    targetLanguage: string;
    translationMode: string;
    translatorEngine: string;
    sourceFingerprint: string;
    translatedByIndex: string;
    translatedText: string;
    lineCount?: number;
    groupCount?: number;
    width?: number;
    height?: number;
  }): void {
    const now = Date.now();
    const stmt = this.getStmt(`
      INSERT INTO translation_cache (
        document_id, page_number, cache_key, ocr_engine, ocr_language,
        source_language, target_language, translation_mode, translator_engine,
        source_fingerprint, translated_by_index, translated_text, line_count, group_count,
        width, height, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id, page_number, cache_key) DO UPDATE SET
        translated_by_index = excluded.translated_by_index,
        translated_text = excluded.translated_text,
        line_count = excluded.line_count,
        group_count = excluded.group_count,
        width = excluded.width,
        height = excluded.height,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      entry.documentId,
      entry.pageNumber,
      entry.cacheKey,
      entry.ocrEngine,
      entry.ocrLanguage,
      entry.sourceLanguage,
      entry.targetLanguage,
      entry.translationMode,
      entry.translatorEngine,
      entry.sourceFingerprint,
      entry.translatedByIndex,
      entry.translatedText,
      entry.lineCount || 0,
      entry.groupCount || 0,
      entry.width || 0,
      entry.height || 0,
      now,
      now
    );
  }

  static clearTranslationCache(documentId: number, pageNumber?: number): void {
    if (pageNumber !== undefined) {
      this.getStmt('DELETE FROM translation_cache WHERE document_id = ? AND page_number = ?')
        .run(documentId, pageNumber);
    } else {
      this.getStmt('DELETE FROM translation_cache WHERE document_id = ?').run(documentId);
    }
  }

  static getSentenceTranslation(
    sourceText: string,
    sourceLanguage: string,
    targetLanguage: string,
    translatorEngine: string,
    translationMode: string
  ): string | null {
    const stmt = this.getStmt(`
      SELECT translated_text FROM sentence_translation_cache 
      WHERE source_text = ? AND source_language = ? AND target_language = ? AND translator_engine = ? AND translation_mode = ?
    `);
    const row = stmt.get(
      sourceText,
      sourceLanguage.toLowerCase(),
      targetLanguage.toLowerCase(),
      translatorEngine.toLowerCase(),
      translationMode.toLowerCase()
    ) as { translated_text: string } | undefined;
    return row ? row.translated_text : null;
  }

  static setSentenceTranslation(
    sourceText: string,
    sourceLanguage: string,
    targetLanguage: string,
    translatorEngine: string,
    translationMode: string,
    translatedText: string
  ): void {
    const now = Date.now();
    const stmt = this.getStmt(`
      INSERT INTO sentence_translation_cache (
        source_text, source_language, target_language, translator_engine, translation_mode, translated_text, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_text, source_language, target_language, translator_engine, translation_mode) DO UPDATE SET
        translated_text = excluded.translated_text
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
  }

  static getSentenceTranslationsBatch(
    sourceTexts: string[],
    sourceLanguage: string,
    targetLanguage: string,
    translatorEngine: string,
    translationMode: string
  ): Record<string, string> {
    const results: Record<string, string> = {};
    if (!sourceTexts || sourceTexts.length === 0) return results;

    const stmt = this.getStmt(`
      SELECT translated_text FROM sentence_translation_cache 
      WHERE source_text = ? AND source_language = ? AND target_language = ? AND translator_engine = ? AND translation_mode = ?
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
  }
}
