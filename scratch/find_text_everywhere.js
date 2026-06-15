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

  // Ensure node_modules path is resolved correctly
  module.paths.push('c:/App/Electron/PDF_Translator/node_modules');
  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma(`key = '${masterPassword.replace(/'/g, "''")}'`);

    const engineRows = db.prepare('SELECT document_id, page_number, ocr_engine, ocr_data FROM ocr_cache_engine').all();
    console.log(`Checking ${engineRows.length} rows in ocr_cache_engine...`);
    for (const r of engineRows) {
      const ocr = JSON.parse(r.ocr_data);
      ocr.lines.forEach((l, idx) => {
        const txt = l.text.toUpperCase();
        if (txt.includes('LUDMER')) {
          console.log(`[ocr_cache_engine] MATCH! Doc ${r.document_id} Page ${r.page_number} (${r.ocr_engine}) Line ${idx}: "${l.text}"`);
        }
      });
    }

    const transRows = db.prepare('SELECT document_id, page_number, translated_text FROM translation_cache').all();
    console.log(`Checking ${transRows.length} rows in translation_cache...`);
    for (const r of transRows) {
      const txt = (r.translated_text || '').toUpperCase();
      if (txt.includes('LUDMER') || txt.includes('ROSERIA') || txt.includes('STALEMATE') || txt.includes('WAR')) {
        console.log(`[translation_cache] MATCH! Doc ${r.document_id} Page ${r.page_number}: "${txt.substring(0, 150)}"`);
      }
    }

    const sentenceRows = db.prepare('SELECT source_text, translated_text FROM sentence_translation_cache').all();
    console.log(`Checking ${sentenceRows.length} rows in sentence_translation_cache...`);
    for (const r of sentenceRows) {
      const src = (r.source_text || '').toUpperCase();
      if (src.includes('LUDMER') || src.includes('ROSERIA') || src.includes('STALEMATE')) {
        console.log(`[sentence_translation_cache] MATCH! Src: "${r.source_text}" -> Trans: "${r.translated_text}"`);
      }
    }

    db.close();
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
