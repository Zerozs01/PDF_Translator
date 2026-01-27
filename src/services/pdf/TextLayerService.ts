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
   * @param ocrResult - OCR result with word-level bounding boxes
   * @param imageScale - Scale factor (image pixels / PDF points)
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
    const { height: pdfHeight } = page.getSize();

    console.log(`[TextLayer] Adding text to page ${pageIndex + 1}. OCR has ${ocrResult.words.length} words.`);
    console.log(`[TextLayer] Image scale: ${imageScale}, PDF height: ${pdfHeight}`);

    // Process each word
    for (const word of ocrResult.words) {
      await this.drawWord(page, word, pdfHeight, imageScale, options);
    }

    console.log(`[TextLayer] Completed page ${pageIndex + 1}`);
  }

  /**
   * Draw a single word on the page
   */
  private async drawWord(
    page: PDFPage,
    word: OCRWord,
    pdfHeight: number,
    scale: number,
    options: TextLayerOptions
  ): Promise<void> {
    if (!this.font || !word.text.trim()) return;

    // Transform image coordinates to PDF coordinates
    // Image: top-left origin, PDF: bottom-left origin
    const x = word.bbox.x0 / scale;
    const y = pdfHeight - (word.bbox.y1 / scale); // Flip Y axis
    const width = (word.bbox.x1 - word.bbox.x0) / scale;
    const height = (word.bbox.y1 - word.bbox.y0) / scale;

    // Calculate font size to fit text in bounding box
    const fontSize = this.estimateFontSize(word.text, width, height);

    // Skip if font size is too small
    if (fontSize < 1) return;

    try {
      page.drawText(word.text, {
        x: x,
        y: y + (height * 0.15), // Adjust baseline slightly
        size: fontSize,
        font: this.font,
        color: rgb(0, 0, 0),
        opacity: options.invisible ? 0 : (options.debugOpacity ?? 0.3),
        // Note: pdf-lib doesn't support text rendering mode directly
        // but opacity: 0 achieves invisible but selectable text
      });
    } catch (error) {
      // Skip words with characters not supported by the font
      console.warn(`[TextLayer] Skipped word "${word.text.substring(0, 10)}...": Font encoding issue`);
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
