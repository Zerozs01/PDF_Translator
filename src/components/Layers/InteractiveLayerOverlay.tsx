/**
 * InteractiveLayerOverlay — Phase 3 Interactive Canvas Manipulation
 *
 * Component นี้ทำงานซ้อนทับ PDFCanvas เป็น absolute overlay layer
 * รองรับ: Drag, 8-direction Resize, Rotation, Double-click Inline Editing, Multi-Selection (Shift+Click)
 *
 * Coordinate Space:
 *   - layer.bbox ใช้ OCR Image-Space (unit: px ของภาพดิบ)
 *   - Screen position คำนวณจาก: coord * ocrScale + ocrOffset
 */

import React, { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import type { BBox } from '../../types';
import type { TextLayer, TextLayerGroup } from '../../types/layers';
import type { OverlayLayout } from '../OCR/translationOverlayUtils';
import { resolveOverlayMaskExpansion, clampOverlayRect } from '../OCR/translationOverlayUtils';
import { useLayerStore } from '../../stores/useLayerStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { useUIStore } from '../../stores/useUIStore';

// ─── Types ───────────────────────────────────────────────────────
type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface OcrTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

interface Props {
  pageNum: number;
  layers: TextLayer[];
  groups: TextLayerGroup[];
  ocrTransform: OcrTransform;
  /** ถ้า false = ซ่อน overlay ทั้งหมด (เมื่อ activeTool ไม่ใช่ 'select' และไม่ใช่ 'region') */
  isActive: boolean;
  layouts?: Map<number, OverlayLayout>;
}

// ─── Helpers ─────────────────────────────────────────────────────
/** แปลง OCR bbox → screen coordinates */
const toScreen = (bbox: BBox, t: OcrTransform) => ({
  left:   t.offsetX + bbox.x0 * t.scaleX,
  top:    t.offsetY + bbox.y0 * t.scaleY,
  width:  (bbox.x1 - bbox.x0) * t.scaleX,
  height: (bbox.y1 - bbox.y0) * t.scaleY,
});

/** แปลง screen delta → OCR coordinate delta */
const toPDFDelta = (dx: number, dy: number, t: OcrTransform) => ({
  dx: dx / t.scaleX,
  dy: dy / t.scaleY,
});

/** คำนวณ BBox ใหม่ตาม resize direction + delta */
const applyResize = (start: BBox, delta: { dx: number; dy: number }, dir: ResizeDirection): BBox => {
  const b = { ...start };
  if (dir.includes('n')) b.y0 = Math.min(b.y0 + delta.dy, b.y1 - 10);
  if (dir.includes('s')) b.y1 = Math.max(b.y1 + delta.dy, b.y0 + 10);
  if (dir.includes('w')) b.x0 = Math.min(b.x0 + delta.dx, b.x1 - 20);
  if (dir.includes('e')) b.x1 = Math.max(b.x1 + delta.dx, b.x0 + 20);
  return b;
};

/** Cursor CSS ตาม direction */
const CURSOR_MAP: Record<ResizeDirection, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
};

const HANDLE_POSITIONS: { dir: ResizeDirection; style: CSSProperties }[] = [
  // Corners: White circles (10px x 10px, borderRadius 50%)
  { dir: 'nw', style: { top: -5, left: -5, width: 10, height: 10, borderRadius: '50%' } },
  { dir: 'ne', style: { top: -5, right: -5, width: 10, height: 10, borderRadius: '50%' } },
  { dir: 'se', style: { bottom: -5, right: -5, width: 10, height: 10, borderRadius: '50%' } },
  { dir: 'sw', style: { bottom: -5, left: -5, width: 10, height: 10, borderRadius: '50%' } },
  
  // Left/Right: Thin vertical pills (6px x 16px, borderRadius 3px)
  { dir: 'e',  style: { top: '50%', right: -3, transform: 'translateY(-50%)', width: 6, height: 16, borderRadius: 3 } },
  { dir: 'w',  style: { top: '50%', left: -3, transform: 'translateY(-50%)', width: 6, height: 16, borderRadius: 3 } },

  // Top/Bottom: Thin horizontal pills (16px x 6px, borderRadius 3px)
  { dir: 'n',  style: { top: -3, left: '50%', transform: 'translateX(-50%)', width: 16, height: 6, borderRadius: 3 } },
  { dir: 's',  style: { bottom: -3, left: '50%', transform: 'translateX(-50%)', width: 16, height: 6, borderRadius: 3 } },
];

// ─── Sub-component: InlineEditor ─────────────────────────────────
interface InlineEditorProps {
  layer: TextLayer;
  ocrTransform: OcrTransform;
  onCommit: (layerId: string, newText: string) => void;
  defaultValue: string;
  pageNum: number;
  layout?: OverlayLayout;
}

