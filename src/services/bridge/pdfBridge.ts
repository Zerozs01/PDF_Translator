import { invoke } from '@tauri-apps/api/core';
import type { PdfBridge, PdfDocumentMeta, PdfExportOptions } from './pdfContracts';

export class TauriPdfBridge implements PdfBridge {
  async openDocument(filePath: string): Promise<PdfDocumentMeta> {
    const meta = await invoke<any>('open_document', { filePath });
    return {
      docId: meta.doc_id ?? meta.docId,
      filePath: meta.file_path ?? meta.filePath,
      pageCount: meta.page_count ?? meta.pageCount,
      dimensions: meta.dimensions ?? [],
    };
  }

  getPageStreamUrl(docId: string, pageNumber: number, scale: number = 1.0): string {
    const isWindows = typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent || '');
    const scheme = isWindows ? 'http://pdf-page.localhost' : 'pdf-page://localhost';
    return `${scheme}/${encodeURIComponent(docId)}/${pageNumber}?scale=${scale}`;
  }


  async renderPageBinary(docId: string, pageNumber: number, scale: number = 1.0): Promise<Uint8Array> {
    const bytes = await invoke<number[]>('render_page_binary', {
      docId,
      pageNumber,
      scale,
    });
    return new Uint8Array(bytes);
  }

  async exportPdf(options: PdfExportOptions): Promise<{ success: boolean; outputPath: string }> {
    const rustOptions = {
      doc_id: options.docId,
      output_path: options.outputPath,
      page_images: options.pageImages?.map((img) => ({
        page_number: img.pageNumber,
        image_data: img.imageData instanceof Uint8Array ? img.imageData : new Uint8Array(img.imageData),
      })) || [],
      overlays: options.overlays?.map((item) => ({
        page_number: item.pageNumber,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        text: item.text,
        font_size: item.fontSize,
        font_color: item.fontColor,
      })) || [],
      embed_original_images: options.embedOriginalImages,
    };

    const outPath = await invoke<string>('export_translated_pdf', {
      options: rustOptions,
    });

    return {
      success: true,
      outputPath: outPath,
    };
  }
}

export class ElectronPdfBridge implements PdfBridge {
  async openDocument(filePath: string): Promise<PdfDocumentMeta> {
    return {
      docId: `doc_${encodeURIComponent(filePath)}`,
      filePath,
      pageCount: 1,
      dimensions: [{ width: 595, height: 842 }],
    };
  }

  getPageStreamUrl(docId: string, pageNumber: number, _scale: number = 1.0): string {
    return `blob:electron/${docId}/${pageNumber}`;
  }

  async exportPdf(options: PdfExportOptions): Promise<{ success: boolean; outputPath: string }> {
    return {
      success: true,
      outputPath: options.outputPath,
    };
  }
}
