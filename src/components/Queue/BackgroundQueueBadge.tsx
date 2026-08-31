import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useBackgroundQueueStore } from '../../stores/useBackgroundQueueStore';

export const BackgroundQueueBadge = React.memo(() => {
  const liveJobs = useBackgroundQueueStore((s) => s.jobs);
  const [showQueuePanel, setShowQueuePanel] = useState(false);

  const activeJobs = liveJobs.filter(j => ['processing', 'queued', 'pending'].includes(j.status));
  const runningJob = activeJobs.find(j => j.status === 'processing');

  if (activeJobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[190] flex flex-col items-start gap-1.5">
      {/* Main badge */}
      <button
        type="button"
        onClick={() => setShowQueuePanel(p => !p)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0f1117]/90 border border-white/10 shadow-xl backdrop-blur-md hover:border-[#2B9BFF]/40 transition-all cursor-pointer"
      >
        <div className="relative flex items-center justify-center w-4 h-4 shrink-0">
          <div className="absolute w-3 h-3 rounded-full bg-[#2B9BFF] opacity-30 animate-ping" />
          <div className="w-2 h-2 rounded-full bg-[#2B9BFF]" />
        </div>
        <div className="text-left min-w-0">
          {runningJob ? (
            <>
              <p className="text-[10px] font-semibold text-slate-200 truncate max-w-[140px]">{runningJob.filename}</p>
              <p className="text-[9px] text-[#2B9BFF]">
                หน้า {runningJob.currentPage}/{runningJob.totalPages} · {runningJob.progress}%
              </p>
            </>
          ) : (
            <p className="text-[10px] font-semibold text-slate-400">{activeJobs.length} งานรอคิว...</p>
          )}
        </div>
        <span className="ml-1 text-[9px] text-slate-500 font-mono bg-white/5 px-1.5 py-0.5 rounded-md border border-white/[0.08]">
          {activeJobs.length}
        </span>
      </button>

      {/* Mini queue panel */}
      {showQueuePanel && (
        <div className="w-64 rounded-xl bg-[#0f1117]/95 border border-white/10 shadow-2xl backdrop-blur-xl overflow-hidden animate-in slide-in-from-bottom-2 duration-150">
          <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-300 tracking-wider uppercase">Queue</span>
            <button 
              type="button"
              onClick={() => setShowQueuePanel(false)} 
              className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              <X size={11} />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto custom-scrollbar divide-y divide-white/5">
            {activeJobs.map((job, idx) => {
              const isRunning = job.status === 'processing';
              return (
                <div key={job.id} className={`px-3 py-2 flex items-center gap-2 ${isRunning ? 'bg-[#2B9BFF]/5' : ''}`}>
                  <div className="shrink-0">
                    {isRunning ? (
                      <div className="w-1.5 h-1.5 rounded-full bg-[#2B9BFF] animate-pulse" />
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-semibold text-slate-300 truncate">{job.filename}</p>
                    <p className="text-[8px] text-slate-500 truncate">{job.message}</p>
                  </div>
                  {isRunning && (
                    <span className="text-[8px] text-[#2B9BFF] font-mono shrink-0">{job.progress}%</span>
                  )}
                  {!isRunning && (
                    <span className="text-[8px] text-slate-600 shrink-0">#{idx + 1}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

BackgroundQueueBadge.displayName = 'BackgroundQueueBadge';
