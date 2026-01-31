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
import { TextLayerService } from './TextLayerService';
import { OCRPageResult, OCROptions } from '../../types';

export interface ProcessingProgress {
  stage: 'init' | 'rendering' | 'ocr' | 'text-layer' | 'saving' | 'complete';
  currentPage: number;
  totalPages: number;
  message: string;
  progress: number; // 0-100
}

export type ProgressCallback = (progress: ProcessingProgress) => void;
export type OCRResultCallback = (pageNum: number, result: OCRPageResult) => void;

export class SearchablePDFService {
  private textLayerService: TextLayerService;
  private onProgress: ProgressCallback | null = null;
  private onOCRResult: OCRResultCallback | null = null;

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
    pageRange?: number[] // Optional: specify pages to process (1-based)
  ): Promise<Uint8Array> {
    this.reportProgress({
      stage: 'init',
      currentPage: 0,
      totalPages: 0,
      message: 'กำลังโหลด PDF...',
      progress: 0
    });

    // Load original PDF
    const pdfDoc = await this.textLayerService.loadPDF(pdfBytes);
    const pages = pdfDoc.getPages();
    const totalPages = pages.length;

    // Process each page with error recovery
    const failedPages: number[] = [];
    
    for (let i = 0; i < totalPages; i++) {
      const pageNum = i + 1;
      
      // Skip pages not in range
      if (pageRange && !pageRange.includes(pageNum)) {
        continue;
      }
      
      const page = pages[i];
      
      try {
        const { width: pdfWidth, height: pdfHeight } = page.getSize();

        // Stage 1: Render page to canvas
        this.reportProgress({
          stage: 'rendering',
          currentPage: pageNum,
          totalPages,
          message: `กำลัง Render หน้า ${pageNum}/${totalPages}...`,
          progress: ((i * 3) / (totalPages * 3)) * 100
        });

        const { canvas, width: imageWidth, height: imageHeight } = await renderPageToCanvas(pageNum, options.dpi);
        
        // Calculate scale factor (image pixels per PDF point)
        // PDF uses 72 DPI by default
        const scale = options.dpi / 72;

        // Stage 2: OCR the rendered image
        this.reportProgress({
          stage: 'ocr',
          currentPage: pageNum,
          totalPages,
          message: `กำลัง OCR หน้า ${pageNum}/${totalPages} (${options.language})...`,
          progress: ((i * 3 + 1) / (totalPages * 3)) * 100
        });

        // Set up OCR progress callback
        visionService.setProgressCallback((ocrProgress) => {
          const baseProgress = ((i * 3 + 1) / (totalPages * 3)) * 100;
          const ocrContribution = (1 / (totalPages * 3)) * 100 * ocrProgress.progress;
          
          this.reportProgress({
            stage: 'ocr',
            currentPage: pageNum,
            totalPages,
            message: `OCR หน้า ${pageNum}: ${ocrProgress.status} (${Math.round(ocrProgress.progress * 100)}%)`,
            progress: baseProgress + ocrContribution
          });
        });

        const imageDataUrl = canvas.toDataURL('image/png');
        
        // OCR with retry
        let ocrResult: OCRPageResult | null = null;
        let retryCount = 0;
        const MAX_RETRIES = 2;
        
        while (retryCount <= MAX_RETRIES && !ocrResult) {
          try {
            ocrResult = await visionService.ocrForTextLayer(
              imageDataUrl,
              imageWidth,
              imageHeight,
              options.language,
              options.dpi
            );
          } catch (ocrError) {
            retryCount++;
            console.warn(`[SearchablePDF] OCR retry ${retryCount}/${MAX_RETRIES} for page ${pageNum}:`, ocrError);
            
            if (retryCount > MAX_RETRIES) {
              throw ocrError;
            }
            
            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        // Clear OCR progress callback
        visionService.setProgressCallback(null);
        
        if (!ocrResult) {
          throw new Error(`OCR failed after ${MAX_RETRIES} retries`);
        }

        // Emit OCR result for UI display
        if (this.onOCRResult) {
          this.onOCRResult(pageNum, ocrResult);
        }

        // Stage 3: Add text layer
        this.reportProgress({
          stage: 'text-layer',
          currentPage: pageNum,
          totalPages,
          message: `กำลังเพิ่ม Text Layer หน้า ${pageNum}/${totalPages}...`,
          progress: ((i * 3 + 2) / (totalPages * 3)) * 100
        });

        await this.textLayerService.addTextLayerToPage(i, ocrResult, scale, { invisible: true });
        
      } catch (pageError) {
        console.error(`[SearchablePDF] Failed to process page ${pageNum}:`, pageError);
        failedPages.push(pageNum);
        
        // Report error but continue with next page
        this.reportProgress({
          stage: 'ocr',
          currentPage: pageNum,
          totalPages,
          message: `⚠️ หน้า ${pageNum} ล้มเหลว - ข้ามไปหน้าถัดไป...`,
          progress: ((i * 3 + 3) / (totalPages * 3)) * 100
        });
        
        // Clear OCR progress callback
        visionService.setProgressCallback(null);
      }
    }
    
    // Log summary
    if (failedPages.length > 0) {
      console.warn(`[SearchablePDF] Completed with ${failedPages.length} failed pages: ${failedPages.join(', ')}`);
    }

    // Stage 4: Save PDF
    this.reportProgress({
      stage: 'saving',
      currentPage: totalPages,
      totalPages,
      message: 'กำลังบันทึก PDF...',
      progress: 95
    });

    const result = await this.textLayerService.savePDF();

    this.reportProgress({
      stage: 'complete',
      currentPage: totalPages,
      totalPages,
      message: 'เสร็จสิ้น!',
      progress: 100
    });

    return result;
  }

  /**
   * Process single page and return OCR result (for preview/debugging)
   */
  async ocrSinglePage(
    imageDataUrl: string,
    imageWidth: number,
    imageHeight: number,
    language: string = 'eng',
    dpi: number = 300
  ): Promise<OCRPageResult> {
    return visionService.ocrForTextLayer(imageDataUrl, imageWidth, imageHeight, language, dpi);
  }
}

// Singleton instance
export const searchablePDFService = new SearchablePDFService();
