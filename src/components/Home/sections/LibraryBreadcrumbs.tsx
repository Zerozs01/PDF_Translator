import React from 'react';
import { ChevronRight, Home as HomeIcon, Star, Folder, FolderPlus } from 'lucide-react';
import type { DBProject } from '../../../types/electron.d';

export interface BreadcrumbItem {
  name: string;
  id: number | null;
  color?: string;
  isHome?: boolean;
  isFavorites?: boolean;
  isTag?: boolean;
  tagColor?: string;
}

export interface LibraryBreadcrumbsProps {
  breadcrumbItems: BreadcrumbItem[];
  handleBreadcrumbClick: (item: BreadcrumbItem, index: number) => void;
  currentSubprojects: DBProject[];
  sortedDocumentsCount: number;
  selectedProjectId: number | null;
  openProjectDialog: (documentId?: number | null, parentId?: number | null) => void;
}

export const LibraryBreadcrumbs: React.FC<LibraryBreadcrumbsProps> = React.memo(({
  breadcrumbItems,
  handleBreadcrumbClick,
  currentSubprojects,
  sortedDocumentsCount,
  selectedProjectId,
  openProjectDialog,
}) => {
  return (
    <div className="px-4 pt-2.5 pb-1 flex items-center justify-between gap-2 select-none border-b border-white/[0.04]">
      <nav className="flex items-center gap-1.5 flex-wrap min-w-0" aria-label="Breadcrumb">
        {breadcrumbItems.map((item, idx) => {
          const isLast = idx === breadcrumbItems.length - 1;
          return (
            <React.Fragment key={item.id ?? `root-${idx}`}>
              {idx > 0 && (
                <ChevronRight size={12} className="text-slate-600 shrink-0" />
              )}
              {isLast ? (
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold ${
                  item.id !== null
                    ? 'bg-white/[0.08] text-white border border-white/10 shadow-sm'
                    : 'text-slate-200'
                }`}>
                  {item.isHome && <HomeIcon size={13} className="text-sky-400" />}
                  {item.isFavorites && <Star size={13} className="text-amber-400 fill-amber-400" />}
                  {item.isTag && (
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: item.tagColor || '#8B5CF6' }}
                    />
                  )}
                  {item.id !== null && (
                    <Folder size={13} style={{ color: item.color || '#38BDF8' }} />
                  )}
                  <span className="truncate max-w-[220px]">{item.name}</span>
                </div>
              ) : (
                <button
                  onClick={() => handleBreadcrumbClick(item, idx)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] transition-all cursor-pointer group"
                >
                  {item.isHome && <HomeIcon size={13} className="text-slate-400 group-hover:text-sky-400 transition-colors" />}
                  {item.isFavorites && <Star size={13} className="text-slate-400 group-hover:text-amber-400 transition-colors" />}
                  {item.isTag && (
                    <span
                      className="inline-block h-2 w-2 rounded-full opacity-70 group-hover:opacity-100"
                      style={{ backgroundColor: item.tagColor || '#8B5CF6' }}
                    />
                  )}
                  {item.id !== null && (
                    <Folder size={13} style={{ color: item.color || '#38BDF8' }} className="opacity-75 group-hover:opacity-100" />
                  )}
                  <span className="truncate max-w-[160px]">{item.name}</span>
                </button>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {/* Right-aligned Stats & Action Button in Breadcrumb Bar */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Item Counters */}
        <div className="flex items-center gap-2.5 text-xs select-none">
          {currentSubprojects.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="font-bold text-sky-400">{currentSubprojects.length}</span>
              <span className="text-white font-medium">{currentSubprojects.length === 1 ? 'Folder' : 'Folders'}</span>
            </span>
          )}
          {sortedDocumentsCount > 0 && (
            <span className="flex items-center gap-1">
              <span className="font-bold text-sky-400">{sortedDocumentsCount}</span>
              <span className="text-white font-medium">{sortedDocumentsCount === 1 ? 'File' : 'Files'}</span>
            </span>
          )}
        </div>

        {/* Quick Action Button (+ Folder) */}
        <button
          onClick={() => openProjectDialog(null, selectedProjectId)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/8 hover:border-white/15 text-slate-300 hover:text-white text-xs font-medium transition-all shrink-0 cursor-pointer shadow-sm"
          title={selectedProjectId !== null ? "สร้างโฟลเดอร์ย่อยในโฟลเดอร์นี้" : "สร้างโฟลเดอร์ใหม่"}
        >
          <FolderPlus size={13} className="text-sky-400" />
          <span>+ Folder</span>
        </button>
      </div>
    </div>
  );
});

LibraryBreadcrumbs.displayName = 'LibraryBreadcrumbs';
