import type { CSSProperties } from 'react';
import type { BBox } from '../../types';
import type { TextLayer, TextLayerGroup } from '../../types/layers';
import type { OverlayLayout } from '../OCR/translationOverlayUtils';

export type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export interface OcrTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface InteractiveLayerOverlayProps {
  pageNum: number;
  layers: TextLayer[];
  groups: TextLayerGroup[];
  ocrTransform: OcrTransform;
  /** ถ้า false = ซ่อน overlay ทั้งหมด (เมื่อ activeTool ไม่ใช่ 'select' และไม่ใช่ 'region') */
  isActive: boolean;
  layouts?: Map<number, OverlayLayout>;
  previewModeOverride?: 'original' | 'translated';
}

/** แปลง OCR bbox → screen coordinates */
export const toScreen = (bbox: BBox, t: OcrTransform) => ({
  left:   t.offsetX + bbox.x0 * t.scaleX,
  top:    t.offsetY + bbox.y0 * t.scaleY,
  width:  (bbox.x1 - bbox.x0) * t.scaleX,
  height: (bbox.y1 - bbox.y0) * t.scaleY,
});

/** แปลง screen delta → OCR coordinate delta */
export const toPDFDelta = (dx: number, dy: number, t: OcrTransform) => ({
  dx: dx / t.scaleX,
  dy: dy / t.scaleY,
});

/** คำนวณ BBox ใหม่ตาม resize direction + delta */
export const applyResize = (start: BBox, delta: { dx: number; dy: number }, dir: ResizeDirection): BBox => {
  const b = { ...start };
  if (dir.includes('n')) b.y0 = Math.min(b.y0 + delta.dy, b.y1 - 10);
  if (dir.includes('s')) b.y1 = Math.max(b.y1 + delta.dy, b.y0 + 10);
  if (dir.includes('w')) b.x0 = Math.min(b.x0 + delta.dx, b.x1 - 20);
  if (dir.includes('e')) b.x1 = Math.max(b.x1 + delta.dx, b.x0 + 20);
  return b;
};

/** Cursor CSS ตาม direction */
export const CURSOR_MAP: Record<ResizeDirection, string> = {
  nw: 'nwse-resize', se: 'nwse-resize',
  ne: 'nesw-resize', sw: 'nesw-resize',
  n: 'ns-resize', s: 'ns-resize',
  e: 'ew-resize', w: 'ew-resize',
};

export const HANDLE_POSITIONS: { dir: ResizeDirection; style: CSSProperties }[] = [
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
