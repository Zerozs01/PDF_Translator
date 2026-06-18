const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3-multiple-ciphers');

app.name = 'pdf_translator';

app.whenReady().then(() => {
  try {
    const userDataPath = path.join(app.getPath('appData'), 'pdf_translator');
    const configPath = path.join(userDataPath, 'authConfig.json');
    
    if (!fs.existsSync(configPath)) {
      console.log('No authConfig.json found!');
      app.exit(0);
      return;
    }
    
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let key = null;
    if (config.appMode === 'RELAX' && config.encryptedMaster) {
      const encryptedBuffer = Buffer.from(config.encryptedMaster, 'hex');
      key = safeStorage.decryptString(encryptedBuffer);
    }
    
    const dbPath = path.join(userDataPath, 'pdf_translator.db');
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    if (key) {
      db.pragma(`key = '${key.replace(/'/g, "''")}'`);
    }
    
    const docId = 3;
    const pageNum = 3;
    const caches = db.prepare("SELECT ocr_engine, ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?").all(docId, pageNum);
    
    for (const cache of caches) {
      console.log(`\nEngine: ${cache.ocr_engine}`);
      const ocrData = JSON.parse(cache.ocr_data);
      (ocrData.lines || []).forEach((l, idx) => {
        console.log(`[Line ${idx}] text="${l.text}" BBox=${JSON.stringify(l.bbox)}`);
      });
    }
  } catch (error) {
    console.error('Error in script:', error);
  } finally {
    app.exit(0);
  }
});
