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

    const rows = db.prepare('SELECT page_number, ocr_engine FROM ocr_cache_engine WHERE document_id = ?').all(3);
    console.log('Page list for Doc 3:');
    rows.sort((a,b) => a.page_number - b.page_number).forEach(r => {
      const rowData = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?').get(3, r.page_number, r.ocr_engine);
      const ocr = JSON.parse(rowData.ocr_data);
      const sample = ocr.lines.slice(0, 3).map(l => l.text).join(' | ');
      console.log(`Page ${r.page_number} (${r.ocr_engine}): lines=${ocr.lines.length} sample="${sample}"`);
    });

    db.close();
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
