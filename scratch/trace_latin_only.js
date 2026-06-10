const fs = require('fs');
const path = require('path');

const raw = fs.readFileSync(path.join(__dirname, 'page2_ocr.json'), 'utf8');
const data = JSON.parse(raw);

const isLatinOnlyText = (text) => {
  if (!text) return false;
  return /[A-Za-z]/.test(text) && !/[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(text);
};

const groupLineIndexes = [12, 13, 14, 15, 16, 17];
groupLineIndexes.forEach(idx => {
  const text = data.lines[idx].text;
  console.log(`idx=${idx} text="${text}" isLatinOnly=${isLatinOnlyText(text)} hasThai=${/[\u0E00-\u0E7F]/.test(text)}`);
});
