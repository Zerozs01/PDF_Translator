import { BrowserWindow } from 'electron';
import path from 'path';
import type { PdfPrintExportPageConfig } from '../src/types/pdfExport';
import {
  cleanupStagedPdfExportJob,
  readStagedPdfExportPages,
  type StagedPdfExportManifest,
} from './pdfExportStaging';
import {
  enrichPagesWithPdfDimensions,
  mergeOverlayPdfsOntoSource,
  type OverlayPageResult,
} from './pdfExportMerge';

type ProgressCallback = (done: number, total: number) => void;

const EXPORT_PAGE_TIMEOUT_MS = 60_000;
const activeJobs = new Map<string, PdfExportSession>();
let sharedExportWindow: BrowserWindow | null = null;

class PdfExportSession {
  private win: BrowserWindow | null = null;
  private aborted = false;

  constructor(
    private readonly jobId: string,
    private readonly manifest: StagedPdfExportManifest,
  ) {}

  async run(pages: PdfPrintExportPageConfig[], onProgress: ProgressCallback): Promise<Buffer> {
    const maxPageWidthPt = Math.max(595, ...pages.map((p) => p.pageWidthPt ?? p.sourceOCR?.width ?? 0));
    const maxPageHeightPt = Math.max(842, ...pages.map((p) => p.pageHeightPt ?? p.sourceOCR?.height ?? 0));
    const windowWidth = Math.max(1600, Math.round(maxPageWidthPt * 1.5));
    const windowHeight = Math.max(2000, Math.round(maxPageHeightPt * 1.5));

    let shellLoaded = false;
    if (sharedExportWindow && !sharedExportWindow.isDestroyed()) {
      sharedExportWindow.setSize(windowWidth, windowHeight);
      shellLoaded = true;
    } else {
      sharedExportWindow = new BrowserWindow({
        show: false,
        width: windowWidth,
        height: windowHeight,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
    }

    this.win = sharedExportWindow;
    const overlayResults: OverlayPageResult[] = [];

    try {
      if (!shellLoaded) {
        await this.loadExportShell();
      }

      for (let index = 0; index < pages.length; index += 1) {
        this.throwIfAborted();
        const pageConfig = pages[index];
        await this.renderOverlayPage(pageConfig);
        overlayResults.push({
          pageNum: pageConfig.pageNum,
          overlayBuffer: await this.printOverlayPage(pageConfig),
        });
        onProgress(index + 1, pages.length);
      }

      if (this.manifest.fileType === 'pdf') {
        return await mergeOverlayPdfsOntoSource(this.manifest.sourcePath, overlayResults);
      }

      return overlayResults[0]?.overlayBuffer ?? Buffer.alloc(0);
    } finally {
      this.win = null;
      if (sharedExportWindow && !sharedExportWindow.isDestroyed()) {
        try {
          // Clear DOM container to free memory on the renderer side
          sharedExportWindow.webContents.executeJavaScript(`
            document.getElementById('export-root')?.replaceChildren();
            document.head.querySelector('style[data-export-page-size]')?.remove();
          `, true).catch(() => {});
        } catch {
          // ignore
        }
      }
    }
  }

  cancel(): void {
    this.aborted = true;
    this.win = null;
    if (sharedExportWindow && !sharedExportWindow.isDestroyed()) {
      try {
        sharedExportWindow.destroy();
      } catch {
        // ignore
      }
      sharedExportWindow = null;
    }
  }

  private throwIfAborted(): void {
    if (this.aborted) {
      throw new Error('Export canceled');
    }
  }

  private getExportUrl(): string {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      return `${devServerUrl}/export-print.html`;
    }
    return `file://${path.join(process.env.DIST || '', 'export-print.html')}`;
  }

  private async loadExportShell(): Promise<void> {
    const wc = this.win!.webContents;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Failed to load export shell')), EXPORT_PAGE_TIMEOUT_MS);
      wc.once('did-finish-load', () => {
        clearTimeout(timeout);
        resolve();
      });
      wc.loadURL(this.getExportUrl()).catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  private async renderOverlayPage(pageConfig: PdfPrintExportPageConfig): Promise<void> {
    const wc = this.win!.webContents;
    await wc.executeJavaScript(`
      window.__renderExportPrintPage(${JSON.stringify(pageConfig)});
    `, true);
    await wc.executeJavaScript('window.__waitForExportPrintReady?.()', true);
  }

  private async printOverlayPage(pageConfig: PdfPrintExportPageConfig): Promise<Buffer> {
    const widthPt = Math.max(1, pageConfig.pageWidthPt ?? pageConfig.sourceOCR.width ?? 595);
    const heightPt = Math.max(1, pageConfig.pageHeightPt ?? pageConfig.sourceOCR.height ?? 842);
    const widthMicrons = Math.round(widthPt * 25400 / 72);
    const heightMicrons = Math.round(heightPt * 25400 / 72);

    return this.win!.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
      pageSize: {
        width: widthMicrons,
        height: heightMicrons,
      },
    });
  }
}

export const startPdfPrintExport = async (
  manifest: StagedPdfExportManifest,
  onProgress: ProgressCallback,
): Promise<Buffer> => {
  activeJobs.get(manifest.jobId)?.cancel();

  const session = new PdfExportSession(manifest.jobId, manifest);
  activeJobs.set(manifest.jobId, session);

  try {
    const stagedPages = await readStagedPdfExportPages(manifest);
    const pages = await enrichPagesWithPdfDimensions(
      manifest.sourcePath,
      manifest.fileType,
      stagedPages,
    );
    return await session.run(pages, onProgress);
  } finally {
    activeJobs.delete(manifest.jobId);
    await cleanupStagedPdfExportJob(manifest.jobId);
  }
};

export const cancelPdfPrintExport = (jobId: string): void => {
  activeJobs.get(jobId)?.cancel();
  activeJobs.delete(jobId);
  void cleanupStagedPdfExportJob(jobId);
};
