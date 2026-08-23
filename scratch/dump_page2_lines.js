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

    const row = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(3, 2);
    if (!row) {
      console.log('No OCR data found for Doc 3 Page 2');
    } else {
      const ocr = JSON.parse(row.ocr_data);
      console.log('OCR lines for Doc 3 Page 2:');
      ocr.lines.forEach((l, idx) => {
        console.log(`Line ${idx}: "${l.text}" (conf: ${l.confidence.toFixed(1)}, bbox: x0=${l.bbox.x0}, y0=${l.bbox.y0}, x1=${l.bbox.x1}, y1=${l.bbox.y1})`);
      });
      console.log('\nDebug info:', ocr.debug || {});
    }

    db.close();
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
