import { invoke } from '@tauri-apps/api/core';
import type { DatabaseBridge, PlatformBridge, SidecarBridge, PdfBridge } from './contracts';
import { TauriPdfBridge } from './pdfBridge';

interface NativeExecuteResponse {
  rows_affected: number;
  last_insert_id: number;
}

export class TauriDatabaseBridge implements DatabaseBridge {
  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return await invoke<T[]>('query_db', {
      sql,
      params: params ?? [],
    });
  }

  async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number }> {
    const res = await invoke<NativeExecuteResponse>('execute_db', {
      sql,
      params: params ?? [],
    });
    return {
      rowsAffected: res.rows_affected,
      lastInsertId: res.last_insert_id,
    };
  }
}

export class TauriSidecarBridge implements SidecarBridge {
  async checkHealth(): Promise<{ status: 'ready' | 'starting' | 'error'; message?: string }> {
    return await invoke<{ status: 'ready' | 'starting' | 'error'; message?: string }>('check_health');
  }

  async restartWorker(): Promise<void> {
    await invoke<void>('restart_worker');
  }
}

export class TauriBridge implements PlatformBridge {
  readonly db: DatabaseBridge = new TauriDatabaseBridge();
  readonly sidecar: SidecarBridge = new TauriSidecarBridge();
  readonly pdf: PdfBridge = new TauriPdfBridge();
}
