import React from 'react';
import type { TextLayer } from '../../types/layers';
import type { OverlayLayout } from '../OCR/translationOverlayUtils';
import {
  ResizeDirection,
  OcrTransform,
  toScreen,
  CURSOR_MAP,
  HANDLE_POSITIONS,
} from './layerOverlayTypes';

export interface SelectionBoxProps {
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
  previewModeOverride?: 'original' | 'translated';
  showDebugOverlay?: boolean;
  viewMode?: string;
  translationPreviewMode?: 'original' | 'translated';
}

export const areEqualSelectionBox = (prev: SelectionBoxProps, next: SelectionBoxProps): boolean => {
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isEditing !== next.isEditing) return false;
  if (prev.isMultiSelected !== next.isMultiSelected) return false;
  if (prev.activeResizeDir !== next.activeResizeDir) return false;
  if (prev.isRotating !== next.isRotating) return false;
  if (prev.startRotation !== next.startRotation) return false;
  if (prev.activeTool !== next.activeTool) return false;
  if (prev.isLayoutHidden !== next.isLayoutHidden) return false;
  if (prev.previewModeOverride !== next.previewModeOverride) return false;
  if (prev.showDebugOverlay !== next.showDebugOverlay) return false;
  if (prev.viewMode !== next.viewMode) return false;
  if (prev.translationPreviewMode !== next.translationPreviewMode) return false;

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

export const LayerSelectionBox: React.FC<SelectionBoxProps> = React.memo(({
  layer, ocrTransform, isSelected, isEditing, isMultiSelected,
  activeResizeDir, isRotating, startRotation, activeTool,
  onMouseDownBody, onMouseDownHandle, onMouseDownRotate,
  onDoubleClick, onHover, layout, isLayoutHidden, previewModeOverride,
  showDebugOverlay = false,
  viewMode = 'single',
  translationPreviewMode: propTranslationPreviewMode,
}) => {
  const translationPreviewMode = previewModeOverride || propTranslationPreviewMode || 'translated';
  
  // ป้ายนี้ถือว่าเป็นฝั่งขวาในโหมดเปรียบเทียบ (split view) ก็ต่อเมื่อ viewMode === 'split' และมีข้อความแปลแล้ว/ภาษาไทย
  const currentRenderText = (layout && typeof layout.renderText === 'string') ? layout.renderText : layer.text;
  const hasThaiText = /[\u0E00-\u0E7F]/.test(currentRenderText);
  const isSplitView = viewMode === 'split';
  const isTranslatedAreaInSplitView = isSplitView && (translationPreviewMode === 'translated' || hasThaiText || (layer.text !== layer.sourceText));

  // ซ่อน child line ที่ถูก dehyphenate รวมกับบรรทัดหลักไปแล้ว (renderText === '')
  if (layout && layout.renderText === '' && !layer.userEdited && !isSelected && !isMultiSelected) {
    return null;
  }

  const effectiveBBox = layer.bbox || layout?.mergedBBox || { x0: 0, y0: 0, x1: 0, y1: 0 };
  const { left, top, width, height } = toScreen(effectiveBBox, ocrTransform);
  const isHighlighted = isSelected || isMultiSelected;
  const rotation = layer.rotation || 0;

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

  const hoverBorder = isLayoutHidden
    ? 'rgba(99,102,241,0.9)'
    : (isTranslatedAreaInSplitView ? '#00D2FF' : '#F97316');
  const hoverBg = isTranslatedAreaInSplitView
    ? 'rgba(0, 210, 255, 0.16)'
    : 'rgba(249, 115, 22, 0.16)';
  const hoverShadow = isTranslatedAreaInSplitView
    ? '0 0 8px rgba(0, 210, 255, 0.35)'
    : '0 0 8px rgba(249, 115, 22, 0.35)';

  return (
    <div
      id={`layer-bbox-${layer.id}`}
      className="layer-selection-box"
      data-rotating={isRotating}
      data-selected={isHighlighted}
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
            ? `2px dashed ${isLayoutHidden ? 'rgba(99,102,241,0.85)' : (isTranslatedAreaInSplitView ? '#00D2FF' : '#3B82F6')}` // กดเลือก Layer -> เส้นประ dashed ชัดเจน!
            : isLayoutHidden
              ? '0.75px solid rgba(99,102,241,0.25)' // suppress โดย overlay dedup
              : (showDebugOverlay || isTranslatedAreaInSplitView)
                ? `1.5px solid ${isTranslatedAreaInSplitView ? '#00D2FF' : '#F97316'}` // ปกติ -> เส้นทึบ solid (ฝั่งขวาSplit = สีฟ้าสด #00D2FF, โหมดปกติ/ฝั่งซ้าย = สีส้มสด #F97316)
                : 'none',
        borderRadius: 3,
        cursor: 'move',
        pointerEvents: (activeTool === 'region' || activeTool === 'text') ? 'none' : 'all', // ซ่อน interaction ตอนวาด region หรือ text เพื่อให้ลากคลุมได้โดยไม่ชนกล่องเดิม
        boxSizing: 'border-box',
        background: isRotating 
          ? 'rgba(139, 92, 246, 0.08)' // ไฮไลท์สีม่วงจางๆ ตอนหมุน
          : isHighlighted 
            ? 'rgba(59,130,246,0.10)' 
            : 'transparent',
        transition: 'border-color 0.12s, background 0.12s, box-shadow 0.12s',
        // Glow Effect ตอนหมุนเพื่อความเด่นบนมังงะขาวดำ
        boxShadow: isRotating
          ? '0 0 12px rgba(139, 92, 246, 0.35)' 
          : isMultiSelected && !isSelected
            ? 'inset 0 0 0 1px rgba(99,102,241,0.4)'
            : undefined,
        ['--hover-border' as any]: `2px dashed ${hoverBorder}`,
        ['--hover-bg' as any]: hoverBg,
        ['--hover-shadow' as any]: hoverShadow,
      }}
      onMouseEnter={() => {
        onHover(layer.id);
      }}
      onMouseLeave={() => {
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
                className="layer-rotate-handle"
                data-rotating={isRotating}
                onMouseDown={(e) => { e.stopPropagation(); onMouseDownRotate(e, layer.id); }}
                style={{
                  width: 28, // ขนาด 28px จับถนัดและมองเห็นชัดเจนยิ่งขึ้นบนมังงะ
                  height: 28,
                  borderRadius: '50%',
                  cursor: isRotating ? 'grabbing' : 'grab',
                  boxShadow: isRotating 
                    ? '0 0 12px rgba(139, 92, 246, 0.7), 0 4px 10px rgba(0,0,0,0.3)' 
                    : '0 2px 4px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: `scale(${isRotating ? 1.15 : 1}) rotate(${rotation}deg)`,
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
