const fs = require('fs/promises');
const path = require('path');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');

const ROOT_DIR = path.resolve(__dirname, '..');
const FONT_OUTPUT_DIR = path.join(ROOT_DIR, 'public', 'fonts', 'overlay');
const FORCE_DOWNLOAD = process.argv.includes('--force');

const DIRECT_FONT_SPECS = [
  {
    label: 'Mitr',
    url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/mitr/Mitr-Regular.ttf',
    fileName: 'Mitr-Regular.ttf',
  },
  {
    label: 'Supermarket',
    url: 'https://fonts.cdnfonts.com/s/68432/SUPERMARKET.woff',
    fileName: 'SUPERMARKET.woff',
  },
];

const FC_ICONIC_SPEC = {
  label: 'FC Iconic',
  url: 'https://www.freefontdownload.org/download-font-otf/fc-iconic-regular',
  entryPattern: /fc-iconic-regular\.otf$/i,
  fileName: 'fc-iconic-regular.otf',
};

const shouldSkipBootstrap = () => {
  const raw = String(process.env.SKIP_OVERLAY_FONT_BOOTSTRAP || '').trim().toLowerCase();
  return raw === '1' || raw === 'true';
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const requestBuffer = (url, redirectDepth = 0) => new Promise((resolve, reject) => {
  if (redirectDepth > 8) {
    reject(new Error(`Too many redirects while downloading ${url}`));
    return;
  }

  const client = url.startsWith('https:') ? https : http;
  const req = client.get(url, {
    headers: {
      'User-Agent': 'PDF-Translator-FontBootstrap/1.0',
      Accept: '*/*',
    },
  }, (res) => {
    const statusCode = Number(res.statusCode || 0);
    const location = String(res.headers.location || '').trim();

    if (statusCode >= 300 && statusCode < 400 && location) {
      const nextUrl = new URL(location, url).toString();
      res.resume();
      requestBuffer(nextUrl, redirectDepth + 1).then(resolve).catch(reject);
      return;
    }

    if (statusCode < 200 || statusCode >= 300) {
      res.resume();
      reject(new Error(`Failed to download ${url} (HTTP ${statusCode})`));
      return;
    }

    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
  });

  req.on('error', reject);
});

const downloadDirectFont = async (spec) => {
  const outputPath = path.join(FONT_OUTPUT_DIR, spec.fileName);
  if (!FORCE_DOWNLOAD && await fileExists(outputPath)) {
    console.log(`[fonts] ${spec.label} already exists -> ${outputPath}`);
    return;
  }

  console.log(`[fonts] Downloading ${spec.label} -> ${outputPath}`);
  const buffer = await requestBuffer(spec.url);
  await fs.writeFile(outputPath, buffer);
};

const downloadFcIconicFont = async () => {
  const outputPath = path.join(FONT_OUTPUT_DIR, FC_ICONIC_SPEC.fileName);
  if (!FORCE_DOWNLOAD && await fileExists(outputPath)) {
    console.log(`[fonts] ${FC_ICONIC_SPEC.label} already exists -> ${outputPath}`);
    return;
  }

  console.log(`[fonts] Downloading ${FC_ICONIC_SPEC.label} archive...`);
  const zipBuffer = await requestBuffer(FC_ICONIC_SPEC.url);
  const zip = new AdmZip(zipBuffer);
  const entry = zip.getEntries().find((item) => FC_ICONIC_SPEC.entryPattern.test(item.entryName));

  if (!entry) {
    throw new Error(`[fonts] Could not find ${FC_ICONIC_SPEC.fileName} in FC Iconic archive`);
  }

  console.log(`[fonts] Extracting ${FC_ICONIC_SPEC.label} -> ${outputPath}`);
  const data = entry.getData();
  await fs.writeFile(outputPath, data);
};

const main = async () => {
  if (shouldSkipBootstrap()) {
    console.log('[fonts] SKIP_OVERLAY_FONT_BOOTSTRAP is enabled, skipping overlay font bootstrap');
    return;
  }

  await fs.mkdir(FONT_OUTPUT_DIR, { recursive: true });

  for (const spec of DIRECT_FONT_SPECS) {
    await downloadDirectFont(spec);
  }

  await downloadFcIconicFont();
  console.log('[fonts] Overlay fonts bootstrap completed');
};

main().catch((error) => {
  console.error('[fonts] Overlay font bootstrap failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
