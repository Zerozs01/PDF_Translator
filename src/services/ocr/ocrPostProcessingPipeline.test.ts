import { describe, it, expect } from 'vitest';
import {
  processOCRPageResult,
  getDroppedLineReasonDistribution,
  type OCRPostProcessingOptions,
} from './ocrPostProcessingPipeline';
import type { OCRPageResult, OCRLine } from '../../types';
import { OCR_ALGORITHM_VERSION } from '../vision/ocrVersion';

const createPageResult = (overrides: Partial<OCRPageResult>): OCRPageResult => ({
  pageNumber: 1,
  width: 1000,
  height: 1500,
  dpi: 300,
  language: 'eng',
  algorithmVersion: OCR_ALGORITHM_VERSION,
  lines: [],
  words: [],
  text: '',
  confidence: 90,
  ...overrides,
});

describe('ocrPostProcessingPipeline', () => {
  const defaultOptions: OCRPostProcessingOptions = {
    engine: 'paddleocr',
    dpi: 300,
    storeLanguage: 'eng',
  };

  it('sets _splitDone flag and filters out phantom ghost noise', () => {
    const rawLines: OCRLine[] = [
      { text: 'AAAANLWAL', bbox: { x0: 10, y0: 10, x1: 50, y1: 30 }, confidence: 90, words: [] },
      { text: '|||///', bbox: { x0: 10, y0: 40, x1: 30, y1: 80 }, confidence: 85, words: [] },
      { text: 'Hello, this is actual dialogue.', bbox: { x0: 100, y0: 100, x1: 400, y1: 140 }, confidence: 95, words: [] },
    ];

    const input = createPageResult({ lines: rawLines });
    const result = processOCRPageResult(input, defaultOptions);

    expect(result._splitDone).toBe(true);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].text).toBe('Hello, this is actual dialogue.');
  });

  it('retains dense technical rows, captions, and formulas without false drops', () => {
    const technicalLines: OCRLine[] = [
      { text: 'Fig. 1: Temperature vs Time', bbox: { x0: 100, y0: 50, x1: 500, y1: 80 }, confidence: 94, words: [] },
      { text: 'Table 4.2: Summary of Parameters (N = 100)', bbox: { x0: 100, y0: 120, x1: 650, y1: 150 }, confidence: 92, words: [] },
      { text: 'x = (a^2 + b^2) / 2', bbox: { x0: 200, y0: 200, x1: 450, y1: 230 }, confidence: 88, words: [] },
      { text: 'p-value < 0.001 (significant)', bbox: { x0: 100, y0: 260, x1: 420, y1: 290 }, confidence: 90, words: [] },
      { text: 'R^2 = 0.985', bbox: { x0: 100, y0: 310, x1: 250, y1: 340 }, confidence: 89, words: [] },
    ];

    const input = createPageResult({ lines: technicalLines });
    const result = processOCRPageResult(input, defaultOptions);

    expect(result.lines).toHaveLength(5);
    expect(result.lines.map((l) => l.text)).toEqual([
      'Fig. 1: Temperature vs Time',
      'Table 4.2: Summary of Parameters (N = 100)',
      'x = (a^2 + b^2) / 2',
      'p-value < 0.001 (significant)',
      'R^2 = 0.985',
    ]);
  });

  it('skips line splitting if _splitDone is already set to true', () => {
    const lines: OCRLine[] = [
      { text: 'Line 1 that was already split', bbox: { x0: 10, y0: 10, x1: 200, y1: 40 }, confidence: 95, words: [] },
    ];

    const input = createPageResult({ lines, _splitDone: true });
    const result = processOCRPageResult(input, defaultOptions);

    expect(result._splitDone).toBe(true);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].text).toBe('Line 1 that was already split');
  });

  it('triggers Korean Manhwa pipeline when language is kor', () => {
    const koreanLines: OCRLine[] = [
      { text: '안녕', bbox: { x0: 100, y0: 100, x1: 200, y1: 140 }, confidence: 95, words: [] },
      { text: '하세요', bbox: { x0: 100, y0: 150, x1: 200, y1: 190 }, confidence: 95, words: [] },
    ];

    const input = createPageResult({ language: 'kor', lines: koreanLines });
    const result = processOCRPageResult(input, { ...defaultOptions, storeLanguage: 'kor' });

    expect(result._splitDone).toBe(true);
    // Korean manhwa pipeline should process Korean lines and preserve content
    expect(result.lines.length).toBeGreaterThan(0);
    const combinedText = result.lines.map((l) => l.text).join(' ');
    expect(combinedText).toContain('안녕');
  });

  it('handles multi-engine options gracefully and consistently', () => {
    const testLine: OCRLine = {
      text: 'Standard dialogue line',
      bbox: { x0: 100, y0: 100, x1: 300, y1: 130 },
      confidence: 90,
      words: [],
    };

    const input = createPageResult({ lines: [testLine] });

    const paddleResult = processOCRPageResult(input, { ...defaultOptions, engine: 'paddleocr' });
    const easyResult = processOCRPageResult(input, { ...defaultOptions, engine: 'easyocr' });

    expect(paddleResult.lines[0].text).toBe('Standard dialogue line');
    expect(easyResult.lines[0].text).toBe('Standard dialogue line');
  });

  it('aggregates dropped line reason distribution in debug diagnostics', () => {
    const rawLines: OCRLine[] = [
      { text: 'AAAANLWAL', bbox: { x0: 10, y0: 10, x1: 50, y1: 30 }, confidence: 90, words: [] },
      { text: 'lll|||', bbox: { x0: 10, y0: 40, x1: 30, y1: 80 }, confidence: 85, words: [] },
      { text: 'Valid Technical Heading', bbox: { x0: 100, y0: 100, x1: 500, y1: 140 }, confidence: 95, words: [] },
    ];

    const input = createPageResult({ lines: rawLines });
    const result = processOCRPageResult(input, defaultOptions);

    const distribution = getDroppedLineReasonDistribution(result);
    expect(distribution.ghostGarbageHallucinationDrop).toBe(1);
    expect(distribution.ghostVerticalLineJunkDrop).toBe(1);
    expect(result.debug?.droppedWords).toHaveLength(2);
  });
});
