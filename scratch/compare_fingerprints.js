const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform === 'darwin'
  ? process.env.HOME + '/Library/Application Support'
  : process.env.HOME + '/.config');
const userDataPath = path.join(appData, 'pdf_translator');
app.name = 'pdf_translator';
app.setPath('userData', userDataPath);

const normalizeFingerprintText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const roundCoord = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric);
};

const buildLineGeometrySignature = (line, index) => {
  const bbox = line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
  const wordCount = Array.isArray(line.words) ? line.words.length : 0;
  return [
    index,
    normalizeFingerprintText(line.text || ''),
    roundCoord(bbox.x0),
    roundCoord(bbox.y0),
    roundCoord(bbox.x1),
    roundCoord(bbox.y1),
    wordCount,
  ].join(':');
};

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
};

const buildOCRSourceFingerprint = (result, fallbackEngine) => {
  const effectiveEngine = result.ocrEngine || fallbackEngine;
  const lines = Array.isArray(result.lines) ? result.lines : [];
  const textSignature = lines
    .map((line, index) => buildLineGeometrySignature(line, index))
    .join('|');

  return [
    result.algorithmVersion,
    effectiveEngine,
    result.pipelineProfile || 'panel',
    result.language || 'eng',
    result.words ? result.words.length : 0,
    lines.length,
    normalizeFingerprintText(result.text || '').length,
    hashString(textSignature),
  ].join('|');
};

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

    const docId = 3;
    const pages = [3, 11, 25];

    pages.forEach(function(pageNum) {
      console.log('\n--- Page ' + pageNum + ' ---');
      const ocrRow = db.prepare('SELECT ocr_engine, ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
      if (!ocrRow) {
        console.log('No OCR Cache data found');
        return;
      }
      const ocrData = JSON.parse(ocrRow.ocr_data);
      const computedFingerprint = buildOCRSourceFingerprint(ocrData, ocrRow.ocr_engine);
      console.log('Computed Fingerprint from OCR:');
      console.log('  ' + computedFingerprint);

      const transRows = db.prepare('SELECT source_fingerprint, cache_key FROM translation_cache WHERE document_id = ? AND page_number = ?').all(docId, pageNum);
      if (transRows.length === 0) {
        console.log('No Translation Cache data found');
        return;
      }
      console.log('Stored Fingerprints in Translation Cache (' + transRows.length + ' rows):');
      transRows.forEach(function(tr) {
        console.log('  Key: ' + tr.cache_key);
        console.log('  Val: ' + tr.source_fingerprint);
        console.log('  Match?: ' + (computedFingerprint === tr.source_fingerprint ? 'YES' : 'NO'));
      });
    });

    db.close();
  } catch (err) {
    console.error('DB error:', err);
  }

  app.quit();
});
