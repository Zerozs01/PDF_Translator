import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  Upload, FileText, Clock, Star, FolderOpen, Settings2, 
  Sparkles, ScrollText, Shield, Grid3X3, List, Search, Plus, Flame, KeyRound, Eye, EyeOff,
  Home as HomeIcon, Folder, ChevronRight, MoreHorizontal, Trash2, Heart, Compass,
  AlertTriangle, RefreshCw, X, Check, Tag, FolderPlus,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { useProjectStore, SafetySettings, TranslationMode } from '../../stores/useProjectStore';
import {
  OVERLAY_FONT_OPTIONS,
  OverlayFontPreset,
  getOverlayPrimaryFontName,
} from '../../constants/overlayFonts';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { useFileBrowserStore, ViewMode as FileBrowserViewMode } from '../../stores/useFileBrowserStore';
import type { DBDocument, DBTag, DBProject } from '../../types/electron.d';
import { generateDocumentThumbnail } from '../../services/libraryThumbnail';
import { OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT } from '../../services/vision/ocr-timeout';

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
  onCreateTag
}) => {
  const assignedTagIds = useMemo(() => new Set(documentTags.map(tag => tag.id)), [documentTags]);
  const projectAccentById = useMemo(
    () => new Map(projects.map((project, index) => [project.id, resolveThemedAccent(index)])),
    [projects]
  );
  const tagAccentById = useMemo(
    () => new Map(tags.map((tag, index) => [tag.id, resolveThemedAccent(index)])),
    [tags]
  );

  return createPortal(
    <div
      data-library-floating-menu="true"
      className="fixed z-[160] w-72 rounded-2xl border border-white/15 bg-slate-950/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-b border-white/10 px-2 pb-2">
        <div className="truncate text-xs font-semibold text-slate-100">{doc.filename}</div>
        <div className="mt-1 text-[10px] text-slate-400">{formatDate(doc.last_accessed)}</div>
      </div>

      <div className="space-y-1 px-1 py-2">
        <button
          onClick={() => {
            onToggleFavorite();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-slate-200 transition-colors hover:bg-white/10"
        >
          <Heart size={12} fill={doc.is_favorite ? 'currentColor' : 'none'} />
          {doc.is_favorite ? 'Remove Favorite' : 'Add Favorite'}
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

      <div className="border-t border-white/10 px-1 pt-2">
        <button
          onClick={() => {
            onDelete();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-red-300 transition-colors hover:bg-red-500/10"
        >
          <Trash2 size={12} />
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

const DocumentCard = React.memo<{
  doc: DBDocument;
  viewMode: FileBrowserViewMode;
  isSelected: boolean;
  onOpen: () => void;
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
  onDragStart: () => void;
  onDragEnd: () => void;
}>(({
  doc,
  viewMode,
  isSelected,
  onOpen,
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
  onDragEnd
}) => {
  const thumbnail = doc.thumbnail_path ? (
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
            ? 'bg-[#090a0d] border-white/14 shadow-[0_14px_34px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.05)]' 
            : 'bg-[#08090c]/96 border-white/8 hover:border-white/12 hover:bg-[#101216]'
        }`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-document-id', String(doc.id));
          e.dataTransfer.effectAllowed = 'move';
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        onClick={onOpen}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRequestMenu(getFloatingMenuPosition(e.clientX, e.clientY, 288, 430));
        }}
      >
        <div className="aspect-[3/4] rounded-xl bg-[#090a0c] mb-3 flex items-center justify-center overflow-hidden border border-white/5">
          {thumbnail}
        </div>
        
        <h3 className="font-medium text-sm text-slate-100 truncate mb-1">{doc.filename}</h3>
        <p className="text-[10px] text-slate-400">
          {formatDate(doc.last_accessed)} • {doc.total_pages} pages
        </p>
        
        <button 
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className={`absolute top-2 right-2 p-1.5 rounded-lg transition-all ${
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
            position={menuPosition ?? getFloatingMenuPosition(24, 24, 288, 430)}
            documentTags={documentTags}
            tags={tags}
            projects={projects}
            onClose={onCloseMenu}
            onToggleFavorite={onToggleFavorite}
            onToggleTag={onToggleTag}
            onMoveToProject={onMoveToProject}
            onDelete={onDelete}
            onCreateTag={onCreateTag}
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
          ? 'bg-[#0a0b0e] border-white/14' 
          : 'bg-[#08090c]/94 border-white/8 hover:border-white/12 hover:bg-[#101216]'
      }`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-document-id', String(doc.id));
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onRequestMenu(getFloatingMenuPosition(e.clientX, e.clientY, 288, 430));
      }}
    >
      <div className="relative h-16 w-12 overflow-hidden rounded-lg border border-white/5 bg-[#090a0c]">
        <div className="absolute inset-0 flex items-center justify-center">
          {thumbnail}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm text-slate-100 truncate">{doc.filename}</h3>
        <p className="text-[10px] text-slate-400">
          {doc.total_pages} pages • {formatFileSize(doc.file_size)}
        </p>
      </div>
      <div className="text-xs text-slate-400 hidden md:block">
        {formatDate(doc.last_accessed)}
      </div>
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
          onRequestMenu(getFloatingMenuPosition(rect.right - 288, rect.bottom + 8, 288, 430));
        }}
        className="p-1.5 rounded text-slate-500 hover:text-slate-300"
      >
        <MoreHorizontal size={14} />
      </button>
      {isMenuOpen && (
        <DocumentContextMenu
          doc={doc}
          position={menuPosition ?? getFloatingMenuPosition(24, 24, 288, 430)}
          documentTags={documentTags}
          tags={tags}
          projects={projects}
          onClose={onCloseMenu}
          onToggleFavorite={onToggleFavorite}
          onToggleTag={onToggleTag}
          onMoveToProject={onMoveToProject}
          onDelete={onDelete}
          onCreateTag={onCreateTag}
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
}>(({ project, isSelected, onSelect, displayColor, isDropTarget, onDragOver, onDragLeave, onDrop }) => {
  const accent = displayColor || resolveStableAccent(project.id);
  return (
  <button 
    onClick={onSelect}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
    className={`w-full p-3 rounded-xl text-left transition-all flex items-center gap-3 border ${
      isDropTarget
        ? 'border-white/16 bg-[#20242b] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
        : 
      isSelected 
        ? 'border-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]' 
        : 'bg-[#16181c]/82 border-white/5 hover:border-white/12 hover:bg-[#1b1e23]'
    }`}
    style={isSelected ? { backgroundColor: hexToRgba(accent, 0.14) } : undefined}
  >
    <div 
      className="p-2 rounded-lg border border-white/5"
      style={{ backgroundColor: hexToRgba(accent, 0.14) }}
    >
      <Folder size={16} style={{ color: accent }} />
    </div>
    <span className="flex-1 truncate text-sm text-slate-200">{project.name}</span>
    <ChevronRight size={14} className="text-slate-500" />
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
  const {
    viewMode, setViewMode,
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
    createTag, createProject, deleteTag, loadDocumentTags, persistDocumentPatch,
    selectedDocumentIds, toggleDocumentSelection, clearSelection,
    getSortedDocuments
  } = useFileBrowserStore();

  const [isDragging, setIsDragging] = useState(false);
  const [activePage, setActivePage] = useState<SidebarPage>('home');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileOpenError, setFileOpenError] = useState<FileOpenErrorEntry | null>(null);
  const [activeDocumentMenuId, setActiveDocumentMenuId] = useState<number | null>(null);
  const [activeDocumentMenuPosition, setActiveDocumentMenuPosition] = useState<MenuPosition | null>(null);
  const [activeTagMenu, setActiveTagMenu] = useState<{ tag: DBTag; position: MenuPosition } | null>(null);
  const [documentTagsById, setDocumentTagsById] = useState<Record<number, DBTag[]>>({});
  const [projectDialog, setProjectDialog] = useState<MenuActionDialogState>({ isOpen: false, name: '', documentId: null });
  const [tagDialog, setTagDialog] = useState<MenuActionDialogState>({ isOpen: false, name: '', documentId: null });
  const [deleteTagDialog, setDeleteTagDialog] = useState<DeleteTagDialogState>({ isOpen: false, tag: null, confirmation: '' });
  const [libraryMenuPosition, setLibraryMenuPosition] = useState<MenuPosition | null>(null);
  const [draggedDocumentId, setDraggedDocumentId] = useState<number | null>(null);
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
      setLibraryMenuPosition(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveDocumentMenuId(null);
        setActiveDocumentMenuPosition(null);
        setActiveTagMenu(null);
        setLibraryMenuPosition(null);
        setProjectDialog((current) => ({ ...current, isOpen: false }));
        setTagDialog((current) => ({ ...current, isOpen: false }));
        setDeleteTagDialog((current) => ({ ...current, isOpen: false, confirmation: '' }));
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      try {
        await loadProject(droppedFile);
        setFileOpenError(null);
      } catch (error) {
        reportFileOpenError('drag_drop', error, {
          filename: droppedFile.name,
          filepath: (droppedFile as unknown as { path?: string }).path
        });
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      try {
        await loadProject(selectedFile);
        setFileOpenError(null);
      } catch (error) {
        reportFileOpenError('file_input', error, {
          filename: selectedFile.name,
          filepath: (selectedFile as unknown as { path?: string }).path
        });
      }
    }
  };

  const handleBrowse = async () => {
    if (window.electronAPI?.fs?.openFile) {
      try {
        const result = await window.electronAPI.fs.openFile();
        if (!result) return;

        const bytes = decodeFileData(result.data);

        const blob = new Blob([bytes as unknown as BlobPart], { type: result.mimeType });
        const file = new File([blob], result.name, { type: result.mimeType }) as File & { path: string };
        Object.defineProperty(file, 'path', { value: result.filepath, writable: false });
        await loadProject(file, bytes);
        setFileOpenError(null);
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
      const file = new File([blob], result.name, { type: result.mimeType }) as File & { path: string };
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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchDocuments(searchQuery);
    }
  };

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
    await deleteDocument(documentId);
    setDocumentTagsById((current) => {
      if (!(documentId in current)) return current;
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    await refreshLibraryView();
  }, [deleteDocument, refreshLibraryView]);

  const sortedDocuments = getSortedDocuments();

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
    setActiveTagMenu({
      tag,
      position: getFloatingMenuPosition(event.clientX, event.clientY, 224, 120)
    });
  }, []);

  const handleToggleDocumentTag = useCallback(async (doc: DBDocument, tag: DBTag) => {
    const currentTags = documentTagsById[doc.id] ?? [];
    const hasTag = currentTags.some(item => item.id === tag.id);

    try {
      if (hasTag) {
        await removeTagFromDocument(doc.id, tag.id);
        setDocumentTagsById((current) => ({
          ...current,
          [doc.id]: (current[doc.id] ?? []).filter(item => item.id !== tag.id)
        }));
      } else {
        await addTagToDocument(doc.id, tag.id);
        setDocumentTagsById((current) => ({
          ...current,
          [doc.id]: [...(current[doc.id] ?? []), tag].sort((a, b) => a.name.localeCompare(b.name))
        }));
      }
    } catch (error) {
      console.error('Failed to update document tag:', error);
    }
  }, [addTagToDocument, documentTagsById, removeTagFromDocument]);

  const handleMoveDocumentToProject = useCallback(async (doc: DBDocument, projectId: number | null) => {
    await moveToProject(doc.id, projectId);
  }, [moveToProject]);

  const openProjectDialog = useCallback((documentId: number | null = null) => {
    setActiveDocumentMenuId(null);
    setActiveDocumentMenuPosition(null);
    setActiveTagMenu(null);
    setLibraryMenuPosition(null);
    setProjectDialog({ isOpen: true, name: '', documentId });
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
    const parentId = selectedProjectId ?? null;
    const project = await createProject(name, parentId, color);
    if (!project) return;

    if (projectDialog.documentId) {
      await moveToProject(projectDialog.documentId, project.id);
    }

    setProjectDialog({ isOpen: false, name: '', documentId: null });
  }, [createProject, moveToProject, projectDialog.documentId, projectDialog.name, projects.length, selectedProjectId]);

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

  const handleProjectDrop = useCallback(async (projectId: number | null) => {
    if (!draggedDocumentId) return;
    const draggedDocument = sortedDocuments.find((doc) => doc.id === draggedDocumentId);
    if (!draggedDocument) return;
    await handleMoveDocumentToProject(draggedDocument, projectId);
    setDraggedDocumentId(null);
    setProjectDropTargetId(null);
  }, [draggedDocumentId, handleMoveDocumentToProject, sortedDocuments]);

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
              {projects.map((project, index) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  displayColor={resolveThemedAccent(index)}
                  isSelected={selectedProjectId === project.id}
                  isDropTarget={projectDropTargetId === project.id}
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
                    void handleProjectDrop(project.id);
                  }}
                  onSelect={() => {
                    if (selectedProjectId === project.id) {
                      setSelectedProjectId(null);
                      loadRecentDocuments();
                    } else {
                      loadDocumentsByProject(project.id);
                    }
                  }}
                />
              ))}
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
              {projects.map((project, index) => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  displayColor={resolveThemedAccent(index)}
                  isSelected={selectedProjectId === project.id}
                  isDropTarget={projectDropTargetId === project.id}
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
                    void handleProjectDrop(project.id);
                  }}
                  onSelect={() => loadDocumentsByProject(project.id)}
                />
              ))}
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
            ) : sortedDocuments.length > 0 ? (
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
                    onOpen={() => handleOpenDocument(doc)}
                    onToggleFavorite={() => toggleFavorite(doc.id)}
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
                    onCreateTag={() => openTagDialog(doc.id)}
                    onDragStart={() => {
                      setDraggedDocumentId(doc.id);
                      setActiveDocumentMenuId(null);
                      setActiveDocumentMenuPosition(null);
                      setLibraryMenuPosition(null);
                    }}
                    onDragEnd={() => {
                      setDraggedDocumentId(null);
                      setProjectDropTargetId(null);
                    }}
                  />
                ))}
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
                      {documents.slice(0, 5).map(doc => (
                        <button
                          key={doc.id}
                          onClick={() => handleOpenDocument(doc)}
                          className="flex items-center gap-3 p-3 rounded-xl bg-[#17191d]/78 border border-white/8 hover:border-white/12 hover:bg-[#1d2025] transition-all text-left group backdrop-blur-xl"
                        >
                          <div className="h-14 w-10 overflow-hidden rounded-lg bg-[#111214]/90 border border-white/5 group-hover:border-white/10">
                            {doc.thumbnail_path ? (
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
                        </button>
                      ))}
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
          <h2 className="text-base font-bold mb-5 flex items-center gap-2">
            <Settings2 className="text-slate-300" size={18} /> Quick Start
          </h2>

          {/* Quick Upload */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`p-4 rounded-xl border-2 border-dashed mb-6 text-center transition-all ${
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
            <div className="space-y-2">
              <button
                onClick={() => setTranslationMode('adaptive')}
                className={`w-full p-3 rounded-xl border text-left transition-all ${
                  translationMode === 'adaptive'
                    ? 'border-[#14B8A6]/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                    : 'bg-[#17191d]/74 border-white/10 hover:border-white/16'
                }`}
                style={translationMode === 'adaptive' ? { background: 'linear-gradient(180deg, rgba(20,184,166,0.22) 0%, rgba(19,48,58,0.92) 100%)' } : undefined}
              >
                <div className="flex items-center gap-2">
                  <Compass size={14} className={translationMode === 'adaptive' ? 'text-[#99F6E4]' : 'text-slate-400'} />
                  <span className={`font-medium text-sm ${translationMode === 'adaptive' ? 'text-[#E6FFF9]' : 'text-slate-300'}`}>Flexibility</span>
                </div>
              </button>

              <button
                onClick={() => setTranslationMode('manga')}
                className={`w-full p-3 rounded-xl border text-left transition-all ${
                  translationMode === 'manga'
                    ? 'border-[#8B5CF6]/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                    : 'bg-[#17191d]/74 border-white/10 hover:border-white/16'
                }`}
                style={translationMode === 'manga' ? { background: 'linear-gradient(180deg, rgba(139,92,246,0.28) 0%, rgba(46,28,82,0.92) 100%)' } : undefined}
              >
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className={translationMode === 'manga' ? 'text-[#D8B4FE]' : 'text-slate-400'} />
                  <span className={`font-medium text-sm ${translationMode === 'manga' ? 'text-[#F4E8FF]' : 'text-slate-300'}`}>Manga Style</span>
                </div>
              </button>

              <button
                onClick={() => setTranslationMode('manhwa')}
                className={`w-full p-3 rounded-xl border text-left transition-all ${
                  translationMode === 'manhwa'
                    ? 'border-[#EC4899]/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                    : 'bg-[#17191d]/74 border-white/10 hover:border-white/16'
                }`}
                style={translationMode === 'manhwa' ? { background: 'linear-gradient(180deg, rgba(236,72,153,0.24) 0%, rgba(66,24,44,0.92) 100%)' } : undefined}
              >
                <div className="flex items-center gap-2">
                  <Flame size={14} className={translationMode === 'manhwa' ? 'text-[#F9A8D4]' : 'text-slate-400'} />
                  <span className={`font-medium text-sm ${translationMode === 'manhwa' ? 'text-[#FFE7F3]' : 'text-slate-300'}`}>Manhwa Style</span>
                </div>
              </button>

              <button
                onClick={() => setTranslationMode('official')}
                className={`w-full p-3 rounded-xl border text-left transition-all ${
                  translationMode === 'official'
                    ? 'border-[#4387FF]/42 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                    : 'bg-[#17191d]/74 border-white/10 hover:border-white/16'
                }`}
                style={translationMode === 'official' ? { background: 'linear-gradient(180deg, rgba(67,135,255,0.2) 0%, rgba(17,28,48,0.9) 100%)' } : undefined}
              >
                <div className="flex items-center gap-2">
                  <ScrollText size={14} className={translationMode === 'official' ? 'text-[#A8CFFF]' : 'text-slate-400'} />
                  <span className={`font-medium text-sm ${translationMode === 'official' ? 'text-[#EDF4FF]' : 'text-slate-300'}`}>Official Doc</span>
                </div>
              </button>
            </div>
          </div>

          {/* Safety Settings (Collapsed by default) */}
          <details className="mb-6">
            <summary className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-3 cursor-pointer flex items-center gap-2">
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

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
          onChange={handleFileSelect}
        />
      </div>
    </div>
  );
};
