import { useCallback } from 'react';
import { useProjectStore } from '../stores/useProjectStore';
import { useOCRTextLayerStore } from '../stores/useOCRTextLayerStore';
import { useLayerStore } from '../stores/useLayerStore';
import { useExportStore } from '../stores/useExportStore';
import { OCRPageResult, OCREngine, OCRQualityProfile } from '../types';
import { DBOCRTranslationCacheEntry as OCRTranslationCacheEntry } from '../types/electron';
import { ExportOverlayPaletteEntry } from '../types/pdfExport';
import { searchablePDFService, exportTranslatedPdfViaPrint } from '../services/pdf';
import { pdfjs } from '../services/pdf/pdfjsWorker';
import {
  OverlayLayoutProfile,
  computeOverlayLayoutMap,
  resolveOverlaySourceBBox,
  resolveOverlayMaskBBox,
  resolveOverlayMaskExpansion,
  clampOverlayRect,
  computeOverlayTypography,
  normalizeOverlayInlineText,
  estimateLineRotationDeg,
  shouldSkipOverlayRenderForSuspiciousLine,
  sampleOverlayPaletteFromLine,
  DEFAULT_OVERLAY_PALETTE,
  OverlayPalette,
} from '../components/OCR/translationOverlayUtils';
import {
  getOverlayFontOption,
  getOverlayPrimaryFontName,
  resolveOverlayFontFamily,
} from '../constants/overlayFonts';
import {
  scaleOverlayTypography,
  resolveOverlayExportScale,
  shouldUseDocumentCoverageFallback,
  shouldSkipOverlayForUntranslatedCarryOver,
} from '../services/translation/offlineTranslationService';
import { normalizeWhitespace } from '../services/ocr/ocrTextNormalizer';
import { wrapCanvasText, buildCanvasFontFamily } from '../services/layout/canvasLayoutService';
import { isSourceFallbackOverlayText } from '../services/translation/textRedistributionService';

export type DownloadScope = 'current' | 'all';
export type DownloadContentMode = 'original' | 'translated';

export interface UseExportOrchestrationParams {
  popupOcrQualityMode: 'high' | 'fast';
  setTranslationStatus: (status: { kind: 'info' | 'success' | 'error'; message: string } | null) => void;
  selectedExportEngine: OCREngine | null;
  setIsDownloadingResult: (val: boolean) => void;
  setIsDownloadMenuOpen: (val: boolean) => void;
  setExportCacheHydrationTick: (fn: (prev: number) => number) => void;
  hydrateExportCachesForDownload: (engine: OCREngine) => Promise<void>;
  resolveModelScopedPagesForExport: (scope: DownloadScope, engine: OCREngine) => Array<{ pageNum: number; ocr: OCRPageResult }>;
  resolveTranslatedEntryForExport: (pageNum: number, ocr: OCRPageResult, engine: OCREngine) => OCRTranslationCacheEntry | null | undefined;
  buildTranslatedPageOCRForExport: (ocr: OCRPageResult, entry: OCRTranslationCacheEntry) => OCRPageResult;
  resolveVisibleOverlayExportSize: (pageNum: number) => { width: number; height: number } | null | undefined;
}

