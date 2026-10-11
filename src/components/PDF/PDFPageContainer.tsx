import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Page } from 'react-pdf';
import type { PDFPageProxy } from 'pdfjs-dist';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import {
  useOCRTextLayerStore,
  OCRTranslationCacheEntry,
  hasCurrentOCRTranslationCacheVersion,
} from '../../stores/useOCRTextLayerStore';
import { dbService } from '../../services/dbService';
import { OCR_ALGORITHM_VERSION, OCR_RAW_VERSION } from '../../services/vision/ocrVersion';
import type { OCREngine } from '../../types';
import { PDFPageOverlay } from './PDFPageOverlay';
import {
  normalizeTranslatedLineItem,
  type RawTranslatedInput,
  type TranslatedLineEntry,
} from './translationLineNormalizer';

export {
  normalizeTranslatedLineItem,
  type RawTranslatedInput,
  type TranslatedLineEntry,
};

export interface PDFPageLoadedEvent {
  width: number;
  height: number;
  originalWidth?: number;
  originalHeight?: number;
  [key: string]: unknown;
}

export interface PDFPageContainerProps {
  pageNum: number;
  onPageLoadSuccess?: (page: PDFPageLoadedEvent) => void;
  onPageRenderSuccess?: () => void;
  previewModeOverride?: 'original' | 'translated';
}

