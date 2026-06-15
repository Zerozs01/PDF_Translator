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
    const transRow = db.prepare('SELECT translated_by_index FROM translation_cache WHERE document_id = ? AND page_number = ?').get(docId, pageNum);

    if (ocrRow && transRow) {
      const ocr = JSON.parse(ocrRow.ocr_data);
      const byIndex = JSON.parse(transRow.translated_by_index || '[]');
      const translatedMap = new Map();
      byIndex.forEach(item => {
        translatedMap.set(item.index, item.text);
      });

      console.log('--- Page 11 Lines ---');
      ocr.lines.forEach((line, index) => {
        const transText = translatedMap.get(index);
        console.log(`[idx:${index}] text: "${line.text}" | trans: "${transText || 'MISSING'}"`);
      });
    }

    db.close();
  } catch (err) {
    console.error(err);
  }
  app.quit();
});
