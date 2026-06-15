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
import { OCR_ALGORITHM_VERSION } from '../vision/ocrVersion';
import { processKoreanManhwaPipeline } from './ocrManhwaHeuristics';

function processAndCleanOCR(result: OCRPageResult, targetEngine: OCREngine, job: BackgroundJob): OCRPageResult {
  // ถ้า result ผ่าน split มาแล้ว (flag _splitDone) ให้ข้ามขั้นตอน split เพื่อป้องกัน double-split bug
  const processedLines = result._splitDone
    ? result.lines
    : splitAggressiveMergedLines(result.lines || [], 2.2);
  const { lines: cleanLines, words: cleanWords } = filterGhostOcrData(
    processedLines,
    result.words || [],
    targetEngine
  );
  
  let ocrResult: OCRPageResult = {
    ...result,
    lines: cleanLines,
    words: cleanWords,
    _splitDone: true, // Mark ว่า split เสร็จแล้ว ป้องกัน store split ซ้ำ
  };

  const isKorean = job.ocrLanguage === 'kor' || job.sourceLanguage === 'kor' || job.targetLanguage === 'kor';
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
  }

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
        // ถ้าคิวไม่ได้ paused และมีงาน pending และระบบไม่ได้กำลังประมวลผลอยู่ -> เริ่มรันทันที
        if (!state.isPaused && !this.isProcessing) {
          const nextJob = useBackgroundQueueStore.getState().getNextPendingJob();
          if (nextJob) {
            this.startProcessingLoop();
          }
        }

        // หากผู้ใช้สั่งยกเลิกหรือหยุดชั่วคราวงานที่กำลังทำงานอยู่ (Active Job)
        if (this.activeJobId) {
          const activeJob = state.jobs.find(j => j.id === this.activeJobId);
          if (activeJob && ['cancelled', 'paused', 'failed'].includes(activeJob.status)) {
            console.log(`[QueueProcessor] Active job ${this.activeJobId} state changed to ${activeJob.status}. Aborting...`);
            this.abortCurrentJob();
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
      
      while (true) {
        // ตรวจสอบสถานะการ pause ของคิวภาพรวม
        const isPaused = useBackgroundQueueStore.getState().isPaused;
        if (isPaused) {
          console.log('[QueueProcessor] Queue processor is paused globally. Exiting loop.');
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
          
          if (currentJob?.status === 'cancelled') {
            console.log(`[QueueProcessor] Job ${job.id} was cancelled.`);
          } else if (currentJob?.status === 'paused') {
            console.log(`[QueueProcessor] Job ${job.id} was paused.`);
          } else if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('canceled') || error.message.includes('aborted'))) {
            // หากเกิดการ Abort (เช่น ตอนสลับไฟล์) แต่สถานะใน Store ยังไม่ได้อัปเดต ให้ตั้งค่าเป็น cancelled
            console.log(`[QueueProcessor] Job ${job.id} aborted via signal.`);
            useBackgroundQueueStore.getState().updateJobStatus(job.id, 'cancelled', 'ยกเลิกแล้ว');
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

      this.isProcessing = false;
      console.log('[QueueProcessor] Background processing loop ended.');
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

    throwIfAborted();

    // 1. โหลดข้อมูลไฟล์ PDF จาก filesystem มาเป็น ArrayBuffer
    useBackgroundQueueStore.getState().updateJobProgress(job.id, 0, 1, 'กำลังอ่านไฟล์เอกสาร...');
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
    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      pageNumbers.push(pageNum);
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
              const targetOcrLanguage = job.ocrLanguage || useOCRTextLayerStore.getState().options.language || 'eng';
              const normalizedProfile = (cached.pipelineProfile || 'panel') === 'panel'
                ? cached
                : {
                  ...cached,
                  pipelineProfile: 'panel' as const,
                };
              const scriptGated = applyPanelLanguageScriptGate(normalizedProfile, targetOcrLanguage);
              if (
                scriptGated.pipelineProfile === 'panel'
                && scriptGated.debug?.panelSafetyNormalizedVersion === OCR_ALGORITHM_VERSION
              ) {
                ocrResult = scriptGated;
              } else {
                ocrResult = applyPanelSafetyLineDedup(scriptGated);
              }

              if (ocrResult) {
                ocrResult = processAndCleanOCR(ocrResult, job.engine, job);
              }
              console.log(`[QueueProcessor] Page ${pageNum} OCR Cache Hit!`);
              
              const activeFile = useProjectStore.getState().file;
              if (activeFile && useProjectStore.getState().documentId === job.documentId) {
                useOCRTextLayerStore.getState().setPageOCR(pageNum, ocrResult);
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
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Cannot create headless canvas 2D context');

            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            await page.render({ canvasContext: ctx, viewport } as any).promise;

            throwIfAborted();

            const imageBlob = await new Promise<Blob>((res, rej) => {
              canvas.toBlob((b) => b ? res(b) : rej(new Error('Headless Canvas to Blob failed')), 'image/png');
            });

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

            const ocrQualityMode = ocrQualityProfile === 'balanced' || ocrQualityProfile === 'best' ? 'high' : 'fast';

            const resolvedQualityProfile = activeEngine === 'paddleocr'
              ? (shouldPreferFastPaddleProfile
                ? 'fast'
                : (ocrQualityMode === 'fast'
                  ? (isSensitiveFastLanguage ? 'balanced' : 'fast')
                  : (isSensitiveFastLanguage ? 'balanced' : 'best')))
              : 'best';

            const pageSegModeVal = job.ocrPageSegMode !== undefined
              ? (job.ocrPageSegMode === null ? undefined : job.ocrPageSegMode)
              : (options.pageSegMode === null ? undefined : options.pageSegMode);

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
              canvas.width * canvas.height
            );

            ocrResult = await ocrPromise;
            ocrResult.pageNumber = pageNum;
            ocrResult.ocrEngine = job.engine;
            ocrResult.language = ocrLanguage;

            ocrResult = applyPanelLanguageScriptGate(ocrResult, ocrLanguage);
            ocrResult = applyPanelSafetyLineDedup(ocrResult);
            ocrResult = processAndCleanOCR(ocrResult, job.engine, job);

            throwIfAborted();

            await dbService.saveOCR(job.documentId, pageNum, ocrResult, job.engine);
            
            const activeFile = useProjectStore.getState().file;
            if (activeFile && useProjectStore.getState().documentId === job.documentId) {
              useOCRTextLayerStore.getState().setPageOCR(pageNum, ocrResult);
            }
          }

          if (ocrResult) {
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
          throwIfAborted();
        }
      } catch (err: any) {
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
        maxSide: 20000,
        maxPixels: 23500000,
        minWidth: null,
        tallPageBoost: {
          minAspectRatio: 2.35,
          minLongSide: 9000,
          boostedMaxSide: 20000,
          boostedMaxPixels: 34000000,
        },
      };
    }
    if (cjkPanelExternal) {
      return {
        maxSide: 19000,
        maxPixels: 28800000,
        minWidth: null,
        tallPageBoost: {
          minAspectRatio: 2.35,
          minLongSide: 9000,
          boostedMaxSide: 20000,
          boostedMaxPixels: 28000000,
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
  
  let effectiveMaxSide = maxSide;
  let effectiveMaxPixels = maxPixels;
  let appliedTallPageBoost = false;

  const longSide = Math.max(width, height);
  const shortSide = Math.max(1, Math.min(width, height));
  const aspectRatio = longSide / shortSide;

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
