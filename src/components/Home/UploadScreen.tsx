import React, { useCallback, useEffect, useRef, useState } from 'react';
import { 
  Upload, FileText, Clock, Star, FolderOpen, Settings2, 
  Sparkles, ScrollText, Shield, Grid3X3, List, Search, Plus,
  Home as HomeIcon, Folder, ChevronRight, MoreHorizontal, Trash2, Heart,
  AlertTriangle, RefreshCw, X
} from 'lucide-react';
import { useProjectStore, SafetySettings, TranslationMode } from '../../stores/useProjectStore';
import { useFileBrowserStore, ViewMode as FileBrowserViewMode } from '../../stores/useFileBrowserStore';
import type { DBDocument, DBTag, DBProject } from '../../types/electron.d';

type SidebarPage = 'home' | 'projects';

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Format date
const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
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
  if (fileType === 'pdf') return <FileText className="text-red-400" size={20} />;
  return <FileText className="text-blue-400" size={20} />;
};

// Document Card Component
const DocumentCard: React.FC<{
  doc: DBDocument;
  viewMode: FileBrowserViewMode;
  isSelected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
}> = ({ doc, viewMode, isSelected, onSelect, onOpen, onToggleFavorite, onDelete }) => {
  const [showMenu, setShowMenu] = useState(false);

  if (viewMode === 'grid') {
    return (
      <div 
        className={`group relative p-4 rounded-xl border transition-all cursor-pointer ${
          isSelected 
            ? 'bg-cyan-900/30 border-cyan-500 ring-1 ring-cyan-500' 
            : 'bg-slate-900/50 border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800'
        }`}
        onClick={onOpen}
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(true); }}
      >
        {/* Thumbnail */}
        <div className="aspect-[3/4] rounded-lg bg-slate-800 mb-3 flex items-center justify-center overflow-hidden">
          {doc.thumbnail_path ? (
            <img src={doc.thumbnail_path} alt={doc.filename} className="w-full h-full object-cover" />
          ) : (
            <div className="text-slate-600">
              {getFileIcon(doc.file_type)}
            </div>
          )}
        </div>
        
        {/* Info */}
        <h3 className="font-medium text-sm text-slate-200 truncate mb-1">{doc.filename}</h3>
        <p className="text-[10px] text-slate-500">
          {formatDate(doc.last_accessed)} • {doc.total_pages} pages
        </p>
        
        {/* Favorite Button */}
        <button 
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className={`absolute top-2 right-2 p-1.5 rounded-lg transition-all ${
            doc.is_favorite 
              ? 'bg-pink-500/20 text-pink-400' 
              : 'bg-slate-800/80 text-slate-500 opacity-0 group-hover:opacity-100'
          }`}
        >
          <Heart size={14} fill={doc.is_favorite ? 'currentColor' : 'none'} />
        </button>
        
        {/* Context Menu */}
        {showMenu && (
          <div 
            className="absolute top-2 right-2 z-10 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 min-w-[120px]"
            onMouseLeave={() => setShowMenu(false)}
          >
            <button 
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(); setShowMenu(false); }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-slate-700 flex items-center gap-2"
            >
              <Heart size={12} /> {doc.is_favorite ? 'Unfavorite' : 'Favorite'}
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onDelete(); setShowMenu(false); }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-slate-700 flex items-center gap-2 text-red-400"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        )}
      </div>
    );
  }

  // Detail view
  return (
    <div 
      className={`group flex items-center gap-4 p-3 rounded-lg border transition-all cursor-pointer ${
        isSelected 
          ? 'bg-cyan-900/30 border-cyan-500' 
          : 'bg-slate-900/30 border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800/50'
      }`}
      onClick={onOpen}
    >
      <div className="p-2 rounded-lg bg-slate-800">
        {getFileIcon(doc.file_type)}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm text-slate-200 truncate">{doc.filename}</h3>
        <p className="text-[10px] text-slate-500">
          {doc.total_pages} pages • {formatFileSize(doc.file_size)}
        </p>
      </div>
      <div className="text-xs text-slate-500 hidden md:block">
        {formatDate(doc.last_accessed)}
      </div>
      <button 
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        className={`p-1.5 rounded transition-all ${
          doc.is_favorite ? 'text-pink-400' : 'text-slate-600 hover:text-slate-400'
        }`}
      >
        <Heart size={14} fill={doc.is_favorite ? 'currentColor' : 'none'} />
      </button>
      <button 
        onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
        className="p-1.5 rounded text-slate-500 hover:text-slate-300"
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
};

