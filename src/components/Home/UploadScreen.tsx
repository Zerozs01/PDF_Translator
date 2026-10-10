import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  Upload, Download, FileText, Clock, Star, FolderOpen, Settings2, 
  Sparkles, ScrollText, Shield, Grid3X3, List, Search, Plus, Flame, KeyRound, Eye, EyeOff,
  Home as HomeIcon, Folder, ChevronRight, MoreHorizontal, Trash2, Heart, Compass,
  AlertTriangle, RefreshCw, X, Check, Tag, FolderPlus,
  PanelLeftClose, PanelLeftOpen, Cpu, Pause, Play, Filter, Edit3, Zap, Award,
  ChevronUp, ChevronDown, ArrowRight, Info, Database
} from 'lucide-react';
import { useProjectStore, SafetySettings, TranslationMode } from '../../stores/useProjectStore';
import { useBackgroundQueueStore } from '../../stores/useBackgroundQueueStore';
import {
  OVERLAY_FONT_OPTIONS,
  OverlayFontPreset,
  getOverlayPrimaryFontName,
} from '../../constants/overlayFonts';
import { useOCRTextLayerStore, SUPPORTED_LANGUAGES } from '../../stores/useOCRTextLayerStore';
import { useFileBrowserStore, ViewMode as FileBrowserViewMode, SortBy, SortOrder } from '../../stores/useFileBrowserStore';
import { useLayerStore } from '../../stores/useLayerStore';
import type { DBDocument, DBTag, DBProject } from '../../types/electron.d';
import { OCREngine } from '../../types';
import { generateDocumentThumbnail } from '../../services/libraryThumbnail';
import { OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT } from '../../services/vision/ocr-timeout';
import { SecuritySettings } from '../Auth/SecuritySettings';
import { dbService } from '../../services/dbService';
import {
  prepareProjectDocumentLoad,
  ensureProjectDocumentRecord,
  touchProjectDocumentActivity
} from '../../services/projectDocumentService';

import {
  FOLDER_PALETTE_COLORS,
  TAG_COLOR_PALETTES,
  fallbackFolderColors,
  THEMED_LIBRARY_ACCENTS,
} from '../../constants/colorPalettes';

import {
  type SidebarPage,
  SAFETY_LEVEL_PREVIEW,
  formatFileSize,
  formatDate,
  decodeFileData,
  type FileOpenContext,
  type FileOpenErrorEntry,
  FILE_OPEN_LOG_KEY,
  recordFileOpenError,
  getFileOpenHint,
  getFileIcon,
  resolveThemedAccent,
  hexToRgba,
  resolveStableAccent,
  type MenuActionDialogState,
  type MenuPosition,
  type DeleteTagDialogState,
  type DeleteProjectDialogState,
  getFloatingMenuPosition,
} from './libraryUtils';

import {
  DocumentContextMenu,
  ProjectContextMenu,
  TagContextMenu,
} from './ContextMenus';

import {
  EditTagModal,
  FolderInfoModal,
  CreateProjectModal,
  EditProjectModal,
} from './Modals';

import {
  SortContextMenu,
} from './SortFilterMenu';

import {
  DocumentCard,
} from './DocumentCard';

import {
  ProjectItem,
} from './ProjectItem';

import {
  TagPill,
} from './TagPill';

import { LibraryTopBar } from './Bars/LibraryTopBar';
import { BackgroundQueueMonitor } from './Panels/BackgroundQueueMonitor';
import { LibrarySettingsPanel } from './Panels/LibrarySettingsPanel';
import { BatchOCRBackgroundDialog } from './Panels/BatchOCRBackgroundDialog';
import { LibrarySidebar } from './sections/LibrarySidebar';
import { DocumentGridView } from './sections/DocumentGridView';
import { LibraryBreadcrumbs } from './sections/LibraryBreadcrumbs';
import { FileOpenErrorBanner } from './sections/FileOpenErrorBanner';
import { LibraryModals } from './sections/LibraryModals';
import { LibraryRightPanel } from './sections/LibraryRightPanel';

export { FOLDER_PALETTE_COLORS, TAG_COLOR_PALETTES };

