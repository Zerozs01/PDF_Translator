import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useSegmentationStore } from '../../stores/useSegmentationStore';
import { visionService } from '../../services/vision/VisionService';

// Set worker source for pdf.js
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export const PDFCanvas: React.FC = () => {
  const { fileUrl, currentPage, totalPages, setTotalPages, viewMode, sourceLanguage } = useProjectStore();
  const { zoom, pan, setZoom, setPan, activeTool } = useUIStore();
  const { regions, setRegions, setIsProcessing, processRequest } = useSegmentationStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const pageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const panRef = useRef(pan);

  // State Ref for Event Listeners to avoid stale closures
  const stateRef = useRef({ zoom, pan });
  useEffect(() => {
    stateRef.current = { zoom, pan };
    if (!isDragging) {
      panRef.current = pan;
    }
  }, [zoom, pan, isDragging]);

  // Handle Document Load
  const onDocumentLoadSuccess = React.useCallback(({ numPages }: { numPages: number }) => {
    setTotalPages(numPages);
  }, [setTotalPages]);

  // Handle Page Load (Fit to Screen Logic)
  const onPageLoadSuccess = React.useCallback(async (page: any) => {
    // 1. Fit to Screen Logic
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      const { width, height } = page.originalWidth ? { width: page.originalWidth, height: page.originalHeight } : page;
      
      // Only fit if we are at default zoom (approx 1) or initial load
      // We can't easily check "initial load" here without more state, but checking zoom === 1 is a decent heuristic
      // However, accessing 'zoom' here would make this callback change when zoom changes.
      // Let's just calculate fit scale and set it if it seems appropriate (e.g. first page load)
      
      const scaleX = (clientWidth - 40) / width;
      const scaleY = (clientHeight - 40) / height;
      const fitScale = Math.min(scaleX, scaleY, 1);
      
      // We only auto-fit if the current zoom is exactly 1 (default)
      if (stateRef.current.zoom === 1) {
        setZoom(fitScale);
      }
      
      const scaledWidth = width * fitScale;
      const x = (clientWidth - scaledWidth) / 2;
      setPan(x, 20);
    }
  }, [setZoom, setPan]);

  // Listen for Process Request
  useEffect(() => {
    if (processRequest > 0) {
      captureAndProcess();
    }
  }, [processRequest]);

  const captureAndProcess = async () => {
    console.log("Processing Triggered...");
    const canvas = document.querySelector(`.react-pdf__Page[data-page-number="${currentPage}"] canvas`) as HTMLCanvasElement;
    
    if (canvas) {
      console.log("Canvas found, sending to Vision Service...");
      setIsProcessing(true);
      
      // Create a temporary canvas to ensure white background (react-pdf canvas might be transparent)
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const ctx = tempCanvas.getContext('2d');
      
      let imageUrl = '';
      
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(canvas, 0, 0);
        imageUrl = tempCanvas.toDataURL('image/jpeg', 1.0);
      } else {
        // Fallback if context fails (unlikely)
        imageUrl = canvas.toDataURL('image/jpeg');
      }

      console.log(`Captured Image URL Length: ${imageUrl.length}`);
      console.log(`Sending OCR Request with Language: ${sourceLanguage}`);
      
      try {
        // Pass the current source language to the vision service
        const detectedRegions = await visionService.segmentImage(imageUrl, sourceLanguage);
        console.log("Vision Service returned:", detectedRegions);
        setRegions(detectedRegions);
      } catch (error) {
        console.error("Vision Service Error:", error);
      } finally {
        setIsProcessing(false);
      }
    } else {
      console.warn("Canvas not found for vision processing");
    }
  };

  // Manual Event Listener for Wheel (Non-Passive)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      // Only prevent default if Ctrl is pressed (Zoom) to allow normal scrolling if needed,
      // BUT since we are implementing custom pan, we likely want to prevent default always
      // to stop the browser from scrolling the page itself.
      e.preventDefault();

      if (e.ctrlKey) {
        // Zoom
        const { zoom } = stateRef.current;
        const scaleAmount = -e.deltaY * 0.001;
        const newZoom = Math.min(Math.max(0.1, zoom + scaleAmount), 5);
        setZoom(newZoom);
      } else {
        // Pan
        const { pan } = stateRef.current;
        setPan(pan.x - e.deltaX, pan.y - e.deltaY);
      }
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [setZoom, setPan]);

  // Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Allow panning with Hand tool OR Middle Mouse Button (button 1)
    if (activeTool === 'hand' || e.button === 1) { 
      setIsDragging(true);
      // Calculate the offset from the mouse position to the current pan position
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault(); // Prevent text selection
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      e.preventDefault();
      // Calculate new position
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      // Update ref
      panRef.current = { x: newX, y: newY };

      // Direct DOM manipulation for performance
      if (contentRef.current) {
        contentRef.current.style.transform = `translate(${newX}px, ${newY}px) scale(${stateRef.current.zoom})`;
      }
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      setPan(panRef.current.x, panRef.current.y);
    }
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
        <div className="relative shadow-2xl">
          <Document
            file={fileUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            className="flex flex-col gap-4"
          >
            {viewMode === 'single' ? (
              <div className="relative group">
                <Page 
                  pageNumber={currentPage} 
                  renderTextLayer={false} 
                  renderAnnotationLayer={false}
                  className="border border-slate-700 bg-white"
                  width={800}
                  onLoadSuccess={onPageLoadSuccess}
                />
                {/* Regions Overlay */}
                {regions.map(reg => (
                    <div 
                      key={reg.id}
                      style={{
                        left: reg.box.x,
                        top: reg.box.y,
                        width: reg.box.w,
                        height: reg.box.h
                      }}
                      className={`absolute border-2 border-dashed transition-all cursor-pointer hover:bg-opacity-20 ${
                        reg.type === 'balloon' ? 'border-green-500 bg-green-500/10' : 
                        reg.type === 'sfx' ? 'border-orange-500 bg-orange-500/10' :
                        'border-blue-500 bg-blue-500/10'
                      }`}
                    >
                    </div>
                  ))}
              </div>
            ) : (
              Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <div key={`page_${pageNum}`} className="relative mb-4 group">
                  <Page 
                    pageNumber={pageNum}
                    renderTextLayer={false} 
                    renderAnnotationLayer={false}
                    className="border border-slate-700 bg-white"
                    width={800}
                  />
                </div>
              ))
            )}
          </Document>
        </div>
      </div>
    </div>
  );
};
