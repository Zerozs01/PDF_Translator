import React from 'react';
import {
  FileDown,
  X,
  BookOpen,
  Layers,
  FileText,
  Languages,
  AlertCircle,
  Check,
  Eye,
  Cpu,
  Globe,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { OCREngine } from '../../types';
import {
  formatPageListSummary,
  type DownloadScope,
  type DownloadContentMode,
} from '../../constants/translationConstants';

export interface DocumentExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  downloadMenuRef: React.RefObject<HTMLDivElement | null>;
  downloadScopeSelection: DownloadScope;
  setDownloadScopeSelection: (scope: DownloadScope) => void;
  downloadModeSelection: DownloadContentMode;
  setDownloadModeSelection: (mode: DownloadContentMode) => void;
  selectedExportEngine: OCREngine | null;
  setSelectedExportEngine: (engine: OCREngine) => void;
  popupOcrQualityMode: 'high' | 'fast';
  changeOcrQualityMode: (mode: 'high' | 'fast') => void;
  isDownloadingResult: boolean;
  isAiProcessing: boolean;
  isOfflineProcessing: boolean;
  triggerPopupTranslation: (engine: 'offline' | 'ai') => void;
  handleHeaderDownload: (scope: DownloadScope, mode: DownloadContentMode) => void;
  handleExportPsd?: () => void;
  currentPage: number;
  totalPages: number;
  fileType: string | null;
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
  ocrLanguage: string;
  getEngineCacheStatus: (engineId: OCREngine) => { status: string; text: string; ocrCount: number; transCount: number };
  ocrCoveredPageNumbers: number[];
  missingOcrPageNumbers: number[];
  translatedAvailablePageNumbers: number[];
  missingTranslatedPageNumbers: number[];
  canExportOriginalSelection: boolean;
  canExportTranslatedSelection: boolean;
  effectiveDownloadScope: DownloadScope;
  selectedDownloadEngine: OCREngine;
  computedProgressPercent: number;
  getRemainingSecondsText: () => string;
  ocrProgress: { progress: number; currentPage: number; totalPages: number; message?: string } | null;
}

