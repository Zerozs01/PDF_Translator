import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  processOCRPageResult,
  getDroppedLineReasonDistribution,
  type OCRPostProcessingOptions,
} from './ocrPostProcessingPipeline';
import type { OCRPageResult, OCRLine, BBox } from '../../types';
import { OCR_ALGORITHM_VERSION } from '../vision/ocrVersion';

interface ManifestCase {
  id: string;
  page: number;
  image: string;
  language: string;
  dpi: number;
}

interface ManifestExpectation {
  page: number;
  minLines: number;
  minMeaningfulWords: number;
  mustContainAny: string[][];
  mustNotContainNormalized: string[];
  maxStandaloneShortTokens: number;
  maxSuspiciousRatio: number;
}

interface ManifestData {
  cases: ManifestCase[];
  expectations: ManifestExpectation[];
}

const createMockLine = (text: string, bbox: BBox, confidence: number = 95): OCRLine => {
  const tokens = text.split(/\s+/).filter(Boolean);
  const totalWidth = Math.max(10, bbox.x1 - bbox.x0);
  const tokenWidth = totalWidth / Math.max(1, tokens.length);

  return {
    text,
    bbox,
    confidence,
    words: tokens.map((t, idx) => ({
      text: t,
      confidence,
      bbox: {
        x0: bbox.x0 + idx * tokenWidth,
        y0: bbox.y0,
        x1: bbox.x0 + (idx + 1) * tokenWidth,
        y1: bbox.y1,
      },
    })),
  };
};

