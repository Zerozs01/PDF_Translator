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

    const docId = 1;
    const pagesToDump = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

    pagesToDump.forEach(function(pageNum) {
      console.log('\n==================================================');
      console.log('Dumping Doc ' + docId + ' Page ' + pageNum);
      console.log('==================================================');

      const row = db.prepare(
        'SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?'
      ).get(docId, pageNum);

      if (row) {
        const ocr = JSON.parse(row.ocr_data);
        const lines = ocr.lines || [];
        console.log('OCR Lines (' + lines.length + '):');
        lines.forEach(function(l, idx) {
          const b = l.bbox || {};
          console.log('  [' + idx + '] "' + l.text + '" conf=' + (l.confidence||0).toFixed(1) + ' x0=' + Math.round(b.x0||0) + ' y0=' + Math.round(b.y0||0) + ' x1=' + Math.round(b.x1||0) + ' y1=' + Math.round(b.y1||0));
        });

        const debug = ocr.debug || {};
        const dropped = debug.droppedWords || [];
        console.log('\nDropped Words (' + dropped.length + '):');
        dropped.forEach(function(d, idx) {
          const bx = d.bbox || {};
          console.log('  DROPPED[' + idx + '] "' + d.text + '" reason=' + d.reason + ' filter=' + d.filter + ' x0=' + Math.round(bx.x0||0) + ' y0=' + Math.round(bx.y0||0));
        });

        const transRows = db.prepare(
          'SELECT translated_by_index, translated_text, cache_key FROM translation_cache WHERE document_id = ? AND page_number = ?'
        ).all(docId, pageNum);

        console.log('\nTranslation cache rows: ' + transRows.length);
        transRows.forEach(function(tr) {
          console.log('  Key: ' + tr.cache_key);
          console.log('  Text: ' + (tr.translated_text || '').substring(0, 200));
          try {
            const m = JSON.parse(tr.translated_by_index);
            console.log('  by_index: ' + JSON.stringify(m).substring(0, 300));
          } catch(e) {
            console.log('  by_index parse error: ' + e.message);
          }
        });

      } else {
        console.log('No OCR cache for this page.');
      }
    });

    db.close();
  } catch (err) {
    console.error('DB error:', err);
  }

  app.quit();
});
