import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  Upload, Download, FileText, Clock, Star, FolderOpen, Settings2, 
  Sparkles, ScrollText, Shield, Grid3X3, List, Search, Plus, Flame, KeyRound, Eye, EyeOff,
  Home as HomeIcon, Folder, ChevronRight, MoreHorizontal, Trash2, Heart, Compass,
  AlertTriangle, RefreshCw, X, Check, Tag, FolderPlus,
  PanelLeftClose, PanelLeftOpen, Cpu, Pause, Play, Filter, Edit3, Zap, Award,
  ChevronUp, ChevronDown, ArrowRight
} from 'lucide-react';
import { useProjectStore, SafetySettings, TranslationMode } from '../../stores/useProjectStore';
import { useBackgroundQueueStore } from '../../stores/useBackgroundQueueStore';
import {
  OVERLAY_FONT_OPTIONS,
  OverlayFontPreset,
  getOverlayPrimaryFontName,
} from '../../constants/overlayFonts';
import { useOCRTextLayerStore, SUPPORTED_LANGUAGES } from '../../stores/useOCRTextLayerStore';
import { useFileBrowserStore, ViewMode as FileBrowserViewMode, SortBy, SortOrder } from '../../stores/useFileBrowserStore';
import { useLayerStore } from '../../stores/useLayerStore';
import type { DBDocument, DBTag, DBProject } from '../../types/electron.d';
import { OCREngine } from '../../types';
import { generateDocumentThumbnail } from '../../services/libraryThumbnail';
import { OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT } from '../../services/vision/ocr-timeout';
import { SecuritySettings } from '../Auth/SecuritySettings';
import { dbService } from '../../services/dbService';
import {
  prepareProjectDocumentLoad,
  ensureProjectDocumentRecord,
  touchProjectDocumentActivity
} from '../../services/projectDocumentService';

type SidebarPage = 'home' | 'projects' | 'settings';

const SAFETY_LEVEL_PREVIEW: Record<keyof SafetySettings, Record<'off' | 'low' | 'medium' | 'high', string>> = {
  harassment: {
    off: 'อนุญาตโทนกระทบกระทั่งตามบริบท เช่น "แกมันบ้าไปแล้ว"',
    low: 'ลดคำโจมตีตรงๆ แต่ยังคงอารมณ์เผ็ดได้',
    medium: 'ตัดการเหยียด/ด่ารุนแรง ให้ใช้โทนโต้เถียงสุภาพขึ้น',
    high: 'บังคับโทนปลอดภัยสูงสุด หลีกเลี่ยงการโจมตีตัวบุคคล',
  },
  hate: {
    off: 'คงเนื้อหาเข้มตามต้นฉบับ (ถ้ามี)',
    low: 'ลดคำล่อแหลมเชิงอคติ แต่ยังคงความหมายหลัก',
    medium: 'แทนถ้อยคำเกลียดชังด้วยคำกลางที่ปลอดภัย',
    high: 'บังคับกรองเข้มงวด หลีกเลี่ยงถ้อยคำแบ่งแยกทั้งหมด',
  },
  sexual: {
    off: 'โทนตรงไปตรงมา เหมาะงานผู้ใหญ่/manhwa',
    low: 'ลดความ explicit ลงเล็กน้อย',
    medium: 'ใช้คำกลางมากขึ้น ลดรายละเอียดทางเพศ',
    high: 'หลีกเลี่ยงถ้อยคำเชิงเพศชัดเจน',
  },
  dangerous: {
    off: 'เก็บโทนขู่/รุนแรงตามบทสนทนา',
    low: 'ลดคำชี้นำรุนแรงโดยตรง',
    medium: 'แทนคำอันตรายด้วยถ้อยคำทั่วไป',
    high: 'กรองเข้ม ปลอดภัยสูงสุดสำหรับงานทั่วไป',
  },
};

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Format date
const formatDate = (dateValue: string | number): string => {
  const date = new Date(dateValue);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
};

