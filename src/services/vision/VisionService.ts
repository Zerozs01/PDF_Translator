/**
 * Enhanced Vision Service - Stable OCR & Smart Segmentation
 * 
 * Features:
 * - Request timeout & retry mechanism
 * - Queue-based processing (prevent overlapping requests)
 * - Smart region classification (text, balloon, sfx, panel)
 * - Error recovery
 */

import { Region, OCREngine, OCRDroppedWord, OCRLine, OCRPageResult, OCRPipelineProfile, OCRQualityProfile, OCRWord } from '../../types';
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
    .replace(/[.,!?;:'"`~^]+/g, '')
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

const horizontalOverlapRatio = (a: OCRWord['bbox'] | OCRLine['bbox'], b: OCRWord['bbox'] | OCRLine['bbox']): number => {
  const overlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const minWidth = Math.max(1, Math.min(bboxWidth(a), bboxWidth(b)));
  return Math.max(0, overlap) / minWidth;
};

const horizontalContainmentRatio = (inner: OCRWord['bbox'] | OCRLine['bbox'], outer: OCRWord['bbox'] | OCRLine['bbox']): number => {
  const innerWidth = Math.max(1, bboxWidth(inner));
  const overlap = Math.min(inner.x1, outer.x1) - Math.max(inner.x0, outer.x0);
  return Math.max(0, overlap) / innerWidth;
};

const bboxArea = (bbox: OCRWord['bbox'] | OCRLine['bbox']): number =>
  Math.max(1, bboxWidth(bbox) * bboxHeight(bbox));

const bboxIoURatio = (a: OCRWord['bbox'] | OCRLine['bbox'], b: OCRWord['bbox'] | OCRLine['bbox']): number => {
  const overlapWidth = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const overlapHeight = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const intersection = overlapWidth * overlapHeight;
  if (intersection <= 0) return 0;

  const union = bboxArea(a) + bboxArea(b) - intersection;
  return union > 0 ? (intersection / union) : 0;
};

const normalizeMultilingualToken = (text: string): string =>
  String(text || '').replace(/[^A-Za-z0-9\uAC00-\uD7A3]+/g, '').toUpperCase();

const hasHangulChars = (text: string): boolean => /[\uAC00-\uD7A3]/.test(String(text || ''));

const normalizeKoreanDedupToken = (text: string): string => {
  const normalized = normalizeMultilingualToken(text);
  const hangulOnly = normalized.replace(/[^\uAC00-\uD7A3]+/g, '');
  return hangulOnly || normalized;
};

const buildBigrams = (value: string): Set<string> => {
  const compact = String(value || '').trim();
  const grams = new Set<string>();
  if (!compact) return grams;
  if (compact.length === 1) {
    grams.add(compact);
    return grams;
  }
  for (let i = 0; i < compact.length - 1; i += 1) {
    grams.add(compact.slice(i, i + 2));
  }
  return grams;
};

const diceSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aBigrams = buildBigrams(a);
  const bBigrams = buildBigrams(b);
  if (aBigrams.size === 0 || bBigrams.size === 0) return 0;

  let overlap = 0;
  for (const gram of aBigrams) {
    if (bBigrams.has(gram)) overlap += 1;
  }

  return (2 * overlap) / (aBigrams.size + bBigrams.size);
};

const boundedLevenshteinDistance = (a: string, b: string, maxDistance: number): number => {
  if (a === b) return 0;
  if (maxDistance < 0) return Number.MAX_SAFE_INTEGER;

  const lenA = a.length;
  const lenB = b.length;
  if (Math.abs(lenA - lenB) > maxDistance) {
    return maxDistance + 1;
  }

  let prev = new Array<number>(lenB + 1);
  let curr = new Array<number>(lenB + 1);
  for (let j = 0; j <= lenB; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= lenA; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];

    for (let j = 1; j <= lenB; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
      if (curr[j] < rowMin) {
        rowMin = curr[j];
      }
    }

    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }

    [prev, curr] = [curr, prev];
  }

  return prev[lenB];
};

const isCjkLikeLanguage = (language: string): boolean =>
  String(language || '')
    .split('+')
    .map((code) => code.trim())
    .filter(Boolean)
    .some((code) => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));

const EXTERNAL_SINGLETON_CJK_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/;

const EXTERNAL_LATIN_DOMAIN_TAIL_TOKENS = new Set(['IO', 'LO', 'COM']);

