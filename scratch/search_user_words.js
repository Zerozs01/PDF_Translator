const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.config");
const userDataPath = path.join(appData, 'pdf_translator');
app.name = 'pdf_translator';
app.setPath('userData', userDataPath);

app.whenReady().then(() => {
  console.log('User Data Path:', userDataPath);

  const configPath = path.join(userDataPath, 'authConfig.json');
  if (!fs.existsSync(configPath)) {
    console.error('Config file not found at:', configPath);
    app.quit();
    return;
  }

  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('App Mode:', configData.appMode);

  let masterPassword = '';
  if (configData.encryptedMaster) {
    try {
      const encryptedBuffer = Buffer.from(configData.encryptedMaster, 'hex');
      masterPassword = safeStorage.decryptString(encryptedBuffer);
      console.log('Decrypted Master Password successfully');
    } catch (err) {
      console.error('Failed to decrypt master password:', err);
    }
  }

  if (!masterPassword) {
    console.error('No master password available');
    app.quit();
    return;
  }

  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');
  console.log('DB Path:', dbPath);

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key = '${masterPassword.replace(/'/g, "''")}'`);

    const deleteOcrCache = db.prepare('DELETE FROM ocr_cache WHERE document_id = 63').run();
    const deleteOcrCacheEngine = db.prepare('DELETE FROM ocr_cache_engine WHERE document_id = 63').run();
    const deleteTransCache = db.prepare('DELETE FROM translation_cache WHERE document_id = 63').run();
    
    console.log('Deleted legacy ocr_cache rows for Doc 63:', deleteOcrCache.changes);
    console.log('Deleted ocr_cache_engine rows for Doc 63:', deleteOcrCacheEngine.changes);
    console.log('Deleted translation_cache rows for Doc 63:', deleteTransCache.changes);

    db.close();
    app.quit();
    return;
    let foundCountDummy = 0;
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
