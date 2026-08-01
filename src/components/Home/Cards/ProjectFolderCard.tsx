import React from 'react';
import { ProjectItem } from '../types';

interface ProjectFolderCardProps {
  project: ProjectItem;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const ProjectFolderCard: React.FC<ProjectFolderCardProps> = ({
  project,
  onClick,
  onContextMenu,
}) => {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="group relative flex items-center gap-3 p-4 rounded-2xl bg-slate-800/60 border border-slate-700/60 hover:border-indigo-500/50 hover:bg-slate-800 hover:shadow-xl hover:shadow-indigo-500/10 cursor-pointer transition-all duration-200"
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shadow-inner"
        style={{ backgroundColor: `${project.color || '#6366f1'}20` }}
      >
        {project.icon || '📁'}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-slate-200 group-hover:text-indigo-400 truncate transition-colors">
          {project.name}
        </h3>
        <p className="text-xs text-slate-400 truncate">
          {project.documentCount ?? 0} {project.documentCount === 1 ? 'file' : 'files'}
        </p>
      </div>
    </div>
  );
};
