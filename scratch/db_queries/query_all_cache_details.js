const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.config");
const userDataPath = path.join(appData, 'pdf_translator');
app.name = 'pdf_translator';
app.setPath('userData', userDataPath);

app.whenReady().then(() => {
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
  const db = new Database(dbPath);
  db.pragma("cipher='sqlcipher'");
  db.pragma(`key = '${masterPassword.replace(/'/g, "''")}'`);

  // Query documents for 58 and 358
  const docs = db.prepare('SELECT id, filename, filepath FROM documents WHERE id IN (58, 358)').all();
  console.log("Documents found:", docs);

  // Query translation_cache for 58 and 358
  const trans = db.prepare('SELECT document_id, page_number, cache_key, translated_text FROM translation_cache WHERE document_id IN (58, 358)').all();
  console.log(`Translation cache count: ${trans.length}`);
  trans.forEach(t => {
    console.log(`  Doc: ${t.document_id} Page: ${t.page_number} Key: ${t.cache_key} Text length: ${t.translated_text ? t.translated_text.length : 0}`);
  });

  // Query ocr_cache_engine for 58 and 358
  const ocr = db.prepare('SELECT document_id, page_number, ocr_engine, length(ocr_data) as len FROM ocr_cache_engine WHERE document_id IN (58, 358)').all();
  console.log(`OCR cache count: ${ocr.length}`);
  ocr.forEach(o => {
    console.log(`  Doc: ${o.document_id} Page: ${o.page_number} Engine: ${o.ocr_engine} Len: ${o.len}`);
  });

  db.close();
  app.quit();
});
