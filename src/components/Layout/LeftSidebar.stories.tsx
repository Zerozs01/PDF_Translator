import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useEffect } from 'react';
import { LeftSidebar } from './LeftSidebar';
import { useProjectStore } from '../../stores/useProjectStore';
import { useGlossaryStore } from '../../stores/useGlossaryStore';

const meta = {
  title: 'Layout/LeftSidebar',
  component: LeftSidebar,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => {
      useEffect(() => {
        // Initialize Project Store
        useProjectStore.setState({
          fileUrl: 'https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/examples/learning/helloworld.pdf',
          fileData: null,
          fileType: 'pdf',
          currentPage: 1,
          totalPages: 4,
          viewMode: 'single',
        });

        // Initialize Glossary Store
        useGlossaryStore.setState({
          entries: [
            {
              id: '1',
              sourceText: '쿵',
              targetText: 'ตึง!',
              type: 'SFX',
              isActive: true,
            },
            {
              id: '2',
              sourceText: 'Arthur',
              targetText: 'อาเธอร์',
              type: 'TERM',
              isActive: true,
            },
          ]
        });
      }, []);

      return (
        <div className="h-screen bg-slate-950 flex">
          <Story />
          <div className="flex-1 bg-slate-900/50 flex items-center justify-center text-slate-500 text-sm">
            Main Application Content Area (Interactive Page Navigation panel on the left)
          </div>
        </div>
      );
    },
  ],
} satisfies Meta<typeof LeftSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    isOpen: true,
    onToggle: () => {},
  },
};

