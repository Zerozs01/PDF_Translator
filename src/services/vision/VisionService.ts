/**
 * Enhanced Vision Service - Stable OCR & Smart Segmentation
 * 
 * Features:
 * - Request timeout & retry mechanism
 * - Queue-based processing (prevent overlapping requests)
 * - Smart region classification (text, balloon, sfx, panel)
 * - Error recovery
 */

import { Region, OCREngine, OCRLine, OCRPageResult, OCRPipelineProfile, OCRQualityProfile, OCRWord } from '../../types';
import { OCR_ALGORITHM_VERSION } from './ocrVersion';
import {
  OCR_WORKER_REQUEST_TIMEOUT_MS_DEFAULT,
  OCR_WORKER_RETRY_ATTEMPTS_DEFAULT,
  OCR_WORKER_RETRY_DELAY_MS_DEFAULT,
} from './ocr-timeout';

type WorkerMessage = {
  type: string;
  payload?: unknown;
  id: string;
};

type PendingRequest = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timestamp: number;
  workerIndex: number;
  timeoutId: ReturnType<typeof setTimeout>;
  request: QueuedRequest;
};

type QueuedRequest = {
  type: string;
  payload?: unknown;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  retryCount: number;
  signal?: AbortSignal;
  abortHandler?: () => void;
};

type WorkerMode = 'primary' | 'stable';

type WorkerSlot = {
  worker: Worker;
  busy: boolean;
  booted: boolean;
  mode: WorkerMode;
};

export type OCRProgressCallback = (progress: {
  status: string;
  progress: number;
  workerId?: string;
}) => void;

// Configuration
const getDefaultWorkerCount = (): number => {
  return 1;
};

const CONFIG = {
  REQUEST_TIMEOUT_MS: OCR_WORKER_REQUEST_TIMEOUT_MS_DEFAULT,
  RETRY_ATTEMPTS: OCR_WORKER_RETRY_ATTEMPTS_DEFAULT,
  RETRY_DELAY_MS: OCR_WORKER_RETRY_DELAY_MS_DEFAULT,
  HEALTH_CHECK_INTERVAL_MS: 30000,
  MAX_WORKERS: getDefaultWorkerCount(),
};

const createAbortError = (reason: string = 'OCR job canceled'): Error => {
  const error = new Error(reason);
  (error as Error & { name?: string }).name = 'AbortError';
  return error;
};

const EXTERNAL_PADDLE_CHUNK_MIN_HEIGHT = 5200;
const EXTERNAL_PADDLE_CHUNK_TARGET_HEIGHT = 2200;
const EXTERNAL_PADDLE_CHUNK_OVERLAP = 220;

const normalizeExternalDedupText = (text: string): string =>
  String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[|¦│┃￨︱︲]+/g, '')
    .toUpperCase();

const bboxCenterX = (bbox: OCRWord['bbox'] | OCRLine['bbox']): number => (bbox.x0 + bbox.x1) / 2;
const bboxCenterY = (bbox: OCRWord['bbox'] | OCRLine['bbox']): number => (bbox.y0 + bbox.y1) / 2;
const bboxWidth = (bbox: OCRWord['bbox'] | OCRLine['bbox']): number => Math.max(0, bbox.x1 - bbox.x0);
const bboxHeight = (bbox: OCRWord['bbox'] | OCRLine['bbox']): number => Math.max(0, bbox.y1 - bbox.y0);
const verticalOverlapRatio = (a: OCRWord['bbox'] | OCRLine['bbox'], b: OCRWord['bbox'] | OCRLine['bbox']): number => {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const minHeight = Math.max(1, Math.min(bboxHeight(a), bboxHeight(b)));
  return Math.max(0, overlap) / minHeight;
};

