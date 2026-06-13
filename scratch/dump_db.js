const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(() => {
  const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.config");
  const userDataPath = path.join(appData, 'pdf_translator');
  console.log('User Data Path:', userDataPath);

  // set app's user path so safeStorage can locate the key if needed
  app.setPath('userData', userDataPath);

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
    console.error('No master password available (cannot decrypt database). App might be in SECURITY mode without saved key.');
    app.quit();
    return;
  }

  // Connect to SQLCipher db
  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');
  console.log('DB Path:', dbPath);

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key = '${masterPassword.replace(/'/g, "''")}'`);

    // test query
    const docCount = db.prepare('SELECT COUNT(*) as count FROM documents').get();
    console.log('Documents Count:', docCount.count);

    const latestDoc = db.prepare('SELECT id, filename FROM documents ORDER BY last_accessed DESC LIMIT 1').get();
    if (!latestDoc) {
      console.log('No documents found in DB.');
      db.close();
      app.quit();
      return;
    }
    console.log('Latest Document:', latestDoc);

    const ocrRows = db.prepare('SELECT ocr_engine, ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = 9').all(latestDoc.id);
    console.log('OCR Rows count for page 9:', ocrRows.length);
    ocrRows.forEach(row => {
      const ocrData = JSON.parse(row.ocr_data);
      console.log(`Engine: ${row.ocr_engine}, Lines: ${ocrData.lines?.length || 0}`);
      ocrData.lines?.forEach((l, idx) => {
        console.log(`  Line ${idx}: [${l.bbox.x0}, ${l.bbox.y0}, ${l.bbox.x1}, ${l.bbox.y1}] - ${l.text}`);
      });
    });

    const transRows = db.prepare('SELECT ocr_engine, translation_mode, translated_by_index FROM translation_cache WHERE document_id = ? AND page_number = 9').all(latestDoc.id);
    console.log('Translation Rows count for page 9:', transRows.length);
    transRows.forEach(row => {
      const lines = JSON.parse(row.translated_by_index);
      console.log(`Engine: ${row.ocr_engine}, Mode: ${row.translation_mode}, Lines: ${lines.length}`);
      lines.forEach((l) => {
        console.log(`  Idx ${l.index}: ${l.sourceText} -> ${l.text}`);
      });
    });

    db.close();
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
