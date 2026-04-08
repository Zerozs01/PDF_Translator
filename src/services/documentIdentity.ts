import type { DBDocumentCacheCandidate } from '../types/electron.d';

type DocumentRecord = {
  id: number;
  total_pages: number;
};

type OCRRecord = {
  page_number: number;
  updated_at: number;
  ocr_data: unknown;
};

export type DocumentIdentityDB = {
  getDocument: (filepath: string) => Promise<DocumentRecord | null>;
  getLatestOCR: (docId: number) => Promise<OCRRecord | null>;
  findDocumentsByFilename: (filename: string) => Promise<DBDocumentCacheCandidate[]>;
};

export const isImportedCachePath = (value: string | null): boolean =>
  typeof value === 'string'
  && /[\\/]imports[\\/][a-f0-9]{16,}\.[^\\/]+$/i.test(value);

type CacheCandidateResolution = {
  candidate: DBDocumentCacheCandidate | null;
  ambiguousCount: number;
};

const findSingleCacheCandidate = async ({
  db,
  filename,
  excludePath,
  excludeId,
}: {
  db: DocumentIdentityDB;
  filename: string;
  excludePath?: string | null;
  excludeId?: number | null;
}): Promise<CacheCandidateResolution> => {
  const candidates = await db.findDocumentsByFilename(filename);
  const cacheCandidates = candidates.filter((candidate) => {
    if (candidate.cache_pages <= 0) return false;
    if (excludePath && candidate.filepath === excludePath) return false;
    if (typeof excludeId === 'number' && candidate.id === excludeId) return false;
    return true;
  });

  return {
    candidate: cacheCandidates.length === 1 ? cacheCandidates[0] : null,
    ambiguousCount: cacheCandidates.length > 1 ? cacheCandidates.length : 0,
  };
};

export const resolveDocumentPathForLoad = async ({
  db,
  filename,
  sourcePath,
  importedPath,
}: {
  db: DocumentIdentityDB;
  filename: string;
  sourcePath: string | null;
  importedPath: string | null;
}): Promise<{
  resolvedPath: string | null;
  reusedCacheCandidate: DBDocumentCacheCandidate | null;
  ambiguousCacheCandidates: number;
}> => {
  let resolvedPath = sourcePath;

  if (sourcePath) {
    try {
      const existingSourceDoc = await db.getDocument(sourcePath);
      if (!existingSourceDoc?.id && importedPath) {
        resolvedPath = importedPath;
      }
    } catch {
      if (importedPath) resolvedPath = importedPath;
    }
  } else if (importedPath) {
    resolvedPath = importedPath;
  }

  if (!resolvedPath || !isImportedCachePath(resolvedPath)) {
    return {
      resolvedPath,
      reusedCacheCandidate: null,
      ambiguousCacheCandidates: 0,
    };
  }

  try {
    const activeDoc = await db.getDocument(resolvedPath);
    const hasCurrentCache = Boolean(activeDoc?.id && await db.getLatestOCR(activeDoc.id));
    if (hasCurrentCache) {
      return {
        resolvedPath,
        reusedCacheCandidate: null,
        ambiguousCacheCandidates: 0,
      };
    }

    const resolution = await findSingleCacheCandidate({
      db,
      filename,
      excludePath: resolvedPath,
    });

    return {
      resolvedPath: resolution.candidate?.filepath ?? resolvedPath,
      reusedCacheCandidate: resolution.candidate,
      ambiguousCacheCandidates: resolution.ambiguousCount,
    };
  } catch {
    return {
      resolvedPath,
      reusedCacheCandidate: null,
      ambiguousCacheCandidates: 0,
    };
  }
};

export const resolveCompatibleDocumentIdentity = async ({
  db,
  documentId,
  filename,
  filePath,
}: {
  db: DocumentIdentityDB;
  documentId: number;
  filename: string;
  filePath: string | null;
}): Promise<{
  documentId: number;
  filePath: string;
  reusedCacheCandidate: DBDocumentCacheCandidate | null;
  ambiguousCacheCandidates: number;
} | null> => {
  if (!isImportedCachePath(filePath)) {
    return null;
  }

  try {
    const hasCurrentCache = Boolean(await db.getLatestOCR(documentId));
    if (hasCurrentCache) {
      return null;
    }

    const resolution = await findSingleCacheCandidate({
      db,
      filename,
      excludeId: documentId,
    });

    if (!resolution.candidate) {
      return resolution.ambiguousCount > 0
        ? {
            documentId,
            filePath: filePath || '',
            reusedCacheCandidate: null,
            ambiguousCacheCandidates: resolution.ambiguousCount,
          }
        : null;
    }

    return {
      documentId: resolution.candidate.id,
      filePath: resolution.candidate.filepath,
      reusedCacheCandidate: resolution.candidate,
      ambiguousCacheCandidates: 0,
    };
  } catch {
    return null;
  }
};
