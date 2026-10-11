import React from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, Info, X } from 'lucide-react';
import type { OCREngine, BenchmarkMode, OCRQualityProfile } from '../../../types';

export type BenchmarkRawSnapshot = {
  runtimeMs: number | null;
  confidence: number | null;
  compositeScore: number | null;
  lexicalAxis: number | null;
  yieldAxis: number | null;
  garbageRatio: number | null;
  efficiency: number | null;
  wordCount: number;
  lineCount: number;
  droppedCount: number;
  status: 'idle' | 'running' | 'done' | 'error';
  message?: string;
};

export type BenchmarkRow = {
  engine: OCREngine;
  engineName: string;
  status: 'idle' | 'running' | 'done' | 'error';
  cacheHit: boolean;
  runtimeMs: number | null;
  confidence: number | null;
  compositeScore: number | null;
  efficiency: number | null;
  rawAxis: number | null;
  lexicalAxis: number | null;
  yieldAxis: number | null;
  werError: number | null;
  cerError: number | null;
  garbageRatio: number | null;
  wordCount: number;
  lineCount: number;
  suspiciousCount: number;
  suspiciousRatio: number;
  droppedCount: number;
  message?: string;
  rawSnapshot?: BenchmarkRawSnapshot;
};

export interface OCRBenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  benchmarkRunning: boolean;
  benchmarkTargetPage: number | null;
  currentPage: number;
  activePipelineProfile: string;
  language: string;
  dpi: number;
  benchmarkMode: BenchmarkMode;
  showMetricsInfo: boolean;
  setShowMetricsInfo: React.Dispatch<React.SetStateAction<boolean>>;
  benchmarkRows: BenchmarkRow[];
  handleCancelBenchmark: () => void;
  handleBenchmarkCurrentPage: () => Promise<void>;
  isProcessing: boolean;
  hasFile: boolean;
}

