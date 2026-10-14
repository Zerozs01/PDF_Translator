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
  renderMs: number;
  ocrIpcMs: number;
  syncLayersMs: number;
  translationMs: number;
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
      console.log(`[QueueProcessor] Prewarm ready in ${(performance.now() - prewarmStartTime).toFixed(1)}ms`);
    } catch (prewarmErr) {
      console.warn('[QueueProcessor] Prewarm skipped or failed:', prewarmErr);
      this.prewarmedKey = null;
      this.activePrewarmPromise = null;
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

    const CHUNK_SIZE = 8;
    const chunks: number[][] = [];
    for (let i = 0; i < pageNumbers.length; i += CHUNK_SIZE) {
      chunks.push(pageNumbers.slice(i, i + CHUNK_SIZE));
    }

    let processedCount = 0;
    let successPagesCount = 0;
    let hasApiError = false;
    let lastErrorMessage = '';
    const jobStageTimings: PageStageTimings[] = [];
    const translationLimiter = new ConcurrencyLimiter(2);
    const translationTasks: Promise<void>[] = [];
    const translationErrors: { pageNum: number; message: string }[] = [];

    // Strict GPU Concurrency Cap (ADR-0005): ort_dml must run sequential (concurrency = 1) to prevent VRAM spikes
    const jobBackend = job.backend || useOCRTextLayerStore.getState().options.backend || 'paddle';
    const ocrConcurrency = jobBackend === 'ort_dml' ? 1 : 2;
    const ocrLimiter = new ConcurrencyLimiter(ocrConcurrency);
    let hasNotifiedFallback = false;

    const prefetch: PrefetchPipelineController = {
      data: null,
      pageNum: null,
      trigger: (nextP: number) => {
        if (nextP > totalPages || isSinglePage || prefetch.data) return;
        prefetch.pageNum = nextP;
        prefetch.data = (async () => {
          try {
            const cached = await dbService.getOCR(job.documentId, nextP, job.engine);
            if (cached && cached.lines && cached.lines.length > 0 && (cached.ocrRawVersion ?? 1) >= OCR_RAW_VERSION) {
              return null;
            }
          } catch {
            // ignore cache lookup errors and proceed to render
          }
          return this.renderHeadlessPage(pdfDoc, nextP, job, signal);
        })().catch((err) => {
          console.warn(`[QueueProcessor] Prefetch render warning for page ${nextP}:`, err);
          return null;
        });
      },
    };

    for (const chunk of chunks) {
      throwIfAborted();
      console.log(`[QueueProcessor] Processing chunk: ${chunk.join(', ')}`);

      try {
        for (const pageNum of chunk) {
          throwIfAborted();

          const pageIndexInAll = pageNumbers.indexOf(pageNum);
          const nextPageNum = pageIndexInAll >= 0 && pageIndexInAll + 1 < pageNumbers.length
            ? pageNumbers[pageIndexInAll + 1]
            : null;

          const localProgress = Math.round((processedCount / pagesCount) * 100);
          useBackgroundQueueStore.getState().updateJobProgress(
            job.id,
            localProgress,
            pageNum,
            isSinglePage
              ? `กำลังวิเคราะห์และแปลหน้าที่ ${pageNum}...`
              : `กำลังวิเคราะห์และแปลหน้าที่ ${pageNum}/${totalPages}...`
          );

          // 1. ดำเนินการ OCR (DB Cache หรือ Headless OCR พร้อม 2-Stage Prefetch)
          const { ocrResult, renderDurationMs, ocrIpcDurationMs } = await ocrLimiter.run(() =>
            this.executePageOCR(
              pdfDoc,
              job,
              pageNum,
              nextPageNum,
              signal,
              prefetch
            )
          );

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

          // 2. จัดกลุ่มเลเยอร์และบันทึกลง store / DB ทันที (ผลหน้า N ขึ้น UI ทันที!)
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
          } catch {
            // ignore mark measure failures
          }

          throwIfAborted();

          // 3. บันทึกผลสำเร็จของ OCR และ timing สำหรับหน้านี้ทันที
          processedCount++;
          successPagesCount++;

          const pageTiming: PageStageTimings = {
            pageNum,
            renderMs: Number(renderDurationMs.toFixed(2)),
            ocrIpcMs: Number(ocrIpcDurationMs.toFixed(2)),
            syncLayersMs: Number(syncLayersDurationMs.toFixed(2)),
            translationMs: 0,
            totalMs: Number((renderDurationMs + ocrIpcDurationMs + syncLayersDurationMs).toFixed(2)),
          };
          jobStageTimings.push(pageTiming);

          const isTrans = this.isTranslationJob(job);
          if (processedCount === 1) {
            console.log(
              `[QueueProcessor] [FirstPageTiming] Page ${pageNum}: OCR IPC = ${pageTiming.ocrIpcMs}ms, Total = ${pageTiming.totalMs}ms (prewarmed=${Boolean(this.prewarmedKey)})`
            );
          }

          const progressScale = isTrans ? 85 : 100;
          const finishedOcrProgress = Math.round((processedCount / pagesCount) * progressScale);
          useBackgroundQueueStore.getState().updateJobProgress(
            job.id,
            finishedOcrProgress,
            pageNum,
            isSinglePage
              ? `ตรวจจับตัวอักษรหน้าที่ ${pageNum} เสร็จสมบูรณ์!`
              : `ตรวจจับตัวอักษรหน้าที่ ${pageNum} สำเร็จ (${processedCount}/${pagesCount}) • กำลังอ่านหน้าถัดไป...`
          );

          // 4. ส่งคำแปลภาษาเข้า Limiter (Concurrency 2) แบบ Asynchronous (ไม่บล็อก loop OCR ของหน้า N+1!)
          if (isTrans) {
            const transTask = translationLimiter
              .run(async () => {
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
                    pageTiming.totalMs = Number((pageTiming.renderMs + pageTiming.ocrIpcMs + pageTiming.syncLayersMs + pageTiming.translationMs).toFixed(2));
                    performance.clearMarks(transStartMark);
                    performance.clearMarks(transEndMark);
                  } catch {}
                } catch (transErr: any) {
                  if (signal.aborted) throw transErr;
                  const errMsg = transErr?.message || String(transErr);
                  console.warn(`[QueueProcessor] Translation failed for page ${pageNum} (isolated error, OCR kept):`, errMsg);
                  translationErrors.push({ pageNum, message: errMsg });
                }
              })
              .catch((limiterErr: any) => {
                // Catch limiter/abort errors right at task creation so no unhandled rejections escape
                if (limiterErr?.name === 'AbortError' || signal.aborted) {
                  return;
                }
                console.warn(`[QueueProcessor] Translation limiter task error on page ${pageNum}:`, limiterErr);
              });
            translationTasks.push(transTask);
          }

          throwIfAborted();
        }
      } catch (err: any) {
        ocrLimiter.clear();
        translationLimiter.clear();
        // ถ้า signal ถูก abort เจตนา (Preemption/Foreground) → re-throw ทันที ไม่ treat เป็น chunk failure
        if (signal.aborted) {
          throw err; // re-throw ให้ main catch handle ตาม job status ที่ตั้งไว้แล้ว
        }
        console.error(`[QueueProcessor] Error processing chunk ${chunk.join(', ')}:`, err);
        lastErrorMessage = err.message || String(err);
        if (lastErrorMessage.toLowerCase().includes('gemini') || lastErrorMessage.toLowerCase().includes('api')) {
          hasApiError = true;
        }
        break; // Freeze the loop instantly
      }

      // Non-blocking event loop tick and clear CUDA cache between chunks
      throwIfAborted();
      await new Promise(r => setTimeout(r, 10));
      
      try {
        if (window.electronAPI?.ocr?.clearCudaCache) {
          await window.electronAPI.ocr.clearCudaCache({ engine: job.engine });
          console.log(`[QueueProcessor] Instructed Python bridge to clear CUDA cache for ${job.engine}`);
        }
      } catch (cudaErr) {
        console.warn(`[QueueProcessor] Failed to clear CUDA cache:`, cudaErr);
      }
    }

    // รอให้งานแปลภาษาที่ค้างอยู่ใน Limiter ทำงานเสร็จครบทุกหน้า
    if (this.isTranslationJob(job) && translationTasks.length > 0) {
      throwIfAborted();
      useBackgroundQueueStore.getState().updateJobProgress(
        job.id,
        90,
        endPage,
        'ตรวจจับตัวอักษรครบทุกหน้าแล้ว กำลังรอการแปลภาษาหน้าสุดท้าย...'
      );
      try {
        await Promise.all(translationTasks);
      } catch (err) {
        if (signal.aborted) throw err;
      }
    }

    // ถ้า signal ถูก abort เจตนา (Preemption) → ออกจาก processJob โดยไม่ mark ว่า failed
    // สถานะ 'queued' ถูกตั้งไว้โดย Subscriber ก่อน abort แล้ว ไม่ต้องทำอะไรเพิ่ม
    if (signal.aborted) {
      ocrLimiter.clear();
      translationLimiter.clear();
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
        '1. Render (Headless 300DPI)': calculateStageStats(jobStageTimings.map(t => t.renderMs)),
        '2. OCR (IPC Round-Trip)': calculateStageStats(jobStageTimings.map(t => t.ocrIpcMs)),
        '3. Sync Page Layers': calculateStageStats(jobStageTimings.map(t => t.syncLayersMs)),
        '4. Translation': calculateStageStats(jobStageTimings.map(t => t.translationMs)),
        'Total Per Page Pipeline': calculateStageStats(jobStageTimings.map(t => t.totalMs)),
      });
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
    nextPageNum: number | null,
    signal: AbortSignal,
    prefetch: PrefetchPipelineController
  ): Promise<{ ocrResult: OCRPageResult; renderDurationMs: number; ocrIpcDurationMs: number }> {
    const throwIfAborted = () => {
      if (signal.aborted) throw new Error('Process aborted by user');
    };

    let ocrResult: OCRPageResult | null = null;
    let pageData: RenderedPageData | null = null;
    let ocrIpcDurationMs = 0;

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
          if (activeFile && useProjectStore.getState().documentId === job.documentId) {
            useOCRTextLayerStore.getState().setPageOCR(pageNum, ocrResult);
            const storeResult = useOCRTextLayerStore.getState().ocrByPageEngine.get(pageNum)?.get(job.engine)
              || useOCRTextLayerStore.getState().allPagesOCR.get(pageNum);
            if (storeResult) {
              ocrResult = storeResult;
            }
          }

          // เคลียร์ Stale Prefetch ของหน้าปัจจุบันที่แคชฮิต เพื่อให้หน้าถัดไป prefetch ต่อได้
          if (prefetch.pageNum !== null && prefetch.pageNum <= pageNum) {
            prefetch.data = null;
            prefetch.pageNum = null;
          }

          if (ocrResult && nextPageNum !== null) {
            prefetch.trigger(nextPageNum);
          }

          return {
            ocrResult,
            renderDurationMs: 0,
            ocrIpcDurationMs: 0,
          };
        }
      }
    } catch (err) {
      console.warn(`[QueueProcessor] DB cache read warning for page ${pageNum}:`, err);
    }

    // หากไม่มีแคช ให้ทำ Headless Rendering + OCR (ใช้ 2-Stage Prefetch Pipeline)
    if (!ocrResult) {
      throwIfAborted();
      console.log(`[QueueProcessor] Page ${pageNum} Cache Miss. Running Headless OCR...`);

      if (prefetch.pageNum === pageNum && prefetch.data) {
        pageData = await prefetch.data;
        prefetch.data = null;
        prefetch.pageNum = null;
      }

      if (!pageData) {
        useBackgroundQueueStore.getState().updateJobProgress(
          job.id,
          Math.max(5, useBackgroundQueueStore.getState().jobs.find(j => j.id === job.id)?.progress || 5),
          pageNum,
          `กำลังเรนเดอร์ภาพหน้าที่ ${pageNum} (300 DPI)...`
        );
        pageData = await this.renderHeadlessPage(pdfDoc, pageNum, job, signal);
      }

      throwIfAborted();

      // เรนเดอร์หน้าถัดไปแบบ Prefetch ทันทีในขณะที่ส่ง OCR หน้าปัจจุบันเข้า Python Bridge
      if (nextPageNum !== null) {
        prefetch.trigger(nextPageNum);
      }

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
        let ocrIpcDurationMs = 0;
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
      if (activeFile && useProjectStore.getState().documentId === job.documentId) {
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
    };
  }

  /**
   * ซิงค์และสร้างเลเยอร์จากผลลัพธ์ OCR ลง useLayerStore โดยเคารพกฎ Cross-Document Isolation
   */
  private syncPageLayers(documentId: number, pageNum: number, ocrResult: OCRPageResult): void {
    const activeDocId = useProjectStore.getState().documentId;
    const isActiveDoc = activeDocId !== null && activeDocId === documentId;

    if (!isActiveDoc) {
      console.log(
        `[QueueProcessor] Document ${documentId} is inactive (active doc is ${activeDocId}). ` +
        `Persisting OCR to DB; viewer will hydrate layers upon document switch.`
      );
      void dbService.saveOCR(documentId, pageNum, ocrResult, ocrResult.ocrEngine || 'paddleocr').catch((err) => {
        console.warn(`[QueueProcessor] Failed to persist OCR cache for inactive doc ${documentId}:`, err);
      });
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
        console.log(`[QueueProcessor] Initialized ${initialLayerResult.layers.length} layers in ${initialLayerResult.groups.length} groups for page ${pageNum} after OCR (overwrite).`);
      } else {
        const mergedResult = mergeLayersAndGroups(initialLayerResult, existingLayers, existingGroups);
        layerStore.setPageLayers(pageNum, mergedResult);
        console.log(`[QueueProcessor] Merged ${mergedResult.layers.length} layers in ${mergedResult.groups.length} groups for page ${pageNum} after OCR.`);
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
    const canvas = this.getHeadlessCanvas();
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const renderStartMark = `job-${job.id}-p${pageNum}-render-start`;
    const renderEndMark = `job-${job.id}-p${pageNum}-render-end`;
    const renderMeasureName = `job-${job.id}-p${pageNum}-render`;
    performance.mark(renderStartMark);

    try {
      if (signal.aborted) throw new Error('Process aborted by signal');
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Cannot create headless canvas 2D context');

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

      const imageBlob = await new Promise<Blob>((res, rej) => {
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('Headless Canvas to Blob failed'))), 'image/webp', 0.95);
      });

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
    } catch (err) {
      // Free buffer immediately on abort or failure
      canvas.width = 0;
      canvas.height = 0;
      throw err;
    } finally {
      try {
        page?.cleanup?.();
      } catch {}
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
      const canvas = this.getHeadlessCanvas();
      canvas.width = imgBitmap.width;
      canvas.height = imgBitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Cannot create headless canvas 2D context for image');
      ctx.drawImage(imgBitmap, 0, 0);
      const imageBlob = await new Promise<Blob>((res, rej) => {
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('Canvas to Blob failed'))), 'image/webp', 0.95);
      });
      imgBitmap.close();

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
