const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

app.name = 'PDF Translator';

app.whenReady().then(() => {
  const appData = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + "/.config");
  const userDataPath = path.join(appData, 'pdf_translator');
  console.log('User Data Path:', userDataPath);

  app.setPath('userData', userDataPath);

  const configPath = path.join(userDataPath, 'authConfig.json');
  if (!fs.existsSync(configPath)) {
    console.error('Config file not found');
    app.quit();
    return;
  }

  const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  console.log('App Mode:', configData.appMode);

  if (configData.encryptedMaster) {
    try {
      const encryptedBuffer = Buffer.from(configData.encryptedMaster, 'hex');
      const masterPassword = safeStorage.decryptString(encryptedBuffer);
      console.log('SUCCESS: Decrypted Master Password:', masterPassword ? '***' : 'empty');
    } catch (err) {
      console.error('DECRYPT FAILED:', err);
    }
  } else {
    console.log('No encryptedMaster found');
  }

  app.quit();
});
