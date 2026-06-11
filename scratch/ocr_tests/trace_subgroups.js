const fs = require('fs');
const path = require('path');
const { deriveBalloonAwareLayoutGrouping } = require('../src/services/layout/balloonAwareGroupingService');

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

// Let's hook print in splitMismergedGroup
// But we can just see which group had line 13
const result = deriveBalloonAwareLayoutGrouping(input);
// Wait, we can see if 13 is ungrouped. Why?
// Let's trace parent list and subGroups!
console.log("Groups containing any of 12, 13, 14:");
result.groups.forEach(g => {
  if (g.lineIndexes.includes(12) || g.lineIndexes.includes(13) || g.lineIndexes.includes(14)) {
    console.log(`Group: ${g.id}`);
    console.log(`  lineIndexes: ${JSON.stringify(g.lineIndexes)}`);
    console.log(`  orderedLineIndexes: ${JSON.stringify(g.orderedLineIndexes)}`);
  }
});

if (result.ungroupedLineIndexes.includes(13)) {
  console.log("Line 13 is indeed in ungroupedLineIndexes!");
}
