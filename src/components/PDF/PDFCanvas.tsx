import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Document, Page } from 'react-pdf';
import '../../services/pdf/pdfjsWorker';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useSegmentationStore } from '../../stores/useSegmentationStore';
import { useOCRTextLayerStore, OCRTranslationCacheEntry, hasCurrentOCRTranslationCacheVersion } from '../../stores/useOCRTextLayerStore';
import { dbService } from '../../services/dbService';
import { OCR_ALGORITHM_VERSION, OCR_RAW_VERSION } from '../../services/vision/ocrVersion';
import { OCREngine } from '../../types';
import { useLayerStore } from '../../stores/useLayerStore';
import { visionService } from '../../services/vision/VisionService';
import { lookupShortPhraseTh } from '../../services/translation/offlineTranslationService';
import { useCanvasNavigation } from './hooks/useCanvasNavigation';
import { PDFPageOverlay } from './PDFPageOverlay';


interface PDFCanvasNavigationState {
  isUserInteracting: boolean;
  userInteractionTimer: ReturnType<typeof setTimeout> | null;
  activePageChangeTimeout: ReturnType<typeof setTimeout> | null;
  lastPageUpdateTime: number;
  pendingPage: number;
  isObserverTriggeredPageChange: boolean;
}

const PDFCanvasNavigationContext = React.createContext<{
  navigationStateRef: React.MutableRefObject<PDFCanvasNavigationState>;
  isProgrammaticScrollRef: React.MutableRefObject<boolean>;
} | null>(null);

