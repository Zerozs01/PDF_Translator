import React, { useMemo } from 'react';
import type { TextLayer, TextLayerGroup } from '../../types/layers';
import {
  clampOverlayRect,
  computeOverlayTypography,
  estimateLineRotationDeg,
  normalizeOverlayInlineText,
  resolveOverlayMaskBBox,
  resolveOverlayMaskExpansion,
  resolveOverlaySourceBBox,
  type OverlayPalette,
  type OverlayLayout,
  type OverlayLayoutProfile,
  type OverlayTypography,
} from '../OCR/translationOverlayUtils';
import { collectTextSearchMatches, type TextSearchPattern } from '../../services/textSearch';

// ─── Helper Functions ───────────────────────────────────────────

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

// ─── Component Props ─────────────────────────────────────────────

export interface OverlayLineItemProps {
  idx: number;
  line: any;
  layout?: OverlayLayout;
  layer?: TextLayer;
  renderText: string;
  isMaskOnlyLine: boolean;
  hasThaiText: boolean;
  ocrOverlayTransform: { scaleX: number; scaleY: number; offsetX: number; offsetY: number };
  overlayLayoutProfile: OverlayLayoutProfile;
  overlayFontFamily?: string;
  overlayFontSizeScale: number;
  overlaySearchPattern: TextSearchPattern | null;
  palette: OverlayPalette;
  continuationPalette: OverlayPalette;
  pageWidth: number;
  pageHeight: number;
}

// ─── Memoized Overlay Line Item ──────────────────────────────────

