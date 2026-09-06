/**
 * InteractiveLayerOverlay — Phase 3 Interactive Canvas Manipulation
 *
 * [Scrutinize S1]: Refactored & Modularized into Sub-components:
 * - layerOverlayTypes.ts (geometry transforms & cursor mappings)
 * - LayerInlineEditor.tsx (floating toolbar, color pickers, textarea)
 * - LayerSelectionBox.tsx (selection box, resize handles, rotation tooltip, memo)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { BBox } from '../../types';
import type { TextLayer, TextLayerGroup } from '../../types/layers';
import type { OverlayLayout } from '../OCR/translationOverlayUtils';
import { useLayerStore } from '../../stores/useLayerStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { useUIStore } from '../../stores/useUIStore';

import {
  ResizeDirection,
  OcrTransform,
  InteractiveLayerOverlayProps as Props,
  toScreen,
  toPDFDelta,
  applyResize,
} from './layerOverlayTypes';
import { LayerInlineEditor as InlineEditor } from './LayerInlineEditor';
import { LayerSelectionBox as SelectionBox } from './LayerSelectionBox';


// ─── Main Component: InteractiveLayerOverlay ──────────────────────
export const InteractiveLayerOverlay: React.FC<Props> = ({
  pageNum, layers, groups, ocrTransform, isActive, layouts, previewModeOverride,
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

  const storePreviewMode = useOCRTextLayerStore((state) => state.translationPreviewMode);
  const translationPreviewMode = previewModeOverride || storePreviewMode;
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
  const { undoLastAction, deleteSelectedLayers } = useLayerStore();
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
        deleteSelectedLayers();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pageNum, editingLayerId, selectedLayerIds, undoLastAction, clearSelection, deleteSelectedLayers]);

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

        // Save position updates only if actual screen movement exceeded 3 pixels to prevent accidental "userEdited" flags
        const screenMovement = Math.sqrt(
          Math.pow(e.clientX - ds.startMouseX, 2) + 
          Math.pow(e.clientY - ds.startMouseY, 2)
        );
        const hasMoved = screenMovement >= 3;
        if (hasMoved) {
          pushUndoSnapshot(pageNum);
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
    updateLayerBBox, updateLayerRotation, updateMultiLayerBBoxDelta, synchronizeGroupBBox, handleCreateManualRegion, activeTool, pushUndoSnapshot
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

    dragState.current = {
      type: 'drag',
      layerId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startBBox: { ...layer.bbox },
    };
  }, [editingLayerId, layers, selectLayer, activeTool, setEditingLayerId]);

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
                previewModeOverride={previewModeOverride}
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
