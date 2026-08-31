import { ipcMain } from 'electron';
import { cancelPdfPrintExport, startPdfPrintExport } from '../pdfExportService';
import {
  cleanupStagedPdfExportJob,
  stagePdfExportJob
} from '../pdfExportStaging';

export function registerPdfExportIpcHandlers() {
  ipcMain.handle('pdf-export:start', async (event, request) => {
    if (!request || typeof request !== 'object' || typeof request.jobId !== 'string') {
      throw new Error('Invalid PDF export job payload.');
    }

    let manifest;
    try {
      manifest = await stagePdfExportJob(request);
      const bytes = await startPdfPrintExport(manifest, (done, total) => {
        event.sender.send('pdf-export:progress', {
          jobId: request.jobId,
          done,
          total,
          progress: Math.round((done / Math.max(1, total)) * 100),
        });
      });
      return { ok: true, bytes };
    } catch (error) {
      await cleanupStagedPdfExportJob(request.jobId);
      const message = error instanceof Error ? error.message : 'PDF export failed';
      if (message === 'Export canceled') {
        return { ok: false, error: message };
      }
      throw error;
    }
  });

  ipcMain.handle('pdf-export:cancel', async (_, payload: { jobId?: string }) => {
    if (!payload?.jobId) {
      return { ok: false };
    }
    cancelPdfPrintExport(payload.jobId);
    return { ok: true };
  });
}
