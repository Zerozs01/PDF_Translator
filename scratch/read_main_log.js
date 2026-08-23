const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform === 'darwin'
  ? process.env.HOME + '/Library/Application Support'
  : process.env.HOME + '/.config');
const logPath = path.join(appData, 'pdf_translator', 'main.log');

console.log('Reading log from:', logPath);
if (!fs.existsSync(logPath)) {
  console.log('Log file not found!');
  process.exit(1);
}

const content = fs.readFileSync(logPath, 'utf8');
const lines = content.split('\n');
const lastLines = lines.slice(-150);

console.log('--- LAST 150 LINES OF MAIN.LOG ---');
console.log(lastLines.join('\n'));
