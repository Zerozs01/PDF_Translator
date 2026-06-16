const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.config");
const userDataPath = path.join(appData, 'pdf_translator');
app.name = 'pdf_translator';
app.setPath('userData', userDataPath);

const bboxHeight = (b) => b.y1 - b.y0;
const mergeBBoxes = (boxes) => {
  if (boxes.length === 0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    if (b.x0 < x0) x0 = b.x0;
    if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y1 > y1) y1 = b.y1;
  }
  return { x0, y0, x1, y1 };
};

const splitAggressiveMergedLines = (lines, gapMultiplier = 2.2) => {
  const result = [];
  for (const line of lines) {
    if (!line.words || line.words.length <= 1) {
      result.push(line);
      continue;
    }
    const { words } = line;
    let currentGroup = [words[0]];
    for (let i = 1; i < words.length; i++) {
      const prev = words[i - 1];
      const curr = words[i];
      const prevHeight = bboxHeight(prev.bbox);
      const currHeight = bboxHeight(curr.bbox);
      const avgHeight = (prevHeight + currHeight) * 0.5;
      const gap = curr.bbox.x0 - prev.bbox.x1;
      let effectiveGapMultiplier = gapMultiplier;
      const prevText = prev.text.trim();
      const currText = curr.text.trim();
      if (/[!?.,;]$/.test(prevText)) {
        effectiveGapMultiplier = 0.85;
      } else if (/-$/.test(prevText)) {
        effectiveGapMultiplier = 2.5;
      } else if (/^[A-Z]/.test(currText)) {
        effectiveGapMultiplier = 0.98;
      }
      const absoluteSplitThreshold = 2.0;
      if (gap > effectiveGapMultiplier * avgHeight || gap > absoluteSplitThreshold * avgHeight) {
        result.push({
          ...line,
          text: currentGroup.map(w => w.text).join(' '),
          bbox: mergeBBoxes(currentGroup.map(w => w.bbox)),
          words: currentGroup,
        });
        currentGroup = [curr];
      } else {
        currentGroup.push(curr);
      }
    }
    if (currentGroup.length > 0) {
      result.push({
        ...line,
        text: currentGroup.map(w => w.text).join(' '),
        bbox: mergeBBoxes(currentGroup.map(w => w.bbox)),
        words: currentGroup,
      });
    }
  }
  return result;
};

app.whenReady().then(() => {
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
  const db = new Database(dbPath);
  db.pragma("cipher='sqlcipher'");
  db.pragma(`key = '${masterPassword.replace(/'/g, "''")}'`);

  const r = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 58 AND page_number = 2').get();
  if (r) {
    const ocr = JSON.parse(r.ocr_data);
    const rawLines = ocr.lines;
    const linesWithIndex = rawLines.map((line, idx) => ({ ...line, originalIndex: idx }));
    const splitLines = splitAggressiveMergedLines(linesWithIndex, 2.2);
    console.log(`Original line count: ${rawLines.length}`);
    console.log(`Split line count: ${splitLines.length}`);
    splitLines.forEach((l, idx) => {
      console.log(`Split Index ${idx}: text="${l.text}" originalIndex=${l.originalIndex}`);
    });
  }

  db.close();
  app.quit();
});
