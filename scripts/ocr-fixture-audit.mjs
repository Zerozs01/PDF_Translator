#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    manifest: 'public/fixtures/ocr/manga/expectations.json',
    requireLanguages: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifest = argv[i + 1] || args.manifest;
    if (arg === '--require-language') {
      const raw = String(argv[i + 1] || '').trim().toLowerCase();
      if (raw) args.requireLanguages.push(raw);
    }
    if (arg === '--require-languages') {
      const raw = String(argv[i + 1] || '').trim().toLowerCase();
      if (!raw) continue;
      for (const lang of raw.split(',').map((item) => item.trim()).filter(Boolean)) {
        args.requireLanguages.push(lang);
      }
    }
  }

  args.requireLanguages = Array.from(new Set(args.requireLanguages));
  return args;
}

function loadManifest(manifestPath) {
  const fullPath = path.resolve(manifestPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Manifest not found: ${fullPath}`);
  }
  const raw = fs.readFileSync(fullPath, 'utf8');
  const parsed = JSON.parse(raw);
  return { parsed, fullPath };
}

function resolveImagePath(imagePath, repoRoot) {
  const normalized = String(imagePath || '').replace(/^\/+/, '');
  if (!normalized) return '';
  return path.resolve(repoRoot, 'public', normalized.replace(/^fixtures\//, 'fixtures/'));
}

function auditFixtures(manifest, manifestPath) {
  const repoRoot = process.cwd();
  const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
  const missing = [];
  const languages = new Map();

  for (const item of cases) {
    const id = String(item?.id || '(unknown-fixture)');
    const image = String(item?.image || '');
    const pdf = String(item?.pdf || '');
    const lang = String(item?.language || '').trim().toLowerCase() || '(unspecified)';
    const assetPath = image || pdf;
    const resolvedAsset = resolveImagePath(assetPath, repoRoot);

    languages.set(lang, (languages.get(lang) || 0) + 1);

    if (!assetPath || !resolvedAsset || !fs.existsSync(resolvedAsset)) {
      missing.push({
        id,
        image: image || '(none)',
        pdf: pdf || '(none)',
        resolvedImage: resolvedAsset || '(unresolved)',
      });
    }
  }

  return {
    manifestPath,
    fixtureCount: cases.length,
    missing,
    languages,
  };
}

function printReport(report, requiredLanguages) {
  console.log('[OCR Fixture Audit] Summary');
  console.log(`- manifest: ${report.manifestPath}`);
  console.log(`- fixtures: ${report.fixtureCount}`);
  console.log(`- missingAssets: ${report.missing.length}`);

  const sortedLanguages = Array.from(report.languages.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  if (sortedLanguages.length === 0) {
    console.log('- languages: (none)');
  } else {
    console.log('- languages:');
    for (const [lang, count] of sortedLanguages) {
      console.log(`  - ${lang}: ${count}`);
    }
  }

  if (requiredLanguages.length > 0) {
    console.log(`- requiredLanguages: ${requiredLanguages.join(', ')}`);
    const missingRequiredLanguages = requiredLanguages.filter((lang) => !report.languages.has(lang));
    if (missingRequiredLanguages.length > 0) {
      console.log(`- missingRequiredLanguages: ${missingRequiredLanguages.join(', ')}`);
    }
  }

  if (report.missing.length > 0) {
    console.log('[OCR Fixture Audit] Missing fixture assets:');
    for (const row of report.missing) {
      console.log(`- ${row.id}: ${row.resolvedImage}`);
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { parsed, fullPath } = loadManifest(args.manifest);
  const report = auditFixtures(parsed, fullPath);
  const missingRequiredLanguages = args.requireLanguages.filter((lang) => !report.languages.has(lang));
  printReport(report, args.requireLanguages);

  if (report.fixtureCount === 0) {
    console.error('[OCR Fixture Audit] No fixture cases found in manifest.');
    process.exit(2);
  }

  if (report.missing.length > 0) {
    console.error('[OCR Fixture Audit] Failed: fixture assets are missing.');
    if (missingRequiredLanguages.length > 0) {
      console.error(`[OCR Fixture Audit] Also missing required fixture language(s): ${missingRequiredLanguages.join(', ')}`);
    }
    process.exit(2);
  }

  if (missingRequiredLanguages.length > 0) {
    console.error(`[OCR Fixture Audit] Failed: required fixture language(s) not found: ${missingRequiredLanguages.join(', ')}`);
    process.exit(3);
  }

  console.log('[OCR Fixture Audit] PASS');
}

try {
  main();
} catch (error) {
  console.error('[OCR Fixture Audit] Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
