import type { OCRPoint } from '../../types';

export type LayoutGroupingMode = 'default' | 'dense-dialogue' | 'balloon-aware';
export type LayoutReadingMode = 'auto' | 'ltr' | 'rtl' | 'ttb';
export type ResolvedLayoutReadingMode = Exclude<LayoutReadingMode, 'auto'>;
export type LayoutGroupingStrategy = 'geometry' | 'region' | 'hybrid';
export type LayoutGroupType = 'dialogue' | 'narration' | 'unknown';

export type OCRLineWithLayout = {
  index: number;
  text: string;
  sourceLength: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
  area?: number;
  confidence?: number;
  angleDeg?: number;
  sortHintX?: number;
  sortHintY?: number;
  quad?: OCRPoint[];
  sourceEngine?: string;
};

export type DerivedLayoutGroup = {
  id: string;
  page: number;
  lineIndexes: number[];
  orderedLineIndexes: number[];
  intraGroupOrder: number[];
  interGroupOrder: number;
  confidence: number;
  readingMode: ResolvedLayoutReadingMode;
  strategy: LayoutGroupingStrategy;
  groupType: LayoutGroupType;
  bounds: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  anchor: {
    sortX: number;
    sortY: number;
    rawOrder: number;
  };
};

export type LayoutGroupingResult = {
  groups: DerivedLayoutGroup[];
  ungroupedLineIndexes: number[];
  orderedGroupIds: string[];
  orderedLineIndexes: number[];
  diagnostics: {
    strategy: LayoutGroupingStrategy;
    avgConfidence: number;
    warnings: string[];
    resolvedReadingMode: ResolvedLayoutReadingMode;
    rawOrder: number[];
  };
};

export type LayoutGroupingInput = {
  pageNumber: number;
  imageWidth: number;
  imageHeight: number;
  lines: OCRLineWithLayout[];
  mode: LayoutGroupingMode;
  readingMode: LayoutReadingMode;
};

type PreparedLine = OCRLineWithLayout & {
  width: number;
  centerX: number;
  centerY: number;
  normalizedAngle: number;
};

type GroupSeed = {
  lines: PreparedLine[];
  edgeScores: number[];
};

type OrderedLayoutItem =
  | { kind: 'group'; group: DerivedLayoutGroup }
  | {
      kind: 'line';
      lineIndex: number;
      bounds: { top: number; bottom: number; left: number; right: number };
      anchor: { sortX: number; sortY: number; rawOrder: number };
    };

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const computeMedian = (values: number[]): number => {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 0) {
    return (ordered[middle - 1] + ordered[middle]) / 2;
  }
  return ordered[middle];
};

const overlapRatio = (a0: number, a1: number, b0: number, b1: number): number => {
  const overlap = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const base = Math.max(1, Math.min(a1 - a0, b1 - b0));
  return overlap / base;
};

const intervalOverlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

const computeHorizontalGap = (a: PreparedLine, b: PreparedLine): number =>
  Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));

const computeVerticalGap = (a: PreparedLine, b: PreparedLine): number =>
  Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));

const normalizeAngle = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return 0;
  let angle = Number(value) % 180;
  if (angle < -90) angle += 180;
  if (angle > 90) angle -= 180;
  return angle;
};

const angleDelta = (left: number | undefined, right: number | undefined): number =>
  Math.abs(normalizeAngle(left) - normalizeAngle(right));

const resolveReadingMode = (
  requestedMode: LayoutReadingMode,
  lines: PreparedLine[]
): ResolvedLayoutReadingMode => {
  if (requestedMode !== 'auto') return requestedMode;
  if (lines.length === 0) return 'ltr';

  const verticalLikeCount = lines.filter((line) => {
    const width = Math.max(1, line.width);
    const height = Math.max(1, line.height);
    return Math.abs(line.normalizedAngle) >= 55 || (height >= width * 1.65 && line.sourceLength <= 10);
  }).length;

  if (verticalLikeCount >= Math.ceil(lines.length * 0.45)) {
    return 'ttb';
  }

  return 'ltr';
};

