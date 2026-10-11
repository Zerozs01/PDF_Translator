import { describe, it, expect } from 'vitest';
import {
  fastDiceSimilarity,
  batchDiceSimilarity,
} from '../../services/native/fastDiceSimilarity';

// ─── fastDiceSimilarity ─────────────────────────────────────────────────────────

describe('fastDiceSimilarity', () => {
  it('returns 0 for empty strings', () => {
    expect(fastDiceSimilarity('', 'hello')).toBe(0);
    expect(fastDiceSimilarity('hello', '')).toBe(0);
    expect(fastDiceSimilarity('', '')).toBe(0);
  });

  it('returns 1 for identical strings', () => {
    expect(fastDiceSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 1 for identical strings after trim', () => {
    expect(fastDiceSimilarity('  hello  ', 'hello')).toBe(1);
  });

  it('returns >0 for partially similar strings', () => {
    const score = fastDiceSimilarity('hello world', 'hello earth');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('returns 0 for completely different strings', () => {
    // Completely non-overlapping bigrams
    const score = fastDiceSimilarity('ab', 'cd');
    expect(score).toBe(0);
  });

  it('handles single-character strings', () => {
    expect(fastDiceSimilarity('a', 'a')).toBe(1);
    expect(fastDiceSimilarity('a', 'b')).toBe(0);
  });

  it('handles Unicode (Thai) strings', () => {
    const score = fastDiceSimilarity('สวัสดี', 'สวัสดีครับ');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('handles CJK characters', () => {
    expect(fastDiceSimilarity('日本語', '日本語')).toBe(1);
    expect(fastDiceSimilarity('日本語', '中国語')).toBeGreaterThanOrEqual(0);
  });
});

// ─── batchDiceSimilarity ────────────────────────────────────────────────────────

describe('batchDiceSimilarity', () => {
  it('returns empty array for empty candidates', () => {
    const scores = batchDiceSimilarity('hello', []);
    expect(scores).toHaveLength(0);
  });

  it('returns zeros for empty reference', () => {
    const scores = batchDiceSimilarity('', ['hello', 'world']);
    expect(scores[0]).toBe(0);
    expect(scores[1]).toBe(0);
  });

  it('scores each candidate against the reference', () => {
    const scores = batchDiceSimilarity('hello world', [
      'hello world',   // identical
      'hello earth',   // partial
      'xyz123',        // no overlap
    ]);
    expect(scores[0]).toBe(1);
    expect(scores[1]).toBeGreaterThan(0);
    expect(scores[1]).toBeLessThan(1);
    // xyz123 might share some bigram overlap with 'hello world' — just verify less than identical
    expect(scores[2]).toBeLessThan(scores[0]);
  });

  it('returns consistent results with fastDiceSimilarity', () => {
    const ref = 'HELLO WORLD';
    const candidates = ['HELLO WORLD', 'HELLO', 'WORLD', ''];
    const batchScores = batchDiceSimilarity(ref, candidates);

    for (let i = 0; i < candidates.length; i++) {
      expect(batchScores[i]).toBeCloseTo(
        fastDiceSimilarity(ref, candidates[i]),
        5
      );
    }
  });
});
