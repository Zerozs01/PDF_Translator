import type { PdfPrintExportPageConfig } from '../types/pdfExport';
import type { OCRLine } from '../types';
import type { TextLayer } from '../types/layers';
import {
  DEFAULT_OVERLAY_PALETTE,
  clampOverlayRect,
  computeOverlayLayoutMap,
  computeOverlayTypography,
  estimateLineRotationDeg,
  normalizeOverlayInlineText,
  resolveOverlayMaskBBox,
  resolveOverlayMaskExpansion,
  resolveOverlaySourceBBox,
  shouldSkipOverlayRenderForSuspiciousLine,
} from '../components/OCR/translationOverlayUtils';
import {
  scaleOverlayTypography,
  shouldSkipOverlayForUntranslatedCarryOver,
  shouldUseDocumentCoverageFallback,
} from '../services/translation/offlineTranslationService';
import { normalizeWhitespace } from '../services/ocr/ocrTextNormalizer';

const isSourceFallbackOverlayText = (sourceText: string, translatedText: string): boolean => {
  const source = normalizeOverlayInlineText(String(sourceText || ''));
  const translated = normalizeOverlayInlineText(String(translatedText || ''));
  if (Boolean(source && translated && source === translated)) return true;

  const sourceKey = String(sourceText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');
  const translatedKey = String(translatedText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');
  return Boolean(sourceKey && translatedKey && sourceKey === translatedKey);
};

export const resolveExportLineText = (
  line: OCRLine,
  index: number,
  pageConfig: PdfPrintExportPageConfig,
  translatedByIndex: Map<number, string>
): string | undefined => {
  const layer = pageConfig.pageLayers.find((entry) => entry.lineIndex === index && entry.visible);
  if (layer) {
    const normalizedLayerText = normalizeWhitespace(String(layer.text || ''));
    const normalizedSourceText = normalizeWhitespace(String(layer.sourceText || line.text || ''));
    const hasTranslation = layer.userEdited || (normalizedLayerText && normalizedLayerText !== normalizedSourceText);
    const translatedText = translatedByIndex.get(index);
    if (hasTranslation) {
      return normalizedLayerText || translatedText;
    }
    return translatedText ?? (normalizedLayerText || line.text);
  }
  return translatedByIndex.get(index) || line.text;
};

const isLineHiddenByLayer = (pageConfig: PdfPrintExportPageConfig, index: number): boolean =>
  pageConfig.pageLayers.some((entry) => entry.lineIndex === index && !entry.visible);

type LayoutDimensions = {
  pageWidthPt: number;
  pageHeightPt: number;
  sx: number;
  sy: number;
};

const resolveLayoutDimensions = (pageConfig: PdfPrintExportPageConfig): LayoutDimensions => {
  const ocrW = Math.max(1, Number(pageConfig.sourceOCR.width || pageConfig.pageWidthPt || 595));
  const ocrH = Math.max(1, Number(pageConfig.sourceOCR.height || pageConfig.pageHeightPt || 842));
  const pageWidthPt = Math.max(1, pageConfig.pageWidthPt || ocrW);
  const pageHeightPt = Math.max(1, pageConfig.pageHeightPt || ocrH);

  return {
    pageWidthPt,
    pageHeightPt,
    sx: pageWidthPt / ocrW,
    sy: pageHeightPt / ocrH,
  };
};

const applyTextStroke = (element: HTMLElement, strokeWidth: number, strokeColor: string, fontSizePt: number): void => {
  if (strokeWidth <= 0 || !strokeColor) return;
  const scaled = Math.max(0.55, Math.min(1.35, strokeWidth * (fontSizePt / 14)));
  element.style.webkitTextStroke = `${scaled}pt ${strokeColor}`;
  element.style.paintOrder = 'stroke fill';
};

const buildOverlayLayoutInputs = (
  pageConfig: PdfPrintExportPageConfig,
  layout: LayoutDimensions,
) => {
  const translatedByIndex = new Map(
    pageConfig.translatedByIndex.map((item) => [item.index, normalizeWhitespace(String(item.text || ''))])
  );
  const { sx, sy, pageWidthPt, pageHeightPt } = layout;

  return computeOverlayLayoutMap(
    pageConfig.sourceOCR.lines.flatMap((line, index) => {
      if (isLineHiddenByLayer(pageConfig, index)) return [];
      const lineLayer = pageConfig.pageLayers.find((entry) => entry.lineIndex === index && entry.visible);
      const translatedText = resolveExportLineText(line, index, pageConfig, translatedByIndex);
      if (!translatedText) return [];
      const sourceFallbackOverlay = isSourceFallbackOverlayText(line.text, translatedText);
      if (!lineLayer && shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallbackOverlay) return [];
      if (!lineLayer && shouldSkipOverlayForUntranslatedCarryOver(line.text, translatedText, pageConfig.targetLanguage) && !sourceFallbackOverlay) {
        return [];
      }

      const layer = lineLayer;
      const sourceBbox = resolveOverlaySourceBBox(line);
      const maskBbox = resolveOverlayMaskBBox(line);
      const sourceWidthRaw = Math.max(1, sourceBbox.x1 - sourceBbox.x0);
      const sourceHeightRaw = Math.max(1, sourceBbox.y1 - sourceBbox.y0);
      const maskWidthRaw = Math.max(1, maskBbox.x1 - maskBbox.x0);
      const maskHeightRaw = Math.max(1, maskBbox.y1 - maskBbox.y0);
      const widthCoverage = sourceWidthRaw / maskWidthRaw;
      const areaCoverage = (sourceWidthRaw * sourceHeightRaw) / Math.max(1, maskWidthRaw * maskHeightRaw);
      const lowCoverageSource = shouldUseDocumentCoverageFallback(line.text)
        && widthCoverage < 0.84
        && areaCoverage < 0.86;
      const effectiveSourceBbox = lowCoverageSource ? maskBbox : sourceBbox;
      const baseWidth = Math.max(1, (effectiveSourceBbox.x1 - effectiveSourceBbox.x0) * sx);
      const baseHeight = Math.max(1, (effectiveSourceBbox.y1 - effectiveSourceBbox.y0) * sy);
      const profile = pageConfig.overlayLayoutProfile;

      return [{
        index,
        text: translatedText,
        width: baseWidth,
        height: baseHeight,
        bbox: profile === 'official' ? maskBbox : effectiveSourceBbox,
        line,
        balloonId: layer?.groupId,
        hints: {
          sourceText: line.text,
          sourceBoxWidth: baseWidth,
          sourceBoxHeight: baseHeight,
          sourceLineCount: 1,
          fontFamily: pageConfig.overlayFontFamily,
          profile,
        },
      }];
    }),
    { profile: pageConfig.overlayLayoutProfile }
  );
};

const appendAutoOverlayElements = (
  root: HTMLElement,
  pageConfig: PdfPrintExportPageConfig,
  layout: LayoutDimensions,
): void => {
  const { sourceOCR, overlayLayoutProfile, overlayFontFamily, overlayFontSizeScale, targetLanguage } = pageConfig;
  const { sx, sy, pageWidthPt, pageHeightPt } = layout;
  const translatedByIndex = new Map(
    pageConfig.translatedByIndex.map((item) => [item.index, normalizeWhitespace(String(item.text || ''))])
  );
  const deletedIndexes = new Set(pageConfig.deletedLineIndexes);
  const overlayLayout = buildOverlayLayoutInputs(pageConfig, layout);
  const pageBounds = { x0: 0, y0: 0, x1: pageWidthPt, y1: pageHeightPt };
  // Build palette map — ใช้สีที่ sample จากรูปต้นฉบับแทนสีขาว default
  const paletteMap = new Map(
    (pageConfig.paletteByIndex ?? []).map((p) => [p.index, p])
  );

  sourceOCR.lines.forEach((line: OCRLine, index: number) => {
    if (deletedIndexes.has(index)) return;
    if (isLineHiddenByLayer(pageConfig, index)) return;
    const lineLayer = pageConfig.pageLayers.find((entry) => entry.lineIndex === index && entry.visible);
    const translatedText = resolveExportLineText(line, index, pageConfig, translatedByIndex);
    if (!translatedText) return;
    const sourceFallback = isSourceFallbackOverlayText(line.text, translatedText);
    if (!lineLayer && shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallback) return;
    if (!lineLayer && shouldSkipOverlayForUntranslatedCarryOver(line.text, translatedText, targetLanguage) && !sourceFallback) return;

    const matchLayer = pageConfig.pageLayers.find((entry) => entry.lineIndex === index && entry.visible && entry.userEdited);
    if (matchLayer) return;

    const layoutEntry = overlayLayout.get(index);
    const isMaskOnly = Boolean(layoutEntry?.hidden);
    if (isMaskOnly && !layoutEntry?.preserveMaskWhenHidden) return;

    const renderText = layoutEntry?.renderText !== undefined ? layoutEntry.renderText : translatedText;
    const effectiveProfile = layoutEntry?.effectiveProfile || overlayLayoutProfile;
    const styleKind = layoutEntry?.styleKind;
    const isDocLike = styleKind
      ? styleKind === 'document-heading' || styleKind === 'document-body'
      : effectiveProfile === 'official';
    const isComicLike = !isDocLike;
    const maskBbox = (!isMaskOnly && layoutEntry?.mergedMaskBBox) || resolveOverlayMaskBBox(line);
    const resolvedSrcBbox = resolveOverlaySourceBBox(line);
    const mskW = Math.max(1, maskBbox.x1 - maskBbox.x0);
    const mskH = Math.max(1, maskBbox.y1 - maskBbox.y0);
    const srcWLine = Math.max(1, resolvedSrcBbox.x1 - resolvedSrcBbox.x0);
    const srcHLine = Math.max(1, resolvedSrcBbox.y1 - resolvedSrcBbox.y0);
    const wCov = srcWLine / mskW;
    const aCov = (srcWLine * srcHLine) / Math.max(1, mskW * mskH);
    const lowCov = shouldUseDocumentCoverageFallback(line.text) && wCov < 0.84 && aCov < 0.86;
    const srcBbox = isMaskOnly
      ? resolvedSrcBbox
      : (layoutEntry?.mergedBBox || (isDocLike || lowCov ? maskBbox : resolvedSrcBbox));

    const mrkLeft = maskBbox.x0;
    const rkLeft = layoutEntry?.alignment === 'left' && layoutEntry.sharedBoxLeftX !== undefined
      ? Math.min(srcBbox.x0, layoutEntry.sharedBoxLeftX)
      : srcBbox.x0;
    const mBW = Math.max(1, (maskBbox.x1 - mrkLeft) * sx);
    const mBH = Math.max(1, (maskBbox.y1 - maskBbox.y0) * sy);
    const bW = Math.max(1, (srcBbox.x1 - rkLeft) * sx);
    const bH = Math.max(1, (srcBbox.y1 - srcBbox.y0) * sy);
    const expansion = resolveOverlayMaskExpansion(line);
    const mBoost = isComicLike && layoutEntry?.mergedBBox ? 4 * sx : 0;
    const mExpX = Math.min(expansion.maxExpandX * sx + mBoost + 3 * sx, Math.max(1, Math.round(mBH * expansion.expandXRatio)) + mBoost + 3 * sx);
    const mExpL = Math.min(isComicLike ? 4 * sx : 1 * sx, mExpX);
    const mExpR = mExpX;
    const mExpTop = Math.min(expansion.maxExpandTop * sy + mBoost + 3 * sy, Math.max(1, Math.round(mBH * expansion.expandTopRatio)) + mBoost + 3 * sy);
    const mExpBot = Math.min(
      expansion.maxExpandBottom * sy + mBoost + 2 * sy,
      Math.max(1, Math.round(mBH * expansion.expandBottomRatio)) + mBoost + 2 * sy
    );
    const maskRect = clampOverlayRect(
      mrkLeft * sx - mExpL,
      maskBbox.y0 * sy - mExpTop,
      mBW + mExpL + mExpR,
      mBH + mExpTop + mExpBot,
      pageBounds
    );

    const palette = paletteMap.get(index) ?? DEFAULT_OVERLAY_PALETTE;
    const maskEl = document.createElement('div');
    maskEl.className = 'export-mask';
    maskEl.style.left = `${maskRect.left}pt`;
    maskEl.style.top = `${maskRect.top}pt`;
    maskEl.style.width = `${maskRect.width}pt`;
    maskEl.style.height = `${maskRect.height}pt`;
    maskEl.style.backgroundColor = palette.backgroundColor;
    root.appendChild(maskEl);
    if (isMaskOnly) return;

    const useMergedComic = (styleKind === 'comic-bubble' || styleKind === 'comic-box')
      && !isMaskOnly
      && Boolean(layoutEntry?.mergedMaskBBox);
    const tSrcL = useMergedComic ? mrkLeft : rkLeft;
    const tSrcT = useMergedComic ? maskBbox.y0 : srcBbox.y0;
    const tBW = useMergedComic ? Math.max(bW, mBW) : bW;
    const tBH = useMergedComic ? Math.max(bH, mBH) : bH;
    const rawTL = tSrcL * sx - (layoutEntry?.alignment === 'center' ? 0 : mExpL);
    const rawTT = tSrcT * sy - mExpTop;
    const rawTW = tBW + (layoutEntry?.alignment === 'center' ? 0 : mExpL + mExpR);
    const rawTH = tBH + mExpTop + mExpBot;
    const textRect = clampOverlayRect(rawTL, rawTT, rawTW, rawTH, pageBounds);

    const typoW = isDocLike ? Math.max(bW, textRect.width * 0.96) : textRect.width;
    const typoH = isDocLike ? textRect.height : textRect.height;
    const baseTypo = layoutEntry?.typography || computeOverlayTypography(renderText, typoW, typoH, {
      sourceText: line.text,
      sourceBoxWidth: bW,
      sourceBoxHeight: bH,
      sourceLineCount: 1,
      fontFamily: overlayFontFamily,
      profile: effectiveProfile,
      styleKind,
    });
    const typo = scaleOverlayTypography(baseTypo, overlayFontSizeScale);
    const overlayText = typo.forceSingleLine ? normalizeOverlayInlineText(renderText) : renderText;
    const rotDeg = estimateLineRotationDeg(line);
    const textWeight = Math.max(400, Math.min(700, Math.round(Number(palette.textFillWeight || 400))));

    const textEl = document.createElement('div');
    textEl.className = 'export-text';
    textEl.textContent = overlayText;
    textEl.style.left = `${textRect.left}pt`;
    textEl.style.top = `${textRect.top}pt`;
    textEl.style.width = `${textRect.width}pt`;
    textEl.style.height = `${textRect.height}pt`;
    textEl.style.fontFamily = overlayFontFamily;
    textEl.style.fontSize = `${typo.fontSize}pt`;
    textEl.style.fontWeight = String(textWeight);
    textEl.style.color = palette.textColor;
    textEl.style.textAlign = layoutEntry?.alignment === 'center' ? 'center' : 'left';
    textEl.style.padding = `${typo.padY}pt ${typo.padX}pt`;
    textEl.style.lineHeight = String(typo.lineHeight);
    if (rotDeg !== 0) {
      textEl.style.transformOrigin = 'top left';
      textEl.style.transform = `rotate(${rotDeg}deg)`;
    }
    applyTextStroke(textEl, Number(palette.textStrokeWidth || 0), palette.textStrokeColor || '', typo.fontSize);
    root.appendChild(textEl);
  });
};

const appendUserLayerElements = (
  root: HTMLElement,
  pageConfig: PdfPrintExportPageConfig,
  layout: LayoutDimensions,
): void => {
  const { sx, sy } = layout;

  pageConfig.pageLayers
    .filter((layer) => layer.visible && layer.userEdited)
    .forEach((layer) => {
      const left = layer.bbox.x0 * sx;
      const top = layer.bbox.y0 * sy;
      const width = Math.max(1, (layer.bbox.x1 - layer.bbox.x0) * sx);
      const height = Math.max(1, (layer.bbox.y1 - layer.bbox.y0) * sy);
      const fontSize = Math.max(8, (layer.fontSize || 14) * sx);

      const layerEl = document.createElement('div');
      layerEl.className = 'export-user-layer';
      layerEl.textContent = layer.text || '';
      layerEl.style.left = `${left}pt`;
      layerEl.style.top = `${top}pt`;
      layerEl.style.width = `${width}pt`;
      layerEl.style.height = `${height}pt`;
      layerEl.style.fontFamily = pageConfig.overlayFontFamily;
      layerEl.style.fontSize = `${fontSize}pt`;
      layerEl.style.fontWeight = layer.bold ? '700' : '400';
      layerEl.style.color = layer.textColor || '#000000';
      layerEl.style.backgroundColor = layer.backgroundColor && layer.backgroundColor !== 'transparent'
        ? layer.backgroundColor
        : '#ffffff';
      layerEl.style.padding = '3pt 4pt';
      if (layer.rotation) {
        layerEl.style.transformOrigin = 'center center';
        layerEl.style.transform = `rotate(${layer.rotation}deg)`;
      }
      root.appendChild(layerEl);
    });
};

export const renderExportPrintPage = async (pageConfig: PdfPrintExportPageConfig): Promise<void> => {
  const root = document.getElementById('export-root');
  if (!root) {
    throw new Error('Export root element not found.');
  }

  root.replaceChildren();
  const layout = resolveLayoutDimensions(pageConfig);

  const page = document.createElement('div');
  page.className = 'export-page';
  page.style.width = `${layout.pageWidthPt}pt`;
  page.style.height = `${layout.pageHeightPt}pt`;

  const styleEl = document.createElement('style');
  styleEl.textContent = `@page { size: ${layout.pageWidthPt}pt ${layout.pageHeightPt}pt; margin: 0; }`;
  document.head.querySelector('style[data-export-page-size]')?.remove();
  styleEl.setAttribute('data-export-page-size', 'true');
  document.head.appendChild(styleEl);

  appendAutoOverlayElements(page, pageConfig, layout);
  appendUserLayerElements(page, pageConfig, layout);
  root.appendChild(page);

  if ('fonts' in document) {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  }
};

declare global {
  interface Window {
    __renderExportPrintPage?: (pageConfig: PdfPrintExportPageConfig) => Promise<void>;
    __waitForExportPrintReady?: () => Promise<void>;
  }
}
