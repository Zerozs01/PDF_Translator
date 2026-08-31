import { app, BrowserWindow, ipcMain, powerSaveBlocker } from 'electron';
import fs from 'fs';
import * as authService from '../authService';
import { initDB, closeDB } from '../db';
import { disposeExternalOcrDaemons } from '../ocrBridge';
import { disposeArgosTranslateRuntime } from '../argosBridge';

export function registerAuthIpcHandlers(powerSaveState: { powerSaveBlockerId: number | null }) {
  // Power management IPC handlers
  ipcMain.handle('power:prevent-sleep', () => {
    if (powerSaveState.powerSaveBlockerId === null) {
      powerSaveState.powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
      console.log(`[Main] Started powerSaveBlocker (ID: ${powerSaveState.powerSaveBlockerId}) to prevent app suspension.`);
    }
    return powerSaveState.powerSaveBlockerId;
  });

  ipcMain.handle('power:allow-sleep', () => {
    if (powerSaveState.powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(powerSaveState.powerSaveBlockerId);
      console.log(`[Main] Stopped powerSaveBlocker (ID: ${powerSaveState.powerSaveBlockerId}).`);
      powerSaveState.powerSaveBlockerId = null;
    }
    return true;
  });

  // 🔒 Advanced Security Phase 7: Auth IPC Handlers
  ipcMain.handle('auth:check-status', async () => {
    const config = authService.readAuthConfig();
    return {
      isSetup: authService.isSetup(),
      mode: config ? config.appMode : 'SECURITY',
    };
  });

  ipcMain.handle('auth:setup', async (_, { password, emergencyPin }) => {
    try {
      authService.setupCredentials(password, emergencyPin);
      try {
        // Immediately open DB with setup key
        initDB(password);
        return { success: true };
      } catch (dbErr) {
        // Rollback setup configuration if database initialization fails
        console.error('[Main IPC] auth:setup DB init failed, rolling back auth config:', dbErr);
        const configPath = authService.getAuthConfigPath();
        if (fs.existsSync(configPath)) {
          fs.unlinkSync(configPath);
        }
        throw dbErr;
      }
    } catch (err: any) {
      console.error('[Main IPC] auth:setup error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('auth:login', async (_, { password }) => {
    try {
      if (authService.verifyMasterPassword(password)) {
        initDB(password); // will throw error if database is not unlockable
        return { success: true };
      } else {
        return { success: false, error: 'Incorrect master password.' };
      }
    } catch (err: any) {
      console.error('[Main IPC] auth:login error:', err);
      return { success: false, error: err.message || 'Incorrect password or corrupted database.' };
    }
  });

  ipcMain.handle('auth:auto-login', async () => {
    try {
      const autoLoginPassword = authService.getAutoLoginPassword();
      if (autoLoginPassword) {
        initDB(autoLoginPassword);
        return { success: true };
      }
      return { success: false, error: 'Relax mode is disabled or safeStorage key missing.' };
    } catch (err: any) {
      console.error('[Main IPC] auth:auto-login error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('auth:hard-reset', async (_, { emergencyPin }) => {
    try {
      if (authService.verifyEmergencyPin(emergencyPin)) {
        console.warn('[Main IPC] HARD RESET / DATA WIPE TRIGGERED!');
        
        // Stop all background child processes / translation engines immediately
        try {
          disposeExternalOcrDaemons();
          disposeArgosTranslateRuntime?.();
          console.log('[Main IPC] Stopped background processes during emergency reset');
        } catch (procErr) {
          console.error('[Main IPC] Error stopping processes during reset:', procErr);
        }

        closeDB();
        authService.deleteAppDataFiles();

        // Force destroy all open windows to prevent hanging UI windows on Windows OS
        BrowserWindow.getAllWindows().forEach((w) => {
          try {
            w.destroy();
          } catch (e) {
            console.error('[Main IPC] Error destroying window:', e);
          }
        });
        
        // Relaunch the app clean and exit
        app.relaunch();
        app.exit(0);
        return { success: true };
      } else {
        return { success: false, error: 'Incorrect Emergency PIN.' };
      }
    } catch (err: any) {
      console.error('[Main IPC] auth:hard-reset error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('auth:set-mode', async (_, { mode, password }) => {
    try {
      authService.setAppMode(mode, password);
      return { success: true };
    } catch (err: any) {
      console.error('[Main IPC] auth:set-mode error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });
}
