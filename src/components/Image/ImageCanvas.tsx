import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import {
  clampOverlayRect,
  computeOverlayTypography,
  computeOverlayLayoutMap,
  DEFAULT_OVERLAY_PALETTE,
  estimateLineRotationDeg,
  normalizeOverlayInlineText,
  resolveOverlayMaskExpansion,
  type OverlayLayout,
  type OverlayLayoutProfile,
  resolveTranslationOverlayContext,
  resolveOverlaySourceBBox,
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
    ocrByPageEngine,
    showDebugOverlay,
    options,
    translationPreviewMode,
    translationCacheByPage,
    activeTranslationKeyByPage,
  } = useOCRTextLayerStore();
  const selectedEngine = (options.engine || 'tesseract');
  const currentPageOCR = ocrByPageEngine.get(currentPage)?.get(selectedEngine)
    || ocrByPageEngine.get(1)?.get(selectedEngine)
    || allPagesOCR.get(currentPage)
    || allPagesOCR.get(1);
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
  const overlayLayoutProfile: OverlayLayoutProfile = translationMode === 'official'
    ? 'official'
    : translationMode === 'manhwa'
      ? 'manhwa'
      : 'manga';
  const overlayLayoutByIndex = useMemo(() => {
    if (!translationOverlayContext.shouldRender || !currentPageOCR || imageDisplaySize.width <= 0 || imageDisplaySize.height <= 0) {
      return new Map<number, OverlayLayout>();
    }

    return computeOverlayLayoutMap(
      currentPageOCR.lines.flatMap((line, index) => {
        const translatedText = translationOverlayContext.translatedByIndex.get(index);
        if (!translatedText) return [];

        const sourceBbox = resolveOverlaySourceBBox(line);
        const baseWidth = Math.max(1, (sourceBbox.x1 - sourceBbox.x0) * ocrScaleX);
        const baseHeight = Math.max(1, (sourceBbox.y1 - sourceBbox.y0) * ocrScaleY);
        const expansion = resolveOverlayMaskExpansion(line);
        const maskExpandX = Math.min(expansion.maxExpandX, Math.max(1, Math.round(baseHeight * expansion.expandXRatio)));
        const maskExpandTop = Math.min(expansion.maxExpandTop, Math.max(1, Math.round(baseHeight * expansion.expandTopRatio)));
        const maskExpandBottom = Math.min(expansion.maxExpandBottom, Math.max(1, Math.round(baseHeight * expansion.expandBottomRatio)));
        const rawLeft = sourceBbox.x0 * ocrScaleX - maskExpandX;
        const rawTop = sourceBbox.y0 * ocrScaleY - maskExpandTop;
        const rawWidth = baseWidth + maskExpandX * 2;
        const rawHeight = baseHeight + maskExpandTop + maskExpandBottom;
        const rect = clampOverlayRect(rawLeft, rawTop, rawWidth, rawHeight, {
          x0: 0,
          y0: 0,
          x1: imageDisplaySize.width,
          y1: imageDisplaySize.height,
        });

        return [{
          index,
          text: translatedText,
          width: rect.width,
          height: rect.height,
          bbox: sourceBbox,
          line,
          hints: {
            sourceText: line.text,
            sourceBoxWidth: Math.max(1, sourceBbox.x1 - sourceBbox.x0),
            sourceBoxHeight: Math.max(1, sourceBbox.y1 - sourceBbox.y0),
            fontFamily: overlayFontFamily,
          },
        }];
      }),
      { profile: overlayLayoutProfile }
    );
  }, [
    currentPageOCR,
    imageDisplaySize.height,
    imageDisplaySize.width,
    ocrScaleX,
    ocrScaleY,
    overlayLayoutProfile,
    overlayFontFamily,
    translationOverlayContext.shouldRender,
    translationOverlayContext.translatedByIndex,
  ]);

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

                  const layout = overlayLayoutByIndex.get(idx);
                  const sourceBbox = resolveOverlaySourceBBox(line);
                  const renderSourceLeft = layout?.alignment === 'left' && layout.sharedBoxLeftX !== undefined
                    ? Math.min(sourceBbox.x0, layout.sharedBoxLeftX)
                    : sourceBbox.x0;
                  const baseWidth = Math.max(1, (sourceBbox.x1 - renderSourceLeft) * ocrScaleX);
                  const baseHeight = Math.max(1, (sourceBbox.y1 - sourceBbox.y0) * ocrScaleY);
                  const hasThaiText = /[\u0E00-\u0E7F]/.test(translatedText);
                  const expansion = resolveOverlayMaskExpansion(line);
                  const maskExpandX = Math.min(expansion.maxExpandX, Math.max(1, Math.round(baseHeight * expansion.expandXRatio)));
                  const maskExpandLeft = Math.min(1, maskExpandX);
                  const maskExpandRight = maskExpandX;
                  const maskExpandTop = Math.min(expansion.maxExpandTop, Math.max(1, Math.round(baseHeight * expansion.expandTopRatio)));
                  const thaiBottomBoost = hasThaiText ? Math.min(3, Math.max(1, Math.round(baseHeight * 0.08))) : 0;
                  const maskExpandBottom = Math.min(
                    expansion.maxExpandBottom + thaiBottomBoost,
                    Math.max(1, Math.round(baseHeight * expansion.expandBottomRatio)) + thaiBottomBoost
                  );
                  const rawLeft = renderSourceLeft * ocrScaleX - maskExpandLeft;
                  const rawTop = sourceBbox.y0 * ocrScaleY - maskExpandTop;
                  const rawWidth = baseWidth + maskExpandLeft + maskExpandRight;
                  const rawHeight = baseHeight + maskExpandTop + maskExpandBottom;
                  const rect = clampOverlayRect(rawLeft, rawTop, rawWidth, rawHeight, {
                    x0: 0,
                    y0: 0,
                    x1: imageDisplaySize.width,
                    y1: imageDisplaySize.height,
                  });
                  const palette = translatedLinePalette.get(idx) || DEFAULT_OVERLAY_PALETTE;
                  const typography = layout?.typography || computeOverlayTypography(translatedText, rect.width, rect.height, {
                    sourceText: line.text,
                    sourceBoxWidth: Math.max(1, sourceBbox.x1 - sourceBbox.x0),
                    sourceBoxHeight: Math.max(1, sourceBbox.y1 - sourceBbox.y0),
                    fontFamily: overlayFontFamily,
                  });
                  const extraTopPad = hasThaiText ? Math.max(2, Math.round(typography.fontSize * 0.11)) : 0;
                  const extraBottomPad = hasThaiText ? Math.max(1, Math.round(typography.fontSize * 0.08)) : 0;
                  const textStartOffset = layout?.sharedTextStartX !== undefined
                    ? Math.max(0, (layout.sharedTextStartX - renderSourceLeft) * ocrScaleX)
                    : 0;
                  const centerOffset = layout?.sharedCenterX !== undefined
                    ? ((layout.sharedCenterX - renderSourceLeft) * ocrScaleX) - (rect.width * 0.5)
                    : 0;
                  const innerLeft = layout?.alignment === 'center'
                    ? Math.max(0, Math.min(rect.width * 0.12, centerOffset))
                    : Math.max(0, Math.min(rect.width - 1, maskExpandLeft + textStartOffset));
                  const innerWidth = layout?.alignment === 'center'
                    ? rect.width
                    : Math.max(1, rect.width - innerLeft);
                  const overlayText = typography.forceSingleLine
                    ? normalizeOverlayInlineText(translatedText)
                    : translatedText;
                  const rotationDeg = estimateLineRotationDeg(line);
                  const minFillRatio = typography.estimatedLines > 1 ? 0.74 : 0.5;
                  const paintHeight = Math.min(
                    rect.height,
                    Math.max(
                      typography.contentHeight + typography.padY * 2 + extraTopPad + extraBottomPad,
                      rect.height * minFillRatio
                    )
                  );
                  const paintOffsetTop = Math.max(
                    hasThaiText ? 1 : 0,
                    Math.min(rect.height - paintHeight, Math.round(rect.height * 0.08))
                  );

                  return (
                    <div
                      key={`ocr-translation-line-${idx}`}
                      style={{
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        maxWidth: rect.width,
                        minWidth: rect.width,
                        height: rect.height,
                        maxHeight: rect.height,
                        minHeight: rect.height,
                        backgroundColor: palette.backgroundColor,
                        overflow: 'hidden',
                        zIndex: Math.max(1, 100000 - Math.round(rect.top)),
                        transform: rotationDeg !== 0 ? `rotate(${rotationDeg.toFixed(2)}deg)` : undefined,
                        transformOrigin: rotationDeg !== 0 ? 'left top' : undefined,
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
                          boxSizing: 'border-box',
                          display: 'flex',
                          alignItems: 'flex-start',
                          color: palette.textColor,
                          fontSize: typography.fontSize,
                          lineHeight: typography.lineHeight,
                          fontFamily: overlayFontFamily,
                          textAlign: layout?.alignment === 'center' ? 'center' : 'left',
                          whiteSpace: typography.forceSingleLine ? 'nowrap' : 'normal',
                          wordBreak: 'normal',
                          overflowWrap: typography.forceSingleLine ? 'normal' : 'break-word',
                          overflow: 'hidden',
                        }}
                      >
                        {overlayText}
                      </div>
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
