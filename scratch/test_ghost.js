
const HANGUL_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
const THAI_REGEX = /[\u0E00-\u0E7F]/;
const OCR_NOISE_COMPACT_FRAGMENTS = ['submaie', 'ureat', 'ydoot', 'falinth', 'willtudhow', 'chapte', 'chapt', 'effctofravt', 'ctriclm', 'gnetiontact', 'rescaused'];
const ENGLISH_TECH_HINT_WORDS = new Set(['chapter', 'table', 'fig', 'figure', 'conditions', 'equilibrium', 'rigid', 'body', 'reaction', 'moment', 'force', 'diagram']);

const normalizeWhitespace = (text) => text.replace(/\s+/g, ' ').trim();
const computeLineWordUnionCoverage = (line) => 1.0; // Mocked
const shouldForceKeepComicTranslationLine = (text, line) => false;
const shouldForceKeepTechnicalTranslationLine = (text, line) => false;

const GHOST_TRANSLATION_PUNCT_ONLY_REGEX = /^[^A-Za-z0-9]+$/;
const GHOST_TRANSLATION_SHORT_TOKEN_REGEX = /^[A-Z0-9]{1,4}$/;


const hasKnownOcrNoisePattern = (text)=> {
  const compact = normalizeWhitespace(String(text || ''))
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!compact) return false;
  return OCR_NOISE_COMPACT_FRAGMENTS.some((fragment) => compact.includes(fragment));
}

const scoreSourceLineReadability = (text)=> {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return -1_000;

  const hasLatin = /[A-Za-z]/.test(normalized);
  if (!hasLatin) {
    return normalized.length * 0.22;
  }

  const tokens = normalized.split(/\s+/g).filter(Boolean);
  let score = 0;
  let weirdTokens = 0;

  if (hasKnownOcrNoisePattern(normalized)) {
    weirdTokens += 2;
    score -= 10.5;
  }

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

    if (/^(submaie|ureat|ydoot|falinth|willtudhow|chapte|chapt|effctofravt|ctriclm|gnetiontact|rescaused)$/i.test(lower)) {
      weirdTokens += 1;
      score -= 6.2;
    }
  }

  score -= weirdTokens * 0.85;
  return score;
}

