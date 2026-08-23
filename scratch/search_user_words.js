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
    const pageNum = 26;
    console.log(`Dumping ALL raw OCR lines on Doc ${docId} Page ${pageNum}:`);
    const row = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
    if (row) {
      const ocr = JSON.parse(row.ocr_data);
      console.log('OCR Lines length:', ocr.lines ? ocr.lines.length : 0);
      if (ocr.lines) {
        ocr.lines.forEach((l, idx) => {
          console.log(`Line ${idx}: "${l.text}" (box: x0=${l.bbox.x0.toFixed(1)}, y0=${l.bbox.y0.toFixed(1)}, x1=${l.bbox.x1.toFixed(1)}, y1=${l.bbox.y1.toFixed(1)}, height=${(l.bbox.y1-l.bbox.y0).toFixed(1)})`);
        });
      }
      const debug = ocr.debug || {};
      const dropped = debug.droppedWords || [];
      console.log('Dropped Words length:', dropped.length);
      dropped.forEach((d, idx) => {
        console.log(`Dropped ${idx}: "${d.text}" (box: x0=${d.bbox.x0.toFixed(1)}, y0=${d.bbox.y0.toFixed(1)}, x1=${d.bbox.x1.toFixed(1)}, y1=${d.bbox.y1.toFixed(1)}) reason=${d.reason} filter=${d.filter}`);
      });
    } else {
      console.log('Page not found in ocr_cache_engine');
    }

    db.close();
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
