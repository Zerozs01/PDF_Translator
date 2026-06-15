const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform === 'darwin'
  ? process.env.HOME + '/Library/Application Support'
  : process.env.HOME + '/.config');
const userDataPath = path.join(appData, 'pdf_translator');
app.name = 'pdf_translator';
app.setPath('userData', userDataPath);

// จำลองฟังก์ชันต่างๆ จาก translationOverlayUtils.ts และ ocrSafetyLineDedup.ts
const normalizeOverlayInlineText = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const isKnownShortWordHelper = (asciiCompact) => {
  return /^[IAO]$/i.test(asciiCompact) || 
    /^(?:OK|NO|HI|OH|AM|AN|AS|AT|BE|BY|DO|GO|HE|IF|IN|IS|IT|ME|MY|OF|ON|OR|SO|TO|UP|US|WE|YE|AH|HA|EH|UH|LO|YA|UM|YES|FOR|AND|BUT|YOU|THE|NOT|HER|HIS|HIM|SHE|CAN|OUT|GET|HOW|WHO|WHY|HEY|BOY|RUN|SAY|SEE|MAN|OUR|DAY|NEW|TOO|ALL|ANY|BAD|BIG|CRY|DID|EAT|END|FAR|FIT|FLY|FUN|GUY|HOT|ITS|JOB|KEY|LET|LIE|LOT|MAD|MAY|MOM|DAD|OLD|ONE|TWO|OWN|PAY|SAD|SON|TRY|USE|WAY|WIN|YET|WOW|YAY|YEP|NAH|NOP|DIE|PIG|CUM|COCK|OHHH|OHHHH|OHHHHH|AGAA|MORE|YOURE|STOOOOP|STOAOOP|STOAAOP|LIKETHIS|LIKE|WASTOYED|UPLOOKING|SIR|YESSIR|QUCK|QUICK|USTHE|NOWI|II|IIM|ONA|YYOU|IIS|IIT|IIN|SSHE|HHE|TTHEY|WWE|TTHIS|TTHAT|NNO|MME|III|MEEE|MEEEE|5O|S0|6O|OFME|EROMANGA|OFMEEROMANGA|BLOWJOB|IM|NURSE|BEINGTOO|SUDDENLY|ILL|RESTA|THESEX|WELLSINCE|JUST|ILLNESSBE|METHOD|FROMTHE|ITFEELS|OUTINSIDE|STILLFULL|BLOWTOB|NOU|DISEASE|FOUNDA|II333S|S3HS|INSIDEI|INSIDE|WHTTTTT|RESTRAINT|GOO|IHNH|ISIHS|2IHG|EIH3|IIMOM|OD111|VAYS|BEEELEE|WNTTTT|HERPUSSY|WOMB|MING|CUMMING|WAYTOO|GOOD|TOMAKETHREADS|MYCUM|THATS|NOTNECESSARY|ADYDO|UMEAN|WERE|PLEASE|YQURE|WIDLY|SIDESHOW|CAME|COOOOOOCKS|COOOOOCKS|COOOOCKS|COOOCKS|COOCKS|COCKS|ONEONONE|CUMALOTJUSTLIKETHAT|MUCH|FOOL|SOW|NONSTOP|HA|HEHE|HEHEHE|MEEEEEEE|MEEEEEE|MEEEEE|CHARGE|ASS|HOLE|ASSHOLE|GONNADIE|TOBEDEADNOW|SOPLEASE|ONEBATTLE|WHY|WITHIT|SIDE|THING|WITH|CUMMING)$/i.test(asciiCompact);
};

const normalizeOverlayBBox = (bbox) => {
  if (!bbox) return undefined;
  const x0 = Number(bbox.x0);
  const y0 = Number(bbox.y0);
  const x1 = Number(bbox.x1);
  const y1 = Number(bbox.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return undefined;
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  };
};

