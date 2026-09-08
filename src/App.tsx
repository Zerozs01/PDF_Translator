import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UploadScreen } from './components/Home/UploadScreen';
import { OCRRegressionHarness } from './components/OCR/OCRRegressionHarness';
import { useUIStore } from './stores/useUIStore';
import { GlobalLoadingOverlay } from './components/UI/GlobalLoadingOverlay';
import { useProjectStore, type TranslationMode } from './stores/useProjectStore';
import { useOCRTextLayerStore } from './stores/useOCRTextLayerStore';
import { ExportOverlay } from './components/Export/ExportOverlay';
import { useBackgroundQueueStore } from './stores/useBackgroundQueueStore';
import { useLayerStore } from './stores/useLayerStore';
import { visionService } from './services/vision/VisionService';
import { dbService } from './services/dbService';
import type { OCREngine, OCRQualityProfile } from './types';
import { useExportOrchestration } from './hooks/useExportOrchestration';
import { useDocumentTranslation } from './hooks/useDocumentTranslation';
import { useBackgroundQueueSync } from './hooks/useBackgroundQueueSync';

// Lazy Load Heavy Components
const RightSidebar = React.lazy(() => import('./components/Layout/RightSidebar').then(module => ({ default: module.RightSidebar })));
const CompactTopToolbar = React.lazy(() => import('./components/Layout/CompactTopToolbar').then(module => ({ default: module.CompactTopToolbar })));
const LeftSidebar = React.lazy(() => import('./components/Layout/LeftSidebar').then(module => ({ default: module.LeftSidebar })));
import { useTranslationLoadingState } from './hooks/useTranslationLoadingState';
import { useDownloadMenuState } from './hooks/useDownloadMenuState';
import { useExportCacheHydration } from './hooks/useExportCacheHydration';
import { useExportOcrResolvers } from './hooks/useExportOcrResolvers';
import { useDocumentExportModalState } from './hooks/useDocumentExportModalState';
import { type DownloadScope } from './constants/translationConstants';
import { WorkspaceContainer } from './components/Viewer/WorkspaceContainer';
import { AppHeaderToolbar } from './components/Layout/AppHeaderToolbar';
import { BackgroundQueuePanel } from './components/Queue/BackgroundQueuePanel';
import { DocumentExportModal } from './components/Export/DocumentExportModal';

