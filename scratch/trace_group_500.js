const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'page2_ocr.json'), 'utf8');
const data = JSON.parse(raw);

const preparedLines = data.lines.map((l, index) => {
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

// Import deriveBalloonAwareLayoutGrouping
const { deriveBalloonAwareLayoutGrouping } = require('../src/services/layout/balloonAwareGroupingService');

const input = {
  pageNumber: 2,
  imageWidth: data.width || 1590,
  imageHeight: data.height || 23858,
  mode: 'balloon-aware',
  readingMode: 'ltr',
  lines: preparedLines
};

const result = deriveBalloonAwareLayoutGrouping(input);
const g500 = result.groups.find(g => g.id.includes('group-500'));
console.log("Group 500 lines in result:", g500 ? g500.lineIndexes : "Not found");
console.log("Ungrouped lines:", result.ungroupedLineIndexes);
