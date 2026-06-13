import React from 'react';
import { Columns2 } from 'lucide-react';

interface SplitViewToggleProps {
  viewMode: 'overlay' | 'split';
  isActive: boolean;
  onToggle: () => void;
}

export const SplitViewToggle: React.FC<SplitViewToggleProps> = ({
  viewMode,
  isActive,
  onToggle,
}) => {
  return (
    <button
      onClick={onToggle}
      className={`p-2 rounded transition-colors ${
        isActive 
          ? 'bg-[#2B9BFF]/25 text-white border border-[#2B9BFF]/40' 
          : 'hover:bg-white/10 text-slate-300 hover:text-white border border-transparent'
      }`}
      title={isActive ? "Switch to Single Overlay View" : "Side-by-Side View"}
    >
      <Columns2 size={16} />
    </button>
  );
};
