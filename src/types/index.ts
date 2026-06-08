/** @format */ 

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BenchmarkMode = 'baseline' | 'improve' | 'dual' | 'compare';

export interface BenchmarkSnapshot {
  runtimeMs: number | null;
  confidence: number | null;
  compositeScore: number | null;
  efficiency: number | null;
  rawAxis: number | null;
  lexicalAxis: number | null;
  yieldAxis: number | null;
  garbageRatio: number | null;
  wordCount: number;
  lineCount: number;
  suspiciousCount: number;
  suspiciousRatio: number;
  droppedCount: number;
  status: 'idle' | 'running' | 'done' | 'error' | 'cached';
  message?: string;
  timestamp?: number;
}

export interface BenchmarkResultSnapshot extends BenchmarkSnapshot {
  engine: OCREngine;
  timestamp: number;
}

export interface BenchmarkResultRow {
  engine: OCREngine;
  engineName: string;
  baseline?: BenchmarkSnapshot | null;
  improve?: BenchmarkSnapshot | null;
  dualRaw?: BenchmarkSnapshot | null;
  dualPipeline?: BenchmarkSnapshot | null;
  status: 'idle' | 'cached' | 'running' | 'done' | 'error';
  cacheHit: boolean;
  timestamp: number;
  message?: string;
  deltas?: {
    compositeDelta: number;
    runtimeDelta: number;
    efficiencyDelta: number;
  };
}

export interface DBBenchmarkRecord {
  documentId: number;
  pageNumber: number;
  mode: 'baseline' | 'improve';
  configHash: string;
  results: BenchmarkResultSnapshot[];
  createdAt: number;
  updatedAt: number;
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

export interface OCRPoint {
  x: number;
  y: number;
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
  quad?: OCRPoint[];
  angleDeg?: number;
  sortHintX?: number;
  sortHintY?: number;
  _sortX?: number;
  _sortY?: number;
  sourceEngine?: OCREngine;
  layoutHints?: Record<string, unknown>;
}

export interface OCRDroppedWord {
  filter: string;
  reason: string;
  text: string;
  confidence: number;
  bbox?: BBox;
}

export type OCRPipelineProfile = "panel" | "export" | "raw";
export type OCRQualityProfile = "fast" | "balanced" | "best";
export type OCREngine = "paddleocr" | "easyocr";

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
  droppedWords?: OCRDroppedWord[];
  dropCounts?: Record<string, number>;
  stageMetrics?: OCRStageMetric[];
  candidates?: OCRCandidateDebug[];
  skipReason?: string;
  runtimeMs?: number;
  timingsMs?: { ocr?: number; [key: string]: number | undefined };
  paddlePass?: string;
  qualityProfile?: OCRQualityProfile;
  raw?: boolean;
  panelSafetyNormalizedVersion?: number;
  fallbackFromEngine?: string;
  fallbackReason?: string;
}

/** Benchmark result for a doc/page */
export interface BenchmarkResult {
  docId: number;
  pageNum: number;
  mode: BenchmarkMode;
  configHash: string;
  results: BenchmarkResultRow[];
  overallStatus: 'pass' | 'risk' | 'fail';
  createdAt: number;
  updatedAt: number;
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
  ocrEngine?: OCREngine;
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
  engine: OCREngine;
  pageSegMode?: number;
  skipIfTextExists?: boolean;
  /** Per-page OCR timeout in seconds (0 = no timeout). Default: 120 */
  perPageTimeoutSec?: number;
  ocrQualityProfile?: OCRQualityProfile;
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
