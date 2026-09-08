import { spawn } from 'child_process';

export type ExternalBridgeEngine = 'paddleocr' | 'easyocr';

export interface ExternalOcrEngineStatus {
  engine: ExternalBridgeEngine;
  available: boolean;
  runtime: string;
  description: string;
}

export interface ExternalOcrWarmupResponse {
  ok: boolean;
  engine: ExternalBridgeEngine;
  runtime: string;
  description: string;
}

export interface ExternalOcrRequestPayload {
  id?: string;
  engine: string;
  chunkIndex?: number;
  totalChunks?: number;
  /**
   * Absolute path to a temp image file already written to disk.
   * Preferred over imageData — avoids heavy buffer serialization across the IPC bridge.
   * When provided, runExternalOcr bypasses the writeFile step entirely.
   */
  imagePath?: string;
  /**
   * @deprecated Provide imagePath instead to eliminate IPC buffer copy overhead.
   * Still supported for backward-compatibility but will be removed in a future version.
   */
  imageData?: Uint8Array | ArrayBuffer;
  imageMimeType: string;
  imageWidth: number;
  imageHeight: number;
  language: string;
  dpi: number;
  pageSegMode?: number;
  pipelineProfile?: string;
  ocrQualityProfile?: string;
  /**
   * Override PaddleOCR det_limit_side_len (pixels) for this request.
   * Defaults to 4800 when omitted — optimal for dense academic PDFs.
   * Use up to 6000 for tall financial spreadsheets or receipts.
   * Hard-capped at 6000 to prevent the DB++ "Donut Effect".
   */
  maxSideLen?: number;
  maxPixels?: number;
  useAngleCls?: boolean;
  use_angle_cls?: boolean;
}

export interface ExternalOcrBridgeResponse {
  ok: boolean;
  id?: string;
  engine?: string;
  words?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  lines?: Array<{
    text: string;
    confidence: number;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  }>;
  text?: string;
  confidence?: number;
  pageSegMode?: number;
  debug?: unknown;
  runtime?: string;
  description?: string;
  available?: boolean;
  reason?: string;
}

export interface BridgeDaemonRequest {
  resolve: (response: ExternalOcrBridgeResponse) => void;
  reject: (error: Error) => void;
  payload?: Record<string, unknown>;
}

export interface BridgeDaemonQueueItem {
  payload: Record<string, unknown>;
  resolve: (response: ExternalOcrBridgeResponse) => void;
  reject: (error: Error) => void;
  timeoutMs: number;
}

export interface BridgeDaemon {
  engine: ExternalBridgeEngine;
  child: ReturnType<typeof spawn>;
  stdoutBuffer: string;
  pending: Map<string, BridgeDaemonRequest>;
  scriptPath: string;
  scriptSignature: string;
  queue: BridgeDaemonQueueItem[];
  running: boolean;
  lastStderrLines: string[];
  hasProcessedSinceLastMemCheck: boolean;
}

export const EXTERNAL_ENGINES: ExternalBridgeEngine[] = ['paddleocr', 'easyocr'];

export const BENIGN_BRIDGE_STDERR_PATTERNS: RegExp[] = [
  /pin_memory.*no accelerator/i,
  /connectivity check to the model hoster has been skipped/i,
  /creating model:/i,
  /model files already exist/i,
  /no ccache found/i,
  /resized image size .* exceeds max_side_limit/i,
  /info:\s*could not find files for the given pattern/i,
  /lang.*ocr_version.*will be ignored when model names/i,
  // PaddlePaddle / ppocr DEBUG noise
  /ppocr\s+DEBUG:/i,
  /ppocr\s+INFO:/i,
  /ppocr\s+WARNING:/i,
  /^\s*Namespace\(/i,
  /\[0-9]{4}\/[0-9]{2}\/[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\] ppocr/i,
  /W[0-9]+.*paddle/i,
  /I[0-9]+.*paddle/i,
  /^W[0-9]{4}\s/,
  /^I[0-9]{4}\s/,
  // GPU / CUDA / ZLUDA init messages
  /paddle.*use_gpu/i,
  /paddle.*gpu_id/i,
  /gpu.*successfully/i,
  /cuda.*successfully/i,
  /^.*ZLUDA.*(loaded|initialized|version)/i,
  /registering.*hook/i,
  /model.*warmup/i,
  /^.*nvinfer.*[Ii]nfo/i,
  // Electron / DirectComposition noise (not from bridge, but suppress at bridge level too)
  /direct_composition/i,
  /AMD VideoProcessor/i,
];
