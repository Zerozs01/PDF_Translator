import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { DocumentDAO } from '../db';
import { isPathWithinDirectory } from '../documentFileAccess';

export const isValidString = (value: unknown): value is string => 
  typeof value === 'string' && value.length > 0 && value.length < 10000;

export const isValidNumber = (value: unknown): value is number => 
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export const isValidEngine = (value: unknown): value is string =>
  typeof value === 'string' && ['paddleocr', 'easyocr'].includes(value);

export const getImportsDirectory = (): string => path.join(app.getPath('userData'), 'imports');

export const assertAuthorizedDocumentRead = async (requestedPath: string, canonicalPath: string): Promise<void> => {
  const importDir = getImportsDirectory();
  const normalizedImportDir = await fs.promises
    .realpath(importDir)
    .catch(() => path.resolve(importDir));

  if (isPathWithinDirectory(normalizedImportDir, canonicalPath)) {
    return;
  }

  if (DocumentDAO.get(requestedPath) || DocumentDAO.get(canonicalPath)) {
    return;
  }

  throw new Error('File access denied');
};
