import React, { useState } from 'react';
import { Upload, FileText, Clock, Shield, Settings2, Sparkles, ScrollText } from 'lucide-react';
import { useProjectStore, SafetySettings, TranslationMode } from '../../stores/useProjectStore';

export const UploadScreen: React.FC = () => {
  const { loadProject, translationMode, setTranslationMode, safetySettings, updateSafetySettings } = useProjectStore();
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadProject(e.dataTransfer.files[0]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      loadProject(e.target.files[0]);
    }
  };

  return (
    <div className="flex h-full w-full bg-slate-950 text-slate-200">
      {/* Left: Recent Files & Quick Actions */}
      <div className="w-1/3 border-r border-slate-800 p-8 flex flex-col">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Clock className="text-cyan-400" /> Recent Projects
        </h2>
        <div className="flex-1 overflow-y-auto space-y-3">
          {/* Mock Recent Files */}
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800 transition-all cursor-pointer group">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-800 group-hover:bg-cyan-900/30 text-cyan-400">
                  <FileText size={20} />
                </div>
                <div>
                  <h3 className="font-medium text-sm text-slate-200">One Piece Chapter {1000 + i}.pdf</h3>
                  <p className="text-xs text-slate-500">Edited 2 hours ago • Manga Mode</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Center: Upload Area */}
      <div className="flex-1 p-8 flex flex-col items-center justify-center relative">
        <div 
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`w-full max-w-2xl aspect-video rounded-3xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-300 ${
            isDragging 
              ? 'border-cyan-400 bg-cyan-400/10 scale-105' 
              : 'border-slate-700 bg-slate-900/30 hover:border-slate-600'
          }`}
        >
          <div className="p-6 rounded-full bg-slate-800 mb-6 shadow-2xl">
            <Upload size={48} className="text-cyan-400" />
          </div>
          <h3 className="text-2xl font-bold mb-2">Drag & Drop PDF or Image</h3>
          <p className="text-slate-500 mb-8">Support PDF, JPG, PNG (Max 100MB)</p>
          
          <label className="px-8 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold cursor-pointer transition-all shadow-lg shadow-cyan-900/20">
            Browse Files
            <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileSelect} />
          </label>
        </div>
      </div>

      {/* Right: Project Settings (The "Canva-like" Sidebar) */}
      <div className="w-80 bg-slate-900 border-l border-slate-800 p-6 flex flex-col overflow-y-auto">
        <h2 className="text-lg font-bold mb-6 flex items-center gap-2">
          <Settings2 className="text-cyan-400" /> Project Settings
        </h2>

        {/* Mode Selection */}
        <div className="mb-8">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 block">Translation Mode</label>
          <div className="grid grid-cols-1 gap-3">
            <button 
              onClick={() => setTranslationMode('manga')}
              className={`p-4 rounded-xl border text-left transition-all ${
                translationMode === 'manga' 
                  ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500' 
                  : 'bg-slate-800 border-slate-700 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Sparkles size={16} className={translationMode === 'manga' ? 'text-blue-400' : 'text-slate-400'} />
                <span className={`font-bold ${translationMode === 'manga' ? 'text-blue-100' : 'text-slate-300'}`}>Manga Style</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Optimized for SFX, vertical text, and informal speech.
              </p>
            </button>

            <button 
              onClick={() => setTranslationMode('official')}
              className={`p-4 rounded-xl border text-left transition-all ${
                translationMode === 'official' 
                  ? 'bg-emerald-600/20 border-emerald-500 ring-1 ring-emerald-500' 
                  : 'bg-slate-800 border-slate-700 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <ScrollText size={16} className={translationMode === 'official' ? 'text-emerald-400' : 'text-slate-400'} />
                <span className={`font-bold ${translationMode === 'official' ? 'text-emerald-100' : 'text-slate-300'}`}>Official Doc</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Formal tone, precise layout preservation.
              </p>
            </button>
          </div>
        </div>

        {/* Safety Settings */}
        <div className="mb-8">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4 block flex items-center gap-2">
            <Shield size={12} /> Safety Filters
          </label>
          
          <div className="space-y-6">
            {Object.entries(safetySettings).map(([key, value]) => (
              <div key={key}>
                <div className="flex justify-between mb-2">
                  <span className="text-xs capitalize text-slate-300">{key}</span>
                  <span className="text-[10px] px-2 py-0.5 bg-slate-800 rounded text-slate-400 uppercase">{value}</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="3" 
                  step="1"
                  value={['off', 'low', 'medium', 'high'].indexOf(value)}
                  onChange={(e) => {
                    const levels = ['off', 'low', 'medium', 'high'] as const;
                    updateSafetySettings({ [key]: levels[parseInt(e.target.value)] });
                  }}
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
                <div className="flex justify-between text-[9px] text-slate-600 mt-1 font-mono">
                  <span>OFF</span>
                  <span>HIGH</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-auto p-4 bg-slate-800/50 rounded-xl border border-slate-700 text-xs text-slate-400">
          <p>💡 <strong>Tip:</strong> You can change these settings later in the workspace sidebar.</p>
        </div>
      </div>
    </div>
  );
};
