import { describe, expect, test } from 'vitest';
import type { OCRLine, OCRPageResult } from '../../types';
import { visionService } from './VisionService';

const makeLine = (text: string, x0: number, y0: number, x1: number, y1: number): OCRLine => ({
  text,
  confidence: 96,
  bbox: { x0, y0, x1, y1 },
  words: [],
});

const makeLineWithWord = (text: string, x0: number, y0: number, x1: number, y1: number): OCRLine => ({
  text,
  confidence: 96,
  bbox: { x0, y0, x1, y1 },
  words: [{
    text,
    confidence: 96,
    bbox: { x0, y0, x1, y1 },
  }],
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

  test('collapses same-box Latin phrase duplicates with noisy OCR variants', () => {
    const service = visionService as unknown as {
      collapseResidualSpatialDuplicateExternalLines: (lines: OCRLine[], languageCodes: string[]) => { lines: OCRLine[]; dropped: Array<{ text: string }> };
    };
    const lines = [
      makeLine('AEs DEal HER', 310, 442, 528, 474),
      makeLine('A BIG DEAL TO HER', 306, 444, 536, 476),
    ];

    const result = service.collapseResidualSpatialDuplicateExternalLines(lines, ['eng']);

    expect(result.lines.map((line) => line.text)).toEqual(['A BIG DEAL TO HER']);
    expect(result.dropped).toEqual([
      expect.objectContaining({ text: 'AEs DEal HER' }),
    ]);
  });

  test('collapses same-box coverage echoes even when OCR text differs', () => {
    const service = visionService as unknown as {
      collapseResidualSpatialDuplicateExternalLines: (lines: OCRLine[], languageCodes: string[]) => { lines: OCRLine[]; dropped: Array<{ text: string }> };
    };
    const lines: OCRLine[] = [
      {
        text: 'rests on the ledge that',
        confidence: 95,
        bbox: { x0: 120, y0: 108, x1: 310, y1: 156 },
        words: [
          { text: 'rests', confidence: 95, bbox: { x0: 126, y0: 112, x1: 170, y1: 136 } },
          { text: 'on', confidence: 95, bbox: { x0: 176, y0: 112, x1: 198, y1: 136 } },
          { text: 'the', confidence: 95, bbox: { x0: 204, y0: 112, x1: 234, y1: 136 } },
          { text: 'ledge', confidence: 95, bbox: { x0: 240, y0: 112, x1: 288, y1: 136 } },
        ],
      },
      {
        text: 'connection types in Table 5-1.',
        confidence: 93,
        bbox: { x0: 104, y0: 96, x1: 498, y1: 174 },
        words: [
          { text: 'connection', confidence: 93, bbox: { x0: 112, y0: 110, x1: 194, y1: 134 } },
        ],
      },
    ];

    const result = service.collapseResidualSpatialDuplicateExternalLines(lines, ['eng']);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].text).toBe('rests on the ledge that');
    expect(result.dropped).toEqual([
      expect.objectContaining({ text: 'connection types in Table 5-1.' }),
    ]);
  });

  test('collapses displaced oversized technical echoes with low coverage mismatch', () => {
    const service = visionService as unknown as {
      collapseResidualSpatialDuplicateExternalLines: (lines: OCRLine[], languageCodes: string[]) => { lines: OCRLine[]; dropped: Array<{ text: string }> };
    };
    const lines: OCRLine[] = [
      {
        text: 'rests on the ledge that',
        confidence: 95,
        bbox: { x0: 124, y0: 116, x1: 318, y1: 156 },
        words: [
          { text: 'rests', confidence: 95, bbox: { x0: 130, y0: 122, x1: 172, y1: 144 } },
          { text: 'on', confidence: 95, bbox: { x0: 176, y0: 122, x1: 196, y1: 144 } },
          { text: 'the', confidence: 95, bbox: { x0: 200, y0: 122, x1: 228, y1: 144 } },
          { text: 'ledge', confidence: 95, bbox: { x0: 232, y0: 122, x1: 280, y1: 144 } },
        ],
      },
      {
        text: 'connection types in Table 5-1.',
        confidence: 92,
        bbox: { x0: 96, y0: 92, x1: 504, y1: 170 },
        words: [
          { text: 'connection', confidence: 92, bbox: { x0: 110, y0: 108, x1: 192, y1: 132 } },
        ],
      },
    ];

    const result = service.collapseResidualSpatialDuplicateExternalLines(lines, ['eng']);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].text).toBe('rests on the ledge that');
    expect(result.dropped).toEqual([
      expect.objectContaining({ text: 'connection types in Table 5-1.' }),
    ]);
  });

  test('collapses stacked same-source technical echoes with near-zero vertical overlap', () => {
    const service = visionService as unknown as {
      collapseResidualSpatialDuplicateExternalLines: (lines: OCRLine[], languageCodes: string[]) => { lines: OCRLine[]; dropped: Array<{ text: string }> };
    };
    const lines: OCRLine[] = [
      {
        text: 'in the direction of the cable. (1)',
        confidence: 89,
        bbox: { x0: 226, y0: 2356, x1: 816, y1: 2393 },
        words: [
          { text: 'direction', confidence: 89, bbox: { x0: 346, y0: 2364, x1: 412, y1: 2386 } },
        ],
      },
      {
        text: 'in the direction of the cable. (1)',
        confidence: 92,
        bbox: { x0: 222, y0: 2397, x1: 738, y1: 2445 },
        words: [
          { text: 'direction', confidence: 92, bbox: { x0: 326, y0: 2408, x1: 392, y1: 2432 } },
          { text: 'cable', confidence: 92, bbox: { x0: 486, y0: 2408, x1: 536, y1: 2432 } },
        ],
      },
    ];

    const result = service.collapseResidualSpatialDuplicateExternalLines(lines, ['eng']);

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].confidence).toBe(92);
    expect(result.dropped).toEqual([
      expect.objectContaining({ text: 'in the direction of the cable. (1)' }),
    ]);
  });

  test('repairs I THINK text from a top-right watermark echo onto the real bubble geometry', () => {
    const service = visionService as unknown as {
      repairPaddlePanelDialogueEchoLines: (
        lines: OCRLine[],
        pageWidth: number,
        pageHeight: number,
        language: string
      ) => { lines: OCRLine[]; dropped: Array<{ text: string; reason: string }> };
    };
    const lines = [
      makeLineWithWord('THINK', 92, 54, 214, 94),
      makeLineWithWord('ITHINK.', 610, 52, 742, 92),
      makeLineWithWord("IT'S BEST IF", 118, 720, 340, 758),
    ];

    const result = service.repairPaddlePanelDialogueEchoLines(lines, 800, 1100, 'eng');

    expect(result.lines.map((line) => line.text)).toEqual([
      'I THINK.',
      "IT'S BEST IF",
    ]);
    expect(result.lines[0].bbox).toEqual({ x0: 92, y0: 54, x1: 214, y1: 94 });
    expect(result.dropped).toEqual([
      expect.objectContaining({ text: 'ITHINK.', reason: 'topWatermarkDialogueEcho' }),
    ]);
  });

  test('keeps short real I and IN tokens during Latin edge cleanup', () => {
    const service = visionService as unknown as {
      pruneLikelyLatinGhostExternalLines: (
        lines: OCRLine[],
        pageHeight: number,
        pipelineProfile: string,
        language: string
      ) => { lines: OCRLine[]; dropped: Array<{ text: string; reason: string }> };
    };
    const lines = [
      { ...makeLine('I', 120, 44, 136, 78), confidence: 90 },
      { ...makeLine('IN', 160, 48, 194, 78), confidence: 90 },
      { ...makeLine('X', 220, 48, 238, 78), confidence: 90 },
      { ...makeLine('THINK', 260, 48, 360, 82), confidence: 90 },
    ];

    const result = service.pruneLikelyLatinGhostExternalLines(lines, 1000, 'panel', 'eng');

    expect(result.lines.map((line) => line.text)).toEqual(['I', 'IN', 'THINK']);
    expect(result.dropped).toEqual([
      expect.objectContaining({ text: 'X', reason: 'latinEdgeSingleton' }),
    ]);
  });

  test('keeps Spanish comic fragments during contextual panel cleanup', () => {
    const service = visionService as unknown as {
      repairPaddlePanelContextualDialogueLines: (
        lines: OCRLine[],
        pageWidth: number,
        pageHeight: number,
        language: string
      ) => { lines: OCRLine[]; dropped: Array<{ text: string; reason: string }> };
    };
    const lines = [
      makeLine('STAFF', 140, 100, 230, 132),
      makeLine('PRI-MERO LA FOTO', 124, 138, 390, 172),
      makeLine('DE', 150, 178, 190, 208),
      makeLine('METIENDO POR', 118, 212, 330, 246),
      makeLine('iLISTO! CON', 112, 252, 300, 286),
    ];

    const result = service.repairPaddlePanelContextualDialogueLines(lines, 900, 1300, 'eng');

    expect(result.lines.map((line) => line.text)).toEqual([
      'STAFF',
      'PRI-MERO LA FOTO',
      'DE',
      'METIENDO POR',
      'iLISTO! CON',
    ]);
    expect(result.dropped).toEqual([]);
  });

  test('drops isolated narrow tall Latin effect lines from Paddle panel output', () => {
    const service = visionService as unknown as {
      prunePaddlePanelTallEffectLines: (
        lines: OCRLine[],
        pageWidth: number,
        pageHeight: number,
        language: string
      ) => { lines: OCRLine[]; dropped: Array<{ text: string; reason: string }> };
    };
    const lines = [
      makeLine('ON THE', 120, 120, 260, 148),
      makeLine('BATTLEFIELD,', 118, 154, 320, 182),
      makeLine('I', 560, 340, 640, 505),
      makeLine('ALL RIGHT,', 122, 190, 300, 218),
    ];

    const result = service.prunePaddlePanelTallEffectLines(lines, 800, 1100, 'eng');

    expect(result.lines.map((line) => line.text)).toEqual([
      'ON THE',
      'BATTLEFIELD,',
      'ALL RIGHT,',
    ]);
    expect(result.dropped).toEqual([
      expect.objectContaining({ text: 'I', reason: 'tallEffectLine' }),
    ]);
  });

  test('drops isolated wide stylized Latin effect lines from Paddle panel output', () => {
    const service = visionService as unknown as {
      prunePaddlePanelTallEffectLines: (
        lines: OCRLine[],
        pageWidth: number,
        pageHeight: number,
        language: string
      ) => { lines: OCRLine[]; dropped: Array<{ text: string; reason: string }> };
    };
    const lines = [
      makeLine('I WILL LET YOU', 120, 110, 390, 145),
      makeLine('EXPERIMENT WITH', 118, 152, 410, 187),
      makeLine('Ooh~', 54, 760, 268, 840),
      makeLine('HER IN RETURN.', 125, 196, 380, 232),
    ];

    const result = service.prunePaddlePanelTallEffectLines(lines, 900, 1300, 'eng');

    expect(result.lines.map((line) => line.text)).toEqual([
      'I WILL LET YOU',
      'EXPERIMENT WITH',
      'HER IN RETURN.',
    ]);
    expect(result.dropped).toEqual([
      expect.objectContaining({ text: 'Ooh~', reason: 'stylizedEffectLine' }),
    ]);
  });

  test('keeps known short dialogue fragments even when they look like stylized effect lines', () => {
    const service = visionService as unknown as {
      prunePaddlePanelTallEffectLines: (
        lines: OCRLine[],
        pageWidth: number,
        pageHeight: number,
        language: string
      ) => { lines: OCRLine[]; dropped: Array<{ text: string; reason: string }> };
    };
    const lines = [
      makeLine('I WILL LET YOU', 120, 110, 390, 145),
      makeLine('EXPERIMENT WITH', 118, 152, 410, 187),
      makeLine('HER IN RETURN.', 125, 196, 380, 232),
      makeLine('AH ME!!', 120, 760, 330, 840),
      makeLine('Ooh~', 520, 760, 730, 840),
    ];

    const result = service.prunePaddlePanelTallEffectLines(lines, 900, 1300, 'eng');

    expect(result.lines.map((line) => line.text)).toContain('AH ME!!');
    expect(result.lines.map((line) => line.text)).not.toContain('Ooh~');
    expect(result.dropped).toEqual([
      expect.objectContaining({ text: 'Ooh~', reason: 'stylizedEffectLine' }),
    ]);
  });

  test('keeps common dialogue words like LIGHT and WAIT even if they match stylized wide effect dimensions', () => {
    const service = visionService as unknown as {
      prunePaddlePanelTallEffectLines: (
        lines: OCRLine[],
        pageWidth: number,
        pageHeight: number,
        language: string
      ) => { lines: OCRLine[]; dropped: Array<{ text: string; reason: string }> };
    };
    const lines = [
      makeLine('I WILL LET YOU', 120, 110, 390, 145),
      makeLine('EXPERIMENT WITH', 118, 152, 410, 187),
      makeLine('LIGHT...!', 54, 760, 268, 840),
      makeLine('WAIT!', 600, 760, 750, 840),
      makeLine('HER IN RETURN.', 125, 196, 380, 232),
    ];

    const result = service.prunePaddlePanelTallEffectLines(lines, 900, 1300, 'eng');

    expect(result.lines.map((line) => line.text)).toContain('LIGHT...!');
    expect(result.lines.map((line) => line.text)).toContain('WAIT!');
    expect(result.dropped).toHaveLength(0);
  });

  test('repairs lost short I and IT tokens around SOLD in profit dialogue', () => {
    const service = visionService as unknown as {
      repairPaddlePanelContextualDialogueLines: (
        lines: OCRLine[],
        pageWidth: number,
        pageHeight: number,
        language: string
      ) => { lines: OCRLine[]; dropped: Array<{ text: string; reason: string }> };
    };
    const lines = [
      makeLine('GETTING 40% OF', 330, 210, 640, 246),
      makeLine('THE PROFITS HAD', 318, 256, 670, 292),
      makeLine('SOLD', 430, 304, 520, 338),
      makeLine("I'LL LET YOU", 360, 410, 610, 446),
    ];

    const result = service.repairPaddlePanelContextualDialogueLines(lines, 900, 1300, 'eng');

    expect(result.lines.map((line) => line.text)).toEqual([
      'GETTING 40% OF',
      'THE PROFITS HAD',
      'I SOLD IT.',
      "I'LL LET YOU",
    ]);
    const repairedSold = result.lines.find((line) => line.text === 'I SOLD IT.');
    expect(repairedSold?.bbox.x0).toBeLessThan(430);
    expect(repairedSold?.bbox.x1).toBeGreaterThan(520);
    expect(repairedSold?.words).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  test('repairs lost leading I when Paddle keeps SOLD IT together', () => {
    const service = visionService as unknown as {
      repairPaddlePanelContextualDialogueLines: (
        lines: OCRLine[],
        pageWidth: number,
        pageHeight: number,
        language: string
      ) => { lines: OCRLine[]; dropped: Array<{ text: string; reason: string }> };
    };
    const lines = [
      makeLine('GETTING 40% OF', 330, 210, 640, 246),
      makeLine('THE PROFITS HAD', 318, 256, 670, 292),
      makeLine('SOLD IT.', 430, 304, 590, 338),
    ];

    const result = service.repairPaddlePanelContextualDialogueLines(lines, 900, 1300, 'eng');

    expect(result.lines.map((line) => line.text)).toEqual([
      'GETTING 40% OF',
      'THE PROFITS HAD',
      'I SOLD IT.',
    ]);
    const repairedSoldIt = result.lines.find((line) => line.text === 'I SOLD IT.');
    expect(repairedSoldIt?.bbox.x0).toBeLessThan(430);
    expect(repairedSoldIt?.bbox.x1).toBeGreaterThanOrEqual(590);
    expect(repairedSoldIt?.words).toEqual([]);
    expect(result.dropped).toEqual([]);
  });

  test('drops RIE ghost line inside monster skills focus dialogue', () => {
    const service = visionService as unknown as {
      repairPaddlePanelContextualDialogueLines: (
        lines: OCRLine[],
        pageWidth: number,
        pageHeight: number,
        language: string
      ) => { lines: OCRLine[]; dropped: Array<{ text: string; reason: string }> };
    };
    const lines = [
      makeLine('THINK ABOUT THE', 120, 120, 420, 154),
      makeLine('SKILLS THE MONSTER', 122, 164, 482, 198),
      makeLine('RIE', 260, 205, 312, 232),
      makeLine('USED EARLIER AND', 124, 244, 460, 278),
      makeLine('FOCUS.', 186, 288, 332, 322),
    ];

    const result = service.repairPaddlePanelContextualDialogueLines(lines, 900, 1300, 'eng');

    expect(result.lines.map((line) => line.text)).toEqual([
      'THINK ABOUT THE',
      'SKILLS THE MONSTER',
      'USED EARLIER AND',
      'FOCUS.',
    ]);
    expect(result.dropped).toEqual([
      expect.objectContaining({ text: 'RIE', reason: 'contextualDialogueGhostLine' }),
    ]);
  });

  test('drops CARNED and WINGSII contextual ghost lines without removing real dialogue', () => {
    const service = visionService as unknown as {
      repairPaddlePanelContextualDialogueLines: (
        lines: OCRLine[],
        pageWidth: number,
        pageHeight: number,
        language: string
      ) => { lines: OCRLine[]; dropped: Array<{ text: string; reason: string }> };
    };
    const lines = [
      makeLine("I DON'T CARE.", 120, 120, 380, 154),
      makeLine('I ALREADY EARNED', 118, 164, 462, 198),
      makeLine('CARNED', 310, 165, 430, 198),
      makeLine('ENOUGH.', 190, 206, 340, 240),
      makeLine('LOOK, BJORN!', 520, 420, 760, 454),
      makeLine('I HAVE WINGS!!', 524, 462, 786, 496),
      makeLine('WINGSII', 610, 506, 730, 540),
      makeLine('THAVE', 560, 464, 690, 496),
    ];

    const result = service.repairPaddlePanelContextualDialogueLines(lines, 900, 1300, 'eng');

    expect(result.lines.map((line) => line.text)).toEqual([
      "I DON'T CARE.",
      'I ALREADY EARNED',
      'ENOUGH.',
      'LOOK, BJORN!',
      'I HAVE WINGS!!',
    ]);
    expect(result.dropped).toEqual([
      expect.objectContaining({ text: 'CARNED', reason: 'contextualDialogueGhostLine' }),
      expect.objectContaining({ text: 'WINGSII', reason: 'contextualDialogueGhostLine' }),
      expect.objectContaining({ text: 'THAVE', reason: 'contextualDialogueGhostLine' }),
    ]);
  });

  test('dropMinorPaddleGeometryAnomalies preserves critical technical lines while dropping malformed slivers', () => {
    const service = visionService as unknown as {
      dropMinorPaddleGeometryAnomalies: (
        externalResult: OCRPageResult,
        anomalies: OCRLine[],
        skipReason: string
      ) => OCRPageResult;
    };

    const technicalEquationLine = makeLine('Resultant force magnitude (1)', 100, 100, 600, 140);
    const sliverAnomalyLine = makeLine('|||', 50, 50, 60, 200);
    const normalDialogueLine = makeLine('HELLO THERE', 200, 300, 400, 340);

    const inputResult: OCRPageResult = {
      pageNumber: 1,
      width: 1000,
      height: 1500,
      dpi: 300,
      language: 'eng',
      algorithmVersion: 1,
      lines: [technicalEquationLine, sliverAnomalyLine, normalDialogueLine],
      words: [],
      text: 'Resultant force magnitude (1)\n|||\nHELLO THERE',
      confidence: 90,
    };

    const anomalies = [technicalEquationLine, sliverAnomalyLine];
    const result = service.dropMinorPaddleGeometryAnomalies(inputResult, anomalies, 'testAnomalyDrop');

    // Technical line must be preserved
    expect(result.lines.map((l) => l.text)).toContain('Resultant force magnitude (1)');
    expect(result.lines.map((l) => l.text)).toContain('HELLO THERE');
    // Sliver anomaly must be dropped
    expect(result.lines.map((l) => l.text)).not.toContain('|||');
    // Drop counts and debug diagnostics must be updated
    expect(result.debug?.dropCounts?.externalPaddleGeometryAnomalyDrop).toBe(1);
    expect(result.debug?.droppedWords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filter: 'externalPaddleFallback',
          reason: 'malformedPanelGeometry',
          text: '|||',
        }),
      ])
    );
  });

  test('dropMinorPaddleGeometryAnomalies returns original result when anomalies array is empty', () => {
    const service = visionService as unknown as {
      dropMinorPaddleGeometryAnomalies: (
        externalResult: OCRPageResult,
        anomalies: OCRLine[],
        skipReason: string
      ) => OCRPageResult;
    };

    const line = makeLine('NORMAL LINE', 100, 100, 300, 140);
    const inputResult: OCRPageResult = {
      pageNumber: 1,
      width: 1000,
      height: 1500,
      dpi: 300,
      language: 'eng',
      algorithmVersion: 1,
      lines: [line],
      words: [],
      text: 'NORMAL LINE',
      confidence: 95,
    };

    const result = service.dropMinorPaddleGeometryAnomalies(inputResult, [], 'none');
    expect(result).toBe(inputResult);
  });
});

