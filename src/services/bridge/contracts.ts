import type { PdfBridge } from './pdfContracts';

export * from './pdfContracts';

export interface DatabaseBridge {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number }>;
}

export interface SidecarBridge {
  checkHealth(): Promise<{ status: 'ready' | 'starting' | 'error'; message?: string }>;
  restartWorker(): Promise<void>;
}

export interface PlatformBridge {
  db: DatabaseBridge;
  sidecar: SidecarBridge;
  pdf: PdfBridge;
}
