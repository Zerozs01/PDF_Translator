import type {
  DBDocument,
  DBProject,
  DBTag,
  DocumentUpdate,
  ElectronAPI,
  ProjectCreate,
  ProjectUpdate,
  TagUpdate,
} from '../types/electron.d';

export type LibrarySortBy = 'name' | 'date' | 'size' | 'type' | 'rating';
export type LibrarySortOrder = 'asc' | 'desc';
export type LibraryFilterType = 'all' | 'favorites' | 'recent' | 'tag' | 'project';

type LibraryDBClient = Pick<ElectronAPI, 'db'>;
type LibraryTagsClient = Pick<ElectronAPI, 'tags'>;
type LibraryProjectsClient = Pick<ElectronAPI, 'projects'>;

const isFiniteTime = (value: number): boolean => Number.isFinite(value);

const resolveDbClient = (client?: LibraryDBClient | null): LibraryDBClient | null => {
  if (client?.db) return client;
  if (typeof window === 'undefined' || !window.electronAPI?.db) return null;
  return { db: window.electronAPI.db };
};

const resolveTagsClient = (client?: LibraryTagsClient | null): LibraryTagsClient | null => {
  if (client?.tags) return client;
  if (typeof window === 'undefined' || !window.electronAPI?.tags) return null;
  return { tags: window.electronAPI.tags };
};

const resolveProjectsClient = (client?: LibraryProjectsClient | null): LibraryProjectsClient | null => {
  if (client?.projects) return client;
  if (typeof window === 'undefined' || !window.electronAPI?.projects) return null;
  return { projects: window.electronAPI.projects };
};

const withDbClient = async <T>(
  client: LibraryDBClient | null | undefined,
  action: string,
  fallback: T,
  run: (dbClient: LibraryDBClient) => Promise<T>
): Promise<T> => {
  const resolved = resolveDbClient(client);
  if (!resolved) {
    console.warn(`[Library] ${action} skipped: DB bridge is not available`);
    return fallback;
  }

  try {
    return await run(resolved);
  } catch (error) {
    console.error(`[Library] ${action} failed:`, error);
    return fallback;
  }
};

const withTagsClient = async <T>(
  client: LibraryTagsClient | null | undefined,
  action: string,
  fallback: T,
  run: (tagsClient: LibraryTagsClient) => Promise<T>
): Promise<T> => {
  const resolved = resolveTagsClient(client);
  if (!resolved) {
    console.warn(`[Library] ${action} skipped: tags bridge is not available`);
    return fallback;
  }

  try {
    return await run(resolved);
  } catch (error) {
    console.error(`[Library] ${action} failed:`, error);
    return fallback;
  }
};

const withProjectsClient = async <T>(
  client: LibraryProjectsClient | null | undefined,
  action: string,
  fallback: T,
  run: (projectsClient: LibraryProjectsClient) => Promise<T>
): Promise<T> => {
  const resolved = resolveProjectsClient(client);
  if (!resolved) {
    console.warn(`[Library] ${action} skipped: projects bridge is not available`);
    return fallback;
  }

  try {
    return await run(resolved);
  } catch (error) {
    console.error(`[Library] ${action} failed:`, error);
    return fallback;
  }
};

export const isVirtualDocumentPath = (filepath: string): boolean => String(filepath || '').startsWith('virtual://');

export const filterLibraryDocuments = (documents: DBDocument[] | null | undefined): DBDocument[] => {
  if (!Array.isArray(documents)) return [];
  return documents.filter((doc) => !isVirtualDocumentPath(doc.filepath));
};

const getDocumentSortValue = (document: DBDocument, sortBy: LibrarySortBy): number | string => {
  switch (sortBy) {
    case 'name':
      return document.filename;
    case 'date': {
      const timestamp = new Date(document.last_accessed).getTime();
      return isFiniteTime(timestamp) ? timestamp : 0;
    }
    case 'size':
      return document.file_size;
    case 'type':
      return document.file_type;
    case 'rating':
      return document.rating || 0;
  }
};

