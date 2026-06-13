#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

// --- OCR Benchmark Service logic port ---
const BENCHMARK_SHORT_KEEP = new Set([
  'i', 'a', 'go', 'to', 'do', 'in', 'on', 'of', 'if', 'is', 'be', 'we', 'us', 'my', 'or', 'an', 'at', 'as', 'am', 'up', 'it',
  'в', 'и', 'с', 'я', 'к', 'о', 'а', 'у', 'он', 'не', 'по', 'на', 'из', 'от', 'до', 'за', 'да', 'но', 'вы', 'ты', 'мы'
]);

const BENCHMARK_DOMAIN_TOKENS = new Set(['io', 'com', 'net', 'org', 'gg', 'tv']);

const BENCHMARK_COMPOSITE_WEIGHTS = {
  rawConfidence: 0.35,
  lexicalErrorPenalization: 0.45,
  yieldPreservationDropSafe: 0.20,
};

function normalizeBenchmarkToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();
}

function isCjkLikeLanguage(language) {
  const lang = String(language || '').toLowerCase();
  return lang.includes('kor') || lang.includes('jpn') || lang.includes('chi') || lang.includes('tha');
}

function toBenchmarkTokens(result) {
  if (result.words && Array.isArray(result.words) && result.words.length > 0) {
    return result.words
      .map((word) => String(word?.text || '').trim())
      .filter(Boolean);
  }
  if (result.lines && Array.isArray(result.lines) && result.lines.length > 0) {
    return result.lines
      .flatMap((line) => String(line?.text || '').split(/\s+/g))
      .map((text) => text.trim())
      .filter(Boolean);
  }
  if (typeof result.text === 'string') {
    return result.text
      .split(/\s+/g)
      .map((text) => text.trim())
      .filter(Boolean);
  }
  return [];
}

function computeSuspiciousCount(tokens, language) {
  const cjkLike = isCjkLikeLanguage(language);
  const jamoRe = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/;
  const syllableRe = /[\uAC00-\uD7AF]/;
  const edgeJamoRe = /^[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]|[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]$/;
  const thaiConsoOnly = /^[\u0E00-\u0E2E]+$/;

  let suspicious = 0;

  for (const token of tokens) {
    const clean = token.trim();
    if (!clean) continue;
    const normalized = normalizeBenchmarkToken(clean);
    
    const specialCharsCount = (clean.match(/[^\p{L}\p{N}\s]/gu) || []).length;
    if (specialCharsCount > 0 && specialCharsCount >= clean.length * 0.5) {
      suspicious += 1;
      continue;
    }

    const hasJamo = jamoRe.test(clean);
    const hasSyllable = syllableRe.test(clean);

    if (hasJamo && !hasSyllable) { suspicious += 1; continue; }
    if (/^[0-9]{1,3}$/.test(clean)) { suspicious += 1; continue; }
    if (cjkLike && /^[A-Za-z]{1,2}$/.test(clean) && !BENCHMARK_SHORT_KEEP.has(clean.toLowerCase())) { suspicious += 1; continue; }
    if (hasSyllable && edgeJamoRe.test(clean) && clean.length <= 4) { suspicious += 1; continue; }
    
    if (language.includes('tha') && thaiConsoOnly.test(clean)) {
      if (clean.length === 1 && !['ก็','ณ','ธ'].includes(clean)) {
        suspicious += 1; continue;
      }
      if (clean.length >= 4) {
        suspicious += 1; continue;
      }
    }

    if (!cjkLike && normalized.length === 1 && !BENCHMARK_SHORT_KEEP.has(normalized)) { suspicious += 1; continue; }
  }

  return suspicious;
}

function clampUnit(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function computeLexicalQuality(tokens, language) {
  if (tokens.length === 0) return 0;
  
  const isCjk = isCjkLikeLanguage(language);
  const isThai = language.includes('tha');
  const vowelLike = /[aeiouyаеёиоуыэюя]/i;
  const thaiVowelTone = /[\u0E30-\u0E4E]/;
  const cjkChars = /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7A3]/;

  let considered = 0;
  let strong = 0;
  let artifact = 0;

  for (const rawToken of tokens) {
    const normalized = normalizeBenchmarkToken(rawToken);
    if (!normalized) continue;

    considered += 1;

    if (BENCHMARK_DOMAIN_TOKENS.has(normalized) || /^[0-9]{1,4}$/.test(normalized)) {
      artifact += 1;
      continue;
    }

    if (BENCHMARK_SHORT_KEEP.has(normalized)) {
      strong += 1;
      continue;
    }

    if (isThai) {
      if (thaiVowelTone.test(rawToken)) {
        strong += 1;
      } else if (rawToken.length === 1) {
        artifact += 1;
      } else if (rawToken.length >= 2) {
        strong += 0.5;
      }
    } else if (isCjk) {
       if (cjkChars.test(rawToken)) strong += 1;
       else if (rawToken.length === 1) artifact += 1;
       else strong += 0.5;
    } else {
      if (normalized.length >= 5 || vowelLike.test(normalized)) {
        strong += 1;
      }
    }
  }

  if (considered === 0) return 0;

  const strongRatio = strong / considered;
  const artifactRatio = artifact / considered;
  return clampUnit(strongRatio - (artifactRatio * 0.45));
}

