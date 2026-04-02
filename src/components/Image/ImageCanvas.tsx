import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import {
  clampOverlayRect,
  computeOverlayTypography,
  DEFAULT_OVERLAY_PALETTE,
  estimateLineRotationDeg,
  resolveTranslationOverlayContext,
  sampleOverlayPaletteFromLine,
} from '../OCR/translationOverlayUtils';
import { resolveOverlayFontFamily } from '../../constants/overlayFonts';

export const ImageCanvas: React.FC = () => {
  const {
    fileUrl,
    currentPage,
    sourceLanguage,
    targetLanguage,
    translationMode,
    overlayThaiFontEnabled,
    overlayFontPreset,
  } = useProjectStore();
  const { zoom, pan, setZoom, setPan, activeTool } = useUIStore();
  const {
    allPagesOCR,
    showDebugOverlay,
    options,
    translationPreviewMode,
    translationCacheByPage,
    activeTranslationKeyByPage,
  } = useOCRTextLayerStore();
  const currentPageOCR = allPagesOCR.get(currentPage) || allPagesOCR.get(1);
  const currentPageTranslationMap = translationCacheByPage.get(currentPage) || translationCacheByPage.get(1);
  const activeTranslationKey = activeTranslationKeyByPage.get(currentPage) || activeTranslationKeyByPage.get(1);
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
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const stateRef = useRef({ zoom, pan });
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 0, height: 0 });
  const [translatedLinePalette, setTranslatedLinePalette] = useState<Map<number, { backgroundColor: string; textColor: string }>>(new Map());

  useEffect(() => {
    if (!translationOverlayContext.shouldRender || !currentPageOCR || !imageRef.current) {
      setTranslatedLinePalette(new Map());
      return;
    }

    const img = imageRef.current;
    if (!img.naturalWidth || !img.naturalHeight) {
      setTranslatedLinePalette(new Map());
      return;
    }

    const maxSampleSide = 2400;
    const sampleScale = Math.min(1, maxSampleSide / Math.max(img.naturalWidth, img.naturalHeight));
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = Math.max(1, Math.round(img.naturalWidth * sampleScale));
    sampleCanvas.height = Math.max(1, Math.round(img.naturalHeight * sampleScale));

    const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      setTranslatedLinePalette(new Map());
      return;
    }

    context.drawImage(img, 0, 0, sampleCanvas.width, sampleCanvas.height);

    const next = new Map<number, { backgroundColor: string; textColor: string }>();
    currentPageOCR.lines.forEach((line, index) => {
      if (!translationOverlayContext.translatedByIndex.has(index)) return;
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
    currentPageOCR,
    translationOverlayContext.entry?.key,
    translationOverlayContext.shouldRender,
    translationOverlayContext.translatedByIndex,
  ]);

  useEffect(() => {
    stateRef.current = { zoom, pan };
    if (!isDragging) {
      panRef.current = pan;
    }
  }, [zoom, pan, isDragging]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    }
  }, [pan, zoom]);

  // Manual Event Listener for Wheel (Non-Passive)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const scaleAmount = -e.deltaY * 0.001;
        const newZoom = Math.min(Math.max(0.1, stateRef.current.zoom + scaleAmount), 5);
        setZoom(newZoom);
      } else {
        setPan(stateRef.current.pan.x - e.deltaX, stateRef.current.pan.y - e.deltaY);
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [setZoom, setPan]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'hand' || e.button === 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    panRef.current = { x: newX, y: newY };
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${newX}px, ${newY}px) scale(${stateRef.current.zoom})`;
    }
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    setPan(panRef.current.x, panRef.current.y);
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const { naturalWidth, naturalHeight } = img;
    const container = containerRef.current;
    if (!container) return;

    const { clientWidth, clientHeight } = container;
    const scaleX = (clientWidth - 40) / naturalWidth;
    const scaleY = (clientHeight - 40) / naturalHeight;
    const fitScale = Math.min(scaleX, scaleY, 1);
    if (stateRef.current.zoom === 1) {
      setZoom(fitScale);
    }
    const scaledWidth = naturalWidth * fitScale;
    const x = (clientWidth - scaledWidth) / 2;
    setPan(x, 20);
    setImageDisplaySize({
      width: img.clientWidth || naturalWidth,
      height: img.clientHeight || naturalHeight,
    });
  };

  const ocrScaleX = currentPageOCR && imageDisplaySize.width > 0
    ? imageDisplaySize.width / Math.max(1, currentPageOCR.width)
    : 1;
  const ocrScaleY = currentPageOCR && imageDisplaySize.height > 0
    ? imageDisplaySize.height / Math.max(1, currentPageOCR.height)
    : 1;

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
        {fileUrl ? (
          <div className="relative inline-block">
            <img
              ref={imageRef}
              src={fileUrl}
              alt="Loaded document"
              onLoad={handleImageLoad}
              draggable={false}
              className="max-w-none border border-slate-700 bg-white shadow-2xl select-none block"
            />
            {translationOverlayContext.shouldRender && currentPageOCR && imageDisplaySize.width > 0 && imageDisplaySize.height > 0 && (
              <div className="absolute inset-0 pointer-events-none">
                {currentPageOCR.lines.map((line, idx) => {
                  const translatedText = translationOverlayContext.translatedByIndex.get(idx);
                  if (!translatedText) return null;

                  const rawLeft = line.bbox.x0 * ocrScaleX;
                  const rawTop = line.bbox.y0 * ocrScaleY;
                  const rawWidth = Math.max(1, (line.bbox.x1 - line.bbox.x0) * ocrScaleX);
                  const rawHeight = Math.max(1, (line.bbox.y1 - line.bbox.y0) * ocrScaleY);
                  const rect = clampOverlayRect(rawLeft, rawTop, rawWidth, rawHeight, {
                    x0: 0,
                    y0: 0,
                    x1: imageDisplaySize.width,
                    y1: imageDisplaySize.height,
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
            {debugPageOCR && (
              <div className="absolute inset-0 pointer-events-none">
                {debugPageOCR.words.map((word, idx) => (
                  <div
                    key={`ocr-word-${idx}`}
                    style={{
                      left: word.bbox.x0 * ocrScaleX,
                      top: word.bbox.y0 * ocrScaleY,
                      width: Math.max(1, (word.bbox.x1 - word.bbox.x0) * ocrScaleX),
                      height: Math.max(1, (word.bbox.y1 - word.bbox.y0) * ocrScaleY)
                    }}
                    className="absolute border border-red-400/60"
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-slate-500 p-6">Loading image...</div>
        )}
      </div>
    </div>
  );
};
