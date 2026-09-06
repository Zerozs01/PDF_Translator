import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { TextLayer } from '../../types/layers';
import type { OverlayLayout } from '../OCR/translationOverlayUtils';
import { resolveOverlayMaskExpansion, clampOverlayRect } from '../OCR/translationOverlayUtils';
import { useLayerStore } from '../../stores/useLayerStore';
import type { OcrTransform } from './layerOverlayTypes';

export interface InlineEditorProps {
  layer: TextLayer;
  ocrTransform: OcrTransform;
  onCommit: (layerId: string, newText: string) => void;
  defaultValue: string;
  pageNum: number;
  layout?: OverlayLayout;
}

export const TEXT_COLORS = [
  { name: 'ดำ', value: '#000000' },
  { name: 'เทา', value: '#374151' },
  { name: 'แดง', value: '#E11D48' },
  { name: 'ส้ม', value: '#D97706' },
  { name: 'เหลือง', value: '#CA8A04' },
  { name: 'เขียว', value: '#16A34A' },
  { name: 'น้ำเงิน', value: '#2563EB' },
  { name: 'ม่วง', value: '#9333EA' },
  { name: 'ชมพู', value: '#DB2777' },
  { name: 'น้ำตาล', value: '#78350F' },
];

export const BG_COLORS = [
  { name: 'โปร่งใส', value: 'transparent' },
  { name: 'ขาว', value: '#FFFFFF' },
  { name: 'เทา', value: '#F3F4F6' },
  { name: 'แดง', value: '#FFE4E6' },
  { name: 'ส้ม', value: '#FFEDD5' },
  { name: 'เหลือง', value: '#FEF9C3' },
  { name: 'เขียว', value: '#DCFCE7' },
  { name: 'น้ำเงิน', value: '#DBEAFE' },
  { name: 'ม่วง', value: '#F3E8FF' },
  { name: 'ชมพู', value: '#FCE7F3' },
  { name: 'น้ำตาล', value: '#FEF3C7' },
];

