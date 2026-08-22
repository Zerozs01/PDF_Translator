import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { CompactTopToolbar } from './CompactTopToolbar';

const meta = {
  title: 'Layout/CompactTopToolbar',
  component: CompactTopToolbar,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof CompactTopToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    isAiProcessing: false,
    isOfflineProcessing: false,
    translationStatus: null,
    offlineEngine: 'argos',
  },
  render: (args) => (
    <div className="w-full bg-[#16181c] p-2">
      <CompactTopToolbar {...args} />
    </div>
  ),
};

export const AIProcessing: Story = {
  args: {
    isAiProcessing: true,
    isOfflineProcessing: false,
    translationStatus: { kind: 'info', message: 'Translating with Gemini AI...' },
    offlineEngine: 'argos',
  },
  render: (args) => (
    <div className="w-full bg-[#16181c] p-2">
      <CompactTopToolbar {...args} />
    </div>
  ),
};

export const SuccessStatus: Story = {
  args: {
    isAiProcessing: false,
    isOfflineProcessing: false,
    translationStatus: { kind: 'success', message: 'Page 1 translation complete!' },
    offlineEngine: 'argos',
  },
  render: (args) => (
    <div className="w-full bg-[#16181c] p-2">
      <CompactTopToolbar {...args} />
    </div>
  ),
};
