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
// HELPERS
// ==========================================
const normalizeWhitespace = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const normalizeOverlayInlineText = (text) => String(text || '').replace(/\s+/g, ' ').trim();

const normalizeTranslatableDedupKey = (text) =>
  normalizeWhitespace(String(text || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S');

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
    } else if (clean.length >= 4) {
      weirdTokens += 1;
      score -= 3.1;
    }
    if (clean === clean.toUpperCase() && clean.length >= 7) {
      score -= 1.2;
    }
  }
  score -= weirdTokens * 0.85;
  return score;
};

const computeLineWordUnionCoverage = (line) => {
  const bbox = line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
  const width = Math.max(1, bbox.x1 - bbox.x0);
  const height = Math.max(1, bbox.y1 - bbox.y0);
  const area = width * height;
  const words = Array.isArray(line.words) ? line.words : [];
  const validWords = words.filter(w => w?.bbox && (w.bbox.x1 - w.bbox.x0) > 0 && (w.bbox.y1 - w.bbox.y0) > 0);
  if (validWords.length === 0) return 0;
  let unionArea = 0;
  validWords.forEach(w => {
    const ww = w.bbox.x1 - w.bbox.x0;
    const wh = w.bbox.y1 - w.bbox.y0;
    unionArea += ww * wh;
  });
  return Math.min(1.0, unionArea / area);
};