export const LayerInlineEditor: React.FC<InlineEditorProps> = ({
  layer,
  ocrTransform,
  onCommit,
  defaultValue,
  pageNum,
  layout,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmedValue = defaultValue ? defaultValue.trim() : '';

  const scaleX = ocrTransform.scaleX;
  const scaleY = ocrTransform.scaleY;
  const offsetX = ocrTransform.offsetX;
  const offsetY = ocrTransform.offsetY;

  const maskBbox = (layout && !layer.userEdited) ? (layout.mergedMaskBBox || layer.bbox) : layer.bbox;
  const sourceBbox = (layout && !layer.userEdited) ? (layout.mergedBBox || layer.bbox) : layer.bbox;

  const maskRenderSourceLeft = maskBbox.x0;
  const renderSourceLeft = (!layer.userEdited && layout?.alignment === 'left' && layout.sharedBoxLeftX !== undefined)
    ? Math.min(sourceBbox.x0, layout.sharedBoxLeftX)
    : sourceBbox.x0;

  const maskBaseWidth = Math.max(1, (maskBbox.x1 - maskRenderSourceLeft) * scaleX);
  const maskBaseHeight = Math.max(1, (maskBbox.y1 - maskBbox.y0) * scaleY);
  const baseWidth = Math.max(1, (sourceBbox.x1 - renderSourceLeft) * scaleX);
  const baseHeight = Math.max(1, (sourceBbox.y1 - sourceBbox.y0) * scaleY);

  const styleKind = layout?.styleKind || 'comic-bubble';
  const hasThaiText = /[\u0E00-\u0E7F]/.test(defaultValue || '');

  const expansion = resolveOverlayMaskExpansion({ text: layer.sourceText || layer.text } as any);
  const isComicLikeOverlay = styleKind === 'comic-bubble' || styleKind === 'comic-box' || styleKind === 'comic-line';
  const isDocumentLikeOverlay = styleKind === 'document-heading' || styleKind === 'document-body';

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

  const maskBleed = (styleKind === 'comic-bubble' || styleKind === 'comic-box') ? 2.5 : 0;
  const bounds = { x0: 0, y0: 0, x1: 99999, y1: 99999 };

  const rawMaskLeft = maskRenderSourceLeft * scaleX - maskExpandLeft - maskBleed;
  const rawMaskTop = maskBbox.y0 * scaleY - maskExpandTop - maskBleed;
  const rawMaskWidth = maskBaseWidth + maskExpandLeft + maskExpandRight + (maskBleed * 2);
  const rawMaskHeight = maskBaseHeight + maskExpandTop + maskExpandBottom + (maskBleed * 2);
  const maskRect = clampOverlayRect(rawMaskLeft, rawMaskTop, rawMaskWidth, rawMaskHeight, bounds);

  const useMergedComicTextRect = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && Boolean(layout?.mergedMaskBBox);
  const textSourceLeft = useMergedComicTextRect ? maskRenderSourceLeft : renderSourceLeft;
  const textSourceTop = sourceBbox.y0;
  const textBaseWidth = useMergedComicTextRect ? Math.max(baseWidth, maskBaseWidth) : baseWidth;
  const textBaseHeight = baseHeight;
  const mergedComicTextTopLift = 0;
  const mergedComicTextExtraHeight = 0;

  const rawTextLeft = textSourceLeft * scaleX - (layout?.alignment === 'center' ? 0 : maskExpandLeft);
  const rawTextTop = textSourceTop * scaleY - maskExpandTop - mergedComicTextTopLift;
  const rawTextWidth = textBaseWidth + (layout?.alignment === 'center' ? 0 : maskExpandLeft + maskExpandRight);
  const rawTextHeight = textBaseHeight + maskExpandTop + maskExpandBottom + mergedComicTextTopLift + mergedComicTextExtraHeight;

  let textRect = clampOverlayRect(rawTextLeft, rawTextTop, rawTextWidth, rawTextHeight, bounds);
  if (!isDocumentLikeOverlay) {
    textRect = clampOverlayRect(textRect.left, textRect.top, textRect.width, textRect.height, {
      x0: Math.max(0, maskRect.left - 1),
      y0: Math.max(0, maskRect.top - 1),
      x1: maskRect.left + maskRect.width + 1,
      y1: maskRect.top + maskRect.height + 1,
    });
  }

  const typography = layout?.typography || {
    fontSize: 14 * scaleX,
    lineHeight: 1.12,
    padX: 3,
    padY: 2,
    forceSingleLine: false,
    estimatedLines: 1,
    contentHeight: baseHeight,
  };

  let fontSize = typography.fontSize;
  if (layer && layer.userEdited) {
    fontSize = (layer.fontSize || 14) * scaleX;
  }
  const padX = typography.padX ?? 3;
  const padY = typography.padY ?? 2;

  const extraTopPad = hasThaiText ? Math.max(1, Math.round(fontSize * 0.08)) : 0;
  const extraBottomPad = hasThaiText ? Math.max(1, Math.round(fontSize * 0.06)) : 0;

  const thaiComicLine = hasThaiText && (styleKind === 'comic-bubble' || styleKind === 'comic-box');
  const isComicCenter = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && layout?.alignment === 'center';
  const minFillRatio = typography.estimatedLines > 1
    ? (thaiComicLine ? 0.82 : 0.74)
    : (thaiComicLine ? 0.58 : 0.5);
  const naturalPaintHeight = typography.contentHeight + padY * 2 + extraTopPad + extraBottomPad;

  const paintHeightMultiplier = 1.0;
  const paintHeight = isComicCenter
    ? Math.min(textRect.height * paintHeightMultiplier, naturalPaintHeight)
    : Math.min(
        textRect.height * paintHeightMultiplier,
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

  const inlineLeft = offsetX + textRect.left;
  const inlineTop = offsetY + textRect.top + paintOffsetTop;
  const inlineWidth = textRect.width;

  const { updateLayerBold, updateLayerBackgroundColor, updateLayerTextColor } = useLayerStore();
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const [showBgColorPicker, setShowBgColorPicker] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      adjustHeight();
    }
  }, [adjustHeight]);

  const commit = useCallback(() => {
    const value = textareaRef.current?.value ?? trimmedValue;
    onCommit(layer.id, value.trim());
  }, [layer.id, trimmedValue, onCommit]);

  return (
    <div
      style={{
        position: 'absolute',
        left: inlineLeft,
        top: inlineTop,
        width: Math.max(inlineWidth, 140),
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
      {/* Notion-style Floating Toolbar */}
      <div
        onMouseDown={(e) => e.preventDefault()} // CRITICAL: Prevent blur on textarea!
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          background: '#FFFFFF',
          border: '1px solid #E2E8F0',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08), 0 2px 4px rgba(0, 0, 0, 0.04)',
          borderRadius: '8px',
          padding: '4px 6px',
          position: 'absolute',
          top: -8,
          left: 0,
          opacity: mounted ? 1 : 0,
          transform: mounted ? 'translateY(-100%) scale(1)' : 'translateY(-90%) scale(0.95)',
          transition: 'opacity 0.15s cubic-bezier(0.16, 1, 0.3, 1), transform 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
          zIndex: 10001,
          whiteSpace: 'nowrap',
          boxSizing: 'border-box',
        }}
      >
        {/* Bold Button */}
        <button
          onClick={() => updateLayerBold(pageNum, layer.id, !layer.bold)}
          style={{
            padding: '4px 8px',
            fontSize: 13,
            fontWeight: 'bold',
            borderRadius: 4,
            background: layer.bold ? '#EFF6FF' : 'transparent',
            color: layer.bold ? '#2563EB' : '#475569',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 28,
            height: 28,
            transition: 'all 0.15s',
          }}
          title="ตัวหนา"
        >
          B
        </button>

        {/* Text Color Button */}
        <button
          onClick={() => {
            setShowTextColorPicker(!showTextColorPicker);
            setShowBgColorPicker(false);
          }}
          style={{
            padding: '4px 8px',
            fontSize: 13,
            borderRadius: 4,
            background: showTextColorPicker ? '#F1F5F9' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            height: 28,
            transition: 'all 0.15s',
          }}
          title="สีตัวอักษร"
        >
          <span style={{ color: layer.textColor || '#000000', fontWeight: 'bold' }}>A</span>
          <span style={{ fontSize: 10, color: '#64748B' }}>▼</span>
        </button>

        {/* BG Color Button */}
        <button
          onClick={() => {
            setShowBgColorPicker(!showBgColorPicker);
            setShowTextColorPicker(false);
          }}
          style={{
            padding: '4px 8px',
            fontSize: 13,
            borderRadius: 4,
            background: showBgColorPicker ? '#F1F5F9' : 'transparent',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            height: 28,
            transition: 'all 0.15s',
          }}
          title="สีพื้นหลัง"
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              border: '1px solid #CBD5E1',
              background: layer.backgroundColor === 'transparent' ? 'transparent' : (layer.backgroundColor || '#FFFFFF'),
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {layer.backgroundColor === 'transparent' && (
              <div style={{ position: 'absolute', top: 6, left: -2, width: 18, height: 1.5, background: '#EF4444', transform: 'rotate(45deg)' }} />
            )}
          </div>
          <span style={{ fontSize: 10, color: '#64748B' }}>▼</span>
        </button>

        {/* Text Color Dropdown */}
        {showTextColorPicker && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 32,
              marginBottom: 8,
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
              padding: '6px',
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 6,
              zIndex: 10005,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {TEXT_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => {
                  updateLayerTextColor(pageNum, layer.id, c.value);
                  setShowTextColorPicker(false);
                }}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 4,
                  backgroundColor: 'transparent',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'transform 0.1s',
                }}
                title={c.name}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    backgroundColor: c.value,
                    border: c.value === '#FFFFFF' ? '1px solid #94A3B8' : 'none',
                  }}
                />
              </button>
            ))}
          </div>
        )}

        {/* BG Color Dropdown */}
        {showBgColorPicker && (
          <div
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 72,
              marginBottom: 8,
              background: '#FFFFFF',
              border: '1px solid #E2E8F0',
              borderRadius: 8,
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
              padding: '6px',
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 6,
              zIndex: 10005,
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {BG_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => {
                  updateLayerBackgroundColor(pageNum, layer.id, c.value);
                  setShowBgColorPicker(false);
                }}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 4,
                  backgroundColor: c.value === 'transparent' ? '#F8FAFC' : c.value,
                  border: c.value === 'transparent' || c.value === '#FFFFFF' ? '1px solid #CBD5E1' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'transform 0.1s',
                }}
                title={c.name}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
              >
                {c.value === 'transparent' ? (
                  <div style={{ width: 14, height: 1.5, background: '#EF4444', transform: 'rotate(45deg)' }} />
                ) : (
                  <div
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      backgroundColor: c.value,
                      border: c.value === '#FFFFFF' ? '1px solid #94A3B8' : 'none',
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Textarea */}
      <textarea
        ref={textareaRef}
        defaultValue={trimmedValue}
        onBlur={commit}
        onInput={adjustHeight}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.currentTarget.blur(); }
          e.stopPropagation();
        }}
        style={{
          width: '100%',
          height: 'auto',
          fontSize: Math.max(10, (layer.fontSize || 14) * ocrTransform.scaleX),
          fontFamily: 'inherit',
          background: layer.backgroundColor === 'transparent' ? 'rgba(255, 255, 255, 0.95)' : (layer.backgroundColor || '#FFFFFF'),
          color: layer.textColor || '#000000',
          fontWeight: layer.bold ? 'bold' : 'normal',
          border: '2px solid #3B82F6',
          borderRadius: 4,
          padding: '2px 4px',
          resize: 'none',
          outline: 'none',
          boxSizing: 'border-box',
          lineHeight: 1.4,
          overflowY: 'hidden',
          textAlign: layout?.alignment === 'center' ? 'center' : 'left',
        }}
      />
    </div>
  );
};
