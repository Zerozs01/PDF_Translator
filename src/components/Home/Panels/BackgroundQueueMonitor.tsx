import React from 'react';
import { Cpu, ChevronUp, ChevronDown, Pause, Play, X, ArrowRight, Trash2 } from 'lucide-react';
import type { BackgroundJob } from '../../../stores/useBackgroundQueueStore';

export interface BackgroundQueueMonitorProps {
  jobs: BackgroundJob[];
  clearCompletedJobs: () => void;
  moveJobUp: (id: string) => void;
  moveJobDown: (id: string) => void;
  pauseJob: (id: string) => void;
  resumeJob: (id: string) => void;
  cancelJob: (id: string) => void;
  removeJob: (id: string) => void;
  handleOpenJobFile: (job: BackgroundJob) => void;
}

export const BackgroundQueueMonitor: React.FC<BackgroundQueueMonitorProps> = ({
  jobs,
  clearCompletedJobs,
  moveJobUp,
  moveJobDown,
  pauseJob,
  resumeJob,
  cancelJob,
  removeJob,
  handleOpenJobFile,
}) => {
  return (
    <div className="mt-4 border-t border-white/6 pt-5">
      <div className="flex items-center justify-between mb-3">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] flex items-center gap-1.5">
          <Cpu size={12} className="text-slate-400" /> Queue Monitor
        </label>
        {jobs.some((j) => ['completed', 'failed', 'cancelled'].includes(j.status)) && (
          <button
            onClick={clearCompletedJobs}
            className="text-[10px] text-[#2B9BFF] hover:text-[#5CC6F2] transition-colors"
          >
            Clear Finished
          </button>
        )}
      </div>

      {jobs.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic py-3 text-center bg-[#13151a]/40 rounded-xl border border-white/4">
          No active background tasks
        </p>
      ) : (
        <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
          {jobs.map((job) => {
            const isActive = job.status === 'processing';
            const isPending = job.status === 'pending';
            const isJobPaused = job.status === 'paused';
            const isFinished = ['completed', 'failed', 'cancelled'].includes(job.status);

            return (
              <div
                key={job.id}
                className={`p-2.5 rounded-xl border transition-all text-left ${
                  isActive
                    ? 'border-[#2B9BFF]/35 bg-[#17191d]/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
                    : 'bg-[#13151a]/70 border-white/6 hover:border-white/10'
                }`}
              >
                <div className="flex items-start justify-between gap-1.5 mb-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-200 truncate" title={job.filename}>
                      {job.filename}
                    </p>
                    <p className="text-[9px] text-slate-500 truncate mt-0.5 capitalize">
                      {job.type.replace('_all', ' all pages')} • {job.engine}
                    </p>
                  </div>

                  {!isFinished && (
                    <div className="flex flex-col items-center gap-0.5 shrink-0 mr-0.5">
                      <button
                        onClick={() => moveJobUp(job.id)}
                        disabled={jobs.indexOf(job) === 0}
                        className="p-0.5 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                        title="เลื่อนขึ้นในคิว"
                      >
                        <ChevronUp size={10} />
                      </button>
                      <button
                        onClick={() => moveJobDown(job.id)}
                        disabled={jobs.indexOf(job) === jobs.length - 1}
                        className="p-0.5 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                        title="เลื่อนลงในคิว"
                      >
                        <ChevronDown size={10} />
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-1 shrink-0">
                    {isActive && (
                      <button
                        onClick={() => pauseJob(job.id)}
                        className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 transition-colors"
                        title="Pause"
                      >
                        <Pause size={10} />
                      </button>
                    )}
                    {isJobPaused && (
                      <button
                        onClick={() => resumeJob(job.id)}
                        className="p-1 rounded bg-[#2B9BFF]/20 hover:bg-[#2B9BFF]/35 text-[#2B9BFF] hover:text-white transition-colors"
                        title="Resume"
                      >
                        <Play size={10} />
                      </button>
                    )}
                    {!isFinished && (
                      <button
                        onClick={() => cancelJob(job.id)}
                        className="p-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 hover:text-rose-200 transition-colors"
                        title="Cancel"
                      >
                        <X size={10} />
                      </button>
                    )}
                    {isFinished && (
                      <div className="flex items-center gap-1 shrink-0">
                        {job.status === 'completed' && (
                          <button
                            onClick={() => handleOpenJobFile(job)}
                            className="p-1 rounded bg-[#EAB308]/15 hover:bg-[#EAB308]/25 text-[#EAB308] hover:text-yellow-400 transition-all flex items-center justify-center"
                            title="เปิดไฟล์นี้"
                          >
                            <ArrowRight size={10} className="animate-pulse" />
                          </button>
                        )}
                        <button
                          onClick={() => removeJob(job.id)}
                          className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-slate-300 transition-colors"
                          title="Remove"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center text-[9px]">
                    <span
                      className={`truncate max-w-[175px] ${
                        isActive
                          ? 'text-[#2B9BFF] animate-pulse font-medium'
                          : isJobPaused
                            ? 'text-amber-400/90'
                            : job.status === 'completed'
                              ? 'text-emerald-400/90'
                              : job.status === 'failed'
                                ? 'text-rose-400/90'
                                : job.status === 'cancelled'
                                  ? 'text-slate-400/90'
                                  : 'text-slate-400'
                      }`}
                    >
                      {job.message}
                      {job.startTime && (
                        <span className="text-[8px] text-slate-500 font-normal ml-1">
                          ({(() => {
                            const end = job.completedTime || Date.now();
                            const diff = Math.max(0, Math.floor((end - job.startTime) / 1000));
                            if (diff < 60) return `${diff}s`;
                            return `${Math.floor(diff / 60)}m ${diff % 60}s`;
                          })()})
                        </span>
                      )}
                    </span>
                    <span className="font-semibold text-slate-300">{job.progress}%</span>
                  </div>
                  <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden border border-white/4">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isActive
                          ? 'bg-[#2B9BFF]'
                          : isJobPaused
                            ? 'bg-amber-400/80'
                            : job.status === 'completed'
                              ? 'bg-emerald-400/80'
                              : job.status === 'failed'
                                ? 'bg-rose-500/80'
                                : job.status === 'cancelled'
                                  ? 'bg-slate-500'
                                  : 'bg-slate-700'
                      }`}
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