const TEXT_COLORS = [
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

const BG_COLORS = [
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

const InlineEditor: React.FC<InlineEditorProps> = ({ layer, ocrTransform, onCommit, defaultValue, pageNum, layout }) => {
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

// ─── Sub-component: SelectionBox ─────────────────────────────────
interface SelectionBoxProps {
  layer: TextLayer;
  ocrTransform: OcrTransform;
  isSelected: boolean;
  isEditing: boolean;
  isMultiSelected: boolean;
  activeResizeDir: ResizeDirection | null;
  isRotating: boolean;
  startRotation: number;
  activeTool: string;
  onMouseDownBody: (e: React.MouseEvent, layerId: string) => void;
  onMouseDownHandle: (e: React.MouseEvent, layerId: string, dir: ResizeDirection) => void;
  onMouseDownRotate: (e: React.MouseEvent, layerId: string) => void;
  onDoubleClick: (layerId: string) => void;
  onHover: (layerId: string | null) => void;
  layout?: OverlayLayout;
  /** true = layer ถูก suppress โดย overlay dedup (hidden) — แสดง style จางลงแต่ยังเลือกได้ */
  isLayoutHidden?: boolean;
}

const areEqualSelectionBox = (prev: SelectionBoxProps, next: SelectionBoxProps) => {
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isEditing !== next.isEditing) return false;
  if (prev.isMultiSelected !== next.isMultiSelected) return false;
  if (prev.activeResizeDir !== next.activeResizeDir) return false;
  if (prev.isRotating !== next.isRotating) return false;
  if (prev.startRotation !== next.startRotation) return false;
  if (prev.activeTool !== next.activeTool) return false;
  if (prev.isLayoutHidden !== next.isLayoutHidden) return false;

  // ocrTransform check (deep fields check)
  if (
    prev.ocrTransform.scaleX !== next.ocrTransform.scaleX ||
    prev.ocrTransform.scaleY !== next.ocrTransform.scaleY ||
    prev.ocrTransform.offsetX !== next.ocrTransform.offsetX ||
    prev.ocrTransform.offsetY !== next.ocrTransform.offsetY
  ) {
    return false;
  }

  // layer check (deep fields check)
  const pl = prev.layer;
  const nl = next.layer;
  if (
    pl.id !== nl.id ||
    pl.rotation !== nl.rotation ||
    pl.locked !== nl.locked ||
    pl.visible !== nl.visible ||
    pl.userEdited !== nl.userEdited ||
    pl.text !== nl.text ||
    pl.sourceText !== nl.sourceText
  ) {
    return false;
  }

  // BBox check
  if (
    pl.bbox.x0 !== nl.bbox.x0 ||
    pl.bbox.y0 !== nl.bbox.y0 ||
    pl.bbox.x1 !== nl.bbox.x1 ||
    pl.bbox.y1 !== nl.bbox.y1
  ) {
    return false;
  }

  // layout check
  if (prev.layout !== next.layout) {
    const playout = prev.layout;
    const nlayout = next.layout;
    if (!playout || !nlayout) return false;
    if (
      playout.hidden !== nlayout.hidden ||
      playout.renderText !== nlayout.renderText ||
      playout.alignment !== nlayout.alignment ||
      playout.styleKind !== nlayout.styleKind
    ) {
      return false;
    }
    
    // mergedBBox check
    const pm = playout.mergedBBox;
    const nm = nlayout.mergedBBox;
    if (Boolean(pm) !== Boolean(nm)) return false;
    if (pm && nm) {
      if (pm.x0 !== nm.x0 || pm.y0 !== nm.y0 || pm.x1 !== nm.x1 || pm.y1 !== nm.y1) {
        return false;
      }
    }
  }

  return true;
};

const SelectionBox: React.FC<SelectionBoxProps> = React.memo(({
  layer, ocrTransform, isSelected, isEditing, isMultiSelected,
  activeResizeDir, isRotating, startRotation, activeTool,
  onMouseDownBody, onMouseDownHandle, onMouseDownRotate,
  onDoubleClick, onHover, layout, isLayoutHidden,
}) => {
  const showDebugOverlay = useOCRTextLayerStore((state) => state.showDebugOverlay);
  const effectiveBBox = (layout && !layer.userEdited)
    ? (layout.mergedBBox || layer.bbox)
    : layer.bbox;
  const { left, top, width, height } = toScreen(effectiveBBox, ocrTransform);
  const isHighlighted = isSelected || isMultiSelected;
  const rotation = layer.rotation || 0;
  
  // State สำหรับจัดการ Hover Effect ของปุ่มหมุน
  const [isRotateHovered, setIsRotateHovered] = useState(false);

  // State สำหรับจัดการ Hover Effect ของตัวกล่องข้อความ
  const [isBoxHovered, setIsBoxHovered] = useState(false);

  // ตรวจวัดขนาดกล่องข้อความเพื่อหาว่ากล่องเป็นขนาด Small หรือไม่
  const isSmall = width < 120 || height < 40;

  // กำหนดว่า handle ใดควรแสดงผลเพื่อความคลีนแบบ Canva
  const visibleDirs = React.useMemo<ResizeDirection[]>(() => {
    // 1. ถ้ามี handle กำลัง active อยู่ -> แสดงเฉพาะอันนั้นอันเดียวเพื่อความคลีนและโฟกัส!
    if (activeResizeDir) {
      return [activeResizeDir];
    }
    // ถ้ากำลังหมุนอยู่ -> ซ่อน handles ทั้งหมด
    if (isRotating) {
      return [];
    }

    // 2. สถานะปกติ -> แยกแยะตามขนาดกล่อง
    if (isSmall) {
      // กล่องขนาดเล็ก: 1 วงกลม (nw) + 1 แท่ง (e)
      return ['nw', 'e'];
    } else {
      // กล่องขนาดปานกลาง/ใหญ่: 4 วงกลม (nw, ne, se, sw) + 2 แท่ง (w, e)
      return ['nw', 'ne', 'se', 'sw', 'w', 'e'];
    }
  }, [activeResizeDir, isRotating, isSmall]);

  return (
    <div
      id={`layer-bbox-${layer.id}`}
      role="button"
      aria-label={`Layer: ${layer.text}`}
      style={{
        position: 'absolute',
        left, top, width, height,
        transform: rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: 'center center',
        border: isRotating
          ? '2px solid #8B5CF6' // กำลังหมุน -> เส้นทึบสีม่วง Canva พรีเมียม!
          : isHighlighted
            ? `2px dashed ${isLayoutHidden ? 'rgba(99,102,241,0.55)' : '#3B82F6'}` // ได้รับการเลือก (suppress = สีม่วง, ปกติ = น้ำเงิน)
            : isBoxHovered
              ? `1.5px dashed ${isLayoutHidden ? 'rgba(99,102,241,0.4)' : '#F97316'}` // hover (suppress = ม่วงจาง, ปกติ = ส้ม)
              : isLayoutHidden
                ? '0.5px dashed rgba(99,102,241,0.18)' // suppress โดย overlay dedup → เส้นประม่วงจางมาก บอกว่า "มีอยู่แต่ถูกซ่อน"
                : showDebugOverlay
                  ? '0.65px dashed rgba(249, 115, 22, 0.25)' // ปกติ (ยังไม่เลือก) -> เส้นประสีส้มจางบางเบา สบายตา ไม่แย่งซีน
                  : 'none',
        borderRadius: 3,
        cursor: 'move',
        pointerEvents: (activeTool === 'region' || activeTool === 'text') ? 'none' : 'all', // ซ่อน interaction ตอนวาด region หรือ text เพื่อให้ลากคลุมได้โดยไม่ชนกล่องเดิม
        boxSizing: 'border-box',
        background: isRotating 
          ? 'rgba(139, 92, 246, 0.05)' // ไฮไลท์สีม่วงจางๆ ตอนหมุน
          : isHighlighted 
            ? 'rgba(59,130,246,0.06)' 
            : 'transparent',
        transition: 'border-color 0.12s, background 0.12s, box-shadow 0.12s',
        // Glow Effect ตอนหมุนเพื่อความเด่นบนมังงะขาวดำ
        boxShadow: isRotating
          ? '0 0 12px rgba(139, 92, 246, 0.35)' 
          : isMultiSelected && !isSelected
            ? 'inset 0 0 0 1px rgba(99,102,241,0.4)'
            : undefined,
      }}
      onMouseEnter={() => {
        setIsBoxHovered(true);
        onHover(layer.id);
      }}
      onMouseLeave={() => {
        setIsBoxHovered(false);
        onHover(null);
      }}
      onMouseDown={(e) => onMouseDownBody(e, layer.id)}
      onDoubleClick={() => !isEditing && onDoubleClick(layer.id)}
    >
      {/* Resize Handles — แสดงเฉพาะกล่องที่ selected เดี่ยวๆ */}
      {isSelected && !isEditing && (
        <>
          {HANDLE_POSITIONS.filter(h => visibleDirs.includes(h.dir)).map(({ dir, style }) => (
            <div
              key={dir}
              onMouseDown={(e) => { e.stopPropagation(); onMouseDownHandle(e, layer.id, dir); }}
              style={{
                position: 'absolute',
                background: '#FFFFFF',
                boxShadow: '0 1px 3px rgba(0,0,0,0.22), 0 0 0 1px rgba(59,130,246,0.85)',
                boxSizing: 'border-box',
                cursor: CURSOR_MAP[dir],
                ...style,
              }}
            />
          ))}
          {/* Rotation Handle - ซ่อนเมื่อกำลังลากปรับขนาดหรือกำลังหมุนเลเยอร์อื่น */}
          {!activeResizeDir && (
            <div style={{
              position: 'absolute',
              bottom: -32, // ย้ายมาอยู่ด้านล่างเพื่อให้เหมือนดีไซน์สากลแบบ Canva
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              zIndex: 10000,
            }}>
              {/* Connector line */}
              <div style={{ width: 1.5, height: 10, background: isRotating ? '#8B5CF6' : '#3B82F6', opacity: isRotating ? 0.9 : 0.6 }} />
              <div
                onMouseDown={(e) => { e.stopPropagation(); onMouseDownRotate(e, layer.id); }}
                onMouseEnter={() => setIsRotateHovered(true)}
                onMouseLeave={() => setIsRotateHovered(false)}
                style={{
                  width: 28, // ขนาด 28px จับถนัดและมองเห็นชัดเจนยิ่งขึ้นบนมังงะ
                  height: 28,
                  borderRadius: '50%',
                  background: isRotateHovered || isRotating ? '#8B5CF6' : '#FFFFFF', // Canva Violet
                  border: isRotateHovered || isRotating ? '2px solid #FFFFFF' : '1.5px solid #9CA3AF',
                  cursor: isRotating ? 'grabbing' : 'grab',
                  boxShadow: isRotateHovered || isRotating 
                    ? '0 0 12px rgba(139, 92, 246, 0.7), 0 4px 10px rgba(0,0,0,0.3)' 
                    : '0 2px 4px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: `scale(${isRotateHovered || isRotating ? 1.15 : 1}) rotate(${rotation}deg)`, // หมุนไอคอนและขยายขนาดตอน hover/หมุนจริง
                  color: isRotateHovered || isRotating ? '#FFFFFF' : '#4B5563', // สีไอคอนขาวเมื่อ active
                  zIndex: 20,
                }}
                title="ลากเพื่อหมุนข้อความ"
              >
                {/* SVG ลูกศรโค้งวนสองหัวแบบ Canva */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.5 2v6h-6" />
                  <path d="M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
              </div>
            </div>
          )}

          {/* ป้ายบอกองศา (Degree Badge Tooltip) - แสดงตอนกำลังหมุนจริง สีม่วงสว่างตัดชัดเจนกับมังงะขาวดำ */}
          {isRotating && (() => {
            // ฟังก์ชันสำหรับ Normalize องศาให้อยู่ในช่วง -180 ถึง 180 เพื่อการแสดงผลที่สวยงาม
            const normalizeAngle = (angle: number) => {
              let norm = Math.round(angle) % 360;
              if (norm < 0) norm += 360;
              if (norm > 180) norm -= 360;
              return norm;
            };

            const currentNorm = normalizeAngle(rotation);
            const startNorm = normalizeAngle(startRotation);
            const deltaFromStart = normalizeAngle(rotation - startRotation);
            
            const deltaText = deltaFromStart > 0 
              ? `+${deltaFromStart}°` 
              : deltaFromStart < 0 
                ? `${deltaFromStart}°` 
                : `0°`;

            return (
              <div style={{
                position: 'absolute',
                bottom: -72, // ขยับลงมาให้ไม่ซ้อนกับปุ่มหมุนที่ขยายใหญ่ขึ้น
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#8B5CF6', 
                color: '#FFFFFF',
                padding: '5px 10px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 'bold',
                whiteSpace: 'nowrap',
                // ขอบขาวหนา 2px และเงาสีม่วงเรืองแสงรอบป้าย เพื่อให้ไม่กลืนไปกับลายเส้นมังงะขาวดำแน่นอน
                border: '2px solid #FFFFFF',
                boxShadow: '0 0 12px rgba(139, 92, 246, 0.75), 0 4px 12px rgba(0, 0, 0, 0.4)',
                zIndex: 11000,
                pointerEvents: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                {/* ลูกศรชี้ขึ้นไปหาปุ่มหมุน (Tooltip Arrow) */}
                <div style={{
                  position: 'absolute',
                  top: -6,
                  left: '50%',
                  transform: 'translateX(-50%) rotate(45deg)',
                  width: 8,
                  height: 8,
                  background: '#8B5CF6',
                  borderLeft: '2px solid #FFFFFF',
                  borderTop: '2px solid #FFFFFF',
                  zIndex: -1,
                }} />
                <span>{currentNorm}°</span>
                {deltaFromStart !== 0 && (
                  <span style={{ opacity: 0.85, fontSize: 10, fontWeight: 'normal' }}>
                    ({deltaText})
                  </span>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}, areEqualSelectionBox);

// ─── Main Component: InteractiveLayerOverlay ──────────────────────
export const InteractiveLayerOverlay: React.FC<Props> = ({
  pageNum, layers, groups, ocrTransform, isActive, layouts,
}) => {
  const {
    selectedLayerIds,
    selectLayer, clearSelection,
    updateLayerBBox, updateLayerText, updateLayerRotation,
    updateMultiLayerBBoxDelta, synchronizeGroupBBox,
    setHoveredLayer,
    pushUndoSnapshot,
    editingLayerId,
    setEditingLayerId,
    addManualLayer,
    deleteLayer,
  } = useLayerStore();

  const translationPreviewMode = useOCRTextLayerStore((state) => state.translationPreviewMode);
  const activeTool = useUIStore((state) => state.activeTool);
  const zoom = useUIStore((state) => state.zoom || 1);

  // Ref and state for Viewport Virtualization (Correct coordinate space + zoom scale)
  const overlayRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !isActive) return;
    const parent = el.parentElement;
    if (!parent) return;

    const handleUpdate = () => {
      const elRect = el.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();

      // Viewport boundaries in local CSS coordinate space (divided by zoom scale)
      const MARGIN = 400; // 400px margin to load layers ahead during scroll/drag
      const x0 = (parentRect.left - elRect.left) / zoom - MARGIN;
      const y0 = (parentRect.top - elRect.top) / zoom - MARGIN;
      const x1 = (parentRect.left - elRect.left + parentRect.width) / zoom + MARGIN;
      const y1 = (parentRect.top - elRect.top + parentRect.height) / zoom + MARGIN;

      setViewport({ x0, y0, x1, y1 });
    };

    // Initial update is synchronous to prevent layout flicker
    handleUpdate();

    // Throttled update helper (minimum 100ms between calls during continuous scrolling/resize)
    let lastRun = 0;
    let throttleTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleUpdateThrottled = () => {
      const now = Date.now();
      if (now - lastRun >= 100) {
        handleUpdate();
        lastRun = now;
      } else {
        if (throttleTimeout) clearTimeout(throttleTimeout);
        throttleTimeout = setTimeout(() => {
          handleUpdate();
          lastRun = Date.now();
        }, 100 - (now - lastRun));
      }
    };

    // Listen to scroll/resize events
    parent.addEventListener('scroll', handleUpdateThrottled, { passive: true });
    window.addEventListener('resize', handleUpdateThrottled, { passive: true });

    // Use ResizeObserver to detect layout changes on zoom or pan
    const resizeObserver = new ResizeObserver(() => {
      handleUpdateThrottled();
    });
    resizeObserver.observe(el);
    resizeObserver.observe(parent);

    return () => {
      parent.removeEventListener('scroll', handleUpdateThrottled);
      window.removeEventListener('resize', handleUpdateThrottled);
      if (throttleTimeout) clearTimeout(throttleTimeout);
      resizeObserver.disconnect();
    };
  }, [ocrTransform, isActive, zoom]);

  // States for hiding other elements during resizing/rotation
  const [activeResizeDir, setActiveResizeDir] = useState<ResizeDirection | null>(null);
  const [isRotating, setIsRotating] = useState<boolean>(false);
  const [startRotation, setStartRotation] = useState<number>(0);

  // States for drawing region
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStartPos, setDrawStartPos] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrentPos, setDrawCurrentPos] = useState<{ x: number; y: number } | null>(null);

  // Drag / Resize / Rotate / Draw state
  const dragState = useRef<{
    type: 'drag' | 'resize' | 'rotate' | 'draw';
    layerId?: string;
    startMouseX: number;
    startMouseY: number;
    startBBox?: BBox;
    resizeDir?: ResizeDirection;
    startRotation?: number;
    startCenterX?: number;
    startCenterY?: number;
    startAngle?: number;
  } | null>(null);

  // ── Keyboard: Ctrl+Z Undo & Delete ──────────────────────────────
  const { undoLastAction } = useLayerStore();
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !editingLayerId) {
        e.preventDefault();
        undoLastAction(pageNum);
      }
      if (e.key === 'Escape') {
        clearSelection();
        setEditingLayerId(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingLayerId && selectedLayerIds.size > 0) {
        const activeEl = document.activeElement;
        const isTyping = activeEl && (
          activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable
        );
        if (isTyping) return;

        e.preventDefault();
        // ลบ snapshot ก่อนลบจริงเพื่อให้ undo ทำงานได้ถูกต้อง
        pushUndoSnapshot(pageNum);
        selectedLayerIds.forEach((id) => {
          deleteLayer(pageNum, id);
        });
        clearSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pageNum, editingLayerId, selectedLayerIds, undoLastAction, clearSelection, deleteLayer, pushUndoSnapshot]);

  // ── Manual Region Creation Handler ──────────────────────────────────
  const handleCreateManualRegion = useCallback((pdfBBox: BBox, bgColor: string) => {
    const defaultText = 'แปลข้อความใหม่ที่นี่...';
    
    // 1. เพิ่มข้อมูล OCR Line ใหม่เข้า OCR store
    const ocrLine = {
      text: defaultText,
      bbox: pdfBBox,
      confidence: 100,
      words: []
    };
    
    const ocrStore = useOCRTextLayerStore.getState();
    const lineIndex = ocrStore.currentPageOCR ? ocrStore.currentPageOCR.lines.length : 0;
    
    // บันทึกเข้า OCR Store และดึงดัชนีจริงที่ถูกต้อง
    const actualLineIndex = ocrStore.addOCRLine(pageNum, ocrLine);
    
    // 2. เพิ่มเลเยอร์ใหม่เข้า Layer store (จะผูกกับกลุ่ม Ungrouped โดยอัตโนมัติ)
    addManualLayer(pageNum, pdfBBox, defaultText, actualLineIndex, { backgroundColor: bgColor });
  }, [pageNum, addManualLayer]);

  // ── Mouse Events: Global Listeners ──────────────────────────
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds) return;

      const zoom = useUIStore.getState().zoom || 1;
      const screenDx = (e.clientX - ds.startMouseX) / zoom;
      const screenDy = (e.clientY - ds.startMouseY) / zoom;
      const { dx, dy } = toPDFDelta(screenDx, screenDy, ocrTransform);

      if (ds.type === 'drag' && ds.layerId) {
        // Multi-drag or single-drag optimistic DOM update to achieve 60FPS!
        const draggedLayer = layers.find(l => l.id === ds.layerId);
        const group = draggedLayer?.groupId ? groups.find(g => g.id === draggedLayer.groupId) : null;
        const idsToMove = (selectedLayerIds.size > 1 && selectedLayerIds.has(ds.layerId))
          ? Array.from(selectedLayerIds)
          : (group ? group.layerIds : [ds.layerId]);

        idsToMove.forEach(id => {
          const l = layers.find(x => x.id === id);
          const rotation = l?.rotation || 0;

          // 1. Move BBox (selection outline)
          const el = document.getElementById(`layer-bbox-${id}`);
          if (el) {
            el.style.transform = `translate(${screenDx}px, ${screenDy}px) rotate(${rotation}deg)`;
          }

          // 2. Move Mask (white background blocking original text)
          const maskEl = document.getElementById(`layer-mask-${id}`);
          if (maskEl) {
            maskEl.style.transform = `translate(${screenDx}px, ${screenDy}px) rotate(${rotation}deg)`;
          }

          // 3. Move Text (rendered translation)
          const textEl = document.getElementById(`layer-text-${id}`);
          if (textEl) {
            textEl.style.transform = `translate(${screenDx}px, ${screenDy}px) rotate(${rotation}deg)`;
          }
        });
      } else if (ds.type === 'resize' && ds.resizeDir && ds.layerId) {
        const newBBox = applyResize(ds.startBBox!, { dx, dy }, ds.resizeDir);
        updateLayerBBox(pageNum, ds.layerId, newBBox);
      } else if (ds.type === 'rotate' && ds.startCenterX !== undefined && ds.layerId) {
        const cx = ds.startCenterX;
        const cy = ds.startCenterY!;
        const currentAngle = Math.atan2(e.clientY - cy, e.clientX - cx);
        const deltaAngle = currentAngle - ds.startAngle!;
        const newRotation = (ds.startRotation || 0) + deltaAngle * (180 / Math.PI);
        updateLayerRotation(pageNum, ds.layerId, Math.round(newRotation));
      } else if (ds.type === 'draw') {
        if (drawStartPos) {
          const zoom = useUIStore.getState().zoom || 1;
          const rawDx = (e.clientX - ds.startMouseX) / zoom;
          const rawDy = (e.clientY - ds.startMouseY) / zoom;
          const currentX = drawStartPos.x + rawDx;
          const currentY = drawStartPos.y + rawDy;
          setDrawCurrentPos({ x: currentX, y: currentY });
        }
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      setActiveResizeDir(null);
      setIsRotating(false);
      
      const ds = dragState.current;
      if (!ds) return;
      
      if (ds.type === 'draw') {
        setIsDrawing(false);
        if (drawStartPos && drawCurrentPos) {
          const x0 = Math.min(drawStartPos.x, drawCurrentPos.x);
          const y0 = Math.min(drawStartPos.y, drawCurrentPos.y);
          const x1 = Math.max(drawStartPos.x, drawCurrentPos.x);
          const y1 = Math.max(drawStartPos.y, drawCurrentPos.y);
          
          const w = x1 - x0;
          const h = y1 - y0;
          
          // กำหนดขนาดขั้นต่ำที่จะยอมรับเป็น Region (เช่น 15x15 px) เพื่อป้องกันการจิ้มผิดพลาด
          if (w > 15 && h > 15) {
            // คำนวณพิกเซลกลับไปเป็น PDF OCR coordinate space
            const pdfX0 = (x0 - ocrTransform.offsetX) / ocrTransform.scaleX;
            const pdfY0 = (y0 - ocrTransform.offsetY) / ocrTransform.scaleY;
            const pdfX1 = (x1 - ocrTransform.offsetX) / ocrTransform.scaleX;
            const pdfY1 = (y1 - ocrTransform.offsetY) / ocrTransform.scaleY;
            
            const pdfBBox: BBox = {
              x0: Math.round(pdfX0),
              y0: Math.round(pdfY0),
              x1: Math.round(pdfX1),
              y1: Math.round(pdfY1),
            };
            
            const bgColor = activeTool === 'text' ? 'transparent' : '#FFFFFF';
            handleCreateManualRegion(pdfBBox, bgColor);
          }
        }
        setDrawStartPos(null);
        setDrawCurrentPos(null);
      } else if (ds.type === 'drag' && ds.layerId) {
        // Commit final drag to Zustand store once upon release!
        const zoom = useUIStore.getState().zoom || 1;
        const screenDx = (e.clientX - ds.startMouseX) / zoom;
        const screenDy = (e.clientY - ds.startMouseY) / zoom;
        const { dx, dy } = toPDFDelta(screenDx, screenDy, ocrTransform);

        const draggedLayer = layers.find(l => l.id === ds.layerId);
        const group = draggedLayer?.groupId ? groups.find(g => g.id === draggedLayer.groupId) : null;
        const idsToMove = (selectedLayerIds.size > 1 && selectedLayerIds.has(ds.layerId))
          ? Array.from(selectedLayerIds)
          : (group ? group.layerIds : [ds.layerId]);

        // Clean up temporary DOM transform styles for all elements
        idsToMove.forEach(id => {
          const l = layers.find(x => x.id === id);
          const rotation = l?.rotation || 0;

          const el = document.getElementById(`layer-bbox-${id}`);
          if (el) {
            el.style.transform = rotation ? `rotate(${rotation}deg)` : '';
          }

          const maskEl = document.getElementById(`layer-mask-${id}`);
          if (maskEl) {
            maskEl.style.transform = rotation ? `rotate(${rotation}deg)` : '';
          }

          const textEl = document.getElementById(`layer-text-${id}`);
          if (textEl) {
            textEl.style.transform = rotation ? `rotate(${rotation}deg)` : '';
          }
        });

        // Save position updates only if actual screen movement exceeded 3 pixels to prevent accidental "userEdited" flags
        const screenMovement = Math.sqrt(
          Math.pow(e.clientX - ds.startMouseX, 2) + 
          Math.pow(e.clientY - ds.startMouseY, 2)
        );
        const hasMoved = screenMovement >= 3;
        if (hasMoved) {
          if (idsToMove.length > 1) {
            updateMultiLayerBBoxDelta(pageNum, new Set(idsToMove), { dx, dy });
          } else {
            const start = ds.startBBox!;
            const newBBox: BBox = {
              x0: start.x0 + dx,
              y0: start.y0 + dy,
              x1: start.x1 + dx,
              y1: start.y1 + dy,
            };
            updateLayerBBox(pageNum, ds.layerId, newBBox);
          }

          // Sync group BBox
          const layer = layers.find(l => l.id === ds.layerId);
          if (layer?.groupId) synchronizeGroupBBox(pageNum, layer.groupId);
        }
      } else if (ds.layerId) {
        // Sync group BBox หลัง resize หรือ rotate เสร็จ
        const layer = layers.find(l => l.id === ds.layerId);
        if (layer?.groupId) synchronizeGroupBBox(pageNum, layer.groupId);
      }
      
      dragState.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    pageNum, layers, groups, selectedLayerIds, ocrTransform, drawStartPos, drawCurrentPos,
    updateLayerBBox, updateLayerRotation, updateMultiLayerBBoxDelta, synchronizeGroupBBox, handleCreateManualRegion, activeTool
  ]);

  // ── Handlers ─────────────────────────────────────────────────
  const handleMouseDownBody = useCallback((e: React.MouseEvent, layerId: string) => {
    if (e.button !== 0) return; // Only trigger for left-click to allow middle-click panning
    e.stopPropagation();
    if (activeTool === 'region' || activeTool === 'text') return;

    if (editingLayerId) {
      if (editingLayerId === layerId) return;
      // Commit previous text on blur when selecting another box (Canva-style)
      const activeEl = document.activeElement as HTMLElement;
      if (activeEl && activeEl.tagName === 'TEXTAREA') {
        activeEl.blur();
      }
      setEditingLayerId(null);
    }

    const isShift = e.shiftKey;
    selectLayer(layerId, isShift);

    const layer = layers.find(l => l.id === layerId);
    if (!layer || layer.locked) return;

    pushUndoSnapshot(pageNum);
    dragState.current = {
      type: 'drag',
      layerId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startBBox: { ...layer.bbox },
    };
  }, [editingLayerId, layers, pageNum, pushUndoSnapshot, selectLayer, activeTool, setEditingLayerId]);

  const handleMouseDownHandle = useCallback((e: React.MouseEvent, layerId: string, dir: ResizeDirection) => {
    if (e.button !== 0) return; // Only trigger for left-click
    e.stopPropagation();
    const layer = layers.find(l => l.id === layerId);
    if (!layer || layer.locked || activeTool === 'region' || activeTool === 'text') return;

    setActiveResizeDir(dir);
    pushUndoSnapshot(pageNum);
    dragState.current = {
      type: 'resize',
      layerId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startBBox: { ...layer.bbox },
      resizeDir: dir,
    };
  }, [layers, pageNum, pushUndoSnapshot, activeTool]);

  const handleMouseDownRotate = useCallback((e: React.MouseEvent, layerId: string) => {
    if (e.button !== 0) return; // Only trigger for left-click
    e.stopPropagation();
    const layer = layers.find(l => l.id === layerId);
    if (!layer || layer.locked || activeTool === 'region' || activeTool === 'text') return;

    setIsRotating(true);
    const startRot = layer.rotation || 0;
    setStartRotation(startRot);
    const screen = toScreen(layer.bbox, ocrTransform);
    const cx = screen.left + screen.width / 2;
    const cy = screen.top + screen.height / 2;

    pushUndoSnapshot(pageNum);
    dragState.current = {
      type: 'rotate',
      layerId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startBBox: { ...layer.bbox },
      startRotation: startRot,
      startCenterX: cx,
      startCenterY: cy,
      startAngle: Math.atan2(e.clientY - cy, e.clientX - cx),
    };
  }, [layers, pageNum, ocrTransform, pushUndoSnapshot, activeTool]);

  const handleDoubleClick = useCallback((layerId: string) => {
    if (activeTool === 'region' || activeTool === 'text') return;
    setEditingLayerId(layerId);
  }, [activeTool]);

  const handleCommitText = useCallback((layerId: string, newText: string) => {
    pushUndoSnapshot(pageNum);

    const isSource = translationPreviewMode === 'original';
    // 1. Update in useLayerStore (sidebar/layer list)
    updateLayerText(pageNum, layerId, newText, isSource);

    // 2. Synchronize back to OCR raw lines or active translation cache depending on mode
    const layer = layers.find(l => l.id === layerId);
    if (layer) {
      const ocrState = useOCRTextLayerStore.getState();
      if (isSource) {
        ocrState.updateOCRLineText(pageNum, layer.lineIndex, newText);
      } else {
        ocrState.updateTranslationCacheText(pageNum, layer.lineIndex, newText);
      }
    }

    setEditingLayerId(null);
  }, [pageNum, layers, translationPreviewMode, pushUndoSnapshot, updateLayerText]);

  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only trigger for left-click
    if (activeTool === 'region' || activeTool === 'text') {
      e.stopPropagation();
      e.preventDefault();
      
      const zoom = useUIStore.getState().zoom || 1;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom;
      const y = (e.clientY - rect.top) / zoom;
      
      setIsDrawing(true);
      setDrawStartPos({ x, y });
      setDrawCurrentPos({ x, y });
      
      dragState.current = {
        type: 'draw',
        startMouseX: e.clientX,
        startMouseY: e.clientY,
      };
    } else {
      // คลิกพื้นที่ว่าง → clear selection และออกจากโหมด edit (Canva-style Commit on Blur)
      if ((e.target as HTMLElement) === e.currentTarget) {
        if (editingLayerId) {
          const activeEl = document.activeElement as HTMLElement;
          if (activeEl && activeEl.tagName === 'TEXTAREA') {
            activeEl.blur();
          }
        }
        clearSelection();
        setEditingLayerId(null);
      }
    }
  }, [activeTool, clearSelection, editingLayerId, setEditingLayerId]);

  // ── Render ────────────────────────────────────────────────────
  if (!isActive) return null;

  return (
    <div
      ref={overlayRef}
      id="interactive-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'all',
        zIndex: 10000,
        cursor: (activeTool === 'region' || activeTool === 'text') ? 'crosshair' : 'default',
        willChange: 'transform',
        contain: 'layout style paint'
      }}
      onMouseDown={handleOverlayMouseDown}
    >
      {/* Layer Selection Boxes */}
      {layers.map((layer) => {
        if (!layer.visible) return null;

        // คัดกรองและซ่อนเลเยอร์ที่ถูกสั่ง hidden จาก layout map (เนื่องจากถูกผสานกลุ่ม)
        const layout = layouts?.get(layer.lineIndex);
        const isOcrLayer = layer.lineIndex >= 0 && !layer.id.startsWith('manual-');
        // Layer ที่ไม่มีใน layout map และไม่ได้แก้ไขโดย user → ไม่ render (ยังไม่มีข้อมูลพอ) (เว้นแต่จะอยู่ในโหมด original OCR เพื่อให้ select/ขยับกล่องได้)
        if (isOcrLayer && !layout && !layer.userEdited && translationPreviewMode !== 'original') {
          return null;
        }
        // layout.hidden = true → layer ถูก suppress โดย overlay dedup
        // ยังคง render SelectionBox เพื่อให้ user สามารถ select/interact ได้
        // แต่จะแสดง style จางลงเพื่อบ่งบอกสถานะ suppress
        const isLayoutHidden = layout?.hidden === true;
        if (isLayoutHidden && !selectedLayerIds.has(layer.id)) {
          return null;
        }

        // Viewport Virtualization check (Math-based, zero DOM metrics API overhead)
        const effectiveBBox = (layout && !layer.userEdited)
          ? (layout.mergedBBox || layer.bbox)
          : layer.bbox;
        const screenBox = toScreen(effectiveBBox, ocrTransform);
        
        let isVisible = true;
        if (viewport) {
          isVisible = (
            screenBox.left + screenBox.width >= viewport.x0 &&
            screenBox.left <= viewport.x1 &&
            screenBox.top + screenBox.height >= viewport.y0 &&
            screenBox.top <= viewport.y1
          );
        }

        const isBoxSelected = selectedLayerIds.has(layer.id);
        const isEditing = editingLayerId === layer.id;
        
        // ข้ามการสร้าง DOM Node เมื่อกล่องอยู่นอกพื้นที่หน้าต่าง และไม่ได้ถูกเลือกหรือแก้ไขอยู่
        if (!isVisible && !isBoxSelected && !isEditing) {
          return null;
        }

        const isSelected = isBoxSelected && selectedLayerIds.size === 1;
        const isMultiSelected = isBoxSelected && selectedLayerIds.size > 1;

        return (
          <React.Fragment key={layer.id}>
            {isEditing ? (
              <InlineEditor
                layer={layer}
                ocrTransform={ocrTransform}
                onCommit={handleCommitText}
                defaultValue={
                  translationPreviewMode === 'original'
                    ? layer.sourceText || layer.text
                    : (layer.userEdited || layer.text !== layer.sourceText
                        ? layer.text
                        : (layout?.renderText || layer.text))
                }
                pageNum={pageNum}
                layout={layout}
              />
            ) : (
              <SelectionBox
                layer={layer}
                ocrTransform={ocrTransform}
                isSelected={isSelected}
                isEditing={isEditing}
                isMultiSelected={isMultiSelected}
                activeResizeDir={activeResizeDir}
                isRotating={isRotating && dragState.current?.layerId === layer.id}
                startRotation={startRotation}
                activeTool={activeTool}
                onMouseDownBody={handleMouseDownBody}
                onMouseDownHandle={handleMouseDownHandle}
                onMouseDownRotate={handleMouseDownRotate}
                onDoubleClick={handleDoubleClick}
                onHover={setHoveredLayer}
                layout={layout}
                isLayoutHidden={isLayoutHidden}
              />
            )}
          </React.Fragment>
        );
      })}

      {/* Group highlight border เมื่อมีการ hover/select ทุก layer ในกลุ่ม (ซ่อนระหว่างหมุน) */}
      {!isRotating && groups.map((group) => {
        const hasSelectedMember = group.layerIds.some(id => selectedLayerIds.has(id));
        if (!hasSelectedMember || !group.visible) return null;
        const { left, top, width, height } = toScreen(group.mergedBBox, ocrTransform);
        return (
          <div
            key={`group-${group.id}`}
            style={{
              position: 'absolute',
              left: left - 4, top: top - 4,
              width: width + 8, height: height + 8,
              border: `1.5px solid ${group.color || 'rgba(99,102,241,0.45)'}`,
              borderRadius: 6,
              pointerEvents: 'none',
              boxSizing: 'border-box',
            }}
          />
        );
      })}

      {/* Region Drawing Preview */}
      {isDrawing && drawStartPos && drawCurrentPos && (() => {
        const x = Math.min(drawStartPos.x, drawCurrentPos.x);
        const y = Math.min(drawStartPos.y, drawCurrentPos.y);
        const w = Math.abs(drawStartPos.x - drawCurrentPos.x);
        const h = Math.abs(drawStartPos.y - drawCurrentPos.y);
        
        return (
          <div
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: w,
              height: h,
              border: '2px dashed #3B82F6', // เส้นประสีน้ำเงิน Canva พรีเมียม
              backgroundColor: activeTool === 'text' ? 'rgba(59, 130, 246, 0.05)' : 'rgba(255, 255, 255, 0.75)', // พรีวิวตามเครื่องมือที่วาด
              borderRadius: 4,
              pointerEvents: 'none',
              boxShadow: '0 0 8px rgba(59, 130, 246, 0.4)',
              zIndex: 20000,
            }}
          />
        );
      })()}
    </div>
  );
};

export default InteractiveLayerOverlay;
