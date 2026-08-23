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

    const rows = db.prepare('SELECT page_number, ocr_data FROM ocr_cache_engine WHERE document_id = ?').all(3);
    console.log(`Found ${rows.length} pages in doc 3`);
    for (const r of rows) {
      const ocr = JSON.parse(r.ocr_data);
      const texts = ocr.lines.map(l => l.text).join(' ');
      if (texts.toUpperCase().includes('DEAD NOW') || texts.toUpperCase().includes('DUMB PIG')) {
        console.log(`MATCH! Page Number: ${r.page_number}`);
        ocr.lines.forEach((l, idx) => {
          console.log(`  Line ${idx}: "${l.text}" (bbox: y0=${Math.round(l.bbox.y0)}, y1=${Math.round(l.bbox.y1)}, x0=${Math.round(l.bbox.x0)}, x1=${Math.round(l.bbox.x1)})`);
        });
      }
    }

    db.close();
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
