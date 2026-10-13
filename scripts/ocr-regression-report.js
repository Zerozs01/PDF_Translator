#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const SHORT_KEEP = new Set(['i', 'a', 'go', 'to', 'do', 'in', 'on', 'of', 'if', 'is', 'be', 'we', 'us', 'my', 'or', 'an', 'at', 'as', 'am', 'up', 'it']);
const EVAL_WEIGHTS = Object.freeze({
  rawConfidence: 0.35,
  lexicalErrorPenalization: 0.45,
  yieldPreservationDropSafe: 0.20,
});
const LEXICAL_WEIGHTS = Object.freeze({
  wer: 0.35,
  cer: 0.25,
  garbage: 0.40,
});

function parseArgs(argv) {
  const args = {
    base: '',
    cand: '',
    expect: '',
    out: '',
    failOnRisk: false,
    partial: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') args.base = argv[i + 1] || '';
    if (arg === '--cand') args.cand = argv[i + 1] || '';
    if (arg === '--expect') args.expect = argv[i + 1] || '';
    if (arg === '--out') args.out = argv[i + 1] || '';
    if (arg === '--fail-on-risk') args.failOnRisk = true;
    if (arg === '--partial') args.partial = true;
  }
  return args;
}

function loadJson(filePath) {
  const fullPath = path.resolve(filePath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  return JSON.parse(raw);
}

const PAGE_ID_MAP = {
  'manga1': 2, 'manga-1': 2,
  'manga2': 3, 'manga-2': 3,
  'manga3': 5, 'manga-3': 5,
  'document1': 101, 'doc-tech-1': 101,
  'document2': 102, 'doc-tech-2': 102,
  'document3': 103, 'doc-tech-3': 103,
};

function inferPageNumber(page, fallbackIndex) {
  if (page && page.id && PAGE_ID_MAP[page.id]) return PAGE_ID_MAP[page.id];
  if (page && page.fixtureId && PAGE_ID_MAP[page.fixtureId]) return PAGE_ID_MAP[page.fixtureId];
  const pageNumber = Number(page && page.pageNumber);
  if (Number.isFinite(pageNumber) && pageNumber > 0) return pageNumber;
  return fallbackIndex + 1;
}

function normalizePages(input) {
  const pages = new Map();
  const ingest = (page, idx = 0) => {
    if (!page || typeof page !== 'object') return;
    const hasOCRShape = Array.isArray(page.words) || Array.isArray(page.lines) || typeof page.text === 'string';
    if (!hasOCRShape) return;
    const pageNumber = inferPageNumber(page, idx);
    pages.set(pageNumber, page);
  };

  if (Array.isArray(input)) {
    input.forEach((page, idx) => ingest(page, idx));
    return pages;
  }

  if (input && typeof input === 'object') {
    if (Array.isArray(input.cases)) {
      input.cases.forEach((page, idx) => ingest(page, idx));
      return pages;
    }

    if (Array.isArray(input.pages)) {
      input.pages.forEach((page, idx) => ingest(page, idx));
      return pages;
    }

    if (Array.isArray(input.results)) {
      input.results.forEach((page, idx) => ingest(page, idx));
      return pages;
    }

    const entries = Object.entries(input);
    let foundPageLike = false;
    for (const [key, value] of entries) {
      if (!value || typeof value !== 'object') continue;
      const hasOCRShape = Array.isArray(value.words) || Array.isArray(value.lines) || typeof value.text === 'string';
      if (!hasOCRShape) continue;
      foundPageLike = true;
      const keyNum = Number(key);
      const pageNum = Number.isFinite(keyNum) && keyNum > 0 ? keyNum : inferPageNumber(value, pages.size);
      pages.set(pageNum, value);
    }
    if (foundPageLike) return pages;
    ingest(input, 0);
  }

  return pages;
}

function normalizeExpectations(input) {
  if (!input || typeof input !== 'object') return new Map();
  const list = Array.isArray(input.expectations) ? input.expectations : (Array.isArray(input) ? input : []);
  const expectations = new Map();
  for (const item of list) {
    const page = Number(item && item.page);
    if (!Number.isFinite(page) || page <= 0) continue;
    expectations.set(page, item);
  }
  return expectations;
}

function toTokens(page) {
  if (Array.isArray(page.words) && page.words.length > 0) {
    return page.words
      .map((word) => String(word && word.text ? word.text : '').trim())
      .filter(Boolean);
  }
  if (Array.isArray(page.lines) && page.lines.length > 0) {
    return page.lines
      .flatMap((line) => String(line && line.text ? line.text : '').split(/\s+/g))
      .map((text) => text.trim())
      .filter(Boolean);
  }
  if (typeof page.text === 'string') {
    return page.text
      .split(/\s+/g)
      .map((text) => text.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeToken(token) {
  return token
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function normalizeConfidenceScore(rawConfidence) {
  const value = Number(rawConfidence);
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return clampUnit(value);
  return clampUnit(value / 100);
}

function levenshteinDistance(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = new Array(right.length + 1);
  const current = new Array(right.length + 1);

  for (let j = 0; j <= right.length; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
    }
    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
}

function normalizedEditError(reference, hypothesis) {
  const ref = Array.isArray(reference) ? reference : [];
  const hyp = Array.isArray(hypothesis) ? hypothesis : [];
  if (ref.length === 0) {
    return hyp.length === 0 ? null : 1;
  }
  const distance = levenshteinDistance(ref, hyp);
  return clampUnit(distance / Math.max(1, ref.length));
}

function countMeaningfulWords(tokens) {
  let meaningful = 0;
  for (const token of tokens) {
    const normalized = normalizeToken(token);
    if (!normalized) continue;
    if (SHORT_KEEP.has(normalized)) {
      meaningful += 1;
      continue;
    }
    const hasVowel = /[aeiou]/.test(normalized);
    const consonantRun = /[bcdfghjklmnpqrstvwxyz]{5,}/.test(normalized);
    if (normalized.length >= 3 && hasVowel && !consonantRun) {
      meaningful += 1;
    }
  }
  return meaningful;
}

function countStandaloneShortTokens(tokens) {
  return tokens.reduce((sum, token) => {
    const normalized = normalizeToken(token);
    if (!normalized) return sum;
    if (normalized.length <= 1 && !SHORT_KEEP.has(normalized)) return sum + 1;
    if (normalized.length === 2 && !SHORT_KEEP.has(normalized) && !/[aeiou]/.test(normalized)) return sum + 1;
    return sum;
  }, 0);
}

function isCjkLike(language) {
  const lang = String(language || '').toLowerCase();
  return lang.includes('kor') || lang.includes('jpn') || lang.includes('chi') || lang.includes('tha');
}

function suspiciousBreakdown(tokens, language) {
  const stats = {
    jamoOnly: 0,
    digitShort: 0,
    asciiShort: 0,
    edgeJamo: 0,
    latinSingleton: 0,
  };

  const cjk = isCjkLike(language);
  const jamoRe = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/;
  const syllableRe = /[\uAC00-\uD7AF]/;
  const edgeJamoRe = /^[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]|[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]$/;

  for (const token of tokens) {
    const clean = token.trim();
    if (!clean) continue;
    const normalized = normalizeToken(clean);
    const hasJamo = jamoRe.test(clean);
    const hasSyllable = syllableRe.test(clean);

    if (hasJamo && !hasSyllable) stats.jamoOnly += 1;
    if (/^[0-9]{1,3}$/.test(clean)) stats.digitShort += 1;
    if (cjk && /^[A-Za-z]{1,2}$/.test(clean)) stats.asciiShort += 1;
    if (hasSyllable && edgeJamoRe.test(clean) && clean.length <= 4) stats.edgeJamo += 1;
    if (!cjk && normalized.length === 1 && !SHORT_KEEP.has(normalized)) stats.latinSingleton += 1;
  }

  const total = stats.jamoOnly + stats.digitShort + stats.asciiShort + stats.edgeJamo;
  return { total, stats };
}

function metric(page) {
  const tokens = toTokens(page);
  const language = String(page && page.language ? page.language : '');
  const lineCount = Array.isArray(page.lines) && page.lines.length > 0
    ? page.lines.length
    : (page && typeof page.text === 'string' ? page.text.split('\n').filter((line) => line.trim().length > 0).length : 0);
  const wordCount = tokens.length;
  let confAvg = 0;
  if (Array.isArray(page.words) && page.words.length > 0) {
    confAvg = page.words.reduce((sum, word) => sum + Number(word && word.confidence ? word.confidence : 0), 0) / Math.max(1, page.words.length);
  } else if (Array.isArray(page.lines) && page.lines.length > 0) {
    confAvg = page.lines.reduce((sum, line) => {
      const s = line && (line.score != null ? line.score : (line.confidence != null ? line.confidence : 0));
      return sum + Number(s || 0);
    }, 0) / Math.max(1, page.lines.length);
  } else if (page && (page.confidence != null || page.score != null)) {
    confAvg = Number(page.confidence != null ? page.confidence : page.score);
  }
  const suspicious = suspiciousBreakdown(tokens, language);
  const droppedCount = page && page.debug && Array.isArray(page.debug.droppedWords)
    ? page.debug.droppedWords.length
    : 0;

  const normalizedTokens = tokens.map(normalizeToken).filter(Boolean);
  const normalizedSet = new Set(normalizedTokens);
  return {
    wordCount,
    lineCount,
    avgWordsPerLine: wordCount / Math.max(1, lineCount),
    confidence: confAvg,
    suspiciousCount: suspicious.total,
    suspiciousRatio: suspicious.total / Math.max(1, wordCount),
    suspiciousDetail: suspicious.stats,
    droppedCount,
    meaningfulWords: countMeaningfulWords(tokens),
    standaloneShortTokens: countStandaloneShortTokens(tokens),
    language,
    tokens,
    normalizedTokens,
    tokenSet: normalizedSet,
    normalizedText: normalizedTokens.join(' '),
  };
}

function expectationCoverage(expectation, candMetric) {
  if (!expectation || !Array.isArray(expectation.mustContainAny) || expectation.mustContainAny.length === 0) {
    return null;
  }

  let matched = 0;
  for (const group of expectation.mustContainAny) {
    const normalizedGroup = (group || []).map(normalizeToken).filter(Boolean);
    if (normalizedGroup.length === 0) continue;
    if (normalizedGroup.some((token) => candMetric.tokenSet.has(token))) {
      matched += 1;
    }
  }

  return clampUnit(matched / expectation.mustContainAny.length);
}

function expectationWerProxy(expectation, candMetric) {
  const coverage = expectationCoverage(expectation, candMetric);
  if (coverage == null) return null;

  const minMeaningfulWords = Number(expectation && expectation.minMeaningfulWords ? expectation.minMeaningfulWords : 0);
  const minLines = Number(expectation && expectation.minLines ? expectation.minLines : 0);

  const meaningfulScore = minMeaningfulWords > 0
    ? clampUnit(candMetric.meaningfulWords / minMeaningfulWords)
    : 1;
  const lineScore = minLines > 0
    ? clampUnit(candMetric.lineCount / minLines)
    : 1;

  const expectedCoverage = clampUnit((coverage * 0.65) + (meaningfulScore * 0.25) + (lineScore * 0.10));
  return clampUnit(1 - expectedCoverage);
}

function expectationCerProxy(expectation, candMetric) {
  if (!expectation || !Array.isArray(expectation.mustContainAny) || expectation.mustContainAny.length === 0) {
    return null;
  }

  const referenceTokens = expectation.mustContainAny
    .map((group) => (group || []).map(normalizeToken).find(Boolean) || '')
    .filter(Boolean);

  if (referenceTokens.length === 0) return null;
  if (candMetric.normalizedTokens.length === 0) return 1;

  let totalError = 0;
  for (const token of referenceTokens) {
    let bestError = 1;
    const tokenChars = Array.from(token);
    for (const candidateToken of candMetric.normalizedTokens) {
      const candidateChars = Array.from(candidateToken);
      const error = normalizedEditError(tokenChars, candidateChars);
      if (typeof error === 'number' && error < bestError) {
        bestError = error;
      }
      if (bestError === 0) break;
    }
    totalError += bestError;
  }

  return clampUnit(totalError / referenceTokens.length);
}

function computeGarbageRatio(candMetric) {
  const suspiciousRatio = clampUnit(candMetric.suspiciousRatio);
  const shortTokenRatio = clampUnit(candMetric.standaloneShortTokens / Math.max(1, candMetric.wordCount));
  const meaningfulRatio = clampUnit(candMetric.meaningfulWords / Math.max(1, candMetric.wordCount));
  const nonMeaningfulRatio = clampUnit(1 - meaningfulRatio);

  return clampUnit(
    (suspiciousRatio * 0.60)
    + (shortTokenRatio * 0.25)
    + (nonMeaningfulRatio * 0.15)
  );
}

function computeLexicalAxis(baseMetric, candMetric, expectation) {
  const hasReference = Boolean(baseMetric && baseMetric.normalizedTokens.length > 0);
  const candGarbage = computeGarbageRatio(candMetric);
  const baseGarbage = hasReference ? computeGarbageRatio(baseMetric) : 0;
  // When comparing to a reference baseline, penalize excess garbage introduced over baseline
  const garbagePenalty = hasReference ? Math.max(0, candGarbage - baseGarbage) : candGarbage;

  let werError = hasReference
    ? normalizedEditError(baseMetric.normalizedTokens, candMetric.normalizedTokens)
    : expectationWerProxy(expectation, candMetric);

  let cerError;
  if (hasReference) {
    const refChars = Array.from(baseMetric.normalizedText);
    const candChars = Array.from(candMetric.normalizedText);
    cerError = normalizedEditError(refChars, candChars);
  } else {
    cerError = expectationCerProxy(expectation, candMetric);
  }

  if (typeof werError !== 'number') werError = garbagePenalty;
  if (typeof cerError !== 'number') cerError = garbagePenalty;

  const lexicalPenalty = clampUnit(
    (werError * LEXICAL_WEIGHTS.wer)
    + (cerError * LEXICAL_WEIGHTS.cer)
    + (garbagePenalty * LEXICAL_WEIGHTS.garbage)
  );

  return {
    score: clampUnit(1 - lexicalPenalty),
    mode: hasReference ? 'reference' : 'proxy',
    werError: clampUnit(werError),
    cerError: clampUnit(cerError),
    garbageRatio: candGarbage,
  };
}

function computeYieldAxis(baseMetric, candMetric) {
  const observedWords = Math.max(0, Number(candMetric.wordCount || 0));
  const droppedWords = Math.max(0, Number(candMetric.droppedCount || 0));
  const wordYield = clampUnit(observedWords / Math.max(1, observedWords + droppedWords));
  const baseCoverage = baseMetric && baseMetric.wordCount > 0
    ? clampUnit(observedWords / baseMetric.wordCount)
    : null;

  const coverageForScore = baseCoverage == null ? 1 : baseCoverage;
  return {
    score: clampUnit((wordYield * 0.75) + (coverageForScore * 0.25)),
    wordYield,
    baseCoverage,
  };
}

function computeCompositeEvaluation(baseMetric, candMetric, expectation) {
  const hasReference = Boolean(baseMetric && baseMetric.confidence > 0);
  const candConf = normalizeConfidenceScore(candMetric.confidence);
  const baseConf = hasReference ? normalizeConfidenceScore(baseMetric.confidence) : 0;

  // Against reference baseline, rawConfidence measures confidence retention vs baseline
  const rawConfidence = hasReference
    ? (baseConf > 0 ? clampUnit(candConf / baseConf) : 1)
    : candConf;

  const lexical = computeLexicalAxis(baseMetric, candMetric, expectation);
  const yieldAxis = computeYieldAxis(baseMetric, candMetric);

  const compositeUnit = clampUnit(
    (rawConfidence * EVAL_WEIGHTS.rawConfidence)
    + (lexical.score * EVAL_WEIGHTS.lexicalErrorPenalization)
    + (yieldAxis.score * EVAL_WEIGHTS.yieldPreservationDropSafe)
  );

  return {
    compositeScore: Number((compositeUnit * 100).toFixed(2)),
    axisScores: {
      rawConfidence,
      lexical: lexical.score,
      yieldPreservation: yieldAxis.score,
    },
    lexical,
    yield: yieldAxis,
  };
}

function diffTokenSet(baseSet, candSet, limit = 8) {
  const missing = [];
  const added = [];

  for (const token of baseSet) {
    if (!candSet.has(token)) missing.push(token);
    if (missing.length >= limit) break;
  }
  for (const token of candSet) {
    if (!baseSet.has(token)) added.push(token);
    if (added.length >= limit) break;
  }
  return { missing, added };
}

function buildRisk(baseMetric, candMetric) {
  const reasons = [];
  let score = 0;

  if (!baseMetric || !candMetric) {
    return { score, reasons };
  }

  if (baseMetric.wordCount >= 6 && candMetric.wordCount < baseMetric.wordCount * 0.9) {
    reasons.push('coverage_drop');
    score += 2;
  }
  if (
    baseMetric.lineCount > 0
    && candMetric.lineCount > baseMetric.lineCount
    && candMetric.avgWordsPerLine < baseMetric.avgWordsPerLine * 0.7
  ) {
    reasons.push('line_fragmentation');
    score += 2;
  }
  if (candMetric.suspiciousRatio > Math.max(0.15, baseMetric.suspiciousRatio + 0.08)) {
    reasons.push('ghost_spike');
    score += 2;
  }
  if (candMetric.droppedCount > 0 && candMetric.wordCount < baseMetric.wordCount) {
    reasons.push('filter_over_drop');
    score += 1;
  }

  return { score, reasons };
}

function evaluateExpectation(candMetric, expectation) {
  const reasons = [];
  const details = {};
  let score = 0;

  if (!candMetric) {
    return { score: 3, reasons: ['missing_candidate'], details };
  }

  if (!expectation) {
    return { score, reasons, details };
  }

  if (candMetric.lineCount < expectation.minLines) {
    reasons.push('expect_lines');
    details.lineCount = { actual: candMetric.lineCount, expected: expectation.minLines };
    score += 2;
  }

  if (candMetric.meaningfulWords < expectation.minMeaningfulWords) {
    reasons.push('expect_meaningful');
    details.meaningfulWords = { actual: candMetric.meaningfulWords, expected: expectation.minMeaningfulWords };
    score += 2;
  }

  const missingGroups = [];
  for (const group of expectation.mustContainAny || []) {
    const normalizedGroup = (group || []).map(normalizeToken).filter(Boolean);
    const matched = normalizedGroup.some((token) => candMetric.tokenSet.has(token));
    if (!matched && normalizedGroup.length > 0) {
      missingGroups.push(normalizedGroup);
    }
  }
  if (missingGroups.length > 0) {
    reasons.push('expect_missing_token');
    details.missingGroups = missingGroups;
    score += missingGroups.length;
  }

  const forbiddenHits = (expectation.mustNotContainNormalized || [])
    .map(normalizeToken)
    .filter((token) => token && candMetric.tokenSet.has(token));
  if (forbiddenHits.length > 0) {
    reasons.push('expect_forbidden_token');
    details.forbiddenHits = forbiddenHits;
    score += forbiddenHits.length;
  }

  if (candMetric.standaloneShortTokens > expectation.maxStandaloneShortTokens) {
    reasons.push('expect_short_tokens');
    details.standaloneShortTokens = {
      actual: candMetric.standaloneShortTokens,
      expected: expectation.maxStandaloneShortTokens,
    };
    score += 1;
  }

  if (candMetric.suspiciousRatio > expectation.maxSuspiciousRatio) {
    reasons.push('expect_suspicious_ratio');
    details.suspiciousRatio = {
      actual: candMetric.suspiciousRatio,
      expected: expectation.maxSuspiciousRatio,
    };
    score += 2;
  }

  return { score, reasons, details };
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.cand) {
    console.error('Usage: node scripts/ocr-regression-report.js --cand <candidate.json> [--base baseline.json] [--expect expectations.json] [--out report.json] [--fail-on-risk] [--partial]');
    process.exit(1);
  }

  const baseJson = args.base ? loadJson(args.base) : null;
  const candJson = loadJson(args.cand);
  const expectJson = args.expect ? loadJson(args.expect) : null;
  const basePages = baseJson ? normalizePages(baseJson) : new Map();
  const candPages = normalizePages(candJson);
  const expectations = normalizeExpectations(expectJson);

  const pageNumbers = args.partial
    ? Array.from(new Set([
      ...candPages.keys(),
    ])).sort((a, b) => a - b)
    : Array.from(new Set([
      ...basePages.keys(),
      ...candPages.keys(),
      ...expectations.keys(),
    ])).sort((a, b) => a - b);
  const pageReports = [];

  let baseWordsTotal = 0;
  let candWordsTotal = 0;
  let baseSuspiciousTotal = 0;
  let candSuspiciousTotal = 0;
  let expectationFailures = 0;
  let evaluatedPages = 0;
  let compositeScoreTotal = 0;
  let rawAxisTotal = 0;
  let lexicalAxisTotal = 0;
  let yieldAxisTotal = 0;
  let werErrorTotal = 0;
  let cerErrorTotal = 0;
  let garbageRatioTotal = 0;

  for (const pageNum of pageNumbers) {
    const basePage = basePages.get(pageNum);
    const candPage = candPages.get(pageNum);
    const expectation = expectations.get(pageNum);
    if (!candPage) {
      const missingEvaluation = {
        compositeScore: 0,
        axisScores: {
          rawConfidence: 0,
          lexical: 0,
          yieldPreservation: 0,
        },
        lexicalError: {
          mode: 'proxy',
          wer: 1,
          cer: 1,
          garbageRatio: 1,
        },
        yield: {
          wordYield: 0,
          baseCoverage: basePage ? 0 : null,
        },
      };
      pageReports.push({
        page: pageNum,
        score: 3,
        reasons: ['missing_page'],
        baseExists: Boolean(basePage),
        candExists: false,
        expectation: expectation || null,
        evaluation: missingEvaluation,
      });
      if (expectation) expectationFailures += 1;

      evaluatedPages += 1;
      compositeScoreTotal += missingEvaluation.compositeScore;
      rawAxisTotal += missingEvaluation.axisScores.rawConfidence;
      lexicalAxisTotal += missingEvaluation.axisScores.lexical;
      yieldAxisTotal += missingEvaluation.axisScores.yieldPreservation;
      werErrorTotal += missingEvaluation.lexicalError.wer;
      cerErrorTotal += missingEvaluation.lexicalError.cer;
      garbageRatioTotal += missingEvaluation.lexicalError.garbageRatio;
      continue;
    }

    const baseMetric = basePage ? metric(basePage) : null;
    const candMetric = metric(candPage);
    const evaluation = computeCompositeEvaluation(baseMetric, candMetric, expectation);
    const { score: baseScore, reasons: baseReasons } = buildRisk(baseMetric, candMetric);
    const { score: expectScore, reasons: expectReasons, details: expectDetails } = evaluateExpectation(candMetric, expectation);
    const combinedReasons = Array.from(new Set([...baseReasons, ...expectReasons]));
    const tokenDiff = baseMetric ? diffTokenSet(baseMetric.tokenSet, candMetric.tokenSet) : { missing: [], added: [] };
    if (expectReasons.length > 0) {
      expectationFailures += 1;
    }

    pageReports.push({
      page: pageNum,
      score: baseScore + expectScore,
      reasons: combinedReasons,
      base: baseMetric ? {
        words: baseMetric.wordCount,
        lines: baseMetric.lineCount,
        suspicious: baseMetric.suspiciousCount,
        suspiciousRatio: baseMetric.suspiciousRatio,
        avgWordsPerLine: baseMetric.avgWordsPerLine,
        confidence: Number(baseMetric.confidence.toFixed(2)),
      } : null,
      candidate: {
        words: candMetric.wordCount,
        lines: candMetric.lineCount,
        meaningfulWords: candMetric.meaningfulWords,
        suspicious: candMetric.suspiciousCount,
        suspiciousRatio: candMetric.suspiciousRatio,
        avgWordsPerLine: candMetric.avgWordsPerLine,
        confidence: Number(candMetric.confidence.toFixed(2)),
        dropped: candMetric.droppedCount,
        standaloneShortTokens: candMetric.standaloneShortTokens,
      },
      expectation: expectation || null,
      expectationDetails: expectDetails,
      evaluation: {
        compositeScore: evaluation.compositeScore,
        axisScores: {
          rawConfidence: Number((evaluation.axisScores.rawConfidence * 100).toFixed(2)),
          lexical: Number((evaluation.axisScores.lexical * 100).toFixed(2)),
          yieldPreservation: Number((evaluation.axisScores.yieldPreservation * 100).toFixed(2)),
        },
        lexicalError: {
          mode: evaluation.lexical.mode,
          wer: Number(evaluation.lexical.werError.toFixed(4)),
          cer: Number(evaluation.lexical.cerError.toFixed(4)),
          garbageRatio: Number(evaluation.lexical.garbageRatio.toFixed(4)),
        },
        yield: {
          wordYield: Number(evaluation.yield.wordYield.toFixed(4)),
          baseCoverage: evaluation.yield.baseCoverage == null ? null : Number(evaluation.yield.baseCoverage.toFixed(4)),
        },
      },
      missingTokens: tokenDiff.missing,
      addedTokens: tokenDiff.added,
    });

    evaluatedPages += 1;
    compositeScoreTotal += evaluation.compositeScore;
    rawAxisTotal += evaluation.axisScores.rawConfidence;
    lexicalAxisTotal += evaluation.axisScores.lexical;
    yieldAxisTotal += evaluation.axisScores.yieldPreservation;
    werErrorTotal += evaluation.lexical.werError;
    cerErrorTotal += evaluation.lexical.cerError;
    garbageRatioTotal += evaluation.lexical.garbageRatio;

    if (baseMetric) {
      baseWordsTotal += baseMetric.wordCount;
      baseSuspiciousTotal += baseMetric.suspiciousCount;
    }
    candWordsTotal += candMetric.wordCount;
    candSuspiciousTotal += candMetric.suspiciousCount;
  }

  const risky = pageReports
    .filter((report) => report.score >= 2 || report.reasons.length > 0)
    .sort((a, b) => b.score - a.score || a.page - b.page);

  const scopedExpectationPages = args.partial
    ? pageNumbers.filter((pageNum) => expectations.has(pageNum)).length
    : expectations.size;

  const summary = {
    comparedPages: pageNumbers.length,
    expectationPages: scopedExpectationPages,
    expectationFailures,
    baseWordsTotal,
    candWordsTotal,
    wordDelta: candWordsTotal - baseWordsTotal,
    baseSuspiciousTotal,
    candSuspiciousTotal,
    suspiciousDelta: candSuspiciousTotal - baseSuspiciousTotal,
    riskyPages: risky.length,
    compositeScore: Number((compositeScoreTotal / Math.max(1, evaluatedPages)).toFixed(2)),
    axisScores: {
      rawConfidence: Number(((rawAxisTotal / Math.max(1, evaluatedPages)) * 100).toFixed(2)),
      lexical: Number(((lexicalAxisTotal / Math.max(1, evaluatedPages)) * 100).toFixed(2)),
      yieldPreservation: Number(((yieldAxisTotal / Math.max(1, evaluatedPages)) * 100).toFixed(2)),
    },
    lexicalErrors: {
      wer: Number((werErrorTotal / Math.max(1, evaluatedPages)).toFixed(4)),
      cer: Number((cerErrorTotal / Math.max(1, evaluatedPages)).toFixed(4)),
      garbageRatio: Number((garbageRatioTotal / Math.max(1, evaluatedPages)).toFixed(4)),
    },
    methodology: {
      version: 'ocr-composite-v1',
      weights: {
        rawConfidence: EVAL_WEIGHTS.rawConfidence,
        lexicalErrorPenalization: EVAL_WEIGHTS.lexicalErrorPenalization,
        yieldPreservationDropSafe: EVAL_WEIGHTS.yieldPreservationDropSafe,
      },
      lexicalWeights: {
        wer: LEXICAL_WEIGHTS.wer,
        cer: LEXICAL_WEIGHTS.cer,
        garbage: LEXICAL_WEIGHTS.garbage,
      },
    },
  };

  console.log('[OCR Regression] Summary');
  console.log(`- pages: ${summary.comparedPages}`);
  if (args.base) {
    console.log(`- words: ${summary.baseWordsTotal} -> ${summary.candWordsTotal} (delta ${summary.wordDelta >= 0 ? '+' : ''}${summary.wordDelta})`);
    console.log(`- suspicious: ${summary.baseSuspiciousTotal} -> ${summary.candSuspiciousTotal} (delta ${summary.suspiciousDelta >= 0 ? '+' : ''}${summary.suspiciousDelta})`);
  } else {
    console.log(`- candidate words: ${summary.candWordsTotal}`);
    console.log(`- candidate suspicious: ${summary.candSuspiciousTotal}`);
  }
  console.log(`- expectation failures: ${summary.expectationFailures}/${summary.expectationPages}`);
  console.log(`- risky pages: ${summary.riskyPages}`);
  console.log(`- composite score: ${summary.compositeScore}/100`);
  console.log(`- axis raw/lexical/yield: ${summary.axisScores.rawConfidence}% / ${summary.axisScores.lexical}% / ${summary.axisScores.yieldPreservation}%`);
  console.log(`- lexical errors wer/cer/garbage: ${summary.lexicalErrors.wer} / ${summary.lexicalErrors.cer} / ${summary.lexicalErrors.garbageRatio}`);

  if (risky.length > 0) {
    console.log('\n[OCR Regression] Risk Details');
    risky.slice(0, 20).forEach((report) => {
      const baseWords = report.base ? report.base.words : '-';
      const candWords = report.candidate ? report.candidate.words : '-';
      const baseLines = report.base ? report.base.lines : '-';
      const candLines = report.candidate ? report.candidate.lines : '-';
      const baseGhost = report.base ? formatPercent(report.base.suspiciousRatio) : '-';
      const candGhost = report.candidate ? formatPercent(report.candidate.suspiciousRatio) : '-';
      console.log(
        `- page ${report.page}: score=${report.score} [${report.reasons.join(', ')}] `
        + `words ${baseWords}->${candWords}, lines ${baseLines}->${candLines}, ghost ${baseGhost}->${candGhost}`
      );
      if (report.expectationDetails && Object.keys(report.expectationDetails).length > 0) {
        console.log(`  expect: ${JSON.stringify(report.expectationDetails)}`);
      }
      if (report.addedTokens && report.addedTokens.length > 0) {
        console.log(`  added: ${report.addedTokens.join(', ')}`);
      }
      if (report.missingTokens && report.missingTokens.length > 0) {
        console.log(`  missing: ${report.missingTokens.join(', ')}`);
      }
    });
  }

  const report = {
    summary,
    pages: pageReports,
  };

  if (args.out) {
    const outPath = path.resolve(args.out);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\nReport written to ${outPath}`);
  }

  if (candPages.size === 0 || summary.comparedPages === 0) {
    console.error('\n[OCR Regression] FATAL: 0 candidate pages found or compared!');
    process.exit(1);
  }

  if (args.failOnRisk && risky.length > 0) {
    console.error(`\n[OCR Regression] FATAL: ${risky.length} risky/regressed pages detected with --fail-on-risk active!`);
    process.exit(2);
  }
}

main();
