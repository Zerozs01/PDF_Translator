import { useCallback } from 'react';
import type { OCREngine, OCROptions } from '../types';
import type { ProcessingProgress } from '../services/pdf';
import type { TranslationMode } from '../stores/useProjectStore';
import type { DownloadScope } from '../constants/translationConstants';

export interface UseDocumentExportModalStateParams {
  downloadScopeSelection: DownloadScope;
  fileType: string | null;
  selectedExportEngine: OCREngine | null;
  ocrOptions: OCROptions;
  totalPages: number;
  currentPage: number;
  resolveModelScopedPagesForExport: (scope: DownloadScope, engineId: OCREngine) => Array<{ pageNum: number; ocr: any }>;
  resolveTranslatedEntryForExport: (pageNum: number, ocr: any, engineId: OCREngine) => any;
  ocrProgress: ProcessingProgress | null;
  isOfflineProcessing: boolean;
  isAiProcessing: boolean;
  translationStartTime: number | null;
  applyPopupOcrQualityProfile: () => void;
  hydrateExportCachesForDownload: (engine: OCREngine) => Promise<void>;
  setExportCacheHydrationTick: React.Dispatch<React.SetStateAction<number>>;
  setTranslationStatus: (status: { kind: 'info' | 'success' | 'error'; message: string } | null) => void;
  setIsOfflineProcessing: (processing: boolean) => void;
  setIsAiProcessing: (processing: boolean) => void;
  setProgress: (progress: any) => void;
  runCurrentPageTranslation: (engine: 'offline' | 'ai', pageNum: number, options?: any) => Promise<boolean>;
  sourceLanguage: string;
  targetLanguage: string;
  translationMode: TranslationMode;
}