export const PDFPageContainer = React.memo<PDFPageContainerProps>(({
  pageNum,
  onPageLoadSuccess: externalOnLoadSuccess,
  onPageRenderSuccess: externalOnRenderSuccess,
  previewModeOverride,
}) => {
  const viewMode = useProjectStore((s) => s.viewMode);
  const setPage = useProjectStore((s) => s.setPage);
  const documentId = useProjectStore((s) => s.documentId);
  const fileUrl = useProjectStore((s) => s.fileUrl);

  // Fine-grained selector: only re-render this page when entering/leaving the active ±2 page buffer window
  const isNearCurrentPage = useProjectStore(
    useCallback((s) => s.viewMode === 'single' || Math.abs(s.currentPage - pageNum) <= 2, [pageNum])
  );

  // Fine-grained selector: only re-render if active engine changes
  const activeEngine = useOCRTextLayerStore((s) => (s.options.engine || 'paddleocr') as OCREngine);

  const [pageRenderTick, setPageRenderTick] = useState(0);
  const [isCacheLoading, setIsCacheLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(viewMode === 'single');
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  // Windowing Buffer: Keep canvas in DOM only when visible within 1400px margin or within ±2 pages of current view
  const shouldRenderCanvas = isVisible || isNearCurrentPage;

  useEffect(() => {
    if (viewMode === 'single') {
      setIsVisible(true);
      return;
    }

    const preloadObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting);
        });
      },
      {
        rootMargin: '1400px 0px 1400px 0px',
      }
    );

    if (pageRef.current) {
      preloadObserver.observe(pageRef.current);
    }

    return () => {
      preloadObserver.disconnect();
    };
  }, [viewMode]);

  // Background load OCR and translation cache from IndexedDB/SQLite for this page when it mounts
  useEffect(() => {
    if (!documentId) return;
    if (!isVisible) return; // Only load cache if page is visible or preloading

    const ocrState = useOCRTextLayerStore.getState();
    const hasOcr = ocrState.ocrByPageEngine.get(pageNum)?.has(activeEngine);
    const hasTranslation = ocrState.translationCacheByPage.has(pageNum);
    if (hasOcr && hasTranslation) return;

    let canceled = false;

    const loadCache = async () => {
      // 1. Load OCR cache if not in memory
      const hasOcr = ocrState.ocrByPageEngine.get(pageNum)?.has(activeEngine);
      const hasTranslation = ocrState.translationCacheByPage.has(pageNum);

      let startedLoading = false;
      if (!hasOcr || !hasTranslation) {
        setIsCacheLoading(true);
        startedLoading = true;
      }

      try {
        const ocrPromise = !hasOcr
          ? dbService.getOCR(documentId, pageNum, activeEngine).catch((err) => {
              console.warn(`[PDFPageContainer] Failed to load OCR cache for page ${pageNum}:`, err);
              return null;
            })
          : Promise.resolve(null);

        const transPromise = !hasTranslation
          ? dbService.getTranslationCachePage(documentId, pageNum).catch((err) => {
              console.warn(`[PDFPageContainer] Failed to load translation cache for page ${pageNum}:`, err);
              return null;
            })
          : Promise.resolve(null);

        const [cached, rows] = await Promise.all([ocrPromise, transPromise]);

        if (cached && !canceled) {
          if (cached.algorithmVersion === OCR_ALGORITHM_VERSION && (cached.ocrRawVersion ?? 0) >= OCR_RAW_VERSION) {
            cached.pageNumber = pageNum;
            ocrState.setPageOCRForEngine(pageNum, activeEngine, cached);
            console.log(`[PDFPageContainer] Background loaded OCR cache for page ${pageNum} engine=${activeEngine}`);
          } else {
            console.log(`[PDFPageContainer] Background OCR cache version mismatch for page ${pageNum}: expected algorithm v${OCR_ALGORITHM_VERSION} & raw v${OCR_RAW_VERSION}, got algorithm v${cached.algorithmVersion} & raw v${cached.ocrRawVersion ?? 0}`);
          }
        }

        // 2. Load Translation cache if not in memory
        if (Array.isArray(rows) && rows.length > 0 && !canceled) {
          console.log(`[PDFPageContainer] Background loaded translation cache for page ${pageNum} rows=${rows.length}`);
          let preferredKey: string | null = null;
          const sortedRows = [...rows].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

          for (const row of sortedRows) {
            if (row.key && !hasCurrentOCRTranslationCacheVersion(row.key)) {
              continue;
            }
            const normalizedEntry: OCRTranslationCacheEntry = {
              ...row,
              pageNum,
              ocrEngine: (row.ocrEngine || 'paddleocr') as OCREngine,
              translationMode: row.translationMode === 'official' ? 'official' : row.translationMode === 'adaptive' ? 'adaptive' : row.translationMode === 'manhwa' ? 'manhwa' : 'manga',
              translatorEngine: row.translatorEngine === 'ai' ? 'ai' : 'offline',
              translatedByIndex: Array.isArray(row.translatedByIndex)
                ? (row.translatedByIndex as RawTranslatedInput[]).map((item, idx) => normalizeTranslatedLineItem(item, idx))
                : [],
            };
            ocrState.setTranslationCacheEntry(pageNum, normalizedEntry.key, normalizedEntry);

            if (!preferredKey && row.key && row.key.includes(activeEngine)) {
              preferredKey = row.key;
            }
          }

          if (!preferredKey && sortedRows.length > 0 && sortedRows[0].key) {
            preferredKey = sortedRows[0].key;
          }

          if (preferredKey) {
            ocrState.setActiveTranslationCacheKey(pageNum, preferredKey);
          }
        }
      } finally {
        if (startedLoading && !canceled) {
          setIsCacheLoading(false);
        }
      }
    };

    // Fast cache loader: Load database cache quickly (40ms debounce) without 1000ms idle callback blocker
    const timer = setTimeout(() => {
      if (!canceled) void loadCache();
    }, 40);

    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [pageNum, documentId, activeEngine, fileUrl, isVisible]);

  const handlePageClick = useCallback(() => {
    if (useProjectStore.getState().currentPage !== pageNum) {
      setPage(pageNum, { source: 'scroll' });
    }
  }, [pageNum, setPage]);

  const onPageLoadSuccess = useCallback((page: PDFPageProxy) => {
    try {
      const viewport = page.getViewport({ scale: 1 });
      if (viewport.width > 0 && viewport.height > 0) {
        // Calculate proportional height based on fixed width of 800px
        const calculatedHeight = Math.round((viewport.height / viewport.width) * 800);
        setMeasuredHeight(calculatedHeight);
      }
    } catch {
      // Ignore calculation fallback
    }
    if (externalOnLoadSuccess) {
      externalOnLoadSuccess(page as unknown as PDFPageLoadedEvent);
    }
  }, [externalOnLoadSuccess]);

  const onPageRenderSuccess = useCallback(() => {
    setPageRenderTick((prev) => prev + 1);
    if (externalOnRenderSuccess) {
      externalOnRenderSuccess();
    }
  }, [externalOnRenderSuccess]);

  const targetHeight = measuredHeight || 1130;

  return (
    <div 
      ref={pageRef}
      onMouseDown={handlePageClick}
      data-page-container={pageNum}
      style={{ minHeight: targetHeight }}
      className="relative mb-4 group pdf-page-container"
    >
      {shouldRenderCanvas ? (
        <Page 
          pageNumber={pageNum} 
          renderTextLayer={false} 
          renderAnnotationLayer={false}
          className="border border-slate-700 bg-white"
          width={800}
          onLoadSuccess={onPageLoadSuccess}
          onRenderSuccess={onPageRenderSuccess}
          onRenderError={(err) => {
            console.warn(`[PDFCanvas] Page ${pageNum} render suppressed:`, err);
          }}
        />
      ) : (
        <div 
          className="border border-slate-700/60 bg-[#0d1117] flex flex-col items-center justify-center text-slate-500 select-none transition-opacity duration-200"
          style={{ width: 800, height: targetHeight }}
        >
          {measuredHeight ? (
            <div className="flex flex-col items-center justify-center opacity-40">
              <svg className="w-8 h-8 mb-1.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-xs font-mono">Page {pageNum}</span>
            </div>
          ) : (
            <>
              <div className="h-6 w-6 rounded-full border-2 border-slate-700 border-t-sky-400 animate-spin mb-2 opacity-40" />
              <span className="text-xs font-mono opacity-50">Page {pageNum}</span>
            </>
          )}
        </div>
      )}
      {isCacheLoading && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-700/50 text-xs text-slate-200 shadow-lg animate-pulse pointer-events-none select-none">
          <svg className="animate-spin h-3.5 w-3.5 text-sky-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="font-medium tracking-wide">กำลังโหลดแคช...</span>
        </div>
      )}
      {isVisible && shouldRenderCanvas && (
        <div className="absolute inset-0 pointer-events-none">
          <PDFPageOverlay
            pageNum={pageNum}
            pageRef={pageRef}
            pageRenderTick={pageRenderTick}
            isVisible={isVisible}
            previewModeOverride={previewModeOverride}
          />
        </div>
      )}
    </div>
  );
});

PDFPageContainer.displayName = 'PDFPageContainer';
