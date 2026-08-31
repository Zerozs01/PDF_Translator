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
        let changed = false;
        const next = new Set(prev);
        documents.forEach(doc => {
          if (doc.is_thumbnail_hidden && !next.has(doc.id)) {
            next.add(doc.id);
            changed = true;
          }
        });
        return changed ? next : prev;
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

      // Persist to SQLite DB so it is synchronized across production and dev mode
      dbService.toggleThumbnailHidden(docId).catch(err => {
        console.warn('[UploadScreen] Failed to persist toggleThumbnailHidden in DB:', err);
      });

      return next;
    });
  }, []);

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
    if (selectedProjectId !== null) {
      return projects.filter(p => p.parent_id === selectedProjectId);
    }
    return projects.filter(p => p.parent_id === null);
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
        {/* Left Navigation Sidebar */}
        <div className="w-16 bg-[#0e0f11]/86 border-r border-white/6 backdrop-blur-xl flex flex-col items-center py-4 titlebar-drag">
          <button
            onClick={() => { setActivePage('home'); loadRecentDocuments(); }}
            className={`p-3 rounded-xl mb-2 transition-all ${
              activePage === 'home'
                ? 'bg-[#262a30] text-slate-50 ring-1 ring-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-100'
            }`}
            title="Home"
          >
            <HomeIcon size={20} />
          </button>
          <button
            onClick={() => { setActivePage('projects'); setIsSidebarOpen(true); }}
            className={`p-3 rounded-xl mb-2 transition-all ${
              activePage === 'projects'
                ? 'bg-[#262a30] text-slate-50 ring-1 ring-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-100'
            }`}
            title="Projects"
          >
            <FolderOpen size={20} />
          </button>

          <div className="flex-1" />

          <button
            onClick={() => { setActivePage('settings'); setIsSidebarOpen(true); }}
            className={`p-3 rounded-xl transition-all ${
              activePage === 'settings'
                ? 'bg-[#262a30] text-slate-50 ring-1 ring-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                : 'text-slate-500 hover:bg-white/[0.06] hover:text-slate-100'
            }`}
            title="Settings"
          >
            <Settings2 size={20} />
          </button>
        </div>

        {/* Secondary Sidebar */}
        <div className={`transition-all duration-300 ease-in-out border-r border-white/6 bg-[#111214]/74 backdrop-blur-xl flex flex-col overflow-hidden shrink-0 titlebar-drag ${
          isSidebarOpen ? 'w-56 p-4 opacity-100' : 'w-0 p-0 border-r-0 opacity-0 pointer-events-none'
        }`}>
        {activePage === 'home' ? (
          <>
            {/* Quick Filters */}
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-2 px-0.5 select-none titlebar-drag">Library</h2>
            <div className="space-y-1 mb-3">
              <button
                onClick={() => {
                  setSelectedTagId(null);
                  loadRecentDocuments();
                }}
                className={`w-full py-1.5 px-2.5 rounded-lg text-left text-xs flex items-center gap-2.5 border transition-all ${
                  filterType === 'recent'
                    ? 'border-white/12 bg-[#25282d] text-slate-100'
                    : 'border-transparent hover:border-white/8 hover:bg-white/[0.04] text-slate-300'
                }`}
              >
                <Clock size={14} /> Recent
              </button>
              <button
                onClick={() => {
                  setSelectedTagId(null);
                  loadFavoriteDocuments();
                }}
                className={`w-full py-1.5 px-2.5 rounded-lg text-left text-xs flex items-center gap-2.5 border transition-all ${
                  filterType === 'favorites'
                    ? 'border-white/12 bg-[#25282d] text-slate-100'
                    : 'border-transparent hover:border-white/8 hover:bg-white/[0.04] text-slate-300'
                }`}
              >
                <Star size={14} /> Favorites
              </button>
            </div>

            {/* Subtle Divider Line */}
            <div className="h-px bg-white/6 my-3 w-full shrink-0" />

            {/* Tags */}
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-2 px-0.5 flex items-center justify-between">
              Tags
              <button
                onClick={() => openTagDialog()}
                className="p-1 rounded hover:bg-white/10"
                title="Create Tag"
              >
                <Plus size={12} />
              </button>
            </h2>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <TagPill
                tag={{ id: 0, name: 'No tags', color: '#64748b', created_at: '' }}
                displayColor="#64748b"
                isSelected={selectedTagId === 0}
                onContextMenu={(event) => event.preventDefault()}
                onClick={() => {
                  setActiveTagMenu(null);
                  if (selectedTagId === 0) {
                    setSelectedTagId(null);
                    if (selectedProjectId !== null) {
                      loadDocumentsByProject(selectedProjectId);
                    } else {
                      loadRecentDocuments();
                    }
                  } else {
                    loadDocumentsByTag(0);
                  }
                }}
              />
              {tags.map((tag, index) => (
                <TagPill 
                  key={tag.id} 
                  tag={tag} 
                  displayColor={tag.color || resolveThemedAccent(index)}
                  isSelected={selectedTagId === tag.id}
                  onContextMenu={(event) => openTagMenu(tag, event)}
                  onClick={() => {
                    setActiveTagMenu(null);
                    if (selectedTagId === tag.id) {
                      setSelectedTagId(null);
                      if (selectedProjectId !== null) {
                        loadDocumentsByProject(selectedProjectId);
                      } else {
                        loadRecentDocuments();
                      }
                    } else {
                      loadDocumentsByTag(tag.id);
                    }
                  }}
                />
              ))}
            </div>

            {/* Subtle Divider Line */}
            <div className="h-px bg-white/6 my-3 w-full shrink-0" />

            {/* Projects */}
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-2 px-0.5 flex items-center justify-between">
              Projects
              <button
                onClick={() => openProjectDialog()}
                className="p-1 rounded hover:bg-white/10"
                title="Create Folder"
              >
                <Plus size={12} />
              </button>
            </h2>
            <div 
              onDragOver={(event) => {
                if (draggedProjectIdRef.current !== null || draggedProjectId !== null) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }
              }}
              onDrop={(event) => {
                if (draggedProjectIdRef.current !== null || draggedProjectId !== null) {
                  event.preventDefault();
                  void handleDropOnProject(null, event);
                }
              }}
              className="flex-1 overflow-y-auto space-y-1 custom-scrollbar min-h-[120px] rounded-xl"
            >
              {renderProjectTree(null)}
            </div>

            {/* Hardware Acceleration GPU Status */}
            <div className="mt-4 border-t border-white/6 pt-4 shrink-0">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.22em] mb-2 block">
                Hardware Acceleration
              </label>
              <div className="rounded-xl border border-white/8 bg-slate-950/40 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-slate-400">GPU Acceleration</span>
                  <span className={`inline-flex items-center gap-1 text-[8px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                    gpuInfo && gpuInfo.mode !== 'CPU'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  }`}>
                    <span className={`h-1 w-1 rounded-full ${gpuInfo && gpuInfo.mode !== 'CPU' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                    {getGpuModeLabel(gpuInfo)}
                  </span>
                </div>
                <div className="text-[9px] text-slate-500 leading-normal">
                  <div className="font-semibold text-slate-300 truncate" title={gpuInfo?.gpus.join(', ')}>
                    Device: {gpuInfo?.gpus[0] || 'Loading...'}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : activePage === 'projects' ? (
          <>
            {/* Projects Page Sidebar */}
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 titlebar-drag select-none">
              <FolderOpen className="text-slate-300" size={20} /> Projects
            </h2>
            <button
              onClick={() => openProjectDialog()}
              className="w-full p-3 rounded-lg bg-[#25282d] hover:bg-[#2b2f35] text-white text-sm font-medium flex items-center justify-center gap-2 mb-4 border border-white/10 transition-all"
            >
              <Plus size={16} /> New Project
            </button>
            <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
              {renderProjectTree(null)}
            </div>
          </>
        ) : (
          <>
            {/* Settings Page Sidebar */}
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 titlebar-drag select-none">
              <Settings2 className="text-slate-300" size={20} /> Settings
            </h2>

            <div className="flex-1 overflow-y-auto space-y-5 custom-scrollbar pr-1">
              <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-2">
                <label className="text-[11px] font-semibold text-slate-300">Gemini API Key</label>
                <div className="relative">
                  <KeyRound size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showGeminiApiKey ? 'text' : 'password'}
                    value={geminiApiKeyDraft}
                    onChange={(e) => setGeminiApiKeyDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void saveGeminiApiKey();
                      }
                    }}
                    placeholder={geminiInputPlaceholder}
                    className="w-full rounded-lg border border-white/12 bg-slate-900/85 pl-7 pr-8 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#2B9BFF]/55"
                    disabled={!isGeminiApiKeyLoaded || isGeminiApiKeySaving}
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiApiKey((prev) => !prev)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-white/10"
                    title={showGeminiApiKey ? 'Hide API key' : 'Show API key'}
                  >
                    {showGeminiApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void saveGeminiApiKey()}
                    disabled={!geminiApiKeyDraft.trim() || isGeminiApiKeySaving || !isGeminiApiKeyLoaded}
                    className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check size={12} />
                    Save Securely
                  </button>
                  <button
                    type="button"
                    onClick={() => void clearGeminiApiKey()}
                    disabled={(!hasGeminiApiKey && geminiApiKeySource !== 'environment') || isGeminiApiKeySaving || !isGeminiApiKeyLoaded}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/12 bg-slate-900/70 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 transition-colors hover:border-white/20 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X size={12} />
                    Clear Saved Key
                  </button>
                </div>
                <p className={`text-[10px] leading-relaxed ${geminiStatusClass}`}>
                  {geminiStatusLabel}
                </p>
                {geminiApiKeyError && (
                  <p className="text-[10px] leading-relaxed text-rose-300/90">
                    {geminiApiKeyError}
                  </p>
                )}
              </div>

              {/* Model Downloader / Management */}
              <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-3">
                <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                  <Download size={12} className="text-slate-400" />
                  การจัดการโมเดล OCR (Model Management)
                </label>
                
                <div className="space-y-3 text-xs">
                  {/* Thai OCR Model */}
                  <div className="rounded-lg bg-slate-900/50 p-2 border border-white/5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">โมเดลภาษาไทย (Thai Model)</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                        paddleThaiStatus.downloading
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                          : paddleThaiStatus.installed
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-slate-500/10 text-slate-400 border border-white/10'
                      }`}>
                        {paddleThaiStatus.downloading ? 'กำลังดาวน์โหลด...' : paddleThaiStatus.installed ? 'ติดตั้งแล้ว' : 'ไม่ได้ติดตั้ง'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">PaddleOCR PP-OCRv5 Thai Model (~15MB)</span>
                      <button
                        type="button"
                        onClick={() => handleDownloadModel('th')}
                        disabled={paddleThaiStatus.checking || paddleThaiStatus.downloading || paddleThaiStatus.installed}
                        className="rounded bg-[#2B9BFF] hover:bg-[#1a85e8] disabled:bg-slate-800 disabled:text-slate-500 px-2 py-1 text-[10px] font-semibold text-white transition-colors"
                      >
                        {paddleThaiStatus.downloading ? 'Downloading...' : paddleThaiStatus.installed ? 'Installed' : 'Download'}
                      </button>
                    </div>
                    {paddleThaiStatus.downloading && (
                      <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                        <div className="bg-[#2B9BFF] h-1 rounded-full animate-pulse" style={{ width: '65%' }}></div>
                      </div>
                    )}
                  </div>

                  {/* English OCR Model */}
                  <div className="rounded-lg bg-slate-900/50 p-2 border border-white/5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">โมเดลภาษาอังกฤษ (English Model)</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                        paddleEnglishStatus.downloading
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                          : paddleEnglishStatus.installed
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                            : 'bg-slate-500/10 text-slate-400 border border-white/10'
                      }`}>
                        {paddleEnglishStatus.downloading ? 'กำลังดาวน์โหลด...' : paddleEnglishStatus.installed ? 'ติดตั้งแล้ว' : 'ไม่ได้ติดตั้ง'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] text-slate-400">PaddleOCR English Model (~10MB)</span>
                      <button
                        type="button"
                        onClick={() => handleDownloadModel('en')}
                        disabled={paddleEnglishStatus.checking || paddleEnglishStatus.downloading || paddleEnglishStatus.installed}
                        className="rounded bg-[#2B9BFF] hover:bg-[#1a85e8] disabled:bg-slate-800 disabled:text-slate-500 px-2 py-1 text-[10px] font-semibold text-white transition-colors"
                      >
                        {paddleEnglishStatus.downloading ? 'Downloading...' : paddleEnglishStatus.installed ? 'Installed' : 'Download'}
                      </button>
                    </div>
                    {paddleEnglishStatus.downloading && (
                      <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                        <div className="bg-[#2B9BFF] h-1 rounded-full animate-pulse" style={{ width: '65%' }}></div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Security Settings */}
              <SecuritySettings />

              {/* Hardware Acceleration GPU Status */}
              <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-2.5">
                <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1.5">
                  <Cpu size={12} className="text-slate-400" />
                  Hardware Acceleration / GPU Status
                </label>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Acceleration Mode</span>
                    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                      gpuInfo && gpuInfo.mode !== 'CPU'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${gpuInfo && gpuInfo.mode !== 'CPU' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                      {getGpuModeLabel(gpuInfo)}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-slate-400 shrink-0">Detected GPUs</span>
                    <div className="text-slate-200 text-right truncate font-mono text-[10px]" title={gpuInfo?.gpus.join(', ')}>
                      {gpuInfo?.gpus.join(', ') || 'None'}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">DirectML Support</span>
                    <span className={`text-[10px] font-semibold ${gpuInfo?.hasDirectML ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {gpuInfo?.hasDirectML ? 'Available' : 'Unavailable'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">CUDA Support</span>
                    <span className={`text-[10px] font-semibold ${gpuInfo?.hasCuda ? 'text-emerald-400' : 'text-slate-500'}`}>
                      {gpuInfo?.hasCuda ? 'Available' : 'Unavailable'}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-normal border-t border-white/5 pt-2">
                    {gpuInfo && gpuInfo.mode !== 'CPU'
                      ? 'GPU Acceleration is active. The system will leverage DirectML/CUDA for OCR processing.'
                      : 'Running on CPU. If you have an AMD/Intel/NVIDIA GPU, make sure you ran setup correctly to enable hardware acceleration.'}
                  </p>
                </div>
              </div>

              {isThaiTargetLanguage && (
                <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-2.5">
                  <label className="text-[11px] font-semibold text-slate-300">Overlay Font</label>

                  <select
                    value={overlayFontPreset}
                    onChange={(e) => setOverlayFontPreset(e.target.value as OverlayFontPreset)}
                    className="w-full rounded-lg border border-white/12 bg-slate-900/85 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#2B9BFF]/55"
                    aria-label="Overlay font preset"
                    title="Overlay font preset"
                  >
                    {OVERLAY_FONT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>

                  <p className={`text-[10px] leading-relaxed ${
                    selectedFontAvailable === false
                      ? 'text-amber-300/90'
                      : selectedFontAvailable === true
                        ? 'text-emerald-300/85'
                        : 'text-slate-500'
                  }`}>
                    Font status: {
                      selectedFontAvailable === false
                        ? 'fallback in use (font not detected)'
                        : selectedFontAvailable === true
                          ? 'detected and ready'
                          : 'unknown'
                    }
                  </p>
                </div>
              )}

              <div className="rounded-xl border border-white/10 bg-[#13151a]/92 p-3 space-y-3">
                <label className="text-[11px] font-semibold text-slate-300">OCR Runtime</label>
                <div className="grid grid-cols-12 items-center gap-2">
                  <label className="col-span-5 text-[11px] font-semibold text-slate-300">Timeout</label>
                  <select
                    value={ocrOptions.perPageTimeoutSec ?? OCR_PER_PAGE_TIMEOUT_SEC_DEFAULT}
                    onChange={(e) => setOCROptions({ perPageTimeoutSec: Number(e.target.value) })}
                    aria-label="OCR timeout seconds per page"
                    title="OCR timeout seconds per page"
                    className="col-span-7 rounded-lg border border-white/12 bg-slate-900/80 px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-[#2B9BFF]/55"
                  >
                    <option value={0}>No Limit</option>
                    <option value={30}>30s</option>
                    <option value={60}>60s</option>
                    <option value={120}>120s</option>
                    <option value={180}>180s</option>
                    <option value={300}>300s</option>
                  </select>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-900/55 px-2.5 py-2">
                  <span className="text-[11px] font-semibold text-slate-300">Skip if text exists</span>
                  <input
                    type="checkbox"
                    checked={ocrOptions.skipIfTextExists !== false}
                    onChange={(e) => setOCROptions({ skipIfTextExists: e.target.checked })}
                    className="accent-[#2B9BFF]"
                    aria-label="Skip OCR if Text Exists"
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

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
                            await handleDeleteDocument(fileOpenError.docId);
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

          {/* Breadcrumb Path Navigation Bar */}
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
                {sortedDocuments.length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="font-bold text-sky-400">{sortedDocuments.length}</span>
                    <span className="text-white font-medium">{sortedDocuments.length === 1 ? 'File' : 'Files'}</span>
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

          {/* Documents Grid/List */}
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
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-slate-300/80"></div>
              </div>
            ) : (sortedDocuments.length > 0 || currentSubprojects.length > 0) ? (
              <div className="h-full overflow-y-auto pr-1 custom-scrollbar pb-20">
                {/* 📂 Render Folder Grid/List first */}
                {viewMode === 'grid' ? (
                  currentSubprojects.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
                      {currentSubprojects.map((subproj) => {
                        const accent = subproj.color || resolveStableAccent(subproj.id);
                        const isDropTarget = projectDropTargetId === subproj.id;
                        return (
                          <div
                            key={subproj.id}
                            draggable={true}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('text/plain', `project:${subproj.id}`);
                              event.dataTransfer.setData('application/x-project-id', String(subproj.id));
                              event.dataTransfer.effectAllowed = 'move';
                              draggedProjectIdRef.current = subproj.id;
                              setDraggedProjectId(subproj.id);
                              setActiveProjectMenu(null);

                              const dragGhost = document.createElement('div');
                              dragGhost.style.position = 'absolute';
                              dragGhost.style.top = '-9999px';
                              dragGhost.style.left = '-9999px';
                              dragGhost.style.padding = '6px 12px';
                              dragGhost.style.background = '#0284c7';
                              dragGhost.style.color = '#ffffff';
                              dragGhost.style.fontSize = '12px';
                              dragGhost.style.fontWeight = 'bold';
                              dragGhost.style.borderRadius = '10px';
                              dragGhost.style.boxShadow = '0 4px 14px rgba(0,0,0,0.4)';
                              dragGhost.innerText = `📁 ${subproj.name}`;
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
                            onClick={() => {
                              loadDocumentsByProject(subproj.id);
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              openProjectMenu(subproj, e);
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              event.dataTransfer.dropEffect = 'move';
                              setProjectDropTargetId(subproj.id);
                            }}
                            onDragLeave={(event) => {
                              event.stopPropagation();
                              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                              if (projectDropTargetId === subproj.id) {
                                setProjectDropTargetId(null);
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleDropOnProject(subproj.id, event);
                            }}
                            className={`group relative px-3 py-2 rounded-xl border transition-all flex items-center gap-2.5 cursor-pointer select-none overflow-hidden ${
                              isDropTarget
                                ? 'border-sky-400 bg-sky-500/20 shadow-[0_0_20px_rgba(56,189,248,0.4)] scale-[1.01]'
                                : 'border-white/8 hover:border-white/18 bg-[#16181c]/80 hover:bg-[#1c1f26] shadow-sm hover:shadow-md'
                            }`}
                          >
                            <div 
                              className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 border border-white/10 transition-transform duration-200 group-hover:scale-105 shadow-inner"
                              style={{ 
                                backgroundColor: hexToRgba(accent, 0.16),
                                boxShadow: `0 1px 4px ${hexToRgba(accent, 0.2)}`
                              }}
                            >
                              <Folder size={14} style={{ color: accent }} />
                            </div>

                            <span className="flex-1 truncate text-xs font-semibold text-slate-100 group-hover:text-white transition-colors" title={subproj.name}>
                              {subproj.name}
                            </span>

                            <ChevronRight size={12} className="text-slate-500 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all shrink-0" />
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  currentSubprojects.length > 0 && (
                    <div className="space-y-1">
                      {currentSubprojects.map((subproj) => {
                        const accent = subproj.color || resolveStableAccent(subproj.id);
                        const isDropTarget = projectDropTargetId === subproj.id;
                        return (
                          <div
                            key={subproj.id}
                            draggable={true}
                            onDragStart={(event) => {
                              event.dataTransfer.setData('text/plain', `project:${subproj.id}`);
                              event.dataTransfer.setData('application/x-project-id', String(subproj.id));
                              event.dataTransfer.effectAllowed = 'move';
                              draggedProjectIdRef.current = subproj.id;
                              setDraggedProjectId(subproj.id);
                              setActiveProjectMenu(null);

                              const dragGhost = document.createElement('div');
                              dragGhost.style.position = 'absolute';
                              dragGhost.style.top = '-9999px';
                              dragGhost.style.left = '-9999px';
                              dragGhost.style.padding = '6px 12px';
                              dragGhost.style.background = '#0284c7';
                              dragGhost.style.color = '#ffffff';
                              dragGhost.style.fontSize = '12px';
                              dragGhost.style.fontWeight = 'bold';
                              dragGhost.style.borderRadius = '10px';
                              dragGhost.style.boxShadow = '0 4px 14px rgba(0,0,0,0.4)';
                              dragGhost.innerText = `📁 ${subproj.name}`;
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
                            onClick={() => {
                              loadDocumentsByProject(subproj.id);
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              openProjectMenu(subproj, e);
                            }}
                            onDragOver={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              event.dataTransfer.dropEffect = 'move';
                              setProjectDropTargetId(subproj.id);
                            }}
                            onDragLeave={(event) => {
                              event.stopPropagation();
                              if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                              if (projectDropTargetId === subproj.id) {
                                setProjectDropTargetId(null);
                              }
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              void handleDropOnProject(subproj.id, event);
                            }}
                            className={`group px-3 py-2 rounded-xl border transition-all flex items-center gap-2.5 cursor-pointer select-none ${
                              isDropTarget
                                ? 'border-sky-400 bg-sky-500/20 shadow-[0_0_20px_rgba(56,189,248,0.35)] scale-[1.01]'
                                : 'border-white/6 hover:border-white/15 bg-[#16181c]/70 hover:bg-[#1b1e24]'
                            }`}
                          >
                            <div 
                              className="h-7 w-7 rounded-lg shrink-0 flex items-center justify-center transition-transform group-hover:scale-105 border border-white/5"
                              style={{ backgroundColor: hexToRgba(accent, 0.16) }}
                            >
                              <Folder size={14} style={{ color: accent }} />
                            </div>
                            <span className="flex-1 truncate text-xs font-semibold text-slate-200 group-hover:text-white">{subproj.name}</span>
                            <ChevronRight size={12} className="text-slate-600 group-hover:text-slate-300 transition-colors shrink-0" />
                          </div>
                        );
                      })}
                    </div>
                  )
                )}

                {/* Subtle section divider line between Folders and Files when both exist */}
                {currentSubprojects.length > 0 && sortedDocuments.length > 0 && (
                  <div className="h-px bg-white/6 my-3 w-full shrink-0" />
                )}

                {/* 📄 Render Documents Grid/List */}
                {sortedDocuments.length > 0 ? (
                  <div className={viewMode === 'grid'
                    ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4'
                    : 'space-y-2'
                  }>
                    {sortedDocuments.map((doc, index) => (
                      <DocumentCard
                        key={doc.id}
                        doc={doc}
                        viewMode={viewMode}
                        isSelected={selectedDocumentIds.has(doc.id)}
                        isMultiSelectActive={selectedDocumentIds.size > 0}
                        onOpen={() => handleOpenDocument(doc)}
                        onCardClick={(e) => handleCardClick(doc, index, e)}
                        onCheckboxClick={(e) => handleCheckboxClick(doc, e)}
                        onToggleFavorite={() => void handleToggleFavorite(doc.id)}
                        onDelete={() => void handleDeleteDocument(doc.id)}
                        isMenuOpen={activeDocumentMenuId === doc.id}
                        menuPosition={activeDocumentMenuPosition}
                        documentTags={documentTagsById[doc.id] ?? []}
                        tags={tags}
                        projects={projects}
                        onRequestMenu={(position) => void openDocumentMenu(doc.id, position)}
                        onCloseMenu={() => {
                          setActiveDocumentMenuId(null);
                          setActiveDocumentMenuPosition(null);
                        }}
                        onToggleTag={(tag) => void handleToggleDocumentTag(doc, tag)}
                        onMoveToProject={(projectId) => void handleMoveDocumentToProject(doc, projectId)}
                        onToggleSelect={() => toggleDocumentSelection(doc.id)}
                        onCreateTag={() => openTagDialog(doc.id)}
                        onDragStart={(e) => {
                          const isTargetSelected = selectedDocumentIds.has(doc.id);
                          const ids = isTargetSelected && selectedDocumentIds.size > 0
                            ? Array.from(selectedDocumentIds)
                            : [doc.id];
                          const payload = JSON.stringify(ids);
                          e.dataTransfer.setData('application/x-document-ids', payload);
                          e.dataTransfer.setData('text/plain', payload);
                          e.dataTransfer.effectAllowed = 'move';
                          
                          if (ids.length > 1) {
                            const dragGhost = document.createElement('div');
                            dragGhost.style.position = 'absolute';
                            dragGhost.style.top = '-9999px';
                            dragGhost.style.left = '-9999px';
                            dragGhost.style.padding = '6px 12px';
                            dragGhost.style.background = '#0284c7';
                            dragGhost.style.color = '#ffffff';
                            dragGhost.style.fontSize = '12px';
                            dragGhost.style.fontWeight = 'bold';
                            dragGhost.style.borderRadius = '12px';
                            dragGhost.style.boxShadow = '0 4px 14px rgba(0,0,0,0.4)';
                            dragGhost.style.zIndex = '99999';
                            dragGhost.innerText = `📄 ย้าย ${ids.length} รายการ`;
                            document.body.appendChild(dragGhost);
                            e.dataTransfer.setDragImage(dragGhost, 15, 15);
                            setTimeout(() => {
                              if (document.body.contains(dragGhost)) {
                                document.body.removeChild(dragGhost);
                              }
                            }, 0);
                          }

                          setDraggedDocumentId(doc.id);
                          setDraggedDocumentIds(ids);
                          setActiveDocumentMenuId(null);
                          setActiveDocumentMenuPosition(null);
                          setLibraryMenuPosition(null);
                        }}
                        onDragEnd={() => {
                          setDraggedDocumentId(null);
                          setDraggedDocumentIds([]);
                          setProjectDropTargetId(null);
                        }}
                        isThumbnailHidden={hiddenThumbnails.has(doc.id)}
                        onToggleHideThumbnail={() => toggleHideThumbnail(doc.id)}
                        onOCRAllPages={() => openOcrBackgroundDialog(doc)}
                        onUpdateRating={(rating) => void handleUpdateRating(doc, rating)}
                      />
                    ))}
                  </div>
                ) : (
                  currentSubprojects.length > 0 && (
                    <div
                      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={handleDrop}
                      className="rounded-3xl border-2 border-dashed border-white/8 bg-[#16181c]/40 p-8 flex flex-col items-center justify-center text-center mt-3 backdrop-blur-xl select-none group hover:border-white/15 transition-all"
                    >
                      <div className="h-12 w-12 rounded-2xl bg-white/[0.04] border border-white/8 flex items-center justify-center text-slate-400 mb-3 group-hover:scale-105 transition-transform">
                        <FolderPlus size={22} className="text-sky-400/80" />
                      </div>
                      <h4 className="text-sm font-semibold text-slate-200 mb-1">
                        โฟลเดอร์นี้ยังไม่มีเอกสาร
                      </h4>
                      <p className="text-xs text-slate-400 max-w-sm mb-4">
                        ลากไฟล์มาวางที่นี่เพื่อเพิ่มไฟล์เข้าโฟลเดอร์นี้ หรือเลือกนำเข้าไฟล์ใหม่
                      </p>
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={handleBrowse}
                          className="px-4 py-2 rounded-xl bg-[#23272e] hover:bg-[#2b3038] text-white border border-white/10 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 shadow-sm"
                        >
                          <Upload size={13} />
                          <span>Import Files</span>
                        </button>
                        <button
                          onClick={() => openProjectDialog(null, selectedProjectId)}
                          className="px-4 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 hover:text-white border border-white/8 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          <FolderPlus size={13} className="text-sky-400" />
                          <span>+ Subfolder</span>
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : selectedProjectId !== null ? (
              // Dedicated Empty State when inside a Folder with no subfolders and no documents
              <div className="h-full flex items-center justify-center p-4">
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`w-full max-w-lg rounded-3xl border-2 border-dashed flex flex-col items-center justify-center p-10 transition-all duration-300 backdrop-blur-xl text-center ${
                    isDragging
                      ? 'border-sky-400 bg-sky-500/10 scale-[1.015] shadow-[0_24px_60px_rgba(56,189,248,0.2)]'
                      : 'border-white/10 bg-[#17191d]/75 hover:border-white/16'
                  }`}
                >
                  <div 
                    className="p-5 rounded-2xl border border-white/10 mb-4 shadow-xl"
                    style={{ 
                      backgroundColor: hexToRgba(projects.find(p => p.id === selectedProjectId)?.color || '#38BDF8', 0.14) 
                    }}
                  >
                    <Folder size={40} style={{ color: projects.find(p => p.id === selectedProjectId)?.color || '#38BDF8' }} />
                  </div>
                  <h3 className="text-lg font-bold text-slate-100 mb-1.5">
                    {projects.find(p => p.id === selectedProjectId)?.name || 'Folder'}
                  </h3>
                  <p className="text-slate-400 mb-6 text-xs max-w-xs">
                    โฟลเดอร์นี้ว่างอยู่ ลากไฟล์ PDF หรือรูปภาพมาวางที่นี่ หรือสร้างโฟลเดอร์ย่อย
                  </p>

                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleBrowse}
                      className="px-5 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white rounded-xl font-bold cursor-pointer transition-all text-xs shadow-lg flex items-center gap-2"
                    >
                      <Upload size={14} />
                      Browse / Import
                    </button>
                    <button
                      onClick={() => openProjectDialog(null, selectedProjectId)}
                      className="px-4 py-2.5 bg-white/[0.06] hover:bg-white/[0.1] text-slate-200 hover:text-white rounded-xl font-semibold cursor-pointer transition-all border border-white/10 text-xs flex items-center gap-1.5"
                    >
                      <FolderPlus size={14} className="text-sky-400" />
                      Create Subfolder
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              // Empty State / Upload Area with Recent Files for Root Library
              <div className="h-full flex flex-col">
                {/* Recent Files Section */}
                {documents.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                      <Clock size={14} className="text-slate-300" />
                      Recent Files
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {documents.slice(0, 5).map(doc => {
                        const isHidden = hiddenThumbnails.has(doc.id);
                        return (
                          <div
                            key={doc.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleOpenDocument(doc)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleOpenDocument(doc); }}
                            className="flex items-center gap-3 p-3 rounded-xl bg-[#17191d]/78 border border-white/8 hover:border-white/12 hover:bg-[#1d2025] transition-all text-left group backdrop-blur-xl relative cursor-pointer select-none"
                          >
                            <div className="h-14 w-10 overflow-hidden rounded-lg bg-[#111214]/90 border border-white/5 group-hover:border-white/10 flex items-center justify-center shrink-0 relative">
                              {isHidden ? (
                                <div className="h-full w-full bg-[#f8fafc] border border-slate-200 shadow-inner flex items-center justify-center relative overflow-hidden">
                                  <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:6px_6px] opacity-25" />
                                  <FileText size={14} className="text-slate-300 relative z-10" />
                                </div>
                              ) : doc.thumbnail_path ? (
                                <img src={doc.thumbnail_path} alt={doc.filename} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  {getFileIcon(doc.file_type)}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-100 truncate">{doc.filename}</p>
                              <p className="text-[10px] text-slate-400">{formatDate(doc.last_accessed)}</p>
                            </div>
                            
                            {/* Toggle Button for Privacy on hover */}
                            <button 
                              onClick={(e) => { 
                                e.stopPropagation(); 
                                toggleHideThumbnail(doc.id); 
                              }}
                              className={`absolute top-2 right-2 p-1 rounded-md transition-all z-10 ${
                                isHidden 
                                  ? 'bg-[#839958] text-white border border-[#839958]' 
                                  : 'bg-[#111214]/90 text-slate-500 border border-white/5 opacity-0 group-hover:opacity-100 hover:text-slate-200'
                              }`}
                              title={isHidden ? 'แสดงรูปภาพตัวอย่าง' : 'ซ่อนรูปภาพตัวอย่าง'}
                            >
                              {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
                            </button>
                          </div>
                        );
                      })}
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
                        ? 'border-white/20 bg-white/[0.04] scale-[1.015] shadow-[0_24px_60px_rgba(0,0,0,0.22)]'
                        : 'border-white/12 bg-[#17191d]/68 hover:border-white/16'
                    }`}
                  >
                    <div className="p-5 rounded-full bg-slate-900/85 border border-white/10 mb-5 shadow-2xl">
                      <Upload size={40} className="text-slate-200" />
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
                      className="px-6 py-2.5 bg-[#262a30] hover:bg-[#2d3138] text-white rounded-xl font-bold cursor-pointer transition-all border border-white/10 text-sm"
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
        <div className="w-72 bg-[#1b1d22]/96 border-l border-white/6 p-5 flex flex-col overflow-y-auto backdrop-blur-xl custom-scrollbar titlebar-no-drag">
          <div className="flex items-center justify-between mb-3 titlebar-drag select-none pr-36">
            <h2 className="text-base font-bold flex items-center gap-1">
              Import
            </h2>
          </div>

          {/* Quick Upload */}
          <div
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`p-4 rounded-xl border-2 border-dashed mb-4 text-center transition-all titlebar-no-drag ${
              isDragging ? 'border-white/18 bg-white/[0.04]' : 'border-white/10 hover:border-white/16 bg-[#13151a]/92'
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

          {/* Profile Selection */}
          <div className="mb-6">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-3 block">Profile</label>
            <div className="relative">
              {(() => {
                const profiles = [
                  { id: 'adaptive', name: 'Flexibility', icon: Compass, activeBg: 'linear-gradient(180deg, rgba(20,184,166,0.22) 0%, rgba(19,48,58,0.92) 100%)', textTheme: 'text-[#E6FFF9]', iconTheme: 'text-[#99F6E4]' },
                  { id: 'manga', name: 'Manga Style', icon: Sparkles, activeBg: 'linear-gradient(180deg, rgba(139,92,246,0.28) 0%, rgba(46,28,82,0.92) 100%)', textTheme: 'text-[#F4E8FF]', iconTheme: 'text-[#D8B4FE]' },
                  { id: 'manhwa', name: 'Manhwa Style', icon: Flame, activeBg: 'linear-gradient(180deg, rgba(236,72,153,0.24) 0%, rgba(66,24,44,0.92) 100%)', textTheme: 'text-[#FFE7F3]', iconTheme: 'text-[#F9A8D4]' },
                  { id: 'official', name: 'Official Doc', icon: ScrollText, activeBg: 'linear-gradient(180deg, rgba(67,135,255,0.2) 0%, rgba(17,28,48,0.9) 100%)', textTheme: 'text-[#EDF4FF]', iconTheme: 'text-[#A8CFFF]' }
                ];
                const activeProfile = profiles.find(p => p.id === translationMode) || profiles[0];
                const ActiveIcon = activeProfile.icon;

                return (
                  <div className="relative space-y-1">
                    {/* Main Active Button */}
                    <button
                      onClick={() => setIsProfileListOpen(!isProfileListOpen)}
                      className={`w-full p-3 rounded-xl border text-left transition-all flex items-center justify-between ${
                        isProfileListOpen 
                          ? 'border-[#2B9BFF]/60 bg-slate-900/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]' 
                          : activeProfile.id === 'adaptive' ? 'border-[#14B8A6]/45' 
                          : activeProfile.id === 'manga' ? 'border-[#8B5CF6]/45'
                          : activeProfile.id === 'manhwa' ? 'border-[#EC4899]/45'
                          : 'border-[#4387FF]/42'
                      }`}
                      style={!isProfileListOpen ? { background: activeProfile.activeBg } : undefined}
                    >
                      <div className="flex items-center gap-2">
                        <ActiveIcon size={14} className={activeProfile.iconTheme} />
                        <span className={`font-semibold text-sm ${activeProfile.textTheme}`}>{activeProfile.name}</span>
                      </div>
                      <ChevronRight 
                        size={14} 
                        className={`text-slate-400 transition-transform duration-200 ${isProfileListOpen ? 'rotate-90 text-white' : ''}`} 
                      />
                    </button>

                    {/* Expanded Dropdown List */}
                    {isProfileListOpen && (
                      <div className="absolute left-0 right-0 mt-1 z-[160] rounded-xl border border-white/10 bg-slate-950/98 p-1 shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl flex flex-col gap-0.5 max-h-56 overflow-y-auto">
                        {profiles.map((prof) => {
                          const isSelected = prof.id === translationMode;
                          const Icon = prof.icon;
                          return (
                            <button
                              key={prof.id}
                              onClick={() => {
                                setTranslationMode(prof.id as any);
                                setIsProfileListOpen(false);
                              }}
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-xs transition-all ${
                                isSelected
                                  ? 'bg-white/10 text-white font-medium'
                                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <Icon size={13} className={isSelected ? prof.iconTheme : 'text-slate-500'} />
                                <span className={isSelected ? 'font-semibold' : ''}>{prof.name}</span>
                              </div>
                              {isSelected && <Check size={12} className="text-[#5CC6F2]" />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Safety Settings (Collapsed by default) */}
          <details className="mb-1">
            <summary className="text-xs font-bold text-slate-500 uppercase tracking-[0.22em] mb-0 cursor-pointer flex items-center gap-2">
              <Shield size={12} /> Safety Filters
            </summary>
            <div className="space-y-4 mt-3">
              {Object.entries(safetySettings).map(([key, value]) => (
                <div key={key}>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs capitalize text-slate-300">{key}</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-slate-900/85 border border-white/10 rounded text-slate-400 uppercase">{value}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mb-1.5 leading-relaxed">
                    {SAFETY_LEVEL_PREVIEW[key as keyof SafetySettings][value as 'off' | 'low' | 'medium' | 'high']}
                  </p>
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

          {/* Background Queue Monitor */}
          <BackgroundQueueMonitor
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

          <div className="mt-auto" />
        </div>

        {libraryMenuPosition && createPortal(
          <div
            data-library-floating-menu="true"
            className="fixed z-[160] w-56 rounded-2xl border border-white/15 bg-slate-950/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl"
            style={{ left: libraryMenuPosition.x, top: libraryMenuPosition.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <button
              onClick={() => openProjectDialog()}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-white/10"
            >
              <FolderPlus size={14} />
              New Folder
            </button>
            <button
              onClick={() => openTagDialog()}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-white/10"
            >
              <Tag size={14} />
              New Tag
            </button>
            <button
              onClick={() => {
                loadRecentDocuments();
                setLibraryMenuPosition(null);
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-slate-200 transition-colors hover:bg-white/10"
            >
              <RefreshCw size={14} />
              Refresh Library
            </button>
          </div>,
          document.body
        )}


        {activeProjectMenu && (
          <ProjectContextMenu
            project={activeProjectMenu.project}
            position={activeProjectMenu.position}
            onClose={() => setActiveProjectMenu(null)}
            onShowInfo={() => setFolderInfoProject(activeProjectMenu.project)}
            onDelete={() => {
              setDeleteProjectDialog({
                isOpen: true,
                project: activeProjectMenu.project,
                confirmation: ''
              });
            }}
            onEdit={() => {
              setEditProjectDialog({
                isOpen: true,
                project: activeProjectMenu.project,
                name: activeProjectMenu.project.name,
                color: activeProjectMenu.project.color || resolveStableAccent(activeProjectMenu.project.id)
              });
            }}
            onCreateSubfolder={() => {
              openProjectDialog(null, activeProjectMenu.project.id);
            }}
          />
        )}

        {folderInfoProject && (
          <FolderInfoModal
            project={folderInfoProject}
            onClose={() => setFolderInfoProject(null)}
          />
        )}

        {activeTagMenu && (
          <TagContextMenu
            tag={activeTagMenu.tag}
            position={activeTagMenu.position}
            onClose={() => setActiveTagMenu(null)}
            onEdit={() => {
              setEditTagDialog({
                isOpen: true,
                tag: activeTagMenu.tag,
                name: activeTagMenu.tag.name,
                color: activeTagMenu.tag.color || '#8B5CF6'
              });
            }}
            onDelete={() => {
              setDeleteTagDialog({
                isOpen: true,
                tag: activeTagMenu.tag,
                confirmation: ''
              });
            }}
          />
        )}

        {editTagDialog.isOpen && editTagDialog.tag && (
          <EditTagModal
            isOpen={editTagDialog.isOpen}
            tag={editTagDialog.tag}
            name={editTagDialog.name}
            color={editTagDialog.color}
            onChangeName={(name) => setEditTagDialog((prev) => ({ ...prev, name }))}
            onChangeColor={(color) => setEditTagDialog((prev) => ({ ...prev, color }))}
            onSave={handleEditTag}
            onClose={() => setEditTagDialog({ isOpen: false, tag: null, name: '', color: '' })}
          />
        )}

        {isSortMenuOpen && sortMenuPosition && (
          <SortContextMenu
            position={sortMenuPosition}
            sortBy={sortBy}
            sortOrder={sortOrder}
            ratingFilterMode={ratingFilterMode}
            ratingFilterOnly={ratingFilterOnly}
            ratingFilterMin={ratingFilterMin}
            ratingFilterMax={ratingFilterMax}
            activeFilterTag={activeFilterTag}
            tags={tags}
            onSelectFilterTag={setActiveFilterTag}
            onUpdateFilters={(updates) => {
              if (updates.mode !== undefined) setRatingFilterMode(updates.mode);
              if (updates.only !== undefined) setRatingFilterOnly(updates.only);
              if (updates.min !== undefined) setRatingFilterMin(updates.min);
              if (updates.max !== undefined) setRatingFilterMax(updates.max);
            }}
            onSelect={(key, order) => {
              setSortBy(key);
              setSortOrder(order);
            }}
            onClose={() => {
              setIsSortMenuOpen(false);
              setSortMenuPosition(null);
            }}
          />
        )}

        {ocrBackgroundDialog.isOpen && ocrBackgroundDialog.doc && (
          <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/65 backdrop-blur-md">
            <div className="w-full max-w-md rounded-3xl border border-white/12 bg-[#0e1116]/96 p-6 shadow-[0_32px_96px_rgba(0,0,0,0.6)] text-left flex flex-col gap-4">
              <div>
                <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                  <Cpu className="text-cyan-400" size={18} />
                  ประมวลผลทุกหน้าเบื้องหลัง
                </h3>
                <div className="mt-2 flex flex-col gap-1 bg-white/[0.03] border border-white/5 p-2.5 rounded-2xl">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">ชื่อไฟล์:</span>
                  <span className="text-xs font-semibold text-slate-300 truncate font-mono">{ocrBackgroundDialog.doc.filename}</span>
                  {dialogCachePages !== null && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-[10px] font-semibold text-emerald-400">
                        แปล/ทำ OCR ไปแล้ว {dialogCachePages} จาก {ocrBackgroundDialog.doc.total_pages} หน้า ({Math.round((dialogCachePages / ocrBackgroundDialog.doc.total_pages) * 100)}%)
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* OCR Engine selection */}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Model Engine</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOcrBackgroundDialog(prev => ({ ...prev, model: 'paddleocr' }))}
                    className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs ${
                      ocrBackgroundDialog.model === 'paddleocr'
                        ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200 shadow-[0_0_15px_rgba(6,182,212,0.15)] font-semibold'
                        : 'border-white/5 bg-slate-900/40 text-slate-500 hover:border-white/10 hover:text-slate-300'
                    }`}
                  >
                    <span className="font-semibold">PaddleOCR</span>
                    <span className="text-[8px] opacity-75 mt-0.5">แนะนำสำหรับมังงะ/รูปภาพ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOcrBackgroundDialog(prev => ({ ...prev, model: 'easyocr' }))}
                    className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs ${
                      ocrBackgroundDialog.model === 'easyocr'
                        ? 'border-violet-500/50 bg-violet-500/10 text-violet-200 shadow-[0_0_15px_rgba(139,92,246,0.15)] font-semibold'
                        : 'border-white/5 bg-slate-900/40 text-slate-500 hover:border-white/10 hover:text-slate-300'
                    }`}
                  >
                    <span className="font-semibold">EasyOCR</span>
                    <span className="text-[8px] opacity-75 mt-0.5">ทางเลือก (เอกสารทั่วไป)</span>
                  </button>
                </div>
              </div>

              {/* Profile Selection */}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">รูปแบบการทำงาน</label>
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition-all ${
                    ocrBackgroundDialog.profile === 'offline_all'
                      ? 'border-sky-500/50 bg-sky-500/10 text-slate-100 shadow-[0_0_15px_rgba(14,165,233,0.12)]'
                      : 'border-white/5 bg-slate-900/30 text-slate-500 hover:border-white/10 hover:bg-slate-900/50'
                  }`}>
                    <input
                      type="radio"
                      name="background_ocr_profile"
                      checked={ocrBackgroundDialog.profile === 'offline_all'}
                      onChange={() => setOcrBackgroundDialog(prev => ({ ...prev, profile: 'offline_all' }))}
                      className="mt-0.5 accent-sky-400"
                    />
                    <div className="text-xs flex-1">
                      <div className={`font-semibold ${ocrBackgroundDialog.profile === 'offline_all' ? 'text-sky-300' : 'text-slate-300'}`}>Offline Translate All</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">รัน OCR พร้อมแปลเนื้อหาเป้าหมายลงฐานข้อมูล</div>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 rounded-2xl border p-3 cursor-pointer transition-all ${
                    ocrBackgroundDialog.profile === 'ocr_all'
                      ? 'border-indigo-500/50 bg-indigo-500/10 text-slate-100 shadow-[0_0_15px_rgba(99,102,241,0.12)]'
                      : 'border-white/5 bg-slate-900/30 text-slate-500 hover:border-white/10 hover:bg-slate-900/50'
                  }`}>
                    <input
                      type="radio"
                      name="background_ocr_profile"
                      checked={ocrBackgroundDialog.profile === 'ocr_all'}
                      onChange={() => setOcrBackgroundDialog(prev => ({ ...prev, profile: 'ocr_all' }))}
                      className="mt-0.5 accent-indigo-400"
                    />
                    <div className="text-xs">
                      <div className={`font-semibold ${ocrBackgroundDialog.profile === 'ocr_all' ? 'text-indigo-300' : 'text-slate-300'}`}>OCR All Pages Only</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">ค้นหาพิกัดและแกะข้อความเก็บไว้โดยยังไม่แปลภาษา</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Processing Quality (Fast vs High) */}
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-2">Processing Quality</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOcrBackgroundDialog(prev => ({ ...prev, ocrQualityProfile: 'fast' }))}
                    className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs gap-1.5 ${
                      ocrBackgroundDialog.ocrQualityProfile === 'fast'
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-200 shadow-[0_0_15px_rgba(245,158,11,0.15)] font-semibold'
                        : 'border-white/5 bg-slate-900/40 text-slate-500 hover:border-white/10 hover:text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Zap size={13} className={ocrBackgroundDialog.ocrQualityProfile === 'fast' ? 'text-amber-400 animate-pulse' : 'text-slate-400'} />
                      Fast (เน้นความเร็ว)
                    </span>
                   
                  </button>
                  <button
                    type="button"
                    onClick={() => setOcrBackgroundDialog(prev => ({ ...prev, ocrQualityProfile: 'best' }))}
                    className={`flex flex-col items-center justify-center rounded-2xl border p-3 transition-all text-xs gap-1.5 ${
                      ocrBackgroundDialog.ocrQualityProfile === 'best'
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.15)] font-semibold'
                        : 'border-white/5 bg-slate-900/40 text-slate-500 hover:border-white/10 hover:text-slate-300'
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Award size={13} className={ocrBackgroundDialog.ocrQualityProfile === 'best' ? 'text-emerald-400 animate-pulse' : 'text-slate-400'} />
                      High (ความแม่นยำสูง)
                    </span>
                   
                  </button>
                </div>
              </div>

              {/* Languages Row */}
              <div className="grid grid-cols-2 gap-3">
                {/* Source Language */}
                <div>
                  <label htmlFor="ocr-bg-lang-select" className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-cyan-400" />
                    ภาษาต้นทาง 
                  </label>
                  <select
                    id="ocr-bg-lang-select"
                    value={ocrBackgroundDialog.ocrLanguage}
                    onChange={(e) => setOcrBackgroundDialog(prev => ({ ...prev, ocrLanguage: e.target.value }))}
                    className="w-full rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-100 outline-none transition-colors focus:border-cyan-400/50 cursor-pointer"
                  >
                    <option value="eng">🇬🇧 EN (English)</option>
                    <option value="tha">🇹🇭 TH (Thai)</option>
                    <option value="jpn">🇯🇵 JA (Japanese)</option>
                    <option value="jpn_vert">🇯🇵 JA-V (Japanese Vert)</option>
                    <option value="kor">🇰🇷 KO (Korean)</option>
                    <option value="chi_sim">🇨🇳 ZH-S (Chinese Simp)</option>
                    <option value="chi_tra">🇨🇳 ZH-T (Chinese Trad)</option>
                    <option value="vie">🇻🇳 VI (Vietnamese)</option>
                    <option value="deu">🇩🇪 DE (German)</option>
                    <option value="fra">🇫🇷 FR (French)</option>
                    <option value="spa">🇪🇸 ES (Spanish)</option>
                    <option value="rus">🇷🇺 RU (Russian)</option>
                  </select>
                </div>

                {/* Target Language */}
                <div>
                  <label htmlFor="ocr-bg-target-lang-select" className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    ภาษาปลายทาง
                  </label>
                  <select
                    id="ocr-bg-target-lang-select"
                    value={ocrBackgroundDialog.targetLanguage}
                    disabled={ocrBackgroundDialog.profile !== 'offline_all'}
                    onChange={(e) => setOcrBackgroundDialog(prev => ({ ...prev, targetLanguage: e.target.value }))}
                    className={`w-full rounded-2xl border border-white/10 bg-slate-900/60 px-3 py-2 text-xs text-slate-100 outline-none transition-colors focus:border-emerald-500/50 cursor-pointer ${
                      ocrBackgroundDialog.profile !== 'offline_all' ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                  >
                    <option value="th">🇹🇭 TH (Thai)</option>
                    <option value="en">🇬🇧 EN (English)</option>
                    <option value="ja">🇯🇵 JA (Japanese)</option>
                    <option value="ko">🇰🇷 KO (Korean)</option>
                    <option value="zh">🇨🇳 ZH (Chinese)</option>
                  </select>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 border-t border-white/5 pt-4">
                <button
                  type="button"
                  onClick={() => setOcrBackgroundDialog({ isOpen: false, doc: null, model: 'paddleocr', profile: 'offline_all', ocrLanguage: 'eng', ocrQualityProfile: 'best', targetLanguage: 'th' })}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-xs text-slate-300 transition-colors hover:bg-white/10"
                >
                  ยกเลิก (Cancel)
                </button>
                <button
                  type="button"
                  onClick={handleStartOcrBackground}
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-5 py-2.5 text-xs font-semibold text-white shadow-[0_8px_20px_rgba(16,185,129,0.3)] transition-all active:scale-[0.98]"
                >
                  เริ่มประมวลผล (Start)
                </button>
              </div>
            </div>
          </div>
        )}

        {projectDialog.isOpen && (
          <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] text-left flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2.5">
                  <div 
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-inner border border-white/10"
                    style={{ backgroundColor: hexToRgba(projectDialog.color || '#38BDF8', 0.2) }}
                  >
                    <Folder size={16} style={{ color: projectDialog.color || '#38BDF8' }} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-100">
                      {projectDialog.parentId ? 'สร้างโฟลเดอร์ย่อย (Create Subfolder)' : 'สร้างโฟลเดอร์ใหม่ (Create Folder)'}
                    </h3>
                    <p className="text-xs text-slate-400">สำหรับจัดหมวดหมู่เอกสารในคลัง</p>
                  </div>
                </div>
                <button 
                  onClick={() => setProjectDialog({ isOpen: false, name: '', documentId: null, color: '' })}
                  className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                  ชื่อโฟลเดอร์ (Folder Name)
                </label>
                <input
                  autoFocus
                  type="text"
                  value={projectDialog.name}
                  onChange={(e) => setProjectDialog((current) => ({ ...current, name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handleCreateProject();
                    }
                  }}
                  placeholder="Folder name"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2.5 text-sm text-slate-100 outline-none transition-colors focus:border-sky-400/60"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  เลือกสีไอคอนโฟลเดอร์ (Folder Color)
                </label>
                <div className="grid grid-cols-6 gap-2">
                  {FOLDER_PALETTE_COLORS.map((c) => {
                    const isSelected = (projectDialog.color || '').toUpperCase() === c.toUpperCase();
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setProjectDialog((current) => ({ ...current, color: c }))}
                        className="h-8 w-8 rounded-full border border-white/10 transition-all flex items-center justify-center hover:scale-110 active:scale-95 shadow-sm"
                        style={{ 
                          backgroundColor: c,
                          boxShadow: isSelected ? `0 0 0 2px rgb(15, 23, 42), 0 0 0 4px ${c}` : 'none'
                        }}
                        title={c}
                      >
                        {isSelected && <Check size={13} className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-3">
                <button
                  onClick={() => setProjectDialog({ isOpen: false, name: '', documentId: null, color: '' })}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleCreateProject()}
                  disabled={!projectDialog.name.trim()}
                  className="rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(14,165,233,0.35)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Create (สร้าง)
                </button>
              </div>
            </div>
          </div>
        )}

        {editProjectDialog.isOpen && editProjectDialog.project && (
          <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] text-left flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2.5">
                  <div 
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-sm shadow-inner border border-white/10"
                    style={{ backgroundColor: hexToRgba(editProjectDialog.color || '#38BDF8', 0.2) }}
                  >
                    <Folder size={16} style={{ color: editProjectDialog.color || '#38BDF8' }} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                      <Edit3 size={15} className="text-sky-400" />
                      แก้ไขโฟลเดอร์ (Edit Folder)
                    </h3>
                    <p className="text-xs text-slate-400">เปลี่ยนชื่อหรือเลือกสีไอคอนสำหรับโฟลเดอร์นี้</p>
                  </div>
                </div>
                <button 
                  onClick={() => setEditProjectDialog({ isOpen: false, project: null, name: '', color: '' })}
                  className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1.5">
                  ชื่อโฟลเดอร์ (Folder Name)
                </label>
                <input
                  autoFocus
                  type="text"
                  value={editProjectDialog.name}
                  onChange={(e) => setEditProjectDialog((current) => ({ ...current, name: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      void handleEditProject();
                    }
                  }}
                  placeholder="Folder name"
                  className="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-2.5 text-sm text-slate-100 outline-none transition-colors focus:border-sky-400/60"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  เลือกสีไอคอนโฟลเดอร์ (Folder Color)
                </label>
                <div className="grid grid-cols-6 gap-2">
                  {FOLDER_PALETTE_COLORS.map((c) => {
                    const isSelected = (editProjectDialog.color || '').toUpperCase() === c.toUpperCase();
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setEditProjectDialog((current) => ({ ...current, color: c }))}
                        className="h-8 w-8 rounded-full border border-white/10 transition-all flex items-center justify-center hover:scale-110 active:scale-95 shadow-sm"
                        style={{ 
                          backgroundColor: c,
                          boxShadow: isSelected ? `0 0 0 2px rgb(15, 23, 42), 0 0 0 4px ${c}` : 'none'
                        }}
                        title={c}
                      >
                        {isSelected && <Check size={13} className="text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-3">
                <button
                  onClick={() => setEditProjectDialog({ isOpen: false, project: null, name: '', color: '' })}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleEditProject()}
                  disabled={!editProjectDialog.name.trim()}
                  className="rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(14,165,233,0.35)] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save (บันทึก)
                </button>
              </div>
            </div>
          </div>
        )}

        {tagDialog.isOpen && (
          <div className="absolute inset-0 z-[170] flex items-center justify-center bg-black/55 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <h3 className="text-lg font-semibold text-slate-100">Create Tag</h3>
              <p className="mt-1 text-sm text-slate-400">
                Add a reusable tag and optionally assign it to the selected document.
              </p>
              <input
                autoFocus
                type="text"
                value={tagDialog.name}
                onChange={(e) => setTagDialog((current) => ({ ...current, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleCreateTag();
                  }
                }}
                placeholder="Tag name"
                className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-[#FF8705]/60"
              />
              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  onClick={() => setTagDialog({ isOpen: false, name: '', documentId: null })}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleCreateTag()}
                  className="rounded-xl bg-gradient-to-r from-[#FF8705] to-[#FF7E67] px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(255,135,5,0.35)]"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteTagDialog.isOpen && deleteTagDialog.tag && (
          <div className="absolute inset-0 z-[175] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-3xl border border-red-400/25 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl bg-red-500/12 p-2 text-red-300">
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">Delete Tag</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    This removes the tag label from documents, but does not delete documents, OCR cache, or translated content.
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/55 p-4">
                <div className="flex items-center gap-2 text-sm text-slate-200">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: deleteTagDialog.tag.color || '#FF8705' }}
                  />
                  <span className="font-medium">{deleteTagDialog.tag.name}</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Type <span className="font-semibold text-slate-200">{deleteTagDialog.tag.name}</span> to confirm deletion.
                </p>
              </div>

              <input
                autoFocus
                type="text"
                value={deleteTagDialog.confirmation}
                onChange={(e) => setDeleteTagDialog((current) => ({ ...current, confirmation: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleDeleteTag();
                  }
                }}
                placeholder={deleteTagDialog.tag.name}
                className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-red-400/60"
              />

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  onClick={() => setDeleteTagDialog({ isOpen: false, tag: null, confirmation: '' })}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDeleteTag()}
                  disabled={deleteTagDialog.confirmation.trim() !== deleteTagDialog.tag.name}
                  className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(239,68,68,0.28)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Delete Tag
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteProjectDialog.isOpen && deleteProjectDialog.project && (
          <div className="absolute inset-0 z-[175] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-3xl border border-red-400/25 bg-slate-950/95 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl bg-red-500/12 p-2 text-red-300">
                  <Trash2 size={18} />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">Delete Project Folder</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    This removes the project folder. Documents in this project will not be deleted, but will be moved out of the project folder.
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-slate-900/55 p-4">
                <div className="flex items-center gap-2 text-sm text-slate-200">
                  <Folder
                    size={16}
                    style={{ color: resolveStableAccent(deleteProjectDialog.project.id) }}
                  />
                  <span className="font-medium">{deleteProjectDialog.project.name}</span>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Type <span className="font-semibold text-slate-200">{deleteProjectDialog.project.name}</span> to confirm deletion.
                </p>
              </div>

              <input
                autoFocus
                type="text"
                value={deleteProjectDialog.confirmation}
                onChange={(e) => setDeleteProjectDialog((current) => ({ ...current, confirmation: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleDeleteProject();
                  }
                }}
                placeholder={deleteProjectDialog.project.name}
                className="mt-5 w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-100 outline-none transition-colors focus:border-red-400/60"
              />

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  onClick={() => setDeleteProjectDialog({ isOpen: false, project: null, confirmation: '' })}
                  className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleDeleteProject()}
                  disabled={deleteProjectDialog.confirmation.trim() !== deleteProjectDialog.project.name}
                  className="rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(239,68,68,0.28)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Delete Folder
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Import Progress Dialog */}
        {importProgress !== null && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-md">
            <div className="w-96 rounded-3xl border border-white/10 bg-slate-900/90 p-6 shadow-[0_30px_70px_rgba(0,0,0,0.6)] backdrop-blur-2xl flex flex-col items-center text-center gap-4">
              <div className="relative flex items-center justify-center">
                <div className="h-12 w-12 rounded-full border-2 border-white/5 border-t-[#2B9BFF] animate-spin"></div>
                <div className="absolute h-8 w-8 rounded-full border-2 border-white/5 border-b-[#839958] animate-spin [animation-direction:reverse]"></div>
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-100 mb-1">กำลังนำเข้าไฟล์...</h3>
                <p className="text-xs text-slate-400">
                  กำลังประมวลผลไฟล์ที่ {importProgress.current} จาก {importProgress.total} ไฟล์
                </p>
              </div>
              <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                <div 
                  className="bg-gradient-to-r from-[#2B9BFF] to-[#839958] h-full transition-all duration-300"
                  style={{ width: `${(importProgress.current / importProgress.total) * 100}%` }}
                />
              </div>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
          onChange={handleFileSelect}
        />
      </div>
    </div>
  );
};
