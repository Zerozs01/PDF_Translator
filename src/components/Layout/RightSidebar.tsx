import React, { useEffect, useState } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import {
  OVERLAY_FONT_OPTIONS,
  OverlayFontPreset,
} from '../../constants/overlayFonts';
import { SUPPORTED_LANGUAGES, useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { 
  FileText, 
  Eye,
  EyeOff,
  Languages,
  Sparkles,
  RefreshCw,
  Info,
  Minus,
  Plus,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { OCRTextLayerPanel } from '../OCR/OCRTextLayerPanel';

const OCR_TEXT_LAYER_OPEN_STORAGE_KEY = 'pdf_translator.ocr_text_layer_open';
const OCR_LANGUAGES_SECTION_OPEN_STORAGE_KEY = 'pdf_translator.ocr_languages_section_open';

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

const readPersistedLanguagesSectionOpen = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    const raw = String(window.localStorage.getItem(OCR_LANGUAGES_SECTION_OPEN_STORAGE_KEY) || '').trim().toLowerCase();
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return true;
  } catch {
    return true;
  }
};

const persistLanguagesSectionOpen = (open: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(OCR_LANGUAGES_SECTION_OPEN_STORAGE_KEY, open ? '1' : '0');
  } catch {
    // Ignore local storage failures.
  }
};

