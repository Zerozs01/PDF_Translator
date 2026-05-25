import { create } from 'zustand';
import type { DBDocument, DBTag, DBProject, DocumentUpdate } from '../types/electron.d';
import {
  applyLibraryFavoriteToggle,
  applyLibraryProjectMove,
  applyLibraryTagRemoval,
  createLibraryProject,
  createLibraryTag,
  deleteLibraryDocument,
  deleteLibraryProject,
  deleteLibraryTag,
  loadFavoriteLibraryDocuments,
  loadLibraryDocumentTags,
  loadLibraryDocumentsByProject,
  loadLibraryDocumentsByTag,
  loadLibraryProjects,
  loadLibraryTags,
  loadRecentLibraryDocuments,
  moveLibraryDocumentToProject,
  patchLibraryDocuments,
  removeLibraryTagFromDocument,
  searchLibraryDocuments,
  sortLibraryDocuments,
  toggleLibraryDocumentFavorite,
  updateLibraryDocument,
  addLibraryTagToDocument,
} from '../services/libraryService';

export type ViewMode = 'grid' | 'detail';
export type SortBy = 'name' | 'date' | 'size' | 'type';
export type SortOrder = 'asc' | 'desc';
export type FilterType = 'all' | 'favorites' | 'recent' | 'tag' | 'project';

interface FileBrowserState {
  // View Settings
  viewMode: ViewMode;
  sortBy: SortBy;
  sortOrder: SortOrder;
  
  // Filter
  filterType: FilterType;
  selectedTagId: number | null;
  selectedProjectId: number | null;
  searchQuery: string;
  
  // Data
  documents: DBDocument[];
  tags: DBTag[];
  projects: DBProject[];
  
  // Selection
  selectedDocumentIds: Set<number>;
  
  // Loading States
  isLoading: boolean;
  error: string | null;
  
  // Actions - View
  setViewMode: (mode: ViewMode) => void;
  setSortBy: (sortBy: SortBy) => void;
  setSortOrder: (order: SortOrder) => void;
  toggleSortOrder: () => void;
  
  // Actions - Filter
  setFilterType: (type: FilterType) => void;
  setSelectedTagId: (id: number | null) => void;
  setSelectedProjectId: (id: number | null) => void;
  setSearchQuery: (query: string) => void;
  
  // Actions - Selection
  selectDocument: (id: number) => void;
  deselectDocument: (id: number) => void;
  toggleDocumentSelection: (id: number) => void;
  selectAllDocuments: () => void;
  clearSelection: () => void;
  
    // Actions - Data Loading
  loadStartupData: () => Promise<void>; // 🚀 Batch load: recent + tags + projects in 1 call
  loadRecentDocuments: () => Promise<void>;
  loadDocumentsByProject: (projectId: number | null) => Promise<void>;
  loadFavoriteDocuments: () => Promise<void>;
  loadDocumentsByTag: (tagId: number) => Promise<void>;
  searchDocuments: (query: string) => Promise<void>;
  loadTags: () => Promise<void>;
  loadProjects: () => Promise<void>;
  
  // Actions - Document Operations
  toggleFavorite: (id: number) => Promise<void>;
  deleteDocument: (id: number) => Promise<void>;
  moveToProject: (documentId: number, projectId: number | null) => Promise<void>;
  addTagToDocument: (documentId: number, tagId: number) => Promise<void>;
  removeTagFromDocument: (documentId: number, tagId: number) => Promise<void>;
  loadDocumentTags: (documentId: number) => Promise<DBTag[]>;
  persistDocumentPatch: (documentId: number, updates: DocumentUpdate) => Promise<boolean>;
  
  // Actions - Tag Operations
  createTag: (name: string, color?: string) => Promise<DBTag | null>;
  deleteTag: (id: number) => Promise<void>;
  
  // Actions - Project Operations
  createProject: (name: string, parentId?: number | null, color?: string) => Promise<DBProject | null>;
  deleteProject: (id: number) => Promise<void>;
  
