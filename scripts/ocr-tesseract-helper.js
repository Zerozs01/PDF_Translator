const { createWorker } = require('tesseract.js');

const imagePath = process.argv[2];
const language = process.argv[3] || 'eng';

if (!imagePath) {
  console.error(JSON.stringify({ ok: false, error: 'No image path provided' }));
  process.exit(1);
}

function parseTSV(tsv) {
  const words = [];
  const lineKeys = new Set();
  
  if (!tsv) return { words, lines: 0 };
  
  const lines = tsv.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 12) continue;
    
    const level = parseInt(cols[0] || '0');
    const text = cols.slice(11).join('\t').trim();
    const conf = parseFloat(cols[10] || '0');
    
    if (level === 5 && text.length > 0 && conf > 0) {
      words.push({ text, confidence: conf });
      const lineKey = `${cols[1]}-${cols[2]}-${cols[3]}-${cols[4]}`;
      lineKeys.add(lineKey);
    }
  }
  return { words, lines: lineKeys.size };
}

async function run() {
  const worker = await createWorker(language);
  // Pass { tsv: true } to enable generating TSV data in the response
  const { data } = await worker.recognize(imagePath, {}, { tsv: true });
  
  const { words, lines } = parseTSV(data.tsv);
  const confs = words.map(w => w.confidence);
  const avg_conf = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0.0;
  
  console.log(JSON.stringify({
    ok: true,
    lines: lines,
    words: words.map(w => w.text),
    confidence: avg_conf,
    text: data.text
  }));
  
  await worker.terminate();
}

run().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
