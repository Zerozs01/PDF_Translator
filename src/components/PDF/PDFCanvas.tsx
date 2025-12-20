import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { Region } from '../../types';

// Set worker source for pdf.js
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

interface PDFCanvasProps {
  regions: Region[];
}

export const PDFCanvas: React.FC<PDFCanvasProps> = ({ regions }) => {
  const { fileUrl, currentPage, totalPages, setTotalPages, viewMode } = useProjectStore();
  const { zoom, pan, setZoom, setPan, activeTool } = useUIStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Handle Document Load
  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setTotalPages(numPages);
  };

  // Handle Page Load (Fit to Screen Logic)
  const onPageLoadSuccess = (page: any) => {
    if (containerRef.current && zoom === 1) {
      const { clientWidth, clientHeight } = containerRef.current;
      const { width, height } = page.originalWidth ? { width: page.originalWidth, height: page.originalHeight } : page;
      
      // Calculate scale to fit
      const scaleX = (clientWidth - 40) / width; // 40px padding
      const scaleY = (clientHeight - 40) / height;
      const fitScale = Math.min(scaleX, scaleY, 1); // Don't zoom in if image is smaller
      
      setZoom(fitScale);
      
      // Center the page
      const scaledWidth = width * fitScale;
      const x = (clientWidth - scaledWidth) / 2;
      setPan(x, 20);
    }
  };

  // Mouse Wheel Zoom & Pan
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      // Zoom
      e.preventDefault();
      const scaleAmount = -e.deltaY * 0.001;
      const newZoom = Math.min(Math.max(0.1, zoom + scaleAmount), 5);
      setZoom(newZoom);
    } else {
      // Pan (Scroll)
      // If we are in continuous mode or zoomed in, we want to scroll
      const scrollSpeed = 1; // Adjust as needed
      setPan(pan.x - e.deltaX * scrollSpeed, pan.y - e.deltaY * scrollSpeed);
    }
  };

  // Pan Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'hand' || e.button === 1) { // Hand tool or Middle Click
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan(e.clientX - dragStart.x, e.clientY - dragStart.y);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div 
      ref={containerRef}
      className={`w-full h-full overflow-hidden relative bg-slate-900/50 ${activeTool === 'hand' ? 'cursor-grab active:cursor-grabbing' : ''}`}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div 
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out'
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
                  width={800} // Base width, scaled by CSS transform
                  onLoadSuccess={onPageLoadSuccess}
                />
                {/* Regions Overlay for Single Page */}
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
                     {/* Region Content */}
                   </div>
                 ))}
              </div>
            ) : (
              // Continuous Mode: Render all pages
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
