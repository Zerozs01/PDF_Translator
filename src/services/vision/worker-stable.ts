/**
 * Stable Vision Worker - Smart Layout Segmentation (Tesseract-free)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const self: any;

import type {
  OCRWord,
  DocumentType,
} from './ocr-types';
import { groupWordsIntoRegions } from './ocr-region';

// Boot status reporting
try {
  console.log('[Worker-Stable] Module loaded OK – all imports resolved.');
  self.postMessage({ type: 'WORKER_BOOT', payload: { status: 'ok', ts: Date.now() } });
} catch (e) {
  console.error('[Worker-Stable] Boot postMessage failed:', e);
}

function sendProgress(status: string, progress: number, workerId?: string): void {
  self.postMessage({
    type: 'OCR_PROGRESS',
    payload: { status, progress, workerId }
  });
}

self.onmessage = async (e: MessageEvent) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      // ── INIT ──
      case 'INIT': {
        console.log('[Worker-Stable] Initializing Vision Worker...');
        self.postMessage({ type: 'INIT_SUCCESS', id });
        break;
      }

      // ── SEGMENT ──
      case 'SEGMENT': {
        const { words, width, height, documentType = 'manga' } = payload as {
          words: OCRWord[];
          width: number;
          height: number;
          documentType: DocumentType;
        };

        sendProgress('Analyzing regions...', 0.5);
        const regions = groupWordsIntoRegions(words, width, height, documentType);

        console.log(`[Worker-Stable] SEGMENT complete: ${regions.length} regions`);
        self.postMessage({ type: 'SEGMENT_RESULT', id, payload: regions });
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('[Worker-Stable] Error:', error);
    self.postMessage({
      type: 'ERROR',
      id,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

export {};
