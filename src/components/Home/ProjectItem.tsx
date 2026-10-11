import React, { useRef } from 'react';
import { Folder, ChevronRight } from 'lucide-react';
import type { DBProject } from '../../types/electron.d';
import { hexToRgba, resolveStableAccent } from './libraryUtils';

export const ProjectItem = React.memo<{
  project: DBProject;
  isSelected: boolean;
  onSelect: () => void;
  displayColor?: string;
  isDropTarget: boolean;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  level?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}>(({
  project,
  isSelected,
  onSelect,
  displayColor,
  isDropTarget,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
  level = 0,
  hasChildren = false,
  isExpanded = false,
  onToggleExpand
}) => {
  const accent = displayColor || resolveStableAccent(project.id);
  const isDraggingRef = useRef(false);

  return (
    <div 
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={(e) => {
        isDraggingRef.current = true;
        onDragStart?.(e);
      }}
      onDragEnd={(e) => {
        onDragEnd?.(e);
        setTimeout(() => {
          isDraggingRef.current = false;
        }, 50);
      }}
      onClick={(e) => {
        if (isDraggingRef.current) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onSelect();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`w-full py-2 px-2.5 rounded-xl text-left transition-all flex items-center border cursor-pointer select-none ${
        isDropTarget
          ? 'border-sky-400 bg-sky-500/20 shadow-[0_0_16px_rgba(56,189,248,0.3)] scale-[1.01]'
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
          style={{ width: `${level * 14}px`, height: '20px' }}
        >
          <span className="w-2.5 h-3.5 border-l border-b border-white/20 rounded-bl mr-1.5 mt-[-6px]" />
        </div>
      )}

      <div 
        className="p-1.5 rounded-lg border border-white/5 flex items-center justify-center shrink-0 mr-2.5 transition-transform group-hover:scale-105"
        style={{ backgroundColor: hexToRgba(accent, 0.14) }}
      >
        <Folder size={14} style={{ color: accent }} />
      </div>
      <span className="flex-1 truncate text-xs font-medium text-slate-200">{project.name}</span>
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
          className="p-1 rounded-md hover:bg-white/10 text-slate-400 hover:text-sky-300 transition-all shrink-0 ml-1 cursor-pointer flex items-center justify-center"
          title={isExpanded ? 'Collapse subfolders' : 'Expand subfolders'}
        >
          <ChevronRight size={13} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90 text-sky-400' : 'text-slate-400'}`} />
        </div>
      ) : (
        <div className="w-5 shrink-0" />
      )}
    </div>
  );
});
