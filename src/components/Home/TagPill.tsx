import React from 'react';
import type { DBTag } from '../../types/electron.d';
import { hexToRgba } from './libraryUtils';

export const TagPill = React.memo<{
  tag: DBTag;
  isSelected: boolean;
  onClick: () => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  displayColor?: string;
}>(({ tag, isSelected, onClick, onContextMenu, displayColor }) => {
  const accent = tag.color || displayColor || '#8B5CF6';
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all cursor-pointer ${
        isSelected 
          ? 'border-white/12 bg-[#23262b] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]' 
          : 'border-white/10 bg-[#131519]/88 text-slate-300 hover:border-white/14 hover:bg-[#1a1d22]'
      }`}
      style={isSelected ? { boxShadow: `inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px ${hexToRgba(accent, 0.28)}` } : undefined}
    >
      <span 
        className="h-1.5 w-1.5 rounded-full transition-colors" 
        style={{ backgroundColor: accent }} 
      />
      {tag.name}
    </button>
  );
});
