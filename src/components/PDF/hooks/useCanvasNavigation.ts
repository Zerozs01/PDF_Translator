import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useUIStore } from '../../../stores/useUIStore';

export interface UseCanvasNavigationOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  activeTool: string;
  onInteractionStart?: () => void;
  onInteractionEnd?: (delay?: number) => void;
}

export function useCanvasNavigation({
  containerRef,
  contentRef,
  activeTool,
  onInteractionStart,
  onInteractionEnd,
}: UseCanvasNavigationOptions) {
  const zoom = useUIStore((s) => s.zoom);
  const pan = useUIStore((s) => s.pan);
  const setZoom = useUIStore((s) => s.setZoom);
  const setPan = useUIStore((s) => s.setPan);
  const setView = useUIStore((s) => s.setView);

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);

  const wheelTransformRafRef = useRef<number | null>(null);
  const wheelIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragTransformRafRef = useRef<number | null>(null);

  const stateRef = useRef({ zoom, pan });

  useEffect(() => {
    stateRef.current = { zoom, pan };
    if (!isDragging) {
      panRef.current = pan;
    }
  }, [zoom, pan, isDragging]);

  const syncContentTransform = useCallback((nextPan: { x: number; y: number }, nextZoom: number) => {
    if (!contentRef.current) return;
    const transformStr = `translate3d(${nextPan.x}px, ${nextPan.y}px, 0px) scale(${nextZoom})`;
    contentRef.current.style.transform = transformStr;

    // Real-time synchronization for split-view
    const isSplit = useUIStore.getState().viewMode === 'split';
    if (isSplit) {
      const workspace = contentRef.current.closest('.workspace-viewport');
      if (workspace) {
        const allContents = workspace.querySelectorAll('.pdf-canvas-content, .image-canvas-content');
        allContents.forEach((el) => {
          if (el !== contentRef.current) {
            (el as HTMLElement).style.transform = transformStr;
          }
        });
      }
    }
  }, [contentRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      onInteractionStart?.();

      if (contentRef.current) {
        contentRef.current.style.transition = 'none';
      }

      if (wheelIdleTimerRef.current) {
        clearTimeout(wheelIdleTimerRef.current);
      }

      if (e.ctrlKey) {
        const scaleAmount = -e.deltaY * 0.001;
        const newZoom = Math.min(Math.max(0.1, stateRef.current.zoom + scaleAmount), 5);

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomFactor = newZoom / stateRef.current.zoom;
        const nextPan = {
          x: mouseX - (mouseX - stateRef.current.pan.x) * zoomFactor,
          y: mouseY - (mouseY - stateRef.current.pan.y) * zoomFactor,
        };

        panRef.current = nextPan;
        stateRef.current = { zoom: newZoom, pan: nextPan };

        if (wheelTransformRafRef.current !== null) {
          cancelAnimationFrame(wheelTransformRafRef.current);
        }
        wheelTransformRafRef.current = requestAnimationFrame(() => {
          syncContentTransform(nextPan, newZoom);
          wheelTransformRafRef.current = null;
        });
      } else {
        const nextPan = {
          x: stateRef.current.pan.x - e.deltaX,
          y: stateRef.current.pan.y - e.deltaY,
        };
        panRef.current = nextPan;
        stateRef.current = { ...stateRef.current, pan: nextPan };

        if (wheelTransformRafRef.current !== null) {
          cancelAnimationFrame(wheelTransformRafRef.current);
        }
        wheelTransformRafRef.current = requestAnimationFrame(() => {
          syncContentTransform(nextPan, stateRef.current.zoom);
          wheelTransformRafRef.current = null;
        });
      }

      wheelIdleTimerRef.current = setTimeout(() => {
        wheelIdleTimerRef.current = null;
        setView(panRef.current, stateRef.current.zoom);
        onInteractionEnd?.(300);
      }, 120);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [containerRef, contentRef, onInteractionEnd, onInteractionStart, setView, syncContentTransform]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (activeTool === 'hand' || e.button === 1 || e.ctrlKey) {
      setIsDragging(true);
      onInteractionStart?.();
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  }, [activeTool, onInteractionStart, pan.x, pan.y]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) {
      e.preventDefault();
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;

      panRef.current = { x: newX, y: newY };

      if (dragTransformRafRef.current !== null) {
        cancelAnimationFrame(dragTransformRafRef.current);
      }
      dragTransformRafRef.current = requestAnimationFrame(() => {
        if (contentRef.current) {
          const transformStr = `translate3d(${newX}px, ${newY}px, 0px) scale(${stateRef.current.zoom})`;
          contentRef.current.style.transform = transformStr;

          const isSplit = useUIStore.getState().viewMode === 'split';
          if (isSplit) {
            const workspace = contentRef.current.closest('.workspace-viewport');
            if (workspace) {
              const allContents = workspace.querySelectorAll('.pdf-canvas-content, .image-canvas-content');
              allContents.forEach((el) => {
                if (el !== contentRef.current) {
                  (el as HTMLElement).style.transform = transformStr;
                }
              });
            }
          }
        }
        dragTransformRafRef.current = null;
      });
    }
  }, [contentRef, dragStart.x, dragStart.y, isDragging]);

  const handleMouseUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (dragTransformRafRef.current !== null) {
        cancelAnimationFrame(dragTransformRafRef.current);
        dragTransformRafRef.current = null;
      }
      setPan(panRef.current.x, panRef.current.y);
      onInteractionEnd?.(500);
    }
  }, [isDragging, onInteractionEnd, setPan]);

  useEffect(() => {
    return () => {
      if (wheelTransformRafRef.current !== null) {
        cancelAnimationFrame(wheelTransformRafRef.current);
        wheelTransformRafRef.current = null;
      }
      if (dragTransformRafRef.current !== null) {
        cancelAnimationFrame(dragTransformRafRef.current);
        dragTransformRafRef.current = null;
      }
      if (wheelIdleTimerRef.current) {
        clearTimeout(wheelIdleTimerRef.current);
        wheelIdleTimerRef.current = null;
      }
    };
  }, []);

  return {
    zoom,
    pan,
    setZoom,
    setPan,
    setView,
    isDragging,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    syncContentTransform,
    stateRef,
    panRef,
  };
}