export const DocumentExportModal = React.memo<DocumentExportModalProps>(({
  isOpen,
  onClose,
  downloadMenuRef,
  downloadScopeSelection,
  setDownloadScopeSelection,
  downloadModeSelection,
  setDownloadModeSelection,
  selectedExportEngine,
  setSelectedExportEngine,
  popupOcrQualityMode,
  changeOcrQualityMode,
  isDownloadingResult,
  isAiProcessing,
  isOfflineProcessing,
  triggerPopupTranslation,
  handleHeaderDownload,
  handleExportPsd,
  currentPage,
  totalPages,
  fileType,
  targetLanguage,
  setTargetLanguage,
  ocrLanguage,
  getEngineCacheStatus,
  ocrCoveredPageNumbers,
  missingOcrPageNumbers,
  translatedAvailablePageNumbers,
  missingTranslatedPageNumbers,
  canExportOriginalSelection,
  canExportTranslatedSelection,
  effectiveDownloadScope,
  selectedDownloadEngine,
  computedProgressPercent,
  getRemainingSecondsText,
  ocrProgress,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/60 backdrop-blur-md px-4 py-3 transition-all duration-300">
      <div 
        ref={downloadMenuRef} 
        className="w-full max-w-md max-h-[calc(100vh-1.5rem)] overflow-y-auto custom-scrollbar rounded-2xl border border-white/10 bg-slate-950/80 p-5 shadow-[0_0_50px_-12px_rgba(43,155,255,0.25)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <FileDown size={18} />
            </div>
            <div className="text-left">
              <h3 className="text-xs font-bold text-slate-100 tracking-wide">ส่งออกข้อมูล PDF</h3>
              <p className="text-[9px] text-slate-400">เลือกขอบเขตและโมเดลสำหรับผลลัพธ์</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg border border-white/10 hover:border-white/20 bg-white/5 text-slate-400 hover:text-white hover:bg-rose-500/10 hover:border-rose-500/25 transition-all cursor-pointer"
            title="ปิดหน้าต่าง"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-4">
          {/* 1. Scope Selection */}
          <div className="space-y-2">
            <div className="text-left">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">ขอบเขตหน้า (Scope)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDownloadScopeSelection('current')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center group cursor-pointer ${
                  downloadScopeSelection === 'current'
                    ? 'border-purple-500 bg-purple-500/12 text-purple-100 shadow-[0_0_15px_-4px_rgba(168,85,247,0.25)] scale-[1.01]'
                    : 'border-white/5 bg-white/3 text-slate-400 hover:border-white/15 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <BookOpen size={16} className={`mb-1.5 transition-transform group-hover:scale-110 ${downloadScopeSelection === 'current' ? 'text-purple-400' : 'text-slate-400'}`} />
                <span className="text-xs font-semibold">หน้าปัจจุบัน</span>
                <span className="text-[9px] opacity-75 mt-0.5 px-1.5 py-0.5 rounded-full bg-slate-900/50 border border-white/5">
                  หน้า {currentPage}
                </span>
              </button>
              
              <button
                type="button"
                onClick={() => setDownloadScopeSelection('all')}
                disabled={fileType !== 'pdf'}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center group disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer ${
                  downloadScopeSelection === 'all'
                    ? 'border-purple-500 bg-purple-500/12 text-purple-100 shadow-[0_0_15px_-4px_rgba(168,85,247,0.25)] scale-[1.01]'
                    : 'border-white/5 bg-white/3 text-slate-400 hover:border-white/15 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <Layers size={16} className={`mb-1.5 transition-transform group-hover:scale-110 ${downloadScopeSelection === 'all' ? 'text-purple-400' : 'text-slate-400'}`} />
                <span className="text-xs font-semibold">ทุกหน้า</span>
                <span className="text-[9px] opacity-75 mt-0.5 px-1.5 py-0.5 rounded-full bg-slate-900/50 border border-white/5">
                  {fileType === 'pdf' ? `รวม ${totalPages} หน้า` : 'ไฟล์รูปภาพ'}
                </span>
              </button>
            </div>
          </div>

          {/* 2. Content Selection */}
          <div className="space-y-2">
            <div className="text-left">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">รูปแบบเนื้อหา (Content)</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setDownloadModeSelection('original')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center group cursor-pointer ${
                  downloadModeSelection === 'original'
                    ? 'border-blue-500 bg-blue-500/12 text-blue-100 shadow-[0_0_15px_-4px_rgba(59,130,246,0.25)] scale-[1.01]'
                    : 'border-white/5 bg-white/3 text-slate-400 hover:border-white/15 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <FileText size={16} className={`mb-1.5 transition-transform group-hover:scale-110 ${downloadModeSelection === 'original' ? 'text-blue-400' : 'text-slate-400'}`} />
                <span className="text-xs font-semibold">ต้นฉบับพร้อมค้นหา</span>
                <span className="text-[9px] opacity-75 mt-0.5">เฉพาะข้อมูล OCR ดิบ</span>
              </button>
              
              <button
                type="button"
                onClick={() => setDownloadModeSelection('translated')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center group cursor-pointer ${
                  downloadModeSelection === 'translated'
                    ? 'border-blue-500 bg-blue-500/12 text-blue-100 shadow-[0_0_15px_-4px_rgba(59,130,246,0.25)] scale-[1.01]'
                    : 'border-white/5 bg-white/3 text-slate-400 hover:border-white/15 hover:bg-white/5 hover:text-slate-200'
                }`}
              >
                <Languages size={16} className={`mb-1.5 transition-transform group-hover:scale-110 ${downloadModeSelection === 'translated' ? 'text-blue-400' : 'text-slate-400'}`} />
                <span className="text-xs font-semibold">ฉบับแปลภาษา</span>
                <span className="text-[9px] opacity-75 mt-0.5">ทับคำแปลบน PDF เดิม</span>
              </button>
            </div>
          </div>

          {/* 3. Interactive OCR Model Grid */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">โมเดลประมวลผล (OCR Engine)</span>
              <span className="text-[9px] text-slate-400">คลิกเพื่อสลับใช้ผลลัพธ์</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {(['paddleocr', 'easyocr'] as OCREngine[]).map((engineId) => {
                const statusInfo = getEngineCacheStatus(engineId);
                const isSelected = selectedExportEngine === engineId;
                
                let statusBg = 'bg-slate-900/60 text-slate-400 border-white/5';
                let statusIcon = <AlertCircle size={10} className="text-slate-500" />;
                
                if (statusInfo.status === 'ready') {
                  statusBg = 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
                  statusIcon = <Check size={10} className="text-emerald-400" />;
                } else if (statusInfo.status === 'partial_trans') {
                  statusBg = 'bg-teal-500/10 text-teal-300 border-teal-500/20';
                  statusIcon = <Check size={10} className="text-teal-400" />;
                } else if (statusInfo.status === 'ocr_only') {
                  statusBg = 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20';
                  statusIcon = <Eye size={10} className="text-cyan-400" />;
                } else if (statusInfo.status === 'partial_ocr') {
                  statusBg = 'bg-cyan-500/5 text-cyan-300 border-cyan-500/10';
                  statusIcon = <Eye size={10} className="text-cyan-400/80" />;
                }
                
                const displayName = engineId === 'paddleocr' ? 'PaddleOCR' : 'EasyOCR';
                
                return (
                  <button
                    key={engineId}
                    type="button"
                    onClick={() => setSelectedExportEngine(engineId)}
                    className={`flex flex-col items-center justify-between p-2.5 rounded-xl border text-center transition-all group relative overflow-hidden cursor-pointer ${
                      isSelected
                        ? 'border-orange-500 bg-orange-950/20 text-orange-100 shadow-[0_0_15px_-4px_rgba(249,115,22,0.4)] scale-[1.02]'
                        : 'border-white/5 bg-slate-900/40 text-slate-400 hover:border-white/10 hover:bg-slate-900/60 hover:text-slate-200'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute inset-0 bg-gradient-to-b from-orange-500/10 to-transparent pointer-events-none" />
                    )}
                    
                    <Cpu size={14} className={`mb-1 transition-transform group-hover:rotate-12 ${isSelected ? 'text-orange-400' : 'text-slate-400'}`} />
                    <span className="text-[10px] font-bold tracking-tight mb-1.5">{displayName}</span>
                    
                    <span className={`w-full flex items-center justify-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-semibold tracking-tighter ${statusBg}`}>
                      {statusIcon}
                      <span className="truncate">{statusInfo.text}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Quick Translation Console (แสดงเฉพาะเมื่อเลือก Translated) */}
          {downloadModeSelection === 'translated' && (
            <div className="rounded-xl border border-white/5 bg-white/2 p-3 space-y-2.5 backdrop-blur-md">
              <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-slate-400 text-left">
                <Globe size={11} className="text-cyan-400 shrink-0" />
                <span>ตัวแปลภาษาด่วน (Quick Translate)</span>
              </div>
              
              {/* การแสดงผลระหว่างแปลภาษา (Progress Bar ของจริง!) */}
              {(isAiProcessing || isOfflineProcessing) && ocrProgress ? (
                <div className="space-y-2 p-2.5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 backdrop-blur-sm">
                  <div className="flex items-center justify-between text-[10px] text-cyan-200">
                    <span className="font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                      {isOfflineProcessing && effectiveDownloadScope === 'all' && fileType === 'pdf'
                        ? `กำลังประมวลผลหน้า ${currentPage} จาก ${totalPages} หน้า...`
                        : (ocrProgress.message || 'กำลังแปลเอกสาร...')}
                    </span>
                    <span className="font-mono text-[11px]">
                      {Math.round(
                        isOfflineProcessing && effectiveDownloadScope === 'all' && fileType === 'pdf'
                          ? computedProgressPercent
                          : ocrProgress.progress
                      )}%
                    </span>
                  </div>
                  
                  {/* หลอด Progress Bar */}
                  <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden border border-white/10 relative">
                    <div 
                      className="h-full bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(6,182,212,0.5)]"
                      style={{
                        width: `${
                          isOfflineProcessing && effectiveDownloadScope === 'all' && fileType === 'pdf'
                            ? computedProgressPercent
                            : ocrProgress.progress
                        }%`
                      }}
                    />
                  </div>
                  
                  {/* รายละเอียดเลขหน้าและเวลาที่เหลือ */}
                  <div className="flex items-center justify-between text-[9px] text-slate-400">
                    <span>
                      หน้าที่: {isOfflineProcessing && effectiveDownloadScope === 'all' && fileType === 'pdf' ? currentPage : ocrProgress.currentPage} / {isOfflineProcessing && effectiveDownloadScope === 'all' && fileType === 'pdf' ? totalPages : ocrProgress.totalPages} หน้า
                    </span>
                    <span className="text-cyan-300 font-semibold">{getRemainingSecondsText()}</span>
                  </div>
                </div>
              ) : (
                <>
                  {/* เมนูตั้งค่าก่อนกดแปล */}
                  <div className="grid grid-cols-12 gap-3 items-end">
                    {/* 1. เลือกภาษา */}
                    <div className="col-span-7 flex flex-col gap-1 text-left">
                      <span className="text-[9px] text-slate-400">ภาษาเป้าหมาย:</span>
                      <select
                        value={targetLanguage}
                        onChange={(event) => setTargetLanguage(event.target.value)}
                        aria-label="Download translated target language"
                        title="Download translated target language"
                        className="w-full rounded-lg border border-white/10 bg-slate-950/90 px-2 py-1.5 text-[11px] text-slate-100 focus:border-cyan-400/50 focus:outline-none"
                      >
                        {(() => {
                          const isOcrThai = ocrLanguage.split('+').some(lang => lang.trim().toLowerCase() === 'tha' || lang.trim().toLowerCase() === 'thai');
                          return (
                            <>
                              <option value="th" disabled={isOcrThai}>Thai (ไทย)</option>
                              <option value="en">English</option>
                              <option value="ja">Japanese (日本語)</option>
                              <option value="ko">Korean (한국어)</option>
                              <option value="zh">Chinese (中文)</option>
                            </>
                          );
                        })()}
                      </select>
                    </div>

                    {/* 2. สวิตช์ OCR Profile (High / Fast) */}
                    <div className="col-span-5 flex flex-col gap-1 text-left">
                      <span className="text-[9px] text-slate-400">โปรไฟล์ OCR:</span>
                      <div className="grid grid-cols-2 rounded-lg border border-white/10 bg-slate-950/90 p-0.5 h-[30px]">
                        <button
                          type="button"
                          onClick={() => changeOcrQualityMode('high')}
                          className={`text-[9px] font-bold rounded transition-all cursor-pointer ${
                            popupOcrQualityMode === 'high'
                              ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/30'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                          }`}
                        >
                          High
                        </button>
                        <button
                          type="button"
                          onClick={() => changeOcrQualityMode('fast')}
                          className={`text-[9px] font-bold rounded transition-all cursor-pointer ${
                            popupOcrQualityMode === 'fast'
                              ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/30'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                          }`}
                        >
                          Fast
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* ปุ่มเริ่มแปล */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => triggerPopupTranslation('offline')}
                      disabled={isAiProcessing || isOfflineProcessing}
                      className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold text-white transition-all bg-[#864E3E] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 border border-white/10 cursor-pointer"
                    >
                      <RefreshCw size={10} className={isOfflineProcessing ? 'animate-spin' : ''} />
                      <span>Offline All Pages</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerPopupTranslation('ai')}
                      disabled={isAiProcessing || isOfflineProcessing}
                      className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold text-white transition-all bg-[#CA7C4C] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 border border-white/10 cursor-pointer"
                    >
                      <Sparkles size={10} className={isAiProcessing ? 'animate-pulse' : ''} />
                      <span>AI All Pages</span>
                    </button>
                  </div>
                  
                  <div className="text-[9px] text-slate-400 text-center flex items-center justify-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-cyan-400 animate-ping shrink-0" />
                    เป้าหมาย: {effectiveDownloadScope === 'all' && fileType === 'pdf' ? 'ทุกหน้าที่มี OCR' : `เฉพาะหน้าปัจจุบัน (หน้า ${currentPage})`}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 5. HUD-style Info & Warnings */}
          <div className="space-y-2 text-[10px] text-left">
            {effectiveDownloadScope === 'all' && fileType === 'pdf' && missingOcrPageNumbers.length > 0 && (
              <div className="flex gap-1.5 p-2 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-300/90 leading-relaxed shadow-sm">
                <AlertCircle size={13} className="shrink-0 text-amber-400 mt-0.5" />
                <div>
                  ยังไม่รัน OCR บางหน้า ({missingOcrPageNumbers.length} หน้า):{' '}
                  <span className="font-bold">{formatPageListSummary(missingOcrPageNumbers)}</span>{' '}
                  (ระบบจะส่งออกข้ามหน้าที่ยังไม่ได้ OCR)
                </div>
              </div>
            )}

            {downloadModeSelection === 'translated' && ocrCoveredPageNumbers.length > 0 && missingTranslatedPageNumbers.length > 0 && (
              <div className="flex gap-1.5 p-2 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-300/90 leading-relaxed shadow-sm">
                <AlertCircle size={13} className="shrink-0 text-amber-400 mt-0.5" />
                <div>
                  ยังไม่มีข้อมูลแปลของโมเดลนี้บางหน้า ({missingTranslatedPageNumbers.length} หน้า):{' '}
                  <span className="font-bold">{formatPageListSummary(missingTranslatedPageNumbers)}</span>{' '}
                  (กดแปลภาษาด้านบนก่อน หรือดาวน์โหลดเท่าที่มีแปลแล้ว)
                </div>
              </div>
            )}

            <div className="flex items-center justify-between p-2 rounded-lg border border-white/5 bg-slate-900/30 text-slate-400">
              <span>หน้าที่มี OCR: {ocrCoveredPageNumbers.length > 0 ? formatPageListSummary(ocrCoveredPageNumbers) : 'ไม่มี'}</span>
              {downloadModeSelection === 'translated' && (
                <span className="border-l border-white/10 pl-2">
                  แปลแล้ว: {translatedAvailablePageNumbers.length > 0 ? formatPageListSummary(translatedAvailablePageNumbers) : 'ไม่มี'}
                </span>
              )}
            </div>
          </div>

          {/* 6. Primary Action Button */}
          <button
            type="button"
            onClick={() => void handleHeaderDownload(effectiveDownloadScope, downloadModeSelection)}
            disabled={isDownloadingResult || (downloadModeSelection === 'original' ? !canExportOriginalSelection : !canExportTranslatedSelection)}
            className="w-full relative overflow-hidden group rounded-xl bg-gradient-to-r from-[#839958] to-[#0A3323] hover:from-[#95ad66] hover:to-[#0f4631] text-white font-bold p-3 text-xs tracking-wider transition-all duration-300 shadow-[0_0_20px_rgba(131,153,88,0.3)] hover:shadow-[0_0_25px_rgba(131,153,88,0.45)] hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none cursor-pointer"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-white/15 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out" />
            
            <div className="flex items-center justify-center gap-1.5">
              {isDownloadingResult ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>กำลังส่งออกและรวมไฟล์...</span>
                </>
              ) : (
                <>
                  <FileDown size={14} className="group-hover:translate-y-0.5 transition-transform" />
                  <span>
                    ส่งออกข้อมูล {effectiveDownloadScope === 'all' && fileType === 'pdf' ? 'ทั้งหมดทุกหน้า' : `เฉพาะหน้า ${currentPage}`}
                  </span>
                </>
              )}
            </div>
            
            {!isDownloadingResult && (
              <div className="text-[9px] font-normal opacity-75 mt-0.5 uppercase tracking-tighter">
                [{selectedDownloadEngine === 'paddleocr' ? 'PaddleOCR' : 'EasyOCR'} • {downloadModeSelection === 'original' ? 'ต้นฉบับ OCR' : 'ฉบับแปลภาษา'}]
              </div>
            )}
          </button>

          {/* 7. Photoshop PSD Native Export Button */}
          {handleExportPsd && (
            <button
              type="button"
              onClick={() => void handleExportPsd()}
              disabled={isDownloadingResult}
              className="w-full relative overflow-hidden group rounded-xl bg-gradient-to-r from-[#001E36] to-[#0D1F2D] hover:from-[#002848] hover:to-[#122B3E] text-[#31A8FF] hover:text-white font-semibold py-2.5 px-3 text-[11px] tracking-wide transition-all duration-200 border border-[#31A8FF]/30 hover:border-[#31A8FF]/60 shadow-sm disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer flex items-center justify-center gap-2"
            >
              <Layers size={13} className="text-[#31A8FF] shrink-0" />
              <span>ส่งออกเลเยอร์ Photoshop (.psd) หน้า {currentPage}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#31A8FF]/20 text-[#31A8FF] font-mono">
                Native Rust
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

DocumentExportModal.displayName = 'DocumentExportModal';