const isLikelyGhostTranslatableLine = (line, resolvedText, engineHint, pageWidth, pageHeight) => {
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

  if (isKnownShortWord) {
    return false;
  }

  const isPureSymbolNoise = !hasCjkOrThai && asciiCompact.length === 0;
  if (isPureSymbolNoise) return true;

  const isVerticalLineJunk = !hasCjkOrThai && /^[lI1|!/\\_\-]+$/i.test(compact) && !/^[IAO]$/i.test(asciiCompact);
  if (isVerticalLineJunk) return true;

  const isSingleCharJunk = !hasCjkOrThai && asciiCompact.length === 1 && !/^[IAO]$/i.test(asciiCompact);
  if (isSingleCharJunk) return true;

  const isExternalEngine = engineHint === 'paddleocr' || scaledLine?.sourceEngine === 'paddleocr' || engineHint === 'easyocr' || scaledLine?.sourceEngine === 'easyocr';
  const isTinyJunkBox = !hasCjkOrThai
    && asciiCompact.length <= 3
    && area <= 8000
    && (isExternalEngine ? avgConfidence <= 98 : avgConfidence <= 85)
    && !isKnownShortWord;
  if (isTinyJunkBox) return true;

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
  if (noWordOversizedShortPhrase) return true;

  const sparseLargePhrase = wordCount <= 4 && compact.length <= 24;
  const lowCoverageLargeBox = wordCoverage <= 0.26;
  const lowSignalLargeBox = avgConfidence <= 93 || unknownCharRatio >= 0.24 || readability <= 8.8;
  if (giantLineBox && sparseLargePhrase && lowCoverageLargeBox && lowSignalLargeBox) return true;

  const isSparseSfxBox = (area >= 12000 && compact.length <= 14 && (area / Math.max(1, compact.length)) >= 1200)
    || (area >= 24000 && compact.length <= 22 && (area / Math.max(1, compact.length)) >= 1000);
  const englishTokens = text.split(/\s+/g).map(t => t.replace(/[^A-Za-z]/g, '')).filter(t => t.length >= 2 && /[aeiouy]/i.test(t));
  const isNaturalDialogue = englishTokens.length >= 2
    || (englishTokens.length === 1 && englishTokens[0].length >= 3 && readability >= 1.0)
    || isKnownShortWord
    || /^(?:PRINCESS|PRiNCESS|DIE|PIG|CUM|COCK|OH|OHHH|OHHHH|OHHHHH|AGAA|SO|OF|ALL|MORE|YOU|US|THE|THIS|MY|YOURE|STOOOOP|STOAOOP|STOAAOP|LIKETHIS|LIKE|WASTOYED|UPLOOKING|SIR|YESSIR|USTHESOOFALL|QUCK|QUICK|USTHE|NOWI|II|IIM|ONA|YYOU)$/i.test(asciiCompact);
  if (isSparseSfxBox && !isNaturalDialogue) return true;

  if (hasCjkOrThai) {
    const isCommonKoreanWord = /^(?:이런|자|그|이|저|나|너|네|예|응|뭐|왜|안|못|잘|더|다|또|꾹|슥|헉|하|앗|어|오|엇|녀석|녀석들|쿠기사키|제대로|쪼여|쪼여라|크|윽|흐|음|읏|큭|읍|하앗|흐윽|후|휴|하아|하아아|으|으윽)$/.test(cjkCompact);
    if (isCommonKoreanWord) return false;
    const tinyCjkSingleton = wordCount <= 1 && cjkCompact.length <= 3 && width <= 96 && height <= 54 && area <= 3000 && avgConfidence <= 90;
    const narrowTallCjkNoise = wordCount <= 2 && cjkCompact.length <= 4 && width <= 88 && height <= 180 && height >= Math.max(42, width * 1.15) && avgConfidence <= 90;
    const cjkUnknownHeavy = cjkCompact.length <= 2 && unknownCharRatio >= 0.45 && area <= 3200 && avgConfidence <= 88;
    const shortStylizedNonLatinSfx = wordCount <= 1 && cjkCompact.length <= 3 && width <= 132 && height <= 112 && area <= 11500 && avgConfidence <= 92 && (unknownCharRatio >= 0.08 || height >= width * 0.6);
    const shortNonLatinLowCoverageArtifact = wordCount <= 2 && cjkCompact.length <= 5 && area <= 6200 && wordCoverage <= 0.26 && (avgConfidence <= 92 || unknownCharRatio >= 0.2);
    if (tinyCjkSingleton || narrowTallCjkNoise || cjkUnknownHeavy || shortStylizedNonLatinSfx || shortNonLatinLowCoverageArtifact) return true;
    return false;
  }

  if (/^[^\w\s\u0E00-\u0E7F]+$/.test(compact) && width <= 112 && height <= 44) return true;

  const compactUpper = compact.toUpperCase();
  const shortDigitArtifact = /^[0-9\-+()]{1,6}$/.test(compactUpper) && /\d/.test(compactUpper) && !/[a-z]/.test(compact);
  if (shortDigitArtifact && wordCount <= 1 && width <= 96 && height <= 42 && avgConfidence <= 82) return true;

  const tinyAsciiSingletonNoise = !hasCjkOrThai && wordCount <= 1 && asciiCompact.length > 0 && asciiCompact.length <= 2 && width <= 72 && height <= 38 && area <= 2100 && avgConfidence <= 94 && !/[!?]/.test(text);
  if (tinyAsciiSingletonNoise && !isKnownShortWord) return true;

  const noWordTinyAsciiNoise = validWords.length === 0 && !hasCjkOrThai && wordCount <= 2 && asciiCompact.length > 0 && asciiCompact.length <= 6 && width <= 88 && height <= 44 && area <= 2600 && avgConfidence <= 92 && !isKnownShortWord;
  if (noWordTinyAsciiNoise) return true;

  const pxPerLatinChar = width / Math.max(1, latinCompact.length);
  const suspiciousTinyLongLatin = latinCompact.length >= 10 && wordCount >= 3 && pxPerLatinChar < 2.9 && width <= Math.max(72, latinCompact.length * 5.4) && height <= 26;
  if (suspiciousTinyLongLatin) return true;

  const compressedSparseShortPhrase = !hasCjkOrThai && sourceTokenCount >= 2 && sourceTokenCount <= 4 && latinCompact.length >= 8 && width <= Math.max(92, latinCompact.length * 6.4) && height <= 78 && area <= Math.max(5200, latinCompact.length * 520) && (area / Math.max(1, latinCompact.length)) <= 430 && wordCoverage <= 0.24 && avgConfidence <= 94 && !/[.!?…]\s*$/.test(text);
  if (compressedSparseShortPhrase) return true;

  if (/[a-z]{2,}-[a-z]{2,}/.test(text) && wordCount <= 3 && width <= 220 && height <= 38 && avgConfidence <= 82) return true;
  if (wordCount <= 2 && area <= 3000 && unknownCharRatio >= 0.45 && avgConfidence <= 82) return true;

  const lowSignalTinySingleton = wordCount <= 1 && asciiCompact.length > 0 && asciiCompact.length <= 4 && area <= 2600 && width <= 104 && height <= 40 && readability <= 0.35 && avgConfidence <= 78;
  if (lowSignalTinySingleton) return true;

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
    const pages = [3, 11, 25];

    pages.forEach(function(pageNum) {
      console.log('\n=========================================');
      console.log(`ANALYZING PAGE ${pageNum}`);
      console.log('=========================================');

      const row = db.prepare('SELECT ocr_engine, ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
      if (!row) {
        console.log('No OCR data found');
        return;
      }
      const ocr = JSON.parse(row.ocr_data);
      const lines = ocr.lines || [];

      lines.forEach((l, idx) => {
        const isGhost = isLikelyGhostTranslatableLine(l, l.text, row.ocr_engine, ocr.width, ocr.height);
        if (isGhost) {
          console.log(`[idx:${idx}] Dropped as ghost -> Text: "${l.text}" | conf: ${l.confidence}`);
        }
      });
    });

    db.close();
  } catch (err) {
    console.error(err);
  }
  app.quit();
});
