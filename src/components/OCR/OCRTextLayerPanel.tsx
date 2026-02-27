/**
 * OCRTextLayerPanel - UI สำหรับสร้าง Searchable PDF ด้วย OCR
 * 
 * Features:
 * - เลือกภาษา OCR
 * - เลือก Quality Profile (DPI)
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
  CheckCircle,
  Eye
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { OCRPageResult } from '../../types';
import { useOCRTextLayerStore, SUPPORTED_LANGUAGES } from '../../stores/useOCRTextLayerStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { searchablePDFService } from '../../services/pdf';
import { dbService } from '../../services/dbService';
import { visionService } from '../../services/vision/VisionService';
import { OCR_ALGORITHM_VERSION } from '../../services/vision/ocrVersion';
import { pdfjs } from '../../services/pdf/pdfjsWorker';

// PDF.js worker is configured via pdfjsWorker

export const OCRTextLayerPanel: React.FC = () => {
  const { file, fileUrl, fileData, fileType, currentPage, ensureDocumentId } = useProjectStore();
  const {
    options,
    setOptions,
    isProcessing,
    progress,
    setProgress,
    setIsProcessing,
    setPageOCR,
    allPagesOCR,
    showDebugOverlay,
    setShowDebugOverlay
  } = useOCRTextLayerStore();

  const [isExporting, setIsExporting] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<{ page: number; source: 'memory' | 'db'; stale?: boolean } | null>(null);
  const autoSyncedDocRef = useRef<number | null>(null);
  const persistedCacheRef = useRef<Map<string, string>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const pdfLoadingRef = useRef<Promise<PDFDocumentProxy> | null>(null);
  const fileRef = useRef<File | null>(null);
  const pdfDataRef = useRef<ArrayBuffer | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const isAbortError = useCallback(
    (error: unknown): boolean => error instanceof Error && error.name === 'AbortError',
    []
  );

  useEffect(() => {
    return () => {
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
      pdfLoadingRef.current = null;
      fileRef.current = null;
      pdfDataRef.current = null;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Keep OCR overlay enabled by default and lock it on for this workflow.
    if (!showDebugOverlay) {
      setShowDebugOverlay(true);
    }
  }, [showDebugOverlay, setShowDebugOverlay]);

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
      pdfDataRef.current = data;
      const loadingTask = pdfjs.getDocument({ data });
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
    return true;
  }, [options, normalizeLanguage]);

  // UI preview can show stale algorithm cache (marked as stale in badge) to avoid blank panel
  // while still requiring language match.
  const isDisplayCacheCompatible = useCallback((cached: OCRPageResult): boolean => {
    return normalizeLanguage(cached.language) === normalizeLanguage(options.language);
  }, [normalizeLanguage, options.language]);

  const loadCachedOCR = useCallback(async (pageNum: number): Promise<boolean> => {
    setCacheStatus(null);
    const activeFile = file;
    const state = useOCRTextLayerStore.getState();
    const memoryCached = state.allPagesOCR.get(pageNum);
    if (memoryCached && isDisplayCacheCompatible(memoryCached)) {
      if (useProjectStore.getState().file !== activeFile) return false;
      setPageOCR(pageNum, memoryCached);
      const stale = !isCacheCompatible(memoryCached);
      setCacheStatus({ page: pageNum, source: 'memory', stale });
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
      const stale = !isCacheCompatible(cached);
      setCacheStatus({ page: pageNum, source: 'db', stale });
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
        const stale = !isCacheCompatible(aliasCached);
        setCacheStatus({ page: pageNum, source: 'db', stale });

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
  }, [file, isCacheCompatible, isDisplayCacheCompatible, ensureDocumentId, setPageOCR]);

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
    const latestLang = normalizeLanguage(latestOCR.language || 'eng');
    const currentLang = normalizeLanguage(options.language || 'eng');
    const nextPatch: Partial<typeof options> = {};

    if (latestLang && latestLang !== currentLang) {
      nextPatch.language = latestLang;
    }
    if (typeof latestOCR.dpi === 'number' && latestOCR.dpi > 0 && latestOCR.dpi !== options.dpi) {
      nextPatch.dpi = latestOCR.dpi;
    }
    if (latestOCR.pageSegMode !== options.pageSegMode) {
      nextPatch.pageSegMode = latestOCR.pageSegMode;
    }

    if (Object.keys(nextPatch).length > 0) {
      setOptions(nextPatch);
    }
  }, [ensureDocumentId, file, normalizeLanguage, options.dpi, options.language, options.pageSegMode, setOptions]);

  const beginAbortableJob = useCallback(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return controller;
  }, []);

  const cancelCurrentJob = useCallback(() => {
    abortControllerRef.current?.abort();
    visionService.cancelAll('OCR job canceled');
  }, []);

  useEffect(() => {
    if (!file) return;
    void loadCachedOCR(currentPage);
  }, [file, currentPage, options.language, options.dpi, options.pageSegMode, loadCachedOCR]);

  useEffect(() => {
    autoSyncedDocRef.current = null;
    persistedCacheRef.current.clear();
  }, [file]);

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
        const fp = `${result.algorithmVersion}|${result.dpi}|${normalizeLanguage(result.language)}|${result.words.length}|${result.text.length}`;
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

  /**
   * Render PDF page to canvas at specified DPI
   * 
   * Strategy:
   * 1) Render directly with pdf.js at target DPI (best OCR accuracy)
   * 2) Fallback to existing react-pdf canvas if pdf.js render fails
   */
  const renderImageToCanvas = useCallback(async () => {
    if (!file) throw new Error('No image loaded');
    const imageBlob = fileData
      ? new Blob([fileData], { type: file.type || 'image/png' })
      : file;

    const imageBitmap = await createImageBitmap(imageBlob);
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = imageBitmap.width;
    outputCanvas.height = imageBitmap.height;
    const ctx = outputCanvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Cannot get canvas context');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imageBitmap, 0, 0);
    imageBitmap.close?.();
    return {
      canvas: outputCanvas,
      width: outputCanvas.width,
      height: outputCanvas.height
    };
  }, [file, fileData]);

  const renderPageToCanvas = useCallback(async (pageNum: number, targetDpi: number) => {
    if (!file) throw new Error('No PDF loaded');
    if (fileType !== 'pdf') {
      return renderImageToCanvas();
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

        const outputWidth = Math.round(currentWidth * scaleFactor);
        const outputHeight = Math.round(currentHeight * scaleFactor);

        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = outputWidth;
        outputCanvas.height = outputHeight;
        const ctx = outputCanvas.getContext('2d');

        if (!ctx) throw new Error('Cannot get canvas context');

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, outputWidth, outputHeight);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(existingCanvas, 0, 0, outputWidth, outputHeight);

        return {
          canvas: outputCanvas,
          width: outputWidth,
          height: outputHeight
        };
      }

      // Navigate to the page and wait for canvas to appear (legacy fallback)
      console.log(`[OCRPanel] Navigating to page ${pageNum} and waiting for canvas...`);

      const { setPage } = useProjectStore.getState();
      const previousPage = useProjectStore.getState().currentPage;

      setPage(pageNum);

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

          const outputWidth = Math.round(currentWidth * scaleFactor);
          const outputHeight = Math.round(currentHeight * scaleFactor);

          const outputCanvas = document.createElement('canvas');
          outputCanvas.width = outputWidth;
          outputCanvas.height = outputHeight;
          const ctx = outputCanvas.getContext('2d');

          if (!ctx) throw new Error('Cannot get canvas context');

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, outputWidth, outputHeight);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(newCanvas, 0, 0, outputWidth, outputHeight);

          return {
            canvas: outputCanvas,
            width: outputWidth,
            height: outputHeight
          };
        }
      }

      setPage(previousPage);
      throw new Error(`Timeout waiting for page ${pageNum} canvas to render`);
    };

    try {
      const pdfDoc = await getPdfDoc();
      const page = await pdfDoc.getPage(pageNum);
      const scale = targetDpi / 72;
      const viewport = page.getViewport({ scale });

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = Math.floor(viewport.width);
      outputCanvas.height = Math.floor(viewport.height);

      const ctx = outputCanvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Cannot get canvas context');

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

      const renderTask = page.render({ canvasContext: ctx, viewport, intent: 'print' });
      await renderTask.promise;

      return {
        canvas: outputCanvas,
        width: outputCanvas.width,
        height: outputCanvas.height
      };
    } catch (error) {
      console.warn('[OCRPanel] pdf.js render failed, falling back to existing canvas:', error);
      return renderFromExistingCanvas();
    }
  }, [file, fileType, getPdfDoc, renderImageToCanvas]);

  /**
   * Start OCR processing
   */
  const handleCurrentPageOCR = useCallback(async (pageNum: number, force: boolean = false) => {
    if (!file || !fileUrl) {
      console.error('No file loaded');
      return;
    }

    try {
      const controller = beginAbortableJob();
      setCacheStatus(null);
      if (!force) {
        const loaded = await loadCachedOCR(pageNum);
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

      const { canvas, width: imageWidth, height: imageHeight } = await renderPageToCanvas(pageNum, options.dpi);

      const imageBlob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to convert canvas to Blob'));
        }, 'image/png');
      });

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

      const ocrResult = await visionService.ocrForTextLayer(
        imageBlob,
        imageWidth,
        imageHeight,
        options.language,
        options.dpi,
        options.pageSegMode,
        controller.signal,
        showDebugOverlay
      );
      visionService.setProgressCallback(null);

      ocrResult.language = normalizeLanguage(options.language);
      ocrResult.pageNumber = pageNum;
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
      setIsProcessing(false);
    }
  }, [file, fileUrl, options, renderPageToCanvas, ensureDocumentId, setIsProcessing, setProgress, setPageOCR, loadCachedOCR, beginAbortableJob, isAbortError, showDebugOverlay]);

  const handleStartOCR = useCallback(async (targetPages?: number[], forceReOCR: boolean = false) => {
    if (!file || !fileUrl) {
      console.error('No file loaded');
      return;
    }

    try {
      const controller = beginAbortableJob();
      setCacheStatus(null);
      if (fileType !== 'pdf') {
        await handleCurrentPageOCR(1, true);
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
      searchablePDFService.setCacheHitCallback((pageNum) => {
        if (useProjectStore.getState().file !== activeFile) return;
        if (pageNum === useProjectStore.getState().currentPage) {
          setCacheStatus({ page: pageNum, source: 'db' });
        }
      });

      // Read file as ArrayBuffer
      const arrayBuffer = fileData
        ? fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength)
        : await file.arrayBuffer();
      pdfDataRef.current = arrayBuffer;

      // Create searchable PDF (also performs OCR)
      const cacheDocId = await ensureDocumentId();
      const resultBytes = await searchablePDFService.createSearchablePDF(
        arrayBuffer,
        options,
        renderPageToCanvas,
        targetPages,
        cacheDocId ?? undefined,
        controller.signal,
        forceReOCR,
        showDebugOverlay
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
      setIsProcessing(false);
    }
  }, [file, fileUrl, fileData, fileType, options, renderPageToCanvas, setIsProcessing, setProgress, setPageOCR, ensureDocumentId, beginAbortableJob, isAbortError, handleCurrentPageOCR, showDebugOverlay]);

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

  return (
    <div className="space-y-3 p-4">
      {/* Language Selector (Multi-select) */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <Languages size={12} />
          OCR Languages
        </label>
        <div className="text-[10px] text-slate-500">
          Selected: {options.language.split('+').filter(Boolean).map(code => {
            const found = SUPPORTED_LANGUAGES.find(l => l.code === code);
            return found ? found.name : code;
          }).join(' + ') || 'English'}
        </div>
        <div className="max-h-36 overflow-y-auto border border-white/10 rounded-lg bg-slate-900/45 p-2 space-y-1">
          {SUPPORTED_LANGUAGES.map(lang => {
            const selected = options.language.split('+').filter(Boolean).includes(lang.code);
            return (
              <label key={lang.code} className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
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
                <span>{lang.name}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Skip OCR if Text Exists (PDF only) */}
      {fileType === 'pdf' && (
        <div className="flex items-center justify-between bg-slate-900/45 border border-white/10 rounded-lg px-3 py-2">
          <span className="text-xs text-slate-300">Skip OCR if Text Exists</span>
          <input
            type="checkbox"
            checked={options.skipIfTextExists !== false}
            onChange={(e) => setOptions({ skipIfTextExists: e.target.checked })}
            disabled={isProcessing}
            className="accent-[#2B9BFF]"
            aria-label="Skip OCR if Text Exists"
          />
        </div>
      )}

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

      {cacheStatus && cacheStatus.page === currentPage && !isProcessing && (
        <div className="text-xs text-emerald-300 bg-emerald-900/25 border border-emerald-700/70 rounded-lg px-3 py-2">
          Loaded from cache ({cacheStatus.source === 'memory' ? 'memory' : 'disk'}{cacheStatus.stale ? ', stale' : ''})
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-2">
        <div className="flex gap-2">
          {/* Main Button */}
          <button
            onClick={() => handleStartOCR()}
            disabled={isProcessing || !file}
            className="flex-1 bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-[0_10px_24px_rgba(43,155,255,0.35)]"
            title={fileType === 'pdf' ? 'Process all pages' : 'Process image'}
          >
            {isProcessing ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play size={16} fill="currentColor" />
                {fileType === 'pdf' ? 'All Pages' : 'Run OCR'}
              </>
            )}
          </button>

          {/* Current Page Button (PDF only) */}
          {fileType === 'pdf' && (
            <button
              onClick={() => handleCurrentPageOCR(useProjectStore.getState().currentPage, true)}
              disabled={isProcessing || !file}
              className="flex-[0.35] bg-slate-900/70 hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg flex items-center justify-center transition-all shadow-lg border border-white/12"
              title="Process current page only"
            >
              <span className="text-xs font-bold">Current</span>
            </button>
          )}
        </div>

        {fileType === 'pdf' && !isProcessing && (
          <button
            onClick={() => handleStartOCR(undefined, true)}
            disabled={!file}
            className="w-full bg-gradient-to-r from-[#FF8705] to-[#FF9A3D] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-[0_10px_24px_rgba(255,135,5,0.28)]"
            title="Force re-run OCR for all pages (ignore cache)"
          >
            <RefreshCw size={16} />
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
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
              title="Download current page"
            >
              <Download size={16} />
              Current Page
            </button>
            <button
              onClick={() => handleDownloadFromCache('all')}
              disabled={isExporting}
              className="flex-1 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
              title="Download all OCR pages"
            >
              <Download size={16} />
              All Pages
            </button>
          </div>
        )}
      </div>

      {/* Success Message */}
      {totalOCRPages > 0 && !isProcessing && (
        <div className="flex items-start gap-2 bg-green-900/25 border border-green-700/70 rounded-lg p-3">
          <CheckCircle size={16} className="text-green-400 shrink-0 mt-0.5" />
          <div className="text-xs">
            <p className="text-green-300 font-medium">OCR สำเร็จ!</p>
            <p className="text-green-400/70 mt-1">
              OCR {totalOCRPages} หน้า • พบ {totalWords} คำ
            </p>
          </div>
        </div>
      )}

      {/* OCR Results Preview */}
      {currentPageOCR && !isProcessing && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <Eye size={12} className="text-[#5CC6F2]" />
            OCR Result - หน้า {currentPage}
            <span className="ml-auto text-slate-500 font-normal">
              {currentPageOCR.words.length} คำ • {currentPageOCR.confidence.toFixed(0)}%
            </span>
          </div>
          {showDebugOverlay && currentDroppedCount > 0 && (
            <div className="text-[11px] text-orange-300 bg-orange-900/20 border border-orange-700/40 rounded px-2 py-1">
              dropped {currentDroppedCount} คำ{currentDropSummary ? ` (${currentDropSummary})` : ''}
            </div>
          )}
          
          <div className="bg-slate-900/55 border border-white/10 rounded-lg p-2 max-h-48 overflow-y-auto">
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
