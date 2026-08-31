import type { BrowserWindow } from 'electron';
import { registerAuthIpcHandlers } from './authIpc';
import { registerModelIpcHandlers } from './modelIpc';
import { registerDbIpcHandlers } from './dbIpc';
import { registerFsIpcHandlers } from './fsIpc';
import { registerOcrIpcHandlers } from './ocrIpc';
import { registerTranslationIpcHandlers } from './translationIpc';
import { registerPdfExportIpcHandlers } from './pdfExportIpc';

export interface RegisterIpcOptions {
  getMainWindow: () => BrowserWindow | null;
  powerSaveState: { powerSaveBlockerId: number | null };
}

export function registerAllIpcHandlers(options: RegisterIpcOptions) {
  registerAuthIpcHandlers(options.powerSaveState);
  registerModelIpcHandlers();
  registerDbIpcHandlers();
  registerFsIpcHandlers(options.getMainWindow);
  registerOcrIpcHandlers();
  registerTranslationIpcHandlers();
  registerPdfExportIpcHandlers();
}
