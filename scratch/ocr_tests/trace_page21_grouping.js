const fs = require('fs');
const path = require('path');
const { deriveBalloonAwareLayoutGrouping } = require('../src/services/layout/balloonAwareGroupingService');

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

const result = deriveBalloonAwareLayoutGrouping(input);
console.log("=== GROUPS ===");
result.groups.forEach(g => {
  // Let's filter groups containing 'FiTTiNG FOR' or 'BEING'
  const hasFitting = g.orderedLineIndexes.some(idx => data.lines[idx].text.includes('FiTTiNG'));
  const hasBeing = g.orderedLineIndexes.some(idx => data.lines[idx].text.includes('BEING'));
  if (hasFitting || hasBeing) {
    console.log(`Group ID: ${g.id} (Confidence: ${g.confidence})`);
    console.log(`  Lines: ${JSON.stringify(g.orderedLineIndexes)}`);
    console.log(`  Texts:`);
    g.orderedLineIndexes.forEach(idx => {
      const line = data.lines[idx];
      console.log(`    - [${idx}] "${line.text}" bbox: ${JSON.stringify(line.bbox)}`);
    });
    console.log("-" * 30);
  }
});
