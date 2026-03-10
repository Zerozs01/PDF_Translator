#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

function parseArgs(argv) {
  const args = {
    baseUrl: 'http://127.0.0.1:5173',
    manifest: 'public/fixtures/ocr/manga/expectations.json',
    out: '.tmp-ocr-current.json',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') args.baseUrl = argv[i + 1] || args.baseUrl;
    if (arg === '--manifest') args.manifest = argv[i + 1] || args.manifest;
    if (arg === '--out') args.out = argv[i + 1] || args.out;
  }

  return args;
}

function loadManifest(filePath) {
  const fullPath = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadManifest(args.manifest);
  const fixtures = Array.isArray(manifest.cases) ? manifest.cases : [];

  if (fixtures.length === 0) {
    throw new Error(`No OCR fixtures found in ${args.manifest}`);
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
