import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { SmartCanvas } from './SmartCanvas';
import { Region } from '../types';

const mockRegions: Region[] = [
  {
    id: 'region-1',
    type: 'text',
    box: { x: 100, y: 100, w: 200, h: 60 },
    originalText: 'HELLO WORLD',
    translatedText: 'สวัสดีชาวโลก',
  },
  {
    id: 'region-2',
    type: 'balloon',
    box: { x: 350, y: 200, w: 200, h: 80 },
    originalText: 'HOW ARE YOU TODAY?',
    translatedText: 'วันนี้คุณเป็นอย่างไรบ้าง?',
  },
];

const meta = {
  title: 'Canvas/SmartCanvas',
  component: SmartCanvas,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof SmartCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    regions: mockRegions,
  },
  render: (args) => (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 relative">
      <SmartCanvas {...args} />
    </div>
  ),
};

export const Empty: Story = {
  args: {
    regions: [],
  },
  render: (args) => (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 relative">
      <SmartCanvas {...args} />
    </div>
  ),
};
