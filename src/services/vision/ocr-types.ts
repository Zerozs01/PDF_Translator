/**
 * OCR Types — shared type definitions used across all OCR modules
 */

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OCRBlock {
  text: string;
  confidence: number;
  bbox: BBox;
  blockType?: 'text' | 'image' | 'separator' | 'unknown';
}

export type OCRWord = { text: string; confidence: number; bbox: BBox };

export interface TesseractResult {
  data: {
    text: string;
    confidence: number;
    blocks?: OCRBlock[];
    lines?: Array<{ text: string; confidence: number; bbox: BBox; words: unknown[] }>;
    words?: Array<{ text: string; confidence: number; bbox: BBox }>;
    hocr?: string;
    tsv?: string;
  };
}

export type DocumentType = 'manga' | 'document';

export type OCRLine = { text: string; confidence: number; bbox: BBox; words: unknown[] };
