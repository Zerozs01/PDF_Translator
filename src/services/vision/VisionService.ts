import { Region, OCRPageResult } from '../../types';

type WorkerMessage = {
  type: string;
  payload?: any;
  id: string;
};

export type OCRProgressCallback = (progress: {
  status: string;
  progress: number;
  workerId?: string;
}) => void;

class VisionService {
  private worker: Worker | null = null;
  private pendingRequests: Map<string, (data: any) => void> = new Map();
  private progressCallback: OCRProgressCallback | null = null;

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (e) => {
      const { type, id, payload, error } = e.data;
      
      // Handle progress updates
      if (type === 'OCR_PROGRESS' && this.progressCallback) {
        this.progressCallback(payload);
        return;
      }

      const resolver = this.pendingRequests.get(id);

      if (resolver) {
        if (type === 'ERROR') {
          console.error('Vision Worker Error:', error);
          // Handle error appropriately
        } else {
          resolver(payload);
        }
        this.pendingRequests.delete(id);
      }
    };
  }

  public async initialize(): Promise<void> {
    return this.sendMessage('INIT');
  }

  public async segmentImage(imageUrl: string, language: string = 'eng'): Promise<Region[]> {
    return this.sendMessage('SEGMENT', { imageUrl, language });
  }

  /**
   * Set callback for OCR progress updates
   */
  public setProgressCallback(callback: OCRProgressCallback | null): void {
    this.progressCallback = callback;
  }

  /**
   * OCR for Text Layer Overlay
   * Returns word-level bounding boxes for precise text positioning
   */
  public async ocrForTextLayer(
    imageUrl: string,
    imageWidth: number,
    imageHeight: number,
    language: string = 'eng',
    dpi: number = 300
  ): Promise<OCRPageResult> {
    return this.sendMessage('OCR_FOR_TEXT_LAYER', {
      imageUrl,
      imageWidth,
      imageHeight,
      language,
      dpi
    });
  }

  private sendMessage(type: string, payload?: any): Promise<any> {
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      this.pendingRequests.set(id, resolve);
      this.worker?.postMessage({ type, payload, id });
    });
  }

  public terminate() {
    this.worker?.terminate();
    this.worker = null;
  }
}

export const visionService = new VisionService();
