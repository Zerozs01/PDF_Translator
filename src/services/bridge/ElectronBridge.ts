import type { DatabaseBridge, PlatformBridge, SidecarBridge, PdfBridge } from './contracts';
import { ElectronPdfBridge } from './pdfBridge';

export class ElectronDatabaseBridge implements DatabaseBridge {
  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.db?.query) {
      return (window as any).electronAPI.db.query(sql, params);
    }
    console.warn('[ElectronDatabaseBridge] Direct raw query not supported by window.electronAPI.db; fallback empty');
    return [];
  }

  async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number }> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.db?.execute) {
      return (window as any).electronAPI.db.execute(sql, params);
    }
    return { rowsAffected: 0, lastInsertId: 0 };
  }
}

export class ElectronSidecarBridge implements SidecarBridge {
  async checkHealth(): Promise<{ status: 'ready' | 'starting' | 'error'; message?: string }> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.ocr?.checkHealth) {
      return (window as any).electronAPI.ocr.checkHealth();
    }
    return { status: 'ready', message: 'Electron main process active' };
  }

  async restartWorker(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.ocr?.restart) {
      await (window as any).electronAPI.ocr.restart();
    }
  }
}

export class ElectronBridge implements PlatformBridge {
  readonly db: DatabaseBridge = new ElectronDatabaseBridge();
  readonly sidecar: SidecarBridge = new ElectronSidecarBridge();
  readonly pdf: PdfBridge = new ElectronPdfBridge();
}
