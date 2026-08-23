const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform === 'darwin'
  ? process.env.HOME + '/Library/Application Support'
  : process.env.HOME + '/.config');
const userDataPath = path.join(appData, 'pdf_translator');
app.name = 'pdf_translator';
app.setPath('userData', userDataPath);

// ==========================================
// FULL LOGIC WITH CONSOLE LOGS FOR LINE 41
// ==========================================
const normalizeWhitespace = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const isKnownShortWordHelper = (asciiCompact) => {
  return /^[IAO]$/i.test(asciiCompact) || 
    /^(?:OK|NO|HI|OH|AM|AN|AS|AT|BE|BY|DO|GO|HE|IF|IN|IS|IT|ME|MY|OF|ON|OR|SO|TO|UP|US|WE|YE|AH|HA|EH|UH|LO|YA|UM|YES|FOR|AND|BUT|YOU|THE|NOT|HER|HIS|HIM|SHE|CAN|OUT|GET|HOW|WHO|WHY|HEY|BOY|RUN|SAY|SEE|MAN|OUR|DAY|NEW|TOO|ALL|ANY|BAD|BIG|CRY|DID|EAT|END|FAR|FIT|FLY|FUN|GUY|HOT|ITS|JOB|KEY|LET|LIE|LOT|MAD|MAY|MOM|DAD|OLD|ONE|TWO|OWN|PAY|SAD|SON|TRY|USE|WAY|WIN|YET|WOW|YAY|YEP|NAH|NOP|DIE|PIG|CUM|COCK|OHHH|OHHHH|OHHHHH|AGAA|MORE|YOURE|STOOOOP|STOAOOP|STOAAOP|LIKETHIS|LIKE|WASTOYED|UPLOOKING|SIR|YESSIR|QUCK|QUICK|USTHE|NOWI|II|IIM|ONA|YYOU|IIS|IIT|IIN|SSHE|HHE|TTHEY|WWE|TTHIS|TTHAT|NNO|MME|III|MEEE|MEEEE|5O|S0|6O|OFME|EROMANGA|OFMEEROMANGA|BLOWJOB|IM|NURSE|BEINGTOO|SUDDENLY|ILL|RESTA|THESEX|WELLSINCE|JUST|ILLNESSBE|METHOD|FROMTHE|ITFEELS|OUTINSIDE|STILLFULL|BLOWTOB|NOU|DISEASE|FOUNDA|II333S|S3HS|INSIDEI|INSIDE|WHTTTTT|RESTRAINT|GOO|IHNH|ISIHS|2IHG|EIH3|IIMOM|OD111|VAYS|BEEELEE|WNTTTT|HERPUSSY|WOMB|MING|CUMMING|WAYTOO|GOOD|TOMAKETHREADS|MYCUM|THATS|NOTNECESSARY|ADYDO|UMEAN|WERE|PLEASE|YQURE|WIDLY|SIDESHOW|CAME|COOOOOOCKS|COOOOOCKS|COOOOCKS|COOOCKS|COOCKS|COCKS|ONEONONE|CUMALOTJUSTLIKETHAT|MUCH|FOOL|SOW|NONSTOP|HA|HEHE|HEHEHE|MEEEEEEE|MEEEEEE|MEEEEE|CHARGE|ASS|HOLE|ASSHOLE|GONNADIE|TOBEDEADNOW|SOPLEASE|ONEBATTLE|WHY|WITHIT|SIDE|THING|WITH|CUMMING)$/i.test(asciiCompact);
};

const scoreSourceLineReadability = (text) => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return -1000;
  const hasLatin = /[A-Za-z]/.test(normalized);
  if (!hasLatin) return normalized.length * 0.22;
  const tokens = normalized.split(/\s+/g).filter(Boolean);
  let score = 0;
  let weirdTokens = 0;
  for (const token of tokens) {
    const clean = token.replace(/[^A-Za-z]/g, '');
    if (!clean) continue;
    const lower = clean.toLowerCase();
    score += Math.min(clean.length, 14) * 0.75;
    if (/[aeiou]/i.test(clean)) {
      score += 1.7;
    } else {
      weirdTokens += 1;
      score -= 3.1;
    }
  }
  score -= weirdTokens * 0.85;
  return score;
};

