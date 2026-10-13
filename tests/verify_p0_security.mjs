import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer, preview } from 'vite';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const reportPath = path.resolve(projectRoot, 'docs', 'p0-security-audit.txt');

async function grepDistDirectory() {
  const distDir = path.resolve(projectRoot, 'dist');
  const targetPatterns = ['ocr_harness', 'isDevHarness', 'OCRRegressionHarness', 'URLSearchParams', 'location.search'];
  const matches = [];

  function walk(dir) {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (/\.(js|mjs|cjs|html|css)$/.test(f)) {
        const content = fs.readFileSync(full, 'utf-8');
        for (const pattern of targetPatterns) {
          if (content.includes(pattern)) {
            matches.push({ file: path.relative(projectRoot, full), pattern });
          }
        }
      }
    }
  }

  walk(distDir);
  return matches;
}

async function runAudit() {
  const logLines = [];
  const log = (msg) => {
    console.log(msg);
    logLines.push(msg);
  };

  log('======================================================================');
  log('P0 PLAYWRIGHT SECURITY & HARNESS GATE AUDIT');
  log(`Timestamp: ${new Date().toISOString()}`);
  log('======================================================================\n');

  // STEP 1: Static Bundle Analysis (Grep dist/)
  log('## 1. STATIC BUNDLE ANALYSIS (Grep dist/ for dev harness bypass)');
  const distMatches = await grepDistDirectory();
  log(`Total occurrences of [ocr_harness, isDevHarness, OCRRegressionHarness, URLSearchParams, location.search] in dist/: ${distMatches.length}`);
  if (distMatches.length === 0) {
    log('PASS: Dead-code elimination succeeded. 0 occurrences found in production build.');
  } else {
    log(`FAIL: Leaked patterns found: ${JSON.stringify(distMatches, null, 2)}`);
  }
  log('');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    // STEP 2: Dev Server Verification
    log('## 2. DEV SERVER TEST (Vite Dev)');
    let devServer = null;
    let devUrl = 'http://127.0.0.1:5173';
    let isReusingDevServer = false;

    try {
      const ping = await fetch('http://127.0.0.1:5173/').then(r => r.ok).catch(() => false);
      if (ping) {
        log('Reusing currently running Vite dev server at http://127.0.0.1:5173');
        isReusingDevServer = true;
      }
    } catch (_) {}

    if (!isReusingDevServer) {
      devServer = await createServer({
        root: projectRoot,
        server: { port: 5183, host: '127.0.0.1', strictPort: false },
        logLevel: 'error'
      });
      await devServer.listen();
      devUrl = 'http://127.0.0.1:5183';
      log(`Dev server started at ${devUrl}`);
    }

    // 2a. Dev with ?ocr_harness=1
    const pageDevHarness = await context.newPage();
    await pageDevHarness.goto(`${devUrl}/?ocr_harness=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await pageDevHarness.waitForTimeout(1500); // Wait for React lazy components
    const devHarnessTitle = await pageDevHarness.title();
    const devHarnessText = await pageDevHarness.evaluate(() => document.body.innerText);
    const devHarnessHasHeader = devHarnessText.includes('OCR') && (devHarnessText.includes('Harness') || devHarnessText.includes('Regression'));
    log(`[TEST 2A] Dev with ?ocr_harness=1:`);
    log(`  URL: ${pageDevHarness.url()}`);
    log(`  Title: "${devHarnessTitle}"`);
    log(`  Found Harness Content: ${devHarnessHasHeader}`);
    log(`  Status: ${devHarnessHasHeader ? 'PASS (Harness accessible in dev with query param)' : 'FAIL'}`);
    await pageDevHarness.close();

    // 2b. Dev without param (default access)
    const pageDevDefault = await context.newPage();
    await pageDevDefault.goto(`${devUrl}/`, { waitUntil: 'domcontentloaded' });
    await pageDevDefault.waitForTimeout(1500);
    const devDefaultText = await pageDevDefault.evaluate(() => document.body.innerText);
    const devDefaultBlocked = devDefaultText.includes('ตรวจสอบสิทธิ์ความปลอดภัย') || devDefaultText.includes('เข้าสู่ระบบ') || devDefaultText.includes('รหัสผ่าน') || !devDefaultText.includes('Regression');
    log(`\n[TEST 2B] Dev without query param:`);
    log(`  URL: ${pageDevDefault.url()}`);
    log(`  Blocked by AuthGuard: ${devDefaultBlocked}`);
    log(`  Status: ${devDefaultBlocked ? 'PASS (AuthGuard active, cannot bypass to harness)' : 'FAIL'}`);
    await pageDevDefault.close();

    if (devServer) {
      await devServer.close();
      log('Dev server stopped.\n');
    } else {
      log('Dev server test complete (kept external server alive).\n');
    }

    // STEP 3: Production Preview Verification
    log('## 3. PRODUCTION PREVIEW TEST (Vite Preview on dist/)');
    const previewServer = await preview({
      root: projectRoot,
      preview: { port: 4183, host: '127.0.0.1' },
      logLevel: 'error'
    });
    const previewUrl = 'http://127.0.0.1:4183';
    log(`Preview server started at ${previewUrl}`);

    // 3a. Production Preview with ?ocr_harness=1
    const pageProdHarness = await context.newPage();
    await pageProdHarness.goto(`${previewUrl}/?ocr_harness=1`, { waitUntil: 'domcontentloaded' });
    await pageProdHarness.waitForTimeout(1500);
    const prodText = await pageProdHarness.evaluate(() => document.body.innerText);
    const prodBlocked = (prodText.includes('ตรวจสอบสิทธิ์ความปลอดภัย') || prodText.includes('เข้าสู่ระบบ') || prodText.includes('รหัสผ่าน')) && !prodText.includes('Regression');
    log(`[TEST 3A] Production Preview with ?ocr_harness=1:`);
    log(`  URL: ${pageProdHarness.url()}`);
    log(`  Harness rendered in production: ${prodText.includes('Regression')}`);
    log(`  AuthGuard enforced: ${prodBlocked}`);
    log(`  Status: ${prodBlocked ? 'PASS (ทดสอบ 1 production URL, ไม่พบ harness, grep ไม่พบ pattern ที่ระบุ)' : 'FAIL'}`);
    await pageProdHarness.close();

    await previewServer.close();
    log('Preview server stopped.\n');

    log('## 4. PRODUCTION REGRESSION PROPOSAL');
    log('If OCR regression tests must ever be executed against a production-like artifact,');
    log('DO NOT weaken AuthGuard. Instead, provide an isolated build target:');
    log('  1. Introduce npm script: "build:test-harness" with VITE_APP_ENV=test');
    log('  2. Never deploy test-harness build to end-users/distribution release.');

  } finally {
    await browser.close();
  }

  fs.writeFileSync(reportPath, logLines.join('\n'), 'utf-8');
  console.log(`\nAudit log saved to: ${reportPath}`);
}

runAudit().catch(err => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
