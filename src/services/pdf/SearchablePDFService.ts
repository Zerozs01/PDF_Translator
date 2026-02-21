/**
 * SearchablePDFService - สร้าง Searchable PDF จาก Image-based PDF
 * 
 * Pipeline:
 * 1. Render PDF page → Image (Canvas)
 * 2. OCR Image → Word-level bounding boxes
 * 3. Add invisible text layer → Searchable PDF
 */

import { PDFDocument } from 'pdf-lib';
import { visionService } from '../vision/VisionService';
import { OCR_ALGORITHM_VERSION } from '../vision/ocrVersion';
import { TextLayerService } from './TextLayerService';
import { OCRPageResult, OCROptions } from '../../types';
import { dbService } from '../dbService';
import { pdfjs } from './pdfjsWorker';

export interface ProcessingProgress {
  stage: 'init' | 'rendering' | 'ocr' | 'text-layer' | 'saving' | 'complete';
  currentPage: number;
  totalPages: number;
  message: string;
  progress: number; // 0-100
}

export type ProgressCallback = (progress: ProcessingProgress) => void;
export type OCRResultCallback = (pageNum: number, result: OCRPageResult) => void;
export type CacheHitCallback = (pageNum: number, source: 'db') => void;

export class SearchablePDFService {
  private textLayerService: TextLayerService;
  private onProgress: ProgressCallback | null = null;
  private onOCRResult: OCRResultCallback | null = null;
  private onCacheHit: CacheHitCallback | null = null;

  constructor() {
    this.textLayerService = new TextLayerService();
  }

  /**
   * Set progress callback
   */
  setProgressCallback(callback: ProgressCallback): void {
    this.onProgress = callback;
  }

  /**
   * Set OCR result callback - called when each page's OCR completes
   */
  setOCRResultCallback(callback: OCRResultCallback | null): void {
    this.onOCRResult = callback;
  }

  /**
   * Set cache hit callback - called when a page uses cached OCR
   */
  setCacheHitCallback(callback: CacheHitCallback | null): void {
    this.onCacheHit = callback;
  }

  /**
   * Report progress
   */
  private reportProgress(progress: ProcessingProgress): void {
    if (this.onProgress) {
      this.onProgress(progress);
    }
  }

