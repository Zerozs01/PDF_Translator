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
  if (!layer) {
    return translatedByIndex.get(index);
  }
  const hasTranslation = layer.userEdited || layer.text !== layer.sourceText;
  if (hasTranslation) {
    return layer.text;
  }
  return translatedByIndex.get(index) || layer.text;
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
  const { sx, sy } = layout;

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
  const paletteMap = new Map(
    (pageConfig.paletteByIndex ?? []).map((p) => [p.index, p])
  );

  sourceOCR.lines.forEach((line: OCRLine, index: number) => {
    if (deletedIndexes.has(index)) return;
    if (isLineHiddenByLayer(pageConfig, index)) return;
    const layer = pageConfig.pageLayers.find((entry) => entry.lineIndex === index);
    const translatedText = resolveExportLineText(line, index, pageConfig, translatedByIndex);
    console.log(`[ExportDebug] Page ${pageConfig.pageNum} line ${index}: srcText="${line.text}" resolvedText="${translatedText}" pageLayersCount=${pageConfig.pageLayers.length}`);
    if (!translatedText) return;
    const sourceFallback = isSourceFallbackOverlayText(line.text, translatedText);
    if (!layer && shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallback) return;
    if (!layer && shouldSkipOverlayForUntranslatedCarryOver(line.text, translatedText, targetLanguage) && !sourceFallback) return;

    const layoutEntry = overlayLayout.get(index);
    const isMaskOnly = (layer && layer.userEdited) ? false : Boolean(layoutEntry?.hidden);
    if (isMaskOnly && !layoutEntry?.preserveMaskWhenHidden) return;

    const renderText = (layer && layer.userEdited)
      ? layer.text
      : (layoutEntry?.renderText !== undefined ? layoutEntry.renderText : translatedText);
    const effectiveProfile = layoutEntry?.effectiveProfile || overlayLayoutProfile;
    const styleKind = layoutEntry?.styleKind;
    const isDocLike = styleKind
      ? styleKind === 'document-heading' || styleKind === 'document-body'
      : effectiveProfile === 'official';
    const isComicLike = !isDocLike;
    const useLayerBbox = Boolean(layer && layer.userEdited);

    const maskBbox = useLayerBbox
      ? layer!.bbox
      : ((!isMaskOnly && layoutEntry?.mergedMaskBBox) || resolveOverlayMaskBBox(line));
    const resolvedSrcBbox = useLayerBbox
      ? layer!.bbox
      : resolveOverlaySourceBBox(line);
    const mskW = Math.max(1, maskBbox.x1 - maskBbox.x0);
    const mskH = Math.max(1, maskBbox.y1 - maskBbox.y0);
    const srcWLine = Math.max(1, resolvedSrcBbox.x1 - resolvedSrcBbox.x0);
    const srcHLine = Math.max(1, resolvedSrcBbox.y1 - resolvedSrcBbox.y0);
    const wCov = srcWLine / mskW;
    const aCov = (srcWLine * srcHLine) / Math.max(1, mskW * mskH);
    const lowCov = shouldUseDocumentCoverageFallback(line.text) && wCov < 0.84 && aCov < 0.86;
    const srcBbox = useLayerBbox
      ? layer!.bbox
      : (isMaskOnly
        ? resolvedSrcBbox
        : (layoutEntry?.mergedBBox || (isDocLike || lowCov ? maskBbox : resolvedSrcBbox)));

    const mrkLeft = maskBbox.x0;
    const rkLeft = layoutEntry?.alignment === 'left' && layoutEntry.sharedBoxLeftX !== undefined
      ? Math.min(srcBbox.x0, layoutEntry.sharedBoxLeftX)
      : srcBbox.x0;
    const mBW = Math.max(1, (maskBbox.x1 - mrkLeft) * sx);
    const mBH = Math.max(1, (maskBbox.y1 - maskBbox.y0) * sy);
    const bW = Math.max(1, (srcBbox.x1 - rkLeft) * sx);
    const bH = Math.max(1, (srcBbox.y1 - srcBbox.y0) * sy);

    const hasThaiText = /[\u0E00-\u0E7F]/.test(renderText);
    const expansion = resolveOverlayMaskExpansion(line);
    const mergedMaskBoost = 0;
    const comicMaskBoostX = 0;
    const comicMaskBoostTop = 0;
    const comicMaskBoostBottom = 0;

    const maskExpandX = Math.min(
      expansion.maxExpandX * sx + mergedMaskBoost + comicMaskBoostX,
      Math.max(1, Math.round(mBH * expansion.expandXRatio)) + mergedMaskBoost + comicMaskBoostX
    );
    const maskExpandLeft = Math.min(isComicLike ? 4 * sx : 1 * sx, maskExpandX);
    const maskExpandRight = maskExpandX;
    const maskExpandTop = Math.min(
      expansion.maxExpandTop * sy + mergedMaskBoost + comicMaskBoostTop,
      Math.max(1, Math.round(mBH * expansion.expandTopRatio)) + mergedMaskBoost + comicMaskBoostTop
    );
    const thaiBottomBoost = hasThaiText ? Math.min(3 * sy, Math.max(1 * sy, Math.round(mBH * 0.08))) : 0;
    const documentBottomBoost = isDocLike
      ? Math.min(8 * sy, Math.max(2 * sy, Math.round(mBH * 0.16)))
      : 0;
    const maskExpandBottom = Math.min(
      expansion.maxExpandBottom * sy + thaiBottomBoost + documentBottomBoost + mergedMaskBoost + comicMaskBoostBottom,
      Math.max(1, Math.round(mBH * expansion.expandBottomRatio)) + thaiBottomBoost + documentBottomBoost + mergedMaskBoost + comicMaskBoostBottom
    );

    const maskBleed = 2.5; // ถมสีกว้างกว่า border area เล็กน้อยในหน่วย pt เพื่อความมิดชิดของข้อความเดิม
    const maskRect = clampOverlayRect(
      mrkLeft * sx - maskExpandLeft - maskBleed,
      maskBbox.y0 * sy - maskExpandTop - maskBleed,
      mBW + maskExpandLeft + maskExpandRight + (maskBleed * 2),
      mBH + maskExpandTop + maskExpandBottom + (maskBleed * 2),
      pageBounds
    );

    const palette = paletteMap.get(index) ?? DEFAULT_OVERLAY_PALETTE;
    const maskBackgroundColor = (layer && layer.backgroundColor !== undefined)
      ? layer.backgroundColor
      : palette.backgroundColor;

    const maskEl = document.createElement('div');
    maskEl.className = 'export-mask';
    maskEl.style.left = `${maskRect.left}pt`;
    maskEl.style.top = `${maskRect.top}pt`;
    maskEl.style.width = `${maskRect.width}pt`;
    maskEl.style.height = `${maskRect.height}pt`;
    maskEl.style.backgroundColor = maskBackgroundColor;
    maskEl.style.overflow = 'hidden';
    root.appendChild(maskEl);
    if (isMaskOnly) return;

    const useMergedComicTextRect = (styleKind === 'comic-bubble' || styleKind === 'comic-box')
      && !isMaskOnly
      && Boolean(layoutEntry?.mergedMaskBBox);
    const textSourceLeft = useMergedComicTextRect ? mrkLeft : rkLeft;
    const textSourceTop = srcBbox.y0;
    const textBaseWidth = useMergedComicTextRect ? Math.max(bW, mBW) : bW;
    const textBaseHeight = bH;

    const mergedComicTextTopLift = 0;
    const mergedComicTextExtraHeight = 0;

    const rawTextLeft = textSourceLeft * sx - (layoutEntry?.alignment === 'center' ? 0 : maskExpandLeft);
    const rawTextTop = textSourceTop * sy - maskExpandTop - mergedComicTextTopLift;
    const rawTextWidth = textBaseWidth + (layoutEntry?.alignment === 'center' ? 0 : maskExpandLeft + maskExpandRight);
    const rawTextHeight = textBaseHeight + maskExpandTop + maskExpandBottom + mergedComicTextTopLift + mergedComicTextExtraHeight;

    let textRect = clampOverlayRect(rawTextLeft, rawTextTop, rawTextWidth, rawTextHeight, pageBounds);
    if (isComicLike) {
      textRect = clampOverlayRect(textRect.left, textRect.top, textRect.width, textRect.height, {
        x0: Math.max(0, maskRect.left - 1),
        y0: Math.max(0, maskRect.top - 1),
        x1: Math.min(pageBounds.x1, maskRect.left + maskRect.width + 1),
        y1: Math.min(pageBounds.y1, maskRect.top + maskRect.height + 1),
      });
    }

    const thaiDocumentHeadroom = isDocLike && hasThaiText
      ? Math.max(4, Math.round(Math.max(bW, mBW) * 0.4))
      : 0;
    const documentTypographyWidth = lowCov
      ? Math.max(bW, mBW)
      : Math.max(bW, textRect.width * 0.96);
    const typographyWidth = isDocLike ? documentTypographyWidth : textRect.width;
    const typographyHeight = isDocLike
      ? Math.min(
          textRect.height,
          Math.max(bH + thaiDocumentHeadroom, (lowCov ? mBH : bH) + thaiDocumentHeadroom)
        )
      : textRect.height;

    const baseTypo = layoutEntry?.typography || computeOverlayTypography(renderText, typographyWidth, typographyHeight, {
      sourceText: line.text,
      sourceBoxWidth: isDocLike && lowCov ? Math.max(bW, mBW) : bW,
      sourceBoxHeight: isDocLike
        ? (lowCov ? Math.max(bH, mBH) : bH) + thaiDocumentHeadroom
        : bH,
      sourceLineCount: 1,
      fontFamily: overlayFontFamily,
      profile: effectiveProfile,
      styleKind,
    });
    const typo = scaleOverlayTypography(baseTypo, overlayFontSizeScale);
    if (layer && layer.userEdited) {
      typo.fontSize = (layer.fontSize || 14) * sx;
    }

    // ทำไมถึงเขียนแบบนี้: คำนวณขอบเขตและตำแหน่งความสูง/ความกว้างของกล่องข้อความภายใน
    // ตามแบบที่ทำใน PDFCanvas.tsx เพื่อให้สัดส่วนการตัดคำและตำแหน่งแสดงผลตรงกันเป๊ะ 100%
    const extraTopPad = hasThaiText ? Math.max(1, Math.round(typo.fontSize * 0.08)) : 0;
    const extraBottomPad = hasThaiText ? Math.max(1, Math.round(typo.fontSize * 0.06)) : 0;

    const textStartOffset = layoutEntry?.sharedTextStartX !== undefined
      ? Math.max(0, (layoutEntry.sharedTextStartX - textSourceLeft) * sx)
      : 0;
    const centerOffset = layoutEntry?.sharedCenterX !== undefined
      ? ((layoutEntry.sharedCenterX - textSourceLeft) * sx) - (textRect.width * 0.5)
      : 0;

    const innerLeft = layoutEntry?.alignment === 'center'
      ? (effectiveProfile === 'manga' || effectiveProfile === 'manhwa'
        ? centerOffset
        : Math.max(0, Math.min(textRect.width * 0.12, centerOffset)))
      : Math.max(0, Math.min(textRect.width - 1, maskExpandLeft + textStartOffset));

    const innerWidth = layoutEntry?.alignment === 'center'
      ? textRect.width
      : Math.max(1, textRect.width - innerLeft);

    const thaiComicLine = hasThaiText && (styleKind === 'comic-bubble' || styleKind === 'comic-box');
    const isComicCenter = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && layoutEntry?.alignment === 'center';
    const minFillRatio = typo.estimatedLines > 1
      ? (thaiComicLine ? 0.82 : 0.74)
      : (thaiComicLine ? 0.58 : 0.5);

    const naturalPaintHeight = typo.contentHeight + typo.padY * 2 + extraTopPad + extraBottomPad;
    const paintHeight = isComicCenter
      ? Math.min(textRect.height * 1.25, naturalPaintHeight)
      : Math.min(
          textRect.height * 1.25,
          Math.max(naturalPaintHeight, textRect.height * minFillRatio)
        );
    const thaiVisualShift = (isComicCenter && hasThaiText)
      ? Math.round(maskRect.height * 0.035)
      : 0;
    const paintOffsetTop = isComicCenter
      ? Math.max(0, Math.min(textRect.height - paintHeight, Math.round((maskRect.top - textRect.top) + (maskRect.height - paintHeight) * 0.5 - thaiVisualShift)))
      : Math.max(
          hasThaiText ? 1 * sy : 0,
          Math.min(textRect.height - paintHeight, Math.round(textRect.height * (thaiComicLine ? 0.04 : 0.08)))
        );

    const overlayText = typo.forceSingleLine ? normalizeOverlayInlineText(renderText) : renderText;
    const rotDeg = layer ? (layer.rotation || 0) : estimateLineRotationDeg(line);
    const textWeight = layer?.bold
      ? '700'
      : String(Math.max(400, Math.min(700, Math.round(Number(palette.textFillWeight || 400)))));
    const textColor = (layer && layer.textColor !== undefined) ? layer.textColor : palette.textColor;

    const outerEl = document.createElement('div');
    outerEl.className = 'export-text-outer';
    outerEl.style.left = `${textRect.left}pt`;
    outerEl.style.top = `${textRect.top}pt`;
    outerEl.style.width = `${textRect.width}pt`;
    outerEl.style.height = `${textRect.height}pt`;

    const rotationOrigin = layer ? 'center center' : 'left top';
    if (rotDeg !== 0) {
      outerEl.style.transformOrigin = rotationOrigin;
      outerEl.style.transform = `rotate(${rotDeg}deg)`;
    }

    const innerEl = document.createElement('div');
    innerEl.className = 'export-text-inner';
    innerEl.style.left = `${innerLeft}pt`;
    innerEl.style.top = `${paintOffsetTop}pt`;
    innerEl.style.width = `${innerWidth}pt`;
    innerEl.style.maxWidth = `${innerWidth}pt`;
    innerEl.style.minWidth = `${innerWidth}pt`;
    innerEl.style.height = `${paintHeight}pt`;
    innerEl.style.maxHeight = `${paintHeight}pt`;
    innerEl.style.minHeight = `${paintHeight}pt`;
    innerEl.style.padding = `${typo.padY + extraTopPad}pt ${typo.padX}pt ${typo.padY + extraBottomPad}pt ${typo.padX}pt`;
    innerEl.style.color = textColor;
    innerEl.style.fontSize = `${typo.fontSize}pt`;
    innerEl.style.lineHeight = String(typo.lineHeight);
    innerEl.style.fontFamily = overlayFontFamily;
    innerEl.style.fontWeight = textWeight;
    const layoutProfile = layoutEntry?.effectiveProfile || pageConfig.overlayLayoutProfile;
    const isMangaOrManhwa = layoutProfile === 'manga' || layoutProfile === 'manhwa';
    innerEl.style.alignItems = isComicCenter ? 'center' : 'flex-start';
    innerEl.style.justifyContent = isMangaOrManhwa && layoutEntry?.alignment === 'center' ? 'center' : 'flex-start';
    innerEl.style.textAlign = layoutEntry?.alignment === 'center' ? 'center' : 'left';
    
    // ตั้งค่า word-break และ white-space เพื่อแก้ปัญหาวรรณยุกต์ภาษาไทยซ้อนหรือถูกดีดลงบรรทัดใหม่
    innerEl.style.whiteSpace = typo.forceSingleLine ? 'nowrap' : 'pre-wrap';
    innerEl.style.wordBreak = 'normal';
    innerEl.style.lineBreak = hasThaiText ? 'auto' : 'normal';
    innerEl.style.overflowWrap = typo.forceSingleLine
      ? 'normal'
      : (hasThaiText ? 'normal' : 'break-word');

    innerEl.textContent = overlayText;
    applyTextStroke(innerEl, Number(palette.textStrokeWidth || 0), palette.textStrokeColor || '', typo.fontSize);

    outerEl.appendChild(innerEl);
    root.appendChild(outerEl);
  });
};

const appendUserLayerElements = (
  root: HTMLElement,
  pageConfig: PdfPrintExportPageConfig,
  layout: LayoutDimensions,
): void => {
  const { sx, sy } = layout;
  const ocrLinesCount = pageConfig.sourceOCR.lines.length;

  pageConfig.pageLayers
    .filter((layer) => layer.visible && layer.userEdited && (layer.lineIndex === undefined || layer.lineIndex === null || layer.lineIndex < 0 || layer.lineIndex >= ocrLinesCount))
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
