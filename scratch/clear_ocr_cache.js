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
    console.error('Config file not found at:', configPath);
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
    console.error('No master password decrypted');
    app.quit();
    return;
  }

  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key = '${masterPassword.replace(/'/g, "''")}'`);

    console.log('[SQLite] Connected to DB. Clearing caches...');
    
    // Clear all OCR and Translation caches
    const d1 = db.prepare('DELETE FROM ocr_cache').run();
    const d2 = db.prepare('DELETE FROM ocr_cache_engine').run();
    const d3 = db.prepare('DELETE FROM translation_cache').run();
    const d4 = db.prepare('DELETE FROM sentence_translation_cache').run();

    console.log(`[SQLite] Cache cleared successfully!`);
    console.log(`- Deleted from ocr_cache: ${d1.changes} rows`);
    console.log(`- Deleted from ocr_cache_engine: ${d2.changes} rows`);
    console.log(`- Deleted from translation_cache: ${d3.changes} rows`);
    console.log(`- Deleted from sentence_translation_cache: ${d4.changes} rows`);

    db.close();
  } catch (err) {
    console.error('Database operations failed:', err);
  }

  app.quit();
});
