/**
 * TextLayerService - สร้าง Invisible Text Layer บน PDF
 * 
 * หลักการ: วาดข้อความที่ OCR ได้ในตำแหน่ง bounding box เดิม
 * โดยใช้ opacity = 0 ทำให้มองไม่เห็นแต่ select/copy ได้
 */

import { PDFDocument, PDFPage, rgb, StandardFonts, PDFFont } from 'pdf-lib';
import { OCRPageResult, OCRWord, TextLayerOptions } from '../../types';

// Font width estimation (approximate)
const AVERAGE_CHAR_WIDTH_RATIO = 0.5; // Average character width relative to font size

export class TextLayerService {
  private pdfDoc: PDFDocument | null = null;
  private font: PDFFont | null = null;

  /**
   * Load PDF from ArrayBuffer
   */
  async loadPDF(pdfBytes: ArrayBuffer): Promise<PDFDocument> {
    this.pdfDoc = await PDFDocument.load(pdfBytes);
    this.font = await this.pdfDoc.embedFont(StandardFonts.Helvetica);
    return this.pdfDoc;
  }

  /**
   * Create new PDF with text layer from scratch
   */
  async createNewPDF(): Promise<PDFDocument> {
    this.pdfDoc = await PDFDocument.create();
    this.font = await this.pdfDoc.embedFont(StandardFonts.Helvetica);
    return this.pdfDoc;
  }

  /**
   * Add invisible text layer to a specific page
   * 
   * @param pageIndex - 0-based page index
   * @param ocrResult - OCR result with word-level bounding boxes (coords in image pixels)
   * @param imageScale - Scale factor (DPI/72, e.g., 300/72 ≈ 4.17 for 300 DPI)
   * @param options - Text layer options
   */
  async addTextLayerToPage(
    pageIndex: number,
    ocrResult: OCRPageResult,
    imageScale: number = 1,
    options: TextLayerOptions = { invisible: true }
  ): Promise<void> {
    if (!this.pdfDoc || !this.font) {
      throw new Error('PDF not loaded. Call loadPDF() first.');
    }

    const pages = this.pdfDoc.getPages();
    if (pageIndex < 0 || pageIndex >= pages.length) {
      throw new Error(`Invalid page index: ${pageIndex}`);
    }

    const page = pages[pageIndex];
    const { width: pdfWidth, height: pdfHeight } = page.getSize();
    
    // Calculate ACTUAL scale based on OCR image dimensions vs PDF page dimensions
    // This is more accurate than using DPI/72 alone
    const ocrImageWidth = ocrResult.width;
    const ocrImageHeight = ocrResult.height;
    
    // Scale factors: how many image pixels per PDF point
    const scaleX = ocrImageWidth / pdfWidth;
    const scaleY = ocrImageHeight / pdfHeight;

    // Process each word
    for (const word of ocrResult.words) {
      await this.drawWord(page, word, pdfWidth, pdfHeight, scaleX, scaleY, options);
    }
  }

  /**
   * Draw a single word on the page
   * 
   * PDF24-style positioning: Transform OCR bbox to PDF coordinates accurately
   * OCR coordinates: top-left origin (0,0 at top-left)
   * PDF coordinates: bottom-left origin (0,0 at bottom-left)
   */
  private async drawWord(
    page: PDFPage,
    word: OCRWord,
    pdfWidth: number,
    pdfHeight: number,
    scaleX: number,
    scaleY: number,
    options: TextLayerOptions
  ): Promise<void> {
    if (!this.font || !word.text.trim()) return;

    // Validate bbox
    if (!word.bbox || word.bbox.x0 === undefined || word.bbox.y0 === undefined) {
      return;
    }

    // Transform image coordinates to PDF coordinates
    // Image: top-left origin, PDF: bottom-left origin
    // 
    // OCR bbox is in image pixels, we need to:
    // 1. Scale down by the image/PDF ratio (scaleX, scaleY)
    // 2. Flip Y axis (PDF y = pdfHeight - imageY/scaleY)
    
    const x = word.bbox.x0 / scaleX;
    const width = (word.bbox.x1 - word.bbox.x0) / scaleX;
    const height = (word.bbox.y1 - word.bbox.y0) / scaleY;
    
    // CRITICAL: For PDF24-like accuracy, position at the BASELINE of text
    // bbox.y1 is the bottom of the bbox in image coords (where text baseline is)
    // We convert to PDF coords by: pdfY = pdfHeight - (imageY / scaleY)
    const y = pdfHeight - (word.bbox.y1 / scaleY);

    // Calculate font size to fit text in bounding box
    const fontSize = this.estimateFontSize(word.text, width, height);

    // Skip if font size is too small or dimensions invalid
    if (fontSize < 1 || width <= 0 || height <= 0) return;
    
    // Clamp position to page bounds
    const clampedX = Math.max(0, Math.min(x, pdfWidth - width));
    const clampedY = Math.max(0, Math.min(y, pdfHeight - fontSize));

    try {
      page.drawText(word.text, {
        x: clampedX,
        y: clampedY,
        size: fontSize,
        font: this.font,
        color: rgb(0, 0, 0),
        opacity: options.invisible ? 0 : (options.debugOpacity ?? 0.3),
      });
    } catch {
      // Skip words with characters not supported by the font
    }
  }

  /**
   * Estimate font size to fit text within bounding box
   */
  private estimateFontSize(text: string, boxWidth: number, boxHeight: number): number {
    if (!this.font || text.length === 0) return 0;

    // Start with height-based estimate
    const heightBasedSize = boxHeight * 0.85;

    // Calculate width-based estimate
    const estimatedCharWidth = heightBasedSize * AVERAGE_CHAR_WIDTH_RATIO;
    const estimatedTextWidth = text.length * estimatedCharWidth;

    // If text is too wide, scale down
    if (estimatedTextWidth > boxWidth) {
      const widthBasedSize = (boxWidth / text.length) / AVERAGE_CHAR_WIDTH_RATIO;
      return Math.min(heightBasedSize, widthBasedSize);
    }

    return heightBasedSize;
  }

  /**
   * Save PDF to ArrayBuffer
   */
  async savePDF(): Promise<Uint8Array> {
    if (!this.pdfDoc) {
      throw new Error('No PDF document to save');
    }
    return await this.pdfDoc.save();
  }

  /**
   * Get current PDF document
   */
  getDocument(): PDFDocument | null {
    return this.pdfDoc;
  }
}

// Singleton instance
export const textLayerService = new TextLayerService();
