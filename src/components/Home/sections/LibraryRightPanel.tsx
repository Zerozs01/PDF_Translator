import React, { useState } from 'react';
import { 
  Upload, ChevronRight, Check, Shield, Compass, Sparkles, Flame, ScrollText 
} from 'lucide-react';
import type { TranslationMode, SafetySettings } from '../../../stores/useProjectStore';
import { SAFETY_LEVEL_PREVIEW } from '../libraryUtils';
import { BackgroundQueueMonitor } from '../Panels/BackgroundQueueMonitor';
import type { BackgroundJob } from '../../../stores/useBackgroundQueueStore';

export interface LibraryRightPanelProps {
  isDragging: boolean;
  setIsDragging: (val: boolean) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleBrowse: () => void;
  translationMode: TranslationMode;
  setTranslationMode: (mode: TranslationMode) => void;
  safetySettings: SafetySettings;
  updateSafetySettings: (settings: Partial<SafetySettings>) => void;
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

export const LibraryRightPanel: React.FC<LibraryRightPanelProps> = React.memo(({
  isDragging,
  setIsDragging,
  handleDrop,
  handleBrowse,
  translationMode,
  setTranslationMode,
  safetySettings,
  updateSafetySettings,
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
  const [isProfileListOpen, setIsProfileListOpen] = useState(false);

  const profiles = [
    { id: 'adaptive', name: 'Flexibility', icon: Compass, activeBg: 'linear-gradient(180deg, rgba(20,184,166,0.22) 0%, rgba(19,48,58,0.92) 100%)', textTheme: 'text-[#E6FFF9]', iconTheme: 'text-[#99F6E4]' },
    { id: 'manga', name: 'Manga Style', icon: Sparkles, activeBg: 'linear-gradient(180deg, rgba(139,92,246,0.28) 0%, rgba(46,28,82,0.92) 100%)', textTheme: 'text-[#F4E8FF]', iconTheme: 'text-[#D8B4FE]' },
    { id: 'manhwa', name: 'Manhwa Style', icon: Flame, activeBg: 'linear-gradient(180deg, rgba(236,72,153,0.24) 0%, rgba(66,24,44,0.92) 100%)', textTheme: 'text-[#FFE7F3]', iconTheme: 'text-[#F9A8D4]' },
    { id: 'official', name: 'Official Doc', icon: ScrollText, activeBg: 'linear-gradient(180deg, rgba(67,135,255,0.2) 0%, rgba(17,28,48,0.9) 100%)', textTheme: 'text-[#EDF4FF]', iconTheme: 'text-[#A8CFFF]' }
  ] as const;
  const activeProfile = profiles.find(p => p.id === translationMode) || profiles[0];
  const ActiveIcon = activeProfile.icon;

  return (
    <div className="w-72 bg-[#1b1d22]/96 border-l border-white/6 p-5 flex flex-col overflow-y-auto backdrop-blur-xl custom-scrollbar titlebar-no-drag">
      <div className="flex items-center justify-between mb-3 titlebar-drag select-none pr-36">
        <h2 className="text-base font-bold flex items-center gap-1">
          Import
        </h2>
      </div>

      {/* Quick Upload */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`p-4 rounded-xl border-2 border-dashed mb-4 text-center transition-all titlebar-no-drag ${
          isDragging ? 'border-white/18 bg-white/[0.04]' : 'border-white/10 hover:border-white/16 bg-[#13151a]/92'
        }`}
      >
        <Upload size={24} className="mx-auto mb-2 text-slate-300" />
        <p className="text-xs text-slate-400">Drop file here</p>
        <button
          onClick={handleBrowse}
          className="mt-3 inline-block px-4 py-1.5 bg-slate-900/85 border border-white/10 hover:bg-slate-800 rounded-lg text-xs cursor-pointer"
        >
          Browse
        </button>
      </div>

      {/* Profile Selection */}
      <div className="mb-6">
        <label className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-3 block">Profile</label>
        <div className="relative">
          <div className="relative space-y-1">
            {/* Main Active Button */}
            <button
              onClick={() => setIsProfileListOpen(!isProfileListOpen)}
              className={`w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
                isProfileListOpen 
                  ? 'border-[#2B9BFF]/60 bg-slate-900/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' 
                  : activeProfile.id === 'adaptive' ? 'border-[#14B8A6]/45' 
                  : activeProfile.id === 'manga' ? 'border-[#8B5CF6]/45' 
                  : activeProfile.id === 'manhwa' ? 'border-[#EC4899]/45' 
                  : 'border-[#4387FF]/42'
              }`}
              style={!isProfileListOpen ? { background: activeProfile.activeBg } : undefined}
            >
              <div className="flex items-center gap-2">
                <ActiveIcon size={14} className={activeProfile.iconTheme} />
                <span className={`font-semibold text-sm ${activeProfile.textTheme}`}>{activeProfile.name}</span>
              </div>
              <ChevronRight 
                size={14} 
                className={`text-slate-400 transition-transform duration-200 ${isProfileListOpen ? 'rotate-90 text-white' : ''}`} 
              />
            </button>

            {/* Expanded Dropdown List */}
            {isProfileListOpen && (
              <div className="absolute left-0 right-0 mt-1 z-[160] rounded-xl border border-white/10 bg-slate-950/98 p-1 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl flex flex-col gap-0.5 max-h-56 overflow-y-auto">
                {profiles.map((prof) => {
                  const isSelected = prof.id === translationMode;
                  const Icon = prof.icon;
                  return (
                    <button
                      key={prof.id}
                      onClick={() => {
                        setTranslationMode(prof.id);
                        setIsProfileListOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition-all ${
                        isSelected
                          ? 'bg-white/10 text-white font-medium'
                          : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon size={13} className={isSelected ? prof.iconTheme : 'text-slate-500'} />
                        <span className={isSelected ? 'font-semibold' : ''}>{prof.name}</span>
                      </div>
                      {isSelected && <Check size={12} className="text-[#5CC6F2]" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Safety Settings (Collapsed by default) */}
      <details className="mb-1">
        <summary className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-0 cursor-pointer flex items-center gap-2">
          <Shield size={12} /> Safety Filters
        </summary>
        <div className="space-y-4 mt-3">
          {(Object.keys(safetySettings) as Array<keyof SafetySettings>).map((key) => {
            const value = safetySettings[key];
            return (
              <div key={key}>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs capitalize text-slate-300">{String(key)}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-slate-900/85 border border-white/10 rounded text-slate-400 uppercase">{String(value)}</span>
                </div>
                <p className="text-[10px] text-slate-500 mb-1.5 leading-relaxed">
                  {SAFETY_LEVEL_PREVIEW[key][value]}
                </p>
                <input
                  type="range"
                  min="0"
                  max="3"
                  step="1"
                  value={['off', 'low', 'medium', 'high'].indexOf(value)}
                  onChange={(e) => {
                    const levels = ['off', 'low', 'medium', 'high'] as const;
                    updateSafetySettings({ [key]: levels[parseInt(e.target.value, 10)] });
                  }}
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[#2B9BFF]"
                />
              </div>
            );
          })}
        </div>
      </details>

      {/* Background Queue Monitor */}
      <BackgroundQueueMonitor
        jobs={jobs}
        clearCompletedJobs={clearCompletedJobs}
        moveJobUp={moveJobUp}
        moveJobDown={moveJobDown}
        pauseJob={pauseJob}
        resumeJob={resumeJob}
        cancelJob={cancelJob}
        removeJob={removeJob}
        handleOpenJobFile={handleOpenJobFile}
      />

      <div className="mt-auto" />
    </div>
  );
});

LibraryRightPanel.displayName = 'LibraryRightPanel';
