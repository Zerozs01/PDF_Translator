const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
const userDataPath = path.join(appData, 'pdf_translator');
app.name = 'pdf_translator';
app.setPath('userData', userDataPath);

app.whenReady().then(function() {
  const configPath = path.join(userDataPath, 'authConfig.json');
  if (!fs.existsSync(configPath)) { app.quit(); return; }

  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let masterPassword = '';
  if (configData.encryptedMaster) {
    try {
      masterPassword = safeStorage.decryptString(Buffer.from(configData.encryptedMaster, 'hex'));
    } catch (e) { console.error('Decrypt error:', e); }
  }
  if (!masterPassword) { app.quit(); return; }

  module.paths.push('c:/App/Electron/PDF_Translator/node_modules');
  const Database = require('better-sqlite3-multiple-ciphers');
  const db = new Database(path.join(userDataPath, 'pdf_translator.db'));
  db.pragma("cipher='sqlcipher'");
  db.pragma("key = '" + masterPassword.replace(/'/g, "''") + "'");

  try {
    // Check OCR cache algorithm_version for doc 3
    const ocrRows = db.prepare(
      'SELECT page_number, algorithm_version FROM ocr_cache_engine WHERE document_id = 3 ORDER BY page_number'
    ).all();
    console.log('OCR cache algorithm_version for doc 3:');
    ocrRows.forEach(function(r) {
      console.log('  Page ' + r.page_number + ': algorithm_version=' + r.algorithm_version);
    });

    // Check translation cache sourceFingerprint for doc 3
    const transRows = db.prepare(
      'SELECT page_number, source_fingerprint, cache_key FROM translation_cache WHERE document_id = 3 ORDER BY page_number'
    ).all();
    console.log('\nTranslation cache source_fingerprint for doc 3:');
    transRows.forEach(function(r) {
      console.log('  Page ' + r.page_number + ': fingerprint=' + (r.source_fingerprint || 'NULL') + ' key=' + (r.cache_key || '').substring(0, 60));
    });

    db.close();
  } catch(e) { console.error('DB error:', e); }

  app.quit();
});
