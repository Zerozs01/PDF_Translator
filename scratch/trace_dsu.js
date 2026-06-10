const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'page2_ocr.json'), 'utf8');
const data = JSON.parse(raw);

const lines = data.lines.map((l, index) => {
  const bbox = l.bbox || {};
  return {
    ...l,
    index,
    left: typeof l.left === 'number' ? l.left : (bbox.x0 || 0),
    right: typeof l.right === 'number' ? l.right : (bbox.x1 || 0),
    top: typeof l.top === 'number' ? l.top : (bbox.y0 || 0),
    bottom: typeof l.bottom === 'number' ? l.bottom : (bbox.y1 || 0),
    width: Math.max(1, (bbox.x1 || 0) - (bbox.x0 || 0)),
    height: Math.max(1, (bbox.y1 || 0) - (bbox.y0 || 0)),
    centerX: ((bbox.x0 || 0) + (bbox.x1 || 0)) * 0.5,
    centerY: ((bbox.y0 || 0) + (bbox.y1 || 0)) * 0.5,
    normalizedAngle: 0,
    originalHeight: Math.max(1, (bbox.y1 || 0) - (bbox.y0 || 0)),
    sourceLength: l.text.length
  };
});

const baseHeight = 102.13;

const overlapRatio = (a0, a1, b0, b1) => {
  const overlap = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const base = Math.max(1, Math.min(a1 - a0, b1 - b0));
  return overlap / base;
};

const computeHorizontalGap = (a, b) => Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
const computeVerticalGap = (a, b) => Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));

// Let's run DSU manually
const parent = lines.map((_, index) => index);
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
  if (rootA !== rootB) {
    parent[rootB] = rootA;
  }
};

const shouldLinkGeometryLines = (a, b) => {
  const overlapX = overlapRatio(a.left, a.right, b.left, b.right);
  const overlapY = overlapRatio(a.top, a.bottom, b.top, b.bottom);
  const horizontalGap = computeHorizontalGap(a, b);
  const verticalGap = computeVerticalGap(a, b);
  const centerDeltaX = Math.abs(a.centerX - b.centerX);
  const centerDeltaY = Math.abs(a.centerY - b.centerY);
  const minWidth = Math.min(a.width, b.width);
  const maxWidth = Math.max(a.width, b.width);
  const sizeSimilarity = Math.min(a.height, b.height) / Math.max(a.height, b.height, 1);
  const widthSimilarity = Math.min(a.width, b.width) / Math.max(a.width, b.width, 1);

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
    && (overlapX >= 0.055 || horizontalGap <= Math.max(70, baseHeight * 2.6, minWidth * 0.55));

  const contained = overlapX >= 0.52 && overlapY >= 0.22;

  const matched = verticallyStacked || tightlyStacked || diagonalStack || looseColumnStack || contained;
  if (!matched) return false;

  let score = 0;
  score += overlapX * 3.6;
  score += overlapY * 2.2;
  score += sizeSimilarity * 1.5;
  score += widthSimilarity * 0.8;
  score -= (horizontalGap / baseHeight) * 0.22;
  score -= (verticalGap / baseHeight) * 0.28;
  score -= (centerDeltaY / baseHeight) * 0.06;
  if (verticallyStacked) score += 1.15;
  if (tightlyStacked) score += 0.85;
  if (diagonalStack) score += 0.95;
  if (looseColumnStack) score += 0.9;
  if (contained) score += 1.1;

  return score >= 2.2;
};

for (let i = 0; i < lines.length; i++) {
  for (let j = i + 1; j < lines.length; j++) {
    if (shouldLinkGeometryLines(lines[i], lines[j])) {
      unite(i, j);
    }
  }
}

console.log(`Find(12): ${find(12)}`);
console.log(`Find(13): ${find(13)}`);
console.log(`Find(14): ${find(14)}`);
console.log(`Find(15): ${find(15)}`);
console.log(`Find(16): ${find(16)}`);
console.log(`Find(17): ${find(17)}`);