const decodeFileData = (data: Uint8Array | ArrayBuffer | string): Uint8Array => {
  if (typeof data === 'string') {
    const binaryString = atob(data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array();
};

type FileOpenContext = 'recent' | 'browse' | 'drag_drop' | 'file_input';

type FileOpenErrorEntry = {
  id: string;
  context: FileOpenContext;
  message: string;
  details?: string;
  filename?: string;
  filepath?: string;
  docId?: number;
  timestamp: number;
};

const FILE_OPEN_LOG_KEY = 'pdf_translator.file_open_errors';

const recordFileOpenError = (entry: FileOpenErrorEntry): void => {
  try {
    const existingRaw = window.localStorage.getItem(FILE_OPEN_LOG_KEY);
    const existing = existingRaw ? (JSON.parse(existingRaw) as FileOpenErrorEntry[]) : [];
    const next = [entry, ...existing].slice(0, 50);
    window.localStorage.setItem(FILE_OPEN_LOG_KEY, JSON.stringify(next));
  } catch {
    // ignore telemetry persistence errors
  }
  console.error('[FileOpenTelemetry]', entry);
};

const getFileOpenHint = (message: string): string => {
  const lower = message.toLowerCase();
  if (lower.includes('file not found')) {
    return 'File not found. It may have been moved or deleted. Please re-import it.';
  }
  if (lower.includes('permission') || lower.includes('access') || lower.includes('denied')) {
    return 'Permission denied. Close the file in other apps or move it to a writable folder.';
  }
  if (lower.includes('unsupported') || lower.includes('mime')) {
    return 'Unsupported file type. Please choose a PDF, PNG, or JPEG.';
  }
  return 'Try re-importing the file or open it from a different location.';
};

// Get file icon based on type
const getFileIcon = (fileType: string) => {
  if (fileType === 'pdf') {
    return <FileText className="text-slate-300" size={20} />;
  }
  return <FileText className="text-slate-400" size={20} />;
};

const fallbackFolderColors = ['#7C5CFF', '#4387FF', '#59C8F6', '#F59A3A', '#F1C85B'];
const THEMED_LIBRARY_ACCENTS = ['#7C5CFF', '#4387FF', '#59C8F6', '#F59A3A', '#F1C85B'];

const resolveThemedAccent = (index: number): string =>
  THEMED_LIBRARY_ACCENTS[Math.abs(index) % THEMED_LIBRARY_ACCENTS.length];

const hexToRgba = (hex: string, alpha: number): string => {
  const normalized = hex.replace('#', '');
  const full = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const value = Number.parseInt(full, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const resolveStableAccent = (seed: number | string): string => {
  if (typeof seed === 'number') {
    return resolveThemedAccent(seed);
  }

  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return resolveThemedAccent(hash);
};

type MenuActionDialogState = {
  isOpen: boolean;
  name: string;
  documentId: number | null;
  parentId?: number | null;
};

type MenuPosition = {
  x: number;
  y: number;
};

type DeleteTagDialogState = {
  isOpen: boolean;
  tag: DBTag | null;
  confirmation: string;
};

type DeleteProjectDialogState = {
  isOpen: boolean;
  project: DBProject | null;
  confirmation: string;
};


const getFloatingMenuPosition = (
  x: number,
  y: number,
  width: number,
  height: number
): MenuPosition => {
  if (typeof window === 'undefined') {
    return { x, y };
  }

  const padding = 12;
  const clampedX = Math.min(
    Math.max(padding, x),
    Math.max(padding, window.innerWidth - width - padding)
  );
  const clampedY = Math.min(
    Math.max(padding, y),
    Math.max(padding, window.innerHeight - height - padding)
  );

  return { x: clampedX, y: clampedY };
};

const DocumentContextMenu: React.FC<{
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
    if (window.electronAPI.db.getDocumentCacheSize) {
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
          <div className="mt-1 flex items-center gap-1.5">
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

const TagContextMenu: React.FC<{
  tag: DBTag;
  position: MenuPosition;
  onClose: () => void;
  onDelete: () => void;
}> = ({ tag, position, onClose, onDelete }) => {
  const accent = resolveStableAccent(tag.id);
  return createPortal(
  <div
    data-library-floating-menu="true"
    className="fixed z-[160] w-56 rounded-2xl border border-white/15 bg-slate-950/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
    style={{ left: position.x, top: position.y }}
    onClick={(e) => e.stopPropagation()}
    onContextMenu={(e) => e.preventDefault()}
  >
    <div className="border-b border-white/10 px-2 pb-2">
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: accent }}
        />
        {tag.name}
      </div>
      <div className="mt-1 text-[10px] text-slate-400">Deleting a tag only removes the label, not OCR data.</div>
    </div>
    <div className="pt-2">
      <button
        onClick={() => {
          onDelete();
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-red-300 transition-colors hover:bg-red-500/10"
      >
        <Trash2 size={12} />
        Delete Tag
      </button>
    </div>
  </div>,
  document.body
);
};

const ProjectContextMenu: React.FC<{
  project: DBProject;
  position: MenuPosition;
  onClose: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onCreateSubfolder: () => void;
}> = ({ project, position, onClose, onDelete, onEdit, onCreateSubfolder }) => {
  const accent = project.color || resolveStableAccent(project.id);
  return createPortal(
  <div
    data-library-floating-menu="true"
    className="fixed z-[160] w-56 rounded-2xl border border-white/15 bg-slate-950/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
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
          onCreateSubfolder();
          onClose();
        }}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-slate-300 transition-colors hover:bg-white/10"
      >
        <FolderPlus size={12} className="text-slate-400" />
        Create Subfolder
      </button>
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

const SortContextMenu: React.FC<{
  position: MenuPosition;
  sortBy: SortBy;
  sortOrder: SortOrder;
  ratingFilterMode: 'only' | 'range';
  ratingFilterOnly: number | null;
  ratingFilterMin: number | null;
  ratingFilterMax: number | null;
  onUpdateFilters: (updates: {
    mode?: 'only' | 'range';
    only?: number | null;
    min?: number | null;
    max?: number | null;
  }) => void;
  onSelect: (key: SortBy, order: SortOrder) => void;
  onClose: () => void;
}> = ({
  position,
  sortBy,
  sortOrder,
  ratingFilterMode,
  ratingFilterOnly,
  ratingFilterMin,
  ratingFilterMax,
  onUpdateFilters,
  onSelect,
  onClose
}) => {
  return createPortal(
    <div
      data-library-floating-menu="true"
      className="fixed z-[160] w-[270px] rounded-2xl border border-white/15 bg-slate-950/95 p-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.5)] backdrop-blur-2xl flex flex-col gap-0.5"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-white/5 mb-1">
        Sort Documents
      </div>
      <div className="grid grid-cols-2 gap-1 p-1">
        {[
          { label: 'Newest', key: 'date', order: 'desc' as const, labelComponent: <span>Newest</span> },
          { label: 'Oldest', key: 'date', order: 'asc' as const, labelComponent: <span>Oldest</span> },
          { label: 'A-Z', key: 'name', order: 'asc' as const, labelComponent: <span>A-Z</span> },
          { label: 'Z-A', key: 'name', order: 'desc' as const, labelComponent: <span>Z-A</span> },
          { 
            label: 'Rating: High to Low', 
            key: 'rating', 
            order: 'desc' as const, 
            labelComponent: <span className="flex items-center gap-1"><Star size={11} className="fill-amber-400 text-amber-400 shrink-0" /> High ▲</span> 
          },
          { 
            label: 'Rating: Low to High', 
            key: 'rating', 
            order: 'asc' as const, 
            labelComponent: <span className="flex items-center gap-1"><Star size={11} className="fill-amber-400 text-amber-400 shrink-0" /> Low ▼</span> 
          }
        ].map((opt) => {
          const isActive = sortBy === opt.key && sortOrder === opt.order;
          return (
            <button
              key={`${opt.key}-${opt.order}`}
              onClick={() => {
                onSelect(opt.key as SortBy, opt.order);
                onClose();
              }}
              className={`flex items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition-all border ${
                isActive
                  ? 'bg-white/10 text-white font-medium border-white/10'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200 border-transparent'
              }`}
            >
              {opt.labelComponent}
              {isActive && <Check size={10} className="text-[#5CC6F2] shrink-0" />}
            </button>
          );
        })}
      </div>

      <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-t border-b border-white/5 my-1 mt-2">
        Filter by Rating
      </div>

      <div className="flex flex-col gap-2 p-2 bg-white/[0.02] rounded-xl border border-white/5 my-1 mx-0.5">
        {/* Only Rating Row */}
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-[11px] font-medium text-slate-400 select-none min-w-[32px]">Only:</span>
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((stars) => {
              const isSelected = ratingFilterMode === 'only' && ratingFilterOnly === stars;
              return (
                <button
                  key={stars}
                  onClick={() => {
                    if (ratingFilterMode === 'only' && ratingFilterOnly === stars) {
                      onUpdateFilters({ mode: 'only', only: null });
                    } else {
                      onUpdateFilters({ mode: 'only', only: stars });
                    }
                  }}
                  className="p-0.5 hover:scale-110 active:scale-95 transition-all text-slate-600 hover:text-amber-400"
                  title={`Only ${stars} stars`}
                >
                  <Star 
                    size={12} 
                    className={isSelected ? "fill-amber-400 text-amber-400" : "text-slate-600 hover:text-amber-400"} 
                  />
                </button>
              );
            })}
          </div>
          <button
            onClick={() => {
              if (ratingFilterMode === 'only' && ratingFilterOnly === 0) {
                onUpdateFilters({ mode: 'only', only: null });
              } else {
                onUpdateFilters({ mode: 'only', only: 0 });
              }
            }}
            className={`px-1.5 py-0.5 rounded text-[10px] transition-all border ${
              ratingFilterMode === 'only' && ratingFilterOnly === 0
                ? 'bg-[#5CC6F2]/10 text-[#5CC6F2] border-[#5CC6F2]/30 font-semibold animate-pulse'
                : 'text-slate-500 hover:text-slate-300 border-transparent hover:border-white/5'
            }`}
          >
            ☆ None
          </button>
        </div>

        {/* Min/Max Rating Row */}
        <div className="flex flex-col gap-1.5 pt-1.5 border-t border-white/5">
          {/* Min row */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-400 select-none min-w-[32px]">Min:</span>
            <button
              onClick={() => {
                onUpdateFilters({ mode: 'range', min: null });
              }}
              className={`p-0.5 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors ${
                ratingFilterMode === 'range' && ratingFilterMin === null ? 'text-[#5CC6F2]' : ''
              }`}
              title="Reset Min"
            >
              <RefreshCw size={10} />
            </button>
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((stars) => {
                const isSelected = ratingFilterMode === 'range' && ratingFilterMin !== null && ratingFilterMin === stars;
                const isPassive = ratingFilterMode === 'range' && ratingFilterMin !== null && stars <= ratingFilterMin;
                return (
                  <button
                    key={stars}
                    onClick={() => {
                      onUpdateFilters({ mode: 'range', min: stars });
                    }}
                    className="p-0.5 hover:scale-110 active:scale-95 transition-all"
                  >
                    <Star 
                      size={11} 
                      className={
                        isSelected 
                          ? "fill-blue-400 text-blue-400" 
                          : isPassive 
                            ? "fill-blue-400/40 text-blue-400/40" 
                            : "text-slate-600 hover:text-blue-400"
                      } 
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Max row */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-slate-400 select-none min-w-[32px]">Max:</span>
            <button
              onClick={() => {
                onUpdateFilters({ mode: 'range', max: null });
              }}
              className={`p-0.5 rounded hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors ${
                ratingFilterMode === 'range' && ratingFilterMax === null ? 'text-[#5CC6F2]' : ''
              }`}
              title="Reset Max"
            >
              <RefreshCw size={10} />
            </button>
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((stars) => {
                const isSelected = ratingFilterMode === 'range' && ratingFilterMax !== null && ratingFilterMax === stars;
                const isPassive = ratingFilterMode === 'range' && ratingFilterMax !== null && stars <= ratingFilterMax;
                return (
                  <button
                    key={stars}
                    onClick={() => {
                      onUpdateFilters({ mode: 'range', max: stars });
                    }}
                    className="p-0.5 hover:scale-110 active:scale-95 transition-all"
                  >
                    <Star 
                      size={11} 
                      className={
                        isSelected 
                          ? "fill-amber-400 text-amber-400" 
                          : isPassive 
                            ? "fill-amber-400/40 text-amber-400/40" 
                            : "text-slate-600 hover:text-amber-400"
                      } 
                    />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

const DocumentCard = React.memo<{
  doc: DBDocument;
  viewMode: FileBrowserViewMode;
  isSelected: boolean;
  isMultiSelectActive?: boolean;
  onOpen: () => void;
  onToggleSelect?: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  isMenuOpen: boolean;
  menuPosition: MenuPosition | null;
  documentTags: DBTag[];
  tags: DBTag[];
  projects: DBProject[];
  onRequestMenu: (position: MenuPosition) => void;
  onCloseMenu: () => void;
  onToggleTag: (tag: DBTag) => void;
  onMoveToProject: (projectId: number | null) => void;
  onCreateTag: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragEnd: () => void;
  isThumbnailHidden?: boolean;
  onToggleHideThumbnail?: () => void;
  onOCRAllPages: () => void;
  onUpdateRating: (rating: number) => void;
}>(({
  doc,
  viewMode,
  isSelected,
  isMultiSelectActive = false,
  onOpen,
  onToggleSelect,
  onToggleFavorite,
  onDelete,
  isMenuOpen,
  menuPosition,
  documentTags,
  tags,
  projects,
  onRequestMenu,
  onCloseMenu,
  onToggleTag,
  onMoveToProject,
  onCreateTag,
  onDragStart,
  onDragEnd,
  isThumbnailHidden = false,
  onToggleHideThumbnail,
  onOCRAllPages,
  onUpdateRating
}) => {
  const thumbnail = isThumbnailHidden ? (
    <div className="h-full w-full bg-[#f8fafc] border border-slate-200/80 shadow-inner flex flex-col items-center justify-center relative overflow-hidden group/paper">
      <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1.2px,transparent_1.2px)] [background-size:12px_12px] opacity-35" />
      <FileText size={viewMode === 'grid' ? 24 : 16} className="text-slate-400 relative z-10 animate-fade-in" />
    </div>
  ) : doc.thumbnail_path ? (
    <img src={doc.thumbnail_path} alt={doc.filename} className="h-full w-full object-cover" />
  ) : (
    <div className="text-slate-600">
      {getFileIcon(doc.file_type)}
    </div>
  );

  if (viewMode === 'grid') {
    return (
      <div 
        data-document-card="true"
        className={`group relative p-4 rounded-2xl border transition-all cursor-pointer backdrop-blur-xl ${
          isSelected 
            ? 'bg-[#090a0d] border-[#2B9BFF]/60 shadow-[0_14px_34px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.05)]' 
            : 'bg-[#08090c]/96 border-white/8 hover:border-white/12 hover:bg-[#101216]'
        }`}
        draggable
        onDragStart={(e) => {
          onDragStart(e);
        }}
        onDragEnd={onDragEnd}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey || isMultiSelectActive) {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect?.();
          } else {
            onOpen();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRequestMenu(getFloatingMenuPosition(e.clientX, e.clientY, 288, 560));
        }}
      >
        <div className="aspect-[3/4] rounded-xl bg-[#090a0c] mb-3 flex items-center justify-center overflow-hidden border border-white/5 relative">
          {thumbnail}
          {isSelected && (
            <div className="absolute top-2 left-2 h-5 w-5 rounded-md bg-[#2B9BFF] text-white flex items-center justify-center shadow-md border border-white/20 z-20 animate-fade-in">
              <Check size={12} className="stroke-[3]" />
            </div>
          )}
        </div>
        
        <h3 className="font-medium text-sm text-slate-100 truncate mb-1">{doc.filename}</h3>
        <p className="text-[10px] text-slate-400 flex items-center justify-between gap-1">
          <span>{formatDate(doc.last_accessed)} • {doc.total_pages} pages</span>
          {(doc.rating || 0) > 0 && (
            <span className="flex items-center text-amber-400 gap-0.5 shrink-0">
              <Star size={10} className="fill-amber-400" />
              <span className="text-[9px] font-bold">{doc.rating}</span>
            </span>
          )}
        </p>
        
        <button 
          onClick={(e) => { e.stopPropagation(); onToggleHideThumbnail?.(); }}
          className={`absolute top-2 left-2 p-1.5 rounded-lg transition-all z-10 ${
            isThumbnailHidden 
              ? 'bg-[#839958] text-white border border-[#839958] shadow-[0_0_8px_rgba(131,153,88,0.4)] opacity-100'
              : isSelected 
                ? 'opacity-0 pointer-events-none'
                : 'bg-[#111214]/90 text-slate-500 border border-white/5 opacity-0 group-hover:opacity-100 hover:text-slate-200'
          }`}
          title={isThumbnailHidden ? 'แสดงรูปภาพตัวอย่าง' : 'ซ่อนรูปภาพตัวอย่าง'}
        >
          {isThumbnailHidden ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>

        <button 
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className={`absolute top-2 right-2 p-1.5 rounded-lg transition-all z-10 ${
            doc.is_favorite 
              ? 'bg-white/10 text-slate-100' 
              : 'bg-[#111214]/90 text-slate-500 border border-white/5 opacity-0 group-hover:opacity-100'
          }`}
        >
          <Heart size={14} fill={doc.is_favorite ? 'currentColor' : 'none'} />
        </button>
        
        {isMenuOpen && (
          <DocumentContextMenu
            doc={doc}
            position={menuPosition ?? getFloatingMenuPosition(24, 24, 288, 560)}
            documentTags={documentTags}
            tags={tags}
            projects={projects}
            onClose={onCloseMenu}
            onToggleFavorite={onToggleFavorite}
            onToggleTag={onToggleTag}
            onMoveToProject={onMoveToProject}
            onDelete={onDelete}
            onCreateTag={onCreateTag}
            onOCRAllPages={onOCRAllPages}
            onUpdateRating={onUpdateRating}
          />
        )}
      </div>
    );
  }

  return (
    <div 
      data-document-card="true"
      className={`group relative flex items-center gap-4 p-3 rounded-xl border transition-all cursor-pointer backdrop-blur-xl ${
        isSelected 
          ? 'bg-[#0a0b0e] border-[#2B9BFF]/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]' 
          : 'bg-[#08090c]/94 border-white/8 hover:border-white/12 hover:bg-[#101216]'
      }`}
      draggable
      onDragStart={(e) => {
        onDragStart(e);
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || isMultiSelectActive) {
          e.preventDefault();
          e.stopPropagation();
          onToggleSelect?.();
        } else {
          onOpen();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onRequestMenu(getFloatingMenuPosition(e.clientX, e.clientY, 288, 560));
      }}
    >
      {isSelected && (
        <div className="h-4 w-4 rounded bg-[#2B9BFF] text-white flex items-center justify-center shrink-0 shadow-sm border border-white/10">
          <Check size={10} className="stroke-[3]" />
        </div>
      )}
      <div className="relative h-16 w-12 overflow-hidden rounded-lg border border-white/5 bg-[#090a0c]">
        <div className="absolute inset-0 flex items-center justify-center">
          {thumbnail}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm text-slate-100 truncate flex items-center gap-2">
          <span>{doc.filename}</span>
          {(doc.rating || 0) > 0 && (
            <span className="inline-flex items-center text-amber-400 gap-0.5 shrink-0">
              <Star size={10} className="fill-amber-400" />
              <span className="text-[9px] font-bold">{doc.rating}</span>
            </span>
          )}
        </h3>
        <p className="text-[10px] text-slate-400">
          {doc.total_pages} pages • {formatFileSize(doc.file_size)}
        </p>
      </div>
      <div className="text-xs text-slate-400 hidden md:block">
        {formatDate(doc.last_accessed)}
      </div>
      <button 
        onClick={(e) => { e.stopPropagation(); onToggleHideThumbnail?.(); }}
        className={`p-1.5 rounded transition-all ${
          isThumbnailHidden ? 'text-[#839958] bg-[#839958]/10' : 'text-slate-500 hover:text-slate-300'
        }`}
        title={isThumbnailHidden ? 'แสดงรูปภาพตัวอย่าง' : 'ซ่อนรูปภาพตัวอย่าง'}
      >
        {isThumbnailHidden ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
      <button 
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        className={`p-1.5 rounded transition-all ${
          doc.is_favorite ? 'text-slate-100' : 'text-slate-500 hover:text-slate-300'
        }`}
      >
        <Heart size={14} fill={doc.is_favorite ? 'currentColor' : 'none'} />
      </button>
      <button 
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          onRequestMenu(getFloatingMenuPosition(rect.right - 288, rect.bottom + 8, 288, 560));
        }}
        className="p-1.5 rounded text-slate-500 hover:text-slate-300"
      >
        <MoreHorizontal size={14} />
      </button>
      {isMenuOpen && (
        <DocumentContextMenu
          doc={doc}
          position={menuPosition ?? getFloatingMenuPosition(24, 24, 288, 560)}
          documentTags={documentTags}
          tags={tags}
          projects={projects}
          onClose={onCloseMenu}
          onToggleFavorite={onToggleFavorite}
          onToggleTag={onToggleTag}
          onMoveToProject={onMoveToProject}
          onDelete={onDelete}
          onCreateTag={onCreateTag}
          onOCRAllPages={onOCRAllPages}
          onUpdateRating={onUpdateRating}
        />
      )}
    </div>
  );
});

// Project Item Component
const ProjectItem = React.memo<{
  project: DBProject;
  isSelected: boolean;
  onSelect: () => void;
  displayColor?: string;
  isDropTarget: boolean;
  onDragOver: (event: React.DragEvent<HTMLButtonElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent<HTMLButtonElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  level?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}>(({ project, isSelected, onSelect, displayColor, isDropTarget, onDragOver, onDragLeave, onDrop, onContextMenu, level = 0, hasChildren = false, isExpanded = false, onToggleExpand }) => {
  const accent = displayColor || resolveStableAccent(project.id);
  return (
  <button 
    onClick={onSelect}
    onContextMenu={onContextMenu}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    className={`w-full p-3 rounded-xl text-left transition-all flex items-center border ${
      isDropTarget
        ? 'border-white/16 bg-[#20242b] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
        : 
      isSelected 
        ? 'border-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]' 
        : 'bg-[#16181c]/82 border-white/5 hover:border-white/12 hover:bg-[#1b1e23]'
    }`}
    style={isSelected ? { backgroundColor: hexToRgba(accent, 0.14) } : undefined}
  >
    {/* Tree line connector */}
    {level > 0 && (
      <div 
        className="flex items-center justify-end shrink-0 text-slate-600/60"
        style={{ width: `${level * 16}px`, height: '24px' }}
      >
        <span className="w-2.5 h-4 border-l border-b border-white/20 rounded-bl mr-1.5 mt-[-8px]" />
      </div>
    )}

    <div 
      className="p-2 rounded-lg border border-white/5 flex items-center justify-center shrink-0 mr-3"
      style={{ backgroundColor: hexToRgba(accent, 0.14) }}
    >
      <Folder size={16} style={{ color: accent }} />
    </div>
    <span className="flex-1 truncate text-sm text-slate-200">{project.name}</span>
    {hasChildren ? (
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            onToggleExpand?.();
          }
        }}
        className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-all shrink-0 ml-1 cursor-pointer"
        title={isExpanded ? 'Collapse subfolders' : 'Expand subfolders'}
      >
        <ChevronRight size={14} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
      </div>
    ) : (
      <div className="w-7 shrink-0" />
    )}
  </button>
  );
});

// Tag Pill Component
const TagPill = React.memo<{
  tag: DBTag;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  displayColor?: string;
}>(({ tag, isSelected, onClick, onContextMenu, displayColor }) => (
  <button
    onClick={onClick}
    onContextMenu={onContextMenu}
    className={`group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
      isSelected 
        ? 'border-white/12 bg-[#23262b] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]' 
        : 'border-white/10 bg-[#131519]/88 text-slate-300 hover:border-white/14 hover:bg-[#1a1d22]'
    }`}
    style={isSelected ? { boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px ${hexToRgba(displayColor || tag.color || '#8B5CF6', 0.18)}` } : undefined}
  >
    <span className={`h-1.5 w-1.5 rounded-full transition-colors ${
      isSelected ? '' : 'bg-slate-500 group-hover:bg-slate-300'
    }`} style={isSelected ? { backgroundColor: displayColor || tag.color || '#8B5CF6' } : undefined} />
    {tag.name}
  </button>
));

export const UploadScreen: React.FC = () => {
  const {
    loadProject,
    translationMode,
    setTranslationMode,
    safetySettings,
    updateSafetySettings,
    targetLanguage,
    geminiApiKeyDraft,
    hasGeminiApiKey,
    geminiApiKeySource,
    isGeminiApiKeyLoaded,
    isGeminiApiKeySaving,
    geminiApiKeyError,
    setGeminiApiKeyDraft,
    saveGeminiApiKey,
    clearGeminiApiKey,
    overlayFontPreset,
    setOverlayFontPreset,
  } = useProjectStore();
  const ocrOptions = useOCRTextLayerStore((state) => state.options);
  const setOCROptions = useOCRTextLayerStore((state) => state.setOptions);
  
  const jobs = useBackgroundQueueStore((state) => state.jobs);
  const pauseJob = useBackgroundQueueStore((state) => state.pauseJob);
  const resumeJob = useBackgroundQueueStore((state) => state.resumeJob);
  const cancelJob = useBackgroundQueueStore((state) => state.cancelJob);
  const removeJob = useBackgroundQueueStore((state) => state.removeJob);
  const clearCompletedJobs = useBackgroundQueueStore((state) => state.clearCompletedJobs);
  const moveJobUp = useBackgroundQueueStore((state) => state.moveJobUp);
  const moveJobDown = useBackgroundQueueStore((state) => state.moveJobDown);

  const {
    viewMode, setViewMode,
    sortBy, setSortBy,
    sortOrder, setSortOrder,
    filterType,
    selectedTagId, setSelectedTagId,
    selectedProjectId, setSelectedProjectId,
    searchQuery, setSearchQuery,
    documents, tags, projects,
          isLoading,
          loadStartupData, loadRecentDocuments, loadFavoriteDocuments, loadDocumentsByTag, loadDocumentsByProject,
          searchDocuments, loadTags, loadProjects,
    toggleFavorite, deleteDocument, moveToProject,
    addTagToDocument, removeTagFromDocument,
    createTag, createProject, deleteTag, deleteProject, updateProject, loadDocumentTags, persistDocumentPatch,
    selectedDocumentIds, toggleDocumentSelection, clearSelection,
    getSortedDocuments
  } = useFileBrowserStore();

  const [isDragging, setIsDragging] = useState(false);
  const [hiddenThumbnails, setHiddenThumbnails] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('pdf_translator.hidden_thumbnails');
      return saved ? new Set(JSON.parse(saved).map(Number)) : new Set();
    } catch {
      return new Set();
    }
  });

  const toggleHideThumbnail = useCallback((docId: number) => {
    setHiddenThumbnails(prev => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      localStorage.setItem('pdf_translator.hidden_thumbnails', JSON.stringify(Array.from(next)));
      return next;
    });
  }, []);

  const [activePage, setActivePage] = useState<SidebarPage>('home');
  const [gpuInfo, setGpuInfo] = useState<{
    gpus: string[];
    hasDirectML: boolean;
    hasCuda: boolean;
    mode: 'CUDA' | 'DirectML' | 'CPU';
    gpuVendor: 'intel' | 'amd' | 'nvidia' | 'unknown';
  } | null>(null);

  const [paddleThaiStatus, setPaddleThaiStatus] = useState<{ installed: boolean; checking: boolean; downloading: boolean }>({
    installed: false,
    checking: true,
    downloading: false,
  });
  const [paddleEnglishStatus, setPaddleEnglishStatus] = useState<{ installed: boolean; checking: boolean; downloading: boolean }>({
    installed: false,
    checking: true,
    downloading: false,
  });

  const checkModelStatus = useCallback(async () => {
    if (!window.electronAPI?.models) return;
    try {
      const thaiRes = await window.electronAPI.models.getStatus({ engine: 'paddleocr', language: 'th' });
      setPaddleThaiStatus(prev => ({ ...prev, installed: thaiRes.installed, checking: false }));
    } catch (err) {
      setPaddleThaiStatus(prev => ({ ...prev, checking: false }));
    }
    try {
      const engRes = await window.electronAPI.models.getStatus({ engine: 'paddleocr', language: 'en' });
      setPaddleEnglishStatus(prev => ({ ...prev, installed: engRes.installed, checking: false }));
    } catch (err) {
      setPaddleEnglishStatus(prev => ({ ...prev, checking: false }));
    }
  }, []);

  const handleDownloadModel = useCallback(async (lang: 'th' | 'en') => {
    if (!window.electronAPI?.models) return;
    const setStatus = lang === 'th' ? setPaddleThaiStatus : setPaddleEnglishStatus;
    setStatus(prev => ({ ...prev, downloading: true }));
    try {
      const success = await window.electronAPI.models.download({ engine: 'paddleocr', language: lang });
      if (success) {
        setStatus(prev => ({ ...prev, installed: true, downloading: false }));
      } else {
        setStatus(prev => ({ ...prev, downloading: false }));
      }
    } catch (err) {
      console.error(`Failed to download ${lang} model:`, err);
      setStatus(prev => ({ ...prev, downloading: false }));
    }
  }, []);

  useEffect(() => {
    if (activePage === 'settings') {
      void checkModelStatus();
    }
  }, [activePage, checkModelStatus]);

  // Returns vendor-aware mode label: "Intel DirectML", "AMD DirectML", "CUDA", or "CPU"
  const getGpuModeLabel = (info: typeof gpuInfo): string => {
    if (!info) return 'CPU';
    if (info.mode === 'DirectML') {
      if (info.gpuVendor === 'intel') return 'Intel DirectML';
      if (info.gpuVendor === 'amd') return 'AMD DirectML';
      return 'DirectML';
    }
    return info.mode;
  };

  useEffect(() => {
    let active = true;
    if (window.electronAPI?.ocr?.getGpuInfo) {
      window.electronAPI.ocr.getGpuInfo()
        .then((info) => {
          if (active) setGpuInfo(info);
        })
        .catch((err) => console.error('Failed to get GPU info:', err));
    }
    return () => {
      active = false;
    };
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileOpenError, setFileOpenError] = useState<FileOpenErrorEntry | null>(null);
  const [activeDocumentMenuId, setActiveDocumentMenuId] = useState<number | null>(null);
  const [activeDocumentMenuPosition, setActiveDocumentMenuPosition] = useState<MenuPosition | null>(null);
  const [activeTagMenu, setActiveTagMenu] = useState<{ tag: DBTag; position: MenuPosition } | null>(null);
  const [documentTagsById, setDocumentTagsById] = useState<Record<number, DBTag[]>>({});
  const [projectDialog, setProjectDialog] = useState<MenuActionDialogState>({ isOpen: false, name: '', documentId: null });
  const [tagDialog, setTagDialog] = useState<MenuActionDialogState>({ isOpen: false, name: '', documentId: null });
  const [deleteTagDialog, setDeleteTagDialog] = useState<DeleteTagDialogState>({ isOpen: false, tag: null, confirmation: '' });
  const [activeProjectMenu, setActiveProjectMenu] = useState<{ project: DBProject; position: MenuPosition } | null>(null);
  const [deleteProjectDialog, setDeleteProjectDialog] = useState<DeleteProjectDialogState>({ isOpen: false, project: null, confirmation: '' });
  const [editProjectDialog, setEditProjectDialog] = useState<{
    isOpen: boolean;
    project: DBProject | null;
    name: string;
    color: string;
  }>({ isOpen: false, project: null, name: '', color: '' });
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [draggedDocumentId, setDraggedDocumentId] = useState<number | null>(null);
  const [libraryMenuPosition, setLibraryMenuPosition] = useState<MenuPosition | null>(null);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [sortMenuPosition, setSortMenuPosition] = useState<MenuPosition | null>(null);
  const [ratingFilterMode, setRatingFilterMode] = useState<'only' | 'range'>('only');
  const [ratingFilterOnly, setRatingFilterOnly] = useState<number | null>(null);
  const [ratingFilterMin, setRatingFilterMin] = useState<number | null>(null);
  const [ratingFilterMax, setRatingFilterMax] = useState<number | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set());
  const [isProfileListOpen, setIsProfileListOpen] = useState(false);

  const toggleProjectExpanded = useCallback((projectId: number) => {
    setExpandedProjectIds(current => {
      const newSet = new Set(current);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
      } else {
        newSet.add(projectId);
      }
      return newSet;
    });
  }, []);

  const [ocrBackgroundDialog, setOcrBackgroundDialog] = useState<{
    isOpen: boolean;
    doc: DBDocument | null;
    model: OCREngine;
    profile: 'ocr_all' | 'offline_all';
    ocrLanguage: string;
    ocrQualityProfile: 'fast' | 'best';
    targetLanguage: string;
  }>({
    isOpen: false,
    doc: null,
    model: 'paddleocr',
    profile: 'offline_all',
    ocrLanguage: 'eng',
    ocrQualityProfile: 'best',
    targetLanguage: 'th',
  });

  const [dialogCachePages, setDialogCachePages] = useState<number | null>(null);

  useEffect(() => {
    if (ocrBackgroundDialog.isOpen && ocrBackgroundDialog.doc) {
      setDialogCachePages(null); // Reset
      if (window.electronAPI?.db?.getOcrCacheStatsForDocumentIds) {
        window.electronAPI.db.getOcrCacheStatsForDocumentIds([ocrBackgroundDialog.doc.id])
          .then((rows) => {
            if (rows && rows.length > 0) {
              setDialogCachePages(rows[0].cache_pages);
            } else {
              setDialogCachePages(0);
            }
          })
          .catch((err) => {
            console.error('Failed to get cache pages stats for dialog:', err);
            setDialogCachePages(0);
          });
      } else {
        setDialogCachePages(0);
      }
    }
  }, [ocrBackgroundDialog.isOpen, ocrBackgroundDialog.doc]);

  const openOcrBackgroundDialog = useCallback((doc: DBDocument) => {
    const currentOcrLanguage = useOCRTextLayerStore.getState().options.language || 'eng';
    const currentOcrEngine = (useOCRTextLayerStore.getState().options.engine || 'paddleocr') as OCREngine;
    const currentTargetLanguage = useProjectStore.getState().targetLanguage || 'th';
    const currentOcrQuality = useOCRTextLayerStore.getState().options.ocrQualityProfile || 'best';
    setOcrBackgroundDialog({
      isOpen: true,
      doc,
      model: currentOcrEngine,
      profile: 'offline_all',
      ocrLanguage: currentOcrLanguage,
      ocrQualityProfile: currentOcrQuality === 'fast' ? 'fast' : 'best',
      targetLanguage: currentTargetLanguage,
    });
  }, []);

  const handleStartOcrBackground = useCallback(() => {
    const { doc, model, profile, ocrLanguage, ocrQualityProfile, targetLanguage } = ocrBackgroundDialog;
    if (!doc) return;

    const opt = useOCRTextLayerStore.getState().options;
    const projectState = useProjectStore.getState();

    if (profile === 'ocr_all') {
      useBackgroundQueueStore.getState().addJob({
        documentId: doc.id,
        filename: doc.filename,
        filepath: doc.filepath,
        engine: model,
        type: 'ocr_all',
        totalPages: Math.max(1, doc.total_pages),
        ocrLanguage: ocrLanguage,
        ocrQualityProfile: ocrQualityProfile,
        useAngleCls: opt.useAngleCls,
      });
    } else {
      useBackgroundQueueStore.getState().addJob({
        documentId: doc.id,
        filename: doc.filename,
        filepath: doc.filepath,
        engine: model,
        type: 'offline_all',
        totalPages: Math.max(1, doc.total_pages),
        ocrLanguage: ocrLanguage,
        sourceLanguage: projectState.sourceLanguage || 'eng',
        targetLanguage: targetLanguage,
        translationMode: projectState.translationMode || 'adaptive',
        ocrDpi: opt.dpi || 300,
        ocrPageSegMode: opt.pageSegMode,
        ocrQualityProfile: ocrQualityProfile,
        useAngleCls: opt.useAngleCls,
      });
    }

    // ไม่เรียก boostPriorityForDocument สำหรับคิวเบื้องหลัง (Case 1)
    // งานที่เพิ่มจาก OCR Panel จะต่อท้ายคิวตาม FIFO โดยไม่แทรกคิวหรือยกเลิกงานที่กำลังรันอยู่
    setOcrBackgroundDialog(prev => ({ ...prev, isOpen: false, doc: null }));
  }, [ocrBackgroundDialog]);
  const [projectDropTargetId, setProjectDropTargetId] = useState<number | null>(null);
  const [showGeminiApiKey, setShowGeminiApiKey] = useState(false);
  const [selectedFontAvailable, setSelectedFontAvailable] = useState<boolean | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem('pdf_translator.sidebar_open');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('pdf_translator.sidebar_open', String(next));
      } catch (err) {
        console.error('Failed to save sidebar state:', err);
      }
      return next;
    });
  }, []);
  const thumbnailJobsRef = useRef<Set<number>>(new Set());
  const isThaiTargetLanguage = targetLanguage === 'th';
  const geminiStatusLabel = !isGeminiApiKeyLoaded
    ? 'Loading secure key status...'
    : geminiApiKeySource === 'secure-storage'
      ? 'Gemini key is stored securely on this device.'
      : geminiApiKeySource === 'environment'
        ? 'Gemini key is currently provided by local environment variables.'
        : 'No Gemini key saved yet.';
  const geminiInputPlaceholder = geminiApiKeySource === 'secure-storage'
    ? 'Stored securely. Enter a new key to replace it.'
    : geminiApiKeySource === 'environment'
      ? 'Loaded from environment. Enter a key here to store it securely instead.'
      : 'AIza...';
  const geminiStatusClass = hasGeminiApiKey
    ? 'text-emerald-300/85'
    : 'text-slate-500';

  useEffect(() => {
    let mounted = true;

    const checkFont = async () => {
      if (!isThaiTargetLanguage) {
        if (mounted) setSelectedFontAvailable(null);
        return;
      }

      if (typeof document === 'undefined' || !('fonts' in document)) {
        if (mounted) setSelectedFontAvailable(null);
        return;
      }

      try {
        await document.fonts.ready;
      } catch {
        // Ignore font-set readiness failures.
      }

      const primaryFont = getOverlayPrimaryFontName(overlayFontPreset);
      const available = document.fonts.check(`16px "${primaryFont}"`);
      if (mounted) {
        setSelectedFontAvailable(available);
      }
    };

    void checkFont();
    return () => {
      mounted = false;
    };
  }, [isThaiTargetLanguage, overlayFontPreset]);

  const reportFileOpenError = useCallback((
    context: FileOpenContext,
    error: unknown,
    meta?: { filename?: string; filepath?: string; docId?: number; details?: string }
  ) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const entry: FileOpenErrorEntry = {
      id: (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      context,
      message,
      details: meta?.details,
      filename: meta?.filename,
      filepath: meta?.filepath,
      docId: meta?.docId,
      timestamp: Date.now()
    };
    recordFileOpenError(entry);
    setFileOpenError(entry);
  }, []);

  // Load initial data — batched in 1 IPC round-trip
    useEffect(() => {
      loadStartupData();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-library-floating-menu="true"]')) return;
      setActiveDocumentMenuId(null);
      setActiveDocumentMenuPosition(null);
      setActiveTagMenu(null);
      setActiveProjectMenu(null);
      setLibraryMenuPosition(null);
      setIsSortMenuOpen(false);
      setSortMenuPosition(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveDocumentMenuId(null);
        setActiveDocumentMenuPosition(null);
        setActiveTagMenu(null);
        setActiveProjectMenu(null);
        setLibraryMenuPosition(null);
        setIsSortMenuOpen(false);
        setSortMenuPosition(null);
        setProjectDialog((current) => ({ ...current, isOpen: false }));
        setTagDialog((current) => ({ ...current, isOpen: false }));
        setDeleteTagDialog((current) => ({ ...current, isOpen: false, confirmation: '' }));
        setDeleteProjectDialog((current) => ({ ...current, isOpen: false, confirmation: '' }));
        setEditProjectDialog((current) => ({ ...current, isOpen: false }));
        useFileBrowserStore.getState().clearSelection();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const refreshLibraryView = useCallback(async () => {
    const activeSearch = searchQuery.trim();
    if (activeSearch) {
      await searchDocuments(activeSearch);
      return;
    }

    if (filterType === 'favorites') {
      await loadFavoriteDocuments();
      return;
    }

    if (filterType === 'tag' && selectedTagId !== null) {
      await loadDocumentsByTag(selectedTagId);
      return;
    }

    if (filterType === 'project') {
      await loadDocumentsByProject(selectedProjectId ?? null);
      return;
    }

    await loadRecentDocuments();
  }, [
    filterType,
    loadDocumentsByProject,
    loadDocumentsByTag,
    loadFavoriteDocuments,
    loadRecentDocuments,
    searchDocuments,
    searchQuery,
    selectedProjectId,
    selectedTagId,
  ]);

  const handleImportFiles = useCallback(async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    if (fileList.length === 1) {
      const file = fileList[0];
      try {
        await loadProject(file);
        setFileOpenError(null);
        
        // Auto assign to selectedProjectId if inside a folder
        const documentId = useProjectStore.getState().documentId;
        if (documentId && selectedProjectId) {
          await moveToProject(documentId, selectedProjectId);
        }
      } catch (error) {
        reportFileOpenError('file_input', error, {
          filename: file.name,
          filepath: (file as unknown as { path?: string }).path
        });
      }
      return;
    }

    setImportProgress({ current: 0, total: fileList.length });
    try {
      for (let i = 0; i < fileList.length; i++) {
        setImportProgress({ current: i + 1, total: fileList.length });
        const file = fileList[i];
        
        const prepared = await prepareProjectDocumentLoad({
          db: dbService,
          file: file as File & { path?: string },
          importFile: window.electronAPI?.fs?.importFile,
        });
        
        const resolvedPath = prepared.resolvedPath;
        if (resolvedPath && dbService.isAvailable()) {
          const ensured = await ensureProjectDocumentRecord({
            db: dbService,
            documentId: null,
            file: file as File & { path?: string },
            filePath: resolvedPath,
          });
          
          if (ensured.documentId) {
            await touchProjectDocumentActivity(dbService, ensured.documentId);
            
            if (selectedProjectId) {
              await moveToProject(ensured.documentId, selectedProjectId);
            }
          }
        }
      }
      
      await refreshLibraryView();
    } catch (error) {
      console.error('Failed to import multiple files:', error);
    } finally {
      setImportProgress(null);
    }
  }, [selectedProjectId, moveToProject, refreshLibraryView, loadProject]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const isFile = Array.from(e.dataTransfer.types).includes('Files');
      if (isFile) {
        void handleImportFiles(e.dataTransfer.files);
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleImportFiles(e.target.files);
    }
  };

  const handleBrowse = async () => {
    if (window.electronAPI?.fs?.openFile) {
      try {
        const results = await window.electronAPI.fs.openFile();
        if (!results || !Array.isArray(results) || results.length === 0) return;

        if (results.length === 1) {
          const result = results[0];
          const bytes = decodeFileData(result.data);
          const blob = new Blob([bytes as unknown as BlobPart], { type: result.mimeType });
          const file = new File([blob], result.name, { type: result.mimeType }) as File & { path: string };
          Object.defineProperty(file, 'path', { value: result.filepath, writable: false });
          await loadProject(file, bytes);
          setFileOpenError(null);
          
          // Auto assign to selectedProjectId if inside a folder
          const documentId = useProjectStore.getState().documentId;
          if (documentId && selectedProjectId) {
            await moveToProject(documentId, selectedProjectId);
          }
        } else {
          setImportProgress({ current: 0, total: results.length });
          try {
            for (let i = 0; i < results.length; i++) {
              setImportProgress({ current: i + 1, total: results.length });
              const result = results[i];
              const bytes = decodeFileData(result.data);
              const blob = new Blob([bytes as unknown as BlobPart], { type: result.mimeType });
              const file = new File([blob], result.name, { type: result.mimeType }) as File & { path: string };
              Object.defineProperty(file, 'path', { value: result.filepath, writable: false });

              const prepared = await prepareProjectDocumentLoad({
                db: dbService,
                file: file as File & { path?: string },
                fileData: bytes,
                importFile: window.electronAPI?.fs?.importFile,
              });
              
              const resolvedPath = prepared.resolvedPath;
              if (resolvedPath && dbService.isAvailable()) {
                const ensured = await ensureProjectDocumentRecord({
                  db: dbService,
                  documentId: null,
                  file: file as File & { path?: string },
                  filePath: resolvedPath,
                });
                
                if (ensured.documentId) {
                  await touchProjectDocumentActivity(dbService, ensured.documentId);
                  
                  if (selectedProjectId) {
                    await moveToProject(ensured.documentId, selectedProjectId);
                  }
                }
              }
            }
            await refreshLibraryView();
          } catch (error) {
            console.error('Failed to import multiple files via browse:', error);
          } finally {
            setImportProgress(null);
          }
        }
        return;
      } catch (error) {
        reportFileOpenError('browse', error);
      }
    }

    fileInputRef.current?.click();
  };

  const handleOpenDocument = async (doc: DBDocument) => {
    // Use Electron's fs API for fast file reading
    try {
      const result = await window.electronAPI.fs.readFile(doc.filepath);
      const bytes = decodeFileData(result.data);
      
      // Create File object with path attached for database tracking
      const blob = new Blob([bytes as unknown as BlobPart], { type: result.mimeType });
      const file = new File([blob], doc.filename || result.name, { type: result.mimeType }) as File & { path: string };
      // Attach the filepath so loadProject can save to DB
      Object.defineProperty(file, 'path', { value: doc.filepath, writable: false });
      
      await loadProject(file, bytes);
      if (doc.last_page > 1) {
        useProjectStore.getState().setPage(doc.last_page);
      }
      setFileOpenError(null);
    } catch (error) {
      reportFileOpenError('recent', error, {
        filename: doc.filename,
        filepath: doc.filepath,
        docId: doc.id
      });
    }
  };

  const handleOpenJobFile = async (job: any) => {
    let docToOpen: any = {
      id: job.documentId,
      filename: job.filename,
      filepath: job.filepath,
      last_page: 1
    };
    
    try {
      if (window.electronAPI?.db?.getDocument) {
        const realDoc = await window.electronAPI.db.getDocument(job.documentId);
        if (realDoc) {
          docToOpen = realDoc;
        }
      }
    } catch (err) {
      console.warn('[UploadScreen] Failed to fetch real document from DB, falling back to job metadata:', err);
    }

    handleOpenDocument(docToOpen);
  };


  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchDocuments(searchQuery);
    }
  };

  useEffect(() => {
    const trimmed = searchQuery.trim();
    const timer = window.setTimeout(() => {
      if (!trimmed) {
        void refreshLibraryView();
        return;
      }
      void searchDocuments(trimmed);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [refreshLibraryView, searchDocuments, searchQuery]);

  const handleDeleteDocument = useCallback(async (documentId: number) => {
    if (selectedDocumentIds.has(documentId)) {
      const confirm = window.confirm(`ต้องการลบไฟล์ที่เลือกทั้งหมด (${selectedDocumentIds.size} ไฟล์) หรือไม่?`);
      if (!confirm) return;
      await Promise.all(
        Array.from(selectedDocumentIds).map(async (id) => {
          await deleteDocument(id);
          setDocumentTagsById((current) => {
            if (!(id in current)) return current;
            const next = { ...current };
            delete next[id];
            return next;
          });
        })
      );
      clearSelection();
    } else {
      const confirm = window.confirm('ต้องการลบไฟล์นี้หรือไม่?');
      if (!confirm) return;
      await deleteDocument(documentId);
      setDocumentTagsById((current) => {
        if (!(documentId in current)) return current;
        const next = { ...current };
        delete next[documentId];
        return next;
      });
    }
    await refreshLibraryView();
  }, [deleteDocument, refreshLibraryView, selectedDocumentIds, clearSelection]);

  const handleToggleFavorite = useCallback(async (docId: number) => {
    if (selectedDocumentIds.has(docId)) {
      await Promise.all(
        Array.from(selectedDocumentIds).map((id) => toggleFavorite(id))
      );
    } else {
      await toggleFavorite(docId);
    }
  }, [selectedDocumentIds, toggleFavorite]);

  const handleUpdateRating = useCallback(async (doc: DBDocument, rating: number) => {
    const isMulti = selectedDocumentIds.has(doc.id);
    const targetDocIds = isMulti ? Array.from(selectedDocumentIds) : [doc.id];
    
    await Promise.all(
      targetDocIds.map(async (docId) => {
        await window.electronAPI.db.updateDocument(docId, { rating });
      })
    );
    
    await refreshLibraryView();
  }, [selectedDocumentIds, refreshLibraryView]);

  const rawSortedDocuments = getSortedDocuments();
  const sortedDocuments = useMemo(() => {
    return rawSortedDocuments.filter(doc => {
      const rating = doc.rating || 0;
      if (ratingFilterMode === 'only') {
        if (ratingFilterOnly === null) return true;
        return rating === ratingFilterOnly;
      } else {
        if (ratingFilterMin !== null && rating < ratingFilterMin) return false;
        if (ratingFilterMax !== null && rating > ratingFilterMax) return false;
        return true;
      }
    });
  }, [rawSortedDocuments, ratingFilterMode, ratingFilterOnly, ratingFilterMin, ratingFilterMax]);

  const currentSubprojects = useMemo(() => {
    if (filterType === 'favorites' || filterType === 'tag') {
      return [];
    }
    if (selectedProjectId !== null) {
      return projects.filter(p => p.parent_id === selectedProjectId);
    }
    return projects.filter(p => p.parent_id === null);
  }, [projects, selectedProjectId, filterType]);

  const openDocumentMenu = useCallback(async (docId: number, position: MenuPosition) => {
    setActiveTagMenu(null);
    setLibraryMenuPosition(null);
    setActiveDocumentMenuId(docId);
    setActiveDocumentMenuPosition(position);

    if (!documentTagsById[docId]) {
      try {
        const documentTags = await loadDocumentTags(docId);
        setDocumentTagsById((current) => ({ ...current, [docId]: documentTags }));
      } catch (error) {
        console.error('Failed to load document tags:', error);
      }
    }
  }, [documentTagsById, loadDocumentTags]);

  const openTagMenu = useCallback((tag: DBTag, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveDocumentMenuId(null);
    setActiveDocumentMenuPosition(null);
    setLibraryMenuPosition(null);
    setActiveProjectMenu(null);
    setActiveTagMenu({
      tag,
      position: getFloatingMenuPosition(event.clientX, event.clientY, 224, 120)
    });
  }, []);

  const openProjectMenu = useCallback((project: DBProject, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveDocumentMenuId(null);
    setActiveDocumentMenuPosition(null);
    setLibraryMenuPosition(null);
    setActiveTagMenu(null);
    setActiveProjectMenu({
      project,
      position: getFloatingMenuPosition(event.clientX, event.clientY, 224, 120)
    });
  }, []);

  const openSortMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveDocumentMenuId(null);
    setActiveDocumentMenuPosition(null);
    setLibraryMenuPosition(null);
    setActiveTagMenu(null);
    setActiveProjectMenu(null);
    const rect = event.currentTarget.getBoundingClientRect();
    setSortMenuPosition({
      x: rect.right - 192, // 192px is w-48
      y: rect.bottom + 8
    });
    setIsSortMenuOpen(true);
  }, []);

  const handleToggleDocumentTag = useCallback(async (doc: DBDocument, tag: DBTag) => {
    const isMulti = selectedDocumentIds.has(doc.id);
    const targetDocIds = isMulti ? Array.from(selectedDocumentIds) : [doc.id];
    
    const currentTags = documentTagsById[doc.id] ?? [];
    const hasTag = currentTags.some(item => item.id === tag.id);

    try {
      if (hasTag) {
        await Promise.all(
          targetDocIds.map(async (docId) => {
            const docTags = documentTagsById[docId] ?? [];
            if (docTags.some(item => item.id === tag.id)) {
              await removeTagFromDocument(docId, tag.id);
              setDocumentTagsById((current) => ({
                ...current,
                [docId]: (current[docId] ?? []).filter(item => item.id !== tag.id)
              }));
            }
          })
        );
      } else {
        await Promise.all(
          targetDocIds.map(async (docId) => {
            const docTags = documentTagsById[docId] ?? [];
            if (!docTags.some(item => item.id === tag.id)) {
              await addTagToDocument(docId, tag.id);
              setDocumentTagsById((current) => ({
                ...current,
                [docId]: [...(current[docId] ?? []), tag].sort((a, b) => a.name.localeCompare(b.name))
              }));
            }
          })
        );
      }
    } catch (error) {
      console.error('Failed to update document tag:', error);
    }
  }, [addTagToDocument, documentTagsById, removeTagFromDocument, selectedDocumentIds]);

  const handleMoveDocumentToProject = useCallback(async (doc: DBDocument, projectId: number | null) => {
    const isMulti = selectedDocumentIds.has(doc.id);
    const targetDocIds = isMulti ? Array.from(selectedDocumentIds) : [doc.id];
    
    await Promise.all(
      targetDocIds.map((docId) => moveToProject(docId, projectId))
    );
    
    if (isMulti) {
      clearSelection();
    }
  }, [moveToProject, selectedDocumentIds, clearSelection]);

  const openProjectDialog = useCallback((documentId: number | null = null, parentId: number | null = null) => {
    setActiveDocumentMenuId(null);
    setActiveDocumentMenuPosition(null);
    setActiveTagMenu(null);
    setLibraryMenuPosition(null);
    setProjectDialog({ isOpen: true, name: '', documentId, parentId });
  }, []);

  const openTagDialog = useCallback((documentId: number | null = null) => {
    setActiveDocumentMenuId(null);
    setActiveDocumentMenuPosition(null);
    setActiveTagMenu(null);
    setLibraryMenuPosition(null);
    setTagDialog({ isOpen: true, name: '', documentId });
  }, []);

  const handleCreateProject = useCallback(async () => {
    const name = projectDialog.name.trim();
    if (!name) return;

    const color = fallbackFolderColors[projects.length % fallbackFolderColors.length];
    const parentId = (projectDialog.parentId !== undefined && projectDialog.parentId !== null) ? projectDialog.parentId : (selectedProjectId ?? null);
    const project = await createProject(name, parentId, color);
    if (!project) return;

    if (projectDialog.documentId) {
      await moveToProject(projectDialog.documentId, project.id);
    }

    setProjectDialog({ isOpen: false, name: '', documentId: null, parentId: null });
  }, [createProject, moveToProject, projectDialog.documentId, projectDialog.name, projectDialog.parentId, projects.length, selectedProjectId]);

  const handleEditProject = useCallback(async () => {
    const { project, name, color } = editProjectDialog;
    if (!project) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const success = await updateProject(project.id, { name: trimmedName, color });
    if (success) {
      setEditProjectDialog({ isOpen: false, project: null, name: '', color: '' });
    }
  }, [editProjectDialog, updateProject]);

  const handleCreateTag = useCallback(async () => {
    const name = tagDialog.name.trim();
    if (!name) return;

    const color = ['#FF8705', '#2B9BFF', '#8B5CF6', '#10B981', '#EC4899'][tags.length % 5];
    const tag = await createTag(name, color);
    if (!tag) return;

    if (tagDialog.documentId) {
      await addTagToDocument(tagDialog.documentId, tag.id);
      setDocumentTagsById((current) => ({
        ...current,
        [tagDialog.documentId!]: [...(current[tagDialog.documentId!] ?? []), tag].sort((a, b) => a.name.localeCompare(b.name))
      }));
    }

    setTagDialog({ isOpen: false, name: '', documentId: null });
  }, [addTagToDocument, createTag, tagDialog.documentId, tagDialog.name, tags.length]);

  const handleDeleteTag = useCallback(async () => {
    const targetTag = deleteTagDialog.tag;
    if (!targetTag) return;
    if (deleteTagDialog.confirmation.trim() !== targetTag.name) return;

    await deleteTag(targetTag.id);

    setDocumentTagsById((current) =>
      Object.fromEntries(
        Object.entries(current).map(([docId, docTags]) => [
          docId,
          docTags.filter((tag) => tag.id !== targetTag.id)
        ])
      )
    );

    if (selectedTagId === targetTag.id) {
      setSelectedTagId(null);
      void loadRecentDocuments();
    } else {
      void loadTags();
    }

    setActiveTagMenu(null);
    setDeleteTagDialog({ isOpen: false, tag: null, confirmation: '' });
  }, [deleteTag, deleteTagDialog.confirmation, deleteTagDialog.tag, loadRecentDocuments, loadTags, selectedTagId, setSelectedTagId]);

  const handleDeleteProject = useCallback(async () => {
    const targetProject = deleteProjectDialog.project;
    if (!targetProject) return;
    if (deleteProjectDialog.confirmation.trim() !== targetProject.name) return;

    await deleteProject(targetProject.id);

    if (selectedProjectId === targetProject.id) {
      setSelectedProjectId(null);
      void loadRecentDocuments();
    } else {
      void loadProjects();
    }

    setActiveProjectMenu(null);
    setDeleteProjectDialog({ isOpen: false, project: null, confirmation: '' });
  }, [deleteProject, deleteProjectDialog.confirmation, deleteProjectDialog.project, loadRecentDocuments, loadProjects, selectedProjectId, setSelectedProjectId]);

  const handleProjectDrop = useCallback(async (projectId: number | null, event?: React.DragEvent) => {
    let ids: number[] = [];
    if (event) {
      try {
        const rawIds = event.dataTransfer.getData('application/x-document-ids');
        if (rawIds) {
          ids = JSON.parse(rawIds);
        }
      } catch (e) {
        console.error('Failed to parse dragged document IDs:', e);
      }
    }
    
    if (ids.length === 0 && draggedDocumentId) {
      ids = [draggedDocumentId];
    }

    if (ids.length === 0) return;

    await Promise.all(
      ids.map(async (docId) => {
        const doc = sortedDocuments.find((d) => d.id === docId);
        if (doc) {
          await handleMoveDocumentToProject(doc, projectId);
        }
      })
    );

    // Clear selection after moving
    clearSelection();
    setDraggedDocumentId(null);
    setProjectDropTargetId(null);
  }, [draggedDocumentId, handleMoveDocumentToProject, sortedDocuments, clearSelection]);

  useEffect(() => {
    const pendingDocs = sortedDocuments
      .filter(doc => !doc.thumbnail_path)
      .slice(0, viewMode === 'grid' ? 8 : 6);

    pendingDocs.forEach((doc) => {
      if (thumbnailJobsRef.current.has(doc.id) || !window.electronAPI?.fs?.readFile) return;

      thumbnailJobsRef.current.add(doc.id);
      void (async () => {
        try {
          const source = await window.electronAPI.fs.readFile(doc.filepath);
          const thumbnail = await generateDocumentThumbnail({
            name: source.name,
            mimeType: source.mimeType,
            data: source.data
          });

          const persisted = await persistDocumentPatch(doc.id, {
            thumbnail_path: thumbnail.dataUrl,
            total_pages: thumbnail.totalPages ?? doc.total_pages
          });
          if (!persisted) {
            console.warn(`[Library] Failed to persist preview for "${doc.filename}"`);
          }
        } catch (error) {
          console.warn(`[Library] Failed to generate preview for "${doc.filename}"`, error);
        } finally {
          thumbnailJobsRef.current.delete(doc.id);
        }
      })();
    });
  }, [persistDocumentPatch, sortedDocuments, viewMode]);

  const renderProjectTree = useCallback((parentId: number | null, level: number = 0) => {
    const levelProjects = projects.filter(p => p.parent_id === parentId);
    return levelProjects.map((project, index) => {
      const displayColor = project.color || resolveThemedAccent(index);
      const hasChildren = projects.some(p => p.parent_id === project.id);
      const isExpanded = expandedProjectIds.has(project.id);

      return (
        <React.Fragment key={project.id}>
          <ProjectItem
            project={project}
            displayColor={displayColor}
            isSelected={selectedProjectId === project.id}
            isDropTarget={projectDropTargetId === project.id}
            level={level}
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            onToggleExpand={() => toggleProjectExpanded(project.id)}
            onDragOver={(event) => {
              if (!draggedDocumentId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setProjectDropTargetId(project.id);
            }}
            onDragLeave={() => {
              if (projectDropTargetId === project.id) {
                setProjectDropTargetId(null);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              void handleProjectDrop(project.id, event);
            }}
            onSelect={() => {
              if (selectedProjectId === project.id) {
                setSelectedProjectId(null);
                loadRecentDocuments();
              } else {
                loadDocumentsByProject(project.id);
              }
            }}
            onContextMenu={(event) => openProjectMenu(project, event)}
          />
          {isExpanded && renderProjectTree(project.id, level + 1)}
        </React.Fragment>
      );
    });
  }, [projects, selectedProjectId, projectDropTargetId, draggedDocumentId, expandedProjectIds, toggleProjectExpanded, handleProjectDrop, loadRecentDocuments, loadDocumentsByProject, openProjectMenu]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#17181b] text-slate-100">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(82,162,255,0.18),transparent_40%),radial-gradient(circle_at_54%_10%,rgba(94,124,255,0.16),transparent_44%),radial-gradient(circle_at_86%_24%,rgba(149,106,255,0.16),transparent_38%),linear-gradient(138deg,rgba(18,22,34,0.98)_0%,rgba(22,31,50,0.985)_38%,rgba(16,24,43,0.995)_68%,rgba(22,17,40,1)_100%)]" />
        <div className="absolute inset-y-0 left-0 w-[24rem] bg-[linear-gradient(90deg,rgba(72,142,255,0.2),rgba(72,142,255,0))]" />
        <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0))]" />
      </div>

      <div className="relative z-10 flex h-full w-full">
        {/* Left Navigation Sidebar */}
        <div className="w-16 bg-[#0e0f11]/86 border-r border-white/6 backdrop-blur-xl flex flex-col items-center py-4">
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
        <div className={`transition-all duration-300 ease-in-out border-r border-white/6 bg-[#111214]/74 backdrop-blur-xl flex flex-col overflow-hidden shrink-0 ${
          isSidebarOpen ? 'w-56 p-4 opacity-100' : 'w-0 p-0 border-r-0 opacity-0 pointer-events-none'
        }`}>
        {activePage === 'home' ? (
          <>
            {/* Quick Filters */}
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-3">Library</h2>
            <div className="space-y-1 mb-6">
              <button
                onClick={() => loadRecentDocuments()}
                className={`w-full p-2.5 rounded-lg text-left text-sm flex items-center gap-3 border transition-all ${
                  filterType === 'recent'
                    ? 'border-white/12 bg-[#25282d] text-slate-100'
                    : 'border-transparent hover:border-white/8 hover:bg-white/[0.04] text-slate-300'
                }`}
              >
                <Clock size={16} /> Recent
              </button>
              <button
                onClick={() => loadFavoriteDocuments()}
                className={`w-full p-2.5 rounded-lg text-left text-sm flex items-center gap-3 border transition-all ${
                  filterType === 'favorites'
                    ? 'border-white/12 bg-[#25282d] text-slate-100'
                    : 'border-transparent hover:border-white/8 hover:bg-white/[0.04] text-slate-300'
                }`}
              >
                <Star size={16} /> Favorites
              </button>
            </div>

            {/* Tags */}
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-3 flex items-center justify-between">
              Tags
              <button
                onClick={() => openTagDialog()}
                className="p-1 rounded hover:bg-white/10"
                title="Create Tag"
              >
                <Plus size={12} />
              </button>
            </h2>
            <div className="flex flex-wrap gap-2 mb-6">
              <TagPill
                tag={{ id: 0, name: 'No tags', color: '#64748b', created_at: '' }}
                displayColor="#64748b"
                isSelected={selectedTagId === 0}
                onContextMenu={(event) => event.preventDefault()}
                onClick={() => {
                  setActiveTagMenu(null);
                  if (selectedTagId === 0) {
                    setSelectedTagId(null);
                    loadRecentDocuments();
                  } else {
                    loadDocumentsByTag(0);
                  }
                }}
              />
              {tags.map((tag, index) => (
                <TagPill 
                  key={tag.id} 
                  tag={tag} 
                  displayColor={resolveThemedAccent(index)}
                  isSelected={selectedTagId === tag.id}
                  onContextMenu={(event) => openTagMenu(tag, event)}
                  onClick={() => {
                    setActiveTagMenu(null);
                    if (selectedTagId === tag.id) {
                      setSelectedTagId(null);
                      loadRecentDocuments();
                    } else {
                      loadDocumentsByTag(tag.id);
                    }
                  }}
                />
              ))}
            </div>

            {/* Projects */}
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-3 flex items-center justify-between">
              Projects
              <button
                onClick={() => openProjectDialog()}
                className="p-1 rounded hover:bg-white/10"
                title="Create Folder"
              >
                <Plus size={12} />
              </button>
            </h2>
            <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
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
                  <div className="font-semibold text-slate-300 truncate" title={gpuInfo?.gpus.join(', ')}>
                    Device: {gpuInfo?.gpus[0] || 'Loading...'}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : activePage === 'projects' ? (
          <>
            {/* Projects Page Sidebar */}
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
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
          <>
            {/* Settings Page Sidebar */}
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <Settings2 className="text-slate-300" size={20} /> Settings
            </h2>

            <div className="flex-1 overflow-y-auto space-y-5 custom-scrollbar pr-1">
              <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-2">
                <label className="text-[11px] font-semibold text-slate-300">Gemini API Key</label>
                <div className="relative">
                  <KeyRound size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showGeminiApiKey ? 'text' : 'password'}
                    value={geminiApiKeyDraft}
                    onChange={(e) => setGeminiApiKeyDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void saveGeminiApiKey();
                      }
                    }}
                    placeholder={geminiInputPlaceholder}
                    className="w-full rounded-lg border border-white/12 bg-slate-900/85 pl-7 pr-8 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#2B9BFF]/55"
                    disabled={!isGeminiApiKeyLoaded || isGeminiApiKeySaving}
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiApiKey((prev) => !prev)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10"
                    title={showGeminiApiKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showGeminiApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveGeminiApiKey()}
                    disabled={!geminiApiKeyDraft.trim() || isGeminiApiKeySaving || !isGeminiApiKeyLoaded}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check size={12} />
                    Save Securely
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearGeminiApiKey()}
                    disabled={(!hasGeminiApiKey && geminiApiKeySource !== 'environment') || isGeminiApiKeySaving || !isGeminiApiKeyLoaded}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-slate-900/70 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition-colors hover:border-white/20 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X size={12} />
                    Clear Saved Key
                  </button>
                </div>
                <p className={`text-[10px] leading-relaxed ${geminiStatusClass}`}>
                  {geminiStatusLabel}
                </p>
                {geminiApiKeyError && (
                  <p className="text-[10px] leading-relaxed text-rose-300/90">
                    {geminiApiKeyError}
                  </p>
                )}
              </div>

              {/* Model Downloader / Management */}
              <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-3">
                <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                  <Download size={12} className="text-slate-400" />
                  การจัดการโมเดล OCR (Model Management)
                </label>
                
                <div className="space-y-3 text-xs">
                  {/* Thai OCR Model */}
                  <div className="rounded-lg bg-slate-900/50 p-2 border border-white/5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">โมเดลภาษาไทย (Thai Model)</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                        paddleThaiStatus.downloading
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                          : paddleThaiStatus.installed
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-slate-500/10 text-slate-400 border border-white/10'
                      }`}>
                        {paddleThaiStatus.downloading ? 'กำลังดาวน์โหลด...' : paddleThaiStatus.installed ? 'ติดตั้งแล้ว' : 'ไม่ได้ติดตั้ง'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">PaddleOCR PP-OCRv5 Thai Model (~15MB)</span>
                      <button
                        type="button"
                        onClick={() => handleDownloadModel('th')}
                        disabled={paddleThaiStatus.checking || paddleThaiStatus.downloading || paddleThaiStatus.installed}
                        className="rounded bg-[#2B9BFF] hover:bg-[#1a85e8] disabled:bg-slate-800 disabled:text-slate-500 px-2 py-1 text-[10px] font-semibold text-white transition-colors"
                      >
                        {paddleThaiStatus.downloading ? 'Downloading...' : paddleThaiStatus.installed ? 'Installed' : 'Download'}
                      </button>
                    </div>
                    {paddleThaiStatus.downloading && (
                      <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                        <div className="bg-[#2B9BFF] h-1 rounded-full animate-pulse" style={{ width: '65%' }}></div>
                      </div>
                    )}
                  </div>

                  {/* English OCR Model */}
                  <div className="rounded-lg bg-slate-900/50 p-2 border border-white/5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">โมเดลภาษาอังกฤษ (English Model)</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                        paddleEnglishStatus.downloading
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                          : paddleEnglishStatus.installed
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-slate-500/10 text-slate-400 border border-white/10'
                      }`}>
                        {paddleEnglishStatus.downloading ? 'กำลังดาวน์โหลด...' : paddleEnglishStatus.installed ? 'ติดตั้งแล้ว' : 'ไม่ได้ติดตั้ง'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">PaddleOCR English Model (~10MB)</span>
                      <button
                        type="button"
                        onClick={() => handleDownloadModel('en')}
                        disabled={paddleEnglishStatus.checking || paddleEnglishStatus.downloading || paddleEnglishStatus.installed}
                        className="rounded bg-[#2B9BFF] hover:bg-[#1a85e8] disabled:bg-slate-800 disabled:text-slate-500 px-2 py-1 text-[10px] font-semibold text-white transition-colors"
                      >
                        {paddleEnglishStatus.downloading ? 'Downloading...' : paddleEnglishStatus.installed ? 'Installed' : 'Download'}
                      </button>
                    </div>
                    {paddleEnglishStatus.downloading && (
                      <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                        <div className="bg-[#2B9BFF] h-1 rounded-full animate-pulse" style={{ width: '65%' }}></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Security Settings */}
              <SecuritySettings />

              {/* Hardware Acceleration GPU Status */}
              <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-2.5">
                <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                  <Cpu size={12} className="text-slate-400" />
                  Hardware Acceleration / GPU Status
                </label>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Acceleration Mode</span>
                    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                      gpuInfo && gpuInfo.mode !== 'CPU'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${gpuInfo && gpuInfo.mode !== 'CPU' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                      {getGpuModeLabel(gpuInfo)}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-slate-400 shrink-0">Detected GPUs</span>
                    <div className="text-slate-200 text-right truncate font-mono text-[10px]" title={gpuInfo?.gpus.join(', ')}>
                      {gpuInfo?.gpus.join(', ') || 'None'}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">DirectML Support</span>
                    <span className={`text-[10px] font-semibold ${gpuInfo?.hasDirectML ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {gpuInfo?.hasDirectML ? 'Available' : 'Unavailable'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">CUDA Support</span>
                    <span className={`text-[10px] font-semibold ${gpuInfo?.hasCuda ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {gpuInfo?.hasCuda ? 'Available' : 'Unavailable'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-normal border-t border-white/5 pt-2">
                    {gpuInfo && gpuInfo.mode !== 'CPU'
                      ? 'GPU Acceleration is active. The system will leverage DirectML/CUDA for OCR processing.'
                      : 'Running on CPU. If you have an AMD/Intel/NVIDIA GPU, make sure you ran setup correctly to enable hardware acceleration.'}
                  </p>
                </div>
              </div>

              {isThaiTargetLanguage && (
                <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-2.5">
                  <label className="text-[11px] font-semibold text-slate-300">Overlay Font</label>

                  <select
                    value={overlayFontPreset}
                    onChange={(e) => setOverlayFontPreset(e.target.value as OverlayFontPreset)}
                    className="w-full rounded-lg border border-white/12 bg-slate-900/85 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#2B9BFF]/55"
                    aria-label="Overlay font preset"
                    title="Overlay font preset"
                  >
                    {OVERLAY_FONT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>

                  <p className={`text-[10px] leading-relaxed ${
                    selectedFontAvailable === false
                      ? 'text-amber-300/90'
                      : selectedFontAvailable === true
                        ? 'text-emerald-300/85'
                        : 'text-slate-500'
                  }`}>
                    Font status: {
                      selectedFontAvailable === false
                        ? 'fallback in use (font not detected)'
                        : selectedFontAvailable === true
                          ? 'detected and ready'
                          : 'unknown'
                    }
                  </p>
                </div>
              )}

              <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-3">
                <label className="text-[11px] font-semibold text-slate-300">OCR Runtime</label>
                <div className="grid grid-cols-12 items-center gap-2">
                  <label className="col-span-5 text-[11px] font-semibold text-slate-300">Timeout</label>
                  <select
                    value={ocrOptions.perPageTimeoutSec ?? OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT}
                    onChange={(e) => setOCROptions({ perPageTimeoutSec: Number(e.target.value) })}
                    aria-label="OCR timeout seconds per page"
                    title="OCR timeout seconds per page"
                    className="col-span-7 rounded-lg border border-white/12 bg-slate-900/80 px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#2B9BFF]/55"
                  >
                    <option value={0}>No Limit</option>
                    <option value={30}>30s</option>
                    <option value={60}>60s</option>
                    <option value={120}>120s</option>
                    <option value={180}>180s</option>
                    <option value={300}>300s</option>
                  </select>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/55 px-2.5 py-2">
                  <span className="text-[11px] font-semibold text-slate-300">Skip if text exists</span>
                  <input
                    type="checkbox"
                    checked={ocrOptions.skipIfTextExists !== false}
                    onChange={(e) => setOCROptions({ skipIfTextExists: e.target.checked })}
                    className="accent-[#2B9BFF]"
                    aria-label="Skip OCR if Text Exists"
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

        {/* Main Content Area */}
        <div className="relative flex-1 flex flex-col overflow-hidden bg-[#25272b]">
          {/* Toolbar */}
          <div className="relative overflow-hidden border-b border-white/6 px-4 pt-4 pb-5 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="absolute inset-0 bg-[linear-gradient(98deg,rgba(60,134,223,0.9)_0%,rgba(58,152,224,0.86)_34%,rgba(74,120,213,0.88)_66%,rgba(112,84,194,0.88)_100%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.14)_0%,rgba(0,0,0,0.05)_18%,rgba(0,0,0,0.04)_82%,rgba(0,0,0,0.12)_100%)]" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.03)_0%,rgba(0,0,0,0.05)_48%,rgba(0,0,0,0.09)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0))]" />
            <div className="relative z-10 flex items-center gap-4">
              {/* Sidebar Toggle */}
              <button
                onClick={toggleSidebar}
                className="p-2 rounded-lg bg-[#202329]/90 border border-white/8 text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] transition-all flex items-center justify-center shrink-0"
                title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              >
                {isSidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>

              {/* Search */}
              <form onSubmit={handleSearch} className="flex-1 max-w-md">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                  <input
                    type="text"
                    placeholder="Search documents..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-[#1f2227]/92 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-[#5CC6F2]/30 focus:ring-2 focus:ring-[#5CC6F2]/10"
                  />
                </div>
              </form>

              {/* View Mode Toggle */}
              <div className="flex items-center bg-[#202329]/90 rounded-lg p-1 border border-white/8">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded-md transition-all ${
                    viewMode === 'grid'
                      ? 'bg-[#353942] text-slate-100'
                      : 'text-slate-500 hover:text-slate-200'
                  }`}
                >
                  <Grid3X3 size={16} />
                </button>
                <button
                  onClick={() => setViewMode('detail')}
                  className={`p-2 rounded-md transition-all ${
                    viewMode === 'detail'
                      ? 'bg-[#353942] text-slate-100'
                      : 'text-slate-500 hover:text-slate-200'
                  }`}
                >
                  <List size={16} />
                </button>
              </div>

              {/* Spacer to push filter button to the right corner */}
              <div className="flex-1" />

              {/* Sort / Filter Button */}
              <div className="relative">
                <button
                  onClick={openSortMenu}
                  className={`p-2 rounded-lg bg-[#202329]/90 border border-white/8 text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] transition-all flex items-center justify-center shrink-0 ${
                    isSortMenuOpen ? 'text-[#5CC6F2] border-[#5CC6F2]/30' : ''
                  }`}
                  title="Sort options"
                >
                  <Filter size={16} />
                </button>
              </div>
            </div>
          </div>

          {/* File Open Error Banner */}
          {fileOpenError && (
            <div className="mx-4 mt-4 mb-2 rounded-xl border border-amber-400/45 bg-amber-400/12 backdrop-blur-xl px-4 py-3 text-sm text-amber-100 flex items-start gap-3">
              <div className="mt-0.5 text-amber-300">
                <AlertTriangle size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Open failed</span>
                  <span className="text-[10px] text-amber-200/80">
                    {new Date(fileOpenError.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-[11px] text-amber-100/90 mt-1">
                  {fileOpenError.filename ? `${fileOpenError.filename} — ` : ''}
                  {fileOpenError.message}
                </p>
                <p className="text-[11px] text-amber-100/70 mt-1">
                  {getFileOpenHint(fileOpenError.message)}
                </p>
                {fileOpenError.filepath && (
                  <p className="text-[10px] text-amber-100/65 mt-1 truncate">
                    {fileOpenError.filepath}
                  </p>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  {fileOpenError.context === 'recent' && fileOpenError.docId !== undefined ? (
                    <>
                      <button
                        onClick={() => {
                          const doc = documents.find(d => d.id === fileOpenError.docId);
                          if (doc) {
                            handleOpenDocument(doc);
                          } else {
                            handleBrowse();
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-amber-300 text-slate-900 text-xs font-semibold hover:bg-amber-200 transition-colors flex items-center gap-1"
                      >
                        <RefreshCw size={12} /> Retry
                      </button>
                      <button
                        onClick={async () => {
                          if (fileOpenError.docId !== undefined) {
                            await handleDeleteDocument(fileOpenError.docId);
                          }
                          setFileOpenError(null);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-900/75 border border-white/10 text-amber-100 text-xs hover:bg-slate-800 transition-colors"
                      >
                        Remove from Recent
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleBrowse}
                      className="px-3 py-1.5 rounded-lg bg-amber-300 text-slate-900 text-xs font-semibold hover:bg-amber-200 transition-colors flex items-center gap-1"
                    >
                      <RefreshCw size={12} /> Browse Again
                    </button>
                  )}
                  <button
                    onClick={() => setFileOpenError(null)}
                    className="px-3 py-1.5 rounded-lg bg-slate-900/75 border border-white/10 text-amber-100 text-xs hover:bg-slate-800 transition-colors flex items-center gap-1"
                  >
                    <X size={12} /> Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Documents Grid/List */}
          <div
            className="flex-1 overflow-y-auto p-4 custom-scrollbar"
            onContextMenu={(e) => {
              if ((e.target as HTMLElement).closest('[data-document-card="true"]')) return;
              e.preventDefault();
              setActiveDocumentMenuId(null);
              setActiveDocumentMenuPosition(null);
              setActiveTagMenu(null);
              setLibraryMenuPosition(getFloatingMenuPosition(e.clientX, e.clientY, 224, 156));
            }}
          >
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-slate-300/80"></div>
              </div>
            ) : (sortedDocuments.length > 0 || currentSubprojects.length > 0) ? (
              <div className="h-full overflow-y-auto pr-1 custom-scrollbar pb-20">
                {/* 📂 Render Folder Grid/List first */}
                {viewMode === 'grid' ? (
                  currentSubprojects.length > 0 && (
                    <div className="mb-6">
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 px-1">Folders ({currentSubprojects.length})</h3>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                        {currentSubprojects.map((subproj, index) => {
                          const accent = subproj.color || resolveStableAccent(subproj.id);
                          return (
                            <div
                              key={subproj.id}
                              onClick={() => {
                                loadDocumentsByProject(subproj.id);
                              }}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                openProjectMenu(subproj, e);
                              }}
                              className="group p-3 rounded-xl border border-white/5 hover:border-white/12 bg-[#16181c]/70 hover:bg-[#1b1e23] transition-all flex items-center gap-3 cursor-pointer select-none"
                            >
                              <div 
                                className="p-1.5 rounded-lg shrink-0 flex items-center justify-center"
                                style={{ backgroundColor: hexToRgba(accent, 0.14) }}
                              >
                                <Folder size={16} style={{ color: accent }} />
                              </div>
                              <span className="flex-1 truncate text-xs font-medium text-slate-200 group-hover:text-white">{subproj.name}</span>
                              <ChevronRight size={12} className="text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
                ) : (
                  currentSubprojects.length > 0 && (
                    <div className="mb-4 space-y-1">
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 px-1">Folders ({currentSubprojects.length})</h3>
                      {currentSubprojects.map((subproj, index) => {
                        const accent = subproj.color || resolveStableAccent(subproj.id);
                        return (
                          <div
                            key={subproj.id}
                            onClick={() => {
                              loadDocumentsByProject(subproj.id);
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              openProjectMenu(subproj, e);
                            }}
                            className="group px-4 py-2.5 rounded-xl border border-white/5 hover:border-white/12 bg-[#16181c]/50 hover:bg-[#1b1e23] transition-all flex items-center gap-3 cursor-pointer select-none"
                          >
                            <div 
                              className="p-1.5 rounded-lg shrink-0 flex items-center justify-center"
                              style={{ backgroundColor: hexToRgba(accent, 0.14) }}
                            >
                              <Folder size={14} style={{ color: accent }} />
                            </div>
                            <span className="flex-1 truncate text-xs font-medium text-slate-200 group-hover:text-white">{subproj.name}</span>
                            <ChevronRight size={12} className="text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
                          </div>
                        );
                      })}
                    </div>
                  )
                )}

                {/* 📄 Render Documents Grid/List */}
                {sortedDocuments.length > 0 ? (
                  <>
                    {currentSubprojects.length > 0 && (
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 mt-2 px-1">Files ({sortedDocuments.length})</h3>
                    )}
                    <div className={viewMode === 'grid'
                      ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
                      : 'space-y-2'
                    }>
                      {sortedDocuments.map(doc => (
                        <DocumentCard
                          key={doc.id}
                          doc={doc}
                          viewMode={viewMode}
                          isSelected={selectedDocumentIds.has(doc.id)}
                          isMultiSelectActive={selectedDocumentIds.size > 0}
                          onOpen={() => handleOpenDocument(doc)}
                          onToggleFavorite={() => void handleToggleFavorite(doc.id)}
                          onDelete={() => void handleDeleteDocument(doc.id)}
                          isMenuOpen={activeDocumentMenuId === doc.id}
                          menuPosition={activeDocumentMenuPosition}
                          documentTags={documentTagsById[doc.id] ?? []}
                          tags={tags}
                          projects={projects}
                          onRequestMenu={(position) => void openDocumentMenu(doc.id, position)}
                          onCloseMenu={() => {
                            setActiveDocumentMenuId(null);
                            setActiveDocumentMenuPosition(null);
                          }}
                          onToggleTag={(tag) => void handleToggleDocumentTag(doc, tag)}
                          onMoveToProject={(projectId) => void handleMoveDocumentToProject(doc, projectId)}
                          onToggleSelect={() => toggleDocumentSelection(doc.id)}
                          onCreateTag={() => openTagDialog(doc.id)}
                          onDragStart={(e) => {
                            const ids = selectedDocumentIds.has(doc.id)
                              ? Array.from(selectedDocumentIds)
                              : [doc.id];
                            e.dataTransfer.setData('application/x-document-ids', JSON.stringify(ids));
                            e.dataTransfer.effectAllowed = 'move';
                            setDraggedDocumentId(doc.id);
                            setActiveDocumentMenuId(null);
                            setActiveDocumentMenuPosition(null);
                            setLibraryMenuPosition(null);
                          }}
                          onDragEnd={() => {
                            setDraggedDocumentId(null);
                            setProjectDropTargetId(null);
                          }}
                          isThumbnailHidden={hiddenThumbnails.has(doc.id)}
                          onToggleHideThumbnail={() => toggleHideThumbnail(doc.id)}
                          onOCRAllPages={() => openOcrBackgroundDialog(doc)}
                          onUpdateRating={(rating) => void handleUpdateRating(doc, rating)}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  currentSubprojects.length > 0 && (
                    <div className="rounded-xl border border-white/5 bg-[#16181c]/30 p-8 text-center text-xs text-slate-500 mt-2 select-none">
                      No documents in this folder level. Drag and drop files here to upload.
                    </div>
                  )
                )}
              </div>
            ) : (
              // Empty State / Upload Area with Recent Files
              <div className="h-full flex flex-col">
                {/* Recent Files Section */}
                {documents.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                      <Clock size={14} className="text-slate-300" />
                      Recent Files
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {documents.slice(0, 5).map(doc => {
                        const isHidden = hiddenThumbnails.has(doc.id);
                        return (
                          <button
                            key={doc.id}
                            onClick={() => handleOpenDocument(doc)}
                            className="flex items-center gap-3 p-3 rounded-xl bg-[#17191d]/78 border border-white/8 hover:border-white/12 hover:bg-[#1d2025] transition-all text-left group backdrop-blur-xl relative"
                          >
                            <div className="h-14 w-10 overflow-hidden rounded-lg bg-[#111214]/90 border border-white/5 group-hover:border-white/10 flex items-center justify-center shrink-0 relative">
                              {isHidden ? (
                                <div className="h-full w-full bg-[#f8fafc] border border-slate-200 shadow-inner flex items-center justify-center relative overflow-hidden">
                                  <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:6px_6px] opacity-25" />
                                  <FileText size={14} className="text-slate-300 relative z-10" />
                                </div>
                              ) : doc.thumbnail_path ? (
                                <img src={doc.thumbnail_path} alt={doc.filename} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  {getFileIcon(doc.file_type)}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-100 truncate">{doc.filename}</p>
                              <p className="text-[10px] text-slate-400">{formatDate(doc.last_accessed)}</p>
                            </div>
                            
                            {/* Toggle Button for Privacy on hover */}
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                toggleHideThumbnail(doc.id); 
                              }}
                              className={`absolute top-2 right-2 p-1 rounded-md transition-all z-10 ${
                                isHidden 
                                  ? 'bg-[#839958] text-white border border-[#839958]' 
                                  : 'bg-[#111214]/90 text-slate-500 border border-white/5 opacity-0 group-hover:opacity-100 hover:text-slate-200'
                              }`}
                              title={isHidden ? 'แสดงรูปภาพตัวอย่าง' : 'ซ่อนรูปภาพตัวอย่าง'}
                            >
                              {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
                            </button>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Upload Area */}
                <div className="flex-1 flex items-center justify-center">
                  <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    className={`w-full max-w-xl aspect-video rounded-3xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-300 backdrop-blur-xl ${
                      isDragging
                        ? 'border-white/20 bg-white/[0.04] scale-[1.015] shadow-[0_24px_60px_rgba(0,0,0,0.22)]'
                        : 'border-white/12 bg-[#17191d]/68 hover:border-white/16'
                    }`}
                  >
                    <div className="p-5 rounded-full bg-slate-900/85 border border-white/10 mb-5 shadow-2xl">
                      <Upload size={40} className="text-slate-200" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">
                      {documents.length === 0 ? 'No documents yet' : 'No results found'}
                    </h3>
                    <p className="text-slate-400 mb-6 text-sm">
                      {documents.length === 0
                        ? 'Drag & drop PDF or images to get started'
                        : 'Try a different search term or filter'
                      }
                    </p>

                    <button
                      onClick={handleBrowse}
                      className="px-6 py-2.5 bg-[#262a30] hover:bg-[#2d3138] text-white rounded-xl font-bold cursor-pointer transition-all border border-white/10 text-sm"
                    >
                      Browse Files
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Right: Project Settings */}
        <div className="w-72 bg-[#1b1d22]/96 border-l border-white/6 p-5 flex flex-col overflow-y-auto backdrop-blur-xl">
         <h2 className="text-base font-bold mb-3 flex items-center gap-1">
            Import
          </h2>

          {/* Quick Upload */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`p-4 rounded-xl border-2 border-dashed mb-4 text-center transition-all ${
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
              {(() => {
                const profiles = [
                  { id: 'adaptive', name: 'Flexibility', icon: Compass, activeBg: 'linear-gradient(180deg, rgba(20,184,166,0.22) 0%, rgba(19,48,58,0.92) 100%)', textTheme: 'text-[#E6FFF9]', iconTheme: 'text-[#99F6E4]' },
                  { id: 'manga', name: 'Manga Style', icon: Sparkles, activeBg: 'linear-gradient(180deg, rgba(139,92,246,0.28) 0%, rgba(46,28,82,0.92) 100%)', textTheme: 'text-[#F4E8FF]', iconTheme: 'text-[#D8B4FE]' },
                  { id: 'manhwa', name: 'Manhwa Style', icon: Flame, activeBg: 'linear-gradient(180deg, rgba(236,72,153,0.24) 0%, rgba(66,24,44,0.92) 100%)', textTheme: 'text-[#FFE7F3]', iconTheme: 'text-[#F9A8D4]' },
                  { id: 'official', name: 'Official Doc', icon: ScrollText, activeBg: 'linear-gradient(180deg, rgba(67,135,255,0.2) 0%, rgba(17,28,48,0.9) 100%)', textTheme: 'text-[#EDF4FF]', iconTheme: 'text-[#A8CFFF]' }
                ];
                const activeProfile = profiles.find(p => p.id === translationMode) || profiles[0];
                const ActiveIcon = activeProfile.icon;

                return (
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
                                setTranslationMode(prof.id as any);
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
                );
              })()}
            </div>
          </div>

          {/* Safety Settings (Collapsed by default) */}
          <details className="mb-1">
            <summary className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-0 cursor-pointer flex items-center gap-2">
              <Shield size={12} /> Safety Filters
            </summary>
            <div className="space-y-4 mt-3">
              {Object.entries(safetySettings).map(([key, value]) => (
                <div key={key}>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs capitalize text-slate-300">{key}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-900/85 border border-white/10 rounded text-slate-400 uppercase">{value}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mb-1.5 leading-relaxed">
                    {SAFETY_LEVEL_PREVIEW[key as keyof SafetySettings][value as 'off' | 'low' | 'medium' | 'high']}
                  </p>
                  <input
                    type="range"
                    min="0"
                    max="3"
                    step="1"
                    value={['off', 'low', 'medium', 'high'].indexOf(value)}
                    onChange={(e) => {
                      const levels = ['off', 'low', 'medium', 'high'] as const;
                      updateSafetySettings({ [key]: levels[parseInt(e.target.value)] });
                    }}
                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[#2B9BFF]"
                  />
                </div>
              ))}
            </div>
          </details>

          {/* Background Queue Monitor */}
          <div className="mt-4 border-t border-white/6 pt-5">
            <div className="flex items-center justify-between mb-3">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] flex items-center gap-1.5">
                <Cpu size={12} className="text-slate-400" /> Queue Monitor
              </label>
              {jobs.some(j => ['completed', 'failed', 'cancelled'].includes(j.status)) && (
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
                        
                        {/* Queue reorder buttons: ^ and v */}
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

                      {/* Progress and status message */}
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-[9px]">
                          <span className={`truncate max-w-[175px] ${
                            isActive ? 'text-[#2B9BFF] animate-pulse font-medium' :
                            isJobPaused ? 'text-amber-400/90' :
                            job.status === 'completed' ? 'text-emerald-400/90' :
                            job.status === 'failed' ? 'text-rose-400/90' :
                            job.status === 'cancelled' ? 'text-slate-400/90' :
                            'text-slate-400'
                          }`}>
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
                          <span className="font-semibold text-slate-300">
                            {job.progress}%
                          </span>
                        </div>
                        <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden border border-white/4">
                          <div 
                            className={`h-full rounded-full transition-all duration-300 ${
                              isActive ? 'bg-[#2B9BFF]' :
                              isJobPaused ? 'bg-amber-400/80' :
                              job.status === 'completed' ? 'bg-emerald-400/80' :
                              job.status === 'failed' ? 'bg-rose-500/80' :
                              job.status === 'cancelled' ? 'bg-slate-500' :
                              'bg-slate-700'
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

          <div className="mt-auto" />
        </div>

        {libraryMenuPosition && createPortal(
          <div
            data-library-floating-menu="true"
            className="fixed z-[160] w-56 rounded-2xl border border-white/15 bg-slate-950/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
            style={{ left: libraryMenuPosition.x, top: libraryMenuPosition.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              onClick={() => openProjectDialog()}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-white/10"
            >
              <FolderPlus size={14} />
              New Folder
            </button>
            <button
              onClick={() => openTagDialog()}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-white/10"
            >
              <Tag size={14} />
              New Tag
            </button>
            <button
              onClick={() => {
                loadRecentDocuments();
                setLibraryMenuPosition(null);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-white/10"
            >
              <RefreshCw size={14} />
              Refresh Library
            </button>
          </div>,
          document.body
        )}

        {activeTagMenu && (
          <TagContextMenu
            tag={activeTagMenu.tag}
            position={activeTagMenu.position}
            onClose={() => setActiveTagMenu(null)}
            onDelete={() => {
              setDeleteTagDialog({
                isOpen: true,
                tag: activeTagMenu.tag,
                confirmation: ''
              });
            }}
          />
        )}

        {activeProjectMenu && (
          <ProjectContextMenu
            project={activeProjectMenu.project}
            position={activeProjectMenu.position}
            onClose={() => setActiveProjectMenu(null)}
            onDelete={() => {
              setDeleteProjectDialog({
                isOpen: true,
                project: activeProjectMenu.project,
                confirmation: ''
              });
            }}
            onEdit={() => {
              setEditProjectDialog({
                isOpen: true,
                project: activeProjectMenu.project,
                name: activeProjectMenu.project.name,
                color: activeProjectMenu.project.color || resolveStableAccent(activeProjectMenu.project.id)
              });
            }}
            onCreateSubfolder={() => {
              openProjectDialog(null, activeProjectMenu.project.id);
            }}
          />
        )}

        {isSortMenuOpen && sortMenuPosition && (
          <SortContextMenu
            position={sortMenuPosition}
            sortBy={sortBy}
            sortOrder={sortOrder}
            ratingFilterMode={ratingFilterMode}
            ratingFilterOnly={ratingFilterOnly}
            ratingFilterMin={ratingFilterMin}
            ratingFilterMax={ratingFilterMax}
            onUpdateFilters={(updates) => {
              if (updates.mode !== undefined) setRatingFilterMode(updates.mode);
              if (updates.only !== undefined) setRatingFilterOnly(updates.only);
              if (updates.min !== undefined) setRatingFilterMin(updates.min);
              if (updates.max !== undefined) setRatingFilterMax(updates.max);
            }}
            onSelect={(key, order) => {
              setSortBy(key);
              setSortOrder(order);
            }}
            onClose={() => {
              setIsSortMenuOpen(false);
              setSortMenuPosition(null);
            }}
          />
        )}

        {ocrBackgroundDialog.isOpen && ocrBackgroundDialog.doc && (
          <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/65 backdrop-blur-md">
            <div className="w-full max-w-md rounded-3xl border border-white/12 bg-[#0e1116]/96 p-6 shadow-[0_32px_96px_rgba(0,0,0,0.6)] text-left flex flex-col gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <Cpu className="text-cyan-400" size={18} />
                  ประมวลผลทุกหน้าเบื้องหลัง
                </h3>
                <div className="mt-2 flex flex-col gap-1 bg-white/[0.03] border border-white/5 p-2.5 rounded-2xl">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ชื่อไฟล์:</span>
                  <span className="text-xs font-semibold text-slate-300 truncate font-mono">{ocrBackgroundDialog.doc.filename}</span>
                  {dialogCachePages !== null && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[10px] font-semibold text-emerald-400">
                        แปล/ทำ OCR ไปแล้ว {dialogCachePages} จาก {ocrBackgroundDialog.doc.total_pages} หน้า ({Math.round((dialogCachePages / ocrBackgroundDialog.doc.total_pages) * 100)}%)
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* OCR Engine selection */}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Model Engine</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOcrBackgroundDialog(prev => ({ ...prev, model: 'paddleocr' }))}
                    className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs ${
                      ocrBackgroundDialog.model === 'paddleocr'
                        ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.15)] font-semibold'
                        : 'border-white/5 bg-slate-900/40 text-slate-500 hover:border-white/10 hover:text-slate-300'
                    }`}
                  >
                    <span className="font-semibold">PaddleOCR</span>
                    <span className="text-[8px] opacity-75 mt-0.5">แนะนำสำหรับมังงะ/รูปภาพ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOcrBackgroundDialog(prev => ({ ...prev, model: 'easyocr' }))}
                    className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs ${
                      ocrBackgroundDialog.model === 'easyocr'
                        ? 'border-violet-500/50 bg-violet-500/10 text-violet-200 shadow-[0_0_15px_rgba(139,92,246,0.15)] font-semibold'
                        : 'border-white/5 bg-slate-900/40 text-slate-500 hover:border-white/10 hover:text-slate-300'
                    }`}
                  >
                    <span className="font-semibold">EasyOCR</span>
                    <span className="text-[8px] opacity-75 mt-0.5">ทางเลือก (เอกสารทั่วไป)</span>
                  </button>
                </div>
              </div>

              {/* Profile Selection */}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">รูปแบบการทำงาน</label>
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition-all ${
                    ocrBackgroundDialog.profile === 'offline_all'
                      ? 'border-sky-500/50 bg-sky-500/10 text-slate-100 shadow-[0_0_15px_rgba(14,165,233,0.12)]'
                      : 'border-white/5 bg-slate-900/30 text-slate-500 hover:border-white/10 hover:bg-slate-900/50'
                  }`}>
                    <input
                      type="radio"
                      name="background_ocr_profile"
                      checked={ocrBackgroundDialog.profile === 'offline_all'}
                      onChange={() => setOcrBackgroundDialog(prev => ({ ...prev, profile: 'offline_all' }))}
                      className="mt-0.5 accent-sky-400"
                    />
                    <div className="text-xs flex-1">
                      <div className={`font-semibold ${ocrBackgroundDialog.profile === 'offline_all' ? 'text-sky-300' : 'text-slate-300'}`}>Offline Translate All</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">รัน OCR พร้อมแปลเนื้อหาเป้าหมายลงฐานข้อมูล</div>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition-all ${
                    ocrBackgroundDialog.profile === 'ocr_all'
                      ? 'border-indigo-500/50 bg-indigo-500/10 text-slate-100 shadow-[0_0_15px_rgba(99,102,241,0.12)]'
                      : 'border-white/5 bg-slate-900/30 text-slate-500 hover:border-white/10 hover:bg-slate-900/50'
                  }`}>
                    <input
                      type="radio"
                      name="background_ocr_profile"
                      checked={ocrBackgroundDialog.profile === 'ocr_all'}
                      onChange={() => setOcrBackgroundDialog(prev => ({ ...prev, profile: 'ocr_all' }))}
                      className="mt-0.5 accent-indigo-400"
                    />
                    <div className="text-xs">
                      <div className={`font-semibold ${ocrBackgroundDialog.profile === 'ocr_all' ? 'text-indigo-300' : 'text-slate-300'}`}>OCR All Pages Only</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">ค้นหาพิกัดและแกะข้อความเก็บไว้โดยยังไม่แปลภาษา</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Processing Quality (Fast vs High) */}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Processing Quality</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOcrBackgroundDialog(prev => ({ ...prev, ocrQualityProfile: 'fast' }))}
                    className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs gap-1.5 ${
                      ocrBackgroundDialog.ocrQualityProfile === 'fast'
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.15)] font-semibold'
                        : 'border-white/5 bg-slate-900/40 text-slate-500 hover:border-white/10 hover:text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Zap size={13} className={ocrBackgroundDialog.ocrQualityProfile === 'fast' ? 'text-amber-400 animate-pulse' : 'text-slate-400'} />
                      Fast (เน้นความเร็ว)
                    </span>
                   
                  </button>
                  <button
                    type="button"
                    onClick={() => setOcrBackgroundDialog(prev => ({ ...prev, ocrQualityProfile: 'best' }))}
                    className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs gap-1.5 ${
                      ocrBackgroundDialog.ocrQualityProfile === 'best'
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.15)] font-semibold'
                        : 'border-white/5 bg-slate-900/40 text-slate-500 hover:border-white/10 hover:text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Award size={13} className={ocrBackgroundDialog.ocrQualityProfile === 'best' ? 'text-emerald-400 animate-pulse' : 'text-slate-400'} />
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
                    value={ocrBackgroundDialog.ocrLanguage}
                    onChange={(e) => setOcrBackgroundDialog(prev => ({ ...prev, ocrLanguage: e.target.value }))}
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
                    value={ocrBackgroundDialog.targetLanguage}
                    disabled={ocrBackgroundDialog.profile !== 'offline_all'}
                    onChange={(e) => setOcrBackgroundDialog(prev => ({ ...prev, targetLanguage: e.target.value }))}
                    className={`w-full rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-100 outline-none transition-colors focus:border-emerald-500/50 cursor-pointer ${
                      ocrBackgroundDialog.profile !== 'offline_all' ? 'opacity-40 cursor-not-allowed' : ''
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
                  onClick={() => setOcrBackgroundDialog({ isOpen: false, doc: null, model: 'paddleocr', profile: 'offline_all', ocrLanguage: 'eng', ocrQualityProfile: 'best', targetLanguage: 'th' })}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-slate-300 transition-colors hover:bg-white/10"
                >
                  ยกเลิก (Cancel)
                </button>
                <button
                  type="button"
                  onClick={handleStartOcrBackground}
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98]"
                >
                  เริ่มประมวลผล (Start)
                </button>
              </div>
            </div>
          </div>
        )}

        {projectDialog.isOpen && (
          <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/55 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <h3 className="text-lg font-semibold text-slate-100">Create Folder</h3>
              <p className="mt-1 text-sm text-slate-400">
                Create a folder for organizing documents in the home library.
              </p>
              <input
                autoFocus
                type="text"
                value={projectDialog.name}
                onChange={(e) => setProjectDialog((current) => ({ ...current, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleCreateProject();
                  }
                }}
                placeholder="Folder name"
                className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-[#2B9BFF]/60"
              />
              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  onClick={() => setProjectDialog({ isOpen: false, name: '', documentId: null })}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleCreateProject()}
                  className="rounded-xl bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(43,155,255,0.35)]"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {editProjectDialog.isOpen && editProjectDialog.project && (
          <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/55 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] text-left">
              <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                <Edit3 size={18} className="text-[#2B9BFF]" />
                แก้ไขโฟลเดอร์ (Edit Folder)
              </h3>
              <p className="mt-1 text-sm text-slate-400">
                เปลี่ยนชื่อหรือเลือกสีไอคอนสำหรับโฟลเดอร์นี้
              </p>
              
              <div className="mt-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ชื่อโฟลเดอร์ (Folder Name)</label>
                  <input
                    autoFocus
                    type="text"
                    value={editProjectDialog.name}
                    onChange={(e) => setEditProjectDialog((current) => ({ ...current, name: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void handleEditProject();
                      }
                    }}
                    placeholder="Folder name"
                    className="mt-1.5 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-[#2B9BFF]/60"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">สีไอคอนโฟลเดอร์ (Folder Icon Color)</label>
                  <div className="grid grid-cols-5 gap-3">
                    {[
                      '#7C5CFF', // Indigo
                      '#4387FF', // Blue
                      '#59C8F6', // Sky
                      '#10B981', // Emerald/Green
                      '#06B6D4', // Cyan
                      '#F59A3A', // Orange
                      '#F1C85B', // Yellow
                      '#EC4899', // Rose/Pink
                      '#EF4444', // Red
                      '#64748B'  // Slate
                    ].map((color) => {
                      const isSelected = editProjectDialog.color === color;
                      return (
                        <button
                          key={color}
                          onClick={() => setEditProjectDialog((current) => ({ ...current, color }))}
                          className="h-9 w-9 rounded-full border border-white/10 transition-all flex items-center justify-center hover:scale-105 active:scale-95"
                          style={{ 
                            backgroundColor: color,
                            boxShadow: isSelected ? `0 0 0 2px rgb(15, 23, 42), 0 0 0 4px ${color}` : 'none'
                          }}
                          title={color}
                        >
                          {isSelected && <Check size={14} className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-3">
                <button
                  onClick={() => setEditProjectDialog({ isOpen: false, project: null, name: '', color: '' })}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleEditProject()}
                  className="rounded-xl bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(43,155,255,0.35)]"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {tagDialog.isOpen && (
          <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/55 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <h3 className="text-lg font-semibold text-slate-100">Create Tag</h3>
              <p className="mt-1 text-sm text-slate-400">
                Add a reusable tag and optionally assign it to the selected document.
              </p>
              <input
                autoFocus
                type="text"
                value={tagDialog.name}
                onChange={(e) => setTagDialog((current) => ({ ...current, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleCreateTag();
                  }
                }}
                placeholder="Tag name"
                className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-[#FF8705]/60"
              />
              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  onClick={() => setTagDialog({ isOpen: false, name: '', documentId: null })}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleCreateTag()}
                  className="rounded-xl bg-gradient-to-r from-[#FF8705] to-[#FF7E67] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,135,5,0.35)]"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteTagDialog.isOpen && deleteTagDialog.tag && (
          <div className="absolute inset-0 z-[175] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-3xl border border-red-400/25 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl bg-red-500/12 p-2 text-red-300">
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">Delete Tag</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    This removes the tag label from documents, but does not delete documents, OCR cache, or translated content.
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/55 p-4">
                <div className="flex items-center gap-2 text-sm text-slate-200">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: deleteTagDialog.tag.color || '#FF8705' }}
                  />
                  <span className="font-medium">{deleteTagDialog.tag.name}</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Type <span className="font-semibold text-slate-200">{deleteTagDialog.tag.name}</span> to confirm deletion.
                </p>
              </div>

              <input
                autoFocus
                type="text"
                value={deleteTagDialog.confirmation}
                onChange={(e) => setDeleteTagDialog((current) => ({ ...current, confirmation: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleDeleteTag();
                  }
                }}
                placeholder={deleteTagDialog.tag.name}
                className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-red-400/60"
              />

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  onClick={() => setDeleteTagDialog({ isOpen: false, tag: null, confirmation: '' })}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDeleteTag()}
                  disabled={deleteTagDialog.confirmation.trim() !== deleteTagDialog.tag.name}
                  className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(239,68,68,0.28)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Delete Tag
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteProjectDialog.isOpen && deleteProjectDialog.project && (
          <div className="absolute inset-0 z-[175] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-3xl border border-red-400/25 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl bg-red-500/12 p-2 text-red-300">
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">Delete Project Folder</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    This removes the project folder. Documents in this project will not be deleted, but will be moved out of the project folder.
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/55 p-4">
                <div className="flex items-center gap-2 text-sm text-slate-200">
                  <Folder
                    size={16}
                    style={{ color: resolveStableAccent(deleteProjectDialog.project.id) }}
                  />
                  <span className="font-medium">{deleteProjectDialog.project.name}</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Type <span className="font-semibold text-slate-200">{deleteProjectDialog.project.name}</span> to confirm deletion.
                </p>
              </div>

              <input
                autoFocus
                type="text"
                value={deleteProjectDialog.confirmation}
                onChange={(e) => setDeleteProjectDialog((current) => ({ ...current, confirmation: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleDeleteProject();
                  }
                }}
                placeholder={deleteProjectDialog.project.name}
                className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-red-400/60"
              />

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  onClick={() => setDeleteProjectDialog({ isOpen: false, project: null, confirmation: '' })}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDeleteProject()}
                  disabled={deleteProjectDialog.confirmation.trim() !== deleteProjectDialog.project.name}
                  className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(239,68,68,0.28)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Delete Folder
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Import Progress Dialog */}
        {importProgress !== null && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-md">
            <div className="w-96 rounded-3xl border border-white/10 bg-slate-900/90 p-6 shadow-[0_30px_70px_rgba(0,0,0,0.6)] backdrop-blur-2xl flex flex-col items-center text-center gap-4">
              <div className="relative flex items-center justify-center">
                <div className="h-12 w-12 rounded-full border-2 border-white/5 border-t-[#2B9BFF] animate-spin"></div>
                <div className="absolute h-8 w-8 rounded-full border-2 border-white/5 border-b-[#839958] animate-spin [animation-direction:reverse]"></div>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100 mb-1">กำลังนำเข้าไฟล์...</h3>
                <p className="text-xs text-slate-400">
                  กำลังประมวลผลไฟล์ที่ {importProgress.current} จาก {importProgress.total} ไฟล์
                </p>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-[#2B9BFF] to-[#839958] h-full transition-all duration-300"
                  style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
          onChange={handleFileSelect}
        />
      </div>
    </div>
  );
};
