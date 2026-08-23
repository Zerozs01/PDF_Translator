const Database = require('better-sqlite3-multiple-ciphers');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'pdf_translator', 'pdf_translator.db');
console.log('Opening DB at:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });
  const latestDoc = db.prepare('SELECT id, filename FROM documents ORDER BY last_accessed DESC LIMIT 1').get();
  console.log('Active Doc:', latestDoc);

  if (latestDoc) {
    const ocrRows = db.prepare('SELECT page_number, ocr_data FROM ocr_cache_engine WHERE document_id = ?').all(latestDoc.id);
    for (const row of ocrRows) {
      const ocr = JSON.parse(row.ocr_data);
      const hasRoseria = ocr.lines.some(l => l.text.toLowerCase().includes('roseria'));
      if (hasRoseria) {
        console.log(`\n================ PAGE ${row.page_number} ================`);
        console.log('OCR Lines:');
        ocr.lines.forEach((l, idx) => {
          console.log(`Line ${idx}: "${l.text}"`);
        });

        // Get translations
        const transRows = db.prepare('SELECT translated_text, cache_key FROM translation_cache WHERE document_id = ? AND page_number = ?').all(latestDoc.id, row.page_number);
        for (const tr of transRows) {
          console.log(`\nTranslation cache (${tr.cache_key}):`);
          const data = JSON.parse(tr.translated_text);
          console.log('translatedByIndex:', data.translatedByIndex);
        }
      }
    }
  }

  db.close();
} catch (err) {
  console.error(err);
}
