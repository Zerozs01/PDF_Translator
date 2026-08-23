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

      // Let's inspect shouldLinkGeometryLines for our target lines: 45, 48, 51, 52, 53, 54
      const targets = [45, 48, 51, 52, 53, 54];
      console.log('Target Lines:');
      targets.forEach(idx => {
        const l = lines[idx];
        console.log(`  Line ${idx}: "${l.text}" (box: left=${l.left}, right=${l.right}, top=${l.top}, bottom=${l.bottom}, h=${l.height})`);
      });

      console.log('\n--- Link Decisions between Targets ---');
      const groupingService = require('../src/services/layout/balloonAwareGroupingService');
      
      const baseHeight = Math.max(8, Math.min(...lines.map(l => l.height))); // Wait, let's see how baseHeight is computed in the service
      console.log('Calculated page baseHeight:', baseHeight);

      for (let i = 0; i < targets.length; i++) {
        for (let j = i + 1; j < targets.length; j++) {
          const aIdx = targets[i];
          const bIdx = targets[j];
          const a = lines[aIdx];
          const b = lines[bIdx];

          const preparedA = { ...a, width: a.right - a.left, centerX: (a.left + a.right)*0.5, centerY: (a.top+a.bottom)*0.5, normalizedAngle: 0 };
          const preparedB = { ...b, width: b.right - b.left, centerX: (b.left + b.right)*0.5, centerY: (b.top+b.bottom)*0.5, normalizedAngle: 0 };
          
          // Let's run a test group to get page median vertical gap
          const input = {
            pageNumber: pageNum,
            imageWidth: ocr.width || 1,
            imageHeight: ocr.height || 1,
            lines: lines,
            mode: 'balloon-aware',
            readingMode: 'auto',
          };
          const groupingResult = groupingService.deriveBalloonAwareLayoutGrouping(input);
          
          // We can inspect the groups that these lines actually ended up in
          const groupOfA = groupingResult.groups.find(g => g.lineIndexes.includes(aIdx));
          const groupOfB = groupingResult.groups.find(g => g.lineIndexes.includes(bIdx));
          
          console.log(`Pair (${aIdx}, ${bIdx}): "${a.text}" / "${b.text}"`);
          console.log(`  Group of A: ${groupOfA ? groupOfA.id : 'ungrouped'}`);
          console.log(`  Group of B: ${groupOfB ? groupOfB.id : 'ungrouped'}`);
        }
      }

    }

    db.close();
  } catch (err) {
    console.error('Database query failed:', err);
  }

  app.quit();
});