  // Computed/Helpers
  getSortedDocuments: () => DBDocument[];
}

export const useFileBrowserStore = create<FileBrowserState>((set, get) => ({
  // Initial State
  viewMode: 'grid',
  sortBy: 'date',
  sortOrder: 'desc',
  
  filterType: 'recent',
  selectedTagId: null,
  selectedProjectId: null,
  searchQuery: '',
  
  documents: [],
  tags: [],
  projects: [],
  
  selectedDocumentIds: new Set(),
  
  isLoading: false,
  error: null,
  
  // View Actions
  setViewMode: (mode) => set({ viewMode: mode }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortOrder: (order) => set({ sortOrder: order }),
  toggleSortOrder: () => set((state) => ({ 
    sortOrder: state.sortOrder === 'asc' ? 'desc' : 'asc' 
  })),
  
  // Filter Actions
  setFilterType: (type) => set({ filterType: type }),
  setSelectedTagId: (id) => set({ selectedTagId: id, filterType: id ? 'tag' : 'all' }),
  setSelectedProjectId: (id) => set({ selectedProjectId: id, filterType: id ? 'project' : 'all' }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  
  // Selection Actions
  selectDocument: (id) => set((state) => {
    const newSet = new Set(state.selectedDocumentIds);
    newSet.add(id);
    return { selectedDocumentIds: newSet };
  }),
  deselectDocument: (id) => set((state) => {
    const newSet = new Set(state.selectedDocumentIds);
    newSet.delete(id);
    return { selectedDocumentIds: newSet };
  }),
  toggleDocumentSelection: (id) => set((state) => {
    const newSet = new Set(state.selectedDocumentIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    return { selectedDocumentIds: newSet };
  }),
  selectAllDocuments: () => set((state) => ({
    selectedDocumentIds: new Set(state.documents.map(d => d.id))
  })),
  clearSelection: () => set({ selectedDocumentIds: new Set() }),
  
    // 🚀 Batch startup load: all 3 in 1 IPC round-trip
  loadStartupData: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await window.electronAPI.startupLoad?.();
      if (result) {
        set({
          documents: result.recentDocuments,
          tags: result.allTags,
          projects: result.allProjects,
          isLoading: false,
          filterType: 'recent',
        });
      } else {
        // Fallback to parallel individual loads
        await Promise.all([loadRecentLibraryDocuments(50), loadLibraryTags(), loadLibraryProjects()]).then(
          ([documents, tags, projects]) => set({ documents, tags, projects, isLoading: false, filterType: 'recent' })
        );
      }
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },

  loadRecentDocuments: async () => {
    set({ isLoading: true, error: null });
    try {
      const documents = await loadRecentLibraryDocuments(50);
      set({ documents, isLoading: false, filterType: 'recent' });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
  
  loadDocumentsByProject: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const documents = await loadLibraryDocumentsByProject(projectId);
      set({ documents, isLoading: false, selectedProjectId: projectId, filterType: 'project' });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
  
  loadFavoriteDocuments: async () => {
    set({ isLoading: true, error: null });
    try {
      const documents = await loadFavoriteLibraryDocuments();
      set({ documents, isLoading: false, filterType: 'favorites' });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
  
  loadDocumentsByTag: async (tagId) => {
    set({ isLoading: true, error: null });
    try {
      const documents = await loadLibraryDocumentsByTag(tagId);
      set({ documents, isLoading: false, selectedTagId: tagId, filterType: 'tag' });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
  
  searchDocuments: async (query) => {
    set({ isLoading: true, error: null, searchQuery: query });
    try {
      const documents = await searchLibraryDocuments(query);
      set({ documents, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
  
  loadTags: async () => {
    try {
      const tags = await loadLibraryTags();
      set({ tags });
    } catch (error) {
      console.error('Failed to load tags:', error);
    }
  },
  
  loadProjects: async () => {
    try {
      const projects = await loadLibraryProjects();
      set({ projects });
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  },
  
  // Document Operations
  toggleFavorite: async (id) => {
    try {
      let nextFavorite = false;
      set((state) => {
        const target = state.documents.find(doc => doc.id === id);
        nextFavorite = target ? !target.is_favorite : false;
        return {
          documents: applyLibraryFavoriteToggle({
            documents: state.documents,
            filterType: state.filterType,
            documentId: id,
            nextFavorite,
          })
        };
      });
      await toggleLibraryDocumentFavorite(id);
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  },
  
  deleteDocument: async (id) => {
    try {
      const deleted = await deleteLibraryDocument(id);
      if (!deleted) return;
      set((state) => ({
        documents: state.documents.filter(doc => doc.id !== id),
        selectedDocumentIds: (() => {
          const newSet = new Set(state.selectedDocumentIds);
          newSet.delete(id);
          return newSet;
        })()
      }));
    } catch (error) {
      console.error('Failed to delete document:', error);
    }
  },
  
  moveToProject: async (documentId, projectId) => {
    try {
      const updated = await moveLibraryDocumentToProject(documentId, projectId);
      if (!updated) return;
      set((state) => ({
        documents: applyLibraryProjectMove({
          documents: state.documents,
          filterType: state.filterType,
          selectedProjectId: state.selectedProjectId,
          documentId,
          projectId,
        })
      }));
    } catch (error) {
      console.error('Failed to move document:', error);
    }
  },
  
  addTagToDocument: async (documentId, tagId) => {
    try {
      await addLibraryTagToDocument(documentId, tagId);
    } catch (error) {
      console.error('Failed to add tag:', error);
    }
  },
  
  removeTagFromDocument: async (documentId, tagId) => {
    try {
      const removed = await removeLibraryTagFromDocument(documentId, tagId);
      if (!removed) return;
      set((state) => ({
        documents: applyLibraryTagRemoval({
          documents: state.documents,
          filterType: state.filterType,
          selectedTagId: state.selectedTagId,
          documentId,
          tagId,
        })
      }));
    } catch (error) {
      console.error('Failed to remove tag:', error);
    }
  },

  loadDocumentTags: async (documentId) => loadLibraryDocumentTags(documentId),

  persistDocumentPatch: async (documentId, updates) => {
    const updated = await updateLibraryDocument(documentId, updates);
    if (!updated) return false;
    set((state) => ({
      documents: patchLibraryDocuments(state.documents, documentId, updates),
    }));
    return true;
  },
  
  // Tag Operations
  createTag: async (name, color) => {
    try {
      const tag = await createLibraryTag(name, color);
      if (tag) {
        set((state) => ({ tags: [...state.tags, tag] }));
      }
      return tag;
    } catch (error) {
      console.error('Failed to create tag:', error);
      return null;
    }
  },
  
  deleteTag: async (id) => {
    try {
      const deleted = await deleteLibraryTag(id);
      if (!deleted) return;
      set((state) => ({ tags: state.tags.filter(t => t.id !== id) }));
    } catch (error) {
      console.error('Failed to delete tag:', error);
    }
  },
  
  // Project Operations
  createProject: async (name, parentId = null, color) => {
    try {
      const project = await createLibraryProject({ 
        name, 
        parent_id: parentId,
        color 
      });
      if (project) {
        set((state) => ({ projects: [...state.projects, project] }));
      }
      return project;
    } catch (error) {
      console.error('Failed to create project:', error);
      return null;
    }
  },
  
  deleteProject: async (id) => {
    try {
      const deleted = await deleteLibraryProject(id);
      if (!deleted) return;
      set((state) => ({ projects: state.projects.filter(p => p.id !== id) }));
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  },
  
  // Helper to get sorted documents
  getSortedDocuments: () => {
    const { documents, sortBy, sortOrder } = get();
    return sortLibraryDocuments(documents, sortBy, sortOrder);
  }
}));
