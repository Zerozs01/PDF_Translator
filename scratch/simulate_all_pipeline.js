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
// 1. HELPERS FROM ocrSafetyLineDedup.ts & ocrTextHeuristics.ts & App.tsx
// ==========================================
const normalizeWhitespace = (text) => String(text || '').replace(/\s+/g, ' ').trim();
const normalizeTranslatableDedupKey = (text) =>
  normalizeWhitespace(String(text || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S');

const isKnownShortWordHelper = (asciiCompact) => {
  return /^[IAO]$/i.test(asciiCompact) || 
    /^(?:OK|NO|HI|OH|AM|AN|AS|AT|BE|BY|DO|GO|HE|IF|IN|IS|IT|ME|MY|OF|ON|OR|SO|TO|UP|US|WE|YE|AH|HA|EH|UH|LO|YA|UM|YES|FOR|AND|BUT|YOU|THE|NOT|HER|HIS|HIM|SHE|CAN|OUT|GET|HOW|WHO|WHY|HEY|BOY|RUN|SAY|SEE|MAN|OUR|DAY|NEW|TOO|ALL|ANY|BAD|BIG|CRY|DID|EAT|END|FAR|FIT|FLY|FUN|GUY|HOT|ITS|JOB|KEY|LET|LIE|LOT|MAD|MAY|MOM|DAD|OLD|ONE|TWO|OWN|PAY|SAD|SON|TRY|USE|WAY|WIN|YET|WOW|YAY|YEP|NAH|NOP|DIE|PIG|CUM|COCK|OHHH|OHHHH|OHHHHH|AGAA|MORE|YOURE|STOOOOP|STOAOOP|STOAAOP|LIKETHIS|LIKE|WASTOYED|UPLOOKING|SIR|YESSIR|QUCK|QUICK|USTHE|NOWI|II|IIM|ONA|YYOU|IIS|IIT|IIN|SSHE|HHE|TTHEY|WWE|TTHIS|TTHAT|NNO|MME|III|MEEE|MEEEE|5O|S0|6O|OFME|EROMANGA|OFMEEROMANGA|BLOWJOB|IM|NURSE|BEINGTOO|SUDDENLY|ILL|RESTA|THESEX|WELLSINCE|JUST|ILLNESSBE|METHOD|FROMTHE|ITFEELS|OUTINSIDE|STILLFULL|BLOWTOB|NOU|DISEASE|FOUNDA|II333S|S3HS|INSIDEI|INSIDE|WHTTTTT|RESTRAINT|GOO|IHNH|ISIHS|2IHG|EIH3|IIMOM|OD111|VAYS|BEEELEE|WNTTTT|HERPUSSY|WOMB|MING|CUMMING|WAYTOO|GOOD|TOMAKETHREADS|MYCUM|THATS|NOTNECESSARY|ADYDO|UMEAN|WERE|PLEASE|YQURE|WIDLY|SIDESHOW|CAME|COOOOOOCKS|COOOOOCKS|COOOOCKS|COOOCKS|COOCKS|COCKS|ONEONONE|CUMALOTJUSTLIKETHAT|MUCH|FOOL|SOW|NONSTOP|HA|HEHE|HEHEHE|MEEEEEEE|MEEEEEE|MEEEEE|CHARGE|ASS|HOLE|ASSHOLE|GONNADIE|TOBEDEADNOW|SOPLEASE|ONEBATTLE|WHY|WITHIT|SIDE|THING|WITH|CUMMING)$/i.test(asciiCompact);
};

const ENGLISH_TECH_HINT_WORDS = new Set([
  'unknown', 'unknowns', 'reaction', 'reactions', 'equilibrium', 'resultant', 'component', 'components',
  'direction', 'force', 'moment', 'column', 'columns', 'connection', 'connections', 'support',
  'rigid', 'body', 'beam', 'beams', 'pin', 'hinge', 'utility', 'building', 'bridge', 'girder',
  'floor', 'member', 'concrete', 'weld', 'welded', 'welding'
]);

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
    if (ENGLISH_TECH_HINT_WORDS.has(lower)) {
      score += 3.6;
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

const shouldForceKeepComicTranslationLine = (text, line) => false;
const shouldForceKeepTechnicalTranslationLine = (text, line) => false;

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

  if (shouldForceKeepComicTranslationLine(text, scaledLine)) {
    return false;
  }

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
    && (area / Math.max(1, compact.length)) >= 680
    && !shouldForceKeepTechnicalTranslationLine(text, scaledLine);
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
  if (isSparseSfxBox && !isNaturalDialogue && !shouldForceKeepComicTranslationLine(text, scaledLine)) return true;

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

// ==========================================
// 2. DEDUPE CODE FROM App.tsx
// ==========================================
const collectTranslatableLines = (lines, engineHint, pageWidth, pageHeight) => {
  const collected = [];
  const pageWidthVal = pageWidth && pageWidth > 0 ? pageWidth : 1200;
  const scaleFactor = 1200 / pageWidthVal;

  lines.forEach((line, index) => {
    const text = line.text || '';
    if (!text) return;

    const likelyGhost = isLikelyGhostTranslatableLine(line, text, engineHint, pageWidth, pageHeight);
    if (likelyGhost) {
      console.log(`    Filtered out as ghost line: "${text}"`);
      return;
    }

    const bbox = line.bbox;
    if (!bbox) return;

    const left = Number(bbox.x0);
    const right = Number(bbox.x1);
    const top = Number(bbox.y0);
    const bottom = Number(bbox.y1);

    const validWordBoxCount = (Array.isArray(line.words) ? line.words : []).filter((word) => {
      const wordText = normalizeWhitespace(String(word?.text || ''));
      const wordBBox = word?.bbox;
      if (!wordText || !wordBBox) return false;
      return Number(wordBBox.x1) > Number(wordBBox.x0) && Number(wordBBox.y1) > Number(wordBBox.y0);
    }).length;
    const width = right - left;
    const height = bottom - top;
    const area = width * height;
    const wordCoverage = computeLineWordUnionCoverage(line);

    collected.push({
      index,
      text,
      sourceLength: text.length,
      top,
      bottom,
      left,
      right,
      height,
      area,
      wordCoverage,
      wordBoxCount: validWordBoxCount,
      confidence: line.confidence || 100,
    });
  });
  return collected;
};

const overlapRatio = (minA, maxA, minB, maxB) => {
  const inter = Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
  const union = Math.max(maxA, maxB) - Math.min(minA, minB);
  return inter / Math.max(1, union);
};

const collectMeaningfulTranslatableLatinTokens = (text) => (
  normalizeWhitespace(String(text || ''))
    .toUpperCase()
    .split(/\s+/g)
    .map((token) => token.replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S'))
    .filter((token) => token.length >= 3)
);

const countSharedTranslatableLatinTokens = (left, right) => {
  const leftTokens = new Set(collectMeaningfulTranslatableLatinTokens(left));
  const rightTokens = new Set(collectMeaningfulTranslatableLatinTokens(right));
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared;
};

const TECHNICAL_LINE_HINT_REGEX = /\b(unknowns?|reactions?|equilibrium|resultant|component|components|direction|force|moment|column|columns|connections?|support|rigid|body|beam|beams|pin|hinge|utility|building|bridge|girder|floor|member|concrete|weld(?:ed|ing)?|fx|fy|fz|mx|my|mz|rx|ry|rz)\b/i;
const UNKNOWNS_COUNT_REGEX = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+unknowns?\b/i;
const AXIS_SYMBOL_REGEX = /\b(?:fx|fy|fz|mx|my|mz|rx|ry|rz)\b/gi;
const EQUATION_LABEL_REGEX = /\([0-9]{1,3}\)/;
const UNKNOWN_COUNT_WORD_TO_NUMBER = {
  one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9', ten: '10'
};

const normalizeUnknownCountToken = (value) => {
  const normalized = normalizeWhitespace(String(value || '')).toLowerCase();
  return UNKNOWN_COUNT_WORD_TO_NUMBER[normalized] || normalized;
};

const collectUniqueRegexMatches = (value, regex) => {
  const normalized = normalizeWhitespace(String(value || '')).toLowerCase();
  if (!normalized) return [];
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  return Array.from(new Set((normalized.match(matcher) || []).map(item => item.trim()).filter(Boolean)));
};

const shouldPreserveDistinctTechnicalLines = (a, b) => {
  const normalizedA = normalizeWhitespace(String(a || '')).toLowerCase();
  const normalizedB = normalizeWhitespace(String(b || '')).toLowerCase();
  if (!normalizedA || !normalizedB || normalizedA === normalizedB) return false;
  if (!(TECHNICAL_LINE_HINT_REGEX.test(normalizedA) || UNKNOWNS_COUNT_REGEX.test(normalizedA) || EQUATION_LABEL_REGEX.test(normalizedA)) || 
      !(TECHNICAL_LINE_HINT_REGEX.test(normalizedB) || UNKNOWNS_COUNT_REGEX.test(normalizedB) || EQUATION_LABEL_REGEX.test(normalizedB))) {
    return false;
  }
  const unknownCountA = normalizeUnknownCountToken(normalizedA.match(UNKNOWNS_COUNT_REGEX)?.[1] || '');
  const unknownCountB = normalizeUnknownCountToken(normalizedB.match(UNKNOWNS_COUNT_REGEX)?.[1] || '');
  if (unknownCountA && unknownCountB && unknownCountA !== unknownCountB) return true;
  return false;
};

const translatableDedupSimilarity = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (val) => {
    const s = new Set();
    if (val.length < 2) { s.add(val); return s; }
    for (let i = 0; i < val.length - 1; i++) s.add(val.slice(i, i+2));
    return s;
  };
  const aSet = grams(a); const bSet = grams(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let overlap = 0;
  for (const g of aSet) if (bSet.has(g)) overlap++;
  return (2 * overlap) / (aSet.size + bSet.size);
};

const KNOWN_CONVERSATIONAL_DUPLICATE_KEYS = new Set(['AAREYOU', 'AAREYO', 'AAREY']);

const scoreSourceLineReadabilityLocal = (text) => scoreSourceLineReadability(text);

const lineScore = (line) => {
  const width = Math.max(1, line.right - line.left);
  const height = Math.max(1, line.bottom - line.top);
  const readability = scoreSourceLineReadability(line.text);
  const area = Math.max(1, width * height);
  const density = line.sourceLength / Math.max(1, Math.sqrt(area));
  const wordCoverage = Math.max(0, Math.min(1.5, Number(line.wordCoverage || 0)));
  const wordBoxCount = Math.max(0, Number(line.wordBoxCount || 0));
  const coverageBonus = Math.min(1, wordCoverage) * 15.2;
  const wordBoxBonus = Math.min(4, wordBoxCount) * 1.25;
  const noWordPenalty = wordBoxCount === 0 ? 4.8 : 0;
  const oversizedSparsePenalty = (wordCoverage <= 0.2 && wordBoxCount <= 1 && line.sourceLength <= 34 && area >= 14000) ? (Math.log10(area) * 3.35) : 0;
  const confidence = typeof line.confidence === 'number' ? line.confidence : 85;
  const confidenceBonus = confidence * 0.16;
  const hasPunctuation = /[!.?…]/.test(line.text);
  const punctuationBonus = hasPunctuation ? 3.8 : 0;
  const endsWithOcrTypoNoise = /[A-Z]{3,}[Il1]$/.test(line.text);
  const ocrTypoPenalty = endsWithOcrTypoNoise ? 8.5 : 0;

  return (line.sourceLength * 1.82)
    + (readability * 2.75)
    + (density * 26)
    + (height * 0.18)
    + coverageBonus
    + wordBoxBonus
    + confidenceBonus
    + punctuationBonus
    - noWordPenalty
    - oversizedSparsePenalty
    - ocrTypoPenalty
    - (Math.log10(area) * 1.45);
};

const dedupeTranslatableLinesForTranslation = (lines) => {
  if (lines.length <= 1) return lines;
  const ordered = [...lines].sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return a.index - b.index;
  });

  const kept = [];
  const keptKeys = [];

  for (const candidate of ordered) {
    const candidateKey = normalizeTranslatableDedupKey(candidate.text);
    if (!candidateKey) {
      kept.push(candidate);
      keptKeys.push('');
      continue;
    }

    let existingIndex = kept.findIndex((existing, index) => {
      const existingKey = keptKeys[index];
      if (!existingKey) return false;

      const minLength = Math.min(existingKey.length, candidateKey.length);
      const keySimilarity = translatableDedupSimilarity(existingKey, candidateKey);
      const sameOrSubset = existingKey === candidateKey || (minLength >= 5 && (existingKey.includes(candidateKey) || candidateKey.includes(existingKey)));
      const similar = keySimilarity >= 0.9;
      if (shouldPreserveDistinctTechnicalLines(existing.text, candidate.text)) return false;

      const existingWidth = Math.max(1, existing.right - existing.left);
      const candidateWidth = Math.max(1, candidate.right - candidate.left);
      const existingHeight = Math.max(1, existing.bottom - existing.top);
      const candidateHeight = Math.max(1, candidate.bottom - candidate.top);
      const existingArea = existingWidth * existingHeight;
      const candidateArea = candidateWidth * candidateHeight;

      const overlapW = Math.max(0, Math.min(existing.right, candidate.right) - Math.max(existing.left, candidate.left));
      const overlapH = Math.max(0, Math.min(existing.bottom, candidate.bottom) - Math.max(existing.top, candidate.top));
      const overlapArea = overlapW * overlapH;

      const isSpatialContained = (overlapArea / candidateArea) >= 0.85 || (overlapArea / existingArea) >= 0.85;
      if (isSpatialContained) {
        if (keySimilarity >= 0.15 || existingKey.includes(candidateKey) || candidateKey.includes(existingKey)) {
          return true;
        }
      }
      const minWidth = Math.max(24, Math.min(existingWidth, candidateWidth));
      const minHeight = Math.max(8, Math.min(existingHeight, candidateHeight));
      const existingCenterX = (existing.left + existing.right) * 0.5;
      const candidateCenterX = (candidate.left + candidate.right) * 0.5;
      const existingCenterY = (existing.top + existing.bottom) * 0.5;
      const candidateCenterY = (candidate.top + candidate.bottom) * 0.5;
      const centerDeltaX = Math.abs(existingCenterX - candidateCenterX);
      const centerDeltaY = Math.abs(existingCenterY - candidateCenterY);
      const overlapX = overlapRatio(existing.left, existing.right, candidate.left, candidate.right);
      const overlapY = overlapRatio(existing.top, existing.bottom, candidate.top, candidate.bottom);

      if (!isSpatialContained && overlapY <= 0.48) {
        return false;
      }

      const existingReadability = scoreSourceLineReadability(existing.text);
      const candidateReadability = scoreSourceLineReadability(candidate.text);
      const readabilityGap = Math.abs(existingReadability - candidateReadability);
      const longLinePair = Math.min(existing.sourceLength, candidate.sourceLength) >= 18;
      const existingWordCount = normalizeWhitespace(String(existing.text || '')).split(/\s+/g).filter(Boolean).length;
      const candidateWordCount = normalizeWhitespace(String(candidate.text || '')).split(/\s+/g).filter(Boolean).length;
      const paragraphLikePair = existingWordCount >= 4 && candidateWordCount >= 4;
      const veryStrongSpatialMatch = overlapY >= 0.82 && overlapX >= 0.64;
      const compactSpatialMatch = (overlapY >= 0.7 && overlapX >= 0.52 && centerDeltaY <= Math.max(20, minHeight * 0.92) && centerDeltaX <= Math.max(58, minWidth * 1.3));
      const strongSpatialForNoise = (overlapY >= 0.72 && overlapX >= 0.5 && centerDeltaY <= Math.max(24, minHeight * 1.05) && centerDeltaX <= Math.max(62, minWidth * 1.45));
      const technicalLinePair = (TECHNICAL_LINE_HINT_REGEX.test(existing.text) || TECHNICAL_LINE_HINT_REGEX.test(candidate.text) || UNKNOWNS_COUNT_REGEX.test(existing.text) || UNKNOWNS_COUNT_REGEX.test(candidate.text));
      const strictSubsetPair = sameOrSubset && Math.abs(existingKey.length - candidateKey.length) >= 8;
      if (technicalLinePair && strictSubsetPair) {
        const strictSpatialMatch = veryStrongSpatialMatch || compactSpatialMatch;
        if (!strictSpatialMatch) return false;
      }
      const noisyNearDuplicate = !sameOrSubset && keySimilarity >= 0.72 && readabilityGap >= 4.8 && (existingReadability <= 1.5 || candidateReadability <= 1.5) && strongSpatialForNoise;
      const sameBoxSharedPhraseDuplicate = !sameOrSubset && !technicalLinePair && Math.min(existingKey.length, candidateKey.length) >= 8 && countSharedTranslatableLatinTokens(existing.text, candidate.text) >= 2 && overlapY >= 0.78 && overlapX >= 0.56 && centerDeltaY <= Math.max(24, minHeight * 1.05) && centerDeltaX <= Math.max(72, minWidth * 1.4);

      if (!sameOrSubset && !similar && !noisyNearDuplicate && !sameBoxSharedPhraseDuplicate) return false;

      const looseSpatialMatchForHighSimilarity = keySimilarity >= 0.85 && ((overlapY >= 0.58 && overlapX >= 0.46) || (overlapY >= 0.44 && overlapX >= 0.38 && centerDeltaY <= Math.max(32, minHeight * 1.35) && centerDeltaX <= Math.max(76, minWidth * 1.5)));

      if ((longLinePair || paragraphLikePair) && !veryStrongSpatialMatch && !compactSpatialMatch && !looseSpatialMatchForHighSimilarity) {
        return false;
      }

      const nearByCenter = (centerDeltaY <= Math.max(34, minHeight * 1.45) && centerDeltaX <= Math.max(72, minWidth * 1.58));
      const nearByOverlap = overlapY >= 0.64 && overlapX >= 0.54;
      const nearBySharedColumn = (centerDeltaY <= Math.max(42, minHeight * 1.72) && centerDeltaX <= Math.max(62, minWidth * 1.32) && overlapX >= 0.7);

      return nearByCenter || nearByOverlap || nearBySharedColumn;
    });

    if (existingIndex < 0 && KNOWN_CONVERSATIONAL_DUPLICATE_KEYS.has(candidateKey)) {
      existingIndex = kept.findIndex((existing, index) => {
        if (keptKeys[index] !== candidateKey) return false;
        const centerXExisting = (existing.left + existing.right) * 0.5;
        const centerXCandidate = (candidate.left + candidate.right) * 0.5;
        const horizontalDistance = Math.abs(centerXCandidate - centerXExisting);
        const verticalDistance = Math.abs(candidate.top - existing.top);
        return verticalDistance <= 420 && horizontalDistance <= 460;
      });
    }

    if (existingIndex < 0) {
      kept.push(candidate);
      keptKeys.push(candidateKey);
      continue;
    }

    const existing = kept[existingIndex];
    const existingKey = keptKeys[existingIndex];
    console.log(`    Collision! Deduping: "${candidate.text}" (Score: ${lineScore(candidate).toFixed(2)}) is duplicate of "${existing.text}" (Score: ${lineScore(existing).toFixed(2)})`);
    if (lineScore(candidate) > lineScore(existing)) {
      console.log(`      Replacing "${existing.text}" with "${candidate.text}" because candidate score is higher.`);
      kept[existingIndex] = candidate;
      keptKeys[existingIndex] = candidateKey;
    } else {
      console.log(`      Keeping "${existing.text}", discarding "${candidate.text}".`);
    }
  }

  return kept;
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

    const docId = 311;
    const pageNum = 17;

    const row = db.prepare('SELECT ocr_engine, ocr_data FROM ocr_cache_engine WHERE document_id = ? AND page_number = ?').get(docId, pageNum);
    if (row) {
      const ocr = JSON.parse(row.ocr_data);
      console.log('\n--- SIMULATING GHOST FILTER (collectTranslatableLines) ---');
      const baseLines = collectTranslatableLines(ocr.lines || [], row.ocr_engine, ocr.width, ocr.height);
      console.log(`Base Translatable Lines count: ${baseLines.length} (out of ${ocr.lines.length})`);

      console.log('\n--- SIMULATING DEDUPLICATION (dedupeTranslatableLinesForTranslation) ---');
      const finalLines = dedupeTranslatableLinesForTranslation(baseLines);
      console.log(`Final Translatable Lines count: ${finalLines.length}`);

      console.log('\n--- FINAL LINES AFTER DEDUPE ---');
      finalLines.forEach(l => {
        console.log(`  [idx:${l.index}] "${l.text}" bbox: l=${l.left} t=${l.top} r=${l.right} b=${l.bottom}`);
      });
    }

    db.close();
  } catch (err) {
    console.error(err);
  }
  app.quit();
});