const LANGUAGES_CONFIG = [
  { code: 'th', flagUrl: 'https://flagcdn.com/w20/th.png', label: 'TH', name: 'Thai (ไทย)' },
  { code: 'en', flagUrl: 'https://flagcdn.com/w20/us.png', label: 'EN', name: 'English' },
  { code: 'ja', flagUrl: 'https://flagcdn.com/w20/jp.png', label: 'JA', name: 'Japanese (日本語)' },
  { code: 'ko', flagUrl: 'https://flagcdn.com/w20/kr.png', label: 'KO', name: 'Korean (한국어)' },
  { code: 'zh', flagUrl: 'https://flagcdn.com/w20/cn.png', label: 'ZH', name: 'Chinese (中文)' },
];

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
    options,
    setOptions,
    isProcessing,
    showDebugOverlay,
    setShowDebugOverlay,
  } = useOCRTextLayerStore();

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(() => readPersistedPanelOpen());
  const [isLanguagesSectionOpen, setIsLanguagesSectionOpen] = useState<boolean>(() => readPersistedLanguagesSectionOpen());
  const [isTranslateInfoOpen, setIsTranslateInfoOpen] = useState(false);
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const isTranslateBusy = isAiProcessing || isOfflineProcessing;
  const isThaiTargetLanguage = targetLanguage === 'th';
  const overlayFontScalePercent = Math.round(overlayFontSizeScale * 100);

  const activeLangConfig = LANGUAGES_CONFIG.find(l => l.code === targetLanguage) || LANGUAGES_CONFIG[0];

  const adjustOverlayFontScale = (delta: number) => {
    const next = Math.round((overlayFontSizeScale + delta) * 100) / 100;
    setOverlayFontSizeScale(next);
  };

  useEffect(() => {
    persistPanelOpen(isSettingsOpen);
  }, [isSettingsOpen]);

  useEffect(() => {
    persistLanguagesSectionOpen(isLanguagesSectionOpen);
  }, [isLanguagesSectionOpen]);

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
      <div className="border-b border-white/10 bg-slate-950/55">
        <div className="flex items-center justify-between gap-3 border-y border-black/55 bg-[linear-gradient(124deg,rgba(122,28,210,0.34)_0%,rgba(219,39,119,0.24)_52%,rgba(17,24,39,0.92)_100%)] px-3 py-2">
          <div className="min-w-0 flex-1">
            <label className="flex items-center gap-2 text-xs font-semibold text-white">
              <Languages size={12} />
              OCR Languages
            </label>
          </div>

          <div className="min-w-0 max-w-[56%] truncate text-right text-[11px] text-slate-200/85">
            {options.language.split('+').filter(Boolean).map((code) => {
              const found = SUPPORTED_LANGUAGES.find((language) => language.code === code);
              return found ? found.name : code;
            }).join(' + ') || 'English'}
          </div>

          <button
            type="button"
            onClick={() => setIsLanguagesSectionOpen((current) => !current)}
            className="flex h-5 w-6 items-center justify-center rounded-md border border-fuchsia-200/45 bg-slate-950/60 text-fuchsia-100 transition-colors hover:border-fuchsia-100/60"
            title={isLanguagesSectionOpen ? 'Collapse OCR languages' : 'Expand OCR languages'}
            aria-label={isLanguagesSectionOpen ? 'Collapse OCR languages' : 'Expand OCR languages'}
          >
            {isLanguagesSectionOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        </div>

        {isLanguagesSectionOpen && (
          <div className="px-3 py-2">
            <div className="h-[66px] overflow-y-auto custom-scrollbar border border-white/10 rounded-lg bg-slate-950/65 px-2.5 py-1 grid grid-cols-2 gap-x-3 gap-y-1">
              {(() => {
                const sortedLanguages = [
                  ...SUPPORTED_LANGUAGES.filter(lang => lang.code === 'eng'),
                  ...SUPPORTED_LANGUAGES.filter(lang => lang.code === 'kor'),
                  ...SUPPORTED_LANGUAGES.filter(lang => lang.code === 'tha'),
                  ...SUPPORTED_LANGUAGES.filter(lang => lang.code === 'spa'),
                  ...SUPPORTED_LANGUAGES.filter(lang => !['eng', 'kor', 'tha', 'spa'].includes(lang.code))
                ];
                return sortedLanguages.map((lang) => {
                  const selected = options.language.split('+').filter(Boolean).includes(lang.code);
                  return (
                    <label key={lang.code} className="flex items-center gap-2 text-xs text-slate-100 cursor-pointer min-w-0">
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={isProcessing}
                        onChange={() => {
                          const current = new Set(options.language.split('+').filter(Boolean));
                          if (current.has(lang.code)) {
                            current.delete(lang.code);
                          } else {
                            current.add(lang.code);
                          }
                          if (current.size === 0) {
                            current.add('eng');
                          }
                          const ordered = sortedLanguages
                            .map((language) => language.code)
                            .filter((code) => current.has(code));
                          setOptions({ language: ordered.join('+') });
                        }}
                        className="accent-[#2B9BFF]"
                      />
                      <span className="truncate">{lang.name}</span>
                    </label>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Header */}
      <div className="relative z-30 p-2 border-b border-white/10 flex items-center justify-between">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(94deg,rgba(18,44,94,0.96)_0%,rgba(27,76,156,0.82)_46%,rgba(92,66,175,0.8)_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.1)_0%,rgba(0,0,0,0.05)_52%,rgba(0,0,0,0.1)_100%)]" />
        <h3 className="relative z-10 text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <FileText size={14} />
          OCR Text Layer
        </h3>
        
        <div className="relative z-10 flex items-center gap-1.5">
          {/* Custom Language Selector */}
          <div className="relative">
            <button
              onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
              type="button"
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900/80 border border-white/15 text-[11px] font-bold text-white transition-colors hover:border-white/30"
              title="Select translation target language"
            >
              <img 
                src={activeLangConfig.flagUrl} 
                alt={activeLangConfig.label} 
                className="w-4 h-2.5 object-cover rounded-[1px] opacity-90 shrink-0" 
              />
              <span className="font-mono text-[10px]">{activeLangConfig.label}</span>
              <ChevronDown size={10} className={`transition-transform duration-200 ${isLangDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isLangDropdownOpen && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setIsLangDropdownOpen(false)}
                />
                <div className="absolute right-0 mt-1.5 w-36 bg-slate-950 border border-white/15 rounded-lg shadow-2xl z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100">
                  {LANGUAGES_CONFIG.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => {
                        setTargetLanguage(lang.code);
                        setIsLangDropdownOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-white/10 ${
                        targetLanguage === lang.code ? 'text-[#2B9BFF] font-semibold bg-white/5' : 'text-slate-200'
                      }`}
                    >
                      <img 
                        src={lang.flagUrl} 
                        alt={lang.label} 
                        className="w-4 h-2.5 object-cover rounded-[1px] opacity-90 shrink-0" 
                      />
                      <span>{lang.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

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

          {/* OCR Text Layer Toggle */}
          <button 
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            type="button"
            className={`p-1.5 rounded-lg transition-colors ${
              isSettingsOpen
                ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white'
                : 'hover:bg-white/10 text-slate-400'
            }`}
            title={isSettingsOpen ? 'Collapse OCR text layer settings' : 'Expand OCR text layer settings'}
          >
            {isSettingsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>

      {/* Collapsible Settings Panel */}
      {isSettingsOpen && (
        <div className="border-b border-white/10 bg-slate-950/45 p-2 space-y-1.5">
          {/* Translate To + Actions */}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-1.5">
              <label className="text-[8px] uppercase font-bold text-slate-400/85 tracking-wider block shrink-0">
                Translate To / Actions
              </label>

              <select
                value={overlayFontPreset}
                onChange={(e) => setOverlayFontPreset(e.target.value as OverlayFontPreset)}
                disabled={!isThaiTargetLanguage}
                className={`min-w-0 max-w-[125px] rounded border border-white/12 bg-slate-950 px-2 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:border-[#2B9BFF]/60 ${!isThaiTargetLanguage ? 'cursor-not-allowed opacity-45' : ''}`}
                aria-label="Overlay font preset"
                title={isThaiTargetLanguage ? 'Overlay font preset' : 'Overlay font works when target language is Thai'}
              >
                {OVERLAY_FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => setIsTranslateInfoOpen((current) => !current)}
                className={`flex h-5 w-5 items-center justify-center rounded-full border transition-colors shrink-0 ${
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
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={onOfflineTranslate}
                disabled={isTranslateBusy}
                className="bg-[#8BC3E5] hover:brightness-105 hover:shadow-[0_3px_12px_rgba(139,195,229,0.48)] shadow-[0_2px_4px_rgba(0,0,0,0.15)] disabled:opacity-50 py-1.5 rounded-md text-[10px] font-bold flex items-center justify-center gap-1 transition-all text-slate-900"
                title="Use local Argos model on current page"
              >
                {isOfflineProcessing ? (
                  <RefreshCw className="animate-spin" size={11} />
                ) : (
                  <Languages size={11} />
                )}
                Offline
              </button>

              <button
                onClick={onAiTranslate}
                disabled={isTranslateBusy}
                className="bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] hover:brightness-105 hover:shadow-[0_3px_12px_rgba(43,155,255,0.58)] shadow-[0_2px_4px_rgba(0,0,0,0.2)] disabled:opacity-50 py-1.5 rounded-md text-[10px] font-bold flex items-center justify-center gap-1 transition-all"
                title="Use Gemini cloud model on current page"
              >
                {isAiProcessing ? (
                  <RefreshCw className="animate-spin" size={11} />
                ) : (
                  <Sparkles size={11} />
                )}
                AI
              </button>
            </div>

            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={onOfflineTranslateAllPages}
                disabled={isTranslateBusy}
                className="rounded-md border border-[#8BC3E5]/55 bg-[#8BC3E5]/18 px-2 py-1 text-[9.5px] font-semibold text-[#8BC3E5] transition-all hover:bg-[#8BC3E5]/28 disabled:cursor-not-allowed disabled:opacity-50"
                title="Run offline translation for all pages"
              >
                Offline All Pages
              </button>
              <button
                type="button"
                onClick={onAiTranslateAllPages}
                disabled={isTranslateBusy}
                className="rounded-md border border-cyan-300/65 bg-cyan-500/18 px-2 py-1 text-[9.5px] font-semibold text-cyan-100 transition-all hover:bg-cyan-500/28 disabled:cursor-not-allowed disabled:opacity-50"
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

        </div>
      )}

      {/* OCR Text Layer Panel */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <OCRTextLayerPanel />
      </div>
    </aside>
  );
};
