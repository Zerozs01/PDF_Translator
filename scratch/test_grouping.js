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

    const docId = 3;
    const pageNum = 7;

    const row = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ? AND ocr_engine = ?').get(docId, pageNum, 'paddleocr');
    if (row) {
      const ocr = JSON.parse(row.ocr_data);
      const lines = ocr.lines.map((line, idx) => ({
        index: idx,
        text: line.text,
        sourceLength: line.text.length,
        top: line.bbox.y0,
        bottom: line.bbox.y1,
        left: line.bbox.x0,
        right: line.bbox.x1,
        height: line.bbox.y1 - line.bbox.y0,
        area: (line.bbox.x1 - line.bbox.x0) * (line.bbox.y1 - line.bbox.y0),
        confidence: line.confidence || 0.9,
      }));

      // Run balloonAwareGroupingService
      const groupingService = require('../src/services/layout/balloonAwareGroupingService');
      const input = {
        pageNumber: pageNum,
        imageWidth: ocr.width || 1,
        imageHeight: ocr.height || 1,
        lines: lines,
        mode: 'balloon-aware',
        readingMode: 'auto',
      };
      
      const result = groupingService.deriveBalloonAwareLayoutGrouping(input);
      console.log('\n--- Grouping Results ---');
      result.groups.forEach((group, gIdx) => {
        const texts = group.orderedLineIndexes.map(idx => `[Line ${idx}: "${lines[idx].text}"]`).join(', ');
        const matchesStinky = group.orderedLineIndexes.some(idx => lines[idx].text.toLowerCase().includes('stinky') || lines[idx].text.toLowerCase().includes('pussy'));
        if (matchesStinky) {
          console.log(`Group ${gIdx} (id: ${group.id}): ${texts}`);
        }
      });
      
      console.log('\nUngrouped Lines containing stinky/pussy/ugh/haa:');
      result.ungroupedLineIndexes.forEach(idx => {
        const text = lines[idx].text;
        if (text.toLowerCase().includes('stinky') || text.toLowerCase().includes('pussy') || text.toLowerCase().includes('ugh') || text.toLowerCase().includes('haa') || text.toLowerCase().includes('6o')) {
          console.log(`  Line ${idx}: "${text}"`);
        }
      });
    }

    db.close();
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
