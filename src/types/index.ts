/** @format */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type RegionType = "text" | "balloon" | "sfx" | "panel";

export interface Region {
  id: string;
  type: RegionType;
  originalText?: string;
  translatedText?: string;
  box: Box;
  confidence?: number;
}

export type ToolType = "select" | "hand" | "region" | "text";

// ============================================
// OCR Text Layer Types
// ============================================

/** Bounding box in image coordinates (top-left origin) */
export interface BBox {
  x0: number; // left
  y0: number; // top
  x1: number; // right
  y1: number; // bottom
}

/** Word-level OCR result with precise positioning */
export interface OCRWord {
  text: string;
  confidence: number;
  bbox: BBox;
  baseline?: BBox;
  fontSize?: number;
  fontFamily?: string;
}

/** Line-level OCR result containing words */
export interface OCRLine {
  text: string;
  confidence: number;
  bbox: BBox;
  words: OCRWord[];
}

export interface OCRDroppedWord {
  filter: string;
  reason: string;
  text: string;
  confidence: number;
  bbox?: BBox;
}

export type OCRPipelineProfile = "panel" | "export";
export type OCRQualityProfile = "fast" | "balanced" | "best";

export interface OCRStageMetric {
  stage:
    | "base"
    | "rescan"
    | "anchorProbe"
    | "imageFilter"
    | "imgTile"
    | "bgVariance"
    | "isolatedCjk"
    | "korJamo"
    | "weakCjkLine"
    | "watermark"
    | "linePrune";
  wordsBefore: number;
  wordsAfter: number;
  linesBefore: number;
  linesAfter: number;
  replacements?: number;
}

export interface OCRCandidateDebug {
  id: string;
  stage: "emptyLineFallback" | "gapFallback" | "anchorSecondLine" | "anchorTopSparse" | "anchorBottomSparse" | "postPruneLine";
  bbox: BBox;
  accepted: boolean;
  score?: number;
  reason: string;
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

/** Page-level OCR result */
export interface OCRPageResult {
  pageNumber: number;
  width: number;
  height: number;
  dpi: number;
  language: string;
  pageSegMode?: number;
  algorithmVersion: number;
  pipelineProfile?: OCRPipelineProfile;
  ocrQualityProfile?: OCRQualityProfile;
  lines: OCRLine[];
  words: OCRWord[];
  text: string;
  confidence: number;
  debug?: OCRDebugInfo;
}

/** OCR Processing Options */
export interface OCROptions {
  language: string;
  dpi: number;
  profile: "fast" | "balanced" | "best";
  pageSegMode?: number;
  skipIfTextExists?: boolean;
  /** Per-page OCR timeout in seconds (0 = no timeout). Default: 120 */
  perPageTimeoutSec?: number;
}

/** Text Layer Generation Options */
export interface TextLayerOptions {
  /** Make text invisible (true) or visible for debugging (false) */
  invisible: boolean;
  /** Font to use for text layer */
  fontFamily?: string;
  /** Opacity for debugging (0-1) */
  debugOpacity?: number;
}
