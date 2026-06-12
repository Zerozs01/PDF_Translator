import { describe, expect, test } from 'vitest';
import { resolveExportLineText } from './renderExportPrintPage';
import type { PdfPrintExportPageConfig } from '../types/pdfExport';
import type { OCRLine } from '../types';

describe('renderExportPrintPage helpers', () => {
  const baseLine: OCRLine = {
    text: 'HELLO',
    confidence: 100,
    bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
    words: [],
  };

  const makePageConfig = (overrides: Partial<PdfPrintExportPageConfig> = {}): PdfPrintExportPageConfig => ({
    pageNum: 1,
    sourceOCR: { pageNumber: 1, width: 100, height: 100, dpi: 300, language: 'en', algorithmVersion: 1, lines: [baseLine], words: [], text: 'HELLO', confidence: 1 },
    translatedByIndex: [],
    pageLayers: [],
    deletedLineIndexes: [],
    overlayLayoutProfile: 'official',
    overlayFontFamily: 'Arial',
    overlayFontSizeScale: 1,
    targetLanguage: 'th',
    ...overrides,
  });

  test('returns translatedByIndex value when no visible layer exists', () => {
    const pageConfig = makePageConfig({ translatedByIndex: [{ index: 0, text: 'สวัสดี' }] });
    const resolved = resolveExportLineText(baseLine, 0, pageConfig, new Map([[0, 'สวัสดี']]));
    expect(resolved).toBe('สวัสดี');
  });

  test('prefers visible user-edited layer text over translatedByIndex', () => {
    const pageConfig = makePageConfig({
      pageLayers: [
        {
          id: 'layer-1',
          lineIndex: 0,
          groupId: 'group-1',
          text: 'HELLO WORLD',
          sourceText: 'HELLO',
          bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
          originalBBox: { x0: 0, y0: 0, x1: 100, y1: 20 },
          fontSize: 12,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          zIndex: 1,
          userEdited: true,
          confidence: 100,
        },
      ],
      translatedByIndex: [{ index: 0, text: 'สวัสดี' }],
    });

    const resolved = resolveExportLineText(baseLine, 0, pageConfig, new Map([[0, 'สวัสดี']]));
    expect(resolved).toBe('HELLO WORLD');
  });

  test('returns translatedByIndex when visible layer text matches source and userEdited is false', () => {
    const pageConfig = makePageConfig({
      pageLayers: [
        {
          id: 'layer-1',
          lineIndex: 0,
          groupId: 'group-1',
          text: 'HELLO',
          sourceText: 'HELLO',
          bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
          originalBBox: { x0: 0, y0: 0, x1: 100, y1: 20 },
          fontSize: 12,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          zIndex: 1,
          userEdited: false,
          confidence: 100,
        },
      ],
      translatedByIndex: [{ index: 0, text: 'สวัสดี' }],
    });

    const resolved = resolveExportLineText(baseLine, 0, pageConfig, new Map([[0, 'สวัสดี']]));
    expect(resolved).toBe('สวัสดี');
  });

  test('falls back to visible layer text when translated text is missing but layer has a valid override', () => {
    const pageConfig = makePageConfig({
      pageLayers: [
        {
          id: 'layer-1',
          lineIndex: 0,
          groupId: 'group-1',
          text: 'HELLO WORLD',
          sourceText: 'HELLO',
          bbox: { x0: 0, y0: 0, x1: 100, y1: 20 },
          originalBBox: { x0: 0, y0: 0, x1: 100, y1: 20 },
          fontSize: 12,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          zIndex: 1,
          userEdited: false,
          confidence: 100,
        },
      ],
    });

    const resolved = resolveExportLineText(baseLine, 0, pageConfig, new Map());
    expect(resolved).toBe('HELLO WORLD');
  });
});
