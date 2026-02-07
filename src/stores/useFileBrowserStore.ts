import { create } from 'zustand';
import type { DBDocument, DBTag, DBProject } from '../types/electron.d';

const isVirtualPath = (filepath: string): boolean => filepath.startsWith('virtual://');
const filterVirtualDocuments = (documents: DBDocument[]): DBDocument[] =>
  documents.filter((doc) => !isVirtualPath(doc.filepath));

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
  
  // Data Loading Actions
  loadRecentDocuments: async () => {
    set({ isLoading: true, error: null });
    try {
      const documents = await window.electronAPI.db.getRecentDocuments(50);
      const filtered = filterVirtualDocuments(documents);
      set({ documents: filtered, isLoading: false, filterType: 'recent' });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
  
  loadDocumentsByProject: async (projectId) => {
    set({ isLoading: true, error: null });
    try {
      const documents = await window.electronAPI.db.getDocumentsByProject(projectId);
      const filtered = filterVirtualDocuments(documents);
      set({ documents: filtered, isLoading: false, selectedProjectId: projectId, filterType: 'project' });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
  
  loadFavoriteDocuments: async () => {
    set({ isLoading: true, error: null });
    try {
      const documents = await window.electronAPI.db.getFavoriteDocuments();
      const filtered = filterVirtualDocuments(documents);
      set({ documents: filtered, isLoading: false, filterType: 'favorites' });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
  
  loadDocumentsByTag: async (tagId) => {
    set({ isLoading: true, error: null });
    try {
      const documents = await window.electronAPI.db.getDocumentsByTag(tagId);
      const filtered = filterVirtualDocuments(documents);
      set({ documents: filtered, isLoading: false, selectedTagId: tagId, filterType: 'tag' });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
  
  searchDocuments: async (query) => {
    set({ isLoading: true, error: null, searchQuery: query });
    try {
      const documents = await window.electronAPI.db.searchDocuments(query);
      const filtered = filterVirtualDocuments(documents);
      set({ documents: filtered, isLoading: false });
    } catch (error) {
      set({ error: (error as Error).message, isLoading: false });
    }
  },
  
  loadTags: async () => {
    try {
      const tags = await window.electronAPI.tags.getAll();
      set({ tags });
    } catch (error) {
      console.error('Failed to load tags:', error);
    }
  },
  
  loadProjects: async () => {
    try {
      const projects = await window.electronAPI.projects.getAll();
      set({ projects });
    } catch (error) {
      console.error('Failed to load projects:', error);
    }
  },
  
  // Document Operations
  toggleFavorite: async (id) => {
    try {
      await window.electronAPI.db.toggleFavorite(id);
      // Update local state
      set((state) => ({
        documents: state.documents.map(doc => 
          doc.id === id ? { ...doc, is_favorite: !doc.is_favorite } : doc
        )
      }));
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  },
  
  deleteDocument: async (id) => {
    try {
      await window.electronAPI.db.deleteDocument(id);
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
      await window.electronAPI.db.updateDocument(documentId, { project_id: projectId });
      set((state) => ({
        documents: state.documents.map(doc => 
          doc.id === documentId ? { ...doc, project_id: projectId } : doc
        )
      }));
    } catch (error) {
      console.error('Failed to move document:', error);
    }
  },
  
  addTagToDocument: async (documentId, tagId) => {
    try {
      await window.electronAPI.db.addDocumentTag(documentId, tagId);
    } catch (error) {
      console.error('Failed to add tag:', error);
    }
  },
  
  removeTagFromDocument: async (documentId, tagId) => {
    try {
      await window.electronAPI.db.removeDocumentTag(documentId, tagId);
    } catch (error) {
      console.error('Failed to remove tag:', error);
    }
  },
  
  // Tag Operations
  createTag: async (name, color) => {
    try {
      const tag = await window.electronAPI.tags.create(name, color);
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
      await window.electronAPI.tags.delete(id);
      set((state) => ({ tags: state.tags.filter(t => t.id !== id) }));
    } catch (error) {
      console.error('Failed to delete tag:', error);
    }
  },
  
  // Project Operations
  createProject: async (name, parentId = null, color) => {
    try {
      const project = await window.electronAPI.projects.create({ 
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
      await window.electronAPI.projects.delete(id);
      set((state) => ({ projects: state.projects.filter(p => p.id !== id) }));
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  },
  
  // Helper to get sorted documents
  getSortedDocuments: () => {
    const { documents, sortBy, sortOrder } = get();
    const sorted = [...documents].sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.filename.localeCompare(b.filename);
          break;
        case 'date':
          comparison = new Date(a.last_accessed).getTime() - new Date(b.last_accessed).getTime();
          break;
        case 'size':
          comparison = a.file_size - b.file_size;
          break;
        case 'type':
          comparison = a.file_type.localeCompare(b.file_type);
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }
}));
