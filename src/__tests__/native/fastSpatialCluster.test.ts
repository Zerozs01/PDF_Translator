import { describe, it, expect } from 'vitest';
import {
  packBBoxes,
  packedIoU,
  packedIoUSingle,
  fastIoU,
  clusterByIoU,
  batchIoUMatrix,
  clusterConnectedComponents,
} from '../../services/native/fastSpatialCluster';
import type { BBox } from '../../types';

// ─── fastIoU ────────────────────────────────────────────────────────────────────

describe('fastIoU', () => {
  it('returns 1 for identical boxes', () => {
    const box: BBox = { x0: 10, y0: 10, x1: 50, y1: 50 };
    expect(fastIoU(box, box)).toBe(1);
  });

  it('returns 0 for non-overlapping boxes', () => {
    const a: BBox = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const b: BBox = { x0: 20, y0: 20, x1: 30, y1: 30 };
    expect(fastIoU(a, b)).toBe(0);
  });

  it('returns correct IoU for partial overlap', () => {
    const a: BBox = { x0: 0, y0: 0, x1: 20, y1: 20 };
    const b: BBox = { x0: 10, y0: 10, x1: 30, y1: 30 };
    // intersection: 10×10 = 100, union: 400+400-100 = 700
    expect(fastIoU(a, b)).toBeCloseTo(100 / 700, 5);
  });

  it('handles zero-area boxes gracefully', () => {
    const a: BBox = { x0: 5, y0: 5, x1: 5, y1: 5 };
    const b: BBox = { x0: 5, y0: 5, x1: 5, y1: 5 };
    expect(fastIoU(a, b)).toBe(0); // zero area → 0 union → 0
  });

  it('handles touching edges (no overlap)', () => {
    const a: BBox = { x0: 0, y0: 0, x1: 10, y1: 10 };
    const b: BBox = { x0: 10, y0: 0, x1: 20, y1: 10 };
    expect(fastIoU(a, b)).toBe(0);
  });
});

// ─── packBBoxes + packedIoU ─────────────────────────────────────────────────────

describe('packedIoU', () => {
  it('matches fastIoU results', () => {
    const boxes: BBox[] = [
      { x0: 0, y0: 0, x1: 20, y1: 20 },
      { x0: 10, y0: 10, x1: 30, y1: 30 },
      { x0: 50, y0: 50, x1: 60, y1: 60 },
    ];
    const buf = packBBoxes(boxes);
    expect(packedIoU(buf, 0, 1)).toBeCloseTo(fastIoU(boxes[0], boxes[1]), 10);
    expect(packedIoU(buf, 0, 2)).toBe(0);
    expect(packedIoU(buf, 1, 2)).toBe(0);
  });
});

describe('packedIoUSingle', () => {
  it('computes IoU against a loose BBox', () => {
    const boxes: BBox[] = [{ x0: 0, y0: 0, x1: 20, y1: 20 }];
    const buf = packBBoxes(boxes);
    const other: BBox = { x0: 10, y0: 10, x1: 30, y1: 30 };
    expect(packedIoUSingle(buf, 0, other)).toBeCloseTo(fastIoU(boxes[0], other), 10);
  });
});

// ─── clusterByIoU ───────────────────────────────────────────────────────────────

describe('clusterByIoU', () => {
  it('returns empty for empty input', () => {
    expect(clusterByIoU([], 0.5)).toEqual([]);
  });

  it('returns single cluster for one box', () => {
    const clusters = clusterByIoU([{ x0: 0, y0: 0, x1: 10, y1: 10 }], 0.5);
    expect(clusters).toEqual([[0]]);
  });

  it('clusters overlapping boxes together', () => {
    const boxes: BBox[] = [
      { x0: 0, y0: 0, x1: 20, y1: 20 },
      { x0: 5, y0: 5, x1: 25, y1: 25 },  // overlaps with [0]
      { x0: 100, y0: 100, x1: 110, y1: 110 }, // no overlap
    ];
    const clusters = clusterByIoU(boxes, 0.1);
    expect(clusters).toHaveLength(2);
    // One cluster should contain indices 0,1 and other should contain 2
    const flatAll = clusters.flat().sort();
    expect(flatAll).toEqual([0, 1, 2]);
  });

  it('keeps non-overlapping boxes in separate clusters', () => {
    const boxes: BBox[] = [
      { x0: 0, y0: 0, x1: 10, y1: 10 },
      { x0: 50, y0: 50, x1: 60, y1: 60 },
      { x0: 100, y0: 100, x1: 110, y1: 110 },
    ];
    const clusters = clusterByIoU(boxes, 0.01);
    expect(clusters).toHaveLength(3);
  });
});

// ─── batchIoUMatrix ─────────────────────────────────────────────────────────────

describe('batchIoUMatrix', () => {
  it('produces symmetric matrix with 1.0 diagonal', () => {
    const boxes: BBox[] = [
      { x0: 0, y0: 0, x1: 20, y1: 20 },
      { x0: 10, y0: 10, x1: 30, y1: 30 },
    ];
    const m = batchIoUMatrix(boxes);
    expect(m[0]).toBe(1); // [0][0]
    expect(m[3]).toBe(1); // [1][1]
    expect(m[1]).toBeCloseTo(m[2], 10); // symmetric
    expect(m[1]).toBeCloseTo(fastIoU(boxes[0], boxes[1]), 10);
  });
});

// ─── clusterConnectedComponents ─────────────────────────────────────────────────

describe('clusterConnectedComponents', () => {
  it('handles empty and singleton inputs', () => {
    expect(clusterConnectedComponents(0, () => false)).toEqual([]);
    expect(clusterConnectedComponents(1, () => false)).toEqual([[0]]);
  });

  it('correctly clusters connected pairs via Union-Find transitive closure', () => {
    // 0 connects to 1, 1 connects to 2 -> {0, 1, 2}
    // 3 is isolated -> {3}
    const isConnected = (i: number, j: number) => {
      if ((i === 0 && j === 1) || (i === 1 && j === 2)) return true;
      return false;
    };
    const clusters = clusterConnectedComponents(4, isConnected);
    expect(clusters).toHaveLength(2);
    const sortedClusters = clusters.map(c => c.sort()).sort((a, b) => a[0] - b[0]);
    expect(sortedClusters).toEqual([[0, 1, 2], [3]]);
  });
});
