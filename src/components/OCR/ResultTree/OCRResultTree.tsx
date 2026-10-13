import React from 'react';
import { Search, ChevronDown, ChevronRight, Copy, Check, Info } from 'lucide-react';
import type { OCRLine, OCRPageResult } from '../../../types';
import type { TextSearchPattern } from '../../../services/textSearch';
import { OCRPreviewMode } from '../../../stores/useOCRTextLayerStore';

export interface OCRResultTreeProps {
  currentPage: number;
  currentEngineName: string;
  currentRuntimeSecLabel: string;
  effectivePreviewMode: OCRPreviewMode;
  isStaleTranslation: boolean;
  previewWordsLength: number;
  previewLines?: OCRLine[];
  previewMatchedLineIndexSet: Set<number>;
  activePreviewMatchLineIndex: number;
  ocrPreviewLineRefs: React.MutableRefObject<Map<number, HTMLParagraphElement>>;
  renderPreviewTextWithHighlight: (text: string, pattern: TextSearchPattern | null) => React.ReactNode;
  previewSearchPattern: TextSearchPattern | null;
  previewText?: string;
  previewSourceOCR: OCRPageResult;
  setOcrInfoOpen: (val: boolean) => void;
  copyFeedback: 'idle' | 'copied';
  handleCopyPreviewText: () => void;
  setTranslationPreviewMode: (mode: OCRPreviewMode) => void;
  translatedCacheSlotCount: number;
  ocrResultSearchQuery: string;
  setOcrResultSearchQuery: (query: string) => void;
  ocrPreviewSearchActiveIndex: number;
  setOcrPreviewSearchActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  ocrPreviewScrollRef: React.RefObject<HTMLDivElement>;
  ocrPreviewSearchHeaderRef: React.RefObject<HTMLDivElement>;
}