// Project Item Component
const ProjectItem: React.FC<{
  project: DBProject;
  isSelected: boolean;
  onSelect: () => void;
}> = ({ project, isSelected, onSelect }) => (
  <button 
    onClick={onSelect}
    className={`w-full p-3 rounded-lg text-left transition-all flex items-center gap-3 ${
      isSelected 
        ? 'bg-cyan-900/30 border border-cyan-500' 
        : 'hover:bg-slate-800 border border-transparent'
    }`}
  >
    <div 
      className="p-2 rounded-lg" 
      style={{ backgroundColor: project.color + '20' }}
    >
      <Folder size={16} style={{ color: project.color }} />
    </div>
    <span className="flex-1 truncate text-sm">{project.name}</span>
    <ChevronRight size={14} className="text-slate-500" />
  </button>
);

// Tag Pill Component
const TagPill: React.FC<{
  tag: DBTag;
  isSelected: boolean;
  onClick: () => void;
}> = ({ tag, isSelected, onClick }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
      isSelected 
        ? 'ring-2 ring-offset-2 ring-offset-slate-900' 
        : 'hover:opacity-80'
    }`}
    style={{ 
      backgroundColor: tag.color + '20', 
      color: tag.color,
      ...(isSelected ? { '--tw-ring-color': tag.color } as React.CSSProperties : {})
    }}
  >
    {tag.name}
  </button>
);

export const UploadScreen: React.FC = () => {
  const { loadProject, translationMode, setTranslationMode, safetySettings, updateSafetySettings } = useProjectStore();
  const {
    viewMode, setViewMode,
    filterType, setFilterType,
    selectedTagId, setSelectedTagId,
    selectedProjectId, setSelectedProjectId,
    searchQuery, setSearchQuery,
    documents, tags, projects,
    isLoading,
    loadRecentDocuments, loadFavoriteDocuments, loadDocumentsByTag, loadDocumentsByProject,
    searchDocuments, loadTags, loadProjects,
    toggleFavorite, deleteDocument,
    selectedDocumentIds, toggleDocumentSelection, clearSelection,
    getSortedDocuments
  } = useFileBrowserStore();

  const [isDragging, setIsDragging] = useState(false);
  const [activePage, setActivePage] = useState<SidebarPage>('home');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileOpenError, setFileOpenError] = useState<FileOpenErrorEntry | null>(null);

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

  // Load initial data
  useEffect(() => {
    loadRecentDocuments();
    loadTags();
    loadProjects();
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

        const blob = new Blob([bytes], { type: result.mimeType });
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
      const blob = new Blob([bytes], { type: result.mimeType });
      const file = new File([blob], result.name, { type: result.mimeType }) as File & { path: string };
      // Attach the filepath so loadProject can save to DB
      Object.defineProperty(file, 'path', { value: doc.filepath, writable: false });
      
      await loadProject(file, bytes);
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

  const sortedDocuments = getSortedDocuments();

  return (
    <div className="flex h-screen w-screen bg-slate-950 text-slate-200 overflow-hidden">
      {/* Left Navigation Sidebar */}
      <div className="w-16 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-4">
        <button
          onClick={() => { setActivePage('home'); loadRecentDocuments(); }}
          className={`p-3 rounded-xl mb-2 transition-all ${
            activePage === 'home' 
              ? 'bg-cyan-600 text-white' 
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
          title="Home"
        >
          <HomeIcon size={20} />
        </button>
        <button
          onClick={() => { setActivePage('projects'); }}
          className={`p-3 rounded-xl mb-2 transition-all ${
            activePage === 'projects' 
              ? 'bg-cyan-600 text-white' 
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
          title="Projects"
        >
          <FolderOpen size={20} />
        </button>
        
        <div className="flex-1" />
        
        <button
          onClick={() => {}}
          className="p-3 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-all"
          title="Settings"
        >
          <Settings2 size={20} />
        </button>
      </div>

      {/* Secondary Sidebar */}
      <div className="w-56 border-r border-slate-800 p-4 flex flex-col">
        {activePage === 'home' ? (
          <>
            {/* Quick Filters */}
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Library</h2>
            <div className="space-y-1 mb-6">
              <button
                onClick={() => loadRecentDocuments()}
                className={`w-full p-2.5 rounded-lg text-left text-sm flex items-center gap-3 transition-all ${
                  filterType === 'recent' ? 'bg-cyan-900/30 text-cyan-400' : 'hover:bg-slate-800 text-slate-300'
                }`}
              >
                <Clock size={16} /> Recent
              </button>
              <button
                onClick={() => loadFavoriteDocuments()}
                className={`w-full p-2.5 rounded-lg text-left text-sm flex items-center gap-3 transition-all ${
                  filterType === 'favorites' ? 'bg-cyan-900/30 text-cyan-400' : 'hover:bg-slate-800 text-slate-300'
                }`}
              >
                <Star size={16} /> Favorites
              </button>
            </div>

            {/* Tags */}
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center justify-between">
              Tags
              <button className="p-1 rounded hover:bg-slate-800">
                <Plus size={12} />
              </button>
            </h2>
            <div className="flex flex-wrap gap-2 mb-6">
              {tags.map(tag => (
                <TagPill 
                  key={tag.id} 
                  tag={tag} 
                  isSelected={selectedTagId === tag.id}
                  onClick={() => {
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
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center justify-between">
              Projects
              <button className="p-1 rounded hover:bg-slate-800">
                <Plus size={12} />
              </button>
            </h2>
            <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
              {projects.map(project => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  isSelected={selectedProjectId === project.id}
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
        ) : (
          <>
            {/* Projects Page Sidebar */}
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
              <FolderOpen className="text-cyan-400" size={20} /> Projects
            </h2>
            <button className="w-full p-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium flex items-center justify-center gap-2 mb-4">
              <Plus size={16} /> New Project
            </button>
            <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
              {projects.map(project => (
                <ProjectItem
                  key={project.id}
                  project={project}
                  isSelected={selectedProjectId === project.id}
                  onSelect={() => loadDocumentsByProject(project.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="p-4 border-b border-slate-800 flex items-center gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                type="text"
                placeholder="Search documents..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>
          </form>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-900 rounded-lg p-1 border border-slate-700">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-md transition-all ${
                viewMode === 'grid' ? 'bg-slate-700 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Grid3X3 size={16} />
            </button>
            <button
              onClick={() => setViewMode('detail')}
              className={`p-2 rounded-md transition-all ${
                viewMode === 'detail' ? 'bg-slate-700 text-cyan-400' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {/* File Open Error Banner */}
        {fileOpenError && (
          <div className="mx-4 mt-4 mb-2 rounded-xl border border-amber-500/40 bg-amber-900/20 px-4 py-3 text-sm text-amber-100 flex items-start gap-3">
            <div className="mt-0.5 text-amber-400">
              <AlertTriangle size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold">Open failed</span>
                <span className="text-[10px] text-amber-300/80">
                  {new Date(fileOpenError.timestamp).toLocaleString()}
                </span>
              </div>
              <p className="text-[11px] text-amber-200/90 mt-1">
                {fileOpenError.filename ? `${fileOpenError.filename} — ` : ''}
                {fileOpenError.message}
              </p>
              <p className="text-[11px] text-amber-200/70 mt-1">
                {getFileOpenHint(fileOpenError.message)}
              </p>
              {fileOpenError.filepath && (
                <p className="text-[10px] text-amber-300/70 mt-1 truncate">
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
                      className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-900 text-xs font-semibold hover:bg-amber-400 transition-colors flex items-center gap-1"
                    >
                      <RefreshCw size={12} /> Retry
                    </button>
                    <button
                      onClick={async () => {
                        if (fileOpenError.docId !== undefined) {
                          await deleteDocument(fileOpenError.docId);
                        }
                        setFileOpenError(null);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 text-amber-200 text-xs hover:bg-slate-700 transition-colors"
                    >
                      Remove from Recent
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleBrowse}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 text-slate-900 text-xs font-semibold hover:bg-amber-400 transition-colors flex items-center gap-1"
                  >
                    <RefreshCw size={12} /> Browse Again
                  </button>
                )}
                <button
                  onClick={() => setFileOpenError(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-amber-200 text-xs hover:bg-slate-700 transition-colors flex items-center gap-1"
                >
                  <X size={12} /> Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Documents Grid/List */}
        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-cyan-500"></div>
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
                  onSelect={() => toggleDocumentSelection(doc.id)}
                  onOpen={() => handleOpenDocument(doc)}
                  onToggleFavorite={() => toggleFavorite(doc.id)}
                  onDelete={() => deleteDocument(doc.id)}
                />
              ))}
            </div>
          ) : (
            // Empty State / Upload Area with Recent Files
            <div className="h-full flex flex-col">
              {/* Recent Files Section */}
              {documents.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-bold text-slate-400 mb-3 flex items-center gap-2">
                    <Clock size={14} className="text-cyan-400" />
                    Recent Files
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {documents.slice(0, 5).map(doc => (
                      <button
                        key={doc.id}
                        onClick={() => handleOpenDocument(doc)}
                        className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-cyan-500/50 hover:bg-slate-800 transition-all text-left group"
                      >
                        <div className="p-2 rounded-lg bg-slate-800 group-hover:bg-slate-700">
                          {getFileIcon(doc.file_type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-200 truncate">{doc.filename}</p>
                          <p className="text-[10px] text-slate-500">{formatDate(doc.last_accessed)}</p>
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
                  className={`w-full max-w-xl aspect-video rounded-3xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-300 ${
                    isDragging 
                      ? 'border-cyan-400 bg-cyan-400/10 scale-105' 
                      : 'border-slate-700 bg-slate-900/30 hover:border-slate-600'
                  }`}
                >
                  <div className="p-5 rounded-full bg-slate-800 mb-5 shadow-2xl">
                    <Upload size={40} className="text-cyan-400" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">
                    {documents.length === 0 ? 'No documents yet' : 'No results found'}
                  </h3>
                  <p className="text-slate-500 mb-6 text-sm">
                    {documents.length === 0 
                      ? 'Drag & drop PDF or images to get started'
                      : 'Try a different search term or filter'
                    }
                  </p>
                  
                  <button
                    onClick={handleBrowse}
                    className="px-6 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold cursor-pointer transition-all shadow-lg shadow-cyan-900/20 text-sm"
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
      <div className="w-72 bg-slate-900 border-l border-slate-800 p-5 flex flex-col overflow-y-auto">
        <h2 className="text-base font-bold mb-5 flex items-center gap-2">
          <Settings2 className="text-cyan-400" size={18} /> Quick Start
        </h2>

        {/* Quick Upload */}
        <div 
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`p-4 rounded-xl border-2 border-dashed mb-6 text-center transition-all ${
            isDragging ? 'border-cyan-400 bg-cyan-400/10' : 'border-slate-700 hover:border-slate-600'
          }`}
        >
          <Upload size={24} className="mx-auto mb-2 text-slate-400" />
          <p className="text-xs text-slate-500">Drop file here</p>
          <button
            onClick={handleBrowse}
            className="mt-3 inline-block px-4 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs cursor-pointer"
          >
            Browse
          </button>
        </div>

        {/* Mode Selection */}
        <div className="mb-6">
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 block">Translation Mode</label>
          <div className="space-y-2">
            <button 
              onClick={() => setTranslationMode('manga')}
              className={`w-full p-3 rounded-xl border text-left transition-all ${
                translationMode === 'manga' 
                  ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500' 
                  : 'bg-slate-800 border-slate-700 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sparkles size={14} className={translationMode === 'manga' ? 'text-blue-400' : 'text-slate-400'} />
                <span className={`font-medium text-sm ${translationMode === 'manga' ? 'text-blue-100' : 'text-slate-300'}`}>Manga Style</span>
              </div>
            </button>

            <button 
              onClick={() => setTranslationMode('official')}
              className={`w-full p-3 rounded-xl border text-left transition-all ${
                translationMode === 'official' 
                  ? 'bg-emerald-600/20 border-emerald-500 ring-1 ring-emerald-500' 
                  : 'bg-slate-800 border-slate-700 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-2">
                <ScrollText size={14} className={translationMode === 'official' ? 'text-emerald-400' : 'text-slate-400'} />
                <span className={`font-medium text-sm ${translationMode === 'official' ? 'text-emerald-100' : 'text-slate-300'}`}>Official Doc</span>
              </div>
            </button>
          </div>
        </div>

        {/* Safety Settings (Collapsed by default) */}
        <details className="mb-6">
          <summary className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 cursor-pointer flex items-center gap-2">
            <Shield size={12} /> Safety Filters
          </summary>
          <div className="space-y-4 mt-3">
            {Object.entries(safetySettings).map(([key, value]) => (
              <div key={key}>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs capitalize text-slate-300">{key}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 rounded text-slate-400 uppercase">{value}</span>
                </div>
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
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
              </div>
            ))}
          </div>
        </details>

        <div className="mt-auto p-3 bg-slate-800/50 rounded-xl border border-slate-700 text-xs text-slate-400">
          <p>💡 <strong>Tip:</strong> Press Ctrl+O to quickly open a file.</p>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
        onChange={handleFileSelect}
      />
    </div>
  );
};
