import React from 'react';
import { 
  Clock, Star, FolderOpen, Settings2, Plus, Home as HomeIcon,
} from 'lucide-react';
import type { DBTag, DBProject } from '../../../types/electron.d';
import type { SidebarPage } from '../libraryUtils';
import { TagPill } from '../TagPill';
import { resolveThemedAccent } from '../libraryUtils';
import { LibrarySettingsPanel } from '../Panels/LibrarySettingsPanel';
import { OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT } from '../../../services/vision/ocr-timeout';

export interface LibrarySidebarProps {
  activePage: SidebarPage;
  setActivePage: (page: SidebarPage) => void;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  filterType: string;
  selectedTagId: number | null;
  setSelectedTagId: (id: number | null) => void;
  selectedProjectId: number | null;
  loadRecentDocuments: () => void | Promise<unknown>;
  loadFavoriteDocuments: () => void | Promise<unknown>;
  loadDocumentsByTag: (tagId: number) => void;
  loadDocumentsByProject: (projectId: number) => void;
  tags: DBTag[];
  openTagDialog: (documentId?: number | null) => void;
  openTagMenu: (tag: DBTag, event: React.MouseEvent<HTMLButtonElement>) => void;
  setActiveTagMenu: (val: { tag: DBTag; position: { x: number; y: number } } | null) => void;
  openProjectDialog: (documentId?: number | null, parentId?: number | null) => void;
  renderProjectTree: (parentId: number | null) => React.ReactNode;
  draggedProjectIdRef: React.MutableRefObject<number | null>;
  draggedProjectId: number | null;
  handleDropOnProject: (projectId: number | null, event?: React.DragEvent) => Promise<void>;
  gpuInfo: {
    gpus: string[];
    hasDirectML: boolean;
    hasCuda: boolean;
    mode: 'CUDA' | 'DirectML' | 'CPU';
    gpuVendor: 'intel' | 'amd' | 'nvidia' | 'unknown';
  } | null;
  getGpuModeLabel: (info: any) => string;
  // Settings Panel Props
  geminiApiKeyDraft: string;
  setGeminiApiKeyDraft: (val: string) => void;
  showGeminiApiKey: boolean;
  setShowGeminiApiKey: (val: boolean | ((prev: boolean) => boolean)) => void;
  saveGeminiApiKey: () => Promise<unknown>;
  clearGeminiApiKey: () => Promise<unknown>;
  isGeminiApiKeyLoaded: boolean;
  isGeminiApiKeySaving: boolean;
  hasGeminiApiKey: boolean;
  geminiApiKeySource: 'electron' | 'environment' | 'empty' | 'secure-storage' | string;
  geminiInputPlaceholder: string;
  geminiStatusClass: string;
  geminiStatusLabel: string;
  geminiApiKeyError: string | null;
  paddleThaiStatus: { installed: boolean; checking: boolean; downloading: boolean };
  paddleEnglishStatus: { installed: boolean; checking: boolean; downloading: boolean };
  handleDownloadModel: (lang: 'th' | 'en') => Promise<void>;
  isThaiTargetLanguage: boolean;
  overlayFontPreset: any;
  setOverlayFontPreset: (preset: any) => void;
  selectedFontAvailable: boolean | null;
  ocrOptions: any;
  setOCROptions: (opts: any) => void;
}

