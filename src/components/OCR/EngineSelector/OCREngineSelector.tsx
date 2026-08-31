import React from 'react';
import { Cpu, ChevronDown, Sparkles, Gauge, Zap } from 'lucide-react';
import type { OCREngine, OCROptions } from '../../../types';
import { OCR_ENGINES } from '../../../stores/useOCRTextLayerStore';
import type { EngineWarmState } from '../hooks/useEnginePrewarm';

export interface OCREngineSelectorProps {
  options: OCROptions;
  setOptions: (options: Partial<OCROptions>) => void;
  engineWarmStates: Record<string, EngineWarmState>;
  ensureEngineReady: (engine: OCREngine, opts?: { selectOnReady?: boolean }) => Promise<boolean>;
  isProcessing: boolean;
  isModelSectionOpen: boolean;
  setIsModelSectionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onOpenBenchmark: () => void;
  ocrQualityMode: 'high' | 'fast';
  setOcrQualityMode: (mode: 'high' | 'fast') => void;
}

export const OCREngineSelector: React.FC<OCREngineSelectorProps> = ({
  options,
  setOptions,
  engineWarmStates,
  ensureEngineReady,
  isProcessing,
  isModelSectionOpen,
  setIsModelSectionOpen,
  onOpenBenchmark,
  ocrQualityMode,
  setOcrQualityMode,
}) => {
  return (
    <div className="order-1 space-y-1.5 shrink-0">
      {/* Model Selection Container */}
      <div className="rounded-xl border border-white/10 overflow-hidden shadow-sm space-y-0">
        {/* Copper Header Bar */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-r from-[#4d2810] via-[#3a1d0a] to-[#2b1506] border-b border-white/10">
          <button
            type="button"
            onClick={() => setIsModelSectionOpen((prev) => !prev)}
            className="flex items-center gap-1.5 text-left text-xs font-bold text-white hover:text-slate-200 transition-colors"
          >
            <Cpu size={14} className="text-white" />
            <span>OCR Model</span>
          </button>

          <div className="flex items-center gap-1.5">
            {/* Fast Pill Button */}
            <button
              type="button"
              onClick={() => setOcrQualityMode('fast')}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-semibold border transition-all ${
                ocrQualityMode === 'fast'
                  ? 'border-cyan-500/50 bg-cyan-950/70 text-cyan-300 shadow-sm'
                  : 'border-white/10 bg-black/40 text-slate-400 hover:text-white'
              }`}
              title="Fast Mode - เน้นความเร็วในการประมวลผล OCR"
            >
              <Gauge size={11} className={ocrQualityMode === 'fast' ? "text-cyan-400" : "text-slate-400"} />
              <span>Fast</span>
            </button>

            {/* Best Pill Button */}
            <button
              type="button"
              onClick={() => setOcrQualityMode('high')}
              className={`flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[10px] font-semibold border transition-all ${
                ocrQualityMode === 'high'
                  ? 'border-amber-400/50 bg-amber-950/70 text-amber-300 shadow-sm'
                  : 'border-white/10 bg-black/40 text-slate-400 hover:text-white'
              }`}
              title="Best Mode - ความแม่นยำและคุณภาพสูงสุด"
            >
              <Zap size={11} className={ocrQualityMode === 'high' ? "text-amber-400" : "text-slate-400"} />
              <span>Best</span>
            </button>

            {/* Benchmark Button */}
            <button
              type="button"
              onClick={onOpenBenchmark}
              className="flex items-center justify-center p-1 rounded-lg border border-white/10 bg-black/40 text-slate-400 hover:text-amber-300 hover:border-amber-400/30 transition-all"
              title="Benchmark & Quality Improvement"
            >
              <Sparkles size={11} />
            </button>

            {/* Chevron Toggle Button */}
            <button
              type="button"
              onClick={() => setIsModelSectionOpen((prev) => !prev)}
              className="rounded-lg border border-white/15 bg-black/70 p-1 text-slate-300 hover:text-white transition-colors"
            >
              <ChevronDown
                size={13}
                className={`transition-transform duration-200 ${
                  isModelSectionOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {isModelSectionOpen && (
          <div className="p-2.5 bg-slate-950/80 space-y-2">
            {/* Engine cards grid */}
            <div className="grid grid-cols-2 gap-1.5">
              {OCR_ENGINES.map((engine) => {
                const warmState = engineWarmStates[engine.id] || {
                  phase: 'idle',
                  progress: 0,
                  runtime: engine.runtime,
                  description: 'Click to check and warm this model',
                  etaSec: null,
                };
                const isCurrent = (options.engine || 'paddleocr') === engine.id;
                const isBusy = warmState.phase === 'checking' || warmState.phase === 'warming';
                const isReady = warmState.phase === 'ready';
                const canSelect = isReady;

                return (
                  <button
                    key={engine.id}
                    type="button"
                    disabled={isProcessing || isBusy}
                    onClick={() => {
                      if (canSelect) {
                        setOptions({ engine: engine.id });
                        return;
                      }
                      void ensureEngineReady(engine.id, { selectOnReady: true });
                    }}
                    title={warmState.description || engine.description}
                    className={`relative overflow-hidden rounded-xl border px-2 py-2 text-left transition-all ${
                      isCurrent
                        ? 'border-[#8AB83F]/65 bg-gradient-to-r from-[#8AB83F]/15 to-[#5B8220]/10 shadow-[0_10px_24px_rgba(138,184,63,0.12)]'
                        : 'border-white/10 bg-slate-900/45 hover:border-white/20'
                    } disabled:opacity-70`}
                  >
                    {isBusy && (
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#8AB83F]/20 via-[#5B8220]/25 to-transparent transition-[width] duration-500"
                        style={{ width: `${warmState.progress}%` }}
                      />
                    )}
                    <div className="relative z-10 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-white">{engine.name}</span>
                        <span
                          className="text-[9px] font-medium"
                          style={
                            warmState.phase === 'ready'
                              ? { color: '#8AB83F' }
                              : warmState.phase === 'error'
                                ? { color: '#fda4af' }
                                : { color: '#94a3b8' }
                          }
                        >
                          {warmState.phase === 'ready'
                            ? 'Ready'
                            : warmState.phase === 'error'
                              ? 'Unavailable'
                              : warmState.phase === 'warming'
                                ? 'Loading'
                                : 'Check'}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-950/80 overflow-hidden">
                        <div
                          className="h-full transition-all duration-500"
                          style={{
                            width: `${Math.max(warmState.progress, warmState.phase === 'idle' ? 4 : 8)}%`,
                            background:
                              warmState.phase === 'ready'
                                ? 'linear-gradient(90deg, #8AB83F 0%, #5B8220 100%)'
                                : warmState.phase === 'error'
                                  ? '#f43f5e'
                                  : '#3b82f6',
                          }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
