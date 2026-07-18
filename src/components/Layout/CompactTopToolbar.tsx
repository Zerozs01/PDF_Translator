import React, { useState, useRef, useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useOCRTextLayerStore, SUPPORTED_LANGUAGES } from '../../stores/useOCRTextLayerStore';
import { 
  Languages, 
  Sparkles, 
  RefreshCw, 
  Eye, 
  EyeOff, 
  ChevronDown, 
  Info, 
  FileText, 
  Layers,
  X
} from 'lucide-react';
import { OCRTextLayerPanel } from '../OCR/OCRTextLayerPanel';

const LANGUAGES_CONFIG = [
  { code: 'th', flagUrl: 'https://flagcdn.com/w20/th.png', label: 'TH', name: 'Thai (ไทย)' },
  { code: 'en', flagUrl: 'https://flagcdn.com/w20/us.png', label: 'EN', name: 'English' },
  { code: 'ja', flagUrl: 'https://flagcdn.com/w20/jp.png', label: 'JA', name: 'Japanese (日本語)' },
  { code: 'ko', flagUrl: 'https://flagcdn.com/w20/kr.png', label: 'KO', name: 'Korean (한국어)' },
  { code: 'zh', flagUrl: 'https://flagcdn.com/w20/cn.png', label: 'ZH', name: 'Chinese (中文)' },
];

interface CompactTopToolbarProps {
  isAiProcessing?: boolean;
  isOfflineProcessing?: boolean;
  onAiTranslate?: () => void;
  onOfflineTranslate?: () => void;
  onAiTranslateAllPages?: () => void;
  onOfflineTranslateAllPages?: () => void;
  translationStatus?: { kind: 'info' | 'success' | 'error'; message: string } | null;
  offlineEngine?: 'argos' | 'm2m100';
  onOfflineEngineChange?: (engine: 'argos' | 'm2m100') => void;
}

