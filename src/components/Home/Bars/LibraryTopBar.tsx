import React from 'react';
import { PanelLeftClose, PanelLeftOpen, Search, Grid3X3, List, Filter } from 'lucide-react';
import type { ViewMode as FileBrowserViewMode } from '../../../stores/useFileBrowserStore';

export interface LibraryTopBarProps {
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  handleSearch: (e: React.FormEvent) => void;
  viewMode: FileBrowserViewMode;
  setViewMode: (mode: FileBrowserViewMode) => void;
  isSortMenuOpen: boolean;
  activeFilterTag: number | 'no_folder' | null;
  ratingFilterOnly: number | null;
  ratingFilterMin: number | null;
  ratingFilterMax: number | null;
  handleToggleSortMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const LibraryTopBar: React.FC<LibraryTopBarProps> = ({
  isSidebarOpen,
  toggleSidebar,
  searchQuery,
  setSearchQuery,
  handleSearch,
  viewMode,
  setViewMode,
  isSortMenuOpen,
  activeFilterTag,
  ratingFilterOnly,
  ratingFilterMin,
  ratingFilterMax,
  handleToggleSortMenu,
}) => {
  const isFilterActive =
    isSortMenuOpen ||
    activeFilterTag !== null ||
    ratingFilterOnly !== null ||
    ratingFilterMin !== null ||
    ratingFilterMax !== null;

  return (
    <div className="relative overflow-hidden border-b border-white/6 px-4 pt-4 pb-5 backdrop-blur-xl shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] titlebar-drag">
      <div className="absolute inset-0 bg-[linear-gradient(98deg,rgba(60,134,223,0.9)_0%,rgba(58,152,224,0.86)_34%,rgba(74,120,213,0.88)_66%,rgba(112,84,194,0.88)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.14)_0%,rgba(0,0,0,0.05)_18%,rgba(0,0,0,0.04)_82%,rgba(0,0,0,0.12)_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.03)_0%,rgba(0,0,0,0.05)_48%,rgba(0,0,0,0.09)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-16 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0))]" />

      <div className="relative z-10 flex items-center gap-4">
        {/* Sidebar Toggle */}
        <button
          onClick={toggleSidebar}
          className="p-2 rounded-lg bg-[#202329]/90 border border-white/8 text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] transition-all flex items-center justify-center shrink-0"
          title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
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
              className="w-full pl-10 pr-4 py-2 bg-[#1f2227]/92 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-[#5CC6F2]/30 focus:ring-2 focus:ring-[#5CC6F2]/10 text-slate-100 placeholder:text-slate-500"
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

        <div className="flex-1" />

        {/* Sort / Filter Button */}
        <div className="relative">
          <button
            data-sort-menu-trigger="true"
            onClick={handleToggleSortMenu}
            className={`p-2 rounded-lg bg-[#202329]/90 border text-slate-400 hover:text-slate-100 hover:bg-white/[0.06] transition-all flex items-center justify-center shrink-0 cursor-pointer ${
              isFilterActive
                ? 'text-[#5CC6F2] border-[#5CC6F2]/40 bg-[#5CC6F2]/10 shadow-[0_0_12px_rgba(92,198,242,0.2)]'
                : 'border-white/8'
            }`}
            title="Sort and filter options"
          >
            <Filter size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};
