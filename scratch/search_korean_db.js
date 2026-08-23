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

  if (!masterPassword) {
    console.error('No master password');
    app.quit();
    return;
  }

  module.paths.push('c:/App/Electron/PDF_Translator/node_modules');
  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma("key = '" + masterPassword.replace(/'/g, "''") + "'");

    const searchWords = ["남편이랑", "마리코", "안갔지", "코토미", "학교", "뭐야"];

    console.log('Searching documents...');
    const docs = db.prepare('SELECT id, filename FROM documents').all();
    docs.forEach(doc => {
      console.log(`Doc ID: ${doc.id}, Filename: ${doc.filename}`);
    });

    console.log('\nSearching in ocr_cache_engine...');
    const ocrRows = db.prepare('SELECT document_id, page_number, ocr_engine, ocr_data FROM ocr_cache_engine').all();
    ocrRows.forEach(row => {
      const dataStr = row.ocr_data;
      const found = searchWords.filter(w => dataStr.includes(w));
      if (found.length > 0) {
        console.log(`OCR Match in Doc ${row.document_id} Page ${row.page_number} (${row.ocr_engine}) matches: ${found.join(', ')}`);
        try {
          const ocr = JSON.parse(dataStr);
          if (ocr.lines) {
            ocr.lines.forEach((l, idx) => {
              const matchedW = searchWords.filter(w => l.text.includes(w));
              if (matchedW.length > 0) {
                console.log(`  Line ${idx}: "${l.text}" (box: x0=${l.bbox?.x0.toFixed(1)}, y0=${l.bbox?.y0.toFixed(1)}, x1=${l.bbox?.x1.toFixed(1)}, y1=${l.bbox?.y1.toFixed(1)})`);
              }
            });
          }
        } catch (e) {
          console.error('Failed to parse OCR JSON:', e);
        }
      }
    });

    console.log('\nSearching in translation_cache...');
    const transRows = db.prepare('SELECT document_id, page_number, translator_engine, translated_text, translated_by_index FROM translation_cache').all();
    transRows.forEach(row => {
      const txt = row.translated_text || '';
      const byIdx = row.translated_by_index || '';
      const found = searchWords.filter(w => txt.includes(w) || byIdx.includes(w));
      if (found.length > 0) {
        console.log(`Translation Match in Doc ${row.document_id} Page ${row.page_number} (${row.translator_engine})`);
        console.log(`  Translated Text:`, txt.substring(0, 500));
        console.log(`  Translated By Index:`, byIdx.substring(0, 500));
      }
    });

    console.log('\nSearching in sentence_translation_cache...');
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sentence_translation_cache'").get();
    if (tableExists) {
      const sentenceRows = db.prepare('SELECT source_text, target_text, target_language FROM sentence_translation_cache').all();
      sentenceRows.forEach(row => {
        const src = row.source_text || '';
        const tgt = row.target_text || '';
        const found = searchWords.filter(w => src.includes(w));
        if (found.length > 0) {
          console.log(`Sentence Cache Match: "${src}" -> "${tgt}" (${row.target_language})`);
        }
      });
    }

    db.close();
  } catch (err) {
    console.error('DB error:', err);
  }

  app.quit();
});
