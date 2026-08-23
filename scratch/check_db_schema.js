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

    console.log('--- TABLE ocr_cache_engine ---');
    const ocrCols = db.prepare("PRAGMA table_info(ocr_cache_engine)").all();
    ocrCols.forEach(function(col) {
      console.log('  ' + col.name + ' (' + col.type + ')');
    });

    console.log('\n--- TABLE translation_cache ---');
    const transCols = db.prepare("PRAGMA table_info(translation_cache)").all();
    transCols.forEach(function(col) {
      console.log('  ' + col.name + ' (' + col.type + ')');
    });

    // ลองดึงตัวอย่างข้อมูล ocr_cache_engine มาดู version
    console.log('\n--- OCR Cache Samples ---');
    const ocrSample = db.prepare('SELECT document_id, page_number, engine, length(ocr_data) as len FROM ocr_cache_engine LIMIT 5').all();
    ocrSample.forEach(function(s) {
      console.log('  Doc ' + s.document_id + ' Page ' + s.page_number + ' Engine ' + s.engine + ' Size ' + s.len);
    });

    db.close();
  } catch (err) {
    console.error('DB error:', err);
  }

  app.quit();
});
