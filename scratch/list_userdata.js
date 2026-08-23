const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.config");
const userDataPath = path.join(appData, 'pdf_translator');
console.log('userDataPath:', userDataPath);

if (fs.existsSync(userDataPath)) {
  fs.readdirSync(userDataPath).forEach(file => {
    const filePath = path.join(userDataPath, file);
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      console.log(`File: ${file} (${stat.size} bytes)`);
    } else {
      console.log(`Dir: ${file}`);
    }
  });
} else {
  console.log('userDataPath does not exist');
}
