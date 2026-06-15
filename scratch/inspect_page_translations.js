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

    const docId = 3;
    const pages = [3, 11, 25];

    pages.forEach(function(pageNum) {
      console.log('\n==================================================');
      console.log('PAGE ' + pageNum);
      console.log('==================================================');

      const ocrRow = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
      if (!ocrRow) {
        console.log('No OCR Cache data found');
        return;
      }
      const ocrData = JSON.parse(ocrRow.ocr_data);
      const lines = ocrData.lines || [];

      const transRow = db.prepare('SELECT translated_by_index, translated_text FROM translation_cache WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
      if (!transRow) {
        console.log('No Translation Cache data found');
        return;
      }

      const byIndex = JSON.parse(transRow.translated_by_index || '{}');
      console.log('Translation text: ' + transRow.translated_text);

      console.log('\nMapping OCR Line -> Translation:');
      lines.forEach(function(line, idx) {
        const trans = byIndex[idx];
        const isSuspicious = line.isSuspicious ? ' [SUSPICIOUS]' : '';
        console.log('  [' + idx + '] Original: "' + line.text + '"' + isSuspicious);
        if (trans !== undefined) {
          console.log('      Translation: "' + trans + '"');
        } else {
          console.log('      Translation: MISSING');
        }
      });
    });

    db.close();
  } catch (err) {
    console.error('DB error:', err);
  }

  app.quit();
});
