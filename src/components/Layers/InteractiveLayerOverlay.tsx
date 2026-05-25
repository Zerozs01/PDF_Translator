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
  const effectiveBBox = (layout && !layer.userEdited)
    ? (layout.mergedBBox || layer.bbox)
    : layer.bbox;
  const { left, top, width } = toScreen(effectiveBBox, ocrTransform);
  const trimmedValue = defaultValue ? defaultValue.trim() : '';

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
    // Auto-focus + cursor at end + auto-resize height
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
        left,
        top,
        width: Math.max(width, 140),
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
}

const SelectionBox: React.FC<SelectionBoxProps> = ({
  layer, ocrTransform, isSelected, isEditing, isMultiSelected,
  activeResizeDir, isRotating, startRotation, activeTool,
  onMouseDownBody, onMouseDownHandle, onMouseDownRotate,
  onDoubleClick, onHover, layout,
}) => {
  const effectiveBBox = (layout && !layer.userEdited)
    ? (layout.mergedBBox || layer.bbox)
    : layer.bbox;
  const { left, top, width, height } = toScreen(effectiveBBox, ocrTransform);
  const isHighlighted = isSelected || isMultiSelected;
  const rotation = layer.rotation || 0;
  
  // State สำหรับจัดการ Hover Effect ของปุ่มหมุน
  const [isRotateHovered, setIsRotateHovered] = useState(false);

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
          ? '2px solid #8B5CF6' // กำลังหมุน -> เปลี่ยนเป็นเส้นทึบสีม่วง Canva พรีเมียม!
          : isHighlighted
            ? '2px dashed #3B82F6'
            : 'none',           // ซ่อน border เมื่อไม่ได้ select - ไม่ควรเห็นกล่องรอบทุก layer
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
      onMouseEnter={() => onHover(layer.id)}
      onMouseLeave={() => onHover(null)}
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
};

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
        e.preventDefault();
        if (confirm(`คุณต้องการลบ ${selectedLayerIds.size} ข้อความที่เลือกใช่หรือไม่?`)) {
          // ลบ snapshot ก่อนลบจริงเพื่อให้ undo ทำงานได้ถูกต้อง
          pushUndoSnapshot(pageNum);
          selectedLayerIds.forEach((id) => {
            deleteLayer(pageNum, id);
          });
          clearSelection();
        }
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
    
    // บันทึกเข้า OCR Store
    ocrStore.addOCRLine(pageNum, ocrLine);
    
    // 2. เพิ่มเลเยอร์ใหม่เข้า Layer store (จะผูกกับกลุ่ม Ungrouped โดยอัตโนมัติ)
    addManualLayer(pageNum, pdfBBox, defaultText, lineIndex, { backgroundColor: bgColor });
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
        const idsToMove = (selectedLayerIds.size > 1 && selectedLayerIds.has(ds.layerId))
          ? Array.from(selectedLayerIds)
          : [ds.layerId];

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
          // Note: for drawing region, screenDx/screenDy are still in screen coordinates because the overlay drawing container is at screen scale
          const rawDx = e.clientX - ds.startMouseX;
          const rawDy = e.clientY - ds.startMouseY;
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

        const idsToMove = (selectedLayerIds.size > 1 && selectedLayerIds.has(ds.layerId))
          ? Array.from(selectedLayerIds)
          : [ds.layerId];

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

        // Save position updates
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
    pageNum, layers, selectedLayerIds, ocrTransform, drawStartPos, drawCurrentPos,
    updateLayerBBox, updateLayerRotation, updateMultiLayerBBoxDelta, synchronizeGroupBBox, handleCreateManualRegion, activeTool
  ]);

  // ── Handlers ─────────────────────────────────────────────────
  const handleMouseDownBody = useCallback((e: React.MouseEvent, layerId: string) => {
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
    if (activeTool === 'region' || activeTool === 'text') {
      e.stopPropagation();
      e.preventDefault();
      
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
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
      id="interactive-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'all',
        zIndex: 10000,
        cursor: (activeTool === 'region' || activeTool === 'text') ? 'crosshair' : 'default',
      }}
      onMouseDown={handleOverlayMouseDown}
    >
      {/* Layer Selection Boxes */}
      {layers.map((layer) => {
        if (!layer.visible) return null;

        // คัดกรองและซ่อนเลเยอร์ที่ถูกสั่ง hidden จาก layout map (เนื่องจากถูกผสานกลุ่ม)
        const layout = layouts?.get(layer.lineIndex);
        if (layout?.hidden) {
          return null;
        }

        const isEditing = editingLayerId === layer.id;
        const isSelected = selectedLayerIds.has(layer.id) && selectedLayerIds.size === 1;
        const isMultiSelected = selectedLayerIds.has(layer.id) && selectedLayerIds.size > 1;

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