  /**
   * Create searchable PDF from image-based PDF
   * 
   * @param pdfBytes - Original PDF as ArrayBuffer
   * @param options - OCR options
   * @param renderPageToCanvas - Function to render PDF page to canvas
   * @returns Searchable PDF as Uint8Array
   */
  async createSearchablePDF(
    pdfBytes: ArrayBuffer,
    options: OCROptions,
    renderPageToCanvas: (pageNum: number, dpi: number) => Promise<{ canvas: HTMLCanvasElement; width: number; height: number }>,
    pageRange?: number[], // Optional: specify pages to process (1-based)
    cacheDocId?: number,
    signal?: AbortSignal,
    forceReOCR: boolean = false,
    debugCollectDrops: boolean = false
  ): Promise<Uint8Array> {
    const createAbortError = (reason: string = 'OCR job canceled'): Error => {
      const error = new Error(reason);
      (error as Error & { name?: string }).name = 'AbortError';
      return error;
    };

    const isAbortError = (error: unknown): boolean =>
      error instanceof Error && error.name === 'AbortError';

    const throwIfAborted = () => {
      if (signal?.aborted) {
        throw createAbortError();
      }
    };

    const onAbort = () => {
      visionService.cancelAll('OCR job canceled');
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    let textCheckDoc: import('pdfjs-dist').PDFDocumentProxy | null = null;
    let textCheckTask: { destroy?: () => void } | null = null;

    try {
      throwIfAborted();

    this.reportProgress({
      stage: 'init',
      currentPage: 0,
      totalPages: 0,
      message: 'กำลังโหลด PDF...',
      progress: 0
    });

    // Clone bytes into dedicated buffers to avoid worker transfer/detach side effects.
    const sourceBytes = new Uint8Array(pdfBytes);
    const editBytes = sourceBytes.slice().buffer;
    const textCheckSeed = sourceBytes.slice();

    // Load original PDF
    const pdfDoc = await this.textLayerService.loadPDF(editBytes as ArrayBuffer);
    const pages = pdfDoc.getPages();
    const totalPages = pages.length;
    const pageSet = pageRange ? new Set(pageRange) : null;
    const pagesToProcess = pageRange ? pageRange.length : totalPages;
    const totalUnits = Math.max(1, pagesToProcess * 3);
    let completedUnits = 0;

    const canUseCache = !forceReOCR && Boolean(cacheDocId && dbService.isAvailable());
    const scale = options.dpi / 72;
    const normalizeLanguage = (value: string): string =>
      value
        .split('+')
        .map(v => v.trim())
        .filter(Boolean)
        .sort()
        .join('+');
    const normalizedLanguage = normalizeLanguage(options.language);
    const skipIfTextExists = !forceReOCR && options.skipIfTextExists !== false;

    const textLayerCache = new Map<number, boolean>();

    const hasExistingTextLayer = async (pageNum: number): Promise<boolean> => {
      if (!skipIfTextExists) return false;
      if (textLayerCache.has(pageNum)) return textLayerCache.get(pageNum) ?? false;

      try {
        if (!textCheckDoc) {
          const data = textCheckSeed.slice();
          textCheckTask = pdfjs.getDocument({ data });
          textCheckDoc = await (textCheckTask as any).promise;
        }
        const page = await textCheckDoc.getPage(pageNum);
        const textContent = await page.getTextContent({ includeMarkedContent: true });
        const hasText = textContent.items.some((item) => {
          const text = (item as { str?: string }).str ?? '';
          return text.trim().length > 0;
        });
        textLayerCache.set(pageNum, hasText);
        return hasText;
      } catch (error) {
        console.warn(`[SearchablePDF] Failed to detect text layer for page ${pageNum}:`, error);
        textLayerCache.set(pageNum, false);
        return false;
      }
    };

    const isCacheCompatible = (cached: OCRPageResult): boolean => {
      if (normalizeLanguage(cached.language) !== normalizedLanguage) return false;
      if (cached.dpi !== options.dpi) return false;
      if (options.pageSegMode !== undefined && cached.pageSegMode !== options.pageSegMode) return false;
      if (cached.algorithmVersion !== OCR_ALGORITHM_VERSION) return false;
      return true;
    };

    const updateProgress = (
      stage: ProcessingProgress['stage'],
      pageNum: number,
      message: string,
      units: number = 0
    ) => {
      if (units > 0) {
        completedUnits += units;
      }
      const progress = Math.min(100, (completedUnits / totalUnits) * 100);
      this.reportProgress({
        stage,
        currentPage: pageNum,
        totalPages: pagesToProcess,
        message,
        progress
      });
    };

    // Process each page with error recovery
    const failedPages: number[] = [];
    const maxParallel = (() => {
      if (typeof navigator === 'undefined') return 1;
      const cores = navigator.hardwareConcurrency || 1;
      return Math.max(1, Math.min(2, Math.floor(cores / 2)));
    })();

    let textLayerChain = Promise.resolve();
    const enqueueTextLayer = (pageIndex: number, pageNum: number, ocrResult: OCRPageResult) => {
      textLayerChain = textLayerChain.then(async () => {
        updateProgress('text-layer', pageNum, `กำลังเพิ่ม Text Layer หน้า ${pageNum}/${pagesToProcess}...`);
        try {
          await this.textLayerService.addTextLayerToPage(pageIndex, ocrResult, scale, { invisible: true });
        } catch (error) {
          console.error(`[SearchablePDF] Failed to add text layer for page ${pageNum}:`, error);
          failedPages.push(pageNum);
        } finally {
          updateProgress('text-layer', pageNum, `เพิ่ม Text Layer หน้า ${pageNum}/${pagesToProcess} เสร็จแล้ว`, 1);
        }
      });
      return textLayerChain;
    };

    const inFlight = new Set<Promise<void>>();

    for (let i = 0; i < totalPages; i++) {
      throwIfAborted();
      const pageNum = i + 1;
      if (pageSet && !pageSet.has(pageNum)) continue;

      const task = (async () => {
        throwIfAborted();
        let unitsUsed = 0;
        const stepProgress = (stage: ProcessingProgress['stage'], message: string, units: number = 0) => {
          if (units > 0) unitsUsed += units;
          updateProgress(stage, pageNum, message, units);
        };

        try {
          let ocrResult: OCRPageResult | null = null;
          let usedCache = false;

          if (await hasExistingTextLayer(pageNum)) {
            stepProgress('ocr', `Text layer detected â€” skipping OCR for page ${pageNum}/${pagesToProcess}`, 2);
            stepProgress('text-layer', `Using existing text layer for page ${pageNum}/${pagesToProcess}`, 1);
            return;
          }

          if (canUseCache && cacheDocId) {
            const cached = await dbService.getOCR(cacheDocId, pageNum);
            if (cached && isCacheCompatible(cached)) {
              ocrResult = cached;
              usedCache = true;
            }
          }

          if (usedCache && ocrResult) {
            ocrResult.pageNumber = pageNum;
            if (this.onCacheHit) {
              this.onCacheHit(pageNum, 'db');
            }
            stepProgress('ocr', `ใช้ OCR จากแคช หน้า ${pageNum}/${pagesToProcess}`, 2);
          } else {
            throwIfAborted();
            stepProgress('rendering', `กำลัง Render หน้า ${pageNum}/${pagesToProcess}...`);

            const { canvas, width: imageWidth, height: imageHeight } = await renderPageToCanvas(pageNum, options.dpi);
            stepProgress('rendering', `Render หน้า ${pageNum}/${pagesToProcess} เสร็จแล้ว`, 1);

            const imageBlob = await new Promise<Blob>((resolve, reject) => {
              canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('Failed to convert canvas to Blob'));
              }, 'image/png');
            });

            stepProgress('ocr', `กำลัง OCR หน้า ${pageNum}/${pagesToProcess} (${options.language})...`);
            ocrResult = await visionService.ocrForTextLayer(
              imageBlob,
              imageWidth,
              imageHeight,
              options.language,
              options.dpi,
              options.pageSegMode,
              signal,
              debugCollectDrops
            );
            ocrResult.language = normalizedLanguage;
            ocrResult.pageNumber = pageNum;
            stepProgress('ocr', `OCR หน้า ${pageNum}/${pagesToProcess} เสร็จแล้ว`, 1);

            if (canUseCache && cacheDocId) {
              await dbService.saveOCR(cacheDocId, pageNum, ocrResult);
            }
          }

          if (!ocrResult) {
            throw new Error('OCR failed');
          }

          if (this.onOCRResult) {
            this.onOCRResult(pageNum, ocrResult);
          }

          await enqueueTextLayer(i, pageNum, ocrResult);
          unitsUsed += 1;
        } catch (pageError) {
          console.error(`[SearchablePDF] Failed to process page ${pageNum}:`, pageError);
          failedPages.push(pageNum);
          const remaining = Math.max(0, 3 - unitsUsed);
          updateProgress('ocr', pageNum, `⚠️ หน้า ${pageNum} ล้มเหลว - ข้ามไปหน้าถัดไป...`, remaining);
        }
      })();

      inFlight.add(task);
      task.finally(() => inFlight.delete(task));

      if (inFlight.size >= maxParallel) {
        await Promise.race(inFlight);
      }
    }

