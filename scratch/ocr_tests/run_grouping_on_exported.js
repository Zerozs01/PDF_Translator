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

const result = deriveBalloonAwareLayoutGrouping(input);
console.log("=== GROUPS ===");
result.groups.forEach(g => {
  console.log(`Group ID: ${g.id}`);
  console.log(`  Lines: ${JSON.stringify(g.orderedLineIndexes)}`);
  console.log(`  Texts: ${JSON.stringify(g.orderedLineIndexes.map(idx => data.lines[idx].text))}`);
});

console.log("=== UNGROUPED ===");
console.log(result.ungroupedLineIndexes.map(idx => `${idx}: "${data.lines[idx].text}"`));
