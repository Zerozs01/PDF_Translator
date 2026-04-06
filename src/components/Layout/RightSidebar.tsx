import React, { useEffect, useState } from 'react';
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
  RefreshCw,
  Info,
  Minus,
  Plus,
} from 'lucide-react';
import { OCRTextLayerPanel } from '../OCR/OCRTextLayerPanel';

const OCR_TEXT_LAYER_OPEN_STORAGE_KEY = 'pdf_translator.ocr_text_layer_open';

const readPersistedPanelOpen = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const raw = String(window.localStorage.getItem(OCR_TEXT_LAYER_OPEN_STORAGE_KEY) || '').trim().toLowerCase();
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return false;
  } catch {
    return false;
  }
};

const persistPanelOpen = (open: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OCR_TEXT_LAYER_OPEN_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // Ignore local storage failures.
  }
};

interface RightSidebarProps {
  isAiProcessing?: boolean;
  isOfflineProcessing?: boolean;
  onAiTranslate?: () => void;
  onOfflineTranslate?: () => void;
  onAiTranslateAllPages?: () => void;
  onOfflineTranslateAllPages?: () => void;
  translationStatus?: { kind: 'info' | 'success' | 'error'; message: string } | null;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({ 
  isAiProcessing = false, 
  isOfflineProcessing = false,
  onAiTranslate,
  onOfflineTranslate,
  onAiTranslateAllPages,
  onOfflineTranslateAllPages,
  translationStatus = null,
}) => {
  const { 
    targetLanguage,
    setTargetLanguage,
    overlayFontPreset,
    setOverlayFontPreset,
    overlayFontSizeScale,
    setOverlayFontSizeScale,
  } = useProjectStore();
  const {
    showDebugOverlay,
    setShowDebugOverlay,
  } = useOCRTextLayerStore();

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(() => readPersistedPanelOpen());
  const [isTranslateInfoOpen, setIsTranslateInfoOpen] = useState(false);
  const isTranslateBusy = isAiProcessing || isOfflineProcessing;
  const isThaiTargetLanguage = targetLanguage === 'th';
  const overlayFontScalePercent = Math.round(overlayFontSizeScale * 100);

  const adjustOverlayFontScale = (delta: number) => {
    const next = Math.round((overlayFontSizeScale + delta) * 100) / 100;
    setOverlayFontSizeScale(next);
  };

  useEffect(() => {
    persistPanelOpen(isSettingsOpen);
  }, [isSettingsOpen]);

  const translationStatusClass = translationStatus?.kind === 'success'
    ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-100'
    : translationStatus?.kind === 'error'
      ? 'border-rose-500/40 bg-rose-500/12 text-rose-100'
      : 'border-cyan-500/35 bg-cyan-500/12 text-cyan-100';
  const translationInfoClass = translationStatus
    ? translationStatusClass
    : 'border-white/12 bg-slate-900/60 text-slate-300';

  return (
    <aside className="w-80 bg-slate-950/60 border-l border-white/10 backdrop-blur-xl flex flex-col h-full shrink-0">
      {/* Header */}
      <div className="relative p-2 border-b border-white/10 flex items-center justify-between overflow-hidden">
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
        <div className="border-b border-white/10 bg-slate-950/45 p-2.5 space-y-2">
          {/* Translate To + Actions */}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-[8px] uppercase font-bold text-slate-400/85 tracking-wider block">
                Translate To / Actions
              </label>
              <button
                type="button"
                onClick={() => setIsTranslateInfoOpen((current) => !current)}
                className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                  isTranslateInfoOpen
                    ? 'border-cyan-300/60 bg-cyan-500/18 text-cyan-100'
                    : 'border-white/12 bg-slate-900/60 text-slate-400 hover:border-white/25 hover:text-white'
                }`}
                title="Open translate info"
                aria-label="Open translate info"
              >
                <Info size={11} />
              </button>
            </div>
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
                title="Use local Argos model on current page"
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
                title="Use Gemini cloud model on current page"
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
                onClick={onOfflineTranslateAllPages}
                disabled={isTranslateBusy}
                className="rounded-lg border border-emerald-400/55 bg-emerald-500/18 px-2 py-1.5 text-[10px] font-semibold text-emerald-100 transition-all hover:bg-emerald-500/28 disabled:cursor-not-allowed disabled:opacity-50"
                title="Run offline translation for all pages"
              >
                Offline All Pages
              </button>
              <button
                type="button"
                onClick={onAiTranslateAllPages}
                disabled={isTranslateBusy}
                className="rounded-lg border border-cyan-300/65 bg-cyan-500/18 px-2 py-1.5 text-[10px] font-semibold text-cyan-100 transition-all hover:bg-cyan-500/28 disabled:cursor-not-allowed disabled:opacity-50"
                title="Run AI translation for all pages"
              >
                AI All Pages
              </button>
            </div>

            {isTranslateInfoOpen && (
              <div className={`mt-2 rounded-lg border px-2.5 py-2 text-[11px] ${translationInfoClass}`}>
                {translationStatus?.message || 'No translation info yet.'}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-white/12 bg-slate-900/55 p-2.5">
            <div className="flex items-center gap-2">
              <select
                value={overlayFontPreset}
                onChange={(e) => setOverlayFontPreset(e.target.value as OverlayFontPreset)}
                disabled={!isThaiTargetLanguage}
                className={`min-w-0 flex-1 rounded-md border border-white/12 bg-slate-950/85 px-2 py-1.5 text-[11px] text-slate-100 focus:outline-none focus:border-[#2B9BFF]/60 ${!isThaiTargetLanguage ? 'cursor-not-allowed opacity-60' : ''}`}
                aria-label="Overlay font preset"
                title={isThaiTargetLanguage ? 'Overlay font preset' : 'Overlay font works when target language is Thai'}
              >
                {OVERLAY_FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => adjustOverlayFontScale(-0.05)}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-white/12 bg-slate-950/80 text-slate-300 transition-colors hover:border-white/25 hover:text-white"
                  title="Decrease overlay text size"
                  aria-label="Decrease overlay text size"
                >
                  <Minus size={11} />
                </button>
                <span className="w-10 text-center text-[10px] font-semibold text-slate-300">
                  {overlayFontScalePercent}%
                </span>
                <button
                  type="button"
                  onClick={() => adjustOverlayFontScale(0.05)}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-white/12 bg-slate-950/80 text-slate-300 transition-colors hover:border-white/25 hover:text-white"
                  title="Increase overlay text size"
                  aria-label="Increase overlay text size"
                >
                  <Plus size={11} />
                </button>
              </div>
            </div>
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
