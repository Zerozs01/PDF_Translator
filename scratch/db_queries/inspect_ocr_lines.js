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
    console.log("OCR LINES in ocr_cache_engine:");
    ocr.lines.forEach((l, idx) => {
      console.log(`Array Index ${idx}: text="${l.text}" | _sourceIndex=${l._sourceIndex} | box=${JSON.stringify(l.bbox)}`);
    });
  }

  db.close();
  app.quit();
});
