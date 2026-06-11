import { describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PDFDocument, rgb } from 'pdf-lib';
import { mergeOverlayPdfsOntoSource } from './pdfExportMerge';

describe('pdfExportMerge', () => {
  it('stamps overlay pages onto matching source pages', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-export-merge-'));
    const sourcePath = path.join(tempDir, 'source.pdf');
    const sourcePdf = await PDFDocument.create();
    const page = sourcePdf.addPage([400, 600]);
    page.drawRectangle({ x: 0, y: 0, width: 400, height: 600, color: rgb(0.9, 0.9, 0.9) });
    fs.writeFileSync(sourcePath, await sourcePdf.save());

    const overlayPdf = await PDFDocument.create();
    const overlayPage = overlayPdf.addPage([400, 600]);
    overlayPage.drawText('Overlay Thai', { x: 40, y: 500, size: 18 });
    const overlayBuffer = Buffer.from(await overlayPdf.save());

    const merged = await mergeOverlayPdfsOntoSource(sourcePath, [
      { pageNum: 1, overlayBuffer },
    ]);
    const mergedDoc = await PDFDocument.load(merged);
    expect(mergedDoc.getPageCount()).toBe(1);
    expect(mergedDoc.getPage(0).getSize().width).toBe(400);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
