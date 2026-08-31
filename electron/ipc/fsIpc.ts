import { BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import {
  inspectExistingDocumentFile,
  resolveImportedDocumentName,
  getRequestedDocumentPath
} from '../documentFileAccess';
import {
  isValidString,
  getImportsDirectory,
  assertAuthorizedDocumentRead
} from './ipcUtils';

export function registerFsIpcHandlers(getMainWindow: () => BrowserWindow | null) {
  // ============================================
  // File System IPC Handlers
  // ============================================
  ipcMain.handle('fs:open-file', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'tif', 'tiff'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const files = await Promise.all(
        result.filePaths.map(async (filepath) => {
          const documentFile = await inspectExistingDocumentFile(filepath);
          const buffer = await fs.promises.readFile(documentFile.canonicalPath);
          return {
            filepath: documentFile.canonicalPath,
            data: buffer,
            mimeType: documentFile.mimeType,
            size: documentFile.size,
            name: documentFile.name,
          };
        })
      );

      return files;
    } catch (error) {
      console.error('fs:open-file error:', error);
      throw error;
    }
  });

  ipcMain.handle('fs:read-file', async (_, filepath: string) => {
    if (!isValidString(filepath)) {
      throw new Error('Invalid filepath');
    }
    try {
      const requestedPath = getRequestedDocumentPath(filepath);
      const documentFile = await inspectExistingDocumentFile(requestedPath);
      await assertAuthorizedDocumentRead(requestedPath, documentFile.canonicalPath);
      const buffer = await fs.promises.readFile(documentFile.canonicalPath);
      
      return {
        data: buffer,
        mimeType: documentFile.mimeType,
        size: documentFile.size,
        name: documentFile.name
      };
    } catch (error) {
      console.error('fs:read-file error:', error);
      throw error;
    }
  });

  ipcMain.handle('fs:import-file', async (_event, payload: {
    name: string;
    mimeType: string;
    data?: Uint8Array | ArrayBuffer;
    filePath?: string;
  }) => {
    try {
      if (!payload || typeof payload.name !== 'string' || !payload.name) {
        throw new Error('Invalid payload: name is required');
      }

      let rawData: Uint8Array | Buffer;
      if (payload.filePath) {
        if (!fs.existsSync(payload.filePath)) {
          throw new Error(`Invalid filePath: ${payload.filePath} does not exist`);
        }
        rawData = await fs.promises.readFile(payload.filePath);
      } else {
        if (!payload.data) {
          throw new Error('Invalid payload: either filePath or data is required');
        }
        rawData = payload.data instanceof ArrayBuffer
          ? new Uint8Array(payload.data)
          : payload.data;
      }

      if (!(rawData instanceof Uint8Array) && !Buffer.isBuffer(rawData)) {
        throw new Error('Invalid payload: data must be Uint8Array or ArrayBuffer');
      }

      const { finalName, finalExt, resolvedMimeType } = resolveImportedDocumentName(
        payload.name,
        payload.mimeType,
      );
      const importDir = getImportsDirectory();
      await fs.promises.mkdir(importDir, { recursive: true });

      // Use deterministic content-hash path so repeated imports hit the same DB document_id/cache key.
      const contentHash = createHash('sha256').update(Buffer.from(rawData)).digest('hex').slice(0, 24);
      const hashedPath = path.join(importDir, `${contentHash}${finalExt}`);
      let targetPath = hashedPath;

      if (!fs.existsSync(hashedPath)) {
        // Backward-compat: try to reuse previously imported UUID-style file with identical content
        try {
          const entries = await fs.promises.readdir(importDir, { withFileTypes: true });
          const candidates = entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((name) => {
              if (name === path.basename(hashedPath)) return false;
              if (name.endsWith(`-${finalName}`)) return true;
              if (!finalExt) return true;
              return path.extname(name).toLowerCase() === finalExt.toLowerCase();
            });

          for (const name of candidates) {
            const candidatePath = path.join(importDir, name);
            let stats: fs.Stats;
            try {
              stats = await fs.promises.stat(candidatePath);
            } catch {
              continue;
            }
            if (stats.size !== rawData.byteLength) continue;

            try {
              const candidateBytes = await fs.promises.readFile(candidatePath);
              const candidateHash = createHash('sha256').update(candidateBytes).digest('hex').slice(0, 24);
              if (candidateHash === contentHash) {
                targetPath = candidatePath;
                break;
              }
            } catch {
              // Ignore unreadable candidate files and continue searching.
            }
          }
        } catch {
          // Ignore migration scan failures and fall back to hashed path write.
        }
      }

      if (!fs.existsSync(targetPath)) {
        await fs.promises.writeFile(targetPath, Buffer.from(rawData));
      }
      const stats = await fs.promises.stat(targetPath);

      return {
        filepath: targetPath,
        mimeType: resolvedMimeType,
        size: stats.size,
        name: finalName
      };
    } catch (error) {
      console.error('fs:import-file error:', error);
      throw error;
    }
  });

  // Window fullscreen IPC handlers
  ipcMain.handle('window:toggle-fullscreen', async () => {
    try {
      const win = getMainWindow();
      if (win) {
        const next = !win.isFullScreen();
        win.setFullScreen(next);
        return next;
      }
      return false;
    } catch (error) {
      console.error('window:toggle-fullscreen error:', error);
      return false;
    }
  });

  ipcMain.handle('window:is-fullscreen', async () => {
    const win = getMainWindow();
    return win?.isFullScreen() ?? false;
  });
}
