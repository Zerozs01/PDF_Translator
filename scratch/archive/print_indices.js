const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'page21_ocr.json'), 'utf8');
const data = JSON.parse(raw);

const indices = [26,27,28,29,30,31,32,33,35,36,38,39,40];
indices.forEach(idx => {
  const line = data.lines[idx];
  console.log(`[${idx}] text="${line.text}"`);
  console.log(`      sortHintX=${line.sortHintX} sortHintY=${line.sortHintY}`);
  console.log(`      bbox=${JSON.stringify(line.bbox)}`);
  console.log(`      _sourceIndex=${line._sourceIndex}`);
});
