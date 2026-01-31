import React, { useState, useEffect } from 'react';
import { Document, Page } from 'react-pdf';
import { useProjectStore } from '../../stores/useProjectStore';
import { Layers, CheckSquare, FileText } from 'lucide-react';
import { OCRTextLayerPanel } from '../OCR/OCRTextLayerPanel';

export const RightSidebar: React.FC = () => {
  const { fileUrl, currentPage, totalPages, setPage, viewMode, setViewMode, fileType } = useProjectStore();
  const [activeTab, setActiveTab] = useState<'pages' | 'textlayer'>('pages');

  // Default to textlayer tab for PDF files
  useEffect(() => {
    if (fileType === 'pdf') {
      setActiveTab('textlayer');
    }
  }, [fileType]);

  return (
    <aside className="w-80 bg-slate-800 border-l border-slate-700 flex flex-col h-full">
      {/* Tabs */}
      <div className="flex border-b border-slate-700 bg-slate-900/30">
        <button
          onClick={() => setActiveTab('textlayer')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-colors ${
            activeTab === 'textlayer' 
              ? 'text-cyan-400 border-b-2 border-cyan-400 bg-slate-800' 
              : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
          }`}
        >
          <FileText size={12} />
          Text Layer
        </button>
        <button
          onClick={() => setActiveTab('pages')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-colors ${
            activeTab === 'pages' 
              ? 'text-cyan-400 border-b-2 border-cyan-400 bg-slate-800' 
              : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
          }`}
        >
          <Layers size={12} />
          Pages
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'textlayer' ? (
          <div className="flex-1 overflow-y-auto p-4">
            <OCRTextLayerPanel />
          </div>
        ) : (
          <>
            <div className="p-3 bg-slate-900/30 border-b border-slate-700 flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                All Pages ({totalPages})
              </h3>
              
              {/* View Mode Toggle */}
              <div className="flex bg-slate-800 rounded-lg p-0.5 border border-slate-700">
                <button 
                  onClick={() => setViewMode('single')}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                    viewMode === 'single' 
                      ? 'bg-cyan-600 text-white shadow-sm' 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Single Page View"
                >
                  Single
                </button>
                <button 
                  onClick={() => setViewMode('continuous')}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                    viewMode === 'continuous' 
                      ? 'bg-cyan-600 text-white shadow-sm' 
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title="Continuous Scroll View"
                >
                  Scroll
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <Document file={fileUrl} className="space-y-4">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                  <div 
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`cursor-pointer group relative rounded-lg overflow-hidden border-2 transition-all ${
                      currentPage === pageNum 
                        ? 'border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.3)]' 
                        : 'border-slate-700 hover:border-slate-500'
                    }`}
                  >
                    <div className="relative bg-white min-h-[100px]">
                      <Page 
                        pageNumber={pageNum} 
                        width={280} 
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        className="opacity-90 group-hover:opacity-100 transition-opacity"
                      />
                      {/* Page Number Badge */}
                      <div className="absolute bottom-2 right-2 bg-slate-900/80 text-white text-[10px] font-bold px-2 py-1 rounded backdrop-blur-sm">
                        {pageNum}
                      </div>
                      
                      {/* Active Indicator */}
                      {currentPage === pageNum && (
                        <div className="absolute top-2 left-2 bg-cyan-500 text-white p-1 rounded-full shadow-lg">
                          <CheckSquare size={12} />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </Document>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};