const isLikelyGhostTranslatableLine = (
  line,
  resolvedText,
  engineHint,
  pageWidth,
  pageHeight)=> {
  const text = normalizeWhitespace(String(resolvedText || ''));
  if (!text) return true;
  if (!line?.bbox) return false;

  const pageWidthVal = pageWidth && pageWidth > 0 ? pageWidth ;
  const scale = 1200 / pageWidthVal;

  const scaledLine= scale === 1.0 ? line ...line,
    bbox.bbox.x0 * scale,
      y0.bbox.y0 * scale,
      x1.bbox.x1 * scale,
      y1.bbox.y1 * scale,
    },
    words.isArray(line.words)
      ? line.words.map((word) => ({
          ...word,
          bbox.bbox.x0 * scale,
            y0.bbox.y0 * scale,
            x1.bbox.x1 * scale,
            y1.bbox.y1 * scale,
          },
        }))
      ,
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
  const isKnownShortWord = /^[IAO]$/i.test(asciiCompact) || 
    /^()$/i.test(asciiCompact);

  const validWords = (Array.isArray(scaledLine.words) ? scaledLine.words ).filter((word) => {
    const wordText = normalizeWhitespace(String(word?.text || ''));
    const bbox = word?.bbox;
    if (!wordText || !bbox) return false;
    return (bbox.x1 - bbox.x0) > 0 && (bbox.y1 - bbox.y0) > 0;
  });
  const sourceTokenCount = text.split(/\s+/g).filter(Boolean).length;
  const wordCount = Math.max(validWords.length, sourceTokenCount);
  const confidenceSamples = validWords.length > 0
    ? validWords.map((word) => Number(word.confidence || 0))
    (scaledLine.confidence || 0)];
  const avgConfidence = confidenceSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, confidenceSamples.length);
  const readability = scoreSourceLineReadability(text);
  const wordCoverage = computeLineWordUnionCoverage(scaledLine);

  if (shouldForceKeepComicTranslationLine(text, scaledLine)) {
    return false;
  }

  // Apply these safety filters to ALL OCR engines to guarantee obvious ghost noise is always dropped
  // 1. Pure non-alphanumeric symbol noise (e.g., "|||", "///", "\\", "---")
  const isPureSymbolNoise = !hasCjkOrThai && asciiCompact.length === 0;
  if (isPureSymbolNoise) {
    return true;
  }

  // 2. Repetitive vertical lines, slashes, or symbol junk (classic signature of spiky balloon borders, e.g. "lll", "III", "111", "I l I")
  const isVerticalLineJunk = !hasCjkOrThai && /^[lI1|!/\\_\-s]+$/i.test(compact) && !/^[IAO]$/i.test(asciiCompact);
  if (isVerticalLineJunk) {
    return true;
  }

  // 3. Single-character junk (English letters or digits that aren't valid single-letter words like I, A, O)
  const isSingleCharJunk = !hasCjkOrThai
    && asciiCompact.length === 1
    && !/^[IAO]$/i.test(asciiCompact);
  if (isSingleCharJunk) {
    return true;
  }

  // 4. Tiny noise junk boxes with very short character lengths
  const isExternalEngine = engineHint === 'paddleocr' || scaledLine?.sourceEngine === 'paddleocr' || engineHint === 'easyocr' || scaledLine?.sourceEngine === 'easyocr';
  const isTinyJunkBox = !hasCjkOrThai
    && asciiCompact.length <= 3
    && area <= 8000
    && (isExternalEngine ? avgConfidence <= 98 = 85)
    && !isKnownShortWord;
  if (isTinyJunkBox) {
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
    && (area / Math.max(1, compact.length)) >= 680
    && !shouldForceKeepTechnicalTranslationLine(text, scaledLine);
  if (noWordOversizedShortPhrase) {
    return true;
  }

  const sparseLargePhrase = wordCount <= 4 && compact.length <= 24;
  const lowCoverageLargeBox = wordCoverage <= 0.26;
  const lowSignalLargeBox = avgConfidence <= 93 || unknownCharRatio >= 0.24 || readability <= 8.8;
  if (giantLineBox && sparseLargePhrase && lowCoverageLargeBox && lowSignalLargeBox) {
    return true;
  }

  // New aggressive sparse SFX filter// Removed wordCoverage check because OCR sometimes creates word bboxes line bbox
  const isSparseSfxBox = (area >= 12000 && compact.length <= 14 && (area / Math.max(1, compact.length)) >= 1200)
    || (area >= 24000 && compact.length <= 22 && (area / Math.max(1, compact.length)) >= 1000);
  if (isSparseSfxBox && !shouldForceKeepComicTranslationLine(text, scaledLine)) {
    return true;
  }

  if (hasCjkOrThai) {
    const tinyCjkSingleton = wordCount <= 1
      && cjkCompact.length <= 3
      && width <= 96
      && height <= 54
      && area <= 3000
      && avgConfidence <= 90;
    const narrowTallCjkNoise = wordCount <= 2
      && cjkCompact.length <= 4
      && width <= 88
      && height <= 180
      && height >= Math.max(42, width * 1.15)
      && avgConfidence <= 90;
    const cjkUnknownHeavy = cjkCompact.length <= 2
      && unknownCharRatio >= 0.45
      && area <= 3200
      && avgConfidence <= 88;
    const shortStylizedNonLatinSfx = wordCount <= 1
      && cjkCompact.length <= 3
      && width <= 132
      && height <= 112
      && area <= 11500
      && avgConfidence <= 92
      && (unknownCharRatio >= 0.08 || height >= width * 0.6);
    const shortNonLatinLowCoverageArtifact = wordCount <= 2
      && cjkCompact.length <= 5
      && area <= 6200
      && wordCoverage <= 0.26
      && (avgConfidence <= 92 || unknownCharRatio >= 0.2);

    if (tinyCjkSingleton || narrowTallCjkNoise || cjkUnknownHeavy || shortStylizedNonLatinSfx || shortNonLatinLowCoverageArtifact) {
      return true;
    }
    return false;
  }

  if (GHOST_TRANSLATION_PUNCT_ONLY_REGEX.test(compact) && width <= 112 && height <= 44) {
    return true;
  }

  const compactUpper = compact.toUpperCase();
  const shortDigitArtifact = GHOST_TRANSLATION_SHORT_TOKEN_REGEX.test(compactUpper)
    && /\d/.test(compactUpper)
    && !/[a-z]/.test(compact);
  if (shortDigitArtifact && wordCount <= 1 && width <= 96 && height <= 42 && avgConfidence <= 82) {
    return true;
  }

  const tinyAsciiSingletonNoise = !hasCjkOrThai
    && wordCount <= 1
    && asciiCompact.length > 0
    && asciiCompact.length <= 2
    && width <= 72
    && height <= 38
    && area <= 2100
    && avgConfidence <= 94
    && !/[!?]/.test(text);
  // Exempt known short English words — "I" (pronoun), "A" (article) are not ghost noise
  if (tinyAsciiSingletonNoise && !isKnownShortWord) {
    return true;
  }

  const noWordTinyAsciiNoise = validWords.length === 0
    && !hasCjkOrThai
    && wordCount <= 2
    && asciiCompact.length > 0
    && asciiCompact.length <= 6
    && width <= 88
    && height <= 44
    && area <= 2600
    && avgConfidence <= 92
    && !isKnownShortWord;
  if (noWordTinyAsciiNoise) {
    return true;
  }

  const pxPerLatinChar = width / Math.max(1, latinCompact.length);
  const suspiciousTinyLongLatin = latinCompact.length >= 10
    && wordCount >= 3
    && pxPerLatinChar < 2.9
    && width <= Math.max(72, latinCompact.length * 5.4)
    && height <= 26;
  if (suspiciousTinyLongLatin) {
    return true;
  }

  const compressedSparseShortPhrase = !hasCjkOrThai
    && sourceTokenCount >= 2
    && sourceTokenCount <= 4
    && latinCompact.length >= 8
    && width <= Math.max(92, latinCompact.length * 6.4)
    && height <= 78
    && area <= Math.max(5200, latinCompact.length * 520)
    && (area / Math.max(1, latinCompact.length)) <= 430
    && wordCoverage <= 0.24
    && avgConfidence <= 94
    && !/[.!?…]\s*$/.test(text);
  if (compressedSparseShortPhrase) {
    return true;
  }

  const lowSignalHyphenGhost = /[a-z]{2,}-[a-z]{2,}/.test(text)
    && wordCount <= 3
    && width <= 220
    && height <= 38
    && avgConfidence <= 82;
  if (lowSignalHyphenGhost) {
    return true;
  }

  if (wordCount <= 2 && area <= 3000 && unknownCharRatio >= 0.45 && avgConfidence <= 82) {
    return true;
  }

  const lowSignalTinySingleton = wordCount <= 1
    && asciiCompact.length > 0
    && asciiCompact.length <= 4
    && area <= 2600
    && width <= 104
    && height <= 40
    && readability <= 0.35
    && avgConfidence <= 78;
  if (lowSignalTinySingleton) {
    return true;
  }

  return false;
}