export default function App() {
  const showOCRHarness = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('ocr_harness') === '1';
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const loadingState = useUIStore((s) => s.loadingState);
  const setLoadingState = useUIStore((s) => s.setLoadingState);
  const splitViewMode = useUIStore((s) => s.viewMode);
  const setSplitViewMode = useUIStore((s) => s.setViewMode);
  const ocrOptions = useOCRTextLayerStore((state) => state.options);
  const ocrLanguage = ocrOptions.language;
  const setTranslationCacheEntry = useOCRTextLayerStore((state) => state.setTranslationCacheEntry);
  const isOCRProcessing = useOCRTextLayerStore((state) => state.isProcessing);
  const setProgress = useOCRTextLayerStore((state) => state.setProgress);
  const setOcrOptions = useOCRTextLayerStore((state) => state.setOptions);

  const file = useProjectStore((s) => s.file);
  const fileName = useProjectStore((s) => s.fileName);
  const filePath = useProjectStore((s) => s.filePath);
  const documentId = useProjectStore((s) => s.documentId);
  const fileType = useProjectStore((s) => s.fileType);
  const fileData = useProjectStore((s) => s.fileData);
  const currentPage = useProjectStore((s) => s.currentPage);
  const totalPages = useProjectStore((s) => s.totalPages);
  const ensureDocumentId = useProjectStore((s) => s.ensureDocumentId);
  const setPage = useProjectStore((s) => s.setPage);
  const closeProject = useProjectStore((s) => s.closeProject);
  const viewMode = useProjectStore((s) => s.viewMode);
  const setViewMode = useProjectStore((s) => s.setViewMode);
  const sourceLanguage = useProjectStore((s) => s.sourceLanguage);
  const targetLanguage = useProjectStore((s) => s.targetLanguage);
  const setTargetLanguage = useProjectStore((s) => s.setTargetLanguage);
  const translationMode = useProjectStore((s) => s.translationMode);
  const setTranslationMode = useProjectStore((s) => s.setTranslationMode);
  const safetySettings = useProjectStore((s) => s.safetySettings);
  const hydrateGeminiApiKey = useProjectStore((s) => s.hydrateGeminiApiKey);
  const hasGeminiApiKey = useProjectStore((s) => s.hasGeminiApiKey);

  const [isAiProcessingRaw, setIsAiProcessing] = useState(false);
  const [isOfflineProcessingRaw, setIsOfflineProcessing] = useState(false);
  const [offlineEngine, setOfflineEngine] = useState<'argos' | 'm2m100'>('argos');

  // เชื่อมโยงความคืบหน้าของเอกสารปัจจุบันจากระบบคิวประมวลผลเบื้องหลัง
  const queueJobs = useBackgroundQueueStore((state) => state.jobs);
  const currentDocJob = documentId ? queueJobs.find(j => j.documentId === documentId && j.status === 'processing') : null;

  const isOfflineProcessing = currentDocJob ? currentDocJob.type === 'offline_all' : isOfflineProcessingRaw;
  const isAiProcessing = currentDocJob ? currentDocJob.type === 'ai_all' : isAiProcessingRaw;
  
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const handleToggleLeftSidebar = useCallback(() => {
    setIsLeftSidebarOpen((prev) => !prev);
  }, []);

  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(true);
  const handleToggleRightSidebar = useCallback(() => {
    setIsRightSidebarOpen((prev) => !prev);
  }, []);

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const lastWidthRef = useRef(window.innerWidth);
  useEffect(() => {
    const currentWidth = windowWidth;
    const prevWidth = lastWidthRef.current;
    if (currentWidth < 1024 && prevWidth >= 1024) {
      setIsLeftSidebarOpen(false);
    } else if (currentWidth >= 1024 && prevWidth < 1024) {
      setIsLeftSidebarOpen(true);
    }
    lastWidthRef.current = currentWidth;
  }, [windowWidth]);

  const isNarrow = windowWidth < 820;
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(file?.name || '');
  const [translationStatus, setTranslationStatus] = useState<{ kind: 'info' | 'success' | 'error'; message: string } | null>(null);
  const {
    isDownloadMenuOpen,
    setIsDownloadMenuOpen,
    downloadScopeSelection,
    setDownloadScopeSelection,
    downloadModeSelection,
    setDownloadModeSelection,
    selectedExportEngine,
    setSelectedExportEngine,
    isDownloadingResult,
    setIsDownloadingResult,
    exportCacheHydrationTick,
    setExportCacheHydrationTick,
    downloadMenuRef,
  } = useDownloadMenuState();
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const translationStartTime = useTranslationLoadingState({
    isAiProcessing,
    isOfflineProcessing,
    isDownloadingResult,
    setLoadingState,
  });
  const [popupOcrQualityMode, setPopupOcrQualityMode] = useState<'high' | 'fast'>(() => {
    const saved = localStorage.getItem('pdf_translator_ocr_profile');
    return (saved === 'high' || saved === 'fast') ? saved : 'fast';
  });
  const popupQualityToProfile = (mode: 'high' | 'fast'): OCRQualityProfile =>
    mode === 'high' ? 'balanced' : 'fast';

  const applyPopupOcrQualityProfile = useCallback((mode: 'high' | 'fast' = popupOcrQualityMode) => {
    setOcrOptions({ ocrQualityProfile: popupQualityToProfile(mode) });
  }, [popupOcrQualityMode, setOcrOptions]);

  const changeOcrQualityMode = useCallback((mode: 'high' | 'fast') => {
    setPopupOcrQualityMode(mode);
    localStorage.setItem('pdf_translator_ocr_profile', mode);
    setOcrOptions({ ocrQualityProfile: popupQualityToProfile(mode) });
  }, [setOcrOptions]);

  useEffect(() => {
    const saved = localStorage.getItem('pdf_translator_ocr_profile') as 'high' | 'fast' | null;
    const mode = (saved === 'high' || saved === 'fast') ? saved : 'fast';
    setOcrOptions({ ocrQualityProfile: popupQualityToProfile(mode) });
  }, [setOcrOptions]);

  useEffect(() => {
    useBackgroundQueueStore.getState().loadPersistedQueue();
  }, []);

  useEffect(() => {
    if (!isDownloadMenuOpen) return;
    const syncedMode = ocrOptions.ocrQualityProfile === 'balanced' || ocrOptions.ocrQualityProfile === 'best'
      ? 'high'
      : 'fast';
    if (syncedMode !== popupOcrQualityMode) {
      setPopupOcrQualityMode(syncedMode);
    }
    if (!selectedExportEngine) {
      setSelectedExportEngine((ocrOptions.engine || 'paddleocr') as OCREngine);
    }
  }, [isDownloadMenuOpen, ocrOptions.engine, ocrOptions.ocrQualityProfile, selectedExportEngine, popupOcrQualityMode]);

  const { hydrateExportCachesForDownload } = useExportCacheHydration({
    isDownloadMenuOpen,
    selectedExportEngine,
    defaultEngine: (ocrOptions.engine || 'paddleocr') as OCREngine,
    totalPages,
    fileType,
    documentId,
    ensureDocumentId,
    setExportCacheHydrationTick,
  });

  const {
    resolveModelScopedOriginalPageOCR,
    hasModelScopedCachedOCR,
    getModelScopedCachedPageNumbers,
    resolveModelScopedPagesForExport,
    resolveTranslatedEntryForExport,
    resolveLineBBoxForExport,
    buildTranslatedPageOCRForExport,
    resolveVisibleOverlayExportSize,
  } = useExportOcrResolvers({
    currentPage,
    fileType,
    totalPages,
    targetLanguage,
    translationMode,
    defaultEngine: (ocrOptions.engine || 'paddleocr') as OCREngine,
  });

  const { handleHeaderDownload } = useExportOrchestration({
    popupOcrQualityMode,
    setTranslationStatus,
    selectedExportEngine,
    setIsDownloadingResult,
    setIsDownloadMenuOpen,
    setExportCacheHydrationTick,
    hydrateExportCachesForDownload,
    resolveModelScopedPagesForExport,
    resolveTranslatedEntryForExport,
    buildTranslatedPageOCRForExport,
    resolveVisibleOverlayExportSize,
  });

  // Sync global loading state in useUIStore reactively
  const ocrProgress = useOCRTextLayerStore((state) => state.progress);

  useEffect(() => {
    void hydrateGeminiApiKey();
  }, [hydrateGeminiApiKey]);

  const handleBackToHome = () => {
    visionService.cancelAll('Project closed');
    // ปลดสถานะ Foreground Processing เพื่อให้คิวเบื้องหลังทำงานต่อได้
    useBackgroundQueueStore.getState().setForegroundProcessingActive(false);
    closeProject();
  };

  const handleClearDocumentCache = async () => {
    if (!documentId) return;
    const confirmed = window.confirm(
      "คุณต้องการรีเซ็ตเอกสารนี้ใช่หรือไม่?\n\nการดำเนินการนี้จะลบข้อมูล OCR และคำแปลทั้งหมดของทุกหน้าในไฟล์นี้ออกอย่างถาวร แต่ไฟล์เอกสารหลักจะไม่ถูกลบ"
    );
    if (!confirmed) return;

    try {
      const success = await dbService.clearDocumentCache(documentId);
      if (success) {
        // เคลียร์ memory cache ใน store
        useLayerStore.getState().clearLayers();
        useOCRTextLayerStore.getState().clearAllOCR();
        useOCRTextLayerStore.getState().setCurrentPageOCR(null);
        useProjectStore.getState().setPage(1);

        // ยกเลิกคิวงานที่ค้างอยู่ของเอกสารนี้
        const existingJobs = useBackgroundQueueStore.getState().jobs;
        existingJobs.forEach((j) => {
          if (j.documentId === documentId && ['pending', 'queued', 'paused', 'processing'].includes(j.status)) {
            useBackgroundQueueStore.getState().cancelJob(j.id);
          }
        });
        
        // แจ้งเตือนความสำเร็จ
        setTranslationStatus({
          kind: 'success',
          message: 'ล้างแคชและรีเซ็ตเอกสารสำเร็จแล้ว'
        });
      } else {
        setTranslationStatus({
          kind: 'error',
          message: 'ไม่สามารถล้างแคชได้ในขณะนี้'
        });
      }
    } catch (err) {
      console.error('Failed to clear document cache:', err);
      setTranslationStatus({
        kind: 'error',
        message: 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล'
      });
    }
  };
  
  useEffect(() => {
    if (showOCRHarness) return undefined;
    // Lazy Initialize Vision Worker (low priority)
    // Delay increased to 3.5s to prevent CPU spiking immediately after initial render
    const timer = setTimeout(() => {
      visionService.initialize().then(() => {
        console.log('Vision System Ready (Lazy Loaded)');
      });
    }, 3500);

    return () => clearTimeout(timer);
  }, [showOCRHarness]);



  // Update editedName when file changes
  useEffect(() => {
    if (file) {
      setEditedName(file.name);
    }
  }, [file]);

  const {
    runCurrentPageTranslation,
    runAiBatchDocumentTranslation,
    runOfflineBatchDocumentTranslation,
    handleOfflineTranslate,
    handleAiTranslate,
    cancelSinglePageTranslation,
    handleOfflineTranslateAllPages,
    handleAiTranslateAllPages,
    ensureCurrentPageOCRReadyForTranslation,
    ensureAllPagesOCRReadyForTranslation,
  } = useDocumentTranslation({
    file,
    fileName,
    filePath,
    documentId,
    fileType,
    currentPage,
    totalPages,
    ensureDocumentId,
    sourceLanguage,
    targetLanguage,
    translationMode,
    safetySettings,
    hasGeminiApiKey,
    ocrOptions,
    setTranslationStatus,
    offlineEngine,
    isAiProcessing: isAiProcessingRaw,
    setIsAiProcessing,
    isOfflineProcessing: isOfflineProcessingRaw,
    setIsOfflineProcessing,
    getModelScopedCachedPageNumbers,
  });

  useBackgroundQueueSync({
    documentId,
    currentPage,
    file,
    filePath,
    isAiProcessingRaw,
    isOfflineProcessingRaw,
    ocrOptions,
    sourceLanguage,
    targetLanguage,
    translationMode,
    runCurrentPageTranslation,
  });

  const {
    effectiveDownloadScope,
    selectedDownloadEngine,
    getEngineCacheStatus,
    ocrCoveredPageNumbers,
    missingOcrPageNumbers,
    translatedAvailablePageNumbers,
    missingTranslatedPageNumbers,
    canExportOriginalSelection,
    canExportTranslatedSelection,
    computedProgressPercent,
    getRemainingSecondsText,
    triggerPopupTranslation,
  } = useDocumentExportModalState({
    downloadScopeSelection,
    fileType,
    selectedExportEngine,
    ocrOptions,
    totalPages,
    currentPage,
    resolveModelScopedPagesForExport,
    resolveTranslatedEntryForExport,
    ocrProgress,
    isOfflineProcessing,
    isAiProcessing,
    translationStartTime,
    applyPopupOcrQualityProfile,
    hydrateExportCachesForDownload,
    setExportCacheHydrationTick,
    setTranslationStatus,
    setIsOfflineProcessing,
    setIsAiProcessing,
    setProgress,
    runCurrentPageTranslation,
    sourceLanguage,
    targetLanguage,
    translationMode,
  });

  if (showOCRHarness) {
    return <OCRRegressionHarness />;
  }

  // If no file is loaded, show Upload Screen
  if (!file) {
    return <UploadScreen />;
  }

  return (
    <div className="relative flex flex-col h-screen w-screen bg-[#0b0f16] text-slate-100 overflow-hidden font-sans">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-[22rem] w-[22rem] rounded-full bg-[#2B9BFF]/20 blur-3xl" />
        <div className="absolute -right-24 top-1/3 h-[24rem] w-[24rem] rounded-full bg-[#FF7E67]/12 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_8%,rgba(43,155,255,0.08),transparent_46%),linear-gradient(130deg,rgba(11,15,22,0.96)_0%,rgba(20,23,30,0.98)_55%,rgba(12,15,20,0.99)_100%)]" />
      </div>
      
      {/* HEADER TOOLBAR */}
      <AppHeaderToolbar
        file={file}
        editedName={editedName}
        isEditingName={isEditingName}
        setEditedName={setEditedName}
        setIsEditingName={setIsEditingName}
        onBackToHome={handleBackToHome}
        onClearDocumentCache={handleClearDocumentCache}
        activeTool={activeTool}
        setActiveTool={setActiveTool}
        currentPage={currentPage}
        translationMode={translationMode}
        setTranslationMode={setTranslationMode}
        splitViewMode={splitViewMode}
        setSplitViewMode={setSplitViewMode}
        isDownloadMenuOpen={isDownloadMenuOpen}
        setIsDownloadMenuOpen={setIsDownloadMenuOpen}
        isDownloadingResult={isDownloadingResult}
      />

      {/* MAIN CONTENT AREA */}
      <div className="relative z-10 flex flex-col flex-1 overflow-hidden">
        
        {isNarrow && file && (
          <React.Suspense fallback={<div className="h-10 bg-slate-950/55 border-b border-white/10" />}>
            <CompactTopToolbar 
              isAiProcessing={isAiProcessing}
              isOfflineProcessing={isOfflineProcessing}
              onAiTranslate={handleAiTranslate}
              onOfflineTranslate={handleOfflineTranslate}
              onCancelTranslation={cancelSinglePageTranslation}
              onAiTranslateAllPages={handleAiTranslateAllPages}
              onOfflineTranslateAllPages={handleOfflineTranslateAllPages}
              translationStatus={translationStatus}
              offlineEngine={offlineEngine}
              onOfflineEngineChange={setOfflineEngine}
            />
          </React.Suspense>
        )}

        <div className="relative z-10 flex flex-1 overflow-hidden">
          {/* 1. LEFT SIDEBAR - Pages Navigator Only */}
          {file && (
            <React.Suspense fallback={<div className="w-48 bg-slate-950/55 border-r border-white/10" />}>
              <LeftSidebar 
                isOpen={isLeftSidebarOpen} 
                onToggle={handleToggleLeftSidebar} 
              />
            </React.Suspense>
          )}

          {/* 2. MAIN WORKSPACE (Canvas) */}
          <main className="flex-1 relative overflow-hidden bg-[#313741]">
            <React.Suspense fallback={<div className="flex items-center justify-center h-full text-slate-500">Loading Canvas...</div>}>
              <WorkspaceContainer />
            </React.Suspense>
          </main>

          {/* 3. RIGHT SIDEBAR - OCR & Settings */}
          {!isNarrow && (
            <React.Suspense fallback={<div className="w-65 bg-slate-950/55 border-l border-white/10" />}>
              <RightSidebar 
                isOpen={isRightSidebarOpen}
                onToggle={handleToggleRightSidebar}
                isAiProcessing={isAiProcessing}
                isOfflineProcessing={isOfflineProcessing}
                onAiTranslate={handleAiTranslate}
                onOfflineTranslate={handleOfflineTranslate}
                onCancelTranslation={cancelSinglePageTranslation}
                onAiTranslateAllPages={handleAiTranslateAllPages}
                onOfflineTranslateAllPages={handleOfflineTranslateAllPages}
                translationStatus={translationStatus}
                offlineEngine={offlineEngine}
                onOfflineEngineChange={setOfflineEngine}
              />
            </React.Suspense>
          )}
        </div>
      </div>


      {/* Document Export Modal */}
      <DocumentExportModal
        isOpen={isDownloadMenuOpen}
        onClose={() => setIsDownloadMenuOpen(false)}
        downloadMenuRef={downloadMenuRef}
        downloadScopeSelection={downloadScopeSelection}
        setDownloadScopeSelection={setDownloadScopeSelection}
        downloadModeSelection={downloadModeSelection}
        setDownloadModeSelection={setDownloadModeSelection}
        selectedExportEngine={selectedExportEngine}
        setSelectedExportEngine={setSelectedExportEngine}
        popupOcrQualityMode={popupOcrQualityMode}
        changeOcrQualityMode={changeOcrQualityMode}
        isDownloadingResult={isDownloadingResult}
        isAiProcessing={isAiProcessing}
        isOfflineProcessing={isOfflineProcessing}
        triggerPopupTranslation={triggerPopupTranslation}
        handleHeaderDownload={handleHeaderDownload}
        currentPage={currentPage}
        totalPages={totalPages}
        fileType={fileType}
        targetLanguage={targetLanguage}
        setTargetLanguage={setTargetLanguage}
        ocrLanguage={ocrLanguage}
        getEngineCacheStatus={getEngineCacheStatus}
        ocrCoveredPageNumbers={ocrCoveredPageNumbers}
        missingOcrPageNumbers={missingOcrPageNumbers}
        translatedAvailablePageNumbers={translatedAvailablePageNumbers}
        missingTranslatedPageNumbers={missingTranslatedPageNumbers}
        canExportOriginalSelection={canExportOriginalSelection}
        canExportTranslatedSelection={canExportTranslatedSelection}
        effectiveDownloadScope={effectiveDownloadScope}
        selectedDownloadEngine={selectedDownloadEngine}
        computedProgressPercent={computedProgressPercent}
        getRemainingSecondsText={getRemainingSecondsText}
        ocrProgress={ocrProgress}
      />

      {/* Background Processing Queue Status Drawer */}
      <BackgroundQueuePanel />
      {loadingState?.active && (
        <GlobalLoadingOverlay 
          message={loadingState.message} 
          progress={loadingState.progress} 
        />
      )}
      <ExportOverlay />
    </div>
  );
}





