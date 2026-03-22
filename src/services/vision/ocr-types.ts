/**
 * OCR Types — shared type definitions used across all OCR modules
 */

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OCRDroppedWord {
  filter: string;
  reason: string;
  text: string;
  confidence: number;
  bbox?: BBox;
}

export type OCRPipelineProfile = 'panel' | 'export';
export type OCRQualityProfile = 'fast' | 'balanced' | 'best';

export interface OCRStageMetric {
  stage:
    | 'base'
    | 'rescan'
    | 'anchorProbe'
    | 'imageFilter'
    | 'imgTile'
    | 'bgVariance'
    | 'isolatedCjk'
    | 'korJamo'
    | 'weakCjkLine'
    | 'watermark'
    | 'linePrune';
  wordsBefore: number;
  wordsAfter: number;
  linesBefore: number;
  linesAfter: number;
  replacements?: number;
}

export interface OCRCandidateDebug {
  id: string;
  stage: 'emptyLineFallback' | 'gapFallback' | 'anchorSecondLine' | 'anchorTopSparse' | 'anchorBottomSparse' | 'postPruneLine';
  bbox: BBox;
  accepted: boolean;
  score?: number;
  reason: string;
}

export type OCRCandidateSource = 'tsv-line' | 'linebox' | 'gap' | 'anchorProbe';

export interface OCRCandidate {
  id: string;
  bbox: BBox;
  source: OCRCandidateSource;
  stage: 'base' | 'rescue';
  accepted: boolean;
  textLikeScore: number;
  rejectReason?: string;
  anchorLineIndex?: number;
}

export interface OCRDebugInfo {
  droppedWords: OCRDroppedWord[];
  dropCounts: Record<string, number>;
  stageMetrics?: OCRStageMetric[];
  candidates?: OCRCandidateDebug[];
  skipReason?: string;
  runtimeMs?: number;
  qualityProfile?: OCRQualityProfile;
}

export interface OCRFixtureExpectation {
  page: number;
  minLines: number;
  minMeaningfulWords: number;
  mustContainAny: string[][];
  mustNotContainNormalized: string[];
  maxStandaloneShortTokens: number;
  maxSuspiciousRatio: number;
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
    lines?: Array<{ text: string; confidence: number; bbox: BBox; words: OCRWord[] }>;
    words?: Array<{ text: string; confidence: number; bbox: BBox }>;
    hocr?: string;
    tsv?: string;
  };
}

export type DocumentType = 'manga' | 'document';

export type OCRLine = { text: string; confidence: number; bbox: BBox; words: OCRWord[] };