const linesToTest = [
  {
    text: "682110209",
    line: {
      text: "682110209",
      confidence: 99.92,
      bbox: { x0: 1418, y0: 19, x1: 1669, y1: 75 },
      words: [{ text: "682110209", confidence: 99.92, bbox: { x0: 1418, y0: 19, x1: 1669, y1: 75 } }]
    }
  },
  {
    text: "MAMA",
    line: {
      text: "MAMA",
      confidence: 97.94,
      bbox: { x0: 1464, y0: 92, x1: 1632, y1: 169 },
      words: [{ text: "MAMA", confidence: 97.94, bbox: { x0: 1464, y0: 92, x1: 1632, y1: 169 } }]
    }
  },
  {
    text: "Come with me",
    line: {
      text: "Come with me",
      confidence: 95.44,
      bbox: { x0: 650, y0: 106, x1: 1018, y1: 199 },
      words: [
        { text: "Come", confidence: 95.44, bbox: { x0: 650, y0: 106, x1: 797.2, y1: 199 } },
        { text: "with", confidence: 95.44, bbox: { x0: 797.2, y0: 106, x1: 944.4, y1: 199 } },
        { text: "me", confidence: 95.44, bbox: { x0: 944.4, y0: 106, x1: 1018, y1: 199 } }
      ]
    }
  }
];

console.log("=== RUNNING GHOST FILTER TEST ===");
linesToTest.forEach(item => {
  const isGhost = isLikelyGhostTranslatableLine(item.line, item.text, "paddleocr", 1759, 867);
  console.log(`Text: "${item.text}" -> isGhost: ${isGhost}`);
});
