import React, { useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import {
  OVERLAY_FONT_OPTIONS,
  OverlayFontPreset,
} from '../../constants/overlayFonts';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { 
  FileText, 
  Settings, 
  Eye,
  EyeOff,
  Languages,
  Sparkles,
  Flame,
  RefreshCw,
  Compass
} from 'lucide-react';
import { OCRTextLayerPanel } from '../OCR/OCRTextLayerPanel';

export type AiExecutionMode = 'batch-document' | 'current-page';

interface RightSidebarProps {
  isAiProcessing?: boolean;
  isOfflineProcessing?: boolean;
  onAiTranslate?: () => void;
  onOfflineTranslate?: () => void;
  translationStatus?: { kind: 'info' | 'success' | 'error'; message: string } | null;
  aiExecutionMode?: AiExecutionMode;
  onAiExecutionModeChange?: (mode: AiExecutionMode) => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({ 
  isAiProcessing = false, 
  isOfflineProcessing = false,
  onAiTranslate,
  onOfflineTranslate,
  translationStatus = null,
  aiExecutionMode = 'batch-document',
  onAiExecutionModeChange,
}) => {
  const { 
    targetLanguage,
    setTargetLanguage,
    translationMode,
    setTranslationMode,
    overlayFontPreset,
    setOverlayFontPreset,
  } = useProjectStore();
  const {
    showDebugOverlay,
    setShowDebugOverlay,
  } = useOCRTextLayerStore();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const isTranslateBusy = isAiProcessing || isOfflineProcessing;
  const isThaiTargetLanguage = targetLanguage === 'th';

  const translationStatusClass = translationStatus?.kind === 'success'
    ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-100'
    : translationStatus?.kind === 'error'
      ? 'border-rose-500/40 bg-rose-500/12 text-rose-100'
      : 'border-cyan-500/35 bg-cyan-500/12 text-cyan-100';

  return (
    <aside className="w-80 bg-slate-950/60 border-l border-white/10 backdrop-blur-xl flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="relative p-3 border-b border-white/10 flex items-center justify-between overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(94deg,rgba(18,44,94,0.96)_0%,rgba(27,76,156,0.82)_46%,rgba(92,66,175,0.8)_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.1)_0%,rgba(0,0,0,0.05)_52%,rgba(0,0,0,0.1)_100%)]" />
        <h3 className="relative z-10 text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <FileText size={14} />
          OCR Text Layer
        </h3>
        
        <div className="relative z-10 flex items-center gap-1.5">
          <button
            onClick={() => setShowDebugOverlay(!showDebugOverlay)}
            type="button"
            className={`p-1.5 rounded-lg transition-colors ${
              showDebugOverlay
                ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white'
                : 'hover:bg-white/10 text-slate-400'
            }`}
            title={showDebugOverlay ? 'Hide OCR borders' : 'Show OCR borders'}
            aria-label={showDebugOverlay ? 'Hide OCR borders' : 'Show OCR borders'}
          >
            {showDebugOverlay ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>

          {/* Settings Toggle */}
          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            type="button"
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
      </div>

      {/* Collapsible Settings Panel */}
      {isSettingsOpen && (
        <div className="border-b border-white/10 bg-slate-950/45 p-3 space-y-4">
          {/* Translate To + Actions */}
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400/85 tracking-wider block mb-2">
              Translate To / Actions
            </label>
            <div className="grid grid-cols-12 gap-2">
              <select
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                aria-label="Translate target language"
                title="Translate target language"
                className="col-span-6 bg-slate-900/70 border border-white/15 rounded-lg px-2 py-2 text-xs text-white focus:outline-none focus:border-[#2B9BFF]/60"
              >
                <option value="th">Thai (ไทย)</option>
                <option value="en">English</option>
                <option value="ja">Japanese (日本語)</option>
                <option value="ko">Korean (한국어)</option>
                <option value="zh">Chinese (中文)</option>
              </select>

              <button
                onClick={onOfflineTranslate}
                disabled={isTranslateBusy}
                className="col-span-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:brightness-110 disabled:opacity-50 py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-all"
                title="Use local Argos model only (offline)"
              >
                {isOfflineProcessing ? (
                  <RefreshCw className="animate-spin" size={12} />
                ) : (
                  <Languages size={12} />
                )}
                Offline
              </button>

              <button
                onClick={onAiTranslate}
                disabled={isTranslateBusy}
                className="col-span-3 bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] hover:brightness-110 disabled:opacity-50 py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1 transition-all"
                title={aiExecutionMode === 'current-page'
                  ? 'Use Gemini cloud model on current page only (test mode)'
                  : 'Use Gemini cloud model (batch all OCR pages in one request)'}
              >
                {isAiProcessing ? (
                  <RefreshCw className="animate-spin" size={12} />
                ) : (
                  <Sparkles size={12} />
                )}
                AI
              </button>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onAiExecutionModeChange?.('batch-document')}
                className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition-all ${
                  aiExecutionMode === 'batch-document'
                    ? 'border-cyan-300/65 bg-cyan-500/18 text-cyan-100'
                    : 'border-white/12 bg-slate-900/60 text-slate-300 hover:border-white/25'
                }`}
                title="Send OCR from all cached pages in one Gemini request"
              >
                AI Batch (All Pages)
              </button>
              <button
                type="button"
                onClick={() => onAiExecutionModeChange?.('current-page')}
                className={`rounded-lg border px-2 py-1.5 text-[10px] font-semibold transition-all ${
                  aiExecutionMode === 'current-page'
                    ? 'border-amber-300/65 bg-amber-500/18 text-amber-100'
                    : 'border-white/12 bg-slate-900/60 text-slate-300 hover:border-white/25'
                }`}
                title="Translate only current page with Gemini (for quick testing)"
              >
                AI Current Page
              </button>
            </div>
          </div>

          {/* Translation Context */}
          <div>
            <label className="text-[10px] uppercase font-bold text-slate-400/85 tracking-wider block mb-2">
              Translation Context
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button 
                onClick={() => setTranslationMode('adaptive')}
                className={`text-[11px] px-2 py-1.5 rounded-lg border flex items-center justify-center gap-1 transition-all ${
                  translationMode === 'adaptive' 
                    ? 'bg-gradient-to-r from-[#22c55e]/26 via-[#14b8a6]/22 to-[#38bdf8]/18 border-[#38bdf8]/55 text-[#e8fff8] shadow-[0_8px_18px_rgba(20,184,166,0.22)]'
                    : 'bg-slate-900/60 border-white/12 text-slate-300 hover:bg-slate-900 hover:border-white/25'
                }`}
              >
                <Compass size={12} />
                Orbit
              </button>
              <button 
                onClick={() => setTranslationMode('manga')}
                className={`text-[11px] px-2 py-1.5 rounded-lg border flex items-center justify-center gap-1 transition-all ${
                  translationMode === 'manga' 
                    ? 'bg-gradient-to-r from-[#FF8705]/28 via-[#FFB45C]/20 to-[#FF7E67]/20 border-[#FF9A3D]/55 text-[#fff0da] shadow-[0_8px_18px_rgba(255,135,5,0.25)]'
                    : 'bg-slate-900/60 border-white/12 text-slate-300 hover:bg-slate-900 hover:border-white/25'
                }`}
              >
                <Sparkles size={12} />
                Manga
              </button>
              <button 
                onClick={() => setTranslationMode('manhwa')}
                className={`text-[11px] px-2 py-1.5 rounded-lg border flex items-center justify-center gap-1 transition-all ${
                  translationMode === 'manhwa' 
                    ? 'bg-gradient-to-r from-[#EC4899]/28 to-[#FB7185]/22 border-[#EC4899]/60 text-[#ffe3ef] shadow-[0_8px_18px_rgba(236,72,153,0.24)]'
                    : 'bg-slate-900/60 border-white/12 text-slate-300 hover:bg-slate-900 hover:border-white/25'
                }`}
              >
                <Flame size={12} />
                Manhwa
              </button>
              <button 
                onClick={() => setTranslationMode('official')}
                className={`text-[11px] px-2 py-1.5 rounded-lg border flex items-center justify-center gap-1 transition-all ${
                  translationMode === 'official' 
                    ? 'bg-gradient-to-r from-[#2B9BFF]/30 to-[#5CC6F2]/20 border-[#2B9BFF]/60 text-[#d7edff] shadow-[0_6px_16px_rgba(43,155,255,0.2)]'
                    : 'bg-slate-900/60 border-white/12 text-slate-300 hover:bg-slate-900 hover:border-white/25'
                }`}
              >
                <FileText size={12} />
                Official
              </button>
            </div>
          </div>

          {isThaiTargetLanguage && (
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-400/85 tracking-wider block mb-2">
                Thai Overlay Font
              </label>
              <div className="rounded-lg border border-white/12 bg-slate-900/55 p-2.5 space-y-2">
                <select
                  value={overlayFontPreset}
                  onChange={(e) => setOverlayFontPreset(e.target.value as OverlayFontPreset)}
                  className="w-full rounded-md border border-white/12 bg-slate-950/85 px-2.5 py-1.5 text-[11px] text-slate-100 focus:outline-none focus:border-[#2B9BFF]/60"
                  aria-label="Thai overlay font preset"
                >
                  {OVERLAY_FONT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {translationStatus && (
            <div className={`rounded-lg border px-2.5 py-2 text-[11px] ${translationStatusClass}`}>
              {translationStatus.message}
            </div>
          )}
        </div>
      )}

      {/* OCR Text Layer Panel */}
      <div className="flex-1 overflow-y-auto">
        <OCRTextLayerPanel />
      </div>
    </aside>
  );
};