export const CompactTopToolbar: React.FC<CompactTopToolbarProps> = React.memo(({
  isAiProcessing = false,
  isOfflineProcessing = false,
  onAiTranslate,
  onOfflineTranslate,
  onAiTranslateAllPages,
  onOfflineTranslateAllPages,
  translationStatus = null,
  offlineEngine = 'argos',
  onOfflineEngineChange,
}) => {
  const { 
    targetLanguage,
    setTargetLanguage,
  } = useProjectStore();
  const {
    options,
    setOptions,
    isProcessing,
    showDebugOverlay,
    setShowDebugOverlay,
  } = useOCRTextLayerStore();

  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const [isOcrLangsOpen, setIsOcrLangsOpen] = useState(false);
  const [isTextLayerOpen, setIsTextLayerOpen] = useState(false);
  const [isTranslateInfoOpen, setIsTranslateInfoOpen] = useState(false);
  
  const ocrLangsRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  
  const isTranslateBusy = isAiProcessing || isOfflineProcessing;
  const activeLangConfig = LANGUAGES_CONFIG.find(l => l.code === targetLanguage) || LANGUAGES_CONFIG[0];

  // Close dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ocrLangsRef.current && !ocrLangsRef.current.contains(event.target as Node)) {
        setIsOcrLangsOpen(false);
      }
      if (textLayerRef.current && !textLayerRef.current.contains(event.target as Node)) {
        setIsTextLayerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const translationStatusClass = translationStatus?.kind === 'success'
    ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-100'
    : translationStatus?.kind === 'error'
      ? 'border-rose-500/40 bg-rose-500/12 text-rose-100'
      : 'border-cyan-500/35 bg-cyan-500/12 text-cyan-100';

  return (
    <div className="bg-slate-950/80 border-b border-white/10 backdrop-blur-md px-3 py-2 flex flex-wrap gap-2.5 items-center justify-between z-30 relative select-none">
      
      {/* LEFT SECTION: Languages & OCR Settings */}
      <div className="flex items-center gap-2 flex-wrap">
        
        {/* Target Translation Lang Selector */}
        <div className="relative">
          <button
            onClick={() => setIsLangDropdownOpen(!isLangDropdownOpen)}
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 h-7 rounded bg-slate-900/90 border border-white/15 text-[11px] font-bold text-white transition-colors hover:border-white/30"
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
              <div className="fixed inset-0 z-40" onClick={() => setIsLangDropdownOpen(false)} />
              <div className="absolute left-0 mt-1.5 w-36 bg-slate-950 border border-white/15 rounded-lg shadow-2xl z-50 py-1 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-100">
                {LANGUAGES_CONFIG.map((lang) => {
                  const isOcrThai = options.language.split('+').some(l => l.trim().toLowerCase() === 'tha' || l.trim().toLowerCase() === 'thai');
                  const isDisabled = lang.code === 'th' && isOcrThai;
                  return (
                    <button
                      key={lang.code}
                      disabled={isDisabled}
                      onClick={() => {
                        setTargetLanguage(lang.code);
                        setIsLangDropdownOpen(false);
                      }}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors ${
                        isDisabled 
                          ? 'opacity-40 cursor-not-allowed text-slate-500' 
                          : 'hover:bg-white/10 text-slate-200'
                      } ${
                        targetLanguage === lang.code && !isDisabled ? 'text-[#2B9BFF] font-semibold bg-white/5' : ''
                      }`}
                      title={isDisabled ? 'Cannot translate Thai to Thai' : `Switch to ${lang.name}`}
                    >
                      <img 
                        src={lang.flagUrl} 
                        alt={lang.label} 
                        className="w-4 h-2.5 object-cover rounded-[1px] opacity-90 shrink-0" 
                      />
                      <span>{lang.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* OCR Languages Selector Dropdown */}
        <div className="relative" ref={ocrLangsRef}>
          <button
            onClick={() => setIsOcrLangsOpen(!isOcrLangsOpen)}
            type="button"
            className="flex items-center gap-1.5 px-2 py-1 h-7 rounded bg-slate-900/90 border border-white/15 text-[11px] font-bold text-white transition-colors hover:border-white/30"
            title="Configure OCR source languages"
          >
            <Languages size={12} className="text-slate-400" />
            <span className="text-[10px]">OCR Source</span>
            <ChevronDown size={10} className={`transition-transform duration-200 ${isOcrLangsOpen ? 'rotate-180' : ''}`} />
          </button>

          {isOcrLangsOpen && (
            <div className="absolute left-0 mt-1.5 w-44 bg-slate-950 border border-white/15 rounded-lg shadow-2xl z-50 p-2.5 animate-in fade-in slide-in-from-top-1 duration-100">
              <span className="text-[9px] uppercase font-bold text-slate-500 tracking-wider mb-1.5 block">OCR Languages</span>
              <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-1.5">
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
                      <label key={lang.code} className="flex items-center gap-2 text-xs text-slate-100 cursor-pointer min-w-0 py-0.5" style={{ contentVisibility: 'auto' }}>
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

        {/* Offline Engine Select */}
        <div className="flex items-center gap-1.5 bg-slate-900/40 px-2 py-0.5 h-7 rounded border border-white/5">
          <span className="text-[8px] uppercase font-bold text-slate-400">Offline:</span>
          <select
            value={offlineEngine}
            onChange={(e) => onOfflineEngineChange?.(e.target.value as 'argos' | 'm2m100')}
            className="rounded border border-white/12 bg-slate-950 px-1 py-0.5 text-[10px] text-slate-200 focus:outline-none focus:border-[#2B9BFF]/60 cursor-pointer"
          >
            <option value="argos">Argos</option>
            <option value="m2m100">M2M100</option>
          </select>
        </div>

        {/* OCR Debug Borders Toggle */}
        <button
          onClick={() => setShowDebugOverlay(!showDebugOverlay)}
          type="button"
          className={`flex items-center justify-center h-7 w-7 rounded-lg transition-colors border ${
            showDebugOverlay
              ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] border-blue-500/50 text-white'
              : 'hover:bg-white/10 text-slate-400 border-white/10 bg-slate-900/30'
          }`}
          title={showDebugOverlay ? 'Hide OCR borders' : 'Show OCR borders'}
        >
          {showDebugOverlay ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>

      {/* RIGHT SECTION: Translation triggers & Text Layer list */}
      <div className="flex items-center gap-2">
        
        {/* OCR Text Layer Collapsible Popover */}
        <div className="relative" ref={textLayerRef}>
          <button
            onClick={() => setIsTextLayerOpen(!isTextLayerOpen)}
            type="button"
            className={`flex items-center gap-1.5 px-2 py-1 h-7 rounded transition-colors border ${
              isTextLayerOpen
                ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] border-blue-500/50 text-white'
                : 'bg-slate-900/90 hover:bg-slate-900 border-white/15 text-slate-200'
            }`}
            title="Toggle OCR Text Layer details panel"
          >
            <Layers size={12} />
            <span className="text-[10px] font-bold">Text Layer</span>
            <ChevronDown size={10} className={`transition-transform duration-200 ${isTextLayerOpen ? 'rotate-180' : ''}`} />
          </button>

          {isTextLayerOpen && (
            <div className="absolute right-0 mt-1.5 w-[330px] max-h-[360px] bg-slate-950 border border-white/15 rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden p-2 animate-in fade-in slide-in-from-top-1 duration-100">
              <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-1 px-1.5">
                <span className="text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                  <FileText size={12} className="text-blue-400" />
                  OCR Text Layer List
                </span>
                <button 
                  onClick={() => setIsTextLayerOpen(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden min-h-0">
                <OCRTextLayerPanel />
              </div>
            </div>
          )}
        </div>

        {/* Translation Status Info */}
        {translationStatus && (
          <button
            type="button"
            onClick={() => setIsTranslateInfoOpen(!isTranslateInfoOpen)}
            className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-colors shrink-0 ${
              isTranslateInfoOpen
                ? 'border-cyan-300/60 bg-cyan-500/18 text-cyan-100'
                : 'border-white/12 bg-slate-900/60 text-slate-400 hover:border-white/25 hover:text-white'
            }`}
            title="View translation status/errors"
          >
            <Info size={12} />
          </button>
        )}

        {/* Translate Triggers */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={onOfflineTranslate}
            disabled={isTranslateBusy}
            className="bg-[#8BC3E5] hover:brightness-105 hover:shadow-[0_3px_12px_rgba(139,195,229,0.35)] shadow-[0_2px_4px_rgba(0,0,0,0.15)] disabled:opacity-50 px-2.5 h-7 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all text-slate-900"
            title="Use local Argos model on current page"
          >
            {isOfflineProcessing ? (
              <RefreshCw className="animate-spin" size={10} />
            ) : (
              <Languages size={10} />
            )}
            Offline
          </button>

          <button
            onClick={onAiTranslate}
            disabled={isTranslateBusy}
            className="bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] hover:brightness-105 hover:shadow-[0_3px_12px_rgba(43,155,255,0.45)] shadow-[0_2px_4px_rgba(0,0,0,0.2)] disabled:opacity-50 px-2.5 h-7 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all text-white"
            title="Use Gemini cloud model on current page"
          >
            {isAiProcessing ? (
              <RefreshCw className="animate-spin" size={10} />
            ) : (
              <Sparkles size={10} />
            )}
            AI
          </button>
        </div>
      </div>

      {/* Floating translation status message popup */}
      {isTranslateInfoOpen && translationStatus && (
        <div className={`absolute top-full right-3 mt-2 w-72 rounded-lg border p-2.5 text-[11px] shadow-2xl z-50 animate-in fade-in duration-150 ${translationStatusClass}`}>
          <div className="flex justify-between items-start gap-1">
            <span className="flex-1">{translationStatus.message}</span>
            <button 
              onClick={() => setIsTranslateInfoOpen(false)}
              className="text-slate-300 hover:text-white shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

CompactTopToolbar.displayName = 'CompactTopToolbar';
