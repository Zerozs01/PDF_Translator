import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Document, Page } from 'react-pdf';
import '../../services/pdf/pdfjsWorker';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useSegmentationStore } from '../../stores/useSegmentationStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { useLayerStore } from '../../stores/useLayerStore';
import { InteractiveLayerOverlay } from '../Layers/InteractiveLayerOverlay';
import { visionService } from '../../services/vision/VisionService';
import {
  clampOverlayRect,
  computeOverlayTypography,
  computeOverlayLayoutMap,
  DEFAULT_OVERLAY_PALETTE,
  estimateLineRotationDeg,
  normalizeOverlayInlineText,
  resolveOverlayMaskBBox,
  resolveOverlayMaskExpansion,
  type OverlayPalette,
  type OverlayLayout,
  type OverlayLayoutProfile,
  type OverlayTypography,
  resolveTranslationOverlayContext,
  resolveOverlaySourceBBox,
  shouldSkipOverlayRenderForSuspiciousLine,
  sampleOverlayPaletteFromLine,
} from '../OCR/translationOverlayUtils';
import { resolveOverlayFontFamily } from '../../constants/overlayFonts';
import { buildTextSearchPattern, collectTextSearchMatches, hasTextSearchMatch, type TextSearchPattern } from '../../services/textSearch';

const formatOverlayRatioLabel = (value: number): string => `${Math.max(1, Math.round(value * 100))}%`;
const DOCUMENT_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|reaction|unknowns?|equilibrium|rigid|body|support|diagram|objective|objectives|connection|connections|continued|force|moment|component|unknown|column|columns|bridge|building|beam|beams|welded|surface|bracket|cable|utility|floor|member|pin|hinge)\b/i;

const shouldUseDocumentCoverageFallback = (sourceText: string): boolean => {
  const normalized = normalizeOverlayInlineText(String(sourceText || ''));
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/g).filter(Boolean).length;
  const thaiCharCount = (normalized.match(/[\u0E00-\u0E7F]/g) || []).length;
  const technicalLike = DOCUMENT_SOURCE_HINT_REGEX.test(normalized);
  const numericDocumentLike = wordCount >= 6 && /[0-9()\-]/.test(normalized);
  const thaiDocumentLike = thaiCharCount >= 12
    && (wordCount >= 3 || /[0-9()\[\].,:;\-]/.test(normalized));
  return technicalLike || numericDocumentLike || thaiDocumentLike;
};

const isSourceFallbackOverlayText = (sourceText: string, translatedText: string): boolean => {
  const source = normalizeOverlayInlineText(String(sourceText || ''));
  const translated = normalizeOverlayInlineText(String(translatedText || ''));
  return Boolean(source && translated && source === translated);
};

const clampOverlayTypographyScale = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  if (value < 0.7) return 0.7;
  if (value > 1.6) return 1.6;
  return value;
};

const scaleOverlayTypography = (typography: OverlayTypography, scale: number): OverlayTypography => {
  const normalizedScale = clampOverlayTypographyScale(scale);
  if (Math.abs(normalizedScale - 1) < 0.0001) return typography;

  return {
    ...typography,
    fontSize: Math.max(8, Number((typography.fontSize * normalizedScale).toFixed(2))),
    lineHeight: Number((typography.lineHeight * normalizedScale).toFixed(3)),
    padX: Math.max(1, Math.round(typography.padX * normalizedScale)),
    padY: Math.max(1, Math.round(typography.padY * normalizedScale)),
    contentHeight: Math.max(1, Number((typography.contentHeight * normalizedScale).toFixed(2))),
  };
};

