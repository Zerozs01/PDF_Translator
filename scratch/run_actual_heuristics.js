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
      const line = ocr.lines[41];
      
      // import functions จาก project จริง!
      // compile typescript dynamic หรือใช้ ts-node หรือ require compiled js (ถ้ามี)
      // โครงการนี้น่าจะเป็น ts-node หรือเปล่า? หรือใช้ electron-webpack?
      // ปกติ code ใน src จะเป็น typescript เราสามารถ import หรือจำลอง logic จาก src/
      // มาเช็คดูว่าใน C:\App\Electron\PDF_Translator\dist หรือ build มี compiled js ไหม?
    }

    db.close();
  } catch (err) {
    console.error(err);
  }
  app.quit();
});
