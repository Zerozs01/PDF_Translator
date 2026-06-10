const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'page2_ocr.json'), 'utf8');
const data = JSON.parse(raw);

const input = {
  pageNumber: 2,
  imageWidth: data.width || 1590,
  imageHeight: data.height || 23858,
  mode: 'balloon-aware',
  readingMode: 'ltr',
  lines: data.lines.map((l, index) => {
    const bbox = l.bbox || {};
    return {
      ...l,
      index,
      left: typeof l.left === 'number' ? l.left : (bbox.x0 || 0),
      right: typeof l.right === 'number' ? l.right : (bbox.x1 || 0),
      top: typeof l.top === 'number' ? l.top : (bbox.y0 || 0),
      bottom: typeof l.bottom === 'number' ? l.bottom : (bbox.y1 || 0),
      sourceLength: l.text.length
    };
  })
};

// Copy deriveBalloonAwareLayoutGrouping logic to trace it
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const computeMedian = (values) => {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 0) {
    return (ordered[middle - 1] + ordered[middle]) / 2;
  }
  return ordered[middle];
};

const NEW_BALLOON_PATTERNS = [/^\s*\.{2,}/, /^\s*[\*\!\?]+/, /^\s*[""「『“]/];
const END_BALLOON_PATTERNS = /[.!?…]["」』”]?\s*$/;
const startsNewBalloon = (text) => NEW_BALLOON_PATTERNS.some((p) => p.test(text));
const endsGroup = (text) => END_BALLOON_PATTERNS.test(text);

const areSameScriptLines = (a, b) => true;

const sanitizeLineBbox = (line, baseHeight) => {
  const originalHeight = line.originalHeight ?? (line.bottom - line.top);
  if (originalHeight <= baseHeight * 2.5) return line;
  const center = (line.top + line.bottom) * 0.5;
  return {
    ...line,
    top: center - baseHeight * 0.5,
    bottom: center + baseHeight * 0.5,
    height: baseHeight,
  };
};

const computePageMedianVerticalGap = (lines, baseHeight) => {
  const gaps = [];
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

const splitMismergedGroup = (lines, baseHeight, pageMedianVerticalGap) => {
  if (lines.length === 0) return [];
  const subGroups = [[lines[0]]];
  const anomalyThreshold = pageMedianVerticalGap > 0
    ? Math.min(baseHeight * 1.55, Math.max(baseHeight * 1.0, pageMedianVerticalGap * 1.6))
    : baseHeight * 1.55;

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    const verticalGap = computeVerticalGap(prev, curr);
    const shouldSplit =
      verticalGap > baseHeight * 1.55 ||
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

const overlapRatio = (a0, a1, b0, b1) => {
  const overlap = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const base = Math.max(1, Math.min(a1 - a0, b1 - b0));
  return overlap / base;
};

const computeHorizontalGap = (a, b) => Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
const computeVerticalGap = (a, b) => Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));

const shouldLinkGeometryLines = (a, b, baseHeight, pageMedianVerticalGap) => {
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

  const anomalyThreshold = pageMedianVerticalGap > 0
    ? Math.min(baseHeight * 1.55, Math.max(baseHeight * 1.0, pageMedianVerticalGap * 1.6))
    : baseHeight * 1.55;

  const heightA = a.originalHeight ?? (a.bottom - a.top);
  const heightB = b.originalHeight ?? (b.bottom - b.top);
  const isInflatedA = heightA > baseHeight * 2.0;
  const isInflatedB = heightB > baseHeight * 2.0;
  if (isInflatedA || isInflatedB) {
    const centerGap = Math.abs(a.centerY - b.centerY);
    if (centerGap > anomalyThreshold) return null;
  }

  if (verticalGap > anomalyThreshold) {
    if (!(areSameScriptLines(a.text, b.text) && verticalGap <= baseHeight * 1.55)) return null;
  }

  if (startsNewBalloon(b.text) && verticalGap > baseHeight * 0.8) return null;
  if (endsGroup(a.text) && verticalGap > baseHeight * 0.85) return null;

  const sameRowSeparatedColumns = overlapY >= 0.26 && overlapX <= 0.18 && horizontalGap >= baseHeight * 0.85 && centerDeltaX >= baseHeight * 1.8;
  if (sameRowSeparatedColumns) return null;

  const wideDistantColumns = overlapY >= 0.14 && horizontalGap >= Math.max(96, baseHeight * 2.35) && centerDeltaX >= Math.max(120, minWidth * 1.7);
  if (wideDistantColumns) return null;

  const verticallyStacked = overlapX >= 0.18 && verticalGap <= baseHeight * 1.55 && centerDeltaX <= Math.max(92, minWidth * 1.05);
  const tightlyStacked = overlapX >= 0.12 && verticalGap <= baseHeight * 1.2 && centerDeltaX <= Math.max(72, minWidth * 0.82);
  const diagonalStack = overlapX >= 0.1 && verticalGap <= baseHeight * 1.45 && horizontalGap <= Math.max(64, baseHeight * 1.7) && centerDeltaX <= Math.max(96, minWidth * 1.35);
  const looseColumnStack = overlapY <= 0.38 && verticalGap <= baseHeight * 1.5 && centerDeltaX <= Math.max(128, maxWidth * 0.72, baseHeight * 3.4) && (overlapX >= 0.055 || horizontalGap <= Math.max(70, baseHeight * 2.6, minWidth * 0.55));
  const contained = overlapX >= 0.52 && overlapY >= 0.22;

  if (!verticallyStacked && !tightlyStacked && !diagonalStack && !looseColumnStack && !contained) return null;

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

  return score >= 2.2 ? score : null;
};

const orderGroupLines = (lines, baseHeight) => {
  if (lines.length <= 1) return [...lines];
  return [...lines].sort((a, b) => {
    const aSortY = a.top;
    const bSortY = b.top;
    const horizontalOverlap = overlapRatio(a.left, a.right, b.left, b.right);
    const sameBand = (Math.abs(aSortY - bSortY) <= Math.max(10, baseHeight * 0.45)
      || overlapRatio(a.top, a.bottom, b.top, b.bottom) >= 0.34)
      && horizontalOverlap < 0.18;
    if (sameBand) {
      const aSortX = a.left;
      const bSortX = b.left;
      if (aSortX !== bSortX) return aSortX - bSortX;
    }
    if (aSortY !== bSortY) return aSortY - bSortY;
    if (a.left !== b.left) return a.left - b.left;
    return a.index - b.index;
  });
};

// derive logic
const rawLines = input.lines.map((line) => {
  const width = Math.max(1, line.right - line.left);
  const height = Math.max(1, line.bottom - line.top);
  return {
    ...line,
    width,
    height,
    centerX: (line.left + line.right) * 0.5,
    centerY: (line.top + line.bottom) * 0.5,
    originalHeight: height,
  };
}).filter((line) => line.right > line.left && line.bottom > line.top);

const baseHeight = Math.max(8, computeMedian(rawLines.map((line) => line.height)));
const preparedLines = rawLines.map((line) => sanitizeLineBbox(line, baseHeight));
const lineMap = new Map(preparedLines.map((line) => [line.index, line]));

const parent = preparedLines.map((_, index) => index);
const find = (index) => {
  let current = index;
  while (parent[current] !== current) {
    parent[current] = parent[parent[current]];
    current = parent[current];
  }
  return current;
};
const unite = (aIndex, bIndex) => {
  const rootA = find(aIndex);
  const rootB = find(bIndex);
  if (rootA !== rootB) parent[rootB] = rootA;
};

const pageMedianVerticalGap = computePageMedianVerticalGap(preparedLines, baseHeight);

for (let i = 0; i < preparedLines.length; i++) {
  for (let j = i + 1; j < preparedLines.length; j++) {
    const score = shouldLinkGeometryLines(preparedLines[i], preparedLines[j], baseHeight, pageMedianVerticalGap);
    if (score !== null) unite(i, j);
  }
}

const grouped = new Map();
preparedLines.forEach((line, index) => {
  const root = find(index);
  const bucket = grouped.get(root) || { lines: [] };
  bucket.lines.push(line);
  grouped.set(root, bucket);
});

const groups = [];
const ungroupedLineIndexes = [];

Array.from(grouped.values()).forEach((seed, bucketIndex) => {
  const orderedLines = orderGroupLines(seed.lines, baseHeight);
  const subGroups = splitMismergedGroup(orderedLines, baseHeight, pageMedianVerticalGap);

  subGroups.forEach((subGroupLines, subIndex) => {
    const uniqueBucketIndex = bucketIndex * 100 + subIndex;
    if (subGroupLines.length <= 1) {
      ungroupedLineIndexes.push(subGroupLines[0].index);
      return;
    }
    groups.push({
      id: `page-2-group-${uniqueBucketIndex}`,
      lineIndexes: subGroupLines.map((line) => line.index),
      orderedLineIndexes: subGroupLines.map((line) => line.index),
    });
  });
});

console.log("Groups before mixed-script check:");
groups.forEach(g => {
  if (g.lineIndexes.includes(12) || g.lineIndexes.includes(13) || g.lineIndexes.includes(14)) {
    console.log(`Group: ${g.id}, lineIndexes: ${JSON.stringify(g.lineIndexes)}`);
  }
});

// Run mixed-script check
const isLatinOnlyText = (text) => {
  if (!text) return false;
  return /[A-Za-z]/.test(text) && !/[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(text);
};

for (let gi = groups.length - 1; gi >= 0; gi -= 1) {
  const group = groups[gi];
  const latinLines = group.lineIndexes.filter((idx) => isLatinOnlyText(lineMap.get(idx)?.text));
  const thaiLines = group.lineIndexes.filter((idx) => /[\u0E00-\u0E7F]/.test(lineMap.get(idx)?.text ?? ''));
  console.log(`Group ID ${group.id}: latinLines=${JSON.stringify(latinLines.map(idx => lineMap.get(idx).text))}, thaiLines=${JSON.stringify(thaiLines.map(idx => lineMap.get(idx).text))}`);
}
