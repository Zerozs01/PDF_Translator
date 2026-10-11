import React from 'react';
import {
  Download,
  Settings2,
  KeyRound,
  Eye,
  EyeOff,
  Check,
  X,
  Cpu,
} from 'lucide-react';
import { SecuritySettings } from '../../Auth/SecuritySettings';
import {
  OVERLAY_FONT_OPTIONS,
  OverlayFontPreset,
} from '../../../constants/overlayFonts';
import { OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT } from '../../../services/vision/ocr-timeout';

export interface ModelDownloadStatus {
  installed: boolean;
  checking: boolean;
  downloading: boolean;
  error?: string | null;
}

export interface GpuInfoData {
  gpus: string[];
  hasDirectML: boolean;
  hasCuda: boolean;
  mode: 'CUDA' | 'DirectML' | 'CPU';
  gpuVendor: 'nvidia' | 'amd' | 'intel' | 'unknown';
}

export interface LibrarySettingsPanelProps {
  // Gemini API Key
  geminiApiKeyDraft: string;
  setGeminiApiKeyDraft: (val: string) => void;
  showGeminiApiKey: boolean;
  setShowGeminiApiKey: React.Dispatch<React.SetStateAction<boolean>>;
  saveGeminiApiKey: () => Promise<unknown>;
  clearGeminiApiKey: () => Promise<unknown>;
  isGeminiApiKeyLoaded: boolean;
  isGeminiApiKeySaving: boolean;
  hasGeminiApiKey: boolean;
  geminiApiKeySource: 'electron' | 'environment' | 'empty' | 'secure-storage' | string;
  geminiInputPlaceholder: string;
  geminiStatusClass: string;
  geminiStatusLabel: string;
  geminiApiKeyError: string | null;

  // OCR Model Management
  paddleThaiStatus: ModelDownloadStatus;
  paddleEnglishStatus: ModelDownloadStatus;
  handleDownloadModel: (lang: 'th' | 'en') => void;

  // Hardware Acceleration
  gpuInfo: GpuInfoData | null;
  getGpuModeLabel: (info: GpuInfoData | null) => string;

  // Overlay Font
  isThaiTargetLanguage: boolean;
  overlayFontPreset: OverlayFontPreset;
  setOverlayFontPreset: (preset: OverlayFontPreset) => void;
  selectedFontAvailable: boolean | null;

  // OCR Runtime Options
  ocrOptions: {
    perPageTimeoutSec?: number;
    skipIfTextExists?: boolean;
  };
  setOCROptions: (options: { perPageTimeoutSec?: number; skipIfTextExists?: boolean }) => void;
}

