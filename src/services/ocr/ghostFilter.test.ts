import { describe, it, expect } from 'vitest';
import { filterGhostOcrData } from './ghostFilter';
import { OCRLine, OCRWord } from '../../types';

describe('filterGhostOcrData', () => {
  it('drops garbage noise signatures like AAAANLWAL', () => {
    const lines: OCRLine[] = [
      { text: 'AAAANLWAL', bbox: { x0: 10, y0: 10, x1: 50, y1: 30 }, confidence: 90, words: [] },
      { text: 'Hello world', bbox: { x0: 10, y0: 40, x1: 150, y1: 60 }, confidence: 95, words: [] },
    ];
    const { lines: cleanLines } = filterGhostOcrData(lines, [], 'paddleocr');
    expect(cleanLines).toHaveLength(1);
    expect(cleanLines[0].text).toBe('Hello world');
  });

  it('drops repetitive vertical line noise from spiky balloon borders', () => {
    const lines: OCRLine[] = [
      { text: '|||///', bbox: { x0: 10, y0: 10, x1: 30, y1: 50 }, confidence: 80, words: [] },
      { text: 'I AM FINE', bbox: { x0: 10, y0: 60, x1: 100, y1: 80 }, confidence: 92, words: [] },
    ];
    const { lines: cleanLines } = filterGhostOcrData(lines, [], 'paddleocr');
    expect(cleanLines).toHaveLength(1);
    expect(cleanLines[0].text).toBe('I AM FINE');
  });

  it('preserves Korean and Thai text even when short', () => {
    const lines: OCRLine[] = [
      { text: '안녕', bbox: { x0: 10, y0: 10, x1: 50, y1: 30 }, confidence: 90, words: [] },
      { text: 'สวัสดี', bbox: { x0: 10, y0: 40, x1: 80, y1: 60 }, confidence: 90, words: [] },
    ];
    const { lines: cleanLines } = filterGhostOcrData(lines, [], 'paddleocr');
    expect(cleanLines).toHaveLength(2);
  });

  it('synchronizes remaining words with filtered lines based on bbox', () => {
    const word1: OCRWord = { text: 'Trash', bbox: { x0: 10, y0: 10, x1: 20, y1: 20 }, confidence: 50 };
    const word2: OCRWord = { text: 'Good', bbox: { x0: 30, y0: 30, x1: 60, y1: 50 }, confidence: 95 };
    const lines: OCRLine[] = [
      {
        text: 'AAAANLWAL',
        bbox: { x0: 10, y0: 10, x1: 20, y1: 20 },
        confidence: 50,
        words: [word1],
      },
      {
        text: 'Good',
        bbox: { x0: 30, y0: 30, x1: 60, y1: 50 },
        confidence: 95,
        words: [word2],
      },
    ];
    const { lines: cleanLines, words: cleanWords } = filterGhostOcrData(lines, [word1, word2], 'paddleocr');
    expect(cleanLines).toHaveLength(1);
    expect(cleanWords).toHaveLength(1);
    expect(cleanWords[0].text).toBe('Good');
  });
});
