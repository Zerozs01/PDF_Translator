import { ipcMain } from 'electron';
import {
  DocumentDAO,
  OCRCacheDAO,
  ProjectDAO,
  TagDAO,
  TranslationCacheDAO,
  BenchmarkDAO,
  SentenceTranslationDAO,
  GlossaryDAO
} from '../db';
import {
  getRequestedDocumentPath,
  inspectExistingDocumentFile,
  tryResolveRealDocumentPath
} from '../documentFileAccess';
import { isValidString, isValidNumber, isValidEngine } from './ipcUtils';

const MAX_OCR_CACHE_STATS_DOC_IDS = 500;

export function registerDbIpcHandlers() {
  // ============================================
  // Database IPC Handlers (with validation)
  // ============================================
  ipcMain.handle('db:save-document', async (_, { filepath, filename, totalPages }) => {
    // Input validation
    if (!isValidString(filepath) || !isValidString(filename)) {
      throw new Error('Invalid input: filepath and filename must be non-empty strings');
    }
    if (!isValidNumber(totalPages)) {
      throw new Error('Invalid input: totalPages must be a positive number');
    }

    try {
      const requestedPath = getRequestedDocumentPath(filepath);
      const documentFile = await inspectExistingDocumentFile(requestedPath);
      const storagePath = DocumentDAO.get(requestedPath) ? requestedPath : documentFile.canonicalPath;
      const fileType = documentFile.mimeType === 'application/pdf' ? 'pdf' : 'image';
      const row = DocumentDAO.upsert(storagePath, filename, totalPages, documentFile.size, fileType) as { id?: number } | undefined;
      return row?.id ?? 0;
    } catch (error) {
      console.error('db:save-document error:', error);
      throw error;
    }
  });

  ipcMain.handle('db:get-document', async (_, filepath) => {
    if (!isValidString(filepath)) {
      throw new Error('Invalid input: filepath must be a non-empty string');
    }

    try {
      const requestedPath = getRequestedDocumentPath(filepath);
      return DocumentDAO.get(requestedPath) ?? DocumentDAO.get(await tryResolveRealDocumentPath(requestedPath));
    } catch (error) {
      console.error('db:get-document error:', error);
      return null;
    }
  });

  ipcMain.handle('db:find-documents-by-filename', async (_, filename) => {
    if (!isValidString(filename)) {
      throw new Error('Invalid input: filename must be a non-empty string');
    }

    try {
      return DocumentDAO.findByFilenameWithCacheStats(filename);
    } catch (error) {
      console.error('db:find-documents-by-filename error:', error);
      return [];
    }
  });

  ipcMain.handle('db:save-ocr', async (_, { docId, pageNum, data, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      const selectedEngine = isValidEngine(engine)
        ? engine
        : isValidEngine((data as { ocrEngine?: unknown } | null)?.ocrEngine)
          ? (data as { ocrEngine: string }).ocrEngine
          : 'tesseract';
      OCRCacheDAO.save(docId, pageNum, data, selectedEngine);
      return true;
    } catch (error) {
      console.error('db:save-ocr error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-ocr', async (_, { docId, pageNum, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      const selectedEngine = isValidEngine(engine) ? engine : 'tesseract';
      const result = OCRCacheDAO.get(docId, pageNum, selectedEngine);
      return result;
    } catch (error) {
      console.error('db:get-ocr error:', error);
      return null;
    }
  });

  ipcMain.handle('db:clear-ocr', async (_, { docId, pageNum, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      const selectedEngine = isValidEngine(engine) ? engine : 'tesseract';
      return OCRCacheDAO.clear(docId, pageNum, selectedEngine);
    } catch (error) {
      console.error('db:clear-ocr error:', error);
      return false;
    }
  });

  ipcMain.handle('db:clear-document-cache', async (_, docId) => {
    if (!isValidNumber(docId)) {
      throw new Error('Invalid input: docId must be a positive number');
    }

    try {
      return DocumentDAO.clearDocumentCache(docId);
    } catch (error) {
      console.error('db:clear-document-cache error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-latest-ocr', async (_, { docId }) => {
    if (!isValidNumber(docId)) {
      throw new Error('Invalid input: docId must be a positive number');
    }

    try {
      return OCRCacheDAO.getLatestForDocument(docId);
    } catch (error) {
      console.error('db:get-latest-ocr error:', error);
      return null;
    }
  });

  ipcMain.handle('db:get-ocr-cache-stats-for-document-ids', async (_, payload: { documentIds?: unknown }) => {
    const raw = payload?.documentIds;
    if (!Array.isArray(raw) || raw.length === 0) {
      return [];
    }

    const ids = raw
      .map((id) => (typeof id === 'number' ? id : Number(id)))
      .filter((id) => Number.isFinite(id) && id > 0)
      .slice(0, MAX_OCR_CACHE_STATS_DOC_IDS);

    if (ids.length === 0) {
      return [];
    }

    try {
      return OCRCacheDAO.getAggregatedCacheStatsByDocumentIds(ids);
    } catch (error) {
      console.error('db:get-ocr-cache-stats-for-document-ids error:', error);
      return [];
    }
  });

  // Benchmark handlers
  ipcMain.handle('db:save-benchmark', async (_, { docId, pageNum, mode, key, payload }: { docId: number; pageNum: number; mode?: 'baseline' | 'improve'; key: string; payload: string }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum) || !isValidString(key) || !isValidString(payload)) {
      throw new Error('Invalid benchmark save input');
    }
    const resolvedMode = mode && (mode === 'baseline' || mode === 'improve')
      ? mode
      : (key.startsWith('improve:') ? 'improve' : 'baseline');

    try {
      return BenchmarkDAO.save(docId, pageNum, resolvedMode, key, payload);
    } catch (error) {
      console.error('db:save-benchmark error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-benchmark', async (_, { docId, pageNum, mode, key }: { docId: number; pageNum: number; mode?: 'baseline' | 'improve'; key: string }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum) || !isValidString(key)) {
      throw new Error('Invalid benchmark get input');
    }
    const resolvedMode = mode && (mode === 'baseline' || mode === 'improve')
      ? mode
      : (key.startsWith('improve:') ? 'improve' : 'baseline');

    try {
      return BenchmarkDAO.get(docId, pageNum, resolvedMode, key);
    } catch (error) {
      console.error('db:get-benchmark error:', error);
      return null;
    }
  });

  ipcMain.handle('db:clear-benchmark', async (_, { docId, pageNum, mode, key }: { docId: number; pageNum: number; mode?: 'baseline' | 'improve'; key?: string }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid benchmark clear input');
    }
    const resolvedMode = mode && (mode === 'baseline' || mode === 'improve')
      ? mode
      : (key?.startsWith('improve:') ? 'improve' : (key?.startsWith('baseline:') ? 'baseline' : undefined));

    try {
      return BenchmarkDAO.clear(docId, pageNum, resolvedMode, key);
    } catch (error) {
      console.error('db:clear-benchmark error:', error);
      return false;
    }
  });

  ipcMain.handle('db:list-benchmarks', async (_, { docId, pageNum, mode }: { docId: number; pageNum: number; mode?: 'baseline' | 'improve' }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid benchmark list input');
    }
    try {
      return BenchmarkDAO.list(docId, pageNum, mode);
    } catch (error) {
      console.error('db:list-benchmarks error:', error);
      return [];
    }
  });

  ipcMain.handle('db:save-translation-cache', async (_, { docId, pageNum, cacheKey, entry }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }
    if (!isValidString(cacheKey) || !entry || typeof entry !== 'object') {
      throw new Error('Invalid input: cacheKey and entry are required');
    }

    try {
      TranslationCacheDAO.save(docId, pageNum, cacheKey, entry as {
        key: string;
        pageNum: number;
        ocrEngine: string;
        ocrLanguage: string;
        sourceLanguage: string;
        targetLanguage: string;
        translationMode: string;
        translatorEngine: string;
        sourceFingerprint: string;
        translatedByIndex: Array<{ index: number; text: string }>;
        translatedText: string;
        lineCount: number;
        groupCount: number;
        createdAt: number;
      });
      return true;
    } catch (error) {
      console.error('db:save-translation-cache error:', error);
      return false;
    }
  });

  ipcMain.handle('db:save-ocr-batch', async (_, items) => {
    if (!Array.isArray(items) || items.length === 0) return true;
    try {
      OCRCacheDAO.saveBatch(items);
      return true;
    } catch (error) {
      console.error('db:save-ocr-batch error:', error);
      return false;
    }
  });

  ipcMain.handle('db:save-translation-cache-batch', async (_, items) => {
    if (!Array.isArray(items) || items.length === 0) return true;
    try {
      TranslationCacheDAO.saveBatch(items);
      return true;
    } catch (error) {
      console.error('db:save-translation-cache-batch error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-translation-cache-page', async (_, { docId, pageNum }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      return TranslationCacheDAO.getByPage(docId, pageNum);
    } catch (error) {
      console.error('db:get-translation-cache-page error:', error);
      return [];
    }
  });

  ipcMain.handle('db:clear-translation-cache-by-engine', async (_, { docId, pageNum, engine }) => {
    if (!isValidNumber(docId) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: docId and pageNum must be positive numbers');
    }

    try {
      const selectedEngine = isValidEngine(engine) ? engine : 'tesseract';
      return TranslationCacheDAO.clearByEngine(docId, pageNum, selectedEngine);
    } catch (error) {
      console.error('db:clear-translation-cache-by-engine error:', error);
      return false;
    }
  });

  ipcMain.handle('db:save-sentence-translation', async (_, { sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode, translatedText }) => {
    if (!isValidString(sourceText) || !isValidString(sourceLanguage) || !isValidString(targetLanguage) || !isValidString(translatorEngine) || !isValidString(translationMode) || !isValidString(translatedText)) {
      throw new Error('Invalid input: all arguments must be non-empty strings');
    }
    try {
      return SentenceTranslationDAO.save(sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode, translatedText);
    } catch (error) {
      console.error('db:save-sentence-translation error:', error);
      return false;
    }
  });

  ipcMain.handle('db:save-sentence-translation-batch', async (_, { items }) => {
    if (!Array.isArray(items)) {
      throw new Error('Invalid input: items must be an array');
    }
    try {
      return SentenceTranslationDAO.saveBatch(items);
    } catch (error) {
      console.error('db:save-sentence-translation-batch error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-sentence-translation', async (_, { sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode }) => {
    if (!isValidString(sourceText) || !isValidString(sourceLanguage) || !isValidString(targetLanguage) || !isValidString(translatorEngine) || !isValidString(translationMode)) {
      throw new Error('Invalid input: all arguments must be non-empty strings');
    }
    try {
      return SentenceTranslationDAO.get(sourceText, sourceLanguage, targetLanguage, translatorEngine, translationMode);
    } catch (error) {
      console.error('db:get-sentence-translation error:', error);
      return null;
    }
  });

  ipcMain.handle('db:get-sentence-translation-batch', async (_, { sourceTexts, sourceLanguage, targetLanguage, translatorEngine, translationMode }) => {
    if (!Array.isArray(sourceTexts) || !isValidString(sourceLanguage) || !isValidString(targetLanguage) || !isValidString(translatorEngine) || !isValidString(translationMode)) {
      throw new Error('Invalid input: sourceTexts must be an array, other arguments must be non-empty strings');
    }
    try {
      return SentenceTranslationDAO.getBatch(sourceTexts, sourceLanguage, targetLanguage, translatorEngine, translationMode);
    } catch (error) {
      console.error('db:get-sentence-translation-batch error:', error);
      return {};
    }
  });

  // ============================================
  // Document Management IPC Handlers
  // ============================================

  // 🚀 Startup optimization: batch load all needed data in 1 round-trip
  ipcMain.handle('db:startup-load', async () => {
    try {
      return DocumentDAO.getStartupBatch();
    } catch (error) {
      console.error('db:startup-load error:', error);
      return { recentDocuments: [], allTags: [], allProjects: [], latestOcrDocId: null };
    }
  });

  ipcMain.handle('db:get-recent-documents', async (_, limit = 50) => {
    try {
      return DocumentDAO.getRecent(limit);
    } catch (error) {
      console.error('db:get-recent-documents error:', error);
      return [];
    }
  });

  ipcMain.handle('db:get-documents-by-project', async (_, projectId) => {
    try {
      return DocumentDAO.getByProject(projectId);
    } catch (error) {
      console.error('db:get-documents-by-project error:', error);
      return [];
    }
  });

  ipcMain.handle('db:get-favorite-documents', async () => {
    try {
      return DocumentDAO.getFavorites();
    } catch (error) {
      console.error('db:get-favorite-documents error:', error);
      return [];
    }
  });

  ipcMain.handle('db:search-documents', async (_, query) => {
    if (!isValidString(query)) {
      return [];
    }
    try {
      return DocumentDAO.search(query);
    } catch (error) {
      console.error('db:search-documents error:', error);
      return [];
    }
  });

  ipcMain.handle('db:update-document', async (_, { id, updates }) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return DocumentDAO.update(id, updates);
    } catch (error) {
      console.error('db:update-document error:', error);
      return false;
    }
  });

  ipcMain.handle('db:delete-document', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return DocumentDAO.delete(id);
    } catch (error) {
      console.error('db:delete-document error:', error);
      return false;
    }
  });

  ipcMain.handle('db:toggle-favorite', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return DocumentDAO.toggleFavorite(id);
    } catch (error) {
      console.error('db:toggle-favorite error:', error);
      return false;
    }
  });

  ipcMain.handle('db:toggle-thumbnail-hidden', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return DocumentDAO.toggleThumbnailHidden(id);
    } catch (error) {
      console.error('db:toggle-thumbnail-hidden error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-document-cache-size', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return DocumentDAO.getDocumentCacheSize(id);
    } catch (error) {
      console.error('db:get-document-cache-size error:', error);
      return 0;
    }
  });

  ipcMain.handle('db:get-documents-by-tag', async (_, tagId) => {
    if (!isValidNumber(tagId)) {
      throw new Error('Invalid input: tagId must be a positive number');
    }
    try {
      return DocumentDAO.getByTag(tagId);
    } catch (error) {
      console.error('db:get-documents-by-tag error:', error);
      return [];
    }
  });

  ipcMain.handle('db:add-document-tag', async (_, { documentId, tagId }) => {
    if (!isValidNumber(documentId) || !isValidNumber(tagId)) {
      throw new Error('Invalid input: documentId and tagId must be positive numbers');
    }
    try {
      return DocumentDAO.addTag(documentId, tagId);
    } catch (error) {
      console.error('db:add-document-tag error:', error);
      return false;
    }
  });

  ipcMain.handle('db:remove-document-tag', async (_, { documentId, tagId }) => {
    if (!isValidNumber(documentId) || !isValidNumber(tagId)) {
      throw new Error('Invalid input: documentId and tagId must be positive numbers');
    }
    try {
      return DocumentDAO.removeTag(documentId, tagId);
    } catch (error) {
      console.error('db:remove-document-tag error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-document-tags', async (_, documentId) => {
    if (!isValidNumber(documentId)) {
      throw new Error('Invalid input: documentId must be a positive number');
    }
    try {
      return DocumentDAO.getTags(documentId);
    } catch (error) {
      console.error('db:get-document-tags error:', error);
      return [];
    }
  });

  ipcMain.handle('db:touch-document', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      DocumentDAO.touch(id);
      return true;
    } catch (error) {
      console.error('db:touch-document error:', error);
      return false;
    }
  });

  ipcMain.handle('db:update-last-page', async (_, { id, pageNum }) => {
    if (!isValidNumber(id) || !isValidNumber(pageNum)) {
      throw new Error('Invalid input: id and pageNum must be positive numbers');
    }
    try {
      return DocumentDAO.updateLastPage(id, pageNum);
    } catch (error) {
      console.error('db:update-last-page error:', error);
      return false;
    }
  });

  // ============================================
  // Tag Management IPC Handlers
  // ============================================
  ipcMain.handle('db:get-all-tags', async () => {
    try {
      return TagDAO.getAll();
    } catch (error) {
      console.error('db:get-all-tags error:', error);
      return [];
    }
  });

  ipcMain.handle('db:create-tag', async (_, { name, color }) => {
    if (!isValidString(name)) {
      throw new Error('Invalid input: name must be a non-empty string');
    }
    try {
      return TagDAO.create(name, color);
    } catch (error) {
      console.error('db:create-tag error:', error);
      return null;
    }
  });

  ipcMain.handle('db:update-tag', async (_, { id, updates }) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return TagDAO.update(id, updates);
    } catch (error) {
      console.error('db:update-tag error:', error);
      return false;
    }
  });

  ipcMain.handle('db:delete-tag', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return TagDAO.delete(id);
    } catch (error) {
      console.error('db:delete-tag error:', error);
      return false;
    }
  });

  // ============================================
  // Project Management IPC Handlers
  // ============================================
  ipcMain.handle('db:get-all-projects', async () => {
    try {
      return ProjectDAO.getAll();
    } catch (error) {
      console.error('db:get-all-projects error:', error);
      return [];
    }
  });

  ipcMain.handle('db:get-project-children', async (_, parentId) => {
    try {
      return ProjectDAO.getChildren(parentId);
    } catch (error) {
      console.error('db:get-project-children error:', error);
      return [];
    }
  });

  ipcMain.handle('db:create-project', async (_, project) => {
    if (!isValidString(project?.name)) {
      throw new Error('Invalid input: name must be a non-empty string');
    }
    try {
      return ProjectDAO.create(project);
    } catch (error) {
      console.error('db:create-project error:', error);
      return null;
    }
  });

  ipcMain.handle('db:update-project', async (_, { id, updates }) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return ProjectDAO.update(id, updates);
    } catch (error) {
      console.error('db:update-project error:', error);
      return false;
    }
  });

  ipcMain.handle('db:delete-project', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return ProjectDAO.delete(id);
    } catch (error) {
      console.error('db:delete-project error:', error);
      return false;
    }
  });

  ipcMain.handle('db:get-project-stats', async (_, projectId: number) => {
    if (!isValidNumber(projectId)) {
      throw new Error('Invalid input: projectId must be a positive number');
    }
    try {
      return ProjectDAO.getProjectStats(projectId);
    } catch (error) {
      console.error('db:get-project-stats error:', error);
      return null;
    }
  });

  // ============================================
  // Glossary Management IPC Handlers
  // ============================================
  ipcMain.handle('db:glossary-get-all', async () => {
    try {
      return GlossaryDAO.getAll();
    } catch (error) {
      console.error('db:glossary-get-all error:', error);
      return [];
    }
  });

  ipcMain.handle('db:glossary-save', async (_, entry) => {
    if (!entry || typeof entry !== 'object' || !isValidString(entry.sourceText) || !isValidString(entry.targetText)) {
      throw new Error('Invalid input: sourceText and targetText must be non-empty strings');
    }
    try {
      return GlossaryDAO.upsert(entry);
    } catch (error) {
      console.error('db:glossary-save error:', error);
      return null;
    }
  });

  ipcMain.handle('db:glossary-delete', async (_, id) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return GlossaryDAO.delete(id);
    } catch (error) {
      console.error('db:glossary-delete error:', error);
      return false;
    }
  });

  ipcMain.handle('db:glossary-toggle', async (_, { id, isActive }) => {
    if (!isValidNumber(id)) {
      throw new Error('Invalid input: id must be a positive number');
    }
    try {
      return GlossaryDAO.toggle(id, typeof isActive === 'boolean' ? isActive : undefined);
    } catch (error) {
      console.error('db:glossary-toggle error:', error);
      return false;
    }
  });

  ipcMain.handle('db:glossary-import', async (_, entries) => {
    if (!Array.isArray(entries)) {
      throw new Error('Invalid input: entries must be an array');
    }
    try {
      return GlossaryDAO.importBatch(entries);
    } catch (error) {
      console.error('db:glossary-import error:', error);
      return { inserted: 0, updated: 0 };
    }
  });
}
