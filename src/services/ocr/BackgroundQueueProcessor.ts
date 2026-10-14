import { pdfjs } from '../pdf/pdfjsWorker';
import { visionService } from '../vision/VisionService';
import { OCREngine, OCRPageResult } from '../../types';
import { useBackgroundQueueStore, BackgroundJob } from '../../stores/useBackgroundQueueStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { dbService } from '../dbService';
import type { TranslationMode } from '../../stores/useProjectStore';
import { useLayerStore } from '../../stores/useLayerStore';
import { buildLayerGroupsFromOCR, mergeLayersAndGroups } from '../layers/LayerGroupingService';
import { applyPanelSafetyLineDedup } from './ocrSafetyLineDedup';
import { applyPanelLanguageScriptGate } from '../vision/scriptGateService';
import { OCR_ALGORITHM_VERSION, OCR_RAW_VERSION } from '../vision/ocrVersion';
import { detectBlankOrSolidCanvas } from '../vision/blankPageDetector';
import { processOCRPageResult } from './ocrPostProcessingPipeline';

function processAndCleanOCR(result: OCRPageResult, targetEngine: OCREngine, job: BackgroundJob): OCRPageResult {
  return processOCRPageResult(result, {
    engine: targetEngine,
    dpi: result.dpi || job.ocrDpi || 300,
    storeLanguage: job.ocrLanguage || 'eng',
  });
}

interface RenderedPageData {
  pageNum: number;
  canvasWidth: number;
  canvasHeight: number;
  targetDpi: number;
  ocrLanguage: string;
  resolvedQualityProfile: 'fast' | 'balanced' | 'best';
  renderDurationMs?: number;
  imageBlob?: Blob;
  blankOcrResult?: OCRPageResult;
}

interface PageStageTimings {
  pageNum: number;
  queueWaitMs: number;
  renderMs: number;
  ocrIpcMs: number;
  ocrCacheLoadMs: number;
  ocrStageWallMs: number;
  syncLayersMs: number;
  transQueueWaitMs: number;
  translationMs: number;
  slotHoldMs: number;
  totalMs: number;
}

function calculateStageStats(values: number[]) {
  if (values.length === 0) {
    return { medianMs: 0, meanMs: 0, minMs: 0, maxMs: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    medianMs: Number(median.toFixed(2)),
    meanMs: Number((sum / sorted.length).toFixed(2)),
    minMs: Number(sorted[0].toFixed(2)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(2)),
    count: sorted.length,
  };
}

function calculatePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return Number((sorted[Math.max(0, Math.min(sorted.length - 1, index))] || 0).toFixed(2));
}

import { ConcurrencyLimiter } from './ConcurrencyLimiter';
export { ConcurrencyLimiter };

interface PrefetchPipelineController {
  data: Promise<RenderedPageData | null> | null;
  pageNum: number | null;
  trigger: (nextP: number) => void;
}

export interface BackgroundQueueHandlers {
  translatePage: (
    documentId: number,
    pageNum: number,
    ocrResult: OCRPageResult,
    engine: 'offline' | 'ai',
    signal: AbortSignal,
    options?: {
      ocrLanguage?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      translationMode?: TranslationMode;
    }
  ) => Promise<boolean>;
  onPageComplete?: (documentId: number, pageNum: number, cacheKey: string) => void;
}

class BackgroundQueueProcessor {
  private handlers: BackgroundQueueHandlers | null = null;
  private isProcessing = false;
  private currentAbortController: AbortController | null = null;
  private activeJobId: string | null = null;
  private checkInterval: ReturnType<typeof setTimeout> | null = null;
  private headlessCanvas: HTMLCanvasElement | null = null;
  private activePrewarmPromise: Promise<any> | null = null;
  private prewarmedKey: string | null = null;

  public prewarm(
    engine: OCREngine = 'paddleocr',
    language: string = 'eng',
    options?: { qualityProfile?: string; pipelineProfile?: string }
  ): Promise<any> {
    const qualityProfile = options?.qualityProfile || 'best';
    const pipelineProfile = options?.pipelineProfile || 'panel';
    const key = `${engine}:${language}:${qualityProfile}:${pipelineProfile}`;
    if (this.prewarmedKey === key && this.activePrewarmPromise) {
      return this.activePrewarmPromise;
    }
    if (window.electronAPI?.ocr?.prewarmEngine) {
      console.log(`[QueueProcessor] Triggering eager prewarm for ${engine} (${language}, ${qualityProfile})...`);
      this.prewarmedKey = key;
      this.activePrewarmPromise = window.electronAPI.ocr
        .prewarmEngine({
          engine,
          language,
          qualityProfile,
          pipelineProfile,
        })
        .then((res) => {
          console.log(`[QueueProcessor] Eager prewarm completed for ${engine} (${language}, ${qualityProfile})`);
          return res;
        })
        .catch((err) => {
          console.warn(`[QueueProcessor] Eager prewarm warning for ${engine}:`, err);
          this.prewarmedKey = null;
          this.activePrewarmPromise = null;
          throw err;
        });
      return this.activePrewarmPromise;
    }
    return Promise.resolve(null);
  }

  public async waitForPrewarm(): Promise<void> {
    if (this.activePrewarmPromise) {
      try {
        await this.activePrewarmPromise;
      } catch {
        // ignore prewarm failure
      }
    }
  }