export const OCRResultTree: React.FC<OCRResultTreeProps> = ({
  currentPage,
  currentEngineName,
  currentRuntimeSecLabel,
  effectivePreviewMode,
  isStaleTranslation,
  previewWordsLength,
  previewLines,
  previewMatchedLineIndexSet,
  activePreviewMatchLineIndex,
  ocrPreviewLineRefs,
  renderPreviewTextWithHighlight,
  previewSearchPattern,
  previewText,
  previewSourceOCR,
  setOcrInfoOpen,
  copyFeedback,
  handleCopyPreviewText,
  setTranslationPreviewMode,
  translatedCacheSlotCount,
  ocrResultSearchQuery,
  setOcrResultSearchQuery,
  ocrPreviewSearchActiveIndex,
  setOcrPreviewSearchActiveIndex,
  ocrPreviewScrollRef,
  ocrPreviewSearchHeaderRef,
}) => {
  const matchCount = previewMatchedLineIndexSet.size;

  return (
    <div className="order-3 space-y-1.5 flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Result Header Bar */}
      <div className="flex items-center justify-between text-xs shrink-0 py-0.5">
        <div className="flex items-center gap-2 font-bold">
          <span className="text-white text-sm">Result - </span>
          <span style={{ color: '#D7CE93' }} className="text-sm">P {currentPage}</span>
          <button
            type="button"
            onClick={() => setOcrInfoOpen(true)}
            className="text-slate-400 hover:text-white p-0.5 rounded transition-colors"
            title="Inspect OCR process details"
          >
            <Info size={14} />
          </button>
          <span className="text-xs font-normal" style={{ color: '#D7CE93' }}>
            runtime {currentRuntimeSecLabel}
          </span>
          {(() => {
            const debugObj = previewSourceOCR?.debug as any;
            const activeBackend = debugObj?.activeBackend;
            const providers = debugObj?.activeProviders;
            const isDml =
              activeBackend === 'ort_dml' ||
              (providers?.rec && Array.isArray(providers.rec) && providers.rec.includes('DmlExecutionProvider'));
            return isDml ? (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                DirectML
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                Paddle CPU
              </span>
            );
          })()}
        </div>

        {/* Mode Toggle Button */}
        <button
          type="button"
          onClick={() =>
            setTranslationPreviewMode(
              effectivePreviewMode === 'translated' ? 'original' : 'translated'
            )
          }
          className="px-2.5 py-1 rounded-lg border border-white/15 bg-black/80 text-[11px] font-semibold text-white hover:bg-black transition-all shadow-sm flex items-center gap-1 disabled:opacity-50"
          title={
            translatedCacheSlotCount > 0
              ? 'Click to toggle between Original and Translated text'
              : 'Showing Original OCR text'
          }
        >
          <span>{effectivePreviewMode === 'translated' ? 'Translated' : 'Original OCR'}</span>
        </button>
      </div>

      {isStaleTranslation && effectivePreviewMode === 'translated' && (
        <div className="shrink-0 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200">
          คำแปลมาจากผล OCR ก่อนหน้า (เนื้อหาต้นทางเปลี่ยนไปแล้ว)
        </div>
      )}

      {/* Result Container with In-pane Search */}
      <div className="flex-1 min-h-0 rounded-xl border border-white/10 bg-slate-950/70 flex flex-col overflow-hidden">
        {/* Search & Actions Header */}
        <div
          ref={ocrPreviewSearchHeaderRef}
          className="shrink-0 border-b border-white/10 bg-slate-900/60 p-1.5 flex items-center gap-1.5"
        >
          <div className="relative flex-1 flex items-center">
            <Search size={12} className="absolute left-2.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={ocrResultSearchQuery}
              onChange={(e) => {
                setOcrResultSearchQuery(e.target.value);
                setOcrPreviewSearchActiveIndex(0);
              }}
              placeholder="Search OCR result..."
              className="w-full rounded-lg bg-slate-950/90 border border-white/10 pl-7 pr-2 py-1 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-white/20"
            />
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={matchCount <= 0}
              onClick={() =>
                setOcrPreviewSearchActiveIndex((prev) => (prev > 0 ? prev - 1 : matchCount - 1))
              }
              className="px-2 py-1 rounded-lg border border-white/10 bg-slate-950/80 text-[10px] font-semibold text-slate-300 hover:text-white hover:border-white/20 disabled:opacity-30 transition-colors"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={matchCount <= 0}
              onClick={() =>
                setOcrPreviewSearchActiveIndex((prev) => (prev < matchCount - 1 ? prev + 1 : 0))
              }
              className="px-2 py-1 rounded-lg border border-white/10 bg-slate-950/80 text-[10px] font-semibold text-slate-300 hover:text-white hover:border-white/20 disabled:opacity-30 transition-colors"
            >
              Next
            </button>
            <button
              type="button"
              onClick={handleCopyPreviewText}
              className="p-1 rounded-lg border border-white/10 bg-slate-950/80 text-slate-300 hover:text-white hover:border-white/20 transition-colors"
              title="Copy OCR result text"
            >
              {copyFeedback === 'copied' ? (
                <Check size={13} className="text-emerald-400" />
              ) : (
                <Copy size={13} />
              )}
            </button>
          </div>
        </div>

        {/* Scrollable Text List */}
        <div ref={ocrPreviewScrollRef} className="flex-1 overflow-y-auto p-2.5 space-y-1.5 text-xs text-slate-200">
          {previewWordsLength > 0 ? (
            <div className="space-y-1">
              {previewLines && previewLines.length > 0 ? (
                previewLines.map((line, i) => {
                  const matchedLine = previewMatchedLineIndexSet.has(i);
                  const activeMatchLine = matchedLine && i === activePreviewMatchLineIndex;
                  return (
                    <p
                      key={i}
                      className={`text-xs leading-relaxed ${
                        activeMatchLine
                          ? 'scroll-mt-24 rounded bg-cyan-500/14 px-1 py-0.5 text-cyan-50 ring-1 ring-cyan-400/35'
                          : matchedLine
                            ? 'scroll-mt-24 text-slate-100'
                            : 'text-slate-300'
                      }`}
                      ref={(element) => {
                        if (element) {
                          ocrPreviewLineRefs.current.set(i, element);
                        } else {
                          ocrPreviewLineRefs.current.delete(i);
                        }
                      }}
                    >
                      {renderPreviewTextWithHighlight(line.text, previewSearchPattern)}
                    </p>
                  );
                })
              ) : (
                <p className="text-xs text-slate-300 leading-relaxed">
                  {renderPreviewTextWithHighlight(
                    previewText || previewSourceOCR.words.map((w) => w.text).join(' '),
                    previewSearchPattern
                  )}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-500 italic text-center py-2">
              ไม่พบข้อความในหน้านี้
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
