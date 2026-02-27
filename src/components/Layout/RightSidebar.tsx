import React, { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useOCRTextLayerStore, OCR_PROFILES } from '../../stores/useOCRTextLayerStore';
import { 
  FileText, 
  Settings, 
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
    targetLanguage,
    setTargetLanguage,
    translationMode,
    setTranslationMode
  } = useProjectStore();
  
  const { options, setOptions, isProcessing } = useOCRTextLayerStore();
  const currentProfile = OCR_PROFILES.find(p => p.dpi === options.dpi) || OCR_PROFILES[2];
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <aside className="w-80 bg-slate-950/60 border-l border-white/10 backdrop-blur-xl flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-white/10 bg-slate-950/35 flex items-center justify-between">
        <h3 className="text-xs font-bold text-[#5CC6F2] uppercase tracking-wider flex items-center gap-2">
          <FileText size={14} />
          OCR Text Layer
        </h3>
        
        {/* Settings Toggle */}
        <button 
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className={`p-1.5 rounded-lg transition-colors ${
            isSettingsOpen
              ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white'
              : 'hover:bg-white/10 text-slate-400'
          }`}
          title="Settings"
        >
          <Settings size={14} />
        </button>
      </div>

      {/* Collapsible Settings Panel */}
      {isSettingsOpen && (
        <div className="border-b border-white/10 bg-slate-950/45 p-3 space-y-4">
          {/* Translate To */}
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400/85 tracking-wider block mb-2">
              Translate To
            </label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="w-full bg-slate-900/70 border border-white/15 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#2B9BFF]/60"
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
            <label className="text-[10px] uppercase font-bold text-slate-400/85 tracking-wider block mb-2">
              Translation Context
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => setTranslationMode('manga')}
                className={`text-xs p-2 rounded-lg border flex items-center justify-center gap-1 transition-all ${
                  translationMode === 'manga' 
                    ? 'bg-gradient-to-r from-[#2B9BFF]/30 to-[#5CC6F2]/20 border-[#2B9BFF]/60 text-[#d7edff] shadow-[0_6px_16px_rgba(43,155,255,0.2)]'
                    : 'bg-slate-900/60 border-white/12 text-slate-300 hover:bg-slate-900 hover:border-white/25'
                }`}
              >
                <Sparkles size={12} />
                Manga
              </button>
              <button 
                onClick={() => setTranslationMode('official')}
                className={`text-xs p-2 rounded-lg border flex items-center justify-center gap-1 transition-all ${
                  translationMode === 'official' 
                    ? 'bg-gradient-to-r from-[#FF8705]/28 via-[#FFB45C]/20 to-[#FF7E67]/20 border-[#FF9A3D]/55 text-[#fff0da] shadow-[0_8px_18px_rgba(255,135,5,0.25)]'
                    : 'bg-slate-900/60 border-white/12 text-slate-300 hover:bg-slate-900 hover:border-white/25'
                }`}
              >
                <FileText size={12} />
                Official
              </button>
            </div>
          </div>

          {/* Quality Profile */}
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400/85 tracking-wider block mb-2">
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
                      ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] border-[#5CC6F2]/70 text-white'
                      : 'bg-slate-900/60 border-white/12 text-slate-400 hover:bg-slate-900 hover:border-white/25'
                  } disabled:opacity-50`}
                  title={profile.description}
                >
                  {profile.name}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-slate-500 mt-1">
              DPI: {options.dpi} • {currentProfile.description}
            </p>
          </div>

          {/* AI Translate Button */}
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400/85 tracking-wider block mb-2">
              Gemini Intelligence
            </label>
            <button 
              onClick={onAiTranslate}
              disabled={isAiProcessing}
              className="w-full bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] hover:brightness-110 disabled:opacity-50 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-[0_10px_24px_rgba(43,155,255,0.35)]"
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
