import type { OCRPageResult } from './index';
import type { TextLayer } from './layers';
import type { OverlayLayoutProfile } from '../components/OCR/translationOverlayUtils';

export type PdfPrintExportFileType = 'pdf' | 'image';

export type PdfPrintExportPageConfig = {
  pageNum: number;
  sourceOCR: OCRPageResult;
  translatedByIndex: Array<{ index: number; text: string }>;
  pageLayers: TextLayer[];
  deletedLineIndexes: number[];
  overlayLayoutProfile: OverlayLayoutProfile;
  overlayFontFamily: string;
  overlayFontSizeScale: number;
  targetLanguage: string;
  /** PDF page size in points — filled by Main before print. */
  pageWidthPt?: number;
  pageHeightPt?: number;
};

export type PdfPrintExportJob = {
  jobId: string;
  fileType: PdfPrintExportFileType;
  sourceMimeType?: string;
  /** Prefer disk path so Main can copy without shipping bytes over IPC. */
  sourceFilePath?: string | null;
  /** Fallback when the document only exists in memory. Send raw bytes, not base64. */
  sourceBytes?: Uint8Array | null;
  pages: PdfPrintExportPageConfig[];
};

export type PdfPrintExportProgress = {
  jobId: string;
  done: number;
  total: number;
  progress: number;
};

export type PdfPrintExportResult = {
  ok: boolean;
  bytes?: Uint8Array;
  error?: string;
};
