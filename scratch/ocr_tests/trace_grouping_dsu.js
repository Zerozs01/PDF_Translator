const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'page21_ocr.json'), 'utf8');
const data = JSON.parse(raw);

const input = {
  pageNumber: 21,
  imageWidth: data.width || 5132,
  imageHeight: data.height || 7394,
  mode: 'balloon-aware',
  readingMode: 'ltr',
  lines: data.lines.map((l, index) => {
    const bbox = l.bbox || {};
    return {
      ...l,
      index,
      left: bbox.x0 || 0,
      right: bbox.x1 || 0,
      top: bbox.y0 || 0,
      bottom: bbox.y1 || 0,
      sourceLength: l.text.length
    };
  })
};

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

const startsNewBalloon = (text) => {
  return [
    /^\s*\.{2,}/,
    /^\s*[\*\!\?]+/,
    /^\s*[""「『“]/,
  ].some((p) => p.test(text));
};

const endsGroup = (text) => {
  return [
    /[.!?…]["」』”]?\s*$/,
  ].some((p) => p.test(text));
};

const areSameScriptLines = (a, b) => {
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

  return false;
};

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

const overlapRatio = (a0, a1, b0, b1) => {
  const overlap = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const base = Math.max(1, Math.min(a1 - a0, b1 - b0));
  return overlap / base;
};

const computeHorizontalGap = (a, b) => Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
const computeVerticalGap = (a, b) => Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));

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

const shouldLinkGeometryLines = (a, b, baseHeight, readingMode, pageMedianVerticalGap) => {
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
  const localAngleDelta = 0;

  const anomalyThreshold = pageMedianVerticalGap > 0
    ? Math.min(baseHeight * 1.55, Math.max(baseHeight * 1.0, pageMedianVerticalGap * 1.6))
    : baseHeight * 1.55;

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

  if (verticalGap > anomalyThreshold) {
    if (!(areSameScriptLines(a.text, b.text) && verticalGap <= baseHeight * 1.55)) {
      return null;
    }
  }

  if (startsNewBalloon(b.text)) {
    if (verticalGap > baseHeight * 0.8) return null;
  }

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

  if (!verticallyStacked && !tightlyStacked && !diagonalStack && !looseColumnStack && !contained) {
    return null;
  }

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

  return score >= 2.2 ? score : null;
};

// Run derive layout grouping
const rawLines = input.lines.map((line) => {
  const width = Math.max(1, line.right - line.left);
  const height = Math.max(1, line.bottom - line.top);
  return {
    ...line,
    width,
    height,
    centerX: (line.left + line.right) * 0.5,
    centerY: (line.top + line.bottom) * 0.5,
    normalizedAngle: 0,
    originalHeight: height,
  };
});

const baseHeight = Math.max(8, computeMedian(rawLines.map((line) => line.height)));
const preparedLines = rawLines.map((line) => sanitizeLineBbox(line, baseHeight));
const resolvedReadingMode = 'ltr';
const parent = preparedLines.map((_, index) => index);

const find = (index) => {
  let current = index;
  while (parent[current] !== current) {
    parent[current] = parent[parent[current]];
    current = parent[current];
  }
  return current;
};

const unite = (aIndex, bIndex, score) => {
  const rootA = find(aIndex);
  const rootB = find(bIndex);
  if (rootA !== rootB) {
    parent[rootB] = rootA;
    console.log(`DSU UNITE: [${aIndex}] "${preparedLines[aIndex].text}" <-> [${bIndex}] "${preparedLines[bIndex].text}" score=${score}`);
  }
};

const pageMedianVerticalGap = computePageMedianVerticalGap(preparedLines, baseHeight);
console.log(`baseHeight: ${baseHeight}, pageMedianVerticalGap: ${pageMedianVerticalGap}`);

for (let i = 0; i < preparedLines.length; i += 1) {
  for (let j = i + 1; j < preparedLines.length; j += 1) {
    const score = shouldLinkGeometryLines(preparedLines[i], preparedLines[j], baseHeight, resolvedReadingMode, pageMedianVerticalGap);
    if (score !== null) {
      unite(i, j, score);
    }
  }
}

console.log("\n=== Roots ===");
for (let i = 0; i < preparedLines.length; i++) {
  console.log(`Line [${i}] "${preparedLines[i].text}" -> Root [${find(i)}] "${preparedLines[find(i)].text}"`);
}
