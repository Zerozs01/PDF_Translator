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
    
    // Find documents containing Syunichi
    const docs = db.prepare("SELECT * FROM documents WHERE filename LIKE '%Syunichi%'").all();
    
    for (const doc of docs) {
      console.log(`\n================ Doc ID ${doc.id} (${doc.filename}) Page 8 ================`);
      
      // Get OCR cache for page 8
      const caches = db.prepare("SELECT ocr_engine, updated_at, LENGTH(ocr_data) as len FROM ocr_cache_engine WHERE document_id = ? AND page_number = 8").all(doc.id);
      console.log('Page 8 OCR caches:', caches);
      
      for (const cache of caches) {
        const fullCache = db.prepare("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = 8 AND ocr_engine = ?").get(doc.id, cache.ocr_engine);
        const ocrData = JSON.parse(fullCache.ocr_data);
        console.log(`\nEngine: ${cache.ocr_engine}`);
        console.log('Lines count:', ocrData.lines ? ocrData.lines.length : 0);
        
        console.log('All lines in page 8:');
        (ocrData.lines || []).forEach((l, idx) => {
          console.log(`[Line ${idx}] text="${l.text}" (conf=${l.confidence.toFixed(2)}) BBox=${JSON.stringify(l.bbox)}`);
        });
      }
    }
    
  } catch (error) {
    console.error('Error in script:', error);
  } finally {
    app.exit(0);
  }
});
