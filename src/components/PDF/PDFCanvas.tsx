import React, { useState } from 'react';
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
  const { fileUrl, currentPage, setTotalPages, viewMode } = useProjectStore();
  const { zoom, pan } = useUIStore();
  
  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setTotalPages(numPages);
  };

  return (
    <div 
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: '0 0',
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
                {/* Overlay for this page could be added here if we track page number in regions */}
              </div>
            ))
          )}
        </Document>
      </div>
    </div>
  );
};
