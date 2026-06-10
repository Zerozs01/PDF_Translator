const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const { deriveBalloonAwareLayoutGrouping } = require('../src/services/layout/balloonAwareGroupingService');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'pdf_translator', 'pdf_translator.db');
const db = new Database(dbPath);

const row = db.prepare("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 44 AND page_number = 2 AND ocr_engine = 'paddleocr'").get();
if (!row) {
  console.log("No cache row found");
  process.exit(1);
}

const data = JSON.parse(row.ocr_data);
const input = {
  pageNumber: 2,
  imageWidth: data.width || 1590,
  imageHeight: data.height || 23858,
  mode: 'balloon-aware',
  readingMode: 'ltr',
  lines: data.lines.map(l => ({
    ...l,
    sourceLength: l.text.length
  }))
};

const result = deriveBalloonAwareLayoutGrouping(input);
console.log("=== DIAGNOSTICS ===");
console.log(`Avg Confidence: ${result.diagnostics.avgConfidence}`);
console.log(`Warnings: ${JSON.stringify(result.diagnostics.warnings)}`);

console.log("=== GROUPS ===");
result.groups.forEach(g => {
  console.log(`Group ID: ${g.id}`);
  console.log(`  Confidence: ${g.confidence}`);
  console.log(`  Type: ${g.groupType}`);
  console.log(`  Lines: ${JSON.stringify(g.orderedLineIndexes)}`);
  console.log(`  Texts: ${JSON.stringify(g.orderedLineIndexes.map(idx => data.lines[idx].text))}`);
});

console.log("=== UNGROUPED ===");
console.log(result.ungroupedLineIndexes.map(idx => `${idx}: "${data.lines[idx].text}"`));
