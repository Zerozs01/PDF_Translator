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

    const rows = db.prepare('SELECT document_id, page_number, ocr_data FROM ocr_cache_engine').all();
    console.log(`Scanning ${rows.length} rows...`);

    for (const row of rows) {
      const ocr = JSON.parse(row.ocr_data);
      const textSample = ocr.lines.map(l => l.text).join(' ');
      
      const searchTerms = ['stinky', 'pussy'];
      const matched = searchTerms.some(term => textSample.toLowerCase().includes(term));
      
      if (matched) {
        console.log(`\n================ MATCH FOUND ================`);
        console.log(`Doc ID: ${row.document_id}, Page Number: ${row.page_number}`);
        ocr.lines.forEach((l, idx) => {
          if (l.text.toLowerCase().includes('stinky') || l.text.toLowerCase().includes('pussy') || l.text.toLowerCase().includes('ugh') || l.text.toLowerCase().includes('haa')) {
            console.log(`  Line ${idx}: "${l.text}" (box: x0=${l.bbox.x0.toFixed(1)}, y0=${l.bbox.y0.toFixed(1)}, x1=${l.bbox.x1.toFixed(1)}, y1=${l.bbox.y1.toFixed(1)})`);
          }
        });

        // Get translations
        const transRows = db.prepare('SELECT translated_by_index, translated_text, cache_key FROM translation_cache WHERE document_id = ? AND page_number = ?').all(row.document_id, row.page_number);
        for (const tr of transRows) {
          console.log(`\nTranslation cache (${tr.cache_key}):`);
          try {
            const data = JSON.parse(tr.translated_by_index);
            const filtered = data.filter(item => 
              item.sourceText.toLowerCase().includes('stinky') || 
              item.sourceText.toLowerCase().includes('pussy') || 
              item.sourceText.toLowerCase().includes('ugh') || 
              item.sourceText.toLowerCase().includes('haa')
            );
            console.log('translatedByIndex parsed (filtered):', JSON.stringify(filtered, null, 2));
          } catch (e) {
            console.log('Raw Translation text:', tr.translated_text.slice(0, 200));
          }
        }
      }
    }

    db.close();
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
