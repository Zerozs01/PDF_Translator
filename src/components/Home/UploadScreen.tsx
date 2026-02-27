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
  if (fileType === 'pdf') {
    return <FileText className="text-[#FF970F] drop-shadow-[0_0_8px_rgba(255,135,5,0.35)]" size={20} />;
  }
  return <FileText className="text-[#FFB45C] drop-shadow-[0_0_8px_rgba(255,145,49,0.22)]" size={20} />;
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
        className={`group relative p-4 rounded-2xl border transition-all cursor-pointer backdrop-blur-xl ${
          isSelected 
            ? 'bg-gradient-to-br from-[#2B9BFF]/20 to-[#9979FF]/15 border-[#2B9BFF]/60 shadow-[0_10px_30px_rgba(43,155,255,0.2)]' 
            : 'bg-slate-900/45 border-white/10 hover:border-[#2B9BFF]/40 hover:bg-slate-900/70 hover:shadow-[0_8px_24px_rgba(43,155,255,0.12)]'
        }`}
        onClick={onOpen}
        onContextMenu={(e) => { e.preventDefault(); setShowMenu(true); }}
      >
        {/* Thumbnail */}
        <div className="aspect-[3/4] rounded-xl bg-slate-900/80 mb-3 flex items-center justify-center overflow-hidden border border-white/5">
          {doc.thumbnail_path ? (
            <img src={doc.thumbnail_path} alt={doc.filename} className="w-full h-full object-cover" />
          ) : (
            <div className="text-slate-600">
              {getFileIcon(doc.file_type)}
            </div>
          )}
        </div>
        
        {/* Info */}
        <h3 className="font-medium text-sm text-slate-100 truncate mb-1">{doc.filename}</h3>
        <p className="text-[10px] text-slate-400">
          {formatDate(doc.last_accessed)} • {doc.total_pages} pages
        </p>
        
        {/* Favorite Button */}
        <button 
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
          className={`absolute top-2 right-2 p-1.5 rounded-lg transition-all ${
            doc.is_favorite 
              ? 'bg-[#FF7E67]/20 text-[#FF9E8E]' 
              : 'bg-slate-900/85 text-slate-500 border border-white/5 opacity-0 group-hover:opacity-100'
          }`}
        >
          <Heart size={14} fill={doc.is_favorite ? 'currentColor' : 'none'} />
        </button>
        
        {/* Context Menu */}
        {showMenu && (
          <div 
            className="absolute top-2 right-2 z-10 bg-slate-900/95 border border-white/15 rounded-lg shadow-xl py-1 min-w-[120px] backdrop-blur-xl"
            onMouseLeave={() => setShowMenu(false)}
          >
            <button 
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(); setShowMenu(false); }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-white/10 flex items-center gap-2"
            >
              <Heart size={12} /> {doc.is_favorite ? 'Unfavorite' : 'Favorite'}
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onDelete(); setShowMenu(false); }}
              className="w-full px-3 py-2 text-left text-xs hover:bg-white/10 flex items-center gap-2 text-red-400"
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
      className={`group flex items-center gap-4 p-3 rounded-xl border transition-all cursor-pointer backdrop-blur-xl ${
        isSelected 
          ? 'bg-gradient-to-r from-[#2B9BFF]/20 to-[#9979FF]/15 border-[#2B9BFF]/55' 
          : 'bg-slate-900/35 border-white/10 hover:border-[#2B9BFF]/40 hover:bg-slate-900/60'
      }`}
      onClick={onOpen}
    >
      <div className="p-2 rounded-lg bg-slate-900/90 border border-white/5">
        {getFileIcon(doc.file_type)}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm text-slate-100 truncate">{doc.filename}</h3>
        <p className="text-[10px] text-slate-400">
          {doc.total_pages} pages • {formatFileSize(doc.file_size)}
        </p>
      </div>
      <div className="text-xs text-slate-400 hidden md:block">
        {formatDate(doc.last_accessed)}
      </div>
      <button 
        onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
        className={`p-1.5 rounded transition-all ${
          doc.is_favorite ? 'text-[#FF9E8E]' : 'text-slate-500 hover:text-slate-300'
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
    className={`w-full p-3 rounded-xl text-left transition-all flex items-center gap-3 border ${
      isSelected 
        ? 'bg-gradient-to-r from-[#2B9BFF]/20 to-[#9979FF]/15 border-[#2B9BFF]/45' 
        : 'bg-slate-900/30 border-white/5 hover:border-white/15 hover:bg-slate-900/55'
    }`}
  >
    <div 
      className="p-2 rounded-lg border border-white/5"
      style={{ backgroundColor: project.color + '16' }}
    >
      <Folder size={16} style={{ color: project.color }} />
    </div>
    <span className="flex-1 truncate text-sm text-slate-200">{project.name}</span>
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
    className={`group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
      isSelected 
        ? 'border-[#FFB45C]/75 bg-gradient-to-r from-[#FF8705]/32 via-[#FF8DF2]/24 to-[#FF7E67]/28 text-[#fff0da] shadow-[0_8px_20px_rgba(255,135,5,0.28)]' 
        : 'border-white/12 bg-slate-900/50 text-slate-300 hover:border-[#FF9A3D]/55 hover:bg-gradient-to-r hover:from-[#FF8705]/16 hover:to-[#FF8DF2]/14 hover:text-[#ffe4c2]'
    }`}
  >
    <span className={`h-1.5 w-1.5 rounded-full transition-colors ${
      isSelected ? 'bg-[#FFD091]' : 'bg-slate-500 group-hover:bg-[#FF9A3D]'
    }`} />
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
    <div className="relative h-screen w-screen overflow-hidden bg-[#04060f] text-slate-100">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-28 -top-28 h-[26rem] w-[26rem] rounded-full bg-[#2B9BFF]/28 blur-3xl" />
        <div className="absolute bottom-[-10rem] left-1/3 h-[26rem] w-[26rem] rounded-full bg-[#9979FF]/22 blur-3xl" />
        <div className="absolute -right-32 top-1/3 h-[28rem] w-[28rem] rounded-full bg-[#FF7E67]/18 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(43,155,255,0.16),transparent_48%),radial-gradient(circle_at_85%_30%,rgba(255,126,103,0.14),transparent_42%),linear-gradient(125deg,rgba(4,6,15,0.96)_0%,rgba(6,9,20,0.98)_55%,rgba(5,7,14,0.99)_100%)]" />
      </div>

      <div className="relative z-10 flex h-full w-full">
        {/* Left Navigation Sidebar */}
        <div className="w-16 bg-slate-950/65 border-r border-white/10 backdrop-blur-xl flex flex-col items-center py-4">
          <button
            onClick={() => { setActivePage('home'); loadRecentDocuments(); }}
            className={`p-3 rounded-xl mb-2 transition-all ${
              activePage === 'home'
                ? 'bg-gradient-to-br from-[#2B9BFF] to-[#2776FF] text-white shadow-[0_8px_20px_rgba(43,155,255,0.38)]'
                : 'text-slate-400 hover:bg-white/10 hover:text-slate-100'
            }`}
            title="Home"
          >
            <HomeIcon size={20} />
          </button>
          <button
            onClick={() => { setActivePage('projects'); }}
            className={`p-3 rounded-xl mb-2 transition-all ${
              activePage === 'projects'
                ? 'bg-gradient-to-br from-[#2B9BFF] to-[#2776FF] text-white shadow-[0_8px_20px_rgba(43,155,255,0.38)]'
                : 'text-slate-400 hover:bg-white/10 hover:text-slate-100'
            }`}
            title="Projects"
          >
            <FolderOpen size={20} />
          </button>

          <div className="flex-1" />

          <button
            onClick={() => {}}
            className="p-3 rounded-xl text-slate-400 hover:bg-white/10 hover:text-slate-100 transition-all"
            title="Settings"
          >
            <Settings2 size={20} />
          </button>
        </div>

        {/* Secondary Sidebar */}
        <div className="w-56 border-r border-white/10 bg-slate-950/45 backdrop-blur-xl p-4 flex flex-col">
        {activePage === 'home' ? (
          <>
            {/* Quick Filters */}
            <h2 className="text-xs font-bold text-slate-400/85 uppercase tracking-wider mb-3">Library</h2>
            <div className="space-y-1 mb-6">
              <button
                onClick={() => loadRecentDocuments()}
                className={`w-full p-2.5 rounded-lg text-left text-sm flex items-center gap-3 border transition-all ${
                  filterType === 'recent'
                    ? 'border-[#2B9BFF]/40 bg-gradient-to-r from-[#2B9BFF]/20 to-[#9979FF]/15 text-[#a8dcff]'
                    : 'border-transparent hover:border-white/10 hover:bg-white/5 text-slate-300'
                }`}
              >
                <Clock size={16} /> Recent
              </button>
              <button
                onClick={() => loadFavoriteDocuments()}
                className={`w-full p-2.5 rounded-lg text-left text-sm flex items-center gap-3 border transition-all ${
                  filterType === 'favorites'
                    ? 'border-[#2B9BFF]/40 bg-gradient-to-r from-[#2B9BFF]/20 to-[#9979FF]/15 text-[#a8dcff]'
                    : 'border-transparent hover:border-white/10 hover:bg-white/5 text-slate-300'
                }`}
              >
                <Star size={16} /> Favorites
              </button>
            </div>

            {/* Tags */}
            <h2 className="text-xs font-bold text-slate-400/85 uppercase tracking-wider mb-3 flex items-center justify-between">
              Tags
              <button className="p-1 rounded hover:bg-white/10">
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
            <h2 className="text-xs font-bold text-slate-400/85 uppercase tracking-wider mb-3 flex items-center justify-between">
              Projects
              <button className="p-1 rounded hover:bg-white/10">
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
              <FolderOpen className="text-[#5CC6F2]" size={20} /> Projects
            </h2>
            <button className="w-full p-3 rounded-lg bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] hover:brightness-110 text-white text-sm font-medium flex items-center justify-center gap-2 mb-4 shadow-[0_8px_20px_rgba(43,155,255,0.33)] transition-all">
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
        <div className="flex-1 flex flex-col overflow-hidden bg-slate-950/20">
          {/* Toolbar */}
          <div className="p-4 border-b border-white/10 bg-slate-950/35 backdrop-blur-xl flex items-center gap-4">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1 max-w-md">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                <input
                  type="text"
                  placeholder="Search documents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-slate-900/65 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-[#2B9BFF]/60 focus:ring-2 focus:ring-[#2B9BFF]/25"
                />
              </div>
            </form>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-900/60 rounded-lg p-1 border border-white/10">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-md transition-all ${
                  viewMode === 'grid'
                    ? 'bg-gradient-to-r from-[#2B9BFF]/25 to-[#9979FF]/25 text-[#b4e3ff]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Grid3X3 size={16} />
              </button>
              <button
                onClick={() => setViewMode('detail')}
                className={`p-2 rounded-md transition-all ${
                  viewMode === 'detail'
                    ? 'bg-gradient-to-r from-[#2B9BFF]/25 to-[#9979FF]/25 text-[#b4e3ff]'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <List size={16} />
              </button>
            </div>
          </div>

          {/* File Open Error Banner */}
          {fileOpenError && (
            <div className="mx-4 mt-4 mb-2 rounded-xl border border-amber-400/45 bg-amber-400/12 backdrop-blur-xl px-4 py-3 text-sm text-amber-100 flex items-start gap-3">
              <div className="mt-0.5 text-amber-300">
                <AlertTriangle size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">Open failed</span>
                  <span className="text-[10px] text-amber-200/80">
                    {new Date(fileOpenError.timestamp).toLocaleString()}
                  </span>
                </div>
                <p className="text-[11px] text-amber-100/90 mt-1">
                  {fileOpenError.filename ? `${fileOpenError.filename} — ` : ''}
                  {fileOpenError.message}
                </p>
                <p className="text-[11px] text-amber-100/70 mt-1">
                  {getFileOpenHint(fileOpenError.message)}
                </p>
                {fileOpenError.filepath && (
                  <p className="text-[10px] text-amber-100/65 mt-1 truncate">
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
                        className="px-3 py-1.5 rounded-lg bg-amber-300 text-slate-900 text-xs font-semibold hover:bg-amber-200 transition-colors flex items-center gap-1"
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
                        className="px-3 py-1.5 rounded-lg bg-slate-900/75 border border-white/10 text-amber-100 text-xs hover:bg-slate-800 transition-colors"
                      >
                        Remove from Recent
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleBrowse}
                      className="px-3 py-1.5 rounded-lg bg-amber-300 text-slate-900 text-xs font-semibold hover:bg-amber-200 transition-colors flex items-center gap-1"
                    >
                      <RefreshCw size={12} /> Browse Again
                    </button>
                  )}
                  <button
                    onClick={() => setFileOpenError(null)}
                    className="px-3 py-1.5 rounded-lg bg-slate-900/75 border border-white/10 text-amber-100 text-xs hover:bg-slate-800 transition-colors flex items-center gap-1"
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
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-[#2B9BFF]"></div>
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
                    <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                      <Clock size={14} className="text-[#5CC6F2]" />
                      Recent Files
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {documents.slice(0, 5).map(doc => (
                        <button
                          key={doc.id}
                          onClick={() => handleOpenDocument(doc)}
                          className="flex items-center gap-3 p-3 rounded-xl bg-slate-900/45 border border-white/10 hover:border-[#2B9BFF]/45 hover:bg-slate-900/70 transition-all text-left group backdrop-blur-xl"
                        >
                          <div className="p-2 rounded-lg bg-slate-900/85 border border-white/5 group-hover:border-[#2B9BFF]/35">
                            {getFileIcon(doc.file_type)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-100 truncate">{doc.filename}</p>
                            <p className="text-[10px] text-slate-400">{formatDate(doc.last_accessed)}</p>
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
                    className={`w-full max-w-xl aspect-video rounded-3xl border-2 border-dashed flex flex-col items-center justify-center transition-all duration-300 backdrop-blur-xl ${
                      isDragging
                        ? 'border-[#5CC6F2] bg-[#2B9BFF]/16 scale-105 shadow-[0_0_60px_rgba(43,155,255,0.28)]'
                        : 'border-white/20 bg-slate-900/35 hover:border-[#2B9BFF]/55'
                    }`}
                  >
                    <div className="p-5 rounded-full bg-slate-900/85 border border-white/10 mb-5 shadow-2xl">
                      <Upload size={40} className="text-[#5CC6F2]" />
                    </div>
                    <h3 className="text-xl font-bold mb-2">
                      {documents.length === 0 ? 'No documents yet' : 'No results found'}
                    </h3>
                    <p className="text-slate-400 mb-6 text-sm">
                      {documents.length === 0
                        ? 'Drag & drop PDF or images to get started'
                        : 'Try a different search term or filter'
                      }
                    </p>

                    <button
                      onClick={handleBrowse}
                      className="px-6 py-2.5 bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] hover:brightness-110 text-white rounded-xl font-bold cursor-pointer transition-all shadow-[0_10px_24px_rgba(43,155,255,0.35)] text-sm"
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
        <div className="w-72 bg-slate-950/60 border-l border-white/10 p-5 flex flex-col overflow-y-auto backdrop-blur-xl">
          <h2 className="text-base font-bold mb-5 flex items-center gap-2">
            <Settings2 className="text-[#5CC6F2]" size={18} /> Quick Start
          </h2>

          {/* Quick Upload */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`p-4 rounded-xl border-2 border-dashed mb-6 text-center transition-all ${
              isDragging ? 'border-[#5CC6F2] bg-[#2B9BFF]/14' : 'border-white/15 hover:border-[#2B9BFF]/45 bg-slate-900/40'
            }`}
          >
            <Upload size={24} className="mx-auto mb-2 text-slate-300" />
            <p className="text-xs text-slate-400">Drop file here</p>
            <button
              onClick={handleBrowse}
              className="mt-3 inline-block px-4 py-1.5 bg-slate-900/85 border border-white/10 hover:bg-slate-800 rounded-lg text-xs cursor-pointer"
            >
              Browse
            </button>
          </div>

          {/* Mode Selection */}
          <div className="mb-6">
            <label className="text-xs font-bold text-slate-400/85 uppercase tracking-wider mb-3 block">Translation Mode</label>
            <div className="space-y-2">
              <button
                onClick={() => setTranslationMode('manga')}
                className={`w-full p-3 rounded-xl border text-left transition-all ${
                  translationMode === 'manga'
                    ? 'bg-gradient-to-r from-[#2B9BFF]/22 to-[#5CC6F2]/16 border-[#2B9BFF]/50 shadow-[0_6px_16px_rgba(43,155,255,0.2)]'
                    : 'bg-slate-900/55 border-white/12 hover:border-white/25'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className={translationMode === 'manga' ? 'text-[#5CC6F2]' : 'text-slate-400'} />
                  <span className={`font-medium text-sm ${translationMode === 'manga' ? 'text-[#d9efff]' : 'text-slate-300'}`}>Manga Style</span>
                </div>
              </button>

              <button
                onClick={() => setTranslationMode('official')}
                className={`w-full p-3 rounded-xl border text-left transition-all ${
                  translationMode === 'official'
                    ? 'bg-gradient-to-r from-[#FF8705]/28 via-[#FFB45C]/20 to-[#FF7E67]/20 border-[#FF9A3D]/55 shadow-[0_8px_18px_rgba(255,135,5,0.25)]'
                    : 'bg-slate-900/55 border-white/12 hover:border-white/25'
                }`}
              >
                <div className="flex items-center gap-2">
                  <ScrollText size={14} className={translationMode === 'official' ? 'text-[#FFD091]' : 'text-slate-400'} />
                  <span className={`font-medium text-sm ${translationMode === 'official' ? 'text-[#fff0da]' : 'text-slate-300'}`}>Official Doc</span>
                </div>
              </button>
            </div>
          </div>

          {/* Safety Settings (Collapsed by default) */}
          <details className="mb-6">
            <summary className="text-xs font-bold text-slate-400/85 uppercase tracking-wider mb-3 cursor-pointer flex items-center gap-2">
              <Shield size={12} /> Safety Filters
            </summary>
            <div className="space-y-4 mt-3">
              {Object.entries(safetySettings).map(([key, value]) => (
                <div key={key}>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs capitalize text-slate-300">{key}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-900/85 border border-white/10 rounded text-slate-400 uppercase">{value}</span>
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
                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[#2B9BFF]"
                  />
                </div>
              ))}
            </div>
          </details>

          <div className="mt-auto" />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
          onChange={handleFileSelect}
        />
      </div>
    </div>
  );
};