const resolveOverlaySourceBBox = (line) => {
  const lineBBox = normalizeOverlayBBox(line.bbox);
  if (!lineBBox) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  const words = Array.isArray(line.words) ? line.words : [];
  const validWords = words
    .map((w) => normalizeOverlayBBox(w?.bbox))
    .filter(Boolean);
  if (validWords.length === 0) return lineBBox;
  return {
    x0: Math.min(lineBBox.x0, ...validWords.map((w) => w.x0)),
    y0: Math.min(lineBBox.y0, ...validWords.map((w) => w.y0)),
    x1: Math.max(lineBBox.x1, ...validWords.map((w) => w.x1)),
    y1: Math.max(lineBBox.y1, ...validWords.map((w) => w.y1)),
  };
};

const resolveOverlayMaskBBox = (line) => {
  const sourceBbox = resolveOverlaySourceBBox(line);
  const normalizedLineBBox = normalizeOverlayBBox(line.bbox);
  if (!normalizedLineBBox) return sourceBbox;
  return {
    x0: Math.min(normalizedLineBBox.x0, sourceBbox.x0),
    y0: Math.min(normalizedLineBBox.y0, sourceBbox.y0),
    x1: Math.max(normalizedLineBBox.x1, sourceBbox.x1),
    y1: Math.max(normalizedLineBBox.y1, sourceBbox.y1),
  };
};

const hasPositiveBBox = (bbox) => {
  if (!bbox) return false;
  return (Number(bbox.x1 || 0) - Number(bbox.x0 || 0)) > 0
    && (Number(bbox.y1 || 0) - Number(bbox.y0 || 0)) > 0;
};

const overlayDedupIou = (a, b) => {
  const interX0 = Math.max(a.x0, b.x0);
  const interY0 = Math.max(a.y0, b.y0);
  const interX1 = Math.min(a.x1, b.x1);
  const interY1 = Math.min(a.y1, b.y1);
  if (interX1 <= interX0 || interY1 <= interY0) return 0;
  const interArea = (interX1 - interX0) * (interY1 - interY0);
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  const unionArea = areaA + areaB - interArea;
  return interArea / Math.max(1, unionArea);
};

