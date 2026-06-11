import type { DBDocumentCacheCandidate } from '../types/electron.d';
import { resolveCompatibleDocumentIdentity, resolveDocumentPathForLoad } from './documentIdentity';

type ProjectDocumentRecord = {
  id: number;
  total_pages: number;
};

type ProjectFileLike = File & { path?: string };

type DocumentImportResult = {
  filepath: string;
};

export type ProjectDocumentDB = {
  isAvailable: () => boolean;
  getDocument: (filepath: string) => Promise<ProjectDocumentRecord | null>;
  saveDocument: (filepath: string, filename: string, totalPages: number) => Promise<number>;
  getLatestOCR: (docId: number) => Promise<{ page_number: number; updated_at: number; ocr_data: unknown } | null>;
  findDocumentsByFilename: (filename: string) => Promise<DBDocumentCacheCandidate[]>;
  touchDocument: (docId: number) => Promise<boolean>;
  updateLastPage: (docId: number, pageNum: number) => Promise<boolean>;
  updateDocument: (docId: number, updates: { total_pages?: number }) => Promise<boolean>;
};

export const importCanonicalProjectFile = async ({
  file,
  fileData,
  importFile,
}: {
  file: ProjectFileLike;
  fileData?: Uint8Array | null;
  importFile?: ((payload: {
    name: string;
    mimeType: string;
    data?: Uint8Array | ArrayBuffer;
    filePath?: string;
  }) => Promise<DocumentImportResult | null>) | null;
}): Promise<{
  resolvedFileData: Uint8Array | null;
  importedPath: string | null;
}> => {
  let resolvedFileData = fileData ?? null;
  let importedPath: string | null = null;

  if (!importFile) {
    return { resolvedFileData, importedPath };
  }

  try {
    if (!resolvedFileData) {
      const buffer = await file.arrayBuffer();
      resolvedFileData = new Uint8Array(buffer);
    }

    const importPayload: {
      name: string;
      mimeType: string;
      data?: Uint8Array;
      filePath?: string;
    } = {
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
    };

    if (file.path) {
      importPayload.filePath = file.path;
    } else {
      importPayload.data = new Uint8Array(resolvedFileData);
    }

    const imported = await importFile(importPayload);
    if (imported?.filepath) {
      importedPath = imported.filepath;
    }
  } catch (error) {
    console.warn('[DB] Failed to import canonical file path, fallback to source path:', error);
  }

  return { resolvedFileData, importedPath };
};

export const prepareProjectDocumentLoad = async ({
  db,
  file,
  fileData,
  importFile,
}: {
  db: ProjectDocumentDB;
  file: ProjectFileLike;
  fileData?: Uint8Array | null;
  importFile?: ((payload: {
    name: string;
    mimeType: string;
    data?: Uint8Array | ArrayBuffer;
    filePath?: string;
  }) => Promise<DocumentImportResult | null>) | null;
}): Promise<{
  resolvedPath: string | null;
  resolvedFileData: Uint8Array | null;
}> => {
  const sourcePath = file.path ?? null;
  const imported = await importCanonicalProjectFile({
    file,
    fileData,
    importFile,
  });

  if (!db.isAvailable()) {
    return {
      resolvedPath: imported.importedPath ?? sourcePath,
      resolvedFileData: imported.resolvedFileData,
    };
  }

  try {
    const resolution = await resolveDocumentPathForLoad({
      db,
      filename: file.name,
      sourcePath,
      importedPath: imported.importedPath,
    });

    if (resolution.reusedCacheCandidate) {
      console.log(
        `[DB] Reusing OCR-backed document ${resolution.reusedCacheCandidate.id} for "${file.name}" (cache pages: ${resolution.reusedCacheCandidate.cache_pages})`
      );
    } else if (resolution.ambiguousCacheCandidates > 1 && imported.importedPath) {
      console.warn(
        `[DB] Multiple OCR-backed candidates found for "${file.name}". Keeping current imported path to avoid ambiguity.`
      );
    }

    return {
      resolvedPath: resolution.resolvedPath,
      resolvedFileData: imported.resolvedFileData,
    };
  } catch (error) {
    console.warn('[DB] Failed OCR cache fallback by filename:', error);
    return {
      resolvedPath: imported.importedPath ?? sourcePath,
      resolvedFileData: imported.resolvedFileData,
    };
  }
};

export const ensureProjectDocumentRecord = async ({
  db,
  documentId,
  file,
  filePath,
}: {
  db: ProjectDocumentDB;
  documentId: number | null;
  file: ProjectFileLike | null;
  filePath: string | null;
}): Promise<{
  documentId: number;
  filePath: string;
}> => {
  if (!db.isAvailable()) {
    throw new Error('DB is not available.');
  }

  if (documentId && file && filePath) {
    try {
      const resolution = await resolveCompatibleDocumentIdentity({
        db,
        documentId,
        filename: file.name,
        filePath,
      });

      if (resolution?.reusedCacheCandidate) {
        console.log(
          `[DB] Switching documentId ${documentId} -> ${resolution.documentId} for OCR cache compatibility`
        );
        return {
          documentId: resolution.documentId,
          filePath: resolution.filePath,
        };
      }

      if ((resolution?.ambiguousCacheCandidates || 0) > 1) {
        console.warn(
          `[DB] Multiple OCR-backed candidates found for "${file.name}". Keeping current imported path to avoid ambiguity.`
        );
      }
    } catch (error) {
      console.warn('[DB] Failed to resolve legacy OCR cache document id:', error);
    }

    return { documentId, filePath };
  }

  const path = filePath ?? file?.path ?? null;
  if (!path || !file) {
    throw new Error('File path not available. Cannot ensure document_id.');
  }

  let doc = await db.getDocument(path);
  if (!doc?.id) {
    await db.saveDocument(path, file.name, 0);
    doc = await db.getDocument(path);
  }

  if (!doc?.id) {
    throw new Error('Failed to create document entry for OCR cache.');
  }

  return {
    documentId: doc.id,
    filePath: path,
  };
};

export const touchProjectDocumentActivity = async (db: ProjectDocumentDB, documentId: number): Promise<void> => {
  const touched = await db.touchDocument(documentId);
  if (!touched) {
    console.warn('[DB] Failed to update recent activity:', documentId);
  }
};

export const persistProjectDocumentPage = async (
  db: ProjectDocumentDB,
  documentId: number,
  page: number
): Promise<void> => {
  const updated = await db.updateLastPage(documentId, page);
  if (!updated) {
    console.warn('[DB] Failed to persist page activity:', { documentId, page });
  }
};

export const persistProjectDocumentTotalPages = async (
  db: ProjectDocumentDB,
  documentId: number,
  totalPages: number
): Promise<void> => {
  const updated = await db.updateDocument(documentId, { total_pages: totalPages });
  if (!updated) {
    console.warn('[DB] Failed to persist total pages:', { documentId, totalPages });
  }
};
