#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://localhost:5173',
    manifest: 'public/fixtures/ocr/manga/expectations.json',
    base: 'public/fixtures/ocr/baseline/ocr-v38-panel.json',
    expect: 'public/fixtures/ocr/manga/expectations.json',
    outJson: '.tmp-ocr-benchmark.json',
    outMd: '.tmp-ocr-benchmark.md',
    skipMissing: true,
    failOnRisk: false,
    pipeline: 'panel',
    quality: 'best',
    engines: ['tesseract', 'paddleocr', 'easyocr'],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') args.baseUrl = argv[i + 1] || args.baseUrl;
    if (arg === '--manifest') args.manifest = argv[i + 1] || args.manifest;
    if (arg === '--base') args.base = argv[i + 1] || args.base;
    if (arg === '--expect') args.expect = argv[i + 1] || args.expect;
    if (arg === '--out-json') args.outJson = argv[i + 1] || args.outJson;
    if (arg === '--out-md') args.outMd = argv[i + 1] || args.outMd;
    if (arg === '--pipeline') args.pipeline = argv[i + 1] || args.pipeline;
    if (arg === '--quality') args.quality = argv[i + 1] || args.quality;
    if (arg === '--engines') {
      const raw = argv[i + 1] || '';
      const items = raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
      if (items.length > 0) args.engines = items;
    }
    if (arg === '--skip-missing') args.skipMissing = true;
    if (arg === '--no-skip-missing') args.skipMissing = false;
    if (arg === '--fail-on-risk') args.failOnRisk = true;
  }

  return args;
}

function assertOptions(args) {
  if (!['panel', 'export'].includes(args.pipeline)) {
    throw new Error(`Invalid --pipeline \"${args.pipeline}\". Use panel or export.`);
  }
  if (!['fast', 'balanced', 'best'].includes(args.quality)) {
    throw new Error(`Invalid --quality \"${args.quality}\". Use fast, balanced, or best.`);
  }
  for (const engine of args.engines) {
    if (!['tesseract', 'paddleocr', 'easyocr'].includes(engine)) {
      throw new Error(`Invalid engine \"${engine}\" in --engines. Allowed: tesseract,paddleocr,easyocr.`);
    }
  }
}

function runNodeScript(scriptRelativePath, scriptArgs) {
  const scriptPath = path.resolve(scriptRelativePath);
  const result = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  });

  const exitCode = typeof result.status === 'number' ? result.status : 1;
  return { ok: exitCode === 0, exitCode };
}

function loadJson(filePath) {
  const fullPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function getRuntimeMs(page) {
  const debug = page && page.debug && typeof page.debug === 'object' ? page.debug : null;
  if (!debug) return null;

  if (typeof debug.runtimeMs === 'number' && Number.isFinite(debug.runtimeMs)) {
    return debug.runtimeMs;
  }

  const timings = debug.timingsMs && typeof debug.timingsMs === 'object' ? debug.timingsMs : null;
  if (timings && typeof timings.ocr === 'number' && Number.isFinite(timings.ocr)) {
    return timings.ocr;
  }

  return null;
}

function percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function summarizeRuntime(pages) {
  const runtimes = [];
  for (const page of pages || []) {
    const value = getRuntimeMs(page);
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      runtimes.push(value);
    }
  }

  if (runtimes.length === 0) {
    return {
      count: 0,
      avgMs: null,
      p50Ms: null,
      p90Ms: null,
      minMs: null,
      maxMs: null,
    };
  }

  const sorted = runtimes.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    avgMs: Number((sum / sorted.length).toFixed(1)),
    p50Ms: Number((percentile(sorted, 0.5) || 0).toFixed(1)),
    p90Ms: Number((percentile(sorted, 0.9) || 0).toFixed(1)),
    minMs: Number(sorted[0].toFixed(1)),
    maxMs: Number(sorted[sorted.length - 1].toFixed(1)),
  };
}

function toMdNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return String(value);
}

