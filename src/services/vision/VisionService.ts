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
import { filterKoreanJamoNoise, filterWeakIsolatedCjkLines } from './ocr-filtering';
import { preprocessImage } from './ocr-preprocessing';
import { OCR_ALGORITHM_VERSION, OCR_RAW_VERSION } from './ocrVersion';
import {
  OCR_WORKER_REQUEST_TIMEOUT_MS_DEFAULT,
  OCR_WORKER_RETRY_ATTEMPTS_DEFAULT,
  OCR_WORKER_RETRY_DELAY_MS_DEFAULT,
} from './ocr-timeout';
import {
  bboxArea,
  bboxCenterX,
  bboxCenterY,
  bboxHeight,
  bboxIoURatio,
  bboxWidth,
  computeLineWordUnionCoverage,
  expandContextualPhraseBBox,
  horizontalContainmentRatio,
  horizontalOverlapRatio,
  medianNumber,
  verticalOverlapRatio,
} from './visionGeometry';
import {
  boundedLevenshteinDistance,
  countSharedExternalLatinTokens,
  diceSimilarity,
  EXTERNAL_LATIN_DOMAIN_TAIL_TOKENS,
  EXTERNAL_SHORT_DIALOGUE_WORDS,
  EXTERNAL_SINGLETON_CJK_RE,
  hasHangulChars,
  isCjkLikeLanguage,
  normalizeExternalDedupText,
  normalizeExternalLatinToken,
  normalizeKoreanDedupToken,
  normalizeMultilingualToken,
  scoreExternalLatinLineNaturalness,
  shouldKeepExternalPaddleDialogueFragment,
  offsetExternalWord,
  offsetExternalLine,
  shouldMergeDuplicateExternalLine,
  shouldMergePaddlePanelDuplicateExternalLine,
  shouldCollapseResidualSpatialDuplicateExternalLine,
  pruneLikelyOrphanCjkFragments,
  dropKoreanParticleShadowLines,
  collapseKoreanNearDuplicateLines,
  collapseLatinNearDuplicateExternalLines,
  collapseResidualSpatialDuplicateExternalLines,
  pruneLikelyLatinGhostExternalLines,
  pruneLikelyExternalResidualSingletons,
  repairPaddlePanelDialogueEchoLines,
  prunePaddlePanelTallEffectLines,
  repairPaddlePanelContextualDialogueLines,
  shouldApplyAggressiveLatinPanelCleanup,
  getPaddleLatinLineGeometryMetrics,
  isLikelyMalformedPaddleLatinLine,
  isSevereMalformedPaddleLatinLine,
  isCriticalTechnicalPaddleAnomalyLine,
  collectPaddlePanelGeometryAnomalies,
  isLikelyDenseLatinDocumentPanelResult,
  shouldFallbackMalformedPaddlePanelResult,
  dropMinorPaddleGeometryAnomalies,
  postProcessKoreanExternalResult,
  mergePaddleGeometryFallbackResult,
  mergeExternalChunkResults
} from './externalOcrDedup';



const EXTERNAL_TECHNICAL_LINE_HINT_REGEX = /\b(unknowns?|reactions?|equilibrium|resultant|component|components|direction|force|moment|column|columns|connections?|support|rigid|body|beam|beams|pin|hinge|utility|building|bridge|girder|floor|member|concrete|weld(?:ed|ing)?|fx|fy|fz|mx|my|mz|rx|ry|rz)\b/i;
const EXTERNAL_TECHNICAL_TABLE_ROW_HINT_REGEX = /\b(?:table|continued|types?\s+of\s+connection|number\s+of\s+unknowns|reactions?|unknowns?|components?|couple\s+moment|magnitude|direction|resultant|smooth\s+pin|hinge|fixed\s+support|collar|rod|member\s+fixed|bridge|building|beam|welded|column)\b|^\(?\d+\)?$|^(?:fx|fy|fyt|f|m|or)$/i;

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
  DEBUG_LOG_MISSING_LINES: false,
};

const createAbortError = (reason: string = 'OCR job canceled'): Error => {
  const error = new Error(reason);
  (error as Error & { name?: string }).name = 'AbortError';
  return error;
};

