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

const computeVerticalGap = (a, b) => Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));
const areSameScriptLines = (a, b) => true; // all latin

const groupLines = [lines[12], lines[13], lines[14], lines[15], lines[16], lines[17]];

console.log("=== Group Lines ===");
groupLines.forEach(l => console.log(`${l.index}: "${l.text}" top=${l.top} bottom=${l.bottom}`));

// splitMismergedGroup implementation
const subGroups = [[groupLines[0]]];
const anomalyThreshold = pageMedianVerticalGap > 0
  ? Math.min(baseHeight * 1.55, Math.max(baseHeight * 1.0, pageMedianVerticalGap * 1.6))
  : baseHeight * 1.55;

console.log(`anomalyThreshold: ${anomalyThreshold}`);

for (let i = 1; i < groupLines.length; i++) {
  const prev = groupLines[i - 1];
  const curr = groupLines[i];
  const verticalGap = computeVerticalGap(prev, curr);
  const shouldSplit =
    verticalGap > baseHeight * 1.55 ||
    (verticalGap > anomalyThreshold && !(areSameScriptLines(prev.text, curr.text) && verticalGap <= baseHeight * 1.55));
  
  console.log(`Comparing "${prev.text}" and "${curr.text}": verticalGap=${verticalGap}, shouldSplit=${shouldSplit}`);
  if (shouldSplit) {
    subGroups.push([curr]);
  } else {
    subGroups[subGroups.length - 1].push(curr);
  }
}

console.log("=== Subgroups ===");
subGroups.forEach((sg, idx) => {
  console.log(`Subgroup ${idx}:`, sg.map(l => `${l.index}: "${l.text}"`));
});
