#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    base: '',
    cand: '',
    out: '',
    failOnRisk: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') args.base = argv[i + 1] || '';
    if (arg === '--cand') args.cand = argv[i + 1] || '';
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
  };

  const cjk = isCjkLike(language);
  const jamoRe = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/;
  const syllableRe = /[\uAC00-\uD7AF]/;
  const edgeJamoRe = /^[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]|[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]$/;

  for (const token of tokens) {
    const clean = token.trim();
    if (!clean) continue;
    const hasJamo = jamoRe.test(clean);
    const hasSyllable = syllableRe.test(clean);

    if (hasJamo && !hasSyllable) stats.jamoOnly += 1;
    if (/^[0-9]{1,3}$/.test(clean)) stats.digitShort += 1;
    if (cjk && /^[A-Za-z]{1,2}$/.test(clean)) stats.asciiShort += 1;
    if (hasSyllable && edgeJamoRe.test(clean) && clean.length <= 4) stats.edgeJamo += 1;
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

  const normalizedSet = new Set(tokens.map(normalizeToken).filter(Boolean));
  return {
    wordCount,
    lineCount,
    avgWordsPerLine: wordCount / Math.max(1, lineCount),
    confidence: confAvg,
    suspiciousCount: suspicious.total,
    suspiciousRatio: suspicious.total / Math.max(1, wordCount),
    suspiciousDetail: suspicious.stats,
    droppedCount,
    language,
    tokens,
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

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.base || !args.cand) {
    console.error('Usage: node scripts/ocr-regression-report.js --base <baseline.json> --cand <candidate.json> [--out report.json] [--fail-on-risk]');
    process.exit(1);
  }

  const baseJson = loadJson(args.base);
  const candJson = loadJson(args.cand);
  const basePages = normalizePages(baseJson);
  const candPages = normalizePages(candJson);

  const pageNumbers = Array.from(new Set([...basePages.keys(), ...candPages.keys()])).sort((a, b) => a - b);
  const pageReports = [];

  let baseWordsTotal = 0;
  let candWordsTotal = 0;
  let baseSuspiciousTotal = 0;
  let candSuspiciousTotal = 0;

  for (const pageNum of pageNumbers) {
    const basePage = basePages.get(pageNum);
    const candPage = candPages.get(pageNum);
    if (!basePage || !candPage) {
      pageReports.push({
        page: pageNum,
        score: 3,
        reasons: ['missing_page'],
        baseExists: Boolean(basePage),
        candExists: Boolean(candPage),
      });
      continue;
    }

    const baseMetric = metric(basePage);
    const candMetric = metric(candPage);
    const { score, reasons } = buildRisk(baseMetric, candMetric);
    const tokenDiff = diffTokenSet(baseMetric.tokenSet, candMetric.tokenSet);

    pageReports.push({
      page: pageNum,
      score,
      reasons,
      base: {
        words: baseMetric.wordCount,
        lines: baseMetric.lineCount,
        suspicious: baseMetric.suspiciousCount,
        suspiciousRatio: baseMetric.suspiciousRatio,
        avgWordsPerLine: baseMetric.avgWordsPerLine,
        confidence: Number(baseMetric.confidence.toFixed(2)),
      },
      candidate: {
        words: candMetric.wordCount,
        lines: candMetric.lineCount,
        suspicious: candMetric.suspiciousCount,
        suspiciousRatio: candMetric.suspiciousRatio,
        avgWordsPerLine: candMetric.avgWordsPerLine,
        confidence: Number(candMetric.confidence.toFixed(2)),
        dropped: candMetric.droppedCount,
      },
      missingTokens: tokenDiff.missing,
      addedTokens: tokenDiff.added,
    });

    baseWordsTotal += baseMetric.wordCount;
    candWordsTotal += candMetric.wordCount;
    baseSuspiciousTotal += baseMetric.suspiciousCount;
    candSuspiciousTotal += candMetric.suspiciousCount;
  }

  const risky = pageReports
    .filter((report) => report.score >= 2)
    .sort((a, b) => b.score - a.score || a.page - b.page);

  const summary = {
    comparedPages: pageNumbers.length,
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
  console.log(`- words: ${summary.baseWordsTotal} -> ${summary.candWordsTotal} (delta ${summary.wordDelta >= 0 ? '+' : ''}${summary.wordDelta})`);
  console.log(`- suspicious: ${summary.baseSuspiciousTotal} -> ${summary.candSuspiciousTotal} (delta ${summary.suspiciousDelta >= 0 ? '+' : ''}${summary.suspiciousDelta})`);
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