const computeLineWordUnionCoverage = (line) => {
  if (!line?.bbox) return 0;
  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => {
      const text = normalizeWhitespace(String(word?.text || ''));
      const bbox = word?.bbox;
      if (!text || !bbox) return false;
      return (bbox.x1 - bbox.x0) > 0 && (bbox.y1 - bbox.y0) > 0;
    });
  if (validWords.length === 0) return 0;

  const lineWidth = Math.max(1, Number(line.bbox.x1 || 0) - Number(line.bbox.x0 || 0));
  const lineHeight = Math.max(1, Number(line.bbox.y1 || 0) - Number(line.bbox.y0 || 0));
  const lineArea = Math.max(1, lineWidth * lineHeight);

  let unionX0 = Number.POSITIVE_INFINITY;
  let unionY0 = Number.POSITIVE_INFINITY;
  let unionX1 = Number.NEGATIVE_INFINITY;
  let unionY1 = Number.NEGATIVE_INFINITY;
  validWords.forEach((word) => {
    const bbox = word.bbox;
    unionX0 = Math.min(unionX0, bbox.x0);
    unionY0 = Math.min(unionY0, bbox.y0);
    unionX1 = Math.max(unionX1, bbox.x1);
    unionY1 = Math.max(unionY1, bbox.y1);
  });

  const unionArea = Math.max(1, (unionX1 - unionX0) * (unionY1 - unionY0));
  return Math.max(0, Math.min(1.8, unionArea / lineArea));
};

