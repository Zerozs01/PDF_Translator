import React, { useState, useEffect } from 'react';
import { RefreshCw, ChevronDown, ChevronUp, Pause, Play, Trash2 } from 'lucide-react';
import { useBackgroundQueueStore, BackgroundJob } from '../../stores/useBackgroundQueueStore';

interface BackgroundQueuePanelContentProps {
  visibleQueueJobs: BackgroundJob[];
  activeJob: BackgroundJob;
}

const BackgroundQueuePanelContent: React.FC<BackgroundQueuePanelContentProps> = React.memo(({
  visibleQueueJobs,
  activeJob,
}) => {
  const [isQueuePanelExpanded, setIsQueuePanelExpanded] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  const activeStartTime = activeJob.startTime || activeJob.createdAt;
  const isProcessing = activeJob.status === 'processing';

  useEffect(() => {
    if (!activeStartTime || !isProcessing) {
      if (activeStartTime) {
        setElapsedSec(Math.max(0, Math.floor((Date.now() - activeStartTime) / 1000)));
      } else {
        setElapsedSec(0);
      }
      return;
    }

    setElapsedSec(Math.max(0, Math.floor((Date.now() - activeStartTime) / 1000)));
    const timer = setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - activeStartTime) / 1000)));
    }, 1000);

    return () => clearInterval(timer);
  }, [activeJob.id, activeStartTime, isProcessing]);

  const isPaused = activeJob.status === 'paused';
  const progressPercent = activeJob.totalPages > 0 
    ? Math.round((activeJob.currentPage / activeJob.totalPages) * 100) 
    : 0;

  return (
    <div className="fixed bottom-4 right-0 z-50 w-80 rounded-l-2xl border-y border-l border-white/10 bg-slate-950/90 shadow-2xl backdrop-blur-xl transition-all duration-300 overflow-hidden text-left font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[linear-gradient(124deg,rgba(12,25,48,0.85)_0%,rgba(17,24,39,0.95)_100%)]">
        <div className="flex items-center gap-2">
          <RefreshCw size={13} className={`text-cyan-400 ${activeJob.status === 'processing' ? 'animate-spin' : ''}`} />
          <span className="text-xs font-bold text-slate-100 uppercase tracking-wider">OCR Queue</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 font-mono">
            {visibleQueueJobs.filter(j => ['pending', 'processing'].includes(j.status)).length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-semibold text-slate-300 bg-white/5 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
            {activeJob.status === 'processing' ? 'กำลังรัน' : isPaused ? 'หยุดชั่วคราว' : 'กำลังเริ่ม'}
          </span>
          <button
            type="button"
            onClick={() => setIsQueuePanelExpanded(!isQueuePanelExpanded)}
            className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors cursor-pointer"
            title={isQueuePanelExpanded ? 'ย่อรายละเอียด' : 'ดูรายละเอียดคิว'}
          >
            {isQueuePanelExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-3.5 space-y-3">
        {/* Active Job Details */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="text-[11px] font-bold text-slate-200 truncate flex-1" title={activeJob.filename}>
               {activeJob.filename}
            </div>
            <div className="text-[9px] font-semibold text-cyan-300 capitalize">
              {activeJob.type === 'offline_all' ? 'Offline' : 'AI'} All Pages
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
            <div className="truncate flex-1 pr-2" title={activeJob.message || ''}>
              {activeJob.message || (activeJob.status === 'processing' ? 'กำลังประมวลผล...' : '')}
            </div>
            <div className="shrink-0 font-mono">
              {activeJob.currentPage}/{activeJob.totalPages} หน้า ({progressPercent}%)
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-2.5">
            <div 
              className={`h-full rounded-full transition-all duration-300 ${
                isPaused 
                  ? 'bg-[#839958]' 
                  : activeJob.status === 'failed' 
                    ? 'bg-rose-500' 
                    : 'bg-gradient-to-r from-cyan-500 to-blue-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {/* Active Controls */}
          <div className="flex items-center justify-between gap-2">
            <div className="text-[9px] text-slate-500 shrink-0 font-mono">
              Runtime: <span className="font-semibold text-slate-300">
                {elapsedSec}s
              </span>
            </div>
            <div className="flex items-center gap-1">
              {activeJob.status === 'processing' && (
                <button
                  type="button"
                  onClick={() => useBackgroundQueueStore.getState().pauseJob(activeJob.id)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-[9.5px] font-semibold transition-all bg-[#839958] hover:bg-[#5e7235] text-white border border-[#839958] hover:border-[#5e7235] cursor-pointer"
                  title="หยุดประมวลผลชั่วคราว"
                >
                  <Pause size={10} />
                  <span>หยุด</span>
                </button>
              )}
              {isPaused && (
                <button
                  type="button"
                  onClick={() => useBackgroundQueueStore.getState().resumeJob(activeJob.id)}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 border border-emerald-500/20 text-[9.5px] font-semibold transition-colors cursor-pointer"
                  title="ประมวลผลต่อ"
                >
                  <Play size={10} />
                  <span>ต่อ</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => useBackgroundQueueStore.getState().cancelJob(activeJob.id)}
                className="flex items-center gap-1 px-2 py-1 rounded text-[9.5px] font-semibold transition-all bg-[#0A3323] hover:bg-[#062116] text-white border border-[#0A3323] hover:border-[#062116] cursor-pointer"
                title="ยกเลิกการประมวลผลไฟล์นี้"
              >
                <Trash2 size={10} />
                <span>ยกเลิก</span>
              </button>
            </div>
          </div>
        </div>

        {/* Queue List (แสดงเมื่อขยาย) */}
        {isQueuePanelExpanded && (
          <div className="pt-3 border-t border-white/5 space-y-2">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-left mb-1">
              รายการคิวทั้งหมด ({visibleQueueJobs.length})
            </div>
            <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-1.5 pr-0.5">
              {visibleQueueJobs.map((job) => {
                const isActive = job.id === activeJob.id;
                const isDone = ['completed', 'cancelled', 'failed'].includes(job.status);
                
                let statusBg = 'bg-slate-900 border-white/5 text-slate-400';
                let statusText: string = job.status;
                
                if (job.status === 'processing') {
                  statusBg = 'bg-cyan-500/10 border-cyan-500/20 text-cyan-200';
                  statusText = 'กำลังรัน';
                } else if (job.status === 'pending') {
                  statusBg = 'bg-slate-900 border-white/10 text-slate-300';
                  statusText = 'รอลำดับ';
                } else if (job.status === 'paused') {
                  statusBg = 'bg-amber-500/10 border-amber-500/25 text-amber-200';
                  statusText = 'หยุดค้าง';
                } else if (job.status === 'completed') {
                  statusBg = 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300';
                  statusText = 'สำเร็จ';
                } else if (job.status === 'cancelled') {
                  statusBg = 'bg-slate-950 border-white/5 text-slate-500';
                  statusText = 'ยกเลิกแล้ว';
                } else if (job.status === 'failed') {
                  statusBg = 'bg-rose-500/10 border-rose-500/20 text-rose-300';
                  statusText = 'ล้มเหลว';
                }

                return (
                  <div 
                    key={job.id} 
                    className={`flex items-center justify-between gap-3 p-2 rounded-xl border transition-all ${
                      isActive 
                        ? 'bg-white/5 border-cyan-500/30' 
                        : 'bg-white/2 border-white/5'
                    }`}
                  >
                    <div className="min-w-0 flex-1 text-left">
                      <div className="text-[10px] font-bold text-slate-200 truncate" title={job.filename}>
                        {job.filename}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-slate-400">
                        <span className="capitalize">{job.type === 'offline_all' ? 'Offline' : 'AI'} All</span>
                        <span>•</span>
                        <span>{job.currentPage}/{job.totalPages} หน้า</span>
                        {job.startTime && (
                          <>
                            <span>•</span>
                            <span>
                              {(() => {
                                const end = job.completedTime || Date.now();
                                const diff = Math.max(0, Math.floor((end - job.startTime) / 1000));
                                if (diff < 60) return `${diff}s`;
                                return `${Math.floor(diff / 60)}m ${diff % 60}s`;
                              })()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[8.5px] px-1.5 py-0.5 rounded-md border ${statusBg}`}>
                        {statusText}
                      </span>
                      {!isDone && !isActive && (
                        <button
                          type="button"
                          onClick={() => useBackgroundQueueStore.getState().moveJobUp(job.id)}
                          className="px-1.5 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/20 text-[8.5px] font-semibold transition-colors cursor-pointer"
                          title="เลื่อนขึ้นในคิว"
                        >
                          เลื่อนขึ้น
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => useBackgroundQueueStore.getState().removeJob(job.id)}
                        className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors cursor-pointer"
                        title="ลบออกจากรายการ"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

BackgroundQueuePanelContent.displayName = 'BackgroundQueuePanelContent';

export const BackgroundQueuePanel: React.FC = React.memo(() => {
  const queueJobs = useBackgroundQueueStore((state) => state.jobs);

  const visibleQueueJobs = queueJobs.filter((j) => !j.type.endsWith('_single'));
  const activeJob = visibleQueueJobs.find((j) => j.status === 'processing') || 
                    visibleQueueJobs.find((j) => j.status === 'paused') ||
                    visibleQueueJobs.find((j) => j.status === 'pending');

  if (visibleQueueJobs.length === 0 || !activeJob) {
    return null;
  }

  return (
    <BackgroundQueuePanelContent 
      visibleQueueJobs={visibleQueueJobs} 
      activeJob={activeJob} 
    />
  );
});

BackgroundQueuePanel.displayName = 'BackgroundQueuePanel';
