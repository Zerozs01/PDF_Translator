import {
  OCR_WORKER_REQUEST_TIMEOUT_MS_DEFAULT,
  OCR_WORKER_RETRY_ATTEMPTS_DEFAULT,
  OCR_WORKER_RETRY_DELAY_MS_DEFAULT,
} from './ocr-timeout';

export type WorkerMessage = {
  type: string;
  payload?: unknown;
  id: string;
};

export type QueuedRequest = {
  type: string;
  payload?: unknown;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  retryCount: number;
  signal?: AbortSignal;
  abortHandler?: () => void;
};

export type PendingRequest = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timestamp: number;
  workerIndex: number;
  timeoutId: ReturnType<typeof setTimeout>;
  request: QueuedRequest;
};

export type WorkerMode = 'primary' | 'stable';

export type WorkerSlot = {
  worker: Worker;
  busy: boolean;
  booted: boolean;
  mode: WorkerMode;
};

export type OCRProgressCallback = (progress: {
  status: string;
  progress: number;
  workerId?: string;
}) => void;

export const createAbortError = (reason: string = 'OCR job canceled'): Error => {
  const error = new Error(reason);
  (error as Error & { name?: string }).name = 'AbortError';
  return error;
};

export const WORKER_POOL_CONFIG = {
  REQUEST_TIMEOUT_MS: OCR_WORKER_REQUEST_TIMEOUT_MS_DEFAULT,
  RETRY_ATTEMPTS: OCR_WORKER_RETRY_ATTEMPTS_DEFAULT,
  RETRY_DELAY_MS: OCR_WORKER_RETRY_DELAY_MS_DEFAULT,
  HEALTH_CHECK_INTERVAL_MS: 30000,
  MAX_WORKERS: 1,
  DEBUG_LOG_MISSING_LINES: false,
};
