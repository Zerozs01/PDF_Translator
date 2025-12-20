import React, { useState, useEffect } from 'react';
import { Document, Page } from 'react-pdf';
import { useProjectStore } from '../../stores/useProjectStore';
import { useSegmentationStore } from '../../stores/useSegmentationStore';
import { BrainCircuit, Layers, Play, CheckSquare, Settings, List, MessageSquare, Image as ImageIcon } from 'lucide-react';

export const RightSidebar: React.FC = () => {
  const { fileUrl, currentPage, totalPages, setPage, viewMode, setViewMode } = useProjectStore();
  const { triggerProcess, isProcessing, regions } = useSegmentationStore();
  const [activeTab, setActiveTab] = useState<'pages' | 'results'>('pages');

  // Auto-switch to results when processing finishes and we have regions
  useEffect(() => {
    if (!isProcessing && regions.length > 0) {
      setActiveTab('results');
    }
  }, [isProcessing, regions]);

  return (
    <aside className="w-80 bg-slate-800 border-l border-slate-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex items-center gap-2">
        <BrainCircuit className="text-pink-500" size={20} />
        <h2 className="font-bold text-slate-200">OCR Processing</h2>
      </div>

      {/* OCR Controls */}
      <div className="p-4 space-y-4 border-b border-slate-700 bg-slate-800/50">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
          <span>Current Page: {currentPage}</span>
          <span className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-yellow-400 animate-pulse' : 'bg-slate-600'}`} />
            {isProcessing ? 'Processing...' : 'Idle'}
          </span>
        </div>
        
        <button 
          onClick={triggerProcess}
          disabled={isProcessing}
          className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
        >
          <Play size={16} fill="currentColor" />
          Process Current Page
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button className="bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 rounded-lg text-xs font-medium border border-slate-600">
            Process All
          </button>
          <button className="bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 rounded-lg text-xs font-medium border border-slate-600 flex items-center justify-center gap-1">
            <Settings size={12} />
            Config
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700 bg-slate-900/30">
        <button
          onClick={() => setActiveTab('pages')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'pages' 
              ? 'text-cyan-400 border-b-2 border-cyan-400 bg-slate-800' 
              : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
          }`}
        >
          <Layers size={14} />
          Pages
        </button>
        <button
          onClick={() => setActiveTab('results')}
          className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'results' 
              ? 'text-pink-400 border-b-2 border-pink-400 bg-slate-800' 
              : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
          }`}
        >
          <List size={14} />
          Results ({regions.length})
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'pages' ? (
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
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {regions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 gap-2">
                <BrainCircuit size={32} className="opacity-20" />
                <p className="text-xs">No regions detected yet.</p>
                <p className="text-[10px] opacity-60">Click "Process Current Page" to start.</p>
              </div>
            ) : (
              regions.map((region) => (
                <div 
                  key={region.id} 
                  className="bg-slate-700/50 border border-slate-600 rounded-lg p-3 hover:bg-slate-700 transition-colors group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {region.type === 'balloon' ? (
                        <MessageSquare size={14} className="text-green-400" />
                      ) : region.type === 'sfx' ? (
                        <ImageIcon size={14} className="text-orange-400" />
                      ) : (
                        <Layers size={14} className="text-blue-400" />
                      )}
                      <span className={`text-xs font-bold uppercase ${
                        region.type === 'balloon' ? 'text-green-400' : 
                        region.type === 'sfx' ? 'text-orange-400' : 
                        'text-blue-400'
                      }`}>
                        {region.type}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {Math.round(region.confidence * 100)}%
                    </span>
                  </div>
                  
                  <div className="bg-slate-900/50 rounded p-2 text-xs text-slate-300 font-mono break-all border border-slate-800">
                    {region.originalText || <span className="text-slate-600 italic">No text content</span>}
                  </div>
                  
                  <div className="mt-2 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button className="text-[10px] text-cyan-400 hover:text-cyan-300 hover:underline">
                      Edit Region
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
