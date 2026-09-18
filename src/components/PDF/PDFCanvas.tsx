import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { Document } from 'react-pdf';
import '../../services/pdf/pdfjsWorker';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useCanvasNavigation } from './hooks/useCanvasNavigation';
import { PDFPageContainer, type PDFPageLoadedEvent } from './PDFPageContainer';
import {
  PDFCanvasNavigationContext,
  type PDFCanvasNavigationState,
} from './PDFCanvasContext';

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
  const splitViewMode = useUIStore((s) => s.viewMode);
  const prevSplitViewModeRef = useRef(splitViewMode);

  // Track programmatic scrolling to lock active page updates during animations & initial mount
  const isProgrammaticScrollRef = useRef(currentPage > 1);

  // Sync scroll position when switching to continuous viewMode, split mode toggle, or clicking LeftSidebar thumbnails or on initial load
  useEffect(() => {
    const pageChanged = prevPageRef.current !== null && currentPage !== prevPageRef.current;
    const viewModeChanged = viewMode !== prevViewModeRef.current;
    const splitModeChanged = splitViewMode !== prevSplitViewModeRef.current;
    const isInitialMount = prevPageRef.current === null;
    const fromObserver = navigationStateRef.current.isObserverTriggeredPageChange;
    navigationStateRef.current.isObserverTriggeredPageChange = false;

    prevPageRef.current = currentPage;
    prevViewModeRef.current = viewMode;
    prevSplitViewModeRef.current = splitViewMode;

    // Secondary split-view canvas (previewModeOverride === 'translated') must NOT dispatch pan updates to avoid fighting the primary canvas
    if (previewModeOverride === 'translated') {
      return;
    }

    const isInteracting = navigationStateRef.current.isUserInteracting || useUIStore.getState().isUserInteracting;
    if (viewMode === 'continuous' && (viewModeChanged || splitModeChanged || (isInitialMount && currentPage > 1) || (pageChanged && !fromObserver && !isInteracting))) {
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

          // Snap if the offset diff is substantial or if on initial load / mode switch / page navigation / split mode toggle
          if (diff > 5 || viewModeChanged || splitModeChanged || isInitialMount || pageChanged) {
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

      return () => {
        clearTimeout(timer);
        isProgrammaticScrollRef.current = false;
      };
    } else if (viewMode === 'single' && splitModeChanged) {
      // Re-center horizontally for single mode when split pane changes container width
      const timer = setTimeout(() => {
        if (containerRef.current) {
          const pageElement = containerRef.current.querySelector('.pdf-canvas-document [data-page-container]') as HTMLElement | null;
          const { clientWidth } = containerRef.current;
          const pageWidth = pageElement?.clientWidth || 800;
          const scaledWidth = pageWidth * zoom;
          const targetX = (clientWidth - scaledWidth) / 2;
          setPan(targetX, 20);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [currentPage, viewMode, splitViewMode, zoom, setPan, stateRef, previewModeOverride]);

  // Real-time active page tracking for continuous scroll & split compare modes (Throttled via RAF)
  const pageTrackingRafRef = useRef<number | null>(null);

  useEffect(() => {
    if (viewMode !== 'continuous' || previewModeOverride === 'translated') return;
    if (isProgrammaticScrollRef.current) return;
    if (!containerRef.current) return;

    if (pageTrackingRafRef.current) {
      cancelAnimationFrame(pageTrackingRafRef.current);
    }

    pageTrackingRafRef.current = requestAnimationFrame(() => {
      pageTrackingRafRef.current = null;
      const container = containerRef.current;
      if (!container) return;

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
        const height = node.offsetHeight;
        // Skip unrendered, collapsed, or zero-height placeholder pages
        if (height <= 50) continue;

        const pageNum = parseInt(pageAttr, 10);
        const top = node.offsetTop;
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
    });

    return () => {
      if (pageTrackingRafRef.current) {
        cancelAnimationFrame(pageTrackingRafRef.current);
        pageTrackingRafRef.current = null;
      }
    };
  }, [pan.y, zoom, viewMode, previewModeOverride, totalPages, currentPage, setPage]);

  const onDocumentLoadSuccess = React.useCallback(({ numPages }: { numPages: number }) => {
    setTotalPages(numPages);
  }, [setTotalPages]);

  const onPageLoadSuccess = React.useCallback(async (page: PDFPageLoadedEvent) => {
    if (previewModeOverride === 'translated') {
      // Secondary split-view canvas should not reset or recalculate global zoom/pan
      return;
    }

    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      const width = (page.originalWidth && page.originalWidth > 0) ? page.originalWidth : page.width;
      const height = (page.originalHeight && page.originalHeight > 0) ? page.originalHeight : page.height;
      
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
