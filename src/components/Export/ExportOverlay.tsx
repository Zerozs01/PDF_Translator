import React from 'react';
import { useExportStore } from '../../stores/useExportStore';
import { CheckCircle2 } from 'lucide-react';

export const ExportOverlay: React.FC = () => {
  const { isExporting, totalPages, completedPages, etaSeconds, title, subtitle } = useExportStore();

  if (!isExporting) return null;

  const progressPercent = totalPages === 0 ? 0 : Math.min(100, Math.max(0, Math.round((completedPages / totalPages) * 100)));
  
  // แปลงวินาทีเป็น นาที:วินาที ในรูปแบบภาษาไทย
  const formatETA = (seconds: number | null) => {
    if (seconds === null) return 'กำลังคำนวณ...';
    if (seconds === 0 && completedPages < totalPages) return 'กำลังรวมเล่ม...';
    if (completedPages === totalPages) return 'เสร็จสิ้น!';
    
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    
    if (m > 0) {
      return `${m} นาที ${s} วินาที`;
    }
    return `${s} วินาที`;
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-slate-950/85 backdrop-blur-md text-white select-none transition-all duration-300">
      {/* Background radial glow */}
      <div className="absolute w-[500px] h-[500px] rounded-full bg-cyan-500/10 blur-[100px] pointer-events-none" />
      <div className="absolute w-[400px] h-[400px] rounded-full bg-indigo-500/10 blur-[100px] pointer-events-none" />

      <div className="relative flex flex-col items-center max-w-md w-full p-8 bg-slate-900/90 border border-slate-800 rounded-2xl shadow-2xl mx-4 overflow-hidden">
        {/* Glow Top Accent */}
        <div className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-80" />

        {/* 🎬 Premium SVG Scanning Document Animation */}
        <div className="w-full h-36 bg-slate-950/40 rounded-xl border border-slate-800/80 flex items-center justify-center overflow-hidden mb-6 relative group">
          <svg
            width="120"
            height="120"
            viewBox="0 0 120 120"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="relative export-anim-float"
          >
            {/* Back Page (Shadow) */}
            <path
              d="M35 25C35 22.2386 37.2386 20 40 20H80L95 35V95C95 97.7614 92.7614 100 90 100H40C37.2386 100 35 97.7614 35 95V25Z"
              fill="#1E293B"
              stroke="#334155"
              strokeWidth="2"
              opacity="0.5"
              transform="rotate(-5 65 60)"
            />
            {/* Main Page */}
            <path
              d="M40 25C40 22.2386 42.2386 20 45 20H75L90 35V95C90 97.7614 87.7614 100 85 100H45C42.2386 100 40 97.7614 40 95V25Z"
              fill="#0F172A"
              stroke="#06B6D4"
              strokeWidth="2"
            />
            {/* Folded Corner */}
            <path
              d="M75 20V30C75 32.7614 77.2386 35 80 35H90"
              fill="#0F172A"
              stroke="#06B6D4"
              strokeWidth="2"
            />
            {/* Document Lines (Simulated Text / Images) */}
            <rect x="50" y="45" width="30" height="4" rx="2" fill="#38BDF8" opacity="0.8" />
            <rect x="50" y="55" width="22" height="4" rx="2" fill="#38BDF8" opacity="0.8" />
            <rect x="50" y="65" width="26" height="4" rx="2" fill="#38BDF8" opacity="0.8" />
            <rect x="50" y="75" width="16" height="4" rx="2" fill="#10B981" opacity="0.8" />
            
            {/* Graphic Box */}
            <rect x="50" y="85" width="30" height="6" rx="2" fill="#6366F1" opacity="0.4" />

            {/* Glowing Scan Line (Laser) */}
            <g className="export-anim-scan">
              <rect x="36" y="20" width="48" height="2" fill="#22D3EE" />
              <rect x="36" y="18" width="48" height="6" fill="#22D3EE" opacity="0.2" filter="blur(2px)" />
            </g>
          </svg>


          {/* Processing Glowing Indicator */}
          <div className="absolute bottom-3 right-3 flex items-center gap-2 px-2.5 py-1 bg-slate-950/80 border border-slate-800 rounded-full shadow-inner">
             <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
             </span>
             <span className="text-[10px] font-semibold tracking-wider uppercase text-cyan-400 font-mono">
               Rendering
             </span>
          </div>
        </div>

        <h2 className="text-xl font-bold mb-1 tracking-tight text-slate-100">
          {title || 'กำลังส่งออกไฟล์ PDF...'}
        </h2>
        <p className="text-slate-400 text-xs mb-6">
          {subtitle ? (
            <span>{subtitle}</span>
          ) : (
            <>
              ประมวลผลหน้าที่ <span className="font-mono text-cyan-400 font-bold text-sm">{completedPages}</span> จาก <span className="font-mono text-slate-300 font-semibold">{totalPages}</span> หน้า
            </>
          )}
        </p>

        {/* Custom Progress Bar */}
        <div className="w-full h-2.5 bg-slate-950/80 rounded-full border border-slate-800/80 overflow-hidden mb-3 relative p-[2px]">
          <div 
            className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-emerald-400 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <div className="w-full flex justify-between items-center text-[11px] font-medium text-slate-400">
          <span className="flex items-center gap-1">
            {progressPercent === 100 ? (
              <>
                <CheckCircle2 size={12} className="text-emerald-400" />
                <span className="text-emerald-400 font-semibold">เสร็จสมบูรณ์ 100%</span>
              </>
            ) : (
              <>
                <span className="font-mono font-bold text-cyan-400">{progressPercent}%</span>
                <span>สำเร็จ</span>
              </>
            )}
          </span>
          <span className="flex items-center gap-1">
            <span className="text-slate-500">เวลาคงเหลือ:</span>
            <span className="font-semibold text-slate-300 font-mono">{formatETA(etaSeconds)}</span>
          </span>
        </div>
      </div>
    </div>
  );
};
