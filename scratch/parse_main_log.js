const fs = require('fs');
const readline = require('readline');

const logPath = 'C:\\Users\\auand\\AppData\\Roaming\\pdf_translator\\main.log';
const rl = readline.createInterface({
  input: fs.createReadStream(logPath),
  crlfDelay: Infinity
});

console.log('Searching in main.log...');
rl.on('line', (line) => {
  const upper = line.toUpperCase();
  if (upper.includes('PAGE 26') || upper.includes('DEAD') || upper.includes('SUPPOSED') || upper.includes('MOHS')) {
    console.log(line);
  }
});

rl.on('close', () => {
  console.log('Done.');
});
