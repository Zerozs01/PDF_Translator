import { describe, expect, test } from 'vitest';
import { deriveBalloonAwareLayoutGrouping } from './balloonAwareGroupingService';
import {
  angledDialogueFixture,
  separatedColumnsFixture,
  shiftedMiddleLineBalloonFixture,
  singletonHeavyFixture,
  stackedBalloonFixture,
} from './balloonAwareGroupingService.fixtures';

describe('deriveBalloonAwareLayoutGrouping', () => {
  test('groups vertically stacked dialogue lines inside the same balloon', () => {
    const result = deriveBalloonAwareLayoutGrouping(stackedBalloonFixture());

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.orderedLineIndexes).toEqual([0, 1, 2]);
    expect(result.groups[1]?.orderedLineIndexes).toEqual([3, 4, 5]);
    expect(result.orderedLineIndexes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.diagnostics.avgConfidence).toBeGreaterThan(0.62);
  });

  test('keeps distant same-row balloons separated instead of merging by row-major order', () => {
    const result = deriveBalloonAwareLayoutGrouping(separatedColumnsFixture());

    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((group) => group.orderedLineIndexes)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect(result.orderedLineIndexes).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test('returns low confidence and no groups for singleton-heavy pages', () => {
    const result = deriveBalloonAwareLayoutGrouping(singletonHeavyFixture());

    expect(result.groups).toHaveLength(0);
    expect(result.ungroupedLineIndexes).toEqual([0, 2, 3, 1, 4]);
    expect(result.diagnostics.avgConfidence).toBeLessThan(0.62);
    expect(result.diagnostics.warnings).toContain('no_multi_line_groups');
  });

  test('groups angled dialogue lines using quad metadata and preserves reading order', () => {
    const result = deriveBalloonAwareLayoutGrouping(angledDialogueFixture());

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.orderedLineIndexes).toEqual([0, 1, 2]);
    expect(result.orderedLineIndexes).toEqual([0, 1, 2]);
    expect(result.diagnostics.avgConfidence).toBeGreaterThan(0.62);
  });

  test('keeps shifted middle lines in the same compact balloon stack', () => {
    const result = deriveBalloonAwareLayoutGrouping(shiftedMiddleLineBalloonFixture());

    expect(result.groups.map((group) => group.orderedLineIndexes)).toEqual([
      [0, 1],
      [2, 3],
    ]);
    expect(result.orderedLineIndexes).toEqual([0, 1, 2, 3]);
    expect(result.diagnostics.avgConfidence).toBeGreaterThan(0.62);
  });
});