export const sortLibraryDocuments = (
  documents: DBDocument[] | null | undefined,
  sortBy: LibrarySortBy,
  sortOrder: LibrarySortOrder
): DBDocument[] => {
  const safeDocs = Array.isArray(documents) ? documents : [];
  const multiplier = sortOrder === 'asc' ? 1 : -1;
  return [...safeDocs].sort((left, right) => {
    const leftValue = getDocumentSortValue(left, sortBy);
    const rightValue = getDocumentSortValue(right, sortBy);

    if (leftValue === rightValue) {
      const leftDate = new Date(left.last_accessed).getTime();
      const rightDate = new Date(right.last_accessed).getTime();
      return (rightDate - leftDate);
    }

    if (typeof leftValue === 'string' && typeof rightValue === 'string') {
      return leftValue.localeCompare(rightValue) * multiplier;
    }

    return ((Number(leftValue) || 0) - (Number(rightValue) || 0)) * multiplier;
  });
};

export const patchLibraryDocuments = (
  documents: DBDocument[],
  documentId: number,
  updates: Partial<DBDocument> & DocumentUpdate
): DBDocument[] =>
  documents.map((doc) => (doc.id === documentId ? { ...doc, ...updates } : doc));

export const applyLibraryFavoriteToggle = ({
  documents,
  filterType,
  documentId,
  nextFavorite,
}: {
  documents: DBDocument[];
  filterType: LibraryFilterType;
  documentId: number;
  nextFavorite: boolean;
}): DBDocument[] => {
  if (filterType === 'favorites' && !nextFavorite) {
    return documents.filter((doc) => doc.id !== documentId);
  }
  return patchLibraryDocuments(documents, documentId, { is_favorite: nextFavorite });
};

export const applyLibraryProjectMove = ({
  documents,
  filterType,
  selectedProjectId,
  documentId,
  projectId,
}: {
  documents: DBDocument[];
  filterType: LibraryFilterType;
  selectedProjectId: number | null;
  documentId: number;
  projectId: number | null;
}): DBDocument[] => {
  if (filterType === 'project' && selectedProjectId !== projectId) {
    return documents.filter((doc) => doc.id !== documentId);
  }
  return patchLibraryDocuments(documents, documentId, { project_id: projectId });
};

export const applyLibraryTagRemoval = ({
  documents,
  filterType,
  selectedTagId,
  documentId,
  tagId,
}: {
  documents: DBDocument[];
  filterType: LibraryFilterType;
  selectedTagId: number | null;
  documentId: number;
  tagId: number;
}): DBDocument[] => {
  if (filterType === 'tag' && selectedTagId === tagId) {
    return documents.filter((doc) => doc.id !== documentId);
  }
  return documents;
};

export const loadRecentLibraryDocuments = async (
  limit = 50,
  client?: LibraryDBClient | null
): Promise<DBDocument[]> =>
  withDbClient(client, 'loadRecentDocuments', [], async ({ db }) => {
    const documents = await db.getRecentDocuments(limit);
    return filterLibraryDocuments(documents);
  });

export const loadLibraryDocumentsByProject = async (
  projectId: number | null,
  client?: LibraryDBClient | null
): Promise<DBDocument[]> =>
  withDbClient(client, 'loadDocumentsByProject', [], async ({ db }) => {
    const documents = await db.getDocumentsByProject(projectId);
    return filterLibraryDocuments(documents);
  });

export const loadFavoriteLibraryDocuments = async (
  client?: LibraryDBClient | null
): Promise<DBDocument[]> =>
  withDbClient(client, 'loadFavoriteDocuments', [], async ({ db }) => {
    const documents = await db.getFavoriteDocuments();
    return filterLibraryDocuments(documents);
  });

export const loadLibraryDocumentsByTag = async (
  tagId: number,
  client?: LibraryDBClient | null
): Promise<DBDocument[]> =>
  withDbClient(client, 'loadDocumentsByTag', [], async ({ db }) => {
    const documents = await db.getDocumentsByTag(tagId);
    return filterLibraryDocuments(documents);
  });

