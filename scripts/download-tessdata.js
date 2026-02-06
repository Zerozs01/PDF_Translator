const https = require('https');
const fs = require('fs');
const path = require('path');

const DEFAULT_LANGS = [
  'eng',
  'kor',
  'jpn',
  'jpn_vert',
  'chi_sim',
  'chi_tra',
  'tha',
  'vie'
];

const args = process.argv.slice(2);
let langsArg = null;
let force = false;
let destArg = null;

for (const arg of args) {
  if (arg.startsWith('--langs=')) {
    langsArg = arg.slice('--langs='.length);
  } else if (arg === '--force') {
    force = true;
  } else if (arg.startsWith('--dest=')) {
    destArg = arg.slice('--dest='.length);
  }
}

const langs = (langsArg ? langsArg.split(',') : DEFAULT_LANGS)
  .map(l => l.trim())
  .filter(Boolean);

const destRoot = destArg
  ? path.resolve(process.cwd(), destArg)
  : path.resolve(__dirname, '..', 'public', 'tessdata');

const BASE = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data';
const VARIANT = '4.0.0_best_int';

function request(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const { statusCode, headers } = res;
      if (statusCode && statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        return resolve(request(headers.location));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode}`));
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function downloadLang(lang) {
  const url = `${BASE}/${lang}/${VARIANT}/${lang}.traineddata.gz`;
  const outPath = path.join(destRoot, `${lang}.traineddata.gz`);
  if (!force && fs.existsSync(outPath)) {
    console.log(`[tessdata] Skip ${lang}: already exists`);
    return;
  }

  await fs.promises.mkdir(destRoot, { recursive: true });
  const tempPath = `${outPath}.tmp`;

  console.log(`[tessdata] Downloading ${lang} -> ${outPath}`);
  const res = await request(url);

  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(tempPath);
    res.pipe(file);
    file.on('finish', () => file.close(resolve));
    file.on('error', reject);
  });

  await fs.promises.rename(tempPath, outPath);
}

async function main() {
  if (langs.length === 0) {
    console.log('[tessdata] No languages provided.');
    return;
  }

  console.log(`[tessdata] Destination: ${destRoot}`);
  console.log(`[tessdata] Languages: ${langs.join(', ')}`);

  for (const lang of langs) {
    try {
      await downloadLang(lang);
    } catch (err) {
      console.warn(`[tessdata] Failed ${lang}: ${err.message}`);
    }
  }
}

main().catch(err => {
  console.error('[tessdata] Fatal error:', err);
  process.exit(1);
});