export const OverlayLineItem: React.FC<OverlayLineItemProps> = React.memo(({
  idx,
  line,
  layout,
  layer,
  renderText,
  isMaskOnlyLine,
  hasThaiText,
  ocrOverlayTransform,
  overlayLayoutProfile,
  overlayFontFamily,
  overlayFontSizeScale,
  overlaySearchPattern,
  palette,
  continuationPalette,
  pageWidth,
  pageHeight,
}) => {
  const effectiveProfile = layout?.effectiveProfile || overlayLayoutProfile;
  const styleKind = layout?.styleKind;
  const isDocumentLikeOverlay = styleKind
    ? styleKind === 'document-heading' || styleKind === 'document-body'
    : effectiveProfile === 'official';
  const isComicLikeOverlay = !isDocumentLikeOverlay;
  const useLayerBbox = Boolean(layer && layer.userEdited);

  const maskBbox = useLayerBbox
    ? layer!.bbox
    : ((!isMaskOnlyLine && layout?.mergedMaskBBox) || resolveOverlayMaskBBox(line));
  const resolvedSourceBbox = useLayerBbox
    ? layer!.bbox
    : resolveOverlaySourceBBox(line);

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

  const sourceBbox = useLayerBbox
    ? layer!.bbox
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

  const expansion = resolveOverlayMaskExpansion(line);
  const mergedMaskBoost = 0;
  const comicMaskBoostX = 0;
  const comicMaskBoostTop = 0;
  const comicMaskBoostBottom = 0;

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
  const maskBleed = 2.5; // ถมสีกว้างกว่า border area เล็กน้อยเพื่อไม่ให้เหลือเศษตัวอักษรเดิม

  const rawMaskLeft = ocrOverlayTransform.offsetX + maskRenderSourceLeft * ocrOverlayTransform.scaleX - maskExpandLeft - maskBleed;
  const rawMaskTop = ocrOverlayTransform.offsetY + maskBbox.y0 * ocrOverlayTransform.scaleY - maskExpandTop - maskBleed;
  const rawMaskWidth = maskBaseWidth + maskExpandLeft + maskExpandRight + (maskBleed * 2);
  const rawMaskHeight = maskBaseHeight + maskExpandTop + maskExpandBottom + (maskBleed * 2);

  const maskRect = clampOverlayRect(rawMaskLeft, rawMaskTop, rawMaskWidth, rawMaskHeight, {
    x0: ocrOverlayTransform.offsetX,
    y0: ocrOverlayTransform.offsetY,
    x1: ocrOverlayTransform.offsetX + pageWidth * ocrOverlayTransform.scaleX,
    y1: ocrOverlayTransform.offsetY + pageHeight * ocrOverlayTransform.scaleY,
  });

  const useMergedComicTextRect = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && !isMaskOnlyLine && Boolean(layout?.mergedMaskBBox);
  const textSourceLeft = useMergedComicTextRect ? maskRenderSourceLeft : renderSourceLeft;
  const textSourceTop = useMergedComicTextRect ? maskBbox.y0 : sourceBbox.y0;
  const textBaseWidth = useMergedComicTextRect ? Math.max(baseWidth, maskBaseWidth) : baseWidth;
  const textBaseHeight = useMergedComicTextRect ? Math.max(baseHeight, maskBaseHeight) : baseHeight;
  const mergedComicTextTopLift = 0;
  const mergedComicTextExtraHeight = 0;

  const rawTextLeft = ocrOverlayTransform.offsetX + textSourceLeft * ocrOverlayTransform.scaleX - (layout?.alignment === 'center' ? 0 : maskExpandLeft);
  const rawTextTop = ocrOverlayTransform.offsetY + textSourceTop * ocrOverlayTransform.scaleY - maskExpandTop - mergedComicTextTopLift;
  const rawTextWidth = textBaseWidth + (layout?.alignment === 'center' ? 0 : maskExpandLeft + maskExpandRight);
  const rawTextHeight = textBaseHeight + maskExpandTop + maskExpandBottom + mergedComicTextTopLift + mergedComicTextExtraHeight;

  let textRect = clampOverlayRect(rawTextLeft, rawTextTop, rawTextWidth, rawTextHeight, {
    x0: ocrOverlayTransform.offsetX,
    y0: ocrOverlayTransform.offsetY,
    x1: ocrOverlayTransform.offsetX + pageWidth * ocrOverlayTransform.scaleX,
    y1: ocrOverlayTransform.offsetY + pageHeight * ocrOverlayTransform.scaleY,
  });

  if (!isDocumentLikeOverlay) {
    textRect = clampOverlayRect(textRect.left, textRect.top, textRect.width, textRect.height, {
      x0: Math.max(ocrOverlayTransform.offsetX, maskRect.left - 1),
      y0: Math.max(ocrOverlayTransform.offsetY, maskRect.top - 1),
      x1: Math.min(ocrOverlayTransform.offsetX + pageWidth * ocrOverlayTransform.scaleX, maskRect.left + maskRect.width + 1),
      y1: Math.min(ocrOverlayTransform.offsetY + pageHeight * ocrOverlayTransform.scaleY, maskRect.top + maskRect.height + 1),
    });
  }

  const maskBackgroundColor = layer?.backgroundColor !== undefined ? layer.backgroundColor : palette.backgroundColor;
  const thaiDocumentHeadroom = isDocumentLikeOverlay && hasThaiText
    ? Math.max(4, Math.round(Math.max(baseHeight, maskBaseHeight) * 0.4))
    : 0;

  const documentTypographyWidth = lowCoverageSource
    ? Math.max(baseWidth, maskBaseWidth)
    : Math.max(baseWidth, textRect.width * 0.96);
  const typographyWidth = isDocumentLikeOverlay ? documentTypographyWidth : textRect.width;

  // Manga bubble merge: use the full balloon height for font sizing, not just the first line height
  const mergedBalloonHeight = useMergedComicTextRect ? maskBaseHeight : 0;
  const typographyHeight = isDocumentLikeOverlay
    ? Math.min(
      textRect.height,
      Math.max(baseHeight + thaiDocumentHeadroom, (lowCoverageSource ? maskBaseHeight : baseHeight) + thaiDocumentHeadroom)
    )
    : (mergedBalloonHeight > baseHeight ? mergedBalloonHeight : textRect.height);

  const sourceBoxHeightForTypography = isDocumentLikeOverlay
    ? (lowCoverageSource ? Math.max(baseHeight, maskBaseHeight) : baseHeight) + thaiDocumentHeadroom
    : (mergedBalloonHeight > baseHeight ? mergedBalloonHeight : baseHeight);

  const baseTypography = layout?.typography || computeOverlayTypography(renderText, typographyWidth, typographyHeight, {
    sourceText: line.text,
    sourceBoxWidth: isDocumentLikeOverlay && lowCoverageSource ? Math.max(baseWidth, maskBaseWidth) : baseWidth,
    sourceBoxHeight: sourceBoxHeightForTypography,
    sourceLineCount: 1,
    fontFamily: overlayFontFamily,
    profile: effectiveProfile,
    styleKind,
  });

  const typography = scaleOverlayTypography(baseTypography, overlayFontSizeScale);
  if (layer && layer.userEdited) {
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
    ? (effectiveProfile === 'manga' || effectiveProfile === 'manhwa'
      ? centerOffset
      : Math.max(0, Math.min(textRect.width * 0.12, centerOffset)))
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
  const isComicCenter = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && layout?.alignment === 'center';
  const minFillRatio = typography.estimatedLines > 1
    ? (thaiComicLine ? 0.82 : 0.74)
    : (thaiComicLine ? 0.58 : 0.5);
  const naturalPaintHeight = typography.contentHeight + typography.padY * 2 + extraTopPad + extraBottomPad;
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
        hasThaiText ? 1 : 0,
        Math.min(textRect.height - paintHeight, Math.round(textRect.height * (thaiComicLine ? 0.04 : 0.08)))
      );

  return (
    <React.Fragment key={`ocr-translation-line-${idx}`}>
      <div
        id={layer ? `layer-mask-${layer.id}` : `layer-mask-${idx}`}
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
          id={layer ? `layer-text-${layer.id}` : `layer-text-${idx}`}
          style={{
            left: textRect.left,
            top: textRect.top,
            width: textRect.width,
            maxWidth: textRect.width,
            minWidth: textRect.width,
            height: textRect.height,
            maxHeight: textRect.height,
            minHeight: textRect.height,
            overflow: 'visible',
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
              alignItems: isComicCenter ? 'center' : 'flex-start',
              justifyContent: layout?.alignment === 'center' ? 'center' : 'flex-start',
              textAlign: layout?.alignment === 'center' ? 'center' : 'left',
              whiteSpace: typography.forceSingleLine ? 'nowrap' : 'pre-wrap',
              wordBreak: 'normal',
              lineBreak: hasThaiText ? 'auto' : 'normal',
              WebkitTextStrokeWidth: overlayStrokeWidth > 0 ? `${overlayStrokeWidth.toFixed(2)}px` : undefined,
              WebkitTextStrokeColor: overlayStrokeWidth > 0 ? palette.textStrokeColor : undefined,
              textShadow: palette.textShadow,
              overflowWrap: 'break-word',
              overflow: 'visible',
            }}
          >
            {overlayContent}
          </div>
        </div>
      )}
    </React.Fragment>
  );
});

OverlayLineItem.displayName = 'OverlayLineItem';
