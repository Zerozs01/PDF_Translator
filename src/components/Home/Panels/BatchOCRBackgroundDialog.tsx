import React from 'react';
import {
  Sparkles,
  Zap,
  Award,
  Layers,
} from 'lucide-react';
import type { DBDocument } from '../../../types/electron.d';
import type { OCREngine } from '../../../types';

export interface BatchOCRBackgroundDialogProps {
  isOpen: boolean;
  doc: DBDocument | null;
  model: OCREngine;
  profile: 'ocr_all' | 'offline_all';
  ocrLanguage: string;
  ocrQualityProfile: 'fast' | 'best';
  targetLanguage: string;
  dialogCachePages: number | null;
  onChangeModel: (model: OCREngine) => void;
  onChangeProfile: (profile: 'ocr_all' | 'offline_all') => void;
  onChangeOcrLanguage: (lang: string) => void;
  onChangeOcrQualityProfile: (profile: 'fast' | 'best') => void;
  onChangeTargetLanguage: (lang: string) => void;
  onStart: () => void;
  onClose: () => void;
}

export const BatchOCRBackgroundDialog: React.FC<BatchOCRBackgroundDialogProps> = React.memo(({
  isOpen,
  doc,
  model,
  profile,
  ocrLanguage,
  ocrQualityProfile,
  targetLanguage,
  dialogCachePages,
  onChangeModel,
  onChangeProfile,
  onChangeOcrLanguage,
  onChangeOcrQualityProfile,
  onChangeTargetLanguage,
  onStart,
  onClose,
}) => {
  if (!isOpen || !doc) return null;

  return (
    <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] text-left flex flex-col gap-4">
        {/* Header */}
        <div className="border-b border-white/10 pb-3 flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Sparkles size={16} className="text-emerald-400" />
              ประมวลผลพื้นหลัง (Background Pipeline)
            </h3>
            <p className="text-xs text-slate-400 mt-1 truncate max-w-[320px]" title={doc.filename}>
              {doc.filename}
            </p>
          </div>
        </div>

        {/* Cache status banner */}
        <div className="flex items-center justify-between rounded-xl bg-white/[0.03] border border-white/5 p-3 text-xs">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Layers size={14} className="text-sky-400" />
            สถานะแคชปัจจุบัน:
          </span>
          <span className="font-semibold text-slate-200">
            {dialogCachePages !== null
              ? `${dialogCachePages} / ${doc.total_pages} หน้า`
              : 'กำลังตรวจสอบ...'}
          </span>
        </div>

        {/* Pipeline Profile Selection */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
            โหมดการทำงาน (Pipeline Mode)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeProfile('offline_all')}
              className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs gap-1 ${
                profile === 'offline_all'
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.15)] font-semibold'
                  : 'border-white/5 bg-slate-900/40 text-slate-400 hover:border-white/10 hover:text-slate-200'
              }`}
            >
              <span className="font-bold">OCR + แปลภาษา</span>
              <span className="text-[10px] opacity-70">ทุกหน้าแบบครบวงจร</span>
            </button>

            <button
              type="button"
              onClick={() => onChangeProfile('ocr_all')}
              className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs gap-1 ${
                profile === 'ocr_all'
                  ? 'border-sky-500/50 bg-sky-500/10 text-sky-300 shadow-[0_0_15px_rgba(14,165,233,0.15)] font-semibold'
                  : 'border-white/5 bg-slate-900/40 text-slate-400 hover:border-white/10 hover:text-slate-200'
              }`}
            >
              <span className="font-bold">OCR อย่างเดียว</span>
              <span className="text-[10px] opacity-70">ดึงข้อความเก็บในแคช</span>
            </button>
          </div>
        </div>

        {/* Quality Mode Selection */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
            ระดับความแม่นยำ (Quality Profile)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeOcrQualityProfile('fast')}
              className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs gap-1.5 ${
                ocrQualityProfile === 'fast'
                  ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.15)] font-semibold'
                  : 'border-white/5 bg-slate-900/40 text-slate-500 hover:border-white/10 hover:text-slate-300'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Zap size={13} className={ocrQualityProfile === 'fast' ? 'text-cyan-400 animate-pulse' : 'text-slate-400'} />
                Fast (ความเร็วสูง)
              </span>
            </button>

            <button
              type="button"
              onClick={() => onChangeOcrQualityProfile('best')}
              className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs gap-1.5 ${
                ocrQualityProfile === 'best'
                  ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.15)] font-semibold'
                  : 'border-white/5 bg-slate-900/40 text-slate-500 hover:border-white/10 hover:text-slate-300'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Award size={13} className={ocrQualityProfile === 'best' ? 'text-emerald-400 animate-pulse' : 'text-slate-400'} />
                High (ความแม่นยำสูง)
              </span>
            </button>
          </div>
        </div>

        {/* Languages Row */}
        <div className="grid grid-cols-2 gap-3">
          {/* Source Language */}
          <div>
            <label htmlFor="ocr-bg-lang-select" className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />
              ภาษาต้นทาง 
            </label>
            <select
              id="ocr-bg-lang-select"
              value={ocrLanguage}
              onChange={(e) => onChangeOcrLanguage(e.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-100 outline-none transition-colors focus:border-cyan-400/50 cursor-pointer"
            >
              <option value="eng">🇬🇧 EN (English)</option>
              <option value="tha">🇹🇭 TH (Thai)</option>
              <option value="jpn">🇯🇵 JA (Japanese)</option>
              <option value="jpn_vert">🇯🇵 JA-V (Japanese Vert)</option>
              <option value="kor">🇰🇷 KO (Korean)</option>
              <option value="chi_sim">🇨🇳 ZH-S (Chinese Simp)</option>
              <option value="chi_tra">🇨🇳 ZH-T (Chinese Trad)</option>
              <option value="vie">🇻🇳 VI (Vietnamese)</option>
              <option value="deu">🇩🇪 DE (German)</option>
              <option value="fra">🇫🇷 FR (French)</option>
              <option value="spa">🇪🇸 ES (Spanish)</option>
              <option value="rus">🇷🇺 RU (Russian)</option>
            </select>
          </div>

          {/* Target Language */}
          <div>
            <label htmlFor="ocr-bg-target-lang-select" className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
              <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
              ภาษาปลายทาง
            </label>
            <select
              id="ocr-bg-target-lang-select"
              value={targetLanguage}
              disabled={profile !== 'offline_all'}
              onChange={(e) => onChangeTargetLanguage(e.target.value)}
              className={`w-full rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-100 outline-none transition-colors focus:border-emerald-500/50 cursor-pointer ${
                profile !== 'offline_all' ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              <option value="th">🇹🇭 TH (Thai)</option>
              <option value="en">🇬🇧 EN (English)</option>
              <option value="ja">🇯🇵 JA (Japanese)</option>
              <option value="ko">🇰🇷 KO (Korean)</option>
              <option value="zh">🇨🇳 ZH (Chinese)</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 border-t border-white/5 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-slate-300 transition-colors hover:bg-white/10"
          >
            ยกเลิก (Cancel)
          </button>
          <button
            type="button"
            onClick={onStart}
            className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98]"
          >
            เริ่มประมวลผล (Start)
          </button>
        </div>
      </div>
    </div>
  );
});

BatchOCRBackgroundDialog.displayName = 'BatchOCRBackgroundDialog';
