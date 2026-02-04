import React, { useState, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useOCRTextLayerStore, OCR_PROFILES } from '../../stores/useOCRTextLayerStore';
import { 
  FileText, 
  Settings, 
  ChevronDown, 
  ChevronUp,
  Languages,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { OCRTextLayerPanel } from '../OCR/OCRTextLayerPanel';

interface RightSidebarProps {
  isAiProcessing?: boolean;
  onAiTranslate?: () => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({ 
  isAiProcessing = false, 
  onAiTranslate 
}) => {
  const { 
    fileType,
    targetLanguage,
    setTargetLanguage,
    translationMode,
    setTranslationMode
  } = useProjectStore();
  
  const { options, setOptions, isProcessing } = useOCRTextLayerStore();
  const currentProfile = OCR_PROFILES.find(p => p.dpi === options.dpi) || OCR_PROFILES[2];
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <aside className="w-80 bg-slate-800 border-l border-slate-700 flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-slate-700 bg-slate-900/30 flex items-center justify-between">
        <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
          <FileText size={14} />
          OCR Text Layer
        </h3>
        
        {/* Settings Toggle */}
        <button 
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className={`p-1.5 rounded-lg transition-colors ${
            isSettingsOpen ? 'bg-cyan-600 text-white' : 'hover:bg-slate-700 text-slate-400'
          }`}
          title="Settings"
        >
          <Settings size={14} />
        </button>
      </div>

      {/* Collapsible Settings Panel */}
      {isSettingsOpen && (
        <div className="border-b border-slate-700 bg-slate-900/50 p-3 space-y-4">
          {/* Translate To */}
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-2">
              Translate To
            </label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="th">Thai (ไทย)</option>
              <option value="en">English</option>
              <option value="ja">Japanese (日本語)</option>
              <option value="ko">Korean (한국어)</option>
              <option value="zh">Chinese (中文)</option>
            </select>
          </div>

          {/* Translation Context */}
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-2">
              Translation Context
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => setTranslationMode('manga')}
                className={`text-xs p-2 rounded-lg border flex items-center justify-center gap-1 transition-all ${
                  translationMode === 'manga' 
                    ? 'bg-blue-600 border-blue-400 text-white' 
                    : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                }`}
              >
                <Sparkles size={12} />
                Manga
              </button>
              <button 
                onClick={() => setTranslationMode('official')}
                className={`text-xs p-2 rounded-lg border flex items-center justify-center gap-1 transition-all ${
                  translationMode === 'official' 
                    ? 'bg-emerald-600 border-emerald-400 text-white' 
                    : 'bg-slate-700 border-slate-600 text-slate-300 hover:bg-slate-600'
                }`}
              >
                <FileText size={12} />
                Official
              </button>
            </div>
          </div>

          {/* Quality Profile */}
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-2">
              OCR Quality Profile
            </label>
            <div className="grid grid-cols-3 gap-1">
              {OCR_PROFILES.map(profile => (
                <button 
                  key={profile.id}
                  onClick={() => setOptions({ dpi: profile.dpi, profile: profile.id as any })}
                  disabled={isProcessing}
                  className={`text-[10px] p-1.5 rounded border transition-all ${
                    currentProfile.id === profile.id 
                      ? 'bg-cyan-600 border-cyan-400 text-white' 
                      : 'bg-slate-700 border-slate-600 text-slate-400 hover:bg-slate-600'
                  } disabled:opacity-50`}
                  title={profile.description}
                >
                  {profile.name}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-slate-500 mt-1 italic">
              DPI: {options.dpi} • {currentProfile.description}
            </p>
          </div>

          {/* AI Translate Button */}
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block mb-2">
              Gemini Intelligence
            </label>
            <button 
              onClick={onAiTranslate}
              disabled={isAiProcessing}
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg"
            >
              {isAiProcessing ? (
                <>
                  <RefreshCw className="animate-spin" size={14} />
                  Processing...
                </>
              ) : (
                <>
                  <Languages size={14} />
                  ✨ AI Translate Page
                </>
              )}
            </button>
            <p className="text-[9px] text-slate-500 mt-1.5 text-center">
              Powered by Gemini 2.5 Flash
            </p>
          </div>
        </div>
      )}

      {/* OCR Text Layer Panel */}
      <div className="flex-1 overflow-y-auto">
        <OCRTextLayerPanel />
      </div>
    </aside>
  );
};
