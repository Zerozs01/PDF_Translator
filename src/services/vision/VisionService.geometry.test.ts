import { describe, expect, test } from 'vitest';
import type { OCRLine, OCRPageResult } from '../../types';
import { visionService } from './VisionService';

const makeLine = (text: string, x0: number, y0: number, x1: number, y1: number): OCRLine => ({
  text,
  confidence: 96,
  bbox: { x0, y0, x1, y1 },
  words: [],
});

const createMalformedPaddlePanelResult = (): OCRPageResult => ({
  pageNumber: 6,
  width: 3337,
  height: 4793,
  dpi: 300,
  language: 'eng',
  pageSegMode: 6,
  algorithmVersion: 1,
  pipelineProfile: 'panel',
  ocrEngine: 'paddleocr',
  ocrQualityProfile: 'best',
  confidence: 96,
  text: '',
  words: [],
  lines: [
    makeLine('THIS GAME', 1038, 138, 1274, 214),
    makeLine('BUT THERE', 342, 2218, 713, 2298),
    makeLine('OPEN A', 2484, 2177, 2820, 2256),
    makeLine('SHOE LOCKER', 2436, 2217, 2916, 2311),
    makeLine('AND LEAVE THE', 2454, 2269, 2954, 2367),
    makeLine('ARE ONLY', 369, 2292, 693, 2385),
    makeLine('BUILDING', 2127, 2355, 2145, 2378),
    makeLine('ENOUGH KEYS', 2551, 2359, 2857, 2438),
    makeLine('WITH SHOES', 2197, 2415, 2242, 2468),
    makeLine('FOR 70% OF', 2514, 2438, 2898, 2516),
    makeLine('TO CLEAR', 2201, 2494, 2238, 2531),
    makeLine('THE PLAYERS.', 2540, 2513, 2868, 2602),
    makeLine('THE GAME.', 317, 2539, 745, 2617),
    makeLine('OUR CHANCE', 1374, 4145, 1717, 4213),
    makeLine('TO JOIN', 1924, 4192, 3071, 4548),
    makeLine('THEM.', 1426, 4280, 1676, 4347),
  ],
});

describe('VisionService paddle geometry guard', () => {
  test('detects severe sliver and oversized sparse panel lines directly', () => {
    const service = visionService as unknown as {
      collectPaddlePanelGeometryAnomalies: (result: OCRPageResult) => OCRLine[];
    };
    const result = createMalformedPaddlePanelResult();

    const anomalyTexts = service
      .collectPaddlePanelGeometryAnomalies(result)
      .map((line) => line.text);

    expect(anomalyTexts).toEqual(expect.arrayContaining([
      'BUILDING',
      'WITH SHOES',
      'TO CLEAR',
      'TO JOIN',
    ]));
    expect(anomalyTexts).not.toContain('ENOUGH KEYS');
    expect(anomalyTexts).not.toContain('OUR CHANCE');
  });

  test('does not broaden fallback replacement to unrelated nearby dialogue lines', () => {
    const service = visionService as unknown as {
      collectPaddlePanelGeometryAnomalies: (result: OCRPageResult) => OCRLine[];
      shouldFallbackMalformedPaddlePanelResult: (result: OCRPageResult, language: string) => boolean;
    };
    const result = createMalformedPaddlePanelResult();
    const anomalyTexts = service.collectPaddlePanelGeometryAnomalies(result).map((line) => line.text);

    expect(service.shouldFallbackMalformedPaddlePanelResult(result, 'eng')).toBe(true);
    expect(anomalyTexts).toEqual(expect.arrayContaining([
      'BUILDING',
      'WITH SHOES',
      'TO CLEAR',
      'TO JOIN',
    ]));
    expect(anomalyTexts).not.toContain('BUT THERE');
    expect(anomalyTexts).not.toContain('ENOUGH KEYS');
    expect(anomalyTexts).not.toContain('OUR CHANCE');
  });

  test('collapses technical residual spatial duplicates that are slightly vertically offset', () => {
    const service = visionService as unknown as {
      collapseResidualSpatialDuplicateExternalLines: (lines: OCRLine[], languageCodes: string[]) => { lines: OCRLine[]; dropped: Array<{ text: string }> };
    };
    const lines = [
      makeLine('in the direction of the cable. (1)', 226, 2356, 816, 2393),
      makeLine('in the direction of the cable. (1)', 222, 2397, 738, 2445),
      makeLine('Three unknowns. The reactions are the couple moment', 820, 2404, 1820, 2448),
    ];

    const result = service.collapseResidualSpatialDuplicateExternalLines(lines, ['eng']);

    expect(result.lines.map((line) => line.text)).toEqual(expect.arrayContaining([
      'in the direction of the cable. (1)',
      'Three unknowns. The reactions are the couple moment',
    ]));
    expect(result.lines.filter((line) => line.text === 'in the direction of the cable. (1)')).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
  });
});
