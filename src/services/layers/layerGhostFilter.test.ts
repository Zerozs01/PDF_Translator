import { describe, it, expect } from 'vitest';
import { isGhostTextLayer, filterGhostTextLayers } from './layerGhostFilter';
import type { TextLayer } from '../../types/layers';

const createLayer = (overrides: Partial<TextLayer>): TextLayer => ({
  id: 'layer-1',
  lineIndex: 0,
  groupId: 'group-1',
  text: 'Hello World',
  sourceText: 'Hello World',
  bbox: { x0: 100, y0: 100, x1: 200, y1: 150 },
  originalBBox: { x0: 100, y0: 100, x1: 200, y1: 150 },
  fontSize: 16,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 1,
  userEdited: false,
  confidence: 90,
  ...overrides,
});

describe('layerGhostFilter', () => {
  it('preserves layers explicitly edited by the user', () => {
    const layer = createLayer({
      text: '|||',
      sourceText: '|||',
      userEdited: true,
    });
    expect(isGhostTextLayer(layer)).toBe(false);
  });

  it('drops known garbage signatures such as AAAANLWAL', () => {
    const layer = createLayer({
      text: 'AAAANLWAL',
      sourceText: 'AAAANLWAL',
    });
    expect(isGhostTextLayer(layer)).toBe(true);
  });

  it('drops pure symbol noise and spiky balloon border vertical lines', () => {
    const symbolLayer = createLayer({ text: '///---', sourceText: '///---' });
    const verticalLineLayer = createLayer({ text: '|||||', sourceText: '|||||' });
    const lllLayer = createLayer({ text: 'llll', sourceText: 'llll' });

    expect(isGhostTextLayer(symbolLayer)).toBe(true);
    expect(isGhostTextLayer(verticalLineLayer)).toBe(true);
    expect(isGhostTextLayer(lllLayer)).toBe(true);
  });

  it('preserves valid single-character words (I, A, O) and numbers', () => {
    const iLayer = createLayer({ text: 'I', sourceText: 'I' });
    const aLayer = createLayer({ text: 'A', sourceText: 'A' });
    const numLayer = createLayer({ text: '7', sourceText: '7' });

    expect(isGhostTextLayer(iLayer)).toBe(false);
    expect(isGhostTextLayer(aLayer)).toBe(false);
    expect(isGhostTextLayer(numLayer)).toBe(false);
  });

  it('drops single-character letter junk that is not a word', () => {
    const xLayer = createLayer({ text: 'x', sourceText: 'x' });
    const qLayer = createLayer({ text: 'q', sourceText: 'q' });

    expect(isGhostTextLayer(xLayer)).toBe(true);
    expect(isGhostTextLayer(qLayer)).toBe(true);
  });

  it('preserves Thai and CJK text even if short or unusual', () => {
    const thaiLayer = createLayer({ text: 'ใช่', sourceText: 'ใช่' });
    const japaneseLayer = createLayer({ text: 'あ', sourceText: 'あ' });
    const koreanLayer = createLayer({ text: '네', sourceText: '네' });

    expect(isGhostTextLayer(thaiLayer)).toBe(false);
    expect(isGhostTextLayer(japaneseLayer)).toBe(false);
    expect(isGhostTextLayer(koreanLayer)).toBe(false);
  });

  it('drops phantom BELIEVE artifact when overlapping >= 70% with Thai layer', () => {
    const believeLayer = createLayer({
      id: 'ghost-believe',
      text: 'BELIEVE',
      sourceText: 'BELIEVE',
      bbox: { x0: 100, y0: 100, x1: 200, y1: 150 },
    });
    const thaiLayer = createLayer({
      id: 'thai-1',
      text: 'เชื่อมั่น',
      sourceText: 'เชื่อมั่น',
      bbox: { x0: 100, y0: 100, x1: 200, y1: 150 },
    });

    expect(isGhostTextLayer(believeLayer, [thaiLayer])).toBe(true);
  });

  it('filterGhostTextLayers cleans an array of layers properly', () => {
    const layers: TextLayer[] = [
      createLayer({ id: '1', text: 'Good dialogue', sourceText: 'Good dialogue' }),
      createLayer({ id: '2', text: '|||///', sourceText: '|||///' }),
      createLayer({ id: '3', text: 'AAAANLWAL', sourceText: 'AAAANLWAL' }),
      createLayer({ id: '4', text: 'ถูกต้อง', sourceText: 'ถูกต้อง' }),
    ];

    const result = filterGhostTextLayers(layers);
    expect(result).toHaveLength(2);
    expect(result.map((l) => l.id)).toEqual(['1', '4']);
  });
});
