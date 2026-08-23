const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform === 'darwin'
  ? process.env.HOME + '/Library/Application Support'
  : process.env.HOME + '/.config');
const userDataPath = path.join(appData, 'pdf_translator');
app.name = 'pdf_translator';
app.setPath('userData', userDataPath);

app.whenReady().then(() => {
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

    const rows = db.prepare('SELECT id, filename, filepath, total_pages FROM documents').all();
    console.log('--- DOCUMENTS ---');
    rows.forEach(r => {
      console.log(`ID: ${r.id} | Name: "${r.filename}" | Pages: ${r.total_pages} | Path: ${r.filepath}`);
    });

    db.close();
  } catch (err) {
    console.error('DB error:', err);
  }
  app.quit();
});
