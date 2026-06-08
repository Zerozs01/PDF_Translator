import { pdfjs } from '../pdf/pdfjsWorker';
import { visionService } from '../vision/VisionService';
import { OCREngine, OCRPageResult } from '../../types';
import { useBackgroundQueueStore, BackgroundJob } from '../../stores/useBackgroundQueueStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { dbService } from '../dbService';
import type { TranslationMode } from '../../stores/useProjectStore';

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
    let processedCount = 0;

    // วนลูปประมวลผลทีละหน้า
    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
      throwIfAborted();
      processedCount++;

      const progressPercent = Math.round(((processedCount - 1) / pagesCount) * 100);
      useBackgroundQueueStore.getState().updateJobProgress(
        job.id, 
        progressPercent, 
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
          ocrResult = cached;
          console.log(`[QueueProcessor] Page ${pageNum} OCR Cache Hit!`);
        }
      } catch (err) {
        console.warn(`[QueueProcessor] DB cache read warning for page ${pageNum}:`, err);
      }

      // หากไม่มีแคช ให้ทำ Headless Rendering + OCR
      if (!ocrResult) {
        throwIfAborted();
        console.log(`[QueueProcessor] Page ${pageNum} Cache Miss. Running Headless OCR...`);
        
        // 1.1 Render PDF หน้าดังกล่าวเป็น Canvas ในหน่วยความจำ
        const page = await pdfDoc.getPage(pageNum);
        
        // ตั้งระดับสเกล DPI ให้เสถียร (DPI 150 = scale 2.083, DPI 200 = scale 2.778)
        const scale = 2.0; 
        const viewport = page.getViewport({ scale });
        
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Cannot create headless canvas 2D context');

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        await page.render({ canvasContext: ctx, viewport } as any).promise;

        throwIfAborted();

        // 1.2 แปลง Canvas เป็น Image Blob
        const imageBlob = await new Promise<Blob>((res, rej) => {
          canvas.toBlob((b) => b ? res(b) : rej(new Error('Headless Canvas to Blob failed')), 'image/png');
        });

        throwIfAborted();

        const activeEngine = job.engine;
        const pipelineProfile = 'panel';
        const options = useOCRTextLayerStore.getState().options;
        const ocrLanguage = job.ocrLanguage || options.language || 'eng';

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
          return pixelCount >= 3_600_000 || longest >= 5200 || aspectRatio <= 2.4;
        })();

        const isSensitiveFastLanguage = ocrLanguage
          .split('+')
          .map((code) => code.trim())
          .filter(Boolean)
          .some((code) => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));

        const ocrQualityMode = options.ocrQualityProfile === 'balanced' || options.ocrQualityProfile === 'best' ? 'high' : 'fast';

        const resolvedQualityProfile = activeEngine === 'paddleocr'
          ? (ocrQualityMode === 'fast'
            ? (isSensitiveFastLanguage ? 'balanced' : 'fast')
            : (shouldPreferFastPaddleProfile ? 'fast' : 'balanced'))
          : 'best';

        // 1.3 ส่งภาพไปทำ OCR
        const ocrPromise = visionService.ocrForTextLayer(
          imageBlob,
          canvas.width,
          canvas.height,
          ocrLanguage,
          150, // DPI
          undefined, // pageSegMode
          signal,
          false, // debugCollectDrops
          'panel', // pipelineProfile
          resolvedQualityProfile, // qualityProfile
          job.engine
        );

        ocrResult = await ocrPromise;
        ocrResult.pageNumber = pageNum;
        ocrResult.ocrEngine = job.engine;
        ocrResult.language = ocrLanguage;

        throwIfAborted();

        // 1.4 บันทึก OCR ผลลัพธ์ลงฐานข้อมูล
        await dbService.saveOCR(job.documentId, pageNum, ocrResult, job.engine);
        
        // หากนี่เป็นไฟล์ที่เปิดอยู่ใน UI ให้ซิงก์อัปเดต OCR Store ด้วย
        const activeFile = useProjectStore.getState().file;
        if (activeFile && useProjectStore.getState().documentId === job.documentId) {
          useOCRTextLayerStore.getState().setPageOCR(pageNum, ocrResult);
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
        
        // เรียก Handler ประมวลผลแปลของหน้าและบันทึกลงฐานข้อมูล
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
          console.warn(`[QueueProcessor] Translation failed or skipped on page ${pageNum}`);
        }
      }

      throwIfAborted();
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
