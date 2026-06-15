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

  module.paths.push('c:/App/Electron/PDF_Translator/node_modules');
  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma("key = '" + masterPassword.replace(/'/g, "''") + "'");

    const tr = db.prepare(
      'SELECT translated_by_index, translated_text FROM translation_cache WHERE document_id = 3 AND page_number = 3'
    ).get();

    if (tr) {
      console.log('--- TRANSLATED TEXT ---');
      console.log(tr.translated_text);
      console.log('--- BY INDEX ---');
      const items = JSON.parse(tr.translated_by_index);
      items.forEach((item) => {
        console.log(`Index ${item.index}: "${item.sourceText}" -> "${item.text}"`);
      });
    } else {
      console.log('No translation cache found for Doc 3 Page 3');
    }
    db.close();
  } catch (err) {
    console.error(err);
  }
  app.quit();
});
