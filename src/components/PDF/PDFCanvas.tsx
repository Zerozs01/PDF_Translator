import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Document, Page } from 'react-pdf';
import '../../services/pdf/pdfjsWorker';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useSegmentationStore } from '../../stores/useSegmentationStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { visionService } from '../../services/vision/VisionService';
import {
  clampOverlayRect,
  computeOverlayTypography,
  DEFAULT_OVERLAY_PALETTE,
  estimateLineRotationDeg,
  resolveTranslationOverlayContext,
  sampleOverlayPaletteFromLine,
} from '../OCR/translationOverlayUtils';
import { resolveOverlayFontFamily } from '../../constants/overlayFonts';

export const PDFCanvas: React.FC = () => {
  const {
    fileUrl,
    fileData,
    currentPage,
    totalPages,
    setTotalPages,
    viewMode,
    sourceLanguage,
    targetLanguage,
    translationMode,
    overlayThaiFontEnabled,
    overlayFontPreset,
  } = useProjectStore();
  const { zoom, pan, setZoom, setPan, activeTool } = useUIStore();
  const { regions, setRegions, setIsProcessing, processRequest } = useSegmentationStore();
  const {
    allPagesOCR,
    showDebugOverlay,
    options,
    translationPreviewMode,
    translationCacheByPage,
    activeTranslationKeyByPage,
  } = useOCRTextLayerStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const pageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const panRef = useRef(pan);
  const [ocrOverlayTransform, setOcrOverlayTransform] = useState({
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0
  });
  const [pageRenderTick, setPageRenderTick] = useState(0);
  const [translatedLinePalette, setTranslatedLinePalette] = useState<Map<number, { backgroundColor: string; textColor: string }>>(new Map());

  const currentPageOCR = allPagesOCR.get(currentPage);
  const currentPageTranslationMap = translationCacheByPage.get(currentPage);
  const activeTranslationKey = activeTranslationKeyByPage.get(currentPage);
  const overlayFontFamily = useMemo(() => resolveOverlayFontFamily({
    preset: overlayFontPreset,
    enabled: overlayThaiFontEnabled,
    targetLanguage,
  }), [overlayFontPreset, overlayThaiFontEnabled, targetLanguage]);
  const translationOverlayContext = useMemo(() => resolveTranslationOverlayContext({
    currentPageOCR,
    optionsEngine: options.engine || 'tesseract',
    optionsLanguage: options.language || 'eng',
    translationMode,
    sourceLanguage,
    targetLanguage,
    translationPreviewMode,
    currentPageTranslationMap,
    activeTranslationKey,
  }), [
    activeTranslationKey,
    currentPageOCR,
    currentPageTranslationMap,
    options.engine,
    options.language,
    sourceLanguage,
    targetLanguage,
    translationMode,
    translationPreviewMode,
  ]);
  const debugPageOCR = showDebugOverlay ? currentPageOCR : undefined;
  const droppedDebugWords = useMemo(() => {
    if (!showDebugOverlay || !debugPageOCR?.debug?.droppedWords) return [];
    return debugPageOCR.debug.droppedWords.filter(item => {
      if (!item.bbox) return false;
      const w = item.bbox.x1 - item.bbox.x0;
      const h = item.bbox.y1 - item.bbox.y0;
      return w > 0 && h > 0;
    });
  }, [showDebugOverlay, debugPageOCR]);

  useEffect(() => {
    if (!translationOverlayContext.shouldRender || !currentPageOCR || !pageRef.current) {
      setTranslatedLinePalette(new Map());
      return;
    }

    const canvas = pageRef.current.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      setTranslatedLinePalette(new Map());
      return;
    }

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      setTranslatedLinePalette(new Map());
      return;
    }

    const next = new Map<number, { backgroundColor: string; textColor: string }>();
    currentPageOCR.lines.forEach((line, index) => {
      if (!translationOverlayContext.translatedByIndex.has(index)) return;
      next.set(index, sampleOverlayPaletteFromLine(
        context,
        line,
        currentPageOCR.width,
        currentPageOCR.height,
        canvas.width,
        canvas.height
      ));
    });
    setTranslatedLinePalette(next);
  }, [
    currentPage,
    currentPageOCR,
    pageRenderTick,
    translationOverlayContext.entry?.key,
    translationOverlayContext.shouldRender,
    translationOverlayContext.translatedByIndex,
  ]);

  // State Ref for Event Listeners to avoid stale closures
  const stateRef = useRef({ zoom, pan });
  useEffect(() => {
    stateRef.current = { zoom, pan };
    if (!isDragging) {
      panRef.current = pan;
    }
  }, [zoom, pan, isDragging]);

  useEffect(() => {
    if (!currentPageOCR || !pageRef.current) return;

    let observedCanvas: HTMLCanvasElement | null = null;

    const updateTransform = () => {
      const container = pageRef.current;
      const canvas = container?.querySelector('canvas') as HTMLCanvasElement | null;
      if (!container || !canvas) return;

      if (!currentPageOCR.width || !currentPageOCR.height) return;
      if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return;

      if (canvas !== observedCanvas) {
        if (observedCanvas) {
          resizeObserver.unobserve(observedCanvas);
        }
        observedCanvas = canvas;
        resizeObserver.observe(canvas);
      }

      let offsetX = 0;
      let offsetY = 0;
      let node: HTMLElement | null = canvas;
      const root = pageRef.current;
      while (node && node !== root) {
        offsetX += node.offsetLeft;
        offsetY += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }

      setOcrOverlayTransform({
        scaleX: canvas.clientWidth / currentPageOCR.width,
        scaleY: canvas.clientHeight / currentPageOCR.height,
        offsetX,
        offsetY
      });
    };

    const raf = requestAnimationFrame(updateTransform);
    const resizeObserver = new ResizeObserver(updateTransform);
    resizeObserver.observe(pageRef.current);
    window.addEventListener('resize', updateTransform);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateTransform);
    };
  }, [currentPageOCR, currentPage]);

  // Handle Document Load
  const onDocumentLoadSuccess = React.useCallback(({ numPages }: { numPages: number }) => {
    setTotalPages(numPages);
  }, [setTotalPages]);

  // Handle Page Load (Fit to Screen Logic)
  const onPageLoadSuccess = React.useCallback(async (page: any) => {
    // 1. Fit to Screen Logic
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      const { width, height } = page.originalWidth ? { width: page.originalWidth, height: page.originalHeight } : page;
      
      // Only fit if we are at default zoom (approx 1) or initial load
      // We can't easily check "initial load" here without more state, but checking zoom === 1 is a decent heuristic
      // However, accessing 'zoom' here would make this callback change when zoom changes.
      // Let's just calculate fit scale and set it if it seems appropriate (e.g. first page load)
      
      const scaleX = (clientWidth - 40) / width;
      const scaleY = (clientHeight - 40) / height;
      const fitScale = Math.min(scaleX, scaleY, 1);
      
      // We only auto-fit if the current zoom is exactly 1 (default)
      if (stateRef.current.zoom === 1) {
        setZoom(fitScale);
      }
      
      const scaledWidth = width * fitScale;
      const x = (clientWidth - scaledWidth) / 2;
      setPan(x, 20);
    }
  }, [setZoom, setPan]);

  const onPageRenderSuccess = React.useCallback(() => {
    setPageRenderTick((prev) => prev + 1);
  }, []);

  // Listen for Process Request
  useEffect(() => {
    if (processRequest > 0) {
      captureAndProcess();
    }
  }, [processRequest]);

  const captureAndProcess = async () => {
    console.log("[PDFCanvas] Processing Triggered...");
    const canvas = document.querySelector(`.react-pdf__Page[data-page-number="${currentPage}"] canvas`) as HTMLCanvasElement;
    
    if (!canvas) {
      console.warn("[PDFCanvas] Canvas not found for vision processing");
      return;
    }

    console.log("[PDFCanvas] Canvas found, sending to Vision Service...");
    setIsProcessing(true);
    
    try {
      // Create a temporary canvas to ensure white background (react-pdf canvas might be transparent)
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const ctx = tempCanvas.getContext('2d');
      
      let imageUrl = '';
      
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(canvas, 0, 0);
        imageUrl = tempCanvas.toDataURL('image/jpeg', 0.95);
      } else {
        // Fallback if context fails (unlikely)
        imageUrl = canvas.toDataURL('image/jpeg', 0.95);
      }

      console.log(`[PDFCanvas] Image captured: ${canvas.width}x${canvas.height}, URL length: ${imageUrl.length}`);
      console.log(`[PDFCanvas] OCR Language: ${sourceLanguage}`);
      
      // Determine document type based on translation mode
      // manga mode = comic/manga, official mode = document
      const translationMode = useProjectStore.getState().translationMode;
      const documentType = translationMode === 'official' ? 'document' : 'manga';
      
      console.log(`[PDFCanvas] Document type: ${documentType}`);
      
      // Pass document type to vision service for smart segmentation
      const detectedRegions = await visionService.segmentImage(
        imageUrl, 
        sourceLanguage,
        documentType
      );
      
      console.log(`[PDFCanvas] Vision Service returned ${detectedRegions.length} regions:`, 
        detectedRegions.map(r => `${r.type}(${r.originalText?.substring(0, 20)}...)`).join(', ')
      );
      
      setRegions(detectedRegions);
      
    } catch (error) {
      console.error("[PDFCanvas] Vision Service Error:", error);
      
      // Show error to user (could be enhanced with toast notification)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[PDFCanvas] OCR Failed: ${errorMessage}`);
      
      // Clear regions on error
      setRegions([]);
    } finally {
      setIsProcessing(false);
    }
  };

  // Manual Event Listener for Wheel (Non-Passive)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      // Only prevent default if Ctrl is pressed (Zoom) to allow normal scrolling if needed,
      // BUT since we are implementing custom pan, we likely want to prevent default always
      // to stop the browser from scrolling the page itself.
      e.preventDefault();

      if (e.ctrlKey) {
        // Zoom
        const { zoom } = stateRef.current;
        const scaleAmount = -e.deltaY * 0.001;
        const newZoom = Math.min(Math.max(0.1, zoom + scaleAmount), 5);
        setZoom(newZoom);
      } else {
        // Pan
        const { pan } = stateRef.current;
        setPan(pan.x - e.deltaX, pan.y - e.deltaY);
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [setZoom, setPan]);

  // Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Allow panning with Hand tool OR Middle Mouse Button (button 1)
    if (activeTool === 'hand' || e.button === 1) { 
      setIsDragging(true);
      // Calculate the offset from the mouse position to the current pan position
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault(); // Prevent text selection
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      e.preventDefault();
      // Calculate new position
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      // Update ref
      panRef.current = { x: newX, y: newY };

      // Direct DOM manipulation for performance
      if (contentRef.current) {
        contentRef.current.style.transform = `translate(${newX}px, ${newY}px) scale(${stateRef.current.zoom})`;
      }
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      setPan(panRef.current.x, panRef.current.y);
    }
  };

  const pdfSource = useMemo(() => {
    // Prefer object URL source so worker transfer does not detach store-managed buffers.
    if (fileUrl) return fileUrl;
    if (!fileData) return null;
    // Fallback for edge cases where URL is unavailable.
    return { data: new Uint8Array(fileData) };
  }, [fileUrl, fileData]);

  const docKey = fileUrl ?? 'pdf-document';

  return (
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
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          willChange: 'transform'
        }}
        className="absolute top-0 left-0 origin-top-left"
      >
        <div className="relative shadow-2xl">
          <Document
            key={docKey}
            file={pdfSource}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(error) => console.error('[PDFCanvas] PDF load error:', error)}
            className="flex flex-col gap-4"
          >
            {viewMode === 'single' ? (
              <div ref={pageRef} className="relative group">
                <Page 
                  pageNumber={currentPage} 
                  renderTextLayer={false} 
                  renderAnnotationLayer={false}
                  className="border border-slate-700 bg-white"
                  width={800}
                  onLoadSuccess={onPageLoadSuccess}
                  onRenderSuccess={onPageRenderSuccess}
                />
                {/* Regions Overlay */}
                {regions.map(reg => (
                    <div 
                      key={reg.id}
                      style={{
                        left: reg.box.x,
                        top: reg.box.y,
                        width: reg.box.w,
                        height: reg.box.h
                      }}
                      className={`absolute border-2 border-dashed transition-all cursor-pointer hover:bg-opacity-20 ${
                        reg.type === 'balloon' ? 'border-green-500 bg-green-500/10' : 
                        reg.type === 'sfx' ? 'border-orange-500 bg-orange-500/10' :
                        'border-blue-500 bg-blue-500/10'
                      }`}
                    >
                    </div>
                  ))}
                {/* OCR Debug Overlay */}
                {translationOverlayContext.shouldRender && currentPageOCR && (
                  <div className="absolute inset-0 pointer-events-none">
                    {currentPageOCR.lines.map((line, idx) => {
                      const translatedText = translationOverlayContext.translatedByIndex.get(idx);
                      if (!translatedText) return null;

                      const rawLeft = ocrOverlayTransform.offsetX + line.bbox.x0 * ocrOverlayTransform.scaleX;
                      const rawTop = ocrOverlayTransform.offsetY + line.bbox.y0 * ocrOverlayTransform.scaleY;
                      const rawWidth = Math.max(1, (line.bbox.x1 - line.bbox.x0) * ocrOverlayTransform.scaleX);
                      const rawHeight = Math.max(1, (line.bbox.y1 - line.bbox.y0) * ocrOverlayTransform.scaleY);
                      const rect = clampOverlayRect(rawLeft, rawTop, rawWidth, rawHeight, {
                        x0: ocrOverlayTransform.offsetX,
                        y0: ocrOverlayTransform.offsetY,
                        x1: ocrOverlayTransform.offsetX + currentPageOCR.width * ocrOverlayTransform.scaleX,
                        y1: ocrOverlayTransform.offsetY + currentPageOCR.height * ocrOverlayTransform.scaleY,
                      });
                      const palette = translatedLinePalette.get(idx) || DEFAULT_OVERLAY_PALETTE;
                      const typography = computeOverlayTypography(translatedText, rect.width, rect.height);
                      const rotationDeg = estimateLineRotationDeg(line);

                      return (
                        <div
                          key={`ocr-translation-line-${idx}`}
                          style={{
                            left: rect.left,
                            top: rect.top,
                            width: rect.width,
                            height: rect.height,
                            padding: `${typography.padY}px ${typography.padX}px`,
                            backgroundColor: palette.backgroundColor,
                            color: palette.textColor,
                            fontSize: typography.fontSize,
                            lineHeight: typography.lineHeight,
                            fontFamily: overlayFontFamily,
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            transform: rotationDeg !== 0 ? `rotate(${rotationDeg.toFixed(2)}deg)` : undefined,
                            transformOrigin: rotationDeg !== 0 ? 'left top' : undefined,
                          }}
                          className="absolute rounded-xs overflow-hidden font-semibold shadow-[0_1px_1px_rgba(0,0,0,0.24)] whitespace-normal"
                        >
                          {translatedText}
                        </div>
                      );
                    })}
                  </div>
                )}
                {showDebugOverlay && debugPageOCR && (
                  <div className="absolute inset-0 pointer-events-none">
                    {debugPageOCR.words.map((word, idx) => {
                      const left = ocrOverlayTransform.offsetX + word.bbox.x0 * ocrOverlayTransform.scaleX;
                      const top = ocrOverlayTransform.offsetY + word.bbox.y0 * ocrOverlayTransform.scaleY;
                      const width = (word.bbox.x1 - word.bbox.x0) * ocrOverlayTransform.scaleX;
                      const height = (word.bbox.y1 - word.bbox.y0) * ocrOverlayTransform.scaleY;
                      const baselineY = ocrOverlayTransform.offsetY + word.bbox.y1 * ocrOverlayTransform.scaleY;
                      return (
                        <React.Fragment key={`ocr-word-${idx}`}>
                          <div
                            style={{ left, top, width, height }}
                            className="absolute border border-red-400/60"
                          />
                          <div
                            style={{ left, top: baselineY, width, height: 1 }}
                            className="absolute bg-yellow-400/70"
                          />
                        </React.Fragment>
                      );
                    })}
                    {droppedDebugWords.map((word, idx) => {
                      const bbox = word.bbox!;
                      const left = ocrOverlayTransform.offsetX + bbox.x0 * ocrOverlayTransform.scaleX;
                      const top = ocrOverlayTransform.offsetY + bbox.y0 * ocrOverlayTransform.scaleY;
                      const width = (bbox.x1 - bbox.x0) * ocrOverlayTransform.scaleX;
                      const height = (bbox.y1 - bbox.y0) * ocrOverlayTransform.scaleY;
                      return (
                        <div
                          key={`ocr-dropped-${idx}`}
                          style={{ left, top, width, height }}
                          title={`${word.filter}: ${word.text} (${word.reason})`}
                          className="absolute border border-orange-400/70 border-dashed bg-orange-400/5"
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <div key={`page_${pageNum}`} className="relative mb-4 group">
                  <Page 
                    pageNumber={pageNum}
                    renderTextLayer={false} 
                    renderAnnotationLayer={false}
                    className="border border-slate-700 bg-white"
                    width={800}
                  />
                </div>
              ))
            )}
          </Document>
        </div>
      </div>
    </div>
  );
};
