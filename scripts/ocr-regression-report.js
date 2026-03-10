#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const SHORT_KEEP = new Set(['i', 'a', 'go', 'to', 'do', 'in', 'on', 'of', 'if', 'is', 'be', 'we', 'us', 'my', 'or', 'an', 'at', 'as', 'am', 'up', 'it']);

function parseArgs(argv) {
  const args = {
    base: '',
    cand: '',
    expect: '',
    out: '',
    failOnRisk: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') args.base = argv[i + 1] || '';
    if (arg === '--cand') args.cand = argv[i + 1] || '';
    if (arg === '--expect') args.expect = argv[i + 1] || '';
    if (arg === '--out') args.out = argv[i + 1] || '';
    if (arg === '--fail-on-risk') args.failOnRisk = true;
  }
  return args;
}

function loadJson(filePath) {
  const fullPath = path.resolve(filePath);
  const raw = fs.readFileSync(fullPath, 'utf8');
  return JSON.parse(raw);
}

function inferPageNumber(page, fallbackIndex) {
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
  const confAvg = Array.isArray(page.words) && page.words.length > 0
    ? page.words.reduce((sum, word) => sum + Number(word && word.confidence ? word.confidence : 0), 0) / Math.max(1, page.words.length)
    : Number(page && page.confidence ? page.confidence : 0);
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
    console.error('Usage: node scripts/ocr-regression-report.js --cand <candidate.json> [--base baseline.json] [--expect expectations.json] [--out report.json] [--fail-on-risk]');
    process.exit(1);
  }

  const baseJson = args.base ? loadJson(args.base) : null;
  const candJson = loadJson(args.cand);
  const expectJson = args.expect ? loadJson(args.expect) : null;
  const basePages = baseJson ? normalizePages(baseJson) : new Map();
  const candPages = normalizePages(candJson);
  const expectations = normalizeExpectations(expectJson);

  const pageNumbers = Array.from(new Set([
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

  for (const pageNum of pageNumbers) {
    const basePage = basePages.get(pageNum);
    const candPage = candPages.get(pageNum);
    const expectation = expectations.get(pageNum);
    if (!candPage) {
      pageReports.push({
        page: pageNum,
        score: 3,
        reasons: ['missing_page'],
        baseExists: Boolean(basePage),
        candExists: false,
        expectation: expectation || null,
      });
      if (expectation) expectationFailures += 1;
      continue;
    }

    const baseMetric = basePage ? metric(basePage) : null;
    const candMetric = metric(candPage);
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
      missingTokens: tokenDiff.missing,
      addedTokens: tokenDiff.added,
    });

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

  const summary = {
    comparedPages: pageNumbers.length,
    expectationPages: expectations.size,
    expectationFailures,
    baseWordsTotal,
    candWordsTotal,
    wordDelta: candWordsTotal - baseWordsTotal,
    baseSuspiciousTotal,
    candSuspiciousTotal,
    suspiciousDelta: candSuspiciousTotal - baseSuspiciousTotal,
    riskyPages: risky.length,
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

  if (args.failOnRisk && risky.length > 0) {
    process.exit(2);
  }
}

main();