export const UploadScreen: React.FC = () => {
  const {
    loadProject,
    translationMode,
    setTranslationMode,
    safetySettings,
    updateSafetySettings,
    targetLanguage,
    geminiApiKeyDraft,
    hasGeminiApiKey,
    geminiApiKeySource,
    isGeminiApiKeyLoaded,
    isGeminiApiKeySaving,
    geminiApiKeyError,
    setGeminiApiKeyDraft,
    saveGeminiApiKey,
    clearGeminiApiKey,
    overlayFontPreset,
    setOverlayFontPreset,
  } = useProjectStore();
  const ocrOptions = useOCRTextLayerStore((state) => state.options);
  const setOCROptions = useOCRTextLayerStore((state) => state.setOptions);
  
  const jobs = useBackgroundQueueStore((state) => state.jobs);
  const pauseJob = useBackgroundQueueStore((state) => state.pauseJob);
  const resumeJob = useBackgroundQueueStore((state) => state.resumeJob);
  const cancelJob = useBackgroundQueueStore((state) => state.cancelJob);
  const removeJob = useBackgroundQueueStore((state) => state.removeJob);
  const clearCompletedJobs = useBackgroundQueueStore((state) => state.clearCompletedJobs);
  const moveJobUp = useBackgroundQueueStore((state) => state.moveJobUp);
  const moveJobDown = useBackgroundQueueStore((state) => state.moveJobDown);

  const {
    viewMode, setViewMode,
    sortBy, setSortBy,
    sortOrder, setSortOrder,
    filterType,
    selectedTagId, setSelectedTagId,
    selectedProjectId, setSelectedProjectId,
    searchQuery, setSearchQuery,
    documents, tags, projects,
          isLoading,
          loadStartupData, loadRecentDocuments, loadFavoriteDocuments, loadDocumentsByTag, loadDocumentsByProject,
          searchDocuments, loadTags, loadProjects,
    toggleFavorite, deleteDocument, moveToProject,
    addTagToDocument, removeTagFromDocument,
    createTag, createProject, deleteTag, deleteProject, updateProject, updateTag, loadDocumentTags, persistDocumentPatch,
    selectedDocumentIds, selectDocument, selectRangeDocuments, toggleDocumentSelection, clearSelection,
    getSortedDocuments
  } = useFileBrowserStore();

  const lastClickedDocIdRef = useRef<number | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [hiddenThumbnails, setHiddenThumbnails] = useState<Set<number>>(() => {
    try {
      const saved = localStorage.getItem('pdf_translator.hidden_thumbnails');
      return saved ? new Set(JSON.parse(saved).map(Number)) : new Set();
    } catch {
      return new Set();
    }
  });

  // Sync hidden thumbnails with SQLite database documents
  useEffect(() => {
    if (documents && documents.length > 0) {
      setHiddenThumbnails(prev => {
        const next = new Set<number>();
        documents.forEach(doc => {
          if (doc.is_thumbnail_hidden) {
            next.add(doc.id);
          }
        });
        // Retain any IDs for documents not currently in documents array
        prev.forEach(id => {
          if (!documents.some(d => d.id === id)) {
            next.add(id);
          }
        });
        if (next.size !== prev.size || [...next].some(id => !prev.has(id))) {
          return next;
        }
        return prev;
      });
    }
  }, [documents]);

  const toggleHideThumbnail = useCallback((docId: number) => {
    setHiddenThumbnails(prev => {
      const next = new Set(prev);
      const isNowHidden = !next.has(docId);
      if (isNowHidden) {
        next.add(docId);
      } else {
        next.delete(docId);
      }
      try {
        localStorage.setItem('pdf_translator.hidden_thumbnails', JSON.stringify(Array.from(next)));
      } catch {}

      // Persist to SQLite DB and FileBrowserStore so it is synchronized across views
      persistDocumentPatch(docId, { is_thumbnail_hidden: isNowHidden ? 1 : 0 });
      dbService.toggleThumbnailHidden(docId).catch(err => {
        console.warn('[UploadScreen] Failed to persist toggleThumbnailHidden in DB:', err);
      });

      return next;
    });
  }, [persistDocumentPatch]);

  const [activePage, setActivePage] = useState<SidebarPage>('home');
  const [gpuInfo, setGpuInfo] = useState<{
    gpus: string[];
    hasDirectML: boolean;
    hasCuda: boolean;
    mode: 'CUDA' | 'DirectML' | 'CPU';
    gpuVendor: 'intel' | 'amd' | 'nvidia' | 'unknown';
  } | null>(null);

  const [paddleThaiStatus, setPaddleThaiStatus] = useState<{ installed: boolean; checking: boolean; downloading: boolean }>({
    installed: false,
    checking: true,
    downloading: false,
  });
  const [paddleEnglishStatus, setPaddleEnglishStatus] = useState<{ installed: boolean; checking: boolean; downloading: boolean }>({
    installed: false,
    checking: true,
    downloading: false,
  });

  const checkModelStatus = useCallback(async () => {
    if (!window.electronAPI?.models) return;
    try {
      const thaiRes = await window.electronAPI.models.getStatus({ engine: 'paddleocr', language: 'th' });
      setPaddleThaiStatus(prev => ({ ...prev, installed: thaiRes.installed, checking: false }));
    } catch (err) {
      setPaddleThaiStatus(prev => ({ ...prev, checking: false }));
    }
    try {
      const engRes = await window.electronAPI.models.getStatus({ engine: 'paddleocr', language: 'en' });
      setPaddleEnglishStatus(prev => ({ ...prev, installed: engRes.installed, checking: false }));
    } catch (err) {
      setPaddleEnglishStatus(prev => ({ ...prev, checking: false }));
    }
  }, []);

  const handleDownloadModel = useCallback(async (lang: 'th' | 'en') => {
    if (!window.electronAPI?.models) return;
    const setStatus = lang === 'th' ? setPaddleThaiStatus : setPaddleEnglishStatus;
    setStatus(prev => ({ ...prev, downloading: true }));
    try {
      const success = await window.electronAPI.models.download({ engine: 'paddleocr', language: lang });
      if (success) {
        setStatus(prev => ({ ...prev, installed: true, downloading: false }));
      } else {
        setStatus(prev => ({ ...prev, downloading: false }));
      }
    } catch (err) {
      console.error(`Failed to download ${lang} model:`, err);
      setStatus(prev => ({ ...prev, downloading: false }));
    }
  }, []);

  useEffect(() => {
    if (activePage === 'settings') {
      void checkModelStatus();
    }
  }, [activePage, checkModelStatus]);

  // Returns vendor-aware mode label: "Intel DirectML", "AMD DirectML", "CUDA", or "CPU"
  const getGpuModeLabel = (info: typeof gpuInfo): string => {
    if (!info) return 'CPU';
    if (info.mode === 'DirectML') {
      if (info.gpuVendor === 'intel') return 'Intel DirectML';
      if (info.gpuVendor === 'amd') return 'AMD DirectML';
      return 'DirectML';
    }
    return info.mode;
  };

  useEffect(() => {
    let active = true;
    if (window.electronAPI?.ocr?.getGpuInfo) {
      window.electronAPI.ocr.getGpuInfo()
        .then((info) => {
          if (active) setGpuInfo(info);
        })
        .catch((err) => console.error('Failed to get GPU info:', err));
    }
    return () => {
      active = false;
    };
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileOpenError, setFileOpenError] = useState<FileOpenErrorEntry | null>(null);
  const [activeDocumentMenuId, setActiveDocumentMenuId] = useState<number | null>(null);
  const [activeDocumentMenuPosition, setActiveDocumentMenuPosition] = useState<MenuPosition | null>(null);
  const [activeTagMenu, setActiveTagMenu] = useState<{ tag: DBTag; position: MenuPosition } | null>(null);
  const [editTagDialog, setEditTagDialog] = useState<{
    isOpen: boolean;
    tag: DBTag | null;
    name: string;
    color: string;
  }>({ isOpen: false, tag: null, name: '', color: '' });
  const [documentTagsById, setDocumentTagsById] = useState<Record<number, DBTag[]>>({});
  const [projectDialog, setProjectDialog] = useState<MenuActionDialogState>({ isOpen: false, name: '', documentId: null });
  const [tagDialog, setTagDialog] = useState<MenuActionDialogState>({ isOpen: false, name: '', documentId: null });
  const [deleteTagDialog, setDeleteTagDialog] = useState<DeleteTagDialogState>({ isOpen: false, tag: null, confirmation: '' });
  const [activeProjectMenu, setActiveProjectMenu] = useState<{ project: DBProject; position: MenuPosition } | null>(null);
  const [deleteProjectDialog, setDeleteProjectDialog] = useState<DeleteProjectDialogState>({ isOpen: false, project: null, confirmation: '' });
  const [editProjectDialog, setEditProjectDialog] = useState<{
    isOpen: boolean;
    project: DBProject | null;
    name: string;
    color: string;
  }>({ isOpen: false, project: null, name: '', color: '' });
  const [importProgress, setImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [draggedDocumentId, setDraggedDocumentId] = useState<number | null>(null);
  const [draggedDocumentIds, setDraggedDocumentIds] = useState<number[]>([]);
  const [draggedProjectId, setDraggedProjectId] = useState<number | null>(null);
  const draggedProjectIdRef = useRef<number | null>(null);
  const [libraryMenuPosition, setLibraryMenuPosition] = useState<MenuPosition | null>(null);
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [sortMenuPosition, setSortMenuPosition] = useState<MenuPosition | null>(null);
  const [activeFilterTag, setActiveFilterTag] = useState<number | 'no_folder' | null>(null);
  const [ratingFilterMode, setRatingFilterMode] = useState<'only' | 'range'>('only');
  const [ratingFilterOnly, setRatingFilterOnly] = useState<number | null>(null);
  const [ratingFilterMin, setRatingFilterMin] = useState<number | null>(null);
  const [ratingFilterMax, setRatingFilterMax] = useState<number | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<number>>(new Set());
  const [isProfileListOpen, setIsProfileListOpen] = useState(false);

  const toggleProjectExpanded = useCallback((projectId: number) => {
    setExpandedProjectIds(current => {
      const newSet = new Set(current);
      if (newSet.has(projectId)) {
        newSet.delete(projectId);
      } else {
        newSet.add(projectId);
      }
      return newSet;
    });
  }, []);

  const [ocrBackgroundDialog, setOcrBackgroundDialog] = useState<{
    isOpen: boolean;
    doc: DBDocument | null;
    model: OCREngine;
    profile: 'ocr_all' | 'offline_all';
    ocrLanguage: string;
    ocrQualityProfile: 'fast' | 'best';
    targetLanguage: string;
  }>({
    isOpen: false,
    doc: null,
    model: 'paddleocr',
    profile: 'offline_all',
    ocrLanguage: 'eng',
    ocrQualityProfile: 'best',
    targetLanguage: 'th',
  });

  const [dialogCachePages, setDialogCachePages] = useState<number | null>(null);

  useEffect(() => {
    if (ocrBackgroundDialog.isOpen && ocrBackgroundDialog.doc) {
      setDialogCachePages(null); // Reset
      if (window.electronAPI?.db?.getOcrCacheStatsForDocumentIds) {
        window.electronAPI.db.getOcrCacheStatsForDocumentIds([ocrBackgroundDialog.doc.id])
          .then((rows) => {
            if (rows && rows.length > 0) {
              setDialogCachePages(rows[0].cache_pages);
            } else {
              setDialogCachePages(0);
            }
          })
          .catch((err) => {
            console.error('Failed to get cache pages stats for dialog:', err);
            setDialogCachePages(0);
          });
      } else {
        setDialogCachePages(0);
      }
    }
  }, [ocrBackgroundDialog.isOpen, ocrBackgroundDialog.doc]);

  const openOcrBackgroundDialog = useCallback((doc: DBDocument) => {
    const currentOcrLanguage = useOCRTextLayerStore.getState().options.language || 'eng';
    const currentOcrEngine = (useOCRTextLayerStore.getState().options.engine || 'paddleocr') as OCREngine;
    const currentTargetLanguage = useProjectStore.getState().targetLanguage || 'th';
    const currentOcrQuality = useOCRTextLayerStore.getState().options.ocrQualityProfile || 'best';
    setOcrBackgroundDialog({
      isOpen: true,
      doc,
      model: currentOcrEngine,
      profile: 'offline_all',
      ocrLanguage: currentOcrLanguage,
      ocrQualityProfile: currentOcrQuality === 'fast' ? 'fast' : 'best',
      targetLanguage: currentTargetLanguage,
    });
  }, []);

  const handleStartOcrBackground = useCallback(() => {
    const { doc, model, profile, ocrLanguage, ocrQualityProfile, targetLanguage } = ocrBackgroundDialog;
    if (!doc) return;

    const opt = useOCRTextLayerStore.getState().options;
    const projectState = useProjectStore.getState();

    if (profile === 'ocr_all') {
      useBackgroundQueueStore.getState().addJob({
        documentId: doc.id,
        filename: doc.filename,
        filepath: doc.filepath,
        engine: model,
        type: 'ocr_all',
        totalPages: Math.max(1, doc.total_pages),
        ocrLanguage: ocrLanguage,
        ocrQualityProfile: ocrQualityProfile,
        useAngleCls: opt.useAngleCls,
      });
    } else {
      useBackgroundQueueStore.getState().addJob({
        documentId: doc.id,
        filename: doc.filename,
        filepath: doc.filepath,
        engine: model,
        type: 'offline_all',
        totalPages: Math.max(1, doc.total_pages),
        ocrLanguage: ocrLanguage,
        sourceLanguage: projectState.sourceLanguage || 'eng',
        targetLanguage: targetLanguage,
        translationMode: projectState.translationMode || 'adaptive',
        ocrDpi: opt.dpi || 300,
        ocrPageSegMode: opt.pageSegMode,
        ocrQualityProfile: ocrQualityProfile,
        useAngleCls: opt.useAngleCls,
      });
    }

    // Eagerly prewarm daemon in background while queue initializes
    if (window.electronAPI?.ocr?.prewarmEngine && (model === 'paddleocr' || model === 'easyocr')) {
      void window.electronAPI.ocr.prewarmEngine({ engine: model, language: ocrLanguage }).catch(() => {});
    }

    // ไม่เรียก boostPriorityForDocument สำหรับคิวเบื้องหลัง (Case 1)
    // งานที่เพิ่มจาก OCR Panel จะต่อท้ายคิวตาม FIFO โดยไม่แทรกคิวหรือยกเลิกงานที่กำลังรันอยู่
    setOcrBackgroundDialog(prev => ({ ...prev, isOpen: false, doc: null }));
  }, [ocrBackgroundDialog]);
  const [projectDropTargetId, setProjectDropTargetId] = useState<number | null>(null);
  const [folderInfoProject, setFolderInfoProject] = useState<DBProject | null>(null);
  const [showGeminiApiKey, setShowGeminiApiKey] = useState(false);
  const [selectedFontAvailable, setSelectedFontAvailable] = useState<boolean | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem('pdf_translator.sidebar_open');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });
  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem('pdf_translator.sidebar_open', String(next));
      } catch (err) {
        console.error('Failed to save sidebar state:', err);
      }
      return next;
    });
  }, []);
  const thumbnailJobsRef = useRef<Set<number>>(new Set());
  const isThaiTargetLanguage = targetLanguage === 'th';
  const geminiStatusLabel = !isGeminiApiKeyLoaded
    ? 'Loading secure key status...'
    : geminiApiKeySource === 'secure-storage'
      ? 'Gemini key is stored securely on this device.'
      : geminiApiKeySource === 'environment'
        ? 'Gemini key is currently provided by local environment variables.'
        : 'No Gemini key saved yet.';
  const geminiInputPlaceholder = geminiApiKeySource === 'secure-storage'
    ? 'Stored securely. Enter a new key to replace it.'
    : geminiApiKeySource === 'environment'
      ? 'Loaded from environment. Enter a key here to store it securely instead.'
      : 'AIza...';
  const geminiStatusClass = hasGeminiApiKey
    ? 'text-emerald-300/85'
    : 'text-slate-500';

  useEffect(() => {
    let mounted = true;

    const checkFont = async () => {
      if (!isThaiTargetLanguage) {
        if (mounted) setSelectedFontAvailable(null);
        return;
      }

      if (typeof document === 'undefined' || !('fonts' in document)) {
        if (mounted) setSelectedFontAvailable(null);
        return;
      }

      try {
        await document.fonts.ready;
      } catch {
        // Ignore font-set readiness failures.
      }

      const primaryFont = getOverlayPrimaryFontName(overlayFontPreset);
      const available = document.fonts.check(`16px "${primaryFont}"`);
      if (mounted) {
        setSelectedFontAvailable(available);
      }
    };

    void checkFont();
    return () => {
      mounted = false;
    };
  }, [isThaiTargetLanguage, overlayFontPreset]);

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

  // Load initial data — batched in 1 IPC round-trip
    useEffect(() => {
      loadStartupData();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('[data-library-floating-menu="true"]') ||
        target?.closest('[data-sort-menu-trigger="true"]')
      ) return;
      setActiveDocumentMenuId(null);
      setActiveDocumentMenuPosition(null);
      setActiveTagMenu(null);
      setActiveProjectMenu(null);
      setLibraryMenuPosition(null);
      setIsSortMenuOpen(false);
      setSortMenuPosition(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveDocumentMenuId(null);
        setActiveDocumentMenuPosition(null);
        setActiveTagMenu(null);
        setActiveProjectMenu(null);
        setLibraryMenuPosition(null);
        setIsSortMenuOpen(false);
        setSortMenuPosition(null);
        setProjectDialog((current) => ({ ...current, isOpen: false }));
        setTagDialog((current) => ({ ...current, isOpen: false }));
        setDeleteTagDialog((current) => ({ ...current, isOpen: false, confirmation: '' }));
        setDeleteProjectDialog((current) => ({ ...current, isOpen: false, confirmation: '' }));
        setEditProjectDialog((current) => ({ ...current, isOpen: false }));
        useFileBrowserStore.getState().clearSelection();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const refreshLibraryView = useCallback(async () => {
    const activeSearch = searchQuery.trim();
    if (activeSearch) {
      await searchDocuments(activeSearch);
      return;
    }

    if (filterType === 'favorites') {
      await loadFavoriteDocuments();
      return;
    }

    if (filterType === 'tag' && selectedTagId !== null) {
      await loadDocumentsByTag(selectedTagId);
      return;
    }

    if (filterType === 'project') {
      await loadDocumentsByProject(selectedProjectId ?? null);
      return;
    }

    await loadRecentDocuments();
  }, [
    filterType,
    loadDocumentsByProject,
    loadDocumentsByTag,
    loadFavoriteDocuments,
    loadRecentDocuments,
    searchDocuments,
    searchQuery,
    selectedProjectId,
    selectedTagId,
  ]);

  const handleImportFiles = useCallback(async (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length === 0) return;

    if (fileList.length === 1) {
      const file = fileList[0];
      try {
        await loadProject(file);
        setFileOpenError(null);
        
        // Auto assign to selectedProjectId if inside a folder
        const documentId = useProjectStore.getState().documentId;
        if (documentId && selectedProjectId) {
          await moveToProject(documentId, selectedProjectId);
        }
      } catch (error) {
        reportFileOpenError('file_input', error, {
          filename: file.name,
          filepath: (file as unknown as { path?: string }).path
        });
      }
      return;
    }

    setImportProgress({ current: 0, total: fileList.length });
    try {
      for (let i = 0; i < fileList.length; i++) {
        setImportProgress({ current: i + 1, total: fileList.length });
        const file = fileList[i];
        
        const prepared = await prepareProjectDocumentLoad({
          db: dbService,
          file: file as File & { path?: string },
          importFile: window.electronAPI?.fs?.importFile,
        });
        
        const resolvedPath = prepared.resolvedPath;
        if (resolvedPath && dbService.isAvailable()) {
          const ensured = await ensureProjectDocumentRecord({
            db: dbService,
            documentId: null,
            file: file as File & { path?: string },
            filePath: resolvedPath,
          });
          
          if (ensured.documentId) {
            await touchProjectDocumentActivity(dbService, ensured.documentId);
            
            if (selectedProjectId) {
              await moveToProject(ensured.documentId, selectedProjectId);
            }
          }
        }
      }
      
      await refreshLibraryView();
    } catch (error) {
      console.error('Failed to import multiple files:', error);
    } finally {
      setImportProgress(null);
    }
  }, [selectedProjectId, moveToProject, refreshLibraryView, loadProject]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const isFile = Array.from(e.dataTransfer.types).includes('Files');
      if (isFile) {
        void handleImportFiles(e.dataTransfer.files);
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleImportFiles(e.target.files);
    }
  };

  const handleBrowse = async () => {
    if (window.electronAPI?.fs?.openFile) {
      try {
        const results = await window.electronAPI.fs.openFile();
        if (!results || !Array.isArray(results) || results.length === 0) return;

        if (results.length === 1) {
          const result = results[0];
          const bytes = decodeFileData(result.data);
          const blob = new Blob([bytes as unknown as BlobPart], { type: result.mimeType });
          const file = new File([blob], result.name, { type: result.mimeType }) as File & { path: string };
          Object.defineProperty(file, 'path', { value: result.filepath, writable: false });
          await loadProject(file, bytes);
          setFileOpenError(null);
          
          // Auto assign to selectedProjectId if inside a folder
          const documentId = useProjectStore.getState().documentId;
          if (documentId && selectedProjectId) {
            await moveToProject(documentId, selectedProjectId);
          }
        } else {
          setImportProgress({ current: 0, total: results.length });
          try {
            for (let i = 0; i < results.length; i++) {
              setImportProgress({ current: i + 1, total: results.length });
              const result = results[i];
              const bytes = decodeFileData(result.data);
              const blob = new Blob([bytes as unknown as BlobPart], { type: result.mimeType });
              const file = new File([blob], result.name, { type: result.mimeType }) as File & { path: string };
              Object.defineProperty(file, 'path', { value: result.filepath, writable: false });

              const prepared = await prepareProjectDocumentLoad({
                db: dbService,
                file: file as File & { path?: string },
                fileData: bytes,
                importFile: window.electronAPI?.fs?.importFile,
              });
              
              const resolvedPath = prepared.resolvedPath;
              if (resolvedPath && dbService.isAvailable()) {
                const ensured = await ensureProjectDocumentRecord({
                  db: dbService,
                  documentId: null,
                  file: file as File & { path?: string },
                  filePath: resolvedPath,
                });
                
                if (ensured.documentId) {
                  await touchProjectDocumentActivity(dbService, ensured.documentId);
                  
                  if (selectedProjectId) {
                    await moveToProject(ensured.documentId, selectedProjectId);
                  }
                }
              }
            }
            await refreshLibraryView();
          } catch (error) {
            console.error('Failed to import multiple files via browse:', error);
          } finally {
            setImportProgress(null);
          }
        }
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
      const blob = new Blob([bytes as unknown as BlobPart], { type: result.mimeType });
      const file = new File([blob], doc.filename || result.name, { type: result.mimeType }) as File & { path: string };
      // Attach the filepath so loadProject can save to DB
      Object.defineProperty(file, 'path', { value: doc.filepath, writable: false });
      
      await loadProject(file, bytes);
      if (doc.last_page > 1) {
        useProjectStore.getState().setPage(doc.last_page);
      }
      setFileOpenError(null);
    } catch (error) {
      reportFileOpenError('recent', error, {
        filename: doc.filename,
        filepath: doc.filepath,
        docId: doc.id
      });
    }
  };

  const handleOpenJobFile = async (job: any) => {
    let docToOpen: any = {
      id: job.documentId,
      filename: job.filename,
      filepath: job.filepath,
      last_page: 1
    };
    
    try {
      if (window.electronAPI?.db?.getDocument && job.filepath) {
        const realDoc = await window.electronAPI.db.getDocument(job.filepath);
        if (realDoc) {
          docToOpen = realDoc;
        }
      }
    } catch (err) {
      console.warn('[UploadScreen] Failed to fetch real document from DB, falling back to job metadata:', err);
    }

    handleOpenDocument(docToOpen);
  };


  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      searchDocuments(searchQuery);
    }
  };

  useEffect(() => {
    const trimmed = searchQuery.trim();
    const timer = window.setTimeout(() => {
      if (!trimmed) {
        void refreshLibraryView();
        return;
      }
      void searchDocuments(trimmed);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [refreshLibraryView, searchDocuments, searchQuery]);

  const handleDeleteDocument = useCallback(async (documentId: number) => {
    if (selectedDocumentIds.has(documentId)) {
      const confirm = window.confirm(`ต้องการลบไฟล์ที่เลือกทั้งหมด (${selectedDocumentIds.size} ไฟล์) หรือไม่?`);
      if (!confirm) return;
      await Promise.all(
        Array.from(selectedDocumentIds).map(async (id) => {
          await deleteDocument(id);
          setDocumentTagsById((current) => {
            if (!(id in current)) return current;
            const next = { ...current };
            delete next[id];
            return next;
          });
        })
      );
      clearSelection();
    } else {
      const confirm = window.confirm('ต้องการลบไฟล์นี้หรือไม่?');
      if (!confirm) return;
      await deleteDocument(documentId);
      setDocumentTagsById((current) => {
        if (!(documentId in current)) return current;
        const next = { ...current };
        delete next[documentId];
        return next;
      });
    }
    await refreshLibraryView();
  }, [deleteDocument, refreshLibraryView, selectedDocumentIds, clearSelection]);

  const handleToggleFavorite = useCallback(async (docId: number) => {
    if (selectedDocumentIds.has(docId)) {
      await Promise.all(
        Array.from(selectedDocumentIds).map((id) => toggleFavorite(id))
      );
    } else {
      await toggleFavorite(docId);
    }
  }, [selectedDocumentIds, toggleFavorite]);

  const handleUpdateRating = useCallback(async (doc: DBDocument, rating: number) => {
    const isMulti = selectedDocumentIds.has(doc.id);
    const targetDocIds = isMulti ? Array.from(selectedDocumentIds) : [doc.id];
    
    await Promise.all(
      targetDocIds.map(async (docId) => {
        await window.electronAPI.db.updateDocument(docId, { rating });
      })
    );
    
    await refreshLibraryView();
  }, [selectedDocumentIds, refreshLibraryView]);

  const rawSortedDocuments = getSortedDocuments();
  const sortedDocuments = useMemo(() => {
    return rawSortedDocuments.filter(doc => {
      // 1. Rating Filter
      const rating = doc.rating || 0;
      if (ratingFilterMode === 'only') {
        if (ratingFilterOnly !== null && rating !== ratingFilterOnly) return false;
      } else {
        if (ratingFilterMin !== null && rating < ratingFilterMin) return false;
        if (ratingFilterMax !== null && rating > ratingFilterMax) return false;
      }

      // 2. Scope-aware Local Filter (Tag or No Folder within current view)
      if (activeFilterTag !== null) {
        if (activeFilterTag === 0) {
          // No tags (untagged files)
          const hasTags = (doc.tag_names && doc.tag_names.trim().length > 0) ||
                          (doc.tag_ids && doc.tag_ids.trim().length > 0);
          if (hasTags) return false;
        } else if (activeFilterTag === 'no_folder') {
          // No folder (files not in any folder)
          if (doc.project_id !== null && doc.project_id !== undefined) return false;
        } else {
          // Filter by specific tag ID
          const tagIdStr = String(activeFilterTag);
          const targetTag = tags.find(t => t.id === activeFilterTag);
          const hasTagId = doc.tag_ids ? doc.tag_ids.split(',').map(s => s.trim()).includes(tagIdStr) : false;
          const hasTagName = targetTag && doc.tag_names ? doc.tag_names.split(',').map(s => s.trim()).includes(targetTag.name) : false;
          if (!hasTagId && !hasTagName) return false;
        }
      }

      return true;
    });
  }, [rawSortedDocuments, ratingFilterMode, ratingFilterOnly, ratingFilterMin, ratingFilterMax, activeFilterTag, tags]);

  const currentSubprojects = useMemo(() => {
    if (filterType === 'favorites' || filterType === 'tag') {
      return [];
    }
    const safeProjects = Array.isArray(projects) ? projects : [];
    if (selectedProjectId !== null) {
      return safeProjects.filter(p => p.parent_id === selectedProjectId);
    }
    return safeProjects.filter(p => p.parent_id === null);
  }, [projects, selectedProjectId, filterType]);

  const breadcrumbItems = useMemo(() => {
    let homeLabel = 'Home';
    let isTagView = false;
    let activeTagObj: DBTag | undefined = undefined;

    if (filterType === 'tag' && selectedTagId !== null) {
      isTagView = true;
      if (selectedTagId === 0) {
        homeLabel = 'No tags';
      } else {
        activeTagObj = tags.find(t => t.id === selectedTagId);
        homeLabel = activeTagObj ? `#${activeTagObj.name}` : 'Tag';
      }
    } else if (filterType === 'favorites') {
      homeLabel = 'Favorites';
    }

    const items: Array<{
      id: number | null;
      name: string;
      color?: string;
      isHome?: boolean;
      isTag?: boolean;
      isFavorites?: boolean;
      tagColor?: string;
    }> = [
      {
        id: null,
        name: homeLabel,
        isHome: !isTagView && filterType !== 'favorites',
        isTag: isTagView,
        isFavorites: filterType === 'favorites',
        tagColor: activeTagObj?.color,
      }
    ];

    if (selectedProjectId !== null) {
      const chain: DBProject[] = [];
      let currentId: number | null = selectedProjectId;
      const visited = new Set<number>();
      while (currentId !== null && !visited.has(currentId)) {
        visited.add(currentId);
        const p = projects.find(item => item.id === currentId);
        if (p) {
          chain.unshift(p);
          currentId = p.parent_id;
        } else {
          break;
        }
      }

      for (const p of chain) {
        items.push({
          id: p.id,
          name: p.name,
          color: p.color || resolveStableAccent(p.id),
        });
      }
    }

    return items;
  }, [filterType, selectedTagId, tags, selectedProjectId, projects]);

  const handleBreadcrumbClick = useCallback((item: { id: number | null }, index: number) => {
    if (index === breadcrumbItems.length - 1) {
      return;
    }

    if (item.id === null) {
      setSelectedProjectId(null);
      if (selectedTagId !== null) {
        void loadDocumentsByTag(selectedTagId);
      } else if (filterType === 'favorites') {
        void loadFavoriteDocuments();
      } else {
        void loadRecentDocuments();
      }
      return;
    }

    void loadDocumentsByProject(item.id);
  }, [breadcrumbItems.length, filterType, loadDocumentsByProject, loadDocumentsByTag, loadFavoriteDocuments, loadRecentDocuments, selectedTagId, setSelectedProjectId]);

  const openDocumentMenu = useCallback(async (docId: number, position: MenuPosition) => {
    setActiveTagMenu(null);
    setLibraryMenuPosition(null);
    setActiveDocumentMenuId(docId);
    setActiveDocumentMenuPosition(position);

    if (!documentTagsById[docId]) {
      try {
        const documentTags = await loadDocumentTags(docId);
        setDocumentTagsById((current) => ({ ...current, [docId]: documentTags }));
      } catch (error) {
        console.error('Failed to load document tags:', error);
      }
    }
  }, [documentTagsById, loadDocumentTags]);

  const openTagMenu = useCallback((tag: DBTag, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveDocumentMenuId(null);
    setActiveDocumentMenuPosition(null);
    setLibraryMenuPosition(null);
    setActiveProjectMenu(null);
    setActiveTagMenu({
      tag,
      position: getFloatingMenuPosition(event.clientX, event.clientY, 224, 120)
    });
  }, []);

  const openProjectMenu = useCallback((project: DBProject, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveDocumentMenuId(null);
    setActiveDocumentMenuPosition(null);
    setLibraryMenuPosition(null);
    setActiveTagMenu(null);
    setActiveProjectMenu({
      project,
      position: getFloatingMenuPosition(event.clientX, event.clientY, 224, 120)
    });
  }, []);

  const handleToggleSortMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveDocumentMenuId(null);
    setActiveDocumentMenuPosition(null);
    setLibraryMenuPosition(null);
    setActiveTagMenu(null);
    setActiveProjectMenu(null);

    if (isSortMenuOpen) {
      setIsSortMenuOpen(false);
      setSortMenuPosition(null);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    setSortMenuPosition({
      x: Math.max(16, rect.right - 270),
      y: rect.bottom + 8
    });
    setIsSortMenuOpen(true);
  }, [isSortMenuOpen]);

  const handleToggleDocumentTag = useCallback(async (doc: DBDocument, tag: DBTag) => {
    const isMulti = selectedDocumentIds.has(doc.id);
    const targetDocIds = isMulti ? Array.from(selectedDocumentIds) : [doc.id];
    
    const currentTags = documentTagsById[doc.id] ?? [];
    const hasTag = currentTags.some(item => item.id === tag.id);

    try {
      if (hasTag) {
        await Promise.all(
          targetDocIds.map(async (docId) => {
            const docTags = documentTagsById[docId] ?? [];
            if (docTags.some(item => item.id === tag.id)) {
              await removeTagFromDocument(docId, tag.id);
              setDocumentTagsById((current) => ({
                ...current,
                [docId]: (current[docId] ?? []).filter(item => item.id !== tag.id)
              }));
            }
          })
        );
      } else {
        await Promise.all(
          targetDocIds.map(async (docId) => {
            const docTags = documentTagsById[docId] ?? [];
            if (!docTags.some(item => item.id === tag.id)) {
              await addTagToDocument(docId, tag.id);
              setDocumentTagsById((current) => ({
                ...current,
                [docId]: [...(current[docId] ?? []), tag].sort((a, b) => a.name.localeCompare(b.name))
              }));
            }
          })
        );
      }
    } catch (error) {
      console.error('Failed to update document tag:', error);
    }
  }, [addTagToDocument, documentTagsById, removeTagFromDocument, selectedDocumentIds]);

  const handleMoveDocumentToProject = useCallback(async (doc: DBDocument, projectId: number | null) => {
    const isMulti = selectedDocumentIds.has(doc.id);
    const targetDocIds = isMulti ? Array.from(selectedDocumentIds) : [doc.id];
    
    await Promise.all(
      targetDocIds.map((docId) => moveToProject(docId, projectId))
    );
    
    if (isMulti) {
      clearSelection();
    }
    await refreshLibraryView();
  }, [moveToProject, selectedDocumentIds, clearSelection, refreshLibraryView]);

  const handleCardClick = useCallback((doc: DBDocument, index: number, e: React.MouseEvent) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isShift) {
      e.preventDefault();
      e.stopPropagation();
      
      const lastId = lastClickedDocIdRef.current;
      let anchorIndex = lastId !== null ? sortedDocuments.findIndex(d => d.id === lastId) : -1;
      if (anchorIndex === -1) {
        anchorIndex = 0;
      }
      
      const minIdx = Math.min(anchorIndex, index);
      const maxIdx = Math.max(anchorIndex, index);
      const rangeIds = sortedDocuments.slice(minIdx, maxIdx + 1).map(d => d.id);
      
      selectRangeDocuments(rangeIds, isCtrl);
      return;
    }

    if (isCtrl) {
      e.preventDefault();
      e.stopPropagation();
      toggleDocumentSelection(doc.id);
      lastClickedDocIdRef.current = doc.id;
      return;
    }

    // When multi-select mode is active, clicking any card toggles it without requiring Ctrl to be held!
    if (selectedDocumentIds.size > 0) {
      e.preventDefault();
      e.stopPropagation();
      toggleDocumentSelection(doc.id);
      lastClickedDocIdRef.current = doc.id;
      return;
    }

    lastClickedDocIdRef.current = doc.id;
    handleOpenDocument(doc);
  }, [sortedDocuments, selectedDocumentIds.size, selectRangeDocuments, toggleDocumentSelection, handleOpenDocument]);

  const handleCheckboxClick = useCallback((doc: DBDocument, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    toggleDocumentSelection(doc.id);
    lastClickedDocIdRef.current = doc.id;
  }, [toggleDocumentSelection]);


  const openProjectDialog = useCallback((documentId: number | null = null, parentId: number | null = null) => {
    setActiveDocumentMenuId(null);
    setActiveDocumentMenuPosition(null);
    setActiveTagMenu(null);
    setActiveProjectMenu(null);
    setLibraryMenuPosition(null);
    const initialColor = FOLDER_PALETTE_COLORS[projects.length % FOLDER_PALETTE_COLORS.length];
    setProjectDialog({ isOpen: true, name: '', documentId, parentId, color: initialColor });
  }, [projects.length]);

  const openTagDialog = useCallback((documentId: number | null = null) => {
    setActiveDocumentMenuId(null);
    setActiveDocumentMenuPosition(null);
    setActiveTagMenu(null);
    setLibraryMenuPosition(null);
    setTagDialog({ isOpen: true, name: '', documentId });
  }, []);

  const handleCreateProject = useCallback(async () => {
    const name = projectDialog.name.trim();
    if (!name) return;

    const color = projectDialog.color || FOLDER_PALETTE_COLORS[projects.length % FOLDER_PALETTE_COLORS.length];
    const parentId = (projectDialog.parentId !== undefined && projectDialog.parentId !== null) ? projectDialog.parentId : (selectedProjectId ?? null);
    const project = await createProject(name, parentId, color);
    if (!project) return;

    if (projectDialog.documentId) {
      await moveToProject(projectDialog.documentId, project.id);
    }

    setProjectDialog({ isOpen: false, name: '', documentId: null, parentId: null, color: '' });
  }, [createProject, moveToProject, projectDialog.color, projectDialog.documentId, projectDialog.name, projectDialog.parentId, projects.length, selectedProjectId]);

  const handleEditProject = useCallback(async () => {
    const { project, name, color } = editProjectDialog;
    if (!project) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const success = await updateProject(project.id, { name: trimmedName, color });
    if (success) {
      setEditProjectDialog({ isOpen: false, project: null, name: '', color: '' });
    }
  }, [editProjectDialog, updateProject]);

  const handleEditTag = useCallback(async () => {
    const { tag, name, color } = editTagDialog;
    if (!tag) return;
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const success = await updateTag(tag.id, { name: trimmedName, color });
    if (success) {
      setEditTagDialog({ isOpen: false, tag: null, name: '', color: '' });
      await loadTags();
      if (selectedTagId === tag.id) {
        void loadDocumentsByTag(tag.id);
      } else {
        void loadRecentDocuments();
      }
    }
  }, [editTagDialog, updateTag, loadTags, selectedTagId, loadDocumentsByTag, loadRecentDocuments]);

  const handleCreateTag = useCallback(async () => {
    const name = tagDialog.name.trim();
    if (!name) return;

    const color = ['#FF8705', '#2B9BFF', '#8B5CF6', '#10B981', '#EC4899'][tags.length % 5];
    const tag = await createTag(name, color);
    if (!tag) return;

    if (tagDialog.documentId) {
      await addTagToDocument(tagDialog.documentId, tag.id);
      setDocumentTagsById((current) => ({
        ...current,
        [tagDialog.documentId!]: [...(current[tagDialog.documentId!] ?? []), tag].sort((a, b) => a.name.localeCompare(b.name))
      }));
    }

    setTagDialog({ isOpen: false, name: '', documentId: null });
  }, [addTagToDocument, createTag, tagDialog.documentId, tagDialog.name, tags.length]);

  const handleDeleteTag = useCallback(async () => {
    const targetTag = deleteTagDialog.tag;
    if (!targetTag) return;
    if (deleteTagDialog.confirmation.trim() !== targetTag.name) return;

    await deleteTag(targetTag.id);

    setDocumentTagsById((current) =>
      Object.fromEntries(
        Object.entries(current).map(([docId, docTags]) => [
          docId,
          docTags.filter((tag) => tag.id !== targetTag.id)
        ])
      )
    );

    if (selectedTagId === targetTag.id) {
      setSelectedTagId(null);
      void loadRecentDocuments();
    } else {
      void loadTags();
    }

    setActiveTagMenu(null);
    setDeleteTagDialog({ isOpen: false, tag: null, confirmation: '' });
  }, [deleteTag, deleteTagDialog.confirmation, deleteTagDialog.tag, loadRecentDocuments, loadTags, selectedTagId, setSelectedTagId]);

  const handleDeleteProject = useCallback(async () => {
    const targetProject = deleteProjectDialog.project;
    if (!targetProject) return;
    if (deleteProjectDialog.confirmation.trim() !== targetProject.name) return;

    await deleteProject(targetProject.id);

    if (selectedProjectId === targetProject.id) {
      setSelectedProjectId(null);
      void loadRecentDocuments();
    } else {
      void loadProjects();
    }

    setActiveProjectMenu(null);
    setDeleteProjectDialog({ isOpen: false, project: null, confirmation: '' });
  }, [deleteProject, deleteProjectDialog.confirmation, deleteProjectDialog.project, loadRecentDocuments, loadProjects, selectedProjectId, setSelectedProjectId]);

  const handleProjectDrop = useCallback(async (projectId: number | null, event?: React.DragEvent) => {
    let ids: number[] = [];
    if (event) {
      try {
        const rawIds = event.dataTransfer.getData('application/x-document-ids') || event.dataTransfer.getData('text/plain');
        if (rawIds) {
          const parsed = JSON.parse(rawIds);
          if (Array.isArray(parsed)) {
            ids = parsed.map(Number).filter(Number.isFinite);
          }
        }
      } catch (e) {
        console.error('Failed to parse dragged document IDs:', e);
      }
    }
    
    if (ids.length === 0) {
      if (draggedDocumentIds.length > 0) {
        ids = draggedDocumentIds;
      } else if (draggedDocumentId) {
        ids = selectedDocumentIds.has(draggedDocumentId)
          ? Array.from(selectedDocumentIds)
          : [draggedDocumentId];
      }
    }

    if (ids.length === 0) return;

    // Directly move all items in parallel without nested handleMoveDocumentToProject loops
    await Promise.all(
      ids.map((docId) => moveToProject(docId, projectId))
    );

    // Clear selection and drag state after moving
    clearSelection();
    setDraggedDocumentId(null);
    setDraggedDocumentIds([]);
    setProjectDropTargetId(null);

    // Refresh view staying on current active page/tag/folder
    await refreshLibraryView();
  }, [draggedDocumentIds, draggedDocumentId, selectedDocumentIds, moveToProject, clearSelection, refreshLibraryView]);

  const handleDropOnProject = useCallback(async (targetProjectId: number | null, event?: React.DragEvent) => {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    // 1. Check if dragging a folder
    let sourceProjId: number | null = null;
    if (event) {
      const textPlain = event.dataTransfer.getData('text/plain') || '';
      if (textPlain.startsWith('project:')) {
        const parsed = Number(textPlain.replace('project:', ''));
        if (Number.isFinite(parsed)) sourceProjId = parsed;
      }
      if (sourceProjId === null) {
        const rawProjId = event.dataTransfer.getData('application/x-project-id');
        if (rawProjId) {
          const parsed = Number(rawProjId);
          if (Number.isFinite(parsed)) sourceProjId = parsed;
        }
      }
    }
    if (sourceProjId === null && draggedProjectIdRef.current !== null) {
      sourceProjId = draggedProjectIdRef.current;
    }
    if (sourceProjId === null && draggedProjectId !== null) {
      sourceProjId = draggedProjectId;
    }

    if (sourceProjId !== null) {
      // Prevent dropping a folder into itself
      if (targetProjectId === sourceProjId) {
        draggedProjectIdRef.current = null;
        setDraggedProjectId(null);
        setProjectDropTargetId(null);
        return;
      }
      // Prevent cyclic dependency: dropping a parent folder into one of its children
      if (targetProjectId !== null) {
        let current = projects.find(p => p.id === targetProjectId);
        let isDescendant = false;
        while (current && current.parent_id !== null) {
          if (current.parent_id === sourceProjId) {
            isDescendant = true;
            break;
          }
          current = projects.find(p => p.id === current?.parent_id);
        }
        if (isDescendant) {
          draggedProjectIdRef.current = null;
          setDraggedProjectId(null);
          setProjectDropTargetId(null);
          return;
        }
      }

      const moved = await updateProject(sourceProjId, { parent_id: targetProjectId });
      if (moved) {
        if (targetProjectId !== null) {
          setExpandedProjectIds(prev => new Set(prev).add(targetProjectId));
        }
        await loadProjects();
        await refreshLibraryView();
      }
      draggedProjectIdRef.current = null;
      setDraggedProjectId(null);
      setProjectDropTargetId(null);
      return;
    }

    // 2. Otherwise handle dropped documents
    await handleProjectDrop(targetProjectId, event);
  }, [draggedProjectId, projects, updateProject, loadProjects, refreshLibraryView, handleProjectDrop]);

  useEffect(() => {
    const pendingDocs = sortedDocuments
      .filter(doc => !doc.thumbnail_path)
      .slice(0, viewMode === 'grid' ? 8 : 6);

    pendingDocs.forEach((doc) => {
      if (thumbnailJobsRef.current.has(doc.id) || !window.electronAPI?.fs?.readFile) return;

      thumbnailJobsRef.current.add(doc.id);
      void (async () => {
        try {
          const source = await window.electronAPI.fs.readFile(doc.filepath);
          const thumbnail = await generateDocumentThumbnail({
            name: source.name,
            mimeType: source.mimeType,
            data: source.data
          });

          const persisted = await persistDocumentPatch(doc.id, {
            thumbnail_path: thumbnail.dataUrl,
            total_pages: thumbnail.totalPages ?? doc.total_pages
          });
          if (!persisted) {
            console.warn(`[Library] Failed to persist preview for "${doc.filename}"`);
          }
        } catch (error) {
          console.warn(`[Library] Failed to generate preview for "${doc.filename}"`, error);
        } finally {
          thumbnailJobsRef.current.delete(doc.id);
        }
      })();
    });
  }, [persistDocumentPatch, sortedDocuments, viewMode]);

  const renderProjectTree = useCallback((parentId: number | null, level: number = 0) => {
    const levelProjects = projects.filter(p => p.parent_id === parentId);
    return levelProjects.map((project, index) => {
      const displayColor = project.color || resolveThemedAccent(index);
      const hasChildren = projects.some(p => p.parent_id === project.id);
      const isExpanded = expandedProjectIds.has(project.id);

      return (
        <React.Fragment key={project.id}>
          <ProjectItem
            project={project}
            displayColor={displayColor}
            isSelected={selectedProjectId === project.id}
            isDropTarget={projectDropTargetId === project.id}
            draggable={true}
            onDragStart={(event) => {
              event.dataTransfer.setData('text/plain', `project:${project.id}`);
              event.dataTransfer.setData('application/x-project-id', String(project.id));
              event.dataTransfer.effectAllowed = 'move';
              draggedProjectIdRef.current = project.id;
              setDraggedProjectId(project.id);
              setActiveProjectMenu(null);

              const dragGhost = document.createElement('div');
              dragGhost.style.position = 'absolute';
              dragGhost.style.top = '-9999px';
              dragGhost.style.left = '-9999px';
              dragGhost.style.padding = '4px 10px';
              dragGhost.style.background = '#4f46e5';
              dragGhost.style.color = '#ffffff';
              dragGhost.style.fontSize = '12px';
              dragGhost.style.fontWeight = 'bold';
              dragGhost.style.borderRadius = '8px';
              dragGhost.style.boxShadow = '0 4px 14px rgba(0,0,0,0.4)';
              dragGhost.innerText = `📁 ${project.name}`;
              document.body.appendChild(dragGhost);
              event.dataTransfer.setDragImage(dragGhost, 10, 10);
              setTimeout(() => {
                if (document.body.contains(dragGhost)) {
                  document.body.removeChild(dragGhost);
                }
              }, 0);
            }}
            onDragEnd={() => {
              draggedProjectIdRef.current = null;
              setDraggedProjectId(null);
              setProjectDropTargetId(null);
            }}
            level={level}
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            onToggleExpand={() => toggleProjectExpanded(project.id)}
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = 'move';
              setProjectDropTargetId(project.id);
            }}
            onDragLeave={(event) => {
              event.stopPropagation();
              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
              if (projectDropTargetId === project.id) {
                setProjectDropTargetId(null);
              }
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleDropOnProject(project.id, event);
            }}
            onSelect={() => {
              if (selectedProjectId === project.id) {
                setSelectedProjectId(null);
                if (selectedTagId !== null) {
                  loadDocumentsByTag(selectedTagId);
                } else {
                  loadRecentDocuments();
                }
              } else {
                loadDocumentsByProject(project.id);
              }
            }}
            onContextMenu={(event) => openProjectMenu(project, event)}
          />
          {isExpanded && renderProjectTree(project.id, level + 1)}
        </React.Fragment>
      );
    });
  }, [projects, selectedProjectId, selectedTagId, projectDropTargetId, expandedProjectIds, toggleProjectExpanded, handleDropOnProject, loadRecentDocuments, loadDocumentsByTag, loadDocumentsByProject, openProjectMenu]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#17181b] text-slate-100">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(82,162,255,0.18),transparent_40%),radial-gradient(circle_at_54%_10%,rgba(94,124,255,0.16),transparent_44%),radial-gradient(circle_at_86%_24%,rgba(149,106,255,0.16),transparent_38%),linear-gradient(138deg,rgba(18,22,34,0.98)_0%,rgba(22,31,50,0.985)_38%,rgba(16,24,43,0.995)_68%,rgba(22,17,40,1)_100%)]" />
        <div className="absolute inset-y-0 left-0 w-[24rem] bg-[linear-gradient(90deg,rgba(72,142,255,0.2),rgba(72,142,255,0))]" />
        <div className="absolute inset-x-0 top-0 h-24 bg-[linear-gradient(180deg,rgba(255,255,255,0.025),rgba(255,255,255,0))]" />
      </div>

      <div className="relative z-10 flex h-full w-full">
        {/* Left Navigation & Secondary Sidebar */}
        <LibrarySidebar
          activePage={activePage}
          setActivePage={setActivePage}
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          filterType={filterType}
          selectedTagId={selectedTagId}
          setSelectedTagId={setSelectedTagId}
          selectedProjectId={selectedProjectId}
          loadRecentDocuments={loadRecentDocuments}
          loadFavoriteDocuments={loadFavoriteDocuments}
          loadDocumentsByTag={loadDocumentsByTag}
          loadDocumentsByProject={loadDocumentsByProject}
          tags={tags}
          openTagDialog={openTagDialog}
          openTagMenu={openTagMenu}
          setActiveTagMenu={setActiveTagMenu}
          openProjectDialog={openProjectDialog}
          renderProjectTree={renderProjectTree}
          draggedProjectIdRef={draggedProjectIdRef}
          draggedProjectId={draggedProjectId}
          handleDropOnProject={handleDropOnProject}
          gpuInfo={gpuInfo}
          getGpuModeLabel={getGpuModeLabel}
          geminiApiKeyDraft={geminiApiKeyDraft}
          setGeminiApiKeyDraft={setGeminiApiKeyDraft}
          showGeminiApiKey={showGeminiApiKey}
          setShowGeminiApiKey={setShowGeminiApiKey}
          saveGeminiApiKey={saveGeminiApiKey}
          clearGeminiApiKey={clearGeminiApiKey}
          isGeminiApiKeyLoaded={isGeminiApiKeyLoaded}
          isGeminiApiKeySaving={isGeminiApiKeySaving}
          hasGeminiApiKey={hasGeminiApiKey}
          geminiApiKeySource={geminiApiKeySource}
          geminiInputPlaceholder={geminiInputPlaceholder}
          geminiStatusClass={geminiStatusClass}
          geminiStatusLabel={geminiStatusLabel}
          geminiApiKeyError={geminiApiKeyError}
          paddleThaiStatus={paddleThaiStatus}
          paddleEnglishStatus={paddleEnglishStatus}
          handleDownloadModel={handleDownloadModel}
          isThaiTargetLanguage={isThaiTargetLanguage}
          overlayFontPreset={overlayFontPreset}
          setOverlayFontPreset={setOverlayFontPreset}
          selectedFontAvailable={selectedFontAvailable}
          ocrOptions={ocrOptions}
          setOCROptions={setOCROptions}
        />

        {/* Main Content Area */}
        <div className="relative flex-1 flex flex-col overflow-hidden bg-[#25272b]">
          {/* Toolbar */}
          <LibraryTopBar
            isSidebarOpen={isSidebarOpen}
            toggleSidebar={toggleSidebar}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            handleSearch={handleSearch}
            viewMode={viewMode}
            setViewMode={setViewMode}
            isSortMenuOpen={isSortMenuOpen}
            activeFilterTag={activeFilterTag}
            ratingFilterOnly={ratingFilterOnly}
            ratingFilterMin={ratingFilterMin}
            ratingFilterMax={ratingFilterMax}
            handleToggleSortMenu={handleToggleSortMenu}
          />

          {/* File Open Error Banner */}
          <FileOpenErrorBanner
            fileOpenError={fileOpenError}
            documents={documents}
            handleOpenDocument={handleOpenDocument}
            handleBrowse={handleBrowse}
            handleDeleteDocument={handleDeleteDocument}
            setFileOpenError={setFileOpenError}
          />

          {/* Breadcrumb Path Navigation Bar */}
          <LibraryBreadcrumbs
            breadcrumbItems={breadcrumbItems}
            handleBreadcrumbClick={handleBreadcrumbClick}
            currentSubprojects={currentSubprojects}
            sortedDocumentsCount={sortedDocuments.length}
            selectedProjectId={selectedProjectId}
            openProjectDialog={openProjectDialog}
          />

          {/* Documents Grid/List & Dropzone */}
          <div
            className="flex-1 overflow-y-auto p-4 custom-scrollbar"
            onContextMenu={(e) => {
              if ((e.target as HTMLElement).closest('[data-document-card="true"]')) return;
              e.preventDefault();
              setActiveDocumentMenuId(null);
              setActiveDocumentMenuPosition(null);
              setActiveTagMenu(null);
              setLibraryMenuPosition(getFloatingMenuPosition(e.clientX, e.clientY, 224, 156));
            }}
          >
            <DocumentGridView
              isLoading={isLoading}
              sortedDocuments={sortedDocuments}
              currentSubprojects={currentSubprojects}
              viewMode={viewMode}
              selectedProjectId={selectedProjectId}
              projectDropTargetId={projectDropTargetId}
              setProjectDropTargetId={setProjectDropTargetId}
              draggedProjectIdRef={draggedProjectIdRef}
              setDraggedProjectId={setDraggedProjectId}
              setActiveProjectMenu={setActiveProjectMenu}
              loadDocumentsByProject={loadDocumentsByProject}
              openProjectMenu={openProjectMenu}
              handleDropOnProject={handleDropOnProject}
              selectedDocumentIds={selectedDocumentIds}
              handleOpenDocument={handleOpenDocument}
              handleCardClick={handleCardClick}
              handleCheckboxClick={handleCheckboxClick}
              handleToggleFavorite={handleToggleFavorite}
              handleDeleteDocument={handleDeleteDocument}
              activeDocumentMenuId={activeDocumentMenuId}
              activeDocumentMenuPosition={activeDocumentMenuPosition}
              documentTagsById={documentTagsById}
              tags={tags}
              projects={projects}
              openDocumentMenu={openDocumentMenu}
              setActiveDocumentMenuId={setActiveDocumentMenuId}
              setActiveDocumentMenuPosition={setActiveDocumentMenuPosition}
              handleToggleDocumentTag={handleToggleDocumentTag}
              handleMoveDocumentToProject={handleMoveDocumentToProject}
              toggleDocumentSelection={toggleDocumentSelection}
              openTagDialog={openTagDialog}
              setDraggedDocumentId={setDraggedDocumentId}
              setDraggedDocumentIds={setDraggedDocumentIds}
              setLibraryMenuPosition={setLibraryMenuPosition}
              hiddenThumbnails={hiddenThumbnails}
              toggleHideThumbnail={toggleHideThumbnail}
              openOcrBackgroundDialog={openOcrBackgroundDialog}
              handleUpdateRating={handleUpdateRating}
              isDragging={isDragging}
              setIsDragging={setIsDragging}
              handleDrop={handleDrop}
              handleBrowse={handleBrowse}
              openProjectDialog={openProjectDialog}
              documents={documents}
            />
          </div>
        </div>

        {/* Right: Project Settings / Import Panel */}
        <LibraryRightPanel
          isDragging={isDragging}
          setIsDragging={setIsDragging}
          handleDrop={handleDrop}
          handleBrowse={handleBrowse}
          translationMode={translationMode}
          setTranslationMode={setTranslationMode}
          safetySettings={safetySettings}
          updateSafetySettings={updateSafetySettings}
          jobs={jobs}
          clearCompletedJobs={clearCompletedJobs}
          moveJobUp={moveJobUp}
          moveJobDown={moveJobDown}
          pauseJob={pauseJob}
          resumeJob={resumeJob}
          cancelJob={cancelJob}
          removeJob={removeJob}
          handleOpenJobFile={handleOpenJobFile}
        />

        {/* Modals, Floating Menus & Hidden File Input */}
        <LibraryModals
          libraryMenuPosition={libraryMenuPosition}
          setLibraryMenuPosition={setLibraryMenuPosition}
          openProjectDialog={openProjectDialog}
          openTagDialog={openTagDialog}
          loadRecentDocuments={loadRecentDocuments}
          activeProjectMenu={activeProjectMenu}
          setActiveProjectMenu={setActiveProjectMenu}
          folderInfoProject={folderInfoProject}
          setFolderInfoProject={setFolderInfoProject}
          deleteProjectDialog={deleteProjectDialog}
          setDeleteProjectDialog={setDeleteProjectDialog}
          editProjectDialog={editProjectDialog}
          setEditProjectDialog={setEditProjectDialog}
          handleEditProject={handleEditProject}
          handleDeleteProject={handleDeleteProject}
          activeTagMenu={activeTagMenu}
          setActiveTagMenu={setActiveTagMenu}
          editTagDialog={editTagDialog}
          setEditTagDialog={setEditTagDialog}
          handleEditTag={handleEditTag}
          deleteTagDialog={deleteTagDialog}
          setDeleteTagDialog={setDeleteTagDialog}
          handleDeleteTag={handleDeleteTag}
          isSortMenuOpen={isSortMenuOpen}
          setIsSortMenuOpen={setIsSortMenuOpen}
          sortMenuPosition={sortMenuPosition}
          setSortMenuPosition={setSortMenuPosition}
          sortBy={sortBy}
          sortOrder={sortOrder}
          ratingFilterMode={ratingFilterMode}
          ratingFilterOnly={ratingFilterOnly}
          ratingFilterMin={ratingFilterMin}
          ratingFilterMax={ratingFilterMax}
          activeFilterTag={activeFilterTag}
          tags={tags}
          setActiveFilterTag={setActiveFilterTag}
          setRatingFilterMode={setRatingFilterMode}
          setRatingFilterOnly={setRatingFilterOnly}
          setRatingFilterMin={setRatingFilterMin}
          setRatingFilterMax={setRatingFilterMax}
          setSortBy={setSortBy}
          setSortOrder={setSortOrder}
          ocrBackgroundDialog={ocrBackgroundDialog}
          setOcrBackgroundDialog={setOcrBackgroundDialog}
          dialogCachePages={dialogCachePages}
          handleStartOcrBackground={handleStartOcrBackground}
          projectDialog={projectDialog}
          setProjectDialog={setProjectDialog}
          handleCreateProject={handleCreateProject}
          tagDialog={tagDialog}
          setTagDialog={setTagDialog}
          handleCreateTag={handleCreateTag}
          importProgress={importProgress}
          fileInputRef={fileInputRef}
          handleFileSelect={handleFileSelect}
        />
      </div>
    </div>
  );
};

