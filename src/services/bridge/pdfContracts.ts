export interface PdfDocumentMeta {
  docId: string;
  filePath: string;
  pageCount: number;
  dimensions: Array<{ width: number; height: number }>;
}

export interface TextOverlayItem {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  fontSize: number;
  fontColor?: string;
}

export interface PageImageOverlay {
  pageNumber: number;
  imageData: Uint8Array | number[];
}

export interface PdfExportOptions {
  docId: string;
  outputPath: string;
  pageImages?: PageImageOverlay[];
  overlays?: TextOverlayItem[];
  embedOriginalImages: boolean;
}

export interface PdfBridge {
  openDocument(filePath: string): Promise<PdfDocumentMeta>;
  getPageStreamUrl(docId: string, pageNumber: number, scale?: number): string;
  renderPageBinary?(docId: string, pageNumber: number, scale?: number): Promise<Uint8Array>;
  exportPdf(options: PdfExportOptions): Promise<{ success: boolean; outputPath: string }>;
}
