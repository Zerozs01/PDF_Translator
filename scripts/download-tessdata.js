const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_LANGS = [
  'eng',
  'kor',
  'jpn',
  'jpn_vert',
  'chi_sim',
  'chi_tra',
  'tha',
  'vie',
  'spa',
  'deu',
  'fra',
  'rus'
];

const args = process.argv.slice(2);
let langsArg = null;
let force = false;
let destArg = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--langs=')) {
    langsArg = arg.slice('--langs='.length);
  } else if (arg === '--langs' && typeof args[i + 1] === 'string') {
    langsArg = args[i + 1];
    i += 1;
  } else if (arg === '--force') {
    force = true;
  } else if (arg === '--force=true') {
    force = true;
  } else if (arg.startsWith('--dest=')) {
    destArg = arg.slice('--dest='.length);
  } else if (arg === '--dest' && typeof args[i + 1] === 'string') {
    destArg = args[i + 1];
    i += 1;
  }
}

if (!langsArg && process.env.npm_config_langs) {
  langsArg = process.env.npm_config_langs;
}
if (!force && process.env.npm_config_force === 'true') {
  force = true;
}
if (!destArg && process.env.npm_config_dest) {
  destArg = process.env.npm_config_dest;
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

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function safeRename(tempPath, outPath) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await fs.promises.rename(tempPath, outPath);
      return;
    } catch (err) {
      const code = err && err.code ? err.code : '';
      const transient = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
      if (transient && attempt < 6) {
        await wait(120 * attempt);
        continue;
      }
      if (code === 'EXDEV' || transient) {
        await fs.promises.copyFile(tempPath, outPath);
        return;
      }
      throw err;
    }
  }
}

async function cleanupTemp(tempPath) {
  try {
    await fs.promises.unlink(tempPath);
  } catch {
    // ignore; temp may be locked by antivirus/indexer briefly
  }
}

async function writeUncompressedTraineddata(gzPath, lang) {
  const outPath = path.join(destRoot, `${lang}.traineddata`);
  if (!force && fs.existsSync(outPath)) return;
  const gzBytes = await fs.promises.readFile(gzPath);
  const rawBytes = zlib.gunzipSync(gzBytes);
  await fs.promises.writeFile(outPath, rawBytes);
}

async function downloadLang(lang) {
  const url = `${BASE}/${lang}/${VARIANT}/${lang}.traineddata.gz`;
  const outPath = path.join(destRoot, `${lang}.traineddata.gz`);
  const rawOutPath = path.join(destRoot, `${lang}.traineddata`);
  if (!force && fs.existsSync(outPath) && fs.existsSync(rawOutPath)) {
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

  await safeRename(tempPath, outPath);
  await cleanupTemp(tempPath);
  await writeUncompressedTraineddata(outPath, lang);
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
