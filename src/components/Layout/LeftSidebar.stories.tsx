import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useEffect } from 'react';
import { LeftSidebar } from './LeftSidebar';
import { useProjectStore } from '../../stores/useProjectStore';

const meta = {
  title: 'Layout/LeftSidebar',
  component: LeftSidebar,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => {
      useEffect(() => {
        useProjectStore.setState({
          fileUrl: 'https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/examples/learning/helloworld.pdf',
          fileData: null,
          fileType: 'pdf',
          currentPage: 1,
          totalPages: 4,
          viewMode: 'single',
        });
      }, []);

      return (
        <div className="h-screen w-56 bg-slate-950">
          <Story />
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
