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

  const r = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 58 AND page_number = 2').get();
  if (r) {
    const ocr = JSON.parse(r.ocr_data);
    console.log("OCR LINES FOR DOC 58 PAGE 2:");
    ocr.lines.forEach((l, idx) => {
      console.log(`Index ${idx}: "${l.text}" | Box: ${JSON.stringify(l.box)}`);
    });
  } else {
    console.log("No OCR data found for Doc 58 Page 2");
  }

  db.close();
  app.quit();
});