export const LibrarySettingsPanel: React.FC<LibrarySettingsPanelProps> = React.memo(({
  geminiApiKeyDraft,
  setGeminiApiKeyDraft,
  showGeminiApiKey,
  setShowGeminiApiKey,
  saveGeminiApiKey,
  clearGeminiApiKey,
  isGeminiApiKeyLoaded,
  isGeminiApiKeySaving,
  hasGeminiApiKey,
  geminiApiKeySource,
  geminiInputPlaceholder,
  geminiStatusClass,
  geminiStatusLabel,
  geminiApiKeyError,
  paddleThaiStatus,
  paddleEnglishStatus,
  handleDownloadModel,
  gpuInfo,
  getGpuModeLabel,
  isThaiTargetLanguage,
  overlayFontPreset,
  setOverlayFontPreset,
  selectedFontAvailable,
  ocrOptions,
  setOCROptions,
}) => {
  return (
    <>
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2 titlebar-drag select-none text-slate-100">
        <Settings2 className="text-slate-300" size={20} /> Settings
      </h2>

      <div className="flex-1 overflow-y-auto space-y-5 custom-scrollbar pr-1">
        {/* Gemini API Key */}
        <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-2">
          <label className="text-[11px] font-semibold text-slate-300">Gemini API Key</label>
          <div className="relative">
            <KeyRound size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type={showGeminiApiKey ? 'text' : 'password'}
              value={geminiApiKeyDraft}
              onChange={(e) => setGeminiApiKeyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void saveGeminiApiKey();
                }
              }}
              placeholder={geminiInputPlaceholder}
              className="w-full rounded-lg border border-white/12 bg-slate-900/85 pl-7 pr-8 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#2B9BFF]/55"
              disabled={!isGeminiApiKeyLoaded || isGeminiApiKeySaving}
            />
            <button
              type="button"
              onClick={() => setShowGeminiApiKey((prev) => !prev)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10"
              title={showGeminiApiKey ? 'Hide API key' : 'Show API key'}
            >
              {showGeminiApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveGeminiApiKey()}
              disabled={!geminiApiKeyDraft.trim() || isGeminiApiKeySaving || !isGeminiApiKeyLoaded}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check size={12} />
              Save Securely
            </button>
            <button
              type="button"
              onClick={() => void clearGeminiApiKey()}
              disabled={(!hasGeminiApiKey && geminiApiKeySource !== 'environment') || isGeminiApiKeySaving || !isGeminiApiKeyLoaded}
              className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-slate-900/70 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition-colors hover:border-white/20 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <X size={12} />
              Clear Saved Key
            </button>
          </div>
          <p className={`text-[10px] leading-relaxed ${geminiStatusClass}`}>
            {geminiStatusLabel}
          </p>
          {geminiApiKeyError && (
            <p className="text-[10px] leading-relaxed text-rose-300/90">
              {geminiApiKeyError}
            </p>
          )}
        </div>

        {/* Model Downloader / Management */}
        <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-3">
          <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <Download size={12} className="text-slate-400" />
             OCR Model
          </label>
          
          <div className="space-y-3 text-xs">
            {/* Thai OCR Model */}
            <div className="rounded-lg bg-slate-900/50 p-2 border border-white/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Thai Model</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                  paddleThaiStatus.downloading
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    : paddleThaiStatus.installed
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-slate-500/10 text-slate-400 border border-white/10'
                }`}>
                  {paddleThaiStatus.downloading ? 'กำลังดาวน์โหลด...' : paddleThaiStatus.installed ? 'ติดตั้งแล้ว' : 'ไม่ได้ติดตั้ง'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-400">PaddleOCR PP-OCRv5 Thai Model (~15MB)</span>
                <button
                  type="button"
                  onClick={() => handleDownloadModel('th')}
                  disabled={paddleThaiStatus.checking || paddleThaiStatus.downloading || paddleThaiStatus.installed}
                  className="rounded bg-[#2B9BFF] hover:bg-[#1a85e8] disabled:bg-slate-800 disabled:text-slate-500 px-2 py-1 text-[10px] font-semibold text-white transition-colors"
                >
                  {paddleThaiStatus.downloading ? 'Downloading...' : paddleThaiStatus.installed ? 'Installed' : 'Download'}
                </button>
              </div>
              {paddleThaiStatus.downloading && (
                <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                  <div className="bg-[#2B9BFF] h-1 rounded-full animate-pulse" style={{ width: '65%' }}></div>
                </div>
              )}
            </div>

            {/* English OCR Model */}
            <div className="rounded-lg bg-slate-900/50 p-2 border border-white/5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">English Model</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                  paddleEnglishStatus.downloading
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    : paddleEnglishStatus.installed
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-slate-500/10 text-slate-400 border border-white/10'
                }`}>
                  {paddleEnglishStatus.downloading ? 'กำลังดาวน์โหลด...' : paddleEnglishStatus.installed ? 'ติดตั้งแล้ว' : 'ไม่ได้ติดตั้ง'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-400">PaddleOCR English Model (~10MB)</span>
                <button
                  type="button"
                  onClick={() => handleDownloadModel('en')}
                  disabled={paddleEnglishStatus.checking || paddleEnglishStatus.downloading || paddleEnglishStatus.installed}
                  className="rounded bg-[#2B9BFF] hover:bg-[#1a85e8] disabled:bg-slate-800 disabled:text-slate-500 px-2 py-1 text-[10px] font-semibold text-white transition-colors"
                >
                  {paddleEnglishStatus.downloading ? 'Downloading...' : paddleEnglishStatus.installed ? 'Installed' : 'Download'}
                </button>
              </div>
              {paddleEnglishStatus.downloading && (
                <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                  <div className="bg-[#2B9BFF] h-1 rounded-full animate-pulse" style={{ width: '65%' }}></div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Security Settings */}
        <SecuritySettings />

        {/* Hardware Acceleration GPU Status */}
        <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-2.5">
          <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
            <Cpu size={12} className="text-slate-400" />
            Hardware Acceleration / GPU Status
          </label>
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Acceleration Mode</span>
              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                gpuInfo && gpuInfo.mode !== 'CPU'
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}>
                <span className={`h-1.5 w-1.5 rounded-full ${gpuInfo && gpuInfo.mode !== 'CPU' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                {getGpuModeLabel(gpuInfo)}
              </span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <span className="text-slate-400 shrink-0">Detected GPUs</span>
              <div className="text-slate-200 text-right truncate font-mono text-[10px]" title={gpuInfo?.gpus.join(', ')}>
                {gpuInfo?.gpus.join(', ') || 'None'}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">DirectML Support</span>
              <span className={`text-[10px] font-semibold ${gpuInfo?.hasDirectML ? 'text-emerald-400' : 'text-slate-500'}`}>
                {gpuInfo?.hasDirectML ? 'Available' : 'Unavailable'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">CUDA Support</span>
              <span className={`text-[10px] font-semibold ${gpuInfo?.hasCuda ? 'text-emerald-400' : 'text-slate-500'}`}>
                {gpuInfo?.hasCuda ? 'Available' : 'Unavailable'}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 leading-normal border-t border-white/5 pt-2">
              {gpuInfo && gpuInfo.mode !== 'CPU'
                ? 'GPU Acceleration is active. The system will leverage DirectML/CUDA for OCR processing.'
                : 'Running on CPU. If you have an AMD/Intel/NVIDIA GPU, make sure you ran setup correctly to enable hardware acceleration.'}
            </p>
          </div>
        </div>

        {/* Overlay Font Settings */}
        {isThaiTargetLanguage && (
          <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-2.5">
            <label className="text-[11px] font-semibold text-slate-300">Overlay Font</label>

            <select
              value={overlayFontPreset}
              onChange={(e) => setOverlayFontPreset(e.target.value as OverlayFontPreset)}
              className="w-full rounded-lg border border-white/12 bg-slate-900/85 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#2B9BFF]/55"
              aria-label="Overlay font preset"
              title="Overlay font preset"
            >
              {OVERLAY_FONT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <p className={`text-[10px] leading-relaxed ${
              selectedFontAvailable === false
                ? 'text-amber-300/90'
                : selectedFontAvailable === true
                  ? 'text-emerald-300/85'
                  : 'text-slate-500'
            }`}>
              Font status: {
                selectedFontAvailable === false
                  ? 'fallback in use (font not detected)'
                  : selectedFontAvailable === true
                    ? 'detected and ready'
                    : 'unknown'
              }
            </p>
          </div>
        )}

        {/* OCR Runtime Timeout Settings */}
        <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-3">
          <label className="text-[11px] font-semibold text-slate-300">OCR Runtime</label>
          <div className="grid grid-cols-12 items-center gap-2">
            <label className="col-span-5 text-[11px] font-semibold text-slate-300">Timeout</label>
            <select
              value={ocrOptions.perPageTimeoutSec ?? OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT}
              onChange={(e) => setOCROptions({ perPageTimeoutSec: Number(e.target.value) })}
              aria-label="OCR timeout seconds per page"
              title="OCR timeout seconds per page"
              className="col-span-7 rounded-lg border border-white/12 bg-slate-900/80 px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#2B9BFF]/55"
            >
              <option value={0}>No Limit</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
              <option value={120}>120s</option>
              <option value={180}>180s</option>
              <option value={300}>300s</option>
            </select>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/55 px-2.5 py-2">
            <span className="text-[11px] font-semibold text-slate-300">Skip if text exists</span>
            <input
              type="checkbox"
              checked={ocrOptions.skipIfTextExists !== false}
              onChange={(e) => setOCROptions({ skipIfTextExists: e.target.checked })}
              className="accent-[#2B9BFF]"
              aria-label="Skip OCR if Text Exists"
            />
          </div>
        </div>
      </div>
    </>
  );
});

LibrarySettingsPanel.displayName = 'LibrarySettingsPanel';