const normalizeExternalLatinToken = (value: string): string =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S');

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
    const lineWithHints = line as OCRLine & { _sortY?: number; _sortX?: number };
    return {
      ...lineWithHints,
      bbox: {
        x0: line.bbox.x0,
        y0: line.bbox.y0 + yOffset,
        x1: line.bbox.x1,
        y1: line.bbox.y1 + yOffset,
      },
      words: (line.words || []).map((word) => this.offsetExternalWord(word, yOffset)),
      ...(typeof lineWithHints._sortY === 'number' ? { _sortY: lineWithHints._sortY + yOffset } : {}),
      ...(typeof lineWithHints._sortX === 'number' ? { _sortX: lineWithHints._sortX } : {}),
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

  private shouldMergePaddlePanelDuplicateExternalLine(
    existing: OCRLine,
    candidate: OCRLine,
    languageCodes: string[]
  ): boolean {
    const existingText = normalizeExternalDedupText(existing.text);
    const candidateText = normalizeExternalDedupText(candidate.text);
    if (!existingText || !candidateText) return false;

    const existingToken = normalizeExternalLatinToken(existingText);
    const candidateToken = normalizeExternalLatinToken(candidateText);
    const exactTokenMatch = Boolean(existingToken && candidateToken && existingToken === candidateToken);

    const overlapY = verticalOverlapRatio(existing.bbox, candidate.bbox);
    const overlapX = horizontalOverlapRatio(existing.bbox, candidate.bbox);
    const iou = bboxIoURatio(existing.bbox, candidate.bbox);
    const centerDeltaY = Math.abs(bboxCenterY(existing.bbox) - bboxCenterY(candidate.bbox));
    const centerDeltaX = Math.abs(bboxCenterX(existing.bbox) - bboxCenterX(candidate.bbox));
    const minHeight = Math.max(8, Math.min(bboxHeight(existing.bbox), bboxHeight(candidate.bbox)));
    const minWidth = Math.max(24, Math.min(bboxWidth(existing.bbox), bboxWidth(candidate.bbox)));
    const existingArea = Math.max(1, bboxArea(existing.bbox));
    const candidateArea = Math.max(1, bboxArea(candidate.bbox));
    const areaRatio = existingArea / candidateArea;
    const nearSizeMatch = areaRatio >= 0.64 && areaRatio <= 1.56;

    const sameOrSubset = existingText === candidateText
      || existingText.includes(candidateText)
      || candidateText.includes(existingText);
    if (sameOrSubset) {
      const nearStackedBand = overlapY >= 0.02 || centerDeltaY <= minHeight * 1.35;
      const localStackedDuplicate = (
        exactTokenMatch
        && nearSizeMatch
        && centerDeltaY <= Math.max(56, minHeight * 2.0)
        && centerDeltaX <= Math.max(72, minWidth * 1.25)
        && overlapX >= 0.62
        && nearStackedBand
      );
      return (
        iou >= 0.56
        || (overlapY >= 0.82 && overlapX >= 0.62)
        || (
          centerDeltaY <= minHeight * 0.72
          && centerDeltaX <= minWidth * 0.68
          && overlapY >= 0.62
          && overlapX >= 0.38
        )
        || (
          exactTokenMatch
          && overlapY >= 0.88
          && overlapX >= 0.4
          && centerDeltaY <= minHeight * 1.2
        )
        || localStackedDuplicate
      );
    }

    if (languageCodes.includes('kor')) {
      return false;
    }

    if (!existingToken || !candidateToken) return false;

    const similarity = diceSimilarity(existingToken, candidateToken);
    const lenDelta = Math.abs(existingToken.length - candidateToken.length);
    const typoDistance = boundedLevenshteinDistance(existingToken, candidateToken, 2);
    const nearDuplicateToken = similarity >= 0.9
      || (similarity >= 0.84 && lenDelta <= 2)
      || (
        typoDistance <= 1
        && lenDelta <= 1
        && Math.min(existingToken.length, candidateToken.length) >= 5
      );
    if (!nearDuplicateToken) {
      return false;
    }

    return (
      iou >= 0.62
      || (
        overlapY >= 0.76
        && overlapX >= 0.56
        && centerDeltaY <= minHeight * 0.9
        && centerDeltaX <= minWidth * 0.9
      )
    );
  }

  private shouldCollapseResidualSpatialDuplicateExternalLine(
    existing: OCRLine,
    candidate: OCRLine,
    languageCodes: string[]
  ): boolean {
    if (this.shouldMergePaddlePanelDuplicateExternalLine(existing, candidate, languageCodes)) {
      return true;
    }

    const existingText = normalizeExternalDedupText(existing.text);
    const candidateText = normalizeExternalDedupText(candidate.text);
    if (!existingText || !candidateText) return false;

    const overlapY = verticalOverlapRatio(existing.bbox, candidate.bbox);
    const overlapX = horizontalOverlapRatio(existing.bbox, candidate.bbox);
    const iou = bboxIoURatio(existing.bbox, candidate.bbox);
    const centerDeltaY = Math.abs(bboxCenterY(existing.bbox) - bboxCenterY(candidate.bbox));
    const centerDeltaX = Math.abs(bboxCenterX(existing.bbox) - bboxCenterX(candidate.bbox));
    const minHeight = Math.max(8, Math.min(bboxHeight(existing.bbox), bboxHeight(candidate.bbox)));
    const minWidth = Math.max(24, Math.min(bboxWidth(existing.bbox), bboxWidth(candidate.bbox)));

    if (centerDeltaY > Math.max(84, minHeight * 2.8)) return false;
    if (centerDeltaX > Math.max(120, minWidth * 2.6)) return false;

    const nearSameBox = (
      iou >= 0.66
      || (overlapY >= 0.88 && overlapX >= 0.76)
      || (
        overlapY >= 0.74
        && overlapX >= 0.58
        && centerDeltaY <= minHeight * 0.72
        && centerDeltaX <= minWidth * 0.7
      )
    );
    if (!nearSameBox) {
      return false;
    }

    const latinExistingToken = normalizeExternalLatinToken(existingText);
    const latinCandidateToken = normalizeExternalLatinToken(candidateText);
    const existingToken = latinExistingToken || normalizeMultilingualToken(existingText);
    const candidateToken = latinCandidateToken || normalizeMultilingualToken(candidateText);
    if (!existingToken || !candidateToken) return false;

    const minLength = Math.min(existingToken.length, candidateToken.length);
    const sameOrSubset = existingToken === candidateToken
      || (minLength >= 4 && (existingToken.includes(candidateToken) || candidateToken.includes(existingToken)));
    if (sameOrSubset) {
      return true;
    }

    if (languageCodes.includes('kor') && (latinExistingToken || latinCandidateToken)) {
      return false;
    }

    const similarity = diceSimilarity(existingToken, candidateToken);
    const prefixMatch = minLength >= 4 && existingToken.slice(0, 4) === candidateToken.slice(0, 4);
    const suffixMatch = minLength >= 4 && existingToken.slice(-4) === candidateToken.slice(-4);
    if ((prefixMatch || suffixMatch) && similarity >= 0.82) {
      return true;
    }
    if (iou >= 0.8 && minLength >= 4 && similarity >= 0.7) {
      return true;
    }

    return (
      iou >= 0.82
      && minLength >= 6
      && boundedLevenshteinDistance(existingToken, candidateToken, 3) <= 2
    );
  }

  private pruneLikelyOrphanCjkFragments(lines: OCRLine[]): OCRLine[] {
    if (lines.length <= 1) return lines;

    return lines.filter((line) => {
      const token = normalizeMultilingualToken(line.text || '');
      const rawText = String(line.text || '').trim();
      const hasTerminalPunct = /[!?…\.]+$/u.test(rawText);
      if (!hasHangulChars(rawText) || token.length > 2 || token.length === 0 || hasTerminalPunct) {
        return true;
      }
      const lineConfidence = Number(line.confidence || 0);
      if (lineConfidence > 97) {
        return true;
      }

      const supporters = lines.filter((other) => {
        if (other === line) return false;
        const otherToken = normalizeMultilingualToken(other.text || '');
        if (!hasHangulChars(other.text || '')) return false;
        if (otherToken.length < token.length + 2) return false;
        if (!token || token[0] !== otherToken[0]) return false;

        const centerDelta = Math.abs(bboxCenterY(other.bbox) - bboxCenterY(line.bbox));
        const minHeight = Math.max(8, Math.min(bboxHeight(other.bbox), bboxHeight(line.bbox)));
        const nearbyBand = centerDelta <= Math.max(120, minHeight * 6.0);
        if (!nearbyBand) return false;

        const overlapX = horizontalOverlapRatio(line.bbox, other.bbox);
        const overlapY = verticalOverlapRatio(line.bbox, other.bbox);
        const containedX = horizontalContainmentRatio(line.bbox, other.bbox) >= 0.38;
        const narrowFragment = bboxWidth(line.bbox) <= bboxWidth(other.bbox) * 0.62;

        return narrowFragment && (containedX || overlapX >= 0.12) && overlapY >= 0.04;
      });

      return supporters.length === 0;
    });
  }

  private dropKoreanParticleShadowLines(lines: OCRLine[]): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    if (lines.length <= 1) {
      return { lines, dropped: [] };
    }

    const terminalParticles = new Set(['\uC774', '\uAC00', '\uC740', '\uB294', '\uC744', '\uB97C', '\uC5D0', '\uAC8C', '\uB3C4', '\uB85C', '\uC640', '\uACFC', '\uC758', '\uC57C']);
    const infos = lines.map((line) => {
      const rawText = String(line.text || '').trim();
      const token = normalizeMultilingualToken(rawText);
      const hangulToken = token.replace(/[^\uAC00-\uD7A3]+/g, '');
      const terminal = hangulToken.slice(-1);
      const stem = terminalParticles.has(terminal) ? hangulToken.slice(0, -1) : hangulToken;
      return {
        rawText,
        hangulToken,
        stem,
        terminal,
      };
    });

    const kept: OCRLine[] = [];
    const dropped: OCRDroppedWord[] = [];

    lines.forEach((line, index) => {
      const info = infos[index];
      const rawText = info.rawText;
      if (!rawText || !hasHangulChars(rawText)) {
        kept.push(line);
        return;
      }

      if (/[!?\u2026\.]+$/u.test(rawText)) {
        kept.push(line);
        return;
      }

      const tokenLength = info.hangulToken.length;
      if (tokenLength < 2 || tokenLength > 4) {
        kept.push(line);
        return;
      }

      if (info.stem.length < 2) {
        kept.push(line);
        return;
      }

      const lineConfidence = Number(line.confidence || 0);
      if (lineConfidence > 97) {
        kept.push(line);
        return;
      }

      let dropAsShadow = false;
      for (let otherIndex = 0; otherIndex < lines.length; otherIndex += 1) {
        if (otherIndex === index) continue;

        const other = lines[otherIndex];
        const otherInfo = infos[otherIndex];
        if (!otherInfo.hangulToken || otherInfo.hangulToken.length < tokenLength + 2) {
          continue;
        }
        if (!otherInfo.hangulToken.startsWith(info.stem)) {
          continue;
        }

        const centerDelta = Math.abs(bboxCenterY(other.bbox) - bboxCenterY(line.bbox));
        const minHeight = Math.max(8, Math.min(bboxHeight(other.bbox), bboxHeight(line.bbox)));
        const nearbyBand = centerDelta <= Math.max(140, minHeight * 7.0);
        if (!nearbyBand) {
          continue;
        }

        const overlapX = horizontalOverlapRatio(line.bbox, other.bbox);
        const overlapY = verticalOverlapRatio(line.bbox, other.bbox);
        const containedX = horizontalContainmentRatio(line.bbox, other.bbox) >= 0.38;
        const narrowFragment = bboxWidth(line.bbox) <= bboxWidth(other.bbox) * 0.7;

        if (!narrowFragment || overlapY < 0.04 || (!containedX && overlapX < 0.12)) {
          continue;
        }

        dropAsShadow = true;
        dropped.push({
          filter: 'externalChunkMerge',
          reason: 'koreanParticleShadow',
          text: rawText,
          confidence: lineConfidence,
          bbox: line.bbox,
        });
        break;
      }

      if (!dropAsShadow) {
        kept.push(line);
      }
    });

    return { lines: kept, dropped };
  }

  private collapseKoreanNearDuplicateLines(lines: OCRLine[]): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    if (lines.length <= 1) {
      return { lines, dropped: [] };
    }

    const consumed = new Array<boolean>(lines.length).fill(false);
    const kept: OCRLine[] = [];
    const dropped: OCRDroppedWord[] = [];

    const lineScore = (line: OCRLine): number => {
      const text = String(line.text || '').trim();
      const confidence = Number(line.confidence || 0);
      return (confidence * 1.8) + text.length;
    };

    for (let i = 0; i < lines.length; i += 1) {
      if (consumed[i]) continue;

      let winnerIndex = i;

      for (let j = i + 1; j < lines.length; j += 1) {
        if (consumed[j]) continue;

        const a = lines[winnerIndex];
        const b = lines[j];
        const aText = String(a.text || '').trim();
        const bText = String(b.text || '').trim();
        if (!aText || !bText) continue;
        if (!hasHangulChars(aText) || !hasHangulChars(bText)) continue;

        const overlapY = verticalOverlapRatio(a.bbox, b.bbox);
        if (overlapY < 0.56) continue;

        const overlapX = horizontalOverlapRatio(a.bbox, b.bbox);
        const centerDeltaY = Math.abs(bboxCenterY(a.bbox) - bboxCenterY(b.bbox));
        const centerDeltaX = Math.abs(bboxCenterX(a.bbox) - bboxCenterX(b.bbox));
        const minHeight = Math.max(8, Math.min(bboxHeight(a.bbox), bboxHeight(b.bbox)));
        const minWidth = Math.max(20, Math.min(bboxWidth(a.bbox), bboxWidth(b.bbox)));
        const sameBand = overlapX >= 0.55
          || (centerDeltaY <= minHeight * 0.62 && centerDeltaX <= minWidth * 0.6);
        if (!sameBand) continue;

        const aToken = normalizeKoreanDedupToken(aText);
        const bToken = normalizeKoreanDedupToken(bText);
        if (!aToken || !bToken) continue;

        const similarity = diceSimilarity(aToken, bToken);
        const lenDelta = Math.abs(aToken.length - bToken.length);
        const typoDistance = boundedLevenshteinDistance(aToken, bToken, 1);
        const typoNearDuplicate = typoDistance <= 1
          && lenDelta <= 1
          && overlapX >= 0.7
          && overlapY >= 0.72
          && Math.min(aToken.length, bToken.length) >= 4;
        const nearDuplicate = similarity >= 0.72
          || (similarity >= 0.66 && lenDelta <= 2)
          || typoNearDuplicate;
        if (!nearDuplicate) continue;

        const winner = lineScore(a) >= lineScore(b) ? winnerIndex : j;
        const loser = winner === winnerIndex ? j : winnerIndex;
        const loserLine = lines[loser];
        const loserText = String(loserLine.text || '').trim();
        consumed[loser] = true;
        dropped.push({
          filter: 'externalChunkMerge',
          reason: 'koreanNearDuplicateLine',
          text: loserText,
          confidence: Number(loserLine.confidence || 0),
          bbox: loserLine.bbox,
        });
        winnerIndex = winner;
      }

      if (consumed[winnerIndex]) continue;
      consumed[winnerIndex] = true;
      kept.push(lines[winnerIndex]);
    }

    return { lines: kept, dropped };
  }

  private collapseLatinNearDuplicateExternalLines(
    lines: OCRLine[],
    languageCodes: string[]
  ): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    if (lines.length <= 1) {
      return { lines, dropped: [] };
    }

    const consumed = new Array<boolean>(lines.length).fill(false);
    const kept: OCRLine[] = [];
    const dropped: OCRDroppedWord[] = [];

    const lineScore = (line: OCRLine): number => {
      const text = String(line.text || '').trim();
      const confidence = Number(line.confidence || 0);
      const area = Math.max(1, bboxWidth(line.bbox) * bboxHeight(line.bbox));
      return (confidence * 1.8) + (text.length * 1.2) + (Math.log10(area) * 2.0);
    };

    for (let i = 0; i < lines.length; i += 1) {
      if (consumed[i]) continue;

      let winnerIndex = i;

      for (let j = i + 1; j < lines.length; j += 1) {
        if (consumed[j]) continue;

        const a = lines[winnerIndex];
        const b = lines[j];
        const centerDeltaY = Math.abs(bboxCenterY(a.bbox) - bboxCenterY(b.bbox));
        const maxBandDistance = Math.max(72, Math.max(bboxHeight(a.bbox), bboxHeight(b.bbox)) * 2.6);
        if (centerDeltaY > maxBandDistance) {
          break;
        }

        if (!this.shouldMergePaddlePanelDuplicateExternalLine(a, b, languageCodes)) continue;

        const winner = lineScore(a) >= lineScore(b) ? winnerIndex : j;
        const loser = winner === winnerIndex ? j : winnerIndex;
        const loserLine = lines[loser];
        const loserText = String(loserLine.text || '').trim();
        consumed[loser] = true;
        dropped.push({
          filter: 'externalChunkMerge',
          reason: 'latinNearDuplicateLine',
          text: loserText,
          confidence: Number(loserLine.confidence || 0),
          bbox: loserLine.bbox,
        });
        winnerIndex = winner;
      }

      if (consumed[winnerIndex]) continue;
      consumed[winnerIndex] = true;
      kept.push(lines[winnerIndex]);
    }

    return { lines: kept, dropped };
  }

  private collapseResidualSpatialDuplicateExternalLines(
    lines: OCRLine[],
    languageCodes: string[]
  ): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    if (lines.length <= 1) {
      return { lines, dropped: [] };
    }

    const consumed = new Array<boolean>(lines.length).fill(false);
    const dropped: OCRDroppedWord[] = [];
    const kept: OCRLine[] = [];
    const orderedIndices = lines
      .map((_line, index) => index)
      .sort((a, b) => {
        const aLine = lines[a];
        const bLine = lines[b];
        if (aLine.bbox.y0 !== bLine.bbox.y0) return aLine.bbox.y0 - bLine.bbox.y0;
        if (aLine.bbox.x0 !== bLine.bbox.x0) return aLine.bbox.x0 - bLine.bbox.x0;
        return a - b;
      });

    const lineScore = (line: OCRLine): number => {
      const text = String(line.text || '').trim();
      const confidence = Number(line.confidence || 0);
      return (confidence * 2.2) + text.length + (Math.log10(bboxArea(line.bbox)) * 2.8);
    };

    for (let i = 0; i < orderedIndices.length; i += 1) {
      const baseIndex = orderedIndices[i];
      if (consumed[baseIndex]) continue;

      let winnerIndex = baseIndex;

      for (let j = i + 1; j < orderedIndices.length; j += 1) {
        const candidateIndex = orderedIndices[j];
        if (consumed[candidateIndex]) continue;

        const winnerLine = lines[winnerIndex];
        const candidateLine = lines[candidateIndex];
        const centerDeltaY = Math.abs(bboxCenterY(winnerLine.bbox) - bboxCenterY(candidateLine.bbox));
        const centerDeltaX = Math.abs(bboxCenterX(winnerLine.bbox) - bboxCenterX(candidateLine.bbox));
        const minWidth = Math.max(24, Math.min(bboxWidth(winnerLine.bbox), bboxWidth(candidateLine.bbox)));
        const maxBandDistance = Math.max(92, Math.max(bboxHeight(winnerLine.bbox), bboxHeight(candidateLine.bbox)) * 3.1);
        if (centerDeltaY > maxBandDistance) {
          break;
        }
        if (centerDeltaX > Math.max(132, minWidth * 2.8)) {
          continue;
        }

        if (!this.shouldCollapseResidualSpatialDuplicateExternalLine(winnerLine, candidateLine, languageCodes)) {
          continue;
        }

        const winner = lineScore(winnerLine) >= lineScore(candidateLine) ? winnerIndex : candidateIndex;
        const loser = winner === winnerIndex ? candidateIndex : winnerIndex;
        const loserLine = lines[loser];

        consumed[loser] = true;
        dropped.push({
          filter: 'externalChunkMerge',
          reason: 'residualSpatialDuplicateLine',
          text: String(loserLine.text || '').trim(),
          confidence: Number(loserLine.confidence || 0),
          bbox: loserLine.bbox,
        });
        winnerIndex = winner;
      }

      if (consumed[winnerIndex]) continue;
      consumed[winnerIndex] = true;
      kept.push(lines[winnerIndex]);
    }

    return { lines: kept, dropped };
  }

  private pruneLikelyLatinGhostExternalLines(
    lines: OCRLine[],
    pageHeight: number,
    pipelineProfile: OCRPipelineProfile,
    language: string
  ): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    if (lines.length === 0) return { lines, dropped: [] };
    if (pipelineProfile !== 'panel') return { lines, dropped: [] };
    if (isCjkLikeLanguage(language)) return { lines, dropped: [] };
    if (!this.shouldApplyAggressiveLatinPanelCleanup(language)) return { lines, dropped: [] };

    const dropped: OCRDroppedWord[] = [];
    const edgeBand = Math.max(120, pageHeight * 0.18);

    const kept = lines.filter((line) => {
      const rawText = String(line.text || '').trim();
      if (!rawText) return false;
      if (!/[A-Za-z]/.test(rawText)) return true;

      const tokens = rawText
        .split(/\s+/)
        .map((token) => normalizeExternalLatinToken(token))
        .filter(Boolean);
      if (tokens.length === 0) return true;

      const centerY = bboxCenterY(line.bbox);
      const nearEdge = centerY <= edgeBand || centerY >= (pageHeight - edgeBand);
      const confidence = Number(line.confidence || 0);
      const trailingShortCount = (() => {
        let count = 0;
        for (let i = tokens.length - 1; i >= 0; i -= 1) {
          const token = tokens[i];
          if (!token) break;
          if (token.length <= 2 || EXTERNAL_LATIN_DOMAIN_TAIL_TOKENS.has(token)) {
            count += 1;
            continue;
          }
          break;
        }
        return count;
      })();

      if (tokens.length === 1) {
        const token = tokens[0];
        if (EXTERNAL_LATIN_DOMAIN_TAIL_TOKENS.has(token) && (nearEdge || confidence < 99)) {
          dropped.push({
            filter: 'externalLatinCleanup',
            reason: 'latinDomainTailSingleton',
            text: rawText,
            confidence,
            bbox: line.bbox,
          });
          return false;
        }
        if (token.length <= 2 && nearEdge && confidence < 96) {
          dropped.push({
            filter: 'externalLatinCleanup',
            reason: 'latinEdgeSingleton',
            text: rawText,
            confidence,
            bbox: line.bbox,
          });
          return false;
        }
        return true;
      }

      if (tokens.length === 2 && tokens.every((token) => EXTERNAL_LATIN_DOMAIN_TAIL_TOKENS.has(token)) && confidence < 99) {
        dropped.push({
          filter: 'externalLatinCleanup',
          reason: 'latinDomainTailPair',
          text: rawText,
          confidence,
          bbox: line.bbox,
        });
        return false;
      }

      const oneCharCount = tokens.filter((token) => token.length === 1).length;
      const trailingOneCharCount = (() => {
        let count = 0;
        for (let i = tokens.length - 1; i >= 0; i -= 1) {
          if (tokens[i].length === 1) {
            count += 1;
            continue;
          }
          break;
        }
        return count;
      })();
      const hasDomainTail = tokens.some((token) => EXTERNAL_LATIN_DOMAIN_TAIL_TOKENS.has(token));
      const suspiciousTrailingNoise = trailingShortCount >= 2 && (trailingOneCharCount >= 2 || hasDomainTail || oneCharCount >= 2);
      if (!suspiciousTrailingNoise) {
        return true;
      }

      const head = tokens[0] || '';
      const headVowels = (head.match(/[AEIOU]/g) || []).length;
      const headLooksReadable = head.length >= 4 && headVowels >= 2;

      if ((nearEdge || confidence < 97) && (!headLooksReadable || trailingOneCharCount >= 2 || hasDomainTail)) {
        dropped.push({
          filter: 'externalLatinCleanup',
          reason: 'latinTrailingNoiseLine',
          text: rawText,
          confidence,
          bbox: line.bbox,
        });
        return false;
      }

      return true;
    });

    return { lines: kept, dropped };
  }

  private pruneLikelyExternalResidualSingletons(
    lines: OCRLine[],
    pageWidth: number,
    pageHeight: number,
    pipelineProfile: OCRPipelineProfile,
    language: string
  ): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    if (lines.length === 0) return { lines, dropped: [] };
    if (pipelineProfile !== 'panel') return { lines, dropped: [] };
    if (isCjkLikeLanguage(language)) return { lines, dropped: [] };
    if (!this.shouldApplyAggressiveLatinPanelCleanup(language)) return { lines, dropped: [] };

    const dropped: OCRDroppedWord[] = [];
    const edgeBandY = Math.max(120, pageHeight * 0.18);
    const edgeBandX = Math.max(110, pageWidth * 0.14);

    const kept = lines.filter((line) => {
      const rawText = String(line.text || '').trim();
      if (!rawText) return false;

      const tokens = rawText.split(/\s+/).filter(Boolean);
      if (tokens.length !== 1) return true;

      const token = tokens[0];
      const confidence = Number(line.confidence || 0);
      const centerX = bboxCenterX(line.bbox);
      const centerY = bboxCenterY(line.bbox);
      const nearEdge = centerY <= edgeBandY
        || centerY >= (pageHeight - edgeBandY)
        || centerX <= edgeBandX
        || centerX >= (pageWidth - edgeBandX);
      const tinyToken = bboxHeight(line.bbox) <= pageHeight * 0.028
        || bboxWidth(line.bbox) <= pageWidth * 0.06;

      const alphaNumeric = token.replace(/[^A-Za-z0-9]/g, '');
      const numericSingleton = /^[0-9]{1,2}$/.test(alphaNumeric);
      if (numericSingleton && nearEdge && (tinyToken || confidence < 95)) {
        dropped.push({
          filter: 'externalSingletonCleanup',
          reason: 'numericEdgeSingleton',
          text: rawText,
          confidence,
          bbox: line.bbox,
        });
        return false;
      }

      const cjkSingleton = EXTERNAL_SINGLETON_CJK_RE.test(token) && token.length <= 2;
      if (cjkSingleton && (nearEdge || tinyToken) && confidence < 98.5) {
        dropped.push({
          filter: 'externalSingletonCleanup',
          reason: 'cjkSingletonOnLatinPage',
          text: rawText,
          confidence,
          bbox: line.bbox,
        });
        return false;
      }

      const punctuationSingleton = !alphaNumeric && /^[^\p{L}\p{N}]+$/u.test(token);
      if (punctuationSingleton && nearEdge && tinyToken && confidence < 96) {
        dropped.push({
          filter: 'externalSingletonCleanup',
          reason: 'punctuationEdgeSingleton',
          text: rawText,
          confidence,
          bbox: line.bbox,
        });
        return false;
      }

      return true;
    });

    return { lines: kept, dropped };
  }

  private shouldApplyAggressiveLatinPanelCleanup(language: string): boolean {
    const normalizedCodes = String(language || '')
      .split('+')
      .map((code) => String(code || '').trim().toLowerCase())
      .filter(Boolean);

    if (normalizedCodes.length === 0) return true;
    if (normalizedCodes.some((code) => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code))) {
      return false;
    }

    return normalizedCodes.every((code) => code === 'eng' || code === 'en');
  }

  private externalLineScore(line: OCRLine): number {
    const textLength = String(line.text || '').trim().length;
    const confidence = Number(line.confidence || 0);
    const area = Math.max(1, bboxArea(line.bbox));
    return (confidence * 1.8) + (textLength * 1.15) + (Math.log10(area) * 3.0);
  }

  private isLikelyMalformedPaddleLatinLine(line: OCRLine, pageWidth: number): boolean {
    const text = String(line.text || '').trim();
    if (!text) return false;

    const alpha = normalizeExternalLatinToken(text);
    if (alpha.length < 10) return false;

    const words = (line.words || []).filter((word) => String(word.text || '').trim().length > 0);
    if (words.length < 4) return false;

    const width = Math.max(1, bboxWidth(line.bbox));
    const height = Math.max(1, bboxHeight(line.bbox));
    const pxPerChar = width / Math.max(1, alpha.length);

    const veryNarrowForText = pxPerChar < 2.9;
    const tinyRelativeToPage = width <= Math.max(64, pageWidth * 0.035);
    const thinStrip = height <= 24 && width <= Math.max(140, alpha.length * 5.2);

    return veryNarrowForText && (tinyRelativeToPage || thinStrip);
  }

  private isSevereMalformedPaddleLatinLine(line: OCRLine, pageWidth: number): boolean {
    const text = String(line.text || '').trim();
    if (!text) return false;

    const alpha = normalizeExternalLatinToken(text);
    if (alpha.length < 14) return false;

    const words = (line.words || []).filter((word) => String(word.text || '').trim().length > 0);
    if (words.length < 4) return false;

    const width = Math.max(1, bboxWidth(line.bbox));
    const height = Math.max(1, bboxHeight(line.bbox));
    const pxPerChar = width / Math.max(1, alpha.length);
    const tinyRelativeToPage = width <= Math.max(52, pageWidth * 0.028);
    const veryCompressed = pxPerChar < 2.2 && height <= 24;

    return tinyRelativeToPage && veryCompressed;
  }

  private isCriticalTechnicalPaddleAnomalyLine(line: OCRLine): boolean {
    const text = String(line.text || '').trim();
    if (!text) return false;

    const normalized = text.replace(/\s+/g, ' ').trim();
    const alphaNumericLength = normalizeExternalLatinToken(normalized).length;
    if (alphaNumericLength < 8) return false;

    const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
    if (tokenCount < 2 || tokenCount > 16) return false;

    const hasEquationLabel = /\(\s*\d{1,3}[a-z]?\s*\)/i.test(normalized);
    const hasTechnicalCue = /\b(resultant|magnitude|direction|force|column|columns|connections?|support|reaction|unknowns?|beam|beams|welded|fixed|table|figure|types?)\b/i.test(normalized);

    return hasEquationLabel || hasTechnicalCue;
  }

  private collectPaddlePanelGeometryAnomalies(result: OCRPageResult): OCRLine[] {
    if ((result.pipelineProfile || 'panel') !== 'panel') return [];
    if ((result.ocrEngine || 'paddleocr') !== 'paddleocr') return [];

    const pageWidth = Math.max(1, result.width || 0);
    return (result.lines || []).filter((line) => this.isLikelyMalformedPaddleLatinLine(line, pageWidth));
  }

  private isLikelyDenseLatinDocumentPanelResult(result: OCRPageResult, language: string): boolean {
    if (!this.shouldApplyAggressiveLatinPanelCleanup(language)) return false;
    if ((result.pipelineProfile || 'panel') !== 'panel') return false;
    if ((result.ocrEngine || 'paddleocr') !== 'paddleocr') return false;

    const lines = Array.isArray(result.lines) ? result.lines : [];
    if (lines.length < 36) return false;

    const width = Math.max(1, Number(result.width || 0));
    const height = Math.max(1, Number(result.height || 0));
    const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height));
    if (aspectRatio > 2.2) return false;

    let wordCountSum = 0;
    let longLatinLines = 0;
    lines.forEach((line) => {
      const validWords = (line.words || []).filter((word) => String(word.text || '').trim().length > 0);
      const fallbackWords = String(line.text || '').trim().split(/\s+/g).filter(Boolean);
      wordCountSum += validWords.length > 0 ? validWords.length : fallbackWords.length;
      if (normalizeExternalLatinToken(String(line.text || '')).length >= 18) {
        longLatinLines += 1;
      }
    });

    const avgWordsPerLine = wordCountSum / Math.max(1, lines.length);
    return avgWordsPerLine >= 2.15 && longLatinLines >= 10;
  }

  private shouldFallbackMalformedPaddlePanelResult(result: OCRPageResult, language: string): boolean {
    if (!this.shouldApplyAggressiveLatinPanelCleanup(language)) return false;

    const anomalies = this.collectPaddlePanelGeometryAnomalies(result);
    if (anomalies.length === 0) return false;

    const pageWidth = Math.max(1, Number(result.width || 0));
    const severeAnomalies = anomalies.filter((line) => this.isSevereMalformedPaddleLatinLine(line, pageWidth));
    if (severeAnomalies.length > 0) {
      return true;
    }

    const criticalTechnicalAnomalies = anomalies.filter((line) => this.isCriticalTechnicalPaddleAnomalyLine(line));
    if (criticalTechnicalAnomalies.length > 0) {
      return true;
    }

    const totalLines = Math.max(1, Array.isArray(result.lines) ? result.lines.length : 0);
    const anomalyRatio = anomalies.length / totalLines;
    const pageHeight = Math.max(1, Number(result.height || 0));
    const aspectRatio = Math.max(pageWidth, pageHeight) / Math.max(1, Math.min(pageWidth, pageHeight));
    const veryTallPanelPage = pageHeight >= 4200 && aspectRatio >= 2.6;

    if (this.isLikelyDenseLatinDocumentPanelResult(result, language)) {
      if (anomalies.length <= 2 && anomalyRatio <= 0.09) {
        return false;
      }
    }

    if (veryTallPanelPage && anomalies.length <= 3 && anomalyRatio <= 0.08) {
      return false;
    }

    if (anomalies.some((line) => bboxWidth(line.bbox) <= 40)) return true;
    return anomalies.length >= 3;
  }

  private dropMinorPaddleGeometryAnomalies(
    externalResult: OCRPageResult,
    anomalies: OCRLine[],
    skipReason: string,
  ): OCRPageResult {
    if (anomalies.length === 0) return externalResult;

    // Keep technical caption-like lines to avoid losing valid table/document rows.
    const removableAnomalies = anomalies.filter((line) => !this.isCriticalTechnicalPaddleAnomalyLine(line));
    if (removableAnomalies.length === 0) {
      return externalResult;
    }

    const anomalySet = new Set<OCRLine>(removableAnomalies);
    const preservedLines = (externalResult.lines || []).filter((line) => !anomalySet.has(line));
    if (preservedLines.length === (externalResult.lines || []).length) {
      return externalResult;
    }

    const preservedWords = preservedLines.flatMap((line) => line.words || []);
    const preservedConfidences = preservedWords.length > 0
      ? preservedWords.map((word) => Number(word.confidence || 0))
      : preservedLines.map((line) => Number(line.confidence || 0));
    const preservedConfidence = preservedConfidences.length > 0
      ? preservedConfidences.reduce((sum, value) => sum + value, 0) / preservedConfidences.length
      : Number(externalResult.confidence || 0);

    const droppedWords: OCRDroppedWord[] = removableAnomalies.slice(0, 12).map((line) => ({
      filter: 'externalPaddleFallback',
      reason: 'malformedTinyBboxForLongLine',
      text: String(line.text || '').trim(),
      confidence: Number(line.confidence || 0),
      bbox: line.bbox,
    }));

    return {
      ...externalResult,
      lines: preservedLines,
      words: preservedWords,
      text: preservedLines.map((line) => line.text).filter(Boolean).join('\n').trim(),
      confidence: preservedConfidence,
      debug: {
        ...(externalResult.debug || { droppedWords: [], dropCounts: {} }),
        droppedWords: [
          ...(externalResult.debug?.droppedWords || []),
          ...droppedWords,
        ],
        dropCounts: {
          ...(externalResult.debug?.dropCounts || {}),
          externalPaddleGeometryAnomalyDrop:
            (externalResult.debug?.dropCounts?.externalPaddleGeometryAnomalyDrop || 0) + removableAnomalies.length,
        },
        skipReason,
      },
    };
  }

  private mergePaddleGeometryFallbackResult(
    externalResult: OCRPageResult,
    fallbackResult: OCRPageResult,
    anomalies: OCRLine[],
    width: number,
    height: number,
    dpi: number,
    language: string,
    pageSegMode: number | undefined,
    pipelineProfile: OCRPipelineProfile,
    ocrQualityProfile: OCRQualityProfile,
  ): OCRPageResult {
    const anomalySet = new Set<OCRLine>(anomalies);
    const preservedExternalLines = (externalResult.lines || []).filter((line) => !anomalySet.has(line));
    const preservedExternalWords = preservedExternalLines.flatMap((line) => line.words || []);
    const preservedConfidences = preservedExternalWords.length > 0
      ? preservedExternalWords.map((word) => Number(word.confidence || 0))
      : preservedExternalLines.map((line) => Number(line.confidence || 0));
    const preservedConfidence = preservedConfidences.length > 0
      ? preservedConfidences.reduce((sum, value) => sum + value, 0) / preservedConfidences.length
      : 0;

    const preservedExternalResult: OCRPageResult = {
      ...externalResult,
      lines: preservedExternalLines,
      words: preservedExternalWords,
      text: preservedExternalLines.map((line) => line.text).filter(Boolean).join('\n').trim(),
      confidence: preservedConfidence,
    };

    const hybridMerged = this.mergeExternalChunkResults(
      [preservedExternalResult, fallbackResult],
      width,
      height,
      dpi,
      language,
      pageSegMode ?? externalResult.pageSegMode ?? fallbackResult.pageSegMode,
      pipelineProfile,
      ocrQualityProfile,
      'paddleocr',
    );

    const fallbackDebugDrops: OCRDroppedWord[] = anomalies.slice(0, 8).map((line) => ({
      filter: 'externalPaddleFallback',
      reason: 'malformedTinyBboxForLongLine',
      text: String(line.text || '').trim(),
      confidence: Number(line.confidence || 0),
      bbox: line.bbox,
    }));

    const hybridDropCounts = {
      ...(hybridMerged.debug?.dropCounts || {}),
      externalPaddleGeometryFallback: anomalies.length,
      externalPaddleGeometryFallbackPreserved: preservedExternalLines.length,
    };

    const hybridDroppedWords = [
      ...(hybridMerged.debug?.droppedWords || []),
      ...fallbackDebugDrops,
    ];

    return {
      ...hybridMerged,
      pageNumber: externalResult.pageNumber || fallbackResult.pageNumber || 0,
      ocrEngine: 'paddleocr',
      debug: {
        ...(hybridMerged.debug || { droppedWords: [], dropCounts: {} }),
        droppedWords: hybridDroppedWords,
        dropCounts: hybridDropCounts,
        skipReason: 'paddleGeometryHybridFallbackToTesseract',
      },
    };
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
    const languageCodes = String(language || '')
      .split('+')
      .map((code) => code.trim().toLowerCase())
      .filter(Boolean);
    const mergedDropCounts: Record<string, number> = {};
    const mergedDroppedWords: OCRDroppedWord[] = [];

    for (const result of results) {
      runtimeMs += (result.debug?.runtimeMs || 0);
      for (const [key, value] of Object.entries(result.debug?.dropCounts || {})) {
        const numeric = Number(value || 0);
        if (!Number.isFinite(numeric) || numeric <= 0) continue;
        mergedDropCounts[key] = (mergedDropCounts[key] || 0) + numeric;
      }
      if (Array.isArray(result.debug?.droppedWords) && result.debug!.droppedWords.length > 0) {
        mergedDroppedWords.push(...result.debug!.droppedWords);
      }
      for (const line of result.lines || []) {
        const text = String(line.text || '').trim();
        if (!text) continue;
        const existingIndex = mergedLines.findIndex((existing) => {
          if (!isPaddlePanel) {
            return this.shouldMergeDuplicateExternalLine(existing, line);
          }

          return this.shouldMergePaddlePanelDuplicateExternalLine(existing, line, languageCodes);
        });
        if (existingIndex < 0) {
          mergedLines.push(line);
          continue;
        }

        const existing = mergedLines[existingIndex];
        const candidateScore = this.externalLineScore(line);
        const existingScore = this.externalLineScore(existing);
        if (candidateScore > existingScore) {
          mergedLines[existingIndex] = line;
        }
      }
    }

    mergedLines.sort((a, b) => {
      const aLine = a as OCRLine & { _sortY?: number; _sortX?: number };
      const bLine = b as OCRLine & { _sortY?: number; _sortX?: number };
      const aSortY = typeof aLine._sortY === 'number' ? aLine._sortY : a.bbox.y0;
      const bSortY = typeof bLine._sortY === 'number' ? bLine._sortY : b.bbox.y0;
      if (aSortY !== bSortY) return aSortY - bSortY;

      const aSortX = typeof aLine._sortX === 'number' ? aLine._sortX : a.bbox.x0;
      const bSortX = typeof bLine._sortX === 'number' ? bLine._sortX : b.bbox.x0;
      if (aSortX !== bSortX) return aSortX - bSortX;

      if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
      return a.bbox.x0 - b.bbox.x0;
    });

    const applyCjkOrphanPrune = pipelineProfile === 'panel'
      && isCjkLikeLanguage(language)
      && ocrEngine === 'easyocr';
    const applyKoreanChunkMergePrune = isPaddlePanel && languageCodes.includes('kor');
    const applyLatinChunkMergePrune = isPaddlePanel
      && !isCjkLikeLanguage(language)
      && this.shouldApplyAggressiveLatinPanelCleanup(language);
    const shouldApplyAggressiveLatinPrune = this.shouldApplyAggressiveLatinPanelCleanup(language)
      && !(isPaddlePanel && pipelineProfile === 'panel');

    let finalLines = applyCjkOrphanPrune
      ? this.pruneLikelyOrphanCjkFragments(mergedLines)
      : mergedLines;

    if (applyKoreanChunkMergePrune) {
      const koreanNearDuplicateResult = this.collapseKoreanNearDuplicateLines(finalLines);
      finalLines = koreanNearDuplicateResult.lines;
      if (koreanNearDuplicateResult.dropped.length > 0) {
        mergedDropCounts.koreanChunkMergeNearDuplicate =
          (mergedDropCounts.koreanChunkMergeNearDuplicate || 0) + koreanNearDuplicateResult.dropped.length;
        mergedDroppedWords.push(...koreanNearDuplicateResult.dropped);
      }

      const koreanPruneResult = this.dropKoreanParticleShadowLines(finalLines);
      finalLines = koreanPruneResult.lines;
      if (koreanPruneResult.dropped.length > 0) {
        mergedDropCounts.koreanChunkMergeParticleShadow =
          (mergedDropCounts.koreanChunkMergeParticleShadow || 0) + koreanPruneResult.dropped.length;
        mergedDroppedWords.push(...koreanPruneResult.dropped);
      }
    }

    if (applyLatinChunkMergePrune) {
      const latinNearDuplicateResult = this.collapseLatinNearDuplicateExternalLines(finalLines, languageCodes);
      finalLines = latinNearDuplicateResult.lines;
      if (latinNearDuplicateResult.dropped.length > 0) {
        mergedDropCounts.latinChunkMergeNearDuplicate =
          (mergedDropCounts.latinChunkMergeNearDuplicate || 0) + latinNearDuplicateResult.dropped.length;
        mergedDroppedWords.push(...latinNearDuplicateResult.dropped);
      }
    }

    const latinGhostResult = shouldApplyAggressiveLatinPrune
      ? this.pruneLikelyLatinGhostExternalLines(
        finalLines,
        height,
        pipelineProfile,
        language
      )
      : { lines: finalLines, dropped: [] };
    finalLines = latinGhostResult.lines;
    if (latinGhostResult.dropped.length > 0) {
      mergedDropCounts.externalLatinGhostLine =
        (mergedDropCounts.externalLatinGhostLine || 0) + latinGhostResult.dropped.length;
      mergedDroppedWords.push(...latinGhostResult.dropped);
    }

    const singletonResult = shouldApplyAggressiveLatinPrune
      ? this.pruneLikelyExternalResidualSingletons(
        finalLines,
        width,
        height,
        pipelineProfile,
        language
      )
      : { lines: finalLines, dropped: [] };
    finalLines = singletonResult.lines;
    if (singletonResult.dropped.length > 0) {
      mergedDropCounts.externalResidualSingleton =
        (mergedDropCounts.externalResidualSingleton || 0) + singletonResult.dropped.length;
      mergedDroppedWords.push(...singletonResult.dropped);
    }

    if (isPaddlePanel) {
      const residualSpatialResult = this.collapseResidualSpatialDuplicateExternalLines(finalLines, languageCodes);
      finalLines = residualSpatialResult.lines;
      if (residualSpatialResult.dropped.length > 0) {
        mergedDropCounts.externalResidualSpatialDuplicate =
          (mergedDropCounts.externalResidualSpatialDuplicate || 0) + residualSpatialResult.dropped.length;
        mergedDroppedWords.push(...residualSpatialResult.dropped);
      }
    }

    const mergedWords = finalLines.flatMap((line) => line.words || []);
    const confidences = mergedWords.length > 0
      ? mergedWords.map((word) => word.confidence || 0)
      : finalLines.map((line) => line.confidence || 0);
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
      lines: finalLines,
      words: mergedWords,
      text: finalLines.map((line) => line.text).filter(Boolean).join('\n').trim(),
      confidence,
      debug: {
        droppedWords: mergedDroppedWords,
        dropCounts: mergedDropCounts,
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

      const isPaddlePanelPath = ocrEngine === 'paddleocr' && pipelineProfile === 'panel';
      const shouldApplyAggressiveLatinPrune = this.shouldApplyAggressiveLatinPanelCleanup(language)
        && !isPaddlePanelPath;

      const latinGhostResult = shouldApplyAggressiveLatinPrune
        ? this.pruneLikelyLatinGhostExternalLines(
          result.lines || [],
          imageHeight,
          pipelineProfile,
          language
        )
        : { lines: result.lines || [], dropped: [] };
      const finalLines = latinGhostResult.lines;
      const finalWords = finalLines.flatMap((line) => line.words || []);
      const confidences = finalWords.length > 0
        ? finalWords.map((word) => word.confidence || 0)
        : finalLines.map((line) => line.confidence || 0);
      const finalConfidence = confidences.length > 0
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : (typeof result.confidence === 'number' ? result.confidence : 0);
      const debugDropCounts: Record<string, number> = {
        ...(result.debug?.dropCounts || {}),
      };
      const debugDroppedWords: OCRDroppedWord[] = [
        ...(result.debug?.droppedWords || []),
      ];
      if (latinGhostResult.dropped.length > 0) {
        debugDropCounts.externalLatinGhostLine =
          (debugDropCounts.externalLatinGhostLine || 0) + latinGhostResult.dropped.length;
        debugDroppedWords.push(...latinGhostResult.dropped);
      }

      const singletonResult = shouldApplyAggressiveLatinPrune
        ? this.pruneLikelyExternalResidualSingletons(
          finalLines,
          imageWidth,
          imageHeight,
          pipelineProfile,
          language
        )
        : { lines: finalLines, dropped: [] };
      const singletonCleanedLines = singletonResult.lines;
      if (singletonResult.dropped.length > 0) {
        debugDropCounts.externalResidualSingleton =
          (debugDropCounts.externalResidualSingleton || 0) + singletonResult.dropped.length;
        debugDroppedWords.push(...singletonResult.dropped);
      }

      const languageCodes = String(language || '')
        .split('+')
        .map((code) => code.trim().toLowerCase())
        .filter(Boolean);
      const isExternalPanel = pipelineProfile === 'panel' && (ocrEngine === 'paddleocr' || ocrEngine === 'easyocr');
      const shouldApplyResidualSpatial = isExternalPanel
        && (isCjkLikeLanguage(language) || this.shouldApplyAggressiveLatinPanelCleanup(language));
      const finalResidualSpatialResult = shouldApplyResidualSpatial
        ? this.collapseResidualSpatialDuplicateExternalLines(singletonCleanedLines, languageCodes)
        : { lines: singletonCleanedLines, dropped: [] };
      if (finalResidualSpatialResult.dropped.length > 0) {
        debugDropCounts.externalResidualSpatialDuplicate =
          (debugDropCounts.externalResidualSpatialDuplicate || 0) + finalResidualSpatialResult.dropped.length;
        debugDroppedWords.push(...finalResidualSpatialResult.dropped);
      }

      const singletonCleanedWords = finalResidualSpatialResult.lines.flatMap((line) => line.words || []);
      const finalConfidences = singletonCleanedWords.length > 0
        ? singletonCleanedWords.map((word) => word.confidence || 0)
        : finalResidualSpatialResult.lines.map((line) => line.confidence || 0);
      const finalLineConfidence = finalConfidences.length > 0
        ? finalConfidences.reduce((sum, value) => sum + value, 0) / finalConfidences.length
        : finalConfidence;

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
        lines: finalResidualSpatialResult.lines,
        words: singletonCleanedWords,
        text: finalResidualSpatialResult.lines.map((line) => line.text).filter(Boolean).join('\n').trim(),
        confidence: finalLineConfidence,
        debug: {
          ...(result.debug || {}),
          droppedWords: debugDroppedWords,
          dropCounts: debugDropCounts,
        },
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
      const externalResult = await this.runExternalOcrForTextLayer(
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

      const canApplyPaddleLatinGeometryGuard = ocrEngine === 'paddleocr'
        && pipelineProfile === 'panel'
        && this.shouldApplyAggressiveLatinPanelCleanup(language);
      const anomalies = canApplyPaddleLatinGeometryGuard
        ? this.collectPaddlePanelGeometryAnomalies(externalResult)
        : [];
      const severeAnomalyCount = anomalies.filter((line) =>
        this.isSevereMalformedPaddleLatinLine(line, Math.max(1, Number(externalResult.width || 0)))
      ).length;

      const shouldFallbackToTesseract = canApplyPaddleLatinGeometryGuard
        && this.shouldFallbackMalformedPaddlePanelResult(externalResult, language);
      if (!shouldFallbackToTesseract) {
        if (anomalies.length > 0) {
          return this.dropMinorPaddleGeometryAnomalies(
            externalResult,
            anomalies,
            'paddleGeometryMinorAnomalyDropNoFallback'
          );
        }
        return externalResult;
      }

      const denseLatinDocument = this.isLikelyDenseLatinDocumentPanelResult(externalResult, language);
      const fallbackDpi = denseLatinDocument && severeAnomalyCount === 0 && anomalies.length <= 4
        ? Math.max(220, Math.min(dpi, 260))
        : dpi;
      const fallbackQualityProfile: OCRQualityProfile = severeAnomalyCount > 0
        ? ocrQualityProfile
        : 'fast';
      try {
        const fallbackResult = await this.sendMessage<OCRPageResult>('OCR_FOR_TEXT_LAYER', {
          imageUrl,
          imageWidth,
          imageHeight,
          language,
          dpi: fallbackDpi,
          pageSegMode,
          debugCollectDrops,
          pipelineProfile,
          ocrQualityProfile: fallbackQualityProfile,
          ocrEngine: 'tesseract',
        }, { signal });

        const mergedFallbackResult = this.mergePaddleGeometryFallbackResult(
          externalResult,
          fallbackResult,
          anomalies,
          imageWidth,
          imageHeight,
          dpi,
          language,
          pageSegMode,
          pipelineProfile,
          ocrQualityProfile,
        );

        if (fallbackDpi !== dpi) {
          return {
            ...mergedFallbackResult,
            debug: {
              ...(mergedFallbackResult.debug || { droppedWords: [], dropCounts: {} }),
              dropCounts: {
                ...(mergedFallbackResult.debug?.dropCounts || {}),
                externalPaddleGeometryFallbackDpiDownshift: 1,
              },
            },
          };
        }

        return mergedFallbackResult;
      } catch (fallbackError) {
        if ((fallbackError as Error | undefined)?.name === 'AbortError' || signal?.aborted) {
          if (severeAnomalyCount === 0 && anomalies.length > 0) {
            return this.dropMinorPaddleGeometryAnomalies(
              externalResult,
              anomalies,
              'paddleGeometryFallbackAbortedMinorAnomalyDrop'
            );
          }
          return {
            ...externalResult,
            debug: {
              ...(externalResult.debug || { droppedWords: [], dropCounts: {} }),
              skipReason: 'paddleGeometryFallbackAborted',
            },
          };
        }
        console.warn('[VisionService] Paddle geometry fallback to tesseract failed:', fallbackError);
        if (severeAnomalyCount === 0 && anomalies.length > 0) {
          return this.dropMinorPaddleGeometryAnomalies(
            externalResult,
            anomalies,
            'paddleGeometryFallbackFailedMinorAnomalyDrop'
          );
        }
        return externalResult;
      }
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