class VisionService {
  private workers: WorkerSlot[] = [];
  private workerCrashCounts: number[] = [];
  private workerVersion: number | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private progressCallback: OCRProgressCallback | null = null;
  private requestQueue: Array<QueuedRequest> = [];
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Will be initialized lazily
  }

  /**
   * Initialize worker pool with health monitoring
   */
  private initWorkers(): void {
    if (this.workers.length > 0 && this.workerVersion === OCR_ALGORITHM_VERSION) return;

    if (this.workers.length > 0 && this.workerVersion !== OCR_ALGORITHM_VERSION) {
      for (const slot of this.workers) {
        slot.worker.terminate();
      }
      this.workers = [];
      this.workerCrashCounts = [];
      this.pendingRequests.clear();
      this.requestQueue = [];
    }

    console.log(`[VisionService] Initializing ${CONFIG.MAX_WORKERS} worker(s)...`);
    this.workerVersion = OCR_ALGORITHM_VERSION;
    for (let i = 0; i < CONFIG.MAX_WORKERS; i++) {
      this.workers.push(this.createWorkerSlot(i));
      this.workerCrashCounts[i] = 0;
    }

    // Start health check
    this.startHealthCheck();
  }

  private createWorkerSlot(index: number, mode: WorkerMode = 'primary'): WorkerSlot {
    // Primary mode uses the boot loader which dynamically imports worker.ts
    // and falls back to worker-stable.ts on error with full error reporting.
    // Stable mode loads worker-stable.ts directly.
    const workerEntry = mode === 'stable' ? './worker-stable.ts' : './worker-boot.ts';
    const workerUrl = new URL(workerEntry, import.meta.url);
    workerUrl.searchParams.set('v', String(OCR_ALGORITHM_VERSION));
    const worker = new Worker(workerUrl, {
      type: 'module',
    });
    console.log(`[VisionService] Worker ${index} (${mode}) url=${workerUrl.toString()}`);
    if (typeof this.workerCrashCounts[index] !== 'number') this.workerCrashCounts[index] = 0;

    worker.onmessage = (e) => {
      this.handleWorkerMessage(index, e.data);
    };

    worker.onerror = (error) => {
      const errInfo = {
        message: error.message ?? '(no message)',
        filename: error.filename ?? '(no filename)',
        lineno: error.lineno ?? -1,
        colno: error.colno ?? -1,
        type: error.type ?? '(no type)',
        errorObj: error.error ?? null,
      };
      console.error(`[VisionService] Worker ${index} (${mode}) error:`, JSON.stringify(errInfo, null, 2));
      this.handleWorkerCrash(index, error);
    };

    return { worker, busy: false, booted: false, mode };
  }

  private recreateWorkerSlot(index: number, mode?: WorkerMode): void {
    const current = this.workers[index];
    const nextMode = mode ?? current?.mode ?? 'primary';
    if (current) {
      current.worker.terminate();
    }
    this.workers[index] = this.createWorkerSlot(index, nextMode);
  }

  /**
   * Handle incoming worker messages
   */
  private handleWorkerMessage(
    workerIndex: number,
    data: { type: string; id?: string; payload?: unknown; error?: string }
  ): void {
    const { type, id, payload, error } = data;

    // Handle progress updates
    if (type === 'OCR_PROGRESS' && this.progressCallback) {
      this.progressCallback(payload as { status: string; progress: number; workerId?: string });
      return;
    }

    // Handle boot status messages from worker-boot.ts
    if (type === 'WORKER_BOOT') {
      console.log(`[VisionService] Worker ${workerIndex} booted OK (primary pipeline active).`);
      if (this.workers[workerIndex]) {
        this.workers[workerIndex].booted = true;
      }
      this.workerCrashCounts[workerIndex] = 0;
      this.processQueue();
      return;
    }
    if (type === 'WORKER_BOOT_ERROR') {
      const info = payload as { message?: string; stack?: string; name?: string } | undefined;
      console.error(
        `[VisionService] Worker ${workerIndex} PRIMARY module failed to load!\n` +
        `  Error: ${info?.name || '(unknown)'}: ${info?.message || '(no message)'}\n` +
        `  Stack: ${info?.stack || '(no stack)'}\n` +
        `  → Worker will use STABLE fallback pipeline (already loaded by boot loader).`,
      );
      // Mark as stable mode since the boot loader already imported worker-stable.
      // Don't set booted=true yet — wait for the fallback WORKER_BOOT message.
      if (this.workers[workerIndex]) {
        this.workers[workerIndex].mode = 'stable';
      }
      this.workerCrashCounts[workerIndex] = 2;
      return;
    }

    // Find pending request
    if (!id) return;
    const pending = this.pendingRequests.get(id);
    if (!pending) return;

    // Handle response
    if (type === 'ERROR') {
      pending.reject(new Error(error || 'Unknown worker error'));
    } else {
      pending.resolve(payload);
    }

    clearTimeout(pending.timeoutId);
    pending.request.abortHandler?.();
    this.pendingRequests.delete(id);
    if (this.workers[workerIndex]) {
      this.workers[workerIndex].busy = false;
      if (this.workers[workerIndex].mode === 'primary') {
        this.workerCrashCounts[workerIndex] = 0;
      }
    }
      console.log(`[VisionService] Completed ${type} request ${id} from worker ${workerIndex}`);

    // Process next item(s) in queue
    this.processQueue();
  }

  /**
   * Handle worker crash - reject all pending and restart
   */
  private handleWorkerCrash(workerIndex: number, _error?: Event | ErrorEvent): void {
    const slot = this.workers[workerIndex];
    const currentMode = slot?.mode ?? 'primary';
    this.workerCrashCounts[workerIndex] = (this.workerCrashCounts[workerIndex] || 0) + 1;
    const crashCount = this.workerCrashCounts[workerIndex];
    const fallbackMode: WorkerMode = currentMode === 'primary'
      ? (crashCount >= 2 ? 'stable' : 'primary')
      : 'stable';
    console.warn(`[VisionService] Worker ${workerIndex} crashed in ${currentMode} mode; requeueing pending requests and switching to ${fallbackMode}...`);

    // Requeue pending requests assigned to this worker so OCR doesn't silently skip.
    for (const [id, pending] of this.pendingRequests) {
      if (pending.workerIndex !== workerIndex) continue;
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(id);

      if (pending.request.retryCount < CONFIG.RETRY_ATTEMPTS) {
        pending.request.retryCount += 1;
        this.requestQueue.unshift(pending.request);
      } else {
        pending.request.abortHandler?.();
        pending.reject(new Error(`Worker crashed repeatedly in ${currentMode} mode`));
      }
    }

    if (slot) {
      this.recreateWorkerSlot(workerIndex, fallbackMode);
    }

    this.processQueue();
  }

  /**
   * Health check - clean up stale requests
   */
  private startHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(() => {
      this.processQueue();
    }, CONFIG.HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Process request queue sequentially
   */
  private processQueue(): void {
    if (this.requestQueue.length === 0) return;

    for (let i = 0; i < this.workers.length; i++) {
      if (this.requestQueue.length === 0) break;
      if (this.workers[i].busy || !this.workers[i].booted) continue;

      const nextRequest = this.requestQueue.shift();
      if (!nextRequest) continue;

      this.dispatchRequest(i, nextRequest);
    }
  }

  private dispatchRequest(workerIndex: number, request: QueuedRequest): void {
    const { type, payload, resolve, reject } = request;
    const id = crypto.randomUUID();

    console.log(`[VisionService] Dispatching ${type} request ${id} to worker ${workerIndex}`);

    const timeoutId = setTimeout(() => {
      const pending = this.pendingRequests.get(id);
      if (!pending) return;

      console.warn(`[VisionService] Request ${id} timed out`);

      this.pendingRequests.delete(id);
      const slot = this.workers[workerIndex];
      if (slot) {
        slot.busy = false;
        this.recreateWorkerSlot(workerIndex, slot.mode);
      }

      if (request.retryCount < CONFIG.RETRY_ATTEMPTS) {
        console.warn(`[VisionService] Retry ${request.retryCount + 1}/${CONFIG.RETRY_ATTEMPTS} for ${type}`);
        request.retryCount += 1;
        setTimeout(() => {
          this.requestQueue.unshift(request);
          this.processQueue();
        }, CONFIG.RETRY_DELAY_MS);
      } else {
        request.abortHandler?.();
        reject(new Error(`Request timeout after ${CONFIG.RETRY_ATTEMPTS} retries`));
        this.processQueue();
      }
    }, CONFIG.REQUEST_TIMEOUT_MS);

    this.pendingRequests.set(id, {
      resolve,
      reject,
      timestamp: Date.now(),
      workerIndex,
      timeoutId,
      request
    });

    this.workers[workerIndex].busy = true;
    this.workers[workerIndex].worker.postMessage({ type, payload, id });
  }

  /**
   * Initialize OCR engine
   */
  public async initialize(): Promise<void> {
    return this.sendMessage('INIT', undefined, { skipQueue: true });
  }

  /**
   * Smart Segment Image - Enhanced region detection
   * 
   * For manga: Detects balloons, SFX, and text regions
   * For documents: Detects paragraphs and text blocks
   */
  public async segmentImage(
    imageUrl: string, 
    language: string = 'eng',
    documentType: 'manga' | 'document' = 'manga'
  ): Promise<Region[]> {
    return this.sendMessage('SEGMENT', { 
      imageUrl, 
      language,
      documentType,
    });
  }

  /**
   * Batch OCR - Process multiple pages efficiently
   */
  public async batchOCR(
    pages: Array<{ imageUrl: string; pageNumber: number }>,
    language: string = 'eng',
    onProgress?: (pageNum: number, total: number) => void
  ): Promise<OCRPageResult[]> {
    const results: OCRPageResult[] = [];
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      
      if (onProgress) {
        onProgress(page.pageNumber, pages.length);
      }
      
      try {
        // Get image dimensions from data URL
        const dimensions = await this.getImageDimensions(page.imageUrl);
        
        const result = await this.ocrForTextLayer(
          page.imageUrl,
          dimensions.width,
          dimensions.height,
          language,
          300
        );
        
        results.push({
          ...result,
          pageNumber: page.pageNumber,
        });
      } catch (error) {
        console.error(`[VisionService] Failed to OCR page ${page.pageNumber}:`, error);
        // Continue with other pages
      }
    }
    
    return results;
  }

  /**
   * Get image dimensions from data URL
   */
  private getImageDimensions(imageUrl: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.onerror = reject;
      img.src = imageUrl;
    });
  }

  /**
   * Set callback for OCR progress updates
   */
  public setProgressCallback(callback: OCRProgressCallback | null): void {
    this.progressCallback = callback;
  }

  private async readInputAsBytes(imageUrl: string | Blob): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const blob = typeof imageUrl === 'string'
      ? await (await fetch(imageUrl)).blob()
      : imageUrl;
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type || 'image/png',
    };
  }

  private isCjkOrThaiLanguage(language: string): boolean {
    return language
      .split('+')
      .map((code) => code.trim())
      .filter(Boolean)
      .some((code) => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));
  }

  private shouldChunkExternalOcr(
    engine: OCREngine,
    pipelineProfile: OCRPipelineProfile,
    width: number,
    height: number,
    language: string
  ): boolean {
    if (engine !== 'paddleocr') return false;
    if (pipelineProfile !== 'panel') return false;
    const languageCodes = language
      .split('+')
      .map((code) => code.trim())
      .filter(Boolean);
    const isKorean = languageCodes.includes('kor');
    if (!isKorean && this.isCjkOrThaiLanguage(language)) return false;
    const longest = Math.max(width, height);
    const shortest = Math.max(1, Math.min(width, height));
    const aspectRatio = longest / shortest;
    if (isKorean) {
      return height >= 6200 || aspectRatio >= 2.4;
    }
    return height >= EXTERNAL_PADDLE_CHUNK_MIN_HEIGHT || aspectRatio >= 2.3;
  }

  private async blobToPng(blob: Blob): Promise<{ bytes: Uint8Array; mimeType: string }> {
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type || 'image/png',
    };
  }

  private async canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Failed to encode OCR chunk image'));
      }, 'image/png');
    });
  }

  private offsetExternalWord(word: OCRWord, yOffset: number): OCRWord {
    return {
      ...word,
      bbox: {
        x0: word.bbox.x0,
        y0: word.bbox.y0 + yOffset,
        x1: word.bbox.x1,
        y1: word.bbox.y1 + yOffset,
      },
    };
  }

  private offsetExternalLine(line: OCRLine, yOffset: number): OCRLine {
    return {
      ...line,
      bbox: {
        x0: line.bbox.x0,
        y0: line.bbox.y0 + yOffset,
        x1: line.bbox.x1,
        y1: line.bbox.y1 + yOffset,
      },
      words: (line.words || []).map((word) => this.offsetExternalWord(word, yOffset)),
    };
  }

  private shouldMergeDuplicateExternalLine(existing: OCRLine, candidate: OCRLine): boolean {
    const existingText = normalizeExternalDedupText(existing.text);
    const candidateText = normalizeExternalDedupText(candidate.text);
    if (!existingText || !candidateText) return false;

    const sameOrSubset = existingText === candidateText
      || existingText.includes(candidateText)
      || candidateText.includes(existingText);
    if (!sameOrSubset) return false;

    const centerDeltaY = Math.abs(bboxCenterY(existing.bbox) - bboxCenterY(candidate.bbox));
    const centerDeltaX = Math.abs(bboxCenterX(existing.bbox) - bboxCenterX(candidate.bbox));
    const minHeight = Math.max(8, Math.min(bboxHeight(existing.bbox), bboxHeight(candidate.bbox)));
    const minWidth = Math.max(24, Math.min(bboxWidth(existing.bbox), bboxWidth(candidate.bbox)));
    const overlap = verticalOverlapRatio(existing.bbox, candidate.bbox);

    return (
      overlap >= 0.68
      || (
        centerDeltaY <= minHeight * 0.9
        && centerDeltaX <= minWidth * 0.6
      )
    );
  }

  private mergeExternalChunkResults(
    results: OCRPageResult[],
    width: number,
    height: number,
    dpi: number,
    language: string,
    pageSegMode: number | undefined,
    pipelineProfile: OCRPipelineProfile,
    ocrQualityProfile: OCRQualityProfile,
    ocrEngine: OCREngine
  ): OCRPageResult {
    const mergedLines: OCRLine[] = [];
    let runtimeMs = 0;
    const isPaddlePanel = ocrEngine === 'paddleocr' && pipelineProfile === 'panel';

    for (const result of results) {
      runtimeMs += (result.debug?.runtimeMs || 0);
      for (const line of result.lines || []) {
        const text = String(line.text || '').trim();
        if (!text) continue;
        const existingIndex = mergedLines.findIndex((existing) => {
          if (!isPaddlePanel) {
            return this.shouldMergeDuplicateExternalLine(existing, line);
          }

          const existingText = normalizeExternalDedupText(existing.text);
          const candidateText = normalizeExternalDedupText(line.text);
          if (!existingText || existingText != candidateText) return false;

          const overlap = verticalOverlapRatio(existing.bbox, line.bbox);
          const centerDeltaY = Math.abs(bboxCenterY(existing.bbox) - bboxCenterY(line.bbox));
          const minHeight = Math.max(8, Math.min(bboxHeight(existing.bbox), bboxHeight(line.bbox)));
          return overlap >= 0.82 || centerDeltaY <= minHeight * 0.45;
        });
        if (existingIndex < 0) {
          mergedLines.push(line);
          continue;
        }

        const existing = mergedLines[existingIndex];
        const candidateScore = text.length + (line.confidence || 0);
        const existingScore = String(existing.text || '').trim().length + (existing.confidence || 0);
        if (candidateScore > existingScore) {
          mergedLines[existingIndex] = line;
        }
      }
    }

    mergedLines.sort((a, b) => {
      if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
      return a.bbox.x0 - b.bbox.x0;
    });

    const mergedWords = mergedLines.flatMap((line) => line.words || []);
    const confidences = mergedWords.length > 0
      ? mergedWords.map((word) => word.confidence || 0)
      : mergedLines.map((line) => line.confidence || 0);
    const confidence = confidences.length > 0
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : 0;

    return {
      pageNumber: 0,
      width,
      height,
      dpi,
      language,
      pageSegMode,
      algorithmVersion: OCR_ALGORITHM_VERSION,
      pipelineProfile,
      ocrEngine,
      ocrQualityProfile,
      lines: mergedLines,
      words: mergedWords,
      text: mergedLines.map((line) => line.text).filter(Boolean).join('\n').trim(),
      confidence,
      debug: {
        droppedWords: [],
        dropCounts: {},
        runtimeMs,
      },
    };
  }

  private async runExternalOcrForTextLayer(
    imageUrl: string | Blob,
    imageWidth: number,
    imageHeight: number,
    language: string,
    dpi: number,
    pageSegMode: number | undefined,
    signal: AbortSignal | undefined,
    pipelineProfile: OCRPipelineProfile,
    ocrQualityProfile: OCRQualityProfile,
    ocrEngine: OCREngine
  ): Promise<OCRPageResult> {
    const bridge = window.electronAPI?.ocr;
    if (!bridge?.runExternal) {
      throw new Error(`External OCR engine "${ocrEngine}" is not available in this runtime`);
    }

    if (signal?.aborted) {
      throw createAbortError();
    }

    const onAbort = () => {
      void bridge.cancelExternal?.({ engine: ocrEngine }).catch(() => {
        // Best effort external OCR cancellation.
      });
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const { bytes, mimeType } = await this.readInputAsBytes(imageUrl);
      if (signal?.aborted) {
        throw createAbortError();
      }
      if (this.shouldChunkExternalOcr(ocrEngine, pipelineProfile, imageWidth, imageHeight, language)) {
        const sourceBytes = new Uint8Array(bytes.byteLength);
        sourceBytes.set(bytes);
        const sourceBlob = new Blob([sourceBytes], { type: mimeType || 'image/png' });
        const bitmap = await createImageBitmap(sourceBlob);
        let lastChunkError: Error | null = null;
        try {
          const chunkHeight = Math.min(
            Math.max(EXTERNAL_PADDLE_CHUNK_TARGET_HEIGHT, Math.round(bitmap.width * 1.05)),
            Math.max(EXTERNAL_PADDLE_CHUNK_TARGET_HEIGHT, Math.round(bitmap.height * 0.48)),
          );
          const overlap = Math.min(
            EXTERNAL_PADDLE_CHUNK_OVERLAP,
            Math.max(180, Math.round(chunkHeight * 0.12)),
          );
          const chunkResults: OCRPageResult[] = [];

          for (let yOffset = 0, index = 0; yOffset < bitmap.height; index += 1) {
            if (signal?.aborted) {
              throw createAbortError();
            }

            const actualHeight = Math.min(chunkHeight, bitmap.height - yOffset);
            const chunkCanvas = document.createElement('canvas');
            chunkCanvas.width = bitmap.width;
            chunkCanvas.height = actualHeight;
            const chunkCtx = chunkCanvas.getContext('2d', { alpha: false });
            if (!chunkCtx) {
              throw new Error('Cannot get canvas context for OCR chunk');
            }
            chunkCtx.fillStyle = '#FFFFFF';
            chunkCtx.fillRect(0, 0, chunkCanvas.width, chunkCanvas.height);
            chunkCtx.imageSmoothingEnabled = true;
            chunkCtx.imageSmoothingQuality = 'high';
            chunkCtx.drawImage(
              bitmap,
              0,
              yOffset,
              bitmap.width,
              actualHeight,
              0,
              0,
              bitmap.width,
              actualHeight,
            );

            const chunkBlob = await this.canvasToPngBlob(chunkCanvas);
            const chunkImage = await this.blobToPng(chunkBlob);
            let result;
            try {
              result = await bridge.runExternal({
                engine: ocrEngine,
                imageData: chunkImage.bytes,
                imageMimeType: chunkImage.mimeType,
                imageWidth: bitmap.width,
                imageHeight: actualHeight,
                language,
                dpi,
                pageSegMode,
                pipelineProfile,
                ocrQualityProfile,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (message.includes('No text boxes returned from PaddleOCR')) {
                lastChunkError = error instanceof Error ? error : new Error(message);
                continue;
              }
              throw error;
            }

            chunkResults.push({
              pageNumber: 0,
              width: bitmap.width,
              height: actualHeight,
              dpi,
              language,
              pageSegMode: result.pageSegMode ?? pageSegMode,
              algorithmVersion: OCR_ALGORITHM_VERSION,
              pipelineProfile,
              ocrEngine,
              ocrQualityProfile,
              lines: (result.lines || []).map((line) => this.offsetExternalLine(line, yOffset)),
              words: [],
              text: result.text || '',
              confidence: typeof result.confidence === 'number' ? result.confidence : 0,
              debug: result.debug,
            });

            if (yOffset + actualHeight >= bitmap.height) {
              break;
            }
            yOffset += Math.max(1, actualHeight - overlap);
          }

          if (chunkResults.length > 0) {
            return this.mergeExternalChunkResults(
              chunkResults,
              imageWidth,
              imageHeight,
              dpi,
              language,
              pageSegMode,
              pipelineProfile,
              ocrQualityProfile,
              ocrEngine,
            );
          }

          if (lastChunkError) {
            throw lastChunkError;
          }
        } finally {
          bitmap.close?.();
        }
      }

      const result = await bridge.runExternal({
        engine: ocrEngine,
        imageData: bytes,
        imageMimeType: mimeType,
        imageWidth,
        imageHeight,
        language,
        dpi,
        pageSegMode,
        pipelineProfile,
        ocrQualityProfile,
      });

      return {
        pageNumber: 0,
        width: imageWidth,
        height: imageHeight,
        dpi,
        language,
        pageSegMode: result.pageSegMode ?? pageSegMode,
        algorithmVersion: OCR_ALGORITHM_VERSION,
        pipelineProfile,
        ocrEngine,
        ocrQualityProfile,
        lines: result.lines || [],
        words: result.words || [],
        text: result.text || '',
        confidence: typeof result.confidence === 'number' ? result.confidence : 0,
        debug: result.debug,
      };
    } catch (error) {
      if (signal?.aborted) {
        throw createAbortError();
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * OCR for Text Layer Overlay
   * Returns word-level bounding boxes for precise text positioning
   */
  public async ocrForTextLayer(
    imageUrl: string | Blob,
    imageWidth: number,
    imageHeight: number,
    language: string = 'eng',
    dpi: number = 300,
    pageSegMode?: number,
    signal?: AbortSignal,
    debugCollectDrops: boolean = false,
    pipelineProfile: OCRPipelineProfile = 'panel',
    ocrQualityProfile: OCRQualityProfile = 'best',
    ocrEngine: OCREngine = 'tesseract'
  ): Promise<OCRPageResult> {
    if (ocrEngine !== 'tesseract') {
      return this.runExternalOcrForTextLayer(
        imageUrl,
        imageWidth,
        imageHeight,
        language,
        dpi,
        pageSegMode,
        signal,
        pipelineProfile,
        ocrQualityProfile,
        ocrEngine
      );
    }

    return this.sendMessage('OCR_FOR_TEXT_LAYER', {
      imageUrl,
      imageWidth,
      imageHeight,
      language,
      dpi,
      pageSegMode,
      debugCollectDrops,
      pipelineProfile,
      ocrQualityProfile,
      ocrEngine
    }, { signal });
  }

  /**
   * Send message to worker with timeout & retry
   */
  private async sendMessage<T>(
    type: string, 
    payload?: unknown,
    options: { skipQueue?: boolean; retryCount?: number; signal?: AbortSignal } = {}
  ): Promise<T> {
    const { skipQueue = false, retryCount = 0, signal } = options;

    // Ensure worker is initialized
    this.initWorkers();

    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }

      const request: QueuedRequest = {
        type,
        payload,
        resolve: resolve as (data: unknown) => void,
        reject,
        retryCount,
        signal
      };

      if (signal) {
        const onAbort = () => {
          const abortError = createAbortError();
          // Remove from queue if not dispatched
          const queuedIndex = this.requestQueue.indexOf(request);
          if (queuedIndex >= 0) {
            this.requestQueue.splice(queuedIndex, 1);
            request.abortHandler?.();
            request.reject(abortError);
            this.processQueue();
            return;
          }

          // Remove from pending if dispatched
          for (const [id, pending] of this.pendingRequests) {
            if (pending.request !== request) continue;
            clearTimeout(pending.timeoutId);
            pending.request.abortHandler?.();
            pending.reject(abortError);
            this.pendingRequests.delete(id);
            const slot = this.workers[pending.workerIndex];
            if (slot) {
              this.recreateWorkerSlot(pending.workerIndex, slot.mode);
            }
            this.processQueue();
            return;
          }
        };

        signal.addEventListener('abort', onAbort, { once: true });
        request.abortHandler = () => {
          signal.removeEventListener('abort', onAbort);
        };
      }

      if (skipQueue) {
        this.requestQueue.unshift(request);
      } else {
        this.requestQueue.push(request);
      }

      this.processQueue();
    });
  }

  /**
   * Check if service is currently processing
   */
  public isBusy(): boolean {
    return this.pendingRequests.size > 0 || this.requestQueue.length > 0;
  }

  /**
   * Get queue length
   */
  public getQueueLength(): number {
    return this.requestQueue.length;
  }

  /**
   * Cancel all queued and pending OCR requests
   */
  public cancelAll(reason: string = 'OCR job canceled'): void {
    const abortError = createAbortError(reason);

    // Reject queued requests
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      if (!request) continue;
      request.abortHandler?.();
      request.reject(abortError);
    }

    // Reject pending requests and reset workers
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.request.abortHandler?.();
      pending.reject(abortError);
      this.pendingRequests.delete(id);
      const slot = this.workers[pending.workerIndex];
      if (slot) {
        this.recreateWorkerSlot(pending.workerIndex, slot.mode);
      }
    }

    this.processQueue();
  }

  /**
   * Terminate worker and cleanup
   */
  public terminate(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    // Reject all pending
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error('Service terminated'));
    }
    this.pendingRequests.clear();
    this.requestQueue = [];
    
    for (const slot of this.workers) {
      slot.worker.terminate();
    }
    this.workers = [];
  }
}

export const visionService = new VisionService();
