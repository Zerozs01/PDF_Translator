import React from 'react';
import { createPortal } from 'react-dom';
import { Star, Check, RefreshCw } from 'lucide-react';
import type { SortBy, SortOrder } from '../../stores/useFileBrowserStore';
import type { DBTag } from '../../types/electron.d';
import { hexToRgba, type MenuPosition } from './libraryUtils';

export const SortContextMenu: React.FC<{
  position: MenuPosition;
  sortBy: SortBy;
  sortOrder: SortOrder;
  ratingFilterMode: 'only' | 'range';
  ratingFilterOnly: number | null;
  ratingFilterMin: number | null;
  ratingFilterMax: number | null;
  activeFilterTag: number | 'no_folder' | null;
  tags: DBTag[];
  onSelectFilterTag: (filter: number | 'no_folder' | null) => void;
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
  activeFilterTag,
  tags,
  onSelectFilterTag,
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

      {/* Filter by Tag Section */}
      <div className="px-2.5 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-t border-b border-white/5 my-1 mt-2 flex items-center justify-between">
        <span>Filter by Tag</span>
        {activeFilterTag !== null && (
          <button
            onClick={() => onSelectFilterTag(null)}
            className="text-[9px] text-[#5CC6F2] hover:underline cursor-pointer"
          >
            Reset
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 p-2 bg-white/[0.02] rounded-xl border border-white/5 my-1 mx-0.5 max-h-44 overflow-y-auto custom-scrollbar">
        {/* No tags (Untagged files) button */}
        <button
          onClick={() => {
            if (activeFilterTag === 0) {
              onSelectFilterTag(null);
            } else {
              onSelectFilterTag(0);
            }
          }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
            activeFilterTag === 0
              ? 'border-sky-400 bg-sky-500/20 text-sky-200 shadow-[0_0_12px_rgba(56,189,248,0.25)]'
              : 'border-white/10 bg-[#131519]/88 text-slate-400 hover:border-white/20 hover:text-slate-200'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${activeFilterTag === 0 ? 'bg-sky-400' : 'bg-slate-500'}`} />
          No tags
        </button>

        {/* No folder (Root / Uncategorized files) button */}
        <button
          onClick={() => {
            if (activeFilterTag === 'no_folder') {
              onSelectFilterTag(null);
            } else {
              onSelectFilterTag('no_folder');
            }
          }}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
            activeFilterTag === 'no_folder'
              ? 'border-amber-400 bg-amber-500/20 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.25)]'
              : 'border-white/10 bg-[#131519]/88 text-slate-400 hover:border-white/20 hover:text-slate-200'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${activeFilterTag === 'no_folder' ? 'bg-amber-400' : 'bg-slate-500'}`} />
          No folder
        </button>

        {tags.map((tag) => {
          const isSelected = activeFilterTag === tag.id;
          const tagColor = tag.color || '#8B5CF6';
          return (
            <button
              key={tag.id}
              onClick={() => {
                if (isSelected) {
                  onSelectFilterTag(null);
                } else {
                  onSelectFilterTag(tag.id);
                }
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all cursor-pointer ${
                isSelected
                  ? 'border-white/20 bg-white/10 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                  : 'border-white/10 bg-[#131519]/88 text-slate-400 hover:border-white/20 hover:text-slate-200'
              }`}
              style={isSelected ? { boxShadow: `0 0 0 1px ${hexToRgba(tagColor, 0.35)}` } : undefined}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: tagColor }}
              />
              {tag.name}
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
};
