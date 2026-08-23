import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useEffect, useState } from 'react';
import { UploadScreen } from './UploadScreen';
import { useFileBrowserStore } from '../../stores/useFileBrowserStore';
import { useProjectStore } from '../../stores/useProjectStore';
import type { DBDocument, DBTag, DBProject } from '../../types/electron.d';

const nowIso = new Date().toISOString();

const mockDocuments: DBDocument[] = [
  {
    id: 1,
    filepath: 'C:/Docs/manga-ch01.pdf',
    filename: 'manga-ch01.pdf',
    file_type: 'pdf',
    file_size: 2457600,
    total_pages: 14,
    thumbnail_path: '/fixtures/ocr/dummy.png',
    project_id: 1,
    is_favorite: true,
    rating: 5,
    last_page: 6,
    created_at: nowIso,
    last_accessed: nowIso,
  },
  {
    id: 2,
    filepath: 'C:/Docs/notes.pdf',
    filename: 'notes.pdf',
    file_type: 'pdf',
    file_size: 1024000,
    total_pages: 3,
    thumbnail_path: '/fixtures/ocr/baseline/test1.png',
    project_id: null,
    is_favorite: false,
    rating: 0,
    last_page: 1,
    created_at: nowIso,
    last_accessed: nowIso,
  },
  {
    id: 3,
    filepath: 'C:/Docs/chapter-02.pdf',
    filename: 'Chapter 2.pdf',
    file_type: 'pdf',
    file_size: 4096000,
    total_pages: 28,
    thumbnail_path: '/fixtures/ocr/dummy.png',
    project_id: 1,
    is_favorite: true,
    rating: 4,
    last_page: 1,
    created_at: nowIso,
    last_accessed: nowIso,
  },
];

const mockTags: DBTag[] = [
  { id: 1, name: 'Manga', color: '#8B5CF6', created_at: nowIso },
  { id: 2, name: 'Work', color: '#38BDF8', created_at: nowIso },
  { id: 3, name: 'Important', color: '#F43F5E', created_at: nowIso },
];

const mockProjects: DBProject[] = [
  {
    id: 1,
    name: 'Manga Series',
    description: null,
    icon: null,
    color: '#8B5CF6',
    parent_id: null,
    created_at: nowIso,
  },
  {
    id: 2,
    name: 'Tech Docs',
    description: null,
    icon: null,
    color: '#10B981',
    parent_id: null,
    created_at: nowIso,
  },
  {
    id: 3,
    name: 'Season 1',
    description: null,
    icon: null,
    color: '#38BDF8',
    parent_id: 1,
    created_at: nowIso,
  },
];

interface StoryFrameProps {
  children: React.ReactNode;
  initialState?: Partial<ReturnType<typeof useFileBrowserStore.getState>>;
}

const UploadScreenStoryFrame: React.FC<StoryFrameProps> = ({ children, initialState }) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    useFileBrowserStore.setState({
      documents: mockDocuments,
      tags: mockTags,
      projects: mockProjects,
      isLoading: false,
      error: null,
      filterType: 'recent',
      viewMode: 'grid',
      selectedTagId: null,
      selectedProjectId: null,
      searchQuery: '',
      selectedDocumentIds: new Set<number>(),
      loadStartupData: async () => {},
      ...initialState,
    });

    useProjectStore.setState({
      translationMode: 'adaptive',
      targetLanguage: 'th',
      isGeminiApiKeyLoaded: true,
      hasGeminiApiKey: false,
      geminiApiKeySource: 'none',
      geminiApiKeyDraft: '',
      geminiApiKeyError: null,
    });

    setReady(true);
  }, [initialState]);

  return (
    <div className="h-screen w-screen">
      {ready ? children : (
        <div className="h-screen w-screen flex items-center justify-center text-slate-400 text-sm bg-[#17181b]">
          Preparing story...
        </div>
      )}
    </div>
  );
};

const meta = {
  title: 'Home/UploadScreen',
  component: UploadScreen,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof UploadScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  decorators: [
    (Story) => (
      <UploadScreenStoryFrame>
        <Story />
      </UploadScreenStoryFrame>
    ),
  ],
};

export const InsideFolderWithBreadcrumbs: Story = {
  decorators: [
    (Story) => (
      <UploadScreenStoryFrame
        initialState={{
          selectedProjectId: 1,
          filterType: 'project',
        }}
      >
        <Story />
      </UploadScreenStoryFrame>
    ),
  ],
};

export const EmptyFolderView: Story = {
  decorators: [
    (Story) => (
      <UploadScreenStoryFrame
        initialState={{
          selectedProjectId: 2,
          filterType: 'project',
          documents: [],
        }}
      >
        <Story />
      </UploadScreenStoryFrame>
    ),
  ],
};

export const TagFilterActive: Story = {
  decorators: [
    (Story) => (
      <UploadScreenStoryFrame
        initialState={{
          selectedTagId: 1,
          filterType: 'tag',
        }}
      >
        <Story />
      </UploadScreenStoryFrame>
    ),
  ],
};

export const FavoritesView: Story = {
  decorators: [
    (Story) => (
      <UploadScreenStoryFrame
        initialState={{
          filterType: 'favorites',
          documents: mockDocuments.filter((d) => d.is_favorite),
        }}
      >
        <Story />
      </UploadScreenStoryFrame>
    ),
  ],
};