export function useDocumentExportModalState({
  downloadScopeSelection,
  fileType,
  selectedExportEngine,
  ocrOptions,
  totalPages,
  currentPage,
  resolveModelScopedPagesForExport,
  resolveTranslatedEntryForExport,
  ocrProgress,
  isOfflineProcessing,
  isAiProcessing,
  translationStartTime,
  applyPopupOcrQualityProfile,
  hydrateExportCachesForDownload,
  setExportCacheHydrationTick,
  setTranslationStatus,
  setIsOfflineProcessing,
  setIsAiProcessing,
  setProgress,
  runCurrentPageTranslation,
  sourceLanguage,
  targetLanguage,
  translationMode,
}: UseDocumentExportModalStateParams) {
  const effectiveDownloadScope: DownloadScope = downloadScopeSelection === 'all' && fileType === 'pdf'
    ? 'all'
    : 'current';
  const selectedDownloadEngine = selectedExportEngine || (ocrOptions.engine || 'paddleocr') as OCREngine;
  const downloadScopedPages = resolveModelScopedPagesForExport(effectiveDownloadScope, selectedDownloadEngine);
  const downloadScopePageNumbers = effectiveDownloadScope === 'all' && fileType === 'pdf'
    ? Array.from({ length: Math.max(1, totalPages) }, (_, index) => index + 1)
    : [currentPage];

  const getEngineCacheStatus = useCallback((engineId: OCREngine) => {
    const pages = resolveModelScopedPagesForExport(effectiveDownloadScope, engineId);
    const totalInScope = downloadScopePageNumbers.length;
    const ocrCount = pages.length;
    const transCount = pages.filter(({ pageNum, ocr }) => 
      Boolean(resolveTranslatedEntryForExport(pageNum, ocr, engineId))
    ).length;

    if (ocrCount === 0) {
      return { status: 'no_cache', text: 'ไม่มีแคช', ocrCount, transCount };
    }
    if (transCount === totalInScope) {
      return { status: 'ready', text: 'คำแปลพร้อม', ocrCount, transCount };
    }
    if (transCount > 0) {
      return { status: 'partial_trans', text: `แปลแล้ว (${transCount}/${totalInScope})`, ocrCount, transCount };
    }
    if (ocrCount === totalInScope) {
      return { status: 'ocr_only', text: 'เฉพาะต้นฉบับ OCR', ocrCount, transCount };
    }
    return { status: 'partial_ocr', text: `OCR แล้ว (${ocrCount}/${totalInScope})`, ocrCount, transCount };
  }, [effectiveDownloadScope, downloadScopePageNumbers.length, resolveModelScopedPagesForExport, resolveTranslatedEntryForExport]);

  const ocrCoveredPageNumbers = downloadScopedPages
    .map((item) => item.pageNum)
    .sort((a, b) => a - b);
  const ocrCoveredPageSet = new Set(ocrCoveredPageNumbers);
  const missingOcrPageNumbers = downloadScopePageNumbers.filter((pageNum) => !ocrCoveredPageSet.has(pageNum));
  const translatedAvailablePageNumbers = downloadScopedPages
    .filter(({ pageNum, ocr }) => Boolean(resolveTranslatedEntryForExport(pageNum, ocr, selectedDownloadEngine)))
    .map((item) => item.pageNum)
    .sort((a, b) => a - b);
  const translatedAvailablePageSet = new Set(translatedAvailablePageNumbers);
  const missingTranslatedPageNumbers = ocrCoveredPageNumbers
    .filter((pageNum) => !translatedAvailablePageSet.has(pageNum));
  const canExportOriginalSelection = downloadScopedPages.length > 0;
  const canExportTranslatedSelection = translatedAvailablePageNumbers.length > 0;

  const computedProgressPercent = (() => {
    if (!ocrProgress) return 0;
    if (isOfflineProcessing || isAiProcessing) {
      return ocrProgress.progress;
    }
    return ocrProgress.progress;
  })();

  const getRemainingSecondsText = useCallback(() => {
    if (!translationStartTime || !ocrProgress) return 'กำลังประเมินเวลา...';
    const percent = ocrProgress.progress;

    if (percent <= 0) return 'กำลังประเมินเวลา...';
    
    const elapsedSec = (Date.now() - translationStartTime) / 1000;
    if (percent > 5) {
      const totalSec = elapsedSec * (100 / percent);
      const remainingSec = Math.max(1, Math.round(totalSec - elapsedSec));
      return `อีกประมาณ ${remainingSec} วินาที`;
    } else {
      const pagesLeft = Math.max(1, ocrProgress.totalPages - ocrProgress.currentPage);
      const estSecPerPage = isAiProcessing ? 12 : 4;
      const remainingSec = pagesLeft * estSecPerPage;
      return `อีกประมาณ ${remainingSec} วินาที`;
    }
  }, [translationStartTime, ocrProgress, isAiProcessing]);

  const runExportPopupBatchTranslation = useCallback(async (translatorEngine: 'offline' | 'ai') => {
    if (isAiProcessing || isOfflineProcessing) return;

    applyPopupOcrQualityProfile();
    const exportEngine = selectedDownloadEngine;
    await hydrateExportCachesForDownload(exportEngine);
    setExportCacheHydrationTick((tick) => tick + 1);

    const scopedPages = resolveModelScopedPagesForExport(effectiveDownloadScope, exportEngine);
    if (scopedPages.length === 0) {
      setTranslationStatus({
        kind: 'error',
        message: `ไม่พบ OCR cache ของโมเดล ${exportEngine} สำหรับขอบเขตที่เลือก กรุณารัน OCR ก่อน`,
      });
      return;
    }

    const pageNums = scopedPages.map(({ pageNum }) => pageNum);
    if (translatorEngine === 'offline') {
      setIsOfflineProcessing(true);
    } else {
      setIsAiProcessing(true);
    }

    setProgress({
      stage: 'text-layer',
      currentPage: 1,
      totalPages: pageNums.length,
      message: `กำลังแปล ${pageNums.length} หน้า (${exportEngine})...`,
      progress: 5,
    });

    let translatedPages = 0;
    let skippedPages = 0;

    try {
      for (let index = 0; index < pageNums.length; index += 1) {
        const pageNum = pageNums[index];
        setProgress({
          stage: 'text-layer',
          currentPage: index + 1,
          totalPages: pageNums.length,
          message: `กำลังแปลหน้า ${pageNum} (${index + 1}/${pageNums.length})...`,
          progress: Math.round(((index + 0.5) / pageNums.length) * 100),
        });

        const translated = await runCurrentPageTranslation(translatorEngine, pageNum, {
          suppressStatus: true,
          engineOverride: exportEngine,
          ocrLanguage: ocrOptions.language,
          sourceLanguage,
          targetLanguage,
          translationMode,
        });
        if (translated) {
          translatedPages += 1;
        } else {
          skippedPages += 1;
        }
      }

      setProgress({
        stage: 'complete',
        currentPage: pageNums.length,
        totalPages: pageNums.length,
        message: 'แปลภาษาเสร็จสมบูรณ์!',
        progress: 100,
      });
      setExportCacheHydrationTick((tick) => tick + 1);

      const notes = skippedPages > 0 ? ` (ข้าม ${skippedPages} หน้า)` : '';
      setTranslationStatus({
        kind: translatedPages > 0 ? 'success' : 'error',
        message: translatedPages > 0
          ? `แปล ${translatedPages}/${pageNums.length} หน้า ด้วย ${exportEngine} เรียบร้อย${notes}`
          : `ไม่สามารถแปลหน้าใดได้สำหรับโมเดล ${exportEngine}`,
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (err) {
      console.error('[ExportPopupBatchTranslation] Failed', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTranslationStatus({
        kind: 'error',
        message: `การแปลล้มเหลว: ${message}`,
      });
    } finally {
      setIsOfflineProcessing(false);
      setIsAiProcessing(false);
    }
  }, [
    isAiProcessing,
    isOfflineProcessing,
    applyPopupOcrQualityProfile,
    selectedDownloadEngine,
    hydrateExportCachesForDownload,
    setExportCacheHydrationTick,
    resolveModelScopedPagesForExport,
    effectiveDownloadScope,
    setTranslationStatus,
    setIsOfflineProcessing,
    setIsAiProcessing,
    setProgress,
    runCurrentPageTranslation,
    ocrOptions.language,
    sourceLanguage,
    targetLanguage,
    translationMode,
  ]);

  const triggerPopupTranslation = useCallback((engine: 'offline' | 'ai') => {
    void runExportPopupBatchTranslation(engine);
  }, [runExportPopupBatchTranslation]);

  return {
    effectiveDownloadScope,
    selectedDownloadEngine,
    getEngineCacheStatus,
    ocrCoveredPageNumbers,
    missingOcrPageNumbers,
    translatedAvailablePageNumbers,
    missingTranslatedPageNumbers,
    canExportOriginalSelection,
    canExportTranslatedSelection,
    computedProgressPercent,
    getRemainingSecondsText,
    triggerPopupTranslation,
  };
}
