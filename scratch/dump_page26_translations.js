const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.config");
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

  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key = '${masterPassword.replace(/'/g, "''")}'`);

    console.log('--- Dumping translation_cache for Doc 3 Page 26 ---');
    const transRows = db.prepare('SELECT translated_by_index, translated_text, cache_key FROM translation_cache WHERE document_id = ? AND page_number = ?').all(3, 26);
    transRows.forEach((tr, tIdx) => {
      console.log(`\nRow ${tIdx}: Key = ${tr.cache_key}`);
      try {
        const parsed = JSON.parse(tr.translated_by_index);
        console.log('Parsed translated_by_index:');
        parsed.forEach(item => {
          console.log(`  Index ${item.index}: Source="${item.sourceText}" -> Translated="${item.text}"`);
        });
      } catch (e) {
        console.log('Could not parse JSON:', e.message);
      }
    });

    db.close();
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
