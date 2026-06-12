const fs = require('fs');
const path = require('path');

const userDataPath = path.join(process.env.APPDATA, 'pdf_translator');

const files = [
  path.join(userDataPath, 'authConfig.json'),
  path.join(userDataPath, 'pdf_translator.db'),
  path.join(userDataPath, 'pdf_translator.db-wal'),
  path.join(userDataPath, 'pdf_translator.db-shm')
];

console.log('Cleaning up app data files to reset configuration...');
files.forEach(file => {
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
      console.log(`Deleted: ${file}`);
    } catch (err) {
      console.error(`Failed to delete ${file}:`, err);
    }
  } else {
    console.log(`Not found: ${file}`);
  }
});
console.log('Cleanup completed. The app will boot into Setup Screen on next launch.');