function normalizeBenchmarkConfidence(confidence) {
  if (!Number.isFinite(confidence)) return 0;
  if (confidence <= 1) return clampUnit(confidence);
  return clampUnit(confidence / 100);
}

function calculateCompositeScore(result, language) {
  const tokens = toBenchmarkTokens(result);
  const confidence = result.confidence || 0;
  const suspiciousCount = computeSuspiciousCount(tokens, language);
  const suspiciousRatio = suspiciousCount / Math.max(1, tokens.length);
  const lexicalQuality = computeLexicalQuality(tokens, language);
  const droppedCount = (result.debug?.droppedWords || []).length;
  const wordCount = tokens.length;

  const confidenceScore = normalizeBenchmarkConfidence(confidence);
  const garbageRatio = clampUnit((suspiciousRatio * 0.80) + ((1 - clampUnit(lexicalQuality)) * 0.20));
  const lexicalPenalty = garbageRatio;
  const lexicalAxis = clampUnit(1 - lexicalPenalty);

  const effectiveWordCount = wordCount * lexicalAxis;
  const yieldAxis = clampUnit(effectiveWordCount / Math.max(1, wordCount + Math.max(0, droppedCount)));

  const composite = (
    (confidenceScore * BENCHMARK_COMPOSITE_WEIGHTS.rawConfidence)
    + (lexicalAxis * BENCHMARK_COMPOSITE_WEIGHTS.lexicalErrorPenalization)
    + (yieldAxis * BENCHMARK_COMPOSITE_WEIGHTS.yieldPreservationDropSafe)
  ) * 100;

  return Number(composite.toFixed(2));
}

