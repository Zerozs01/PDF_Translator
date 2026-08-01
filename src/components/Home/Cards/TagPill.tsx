import React from 'react';
import { TagItem } from '../types';

interface TagPillProps {
  tag: TagItem;
  onRemove?: () => void;
  onClick?: () => void;
  size?: 'sm' | 'md';
}

export const TagPill: React.FC<TagPillProps> = ({
  tag,
  onRemove,
  onClick,
  size = 'sm',
}) => {
  const bgStyle = {
    backgroundColor: `${tag.color}20`,
    borderColor: `${tag.color}50`,
    color: tag.color,
  };

  const isSmall = size === 'sm';

  return (
    <span
      style={bgStyle}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium transition-all ${
        onClick ? 'cursor-pointer hover:opacity-80' : ''
      } ${isSmall ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'}`}
    >
      {tag.icon && <span>{tag.icon}</span>}
      <span>{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hover:bg-white/20 rounded-full p-0.5 transition-colors"
        >
          ✕
        </button>
      )}
    </span>
  );
};
