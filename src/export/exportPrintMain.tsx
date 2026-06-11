import './exportPrint.css';
import '../index.css';
import { renderExportPrintPage } from './renderExportPrintPage';
import type { PdfPrintExportPageConfig } from '../types/pdfExport';

window.__renderExportPrintPage = async (pageConfig: PdfPrintExportPageConfig) => {
  await renderExportPrintPage(pageConfig);
};

window.__waitForExportPrintReady = async () => {
  if ('fonts' in document) {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  }
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
};
