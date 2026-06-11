const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'page21_ocr.json'), 'utf8');
const data = JSON.parse(raw);

const baseHeight = 111.5;
const pageMedianVerticalGap = 0; // it was 0 in output

const preparedLines = data.lines.map((line, index) => {
  const width = Math.max(1, line.bbox.x1 - line.bbox.x0);
  const height = Math.max(1, line.bbox.y1 - line.bbox.y0);
  return {
    ...line,
    index,
    left: line.bbox.x0,
    right: line.bbox.x1,
    top: line.bbox.y0,
    bottom: line.bbox.y1,
    width,
    height,
    centerX: (line.bbox.x0 + line.bbox.x1) * 0.5,
    centerY: (line.bbox.y0 + line.bbox.y1) * 0.5,
    normalizedAngle: 0,
    originalHeight: height,
  };
});

function overlapRatio(a0, a1, b0, b1) {
  const overlap = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const base = Math.max(1, Math.min(a1 - a0, b1 - b0));
  return overlap / base;
}

function computeHorizontalGap(a, b) {
  return Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
}

function computeVerticalGap(a, b) {
  return Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
}

function shouldLinkGeometryLines(a, b) {
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

  const anomalyThreshold = baseHeight * 1.55;

  if (verticalGap > anomalyThreshold) return null;

  const sameRowSeparatedColumns = overlapY >= 0.26
    && overlapX <= 0.18
    && horizontalGap >= baseHeight * 0.85
    && centerDeltaX >= baseHeight * 1.8;
  
  const wideDistantColumns = overlapY >= 0.14
    && horizontalGap >= Math.max(96, baseHeight * 2.35)
    && centerDeltaX >= Math.max(120, minWidth * 1.7);

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

  const matched = (verticallyStacked || tightlyStacked || diagonalStack || looseColumnStack || contained);

  if (sameRowSeparatedColumns) return null;
  if (wideDistantColumns) return null;
  if (!matched) return null;

  return score >= 2.2 ? score : null;
}

// Find all linking pairs
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

for (let i = 0; i < preparedLines.length; i++) {
  for (let j = i + 1; j < preparedLines.length; j++) {
    const score = shouldLinkGeometryLines(preparedLines[i], preparedLines[j]);
    if (score !== null) {
      unite(i, j);
      // If we united something in the group
      if (find(35) === find(36)) {
        console.log(`BRIDGE LINK CREATED AT PAIR: [${i}] "${preparedLines[i].text}" <-> [${j}] "${preparedLines[j].text}" score=${score}`);
        // Let's break to see which one was the culprit
      }
    }
  }
}
