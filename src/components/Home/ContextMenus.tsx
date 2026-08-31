import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Star, Heart, Cpu, Folder, Check, Tag, RefreshCw, Trash2, Edit3, FolderPlus, Info
} from 'lucide-react';
import type { DBDocument, DBTag, DBProject } from '../../types/electron.d';
import { useLayerStore } from '../../stores/useLayerStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import {
  formatFileSize,
  resolveThemedAccent,
  hexToRgba,
  resolveStableAccent,
  type MenuPosition,
} from './libraryUtils';

export const DocumentContextMenu: React.FC<{
  doc: DBDocument;
  position: MenuPosition;
  documentTags: DBTag[];
  tags: DBTag[];
  projects: DBProject[];
  onClose: () => void;
  onToggleFavorite: () => void;
  onToggleTag: (tag: DBTag) => void;
  onMoveToProject: (projectId: number | null) => void;
  onDelete: () => void;
  onCreateTag: () => void;
  onOCRAllPages: () => void;
  onUpdateRating: (rating: number) => void;
}> = ({
  doc,
  position,
  documentTags,
  tags,
  projects,
  onClose,
  onToggleFavorite,
  onToggleTag,
  onMoveToProject,
  onDelete,
  onCreateTag,
  onOCRAllPages,
  onUpdateRating
}) => {
  const assignedTagIds = useMemo(() => new Set(documentTags.map(tag => tag.id)), [documentTags]);
  const projectAccentById = useMemo(
    () => new Map(projects.map((project, index) => [project.id, project.color || resolveThemedAccent(index)])),
    [projects]
  );
  const tagAccentById = useMemo(
    () => new Map(tags.map((tag, index) => [tag.id, resolveThemedAccent(index)])),
    [tags]
  );

  const [cacheSize, setCacheSize] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    if (window.electronAPI?.db?.getDocumentCacheSize) {
      window.electronAPI.db.getDocumentCacheSize(doc.id)
        .then((size) => {
          if (active) setCacheSize(size);
        })
        .catch((err) => console.error('Failed to get cache size:', err));
    } else {
      setCacheSize(0);
    }
    return () => {
      active = false;
    };
  }, [doc.id]);

  return createPortal(
    <div
      data-library-floating-menu="true"
      className="fixed z-[160] w-72 rounded-2xl border border-white/15 bg-slate-950/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-b border-white/10 px-2 pb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-slate-100" title={doc.filename}>{doc.filename}</div>
          <div className="mt-1 flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Rating:</span>
              <div className="flex items-center">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => onUpdateRating((doc.rating || 0) === star ? 0 : star)}
                    className="p-0.5 text-slate-500 hover:text-amber-400 transition-colors"
                  >
                    <Star
                      size={13}
                      className={star <= (doc.rating || 0) ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div 
              className="flex items-center gap-1 text-[10px] shrink-0 bg-slate-900/80 border border-white/10 px-1.5 py-0.5 rounded-md"
              title="ขนาดข้อมูลแคช OCR และการแปลของเอกสารนี้"
            >
              <span className="text-[9px] text-slate-500 uppercase font-bold tracking-wider">Cache:</span>
              <span className={cacheSize && cacheSize > 0 ? "text-amber-400 font-semibold" : "text-slate-500"}>
                {cacheSize !== null ? formatFileSize(cacheSize) : '...'}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={() => {
            onToggleFavorite();
            onClose();
          }}
          className={`p-1.5 rounded-lg border transition-all shrink-0 ${
            doc.is_favorite 
              ? 'border-rose-500/25 bg-rose-500/10 text-rose-500' 
              : 'border-white/10 bg-slate-900/30 text-slate-400 hover:text-slate-200 hover:bg-white/5'
          }`}
          title={doc.is_favorite ? 'Remove Favorite' : 'Add Favorite'}
        >
          <Heart size={13} fill={doc.is_favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="space-y-1 px-1 py-2">
        <button
          onClick={() => {
            onOCRAllPages();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-[#2B9BFF] transition-colors hover:bg-[#2B9BFF]/10 font-medium"
        >
          <Cpu size={12} />
          OCR Panel
        </button>
      </div>

      <div className="border-t border-white/10 px-2 py-2">
        <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <Folder size={11} />
          Folder
        </div>
        <div className="max-h-28 space-y-1 overflow-y-auto custom-scrollbar">
          <button
            onClick={() => {
              onMoveToProject(null);
              onClose();
            }}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
              doc.project_id === null
                ? 'bg-[#2a2d33] text-slate-100'
                : 'text-slate-300 hover:bg-white/10'
            }`}
          >
            <span>No Folder</span>
            {doc.project_id === null && <Check size={12} />}
          </button>
          {projects.map(project => (
            <button
              key={project.id}
              onClick={() => {
                onMoveToProject(project.id);
                onClose();
              }}
              style={doc.project_id === project.id ? { backgroundColor: hexToRgba(projectAccentById.get(project.id) || resolveStableAccent(project.id), 0.18) } : undefined}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                doc.project_id === project.id
                  ? 'text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                  : 'text-slate-300 hover:bg-white/10'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: projectAccentById.get(project.id) || resolveStableAccent(project.id) }}
                />
                <span className="truncate">{project.name}</span>
              </span>
              {doc.project_id === project.id && <Check size={12} />}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10 px-2 py-2">
        <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <span className="flex items-center gap-2">
            <Tag size={11} />
            Tags
          </span>
          <button
            onClick={onCreateTag}
            className="rounded-lg px-2 py-1 text-[10px] text-slate-300 transition-colors hover:bg-white/10"
          >
            New Tag
          </button>
        </div>
        <div className="max-h-32 space-y-1 overflow-y-auto custom-scrollbar">
          {tags.length > 0 ? tags.map(tag => {
            const assigned = assignedTagIds.has(tag.id);
            const accent = tagAccentById.get(tag.id) || resolveStableAccent(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => onToggleTag(tag)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                  assigned
                    ? 'text-slate-100'
                    : 'text-slate-300 hover:bg-white/10'
                }`}
                style={assigned ? { backgroundColor: hexToRgba(accent, 0.18) } : undefined}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                  <span className="truncate">{tag.name}</span>
                </span>
                {assigned && <Check size={12} />}
              </button>
            );
          }) : (
            <div className="rounded-xl border border-white/10 bg-slate-900/50 px-3 py-2 text-xs text-slate-400">
              No tags yet
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/10 px-1 pt-2 flex gap-1.5">
        {cacheSize !== null && cacheSize > 0 ? (
          <button
            onClick={async () => {
              const confirm = window.confirm(`ต้องการลบแคช (OCR + Overlay แปล) ของไฟล์นี้หรือไม่?\nขนาดแคช: ${formatFileSize(cacheSize)}`);
              if (confirm) {
                await window.electronAPI.db.clearDocumentCache(doc.id);
                useLayerStore.getState().clearLayers();
                useOCRTextLayerStore.getState().clearAllOCR();
                useOCRTextLayerStore.getState().setCurrentPageOCR(null);
                setCacheSize(0);
              }
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#d97706]/10 border border-[#d97706]/20 py-2 text-[10px] font-semibold text-amber-500 hover:text-amber-400 transition-colors hover:bg-[#d97706]/20"
          >
            <RefreshCw size={11} />
            Clear Cache
          </button>
        ) : (
          <button
            disabled
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900/40 border border-white/5 py-2 text-[10px] font-semibold text-slate-500 cursor-not-allowed"
          >
            <RefreshCw size={11} />
            Clear Cache
          </button>
        )}

        <button
          onClick={() => {
            onDelete();
            onClose();
          }}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white text-[#EA580C] hover:bg-white/90 py-2 text-[10px] font-bold transition-all shadow-sm"
        >
          <Trash2 size={11} className="text-[#EA580C]" />
          Delete
        </button>
      </div>
    </div>,
    document.body
  );
};

export const ProjectContextMenu: React.FC<{
  project: DBProject;
  position: MenuPosition;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onCreateSubfolder: () => void;
  onShowInfo: () => void;
}> = ({ project, position, onClose, onDelete, onEdit, onCreateSubfolder, onShowInfo }) => {
  const accent = project.color || resolveStableAccent(project.id);
  return createPortal(
    <div
      data-library-floating-menu="true"
      className="fixed z-[160] w-60 rounded-2xl border border-white/15 bg-slate-950/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-b border-white/10 px-2 pb-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
          <Folder size={14} style={{ color: accent }} />
          <span className="truncate">{project.name}</span>
        </div>
        <div className="mt-1 text-[10px] text-slate-400">Deleting a folder does not delete the documents inside it.</div>
      </div>
      <div className="pt-2 space-y-0.5">
        <button
          onClick={() => {
            onEdit();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-slate-300 transition-colors hover:bg-white/10"
        >
          <Edit3 size={12} className="text-slate-400" />
          Edit Folder
        </button>
        <button
          onClick={() => {
            onCreateSubfolder();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-slate-300 transition-colors hover:bg-white/10"
        >
          <FolderPlus size={12} className="text-slate-400" />
          Create Sub Folder
        </button>
        <button
          onClick={() => {
            onShowInfo();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-sky-300 transition-colors hover:bg-sky-500/10 font-medium"
        >
          <Info size={13} className="text-sky-400" />
          Folder Info
        </button>
        <button
          onClick={() => {
            onDelete();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-red-300 transition-colors hover:bg-red-500/10"
        >
          <Trash2 size={12} />
          Delete Folder
        </button>
      </div>
    </div>,
    document.body
  );
};

export const TagContextMenu: React.FC<{
  tag: DBTag;
  position: MenuPosition;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ tag, position, onClose, onEdit, onDelete }) => {
  return createPortal(
    <div
      data-library-floating-menu="true"
      className="fixed z-[160] w-52 rounded-2xl border border-white/12 bg-slate-950/95 p-1 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl flex flex-col gap-0.5 animate-fade-in"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-white/5 mb-0.5">
        <span 
          className="h-2 w-2 rounded-full shrink-0 shadow-[0_0_8px_rgba(255,255,255,0.2)]" 
          style={{ backgroundColor: tag.color || '#8B5CF6' }} 
        />
        <span className="text-xs font-semibold text-slate-200 truncate">{tag.name}</span>
      </div>

      <button
        onClick={() => {
          onClose();
          onEdit();
        }}
        className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Edit3 size={13} className="text-sky-400" />
        Edit Tag
      </button>

      <button
        onClick={() => {
          onClose();
          onDelete();
        }}
        className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs text-red-300 transition-colors hover:bg-red-500/20 hover:text-red-200"
      >
        <Trash2 size={13} />
        ลบแท็ก (Delete Tag)
      </button>
    </div>,
    document.body
  );
};
