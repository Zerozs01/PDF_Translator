import React, { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';

export const ImageCanvas: React.FC = () => {
  const { fileUrl } = useProjectStore();
  const { zoom, pan, setZoom, setPan, activeTool } = useUIStore();
  const { allPagesOCR, showDebugOverlay } = useOCRTextLayerStore();
  const currentPageOCR = showDebugOverlay ? allPagesOCR.get(1) : undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const stateRef = useRef({ zoom, pan });

  useEffect(() => {
    stateRef.current = { zoom, pan };
    if (!isDragging) {
      panRef.current = pan;
    }
  }, [zoom, pan, isDragging]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
    }
  }, [pan, zoom]);

  // Manual Event Listener for Wheel (Non-Passive)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const scaleAmount = -e.deltaY * 0.001;
        const newZoom = Math.min(Math.max(0.1, stateRef.current.zoom + scaleAmount), 5);
        setZoom(newZoom);
      } else {
        setPan(stateRef.current.pan.x - e.deltaX, stateRef.current.pan.y - e.deltaY);
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [setZoom, setPan]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'hand' || e.button === 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    panRef.current = { x: newX, y: newY };
    if (contentRef.current) {
      contentRef.current.style.transform = `translate(${newX}px, ${newY}px) scale(${stateRef.current.zoom})`;
    }
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    setPan(panRef.current.x, panRef.current.y);
  };

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const { naturalWidth, naturalHeight } = img;
    const container = containerRef.current;
    if (!container) return;

    const { clientWidth, clientHeight } = container;
    const scaleX = (clientWidth - 40) / naturalWidth;
    const scaleY = (clientHeight - 40) / naturalHeight;
    const fitScale = Math.min(scaleX, scaleY, 1);
    if (stateRef.current.zoom === 1) {
      setZoom(fitScale);
    }
    const scaledWidth = naturalWidth * fitScale;
    const x = (clientWidth - scaledWidth) / 2;
    setPan(x, 20);
  };

  return (
    <div 
      ref={containerRef}
      className={`w-full h-full overflow-hidden relative bg-slate-900/50 ${activeTool === 'hand' ? 'cursor-grab active:cursor-grabbing' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div 
        ref={contentRef}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          willChange: 'transform'
        }}
        className="absolute top-0 left-0 origin-top-left"
      >
        {fileUrl ? (
          <div className="relative inline-block">
            <img
              src={fileUrl}
              alt="Loaded document"
              onLoad={handleImageLoad}
              draggable={false}
              className="max-w-none border border-slate-700 bg-white shadow-2xl select-none block"
            />
            {currentPageOCR && (
              <div className="absolute inset-0 pointer-events-none">
                {currentPageOCR.words.map((word, idx) => (
                  <div
                    key={`ocr-word-${idx}`}
                    style={{
                      left: word.bbox.x0,
                      top: word.bbox.y0,
                      width: Math.max(1, word.bbox.x1 - word.bbox.x0),
                      height: Math.max(1, word.bbox.y1 - word.bbox.y0)
                    }}
                    className="absolute border border-red-400/60"
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-slate-500 p-6">Loading image...</div>
        )}
      </div>
    </div>
  );
};
