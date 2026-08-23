const fs = require('fs');

const data = JSON.parse(fs.readFileSync('scratch/raw_ocr_page26.json', 'utf8'));
console.log('PageNumber:', data.pageNumber);
if (data.debug) {
  console.log('Drop counts:', data.debug.dropCounts);
  console.log('Dropped words length:', data.debug.droppedWords ? data.debug.droppedWords.length : 0);
  if (data.debug.droppedWords) {
    console.log('Dropped words sample:');
    data.debug.droppedWords.forEach(dw => {
      if (dw.text.toUpperCase().includes('DEAD') || dw.text.toUpperCase().includes('SUPPOSED') || dw.text.toUpperCase().includes('MOHS') || dw.text.toUpperCase().includes('TO BE')) {
        console.log(`  Dropped: "${dw.text}" reason: ${dw.reason || dw.filter}`);
      }
    });
  }
} else {
  console.log('No debug field in raw OCR data');
}
