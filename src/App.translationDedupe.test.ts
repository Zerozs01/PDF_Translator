import { beforeAll, describe, expect, test } from 'vitest';

type TranslatableLine = {
  index: number;
  text: string;
  sourceLength: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
};

let dedupeTranslatableLinesForTranslation: (lines: TranslatableLine[]) => TranslatableLine[];

beforeAll(async () => {
  if (typeof (globalThis as { DOMMatrix?: unknown }).DOMMatrix === 'undefined') {
    class DOMMatrixPolyfill {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      multiplySelf() {
        return this;
      }
      preMultiplySelf() {
        return this;
      }
      translateSelf() {
        return this;
      }
      scaleSelf() {
        return this;
      }
      rotateSelf() {
        return this;
      }
      invertSelf() {
        return this;
      }
      static fromFloat32Array(): DOMMatrixPolyfill {
        return new DOMMatrixPolyfill();
      }
      static fromFloat64Array(): DOMMatrixPolyfill {
        return new DOMMatrixPolyfill();
      }
    }
    (globalThis as { DOMMatrix?: unknown }).DOMMatrix = DOMMatrixPolyfill;
  }

  const appModule = await import('./App');
  dedupeTranslatableLinesForTranslation = appModule.dedupeTranslatableLinesForTranslation;
});

const makeLine = (overrides: Partial<TranslatableLine>): TranslatableLine => ({
  index: 0,
  text: '',
  sourceLength: 0,
  top: 0,
  bottom: 20,
  left: 0,
  right: 200,
  height: 20,
  ...overrides,
});

describe('dedupeTranslatableLinesForTranslation', () => {
  test('keeps distinct technical sections with different unknown counts', () => {
    const twoUnknowns = makeLine({
      index: 11,
      text: 'Two unknowns. The reactions at A and B are unknown and the force which acts perpendicular to the rod.',
      sourceLength: 101,
      top: 180,
      bottom: 204,
      left: 92,
      right: 514,
      height: 24,
    });

    const threeUnknowns = makeLine({
      index: 15,
      text: 'Three unknowns. The reactions at A and B are unknown and the force which acts perpendicular to the rod.',
      sourceLength: 103,
      top: 244,
      bottom: 268,
      left: 96,
      right: 520,
      height: 24,
    });

    const deduped = dedupeTranslatableLinesForTranslation([twoUnknowns, threeUnknowns]);

    expect(deduped).toHaveLength(2);
    expect(deduped.map((line) => line.index).sort((a, b) => a - b)).toEqual([11, 15]);
  });

  test('dedupes overlapping near-identical OCR duplicates in the same region', () => {
    const duplicateA = makeLine({
      index: 31,
      text: 'ARE YOU',
      sourceLength: 7,
      top: 400,
      bottom: 424,
      left: 140,
      right: 248,
      height: 24,
    });

    const duplicateB = makeLine({
      index: 32,
      text: 'ARE YOU',
      sourceLength: 7,
      top: 404,
      bottom: 428,
      left: 142,
      right: 246,
      height: 24,
    });

    const deduped = dedupeTranslatableLinesForTranslation([duplicateA, duplicateB]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].text).toBe('ARE YOU');
  });
});
