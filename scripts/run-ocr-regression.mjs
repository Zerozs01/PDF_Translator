#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://localhost:5173',
    manifest: 'public/fixtures/ocr/manga/expectations.json',
    out: '.tmp-ocr-current.json',
    skipMissing: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') args.baseUrl = argv[i + 1] || args.baseUrl;
    if (arg === '--manifest') args.manifest = argv[i + 1] || args.manifest;
    if (arg === '--out') args.out = argv[i + 1] || args.out;
    if (arg === '--skip-missing') args.skipMissing = true;
  }

  return args;
}

function loadManifest(filePath) {
  const fullPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function resolveFixtureImages(manifest, manifestPath) {
  const fixtures = Array.isArray(manifest.cases) ? manifest.cases : [];
  const repoRoot = process.cwd();
  const missing = [];
  const available = [];

  for (const fixture of fixtures) {
    const relativeImage = String(fixture?.image || '').replace(/^\/+/, '');
    if (!relativeImage) {
      missing.push({
        id: fixture?.id || '(unknown-fixture)',
        path: '(missing image path in manifest)',
      });
      continue;
    }

    const absolutePath = path.resolve(repoRoot, 'public', relativeImage.replace(/^fixtures\//, 'fixtures/'));
    if (!fs.existsSync(absolutePath)) {
      missing.push({ id: fixture.id || '(unknown-fixture)', path: absolutePath });
      continue;
    }

    available.push(fixture);
  }

  return {
    available,
    missing,
    manifestPath,
  };
}

function throwMissingFixtureError(result) {
  if (result.missing.length === 0) return;
  const lines = result.missing.map((item) => `- ${item.id}: ${item.path}`);
  throw new Error(
    [
      `Fixture image preflight failed for manifest: ${result.manifestPath}`,
      'Missing files:',
      ...lines,
      'Add real fixture images to public/fixtures/ocr/manga before running OCR regression.',
    ].join('\n')
  );
}

function logMissingFixtureWarning(result) {
  if (result.missing.length === 0) return;
  console.warn(`[OCR Regression Runner] Skipping ${result.missing.length} missing fixtures from ${result.manifestPath}:`);
  for (const item of result.missing) {
    console.warn(`- ${item.id}: ${item.path}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest(args.manifest);
  const fixtureResolution = resolveFixtureImages(manifest, args.manifest);

  if (!args.skipMissing) {
    throwMissingFixtureError(fixtureResolution);
  } else {
    logMissingFixtureWarning(fixtureResolution);
  }

  const fixtures = fixtureResolution.available;

  if (fixtures.length === 0) {
    throw new Error(`No runnable OCR fixtures found in ${args.manifest}. Provide at least one existing fixture image.`);
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pages = [];
  const errors = [];

  try {
    for (const fixture of fixtures) {
      const url = `${args.baseUrl}/?ocr_harness=1&fixture=${encodeURIComponent(fixture.id)}`;
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(
        () => {
          const payload = window.__OCR_REGRESSION_RESULT__;
          return Boolean(payload && typeof payload === 'object' && ['done', 'error'].includes(payload.status));
        },
        undefined,
        { timeout: 180000 }
      );

      const payload = await page.evaluate(() => window.__OCR_REGRESSION_RESULT__);
      if (!payload || typeof payload !== 'object') {
        errors.push({ fixture: fixture.id, error: 'No regression payload returned' });
        continue;
      }

      if (payload.status === 'error') {
        errors.push({ fixture: fixture.id, page: fixture.page, error: payload.error || 'Unknown harness error' });
        continue;
      }

      if (!payload.ocr) {
        errors.push({ fixture: fixture.id, page: fixture.page, error: 'Harness finished without OCR payload' });
        continue;
      }

      pages.push({
        ...payload.ocr,
        pageNumber: fixture.page,
        fixtureId: fixture.id,
        fixtureImage: fixture.image,
      });
    }
  } finally {
    await browser.close();
  }

  const output = {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    manifest: args.manifest,
    skippedFixtures: fixtureResolution.missing,
    pages,
    errors,
  };

  const outPath = path.resolve(args.out);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
  console.log(`[OCR Regression Runner] Wrote ${pages.length} page results to ${outPath}`);

  if (errors.length > 0) {
    console.error('[OCR Regression Runner] Fixture errors detected:');
    for (const error of errors) {
      console.error(`- ${error.fixture}: ${error.error}`);
    }
    process.exit(2);
  }
}

main().catch((error) => {
  console.error('[OCR Regression Runner] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