  private createRenderCanvas(width: number, height: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: any } {
    if (typeof OffscreenCanvas !== 'undefined' && typeof (OffscreenCanvas.prototype as any)?.convertToBlob === 'function') {
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Cannot create OffscreenCanvas 2D context');
      return { canvas, ctx };
    }
    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Cannot create HTMLCanvasElement 2D context');
      return { canvas, ctx };
    }
    throw new Error('Canvas rendering environment not available');
  }

  private async convertCanvasToLosslessPngBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
    if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
      return await (canvas as any).convertToBlob({ type: 'image/png' });
    }
    return await new Promise<Blob>((res, rej) => {
      (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new Error('Canvas to Blob failed'))), 'image/png');
    });
  }

  private cleanupCanvas(canvas: HTMLCanvasElement | OffscreenCanvas | null): void {
    if (canvas) {
      try {
        canvas.width = 0;
        canvas.height = 0;
      } catch {}
    }
  }

  private getHeadlessCanvas(): HTMLCanvasElement {
    if (!this.headlessCanvas && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.style.position = 'absolute';
      canvas.style.left = '-99999px';
      canvas.style.top = '-99999px';
      canvas.style.visibility = 'hidden';
      document.body.appendChild(canvas);
      this.headlessCanvas = canvas;
    }
    return this.headlessCanvas!;
  }

  private releaseHeadlessCanvas(): void {
    if (this.headlessCanvas) {
      this.headlessCanvas.width = 0;
      this.headlessCanvas.height = 0;
      this.headlessCanvas.remove();
      this.headlessCanvas = null;
    }
  }

  constructor() {
    // สมัครรับข้อมูลการเปลี่ยนแปลงในคิว เพื่อให้เริ่มประมวลผลทันทีเมื่อมีงาน pending
    if (typeof window !== 'undefined') {
      useBackgroundQueueStore.subscribe((state, prevState) => {
        // ถ้าคิวไม่ได้ paused, Foreground ไม่ได้ทำงาน, มีงาน pending และระบบไม่ได้กำลังประมวลผลอยู่ -> เริ่มรันทันที
        if (!state.isPaused && !state.isPausedForForeground && !this.isProcessing) {
          const nextJob = useBackgroundQueueStore.getState().getNextPendingJob();
          if (nextJob) {
            this.startProcessingLoop();
          }
        }

        // ตรวจสอบการ Preemption ของ Active Job
        if (this.activeJobId) {
          const activeJobIdx = state.jobs.findIndex(j => j.id === this.activeJobId);
          const activeJob = activeJobIdx >= 0 ? state.jobs[activeJobIdx] : null;

          if (!activeJob) return;

          if (['cancelled', 'paused', 'failed'].includes(activeJob.status)) {
            // ถูกสั่งยกเลิก/หยุดโดยตรง
            console.log(`[QueueProcessor] Active job ${this.activeJobId} state changed to ${activeJob.status}. Aborting...`);
            this.abortCurrentJob();
          } else if (activeJob.status === 'processing' || activeJob.status === 'queued') {
            // ตรวจ Positional Preemption: สถานะของงานใน Store อาจยังเป็น 'processing' อยู่ แต่ถ้ามีงานอื่นเข้ามาอยู่หน้า = ต้องหยุด
            const hasHigherJob = activeJobIdx > 0 && state.jobs.some(
              (j, i) => i < activeJobIdx && (j.status === 'pending' || j.status === 'queued')
            );

            if (hasHigherJob || state.isPausedForForeground) {
              console.log(`[QueueProcessor] Preempting job ${this.activeJobId} (idx=${activeJobIdx}). Higher job exists or foreground active. Pausing...`);
              // ตั้งสถานะเป็น 'queued' (Pause) ก่อน abort เพื่อให้ Error Handler รู้ว่าไม่ควร Cancel
              if (activeJob.status === 'processing') {
                useBackgroundQueueStore.getState().updateJobStatus(
                  this.activeJobId, 'queued', 'รอคิว (ถูกแทรก)...'
                );
              }
              this.abortCurrentJob();
            }
          }
        }
      });
    }
  }

  /**
   * ลงทะเบียน Handlers สำหรับการแปลภาษา
   */
  public registerHandlers(handlers: BackgroundQueueHandlers) {
    this.handlers = handlers;
    console.log('[QueueProcessor] Background handlers registered.');
  }

  /**
   * เริ่มลูปประมวลผลคิวงาน
   */
  public startProcessingLoop() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    void (async () => {
      console.log('[QueueProcessor] Starting background processing loop...');
      
      try {
        if (window.electronAPI?.power?.preventSleep) {
          await window.electronAPI.power.preventSleep();
        }
      } catch (err) {
        console.warn('[QueueProcessor] Failed to prevent sleep:', err);
      }

      try {
        while (true) {
          // ตรวจสอบสถานะการ pause ของคิวภาพรวม และการประมวลผล Foreground
          const storeState = useBackgroundQueueStore.getState();
          if (storeState.isPaused || storeState.isPausedForForeground) {
            console.log('[QueueProcessor] Queue processor is paused (global or foreground). Exiting loop.');
            break;
          }

          // หางานถัดไปในคิวที่มีลำดับความสำคัญสูงสุด
          const job = useBackgroundQueueStore.getState().getNextPendingJob();
          if (!job) {
            console.log('[QueueProcessor] No pending jobs in queue. Exiting loop.');
            break;
          }

          try {
            this.activeJobId = job.id;
            useBackgroundQueueStore.getState().updateJobStatus(job.id, 'processing', 'เริ่มกระบวนการ...');
            this.currentAbortController = new AbortController();

            console.log(`[QueueProcessor] Running Job ${job.id}: ${job.filename} (${job.type})`);
            await this.processJob(job, this.currentAbortController.signal);
            
            useBackgroundQueueStore.getState().updateJobStatus(job.id, 'completed', 'เสร็จสมบูรณ์!');
          } catch (error) {
            // ดึงสถานะปัจจุบันของ Job จาก Store
            const currentJob = useBackgroundQueueStore.getState().jobs.find(j => j.id === job.id);

            const isSignalAborted = Boolean(this.currentAbortController?.signal?.aborted);
            const isAbortLike = error instanceof Error && (
              error.name === 'AbortError' ||
              error.message.includes('canceled') ||
              error.message.includes('aborted') ||
              error.message.includes('aborted by signal')
            );

            if (currentJob?.status === 'cancelled') {
              console.log(`[QueueProcessor] Job ${job.id} was cancelled.`);
            } else if (currentJob?.status === 'paused') {
              console.log(`[QueueProcessor] Job ${job.id} was paused.`);
            } else if (isSignalAborted && (currentJob?.status === 'queued' || currentJob?.status === 'pending')) {
              // งานถูก abort เพื่อหลีกทางให้งานอื่นที่มีลำดับสูงกว่า (Preemption) หรือ Foreground
              // สถานะ queued ถูกตั้งค่าไว้แล้วโดย Subscriber ก่อน abort ไม่ต้องทำอะไรเพิ่ม
              console.log(`[QueueProcessor] Job ${job.id} was preempted. Keeping queued status.`);
            } else if (isSignalAborted || isAbortLike) {
              // Abort via signal: ตรวจสอบสถานะล่าสุดอีกครั้ง
              const freshState = useBackgroundQueueStore.getState().jobs.find(j => j.id === job.id);
              if (freshState?.status === 'queued' || freshState?.status === 'pending') {
                console.log(`[QueueProcessor] Job ${job.id} aborted for preemption, keeping queued status.`);
              } else {
                console.log(`[QueueProcessor] Job ${job.id} aborted via signal. Marking cancelled.`);
                useBackgroundQueueStore.getState().updateJobStatus(job.id, 'cancelled', 'ยกเลิกแล้ว');
              }
            } else {
              // Unexpected failure / PDF.js Worker crash: แจ้งเตือนข้อผิดพลาดจริง
              console.error(`[QueueProcessor] Job ${job.id} failed with error:`, error);
              const errMsg = error instanceof Error ? error.message : 'Unknown processor error';
              useBackgroundQueueStore.getState().updateJobStatus(job.id, 'failed', `ล้มเหลว: ${errMsg}`);
            }
          } finally {
            this.activeJobId = null;
            this.currentAbortController = null;
          }
          
          // หน่วงเวลาเล็กน้อยก่อนประมวลผลงานชิ้นถัดไป เพื่อให้ JS event loop ได้หายใจ
          await new Promise(resolve => setTimeout(resolve, 160));
        }
      } finally {
        this.isProcessing = false;
        this.releaseHeadlessCanvas();
        console.log('[QueueProcessor] Background processing loop ended.');

        try {
          if (window.electronAPI?.power?.allowSleep) {
            await window.electronAPI.power.allowSleep();
          }
        } catch (err) {
          console.warn('[QueueProcessor] Failed to allow sleep:', err);
        }
      }
    })();
  }

  /**
   * ยกเลิกงานที่กำลังทำงานอยู่
   */
  public abortCurrentJob() {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  /**
   * ลบการทำงานและปล่อยการประมวลผล
   */
  public stop() {
    this.abortCurrentJob();
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.releaseHeadlessCanvas();
    this.isProcessing = false;
  }

  /**
   * ประมวลผลงาน (Job) ทีละหน้า
   */
  private async processJob(job: BackgroundJob, signal: AbortSignal): Promise<void> {
    const jobStartTime = performance.now();
    const isArgosProfiling = typeof window !== 'undefined' && window.localStorage?.getItem('pdf_translator_argos_profile') === '1';
    if (isArgosProfiling && typeof window !== 'undefined') {
      (window as any).__ARGOS_IPC_LOG__ = [];
      (window as any).__PAGE_TRANSLATION_TIMINGS__ = [];
      (window as any).__ARGOS_COORDINATOR_STATS__ = {
        n_dict_hits: 0,
        n_mem_cache_hits: 0,
        n_db_sentence_cache_hits: 0,
        n_engine_calls: 0,
      };
    }

    const throwIfAborted = () => {
      if (signal.aborted) {
        throw new Error('Process aborted by user');
      }
    };

    // ตรวจ abort ก่อน throw เสมอ
    if (signal.aborted) {
      throw new Error('Process aborted by signal');
    }

    // 0. Prewarm engine with idempotent key and 60s timeout
    let prewarmDurationMs = 0;
    const prewarmStartTime = performance.now();
    try {
      const prewarmTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Prewarm timed out after 60s')), 60000)
      );
      await Promise.race([
        this.prewarm(job.engine, job.ocrLanguage || 'eng', {
          qualityProfile: job.ocrQualityProfile || 'best',
          pipelineProfile: 'panel',
        }),
        prewarmTimeout,
      ]);
      prewarmDurationMs = Number((performance.now() - prewarmStartTime).toFixed(2));
      console.log(`[QueueProcessor] Prewarm ready in ${prewarmDurationMs}ms`);
    } catch (prewarmErr) {
      prewarmDurationMs = Number((performance.now() - prewarmStartTime).toFixed(2));
      console.warn('[QueueProcessor] Prewarm skipped or failed:', prewarmErr);
      this.prewarmedKey = null;
      this.activePrewarmPromise = null;
    }

    // Eager Prewarm Argos worker for translation jobs (ADR-0009 Phase 1)
    if (this.isTranslationJob(job) && window.electronAPI?.translate?.offlineBatch) {
      window.electronAPI.translate.offlineBatch(['Hello'], {
        profileTag: 'prewarm',
        sourceLanguage: job.sourceLanguage || 'en',
        targetLanguage: job.targetLanguage || 'th',
        mode: 'manga',
        sourceType: 'text',
        engine: 'argos',
      }).catch((err) => {
        console.warn('[QueueProcessor] Eager Argos prewarm dispatch warning:', err);
      });
    }

    // 1. โหลดข้อมูลไฟล์ PDF จาก filesystem มาเป็น ArrayBuffer
    // แสดง immediate feedback บอก user ว่าเริ่มงานแล้ว (ลด delay การ perceive)
    useBackgroundQueueStore.getState().updateJobProgress(job.id, 1, 0, 'กำลังโหลดไฟล์เอกสาร...');
    let fileData: ArrayBuffer;
    try {
      const fileRes = await window.electronAPI.fs.readFile(job.filepath);
      if (typeof fileRes.data === 'string') {
        throw new Error('Headless PDF read returned string instead of buffer');
      }
      fileData = fileRes.data instanceof ArrayBuffer 
        ? fileRes.data 
        : ((fileRes.data as Uint8Array).buffer as ArrayBuffer);
    } catch (err) {
      console.error('[QueueProcessor] Failed to read PDF file:', err);
      throw new Error(`ไม่สามารถเปิดไฟล์เอกสารได้: ${err instanceof Error ? err.message : 'unknown'}`);
    }

    throwIfAborted();

    // 2. โหลด PDF ผ่าน pdfjs ในหน่วยความจำ (Headless Mode)
    useBackgroundQueueStore.getState().updateJobProgress(job.id, 3, 1, 'กำลังเตรียมโครงสร้างเอกสาร...');
    const pdfDoc = await pdfjs.getDocument({ data: fileData }).promise;
    const totalPages = pdfDoc.numPages;

    console.log(`[QueueProcessor] PDF loaded. Total pages: ${totalPages}`);
    useBackgroundQueueStore.getState().updateJobProgress(job.id, 5, 1, 'กำลังเตรียมเรนเดอร์หน้าแรก...', totalPages);

    const isSinglePage = job.type.endsWith('_single') && typeof job.targetPage === 'number';
    const startPage = isSinglePage ? (job.targetPage as number) : 1;
    const endPage = isSinglePage ? (job.targetPage as number) : totalPages;
    const pagesCount = endPage - startPage + 1;
    const pageNumbers: number[] = [];
    if (isSinglePage) {
      pageNumbers.push(job.targetPage as number);
    } else {
      for (let p = 1; p <= totalPages; p++) {
        pageNumbers.push(p);
      }
    }


    let processedCount = 0;
    let processedOcrCount = 0;
    let successPagesCount = 0;
    let hasApiError = false;
    let lastErrorMessage = '';
    let lastReportedProgress = 5;
    const jobStageTimings: PageStageTimings[] = [];
    const translationErrors: { pageNum: number; message: string }[] = [];

    // Bounded Producer-Consumer Pipeline (ADR-0008 Revised):
    // 1. inFlightLimiter (Bounded Backpressure: max = 3 for DirectML, 4 for CPU)
    // 2. ocrStageLimiter (max = 1 for DirectML to protect VRAM, 2 for CPU)
    // 3. translationStageLimiter (max = 1 for Argos worker)
    const jobBackend = job.backend || useOCRTextLayerStore.getState().options.backend || 'paddle';
    let maxInFlight = jobBackend === 'ort_dml' ? 3 : 4;

    // Dynamic VRAM Guard: Check VRAM status before launching job (fast in-memory cache, 0ms)
    try {
      const gpuInfo = await window.electronAPI?.ocr?.getGpuInfo?.();
      const totalVram = gpuInfo?.totalVramMb;
      const freeVram = gpuInfo?.freeVramMb;
      // Only throttle if total hardware VRAM is genuinely constrained (< 3072 MB)
      if (totalVram !== null && totalVram !== undefined && totalVram > 0 && totalVram < 3072) {
        maxInFlight = 2;
        console.warn(
          `[QueueProcessor] Dynamic VRAM Guard: Constrained hardware VRAM detected (${totalVram} MB). ` +
          `Throttling maxInFlight from ${jobBackend === 'ort_dml' ? 3 : 4} to 2 to prevent memory pressure.`
        );
      } else {
        console.log(
          `[QueueProcessor] Dynamic VRAM Guard: Hardware VRAM is adequate (Total: ${totalVram ?? 'N/A'} MB, Free: ${freeVram ?? 'N/A'} MB). Using maxInFlight = ${maxInFlight}.`
        );
      }
    } catch (vramErr) {
      console.warn('[QueueProcessor] Dynamic VRAM Guard query skipped:', vramErr);
    }

    const inFlightLimiter = new ConcurrencyLimiter(maxInFlight);

    const ocrConcurrency = jobBackend === 'ort_dml' ? 1 : 2;
    const ocrStageLimiter = new ConcurrencyLimiter(ocrConcurrency);

    const translationStageLimiter = new ConcurrencyLimiter(1);
    let hasNotifiedFallback = false;

    const clearAllLimiters = () => {
      ocrStageLimiter.clear();
      translationStageLimiter.clear();
      inFlightLimiter.clear();
    };

    const onAbort = () => {
      clearAllLimiters();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const isTrans = this.isTranslationJob(job);
    const progressScale = isTrans ? 85 : 100;

    const updateMonotonicProgress = (targetProgress: number, pageNum: number, message: string) => {
      const nextProgress = Math.max(lastReportedProgress, Math.min(100, targetProgress));
      lastReportedProgress = nextProgress;
      useBackgroundQueueStore.getState().updateJobProgress(
        job.id,
        nextProgress,
        pageNum,
        message
      );
    };

    const processPageTask = async (pageNum: number): Promise<void> => {
      throwIfAborted();
      const taskEnqueueTime = performance.now();
      let queueWaitMs = 0;

      await inFlightLimiter.run(async () => {
        throwIfAborted();
        const slotEnterTime = performance.now();
        queueWaitMs = Number((slotEnterTime - taskEnqueueTime).toFixed(2));

        // ── Stage 1: GPU/CPU OCR Stage (Render Canvas + OCR IPC strictly inside ocrStageLimiter) ──
        const ocrStageStartTime = performance.now();
        const { ocrResult, renderDurationMs, ocrIpcDurationMs, ocrCacheLoadDurationMs } = await ocrStageLimiter.run(async () => {
          throwIfAborted();
          updateMonotonicProgress(
            Math.round((processedOcrCount / pagesCount) * progressScale),
            pageNum,
            isSinglePage
              ? `กำลังวิเคราะห์หน้าที่ ${pageNum}...`
              : `กำลังตรวจจับตัวอักษรหน้าที่ ${pageNum}/${totalPages}...`
          );

          return await this.executePageOCR(pdfDoc, job, pageNum, signal);
        });
        const ocrStageWallMs = Number((performance.now() - ocrStageStartTime).toFixed(2));
        // <-- ocrStageLimiter slot is released immediately! Next page starts GPU OCR right now!

        throwIfAborted();

        // Runtime Truth Sync & Fallback Monitoring (ADR-0005)
        const resBackend = ocrResult.actualBackend || ocrResult.debug?.actualBackend;
        const resFallbackReason = ocrResult.fallbackReason || ocrResult.debug?.fallbackReason;
        if (jobBackend === 'ort_dml') {
          if (resBackend === 'ort_dml') {
            useOCRTextLayerStore.getState().setRuntimeBackendStatus('active_dml', null);
          } else if (resBackend === 'paddle') {
            useOCRTextLayerStore.getState().setRuntimeBackendStatus('fallback_cpu', resFallbackReason || 'unknown');
            if (!hasNotifiedFallback) {
              hasNotifiedFallback = true;
              console.warn(
                `[QueueProcessor] DirectML OCR fell back to CPU for job ${job.id}: ${resFallbackReason || 'unspecified'}`
              );
            }
          }
        }

        throwIfAborted();

        // Sync layers to UI & DB immediately
        const syncStartMark = `job-${job.id}-p${pageNum}-syncLayers-start`;
        const syncEndMark = `job-${job.id}-p${pageNum}-syncLayers-end`;
        const syncMeasureName = `job-${job.id}-p${pageNum}-syncLayers`;
        performance.mark(syncStartMark);
        this.syncPageLayers(job.documentId, pageNum, ocrResult);
        performance.mark(syncEndMark);
        let syncLayersDurationMs = 0;
        try {
          const m = performance.measure(syncMeasureName, syncStartMark, syncEndMark);
          syncLayersDurationMs = m.duration;
          performance.clearMarks(syncStartMark);
          performance.clearMarks(syncEndMark);
        } catch {}

        processedOcrCount++;
        const finishedOcrProgress = Math.round((processedOcrCount / pagesCount) * progressScale);
        updateMonotonicProgress(
          finishedOcrProgress,
          pageNum,
          isSinglePage
            ? `ตรวจจับตัวอักษรหน้าที่ ${pageNum} เสร็จสมบูรณ์!`
            : `ตรวจจับตัวอักษรหน้าที่ ${pageNum} สำเร็จ (${processedOcrCount}/${pagesCount}) • กำลังอ่านหน้าถัดไป...`
        );

        const pageTiming: PageStageTimings = {
          pageNum,
          queueWaitMs,
          renderMs: Number(renderDurationMs.toFixed(2)),
          ocrIpcMs: Number(ocrIpcDurationMs.toFixed(2)),
          ocrCacheLoadMs: Number(ocrCacheLoadDurationMs.toFixed(2)),
          ocrStageWallMs,
          syncLayersMs: Number(syncLayersDurationMs.toFixed(2)),
          transQueueWaitMs: 0,
          translationMs: 0,
          slotHoldMs: 0,
          totalMs: Number((renderDurationMs + ocrIpcDurationMs + ocrCacheLoadDurationMs + syncLayersDurationMs).toFixed(2)),
        };
        jobStageTimings.push(pageTiming);

        if (processedOcrCount === 1) {
          console.log(
            `[QueueProcessor] [FirstPageTiming] Page ${pageNum}: OCR IPC = ${pageTiming.ocrIpcMs}ms, Total = ${pageTiming.totalMs}ms (prewarmed=${Boolean(this.prewarmedKey)})`
          );
        }

        // ── Stage 2: CPU Translation Stage ──
        if (isTrans) {
          throwIfAborted();
          const transQueueStartTime = performance.now();
          await translationStageLimiter.run(async () => {
            pageTiming.transQueueWaitMs = Number((performance.now() - transQueueStartTime).toFixed(2));
            if (signal.aborted) return;
            const transStartMark = `job-${job.id}-p${pageNum}-trans-start`;
            const transEndMark = `job-${job.id}-p${pageNum}-trans-end`;
            const transMeasureName = `job-${job.id}-p${pageNum}-trans`;
            performance.mark(transStartMark);

            try {
              await this.dispatchPageTranslation(job, pageNum, totalPages, ocrResult, signal);
              performance.mark(transEndMark);
              try {
                const m = performance.measure(transMeasureName, transStartMark, transEndMark);
                pageTiming.translationMs = Number(m.duration.toFixed(2));
                pageTiming.totalMs = Number((pageTiming.renderMs + pageTiming.ocrIpcMs + pageTiming.ocrCacheLoadMs + pageTiming.syncLayersMs + pageTiming.translationMs).toFixed(2));
                performance.clearMarks(transStartMark);
                performance.clearMarks(transEndMark);
              } catch {}
            } catch (transErr: any) {
              if (signal.aborted) throw transErr;
              const errMsg = transErr?.message || String(transErr);
              console.warn(`[QueueProcessor] Translation failed for page ${pageNum} (isolated error, OCR kept):`, errMsg);
              translationErrors.push({ pageNum, message: errMsg });
            }
          });
        }

        processedCount++;
        successPagesCount++;

        // Periodic driver cache clear every 8 completed pages (only when GPU OCR ran on this page)
        if (processedCount % 8 === 0 && pageTiming.ocrIpcMs > 0 && window.electronAPI?.ocr?.clearCudaCache) {
          try {
            await window.electronAPI.ocr.clearCudaCache({ engine: job.engine });
          } catch {}
        }

        pageTiming.slotHoldMs = Number((performance.now() - slotEnterTime).toFixed(2));
      });
    };

    try {
      const pagePromises = pageNumbers.map((p) =>
        processPageTask(p).catch((err) => {
          if (err?.name === 'AbortError' || signal.aborted) {
            return;
          }
          throw err;
        })
      );
      await Promise.all(pagePromises);
    } catch (err: any) {
      clearAllLimiters();
      if (signal.aborted) {
        throw err;
      }
      console.error(`[QueueProcessor] Error processing pages:`, err);
      lastErrorMessage = err.message || String(err);
      if (lastErrorMessage.toLowerCase().includes('gemini') || lastErrorMessage.toLowerCase().includes('api')) {
        hasApiError = true;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    if (signal.aborted) {
      clearAllLimiters();
      throw new Error('Process aborted by signal');
    }

    if (processedCount < pagesCount) {
      const targetStatus = successPagesCount > 0 ? 'partial_success' : (hasApiError ? 'api_failed' : 'failed');
      const targetMessage = successPagesCount > 0
        ? `แปลสำเร็จบางส่วน (${successPagesCount}/${pagesCount} หน้า). เกิดข้อผิดพลาดในหน้าถัดไป: ${lastErrorMessage}`
        : `แปลล้มเหลว: ${lastErrorMessage}`;
      
      useBackgroundQueueStore.getState().updateJobStatus(job.id, targetStatus, targetMessage);
      throw new Error(`Queue processing halted: ${targetMessage}`);
    }

    if (jobStageTimings.length > 0) {
      console.log(`\n[QueueProcessor] =======================================================`);
      console.log(`[QueueProcessor] PERFORMANCE TIMING SUMMARY: Job ${job.id} (${job.filename})`);
      console.log(`[QueueProcessor] Engine: ${job.engine} | Pages Measured: ${jobStageTimings.length}`);
      console.log(`[QueueProcessor] =======================================================`);
      console.table({
        '0a. Limiter Queue Wait Time': calculateStageStats(jobStageTimings.map(t => t.queueWaitMs)),
        '0b. Translation Queue Wait': calculateStageStats(jobStageTimings.map(t => t.transQueueWaitMs)),
        '1. Render (Headless 300DPI)': calculateStageStats(jobStageTimings.map(t => t.renderMs)),
        '2. OCR (IPC Round-Trip)': calculateStageStats(jobStageTimings.map(t => t.ocrIpcMs)),
        '2a. OCR Cache Load (DB Hit)': calculateStageStats(jobStageTimings.map(t => t.ocrCacheLoadMs)),
        '2b. OCR Stage Wall Time': calculateStageStats(jobStageTimings.map(t => t.ocrStageWallMs)),
        '3. Sync Page Layers': calculateStageStats(jobStageTimings.map(t => t.syncLayersMs)),
        '4. Translation': calculateStageStats(jobStageTimings.map(t => t.translationMs)),
        '5. In-Flight Slot Hold Time': calculateStageStats(jobStageTimings.map(t => t.slotHoldMs)),
        'Total Per Page Pipeline': calculateStageStats(jobStageTimings.map(t => t.totalMs)),
      });
    }

    const jobWallClockMs = Number((performance.now() - jobStartTime).toFixed(2));

    if (isArgosProfiling && typeof window !== 'undefined') {
      const ipcLogs: Array<{
        seq: number;
        tag: string;
        n_texts: number;
        t_start_epoch_ms: number;
        ipc_ms: number;
        ipc_status: 'ok' | 'bad_response' | 'exception_or_timeout';
      }> = (window as any).__ARGOS_IPC_LOG__ || [];

      interface IpcTagStat {
        calls: number;
        totalMs: number;
        meanMs: number;
        minMs: number;
        maxMs: number;
        p95Ms: number;
        badResponseCount: number;
        exceptionOrTimeoutCount: number;
      }

      const byTag: Record<string, IpcTagStat> = {};
      ipcLogs.forEach((log) => {
        const tag = log.tag || 'untagged';
        if (!byTag[tag]) {
          byTag[tag] = {
            calls: 0,
            totalMs: 0,
            meanMs: 0,
            minMs: Infinity,
            maxMs: -Infinity,
            p95Ms: 0,
            badResponseCount: 0,
            exceptionOrTimeoutCount: 0,
          };
        }
        const s = byTag[tag];
        s.calls++;
        s.totalMs += log.ipc_ms;
        s.minMs = Math.min(s.minMs, log.ipc_ms);
        s.maxMs = Math.max(s.maxMs, log.ipc_ms);
        if (log.ipc_status === 'bad_response') s.badResponseCount++;
        if (log.ipc_status === 'exception_or_timeout') s.exceptionOrTimeoutCount++;
      });

      Object.keys(byTag).forEach((tag) => {
        const s = byTag[tag];
        s.totalMs = Number(s.totalMs.toFixed(2));
        s.meanMs = Number((s.totalMs / Math.max(1, s.calls)).toFixed(2));
        s.minMs = s.minMs === Infinity ? 0 : Number(s.minMs.toFixed(2));
        s.maxMs = s.maxMs === -Infinity ? 0 : Number(s.maxMs.toFixed(2));
        const tagIpcTimes = ipcLogs.filter((l) => (l.tag || 'untagged') === tag).map((l) => l.ipc_ms);
        s.p95Ms = calculatePercentile(tagIpcTimes, 95);
      });

      const allIpcTimes = ipcLogs.map((l) => l.ipc_ms);
      const badResponseCount = ipcLogs.filter((l) => l.ipc_status === 'bad_response').length;
      const exceptionOrTimeoutCount = ipcLogs.filter((l) => l.ipc_status === 'exception_or_timeout').length;
      const p95_ipc_ms = calculatePercentile(allIpcTimes, 95);

      const report = {
        jobId: job.id,
        filename: job.filename,
        engine: job.engine,
        jobWallClockMs,
        prewarmMs: prewarmDurationMs,
        pagesMeasured: jobStageTimings.length,
        stageTimings: {
          queueWait: calculateStageStats(jobStageTimings.map((t) => t.queueWaitMs)),
          transQueueWait: calculateStageStats(jobStageTimings.map((t) => t.transQueueWaitMs)),
          render: calculateStageStats(jobStageTimings.map((t) => t.renderMs)),
          ocrIpc: calculateStageStats(jobStageTimings.map((t) => t.ocrIpcMs)),
          ocrCacheLoad: calculateStageStats(jobStageTimings.map((t) => t.ocrCacheLoadMs)),
          ocrStageWall: calculateStageStats(jobStageTimings.map((t) => t.ocrStageWallMs)),
          syncLayers: calculateStageStats(jobStageTimings.map((t) => t.syncLayersMs)),
          translation: calculateStageStats(jobStageTimings.map((t) => t.translationMs)),
          slotHold: calculateStageStats(jobStageTimings.map((t) => t.slotHoldMs)),
          totalPerPage: calculateStageStats(jobStageTimings.map((t) => t.totalMs)),
        },
        pageTranslationBreakdown: (window as any).__PAGE_TRANSLATION_TIMINGS__ || [],
        coordinatorStats: (window as any).__ARGOS_COORDINATOR_STATS__ || {},
        ipcSummary: {
          totalCalls: ipcLogs.length,
          badResponseCount,
          exceptionOrTimeoutCount,
          p95_ipc_ms,
          byTag,
        },
      };

      (window as any).__LAST_ARGOS_BENCHMARK_REPORT__ = report;

      console.log(`\n[QueueProcessor] =======================================================`);
      console.log(`[QueueProcessor] ARGOS BENCHMARK REPORT (ADR-0009 Phase 0)`);
      console.log(`[QueueProcessor] Job Wall Clock: ${jobWallClockMs}ms | IPC Calls: ${ipcLogs.length} | p95 IPC: ${p95_ipc_ms}ms | Non-OK Statuses: ${badResponseCount + exceptionOrTimeoutCount}`);
      console.log(`[QueueProcessor] =======================================================`);
      console.table(byTag);
      console.log('[QueueProcessor] Full report available at window.__LAST_ARGOS_BENCHMARK_REPORT__:', report);
    }

    if (translationErrors.length > 0) {
      const targetStatus = 'partial_success';
      const targetMessage = `ประมวลผล OCR สำเร็จทุกหน้า (${pagesCount}/${pagesCount}) แต่การแปลล้มเหลว ${translationErrors.length} หน้า: ${translationErrors.map(e => `หน้า ${e.pageNum}`).join(', ')}`;
      useBackgroundQueueStore.getState().updateJobStatus(job.id, targetStatus, targetMessage);
    } else {
      useBackgroundQueueStore.getState().updateJobProgress(
        job.id, 
        100, 
        endPage, 
        isSinglePage ? 'ประมวลผลหน้าเดี่ยวสำเร็จเสร็จสิ้น!' : (this.isTranslationJob(job) ? 'แปลภาษาสำเร็จเสร็จสิ้น!' : 'ตรวจจับตัวอักษรสำเร็จเสร็จสิ้น!')
      );
    }
  }

  /**
   * ค้นหาแคช OCR ใน SQLite หรือเรนเดอร์ Headless + รัน OCR พร้อม 2-Stage Prefetch Pipeline
   */
  private async executePageOCR(
    pdfDoc: any,
    job: BackgroundJob,
    pageNum: number,
    signal: AbortSignal,
    _nextPageNum?: number | null,
    _prefetch?: PrefetchPipelineController | null
  ): Promise<{ ocrResult: OCRPageResult; renderDurationMs: number; ocrIpcDurationMs: number; ocrCacheLoadDurationMs: number }> {
    const throwIfAborted = () => {
      if (signal.aborted) throw new Error('Process aborted by user');
    };

    let ocrResult: OCRPageResult | null = null;
    let pageData: RenderedPageData | null = null;
    let ocrIpcDurationMs = 0;
    const cacheLoadStartTime = performance.now();

    // ลองค้นหา OCR แคชจากฐานข้อมูลก่อน
    try {
      const cached = await dbService.getOCR(job.documentId, pageNum, job.engine);
      if (cached && cached.lines && cached.lines.length > 0) {
        const cachedRawVersion = cached.ocrRawVersion ?? 1;
        const targetOcrLanguage = job.ocrLanguage || useOCRTextLayerStore.getState().options.language || 'eng';
        const languageMismatch = normalizeLanguage(cached.language || '') !== normalizeLanguage(targetOcrLanguage);

        if (cachedRawVersion < OCR_RAW_VERSION) {
          console.log(`[QueueProcessor] Page ${pageNum} raw OCR version mismatch (${cachedRawVersion} < ${OCR_RAW_VERSION}). Re-running OCR...`);
        } else if (languageMismatch) {
          console.log(`[QueueProcessor] Page ${pageNum} language mismatch (cached: "${cached.language}", target: "${targetOcrLanguage}"). Re-running OCR...`);
        } else {
          const normalizedProfile = (cached.pipelineProfile || 'panel') === 'panel'
            ? cached
            : { ...cached, pipelineProfile: 'panel' as const };
          const scriptGated = applyPanelLanguageScriptGate(normalizedProfile, targetOcrLanguage);
          let needResave = false;
          if (
            scriptGated.pipelineProfile === 'panel' &&
            scriptGated.debug?.panelSafetyNormalizedVersion === OCR_ALGORITHM_VERSION
          ) {
            ocrResult = scriptGated;
          } else {
            ocrResult = applyPanelSafetyLineDedup(scriptGated);
            ocrResult.algorithmVersion = OCR_ALGORITHM_VERSION;
            if (!ocrResult.debug) ocrResult.debug = { droppedWords: [], dropCounts: {} };
            ocrResult.debug.panelSafetyNormalizedVersion = OCR_ALGORITHM_VERSION;
            needResave = true;
          }

          if (ocrResult) {
            ocrResult = processAndCleanOCR(ocrResult, job.engine, job);
          }
          console.log(`[QueueProcessor] Page ${pageNum} OCR Cache Hit!`);

          if (needResave) {
            await dbService.saveOCR(job.documentId, pageNum, ocrResult, job.engine);
            console.log(`[QueueProcessor] Saved updated OCR cache for page ${pageNum} after background deduplication upgrade (v${OCR_ALGORITHM_VERSION}).`);
          }

          const activeFile = useProjectStore.getState().file;
          const activeDocId = useProjectStore.getState().documentId;
          const activeCurrentPage = useProjectStore.getState().currentPage;
          // Selective hydration: background pages stay in SQLite and hydrate on-demand when viewed.
          // Eagerly hydrating every page cloned Zustand Maps + ran layout grouping N times on the main thread.
          if (activeFile && activeDocId === job.documentId && activeCurrentPage === pageNum) {
            useOCRTextLayerStore.getState().setPageOCR(pageNum, ocrResult);
            const storeResult = useOCRTextLayerStore.getState().ocrByPageEngine.get(pageNum)?.get(job.engine)
              || useOCRTextLayerStore.getState().allPagesOCR.get(pageNum);
            if (storeResult) {
              ocrResult = storeResult;
            }
          }

          const ocrCacheLoadDurationMs = Number((performance.now() - cacheLoadStartTime).toFixed(2));
          return {
            ocrResult,
            renderDurationMs: 0,
            ocrIpcDurationMs: 0,
            ocrCacheLoadDurationMs,
          };
        }
      }
    } catch (err) {
      console.warn(`[QueueProcessor] DB cache read warning for page ${pageNum}:`, err);
    }

    // หากไม่มีแคช ให้ทำ Headless Rendering + OCR
    if (!ocrResult) {
      throwIfAborted();
      console.log(`[QueueProcessor] Page ${pageNum} Cache Miss. Running Headless OCR...`);

      pageData = await this.renderHeadlessPage(pdfDoc, pageNum, job, signal);

      throwIfAborted();

      if (pageData.blankOcrResult) {
        ocrResult = pageData.blankOcrResult;
      } else if (pageData.imageBlob) {
        const options = useOCRTextLayerStore.getState().options;
        const pageSegModeVal = job.ocrPageSegMode !== undefined
          ? (job.ocrPageSegMode === null ? undefined : job.ocrPageSegMode)
          : (options.pageSegMode === null ? undefined : options.pageSegMode);

        const resolvedUseAngleCls = job.useAngleCls !== undefined
          ? Boolean(job.useAngleCls)
          : Boolean(options.useAngleCls);

        useBackgroundQueueStore.getState().updateJobProgress(
          job.id,
          Math.max(10, useBackgroundQueueStore.getState().jobs.find(j => j.id === job.id)?.progress || 10),
          pageNum,
          `กำลังตรวจจับตัวอักษรหน้าที่ ${pageNum} ด้วย ${job.engine}...`
        );

        const ocrStartMark = `job-${job.id}-p${pageNum}-ocr-start`;
        const ocrEndMark = `job-${job.id}-p${pageNum}-ocr-end`;
        const ocrMeasureName = `job-${job.id}-p${pageNum}-ocr`;
        performance.mark(ocrStartMark);

        const ocrPromise = visionService.ocrForTextLayer(
          pageData.imageBlob,
          pageData.canvasWidth,
          pageData.canvasHeight,
          pageData.ocrLanguage,
          pageData.targetDpi,
          pageSegModeVal,
          signal,
          false,
          'panel',
          pageData.resolvedQualityProfile,
          job.engine,
          pageData.canvasWidth * pageData.canvasHeight,
          {
            useAngleCls: resolvedUseAngleCls
          }
        );

        ocrResult = await ocrPromise;

        performance.mark(ocrEndMark);
        try {
          const m = performance.measure(ocrMeasureName, ocrStartMark, ocrEndMark);
          ocrIpcDurationMs = m.duration;
          performance.clearMarks(ocrStartMark);
          performance.clearMarks(ocrEndMark);
        } catch {
          // ignore mark measure failures
        }
      }

      if (!ocrResult) {
        throw new Error(`Headless OCR failed to produce result for page ${pageNum}`);
      }

      ocrResult.pageNumber = pageNum;
      ocrResult.ocrEngine = job.engine;
      ocrResult.language = normalizeLanguage(pageData.ocrLanguage);
      ocrResult.pipelineProfile = 'panel';
      ocrResult.ocrQualityProfile = pageData.resolvedQualityProfile;
      ocrResult.algorithmVersion = OCR_ALGORITHM_VERSION;
      ocrResult.ocrRawVersion = OCR_RAW_VERSION;

      ocrResult = applyPanelLanguageScriptGate(ocrResult, pageData.ocrLanguage);
      ocrResult = applyPanelSafetyLineDedup(ocrResult);
      ocrResult.algorithmVersion = OCR_ALGORITHM_VERSION;
      ocrResult.ocrRawVersion = OCR_RAW_VERSION;
      if (!ocrResult.debug) ocrResult.debug = { droppedWords: [], dropCounts: {} };
      ocrResult.debug.panelSafetyNormalizedVersion = OCR_ALGORITHM_VERSION;

      throwIfAborted();

      // บันทึก OCR ดิบลง DB
      await dbService.saveOCR(job.documentId, pageNum, ocrResult, job.engine);

      // Process (split, filter, merge) สำหรับ Active session
      ocrResult = processAndCleanOCR(ocrResult, job.engine, job);

      const activeFile = useProjectStore.getState().file;
      const activeDocId = useProjectStore.getState().documentId;
      const activeCurrentPage = useProjectStore.getState().currentPage;
      // Selective hydration: only the visible page of the active document touches React stores.
      if (activeFile && activeDocId === job.documentId && activeCurrentPage === pageNum) {
        useOCRTextLayerStore.getState().setPageOCR(pageNum, ocrResult);
        const storeResult = useOCRTextLayerStore.getState().ocrByPageEngine.get(pageNum)?.get(job.engine)
          || useOCRTextLayerStore.getState().allPagesOCR.get(pageNum);
        if (storeResult) {
          ocrResult = storeResult;
        }
      }
    }

    return {
      ocrResult,
      renderDurationMs: pageData?.renderDurationMs || 0,
      ocrIpcDurationMs: ocrIpcDurationMs || 0,
      ocrCacheLoadDurationMs: 0,
    };
  }

  /**
   * ซิงค์และสร้างเลเยอร์จากผลลัพธ์ OCR ลง useLayerStore โดยเคารพกฎ Cross-Document Isolation
   */
  private syncPageLayers(documentId: number, pageNum: number, ocrResult: OCRPageResult): void {
    const activeDocId = useProjectStore.getState().documentId;
    const isActiveDoc = activeDocId !== null && activeDocId === documentId;

    if (!isActiveDoc) {
      // OCR is already persisted to SQLite in executePageOCR; skip UI layer store mutation for inactive documents.
      return;
    }

    // Background pages hydrate on-demand when viewed; skip layout grouping + Map cloning here.
    if (pageNum !== useProjectStore.getState().currentPage) {
      return;
    }

    try {
      const layerStore = useLayerStore.getState();
      const existingLayers = layerStore.getPageLayers(pageNum);
      const initialLayerResult = buildLayerGroupsFromOCR(ocrResult);
      const existingGroups = layerStore.getPageGroups(pageNum);
      const hasUserModifications = existingLayers.some(l => l.userEdited || l.id.startsWith('manual-layer-'))
        || existingGroups.some(g => g.userCreated);

      if (existingLayers.length === 0 || !hasUserModifications) {
        layerStore.setPageLayers(pageNum, initialLayerResult);
        console.log(`[QueueProcessor] Initialized ${initialLayerResult.layers.length} layers in ${initialLayerResult.groups.length} groups for active page ${pageNum} after OCR (overwrite).`);
      } else {
        const mergedResult = mergeLayersAndGroups(initialLayerResult, existingLayers, existingGroups);
        layerStore.setPageLayers(pageNum, mergedResult);
        console.log(`[QueueProcessor] Merged ${mergedResult.layers.length} layers in ${mergedResult.groups.length} groups for active page ${pageNum} after OCR.`);
      }
    } catch (err) {
      console.warn(`[QueueProcessor] Failed to initialize layers from OCR for page ${pageNum}:`, err);
    }
  }

  private isTranslationJob(job: BackgroundJob): boolean {
    return (
      job.type === 'offline_all' ||
      job.type === 'ai_all' ||
      job.type === 'offline_single' ||
      job.type === 'ai_single'
    );
  }

  /**
   * ดำเนินการแปลภาษาในหน้าเอกสารผ่าน Background Handlers
   */
  private async dispatchPageTranslation(
    job: BackgroundJob,
    pageNum: number,
    totalPages: number,
    ocrResult: OCRPageResult,
    signal: AbortSignal
  ): Promise<boolean> {
    if (!this.isTranslationJob(job)) return false;

    if (!this.handlers) {
      throw new Error('Translation handlers not registered in BackgroundQueueProcessor');
    }

    const targetLang = job.targetLanguage || 'th';
    if (dbService.isAvailable() && (job.type === 'offline_all' || job.type === 'ai_all')) {
      try {
        const transCache = await dbService.getTranslationCachePage(job.documentId, pageNum);
        if (Array.isArray(transCache) && transCache.length > 0) {
          const matched = transCache.find((row) => {
            const rowTargetLang = String(row.targetLanguage || '').toLowerCase();
            const targetRowLang = targetLang.toLowerCase();
            const hasContent = (row.translatedText && row.translatedText.trim().length > 0)
              || (Array.isArray(row.translatedByIndex) && row.translatedByIndex.length > 0);
            return rowTargetLang === targetRowLang && hasContent;
          });

          if (matched) {
            console.log(`[QueueProcessor] Page ${pageNum} Translation Cache Hit! Fast-skipping background translation...`);
            if (typeof window !== 'undefined') {
              const activePage = useProjectStore.getState().currentPage;
              const activeDoc = useProjectStore.getState().documentId;
              if (activeDoc === job.documentId && activePage === pageNum) {
                window.dispatchEvent(new CustomEvent('page-translation-updated', { detail: { pageNum } }));
              }
            }
            return true;
          }
        }
      } catch (err) {
        console.warn(`[QueueProcessor] Failed to check translation cache for page ${pageNum}:`, err);
      }
    }

    console.log(`[QueueProcessor] Translating Page ${pageNum}/${totalPages}...`);
    const translationEngine = (job.type === 'offline_all' || job.type === 'offline_single') ? 'offline' : 'ai';

    const success = await this.handlers.translatePage(
      job.documentId,
      pageNum,
      ocrResult,
      translationEngine,
      signal,
      {
        ocrLanguage: job.ocrLanguage,
        sourceLanguage: job.sourceLanguage,
        targetLanguage: job.targetLanguage,
        translationMode: job.translationMode,
      }
    );

    if (!success) {
      console.log(`[QueueProcessor] Page ${pageNum} translation was skipped (possibly no translatable text).`);
    }

    if (typeof window !== 'undefined') {
      const activePage = useProjectStore.getState().currentPage;
      const activeDoc = useProjectStore.getState().documentId;
      if (activeDoc === job.documentId && activePage === pageNum) {
        window.dispatchEvent(new CustomEvent('page-translation-updated', { detail: { pageNum } }));
      }
    }

    return success;
  }

  /**
   * เรนเดอร์หน้าเอกสารแบบ Headless และแปลงเป็น Blob พร้อมระบบตรวจจับหน้าว่าง
   */
  private async renderHeadlessPage(
    pdfDoc: any,
    pageNum: number,
    job: BackgroundJob,
    signal: AbortSignal
  ): Promise<RenderedPageData> {
    if (signal.aborted) throw new Error('Process aborted by signal');
    const page = await pdfDoc.getPage(pageNum);

    const options = useOCRTextLayerStore.getState().options;
    const targetDpi = job.ocrDpi || options.dpi || 300;
    const ocrLanguage = job.ocrLanguage || options.language || 'eng';
    const ocrQualityProfile = (job.ocrQualityProfile || options.ocrQualityProfile || 'best') as 'fast' | 'balanced' | 'best';
    const resolvedQualityProfile = (options.ocrQualityProfile || 'best') as 'fast' | 'balanced' | 'best';

    const requestedScale = targetDpi / 72;
    const requestedViewport = page.getViewport({ scale: requestedScale });

    const renderConstraints = resolveRenderConstraints(job.engine, ocrLanguage, ocrQualityProfile);
    const fitted = fitDimensionsToConstraints(requestedViewport.width, requestedViewport.height, renderConstraints);
    const scale = requestedScale * fitted.scaleFactor;

    const viewport = page.getViewport({ scale });

    const canvasWidth = Math.floor(viewport.width);
    const canvasHeight = Math.floor(viewport.height);
    const { canvas, ctx } = this.createRenderCanvas(canvasWidth, canvasHeight);

    const renderStartMark = `job-${job.id}-p${pageNum}-render-start`;
    const renderEndMark = `job-${job.id}-p${pageNum}-render-end`;
    const renderMeasureName = `job-${job.id}-p${pageNum}-render`;
    performance.mark(renderStartMark);

    try {
      if (signal.aborted) throw new Error('Process aborted by signal');

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      await page.render({
        canvasContext: ctx,
        viewport,
        intent: 'display',
        canvas
      } as any).promise;

      if (signal.aborted) throw new Error('Process aborted by signal');

      performance.mark(renderEndMark);
      let renderDurationMs = 0;
      try {
        const m = performance.measure(renderMeasureName, renderStartMark, renderEndMark);
        renderDurationMs = m.duration;
        performance.clearMarks(renderStartMark);
        performance.clearMarks(renderEndMark);
      } catch {
        // ignore mark measure failures
      }

      // Fast blank / solid color page detection check
      const blankCheck = detectBlankOrSolidCanvas(canvas);
      if (blankCheck.isBlank) {
        console.log(`[QueueProcessor] Page ${pageNum} is a blank/solid page (maxDeviation: ${blankCheck.maxDeviation}). Skipping OCR & translation.`);
        return {
          pageNum,
          canvasWidth,
          canvasHeight,
          targetDpi,
          ocrLanguage,
          resolvedQualityProfile,
          blankOcrResult: {
            lines: [],
            words: [],
            confidence: 100,
            language: normalizeLanguage(ocrLanguage),
            pageNumber: pageNum,
            width: canvasWidth,
            height: canvasHeight,
            dpi: targetDpi,
            ocrEngine: job.engine,
            pipelineProfile: 'panel',
            ocrQualityProfile: resolvedQualityProfile,
            algorithmVersion: OCR_ALGORITHM_VERSION,
            ocrRawVersion: OCR_RAW_VERSION,
            text: '',
            debug: {
              runtimeMs: 0,
              droppedWords: [],
              dropCounts: {},
            },
          }
        };
      }

      const imageBlob = await this.convertCanvasToLosslessPngBlob(canvas);

      return {
        pageNum,
        canvasWidth,
        canvasHeight,
        targetDpi,
        ocrLanguage,
        resolvedQualityProfile,
        renderDurationMs,
        imageBlob,
      };
    } finally {
      this.cleanupCanvas(canvas);
    }
  }

  /**
   * รัน OCR สำหรับหน้าเดียวแบบ On-Demand (Foreground)
   * ตรวจสอบ SQLite แคชก่อน หากไม่มีจะทำการเรนเดอร์ Headless PDF/Image แล้วส่งเข้า OCR Bridge
   */
  public async runSinglePageOCR(
    documentId: number,
    filePath: string,
    pageNum: number,
    engine: OCREngine,
    signal?: AbortSignal,
    options?: {
      ocrLanguage?: string;
      ocrDpi?: number;
      ocrPageSegMode?: number | null;
      ocrQualityProfile?: 'fast' | 'balanced' | 'best';
      useAngleCls?: boolean;
      forceRefresh?: boolean;
    }
  ): Promise<OCRPageResult> {
    const throwIfAborted = () => {
      if (signal?.aborted) throw new Error('Process aborted by signal');
    };

    throwIfAborted();

    // 1. ตรวจสอบแคชจาก SQLite DB ก่อน (ถ้าไม่ได้สั่ง forceRefresh)
    if (!options?.forceRefresh) {
      try {
        const cached = await dbService.getOCR(documentId, pageNum, engine);
        if (cached && cached.lines && cached.lines.length > 0) {
          const cachedRawVersion = cached.ocrRawVersion ?? 1;
          const targetOcrLanguage = options?.ocrLanguage || useOCRTextLayerStore.getState().options.language || 'eng';
          const languageMismatch = normalizeLanguage(cached.language || '') !== normalizeLanguage(targetOcrLanguage);

          if (cachedRawVersion >= OCR_RAW_VERSION && !languageMismatch) {
            let ocrResult = cached;
            const normalizedProfile = (cached.pipelineProfile || 'panel') === 'panel'
              ? cached
              : { ...cached, pipelineProfile: 'panel' as const };
            const scriptGated = applyPanelLanguageScriptGate(normalizedProfile, targetOcrLanguage);
            if (
              scriptGated.pipelineProfile === 'panel' &&
              scriptGated.debug?.panelSafetyNormalizedVersion === OCR_ALGORITHM_VERSION
            ) {
              ocrResult = scriptGated;
            } else {
              ocrResult = applyPanelSafetyLineDedup(scriptGated);
              ocrResult.algorithmVersion = OCR_ALGORITHM_VERSION;
              if (!ocrResult.debug) ocrResult.debug = { droppedWords: [], dropCounts: {} };
              ocrResult.debug.panelSafetyNormalizedVersion = OCR_ALGORITHM_VERSION;
            }

            ocrResult = processOCRPageResult(ocrResult, {
              engine,
              dpi: ocrResult.dpi || options?.ocrDpi || 300,
              storeLanguage: targetOcrLanguage,
            });

            ocrResult.pageNumber = pageNum;
            useOCRTextLayerStore.getState().setPageOCRForEngine(pageNum, engine, ocrResult);
            useOCRTextLayerStore.getState().setPageOCR(pageNum, ocrResult);
            return ocrResult;
          }
        }
      } catch (err) {
        console.warn(`[runSinglePageOCR] DB cache read warning for page ${pageNum}:`, err);
      }
    }

    throwIfAborted();

    // 2. Eager prewarm OCR daemon in background (parallel to PDF read/render)
    if (window.electronAPI?.ocr?.prewarmEngine && (engine === 'paddleocr' || engine === 'easyocr')) {
      const targetLang = options?.ocrLanguage || useOCRTextLayerStore.getState().options.language || 'eng';
      void window.electronAPI.ocr.prewarmEngine({ engine, language: targetLang }).catch((err: unknown) => {
        console.warn(`[runSinglePageOCR] Background prewarm warning for ${engine}:`, err);
      });
    }

    // 3. โหลดไฟล์และเรนเดอร์หน้าเอกสาร
    const isPdf = filePath.toLowerCase().endsWith('.pdf');
    let pageData: RenderedPageData;

    if (isPdf) {
      let fileData: ArrayBuffer;
      const fileRes = await window.electronAPI.fs.readFile(filePath);
      if (typeof fileRes.data === 'string') {
        throw new Error('Headless PDF read returned string instead of buffer');
      }
      fileData = fileRes.data instanceof ArrayBuffer
        ? fileRes.data
        : ((fileRes.data as Uint8Array).buffer as ArrayBuffer);

      throwIfAborted();
      const pdfDoc = await pdfjs.getDocument({ data: fileData }).promise;

      const mockJob: BackgroundJob = {
        id: `foreground_${documentId}_p${pageNum}_${Date.now()}`,
        documentId,
        filename: filePath.split(/[/\\]/).pop() || 'document.pdf',
        filepath: filePath,
        engine,
        type: 'ocr_single',
        targetPage: pageNum,
        status: 'processing',
        progress: 0,
        currentPage: pageNum,
        totalPages: pdfDoc.numPages,
        message: 'Direct single-page OCR',
        priority: 100,
        createdAt: Date.now(),
        ocrLanguage: options?.ocrLanguage,
        ocrDpi: options?.ocrDpi,
        ocrPageSegMode: options?.ocrPageSegMode,
        ocrQualityProfile: options?.ocrQualityProfile,
        useAngleCls: options?.useAngleCls,
      };

      pageData = await this.renderHeadlessPage(pdfDoc, pageNum, mockJob, signal || new AbortController().signal);
    } else {
      // Image file handling (PNG, JPG, WebP, etc.)
      const fileRes = await window.electronAPI.fs.readFile(filePath);
      const fileData = fileRes.data instanceof ArrayBuffer
        ? fileRes.data
        : ((fileRes.data as Uint8Array).buffer as ArrayBuffer);
      const blob = new Blob([fileData]);
      const imgBitmap = await createImageBitmap(blob);
      const { canvas, ctx } = this.createRenderCanvas(imgBitmap.width, imgBitmap.height);
      let imageBlob: Blob;
      try {
        ctx.drawImage(imgBitmap, 0, 0);
        imageBlob = await this.convertCanvasToLosslessPngBlob(canvas);
        imgBitmap.close();
      } finally {
        this.cleanupCanvas(canvas);
      }

      pageData = {
        pageNum,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        targetDpi: options?.ocrDpi || 300,
        ocrLanguage: options?.ocrLanguage || useOCRTextLayerStore.getState().options.language || 'eng',
        resolvedQualityProfile: options?.ocrQualityProfile || 'best',
        imageBlob,
      };
    }

    throwIfAborted();

    let ocrResult: OCRPageResult;
    if (pageData.blankOcrResult) {
      ocrResult = pageData.blankOcrResult;
    } else if (pageData.imageBlob) {
      const storeOptions = useOCRTextLayerStore.getState().options;
      const pageSegModeVal = options?.ocrPageSegMode !== undefined
        ? (options.ocrPageSegMode === null ? undefined : options.ocrPageSegMode)
        : (storeOptions.pageSegMode === null ? undefined : storeOptions.pageSegMode);

      const resolvedUseAngleCls = options?.useAngleCls !== undefined
        ? Boolean(options.useAngleCls)
        : Boolean(storeOptions.useAngleCls);

      ocrResult = await visionService.ocrForTextLayer(
        pageData.imageBlob,
        pageData.canvasWidth,
        pageData.canvasHeight,
        pageData.ocrLanguage,
        pageData.targetDpi,
        pageSegModeVal,
        signal || new AbortController().signal,
        false,
        'panel',
        pageData.resolvedQualityProfile,
        engine,
        pageData.canvasWidth * pageData.canvasHeight,
        {
          useAngleCls: resolvedUseAngleCls,
        }
      );
    } else {
      throw new Error(`Failed to produce rendered image for page ${pageNum}`);
    }

    throwIfAborted();

    ocrResult.pageNumber = pageNum;
    ocrResult.ocrEngine = engine;
    ocrResult.language = normalizeLanguage(pageData.ocrLanguage);
    ocrResult.pipelineProfile = 'panel';
    ocrResult.ocrQualityProfile = pageData.resolvedQualityProfile;
    ocrResult.algorithmVersion = OCR_ALGORITHM_VERSION;
    ocrResult.ocrRawVersion = OCR_RAW_VERSION;

    ocrResult = applyPanelLanguageScriptGate(ocrResult, pageData.ocrLanguage);
    ocrResult = applyPanelSafetyLineDedup(ocrResult);
    ocrResult.algorithmVersion = OCR_ALGORITHM_VERSION;
    ocrResult.ocrRawVersion = OCR_RAW_VERSION;
    if (!ocrResult.debug) ocrResult.debug = { droppedWords: [], dropCounts: {} };

    ocrResult = processOCRPageResult(ocrResult, {
      engine,
      dpi: pageData.targetDpi,
      storeLanguage: pageData.ocrLanguage,
    });

    // บันทึกลง SQLite DB
    await dbService.saveOCR(documentId, pageNum, ocrResult, engine);

    // อัปเดต In-Memory Store
    useOCRTextLayerStore.getState().setPageOCRForEngine(pageNum, engine, ocrResult);
    useOCRTextLayerStore.getState().setPageOCR(pageNum, ocrResult);

    // อัปเดต Layer Groups ใน LayerStore ถ้ายังไม่มี
    try {
      const initialLayerResult = buildLayerGroupsFromOCR(ocrResult);
      useLayerStore.getState().setPageLayers(pageNum, initialLayerResult);
    } catch (err) {
      console.warn(`[runSinglePageOCR] Failed to build layer groups for page ${pageNum}:`, err);
    }

    return ocrResult;
  }
}

export const backgroundQueueProcessor = new BackgroundQueueProcessor();

interface RenderConstraints {
  maxSide: number | null;
  maxPixels: number | null;
  minWidth: number | null;
  tallPageBoost?: {
    minAspectRatio: number;
    minLongSide: number;
    boostedMaxSide: number;
    boostedMaxPixels: number;
  };
}

const normalizeLanguage = (value: string): string => {
  return (value || '')
    .split('+')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('+');
};

const hasCjkOrThaiOcrLanguage = (lang: string) => {
  return lang.split('+').map(c => c.trim()).filter(Boolean).some(c => 
    ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(c)
  );
};

const hasKoreanOcrLanguage = (lang: string) => {
  return lang.split('+').map(c => c.trim()).filter(Boolean).some(c => c === 'kor');
};

interface ConstraintSpec {
  maxSide: number;
  maxPixels: number;
  boostedMaxPixels?: number;
}

const TALL_PAGE_BOOST_ASPECT_RATIO = 2.35;
const TALL_PAGE_BOOST_MIN_LONG_SIDE = 9000;

function createRenderConstraints(spec: ConstraintSpec): RenderConstraints {
  return {
    maxSide: spec.maxSide,
    maxPixels: spec.maxPixels,
    minWidth: null,
    ...(spec.boostedMaxPixels
      ? {
          tallPageBoost: {
            minAspectRatio: TALL_PAGE_BOOST_ASPECT_RATIO,
            minLongSide: TALL_PAGE_BOOST_MIN_LONG_SIDE,
            boostedMaxSide: spec.maxSide,
            boostedMaxPixels: spec.boostedMaxPixels,
          },
        }
      : {}),
  };
}

const PADDLE_CONSTRAINT_PROFILES: Record<'korean' | 'cjk' | 'high' | 'fast', ConstraintSpec> = {
  korean: { maxSide: 21500, maxPixels: 37650000, boostedMaxPixels: 37950000 },
  cjk:    { maxSide: 21500, maxPixels: 37950000, boostedMaxPixels: 37950000 },
  high:   { maxSide: 21500, maxPixels: 37650000, boostedMaxPixels: 37950000 },
  fast:   { maxSide: 19700, maxPixels: 18800000, boostedMaxPixels: 18800000 },
};

const EASY_CONSTRAINT_PROFILES: Record<'cjk' | 'high' | 'fast', ConstraintSpec> = {
  cjk:  { maxSide: 21500, maxPixels: 23800000, boostedMaxPixels: 23800000 },
  high: { maxSide: 21500, maxPixels: 23800000, boostedMaxPixels: 23800000 },
  fast: { maxSide: 19700, maxPixels: 12800000, boostedMaxPixels: 12800000 },
};

function resolveRenderConstraints(
  engine: string,
  ocrLanguage: string,
  ocrQualityProfile: 'fast' | 'balanced' | 'best'
): RenderConstraints {
  const isHighQuality = ocrQualityProfile === 'balanced' || ocrQualityProfile === 'best';

  if (engine === 'paddleocr') {
    if (hasKoreanOcrLanguage(ocrLanguage)) {
      return createRenderConstraints(PADDLE_CONSTRAINT_PROFILES.korean);
    }
    if (hasCjkOrThaiOcrLanguage(ocrLanguage)) {
      return createRenderConstraints(PADDLE_CONSTRAINT_PROFILES.cjk);
    }
    return createRenderConstraints(isHighQuality ? PADDLE_CONSTRAINT_PROFILES.high : PADDLE_CONSTRAINT_PROFILES.fast);
  }

  if (engine === 'easyocr') {
    if (hasCjkOrThaiOcrLanguage(ocrLanguage)) {
      return createRenderConstraints(EASY_CONSTRAINT_PROFILES.cjk);
    }
    return createRenderConstraints(isHighQuality ? EASY_CONSTRAINT_PROFILES.high : EASY_CONSTRAINT_PROFILES.fast);
  }

  return createRenderConstraints({ maxSide: 21500, maxPixels: 23800000 });
}

function fitDimensionsToConstraints(
  width: number,
  height: number,
  constraints?: RenderConstraints
) {
  const maxSide = constraints?.maxSide ?? null;
  const maxPixels = constraints?.maxPixels ?? null;
  const minWidth = constraints?.minWidth ?? null;
  const tallPageBoost = constraints?.tallPageBoost ?? null;
  
  let effectiveMaxSide = maxSide;
  let effectiveMaxPixels = maxPixels;
  let appliedTallPageBoost = false;

  const longSide = Math.max(width, height);
  const shortSide = Math.max(1, Math.min(width, height));
  const aspectRatio = longSide / shortSide;

  if (tallPageBoost) {
    const qualifiesTallPage = longSide >= Math.max(1, tallPageBoost.minLongSide)
      && aspectRatio >= Math.max(1, tallPageBoost.minAspectRatio);
    if (qualifiesTallPage) {
      appliedTallPageBoost = true;
      if (tallPageBoost.boostedMaxSide > 0) {
        effectiveMaxSide = tallPageBoost.boostedMaxSide;
      }
      if (tallPageBoost.boostedMaxPixels > 0) {
        effectiveMaxPixels = tallPageBoost.boostedMaxPixels;
      }
    }
  }

  if (!appliedTallPageBoost) {
    if (effectiveMaxPixels && effectiveMaxPixels > 0) {
      const baseMaxPixels = effectiveMaxPixels;
      const subLinearMultiplier = Math.sqrt(aspectRatio);
      let dynamicMaxPixels = baseMaxPixels * subLinearMultiplier;

      const MAX_PIXELS_CEILING = 37950000;
      if (dynamicMaxPixels > MAX_PIXELS_CEILING) {
        dynamicMaxPixels = MAX_PIXELS_CEILING;
      }

      effectiveMaxPixels = dynamicMaxPixels;
      appliedTallPageBoost = aspectRatio > 1.5;
    }

    if (effectiveMaxSide && effectiveMaxSide > 0 && aspectRatio > 1.5) {
      const baseMaxSide = effectiveMaxSide;
      effectiveMaxSide = Math.min(30000, Math.max(baseMaxSide, Math.round(baseMaxSide * Math.sqrt(aspectRatio))));
    }
  }

  let scaleFactor = 1;

  if (effectiveMaxSide && effectiveMaxSide > 0) {
    const longestSide = Math.max(width, height);
    if (longestSide > effectiveMaxSide) {
      scaleFactor = Math.min(scaleFactor, effectiveMaxSide / longestSide);
    }
  }

  if (effectiveMaxPixels && effectiveMaxPixels > 0) {
    const pixelCount = width * height;
    if (pixelCount > effectiveMaxPixels) {
      scaleFactor = Math.min(scaleFactor, Math.sqrt(effectiveMaxPixels / pixelCount));
    }
  }

  if (minWidth && minWidth > 0 && scaleFactor < 1 && width * scaleFactor < minWidth && width > minWidth) {
    let minWidthScale = minWidth / width;
    if (effectiveMaxSide && effectiveMaxSide > 0) {
      minWidthScale = Math.min(minWidthScale, effectiveMaxSide / Math.max(width, height));
    }
    if (minWidthScale > scaleFactor) {
      scaleFactor = minWidthScale;
    }
  }

  if (scaleFactor >= 1) {
    return { width, height, scaleFactor: 1, appliedTallPageBoost };
  }

  return {
    width: Math.floor(width * scaleFactor),
    height: Math.floor(height * scaleFactor),
    scaleFactor,
    appliedTallPageBoost,
  };
}
