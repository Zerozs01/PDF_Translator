/**
 * clear_korean_doc58_p2.js
 * ล้าง translation_cache สำหรับ Doc 58 Page 2 (Korean test ocr.pdf)
 * เพื่อบังคับให้แปลใหม่ด้วย pipeline ล่าสุดที่ได้รับการแก้ไขแล้ว
 */
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

    console.log('=== Clearing Korean Translation Cache for Doc 58 (Korean test ocr.pdf) ===');
    
    // ดูว่ามีหน้าไหนบ้างในเอกสารนี้
    const allPages = db.prepare('SELECT DISTINCT page_number FROM translation_cache WHERE document_id = 58 ORDER BY page_number').all();
    console.log('Pages with translation cache for Doc 58:', allPages.map(r => r.page_number).join(', '));

    // ล้าง translation_cache ทุกหน้าของ Doc 58
    const deleteResult = db.prepare('DELETE FROM translation_cache WHERE document_id = 58').run();
    console.log(`Deleted ${deleteResult.changes} rows from translation_cache for Doc 58`);

    // ล้าง sentence_translation_cache ที่มี Korean text ใน source
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sentence_translation_cache'").get();
    if (tableExists) {
      const cols = db.prepare("PRAGMA table_info(sentence_translation_cache)").all();
      console.log('sentence_translation_cache columns:', cols.map(c => c.name).join(', '));
      // ดู column name ที่ถูก
      const sourceCol = cols.find(c => c.name === 'source_text') ? 'source_text' : 
                        cols.find(c => c.name === 'input_text') ? 'input_text' : null;
      if (sourceCol) {
        const deleteKorean = db.prepare(`
          DELETE FROM sentence_translation_cache 
          WHERE ${sourceCol} GLOB '*[가-힣]*'
        `).run();
        console.log(`Deleted ${deleteKorean.changes} Korean sentences from sentence_translation_cache`);
      } else {
        console.log('Cannot identify source column in sentence_translation_cache');
      }
    }

    db.close();
    console.log('\n✅ Cache cleared! Please retranslate Doc 58 in the app.');
  } catch (err) {
    console.error('DB error:', err);
  }

  app.quit();
});