const PDFPageContainer = React.memo<{
  pageNum: number;
  onPageLoadSuccess?: (page: any) => void;
  onPageRenderSuccess?: () => void;
  previewModeOverride?: 'original' | 'translated';
}>(({ pageNum, onPageLoadSuccess: externalOnLoadSuccess, onPageRenderSuccess: externalOnRenderSuccess, previewModeOverride }) => {
  const navContext = React.useContext(PDFCanvasNavigationContext);
  const viewMode = useProjectStore((s) => s.viewMode);
  const setPage = useProjectStore((s) => s.setPage);
  const documentId = useProjectStore((s) => s.documentId);
  const fileUrl = useProjectStore((s) => s.fileUrl);

  const options = useOCRTextLayerStore((s) => s.options);

  const [pageRenderTick, setPageRenderTick] = useState(0);
  const [isCacheLoading, setIsCacheLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(viewMode === 'single');
  const [hasBeenVisible, setHasBeenVisible] = useState(viewMode === 'single');
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible) {
      setHasBeenVisible(true);
    }
  }, [isVisible]);

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

    const activePageObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const navState = navContext?.navigationStateRef.current;
          const isProgScroll = navContext?.isProgrammaticScrollRef.current;
          if (
            entry.isIntersecting &&
            !isProgScroll &&
            navState?.isUserInteracting &&
            previewModeOverride !== 'translated' &&
            useProjectStore.getState().currentPage !== pageNum
          ) {
            const now = performance.now();
            navState.pendingPage = pageNum;
            navState.lastPageUpdateTime = now;
            const capturedTime = now;

            if (navState.activePageChangeTimeout) {
              clearTimeout(navState.activePageChangeTimeout);
            }
            navState.activePageChangeTimeout = setTimeout(() => {
              React.startTransition(() => {
                if (capturedTime < navState.lastPageUpdateTime) return;
                if (navContext?.isProgrammaticScrollRef.current) return;
                navState.isObserverTriggeredPageChange = true;
                setPage(navState.pendingPage);
              });
              navState.activePageChangeTimeout = null;
            }, 250);
          }
        });
      },
      {
        threshold: 0,
        rootMargin: '-45% 0px -45% 0px',
      }
    );

    if (pageRef.current) {
      preloadObserver.observe(pageRef.current);
      activePageObserver.observe(pageRef.current);
    }

    return () => {
      preloadObserver.disconnect();
      activePageObserver.disconnect();
    };
  }, [pageNum, viewMode, navContext, previewModeOverride, setPage]);

  // Background load OCR and translation cache from IndexedDB/SQLite for this page when it mounts
  useEffect(() => {
    if (!documentId) return;
    if (!isVisible) return; // Only load cache if page is visible or preloading
    let canceled = false;
    const activeEngine = (options.engine || 'paddleocr') as OCREngine;
    const ocrState = useOCRTextLayerStore.getState();

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
              translatedByIndex: Array.isArray(row.translatedByIndex) ? row.translatedByIndex.map((item: any) => {
                if (item) {
                  const source = String(item.sourceText || '').trim();
                  const translated = String(item.text || '').trim();
                  const cleanSource = source.toUpperCase().replace(/[^A-Z0-9]/g, '');
                  const cleanTrans = translated.toUpperCase().replace(/[^A-Z0-9]/g, '');
                  if (!translated || cleanSource === cleanTrans || (/[a-zA-Z]/.test(translated) && !/[\u0E00-\u0E7F]/.test(translated))) {
                    const glossaryMatch = lookupShortPhraseTh(source) || lookupShortPhraseTh(cleanSource);
                    if (glossaryMatch) {
                      return { ...item, text: glossaryMatch };
                    }
                    const words = source.trim().split(/\s+/);
                    if (words.length > 1) {
                      const translatedWords = words.map(w => lookupShortPhraseTh(w) || lookupShortPhraseTh(w.replace(/[^A-Za-z0-9]/g, '')) || w);
                      if (translatedWords.some(tw => /[\u0E00-\u0E7F]/.test(tw))) {
                        return { ...item, text: translatedWords.join(' ') };
                      }
                    }
                  }
                }
                return item;
              }) : [],
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
  }, [pageNum, documentId, options.engine, fileUrl, isVisible]);

  const handlePageClick = useCallback(() => {
    if (useProjectStore.getState().currentPage !== pageNum) {
      setPage(pageNum);
    }
  }, [pageNum, setPage]);

  const onPageLoadSuccess = useCallback((page: any) => {
    if (externalOnLoadSuccess) {
      externalOnLoadSuccess(page);
    }
  }, [externalOnLoadSuccess]);

  const onPageRenderSuccess = useCallback(() => {
    setPageRenderTick((prev) => prev + 1);
    if (externalOnRenderSuccess) {
      externalOnRenderSuccess();
    }
  }, [externalOnRenderSuccess]);

  return (
    <div 
      ref={pageRef}
      onMouseDown={handlePageClick}
      data-page-container={pageNum}
      style={{ minHeight: pageRenderTick > 0 ? undefined : 1130 }}
      className="relative mb-4 group pdf-page-container"
    >
      {hasBeenVisible ? (
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
          className="border border-slate-700/60 bg-[#0d1117] flex flex-col items-center justify-center text-slate-500 select-none"
          style={{ width: 800, height: 1130 }}
        >
          <div className="h-8 w-8 rounded-full border-2 border-slate-700 border-t-sky-400 animate-spin mb-2 opacity-50" />
          <span className="text-xs font-mono opacity-60">Page {pageNum}</span>
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
      {isVisible && (
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

interface PDFCanvasProps {
  previewModeOverride?: 'original' | 'translated';
}

export const PDFCanvas: React.FC<PDFCanvasProps> = React.memo(({ previewModeOverride }) => {
  const fileUrl = useProjectStore((s) => s.fileUrl);
  const fileData = useProjectStore((s) => s.fileData);
  const currentPage = useProjectStore((s) => s.currentPage);
  const totalPages = useProjectStore((s) => s.totalPages);
  const setTotalPages = useProjectStore((s) => s.setTotalPages);
  const viewMode = useProjectStore((s) => s.viewMode);
  const setPage = useProjectStore((s) => s.setPage);

  const sourceLanguage = useProjectStore((s) => s.sourceLanguage);
  const activeTool = useUIStore((s) => s.activeTool);
  const setRegions = useSegmentationStore((s) => s.setRegions);
  const setIsProcessing = useSegmentationStore((s) => s.setIsProcessing);
  const processRequest = useSegmentationStore((s) => s.processRequest);

  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const navigationStateRef = useRef<PDFCanvasNavigationState>({
    isUserInteracting: false,
    userInteractionTimer: null,
    activePageChangeTimeout: null,
    lastPageUpdateTime: 0,
    pendingPage: 1,
    isObserverTriggeredPageChange: false,
  });

  const startUserInteraction = useCallback(() => {
    navigationStateRef.current.isUserInteracting = true;
    if (navigationStateRef.current.userInteractionTimer) {
      clearTimeout(navigationStateRef.current.userInteractionTimer);
      navigationStateRef.current.userInteractionTimer = null;
    }
  }, []);

  const endUserInteraction = useCallback((delay = 800) => {
    if (navigationStateRef.current.userInteractionTimer) {
      clearTimeout(navigationStateRef.current.userInteractionTimer);
    }
    navigationStateRef.current.userInteractionTimer = setTimeout(() => {
      navigationStateRef.current.isUserInteracting = false;
      navigationStateRef.current.userInteractionTimer = null;
    }, delay);
  }, []);

  const {
    zoom,
    pan,
    setZoom,
    setPan,
    isDragging,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    stateRef,
  } = useCanvasNavigation({
    containerRef,
    contentRef,
    activeTool,
    onInteractionStart: startUserInteraction,
    onInteractionEnd: endUserInteraction,
  });

  const prevPageRef = useRef<number | null>(null);
  const prevViewModeRef = useRef(viewMode);

  // Track programmatic scrolling to lock active page updates during animations & initial mount
  const isProgrammaticScrollRef = useRef(currentPage > 1);

  // Sync scroll position when switching to continuous viewMode or clicking LeftSidebar thumbnails or on initial load
  useEffect(() => {
    const pageChanged = prevPageRef.current !== null && currentPage !== prevPageRef.current;
    const viewModeChanged = viewMode !== prevViewModeRef.current;
    const isInitialMount = prevPageRef.current === null;
    const fromObserver = navigationStateRef.current.isObserverTriggeredPageChange;
    navigationStateRef.current.isObserverTriggeredPageChange = false;

    // Only snap or adjust pan if page was changed from sidebar/navigation/initial load (NOT from scroll observer)
    // Secondary split-view canvas (previewModeOverride === 'translated') must NOT dispatch pan updates to avoid fighting the primary canvas
    if (previewModeOverride === 'translated') {
      prevPageRef.current = currentPage;
      prevViewModeRef.current = viewMode;
      return;
    }

    if (viewMode === 'continuous' && (viewModeChanged || (isInitialMount && currentPage > 1) || (pageChanged && !fromObserver))) {
      // Set programmatic scroll lock to prevent IntersectionObservers on off-target pages
      // from firing setPage and overriding the target page before the scroll snap finishes.
      isProgrammaticScrollRef.current = true;
      if (navigationStateRef.current.activePageChangeTimeout) {
        clearTimeout(navigationStateRef.current.activePageChangeTimeout);
        navigationStateRef.current.activePageChangeTimeout = null;
      }

      const timer = setTimeout(() => {
        const pageElement = (
          containerRef.current?.querySelector(
            `.pdf-canvas-document [data-page-container="${currentPage}"]`
          ) || document.querySelector(
            `.pdf-canvas-document [data-page-container="${currentPage}"]`
          )
        ) as HTMLElement | null;

        if (containerRef.current) {
          const estimatedOffsetTop = (currentPage - 1) * 1146;
          const offsetTop = pageElement && pageElement.offsetTop > 0 ? pageElement.offsetTop : estimatedOffsetTop;
          const targetY = -(offsetTop * zoom) + 20;

          // Read the latest pan.y from the stateRef to check if the change was substantial
          const currentPanY = stateRef.current.pan.y;
          const diff = Math.abs(currentPanY - targetY);

          // Snap if the offset diff is substantial or if on initial load / mode switch / page navigation
          if (diff > 5 || viewModeChanged || isInitialMount || pageChanged) {
            const { clientWidth } = containerRef.current;
            const pageWidth = pageElement?.clientWidth || 800;
            const scaledWidth = pageWidth * zoom;
            const targetX = (clientWidth - scaledWidth) / 2;

            setPan(targetX, targetY);
          }
        }

        // Release the programmatic scroll lock after the transition animation
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 500);

      }, isInitialMount ? 150 : 80);

      prevPageRef.current = currentPage;
      prevViewModeRef.current = viewMode;
      return () => {
        clearTimeout(timer);
        isProgrammaticScrollRef.current = false;
      };
    }

    prevPageRef.current = currentPage;
    prevViewModeRef.current = viewMode;
  }, [currentPage, viewMode, zoom, setPan, stateRef]);

  // Real-time active page tracking for continuous scroll & split compare modes
  useEffect(() => {
    if (viewMode !== 'continuous' || previewModeOverride === 'translated') return;
    if (isProgrammaticScrollRef.current) return;
    if (!containerRef.current) return;

    const container = containerRef.current;
    const clientHeight = container.clientHeight || window.innerHeight;
    const currentZoom = Math.max(0.1, zoom);
    // Middle of the viewport in content coordinate space
    const viewportCenterY = (-pan.y + clientHeight / 2) / currentZoom;

    const pageNodes = container.querySelectorAll<HTMLElement>('.pdf-canvas-document [data-page-container]');
    if (!pageNodes.length) return;

    let targetPage = currentPage;
    let minDistance = Infinity;

    for (let i = 0; i < pageNodes.length; i++) {
      const node = pageNodes[i];
      const pageAttr = node.getAttribute('data-page-container');
      if (!pageAttr) continue;
      const pageNum = parseInt(pageAttr, 10);
      const top = node.offsetTop;
      const height = node.offsetHeight;
      const bottom = top + height;

      if (viewportCenterY >= top && viewportCenterY <= bottom) {
        targetPage = pageNum;
        break;
      }

      const pageCenter = top + height / 2;
      const dist = Math.abs(pageCenter - viewportCenterY);
      if (dist < minDistance) {
        minDistance = dist;
        targetPage = pageNum;
      }
    }

    if (targetPage !== currentPage && targetPage >= 1 && targetPage <= totalPages) {
      navigationStateRef.current.isObserverTriggeredPageChange = true;
      setPage(targetPage);
    }
  }, [pan.y, zoom, viewMode, previewModeOverride, totalPages, currentPage, setPage]);

  const onDocumentLoadSuccess = React.useCallback(({ numPages }: { numPages: number }) => {
    setTotalPages(numPages);
  }, [setTotalPages]);

  const onPageLoadSuccess = React.useCallback(async (page: any) => {
    if (previewModeOverride === 'translated') {
      // Secondary split-view canvas should not reset or recalculate global zoom/pan
      return;
    }

    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      const { width, height } = page.originalWidth ? { width: page.originalWidth, height: page.originalHeight } : page;
      
      const scaleX = (clientWidth - 40) / width;
      const scaleY = (clientHeight - 40) / height;
      const fitScale = Math.min(scaleX, scaleY, 1);
      
      if (stateRef.current.zoom === 1) {
        setZoom(fitScale);
      }
      
      const scaledWidth = width * fitScale;
      const x = (clientWidth - scaledWidth) / 2;
      
      if (useProjectStore.getState().viewMode === 'single') {
        setPan(x, 20);
      } else {
        const targetPage = useProjectStore.getState().currentPage;
        if (targetPage > 1) {
          isProgrammaticScrollRef.current = true;
          if (navigationStateRef.current.activePageChangeTimeout) {
            clearTimeout(navigationStateRef.current.activePageChangeTimeout);
            navigationStateRef.current.activePageChangeTimeout = null;
          }
          const pageElement = (
            containerRef.current?.querySelector(
              `.pdf-canvas-document [data-page-container="${targetPage}"]`
            ) || document.querySelector(
              `.pdf-canvas-document [data-page-container="${targetPage}"]`
            )
          ) as HTMLElement | null;
          const estimatedOffsetTop = (targetPage - 1) * 1146;
          const offsetTop = pageElement && pageElement.offsetTop > 0 ? pageElement.offsetTop : estimatedOffsetTop;
          const targetY = -(offsetTop * fitScale) + 20;
          setPan(x, targetY);
          setTimeout(() => {
            isProgrammaticScrollRef.current = false;
          }, 500);
        } else {
          // Keep current vertical pan or default to top
          setPan(x, stateRef.current.pan.y !== 0 ? stateRef.current.pan.y : 20);
        }
      }
    }
  }, [setZoom, setPan, previewModeOverride]);

  const pdfSource = useMemo(() => {
    if (fileUrl) return fileUrl;
    if (!fileData) return null;
    return { data: new Uint8Array(fileData) };
  }, [fileUrl, fileData]);

  const docKey = fileUrl ?? 'pdf-document';

  const navContextValue = useMemo(() => ({
    navigationStateRef,
    isProgrammaticScrollRef,
  }), []);

  return (
    <PDFCanvasNavigationContext.Provider value={navContextValue}>
      <div 
        ref={containerRef}
        className={`w-full h-full overflow-hidden relative bg-slate-900/50 ${activeTool === 'hand' ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div 
          ref={contentRef}
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0px) scale(${zoom})`,
            transformOrigin: '0 0',
            transition: 'none',
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
          }}
          className="absolute top-0 left-0 origin-top-left pdf-canvas-content"
        >
          <div className="relative shadow-2xl">
            <Document
              key={docKey}
              file={pdfSource}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={(error) => console.error('[PDFCanvas] PDF load error:', error)}
              className="flex flex-col gap-4 pdf-canvas-document"
            >
              {viewMode === 'single' ? (
                <PDFPageContainer
                  pageNum={currentPage}
                  onPageLoadSuccess={onPageLoadSuccess}
                  previewModeOverride={previewModeOverride}
                />
              ) : (
                Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                  <PDFPageContainer
                    key={`page_${pageNum}`}
                    pageNum={pageNum}
                    onPageLoadSuccess={pageNum === 1 ? onPageLoadSuccess : undefined}
                    previewModeOverride={previewModeOverride}
                  />
                ))
              )}
            </Document>
          </div>
        </div>

      </div>
    </PDFCanvasNavigationContext.Provider>
  );
});

PDFCanvas.displayName = 'PDFCanvas';