export function useExportOrchestration(params: UseExportOrchestrationParams) {
  const {
    popupOcrQualityMode,
    setTranslationStatus,
    selectedExportEngine,
    setIsDownloadingResult,
    setIsDownloadMenuOpen,
    setExportCacheHydrationTick,
    hydrateExportCachesForDownload,
    resolveModelScopedPagesForExport,
    resolveTranslatedEntryForExport,
    buildTranslatedPageOCRForExport,
    resolveVisibleOverlayExportSize,
  } = params;

  const file = useProjectStore((s) => s.file);
  const filePath = useProjectStore((s) => s.filePath);
  const fileType = useProjectStore((s) => s.fileType);
  const fileData = useProjectStore((s) => s.fileData);
  const currentPage = useProjectStore((s) => s.currentPage);
  const targetLanguage = useProjectStore((s) => s.targetLanguage);
  const translationMode = useProjectStore((s) => s.translationMode);
  const overlayThaiFontEnabled = useProjectStore((s) => s.overlayThaiFontEnabled);
  const overlayFontPreset = useProjectStore((s) => s.overlayFontPreset);
  const overlayFontSizeScale = useProjectStore((s) => s.overlayFontSizeScale);
  const ocrOptions = useOCRTextLayerStore((s) => s.options);
  const setOcrOptions = useOCRTextLayerStore((s) => s.setOptions);

  const popupQualityToProfile = (mode: 'high' | 'fast'): OCRQualityProfile =>
    mode === 'high' ? 'balanced' : 'fast';

  const applyPopupOcrQualityProfile = useCallback((mode: 'high' | 'fast' = popupOcrQualityMode) => {
    setOcrOptions({ ocrQualityProfile: popupQualityToProfile(mode) });
  }, [popupOcrQualityMode, setOcrOptions]);

  const buildPaletteByPageForExport = async (
    pageRange: number[],
    localSourcePageMap: Map<number, OCRPageResult>,
    localTranslatedEntryMap: Map<number, OCRTranslationCacheEntry>,
  ): Promise<Map<number, ExportOverlayPaletteEntry[]>> => {
    const paletteByPage = new Map<number, ExportOverlayPaletteEntry[]>();
    if (!file) return paletteByPage;

    const SAMPLE_MAX_SIDE = 1024;
    let pdfDocForSample: import('pdfjs-dist').PDFDocumentProxy | null = null;

    try {
      if (fileType === 'pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        pdfDocForSample = await (loadingTask as { promise: Promise<import('pdfjs-dist').PDFDocumentProxy> }).promise;
      }

      for (const pageNum of pageRange) {
        const pageOCR = localSourcePageMap.get(pageNum);
        const translatedEntry = localTranslatedEntryMap.get(pageNum);
        if (!pageOCR || !translatedEntry) continue;

        const translatedByIndex = new Map<number, string>(
          translatedEntry.translatedByIndex
            .filter((item) => Number.isFinite(item.index))
            .map((item) => [item.index, normalizeWhitespace(String(item.text || ''))])
        );
        if (translatedByIndex.size === 0) continue;

        const sampleCanvas = document.createElement('canvas');
        const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
        if (!sampleCtx) continue;

        try {
          if (fileType === 'pdf' && pdfDocForSample) {
            const page = await pdfDocForSample.getPage(pageNum);
            const baseViewport = page.getViewport({ scale: 1 });
            const scale = Math.min(SAMPLE_MAX_SIDE / Math.max(1, baseViewport.width), SAMPLE_MAX_SIDE / Math.max(1, baseViewport.height));
            const viewport = page.getViewport({ scale });
            sampleCanvas.width = Math.max(1, Math.round(viewport.width));
            sampleCanvas.height = Math.max(1, Math.round(viewport.height));
            sampleCtx.fillStyle = '#ffffff';
            sampleCtx.fillRect(0, 0, sampleCanvas.width, sampleCanvas.height);
            await page.render({ canvasContext: sampleCtx, viewport, canvas: sampleCanvas }).promise;
          } else if (fileType !== 'pdf') {
            const imageBlob = fileData
              ? new Blob([fileData as unknown as BlobPart], { type: file.type || 'image/png' })
              : file;
            const imageBitmap = await createImageBitmap(imageBlob);
            const scale = Math.min(SAMPLE_MAX_SIDE / Math.max(1, imageBitmap.width), SAMPLE_MAX_SIDE / Math.max(1, imageBitmap.height));
            sampleCanvas.width = Math.max(1, Math.round(imageBitmap.width * scale));
            sampleCanvas.height = Math.max(1, Math.round(imageBitmap.height * scale));
            sampleCtx.fillStyle = '#ffffff';
            sampleCtx.fillRect(0, 0, sampleCanvas.width, sampleCanvas.height);
            sampleCtx.drawImage(imageBitmap, 0, 0, sampleCanvas.width, sampleCanvas.height);
            imageBitmap.close?.();
          } else {
            continue;
          }

          const sourceWidth = Math.max(1, Number(pageOCR.width || sampleCanvas.width));
          const sourceHeight = Math.max(1, Number(pageOCR.height || sampleCanvas.height));
          const pageEntries: ExportOverlayPaletteEntry[] = [];

          pageOCR.lines.forEach((line, index) => {
            if (!translatedByIndex.has(index)) return;
            if (shouldSkipOverlayRenderForSuspiciousLine(line)) return;
            const palette = sampleOverlayPaletteFromLine(
              sampleCtx,
              line,
              sourceWidth,
              sourceHeight,
              sampleCanvas.width,
              sampleCanvas.height,
            );
            pageEntries.push({
              index,
              backgroundColor: palette.backgroundColor,
              textColor: palette.textColor,
              textStrokeWidth: palette.textStrokeWidth,
              textStrokeColor: palette.textStrokeColor,
              textFillWeight: palette.textFillWeight,
            });
          });

          if (pageEntries.length > 0) {
            paletteByPage.set(pageNum, pageEntries);
          }
        } catch {
          // Ignore sample errors and fallback to default palette
        }
      }
    } finally {
      await (pdfDocForSample as { destroy?: () => Promise<void> } | null)?.destroy?.();
    }

    return paletteByPage;
  };

  const exportTranslatedOverlayPngForSinglePage = async (
    pageNum: number,
    pageOCR: OCRPageResult,
    translatedEntry: OCRTranslationCacheEntry
  ): Promise<void> => {
    if (!file) return;

    const translatedByIndex = new Map<number, string>(
      translatedEntry.translatedByIndex
        .filter((item) => Number.isFinite(item.index))
        .map((item) => [item.index, normalizeWhitespace(String(item.text || ''))])
    );
    if (translatedByIndex.size === 0) {
      throw new Error('No translated lines found in cache for current page export.');
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Failed to create export canvas context.');
    }

    const visibleExportSize = resolveVisibleOverlayExportSize(pageNum);

    if (fileType === 'pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      const pdfDoc = await (loadingTask as { promise: Promise<import('pdfjs-dist').PDFDocumentProxy> }).promise;
      const page = await pdfDoc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const layoutWidth = Math.max(
        1,
        visibleExportSize?.width || pageOCR.width || Math.round(baseViewport.width)
      );
      const layoutHeight = Math.max(
        1,
        visibleExportSize?.height || Math.round(baseViewport.height * (layoutWidth / Math.max(1, baseViewport.width)))
      );
      const exportScale = resolveOverlayExportScale(
        layoutWidth,
        layoutHeight,
        Math.round(baseViewport.width),
        Math.round(baseViewport.height)
      );
      const targetWidth = Math.max(1, Math.round(layoutWidth * exportScale));
      const scale = targetWidth / Math.max(1, baseViewport.width);
      const viewport = page.getViewport({ scale });

      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      await (pdfDoc as { destroy?: () => Promise<void> }).destroy?.();
      (loadingTask as { destroy?: () => void }).destroy?.();
    } else {
      const imageBlob = fileData
        ? new Blob([fileData as unknown as BlobPart], { type: file.type || 'image/png' })
        : file;
      const imageBitmap = await createImageBitmap(imageBlob);
      const layoutWidth = Math.max(1, visibleExportSize?.width || imageBitmap.width);
      const layoutHeight = Math.max(1, visibleExportSize?.height || imageBitmap.height);
      const exportScale = resolveOverlayExportScale(
        layoutWidth,
        layoutHeight,
        imageBitmap.width,
        imageBitmap.height
      );
      const targetWidth = Math.max(1, Math.round(layoutWidth * exportScale));
      const targetHeight = Math.max(1, Math.round(layoutHeight * exportScale));
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
      imageBitmap.close?.();
    }

    const fontReadyPromise = (typeof document !== 'undefined' && 'fonts' in document)
      ? (document as Document & { fonts?: FontFaceSet }).fonts?.ready
      : undefined;
    if (fontReadyPromise) {
      await fontReadyPromise.catch(() => undefined);
    }

    const sourceWidth = Math.max(1, Number(pageOCR.width || canvas.width));
    const sourceHeight = Math.max(1, Number(pageOCR.height || canvas.height));
    const scaleX = canvas.width / sourceWidth;
    const scaleY = canvas.height / sourceHeight;

    const overlayLayoutProfile: OverlayLayoutProfile = translationMode === 'official'
      ? 'official'
      : translationMode === 'adaptive'
        ? 'adaptive'
        : translationMode === 'manhwa'
          ? 'manhwa'
          : 'manga';
    const preferredOverlayFontFamily = getOverlayFontOption(overlayFontPreset).fontFamily;
    const overlayFontFamily = resolveOverlayFontFamily({
      preset: overlayFontPreset,
      enabled: overlayThaiFontEnabled,
      targetLanguage,
    }) || preferredOverlayFontFamily || "'Noto Sans Thai', 'Sarabun', 'Segoe UI', sans-serif";
    const canvasOverlayFontFamily = await buildCanvasFontFamily(
      overlayFontFamily,
      `${JSON.stringify(getOverlayPrimaryFontName(overlayFontPreset))}, 'Sarabun', 'Noto Sans Thai', sans-serif`
    );

    const pageLayers = useLayerStore.getState().layersByPage.get(pageNum) || [];
    const deletedLineIndexes = useLayerStore.getState().deletedLineIndexesByPage.get(pageNum) || new Set<number>();

    const overlayLayoutByIndex = computeOverlayLayoutMap(
      pageOCR.lines.flatMap((line, index) => {
        const lineLayer = pageLayers.find(l => l.lineIndex === index && l.visible);
        let translatedText = (() => {
          if (lineLayer) {
            const normalizedLayerText = normalizeWhitespace(String(lineLayer.text || ''));
            const normalizedSourceText = normalizeWhitespace(String(lineLayer.sourceText || line.text || ''));
            const hasTranslation = lineLayer.userEdited || (normalizedLayerText && normalizedLayerText !== normalizedSourceText);
            const tText = translatedByIndex.get(index);
            if (hasTranslation) {
              return normalizedLayerText || tText;
            }
            return tText !== undefined ? tText : (normalizedLayerText || line.text);
          }
          const tText = translatedByIndex.get(index);
          return tText !== undefined ? tText : line.text;
        })();
        if (translatedText === '') {
          translatedText = ' ';
        }
        if (!translatedText) return [];
        const sourceFallbackOverlay = isSourceFallbackOverlayText(line.text, translatedText);
        if (!lineLayer && shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallbackOverlay) return [];
        if (!lineLayer && shouldSkipOverlayForUntranslatedCarryOver(line.text, translatedText, targetLanguage) && !sourceFallbackOverlay) return [];

        const layer = pageLayers.find(l => l.lineIndex === index);
        const balloonId = layer?.groupId;

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
        const baseWidth = Math.max(1, (effectiveSourceBbox.x1 - effectiveSourceBbox.x0) * scaleX);
        const baseHeight = Math.max(1, (effectiveSourceBbox.y1 - effectiveSourceBbox.y0) * scaleY);
        const expansion = resolveOverlayMaskExpansion(line);
        const maskExpandX = Math.min(expansion.maxExpandX, Math.max(1, Math.round(baseHeight * expansion.expandXRatio)));
        const maskExpandTop = Math.min(expansion.maxExpandTop, Math.max(1, Math.round(baseHeight * expansion.expandTopRatio)));
        const maskExpandBottom = Math.min(expansion.maxExpandBottom, Math.max(1, Math.round(baseHeight * expansion.expandBottomRatio)));
        const rawLeft = effectiveSourceBbox.x0 * scaleX - maskExpandX;
        const rawTop = effectiveSourceBbox.y0 * scaleY - maskExpandTop;
        const rawWidth = baseWidth + maskExpandX * 2;
        const rawHeight = baseHeight + maskExpandTop + maskExpandBottom;
        const rect = clampOverlayRect(rawLeft, rawTop, rawWidth, rawHeight, {
          x0: 0,
          y0: 0,
          x1: canvas.width,
          y1: canvas.height,
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
          balloonId,
          hints: {
            sourceText: line.text,
            sourceBoxWidth: baseWidth,
            sourceBoxHeight: baseHeight,
            sourceLineCount: 1,
            fontFamily: canvasOverlayFontFamily,
            profile: overlayLayoutProfile,
          },
        }];
      }),
      { profile: overlayLayoutProfile }
    );

    const translatedLinePalette = new Map<number, OverlayPalette>();
    const maxSampleSide = 2400;
    const sampleScale = Math.min(1, maxSampleSide / Math.max(1, canvas.width, canvas.height));
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = Math.max(1, Math.round(canvas.width * sampleScale));
    sampleCanvas.height = Math.max(1, Math.round(canvas.height * sampleScale));
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (sampleContext) {
      sampleContext.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
      pageOCR.lines.forEach((line, index) => {
        if (!translatedByIndex.has(index)) return;
        const translatedText = translatedByIndex.get(index) || '';
        const sourceFallbackOverlay = isSourceFallbackOverlayText(line.text, translatedText);
        if (shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallbackOverlay) return;
        translatedLinePalette.set(index, sampleOverlayPaletteFromLine(
          sampleContext,
          line,
          sourceWidth,
          sourceHeight,
          sampleCanvas.width,
          sampleCanvas.height
        ));
      });
    }

    pageOCR.lines.forEach((line, index) => {
      if (deletedLineIndexes.has(index)) return;
      const lineLayer = pageLayers.find(l => l.lineIndex === index && l.visible);
      let translatedText = (() => {
        if (lineLayer) {
          const normalizedLayerText = normalizeWhitespace(String(lineLayer.text || ''));
          const normalizedSourceText = normalizeWhitespace(String(lineLayer.sourceText || line.text || ''));
          const hasTranslation = lineLayer.userEdited || (normalizedLayerText && normalizedLayerText !== normalizedSourceText);
          const tText = translatedByIndex.get(index);
          if (hasTranslation) {
            return normalizedLayerText || tText;
          }
          return tText !== undefined ? tText : (normalizedLayerText || line.text);
        }
        const tText = translatedByIndex.get(index);
        return tText !== undefined ? tText : line.text;
      })();
      if (translatedText === '') {
        translatedText = ' ';
      }
      if (!translatedText) return;

      const layout = overlayLayoutByIndex.get(index);
      const isMaskOnlyLine = Boolean(layout?.hidden);
      if (isMaskOnlyLine && !layout?.preserveMaskWhenHidden) {
        return;
      }
      if (!isMaskOnlyLine) {
        const sourceFallbackOverlay = isSourceFallbackOverlayText(line.text, translatedText);
        if (!lineLayer && shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallbackOverlay) return;
        if (!lineLayer && shouldSkipOverlayForUntranslatedCarryOver(line.text, translatedText, targetLanguage) && !sourceFallbackOverlay) return;

        const matchedUserLayer = pageLayers.find(l => l.lineIndex === index && l.visible && l.userEdited);
        if (matchedUserLayer) return;
      }

      const renderText = layout?.renderText || translatedText;
      const effectiveProfile = layout?.effectiveProfile || overlayLayoutProfile;
      const styleKind = layout?.styleKind;
      const isDocumentLikeOverlay = styleKind
        ? styleKind === 'document-heading' || styleKind === 'document-body'
        : effectiveProfile === 'official';
      const isComicLikeOverlay = !isDocumentLikeOverlay;
      const maskBbox = (!isMaskOnlyLine && layout?.mergedMaskBBox) || resolveOverlayMaskBBox(line);
      const resolvedSourceBbox = resolveOverlaySourceBBox(line);
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
      const sourceBbox = isMaskOnlyLine
        ? resolvedSourceBbox
        : (layout?.mergedBBox || (isDocumentLikeOverlay || lowCoverageSource ? maskBbox : resolvedSourceBbox));

      const maskRenderSourceLeft = maskBbox.x0;
      const renderSourceLeft = layout?.alignment === 'left' && layout.sharedBoxLeftX !== undefined
        ? Math.min(sourceBbox.x0, layout.sharedBoxLeftX)
        : sourceBbox.x0;
      const maskBaseWidth = Math.max(1, (maskBbox.x1 - maskRenderSourceLeft) * scaleX);
      const maskBaseHeight = Math.max(1, (maskBbox.y1 - maskBbox.y0) * scaleY);
      const baseWidth = Math.max(1, (sourceBbox.x1 - renderSourceLeft) * scaleX);
      const baseHeight = Math.max(1, (sourceBbox.y1 - sourceBbox.y0) * scaleY);
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
      const rawMaskLeft = maskRenderSourceLeft * scaleX - maskExpandLeft;
      const rawMaskTop = maskBbox.y0 * scaleY - maskExpandTop;
      const rawMaskWidth = maskBaseWidth + maskExpandLeft + maskExpandRight;
      const rawMaskHeight = maskBaseHeight + maskExpandTop + maskExpandBottom;
      const maskRect = clampOverlayRect(rawMaskLeft, rawMaskTop, rawMaskWidth, rawMaskHeight, {
        x0: 0,
        y0: 0,
        x1: canvas.width,
        y1: canvas.height,
      });

      const useMergedComicTextRect = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && !isMaskOnlyLine && Boolean(layout?.mergedMaskBBox);
      const textSourceLeft = useMergedComicTextRect ? maskRenderSourceLeft : renderSourceLeft;
      const textSourceTop = sourceBbox.y0;
      const textBaseWidth = useMergedComicTextRect ? Math.max(baseWidth, maskBaseWidth) : baseWidth;
      const textBaseHeight = baseHeight;
      const rawTextLeft = textSourceLeft * scaleX - (layout?.alignment === 'center' ? 0 : maskExpandLeft);
      const rawTextTop = textSourceTop * scaleY - maskExpandTop;
      const rawTextWidth = textBaseWidth + (layout?.alignment === 'center' ? 0 : maskExpandLeft + maskExpandRight);
      const rawTextHeight = textBaseHeight + maskExpandTop + maskExpandBottom;
      let textRect = clampOverlayRect(rawTextLeft, rawTextTop, rawTextWidth, rawTextHeight, {
        x0: 0,
        y0: 0,
        x1: canvas.width,
        y1: canvas.height,
      });
      if (!isDocumentLikeOverlay) {
        textRect = clampOverlayRect(textRect.left, textRect.top, textRect.width, textRect.height, {
          x0: Math.max(0, maskRect.left - 1),
          y0: Math.max(0, maskRect.top - 1),
          x1: Math.min(canvas.width, maskRect.left + maskRect.width + 1),
          y1: Math.min(canvas.height, maskRect.top + maskRect.height + 1),
        });
      }

      const palette = translatedLinePalette.get(index) || DEFAULT_OVERLAY_PALETTE;
      const maskBackgroundColor = palette.backgroundColor;
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
        fontFamily: canvasOverlayFontFamily,
        profile: effectiveProfile,
        styleKind,
      });
      const typography = scaleOverlayTypography(baseTypography, overlayFontSizeScale);
      const extraTopPad = hasThaiText ? Math.max(1, Math.round(typography.fontSize * 0.08)) : 0;
      const extraBottomPad = hasThaiText ? Math.max(1, Math.round(typography.fontSize * 0.06)) : 0;
      const textStartOffset = layout?.sharedTextStartX !== undefined
        ? Math.max(0, (layout.sharedTextStartX - renderSourceLeft) * scaleX)
        : 0;
      const centerOffset = layout?.sharedCenterX !== undefined
        ? ((layout.sharedCenterX - renderSourceLeft) * scaleX) - (textRect.width * 0.5)
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
      const rotationDeg = estimateLineRotationDeg(line);
      const rotationRad = (rotationDeg * Math.PI) / 180;
      const thaiComicLine = hasThaiText && (styleKind === 'comic-bubble' || styleKind === 'comic-box');
      const isComicCenter = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && layout?.alignment === 'center';
      const minFillRatio = typography.estimatedLines > 1
        ? (thaiComicLine ? 0.82 : 0.74)
        : (thaiComicLine ? 0.58 : 0.5);
      const naturalPaintHeight = typography.contentHeight + typography.padY * 2 + extraTopPad + extraBottomPad;
      const paintHeight = isComicCenter
        ? Math.min(textRect.height * 1.8, naturalPaintHeight)
        : Math.min(
            textRect.height * 1.8,
            Math.max(naturalPaintHeight, textRect.height * minFillRatio)
          );
      const thaiVisualShift = (isComicCenter && hasThaiText)
        ? Math.round(maskRect.height * 0.035)
        : 0;
      const paintOffsetTop = isComicCenter
        ? Math.max(0, Math.min(textRect.height - paintHeight, Math.round((maskRect.top - textRect.top) + (maskRect.height - paintHeight) * 0.5 - thaiVisualShift)))
        : Math.max(
            hasThaiText ? 1 : 0,
            Math.min(textRect.height - paintHeight, Math.round(textRect.height * (thaiComicLine ? 0.04 : 0.08)))
          );

      ctx.save();
      if (rotationDeg !== 0) {
        ctx.translate(maskRect.left, maskRect.top);
        ctx.rotate(rotationRad);
        ctx.fillStyle = maskBackgroundColor;
        ctx.fillRect(0, 0, maskRect.width, maskRect.height);
      } else {
        ctx.fillStyle = maskBackgroundColor;
        ctx.fillRect(maskRect.left, maskRect.top, maskRect.width, maskRect.height);
      }
      ctx.restore();

      if (isMaskOnlyLine) {
        return;
      }

      ctx.save();
      if (rotationDeg !== 0) {
        ctx.translate(textRect.left, textRect.top);
        ctx.rotate(rotationRad);
      }

      const originLeft = rotationDeg !== 0 ? 0 : textRect.left;
      const originTop = rotationDeg !== 0 ? 0 : textRect.top;
      const paintLeft = originLeft + innerLeft;
      const paintTop = originTop + paintOffsetTop;

      const clipHeightBoost = hasThaiText ? Math.max(2, Math.round(typography.fontSize * 0.35)) : 0;
      ctx.beginPath();
      ctx.rect(originLeft - 180, originTop, textRect.width + 360, Math.max(textRect.height, paintHeight) + clipHeightBoost);
      ctx.clip();

      const textBoxLeft = paintLeft + typography.padX;
      const textBoxTop = paintTop + typography.padY + extraTopPad;
      const textBoxWidth = Math.max(1, Math.round((innerWidth - (typography.padX * 2)) * 1.15) + 12);
      const textBoxHeight = Math.max(1, Math.max(paintHeight, typography.contentHeight) - ((typography.padY * 2) + extraTopPad + extraBottomPad));
      const lineHeightPx = Math.max(1, typography.fontSize * typography.lineHeight);
      const maxLines = Math.max(1, Math.max(
        Math.ceil(textBoxHeight / lineHeightPx),
        typography.estimatedLines
      ));
      const overlayTextWeight = Number(palette.textFillWeight || 400);
      const resolvedTextWeight = Math.max(400, Math.min(700, Math.round(overlayTextWeight)));

      ctx.font = `${resolvedTextWeight} ${typography.fontSize}px ${canvasOverlayFontFamily}`;
      const lines = wrapCanvasText(ctx, overlayText, textBoxWidth, maxLines, typography.forceSingleLine);
      ctx.fillStyle = palette.textColor;
      const strokeBaseWidth = Number(palette.textStrokeWidth || 0);
      const resolvedStrokeWidth = strokeBaseWidth > 0
        ? Math.max(0.55, Math.min(1.35, strokeBaseWidth * (typography.fontSize / 14)))
        : 0;
      ctx.textBaseline = 'top';
      ctx.textAlign = layout?.alignment === 'center' ? 'center' : 'left';

      lines.forEach((lineText, lineIndex) => {
        const y = textBoxTop + (lineIndex * lineHeightPx);
        if (lineIndex > 0 && y + lineHeightPx > textBoxTop + textBoxHeight + 0.5) return;
        const x = ctx.textAlign === 'center'
          ? textRect.left + innerLeft + (innerWidth / 2)
          : textBoxLeft;
        if (resolvedStrokeWidth > 0 && palette.textStrokeColor) {
          ctx.save();
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.lineWidth = resolvedStrokeWidth;
          ctx.strokeStyle = palette.textStrokeColor;
          ctx.strokeText(lineText, x, y, textBoxWidth);
          ctx.restore();
        }
        ctx.fillText(lineText, x, y, textBoxWidth);
      });

      ctx.restore();
    });

    // User-Edited Layer Render Pass
    const visibleUserLayers = pageLayers.filter(l => l.visible && l.userEdited);
    if (visibleUserLayers.length > 0) {
      for (const layer of visibleUserLayers) {
        const lx = Math.round(layer.bbox.x0 * scaleX);
        const ly = Math.round(layer.bbox.y0 * scaleY);
        const lw = Math.max(1, Math.round((layer.bbox.x1 - layer.bbox.x0) * scaleX));
        const lh = Math.max(1, Math.round((layer.bbox.y1 - layer.bbox.y0) * scaleY));

        ctx.save();
        const layerRotation = layer.rotation || 0;
        if (layerRotation !== 0) {
          const cx = lx + lw / 2;
          const cy = ly + lh / 2;
          ctx.translate(cx, cy);
          ctx.rotate((layerRotation * Math.PI) / 180);
          ctx.translate(-cx, -cy);
        }

        const layerBg = layer.backgroundColor;
        if (layerBg && layerBg !== 'transparent') {
          ctx.fillStyle = layerBg;
          ctx.fillRect(lx, ly, lw, lh);
        } else {
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(lx, ly, lw, lh);
        }

        const baseFontSize = layer.fontSize || 14;
        const resolvedFontSize = Math.max(8, Math.round(baseFontSize * scaleX));
        const fontWeight = layer.bold ? 'bold' : 'normal';
        ctx.font = `${fontWeight} ${resolvedFontSize}px ${canvasOverlayFontFamily}`;
        ctx.fillStyle = layer.textColor || '#000000';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';

        ctx.beginPath();
        ctx.rect(lx, ly, lw, lh);
        ctx.clip();

        const displayText = layer.text || '';
        const lineHeightPx = Math.max(1, resolvedFontSize * 1.35);
        const maxLines = Math.max(1, Math.floor((lh - 6) / lineHeightPx));
        const wrappedLines = wrapCanvasText(ctx, displayText, lw - 8, maxLines, false);
        wrappedLines.forEach((lineText, li) => {
          const ty = ly + 3 + li * lineHeightPx;
          if (li > 0 && ty + lineHeightPx > ly + lh + 0.5) return;
          ctx.fillText(lineText, lx + 4, ty, lw - 8);
        });

        ctx.restore();
      }
    }

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create translated PNG export.'));
      }, 'image/png');
    });

    const pngUrl = URL.createObjectURL(pngBlob);
    const anchor = document.createElement('a');
    anchor.href = pngUrl;
    anchor.download = file.name.replace(/\.[^.]+$/u, `_page_${pageNum}_translated_overlay.png`);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(pngUrl);
  };

  const handleHeaderDownload = async (
    scope: DownloadScope,
    mode: DownloadContentMode,
    engineOverride?: OCREngine
  ) => {
    if (!file) return;

    applyPopupOcrQualityProfile();
    const selectedEngine = engineOverride || selectedExportEngine || (ocrOptions.engine || 'paddleocr') as OCREngine;
    await hydrateExportCachesForDownload(selectedEngine);
    setExportCacheHydrationTick((tick) => tick + 1);

    const scopedPages = resolveModelScopedPagesForExport(scope, selectedEngine);
    if (scopedPages.length === 0) {
      setTranslationStatus({ kind: 'error', message: 'No OCR cache available for download. Run OCR first.' });
      return;
    }

    try {
      setIsDownloadingResult(true);
      if (mode === 'original') {
        const pageMap = new Map<number, OCRPageResult>();
        scopedPages.forEach(({ pageNum, ocr }) => {
          pageMap.set(pageNum, ocr);
        });

        const pageRange = scope === 'current'
          ? [currentPage]
          : scopedPages.map((item) => item.pageNum);
        const arrayBuffer = await file.arrayBuffer();
        const resultBytes = await searchablePDFService.createSearchablePDFWithOCR(
          arrayBuffer,
          pageMap,
          pageRange
        );
        const url = URL.createObjectURL(new Blob([resultBytes.buffer as ArrayBuffer], { type: 'application/pdf' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        const suffix = scope === 'current' ? `_page_${currentPage}_searchable.pdf` : '_searchable.pdf';
        anchor.download = file.name.replace('.pdf', suffix);
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      } else {
        const translatedPageMap = new Map<number, OCRPageResult>();
        const translatedEntryMap = new Map<number, OCRTranslationCacheEntry>();
        const sourcePageMap = new Map<number, OCRPageResult>();
        let missingPages = 0;

        scopedPages.forEach(({ pageNum, ocr }) => {
          sourcePageMap.set(pageNum, ocr);
          const translatedEntry = resolveTranslatedEntryForExport(pageNum, ocr, selectedEngine);
          if (!translatedEntry) {
            missingPages += 1;
            return;
          }

          translatedEntryMap.set(pageNum, translatedEntry);
          translatedPageMap.set(pageNum, buildTranslatedPageOCRForExport(ocr, translatedEntry));
        });

        if (translatedPageMap.size === 0) {
          setTranslationStatus({
            kind: 'error',
            message: 'No translated cache found for selected OCR model and target language. Run translation first.',
          });
          return;
        }

        if (scope === 'current') {
          const currentSourcePage = sourcePageMap.get(currentPage);
          const currentEntry = translatedEntryMap.get(currentPage);
          if (currentSourcePage && currentEntry) {
            await exportTranslatedOverlayPngForSinglePage(currentPage, currentSourcePage, currentEntry);
          }
        }

        if (scope === 'all' && fileType === 'pdf') {
          const pageRange = Array.from(translatedPageMap.keys()).sort((a, b) => a - b);
          const paletteByPage = await buildPaletteByPageForExport(pageRange, sourcePageMap, translatedEntryMap);
          const resultBytes = await exportTranslatedPdfViaPrint({
            fileType: 'pdf',
            sourceBytes: filePath ? undefined : await file.arrayBuffer(),
            sourceFilePath: filePath,
            sourceMimeType: file.type || 'application/pdf',
            pageRange,
            sourcePageMap,
            translatedEntryMap,
            translationMode,
            overlayFontPreset,
            overlayThaiFontEnabled,
            targetLanguage,
            overlayFontSizeScale,
            paletteByPage,
          });

          const url = URL.createObjectURL(new Blob([resultBytes.buffer as ArrayBuffer], { type: 'application/pdf' }));
          const anchor = document.createElement('a');
          anchor.href = url;
          const suffix = '_translated_overlay.pdf';
          anchor.download = file.name.replace(/\.[^.]+$/u, suffix);
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          URL.revokeObjectURL(url);
        }

        if (missingPages > 0) {
          setTranslationStatus({
            kind: 'info',
            message: `Exported translated overlay for ${translatedPageMap.size} pages; ${missingPages} pages had no matching translated cache.`,
          });
        } else if (scope === 'current') {
          setTranslationStatus({
            kind: 'success',
            message: `Exported page ${currentPage} translated overlay PNG.`,
          });
        } else {
          setTranslationStatus({
            kind: 'success',
            message: `Exported translated overlay PDF for ${translatedPageMap.size} pages.`,
          });
        }
      }

      setIsDownloadMenuOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown download error';
      setTranslationStatus({ kind: 'error', message: `Download failed: ${message}` });
    } finally {
      setIsDownloadingResult(false);
      useExportStore.getState().finishExport();
    }
  };

  return {
    handleHeaderDownload,
    buildPaletteByPageForExport,
    exportTranslatedOverlayPngForSinglePage,
  };
}
