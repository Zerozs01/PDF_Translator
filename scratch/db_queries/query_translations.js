const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'pdf_translator', 'pdf_translator.db');
console.log('Opening DB at:', dbPath);

try {
  const db = new Database(dbPath, { readonly: true });
  
  // 1. ดึงข้อมูลเอกสารล่าสุด
  const latestDoc = db.prepare('SELECT id, filename, filepath FROM documents ORDER BY last_accessed DESC LIMIT 1').get();
  console.log('\n--- Latest Active Document ---');
  console.log(latestDoc);

  if (latestDoc) {
    // 2. ตรวจสอบ OCR Cache
    const ocrRows = db.prepare('SELECT page_number, ocr_engine, length(ocr_data) as len FROM ocr_cache_engine WHERE document_id = ? ORDER BY page_number').all(latestDoc.id);
    console.log('\n--- OCR Cache (Engine V2) ---');
    console.log(ocrRows);

    // 3. ตรวจสอบ Translation Cache
    const transRows = db.prepare(`
      SELECT page_number, cache_key, translator_engine, line_count, group_count, length(translated_text) as len, substr(translated_text, 1, 100) as sample 
      FROM translation_cache 
      WHERE document_id = ? 
      ORDER BY page_number
    `).all(latestDoc.id);
    console.log('\n--- Translation Cache ---');
    console.log(transRows);
  }

  db.close();
} catch (err) {
  console.error('Error querying DB:', err);
}
