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
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  let masterPassword = '';
  if (configData.encryptedMaster) {
    const encryptedBuffer = Buffer.from(configData.encryptedMaster, 'hex');
    masterPassword = safeStorage.decryptString(encryptedBuffer);
  }

  module.paths.push('c:/App/Electron/PDF_Translator/node_modules');
  const Database = require('better-sqlite3-multiple-ciphers');
  const dbPath = path.join(userDataPath, 'pdf_translator.db');

  try {
    const db = new Database(dbPath);
    db.pragma("cipher='sqlcipher'");
    db.pragma("key = '" + masterPassword.replace(/'/g, "''") + "'");

    const docId = 3;
    const pageNum = 11;

    const ocrRow = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
    if (ocrRow) {
      const ocr = JSON.parse(ocrRow.ocr_data);
      const line = ocr.lines[41];
      console.log('--- Line 41 Info ---');
      console.log('Text:', line.text);
      console.log('Conf:', line.confidence);
      console.log('BBox:', line.bbox);
      
      const width = line.bbox.x1 - line.bbox.x0;
      const height = line.bbox.y1 - line.bbox.y0;
      const area = width * height;
      const compact = (line.text || '').replace(/\s+/g, '');
      const asciiCompact = compact.replace(/[^A-Za-z0-9]/g, '');
      
      console.log('Width:', width, 'Height:', height, 'Area:', area);
      console.log('compact.length:', compact.length, 'asciiCompact:', asciiCompact);
      
      // คำนวณ wordCoverage
      const words = line.words || [];
      console.log('Words count:', words.length);
      words.forEach((w, idx) => console.log(`  Word[${idx}]: "${w.text}" bbox:`, w.bbox, 'conf:', w.confidence));
    }

    db.close();
  } catch (err) {
    console.error(err);
  }
  app.quit();
});
