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

  const r = db.prepare('SELECT translated_by_index, translated_text FROM translation_cache WHERE document_id = 58 AND page_number = 2').get();
  if (r) {
    console.log("translated_by_index raw:");
    console.log(r.translated_by_index);
    console.log("\ntranslated_text raw:");
    console.log(JSON.stringify(r.translated_text));
  }

  db.close();
  app.quit();
});