export const LibrarySidebar: React.FC<LibrarySidebarProps> = React.memo(({
  activePage,
  setActivePage,
  isSidebarOpen,
  setIsSidebarOpen,
  filterType,
  selectedTagId,
  setSelectedTagId,
  selectedProjectId,
  loadRecentDocuments,
  loadFavoriteDocuments,
  loadDocumentsByTag,
  loadDocumentsByProject,
  tags,
  openTagDialog,
  openTagMenu,
  setActiveTagMenu,
  openProjectDialog,
  renderProjectTree,
  draggedProjectIdRef,
  draggedProjectId,
  handleDropOnProject,
  gpuInfo,
  getGpuModeLabel,
  geminiApiKeyDraft,
  setGeminiApiKeyDraft,
  showGeminiApiKey,
  setShowGeminiApiKey,
  saveGeminiApiKey,
  clearGeminiApiKey,
  isGeminiApiKeyLoaded,
  isGeminiApiKeySaving,
  hasGeminiApiKey,
  geminiApiKeySource,
  geminiInputPlaceholder,
  geminiStatusClass,
  geminiStatusLabel,
  geminiApiKeyError,
  paddleThaiStatus,
  paddleEnglishStatus,
  handleDownloadModel,
  isThaiTargetLanguage,
  overlayFontPreset,
  setOverlayFontPreset,
  selectedFontAvailable,
  ocrOptions,
  setOCROptions,
}) => {
  return (
    <>
      {/* Left Navigation Sidebar */}
      <div className="w-16 bg-[#0e0f11]/86 border-r border-white/6 backdrop-blur-xl flex flex-col items-center py-4 titlebar-drag">
        <button
          onClick={() => { setActivePage('home'); loadRecentDocuments(); }}
          className={`p-3 rounded-xl mb-2 transition-all ${
            activePage === 'home'
              ? 'bg-[#262a30] text-slate-50 ring-1 ring-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
              : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-100'
          }`}
          title="Home"
        >
          <HomeIcon size={20} />
        </button>
        <button
          onClick={() => { setActivePage('projects'); setIsSidebarOpen(true); }}
          className={`p-3 rounded-xl mb-2 transition-all ${
            activePage === 'projects'
              ? 'bg-[#262a30] text-slate-50 ring-1 ring-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
              : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-100'
          }`}
          title="Projects"
        >
          <FolderOpen size={20} />
        </button>

        <div className="flex-1" />

        <button
          onClick={() => { setActivePage('settings'); setIsSidebarOpen(true); }}
          className={`p-3 rounded-xl transition-all ${
            activePage === 'settings'
              ? 'bg-[#262a30] text-slate-50 ring-1 ring-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
              : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-100'
          }`}
          title="Settings"
        >
          <Settings2 size={20} />
        </button>
      </div>

      {/* Secondary Sidebar */}
      <div className={`transition-all duration-300 ease-in-out border-r border-white/6 bg-[#111214]/74 backdrop-blur-xl flex flex-col overflow-hidden shrink-0 titlebar-drag ${
        isSidebarOpen ? 'w-56 p-4 opacity-100' : 'w-0 p-0 border-r-0 opacity-0 pointer-events-none'
      }`}>
        {activePage === 'home' ? (
          <>
            {/* Quick Filters */}
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-2 px-0.5 select-none titlebar-drag">Library</h2>
            <div className="space-y-1 mb-3">
              <button
                onClick={() => {
                  setSelectedTagId(null);
                  loadRecentDocuments();
                }}
                className={`w-full py-1.5 px-2.5 rounded-lg text-left text-xs flex items-center gap-2.5 border transition-all ${
                  filterType === 'recent'
                    ? 'border-white/12 bg-[#25282d] text-slate-100'
                    : 'border-transparent hover:border-white/8 hover:bg-white/[0.04] text-slate-300'
                }`}
              >
                <Clock size={14} /> Recent
              </button>
              <button
                onClick={() => {
                  setSelectedTagId(null);
                  loadFavoriteDocuments();
                }}
                className={`w-full py-1.5 px-2.5 rounded-lg text-left text-xs flex items-center gap-2.5 border transition-all ${
                  filterType === 'favorites'
                    ? 'border-white/12 bg-[#25282d] text-slate-100'
                    : 'border-transparent hover:border-white/8 hover:bg-white/[0.04] text-slate-300'
                }`}
              >
                <Star size={14} /> Favorites
              </button>
            </div>

            {/* Subtle Divider Line */}
            <div className="h-px bg-white/6 my-3 w-full shrink-0" />

            {/* Tags */}
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-2 px-0.5 flex items-center justify-between">
              Tags
              <button
                onClick={() => openTagDialog()}
                className="p-1 rounded hover:bg-white/10"
                title="Create Tag"
              >
                <Plus size={12} />
              </button>
            </h2>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <TagPill
                tag={{ id: 0, name: 'No tags', color: '#64748b', created_at: '' }}
                displayColor="#64748b"
                isSelected={selectedTagId === 0}
                onContextMenu={(event) => event.preventDefault()}
                onClick={() => {
                  setActiveTagMenu(null);
                  if (selectedTagId === 0) {
                    setSelectedTagId(null);
                    if (selectedProjectId !== null) {
                      loadDocumentsByProject(selectedProjectId);
                    } else {
                      loadRecentDocuments();
                    }
                  } else {
                    loadDocumentsByTag(0);
                  }
                }}
              />
              {tags.map((tag, index) => (
                <TagPill 
                  key={tag.id} 
                  tag={tag} 
                  displayColor={tag.color || resolveThemedAccent(index)}
                  isSelected={selectedTagId === tag.id}
                  onContextMenu={(event) => openTagMenu(tag, event)}
                  onClick={() => {
                    setActiveTagMenu(null);
                    if (selectedTagId === tag.id) {
                      setSelectedTagId(null);
                      if (selectedProjectId !== null) {
                        loadDocumentsByProject(selectedProjectId);
                      } else {
                        loadRecentDocuments();
                      }
                    } else {
                      loadDocumentsByTag(tag.id);
                    }
                  }}
                />
              ))}
            </div>

            {/* Subtle Divider Line */}
            <div className="h-px bg-white/6 my-3 w-full shrink-0" />

            {/* Projects */}
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-2 px-0.5 flex items-center justify-between">
              Projects
              <button
                onClick={() => openProjectDialog()}
                className="p-1 rounded hover:bg-white/10"
                title="Create Folder"
              >
                <Plus size={12} />
              </button>
            </h2>
            <div 
              onDragOver={(event) => {
                if (draggedProjectIdRef.current !== null || draggedProjectId !== null) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => {
                if (draggedProjectIdRef.current !== null || draggedProjectId !== null) {
                  event.preventDefault();
                  void handleDropOnProject(null, event);
                }
              }}
              className="flex-1 overflow-y-auto space-y-1 custom-scrollbar min-h-[120px] rounded-xl"
            >
              {renderProjectTree(null)}
            </div>

            {/* Hardware Acceleration GPU Status */}
            <div className="mt-4 border-t border-white/6 pt-4 shrink-0">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.22em] mb-2 block">
                Hardware Acceleration
              </label>
              <div className="rounded-xl border border-white/8 bg-slate-950/40 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-400">GPU Acceleration</span>
                  <span className={`inline-flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                    gpuInfo && gpuInfo.mode !== 'CPU'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>
                    <span className={`h-1 w-1 rounded-full ${gpuInfo && gpuInfo.mode !== 'CPU' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                    {getGpuModeLabel(gpuInfo)}
                  </span>
                </div>
                <div className="text-[9px] text-slate-500 leading-normal">
                  <div className="font-semibold text-slate-300 truncate" title={Array.isArray(gpuInfo?.gpus) ? gpuInfo.gpus.join(', ') : 'CPU'}>
                    Device: {gpuInfo?.gpus?.[0] || 'CPU'}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : activePage === 'projects' ? (
          <>
            {/* Projects Page Sidebar */}
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 titlebar-drag select-none">
              <FolderOpen className="text-slate-300" size={20} /> Projects
            </h2>
            <button
              onClick={() => openProjectDialog()}
              className="w-full p-3 rounded-lg bg-[#25282d] hover:bg-[#2b2f35] text-white text-sm font-medium flex items-center justify-center gap-2 mb-4 border border-white/10 transition-all"
            >
              <Plus size={16} /> New Project
            </button>
            <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
              {renderProjectTree(null)}
            </div>
          </>
        ) : (
          <LibrarySettingsPanel
            geminiApiKeyDraft={geminiApiKeyDraft}
            setGeminiApiKeyDraft={setGeminiApiKeyDraft}
            showGeminiApiKey={showGeminiApiKey}
            setShowGeminiApiKey={setShowGeminiApiKey}
            saveGeminiApiKey={saveGeminiApiKey}
            clearGeminiApiKey={clearGeminiApiKey}
            isGeminiApiKeyLoaded={isGeminiApiKeyLoaded}
            isGeminiApiKeySaving={isGeminiApiKeySaving}
            hasGeminiApiKey={hasGeminiApiKey}
            geminiApiKeySource={geminiApiKeySource}
            geminiInputPlaceholder={geminiInputPlaceholder}
            geminiStatusClass={geminiStatusClass}
            geminiStatusLabel={geminiStatusLabel}
            geminiApiKeyError={geminiApiKeyError}
            paddleThaiStatus={paddleThaiStatus}
            paddleEnglishStatus={paddleEnglishStatus}
            handleDownloadModel={handleDownloadModel}
            gpuInfo={gpuInfo}
            getGpuModeLabel={getGpuModeLabel}
            isThaiTargetLanguage={isThaiTargetLanguage}
            overlayFontPreset={overlayFontPreset}
            setOverlayFontPreset={setOverlayFontPreset}
            selectedFontAvailable={selectedFontAvailable}
            ocrOptions={ocrOptions}
            setOCROptions={setOCROptions}
          />
        )}
      </div>
    </>
  );
});

LibrarySidebar.displayName = 'LibrarySidebar';
