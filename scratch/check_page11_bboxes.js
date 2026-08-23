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
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let masterPassword = '';
  if (configData.encryptedMaster) {
    const encryptedBuffer = Buffer.from(configData.encryptedMaster, 'hex');
    masterPassword = safeStorage.decryptString(encryptedBuffer);
  }

  module.paths.push('c:/App/Electron/PDF_Translator/node_modules');
  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma("key = '" + masterPassword.replace(/'/g, "''") + "'");

    const docId = 3;
    const pageNum = 11;

    const ocrRow = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
    if (ocrRow) {
      const ocr = JSON.parse(ocrRow.ocr_data);
      console.log('--- Target Lines BBox ---');
      [101, 102, 103, 104, 105, 106, 107, 108, 109].forEach(idx => {
        const line = ocr.lines[idx];
        if (!line) return;
        const b = line.bbox;
        console.log(`[idx:${idx}] text: "${line.text}" | x0:${Math.round(b.x0)} y0:${Math.round(b.y0)} x1:${Math.round(b.x1)} y1:${Math.round(b.y1)}`);
      });
    }

    db.close();
  } catch (err) {
    console.error(err);
  }
  app.quit();
});
