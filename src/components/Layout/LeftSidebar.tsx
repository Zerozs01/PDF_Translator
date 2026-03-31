/**
 * LeftSidebar - Pages Navigator
 * 
 * Features:
 * - Gallery view (thumbnails)
 * - Page number input
 * - Collapsible
 */

import React, { useMemo, useState } from 'react';
import { Document, Page } from 'react-pdf';
import '../../services/pdf/pdfjsWorker';
import { useProjectStore } from '../../stores/useProjectStore';
import { ChevronLeft, ChevronRight, Grid3X3, List, CheckSquare } from 'lucide-react';

interface LeftSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ isOpen, onToggle }) => {
  const { fileUrl, fileData, currentPage, totalPages, setPage, viewMode, setViewMode } = useProjectStore();
  const [displayMode, setDisplayMode] = useState<'gallery' | 'list'>('gallery');
  const pdfSource = useMemo(() => {
    // Prefer object URL source so worker message transfer never detaches app-held buffers.
    if (fileUrl) return fileUrl;
    if (!fileData) return null;
    // Fallback for edge cases where URL is not available.
    return { data: new Uint8Array(fileData) };
  }, [fileUrl, fileData]);

  const docKey = fileUrl ?? 'pdf-thumbs';

  return (
    <aside 
      className={`bg-slate-950/60 border-r border-white/10 backdrop-blur-xl flex flex-col transition-all duration-300 ease-in-out relative shrink-0 overflow-visible z-20 ${
        isOpen ? 'w-48' : 'w-0'
      }`}
    >
      <div className={`flex-1 overflow-hidden flex flex-col ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        {/* Header - Combined Controls */}
        <div className="p-2 border-b border-white/10 bg-slate-950/35">
          <div className="flex items-center justify-between gap-2">
            {/* Display Mode Toggle (Gallery/List) */}
            <div className="flex bg-slate-900/70 border border-white/10 rounded p-0.5">
              <button 
                onClick={() => setDisplayMode('gallery')}
                className={`p-1 rounded transition-colors ${
                  displayMode === 'gallery' 
                    ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' 
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Gallery View"
              >
                <Grid3X3 size={12} />
              </button>
              <button 
                onClick={() => setDisplayMode('list')}
                className={`p-1 rounded transition-colors ${
                  displayMode === 'list' 
                    ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' 
                    : 'text-slate-400 hover:text-white'
                }`}
                title="List View"
              >
                <List size={12} />
              </button>
            </div>

            {/* View Mode Toggle (Single/Scroll) */}
            <div className="flex bg-slate-900/70 border border-white/10 rounded p-0.5">
              <button 
                onClick={() => setViewMode('single')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                  viewMode === 'single' 
                    ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' 
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Single Page"
              >
                Single
              </button>
              <button 
                onClick={() => setViewMode('continuous')}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                  viewMode === 'continuous' 
                    ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' 
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Continuous Scroll"
              >
                Scroll
              </button>
            </div>
          </div>
        </div>

        {/* Page Navigation Input */}
        <div className="p-2 border-b border-white/10 bg-slate-950/25">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-slate-500">Go to:</span>
            <input 
              type="number" 
              value={currentPage}
              onChange={(e) => {
                const page = parseInt(e.target.value);
                if (page >= 1 && page <= totalPages) setPage(page);
              }}
              className="flex-1 w-full bg-slate-900/70 border border-white/15 rounded px-2 py-1 text-xs text-center text-white focus:outline-none focus:border-[#2B9BFF]/65"
              min={1}
              max={totalPages}
            />
            <span className="text-[10px] text-slate-500">/ {totalPages}</span>
          </div>
        </div>

        {/* Pages Gallery/List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {displayMode === 'gallery' ? (
            // Gallery View - Thumbnails
            <Document
              key={docKey}
              file={pdfSource}
              onLoadError={(error) => console.error('[LeftSidebar] PDF load error:', error)}
              className="p-2 space-y-2"
            >
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <div 
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`cursor-pointer group relative rounded-lg overflow-hidden border-2 transition-all ${
                    currentPage === pageNum 
                      ? 'border-[#2B9BFF] shadow-[0_0_14px_rgba(43,155,255,0.35)]' 
                      : 'border-white/10 hover:border-white/25'
                  }`}
                >
                  <div className="relative bg-white">
                    <Page 
                      pageNumber={pageNum} 
                      width={160} 
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      className="opacity-90 group-hover:opacity-100 transition-opacity"
                    />
                    {/* Page Number Badge */}
                    <div className="absolute bottom-1 right-1 bg-slate-900/80 text-white text-[9px] font-bold px-1.5 py-0.5 rounded backdrop-blur-sm">
                      {pageNum}
                    </div>
                    
                    {/* Active Indicator */}
                    {currentPage === pageNum && (
                      <div className="absolute top-1 left-1 bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white p-0.5 rounded-full shadow-lg">
                        <CheckSquare size={10} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </Document>
          ) : (
            // List View - Compact
            <div className="p-2 space-y-1">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <button
                  key={pageNum}
                  onClick={() => setPage(pageNum)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all ${
                    currentPage === pageNum 
                      ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' 
                      : 'bg-slate-900/45 border border-white/10 text-slate-300 hover:bg-slate-900/75'
                  }`}
                >
                  <span>Page {pageNum}</span>
                  {currentPage === pageNum && <CheckSquare size={12} />}
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Toggle Button */}
      <button 
        onClick={onToggle}
        className="absolute left-full top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-950/95 border border-white/20 shadow-xl rounded-full p-1.5 hover:bg-slate-900 hover:text-[#5CC6F2] transition-all z-[70]"
        aria-label={isOpen ? 'Collapse page navigator' : 'Expand page navigator'}
        title={isOpen ? 'Collapse page navigator' : 'Expand page navigator'}
      >
        {isOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>
    </aside>
  );
};
