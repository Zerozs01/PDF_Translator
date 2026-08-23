const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.config");
const userDataPath = path.join(appData, 'pdf_translator');
app.name = 'pdf_translator';
app.setPath('userData', userDataPath);

app.whenReady().then(() => {
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

  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key = '${masterPassword.replace(/'/g, "''")}'`);

    const docId = 3;
    const pageNum = 4;
    console.log(`Dumping Doc ${docId} Page ${pageNum} details (lines 40 to 60):`);

    const row = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
    if (row) {
      const ocr = JSON.parse(row.ocr_data);
      console.log('\nOCR Lines:');
      ocr.lines.forEach((l, idx) => {
        if (idx >= 40 && idx <= 60) {
          console.log(`Line ${idx}: "${l.text}" (box: x0=${l.bbox.x0.toFixed(1)}, y0=${l.bbox.y0.toFixed(1)}, x1=${l.bbox.x1.toFixed(1)}, y1=${l.bbox.y1.toFixed(1)}, h=${(l.bbox.y1-l.bbox.y0).toFixed(1)})`);
        }
      });

      // Get translation groups
      const transRows = db.prepare('SELECT translated_by_index, cache_key FROM translation_cache WHERE document_id = ? AND page_number = ?').all(docId, pageNum);
      for (const tr of transRows) {
        console.log(`\n================ Cache Key: ${tr.cache_key} ===============`);
        try {
          const mapData = JSON.parse(tr.translated_by_index);
          const filtered = mapData.filter(item => item.index >= 40 && item.index <= 60);
          console.log(filtered);
        } catch (e) {
          console.log('Error parsing translated_by_index');
        }
      }
    }

    db.close();
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
