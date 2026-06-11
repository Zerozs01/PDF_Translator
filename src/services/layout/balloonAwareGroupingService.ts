import type { OCRPoint } from '../../types';

console.log("[GroupingServiceLoaded] Loaded balloonAwareGroupingService.ts");

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
  originalHeight?: number;
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

const NEW_BALLOON_PATTERNS = [
  /^\s*\.{2,}/,          // "...THAT'S" -> ellipsis ขึ้นต้น
  /^\s*[\*\!\?]+/,       // "!?", "!!" -> คำอุทาน
  /^\s*[""「『“]/,       // เครื่องหมายคำพูดเปิด
];

const END_BALLOON_PATTERNS = [
  /[.!?…]["」』”]?\s*$/,  // จบประโยคสมบูรณ์
];

const startsNewBalloon = (text: string): boolean => {
  return NEW_BALLOON_PATTERNS.some((p) => p.test(text));
};

const endsGroup = (text: string): boolean => {
  return END_BALLOON_PATTERNS.some((p) => p.test(text));
};

const areSameScriptLines = (a: string, b: string): boolean => {
  const cleanA = a.replace(/[\d\s\W_]+/g, '');
  const cleanB = b.replace(/[\d\s\W_]+/g, '');
  if (!cleanA || !cleanB) return true;

  const hasThaiA = /[\u0E00-\u0E7F]/.test(cleanA);
  const hasThaiB = /[\u0E00-\u0E7F]/.test(cleanB);
  if (hasThaiA || hasThaiB) return hasThaiA && hasThaiB;

  const hasHangulA = /[\uAC00-\uD7AF]/.test(cleanA);
  const hasHangulB = /[\uAC00-\uD7AF]/.test(cleanB);
  if (hasHangulA || hasHangulB) return hasHangulA && hasHangulB;

  const hasCjkA = /[\u3040-\u30FF\u4E00-\u9FFF]/.test(cleanA);
  const hasCjkB = /[\u3040-\u30FF\u4E00-\u9FFF]/.test(cleanB);
  if (hasCjkA || hasCjkB) return hasCjkA && hasCjkB;

  const hasLatinA = /[A-Za-z]/.test(cleanA);
  const hasLatinB = /[A-Za-z]/.test(cleanB);
  if (hasLatinA || hasLatinB) return false;

  return false;
};

const sanitizeLineBbox = (line: PreparedLine, baseHeight: number): PreparedLine => {
  const originalHeight = line.originalHeight ?? (line.bottom - line.top);
  console.log(`[Sanitize] "${line.text}" height=${originalHeight} baseHeight=${baseHeight} ratio=${(originalHeight/baseHeight).toFixed(2)}`);
  if (originalHeight <= baseHeight * 2.5) return line;
  const center = (line.top + line.bottom) * 0.5;
  return {
    ...line,
    top: center - baseHeight * 0.5,
    bottom: center + baseHeight * 0.5,
    height: baseHeight,
  };
};

const computePageMedianVerticalGap = (lines: PreparedLine[], baseHeight: number): number => {
  const gaps: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      const a = lines[i];
      const b = lines[j];
      const overlapX = overlapRatio(a.left, a.right, b.left, b.right);
      const overlapY = overlapRatio(a.top, a.bottom, b.top, b.bottom);
      if (overlapX >= 0.18 && overlapY <= 0.15) {
        const verticalGap = computeVerticalGap(a, b);
        if (verticalGap > 0 && verticalGap <= baseHeight * 1.25) {
          gaps.push(verticalGap);
        }
      }
    }
  }
  return gaps.length >= 2 ? computeMedian(gaps) : 0;
};

