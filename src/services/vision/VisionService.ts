import { Region } from '../../types';

type WorkerMessage = {
  type: string;
  payload?: any;
  id: string;
};

class VisionService {
  private worker: Worker | null = null;
  private pendingRequests: Map<string, (data: any) => void> = new Map();

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.onmessage = (e) => {
      const { type, id, payload, error } = e.data;
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