// --- Main script logic ---
async function main() {
  const baseUrl = 'http://localhost:5173';
  const manifestPath = path.resolve('public/fixtures/ocr/manga/expectations.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  console.log(`[compare-pipeline] Launching Playwright browser...`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const pagesResults = [];

  try {
    for (const fixture of manifest.cases) {
      console.log(`\n[compare-pipeline] Running RAW configuration for fixture: ${fixture.id}`);
      const rawUrl = `${baseUrl}/?ocr_harness=1&fixture=${encodeURIComponent(fixture.id)}&engine=paddleocr&config=raw&no_fallback=1`;
      await page.goto(rawUrl, { waitUntil: 'load' });
      await page.waitForFunction(
        () => {
          const payload = window.__OCR_REGRESSION_RESULT__;
          return Boolean(payload && typeof payload === 'object' && ['done', 'error'].includes(payload.status));
        },
        undefined,
        { timeout: 180000 }
      );

      const rawPayload = await page.evaluate(() => window.__OCR_REGRESSION_RESULT__);
      if (rawPayload.status === 'error') {
        throw new Error(`Raw run failed: ${rawPayload.error}`);
      }

      console.log(`[compare-pipeline] Running OPTIMIZED configuration for fixture: ${fixture.id}`);
      const optUrl = `${baseUrl}/?ocr_harness=1&fixture=${encodeURIComponent(fixture.id)}&engine=paddleocr&config=optimized&no_fallback=1`;
      await page.goto(optUrl, { waitUntil: 'load' });
      await page.waitForFunction(
        () => {
          const payload = window.__OCR_REGRESSION_RESULT__;
          return Boolean(payload && typeof payload === 'object' && ['done', 'error'].includes(payload.status));
        },
        undefined,
        { timeout: 180000 }
      );

      const optPayload = await page.evaluate(() => window.__OCR_REGRESSION_RESULT__);
      if (optPayload.status === 'error') {
        throw new Error(`Optimized run failed: ${optPayload.error}`);
      }

      const rawOcr = rawPayload.ocr;
      const optOcr = optPayload.ocr;

      const rawAccuracy = calculateCompositeScore(rawOcr, fixture.language || 'eng');
      const optAccuracy = calculateCompositeScore(optOcr, fixture.language || 'eng');

      const rawConfidence = rawOcr.confidence || 0;
      const optConfidence = optOcr.confidence || 0;
      const confidenceDelta = optConfidence - rawConfidence;

      const prepLatency = optOcr.debug?.preprocessing_latency_ms || 0;

      console.log(`[compare-pipeline] ${fixture.id} - Raw Acc: ${rawAccuracy}% | Opt Acc: ${optAccuracy}% | Prep Latency: ${prepLatency.toFixed(1)}ms`);

      pagesResults.push({
        fixtureId: fixture.id,
        page: fixture.page,
        raw_accuracy: rawAccuracy,
        optimized_accuracy: optAccuracy,
        raw_confidence: rawConfidence,
        optimized_confidence: optConfidence,
        confidence_score_delta: Number(confidenceDelta.toFixed(2)),
        preprocessing_latency_ms: Number(prepLatency.toFixed(1)),
        raw_runtime_ms: rawOcr.debug?.runtimeMs || 0,
        optimized_runtime_ms: optOcr.debug?.runtimeMs || 0,
        raw_text: rawOcr.text || '',
        optimized_text: optOcr.text || '',
      });
    }
  } finally {
    await browser.close();
  }

  // Calculate averages
  const count = pagesResults.length;
  const rawAccuracyAvg = count > 0 ? Number((pagesResults.reduce((acc, p) => acc + p.raw_accuracy, 0) / count).toFixed(2)) : 0;
  const optAccuracyAvg = count > 0 ? Number((pagesResults.reduce((acc, p) => acc + p.optimized_accuracy, 0) / count).toFixed(2)) : 0;
  const prepLatencyAvg = count > 0 ? Number((pagesResults.reduce((acc, p) => acc + p.preprocessing_latency_ms, 0) / count).toFixed(2)) : 0;
  const confidenceDeltaAvg = count > 0 ? Number((pagesResults.reduce((acc, p) => acc + p.confidence_score_delta, 0) / count).toFixed(2)) : 0;

  const outputJson = {
    generatedAt: new Date().toISOString(),
    summary: {
      raw_accuracy_avg: rawAccuracyAvg,
      optimized_accuracy_avg: optAccuracyAvg,
      preprocessing_latency_ms_avg: prepLatencyAvg,
      confidence_score_delta_avg: confidenceDeltaAvg,
    },
    pages: pagesResults,
  };

  // Write JSON
  fs.writeFileSync('benchmark-results.json', JSON.stringify(outputJson, null, 2), 'utf8');
  console.log(`\n[compare-pipeline] Wrote JSON results to: benchmark-results.json`);

  // Write Markdown Report
  let md = `# OCR Pipeline Comparison Report\n\n`;
  md += `Generated at: ${outputJson.generatedAt}\n\n`;
  md += `## Summary Metrics\n\n`;
  md += `| Metric | RAW PaddleOCR | OPTIMIZED PaddleOCR | Delta / Cost |\n`;
  md += `| :--- | :---: | :---: | :---: |\n`;
  md += `| **Average Accuracy (Composite)** | ${rawAccuracyAvg}% | ${optAccuracyAvg}% | **${(optAccuracyAvg - rawAccuracyAvg).toFixed(2)}%** |\n`;
  md += `| **Average Preprocessing Latency** | 0.0 ms | ${prepLatencyAvg} ms | Cost of improvement |\n`;
  md += `| **Average Confidence Score Delta** | - | - | **${confidenceDeltaAvg}%** |\n\n`;

  md += `## Detailed Page Results\n\n`;
  md += `| Fixture | Page | Raw Accuracy | Optimized Accuracy | Confidence Delta | Prep Latency | Raw Runtime | Optimized Runtime |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  for (const page of pagesResults) {
    md += `| ${page.fixtureId} | ${page.page} | ${page.raw_accuracy}% | ${page.optimized_accuracy}% | ${page.confidence_score_delta}% | ${page.preprocessing_latency_ms} ms | ${page.raw_runtime_ms.toFixed(1)} ms | ${page.optimized_runtime_ms.toFixed(1)} ms |\n`;
  }

  md += `\n## Contextual Text comparison\n\n`;
  for (const page of pagesResults) {
    md += `### Fixture: ${page.fixtureId} (Page ${page.page})\n\n`;
    md += `#### RAW Text\n\`\`\`text\n${page.raw_text || '(no text)'}\n\`\`\`\n\n`;
    md += `#### OPTIMIZED Text\n\`\`\`text\n${page.optimized_text || '(no text)'}\n\`\`\`\n\n`;
    md += `---\n\n`;
  }

  fs.writeFileSync('benchmark-results.md', md, 'utf8');
  console.log(`[compare-pipeline] Wrote Markdown report to: benchmark-results.md`);
}

main().catch((err) => {
  console.error('[compare-pipeline] Run failed:', err);
  process.exit(1);
});