const splitMismergedGroup = (
  lines: PreparedLine[],
  baseHeight: number,
  pageMedianVerticalGap: number
): PreparedLine[][] => {
  if (lines.length === 0) return [];

  const subGroups: PreparedLine[][] = [[lines[0]]];
  const anomalyThreshold = pageMedianVerticalGap > 0
    ? Math.min(baseHeight * 1.55, Math.max(baseHeight * 1.0, pageMedianVerticalGap * 1.6))
    : baseHeight * 1.55;

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    const verticalGap = computeVerticalGap(prev, curr);

    

    const shouldSplit =
      verticalGap > baseHeight * 1.55 ||
      // allow same-script fragments to bridge slightly larger gaps
      (verticalGap > anomalyThreshold && !(areSameScriptLines(prev.text, curr.text) && verticalGap <= baseHeight * 1.55)) ||
      (startsNewBalloon(curr.text) && verticalGap > baseHeight * 0.8) ||
      (endsGroup(prev.text) && verticalGap > baseHeight * 0.85);

    if (shouldSplit) {
      subGroups.push([curr]);
    } else {
      subGroups[subGroups.length - 1].push(curr);
    }
  }
  return subGroups;
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
  readingMode: ResolvedLayoutReadingMode,
  pageMedianVerticalGap: number
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
  const localAngleDelta = (a.text.trim().length <= 1 || b.text.trim().length <= 1) ? 0 : angleDelta(a.angleDeg, b.angleDeg);

  // --- Guard 1: Page-level Gap Anomaly ---
  const anomalyThreshold = pageMedianVerticalGap > 0
    ? Math.min(baseHeight * 1.55, Math.max(baseHeight * 1.0, pageMedianVerticalGap * 1.6))
    : baseHeight * 1.55;

  // --- Inflated Bbox Center Distance Guard ---
  const heightA = a.originalHeight ?? (a.bottom - a.top);
  const heightB = b.originalHeight ?? (b.bottom - b.top);
  const isInflatedA = heightA > baseHeight * 2.0;
  const isInflatedB = heightB > baseHeight * 2.0;
  if (isInflatedA || isInflatedB) {
    const centerGap = Math.abs(a.centerY - b.centerY);
    if (centerGap > anomalyThreshold) {
      return null;
    }
  }

  // Allow a relaxed anomaly threshold for same-script hops
  // where fragmented vertical pieces should still be merged.
  if (verticalGap > anomalyThreshold) {
    // permit slightly larger gaps for same-script links (fragmented lines)
    if (!(areSameScriptLines(a.text, b.text) && verticalGap <= baseHeight * 1.55)) {
      return null;
    }
  }

  // --- Guard 2: Special character clue (starts new balloon) ---
  if (startsNewBalloon(b.text)) {
    if (verticalGap > baseHeight * 0.8) return null;
  }

  // --- Guard 3: Sentence ended cleanly + large gap ---
  if (endsGroup(a.text) && verticalGap > baseHeight * 0.85) {
    return null;
  }

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
    && verticalGap <= baseHeight * 1.55
    && centerDeltaX <= Math.max(92, minWidth * 1.05);
  const tightlyStacked = overlapX >= 0.12
    && verticalGap <= baseHeight * 1.2
    && centerDeltaX <= Math.max(72, minWidth * 0.82);
  const diagonalStack = overlapX >= 0.1
    && verticalGap <= baseHeight * 1.45
    && horizontalGap <= Math.max(64, baseHeight * 1.7)
    && centerDeltaX <= Math.max(96, minWidth * 1.35);
  const looseColumnStack = overlapY <= 0.38
    && verticalGap <= baseHeight * 1.5
    && centerDeltaX <= Math.max(128, maxWidth * 0.72, baseHeight * 3.4)
    && (overlapX >= 0.055 || horizontalGap <= Math.max(70, baseHeight * 2.6, minWidth * 0.55))
    && localAngleDelta <= 24;
  const contained = overlapX >= 0.52 && overlapY >= 0.22;
  const hintedSequence = Number.isFinite(a.sortHintY) && Number.isFinite(b.sortHintY)
    && Math.abs(Number(a.sortHintY) - Number(b.sortHintY)) <= Math.max(28, baseHeight * 1.2)
    && (!Number.isFinite(a.sortHintX) || !Number.isFinite(b.sortHintX) || Math.abs(Number(a.sortHintX) - Number(b.sortHintX)) <= Math.max(120, baseHeight * 1.5))
    && centerDeltaX <= Math.max(116, Math.max(a.width, b.width) * 1.45)
    && verticalGap <= baseHeight * 1.5;

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
    const horizontalOverlap = overlapRatio(a.left, a.right, b.left, b.right);
    const sameBand = (Math.abs(aSortY - bSortY) <= Math.max(10, baseHeight * 0.45)
      || overlapRatio(a.top, a.bottom, b.top, b.bottom) >= 0.34)
      && horizontalOverlap < 0.18;
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
  console.log(`[deriveBalloonAwareLayoutGrouping] Called with ${input.lines.length} lines`);
  const rawLines: PreparedLine[] = input.lines
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
        originalHeight: height,
      };
    })
    .filter((line) => line.right > line.left && line.bottom > line.top);

  const rawOrder = rawLines.map((line) => line.index);
  if (rawLines.length === 0) {
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

  const baseHeight = Math.max(8, computeMedian(rawLines.map((line) => line.height)));
  const preparedLines = rawLines.map((line) => sanitizeLineBbox(line, baseHeight));
  const lineMap = new Map<number, PreparedLine>(preparedLines.map((line) => [line.index, line]));
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

  const pageMedianVerticalGap = computePageMedianVerticalGap(preparedLines, baseHeight);

  for (let i = 0; i < preparedLines.length; i += 1) {
    for (let j = i + 1; j < preparedLines.length; j += 1) {
      const score = shouldLinkGeometryLines(preparedLines[i], preparedLines[j], baseHeight, resolvedReadingMode, pageMedianVerticalGap);
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

  if (input.pageNumber === 12) {
    // debug hook removed
  }

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
    if (orderedLines.length === 0) return;

    // Fallback split for mismerged groups (e.g., nested balloons)
    const subGroups = splitMismergedGroup(orderedLines, baseHeight, pageMedianVerticalGap);

    subGroups.forEach((subGroupLines, subIndex) => {
      const uniqueBucketIndex = bucketIndex * 100 + subIndex;
      if (subGroupLines.length <= 1) {
        ungroupedLineIndexes.push(subGroupLines[0].index);
        return;
      }

      const bounds = {
        top: Math.min(...subGroupLines.map((line) => line.top)),
        bottom: Math.max(...subGroupLines.map((line) => line.bottom)),
        left: Math.min(...subGroupLines.map((line) => line.left)),
        right: Math.max(...subGroupLines.map((line) => line.right)),
      };

      groups.push({
        id: `page-${input.pageNumber}-group-${uniqueBucketIndex}`,
        page: input.pageNumber,
        lineIndexes: subGroupLines.map((line) => line.index),
        orderedLineIndexes: subGroupLines.map((line) => line.index),
        intraGroupOrder: subGroupLines.map((line) => line.index),
        interGroupOrder: 0,
        confidence: groupConfidenceFromSeed({ lines: subGroupLines, edgeScores: seed.edgeScores }, preparedLines.length),
        readingMode: resolvedReadingMode,
        strategy: 'geometry',
        groupType: classifyGroupType(subGroupLines),
        bounds,
        anchor: {
          sortX: Number.isFinite(subGroupLines[0]?.sortHintX) ? Number(subGroupLines[0]?.sortHintX) : subGroupLines[0]?.left ?? bounds.left,
          sortY: Number.isFinite(subGroupLines[0]?.sortHintY) ? Number(subGroupLines[0]?.sortHintY) : subGroupLines[0]?.top ?? bounds.top,
          rawOrder: subGroupLines[0]?.index ?? uniqueBucketIndex,
        },
      });
    });
  });

  // Post-process groups to keep mixed-script (Thai vs Latin-only) separated.
  // If a group contains both Thai and Latin-only lines, extract Latin-only
  // lines back to ungrouped so Thai blocks remain isolated.
  const isLatinOnlyText = (text: string | undefined): boolean => {
    if (!text) return false;
    return /[A-Za-z]/.test(text) && !/[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(text);
  };

  for (let gi = groups.length - 1; gi >= 0; gi -= 1) {
    const group = groups[gi];
    const latinLines = group.lineIndexes.filter((idx) => isLatinOnlyText(lineMap.get(idx)?.text));
    const thaiLines = group.lineIndexes.filter((idx) => /[\u0E00-\u0E7F]/.test(lineMap.get(idx)?.text ?? ''));
    if (latinLines.length > 0 && thaiLines.length > 0) {
      // remove latin lines from group
      group.lineIndexes = group.lineIndexes.filter((i) => !latinLines.includes(i));
      group.orderedLineIndexes = group.orderedLineIndexes.filter((i) => !latinLines.includes(i));
      group.intraGroupOrder = group.intraGroupOrder.filter((i) => !latinLines.includes(i));

      // recompute bounds/anchor/confidence for remaining lines
      const remaining = group.lineIndexes.map((i) => lineMap.get(i)).filter(Boolean) as PreparedLine[];
      if (remaining.length === 0) {
        groups.splice(gi, 1);
      } else {
        group.bounds = {
          top: Math.min(...remaining.map((l) => l.top)),
          bottom: Math.max(...remaining.map((l) => l.bottom)),
          left: Math.min(...remaining.map((l) => l.left)),
          right: Math.max(...remaining.map((l) => l.right)),
        };
        group.anchor = {
          sortX: Number.isFinite(remaining[0].sortHintX) ? Number(remaining[0].sortHintX) : remaining[0].left,
          sortY: Number.isFinite(remaining[0].sortHintY) ? Number(remaining[0].sortHintY) : remaining[0].top,
          rawOrder: remaining[0].index,
        };
        group.confidence = groupConfidenceFromSeed({ lines: remaining, edgeScores: [] }, preparedLines.length);
        group.groupType = classifyGroupType(remaining);
      }

      // add latin lines back to ungrouped (preserve ordering)
      latinLines.forEach((li) => {
        if (!ungroupedLineIndexes.includes(li)) ungroupedLineIndexes.push(li);
      });
    }
  }

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

  // debug logs removed

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
