import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import { SplitViewToggle } from './Toolbar';

const meta = {
  title: 'Viewer/Toolbar',
  component: SplitViewToggle,
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof SplitViewToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inactive: Story = {
  args: {
    viewMode: 'overlay',
    isActive: false,
    onToggle: () => {},
  },
  render: (args) => (
    <div className="p-4 bg-slate-900 rounded-xl border border-white/10 flex items-center gap-2">
      <SplitViewToggle {...args} />
      <span className="text-xs text-slate-300">Single Overlay Mode</span>
    </div>
  ),
};

export const Active: Story = {
  args: {
    viewMode: 'split',
    isActive: true,
    onToggle: () => {},
  },
  render: (args) => (
    <div className="p-4 bg-slate-900 rounded-xl border border-white/10 flex items-center gap-2">
      <SplitViewToggle {...args} />
      <span className="text-xs text-slate-300">Side-by-Side Split Mode</span>
    </div>
  ),
};

export const Interactive: Story = {
  args: {
    viewMode: 'overlay',
    isActive: false,
    onToggle: () => {},
  },
  render: () => {
    const [active, setActive] = useState(false);
    return (
      <div className="p-4 bg-slate-900 rounded-xl border border-white/10 flex items-center gap-3">
        <SplitViewToggle
          viewMode={active ? 'split' : 'overlay'}
          isActive={active}
          onToggle={() => setActive(!active)}
        />
        <span className="text-xs text-slate-200">
          Current View: <strong className="text-sky-400">{active ? 'Side-by-Side' : 'Single Overlay'}</strong>
        </span>
      </div>
    );
  },
};