const renderOverlayTextWithSearchHighlight = (
  text: string,
  continuationText: string,
  defaultColor: string,
  continuationColor: string,
  searchPattern: TextSearchPattern | null
): React.ReactNode => {
  const fullText = String(text || '');
  if (!fullText) return '';

  const continuationStart = continuationText ? fullText.indexOf(continuationText) : -1;
  const continuationEnd = continuationStart >= 0 ? continuationStart + continuationText.length : -1;
  const matches = collectTextSearchMatches(fullText, searchPattern);

  if (matches.length === 0 && continuationStart < 0) {
    return fullText;
  }

  const boundaries = new Set<number>([0, fullText.length]);
  matches.forEach((match) => {
    boundaries.add(match.start);
    boundaries.add(match.end);
  });
  if (continuationStart >= 0 && continuationEnd > continuationStart) {
    boundaries.add(continuationStart);
    boundaries.add(continuationEnd);
  }

  const sortedBoundaries = Array.from(boundaries)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= fullText.length)
    .sort((a, b) => a - b);

  const pieces: React.ReactNode[] = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i += 1) {
    const start = sortedBoundaries[i];
    const end = sortedBoundaries[i + 1];
    if (end <= start) continue;

    const slice = fullText.slice(start, end);
    if (!slice) continue;

    const inContinuation = continuationStart >= 0 && start >= continuationStart && end <= continuationEnd;
    const inMatch = matches.some((match) => start >= match.start && end <= match.end);

    if (!inContinuation && !inMatch) {
      pieces.push(<React.Fragment key={`plain-${start}`}>{slice}</React.Fragment>);
      continue;
    }

    pieces.push(
      <span
        key={`seg-${start}`}
        style={{
          color: inContinuation ? continuationColor : defaultColor,
          backgroundColor: inMatch ? 'rgba(250, 204, 21, 0.28)' : undefined,
          borderRadius: inMatch ? 3 : undefined,
          paddingInline: inMatch ? 1 : 0,
          boxShadow: inMatch ? 'inset 0 0 0 1px rgba(250, 204, 21, 0.22)' : undefined,
        }}
      >
        {slice}
      </span>
    );
  }

  return pieces;
};

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
    overlayFontSizeScale,
  } = useProjectStore();
  const { zoom, pan, setZoom, setPan, activeTool } = useUIStore();
  const { regions, setRegions, setIsProcessing, processRequest } = useSegmentationStore();
  const {
    allPagesOCR,
    ocrByPageEngine,
    showDebugOverlay,
    options,
    translationPreviewMode,
    translationCacheByPage,
    activeTranslationKeyByPage,
    ocrResultSearchQuery,
  } = useOCRTextLayerStore();
  const layersByPage = useLayerStore((state) => state.layersByPage);
  const groupsByPage = useLayerStore((state) => state.groupsByPage);
  const editingLayerId = useLayerStore((state) => state.editingLayerId);
  const currentPageLayers = layersByPage.get(currentPage) || [];
  const currentPageGroups = groupsByPage.get(currentPage) || [];
  const hiddenLineIndexes = useMemo(() => {
    const hidden = new Set(currentPageLayers.filter(l => !l.visible).map(l => l.lineIndex));
    const editingLayer = currentPageLayers.find(l => l.id === editingLayerId);
    if (editingLayer) {
      hidden.add(editingLayer.lineIndex);
    }
    return hidden;
  }, [currentPageLayers, editingLayerId]);
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
  const [translatedLinePalette, setTranslatedLinePalette] = useState<Map<number, OverlayPalette>>(new Map());

  const selectedEngine = (options.engine || 'tesseract');
  const resolveEngineScopedPageOCR = (pageNum: number) => {
    const byEngine = ocrByPageEngine.get(pageNum)?.get(selectedEngine);
    if (byEngine) return byEngine;

    const fallback = allPagesOCR.get(pageNum);
    if (!fallback) return undefined;
    const fallbackEngine = (fallback.ocrEngine || selectedEngine);
    return fallbackEngine === selectedEngine ? fallback : undefined;
  };

  const currentPageOCR = resolveEngineScopedPageOCR(currentPage);
  const currentPageTranslationMap = translationCacheByPage.get(currentPage);
  const activeTranslationKey = activeTranslationKeyByPage.get(currentPage);
  const overlayFontFamily = useMemo(() => resolveOverlayFontFamily({
    preset: overlayFontPreset,
    enabled: overlayThaiFontEnabled,
    targetLanguage,
  }), [overlayFontPreset, overlayThaiFontEnabled, targetLanguage]);
  const overlayLayoutProfile: OverlayLayoutProfile = translationMode === 'official'
    ? 'official'
    : translationMode === 'adaptive'
      ? 'adaptive'
    : translationMode === 'manhwa'
      ? 'manhwa'
      : 'manga';
  const normalizedOverlaySearch = useMemo(
    () => normalizeOverlayInlineText(ocrResultSearchQuery),
    [ocrResultSearchQuery]
  );
  const overlaySearchPattern = useMemo(
    () => buildTextSearchPattern(normalizedOverlaySearch),
    [normalizedOverlaySearch]
  );
  const originalOCRSearchPattern = useMemo(() => {
    if (translationPreviewMode !== 'original') return null;
    if (!normalizedOverlaySearch) return null;
    return buildTextSearchPattern(normalizedOverlaySearch);
  }, [normalizedOverlaySearch, translationPreviewMode]);
  const originalOCRMatchedLineIndexes = useMemo(() => {
    if (!currentPageOCR || !originalOCRSearchPattern) return [] as number[];
    return currentPageOCR.lines.reduce<number[]>((indexes, line, index) => {
      const lineText = normalizeOverlayInlineText(String(line.text || ''));
      if (lineText && hasTextSearchMatch(lineText, originalOCRSearchPattern)) {
        indexes.push(index);
      }
      return indexes;
    }, []);
  }, [currentPageOCR, originalOCRSearchPattern]);
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
  const overlayLayoutByIndex = useMemo(() => {
    if (!translationOverlayContext.shouldRender || !currentPageOCR) {
      return new Map<number, OverlayLayout>();
    }

    return computeOverlayLayoutMap(
      currentPageOCR.lines.flatMap((line, index) => {
        const translatedText = translationOverlayContext.translatedByIndex.get(index);
        if (!translatedText) return [];
        if (shouldSkipOverlayRenderForSuspiciousLine(line) && !isSourceFallbackOverlayText(line.text, translatedText)) return [];

        const sourceBbox = resolveOverlaySourceBBox(line);
        const maskBbox = resolveOverlayMaskBBox(line);
        const sourceWidthRaw = Math.max(1, sourceBbox.x1 - sourceBbox.x0);
        const sourceHeightRaw = Math.max(1, sourceBbox.y1 - sourceBbox.y0);
        const sourceAreaRaw = sourceWidthRaw * sourceHeightRaw;
        const maskWidthRaw = Math.max(1, maskBbox.x1 - maskBbox.x0);
        const maskHeightRaw = Math.max(1, maskBbox.y1 - maskBbox.y0);
        const maskAreaRaw = maskWidthRaw * maskHeightRaw;
        const widthCoverage = sourceWidthRaw / maskWidthRaw;
        const areaCoverage = sourceAreaRaw / maskAreaRaw;
        const lowCoverageSource = shouldUseDocumentCoverageFallback(line.text)
          && widthCoverage < 0.84
          && areaCoverage < 0.86;
        const effectiveSourceBbox = lowCoverageSource ? maskBbox : sourceBbox;
        const baseWidth = Math.max(1, (effectiveSourceBbox.x1 - effectiveSourceBbox.x0) * ocrOverlayTransform.scaleX);
        const baseHeight = Math.max(1, (effectiveSourceBbox.y1 - effectiveSourceBbox.y0) * ocrOverlayTransform.scaleY);
        const expansion = resolveOverlayMaskExpansion(line);
        const maskExpandX = Math.min(expansion.maxExpandX, Math.max(1, Math.round(baseHeight * expansion.expandXRatio)));
        const maskExpandTop = Math.min(expansion.maxExpandTop, Math.max(1, Math.round(baseHeight * expansion.expandTopRatio)));
        const maskExpandBottom = Math.min(expansion.maxExpandBottom, Math.max(1, Math.round(baseHeight * expansion.expandBottomRatio)));
        const rawLeft = ocrOverlayTransform.offsetX + effectiveSourceBbox.x0 * ocrOverlayTransform.scaleX - maskExpandX;
        const rawTop = ocrOverlayTransform.offsetY + effectiveSourceBbox.y0 * ocrOverlayTransform.scaleY - maskExpandTop;
        const rawWidth = baseWidth + maskExpandX * 2;
        const rawHeight = baseHeight + maskExpandTop + maskExpandBottom;
        const rect = clampOverlayRect(rawLeft, rawTop, rawWidth, rawHeight, {
          x0: ocrOverlayTransform.offsetX,
          y0: ocrOverlayTransform.offsetY,
          x1: ocrOverlayTransform.offsetX + currentPageOCR.width * ocrOverlayTransform.scaleX,
          y1: ocrOverlayTransform.offsetY + currentPageOCR.height * ocrOverlayTransform.scaleY,
        });
        const typographyWidth = overlayLayoutProfile === 'official' ? baseWidth : rect.width;
        const typographyHeight = overlayLayoutProfile === 'official' ? baseHeight : rect.height;

        return [{
          index,
          text: translatedText,
          width: typographyWidth,
          height: typographyHeight,
          bbox: overlayLayoutProfile === 'official' ? maskBbox : effectiveSourceBbox,
          line,
          hints: {
            sourceText: line.text,
            sourceBoxWidth: baseWidth,
            sourceBoxHeight: baseHeight,
            sourceLineCount: 1,
            fontFamily: overlayFontFamily,
            profile: overlayLayoutProfile,
          },
        }];
      }),
      { profile: overlayLayoutProfile }
    );
  }, [
    currentPageOCR,
    ocrOverlayTransform.offsetX,
    ocrOverlayTransform.offsetY,
    ocrOverlayTransform.scaleX,
    ocrOverlayTransform.scaleY,
    overlayLayoutProfile,
    overlayFontFamily,
    translationOverlayContext.shouldRender,
    translationOverlayContext.translatedByIndex,
  ]);

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

    const sourceWidth = Math.max(1, canvas.width);
    const sourceHeight = Math.max(1, canvas.height);
    if (!sourceWidth || !sourceHeight) {
      setTranslatedLinePalette(new Map());
      return;
    }

    const maxSampleSide = 2400;
    const sampleScale = Math.min(1, maxSampleSide / Math.max(sourceWidth, sourceHeight));
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = Math.max(1, Math.round(sourceWidth * sampleScale));
    sampleCanvas.height = Math.max(1, Math.round(sourceHeight * sampleScale));

    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      setTranslatedLinePalette(new Map());
      return;
    }

    context.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);

    const next = new Map<number, OverlayPalette>();
    currentPageOCR.lines.forEach((line, index) => {
      if (!translationOverlayContext.translatedByIndex.has(index)) return;
      const translatedText = translationOverlayContext.translatedByIndex.get(index) || '';
      if (shouldSkipOverlayRenderForSuspiciousLine(line) && !isSourceFallbackOverlayText(line.text, translatedText)) return;
      next.set(index, sampleOverlayPaletteFromLine(
        context,
        line,
        currentPageOCR.width,
        currentPageOCR.height,
        sampleCanvas.width,
        sampleCanvas.height
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
  }, [currentPageOCR, currentPage, pageRenderTick]);

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
      const documentType = translationMode === 'official' || translationMode === 'adaptive' ? 'document' : 'manga';
      
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
    // Allow panning with Hand tool OR Middle Mouse Button (button 1) OR Ctrl+Left Click
    if (activeTool === 'hand' || e.button === 1 || e.ctrlKey) { 
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
                      if (hiddenLineIndexes.has(idx)) {
                        return null;
                      }
                      const layer = currentPageLayers.find(l => l.lineIndex === idx);
                      const translatedText = layer
                        ? (translationPreviewMode === 'original' ? (layer.sourceText || layer.text) : layer.text)
                        : translationOverlayContext.translatedByIndex.get(idx);
                      if (!translatedText) return null;
                      if (!layer && shouldSkipOverlayRenderForSuspiciousLine(line) && !isSourceFallbackOverlayText(line.text, translatedText)) {
                        return null;
                      }

                      const layout = overlayLayoutByIndex.get(idx);
                      const isMaskOnlyLine = layer ? false : Boolean(layout?.hidden);
                      if (isMaskOnlyLine && !layout?.preserveMaskWhenHidden) {
                        return null;
                      }
                      const renderText = layer
                        ? (translationPreviewMode === 'original' ? (layer.sourceText || layer.text) : layer.text)
                        : (layout?.renderText || translatedText);
                      const effectiveProfile = layout?.effectiveProfile || overlayLayoutProfile;
                      const styleKind = layout?.styleKind;
                      const isDocumentLikeOverlay = styleKind
                        ? styleKind === 'document-heading' || styleKind === 'document-body'
                        : effectiveProfile === 'official';
                      const isComicLikeOverlay = !isDocumentLikeOverlay;
                      const maskBbox = layer ? layer.bbox : (((!isMaskOnlyLine && layout?.mergedMaskBBox) || resolveOverlayMaskBBox(line)));
                      const resolvedSourceBbox = layer ? layer.bbox : resolveOverlaySourceBBox(line);
                      const sourceWidthRaw = Math.max(1, resolvedSourceBbox.x1 - resolvedSourceBbox.x0);
                      const sourceHeightRaw = Math.max(1, resolvedSourceBbox.y1 - resolvedSourceBbox.y0);
                      const sourceAreaRaw = sourceWidthRaw * sourceHeightRaw;
                      const maskWidthRaw = Math.max(1, maskBbox.x1 - maskBbox.x0);
                      const maskHeightRaw = Math.max(1, maskBbox.y1 - maskBbox.y0);
                      const maskAreaRaw = maskWidthRaw * maskHeightRaw;
                      const widthCoverage = sourceWidthRaw / maskWidthRaw;
                      const areaCoverage = sourceAreaRaw / maskAreaRaw;
                      const lowCoverageSource = shouldUseDocumentCoverageFallback(line.text)
                        && widthCoverage < 0.84
                        && areaCoverage < 0.86;
                      const sourceBbox = layer
                        ? layer.bbox
                        : (isMaskOnlyLine
                          ? resolvedSourceBbox
                          : (layout?.mergedBBox || (isDocumentLikeOverlay || lowCoverageSource ? maskBbox : resolvedSourceBbox)));
                      const maskRenderSourceLeft = maskBbox.x0;
                      const renderSourceLeft = layout?.alignment === 'left' && layout.sharedBoxLeftX !== undefined
                        ? Math.min(sourceBbox.x0, layout.sharedBoxLeftX)
                        : sourceBbox.x0;
                      const maskBaseWidth = Math.max(1, (maskBbox.x1 - maskRenderSourceLeft) * ocrOverlayTransform.scaleX);
                      const maskBaseHeight = Math.max(1, (maskBbox.y1 - maskBbox.y0) * ocrOverlayTransform.scaleY);
                      const baseWidth = Math.max(1, (sourceBbox.x1 - renderSourceLeft) * ocrOverlayTransform.scaleX);
                      const baseHeight = Math.max(1, (sourceBbox.y1 - sourceBbox.y0) * ocrOverlayTransform.scaleY);
                      const hasThaiText = /[\u0E00-\u0E7F]/.test(renderText);
                      const expansion = resolveOverlayMaskExpansion(line);
                      const mergedMaskBoost = isComicLikeOverlay && layout?.mergedBBox ? 4 : 0;
                      const comicMaskBoostX = isComicLikeOverlay ? 3 : 0;
                      const comicMaskBoostTop = isComicLikeOverlay ? 3 : 0;
                      const comicMaskBoostBottom = isComicLikeOverlay ? 2 : 0;
                      const maskExpandX = Math.min(
                        expansion.maxExpandX + mergedMaskBoost + comicMaskBoostX,
                        Math.max(1, Math.round(maskBaseHeight * expansion.expandXRatio)) + mergedMaskBoost + comicMaskBoostX
                      );
                      const maskExpandLeft = Math.min(isComicLikeOverlay ? 4 : 1, maskExpandX);
                      const maskExpandRight = maskExpandX;
                      const maskExpandTop = Math.min(
                        expansion.maxExpandTop + mergedMaskBoost + comicMaskBoostTop,
                        Math.max(1, Math.round(maskBaseHeight * expansion.expandTopRatio)) + mergedMaskBoost + comicMaskBoostTop
                      );
                      const thaiBottomBoost = hasThaiText ? Math.min(3, Math.max(1, Math.round(maskBaseHeight * 0.08))) : 0;
                      const documentBottomBoost = isDocumentLikeOverlay
                        ? Math.min(8, Math.max(2, Math.round(maskBaseHeight * 0.16)))
                        : 0;
                      const maskExpandBottom = Math.min(
                        expansion.maxExpandBottom + thaiBottomBoost + documentBottomBoost + mergedMaskBoost + comicMaskBoostBottom,
                        Math.max(1, Math.round(maskBaseHeight * expansion.expandBottomRatio)) + thaiBottomBoost + documentBottomBoost + mergedMaskBoost + comicMaskBoostBottom
                      );
                      const rawMaskLeft = ocrOverlayTransform.offsetX + maskRenderSourceLeft * ocrOverlayTransform.scaleX - maskExpandLeft;
                      const rawMaskTop = ocrOverlayTransform.offsetY + maskBbox.y0 * ocrOverlayTransform.scaleY - maskExpandTop;
                      const rawMaskWidth = maskBaseWidth + maskExpandLeft + maskExpandRight;
                      const rawMaskHeight = maskBaseHeight + maskExpandTop + maskExpandBottom;
                      const maskRect = clampOverlayRect(rawMaskLeft, rawMaskTop, rawMaskWidth, rawMaskHeight, {
                        x0: ocrOverlayTransform.offsetX,
                        y0: ocrOverlayTransform.offsetY,
                        x1: ocrOverlayTransform.offsetX + currentPageOCR.width * ocrOverlayTransform.scaleX,
                        y1: ocrOverlayTransform.offsetY + currentPageOCR.height * ocrOverlayTransform.scaleY,
                      });
                      const useMergedComicTextRect = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && !isMaskOnlyLine && Boolean(layout?.mergedMaskBBox);
                      const textSourceLeft = useMergedComicTextRect ? maskRenderSourceLeft : renderSourceLeft;
                      const textSourceTop = useMergedComicTextRect ? maskBbox.y0 : sourceBbox.y0;
                      const textBaseWidth = useMergedComicTextRect ? Math.max(baseWidth, maskBaseWidth) : baseWidth;
                      const textBaseHeight = useMergedComicTextRect ? Math.max(baseHeight, maskBaseHeight) : baseHeight;
                      const mergedComicTextTopLift = useMergedComicTextRect ? Math.max(0, Math.round(maskBaseHeight * (styleKind === 'comic-bubble' ? 0.08 : 0.05))) : 0;
                      const mergedComicTextExtraHeight = useMergedComicTextRect ? Math.max(0, Math.round(maskBaseHeight * (styleKind === 'comic-bubble' ? 0.34 : 0.18))) : 0;
                      const rawTextLeft = ocrOverlayTransform.offsetX + textSourceLeft * ocrOverlayTransform.scaleX - (layout?.alignment === 'center' ? 0 : maskExpandLeft);
                      const rawTextTop = ocrOverlayTransform.offsetY + textSourceTop * ocrOverlayTransform.scaleY - maskExpandTop - mergedComicTextTopLift;
                      const rawTextWidth = textBaseWidth + (layout?.alignment === 'center' ? 0 : maskExpandLeft + maskExpandRight);
                      const rawTextHeight = textBaseHeight + maskExpandTop + maskExpandBottom + mergedComicTextTopLift + mergedComicTextExtraHeight;
                      let textRect = clampOverlayRect(rawTextLeft, rawTextTop, rawTextWidth, rawTextHeight, {
                        x0: ocrOverlayTransform.offsetX,
                        y0: ocrOverlayTransform.offsetY,
                        x1: ocrOverlayTransform.offsetX + currentPageOCR.width * ocrOverlayTransform.scaleX,
                        y1: ocrOverlayTransform.offsetY + currentPageOCR.height * ocrOverlayTransform.scaleY,
                      });
                      if (!isDocumentLikeOverlay) {
                        textRect = clampOverlayRect(textRect.left, textRect.top, textRect.width, textRect.height, {
                          x0: Math.max(ocrOverlayTransform.offsetX, maskRect.left - 1),
                          y0: Math.max(ocrOverlayTransform.offsetY, maskRect.top - 1),
                          x1: Math.min(ocrOverlayTransform.offsetX + currentPageOCR.width * ocrOverlayTransform.scaleX, maskRect.left + maskRect.width + 1),
                          y1: Math.min(ocrOverlayTransform.offsetY + currentPageOCR.height * ocrOverlayTransform.scaleY, maskRect.top + maskRect.height + 1),
                        });
                      }
                      const palette = translatedLinePalette.get(idx) || DEFAULT_OVERLAY_PALETTE;
                      const continuationPalette = layout?.highlightTextColorSourceIndex !== undefined
                        ? (translatedLinePalette.get(layout.highlightTextColorSourceIndex) || palette)
                        : palette;
                      const maskBackgroundColor = layer?.backgroundColor !== undefined ? layer.backgroundColor : palette.backgroundColor;
                      const thaiDocumentHeadroom = isDocumentLikeOverlay && hasThaiText
                        ? Math.max(4, Math.round(Math.max(baseHeight, maskBaseHeight) * 0.4))
                        : 0;
                      const documentTypographyWidth = lowCoverageSource
                        ? Math.max(baseWidth, maskBaseWidth)
                        : Math.max(baseWidth, textRect.width * 0.96);
                      const typographyWidth = isDocumentLikeOverlay ? documentTypographyWidth : textRect.width;
                      const typographyHeight = isDocumentLikeOverlay
                        ? Math.min(
                          textRect.height,
                          Math.max(baseHeight + thaiDocumentHeadroom, (lowCoverageSource ? maskBaseHeight : baseHeight) + thaiDocumentHeadroom)
                        )
                        : textRect.height;
                      const baseTypography = layout?.typography || computeOverlayTypography(renderText, typographyWidth, typographyHeight, {
                        sourceText: line.text,
                        sourceBoxWidth: isDocumentLikeOverlay && lowCoverageSource ? Math.max(baseWidth, maskBaseWidth) : baseWidth,
                        sourceBoxHeight: isDocumentLikeOverlay
                          ? (lowCoverageSource ? Math.max(baseHeight, maskBaseHeight) : baseHeight) + thaiDocumentHeadroom
                          : baseHeight,
                        sourceLineCount: 1,
                        fontFamily: overlayFontFamily,
                        profile: effectiveProfile,
                        styleKind,
                      });
                      const typography = scaleOverlayTypography(baseTypography, overlayFontSizeScale);
                      if (layer) {
                        typography.fontSize = (layer.fontSize || 14) * ocrOverlayTransform.scaleX;
                      }
                      const extraTopPad = hasThaiText ? Math.max(1, Math.round(typography.fontSize * 0.08)) : 0;
                      const extraBottomPad = hasThaiText ? Math.max(1, Math.round(typography.fontSize * 0.06)) : 0;
                      const textStartOffset = layout?.sharedTextStartX !== undefined
                        ? Math.max(0, (layout.sharedTextStartX - renderSourceLeft) * ocrOverlayTransform.scaleX)
                        : 0;
                      const centerOffset = layout?.sharedCenterX !== undefined
                        ? ((layout.sharedCenterX - renderSourceLeft) * ocrOverlayTransform.scaleX) - (textRect.width * 0.5)
                        : 0;
                      const innerLeft = layout?.alignment === 'center'
                        ? Math.max(0, Math.min(textRect.width * 0.12, centerOffset))
                        : Math.max(0, Math.min(textRect.width - 1, maskExpandLeft + textStartOffset));
                      const innerWidth = layout?.alignment === 'center'
                        ? textRect.width
                        : Math.max(1, textRect.width - innerLeft);
                      const overlayText = typography.forceSingleLine
                        ? normalizeOverlayInlineText(renderText)
                        : renderText;
                      const highlightContinuationText = layout?.highlightContinuationText
                        ? (typography.forceSingleLine
                          ? normalizeOverlayInlineText(layout.highlightContinuationText)
                          : layout.highlightContinuationText)
                        : '';
                      
                      const layerTextColor = layer?.textColor !== undefined ? layer.textColor : palette.textColor;
                      const layerContinuationColor = layer?.textColor !== undefined ? layer.textColor : continuationPalette.textColor;
                      const overlayContent = renderOverlayTextWithSearchHighlight(
                        overlayText,
                        highlightContinuationText,
                        layerTextColor,
                        layerContinuationColor,
                        overlaySearchPattern
                      );
                      const overlayStrokeBaseWidth = Number(palette.textStrokeWidth || 0);
                      const overlayStrokeWidth = overlayStrokeBaseWidth > 0
                        ? Math.max(0.55, Math.min(1.35, overlayStrokeBaseWidth * (typography.fontSize / 14)))
                        : 0;
                      const overlayTextWeight = Math.max(400, Math.min(700, Math.round(Number(palette.textFillWeight || 400))));
                      const rotationDeg = layer ? (layer.rotation || 0) : estimateLineRotationDeg(line);
                      const rotationOrigin = layer ? 'center center' : 'left top';
                      const thaiComicLine = hasThaiText && (styleKind === 'comic-bubble' || styleKind === 'comic-box');
                      const minFillRatio = typography.estimatedLines > 1
                        ? (thaiComicLine ? 0.82 : 0.74)
                        : (thaiComicLine ? 0.58 : 0.5);
                      const paintHeight = Math.min(
                        textRect.height,
                        Math.max(
                          typography.contentHeight + typography.padY * 2 + extraTopPad + extraBottomPad,
                          textRect.height * minFillRatio
                        )
                      );
                      const paintOffsetTop = Math.max(
                        hasThaiText ? 1 : 0,
                        Math.min(textRect.height - paintHeight, Math.round(textRect.height * (thaiComicLine ? 0.04 : 0.08)))
                      );

                      const widthRatio = textRect.width / Math.max(1, baseWidth);
                      const heightRatio = paintHeight / Math.max(1, baseHeight);

                      return (
                        <React.Fragment key={`ocr-translation-line-${idx}`}>
                          <div
                            style={{
                              left: maskRect.left,
                              top: maskRect.top,
                              width: maskRect.width,
                              maxWidth: maskRect.width,
                              minWidth: maskRect.width,
                              height: maskRect.height,
                              maxHeight: maskRect.height,
                              minHeight: maskRect.height,
                              backgroundColor: maskBackgroundColor,
                              overflow: 'hidden',
                              zIndex: Math.max(1, Math.round(maskRect.top)),
                              transform: rotationDeg !== 0 ? `rotate(${rotationDeg.toFixed(2)}deg)` : undefined,
                              transformOrigin: rotationDeg !== 0 ? rotationOrigin : undefined,
                            }}
                            className="absolute"
                          />
                          {isMaskOnlyLine ? null : (
                            <div
                              style={{
                                left: textRect.left,
                                top: textRect.top,
                                width: textRect.width,
                                maxWidth: textRect.width,
                                minWidth: textRect.width,
                                height: textRect.height,
                                maxHeight: textRect.height,
                                minHeight: textRect.height,
                                overflow: 'hidden',
                                zIndex: 1000 + Math.max(1, Math.round(textRect.top)),
                                transform: rotationDeg !== 0 ? `rotate(${rotationDeg.toFixed(2)}deg)` : undefined,
                                transformOrigin: rotationDeg !== 0 ? rotationOrigin : undefined,
                              }}
                              className="absolute"
                            >
                              <div
                                style={{
                                  position: 'absolute',
                                  left: innerLeft,
                                  top: paintOffsetTop,
                                  width: innerWidth,
                                  maxWidth: innerWidth,
                                  minWidth: innerWidth,
                                  height: paintHeight,
                                  maxHeight: paintHeight,
                                  minHeight: paintHeight,
                                  padding: `${typography.padY + extraTopPad}px ${typography.padX}px ${typography.padY + extraBottomPad}px ${typography.padX}px`,
                                  color: layerTextColor,
                                  fontSize: typography.fontSize,
                                  lineHeight: typography.lineHeight,
                                  fontFamily: overlayFontFamily,
                                  fontWeight: layer?.bold ? 'bold' : overlayTextWeight,
                                  boxSizing: 'border-box',
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  textAlign: layout?.alignment === 'center' ? 'center' : 'left',
                                  whiteSpace: typography.forceSingleLine ? 'nowrap' : 'normal',
                                  wordBreak: 'normal',
                                  lineBreak: hasThaiText ? 'auto' : 'normal',
                                  WebkitTextStrokeWidth: overlayStrokeWidth > 0 ? `${overlayStrokeWidth.toFixed(2)}px` : undefined,
                                  WebkitTextStrokeColor: overlayStrokeWidth > 0 ? palette.textStrokeColor : undefined,
                                  textShadow: palette.textShadow,
                                  overflowWrap: typography.forceSingleLine
                                    ? 'normal'
                                    : (hasThaiText ? 'normal' : 'break-word'),
                                  overflow: 'hidden',
                                }}
                              >
                                    {overlayContent}
                              </div>
                              {showDebugOverlay ? (
                                <>
                                  <div
                                    style={{
                                      position: 'absolute',
                                      left: 0,
                                      top: 0,
                                      width: textRect.width,
                                      height: textRect.height,
                                      border: '1px solid rgba(34, 211, 238, 0.8)',
                                      boxSizing: 'border-box',
                                    }}
                                  />
                                  <div
                                    style={{
                                      position: 'absolute',
                                      left: 2,
                                      top: -16,
                                      padding: '1px 4px',
                                      borderRadius: 4,
                                      background: 'rgba(8, 19, 33, 0.9)',
                                      color: '#67e8f9',
                                      fontSize: 9,
                                      lineHeight: 1.1,
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {`W ${formatOverlayRatioLabel(widthRatio)} · H ${formatOverlayRatioLabel(heightRatio)}`}
                                  </div>
                                </>
                              ) : null}
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
                {translationPreviewMode === 'original' && currentPageOCR && originalOCRMatchedLineIndexes.length > 0 && (
                  <div className="absolute inset-0 pointer-events-none">
                    {originalOCRMatchedLineIndexes.map((lineIndex) => {
                      const line = currentPageOCR.lines[lineIndex];
                      if (!line) return null;

                      const sourceBBox = resolveOverlaySourceBBox(line);
                      const rawLeft = ocrOverlayTransform.offsetX + sourceBBox.x0 * ocrOverlayTransform.scaleX - 2;
                      const rawTop = ocrOverlayTransform.offsetY + sourceBBox.y0 * ocrOverlayTransform.scaleY - 2;
                      const rawWidth = Math.max(1, (sourceBBox.x1 - sourceBBox.x0) * ocrOverlayTransform.scaleX + 4);
                      const rawHeight = Math.max(1, (sourceBBox.y1 - sourceBBox.y0) * ocrOverlayTransform.scaleY + 4);
                      const rect = clampOverlayRect(rawLeft, rawTop, rawWidth, rawHeight, {
                        x0: ocrOverlayTransform.offsetX,
                        y0: ocrOverlayTransform.offsetY,
                        x1: ocrOverlayTransform.offsetX + currentPageOCR.width * ocrOverlayTransform.scaleX,
                        y1: ocrOverlayTransform.offsetY + currentPageOCR.height * ocrOverlayTransform.scaleY,
                      });

                      return (
                        <div
                          key={`ocr-original-search-${lineIndex}`}
                          style={{
                            left: rect.left,
                            top: rect.top,
                            width: rect.width,
                            height: rect.height,
                          }}
                          className="absolute rounded-sm border border-amber-500/90 bg-amber-300/40"
                        />
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
                {/* Phase 3: Interactive Layer Manipulation Overlay */}
                <InteractiveLayerOverlay
                  pageNum={currentPage}
                  layers={currentPageLayers}
                  groups={currentPageGroups}
                  ocrTransform={ocrOverlayTransform}
                  isActive={activeTool === 'select' || activeTool === 'region'}
                />
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
