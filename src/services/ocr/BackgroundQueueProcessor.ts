import { pdfjs } from '../pdf/pdfjsWorker';
import { visionService } from '../vision/VisionService';
import { OCREngine, OCRPageResult } from '../../types';
import { useBackgroundQueueStore, BackgroundJob } from '../../stores/useBackgroundQueueStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useOCRTextLayerStore, filterGhostOcrData } from '../../stores/useOCRTextLayerStore';
import { dbService } from '../dbService';
import type { TranslationMode } from '../../stores/useProjectStore';
import { useLayerStore } from '../../stores/useLayerStore';
import { buildLayerGroupsFromOCR, mergeLayersAndGroups, splitAggressiveMergedLines } from '../layers/LayerGroupingService';
import { applyPanelSafetyLineDedup } from './ocrSafetyLineDedup';
import { applyPanelLanguageScriptGate } from '../vision/scriptGateService';
import { OCR_ALGORITHM_VERSION, OCR_RAW_VERSION } from '../vision/ocrVersion';
import { processKoreanManhwaPipeline } from './ocrManhwaHeuristics';
import { processJapaneseVerticalPipeline, isVerticalJapaneseLayout } from './ocrJapaneseVerticalHeuristics';

function processAndCleanOCR(result: OCRPageResult, targetEngine: OCREngine, job: BackgroundJob): OCRPageResult {
  // ถ้า result ผ่าน split มาแล้ว (flag _splitDone) ให้ข้ามขั้นตอน split เพื่อป้องกัน double-split bug
  const processedLines = result._splitDone
    ? result.lines
    : splitAggressiveMergedLines(result.lines || [], 2.2);
  const { lines: cleanLines, words: cleanWords } = filterGhostOcrData(
    processedLines,
    result.words || [],
    targetEngine,
    result.dpi || job.ocrDpi || 300
  );
  
  let ocrResult: OCRPageResult = {
    ...result,
    lines: cleanLines,
    words: cleanWords,
    _splitDone: true, // Mark ว่า split เสร็จแล้ว ป้องกัน store split ซ้ำ
  };

  const isKorean = (job.ocrLanguage === 'kor' || job.sourceLanguage === 'kor' || job.targetLanguage === 'kor')
    && !result._splitDone
    && !(ocrResult as any)._manhwaDone;
  if (isKorean) {
    ocrResult = processKoreanManhwaPipeline(ocrResult, {
      merge: {
        maxVerticalGap: 25,
        maxHorizontalGap: 35,
        minColumnOverlapRatio: 0.3,
        maxGroupHeightRatio: 0.3,
        pageHeight: ocrResult.height || 1200,
        readingDirection: "rtl-ttb",
      },
      debug: false
    });
    (ocrResult as any)._manhwaDone = true;
  }

  const isJapanese = (
    String(job.ocrLanguage || '').toLowerCase().startsWith('jpn') ||
    String(job.ocrLanguage || '').toLowerCase() === 'ja' ||
    String(job.sourceLanguage || '').toLowerCase().startsWith('jpn') ||
    String(job.sourceLanguage || '').toLowerCase() === 'ja' ||
    String(job.targetLanguage || '').toLowerCase().startsWith('jpn') ||
    String(job.targetLanguage || '').toLowerCase() === 'ja'
  )
    && !result._splitDone
    && !(ocrResult as any)._japaneseDone;
  if (isJapanese && isVerticalJapaneseLayout(ocrResult.lines)) {
    ocrResult = processJapaneseVerticalPipeline(ocrResult, {
      merge: {
        maxVerticalGap: 25,
        maxHorizontalGap: 18,
        minColumnOverlapRatio: 0.35,
        maxGroupHeightRatio: 0.45,
        pageHeight: ocrResult.height || 1200,
        readingDirection: "rtl-ttb",
      },
      debug: false
    });
    (ocrResult as any)._japaneseDone = true;
  }

  ocrResult = { ...applyPanelSafetyLineDedup(ocrResult), _splitDone: true };

  return ocrResult;
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
  private checkInterval: NodeJS.Timeout | null = null;

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

            const isAbortLike = error instanceof Error && (
              error.name === 'AbortError' ||
              error.message.includes('canceled') ||
              error.message.includes('aborted') ||
              error.message.includes('aborted by signal') ||
              error.message.includes('Worker was terminated') // PDF.js worker terminated เพราะ abort
            );

            if (currentJob?.status === 'cancelled') {
              console.log(`[QueueProcessor] Job ${job.id} was cancelled.`);
            } else if (currentJob?.status === 'paused') {
              console.log(`[QueueProcessor] Job ${job.id} was paused.`);
            } else if (currentJob?.status === 'queued' || currentJob?.status === 'pending') {
              // งานถูก abort เพื่อหลีกทางให้งานอื่นที่มีลำดับสูงกว่า (Preemption) หรือ Foreground
              // สถานะ queued ถูกตั้งค่าไว้แล้วโดย Subscriber ก่อน abort ไม่ต้องทำอะไรเพิ่ม
              console.log(`[QueueProcessor] Job ${job.id} was preempted. Keeping queued status.`);
            } else if (isAbortLike) {
              // Abort/Worker terminated ที่ไม่ได้ตั้งใจ: ตรวจสอบสถานะล่าสุดอีกครั้ง
              const freshState = useBackgroundQueueStore.getState().jobs.find(j => j.id === job.id);
              if (freshState?.status === 'queued' || freshState?.status === 'pending') {
                console.log(`[QueueProcessor] Job ${job.id} aborted for preemption, keeping queued status.`);
              } else {
                console.log(`[QueueProcessor] Job ${job.id} aborted via signal. Marking cancelled.`);
                useBackgroundQueueStore.getState().updateJobStatus(job.id, 'cancelled', 'ยกเลิกแล้ว');
              }
            } else {
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

    // 1. โหลดข้อมูลไฟล์ PDF จาก filesystem มาเป็น ArrayBuffer
    // แสดง immediate feedback บอก user ว่าเริ่มงานแล้ว (ลด delay การ perceive)
    useBackgroundQueueStore.getState().updateJobProgress(job.id, 0, 0, 'เตรียมงาน...');
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
    useBackgroundQueueStore.getState().updateJobProgress(job.id, 5, 1, 'กำลังเตรียมโครงสร้างรูปภาพ...');
    const pdfDoc = await pdfjs.getDocument({ data: fileData }).promise;
    const totalPages = pdfDoc.numPages;

    console.log(`[QueueProcessor] PDF loaded. Total pages: ${totalPages}`);
    useBackgroundQueueStore.getState().updateJobProgress(job.id, 5, 1, 'กำลังเตรียมโครงสร้างรูปภาพ...', totalPages);

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

    const CHUNK_SIZE = 3;
    const chunks: number[][] = [];
    for (let i = 0; i < pageNumbers.length; i += CHUNK_SIZE) {
      chunks.push(pageNumbers.slice(i, i + CHUNK_SIZE));
    }

    let processedCount = 0;
    let successPagesCount = 0;
    let hasApiError = false;
    let lastErrorMessage = '';

    for (const chunk of chunks) {
      throwIfAborted();
      console.log(`[QueueProcessor] Processing chunk: ${chunk.join(', ')}`);

      try {
        for (const pageNum of chunk) {
          throwIfAborted();
          
          const localProgress = Math.round((processedCount / pagesCount) * 100);
          useBackgroundQueueStore.getState().updateJobProgress(
            job.id, 
            localProgress, 
            pageNum, 
            isSinglePage 
              ? `กำลังวิเคราะห์และแปลหน้าที่ ${pageNum}...` 
              : `กำลังวิเคราะห์และแปลหน้าที่ ${pageNum}/${totalPages}...`
          );

          // --- ขั้นตอนที่ 1: ตรวจหาหรือทำ OCR ของหน้านั้นๆ ---
          let ocrResult: OCRPageResult | null = null;
          
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
                  : {
                    ...cached,
                    pipelineProfile: 'panel' as const,
                  };
                const scriptGated = applyPanelLanguageScriptGate(normalizedProfile, targetOcrLanguage);
                let needResave = false;
                if (
                  scriptGated.pipelineProfile === 'panel'
                  && scriptGated.debug?.panelSafetyNormalizedVersion === OCR_ALGORITHM_VERSION
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
              }
            }
          } catch (err) {
            console.warn(`[QueueProcessor] DB cache read warning for page ${pageNum}:`, err);
          }

          // หากไม่มีแคช ให้ทำ Headless Rendering + OCR
          if (!ocrResult) {
            throwIfAborted();
            console.log(`[QueueProcessor] Page ${pageNum} Cache Miss. Running Headless OCR...`);
            
            const page = await pdfDoc.getPage(pageNum);
            
            const options = useOCRTextLayerStore.getState().options;
            const targetDpi = job.ocrDpi || options.dpi || 300;
            const ocrLanguage = job.ocrLanguage || options.language || 'eng';
            const ocrQualityProfile = job.ocrQualityProfile || options.ocrQualityProfile || 'best';

            const requestedScale = targetDpi / 72;
            const requestedViewport = page.getViewport({ scale: requestedScale });
            
            const renderConstraints = resolveRenderConstraints(job.engine, ocrLanguage, ocrQualityProfile);
            const fitted = fitDimensionsToConstraints(requestedViewport.width, requestedViewport.height, renderConstraints);
            const scale = requestedScale * fitted.scaleFactor;
            
            const viewport = page.getViewport({ scale });
            
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            canvas.style.position = 'absolute';
            canvas.style.left = '-99999px';
            canvas.style.top = '-99999px';
            canvas.style.visibility = 'hidden';
            document.body.appendChild(canvas);

            let imageBlob: Blob;
            try {
              const ctx = canvas.getContext('2d', { alpha: false });
              if (!ctx) throw new Error('Cannot create headless canvas 2D context');

              ctx.fillStyle = '#FFFFFF';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              
              await page.render({
                canvasContext: ctx,
                viewport,
                intent: 'display',
                canvas
              } as any).promise;

              throwIfAborted();

              imageBlob = await new Promise<Blob>((res, rej) => {
                canvas.toBlob((b) => b ? res(b) : rej(new Error('Headless Canvas to Blob failed')), 'image/png');
              });
            } finally {
              canvas.remove();
            }

            throwIfAborted();

            const activeEngine = job.engine;
            const pipelineProfile = 'panel';

            const shouldPreferFastPaddleProfile = (() => {
              if (activeEngine !== 'paddleocr') return false;
              if (pipelineProfile !== 'panel') return false;

              const isCjkLike = ocrLanguage
                  .split('+')
                  .map(code => code.trim())
                  .filter(Boolean)
                  .some(code => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));
              if (isCjkLike) return false;

              const longest = Math.max(canvas.width, canvas.height);
              const shortest = Math.max(1, Math.min(canvas.width, canvas.height));
              const aspectRatio = longest / shortest;
              const pixelCount = canvas.width * canvas.height;
              return (pixelCount >= 16_000_000 && aspectRatio >= 3.0) || longest >= 8000;
            })();

            const isSensitiveFastLanguage = ocrLanguage
              .split('+')
              .map((code) => code.trim())
              .filter(Boolean)
              .some((code) => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));

            const resolvedQualityProfile = options.ocrQualityProfile || 'best';

            const pageSegModeVal = job.ocrPageSegMode !== undefined
              ? (job.ocrPageSegMode === null ? undefined : job.ocrPageSegMode)
              : (options.pageSegMode === null ? undefined : options.pageSegMode);

            const resolvedUseAngleCls = false;

            const ocrPromise = visionService.ocrForTextLayer(
              imageBlob,
              canvas.width,
              canvas.height,
              ocrLanguage,
              targetDpi,
              pageSegModeVal,
              signal,
              false,
              'panel',
              resolvedQualityProfile,
              job.engine,
              canvas.width * canvas.height,
              {
                useAngleCls: resolvedUseAngleCls
              }
            );

            ocrResult = await ocrPromise;
            ocrResult.pageNumber = pageNum;
            ocrResult.ocrEngine = job.engine;
            ocrResult.language = normalizeLanguage(ocrLanguage);
            ocrResult.pipelineProfile = 'panel';
            ocrResult.ocrQualityProfile = resolvedQualityProfile;
            ocrResult.algorithmVersion = OCR_ALGORITHM_VERSION;
            ocrResult.ocrRawVersion = OCR_RAW_VERSION;

            ocrResult = applyPanelLanguageScriptGate(ocrResult, ocrLanguage);
            ocrResult = applyPanelSafetyLineDedup(ocrResult);
            ocrResult.algorithmVersion = OCR_ALGORITHM_VERSION;
            ocrResult.ocrRawVersion = OCR_RAW_VERSION;
            if (!ocrResult.debug) ocrResult.debug = { droppedWords: [], dropCounts: {} };
            ocrResult.debug.panelSafetyNormalizedVersion = OCR_ALGORITHM_VERSION;

            throwIfAborted();

            // Save the raw/unmerged OCR result to the DB (matching OCRTextLayerPanel.tsx)
            await dbService.saveOCR(job.documentId, pageNum, ocrResult, job.engine);

            // Process (split, filter, merge) the result for the active session
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

          if (ocrResult) {
            try {
              const activeDocId = useProjectStore.getState().documentId;
              const isActiveDoc = activeDocId !== null && activeDocId === job.documentId;

              if (!isActiveDoc) {
                console.log(
                  `[QueueProcessor] Skipping layerStore.setPageLayers for page ${pageNum}: ` +
                  `active doc (${activeDocId}) ≠ job doc (${job.documentId}). Layers will be built on open.`
                );
              } else {
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
              }
            } catch (err) {
              console.warn(`[QueueProcessor] Failed to initialize layers from OCR for page ${pageNum}:`, err);
            }
          }

          throwIfAborted();

          // --- ขั้นตอนที่ 2: ดำเนินการแปลภาษาในหน่วยความจำ ---
          if (
            job.type === 'offline_all' || 
            job.type === 'ai_all' || 
            job.type === 'offline_single' || 
            job.type === 'ai_single'
          ) {
            if (!this.handlers) {
              throw new Error('Translation handlers not registered in BackgroundQueueProcessor');
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
                translationMode: job.translationMode
              }
            );

            if (!success) {
              console.log(`[QueueProcessor] Page ${pageNum} translation was skipped (possibly no translatable text).`);
            }
          }

          processedCount++;
          successPagesCount++;

          const finishedProgress = Math.round((processedCount / pagesCount) * 100);
          useBackgroundQueueStore.getState().updateJobProgress(
            job.id,
            finishedProgress,
            pageNum,
            isSinglePage
              ? `แปลหน้าที่ ${pageNum} เรียบร้อยแล้ว!`
              : `แปลหน้าที่ ${pageNum} สำเร็จ (${processedCount}/${pagesCount}) • กำลังประมวลผลต่อ...`
          );

          if (typeof window !== 'undefined') {
            const activePage = useProjectStore.getState().currentPage;
            const activeDoc = useProjectStore.getState().documentId;
            if (activeDoc === job.documentId && activePage === pageNum) {
              window.dispatchEvent(new CustomEvent('page-translation-updated', { detail: { pageNum } }));
            }
          }

          throwIfAborted();
        }
      } catch (err: any) {
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

      // Computational micro-sleep and clear CUDA cache during refractory period
      throwIfAborted();
      console.log(`[QueueProcessor] Chunk completed. Entering 500ms refractory sleep...`);
      await new Promise(r => setTimeout(r, 500));
      
      try {
        if (window.electronAPI?.ocr?.clearCudaCache) {
          await window.electronAPI.ocr.clearCudaCache({ engine: job.engine });
          console.log(`[QueueProcessor] Instructed Python bridge to clear CUDA cache for ${job.engine}`);
        }
      } catch (cudaErr) {
        console.warn(`[QueueProcessor] Failed to clear CUDA cache:`, cudaErr);
      }
    }

    // ถ้า signal ถูก abort เจตนา (Preemption) → ออกจาก processJob โดยไม่ mark ว่า failed
    // สถานะ 'queued' ถูกตั้งไว้โดย Subscriber ก่อน abort แล้ว ไม่ต้องทำอะไรเพิ่ม
    if (signal.aborted) {
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

    useBackgroundQueueStore.getState().updateJobProgress(
      job.id, 
      100, 
      endPage, 
      isSinglePage ? 'ประมวลผลหน้าเดี่ยวสำเร็จเสร็จสิ้น!' : 'แปลภาษาสำเร็จเสร็จสิ้น!'
    );
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

function resolveRenderConstraints(
  engine: string,
  ocrLanguage: string,
  ocrQualityProfile: 'fast' | 'balanced' | 'best'
): RenderConstraints {
  const activePipelineProfile = 'panel';
  
  const cjkPanelExternal = activePipelineProfile === 'panel'
    && hasCjkOrThaiOcrLanguage(ocrLanguage);
  const koreanPaddlePanel = activePipelineProfile === 'panel'
    && engine === 'paddleocr'
    && hasKoreanOcrLanguage(ocrLanguage);

  if (engine === 'paddleocr') {
    if (koreanPaddlePanel) {
      return {
        maxSide: 21500,
        maxPixels: 37650000,
        minWidth: null,
        tallPageBoost: {
          minAspectRatio: 2.35,
          minLongSide: 9000,
          boostedMaxSide: 21500,
          boostedMaxPixels: 37950000,
        },
      };
    }
    if (cjkPanelExternal) {
      return {
        maxSide: 21500,
        maxPixels: 37950000,
        minWidth: null,
        tallPageBoost: {
          minAspectRatio: 2.35,
          minLongSide: 9000,
          boostedMaxSide: 21500,
          boostedMaxPixels: 37950000,
        },
      };
    }
    
    const ocrQualityMode = ocrQualityProfile === 'balanced' || ocrQualityProfile === 'best' ? 'high' : 'fast';
    if (ocrQualityMode === 'high') {
      return {
        maxSide: 21500,
        maxPixels: 37650000,
        minWidth: null,
        tallPageBoost: {
          minAspectRatio: 2.35,
          minLongSide: 9000,
          boostedMaxSide: 21500,
          boostedMaxPixels: 37950000,
        },
      };
    } else {
      return {
        maxSide: 19700,
        maxPixels: 18800000,
        minWidth: null,
        tallPageBoost: {
          minAspectRatio: 2.35,
          minLongSide: 9000,
          boostedMaxSide: 19700,
          boostedMaxPixels: 18800000,
        },
      };
    }
  }
  
  if (engine === 'easyocr') {
    if (cjkPanelExternal) {
      return {
        maxSide: 21500,
        maxPixels: 23800000,
        minWidth: null,
        tallPageBoost: {
          minAspectRatio: 2.35,
          minLongSide: 9000,
          boostedMaxSide: 21500,
          boostedMaxPixels: 23800000,
        },
      };
    }
    
    const ocrQualityMode = ocrQualityProfile === 'balanced' || ocrQualityProfile === 'best' ? 'high' : 'fast';
    if (ocrQualityMode === 'high') {
      return {
        maxSide: 21500,
        maxPixels: 23800000,
        minWidth: null,
        tallPageBoost: {
          minAspectRatio: 2.35,
          minLongSide: 9000,
          boostedMaxSide: 21500,
          boostedMaxPixels: 23800000,
        },
      };
    } else {
      return {
        maxSide: 19700,
        maxPixels: 12800000,
        minWidth: null,
        tallPageBoost: {
          minAspectRatio: 2.35,
          minLongSide: 9000,
          boostedMaxSide: 19700,
          boostedMaxPixels: 12800000,
        },
      };
    }
  }

  return {
    maxSide: 21500,
    maxPixels: 23800000,
    minWidth: null,
  };
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
