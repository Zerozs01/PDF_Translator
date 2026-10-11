import React, { useRef } from 'react';
import { FileText, Check, Star, Eye, EyeOff, Heart, MoreHorizontal } from 'lucide-react';
import type { DBDocument, DBTag, DBProject } from '../../types/electron.d';
import type { ViewMode as FileBrowserViewMode } from '../../stores/useFileBrowserStore';
import { DocumentContextMenu } from './ContextMenus';
import {
  formatDate,
  formatFileSize,
  getFileIcon,
  getFloatingMenuPosition,
  type MenuPosition,
} from './libraryUtils';

export const DocumentCard = React.memo<{
  doc: DBDocument;
  viewMode: FileBrowserViewMode;
  isSelected: boolean;
  isMultiSelectActive?: boolean;
  onOpen: () => void;
  onCardClick?: (e: React.MouseEvent) => void;
  onCheckboxClick?: (e: React.MouseEvent) => void;
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
  onCardClick,
  onCheckboxClick,
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
  const isDraggingRef = useRef(false);
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
          isDraggingRef.current = true;
          onDragStart(e);
        }}
        onDragEnd={() => {
          onDragEnd();
          setTimeout(() => {
            isDraggingRef.current = false;
          }, 80);
        }}
        onClick={(e) => {
          if (isDraggingRef.current) {
            isDraggingRef.current = false;
            return;
          }
          if (onCardClick) {
            onCardClick(e);
          } else if (e.ctrlKey || e.metaKey || isMultiSelectActive) {
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
            <div 
              onClick={(e) => {
                e.stopPropagation();
                if (onCheckboxClick) {
                  onCheckboxClick(e);
                } else {
                  onToggleSelect?.();
                }
              }}
              className="absolute top-2 left-2 h-5 w-5 rounded-md bg-[#2B9BFF] hover:bg-blue-600 text-white flex items-center justify-center shadow-md border border-white/20 z-20 animate-fade-in transition-colors cursor-pointer"
              title="ยกเลิกการเลือก"
            >
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
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.35)] opacity-100 hover:bg-rose-500/30 hover:scale-110' 
              : 'bg-[#111214]/90 text-slate-400 border border-white/5 opacity-0 group-hover:opacity-100 hover:text-rose-400 hover:bg-[#1f2228] hover:border-rose-500/25 hover:scale-110 shadow-sm'
          }`}
          title={doc.is_favorite ? 'นำออกจากรายการโปรด (Unfavorite)' : 'เพิ่มในรายการโปรด (Favorite)'}
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
        isDraggingRef.current = true;
        onDragStart(e);
      }}
      onDragEnd={() => {
        onDragEnd();
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 80);
      }}
      onClick={(e) => {
        if (isDraggingRef.current) {
          isDraggingRef.current = false;
          return;
        }
        if (onCardClick) {
          onCardClick(e);
        } else if (e.ctrlKey || e.metaKey || isMultiSelectActive) {
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
        <div 
          onClick={(e) => {
            e.stopPropagation();
            if (onCheckboxClick) {
              onCheckboxClick(e);
            } else {
              onToggleSelect?.();
            }
          }}
          className="h-4 w-4 rounded bg-[#2B9BFF] hover:bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm border border-white/10 cursor-pointer transition-colors"
          title="ยกเลิกการเลือก"
        >
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
        className={`p-1.5 rounded-lg transition-all ${
          doc.is_favorite 
            ? 'text-rose-400 bg-rose-500/15 border border-rose-500/25 shadow-sm hover:scale-110' 
            : 'text-slate-500 hover:text-rose-400 hover:bg-white/[0.06] hover:scale-110'
        }`}
        title={doc.is_favorite ? 'นำออกจากรายการโปรด (Unfavorite)' : 'เพิ่มในรายการโปรด (Favorite)'}
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
