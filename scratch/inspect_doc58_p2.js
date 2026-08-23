const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform === 'darwin'
  ? process.env.HOME + '/Library/Application Support'
  : process.env.HOME + '/.config');
const userDataPath = path.join(appData, 'pdf_translator');
app.name = 'pdf_translator';
app.setPath('userData', userDataPath);

app.whenReady().then(function() {
  const configPath = path.join(userDataPath, 'authConfig.json');
  if (!fs.existsSync(configPath)) {
    console.error('Config file not found');
    app.quit();
    return;
  }

  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let masterPassword = '';
  if (configData.encryptedMaster) {
    try {
      const encryptedBuffer = Buffer.from(configData.encryptedMaster, 'hex');
      masterPassword = safeStorage.decryptString(encryptedBuffer);
    } catch (err) {
      console.error('Failed to decrypt master password:', err);
    }
  }

  module.paths.push('c:/App/Electron/PDF_Translator/node_modules');
  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma("key = '" + masterPassword.replace(/'/g, "''") + "'");

    const docId = 58;
    const pageNum = 2;

    console.log(`=== Inspecting Doc ${docId} Page ${pageNum} ===`);
    
    // Get OCR data
    const ocrRow = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
    if (ocrRow) {
      const ocr = JSON.parse(ocrRow.ocr_data);
      console.log('--- OCR Lines ---');
      if (ocr.lines) {
        ocr.lines.forEach((l, idx) => {
          console.log(`Line ${idx}: "${l.text}" (box: x0=${l.bbox?.x0.toFixed(1)}, y0=${l.bbox?.y0.toFixed(1)}, x1=${l.bbox?.x1.toFixed(1)}, y1=${l.bbox?.y1.toFixed(1)})`);
        });
      }
    } else {
      console.log('No OCR data found');
    }

    // Get Translation Cache
    const transRow = db.prepare('SELECT * FROM translation_cache WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
    if (transRow) {
      console.log('\n--- Translation Cache Row ---');
      console.log('ocr_engine:', transRow.ocr_engine);
      console.log('ocr_language:', transRow.ocr_language);
      console.log('source_language:', transRow.source_language);
      console.log('target_language:', transRow.target_language);
      console.log('translation_mode:', transRow.translation_mode);
      console.log('translator_engine:', transRow.translator_engine);
      console.log('source_fingerprint:', transRow.source_fingerprint);
      console.log('translated_text:', JSON.stringify(transRow.translated_text));
      console.log('translated_by_index:', transRow.translated_by_index);
    } else {
      console.log('No Translation Cache row found');
    }

    db.close();
  } catch (err) {
    console.error('DB error:', err);
  }

  app.quit();
});