const shouldSkipOverlayRenderForSuspiciousLine = (line) => {
  const tText = normalizeOverlayInlineText(String(line.text || ''));
  const tCompact = tText.replace(/\s+/g, '');
  const asciiCompact = tCompact.replace(/[^A-Za-z0-9]/g, '');
  const isKnownShortWord = isKnownShortWordHelper(asciiCompact);
  if (isKnownShortWord) {
    return { shouldSkip: false, reason: 'isKnownShortWord' };
  }

  const sourceBbox = resolveOverlaySourceBBox(line);
  const maskBbox = resolveOverlayMaskBBox(line);

  const sourceWidth = Math.max(1, sourceBbox.x1 - sourceBbox.x0);
  const sourceHeight = Math.max(1, sourceBbox.y1 - sourceBbox.y0);
  const sourceArea = sourceWidth * sourceHeight;
  const maskWidth = Math.max(1, maskBbox.x1 - maskBbox.x0);
  const maskHeight = Math.max(1, maskBbox.y1 - maskBbox.y0);
  const maskArea = maskWidth * maskHeight;
  const coverage = sourceArea / Math.max(1, maskArea);

  const normalizedText = normalizeOverlayInlineText(String(line.text || ''));
  const compact = normalizedText.replace(/\s+/g, '');
  const meaningfulChars = compact.replace(/[^\p{L}\p{N}]/gu, '');
  const tokenCount = normalizedText.split(/\s+/g).filter(Boolean).length;
  const sentenceLikeSignal = tokenCount >= 3 || (tokenCount >= 2 && meaningfulChars.length >= 10);
  const hasTerminalPunctuation = /[.!?…]\s*$/.test(normalizedText);
  const angledLine = Math.abs(Number(line.angleDeg || 0)) >= 10 && Array.isArray(line.quad) && line.quad.length >= 2;
  if (angledLine && meaningfulChars.length >= 2) {
    return { shouldSkip: false, reason: 'angledLine' };
  }
  const validWords = (Array.isArray(line.words) ? line.words : []).filter((word) => {
    const wordText = normalizeOverlayInlineText(String(word?.text || ''));
    return Boolean(wordText) && hasPositiveBBox(word?.bbox);
  });

  const sparseSignal = meaningfulChars.length <= 6 && validWords.length <= 1 && tokenCount <= 2;
  const lowConfidence = Number(line.confidence || 0) <= 93;

  // 1. Existing oversized mask condition
  const oversizedMask = maskArea >= 17000 && (maskWidth >= 170 || maskHeight >= 96);
  const severeSourceLoss = coverage < 0.24 && maskArea >= sourceArea * 3.2;
  if (sparseSignal && oversizedMask && severeSourceLoss && lowConfidence && !sentenceLikeSignal && !hasTerminalPunctuation) {
    return { shouldSkip: true, reason: 'oversizedMaskCondition', details: { sparseSignal, oversizedMask, severeSourceLoss, lowConfidence, sentenceLikeSignal, hasTerminalPunctuation } };
  }

  // 2. Giant sparse/empty border or panel boxes that contain almost no characters
  const isLargeSparsePanelBox = maskArea >= 10000 && meaningfulChars.length <= 4 && !hasTerminalPunctuation;
  if (isLargeSparsePanelBox && lowConfidence && !sentenceLikeSignal) {
    return { shouldSkip: true, reason: 'largeSparsePanelBox', details: { maskArea, meaningfulCharsLength: meaningfulChars.length, lowConfidence, sentenceLikeSignal } };
  }

  // 3. Tall narrow vertical noise lines
  const isTallNarrowVerticalNoise = maskWidth < 22 && maskHeight > 35 && (maskHeight / maskWidth) > 2.0 && meaningfulChars.length <= 6;
  if (isTallNarrowVerticalNoise && !hasTerminalPunctuation && !sentenceLikeSignal) {
    return { shouldSkip: true, reason: 'tallNarrowVerticalNoise', details: { maskWidth, maskHeight, ratio: maskHeight / maskWidth, meaningfulCharsLength: meaningfulChars.length } };
  }

  // 4. Extremely thin horizontal noise lines
  const isThinHorizontalNoise = maskHeight < 10 && maskWidth > 50 && (maskWidth / maskHeight) > 6.0 && meaningfulChars.length <= 4;
  if (isThinHorizontalNoise && !hasTerminalPunctuation && !sentenceLikeSignal) {
    return { shouldSkip: true, reason: 'thinHorizontalNoise', details: { maskWidth, maskHeight, ratio: maskWidth / maskHeight, meaningfulCharsLength: meaningfulChars.length } };
  }

  return { shouldSkip: false, reason: 'passedAllChecks' };
};

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
    const pageNum = 25;

    const row = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
    if (row) {
      const ocr = JSON.parse(row.ocr_data);
      const lines = ocr.lines || [];
      console.log('Total OCR lines:', lines.length);

      lines.forEach(function(l, idx) {
        const result = shouldSkipOverlayRenderForSuspiciousLine(l);
        const bbox = l.bbox || {};
        const width = bbox.x1 - bbox.x0;
        const height = bbox.y1 - bbox.y0;
        const area = width * height;
        
        console.log('[' + idx + '] "' + l.text + '" conf=' + Math.round(l.confidence || 0) + ' area=' + Math.round(area) + ' w=' + Math.round(width) + ' h=' + Math.round(height));
        console.log('    Skip?: ' + result.shouldSkip + ' | Reason: ' + result.reason + (result.details ? ' | Details: ' + JSON.stringify(result.details) : ''));
      });
    }

    db.close();
  } catch (err) {
    console.error(err);
  }
  app.quit();
});