const shouldLinkGeometryLines = (
  a: PreparedLine,
  b: PreparedLine,
  baseHeight: number,
  readingMode: ResolvedLayoutReadingMode
): number | null => {
  const overlapX = overlapRatio(a.left, a.right, b.left, b.right);
  const overlapY = overlapRatio(a.top, a.bottom, b.top, b.bottom);
  const horizontalGap = computeHorizontalGap(a, b);
  const verticalGap = computeVerticalGap(a, b);
  const centerDeltaX = Math.abs(a.centerX - b.centerX);
  const centerDeltaY = Math.abs(a.centerY - b.centerY);
  const minWidth = Math.max(1, Math.min(a.width, b.width));
  const maxWidth = Math.max(a.width, b.width);
  const sizeSimilarity = Math.min(a.height, b.height) / Math.max(a.height, b.height, 1);
  const widthSimilarity = Math.min(a.width, b.width) / Math.max(a.width, b.width, 1);
  const localAngleDelta = angleDelta(a.angleDeg, b.angleDeg);

  const sameRowSeparatedColumns = overlapY >= 0.26
    && overlapX <= 0.18
    && horizontalGap >= baseHeight * 0.85
    && centerDeltaX >= baseHeight * 1.8;
  if (sameRowSeparatedColumns) return null;

  const wideDistantColumns = overlapY >= 0.14
    && horizontalGap >= Math.max(96, baseHeight * 2.35)
    && centerDeltaX >= Math.max(120, minWidth * 1.7);
  if (wideDistantColumns) return null;

  const verticallyStacked = overlapX >= 0.18
    && verticalGap <= baseHeight * 2.8
    && centerDeltaX <= Math.max(92, minWidth * 1.05);
  const tightlyStacked = overlapX >= 0.12
    && verticalGap <= baseHeight * 1.6
    && centerDeltaX <= Math.max(72, minWidth * 0.82);
  const diagonalStack = overlapX >= 0.1
    && verticalGap <= baseHeight * 2.2
    && horizontalGap <= Math.max(64, baseHeight * 1.7)
    && centerDeltaX <= Math.max(96, minWidth * 1.35);
  const looseColumnStack = overlapY <= 0.38
    && verticalGap <= baseHeight * 2.65
    && centerDeltaX <= Math.max(128, maxWidth * 0.72, baseHeight * 3.4)
    && (overlapX >= 0.055 || horizontalGap <= Math.max(70, baseHeight * 2.6, minWidth * 0.55))
    && localAngleDelta <= 24;
  const contained = overlapX >= 0.52 && overlapY >= 0.22;
  const hintedSequence = Number.isFinite(a.sortHintY) && Number.isFinite(b.sortHintY)
    && Math.abs(Number(a.sortHintY) - Number(b.sortHintY)) <= Math.max(28, baseHeight * 1.2)
    && centerDeltaX <= Math.max(116, Math.max(a.width, b.width) * 1.45)
    && verticalGap <= baseHeight * 2.4;

  if (!verticallyStacked && !tightlyStacked && !diagonalStack && !looseColumnStack && !contained && !hintedSequence) {
    return null;
  }

  // Do not group lines of completely different scripts (e.g. Thai and English)
  // This ensures English fragments in Thai bubbles get translated separately.
  const aHasThai = /[\u0E00-\u0E7F]/.test(a.text);
  const bHasThai = /[\u0E00-\u0E7F]/.test(b.text);
  const aIsLatinOnly = /[A-Za-z]/.test(a.text) && !/[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(a.text);
  const bIsLatinOnly = /[A-Za-z]/.test(b.text) && !/[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(b.text);
  if ((aHasThai && bIsLatinOnly) || (bHasThai && aIsLatinOnly)) {
    return null;
  }

  let score = 0;
  score += overlapX * 3.6;
  score += overlapY * 2.2;
  score += sizeSimilarity * 1.5;
  score += widthSimilarity * 0.8;
  score -= (horizontalGap / Math.max(1, baseHeight)) * 0.22;
  score -= (verticalGap / Math.max(1, baseHeight)) * 0.28;
  score -= (centerDeltaY / Math.max(1, baseHeight)) * 0.06;

  if (verticallyStacked) score += 1.15;
  if (tightlyStacked) score += 0.85;
  if (diagonalStack) score += 0.95;
  if (looseColumnStack) score += 0.9;
  if (contained) score += 1.1;
  if (hintedSequence) score += 0.65;

  if (localAngleDelta <= 14) {
    score += 0.8;
  } else if (localAngleDelta >= 34) {
    score -= 1.1;
  }

  if (readingMode === 'ttb') {
    if (overlapY >= 0.18) score += 0.35;
    if (centerDeltaX <= Math.max(84, minWidth * 1.2)) score += 0.25;
  }

  return score >= 2.2 ? score : null;
};

const orderGroupLines = (
  lines: PreparedLine[],
  readingMode: ResolvedLayoutReadingMode,
  baseHeight: number
): PreparedLine[] => {
  if (lines.length <= 1) return [...lines];

  if (readingMode === 'ttb') {
    return [...lines].sort((a, b) => {
      const aSortX = Number.isFinite(a.sortHintX) ? Number(a.sortHintX) : a.right;
      const bSortX = Number.isFinite(b.sortHintX) ? Number(b.sortHintX) : b.right;
      if (aSortX !== bSortX) return bSortX - aSortX;
      const aSortY = Number.isFinite(a.sortHintY) ? Number(a.sortHintY) : a.top;
      const bSortY = Number.isFinite(b.sortHintY) ? Number(b.sortHintY) : b.top;
      if (aSortY !== bSortY) return aSortY - bSortY;
      return a.index - b.index;
    });
  }

  return [...lines].sort((a, b) => {
    const aSortY = Number.isFinite(a.sortHintY) ? Number(a.sortHintY) : a.top;
    const bSortY = Number.isFinite(b.sortHintY) ? Number(b.sortHintY) : b.top;
    const sameBand = Math.abs(aSortY - bSortY) <= Math.max(10, baseHeight * 0.45)
      || overlapRatio(a.top, a.bottom, b.top, b.bottom) >= 0.34;
    if (sameBand) {
      const aSortX = Number.isFinite(a.sortHintX) ? Number(a.sortHintX) : a.left;
      const bSortX = Number.isFinite(b.sortHintX) ? Number(b.sortHintX) : b.left;
      if (aSortX !== bSortX) {
        return readingMode === 'rtl' ? bSortX - aSortX : aSortX - bSortX;
      }
    }
    if (aSortY !== bSortY) return aSortY - bSortY;
    if (a.left !== b.left) return readingMode === 'rtl' ? b.left - a.left : a.left - b.left;
    return a.index - b.index;
  });
};

const classifyGroupType = (lines: PreparedLine[]): LayoutGroupType => {
  if (lines.length === 0) return 'unknown';
  const joined = lines.map((line) => line.text).join(' ').trim();
  if (!joined) return 'unknown';
  const avgLength = joined.length / Math.max(1, lines.length);
  const punctuationCount = (joined.match(/[.;:]/g) || []).length;
  const shortBubbleLines = lines.filter((line) => line.text.length <= 42).length;
  if (lines.length >= 2 || (shortBubbleLines >= Math.ceil(lines.length * 0.66) && avgLength <= 44 && punctuationCount <= 1)) {
    return 'dialogue';
  }
  if (avgLength >= 54 || punctuationCount >= 2) {
    return 'narration';
  }
  return 'unknown';
};

const groupConfidenceFromSeed = (
  seed: GroupSeed,
  totalLineCount: number
): number => {
  if (seed.lines.length <= 1) {
    return totalLineCount >= 4 ? 0.42 : 0.56;
  }

  const avgEdgeScore = seed.edgeScores.length > 0
    ? seed.edgeScores.reduce((sum, score) => sum + score, 0) / seed.edgeScores.length
    : 2.2;
  const normalizedEdgeScore = clamp((avgEdgeScore - 2.2) / 2.2, 0, 1);
  const avgConfidence = seed.lines.reduce((sum, line) => sum + Number(line.confidence || 0), 0) / Math.max(1, seed.lines.length);
  const confidenceBonus = clamp(avgConfidence / 100, 0, 1);
  const sizeSpread = computeMedian(seed.lines.map((line) => line.height));
  const compactness = clamp(1 - (Math.abs(sizeSpread - seed.lines[0].height) / Math.max(1, sizeSpread * 2.2)), 0, 1);

  return clamp(0.42 + normalizedEdgeScore * 0.32 + confidenceBonus * 0.16 + compactness * 0.1, 0, 0.96);
};

const buildOrderedLayoutItems = (
  groups: DerivedLayoutGroup[],
  ungroupedLineIndexes: number[],
  lineMap: Map<number, PreparedLine>,
  readingMode: ResolvedLayoutReadingMode,
  baseHeight: number
): OrderedLayoutItem[] => {
  const items: OrderedLayoutItem[] = [
    ...groups.map((group) => ({ kind: 'group' as const, group })),
    ...ungroupedLineIndexes.flatMap((lineIndex) => {
      const line = lineMap.get(lineIndex);
      if (!line) return [];
      return [{
        kind: 'line' as const,
        lineIndex,
        bounds: {
          top: line.top,
          bottom: line.bottom,
          left: line.left,
          right: line.right,
        },
        anchor: {
          sortX: Number.isFinite(line.sortHintX) ? Number(line.sortHintX) : line.left,
          sortY: Number.isFinite(line.sortHintY) ? Number(line.sortHintY) : line.top,
          rawOrder: line.index,
        },
      }];
    }),
  ];

  return items.sort((a, b) => {
    const aBounds = a.kind === 'group' ? a.group.bounds : a.bounds;
    const bBounds = b.kind === 'group' ? b.group.bounds : b.bounds;
    const aAnchor = a.kind === 'group' ? a.group.anchor : a.anchor;
    const bAnchor = b.kind === 'group' ? b.group.anchor : b.anchor;
    const topDelta = aAnchor.sortY - bAnchor.sortY;
    const verticalOverlap = intervalOverlap(aBounds.top, aBounds.bottom, bBounds.top, bBounds.bottom);
    const minSpan = Math.max(
      1,
      Math.min(
        Math.max(1, aBounds.bottom - aBounds.top),
        Math.max(1, bBounds.bottom - bBounds.top),
      )
    );
    const sameBand = (verticalOverlap / minSpan) >= 0.16 || Math.abs(topDelta) <= baseHeight * 1.3;
    if (sameBand) {
      if (readingMode === 'rtl' || readingMode === 'ttb') {
        const aRight = Number.isFinite(aAnchor.sortX) ? aAnchor.sortX : aBounds.right;
        const bRight = Number.isFinite(bAnchor.sortX) ? bAnchor.sortX : bBounds.right;
        if (aRight !== bRight) return bRight - aRight;
      } else {
        const aLeft = Number.isFinite(aAnchor.sortX) ? aAnchor.sortX : aBounds.left;
        const bLeft = Number.isFinite(bAnchor.sortX) ? bAnchor.sortX : bBounds.left;
        if (aLeft !== bLeft) return aLeft - bLeft;
      }
    }
    if (topDelta !== 0) return topDelta;
    if (readingMode === 'rtl' || readingMode === 'ttb') {
      const aRight = Number.isFinite(aAnchor.sortX) ? aAnchor.sortX : aBounds.right;
      const bRight = Number.isFinite(bAnchor.sortX) ? bAnchor.sortX : bBounds.right;
      if (aRight !== bRight) return bRight - aRight;
    } else {
      const aLeft = Number.isFinite(aAnchor.sortX) ? aAnchor.sortX : aBounds.left;
      const bLeft = Number.isFinite(bAnchor.sortX) ? bAnchor.sortX : bBounds.left;
      if (aLeft !== bLeft) return aLeft - bLeft;
    }
    return aAnchor.rawOrder - bAnchor.rawOrder;
  });
};

export const deriveBalloonAwareLayoutGrouping = (
  input: LayoutGroupingInput
): LayoutGroupingResult => {
  const preparedLines: PreparedLine[] = input.lines
    .map((line) => {
      const width = Math.max(1, line.right - line.left);
      const height = Math.max(1, line.bottom - line.top);
      return {
        ...line,
        width,
        height,
        centerX: (line.left + line.right) * 0.5,
        centerY: (line.top + line.bottom) * 0.5,
        normalizedAngle: normalizeAngle(line.angleDeg),
      };
    })
    .filter((line) => line.right > line.left && line.bottom > line.top);

  const lineMap = new Map<number, PreparedLine>(preparedLines.map((line) => [line.index, line]));
  const rawOrder = preparedLines.map((line) => line.index);
  if (preparedLines.length === 0) {
    return {
      groups: [],
      ungroupedLineIndexes: [],
      orderedGroupIds: [],
      orderedLineIndexes: [],
      diagnostics: {
        strategy: 'geometry',
        avgConfidence: 0,
        warnings: ['no_input_lines'],
        resolvedReadingMode: 'ltr',
        rawOrder,
      },
    };
  }

  const baseHeight = Math.max(8, computeMedian(preparedLines.map((line) => line.height)));
  const resolvedReadingMode = resolveReadingMode(input.readingMode, preparedLines);
  const parent = preparedLines.map((_, index) => index);
  const groupEdgeScores = new Map<string, number[]>();

  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };

  const unite = (aIndex: number, bIndex: number, score: number): void => {
    const rootA = find(aIndex);
    const rootB = find(bIndex);
    if (rootA !== rootB) {
      parent[rootB] = rootA;
    }
    const nextRoot = find(aIndex);
    const key = `${Math.min(nextRoot, find(bIndex))}:${Math.max(nextRoot, find(bIndex))}`;
    const bucket = groupEdgeScores.get(key) || [];
    bucket.push(score);
    groupEdgeScores.set(key, bucket);
  };

  for (let i = 0; i < preparedLines.length; i += 1) {
    for (let j = i + 1; j < preparedLines.length; j += 1) {
      const score = shouldLinkGeometryLines(preparedLines[i], preparedLines[j], baseHeight, resolvedReadingMode);
      if (score !== null) {
        unite(i, j, score);
      }
    }
  }

  const grouped = new Map<number, GroupSeed>();
  preparedLines.forEach((line, index) => {
    const root = find(index);
    const bucket = grouped.get(root) || { lines: [], edgeScores: [] };
    bucket.lines.push(line);
    grouped.set(root, bucket);
  });

  groupEdgeScores.forEach((scores, key) => {
    const rootText = key.split(':')[0];
    const root = Number.parseInt(rootText, 10);
    const bucket = grouped.get(find(root));
    if (!bucket) return;
    bucket.edgeScores.push(...scores);
  });

  const groups: DerivedLayoutGroup[] = [];
  const ungroupedLineIndexes: number[] = [];

  Array.from(grouped.values()).forEach((seed, bucketIndex) => {
    const orderedLines = orderGroupLines(seed.lines, resolvedReadingMode, baseHeight);
    if (orderedLines.length <= 1) {
      ungroupedLineIndexes.push(orderedLines[0].index);
      return;
    }

    const bounds = {
      top: Math.min(...orderedLines.map((line) => line.top)),
      bottom: Math.max(...orderedLines.map((line) => line.bottom)),
      left: Math.min(...orderedLines.map((line) => line.left)),
      right: Math.max(...orderedLines.map((line) => line.right)),
    };

    groups.push({
      id: `page-${input.pageNumber}-group-${bucketIndex}`,
      page: input.pageNumber,
      lineIndexes: orderedLines.map((line) => line.index),
      orderedLineIndexes: orderedLines.map((line) => line.index),
      intraGroupOrder: orderedLines.map((line) => line.index),
      interGroupOrder: 0,
      confidence: groupConfidenceFromSeed(seed, preparedLines.length),
      readingMode: resolvedReadingMode,
      strategy: 'geometry',
      groupType: classifyGroupType(orderedLines),
      bounds,
      anchor: {
        sortX: Number.isFinite(orderedLines[0]?.sortHintX) ? Number(orderedLines[0]?.sortHintX) : orderedLines[0]?.left ?? bounds.left,
        sortY: Number.isFinite(orderedLines[0]?.sortHintY) ? Number(orderedLines[0]?.sortHintY) : orderedLines[0]?.top ?? bounds.top,
        rawOrder: orderedLines[0]?.index ?? bucketIndex,
      },
    });
  });

  const orderedItems = buildOrderedLayoutItems(groups, ungroupedLineIndexes, lineMap, resolvedReadingMode, baseHeight);
  const orderedLineIndexes: number[] = [];
  const orderedGroupIds: string[] = [];
  orderedItems.forEach((item, itemIndex) => {
    if (item.kind === 'group') {
      item.group.interGroupOrder = itemIndex;
      orderedGroupIds.push(item.group.id);
      orderedLineIndexes.push(...item.group.orderedLineIndexes);
      return;
    }
    orderedLineIndexes.push(item.lineIndex);
  });

  const multiLineCoverage = groups.reduce((sum, group) => sum + group.orderedLineIndexes.length, 0) / Math.max(1, preparedLines.length);
  const avgGroupConfidence = groups.length > 0
    ? groups.reduce((sum, group) => sum + group.confidence, 0) / groups.length
    : 0.38;
  const singletonRatio = ungroupedLineIndexes.length / Math.max(1, preparedLines.length);
  const overallConfidence = clamp(
    avgGroupConfidence * 0.52 + multiLineCoverage * 0.34 + (1 - singletonRatio) * 0.14,
    0,
    1,
  );

  const warnings: string[] = [];
  if (groups.length === 0) warnings.push('no_multi_line_groups');
  if (overallConfidence < 0.62) warnings.push('low_grouping_confidence');
  if (singletonRatio >= 0.72 && preparedLines.length >= 5) warnings.push('singleton_heavy_page');

  return {
    groups,
    ungroupedLineIndexes: ungroupedLineIndexes.sort((a, b) => orderedLineIndexes.indexOf(a) - orderedLineIndexes.indexOf(b)),
    orderedGroupIds,
    orderedLineIndexes,
    diagnostics: {
      strategy: 'geometry',
      avgConfidence: overallConfidence,
      warnings,
      resolvedReadingMode,
      rawOrder,
    },
  };
};