export const searchLibraryDocuments = async (
  query: string,
  client?: LibraryDBClient | null
): Promise<DBDocument[]> =>
  withDbClient(client, 'searchDocuments', [], async ({ db }) => {
    const documents = await db.searchDocuments(query);
    return filterLibraryDocuments(documents);
  });

export const loadLibraryDocumentTags = async (
  documentId: number,
  client?: LibraryDBClient | null
): Promise<DBTag[]> =>
  withDbClient(client, 'loadDocumentTags', [], async ({ db }) => db.getDocumentTags(documentId));

export const toggleLibraryDocumentFavorite = async (
  documentId: number,
  client?: LibraryDBClient | null
): Promise<boolean> =>
  withDbClient(client, 'toggleFavorite', false, async ({ db }) => db.toggleFavorite(documentId));

export const deleteLibraryDocument = async (
  documentId: number,
  client?: LibraryDBClient | null
): Promise<boolean> =>
  withDbClient(client, 'deleteDocument', false, async ({ db }) => db.deleteDocument(documentId));

export const updateLibraryDocument = async (
  documentId: number,
  updates: DocumentUpdate,
  client?: LibraryDBClient | null
): Promise<boolean> =>
  withDbClient(client, 'updateDocument', false, async ({ db }) => db.updateDocument(documentId, updates));

export const moveLibraryDocumentToProject = async (
  documentId: number,
  projectId: number | null,
  client?: LibraryDBClient | null
): Promise<boolean> => updateLibraryDocument(documentId, { project_id: projectId }, client);

export const addLibraryTagToDocument = async (
  documentId: number,
  tagId: number,
  client?: LibraryDBClient | null
): Promise<boolean> =>
  withDbClient(client, 'addDocumentTag', false, async ({ db }) => db.addDocumentTag(documentId, tagId));

export const removeLibraryTagFromDocument = async (
  documentId: number,
  tagId: number,
  client?: LibraryDBClient | null
): Promise<boolean> =>
  withDbClient(client, 'removeDocumentTag', false, async ({ db }) => db.removeDocumentTag(documentId, tagId));

export const loadLibraryTags = async (
  client?: LibraryTagsClient | null
): Promise<DBTag[]> =>
  withTagsClient(client, 'loadTags', [], async ({ tags }) => tags.getAll());

export const createLibraryTag = async (
  name: string,
  color?: string,
  client?: LibraryTagsClient | null
): Promise<DBTag | null> =>
  withTagsClient(client, 'createTag', null, async ({ tags }) => tags.create(name, color));

export const updateLibraryTag = async (
  tagId: number,
  updates: TagUpdate,
  client?: LibraryTagsClient | null
): Promise<boolean> =>
  withTagsClient(client, 'updateTag', false, async ({ tags }) =>
    tags.update ? tags.update(tagId, updates) : false
  );

export const deleteLibraryTag = async (
  tagId: number,
  client?: LibraryTagsClient | null
): Promise<boolean> =>
  withTagsClient(client, 'deleteTag', false, async ({ tags }) => tags.delete(tagId));

export const loadLibraryProjects = async (
  client?: LibraryProjectsClient | null
): Promise<DBProject[]> =>
  withProjectsClient(client, 'loadProjects', [], async ({ projects }) => projects.getAll());

export const createLibraryProject = async (
  project: ProjectCreate,
  client?: LibraryProjectsClient | null
): Promise<DBProject | null> =>
  withProjectsClient(client, 'createProject', null, async ({ projects }) => projects.create(project));

export const deleteLibraryProject = async (
  projectId: number,
  client?: LibraryProjectsClient | null
): Promise<boolean> =>
  withProjectsClient(client, 'deleteProject', false, async ({ projects }) => projects.delete(projectId));

export const updateLibraryProject = async (
  projectId: number,
  updates: ProjectUpdate,
  client?: LibraryProjectsClient | null
): Promise<boolean> =>
  withProjectsClient(client, 'updateProject', false, async ({ projects }) => projects.update(projectId, updates));
