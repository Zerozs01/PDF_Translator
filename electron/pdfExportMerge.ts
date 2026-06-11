import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import type { PdfPrintExportPageConfig } from '../src/types/pdfExport';

export type OverlayPageResult = {
  pageNum: number;
  overlayBuffer: Buffer;
};

export async function enrichPagesWithPdfDimensions(
  sourcePath: string,
  fileType: 'pdf' | 'image',
  pages: PdfPrintExportPageConfig[],
): Promise<PdfPrintExportPageConfig[]> {
  if (fileType !== 'pdf') {
    return pages.map((page) => ({
      ...page,
      pageWidthPt: Math.max(1, page.sourceOCR.width || 595),
      pageHeightPt: Math.max(1, page.sourceOCR.height || 842),
    }));
  }

  const sourcePdf = await PDFDocument.load(fs.readFileSync(sourcePath));
  return pages.map((page) => {
    const pdfPage = sourcePdf.getPage(page.pageNum - 1);
    const { width, height } = pdfPage.getSize();
    return {
      ...page,
      pageWidthPt: width,
      pageHeightPt: height,
    };
  });
}

export async function mergeOverlayPdfsOntoSource(
  sourcePath: string,
  overlays: OverlayPageResult[],
): Promise<Buffer> {
  const sourcePdf = await PDFDocument.load(fs.readFileSync(sourcePath));
  const outputPdf = await PDFDocument.create();

  for (const entry of overlays) {
    const sourceIndex = entry.pageNum - 1;
    const sourcePage = sourcePdf.getPage(sourceIndex);
    const { width, height } = sourcePage.getSize();

    const overlayDoc = await PDFDocument.load(entry.overlayBuffer);
    const overlayIndices = overlayDoc.getPageIndices();
    if (overlayIndices.length === 0) {
      const [copiedSourcePage] = await outputPdf.copyPages(sourcePdf, [sourceIndex]);
      outputPdf.addPage(copiedSourcePage);
      continue;
    }

    const [embeddedSource] = await outputPdf.embedPages([sourcePage]);
    const [embeddedOverlay] = await outputPdf.embedPages([overlayDoc.getPage(overlayIndices[0])]);

    const targetPage = outputPdf.addPage([width, height]);
    targetPage.drawPage(embeddedSource, { x: 0, y: 0, width, height });
    targetPage.drawPage(embeddedOverlay, { x: 0, y: 0, width, height });
  }

  return Buffer.from(await outputPdf.save());
}