const isLikelyGhostTranslatableLineDebug = (
  line,
  resolvedText,
  engineHint,
  pageWidth,
  pageHeight
) => {
  const text = normalizeWhitespace(String(resolvedText || ''));
  if (!text) return true;
  if (!line?.bbox) return false;

  const pageWidthVal = pageWidth && pageWidth > 0 ? pageWidth : 1200;
  const scale = 1200 / pageWidthVal;

  const scaledLine = scale === 1.0 ? line : {
    ...line,
    bbox: {
      x0: line.bbox.x0 * scale,
      y0: line.bbox.y0 * scale,
      x1: line.bbox.x1 * scale,
      y1: line.bbox.y1 * scale,
    },
    words: Array.isArray(line.words)
      ? line.words.map((word) => ({
          ...word,
          bbox: {
            x0: word.bbox.x0 * scale,
            y0: word.bbox.y0 * scale,
            x1: word.bbox.x1 * scale,
            y1: word.bbox.y1 * scale,
          },
        }))
      : [],
  };

  const width = Math.max(1, Number(scaledLine.bbox.x1 || 0) - Number(scaledLine.bbox.x0 || 0));
  const height = Math.max(1, Number(scaledLine.bbox.y1 || 0) - Number(scaledLine.bbox.y0 || 0));
  const area = Math.max(1, width * height);
  const compact = text.replace(/\s+/g, '');
  const asciiCompact = compact.replace(/[^A-Za-z0-9]/g, '');
  const latinCompact = compact.replace(/[^A-Za-z]/g, '');
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(compact);
  const cjkCompact = compact.replace(/[^\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownChars = compact.replace(/[A-Za-z0-9\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownCharRatio = unknownChars.length / Math.max(1, compact.length);
  const isKnownShortWord = isKnownShortWordHelper(asciiCompact);

  const validWords = (Array.isArray(scaledLine.words) ? scaledLine.words : []).filter((word) => {
    const wordText = normalizeWhitespace(String(word?.text || ''));
    const bbox = word?.bbox;
    if (!wordText || !bbox) return false;
    return (bbox.x1 - bbox.x0) > 0 && (bbox.y1 - bbox.y0) > 0;
  });
  const sourceTokenCount = text.split(/\s+/g).filter(Boolean).length;
  const wordCount = Math.max(validWords.length, sourceTokenCount);
  const confidenceSamples = validWords.length > 0
    ? validWords.map((word) => Number(word.confidence || 0))
    : [Number(scaledLine.confidence || 0)];
  const avgConfidence = confidenceSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, confidenceSamples.length);
  const readability = scoreSourceLineReadability(text);
  const wordCoverage = computeLineWordUnionCoverage(scaledLine);

  console.log('--- DEBUG INFO FOR LINE 41 ---');
  console.log('avgConfidence:', avgConfidence);
  console.log('readability:', readability);
  console.log('wordCoverage:', wordCoverage);
  console.log('wordCount:', wordCount);
  console.log('validWords.length:', validWords.length);
  console.log('scale:', scale);
  console.log('scaled width:', width, 'height:', height, 'area:', area);

  if (isKnownShortWord) {
    console.log('Match: isKnownShortWord');
    return false;
  }

  const isPureSymbolNoise = !hasCjkOrThai && asciiCompact.length === 0;
  if (isPureSymbolNoise) {
    console.log('Match: isPureSymbolNoise');
    return true;
  }

  const isVerticalLineJunk = !hasCjkOrThai && /^[lI1|!/\\_\-]+$/i.test(compact) && !/^[IAO]$/i.test(asciiCompact);
  if (isVerticalLineJunk) {
    console.log('Match: isVerticalLineJunk');
    return true;
  }

  const isSingleCharJunk = !hasCjkOrThai && asciiCompact.length === 1 && !/^[IAO]$/i.test(asciiCompact);
  if (isSingleCharJunk) {
    console.log('Match: isSingleCharJunk');
    return true;
  }

  const isExternalEngine = engineHint === 'paddleocr' || scaledLine?.sourceEngine === 'paddleocr' || engineHint === 'easyocr' || scaledLine?.sourceEngine === 'easyocr';
  const isTinyJunkBox = !hasCjkOrThai
    && asciiCompact.length <= 3
    && area <= 8000
    && (isExternalEngine ? avgConfidence <= 98 : avgConfidence <= 85)
    && !isKnownShortWord;
  if (isTinyJunkBox) {
    console.log('Match: isTinyJunkBox');
    return true;
  }

  const giantLineBox = (
    (width >= 180 && height >= 110 && area >= 18000)
    || (width >= 132 && height >= 88 && area >= 12000 && wordCoverage <= 0.2)
    || (width >= 320 && height >= 98 && area >= 32000)
  );
  const noWordOversizedShortPhrase = validWords.length === 0
    && wordCount >= 2
    && wordCount <= 6
    && compact.length <= 30
    && area >= 17000
    && (width >= 170 || height >= 96)
    && (area / Math.max(1, compact.length)) >= 680;
  if (noWordOversizedShortPhrase) {
    console.log('Match: noWordOversizedShortPhrase');
    return true;
  }

  const sparseLargePhrase = wordCount <= 4 && compact.length <= 24;
  const lowCoverageLargeBox = wordCoverage <= 0.26;
  const lowSignalLargeBox = avgConfidence <= 93 || unknownCharRatio >= 0.24 || readability <= 8.8;
  if (giantLineBox && sparseLargePhrase && lowCoverageLargeBox && lowSignalLargeBox) {
    console.log('Match: giantLineBox && sparseLargePhrase && lowCoverageLargeBox && lowSignalLargeBox');
    return true;
  }

  const isSparseSfxBox = (area >= 12000 && compact.length <= 14 && (area / Math.max(1, compact.length)) >= 1200)
    || (area >= 24000 && compact.length <= 22 && (area / Math.max(1, compact.length)) >= 1000);
  const englishTokens = text.split(/\s+/g).map(t => t.replace(/[^A-Za-z]/g, '')).filter(t => t.length >= 2 && /[aeiouy]/i.test(t));
  const isNaturalDialogue = englishTokens.length >= 2
    || (englishTokens.length === 1 && englishTokens[0].length >= 3 && readability >= 1.0)
    || isKnownShortWord
    || /^(?:PRINCESS|PRiNCESS|DIE|PIG|CUM|COCK|OH|OHHH|OHHHH|OHHHHH|AGAA|SO|OF|ALL|MORE|YOU|US|THE|THIS|MY|YOURE|STOOOOP|STOAOOP|STOAAOP|LIKETHIS|LIKE|WASTOYED|UPLOOKING|SIR|YESSIR|USTHESOOFALL|QUCK|QUICK|USTHE|NOWI|II|IIM|ONA|YYOU)$/i.test(asciiCompact);
  if (isSparseSfxBox && !isNaturalDialogue) {
    console.log('Match: isSparseSfxBox && !isNaturalDialogue');
    return true;
  }

  return false;
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
    const pageNum = 11;

    const ocrRow = db.prepare('SELECT ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
    if (ocrRow) {
      const ocr = JSON.parse(ocrRow.ocr_data);
      const line = ocr.lines[41];
      isLikelyGhostTranslatableLineDebug(line, line.text, 'paddleocr', ocr.width, ocr.height);
    }

    db.close();
  } catch (err) {
    console.error(err);
  }
  app.quit();
});