    if (signal?.aborted) {
      await Promise.allSettled(inFlight);
      throw createAbortError();
    }

    try {
      await Promise.all(inFlight);
    } catch (error) {
      if (isAbortError(error)) {
        await Promise.allSettled(inFlight);
        throw createAbortError();
      }
      throw error;
    }
    await textLayerChain;

    throwIfAborted();
    
    // Log summary
    if (failedPages.length > 0) {
      console.warn(`[SearchablePDF] Completed with ${failedPages.length} failed pages: ${failedPages.join(', ')}`);
    }

    // Stage 4: Save PDF
    this.reportProgress({
      stage: 'saving',
      currentPage: pagesToProcess,
      totalPages: pagesToProcess,
      message: 'กำลังบันทึก PDF...',
      progress: 95
    });

    const result = await this.textLayerService.savePDF();

    this.reportProgress({
      stage: 'complete',
      currentPage: pagesToProcess,
      totalPages: pagesToProcess,
      message: 'เสร็จสิ้น!',
      progress: 100
    });

    return result;
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      if (textCheckDoc) {
        try {
          await textCheckDoc.destroy();
        } catch {
          // ignore
        }
      }
      if (textCheckTask && typeof textCheckTask.destroy === 'function') {
        try {
          textCheckTask.destroy();
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Create searchable PDF from cached OCR results (no OCR pass)
   */
  async createSearchablePDFWithOCR(
    pdfBytes: ArrayBuffer,
    ocrPages: Map<number, OCRPageResult>,
    pageRange?: number[]
  ): Promise<Uint8Array> {
    const pdfDoc = await this.textLayerService.loadPDF(pdfBytes);
    const pages = pdfDoc.getPages();

    for (let i = 0; i < pages.length; i++) {
      const pageNum = i + 1;
      if (pageRange && !pageRange.includes(pageNum)) continue;

      const ocrResult = ocrPages.get(pageNum);
      if (!ocrResult) continue;

      await this.textLayerService.addTextLayerToPage(i, ocrResult, 1, { invisible: true });
    }

    return await this.textLayerService.savePDF();
  }

  /**
   * Process single page and return OCR result (for preview/debugging)
   */
  async ocrSinglePage(
    imageDataUrl: string,
    imageWidth: number,
    imageHeight: number,
    language: string = 'eng',
    dpi: number = 300,
    pageSegMode?: number
  ): Promise<OCRPageResult> {
    return visionService.ocrForTextLayer(imageDataUrl, imageWidth, imageHeight, language, dpi, pageSegMode);
  }
}

// Singleton instance
export const searchablePDFService = new SearchablePDFService();
