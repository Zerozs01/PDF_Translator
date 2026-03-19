/**
 * Enhanced Vision Service - Stable OCR & Smart Segmentation
 * 
 * Features:
 * - Request timeout & retry mechanism
 * - Queue-based processing (prevent overlapping requests)
 * - Smart region classification (text, balloon, sfx, panel)
 * - Error recovery
 */

import { Region, OCRPageResult, OCRPipelineProfile } from '../../types';
import { OCR_ALGORITHM_VERSION } from './ocrVersion';

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
  mode: WorkerMode;
};

export type OCRProgressCallback = (progress: {
  status: string;
  progress: number;
  workerId?: string;
}) => void;

// Configuration
const getDefaultWorkerCount = (): number => {
  if (typeof navigator === 'undefined') return 1;
  const cores = navigator.hardwareConcurrency || 1;
  return Math.max(1, Math.min(3, Math.floor(cores / 2)));
};

const CONFIG = {
  REQUEST_TIMEOUT_MS: 120000, // 2 minutes timeout for OCR
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY_MS: 1000,
  HEALTH_CHECK_INTERVAL_MS: 30000,
  MAX_WORKERS: getDefaultWorkerCount(),
};

const createAbortError = (reason: string = 'OCR job canceled'): Error => {
  const error = new Error(reason);
  (error as Error & { name?: string }).name = 'AbortError';
  return error;
};

class VisionService {
  private workers: WorkerSlot[] = [];
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
    if (this.workers.length > 0) return;

    console.log(`[VisionService] Initializing ${CONFIG.MAX_WORKERS} worker(s)...`);
    for (let i = 0; i < CONFIG.MAX_WORKERS; i++) {
      this.workers.push(this.createWorkerSlot(i));
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
        errorObj: (error as any).error ?? null,
      };
      console.error(`[VisionService] Worker ${index} (${mode}) error:`, JSON.stringify(errInfo, null, 2));
      this.handleWorkerCrash(index, error);
    };

    return { worker, busy: false, mode };
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
      // Mark as stable mode since the boot loader already imported worker-stable
      if (this.workers[workerIndex]) {
        this.workers[workerIndex].mode = 'stable';
      }
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
    }

    // Process next item(s) in queue
    this.processQueue();
  }

  /**
   * Handle worker crash - reject all pending and restart
   */
  private handleWorkerCrash(workerIndex: number, _error?: Event | ErrorEvent): void {
    const slot = this.workers[workerIndex];
    const currentMode = slot?.mode ?? 'primary';
    const fallbackMode: WorkerMode = currentMode === 'primary' ? 'stable' : 'stable';
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
      const now = Date.now();
      
      for (const [id, pending] of this.pendingRequests) {
        if (now - pending.timestamp > CONFIG.REQUEST_TIMEOUT_MS) {
          console.warn(`[VisionService] Request ${id} timed out`);
          clearTimeout(pending.timeoutId);
          pending.request.abortHandler?.();
          pending.reject(new Error('Request timeout'));
          this.pendingRequests.delete(id);

          if (this.workers[pending.workerIndex]) {
            this.workers[pending.workerIndex].busy = false;
          }
        }
      }
      
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
      if (this.workers[i].busy) continue;

      const nextRequest = this.requestQueue.shift();
      if (!nextRequest) continue;

      this.dispatchRequest(i, nextRequest);
    }
  }

  private dispatchRequest(workerIndex: number, request: QueuedRequest): void {
    const { type, payload, resolve, reject } = request;
    const id = crypto.randomUUID();

    const timeoutId = setTimeout(() => {
      const pending = this.pendingRequests.get(id);
      if (!pending) return;

      this.pendingRequests.delete(id);
      if (this.workers[workerIndex]) {
        this.workers[workerIndex].busy = false;
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
    pipelineProfile: OCRPipelineProfile = 'panel'
  ): Promise<OCRPageResult> {
    return this.sendMessage('OCR_FOR_TEXT_LAYER', {
      imageUrl,
      imageWidth,
      imageHeight,
      language,
      dpi,
      pageSegMode,
      debugCollectDrops,
      pipelineProfile
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
