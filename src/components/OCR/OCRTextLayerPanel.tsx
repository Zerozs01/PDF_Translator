/**
 * OCRTextLayerPanel - UI สำหรับสร้าง Searchable PDF ด้วย OCR
 * 
 * Features:
 * - เลือกภาษา OCR
 * - เลือก OCR model
 * - แสดง Progress
 * - แสดงผล OCR ที่สแกนได้
 * - Export PDF
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import {
  Play, 
  Download, 
  RefreshCw,
  Languages,
  Eye,
  Cpu
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { OCREngine, OCRPageResult } from '../../types';
import { useOCRTextLayerStore, SUPPORTED_LANGUAGES, OCR_ENGINES } from '../../stores/useOCRTextLayerStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { searchablePDFService } from '../../services/pdf';
import { dbService } from '../../services/dbService';
import { visionService } from '../../services/vision/VisionService';
import {
  OCR_DIRECT_RENDER_TIMEOUT_MS_DEFAULT,
  resolvePerPageTimeoutSec,
  withPerPageOCRTimeout,
} from '../../services/vision/ocr-timeout';
import { OCR_ALGORITHM_VERSION } from '../../services/vision/ocrVersion';
import { pdfjs } from '../../services/pdf/pdfjsWorker';

// PDF.js worker is configured via pdfjsWorker

type EngineWarmPhase = 'idle' | 'checking' | 'warming' | 'ready' | 'error';

type EngineWarmState = {
  phase: EngineWarmPhase;
  progress: number;
  runtime?: string;
  description?: string;
  etaSec?: number | null;
  languageKey?: string;
};

const SESSION_ENGINE_WARM_STATES: Record<string, EngineWarmState> = {};
const SESSION_PREWARM_REQUESTED = new Set<string>();
const SESSION_ENGINE_WARM_PROMISES = new Map<string, Promise<boolean>>();
const SESSION_ENGINE_READY_KEYS = new Set<string>();

const normalizeWarmLanguageKey = (value: string): string => value
  .split('+')
  .map((part) => part.trim())
  .filter(Boolean)
  .sort()
  .join('+') || 'eng';

const getEngineWarmSessionKey = (engine: OCREngine, language: string): string =>
  `${engine}:${normalizeWarmLanguageKey(language)}`;

export const OCRTextLayerPanel: React.FC = () => {
  const DIRECT_RENDER_TIMEOUT_MS = OCR_DIRECT_RENDER_TIMEOUT_MS_DEFAULT;
  const EXTERNAL_OCR_RENDER_MAX_SIDE = 3800;
  const EXTERNAL_OCR_CJK_PANEL_MAX_SIDE = 11000;
  const EXTERNAL_OCR_CJK_PANEL_MAX_PIXELS = 34_000_000;

  const { file, fileUrl, fileData, fileType, currentPage, ensureDocumentId, translationMode } = useProjectStore();
  const {
    options,
    setOptions,
    isProcessing,
    progress,
    setProgress,
    setIsProcessing,
    setPageOCR,
    clearAllOCR,
    allPagesOCR,
    showDebugOverlay,
    setShowDebugOverlay
  } = useOCRTextLayerStore();

  const [isExporting, setIsExporting] = useState(false);
  const autoSyncedDocRef = useRef<number | null>(null);
  const persistedCacheRef = useRef<Map<string, string>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const pdfLoadingRef = useRef<Promise<PDFDocumentProxy> | null>(null);
  const fileRef = useRef<File | null>(null);
  const pdfDataRef = useRef<ArrayBuffer | null>(null);
  const activePipelineProfile = translationMode === 'manga' ? 'panel' : 'export';
  const normalizedWarmLanguage = normalizeWarmLanguageKey(options.language);
  const abortControllerRef = useRef<AbortController | null>(null);
  const ocrJobActiveRef = useRef(false);
  const suspendCacheReadsRef = useRef(false);
  const cacheLoadInFlightRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const [engineWarmStates, setEngineWarmStates] = useState<Record<string, EngineWarmState>>(() => ({ ...SESSION_ENGINE_WARM_STATES }));
  const pendingEngineSelectionRef = useRef<OCREngine | null>(null);
  const warmAnimationTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const externalProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isAbortError = useCallback(
    (error: unknown): boolean => error instanceof Error && error.name === 'AbortError',
    []
  );

  const shouldRecoverExternalEngine = useCallback((error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
      message.includes('daemon') ||
      message.includes('stdin is unavailable') ||
      message.includes('bridge is unavailable') ||
      message.includes('service terminated') ||
      message.includes('exited') ||
      message.includes('signal=sigterm') ||
      message.includes('external ocr canceled')
    );
  }, []);

  useEffect(() => {
    return () => {
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
      pdfLoadingRef.current = null;
      fileRef.current = null;
      pdfDataRef.current = null;
      abortControllerRef.current = null;
      for (const timer of warmAnimationTimersRef.current.values()) {
        clearInterval(timer);
      }
      warmAnimationTimersRef.current.clear();
      if (externalProgressTimerRef.current) {
        clearInterval(externalProgressTimerRef.current);
        externalProgressTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // Keep OCR overlay enabled by default and lock it on for this workflow.
    if (!showDebugOverlay) {
      setShowDebugOverlay(true);
    }
  }, [showDebugOverlay, setShowDebugOverlay]);

  const setEngineWarmState = useCallback((engine: string, patch: Partial<EngineWarmState>) => {
    setEngineWarmStates((current) => {
      const previous = current[engine] || SESSION_ENGINE_WARM_STATES[engine] || { phase: 'idle' as EngineWarmPhase, progress: 0 };
      const nextState = Object.assign(
        { phase: 'idle' as EngineWarmPhase, progress: 0 },
        previous,
        patch
      );
      if (
        (nextState.phase === 'checking' || nextState.phase === 'warming')
        && (previous.phase === 'checking' || previous.phase === 'warming')
      ) {
        nextState.progress = Math.max(previous.progress || 0, nextState.progress || 0);
      }
      SESSION_ENGINE_WARM_STATES[engine] = nextState;
      return {
        ...current,
        [engine]: nextState,
      };
    });
  }, []);

  const resetEngineWarmSession = useCallback((engine: OCREngine, description?: string) => {
    for (const key of Array.from(SESSION_ENGINE_WARM_PROMISES.keys())) {
      if (key.startsWith(`${engine}:`)) {
        SESSION_ENGINE_WARM_PROMISES.delete(key);
      }
    }
    for (const key of Array.from(SESSION_ENGINE_READY_KEYS.values())) {
      if (key.startsWith(`${engine}:`)) {
        SESSION_ENGINE_READY_KEYS.delete(key);
      }
    }
    for (const key of Array.from(SESSION_PREWARM_REQUESTED.values())) {
      if (key.startsWith(`${engine}:`)) {
        SESSION_PREWARM_REQUESTED.delete(key);
      }
    }
    setEngineWarmState(engine, {
      phase: 'idle',
      progress: 0,
      etaSec: null,
      description,
      languageKey: undefined,
    });
  }, [setEngineWarmState]);

  const stopWarmAnimation = useCallback((engine: string) => {
    const timer = warmAnimationTimersRef.current.get(engine);
    if (!timer) return;
    clearInterval(timer);
    warmAnimationTimersRef.current.delete(engine);
  }, []);

  const startWarmAnimation = useCallback((engine: OCREngine, phase: EngineWarmPhase) => {
    if (engine === 'tesseract') return;

    stopWarmAnimation(engine);
    const startedAt = Date.now();
    const expectedMs = phase === 'checking'
      ? 8000
      : engine === 'paddleocr'
        ? 45000
        : 22000;
    const phaseStart = phase === 'checking' ? 8 : 34;
    const phaseCap = phase === 'checking' ? 28 : 92;

    const tick = () => {
      const elapsedMs = Date.now() - startedAt;
      const ratio = Math.min(0.98, elapsedMs / expectedMs);
      const progress = Math.min(phaseCap, phaseStart + ((phaseCap - phaseStart) * ratio));
      const etaSec = Math.max(1, Math.ceil((expectedMs - elapsedMs) / 1000));
      const description = phase === 'checking'
        ? 'Checking local OCR runtime...'
        : engine === 'paddleocr'
          ? elapsedMs < 10000
            ? 'Preparing PaddleOCR runtime...'
            : elapsedMs < 28000
              ? 'Loading detection/recognition models...'
              : 'Warming PaddleOCR for selection...'
          : elapsedMs < 7000
            ? 'Preparing EasyOCR runtime...'
            : 'Loading EasyOCR reader...';

      setEngineWarmState(engine, {
        phase,
        progress,
        etaSec,
        description,
      });
    };

    tick();
    const timer = setInterval(tick, 500);
    warmAnimationTimersRef.current.set(engine, timer);
  }, [setEngineWarmState, stopWarmAnimation]);

  const ensureEngineReady = useCallback(async (
    engine: OCREngine,
    config?: { selectOnReady?: boolean }
  ) => {
    if (engine === 'tesseract') {
      pendingEngineSelectionRef.current = null;
      setOptions({ engine });
      return true;
    }

    const sessionKey = getEngineWarmSessionKey(engine, normalizedWarmLanguage);
    const currentState = SESSION_ENGINE_WARM_STATES[engine];
    const isReadyForCurrentSession = SESSION_ENGINE_READY_KEYS.has(sessionKey);
    const isReadyForCurrentLanguage =
      currentState?.phase === 'ready' && currentState.languageKey === normalizedWarmLanguage;

    if (isReadyForCurrentLanguage || isReadyForCurrentSession) {
      pendingEngineSelectionRef.current = null;
      if (!isReadyForCurrentLanguage) {
        setEngineWarmState(engine, {
          phase: 'ready',
          progress: 100,
          etaSec: 0,
          runtime: currentState?.runtime,
          description: currentState?.description,
          languageKey: normalizedWarmLanguage,
        });
      }
      if (config?.selectOnReady) {
        setOptions({ engine });
      }
      return true;
    }

    const inFlight = SESSION_ENGINE_WARM_PROMISES.get(sessionKey);
    if (inFlight) {
      if (config?.selectOnReady) {
        pendingEngineSelectionRef.current = engine;
      }
      return await inFlight;
    }

    if (!window.electronAPI?.ocr?.prewarmEngine) {
      setEngineWarmState(engine, {
        phase: 'error',
        progress: 0,
        description: 'External OCR bridge is unavailable in this runtime',
      });
      return false;
    }

    if (config?.selectOnReady) {
      pendingEngineSelectionRef.current = engine;
    }

    const warmPromise = (async () => {
      try {
        setEngineWarmState(engine, {
          phase: 'warming',
          progress: 18,
          description: engine === 'paddleocr'
            ? 'Preparing PaddleOCR runtime...'
            : 'Preparing EasyOCR runtime...',
          etaSec: engine === 'paddleocr' ? 45 : 22,
          languageKey: normalizedWarmLanguage,
        });
        startWarmAnimation(engine, 'warming');

        const warmed = await window.electronAPI.ocr.prewarmEngine({
          engine,
          language: normalizedWarmLanguage,
        });
        stopWarmAnimation(engine);
        setEngineWarmState(engine, {
          phase: 'ready',
          progress: 100,
          runtime: warmed.runtime,
          description: warmed.description,
          etaSec: 0,
          languageKey: normalizedWarmLanguage,
        });
        SESSION_ENGINE_READY_KEYS.add(sessionKey);

        if (pendingEngineSelectionRef.current === engine || config?.selectOnReady) {
          pendingEngineSelectionRef.current = null;
          setOptions({ engine });
        }
        return true;
      } catch (error) {
        stopWarmAnimation(engine);
        setEngineWarmState(engine, {
          phase: 'error',
          progress: 0,
          description: error instanceof Error ? error.message : String(error),
          etaSec: null,
          languageKey: normalizedWarmLanguage,
        });
        SESSION_ENGINE_READY_KEYS.delete(sessionKey);
        if (pendingEngineSelectionRef.current === engine) {
          pendingEngineSelectionRef.current = null;
        }
        return false;
      } finally {
        SESSION_ENGINE_WARM_PROMISES.delete(sessionKey);
      }
    })();

    SESSION_ENGINE_WARM_PROMISES.set(sessionKey, warmPromise);
    return await warmPromise;
  }, [normalizedWarmLanguage, setEngineWarmState, setOptions, startWarmAnimation, stopWarmAnimation]);

  // External engines are warmed on-demand when selected or when OCR starts.
  // This keeps first-open latency lower on slower machines.
  useEffect(() => {
    if (!file) return undefined;
    let disposed = false;

    const scheduleWarm = (engine: OCREngine, delayMs: number, useIdle: boolean) => {
      const timer = setTimeout(() => {
        if (disposed) return;
        if (isProcessing) return;
        const sessionKey = getEngineWarmSessionKey(engine, normalizedWarmLanguage);
        if (SESSION_ENGINE_READY_KEYS.has(sessionKey)) return;
        if (SESSION_PREWARM_REQUESTED.has(sessionKey)) return;
        SESSION_PREWARM_REQUESTED.add(sessionKey);

        const idleApi = (window as Window & {
          requestIdleCallback?: (callback: () => void, opts?: { timeout: number }) => number;
        }).requestIdleCallback;

        const runWarm = () => {
          if (disposed) return;
          if (isProcessing) return;
          void ensureEngineReady(engine, { selectOnReady: false });
        };

        if (useIdle && typeof idleApi === 'function') {
          idleApi(runWarm, { timeout: 3000 });
        } else {
          runWarm();
        }
      }, delayMs);
      return timer;
    };

    // Warm quickly after file open so first OCR click doesn't pay the cold-start cost.
    const preferredEngine = options.engine === 'paddleocr' || options.engine === 'easyocr'
      ? options.engine
      : 'paddleocr';
    const secondaryEngine: OCREngine = preferredEngine === 'paddleocr' ? 'easyocr' : 'paddleocr';

    const preferredTimer = scheduleWarm(preferredEngine, 160, false);
    const secondaryTimer = scheduleWarm(secondaryEngine, 2200, true);

    return () => {
      disposed = true;
      clearTimeout(preferredTimer);
      clearTimeout(secondaryTimer);
    };
  }, [ensureEngineReady, file, isProcessing, normalizedWarmLanguage, options.engine]);

  const recoverExternalEngine = useCallback((engine: OCREngine, reason?: string) => {
    if (engine === 'tesseract') return;
    resetEngineWarmSession(engine, reason);
    const sessionKey = getEngineWarmSessionKey(engine, normalizedWarmLanguage);
    SESSION_PREWARM_REQUESTED.add(sessionKey);
    void ensureEngineReady(engine, { selectOnReady: false });
  }, [ensureEngineReady, normalizedWarmLanguage, resetEngineWarmSession]);

  const stopExternalProgress = useCallback(() => {
    if (externalProgressTimerRef.current) {
      clearInterval(externalProgressTimerRef.current);
      externalProgressTimerRef.current = null;
    }
  }, []);

  const startExternalProgress = useCallback((pageNum: number, engine: OCREngine, imageWidth?: number, imageHeight?: number) => {
    stopExternalProgress();
    const startedAt = Date.now();
    const warmState = SESSION_ENGINE_WARM_STATES[engine];
    const engineReadyForLanguage = (
      warmState?.phase === 'ready' && warmState.languageKey === normalizedWarmLanguage
    ) || SESSION_ENGINE_READY_KEYS.has(getEngineWarmSessionKey(engine, normalizedWarmLanguage));
    let expectedMs = engine === 'paddleocr'
      ? (engineReadyForLanguage ? 24000 : 52000)
      : (engineReadyForLanguage ? 12000 : 26000);

    if (
      engine === 'paddleocr'
      && activePipelineProfile === 'panel'
      && imageWidth
      && imageHeight
    ) {
      const longest = Math.max(imageWidth, imageHeight);
      const shortest = Math.max(1, Math.min(imageWidth, imageHeight));
      const aspectRatio = longest / shortest;
      const cjkLike = options.language
        .split('+')
        .map(code => code.trim())
        .filter(Boolean)
        .some(code => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));
      const koreanLike = options.language
        .split('+')
        .map(code => code.trim())
        .filter(Boolean)
        .includes('kor');
      const chunkLikely = koreanLike
        ? (imageHeight >= 6200 || aspectRatio >= 2.4)
        : (!cjkLike && (imageHeight >= 5200 || aspectRatio >= 2.3));
      if (chunkLikely) {
        const estimatedChunkHeight = Math.min(
          Math.max(2200, Math.round(imageWidth * 0.95)),
          Math.max(2200, Math.round(imageHeight * 0.34)),
        );
        const estimatedStride = Math.max(1, estimatedChunkHeight - 220);
        const estimatedChunks = Math.max(1, Math.ceil((imageHeight - 220) / estimatedStride));
        expectedMs = engineReadyForLanguage
          ? (9000 + (estimatedChunks * 8500))
          : (22000 + (estimatedChunks * 10000));
      }
    }

    const tick = () => {
      const elapsedMs = Date.now() - startedAt;
      const warmupProgress = 18 + ((Math.min(elapsedMs, expectedMs) / expectedMs) * 72);
      const tailProgress = elapsedMs > expectedMs
        ? Math.min(98, 90 + (Math.log1p((elapsedMs - expectedMs) / 4000) * 2.6))
        : warmupProgress;
      const progressValue = Math.max(18, Math.min(98, tailProgress));
      const statusText = engine === 'paddleocr'
        ? !engineReadyForLanguage && elapsedMs < 11000
          ? 'Preparing PaddleOCR runtime...'
          : !engineReadyForLanguage && elapsedMs < 28000
            ? 'Loading PaddleOCR model...'
            : 'Running PaddleOCR...'
        : !engineReadyForLanguage && elapsedMs < 6000
          ? 'Preparing EasyOCR runtime...'
          : !engineReadyForLanguage && elapsedMs < 16000
            ? 'Loading EasyOCR reader...'
          : 'Running external OCR...';

      setProgress({
        stage: 'ocr',
        currentPage: pageNum,
        totalPages: 1,
        message: `OCR page ${pageNum}: ${statusText}`,
        progress: progressValue,
      });
    };

    tick();
    externalProgressTimerRef.current = setInterval(tick, 700);
  }, [activePipelineProfile, normalizedWarmLanguage, options.language, setProgress, stopExternalProgress]);

  const getPdfDoc = useCallback(async () => {
    if (!file) {
      throw new Error('No PDF loaded');
    }

    // If file changed, reset cached doc
    if (fileRef.current && fileRef.current !== file) {
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
      pdfLoadingRef.current = null;
      pdfDataRef.current = null;
    }

    fileRef.current = file;

    if (pdfDocRef.current) {
      return pdfDocRef.current;
    }

    if (pdfLoadingRef.current) {
      return pdfLoadingRef.current;
    }

    const loadingPromise = (async () => {
      const cached = pdfDataRef.current && pdfDataRef.current.byteLength > 0
        ? pdfDataRef.current
        : null;
      if (!cached) {
        pdfDataRef.current = null;
      }
      const data = cached ?? (() => {
        if (fileData) {
          return fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
        }
        return null;
      })() ?? await file.arrayBuffer();
      pdfDataRef.current = data as ArrayBuffer;
      const loadingTask = pdfjs.getDocument({ data: data as ArrayBuffer });
      const doc = await loadingTask.promise;
      pdfDocRef.current = doc;
      pdfLoadingRef.current = null;
      return doc;
    })();

    pdfLoadingRef.current = loadingPromise;
    return loadingPromise;
  }, [file, fileData]);

  const normalizeLanguage = useCallback((value: string): string => {
    return value
      .split('+')
      .map(v => v.trim())
      .filter(Boolean)
      .sort()
      .join('+');
  }, []);

  const isCacheCompatible = useCallback((cached: OCRPageResult): boolean => {
    if (normalizeLanguage(cached.language) !== normalizeLanguage(options.language)) return false;
    if (cached.dpi !== options.dpi) return false;
    if (options.pageSegMode !== undefined && cached.pageSegMode !== options.pageSegMode) return false;
    if (cached.algorithmVersion !== OCR_ALGORITHM_VERSION) return false;
    if ((cached.pipelineProfile || 'panel') !== activePipelineProfile) return false;
    if ((cached.ocrEngine || 'tesseract') !== (options.engine || 'tesseract')) return false;
    return true;
  }, [activePipelineProfile, options, normalizeLanguage]);

  // UI preview can show stale algorithm cache (marked as stale in badge) to avoid blank panel
  // while still requiring language match.
  const isDisplayCacheCompatible = useCallback((cached: OCRPageResult): boolean => {
    if (!cached || !Array.isArray(cached.words) || !Array.isArray(cached.lines)) return false;
    if (cached.words.length === 0 && cached.lines.length === 0 && !(cached.text || '').trim()) return false;
    if (normalizeLanguage(cached.language) !== normalizeLanguage(options.language)) return false;
    if ((cached.pipelineProfile || 'panel') !== activePipelineProfile) return false;
    if ((cached.ocrEngine || 'tesseract') !== (options.engine || 'tesseract')) return false;
    return true;
  }, [activePipelineProfile, normalizeLanguage, options.engine, options.language]);

  const loadCachedOCR = useCallback(async (
    pageNum: number,
    options?: { allowDuringSuspension?: boolean }
  ): Promise<boolean> => {
    if (suspendCacheReadsRef.current && !options?.allowDuringSuspension) {
      console.log(`[OCRPanel] Skipping passive cache load for page ${pageNum} while OCR job is active`);
      return false;
    }

    const requestKey = [
      file?.name || 'no-file',
      pageNum,
      normalizeLanguage(options?.allowDuringSuspension ? useOCRTextLayerStore.getState().options.language : useOCRTextLayerStore.getState().options.language),
      useOCRTextLayerStore.getState().options.dpi,
      useOCRTextLayerStore.getState().options.engine || 'tesseract',
      useOCRTextLayerStore.getState().options.pageSegMode ?? 'default',
      activePipelineProfile,
      options?.allowDuringSuspension ? 'forced' : 'passive',
    ].join('|');

    const existingRequest = cacheLoadInFlightRef.current.get(requestKey);
    if (existingRequest) {
      return existingRequest;
    }

    const loadPromise = (async (): Promise<boolean> => {
      const activeFile = file;
      const state = useOCRTextLayerStore.getState();
      const memoryCached = state.allPagesOCR.get(pageNum);
      if (memoryCached && isDisplayCacheCompatible(memoryCached)) {
        if (useProjectStore.getState().file !== activeFile) return false;
        setPageOCR(pageNum, memoryCached);
        return true;
      }

      let cacheDocId: number | null = null;
      try {
        cacheDocId = await ensureDocumentId();
      } catch (error) {
        console.warn('[OCRPanel] Failed to ensure document ID for OCR cache:', error);
        return false;
      }
      if (!cacheDocId) return false;
      console.log(`[OCRPanel] Checking DB cache for page ${pageNum} (docId=${cacheDocId})`);

      const cached = await dbService.getOCR(cacheDocId, pageNum);
      if (cached && isDisplayCacheCompatible(cached)) {
        if (useProjectStore.getState().file !== activeFile) return false;
        cached.pageNumber = pageNum;
        setPageOCR(pageNum, cached);
        return true;
      }

      // Alias fallback: same filename can exist under multiple document_id values
      // (legacy source path vs imported hash path). If current doc misses, probe
      // OCR-backed candidates and switch doc binding once a hit is found.
      if (file?.name) {
        const candidates = await dbService.findDocumentsByFilename(file.name);
        const aliasCandidates = candidates
          .filter(candidate => candidate.id !== cacheDocId && (candidate.cache_pages ?? 0) > 0)
          .slice(0, 8);

        for (const candidate of aliasCandidates) {
          console.log(
            `[OCRPanel] Cache miss on docId=${cacheDocId}, probing alias docId=${candidate.id} for page ${pageNum}`
          );
          const aliasCached = await dbService.getOCR(candidate.id, pageNum);
          if (!aliasCached || !isDisplayCacheCompatible(aliasCached)) continue;
          if (useProjectStore.getState().file !== activeFile) return false;

          aliasCached.pageNumber = pageNum;
          setPageOCR(pageNum, aliasCached);

          const currentProject = useProjectStore.getState();
          if (currentProject.documentId !== candidate.id) {
            useProjectStore.setState({
              documentId: candidate.id,
              filePath: candidate.filepath
            });
            autoSyncedDocRef.current = candidate.id;
            console.log(
              `[OCRPanel] Switched OCR cache binding: docId=${cacheDocId} -> docId=${candidate.id}`
            );
          }
          return true;
        }

        // Even when this page misses, keep the OCR cache binding on the only
        // OCR-backed alias so future page checks don't stay pinned to an empty doc.
        if (aliasCandidates.length === 1) {
          const preferred = aliasCandidates[0];
          const currentProject = useProjectStore.getState();
          if (currentProject.documentId === cacheDocId) {
            useProjectStore.setState({
              documentId: preferred.id,
              filePath: preferred.filepath
            });
            autoSyncedDocRef.current = preferred.id;
            console.log(
              `[OCRPanel] Rebound OCR cache docId=${cacheDocId} -> ${preferred.id} (page ${pageNum} still uncached)`
            );
          }
        }
      }

      return false;
    })();

    cacheLoadInFlightRef.current.set(requestKey, loadPromise);
    try {
      return await loadPromise;
    } finally {
      cacheLoadInFlightRef.current.delete(requestKey);
    }
  }, [activePipelineProfile, file, isCacheCompatible, isDisplayCacheCompatible, ensureDocumentId, setPageOCR]);

  const syncOptionsFromLatestCache = useCallback(async (): Promise<void> => {
    if (!file) return;
    let docId: number | null = null;
    try {
      docId = await ensureDocumentId();
    } catch {
      return;
    }
    if (!docId) return;
    if (autoSyncedDocRef.current === docId) return;

    const latest = await dbService.getLatestOCR(docId);
    autoSyncedDocRef.current = docId;
    if (!latest?.ocr_data) return;

    const latestOCR = latest.ocr_data;
    if ((latestOCR.pipelineProfile || 'panel') !== activePipelineProfile) return;
    const latestLang = normalizeLanguage(latestOCR.language || 'eng');
    const currentLang = normalizeLanguage(options.language || 'eng');
    const nextPatch: Partial<typeof options> = {};

    if (latestLang && latestLang !== currentLang) {
      nextPatch.language = latestLang;
    }
    if (latestOCR.pageSegMode !== options.pageSegMode) {
      nextPatch.pageSegMode = latestOCR.pageSegMode;
    }
    if ((latestOCR.ocrEngine || 'tesseract') !== (options.engine || 'tesseract')) {
      nextPatch.engine = latestOCR.ocrEngine || 'tesseract';
    }

    if (Object.keys(nextPatch).length > 0) {
      setOptions(nextPatch);
    }
  }, [activePipelineProfile, ensureDocumentId, file, normalizeLanguage, options.engine, options.language, options.pageSegMode, setOptions]);

  const beginAbortableJob = useCallback(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return controller;
  }, []);

  const cancelCurrentJob = useCallback(() => {
    abortControllerRef.current?.abort();
    if (options.engine && options.engine !== 'tesseract') {
      void window.electronAPI?.ocr?.cancelExternal?.({ engine: options.engine }).catch(() => {
        // Best effort external OCR cancellation.
      });
      recoverExternalEngine(options.engine, `${options.engine} canceled - reloading model cache...`);
    }
    visionService.cancelAll('OCR job canceled');
  }, [options.engine, recoverExternalEngine]);

  useEffect(() => {
    if (!file) return;
    if (isProcessing) return;
    void loadCachedOCR(currentPage);
  }, [file, currentPage, options.language, options.dpi, options.engine, options.pageSegMode, activePipelineProfile, loadCachedOCR, isProcessing]);

  useEffect(() => {
    autoSyncedDocRef.current = null;
    persistedCacheRef.current.clear();
    clearAllOCR();
  }, [file, activePipelineProfile, clearAllOCR]);

  useEffect(() => {
    if (!file) return;
    void syncOptionsFromLatestCache();
  }, [file, syncOptionsFromLatestCache]);

  // Self-healing persistence: if OCR results exist in memory, ensure they are flushed to DB.
  useEffect(() => {
    if (!file || allPagesOCR.size === 0) return;
    let canceled = false;
    void (async () => {
      const docId = await ensureDocumentId();
      if (!docId || canceled) return;

      for (const [pageNum, result] of allPagesOCR.entries()) {
        if (canceled) return;
        const fp = `${result.algorithmVersion}|${result.dpi}|${result.pipelineProfile || 'panel'}|${result.ocrEngine || 'tesseract'}|${normalizeLanguage(result.language)}|${result.words.length}|${result.text.length}`;
        const key = `${docId}:${pageNum}`;
        if (persistedCacheRef.current.get(key) === fp) continue;

        const saved = await dbService.saveOCR(docId, pageNum, result);
        if (saved) {
          persistedCacheRef.current.set(key, fp);
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [allPagesOCR, ensureDocumentId, file, normalizeLanguage]);

  // Get current page OCR result
  const currentPageOCR = allPagesOCR.get(currentPage);

  const hasCjkOrThaiOcrLanguage = useCallback((language: string) => {
    const codes = language.split('+').map(code => code.trim()).filter(Boolean);
    return codes.some(code => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));
  }, []);

  const hasKoreanOcrLanguage = useCallback((language: string) => {
    const codes = language.split('+').map(code => code.trim()).filter(Boolean);
    return codes.includes('kor');
  }, []);

  const resolveRenderConstraints = useCallback((engine?: string) => {
    const cjkPanelExternal = activePipelineProfile === 'panel'
      && engine !== 'tesseract'
      && hasCjkOrThaiOcrLanguage(options.language);
    const koreanPaddlePanel = activePipelineProfile === 'panel'
      && engine === 'paddleocr'
      && hasKoreanOcrLanguage(options.language);

    if (engine === 'paddleocr') {
      if (koreanPaddlePanel) {
        return {
          maxSide: 9000,
          maxPixels: 22_000_000,
        };
      }
      if (cjkPanelExternal) {
        return {
          maxSide: 7600,
          maxPixels: 14_000_000,
        };
      }
      if (activePipelineProfile === 'export') {
        return {
          maxSide: Math.min(EXTERNAL_OCR_RENDER_MAX_SIDE, 3000),
          maxPixels: 4_600_000,
        };
      }
      return {
        maxSide: Math.min(EXTERNAL_OCR_RENDER_MAX_SIDE, 3200),
        maxPixels: 5_200_000,
      };
    }
    if (engine === 'easyocr') {
      if (cjkPanelExternal) {
        return {
          maxSide: 7600,
          maxPixels: 18_000_000,
        };
      }
      return activePipelineProfile === 'export'
        ? { maxSide: 2600, maxPixels: 3_800_000 }
        : { maxSide: 2800, maxPixels: 4_200_000 };
    }
    if (activePipelineProfile === 'export') {
      return {
        maxSide: 12000,
        maxPixels: 12_000_000,
      };
    }
    return { maxSide: null, maxPixels: null };
  }, [EXTERNAL_OCR_CJK_PANEL_MAX_PIXELS, EXTERNAL_OCR_CJK_PANEL_MAX_SIDE, EXTERNAL_OCR_RENDER_MAX_SIDE, activePipelineProfile, hasCjkOrThaiOcrLanguage, hasKoreanOcrLanguage, options.language]);

  const fitDimensionsToConstraints = useCallback((
    width: number,
    height: number,
    constraints?: { maxSide?: number | null; maxPixels?: number | null }
  ) => {
    const maxSide = constraints?.maxSide ?? null;
    const maxPixels = constraints?.maxPixels ?? null;
    let scaleFactor = 1;

    if (maxSide && maxSide > 0) {
      const longestSide = Math.max(width, height);
      if (longestSide > maxSide) {
        scaleFactor = Math.min(scaleFactor, maxSide / longestSide);
      }
    }

    if (maxPixels && maxPixels > 0) {
      const pixelCount = width * height;
      if (pixelCount > maxPixels) {
        scaleFactor = Math.min(scaleFactor, Math.sqrt(maxPixels / pixelCount));
      }
    }

    if (scaleFactor >= 1) {
      return { width, height, scaleFactor: 1 };
    }

    return {
      width: Math.max(1, Math.floor(width * scaleFactor)),
      height: Math.max(1, Math.floor(height * scaleFactor)),
      scaleFactor,
    };
  }, []);

  /**
   * Render PDF page to canvas at specified DPI
   * 
   * Strategy:
   * 1) Render directly with pdf.js at target DPI (best OCR accuracy)
   * 2) Fallback to existing react-pdf canvas if pdf.js render fails
   */
  const renderImageToCanvas = useCallback(async (renderOptions?: { maxSide?: number | null; maxPixels?: number | null }) => {
    if (!file) throw new Error('No image loaded');
    const imageBlob = fileData
      ? new Blob([fileData as unknown as BlobPart], { type: file.type || 'image/png' })
      : file;

    const imageBitmap = await createImageBitmap(imageBlob);
    const fitted = fitDimensionsToConstraints(imageBitmap.width, imageBitmap.height, renderOptions);
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = fitted.width;
    outputCanvas.height = fitted.height;
    const ctx = outputCanvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Cannot get canvas context');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imageBitmap, 0, 0, outputCanvas.width, outputCanvas.height);
    imageBitmap.close?.();
    return {
      canvas: outputCanvas,
      width: outputCanvas.width,
      height: outputCanvas.height
    };
  }, [file, fileData, fitDimensionsToConstraints]);

  const renderPageToCanvas = useCallback(async (
    pageNum: number,
    targetDpi: number,
    renderOptions?: { allowNavigationFallback?: boolean; maxSide?: number | null; maxPixels?: number | null }
  ) => {
    if (!file) throw new Error('No PDF loaded');
    if (fileType !== 'pdf') {
      return renderImageToCanvas(renderOptions);
    }

    const renderFromExistingCanvas = async () => {
      const existingCanvas = document.querySelector(
        `.react-pdf__Page[data-page-number="${pageNum}"] canvas`
      ) as HTMLCanvasElement | null;

      if (existingCanvas && existingCanvas.width > 0 && existingCanvas.height > 0) {
        const currentWidth = existingCanvas.width;
        const currentHeight = existingCanvas.height;
        const estimatedCurrentDpi = Math.round((currentWidth / 595) * 72);
        const scaleFactor = Math.max(1, Math.min(targetDpi / Math.max(estimatedCurrentDpi, 72), 3.0));

        const scaledWidth = Math.round(currentWidth * scaleFactor);
        const scaledHeight = Math.round(currentHeight * scaleFactor);
        const fitted = fitDimensionsToConstraints(scaledWidth, scaledHeight, renderOptions);

        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = fitted.width;
        outputCanvas.height = fitted.height;
        const ctx = outputCanvas.getContext('2d');

        if (!ctx) throw new Error('Cannot get canvas context');

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(existingCanvas, 0, 0, outputCanvas.width, outputCanvas.height);

        return {
          canvas: outputCanvas,
          width: outputCanvas.width,
          height: outputCanvas.height
        };
      }

      if (!renderOptions?.allowNavigationFallback) {
        throw new Error(`No rendered canvas available for page ${pageNum}`);
      }

      // Navigate to the page and wait for canvas to appear (legacy fallback)
      console.log(`[OCRPanel] Navigating to page ${pageNum} and waiting for canvas...`);

      const { setPage } = useProjectStore.getState();
      const previousPage = useProjectStore.getState().currentPage;

      setPage(pageNum, { persist: false });

      const startTime = Date.now();
      const maxWaitTime = 10000;

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 500));

        const newCanvas = document.querySelector(
          `.react-pdf__Page[data-page-number="${pageNum}"] canvas`
        ) as HTMLCanvasElement | null;

        if (newCanvas && newCanvas.width > 0 && newCanvas.height > 0) {
          console.log(`[OCRPanel] Canvas appeared for page ${pageNum}: ${newCanvas.width}x${newCanvas.height}`);

          const currentWidth = newCanvas.width;
          const currentHeight = newCanvas.height;
          const estimatedCurrentDpi = Math.round((currentWidth / 595) * 72);
          const scaleFactor = targetDpi / Math.max(estimatedCurrentDpi, 72);

          const scaledWidth = Math.round(currentWidth * scaleFactor);
          const scaledHeight = Math.round(currentHeight * scaleFactor);
          const fitted = fitDimensionsToConstraints(scaledWidth, scaledHeight, renderOptions);

          const outputCanvas = document.createElement('canvas');
          outputCanvas.width = fitted.width;
          outputCanvas.height = fitted.height;
          const ctx = outputCanvas.getContext('2d');

          if (!ctx) throw new Error('Cannot get canvas context');

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(newCanvas, 0, 0, outputCanvas.width, outputCanvas.height);

          return {
            canvas: outputCanvas,
            width: outputCanvas.width,
            height: outputCanvas.height
          };
        }
      }

      setPage(previousPage, { persist: false });
      throw new Error(`Timeout waiting for page ${pageNum} canvas to render`);
    };

    try {
      console.log(`[OCRPanel] Direct pdf.js render start for page ${pageNum} @ ${targetDpi} DPI`);
      const pdfDoc = await getPdfDoc();
      const page = await pdfDoc.getPage(pageNum);
      const requestedScale = targetDpi / 72;
      const requestedViewport = page.getViewport({ scale: requestedScale });
      const fitted = fitDimensionsToConstraints(requestedViewport.width, requestedViewport.height, renderOptions);
      const scale = requestedScale * fitted.scaleFactor;
      if (fitted.scaleFactor < 1) {
        console.log(
          `[OCRPanel] Downscaling render for page ${pageNum}: ` +
          `${Math.floor(requestedViewport.width)}x${Math.floor(requestedViewport.height)} -> ${fitted.width}x${fitted.height}`
        );
      }
      const viewport = page.getViewport({ scale });

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = Math.floor(viewport.width);
      outputCanvas.height = Math.floor(viewport.height);

      const ctx = outputCanvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Cannot get canvas context');

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

      const renderTask = page.render({ canvasContext: ctx, viewport, intent: 'print', canvas: outputCanvas });
      await Promise.race([
        renderTask.promise,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Direct pdf.js render timeout after ${DIRECT_RENDER_TIMEOUT_MS}ms for page ${pageNum}`)), DIRECT_RENDER_TIMEOUT_MS);
        })
      ]);

      console.log(`[OCRPanel] Direct pdf.js render complete for page ${pageNum}: ${outputCanvas.width}x${outputCanvas.height}`);

      return {
        canvas: outputCanvas,
        width: outputCanvas.width,
        height: outputCanvas.height
      };
    } catch (error) {
      console.warn('[OCRPanel] pdf.js render failed, falling back to existing canvas:', error);
      return renderFromExistingCanvas();
    }
  }, [file, fileType, fitDimensionsToConstraints, getPdfDoc, renderImageToCanvas]);

  const runCurrentPageOCR = useCallback(async (
    pageNum: number,
    force: boolean,
    controller: AbortController
  ) => {
    const activeEngine = options.engine || 'tesseract';
    if (activeEngine !== 'tesseract') {
      const ready = await ensureEngineReady(activeEngine, { selectOnReady: false });
      if (!ready) {
        throw new Error(`${activeEngine} is not ready yet`);
      }
    }

    if (!force) {
      const loaded = await loadCachedOCR(pageNum, { allowDuringSuspension: true });
      if (loaded) {
        return;
      }
    }

    setIsProcessing(true);
    setProgress({
      stage: 'init',
      currentPage: pageNum,
      totalPages: 1,
      message: 'Initializing...',
      progress: 0
    });

    setProgress({
      stage: 'rendering',
      currentPage: pageNum,
      totalPages: 1,
      message: `Rendering page ${pageNum}...`,
      progress: 10
    });

    const renderConstraints = resolveRenderConstraints(options.engine);
    console.log(`[OCRPanel] Current-page OCR rendering start for page ${pageNum}`);

    const { canvas, width: imageWidth, height: imageHeight } = await renderPageToCanvas(pageNum, options.dpi, {
      allowNavigationFallback: true,
      ...renderConstraints,
    });

    console.log(`[OCRPanel] Current-page OCR render complete for page ${pageNum}: ${imageWidth}x${imageHeight}`);

    const imageBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert canvas to Blob'));
      }, 'image/png');
    });

    console.log(`[OCRPanel] Current-page OCR image blob ready for page ${pageNum}: ${imageBlob.size} bytes`);

    if (activeEngine === 'tesseract') {
      visionService.setProgressCallback((ocrProgress) => {
        const scaled = 15 + (ocrProgress.progress * 80);
        setProgress({
          stage: 'ocr',
          currentPage: pageNum,
          totalPages: 1,
          message: `OCR page ${pageNum}: ${ocrProgress.status} (${Math.round(ocrProgress.progress * 100)}%)`,
          progress: scaled
        });
      });
    } else {
      visionService.setProgressCallback(null);
      startExternalProgress(pageNum, activeEngine, imageWidth, imageHeight);
    }

    console.log(`[OCRPanel] Dispatching OCR request for page ${pageNum}`);

    const pageAbortController = new AbortController();
    const pageSignal = pageAbortController.signal;
    const parentAbortHandler = () => pageAbortController.abort();
    controller.signal.addEventListener('abort', parentAbortHandler, { once: true });

    const ocrPromise = visionService.ocrForTextLayer(
      imageBlob,
      imageWidth,
      imageHeight,
      options.language,
      options.dpi,
      options.pageSegMode,
      pageSignal,
      showDebugOverlay,
      activePipelineProfile,
      'best',
      activeEngine
    );

    const ocrResult: import('../../types').OCRPageResult = await (async () => {
      const effectiveTimeoutSec = resolvePerPageTimeoutSec(options.perPageTimeoutSec, options.engine || 'tesseract');
      try {
        return await withPerPageOCRTimeout(
          ocrPromise,
          pageNum,
          effectiveTimeoutSec,
          () => {
            pageAbortController.abort();
            visionService.cancelAll(`OCR timeout on page ${pageNum}`);
          }
        );
      } finally {
        controller.signal.removeEventListener('abort', parentAbortHandler);
        stopExternalProgress();
      }
    })();

    console.log(`[OCRPanel] OCR request resolved for page ${pageNum} with ${ocrResult.words.length} words`);
    const debugDrops = ocrResult.debug?.dropCounts || {};
    const debugDropWords = ocrResult.debug?.droppedWords || [];
    console.log(
      `[OCRPanel] OCR debug page ${pageNum}: engine=${activeEngine} pipeline=${activePipelineProfile} lang=${options.language} ` +
      `drops=${JSON.stringify(debugDrops)} droppedWords=${debugDropWords.length}`
    );
    if (debugDropWords.length > 0) {
      console.log('[OCRPanel] OCR droppedWords sample:', debugDropWords.slice(0, 8));
    }
    visionService.setProgressCallback(null);

    ocrResult.language = normalizeLanguage(options.language);
    ocrResult.pageNumber = pageNum;
    ocrResult.pipelineProfile = activePipelineProfile;
    ocrResult.ocrEngine = activeEngine;
    ocrResult.ocrQualityProfile = 'best';
    if (activeEngine !== 'tesseract') {
      setEngineWarmState(activeEngine, {
        phase: 'ready',
        progress: 100,
        etaSec: 0,
        languageKey: normalizedWarmLanguage,
      });
    }
    setPageOCR(pageNum, ocrResult);

    const cacheDocId = await ensureDocumentId();
    if (cacheDocId) {
      const saved = await dbService.saveOCR(cacheDocId, pageNum, ocrResult);
      if (!saved) {
        console.warn(`[OCRPanel] Failed to persist OCR cache for page ${pageNum} (docId=${cacheDocId})`);
      }
    }

    setProgress({
      stage: 'complete',
      currentPage: pageNum,
      totalPages: 1,
      message: `OCR complete for page ${pageNum}`,
      progress: 100
    });
  }, [activePipelineProfile, ensureDocumentId, ensureEngineReady, loadCachedOCR, normalizeLanguage, normalizedWarmLanguage, options.dpi, options.engine, options.language, options.pageSegMode, renderPageToCanvas, resolveRenderConstraints, setEngineWarmState, setIsProcessing, setPageOCR, setProgress, showDebugOverlay, startExternalProgress, stopExternalProgress]);

  /**
   * Start OCR processing
   */
  const handleCurrentPageOCR = useCallback(async (pageNum: number, force: boolean = false) => {
    if (!file || !fileUrl) {
      console.error('No file loaded');
      return;
    }

    if (ocrJobActiveRef.current) {
      console.warn('[OCRPanel] Ignored current-page OCR request while another OCR job is active');
      return;
    }

    try {
      console.log(`[OCRPanel] Starting current-page OCR for page ${pageNum} (force=${force})`);
      ocrJobActiveRef.current = true;
      suspendCacheReadsRef.current = true;
      const controller = beginAbortableJob();
      await runCurrentPageOCR(pageNum, force, controller);
    } catch (error) {
      if (isAbortError(error)) {
        setProgress({
          stage: 'complete',
          currentPage: pageNum,
          totalPages: 1,
          message: 'OCR canceled',
          progress: 0
        });
      } else {
        console.error('[OCRPanel] Current page OCR failed:', error);
        if ((options.engine || 'tesseract') !== 'tesseract' && shouldRecoverExternalEngine(error)) {
          recoverExternalEngine(
            options.engine || 'paddleocr',
            error instanceof Error ? error.message : 'External OCR failed - reloading model cache...'
          );
        }
        setProgress({
          stage: 'complete',
          currentPage: pageNum,
          totalPages: 1,
          message: `OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          progress: 0
        });
      }
    } finally {
      visionService.setProgressCallback(null);
      stopExternalProgress();
      ocrJobActiveRef.current = false;
      suspendCacheReadsRef.current = false;
      setIsProcessing(false);
    }
  }, [beginAbortableJob, file, fileUrl, isAbortError, options.engine, recoverExternalEngine, runCurrentPageOCR, setIsProcessing, setProgress, shouldRecoverExternalEngine, stopExternalProgress]);

  const handleStartOCR = useCallback(async (targetPages?: number[], forceReOCR: boolean = false) => {
    if (!file || !fileUrl) {
      console.error('No file loaded');
      return;
    }

    if (ocrJobActiveRef.current) {
      console.warn('[OCRPanel] Ignored batch OCR request while another OCR job is active');
      return;
    }

    try {
      console.log(`[OCRPanel] Starting batch OCR (forceReOCR=${forceReOCR}, targetPages=${targetPages?.join(',') || 'all'})`);
      const activeEngine = options.engine || 'tesseract';
      if (activeEngine !== 'tesseract') {
        const ready = await ensureEngineReady(activeEngine, { selectOnReady: false });
        if (!ready) {
          throw new Error(`${activeEngine} is not ready yet`);
        }
      }
      ocrJobActiveRef.current = true;
      suspendCacheReadsRef.current = true;
      const controller = beginAbortableJob();
      if (fileType !== 'pdf') {
        await runCurrentPageOCR(1, true, controller);
        return;
      }
      setIsProcessing(true);
      
      // Set initial progress (don't call reset() here!)
      setProgress({
        stage: 'init',
        currentPage: 0,
        totalPages: 0,
        message: 'กำลังเริ่มต้น...',
        progress: 0
      });

      // Set up progress callback
      searchablePDFService.setProgressCallback(setProgress);
      
      // Set up OCR result callback to store results for display
      searchablePDFService.setOCRResultCallback((pageNum, result) => {
        setPageOCR(pageNum, result);
        void (async () => {
          try {
            const activeFileNow = useProjectStore.getState().file;
            if (activeFileNow !== activeFile) return;
            const docId = await ensureDocumentId();
            if (!docId) return;
            const saved = await dbService.saveOCR(docId, pageNum, result);
            if (!saved) {
              console.warn(`[OCRPanel] Background cache persist failed for page ${pageNum} (docId=${docId})`);
            }
          } catch (error) {
            console.warn(`[OCRPanel] Background cache persist error for page ${pageNum}:`, error);
          }
        })();
      });
      const activeFile = file;
      searchablePDFService.setCacheHitCallback(forceReOCR ? null : (pageNum) => {
        if (useProjectStore.getState().file !== activeFile) return;
      });

      // Read file as ArrayBuffer
      const arrayBuffer = fileData
        ? fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength)
        : await file.arrayBuffer();
      pdfDataRef.current = arrayBuffer as ArrayBuffer;

      // Create searchable PDF (also performs OCR)
      const cacheDocId = await ensureDocumentId();
      const resultBytes = await searchablePDFService.createSearchablePDF(
        arrayBuffer as ArrayBuffer,
        options,
        (pageNum, dpi) => renderPageToCanvas(pageNum, dpi, {
          allowNavigationFallback: false,
          ...resolveRenderConstraints(options.engine),
        }),
        targetPages,
        cacheDocId ?? undefined,
        controller.signal,
        forceReOCR,
        showDebugOverlay,
        activePipelineProfile
      );
      void resultBytes;
      
      // Clear callback
      searchablePDFService.setOCRResultCallback(null);
      searchablePDFService.setCacheHitCallback(null);

    } catch (error) {
      if (isAbortError(error)) {
        searchablePDFService.setOCRResultCallback(null);
        searchablePDFService.setCacheHitCallback(null);
        setProgress({
          stage: 'complete',
          currentPage: 0,
          totalPages: 0,
          message: 'OCR canceled',
          progress: 0
        });
      } else {
        console.error('[OCRPanel] OCR processing failed:', error);
        if ((options.engine || 'tesseract') !== 'tesseract' && shouldRecoverExternalEngine(error)) {
          recoverExternalEngine(
            options.engine || 'paddleocr',
            error instanceof Error ? error.message : 'External OCR failed - reloading model cache...'
          );
        }
        searchablePDFService.setOCRResultCallback(null);
        searchablePDFService.setCacheHitCallback(null);
        setProgress({
          stage: 'complete',
          currentPage: 0,
          totalPages: 0,
          message: `OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          progress: 0
        });

      }
    } finally {
      searchablePDFService.setProgressCallback(null);
      ocrJobActiveRef.current = false;
      suspendCacheReadsRef.current = false;
      setIsProcessing(false);
    }
  }, [beginAbortableJob, ensureDocumentId, ensureEngineReady, file, fileData, fileType, fileUrl, isAbortError, options, recoverExternalEngine, renderPageToCanvas, resolveRenderConstraints, runCurrentPageOCR, setIsProcessing, setPageOCR, setProgress, shouldRecoverExternalEngine, showDebugOverlay]);

  /**
   * Download searchable PDF from cached OCR results
   */
  const handleDownloadFromCache = useCallback(async (mode: 'current' | 'all') => {
    if (!file || allPagesOCR.size === 0) return;

    const pageRange = mode === 'current' ? [currentPage] : undefined;
    if (mode === 'current' && !allPagesOCR.get(currentPage)) return;

    try {
      setIsExporting(true);
      const arrayBuffer = await file.arrayBuffer();
      const resultBytes = await searchablePDFService.createSearchablePDFWithOCR(
        arrayBuffer,
        allPagesOCR,
        pageRange
      );

      const url = URL.createObjectURL(new Blob([resultBytes.buffer as ArrayBuffer], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      const suffix = mode === 'current' ? `_page_${currentPage}_searchable.pdf` : '_searchable.pdf';
      a.download = file.name.replace('.pdf', suffix);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  }, [file, allPagesOCR, currentPage]);

  // Total OCR stats
  const totalOCRPages = allPagesOCR.size;
  const totalWords = Array.from(allPagesOCR.values()).reduce((sum, r) => sum + r.words.length, 0);
  const currentDroppedCount = currentPageOCR?.debug?.droppedWords?.length ?? 0;
  const currentDropSummary = currentPageOCR?.debug?.dropCounts
    ? Object.entries(currentPageOCR.debug.dropCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([filter, count]) => `${filter}:${count}`)
      .join(', ')
    : '';
  const currentStageSummary = currentPageOCR?.debug?.stageMetrics
    ? currentPageOCR.debug.stageMetrics
      .map((metric) => {
        const deltaWords = metric.wordsAfter - metric.wordsBefore;
        const deltaLines = metric.linesAfter - metric.linesBefore;
        const replacementSuffix = metric.replacements && metric.replacements > 0
          ? `/${metric.replacements}r`
          : '';
        return `${metric.stage}:${deltaWords >= 0 ? '+' : ''}${deltaWords}w/${deltaLines >= 0 ? '+' : ''}${deltaLines}l${replacementSuffix}`;
      })
      .join(', ')
    : '';
  const currentCandidateSummary = currentPageOCR?.debug?.candidates
    ? (() => {
      const rejected = currentPageOCR.debug.candidates.filter(candidate => !candidate.accepted);
      const accepted = currentPageOCR.debug.candidates.filter(candidate => candidate.accepted).length;
      const rejectReasons = rejected.reduce<Record<string, number>>((acc, candidate) => {
        const key = candidate.reason || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const topRejects = Object.entries(rejectReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => `${reason}:${count}`)
        .join(', ');
      if (!topRejects && accepted === 0) return '';
      return `candidates accepted:${accepted}${topRejects ? ` | reject ${topRejects}` : ''}`;
    })()
    : '';
  const currentSkipReason = currentPageOCR?.debug?.skipReason || '';
  const currentRuntimeMs = currentPageOCR?.debug?.runtimeMs
    ?? (currentPageOCR?.debug as { timingsMs?: { ocr?: number } } | undefined)?.timingsMs?.ocr;
  const currentRuntimeSecLabel = typeof currentRuntimeMs === 'number'
    ? `${(currentRuntimeMs / 1000).toFixed(currentRuntimeMs >= 10000 ? 1 : 2)}s`
    : '-';
  const currentEngine = OCR_ENGINES.find(engine => engine.id === (currentPageOCR?.ocrEngine || 'tesseract')) || OCR_ENGINES[0];

  return (
    <div className="space-y-3 p-4">
      {/* Language Selector (Multi-select) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-300">
          <Languages size={12} />
          OCR Languages
          </label>
          <div className="text-[11px] text-[#B68CFF] text-right">
            {options.language.split('+').filter(Boolean).map(code => {
            const found = SUPPORTED_LANGUAGES.find(l => l.code === code);
            return found ? found.name : code;
            }).join(' + ') || 'English'}
          </div>
        </div>
        <div className="max-h-36 overflow-y-auto border border-white/10 rounded-lg bg-slate-900/45 p-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {SUPPORTED_LANGUAGES.map(lang => {
            const selected = options.language.split('+').filter(Boolean).includes(lang.code);
            return (
              <label key={lang.code} className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer min-w-0">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={isProcessing}
                  onChange={() => {
                    const current = new Set(options.language.split('+').filter(Boolean));
                    if (current.has(lang.code)) {
                      current.delete(lang.code);
                    } else {
                      current.add(lang.code);
                    }
                    if (current.size === 0) {
                      current.add('eng');
                    }
                    const ordered = SUPPORTED_LANGUAGES
                      .map(l => l.code)
                      .filter(code => current.has(code));
                    setOptions({ language: ordered.join('+') });
                  }}
                  className="accent-[#2B9BFF]"
                />
                <span className="truncate">{lang.name}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* OCR Model Selector */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <Cpu size={12} />
          OCR Model
        </label>
        <div className="grid grid-cols-3 gap-2">
          {OCR_ENGINES.map((engine) => {
            const warmState = engine.id === 'tesseract'
              ? {
                  phase: 'ready' as EngineWarmPhase,
                  progress: 100,
                  runtime: engine.runtime,
                  description: engine.description,
                  etaSec: 0,
                }
              : engineWarmStates[engine.id] || {
                  phase: 'idle' as EngineWarmPhase,
                  progress: 0,
                  runtime: engine.runtime,
                  description: 'Click to check and warm this model',
                  etaSec: null,
                };
            const isCurrent = (options.engine || 'tesseract') === engine.id;
            const isBusy = warmState.phase === 'checking' || warmState.phase === 'warming';
            const isReady = warmState.phase === 'ready';
            const canSelect = engine.id === 'tesseract' || isReady;

            return (
              <button
                key={engine.id}
                type="button"
                disabled={isProcessing || isBusy}
                onClick={() => {
                  if (engine.id === 'tesseract') {
                    void ensureEngineReady('tesseract', { selectOnReady: true });
                    return;
                  }
                  if (canSelect) {
                    setOptions({ engine: engine.id });
                    return;
                  }
                  void ensureEngineReady(engine.id, { selectOnReady: true });
                }}
                title={warmState.description || engine.description}
                className={`relative overflow-hidden rounded-xl border px-2 py-2 text-left transition-all ${
                  isCurrent
                    ? 'border-[#5CC6F2]/70 bg-gradient-to-r from-[#2B9BFF]/25 to-[#2776FF]/20 shadow-[0_10px_24px_rgba(43,155,255,0.18)]'
                    : 'border-white/10 bg-slate-900/45 hover:border-white/20'
                } disabled:opacity-70`}
              >
                {isBusy && (
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#2B9BFF]/20 via-[#5CC6F2]/25 to-transparent transition-[width] duration-500"
                    style={{ width: `${warmState.progress}%` }}
                  />
                )}
                <div className="relative z-10 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-white">{engine.name}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-950/80 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        warmState.phase === 'ready'
                          ? 'bg-gradient-to-r from-emerald-400 to-emerald-300'
                          : warmState.phase === 'error'
                            ? 'bg-gradient-to-r from-rose-500 to-orange-400'
                            : 'bg-gradient-to-r from-[#2B9BFF] via-[#5CC6F2] to-[#89E6FF]'
                      }`}
                      style={{ width: `${Math.max(warmState.progress, warmState.phase === 'idle' ? 4 : 8)}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Progress Bar */}
      {isProcessing && (
        <div className="space-y-2 bg-slate-900/55 rounded-lg p-3 border border-white/10">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 truncate max-w-[180px]">
              {progress?.message || 'กำลังเริ่มต้น...'}
            </span>
            <span className="text-[#5CC6F2] font-mono">
              {progress ? Math.round(progress.progress) : 0}%
            </span>
          </div>
          <div className="h-2 bg-slate-950 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-[#2B9BFF] to-[#5CC6F2] transition-all duration-150"
              style={{ width: `${progress?.progress || 0}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>
              {progress?.stage === 'rendering' && '📄 Rendering...'}
              {progress?.stage === 'ocr' && '🔍 OCR Processing...'}
              {progress?.stage === 'text-layer' && '✍️ Adding Text...'}
              {progress?.stage === 'saving' && '💾 Saving...'}
              {!progress && '⏳ Initializing...'}
            </span>
            <span>
              {progress?.currentPage || 0} / {progress?.totalPages || '?'}
            </span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2">
        <div className="flex gap-2">
          {fileType === 'pdf' && (
            <button
              onClick={() => handleCurrentPageOCR(useProjectStore.getState().currentPage, true)}
              disabled={isProcessing || !file}
              className="flex-[0.32] bg-gradient-to-r from-[#7C5CFF]/88 to-[#9A6BFF]/82 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white py-1.5 rounded-lg flex items-center justify-center transition-all shadow-[0_5px_14px_rgba(124,92,255,0.18)] border border-[#A992FF]/35"
              title="Process current page only"
            >
              <span className="text-[10px] font-semibold">Current</span>
            </button>
          )}

          {/* Main Button */}
          <button
            onClick={() => handleStartOCR()}
            disabled={isProcessing || !file}
            className="flex-1 bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white py-1.5 rounded-lg font-semibold text-[10px] flex items-center justify-center gap-1.5 transition-all shadow-[0_5px_14px_rgba(43,155,255,0.24)]"
            title={fileType === 'pdf' ? 'Process all pages' : 'Process image'}
          >
            {isProcessing ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play size={14} fill="currentColor" />
                {fileType === 'pdf' ? 'All Pages' : 'Run OCR'}
              </>
            )}
          </button>
        </div>

        {fileType === 'pdf' && !isProcessing && (
          <button
            onClick={() => handleStartOCR(undefined, true)}
            disabled={!file}
            className="w-full bg-gradient-to-r from-[#FF8705] to-[#FF9A3D] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white py-1.5 rounded-lg font-semibold text-[10px] flex items-center justify-center gap-1.5 transition-all shadow-[0_5px_14px_rgba(255,135,5,0.2)]"
            title="Force re-run OCR for all pages (ignore cache)"
          >
            <RefreshCw size={13} />
            Re-OCR All (Ignore Cache)
          </button>
        )}

        {isProcessing && (
          <button
            onClick={cancelCurrentJob}
            className="w-full bg-red-600 hover:bg-red-500 text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
            title="Cancel OCR"
          >
            Cancel
          </button>
        )}

        {fileType === 'pdf' && totalOCRPages > 0 && !isProcessing && (
          <div className="flex gap-2">
            <button
              onClick={() => handleDownloadFromCache('current')}
              disabled={isExporting || !allPagesOCR.get(currentPage)}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-1.5 rounded-lg font-semibold text-[10px] flex items-center justify-center gap-1.5 transition-all shadow-[0_5px_14px_rgba(5,150,105,0.18)]"
              title="Download current page"
            >
              <Download size={13} />
              Current Page
            </button>
            <button
              onClick={() => handleDownloadFromCache('all')}
              disabled={isExporting}
              className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-1.5 rounded-lg font-semibold text-[10px] flex items-center justify-center gap-1.5 transition-all shadow-[0_5px_14px_rgba(34,197,94,0.18)]"
              title="Download all OCR pages"
            >
              <Download size={13} />
              All Pages
            </button>
          </div>
        )}
      </div>

      {/* OCR Results Preview */}
      {currentPageOCR && !isProcessing && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <Eye size={12} className="text-[#5CC6F2]" />
            OCR Result - หน้า {currentPage}
            <span className="ml-auto text-[11px] font-medium text-sky-300/95">
              {`runtime ${currentRuntimeSecLabel}`}
            </span>
          </div>
          <div className="rounded-lg border border-emerald-700/60 bg-emerald-900/20 px-3 py-2 text-[11px] text-emerald-300">
            model {currentEngine.name} • พบ {currentPageOCR.words.length} คำ • accuracy {currentPageOCR.confidence.toFixed(0)}%
          </div>
          {showDebugOverlay && currentDroppedCount > 0 && (
            <div className="text-[11px] text-orange-300 bg-orange-900/20 border border-orange-700/40 rounded px-2 py-1">
              dropped {currentDroppedCount} คำ{currentDropSummary ? ` (${currentDropSummary})` : ''}
            </div>
          )}
          {showDebugOverlay && currentStageSummary && (
            <div className="text-[11px] text-sky-200 bg-sky-900/20 border border-sky-700/40 rounded px-2 py-1">
              stages {currentStageSummary}
            </div>
          )}
          {showDebugOverlay && currentCandidateSummary && (
            <div className="text-[11px] text-fuchsia-200 bg-fuchsia-900/20 border border-fuchsia-700/40 rounded px-2 py-1">
              {currentCandidateSummary}
            </div>
          )}
          {showDebugOverlay && currentSkipReason && (
            <div className="text-[11px] text-amber-200 bg-amber-900/20 border border-amber-700/40 rounded px-2 py-1">
              skipReason {currentSkipReason}
            </div>
          )}
          
          <div className="bg-slate-900/55 border border-white/10 rounded-lg p-2 min-h-56 max-h-[40vh] overflow-y-auto">
            {currentPageOCR.words.length > 0 ? (
              <div className="space-y-1">
                {/* Show text grouped by lines for better readability */}
                {currentPageOCR.lines && currentPageOCR.lines.length > 0 ? (
                  currentPageOCR.lines.map((line, i) => (
                    <p key={i} className="text-xs text-slate-300 leading-relaxed">
                      {line.text}
                    </p>
                  ))
                ) : (
                  // Fallback: show words joined
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {currentPageOCR.words.map(w => w.text).join(' ')}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic text-center py-2">
                ไม่พบข้อความในหน้านี้
              </p>
            )}
          </div>
        </div>
      )}

      {/* Hidden canvas for rendering */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
