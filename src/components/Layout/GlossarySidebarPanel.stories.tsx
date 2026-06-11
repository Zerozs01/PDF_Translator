import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useEffect } from 'react';
import { GlossarySidebarPanel } from './GlossarySidebarPanel';
import { useGlossaryStore } from '../../stores/useGlossaryStore';

const meta = {
  title: 'Layout/GlossarySidebarPanel',
  component: GlossarySidebarPanel,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => {
      useEffect(() => {
        // Initialize with mock data for display in Storybook
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
            {
              id: '3',
              sourceText: 'zoom',
              targetText: 'ฟิ้วว',
              type: 'SFX',
              isActive: false,
            },
            {
              id: '4',
              sourceText: 'shadow',
              targetText: 'เงา',
              type: 'TERM',
              isActive: true,
            },
          ],
        });
      }, []);

      return (
        <div className="h-screen w-80 bg-slate-950">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof GlossarySidebarPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
