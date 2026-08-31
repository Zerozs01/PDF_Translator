import { ipcMain } from 'electron';
import { isValidString } from './ipcUtils';
import { getExternalOcrEngineStatuses, prewarmExternalOcrEngine } from '../ocrBridge';

export function registerModelIpcHandlers() {
  // Model Management IPC Handlers
  ipcMain.handle('models:get-status', async (_, { engine, language }) => {
    if (!isValidString(language)) {
      throw new Error('Invalid language code');
    }
    
    const lang = language.trim().toLowerCase();
    
    if (engine === 'paddleocr') {
      try {
        const statuses = await getExternalOcrEngineStatuses();
        const paddle = statuses.find(s => s.engine === 'paddleocr');
        return { installed: paddle ? paddle.available : false };
      } catch {
        return { installed: false };
      }
    }

    if (engine === 'argos') {
      return { installed: true }; // default true for Argos (built-in fallback)
    }
    
    return { installed: false };
  });

  ipcMain.handle('models:download', async (_event, { engine, language }) => {
    if (!isValidString(language)) {
      throw new Error('Invalid language code');
    }
    
    const lang = language.trim().toLowerCase();
    
    if (engine === 'paddleocr') {
      try {
        await prewarmExternalOcrEngine('paddleocr', lang);
        return true;
      } catch (err) {
        console.error(`[main] PaddleOCR prewarm failed for ${lang}:`, err);
        throw err;
      }
    }
    
    return false;
  });
}