export const OCRBenchmarkModal: React.FC<OCRBenchmarkModalProps> = ({
  isOpen,
  onClose,
  benchmarkRunning,
  benchmarkTargetPage,
  currentPage,
  activePipelineProfile,
  language,
  dpi,
  benchmarkMode,
  showMetricsInfo,
  setShowMetricsInfo,
  benchmarkRows,
  handleCancelBenchmark,
  handleBenchmarkCurrentPage,
  isProcessing,
  hasFile,
}) => {
  if (!isOpen) return null;

  const fmtMs = (ms: number | null) =>
    ms != null ? `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s` : '—';

  const dir = (full: number | null, raw: number | null, higherIsBetter = true): React.ReactNode => {
    if (full == null || raw == null) return null;
    const delta = full - raw;
    if (Math.abs(delta) < 0.0001) return null;
    const improved = higherIsBetter ? delta > 0 : delta < 0;
    const actualIncreased = delta > 0;
    return (
      <span
        className={`ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded text-[9px] font-bold leading-none ${
          improved ? 'bg-emerald-500/25 text-emerald-300' : 'bg-rose-500/25 text-rose-300'
        }`}
      >
        {actualIncreased ? '↑' : '↓'}
      </span>
    );
  };

  const completedEngines = benchmarkRows.filter(
    (row) => row.status === 'done' && row.rawSnapshot?.status === 'done'
  );

  return createPortal(
    <div className="fixed inset-0 z-190 flex items-center justify-center bg-black/72 backdrop-blur-md px-4 py-6">
      <div className="flex max-h-[90vh] w-[min(96vw,1240px)] flex-col rounded-2xl border border-white/15 bg-slate-950/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-100">OCR Benchmark Summary</h3>
              <button
                type="button"
                onClick={() => setShowMetricsInfo((prev) => !prev)}
                className={`rounded p-1 transition-colors hover:bg-white/10 ${
                  showMetricsInfo ? 'text-emerald-300 bg-emerald-500/10' : 'text-slate-400'
                }`}
                title="Toggle detailed metrics explanation"
              >
                <Info size={14} />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              page {benchmarkTargetPage ?? currentPage} • pipeline {activePipelineProfile} • lang {language} • dpi {dpi}
            </p>
            <p className="mt-1 text-[11px] text-amber-200/90">
              confidence เป็น raw score ของแต่ละ engine (ยังไม่ calibrated ข้าม model)
            </p>
            <p className="mt-1 text-[11px] text-cyan-200/90">
              composite score = 35% raw conf + 45% lexical quality (garbage penalization) + 20% yield/drop-safe
            </p>
            <p className="mt-1 text-[11px] text-cyan-200/75">
              efficiency = composite score / runtime (seconds)
            </p>
            {showMetricsInfo && (
              <div className="mt-3 space-y-1 rounded-lg bg-slate-900/50 p-3 text-[11px] leading-relaxed border border-white/5">
                <p className="text-emerald-200/90 font-medium">✦ AI Pipeline + Heuristics Mode (RAW vs FULL Pipeline Comparison)</p>
                <ul className="list-disc pl-4 text-slate-300 space-y-0.5">
                  <li><span className="text-cyan-300">Composite Score:</span> คะแนนรวม (35% Raw Conf + 45% Lexical Quality + 20% Yield) <span className="text-emerald-400">↑ ยิ่งสูงยิ่งดี</span> แปลว่าผลลัพธ์โดยรวมสมบูรณ์และถูกต้องมากขึ้น</li>
                  <li><span className="text-cyan-300">Lexical & Yield:</span> ความถูกต้องของคำ (Lexical) และปริมาณข้อความที่รักษาไว้ได้ (Yield) <span className="text-emerald-400">↑ สูง=ดี</span> หมายถึงลด Garbage ได้โดยไม่ทำให้ข้อความหลักหาย</li>
                  <li><span className="text-rose-300">Garbage Ratio:</span> สัดส่วนข้อความขยะ/ลายน้ำ หรือคำที่ผิดเพี้ยน <span className="text-emerald-400">↓ ยิ่งต่ำยิ่งดี</span> หมายถึง Pipeline สามารถกรองขยะและเส้นกวนทิ้งได้สำเร็จ</li>
                </ul>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!benchmarkRunning) onClose();
            }}
            disabled={benchmarkRunning}
            className="rounded-lg border border-white/10 p-1.5 text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            title={benchmarkRunning ? 'Wait for benchmark to finish or cancel first' : 'Close benchmark summary'}
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-4 flex-1 overflow-auto rounded-xl border border-white/10">
          {benchmarkMode === 'dual' && (
            <div className="flex items-center gap-2 border-b border-white/8 bg-gradient-to-r from-emerald-950/60 to-slate-950/60 px-3 py-2 text-[11px]">
              <span className="font-semibold text-emerald-300">✦ AI Pipeline + Heuristics</span>
              <span className="text-slate-500">·</span>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">RAW</span>
              <span className="text-slate-500">= no pipeline</span>
              <span className="text-slate-500 mx-1">·</span>
              <span className="rounded bg-cyan-900/50 px-1.5 py-0.5 text-[10px] text-cyan-300">FULL</span>
              <span className="text-slate-500">= after processing</span>
              <span className="ml-auto flex items-center gap-2 text-[10px] text-slate-500">
                <span className="text-emerald-400 font-bold">↑</span> improved
                <span className="text-rose-400 font-bold">↓</span> worse
              </span>
            </div>
          )}
          <table className="min-w-full text-xs text-slate-200">
            <thead className="bg-slate-900/85 text-slate-400 text-[11px]">
              <tr>
                <th className="px-3 py-2 text-left w-28">Engine</th>
                <th className="px-2 py-2 text-right">Runtime</th>
                <th className="px-2 py-2 text-right">Conf</th>
                <th className="px-2 py-2 text-right">Lexical</th>
                <th className="px-2 py-2 text-right">Yield</th>
                <th className="px-2 py-2 text-right">Composite</th>
                <th className="px-2 py-2 text-right">Efficiency</th>
                <th className="px-2 py-2 text-right">Garbage</th>
                <th className="px-2 py-2 text-right">Words</th>
                <th className="px-2 py-2 text-right">Dropped</th>
                <th className="px-2 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {benchmarkRows.map((row) => {
                const snap = row.rawSnapshot;
                const isDual = benchmarkMode === 'dual';
                const hasSnap = isDual && snap?.status === 'done';

                return (
                  <tr key={row.engine} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="px-3 py-2 font-medium text-white">{row.engineName}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {fmtMs(row.runtimeMs)}
                      {hasSnap && dir(row.runtimeMs, snap?.runtimeMs, false)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.confidence != null ? `${row.confidence.toFixed(0)}%` : '—'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.lexicalAxis != null ? row.lexicalAxis.toFixed(1) : '—'}
                      {hasSnap && dir(row.lexicalAxis, snap?.lexicalAxis, true)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.yieldAxis != null ? row.yieldAxis.toFixed(1) : '—'}
                      {hasSnap && dir(row.yieldAxis, snap?.yieldAxis, true)}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-white">
                      {row.compositeScore != null ? row.compositeScore.toFixed(1) : '—'}
                      {hasSnap && dir(row.compositeScore, snap?.compositeScore, true)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.efficiency != null ? row.efficiency.toFixed(1) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.garbageRatio != null ? `${(row.garbageRatio * 100).toFixed(0)}%` : '—'}
                      {hasSnap && dir(row.garbageRatio, snap?.garbageRatio, false)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.wordCount}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.droppedCount}</td>
                    <td className="px-2 py-2">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          row.status === 'done'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : row.status === 'running'
                              ? 'bg-cyan-500/20 text-cyan-300'
                              : row.status === 'error'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pipeline Optimization Insights */}
        {completedEngines.length > 0 && (
          <div className="mt-3.5 space-y-2 shrink-0">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
              <Sparkles size={11} className="text-cyan-400" />
              <span>วิเคราะห์ผลการจูนระบบ (Pipeline Optimization Insights)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {completedEngines.map((row) => {
                const snap = row.rawSnapshot!;
                const scoreDelta = (row.compositeScore ?? 0) - (snap.compositeScore ?? 0);
                const rawGarbage = snap.garbageRatio ?? 0;
                const fullGarbage = row.garbageRatio ?? (row.wordCount > 0 ? row.suspiciousRatio : 0);
                const garbageDelta = rawGarbage - fullGarbage;
                const garbageReductionPct = rawGarbage > 0 ? (garbageDelta / rawGarbage) * 100 : 0;

                let commentary = '';
                if (scoreDelta > 0 && garbageDelta > 0) {
                  commentary = `ล้างสัญญาณรบกวน/ลายน้ำลงได้ ${garbageReductionPct.toFixed(0)}% ดึงคุณภาพคำแปลกลับมาสมบูรณ์ขึ้น (${scoreDelta.toFixed(1)} คะแนนดีขึ้น)`;
                } else if (scoreDelta > 0) {
                  commentary = `ดึงความถูกต้องของประโยคเพิ่มขึ้น ${scoreDelta.toFixed(1)} คะแนน รักษาโครงสร้างประโยคได้คมชัดกว่าตัวดิบ`;
                } else if (garbageDelta > 0) {
                  commentary = `ตรวจจับและปัดกวาดขยะทิ้งไปได้สำเร็จ ป้องกันปัญหาอักขระแปลกปลอมปะปนในประโยค`;
                } else {
                  commentary = `รักษาความถูกต้องได้ใกล้เคียงกับฐานตัวดิบ ทำงานร่วมกับฟิลเตอร์ต่างๆ ได้อย่างมั่นคง`;
                }

                return (
                  <div
                    key={row.engine}
                    className="rounded-xl border border-white/8 bg-slate-900/40 p-2.5 flex flex-col justify-between hover:border-white/15 transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] font-bold text-white uppercase tracking-wider">{row.engineName}</span>
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400 border border-emerald-500/15">Active</span>
                        </div>
                        <p className="text-[10px] text-slate-400 font-normal leading-normal">{commentary}</p>
                      </div>

                      <div className="flex gap-2 shrink-0 text-right">
                        <div className="rounded bg-slate-950/40 px-2 py-1 border border-white/5 min-w-[54px]">
                          <div className="text-[8px] text-slate-500 uppercase tracking-wider font-semibold">คะแนนรวม</div>
                          <div className="text-[10px] font-bold text-white flex items-center justify-end gap-0.5 mt-0.5">
                            <span>{(row.compositeScore ?? 0).toFixed(1)}</span>
                            <span className={`text-[8px] font-bold ${scoreDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {scoreDelta >= 0 ? '↑' : '↓'}{Math.abs(scoreDelta).toFixed(1)}
                            </span>
                          </div>
                        </div>
                        <div className="rounded bg-slate-950/40 px-2 py-1 border border-white/5 min-w-[54px]">
                          <div className="text-[8px] text-slate-500 uppercase tracking-wider font-semibold">ขยะขยุกขยิก</div>
                          <div className="text-[10px] font-bold text-white flex items-center justify-end gap-0.5 mt-0.5">
                            <span>{(fullGarbage * 100).toFixed(0)}%</span>
                            {rawGarbage > 0 && (
                              <span className={`text-[8px] font-bold ${garbageDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {garbageDelta >= 0 ? '↓' : '↑'}{(Math.abs(garbageDelta) * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {row.droppedCount > 0 && (
                      <div className="mt-2 flex items-center gap-1 rounded bg-orange-950/15 px-2 py-0.5 text-[9px] text-orange-200/90 border border-orange-500/10">
                        <Info size={9} className="shrink-0" />
                        <span>ตรวจพบและปัดกวาดขยะลายน้ำทิ้งได้เป็นจำนวน <strong>{row.droppedCount} คำ</strong></span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          {benchmarkRunning ? (
            <button
              type="button"
              onClick={handleCancelBenchmark}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
            >
              Stop Benchmark
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void handleBenchmarkCurrentPage()}
                disabled={isProcessing || benchmarkRunning || !hasFile}
                className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Re-run
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