const createMockPageResult = (overrides: Partial<OCRPageResult>): OCRPageResult => ({
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

describe('OCR Fixture Manifest & Stable Engine Output Expectations', () => {
  const repoRoot = process.cwd();
  const manifestPath = path.resolve(repoRoot, 'public/fixtures/ocr/manga/expectations.json');

  it('verifies manifest covers both tall comic balloons and dense technical tables/labels', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);

    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as ManifestData;

    expect(manifest.cases.length).toBe(6);
    expect(manifest.expectations.length).toBe(6);

    const caseIds = manifest.cases.map((c) => c.id);
    // Tall comic sparse balloons
    expect(caseIds).toContain('manga-1');
    expect(caseIds).toContain('manga-2');
    expect(caseIds).toContain('manga-3');
    // Dense technical tables/labels
    expect(caseIds).toContain('doc-tech-1');
    expect(caseIds).toContain('doc-tech-2');
    expect(caseIds).toContain('doc-tech-3');

    // Verify all referenced fixture images exist on disk and have real content
    for (const c of manifest.cases) {
      const assetPath = path.resolve(repoRoot, 'public', c.image.replace(/^\/+/, ''));
      expect(fs.existsSync(assetPath)).toBe(true);
      const stat = fs.statSync(assetPath);
      expect(stat.size).toBeGreaterThan(50_000); // Must be a real high-res test image
    }

    // Verify expectations are properly defined for every single case page
    for (const c of manifest.cases) {
      const exp = manifest.expectations.find((e) => e.page === c.page);
      expect(exp).toBeDefined();
      expect(exp!.minLines).toBeGreaterThan(0);
      expect(exp!.minMeaningfulWords).toBeGreaterThan(0);
      expect(exp!.mustContainAny.length).toBeGreaterThan(0);
      expect(exp!.maxSuspiciousRatio).toBeLessThanOrEqual(0.15);
    }
  });

  describe('PaddleOCR Stable Output Checks', () => {
    const defaultOptions: OCRPostProcessingOptions = {
      engine: 'paddleocr',
      dpi: 300,
      storeLanguage: 'eng',
    };

    it('retains dense technical table rows, connection descriptions, and captions without false drops', () => {
      // Realistic lines extracted by PaddleOCR from document1.png (TABLE 5-1)
      const doc1PaddleLines: OCRLine[] = [
        createMockLine('5.2 FREE-BODY DIAGRAMS', { x0: 650, y0: 10, x1: 850, y1: 30 }, 98),
        createMockLine('203', { x0: 900, y0: 10, x1: 930, y1: 30 }, 99),
        createMockLine('TABLE 5-1 Continued', { x0: 100, y0: 60, x1: 300, y1: 85 }, 96),
        createMockLine('Types of Connection', { x0: 100, y0: 100, x1: 250, y1: 120 }, 95),
        createMockLine('Reaction', { x0: 350, y0: 100, x1: 420, y1: 120 }, 96),
        createMockLine('Number of Unknowns', { x0: 600, y0: 100, x1: 750, y1: 120 }, 97),
        createMockLine('(8)', { x0: 100, y0: 140, x1: 120, y1: 160 }, 95),
        createMockLine('smooth pin or hinge', { x0: 100, y0: 220, x1: 230, y1: 240 }, 95),
        createMockLine(
          'Two unknowns. The reactions are two components of force, or the magnitude and direction of the resultant force.',
          { x0: 520, y0: 150, x1: 920, y1: 190 },
          96
        ),
        createMockLine('fixed support', { x0: 100, y0: 480, x1: 180, y1: 500 }, 95),
        createMockLine(
          'This concrete girder rests on the ledge that is assumed to act as a smooth contacting surface. (5)',
          { x0: 580, y0: 580, x1: 720, y1: 650 },
          94
        ),
      ];

      const input = createMockPageResult({ lines: doc1PaddleLines });
      const result = processOCRPageResult(input, defaultOptions);

      expect(result._splitDone).toBe(true);
      expect(result.lines.length).toBe(doc1PaddleLines.length);

      const texts = result.lines.map((l) => l.text);
      expect(texts).toContain('TABLE 5-1 Continued');
      expect(texts).toContain('smooth pin or hinge');
      expect(texts).toContain('fixed support');
      expect(texts).toContain('(8)');

      const dropStats = getDroppedLineReasonDistribution(result);
      expect(dropStats.ghostGarbageHallucinationDrop || 0).toBe(0);
      expect(dropStats.ghostVerticalLineJunkDrop || 0).toBe(0);
    });

    it('retains mathematical equations and structured analysis procedures from document3.png', () => {
      const doc3PaddleLines: OCRLine[] = [
        createMockLine('5.3 EQUATIONS OF EQUILIBRIUM', { x0: 620, y0: 15, x1: 840, y1: 35 }, 97),
        createMockLine('A second alternative set of equilibrium equations is', { x0: 100, y0: 60, x1: 500, y1: 85 }, 96),
        createMockLine('(5-4)', { x0: 600, y0: 120, x1: 640, y1: 140 }, 98),
        createMockLine('Procedure for Analysis', { x0: 120, y0: 330, x1: 350, y1: 360 }, 97),
        createMockLine('Coplanar force equilibrium problems for a rigid body can be solved using the following procedure.', { x0: 100, y0: 380, x1: 620, y1: 410 }, 95),
        createMockLine('Free-Body Diagram.', { x0: 100, y0: 440, x1: 250, y1: 460 }, 96),
        createMockLine('Equations of Equilibrium.', { x0: 100, y0: 680, x1: 280, y1: 700 }, 96),
      ];

      const input = createMockPageResult({ lines: doc3PaddleLines });
      const result = processOCRPageResult(input, defaultOptions);

      expect(result.lines.length).toBe(doc3PaddleLines.length);
      const texts = result.lines.map((l) => l.text);
      expect(texts).toContain('(5-4)');
      expect(texts).toContain('Procedure for Analysis');
      expect(texts).toContain('Free-Body Diagram.');
    });

    it('preserves comic sparse speech balloons and character name tags from manga1.png', () => {
      const manga1PaddleLines: OCRLine[] = [
        createMockLine('YOU AS A', { x0: 740, y0: 90, x1: 820, y1: 110 }, 96),
        createMockLine('LATECOMER...', { x0: 730, y0: 115, x1: 840, y1: 135 }, 97),
        createMockLine('ARE IN THE SAME BOAT AS US.', { x0: 130, y0: 90, x1: 260, y1: 130 }, 95),
        createMockLine('Player Name:', { x0: 760, y0: 215, x1: 870, y1: 230 }, 94),
        createMockLine('Yuki', { x0: 780, y0: 235, x1: 840, y1: 260 }, 96),
        createMockLine('Player Name:', { x0: 120, y0: 215, x1: 230, y1: 230 }, 94),
        createMockLine('Azuma', { x0: 140, y0: 235, x1: 210, y1: 260 }, 96),
      ];

      const input = createMockPageResult({ lines: manga1PaddleLines });
      const result = processOCRPageResult(input, defaultOptions);

      expect(result.lines.length).toBe(manga1PaddleLines.length);
      const texts = result.lines.map((l) => l.text);
      expect(texts).toContain('Yuki');
      expect(texts).toContain('Azuma');
      expect(texts).toContain('ARE IN THE SAME BOAT AS US.');
    });
  });

  describe('EasyOCR Stable Output Checks', () => {
    const easyOptions: OCRPostProcessingOptions = {
      engine: 'easyocr',
      dpi: 300,
      storeLanguage: 'eng',
    };

    it('correctly handles all-caps comic shouting lines and trailing noise characters', () => {
      // Lines extracted by EasyOCR from manga3.png & manga2.png
      const easyMangaLines: OCRLine[] = [
        createMockLine('DELIVERY', { x0: 770, y0: 230, x1: 850, y1: 250 }, 88),
        createMockLine('EATERS!', { x0: 770, y0: 255, x1: 840, y1: 275 }, 89),
        createMockLine("SHE'S GLARING FOR SOME REASON!", { x0: 130, y0: 180, x1: 300, y1: 240 }, 85),
        createMockLine('THIS GAME IS DIVIDED INTO 3 MAIN AREAS', { x0: 750, y0: 60, x1: 900, y1: 110 }, 90),
        createMockLine('THE INDOOR BATH.', { x0: 340, y0: 80, x1: 460, y1: 110 }, 92),
      ];

      const input = createMockPageResult({ lines: easyMangaLines });
      const result = processOCRPageResult(input, easyOptions);

      expect(result.lines.length).toBe(easyMangaLines.length);
      const texts = result.lines.map((l) => l.text);
      expect(texts).toContain("SHE'S GLARING FOR SOME REASON!");
      expect(texts).toContain('THE INDOOR BATH.');
      expect(texts).toContain('THIS GAME IS DIVIDED INTO 3 MAIN AREAS');
    });

    it('preserves key technical document headings while filtering low-confidence isolated diagram junk', () => {
      // EasyOCR detections on document2: high-confidence text vs sub-65% diagram annotations
      const easyDoc2Lines: OCRLine[] = [
        createMockLine('Equilibrium of a Rigid Body', { x0: 120, y0: 70, x1: 650, y1: 180 }, 91),
        createMockLine('CHAPTER OBJECTIVES', { x0: 120, y0: 250, x1: 420, y1: 280 }, 88),
        createMockLine('5.1 Conditions for Rigid-Body Equilibrium', { x0: 120, y0: 540, x1: 750, y1: 580 }, 87),
        createMockLine('Fig. 5-1', { x0: 430, y0: 960, x1: 500, y1: 980 }, 88),
        // Isolated low-confidence sub-65% vector annotations
        createMockLine('F1', { x0: 560, y0: 750, x1: 580, y1: 770 }, 64),
        createMockLine('F2', { x0: 550, y0: 900, x1: 570, y1: 920 }, 62),
        createMockLine('M1', { x0: 340, y0: 925, x1: 370, y1: 945 }, 61),
      ];

      const input = createMockPageResult({ lines: easyDoc2Lines });
      const result = processOCRPageResult(input, easyOptions);

      // All key headings and captions must be preserved
      const texts = result.lines.map((l) => l.text);
      expect(texts).toContain('Equilibrium of a Rigid Body');
      expect(texts).toContain('CHAPTER OBJECTIVES');
      expect(texts).toContain('5.1 Conditions for Rigid-Body Equilibrium');
      expect(texts).toContain('Fig. 5-1');

      // Low-confidence tiny diagram boxes are cleanly filtered into ghostTinyJunkBoxDrop
      const dropDistribution = getDroppedLineReasonDistribution(result);
      expect(dropDistribution.ghostTinyJunkBoxDrop).toBe(3);
    });
  });

  describe('Engine Invariant & Drop Gate Assertions', () => {
    it('ensures both engines reject true hallucination noise while keeping valid single-token equations', () => {
      const mixedLines: OCRLine[] = [
        createMockLine('AAAANLWAL', { x0: 10, y0: 10, x1: 60, y1: 30 }, 80), // Hallucination junk
        createMockLine('|||///', { x0: 10, y0: 40, x1: 30, y1: 80 }, 85), // Pure symbol noise
        createMockLine('lll|||', { x0: 10, y0: 90, x1: 30, y1: 120 }, 85), // Vertical line noise
        createMockLine('MA = 0', { x0: 350, y0: 100, x1: 420, y1: 125 }, 91), // Real math equation
        createMockLine('I see...', { x0: 500, y0: 600, x1: 580, y1: 630 }, 93), // Short comic speech
      ];

      for (const engine of ['paddleocr', 'easyocr'] as const) {
        const input = createMockPageResult({ lines: mixedLines });
        const result = processOCRPageResult(input, { engine, dpi: 300, storeLanguage: 'eng' });

        expect(result.lines.length).toBe(2);
        const keptTexts = result.lines.map((l) => l.text);
        expect(keptTexts).toContain('MA = 0');
        expect(keptTexts).toContain('I see...');

        const drops = getDroppedLineReasonDistribution(result);
        expect(drops.ghostGarbageHallucinationDrop).toBe(1);
        expect(drops.ghostPureSymbolNoiseDrop).toBe(1);
        expect(drops.ghostVerticalLineJunkDrop).toBe(1);
      }
    });
  });
});
