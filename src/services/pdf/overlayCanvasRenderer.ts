import type { PdfPrintExportPageConfig } from '../../types/pdfExport';
import type { TextOverlayItem } from '../bridge/pdfContracts';
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
  type OverlayPalette,
} from '../../components/OCR/translationOverlayUtils';
import {
  scaleOverlayTypography,
  shouldSkipOverlayForUntranslatedCarryOver,
  shouldUseDocumentCoverageFallback,
} from '../translation/offlineTranslationService';
import { wrapCanvasText } from '../layout/canvasLayoutService';
import { isSourceFallbackOverlayText } from '../translation/textRedistributionService';
import { normalizeWhitespace } from '../ocr/ocrTextNormalizer';

export interface RenderedPageOverlay {
  imageBytes: Uint8Array;
  textOverlays: TextOverlayItem[];
}

/**
 * เรนเดอร์ Overlay ของหน้าเอกสารลงบน Transparent Canvas 2D
 * เพื่อให้ได้ภาพ PNG ที่มี Mask และข้อความแปลภาษา (รวมสระวรรณยุกต์ไทยสมบูรณ์แบบ)
 * พร้อมทั้งสกัดพิกัด TextOverlayItem สำหรับสร้าง Invisible Search Layer ใน Rust
 */
export async function renderPageOverlayToRaster(
  pageConfig: PdfPrintExportPageConfig,
  targetDimensions?: { width: number; height: number }
): Promise<RenderedPageOverlay> {
  const ocrWidth = Math.max(1, Number(pageConfig.sourceOCR.width || 800));
  const ocrHeight = Math.max(1, Number(pageConfig.sourceOCR.height || 1131));

  // กำหนด Resolution สำหรับ Render Overlay ให้คมชัด (ใช้ Scale ~2.0 หรือ targetDimensions)
  const renderWidth = targetDimensions?.width
    ? Math.round(targetDimensions.width)
    : Math.max(1600, ocrWidth * 2);
  const renderHeight = targetDimensions?.height
    ? Math.round(targetDimensions.height)
    : Math.max(2262, ocrHeight * 2);

  const scaleX = renderWidth / ocrWidth;
  const scaleY = renderHeight / ocrHeight;

  // สำหรับพิกัด PDF Points
  const ptWidth = pageConfig.pageWidthPt || 595.276;
  const ptHeight = pageConfig.pageHeightPt || 841.890;
  const ptScaleX = ptWidth / ocrWidth;
  const ptScaleY = ptHeight / ocrHeight;

  const canvas = document.createElement('canvas');
  canvas.width = renderWidth;
  canvas.height = renderHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context not available.');
  }

  // เคลียร์พื้นหลังให้โปร่งใส (Transparent)
  ctx.clearRect(0, 0, renderWidth, renderHeight);

  const fontReadyPromise = (typeof document !== 'undefined' && 'fonts' in document)
    ? (document as Document & { fonts?: FontFaceSet }).fonts?.ready
    : undefined;
  if (fontReadyPromise) {
    await fontReadyPromise.catch(() => undefined);
  }

  const translatedByIndex = new Map<number, string>(
    pageConfig.translatedByIndex.map((item) => [item.index, item.text])
  );
  const deletedLineIndexes = new Set<number>(pageConfig.deletedLineIndexes);
  const textOverlays: TextOverlayItem[] = [];

  const overlayLayoutByIndex = computeOverlayLayoutMap(
    pageConfig.sourceOCR.lines.flatMap((line, index) => {
      if (deletedLineIndexes.has(index)) return [];
      const lineLayer = pageConfig.pageLayers.find((l) => l.lineIndex === index && l.visible);
      let translatedText = (() => {
        if (lineLayer) {
          const normLayer = normalizeWhitespace(String(lineLayer.text || ''));
          const normSource = normalizeWhitespace(String(lineLayer.sourceText || line.text || ''));
          if (lineLayer.userEdited || (normLayer && normLayer !== normSource)) {
            return normLayer || translatedByIndex.get(index);
          }
          const tText = translatedByIndex.get(index);
          return tText !== undefined ? tText : (normLayer || line.text);
        }
        const tText = translatedByIndex.get(index);
        return tText !== undefined ? tText : line.text;
      })();

      if (translatedText === '') translatedText = ' ';
      if (!translatedText) return [];

      const sourceFallback = isSourceFallbackOverlayText(line.text, translatedText);
      if (!lineLayer && shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallback) return [];
      if (!lineLayer && shouldSkipOverlayForUntranslatedCarryOver(line.text, translatedText, pageConfig.targetLanguage) && !sourceFallback) return [];

      const layer = pageConfig.pageLayers.find((l) => l.lineIndex === index);
      const balloonId = layer?.groupId;

      const sourceBbox = resolveOverlaySourceBBox(line);
      const maskBbox = resolveOverlayMaskBBox(line);
      const lowCoverageSource = shouldUseDocumentCoverageFallback(line.text);
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
        x1: renderWidth,
        y1: renderHeight,
      });

      return [{
        index,
        text: translatedText,
        width: pageConfig.overlayLayoutProfile === 'official' ? baseWidth : rect.width,
        height: pageConfig.overlayLayoutProfile === 'official' ? baseHeight : rect.height,
        bbox: pageConfig.overlayLayoutProfile === 'official' ? maskBbox : effectiveSourceBbox,
        line,
        balloonId,
        hints: {
          sourceText: line.text,
          sourceBoxWidth: baseWidth,
          sourceBoxHeight: baseHeight,
          sourceLineCount: 1,
          fontFamily: pageConfig.overlayFontFamily,
          profile: pageConfig.overlayLayoutProfile,
        },
      }];
    }),
    { profile: pageConfig.overlayLayoutProfile }
  );

  const paletteByIndexMap = new Map<number, import('../../types/pdfExport').ExportOverlayPaletteEntry>();
  if (pageConfig.paletteByIndex) {
    pageConfig.paletteByIndex.forEach((entry) => {
      paletteByIndexMap.set(entry.index, entry);
    });
  }


  // วนลูปวาด Mask และ Text แต่ละ Line
  pageConfig.sourceOCR.lines.forEach((line, index) => {
    if (deletedLineIndexes.has(index)) return;
    const lineLayer = pageConfig.pageLayers.find((l) => l.lineIndex === index && l.visible);
    let translatedText = (() => {
      if (lineLayer) {
        const normLayer = normalizeWhitespace(String(lineLayer.text || ''));
        const normSource = normalizeWhitespace(String(lineLayer.sourceText || line.text || ''));
        if (lineLayer.userEdited || (normLayer && normLayer !== normSource)) {
          return normLayer || translatedByIndex.get(index);
        }
        const tText = translatedByIndex.get(index);
        return tText !== undefined ? tText : (normLayer || line.text);
      }
      const tText = translatedByIndex.get(index);
      return tText !== undefined ? tText : line.text;
    })();

    if (translatedText === '') translatedText = ' ';
    if (!translatedText) return;

    const layout = overlayLayoutByIndex.get(index);
    const isMaskOnly = Boolean(layout?.hidden);
    if (isMaskOnly && !layout?.preserveMaskWhenHidden) return;

    if (!isMaskOnly) {
      const sourceFallback = isSourceFallbackOverlayText(line.text, translatedText);
      if (!lineLayer && shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallback) return;
      if (!lineLayer && shouldSkipOverlayForUntranslatedCarryOver(line.text, translatedText, pageConfig.targetLanguage) && !sourceFallback) return;
      const matchedUserLayer = pageConfig.pageLayers.find((l) => l.lineIndex === index && l.visible && l.userEdited);
      if (matchedUserLayer) return;
    }

    const renderText = layout?.renderText || translatedText;
    const effectiveProfile = layout?.effectiveProfile || pageConfig.overlayLayoutProfile;
    const styleKind = layout?.styleKind;
    const isDocLike = styleKind
      ? styleKind === 'document-heading' || styleKind === 'document-body'
      : effectiveProfile === 'official';
    const maskBbox = (!isMaskOnly && layout?.mergedMaskBBox) || resolveOverlayMaskBBox(line);
    const sourceBbox = resolveOverlaySourceBBox(line);
    const baseWidth = Math.max(1, (sourceBbox.x1 - sourceBbox.x0) * scaleX);
    const baseHeight = Math.max(1, (sourceBbox.y1 - sourceBbox.y0) * scaleY);
    const expansion = resolveOverlayMaskExpansion(line);
    const maskExpandX = Math.min(expansion.maxExpandX, Math.max(1, Math.round(baseHeight * expansion.expandXRatio)));
    const maskExpandTop = Math.min(expansion.maxExpandTop, Math.max(1, Math.round(baseHeight * expansion.expandTopRatio)));
    const maskExpandBottom = Math.min(expansion.maxExpandBottom, Math.max(1, Math.round(baseHeight * expansion.expandBottomRatio)));
    const maskBaseWidth = Math.max(1, (maskBbox.x1 - maskBbox.x0) * scaleX);
    const maskBaseHeight = Math.max(1, (maskBbox.y1 - maskBbox.y0) * scaleY);

    const maskRect = clampOverlayRect(
      maskBbox.x0 * scaleX - maskExpandX,
      maskBbox.y0 * scaleY - maskExpandTop,
      maskBaseWidth + maskExpandX * 2,
      maskBaseHeight + maskExpandTop + maskExpandBottom,
      { x0: 0, y0: 0, x1: renderWidth, y1: renderHeight }
    );

    const textRect = clampOverlayRect(
      sourceBbox.x0 * scaleX - maskExpandX,
      sourceBbox.y0 * scaleY - maskExpandTop,
      baseWidth + maskExpandX * 2,
      baseHeight + maskExpandTop + maskExpandBottom,
      { x0: 0, y0: 0, x1: renderWidth, y1: renderHeight }
    );

    const palette = paletteByIndexMap.get(index) || DEFAULT_OVERLAY_PALETTE;
    const maskBg = palette.backgroundColor || '#FFFFFF';

    // วาด Mask ปิดข้อความเดิม
    const rotationDeg = estimateLineRotationDeg(line);
    const rotationRad = (rotationDeg * Math.PI) / 180;
    ctx.save();
    if (rotationDeg !== 0) {
      ctx.translate(maskRect.left, maskRect.top);
      ctx.rotate(rotationRad);
      ctx.fillStyle = maskBg;
      ctx.fillRect(0, 0, maskRect.width, maskRect.height);
    } else {
      ctx.fillStyle = maskBg;
      ctx.fillRect(maskRect.left, maskRect.top, maskRect.width, maskRect.height);
    }
    ctx.restore();

    if (isMaskOnly) return;

    // คำนวณ Typography
    const hasThai = /[\u0E00-\u0E7F]/u.test(renderText);
    const thaiHeadroom = isDocLike && hasThai ? Math.max(4, Math.round(baseHeight * 0.4)) : 0;
    const typoWidth = isDocLike ? Math.max(baseWidth, textRect.width * 0.96) : textRect.width;
    const typoHeight = isDocLike ? Math.min(textRect.height, baseHeight + thaiHeadroom) : textRect.height;

    const baseTypography = layout?.typography || computeOverlayTypography(renderText, typoWidth, typoHeight, {
      sourceText: line.text,
      sourceBoxWidth: baseWidth,
      sourceBoxHeight: baseHeight + thaiHeadroom,
      sourceLineCount: 1,
      fontFamily: pageConfig.overlayFontFamily,
      profile: effectiveProfile,
      styleKind,
    });
    const typography = scaleOverlayTypography(baseTypography, pageConfig.overlayFontSizeScale);
    const overlayText = typography.forceSingleLine ? normalizeOverlayInlineText(renderText) : renderText;

    // คำนวณจุดวาง Text
    ctx.save();
    if (rotationDeg !== 0) {
      ctx.translate(textRect.left, textRect.top);
      ctx.rotate(rotationRad);
    }

    const originLeft = rotationDeg !== 0 ? 0 : textRect.left;
    const originTop = rotationDeg !== 0 ? 0 : textRect.top;
    const textWeight = Math.max(400, Math.min(700, Math.round(Number(palette.textFillWeight || 400))));

    ctx.font = `${textWeight} ${typography.fontSize}px ${pageConfig.overlayFontFamily}`;
    ctx.fillStyle = palette.textColor || '#000000';
    ctx.textBaseline = 'top';
    ctx.textAlign = layout?.alignment === 'center' ? 'center' : 'left';

    const textBoxWidth = Math.max(1, textRect.width - typography.padX * 2);
    const lineHeightPx = Math.max(1, typography.fontSize * typography.lineHeight);
    const maxLines = Math.max(1, typography.estimatedLines);
    const lines = wrapCanvasText(ctx, overlayText, textBoxWidth, maxLines, typography.forceSingleLine);

    const startX = ctx.textAlign === 'center' ? originLeft + textRect.width / 2 : originLeft + typography.padX;
    const startY = originTop + typography.padY;

    lines.forEach((lText, lIdx) => {
      const y = startY + lIdx * lineHeightPx;
      ctx.fillText(lText, startX, y, textBoxWidth);
    });
    ctx.restore();

    // บันทึก TextOverlayItem สำหรับ Invisible Searchable Text ใน PDF
    textOverlays.push({
      pageNumber: pageConfig.pageNum,
      x: sourceBbox.x0 * ptScaleX,
      y: sourceBbox.y0 * ptScaleY,
      width: (sourceBbox.x1 - sourceBbox.x0) * ptScaleX,
      height: (sourceBbox.y1 - sourceBbox.y0) * ptScaleY,
      text: renderText,
      fontSize: Math.max(8, typography.fontSize * (ptScaleX / scaleX)),
      fontColor: undefined, // invisible overlay ใน Rust
    });
  });

  // วาด User Edited Layers
  const userLayers = pageConfig.pageLayers.filter((l) => l.visible && l.userEdited);
  for (const layer of userLayers) {
    const lx = Math.round(layer.bbox.x0 * scaleX);
    const ly = Math.round(layer.bbox.y0 * scaleY);
    const lw = Math.max(1, Math.round((layer.bbox.x1 - layer.bbox.x0) * scaleX));
    const lh = Math.max(1, Math.round((layer.bbox.y1 - layer.bbox.y0) * scaleY));

    ctx.save();
    ctx.fillStyle = layer.backgroundColor || '#FFFFFF';
    ctx.fillRect(lx, ly, lw, lh);

    const baseFSize = layer.fontSize || 14;
    const resolvedFSize = Math.max(8, Math.round(baseFSize * scaleX));
    ctx.font = `${layer.bold ? 'bold' : 'normal'} ${resolvedFSize}px ${pageConfig.overlayFontFamily}`;
    ctx.fillStyle = layer.textColor || '#000000';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    const text = layer.text || '';
    const lineHeight = Math.max(1, resolvedFSize * 1.35);
    const maxL = Math.max(1, Math.floor((lh - 6) / lineHeight));
    const wrapped = wrapCanvasText(ctx, text, lw - 8, maxL, false);
    wrapped.forEach((wLine, wIdx) => {
      ctx.fillText(wLine, lx + 4, ly + 3 + wIdx * lineHeight, lw - 8);
    });
    ctx.restore();

    textOverlays.push({
      pageNumber: pageConfig.pageNum,
      x: layer.bbox.x0 * ptScaleX,
      y: layer.bbox.y0 * ptScaleY,
      width: (layer.bbox.x1 - layer.bbox.x0) * ptScaleX,
      height: (layer.bbox.y1 - layer.bbox.y0) * ptScaleY,
      text: layer.text || '',
      fontSize: Math.max(8, (layer.fontSize || 14) * ptScaleX),
    });
  }

  // แปลง Canvas เป็น PNG Binary Bytes
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('Failed to encode overlay canvas to PNG blob.'));
    }, 'image/png');
  });

  const arrayBuffer = await blob.arrayBuffer();
  return {
    imageBytes: new Uint8Array(arrayBuffer),
    textOverlays,
  };
}
