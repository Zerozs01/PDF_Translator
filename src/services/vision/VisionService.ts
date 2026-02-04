/**
 * Enhanced Vision Service - Stable OCR & Smart Segmentation
 * 
 * Features:
 * - Request timeout & retry mechanism
 * - Queue-based processing (prevent overlapping requests)
 * - Smart region classification (text, balloon, sfx, panel)
 * - Error recovery
 */

import { Region, OCRPageResult } from '../../types';

type WorkerMessage = {
  type: string;
  payload?: unknown;
  id: string;
};

type PendingRequest = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timestamp: number;
};

export type OCRProgressCallback = (progress: {
  status: string;
  progress: number;
  workerId?: string;
}) => void;

// Configuration
const CONFIG = {
  REQUEST_TIMEOUT_MS: 120000, // 2 minutes timeout for OCR
  RETRY_ATTEMPTS: 2,
  RETRY_DELAY_MS: 1000,
  HEALTH_CHECK_INTERVAL_MS: 30000,
};

class VisionService {
  private worker: Worker | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private progressCallback: OCRProgressCallback | null = null;
  private isProcessing: boolean = false;
  private requestQueue: Array<() => Promise<void>> = [];
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Will be initialized lazily
  }

  /**
   * Initialize worker with health monitoring
   */
  private initWorker(): void {
    if (this.worker) {
      this.worker.terminate();
    }

    console.log('[VisionService] Initializing worker...');
    
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (e) => {
      this.handleWorkerMessage(e.data);
    };

    this.worker.onerror = (error) => {
      console.error('[VisionService] Worker error:', error);
      this.handleWorkerCrash();
    };

    // Start health check
    this.startHealthCheck();
  }

  /**
   * Handle incoming worker messages
   */
  private handleWorkerMessage(data: { type: string; id?: string; payload?: unknown; error?: string }): void {
    const { type, id, payload, error } = data;

    // Handle progress updates
    if (type === 'OCR_PROGRESS' && this.progressCallback) {
      this.progressCallback(payload as { status: string; progress: number; workerId?: string });
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
    
    this.pendingRequests.delete(id);
    this.isProcessing = false;
    
    // Process next item in queue
    this.processQueue();
  }

  /**
   * Handle worker crash - reject all pending and restart
   */
  private handleWorkerCrash(): void {
    console.warn('[VisionService] Worker crashed, rejecting pending requests...');
    
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('Worker crashed'));
    }
    this.pendingRequests.clear();
    this.isProcessing = false;

    // Restart worker
    this.worker = null;
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
          pending.reject(new Error('Request timeout'));
          this.pendingRequests.delete(id);
          
          if (this.pendingRequests.size === 0) {
            this.isProcessing = false;
            this.processQueue();
          }
        }
      }
    }, CONFIG.HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Process request queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    const nextRequest = this.requestQueue.shift();
    if (nextRequest) {
      await nextRequest();
    }
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
    dpi: number = 300
  ): Promise<OCRPageResult> {
    return this.sendMessage('OCR_FOR_TEXT_LAYER', {
      imageUrl,
      imageWidth,
      imageHeight,
      language,
      dpi
    });
  }

  /**
   * Send message to worker with timeout & retry
   */
  private async sendMessage<T>(
    type: string, 
    payload?: unknown,
    options: { skipQueue?: boolean; retryCount?: number } = {}
  ): Promise<T> {
    const { skipQueue = false, retryCount = 0 } = options;

    // Ensure worker is initialized
    if (!this.worker) {
      this.initWorker();
    }

    // Queue handling
    if (!skipQueue && this.isProcessing) {
      return new Promise((resolve, reject) => {
        this.requestQueue.push(async () => {
          try {
            const result = await this.sendMessage<T>(type, payload, { ...options, skipQueue: true });
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      });
    }

    this.isProcessing = true;

    return new Promise<T>((resolve, reject) => {
      const id = crypto.randomUUID();
      
      // Set up timeout
      const timeoutId = setTimeout(() => {
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          this.isProcessing = false;
          
          // Retry logic
          if (retryCount < CONFIG.RETRY_ATTEMPTS) {
            console.warn(`[VisionService] Retry ${retryCount + 1}/${CONFIG.RETRY_ATTEMPTS} for ${type}`);
            
            setTimeout(() => {
              this.sendMessage<T>(type, payload, { ...options, retryCount: retryCount + 1 })
                .then(resolve)
                .catch(reject);
            }, CONFIG.RETRY_DELAY_MS);
          } else {
            reject(new Error(`Request timeout after ${CONFIG.RETRY_ATTEMPTS} retries`));
            this.processQueue();
          }
        }
      }, CONFIG.REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(id, {
        resolve: (data) => {
          clearTimeout(timeoutId);
          resolve(data as T);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
        timestamp: Date.now(),
      });

      this.worker?.postMessage({ type, payload, id });
    });
  }

  /**
   * Check if service is currently processing
   */
  public isBusy(): boolean {
    return this.isProcessing || this.requestQueue.length > 0;
  }

  /**
   * Get queue length
   */
  public getQueueLength(): number {
    return this.requestQueue.length;
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
      pending.reject(new Error('Service terminated'));
    }
    this.pendingRequests.clear();
    this.requestQueue = [];
    
    this.worker?.terminate();
    this.worker = null;
    this.isProcessing = false;
  }
}

export const visionService = new VisionService();
