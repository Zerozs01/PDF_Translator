import React from 'react';
import { RefreshCw } from 'lucide-react';

interface GlobalLoadingOverlayProps {
  message: string;
  progress?: number;
}

/**
 * Non-blocking progress toast shown in the bottom-right corner.
 * Does NOT block pointer events — users can still view and interact
 * with the PDF canvas while a background task (OCR/translation) runs.
 */
export const GlobalLoadingOverlay: React.FC<GlobalLoadingOverlayProps> = ({
  message,
  progress,
}) => {
  const hasProgress = typeof progress === 'number' && progress >= 0 && progress <= 100;

  return (
    <div
      className="fixed bottom-5 right-5 z-[9999] pointer-events-none"
      role="status"
      aria-live="polite"
    >
      <div className="relative flex items-start gap-3 max-w-xs w-full px-4 py-3 rounded-xl border border-white/10 bg-slate-900/90 backdrop-blur-md shadow-2xl text-left">
        {/* Glow accent */}
        <div className="absolute -inset-px rounded-xl bg-gradient-to-r from-cyan-500/10 to-indigo-500/10 pointer-events-none" />

        {/* Spinner */}
        <div className="relative mt-0.5 shrink-0 flex items-center justify-center w-7 h-7">
          <div className="w-7 h-7 rounded-full border-2 border-white/5 border-t-cyan-400 animate-spin" />
          <RefreshCw size={13} className="absolute text-cyan-400 animate-pulse" />
        </div>

        {/* Text + bar */}
        <div className="flex-1 min-w-0">
          <p className="text-slate-100 font-medium text-xs leading-snug truncate">
            {message}
          </p>

          {hasProgress && (
            <div className="mt-2">
              <div className="w-full bg-slate-950/60 rounded-full h-1.5 overflow-hidden border border-white/5">
                <div
                  className="bg-gradient-to-r from-cyan-400 to-indigo-500 h-full rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-end mt-1">
                <span className="text-[10px] font-mono text-cyan-400 font-semibold">
                  {Math.round(progress!)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