const EXTERNAL_PADDLE_CHUNK_MIN_HEIGHT = 5200;
const EXTERNAL_PADDLE_CHUNK_TARGET_HEIGHT = 2200;
const EXTERNAL_PADDLE_CHUNK_OVERLAP = 220;

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
    // NOTE: Each branch must use a string literal in new URL() so Vite can
    // emit separate worker chunks during production build.
    const worker = mode === 'stable'
      ? new Worker(new URL('./worker-stable.ts', import.meta.url), { type: 'module' })
      : new Worker(new URL('./worker-boot.ts', import.meta.url), { type: 'module' });
    console.log(`[VisionService] Worker ${index} (${mode}) initialized.`);
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
    const dimensions = await this.getImageDimensions(imageUrl);
    const ocrResult = await this.ocrForTextLayer(
      imageUrl,
      dimensions.width,
      dimensions.height,
      language,
      300,
      undefined,
      undefined,
      false,
      'panel',
      'best',
      'paddleocr'
    );

    return this.sendMessage('SEGMENT', { 
      words: ocrResult.words || [],
      width: dimensions.width,
      height: dimensions.height,
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
    return offsetExternalWord(word, yOffset);
  }

  private offsetExternalLine(line: OCRLine, yOffset: number): OCRLine {
    return offsetExternalLine(line, yOffset);
  }

  private shouldMergeDuplicateExternalLine(existing: OCRLine, candidate: OCRLine): boolean {
    return shouldMergeDuplicateExternalLine(existing, candidate);
  }

  private shouldMergePaddlePanelDuplicateExternalLine(
    existing: OCRLine,
    candidate: OCRLine,
    languageCodes: string[]
  ): boolean {
    return shouldMergePaddlePanelDuplicateExternalLine(existing, candidate, languageCodes);
  }

  private shouldCollapseResidualSpatialDuplicateExternalLine(
    existing: OCRLine,
    candidate: OCRLine,
    languageCodes: string[]
  ): boolean {
    return shouldCollapseResidualSpatialDuplicateExternalLine(existing, candidate, languageCodes);
  }

  private pruneLikelyOrphanCjkFragments(lines: OCRLine[]): OCRLine[] {
    return pruneLikelyOrphanCjkFragments(lines);
  }

  private dropKoreanParticleShadowLines(lines: OCRLine[]): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    return dropKoreanParticleShadowLines(lines);
  }

  private collapseKoreanNearDuplicateLines(lines: OCRLine[]): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    return collapseKoreanNearDuplicateLines(lines);
  }

  private collapseLatinNearDuplicateExternalLines(
    lines: OCRLine[],
    languageCodes: string[]
  ): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    return collapseLatinNearDuplicateExternalLines(lines, languageCodes);
  }

  private collapseResidualSpatialDuplicateExternalLines(
    lines: OCRLine[],
    languageCodes: string[]
  ): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    return collapseResidualSpatialDuplicateExternalLines(lines, languageCodes);
  }

  private pruneLikelyLatinGhostExternalLines(
    lines: OCRLine[],
    pageHeight: number,
    pipelineProfile: OCRPipelineProfile,
    language: string
  ): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    return pruneLikelyLatinGhostExternalLines(lines, pageHeight, pipelineProfile, language);
  }

  private pruneLikelyExternalResidualSingletons(
    lines: OCRLine[],
    pageWidth: number,
    pageHeight: number,
    pipelineProfile: OCRPipelineProfile,
    language: string
  ): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    return pruneLikelyExternalResidualSingletons(lines, pageWidth, pageHeight, pipelineProfile, language);
  }

  private repairPaddlePanelDialogueEchoLines(
    lines: OCRLine[],
    pageWidth: number,
    pageHeight: number,
    language: string
  ): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    return repairPaddlePanelDialogueEchoLines(lines, pageWidth, pageHeight, language);
  }

  private prunePaddlePanelTallEffectLines(
    lines: OCRLine[],
    pageWidth: number,
    pageHeight: number,
    language: string,
    qualityProfile?: OCRQualityProfile
  ): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    return prunePaddlePanelTallEffectLines(lines, pageWidth, pageHeight, language, qualityProfile);
  }

  private repairPaddlePanelContextualDialogueLines(
    lines: OCRLine[],
    pageWidth: number,
    pageHeight: number,
    language: string
  ): { lines: OCRLine[]; dropped: OCRDroppedWord[] } {
    return repairPaddlePanelContextualDialogueLines(lines, pageWidth, pageHeight, language);
  }

  private shouldApplyAggressiveLatinPanelCleanup(language: string): boolean {
    return shouldApplyAggressiveLatinPanelCleanup(language);
  }

  private externalLineScore(line: OCRLine): number {
    const textLength = String(line.text || '').trim().length;
    const confidence = Number(line.confidence || 0);
    const area = Math.max(1, bboxArea(line.bbox));
    return (confidence * 1.8) + (textLength * 1.15) + (Math.log10(area) * 3.0);
  }

  private getPaddleLatinLineGeometryMetrics(line: OCRLine): {
    alphaLength: number;
    tokenCount: number;
    width: number;
    height: number;
    pxPerChar: number;
    areaPerChar: number;
  } | null {
    return getPaddleLatinLineGeometryMetrics(line);
  }

  private isLikelyMalformedPaddleLatinLine(line: OCRLine, pageWidth: number, pageHeight: number): boolean {
    return isLikelyMalformedPaddleLatinLine(line, pageWidth, pageHeight);
  }

  private isSevereMalformedPaddleLatinLine(line: OCRLine, pageWidth: number, pageHeight: number): boolean {
    return isSevereMalformedPaddleLatinLine(line, pageWidth, pageHeight);
  }

  private isCriticalTechnicalPaddleAnomalyLine(line: OCRLine): boolean {
    return isCriticalTechnicalPaddleAnomalyLine(line);
  }

  private collectPaddlePanelGeometryAnomalies(result: OCRPageResult): OCRLine[] {
    return collectPaddlePanelGeometryAnomalies(result);
  }

  private isLikelyDenseLatinDocumentPanelResult(result: OCRPageResult, language: string): boolean {
    return isLikelyDenseLatinDocumentPanelResult(result, language);
  }

  private shouldFallbackMalformedPaddlePanelResult(result: OCRPageResult, language: string): boolean {
    return shouldFallbackMalformedPaddlePanelResult(result, language);
  }

  private dropMinorPaddleGeometryAnomalies(
    externalResult: OCRPageResult,
    anomalies: OCRLine[],
    skipReason: string,
  ): OCRPageResult {
    return dropMinorPaddleGeometryAnomalies(externalResult, anomalies, skipReason);
  }

  private postProcessKoreanExternalResult(result: OCRPageResult, language: string): OCRPageResult {
    return postProcessKoreanExternalResult(result, language);
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
    fallbackEngine: OCREngine,
  ): OCRPageResult {
    return mergePaddleGeometryFallbackResult(
      externalResult,
      fallbackResult,
      anomalies,
      width,
      height,
      dpi,
      language,
      pageSegMode,
      pipelineProfile,
      ocrQualityProfile,
      fallbackEngine
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
    return mergeExternalChunkResults(
      results,
      width,
      height,
      dpi,
      language,
      pageSegMode,
      pipelineProfile,
      ocrQualityProfile,
      ocrEngine
    );
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
    ocrEngine: OCREngine,
    maxPixels?: number,
    useAngleCls?: boolean
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

      // --- IPC Memory Leak Fix ---
      // Write the image buffer to a temp file once via writeTempImage IPC (Main process).
      // All subsequent bridge.runExternal calls receive only a lightweight string path,
      // eliminating repeated Uint8Array serialization across the IPC boundary.
      const tempResult = await bridge.writeTempImage({ imageData: bytes, imageMimeType: mimeType });
      const tempImagePath = tempResult.imagePath;
      const chunkTempPaths: string[] = [];

      // Determine maxSideLen based on pipeline profile context
      // export/PDF: 4800 (dense text optimal), panel: no cap needed (images are already chunked)
      const maxSideLen = pipelineProfile === 'export' ? 4800 : undefined;

      try {
        if (this.shouldChunkExternalOcr(ocrEngine, pipelineProfile, imageWidth, imageHeight, language)) {
          const sourceBlob = new Blob([bytes as BlobPart], { type: mimeType || 'image/png' });
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

            let totalChunks = 0;
            let tempY = 0;
            while (tempY < bitmap.height) {
              totalChunks++;
              const actualH = Math.min(chunkHeight, bitmap.height - tempY);
              if (tempY + actualH >= bitmap.height) {
                break;
              }
              tempY += Math.max(1, actualH - overlap);
            }
            totalChunks = Math.max(1, totalChunks);

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

              // Write chunk to its own temp file (separate from the full-page temp file)
              const chunkTempResult = await bridge.writeTempImage({
                imageData: chunkImage.bytes,
                imageMimeType: chunkImage.mimeType,
              });
              chunkTempPaths.push(chunkTempResult.imagePath);

              let result;
              try {
                result = await bridge.runExternal({
                  engine: ocrEngine,
                  imagePath: chunkTempResult.imagePath,
                  imageMimeType: chunkImage.mimeType,
                  imageWidth: bitmap.width,
                  imageHeight: actualHeight,
                  language,
                  dpi,
                  pageSegMode,
                  pipelineProfile,
                  ocrQualityProfile,
                  chunkIndex: index,
                  totalChunks,
                  ...(maxSideLen !== undefined ? { maxSideLen } : {}),
                  ...(maxPixels !== undefined ? { maxPixels } : {}),
                  ...(useAngleCls !== undefined ? { useAngleCls } : {}),
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
                ocrRawVersion: OCR_RAW_VERSION,
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

        // Non-chunk path: reuse the full-page temp file written above
        const result = await bridge.runExternal({
          engine: ocrEngine,
          imagePath: tempImagePath,
          imageMimeType: mimeType,
          imageWidth,
          imageHeight,
          language,
          dpi,
          pageSegMode,
          pipelineProfile,
          ocrQualityProfile,
          ...(maxSideLen !== undefined ? { maxSideLen } : {}),
          ...(maxPixels !== undefined ? { maxPixels } : {}),
          ...(useAngleCls !== undefined ? { useAngleCls } : {}),
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

        const shouldApplyPaddlePanelValidation = ocrEngine === 'paddleocr'
          && pipelineProfile === 'panel'
          && this.shouldApplyAggressiveLatinPanelCleanup(language);
        const dialogueEchoResult = shouldApplyPaddlePanelValidation
          ? this.repairPaddlePanelDialogueEchoLines(finalResidualSpatialResult.lines, imageWidth, imageHeight, language)
          : { lines: finalResidualSpatialResult.lines, dropped: [] };
        if (dialogueEchoResult.dropped.length > 0) {
          debugDropCounts.externalPaddleDialogueEcho =
            (debugDropCounts.externalPaddleDialogueEcho || 0) + dialogueEchoResult.dropped.length;
          debugDroppedWords.push(...dialogueEchoResult.dropped);
        }

        const contextualRepairResult = shouldApplyPaddlePanelValidation
          ? this.repairPaddlePanelContextualDialogueLines(dialogueEchoResult.lines, imageWidth, imageHeight, language)
          : { lines: dialogueEchoResult.lines, dropped: [] };
        if (contextualRepairResult.dropped.length > 0) {
          debugDropCounts.externalPaddleContextualDialogue =
            (debugDropCounts.externalPaddleContextualDialogue || 0) + contextualRepairResult.dropped.length;
          debugDroppedWords.push(...contextualRepairResult.dropped);
        }

        const tallEffectResult = shouldApplyPaddlePanelValidation
          ? this.prunePaddlePanelTallEffectLines(contextualRepairResult.lines, imageWidth, imageHeight, language, ocrQualityProfile)
          : { lines: contextualRepairResult.lines, dropped: [] };
        if (tallEffectResult.dropped.length > 0) {
          debugDropCounts.externalPaddleTallEffectLine =
            (debugDropCounts.externalPaddleTallEffectLine || 0) + tallEffectResult.dropped.length;
          debugDroppedWords.push(...tallEffectResult.dropped);
        }

        const singletonCleanedWords = tallEffectResult.lines.flatMap((line) => line.words || []);
        const finalConfidences = singletonCleanedWords.length > 0
          ? singletonCleanedWords.map((word) => word.confidence || 0)
          : tallEffectResult.lines.map((line) => line.confidence || 0);
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
          ocrRawVersion: OCR_RAW_VERSION,
          pipelineProfile,
          ocrEngine,
          ocrQualityProfile,
          lines: tallEffectResult.lines,
          words: singletonCleanedWords,
          text: tallEffectResult.lines.map((line) => line.text).filter(Boolean).join('\n').trim(),
          confidence: finalLineConfidence,
          debug: {
            ...(result.debug || {}),
            droppedWords: debugDroppedWords,
            dropCounts: debugDropCounts,
          },
        };
      } finally {
        // Best-effort cleanup: delete the full-page temp file written by writeTempImage,
        // and any chunk temp files created during chunking.
        try {
          if (tempImagePath && typeof bridge.deleteTempImage === 'function') {
            await bridge.deleteTempImage({ imagePath: tempImagePath }).catch(() => {});
          }
          for (const chunkPath of chunkTempPaths) {
            if (typeof bridge.deleteTempImage === 'function') {
              await bridge.deleteTempImage({ imagePath: chunkPath }).catch(() => {});
            }
          }
        } catch { /* best-effort */ }
      }
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
  public async rawOCR(
    imageUrl: string | Blob,
    imageWidth: number,
    imageHeight: number,
    language: string = 'eng',
    dpi: number = 300,
    pageSegMode?: number,
    signal?: AbortSignal,
    ocrEngine: OCREngine = 'paddleocr',
    ocrQualityProfile: OCRQualityProfile = 'best'
  ): Promise<OCRPageResult> {
    const bridge = window.electronAPI?.ocr;
    if (!bridge?.runExternal) {
      throw new Error(`Raw external OCR engine "${ocrEngine}" unavailable`);
    }

    if (signal?.aborted) {
      throw createAbortError();
    }

    const onAbort = () => {
      void bridge.cancelExternal?.({ engine: ocrEngine }).catch(() => {});
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const { bytes, mimeType } = await this.readInputAsBytes(imageUrl);
      if (signal?.aborted) throw createAbortError();

      // Write temp file once; pass only string path across IPC bridge
      const tempResult = await bridge.writeTempImage({ imageData: bytes, imageMimeType: mimeType });

      try {
        const resultRaw = await bridge.runExternal({
          engine: ocrEngine,
          imagePath: tempResult.imagePath,
          imageMimeType: mimeType,
          imageWidth,
          imageHeight,
          language,
          dpi,
          pageSegMode,
          pipelineProfile: 'raw' as any,
          ocrQualityProfile,
        });

        const result: OCRPageResult = {
          pageNumber: 0,
          width: imageWidth,
          height: imageHeight,
          dpi,
          language,
          pageSegMode: resultRaw.pageSegMode ?? pageSegMode,
          algorithmVersion: OCR_ALGORITHM_VERSION,
          ocrRawVersion: OCR_RAW_VERSION,
          pipelineProfile: 'raw',
          ocrEngine,
          ocrQualityProfile,
          lines: (resultRaw.lines || []).map(line => ({
            ...line,
            bbox: line.bbox as any,
            words: (line.words || []).map((w: any) => ({ ...w, bbox: w.bbox as any })),
          })),
          words: [],
          text: resultRaw.text || '',
          confidence: Number(resultRaw.confidence) || 0,
          debug: {
            droppedWords: [],
            dropCounts: {},
            raw: true,
            ...(resultRaw.debug || {}),
          },
        };

        return result;
      } finally {
        if (tempResult?.imagePath && typeof bridge.deleteTempImage === 'function') {
          await bridge.deleteTempImage({ imagePath: tempResult.imagePath }).catch(() => {});
        }
      }
    } catch (error) {
      if (signal?.aborted) throw createAbortError();
      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Run a true raw model invocation (direct PaddleOCR process) bypassing the
   * external bridge preprocessing. Returns a lightweight OCRPageResult with
   * timing in debug.elapsed_ms.
   */
  public async runRawDirect(
    imageUrl: string | Blob,
    imageWidth: number,
    imageHeight: number,
    language: string = 'eng',
    ocrEngine: OCREngine = 'paddleocr'
  ): Promise<OCRPageResult> {
    const bridge = window.electronAPI?.ocr;
    if (!bridge?.runRawDirect) {
      throw new Error('Raw direct OCR runner unavailable');
    }

    const { bytes, mimeType } = await this.readInputAsBytes(imageUrl);

    // Write temp file once (Main process); pass only path string to avoid IPC buffer copy
    const tempResult = await bridge.writeTempImage({ imageData: bytes, imageMimeType: mimeType });

    try {
      const payload = await bridge.runRawDirect({
        imagePath: tempResult.imagePath,
        imageMimeType: mimeType,
        imageWidth,
        imageHeight,
        language,
        engine: ocrEngine,
      });

      // payload is expected to be the JSON emitted by scripts/paddleocr_raw_runner.py
      const runtimeMs = payload?.elapsed_ms ?? null;
      const text = String(payload?.text || '');
      const lines = Array.isArray(payload?.lines)
        ? payload.lines.map((line: any) => ({
            text: String(line?.text || ''),
            confidence: Number(line?.confidence) || 0,
            bbox: line?.bbox,
            words: Array.isArray(line?.words)
              ? line.words.map((word: any) => ({
                  text: String(word?.text || ''),
                  confidence: Number(word?.confidence) || 0,
                  bbox: word?.bbox,
                }))
              : [],
          }))
        : [];
      const words = Array.isArray(payload?.words)
        ? payload.words.map((word: any) => ({
            text: String(word?.text || word || ''),
            confidence: Number(word?.confidence) || 0,
            bbox: word?.bbox,
          }))
        : [];

      const result: OCRPageResult = {
        pageNumber: 0,
        width: imageWidth,
        height: imageHeight,
        dpi: 300,
        language,
        pageSegMode: undefined,
        algorithmVersion: OCR_ALGORITHM_VERSION,
        ocrRawVersion: OCR_RAW_VERSION,
        pipelineProfile: 'raw',
        ocrEngine,
        ocrQualityProfile: 'best',
        lines,
        words,
        text,
        confidence: Number(payload?.confidence) || 0,
        debug: {
          raw: true,
          runtimeMs,
          timingsMs: { ocr: runtimeMs },
          paddlePass: 'raw-direct',
        },
      };

      return result;
    } finally {
      if (tempResult?.imagePath && typeof bridge.deleteTempImage === 'function') {
        await bridge.deleteTempImage({ imagePath: tempResult.imagePath }).catch(() => {});
      }
    }
  }

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
    ocrEngine: OCREngine = 'paddleocr',
    maxPixels?: number,
    config?: {
      engine?: string;
      useAngleCls?: boolean;
      preprocessing?: {
        enabled?: boolean;
        binarization?: boolean;
        deskew?: boolean;
      };
      postprocessing?: {
        heuristics?: boolean;
        glossary?: boolean;
      };
    }
  ): Promise<OCRPageResult> {
    const startTime = performance.now();

    if (config?.preprocessing?.enabled === false) {
      const rawRes = await this.runRawDirect(imageUrl, imageWidth, imageHeight, language, ocrEngine);
      const elapsed = performance.now() - startTime;
      return {
        ...rawRes,
        debug: {
          ...(rawRes.debug || {}),
          runtimeMs: elapsed,
          preprocessing_latency_ms: 0,
        }
      };
    }

    let preprocessingLatencyMs = 0;
    let finalImageUrl = imageUrl;
    if (config?.preprocessing?.binarization === true) {
      const prepStart = performance.now();
      try {
        const prepRes = await preprocessImage(imageUrl, { binarize: true });
        finalImageUrl = prepRes.image;
        preprocessingLatencyMs = performance.now() - prepStart;
      } catch (err) {
        console.warn('[VisionService] Preprocessing failed:', err);
      }
    }

    if (ocrEngine !== 'paddleocr' && ocrEngine !== 'easyocr') {
      ocrEngine = 'paddleocr';
    }

    const setFinalRuntime = (res: OCRPageResult): OCRPageResult => {
      const elapsed = performance.now() - startTime;
      return {
        ...res,
        debug: {
          ...(res.debug || {}),
          runtimeMs: elapsed,
          preprocessing_latency_ms: preprocessingLatencyMs,
        }
      };
    };

    const postProcess = (res: OCRPageResult): OCRPageResult => {
      return config?.postprocessing?.heuristics === false
        ? res
        : this.postProcessKoreanExternalResult(res, language);
    };

    try {
      const externalResult = await this.runExternalOcrForTextLayer(
        finalImageUrl,
        imageWidth,
        imageHeight,
        language,
        dpi,
        pageSegMode,
        signal,
        pipelineProfile,
        ocrQualityProfile,
        ocrEngine,
        maxPixels,
        config?.useAngleCls
      );

      const canApplyPaddleLatinGeometryGuard = ocrEngine === 'paddleocr'
        && pipelineProfile === 'panel'
        && this.shouldApplyAggressiveLatinPanelCleanup(language)
        && config?.postprocessing?.heuristics !== false;
      const anomalies = canApplyPaddleLatinGeometryGuard
        ? this.collectPaddlePanelGeometryAnomalies(externalResult)
        : [];
      const severeAnomalyCount = anomalies.filter((line) =>
        this.isSevereMalformedPaddleLatinLine(
          line,
          Math.max(1, Number(externalResult.width || 0)),
          Math.max(1, Number(externalResult.height || 0)),
        )
      ).length;

      const shouldFallbackToGeometryEngine = canApplyPaddleLatinGeometryGuard
        && this.shouldFallbackMalformedPaddlePanelResult(externalResult, language);
      if (!shouldFallbackToGeometryEngine) {
        if (anomalies.length > 0) {
          return setFinalRuntime(postProcess(
            this.dropMinorPaddleGeometryAnomalies(
              externalResult,
              anomalies,
              'paddleGeometryMinorAnomalyDropNoFallback'
            )
          ));
        }
        return setFinalRuntime(postProcess(externalResult));
      }

      const denseLatinDocument = this.isLikelyDenseLatinDocumentPanelResult(externalResult, language);
      const fallbackDpi = denseLatinDocument && severeAnomalyCount === 0 && anomalies.length <= 4
        ? Math.max(220, Math.min(dpi, 260))
        : dpi;
      const fallbackQualityProfile: OCRQualityProfile = severeAnomalyCount > 0
        ? ocrQualityProfile
        : 'fast';
      const fallbackEngine: OCREngine = 'easyocr';
      try {
        const fallbackResult = await this.runExternalOcrForTextLayer(
          finalImageUrl,
          imageWidth,
          imageHeight,
          language,
          fallbackDpi,
          pageSegMode,
          signal,
          pipelineProfile,
          fallbackQualityProfile,
          fallbackEngine,
          maxPixels,
          config?.useAngleCls
        );

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
          fallbackEngine,
        );

        if (fallbackDpi !== dpi) {
          return setFinalRuntime(postProcess(
            {
              ...mergedFallbackResult,
              debug: {
                ...(mergedFallbackResult.debug || { droppedWords: [], dropCounts: {} }),
                dropCounts: {
                  ...(mergedFallbackResult.debug?.dropCounts || {}),
                  externalPaddleGeometryFallbackDpiDownshift: 1,
                },
              },
            }
          ));
        }

        return setFinalRuntime(postProcess(mergedFallbackResult));
      } catch (fallbackError) {
        if ((fallbackError as Error | undefined)?.name === 'AbortError' || signal?.aborted) {
          if (severeAnomalyCount === 0 && anomalies.length > 0) {
            return setFinalRuntime(postProcess(
              this.dropMinorPaddleGeometryAnomalies(
                externalResult,
                anomalies,
                'paddleGeometryFallbackAbortedMinorAnomalyDrop'
              )
            ));
          }
          return setFinalRuntime(postProcess(
            {
              ...externalResult,
              debug: {
                ...(externalResult.debug || { droppedWords: [], dropCounts: {} }),
                skipReason: 'paddleGeometryFallbackAborted',
              },
            }
          ));
        }
        console.warn(`[VisionService] Paddle geometry fallback to ${fallbackEngine} failed:`, fallbackError);
        if (severeAnomalyCount === 0 && anomalies.length > 0) {
          return setFinalRuntime(postProcess(
            this.dropMinorPaddleGeometryAnomalies(
              externalResult,
              anomalies,
              'paddleGeometryFallbackFailedMinorAnomalyDrop'
            )
          ));
        }
        return setFinalRuntime(postProcess(externalResult));
      }
    } catch (error) {
      if (signal?.aborted || (error as Error | undefined)?.name === 'AbortError') {
        throw error;
      }
      console.warn(`[VisionService] External OCR engine "${ocrEngine}" failed or timed out.`, error);

      // If PaddleOCR failed, attempt fallback to EasyOCR
      if (ocrEngine === 'paddleocr') {
        console.warn(`[VisionService] Performing seamless fallback to easyocr...`);
        try {
          const easyResult = await this.runExternalOcrForTextLayer(
            finalImageUrl,
            imageWidth,
            imageHeight,
            language,
            dpi,
            pageSegMode,
            signal,
            pipelineProfile,
            ocrQualityProfile,
            'easyocr',
            maxPixels,
            config?.useAngleCls
          );

          if (easyResult.debug) {
            easyResult.debug.fallbackFromEngine = ocrEngine;
            easyResult.debug.fallbackReason = error instanceof Error ? error.message : String(error);
          } else {
            easyResult.debug = {
              dropCounts: {},
              droppedWords: [],
              fallbackFromEngine: ocrEngine,
              fallbackReason: error instanceof Error ? error.message : String(error)
            };
          }
          return setFinalRuntime(postProcess(easyResult));
        } catch (fallbackError) {
          console.error('[VisionService] EasyOCR fallback also failed:', fallbackError);
          throw fallbackError;
        }
      }

      throw error;
    }
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