function buildMarkdown(summary) {
  const lines = [];
  lines.push('# OCR Benchmark Matrix');
  lines.push('');
  lines.push(`- generatedAt: ${summary.generatedAt}`);
  lines.push(`- pipeline: ${summary.config.pipeline}`);
  lines.push(`- quality: ${summary.config.quality}`);
  lines.push(`- baseUrl: ${summary.config.baseUrl}`);
  lines.push(`- manifest: ${summary.config.manifest}`);
  lines.push('');
  lines.push('| Engine | Pages | Expect Fail | Risky Pages | Words | Suspicious | Avg ms | P50 ms | P90 ms | Status |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');

  for (const row of summary.results) {
    lines.push(
      `| ${row.engine} | ${row.comparedPages} | ${row.expectationFailures} | ${row.riskyPages} | ${row.candWordsTotal} | ${row.candSuspiciousTotal} | ${toMdNumber(row.runtime.avgMs)} | ${toMdNumber(row.runtime.p50Ms)} | ${toMdNumber(row.runtime.p90Ms)} | ${row.status} |`
    );
  }

  lines.push('');
  lines.push('## Gate');
  lines.push('');
  lines.push('- PASS criteria per engine: expectationFailures = 0 and riskyPages = 0');
  lines.push(`- overallStatus: ${summary.overallStatus}`);

  if (summary.failures.length > 0) {
    lines.push('');
    lines.push('## Failures');
    lines.push('');
    for (const failure of summary.failures) {
      lines.push(`- ${failure.engine}: ${failure.reason}`);
    }
  }

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertOptions(args);

  const stamp = Date.now();
  const results = [];
  const failures = [];

  for (const engine of args.engines) {
    const candPath = `.tmp-ocr-current-${engine}-${args.pipeline}-${args.quality}-${stamp}.json`;
    const reportPath = `.tmp-ocr-report-${engine}-${args.pipeline}-${args.quality}-${stamp}.json`;

    const runArgs = [
      '--base-url', args.baseUrl,
      '--manifest', args.manifest,
      '--engine', engine,
      '--pipeline', args.pipeline,
      '--quality', args.quality,
      '--out', candPath,
    ];
    if (args.skipMissing) {
      runArgs.push('--skip-missing');
    }

    console.log(`\n[OCR Benchmark] Running candidate for engine=${engine}`);
    const runResult = runNodeScript('scripts/run-ocr-regression.mjs', runArgs);
    if (!runResult.ok) {
      failures.push({ engine, reason: `candidate_run_failed (exit=${runResult.exitCode})` });
      results.push({
        engine,
        status: 'run_failed',
        comparedPages: 0,
        expectationFailures: 0,
        riskyPages: 0,
        candWordsTotal: 0,
        candSuspiciousTotal: 0,
        runtime: {
          count: 0,
          avgMs: null,
          p50Ms: null,
          p90Ms: null,
          minMs: null,
          maxMs: null,
        },
      });
      continue;
    }

    const reportArgs = [
      '--cand', candPath,
      '--base', args.base,
      '--expect', args.expect,
      '--out', reportPath,
    ];

    if (args.skipMissing) {
      reportArgs.push('--partial');
    }

    console.log(`[OCR Benchmark] Scoring candidate for engine=${engine}`);
    const scoreResult = runNodeScript('scripts/ocr-regression-report.js', reportArgs);
    if (!scoreResult.ok) {
      failures.push({ engine, reason: `score_failed (exit=${scoreResult.exitCode})` });
      results.push({
        engine,
        status: 'score_failed',
        comparedPages: 0,
        expectationFailures: 0,
        riskyPages: 0,
        candWordsTotal: 0,
        candSuspiciousTotal: 0,
        runtime: {
          count: 0,
          avgMs: null,
          p50Ms: null,
          p90Ms: null,
          minMs: null,
          maxMs: null,
        },
      });
      continue;
    }

    const report = loadJson(reportPath);
    const candidate = loadJson(candPath);
    const runtime = summarizeRuntime(candidate.pages || []);
    const summary = report.summary || {};

    const expectationFailures = Number(summary.expectationFailures || 0);
    const riskyPages = Number(summary.riskyPages || 0);
    const status = expectationFailures === 0 && riskyPages === 0 ? 'pass' : 'risk';

    if (status !== 'pass') {
      failures.push({
        engine,
        reason: `risk_detected (expectationFailures=${expectationFailures}, riskyPages=${riskyPages})`,
      });
    }

    results.push({
      engine,
      status,
      comparedPages: Number(summary.comparedPages || 0),
      expectationFailures,
      riskyPages,
      candWordsTotal: Number(summary.candWordsTotal || 0),
      candSuspiciousTotal: Number(summary.candSuspiciousTotal || 0),
      runtime,
      artifacts: {
        candidateJson: candPath,
        reportJson: reportPath,
      },
    });
  }

  const overallStatus = failures.length === 0 ? 'pass' : 'risk';

  const output = {
    generatedAt: new Date().toISOString(),
    config: {
      baseUrl: args.baseUrl,
      manifest: args.manifest,
      base: args.base,
      expect: args.expect,
      pipeline: args.pipeline,
      quality: args.quality,
      engines: args.engines,
      skipMissing: args.skipMissing,
    },
    overallStatus,
    failures,
    results,
  };

  const outJsonPath = path.resolve(args.outJson);
  fs.writeFileSync(outJsonPath, JSON.stringify(output, null, 2), 'utf8');

  const outMdPath = path.resolve(args.outMd);
  fs.writeFileSync(outMdPath, buildMarkdown(output), 'utf8');

  console.log(`\n[OCR Benchmark] JSON report: ${outJsonPath}`);
  console.log(`[OCR Benchmark] Markdown report: ${outMdPath}`);
  console.log(`[OCR Benchmark] overallStatus=${overallStatus}`);

  if (args.failOnRisk && overallStatus !== 'pass') {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error('[OCR Benchmark] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
