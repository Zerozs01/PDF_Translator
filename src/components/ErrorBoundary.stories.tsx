import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { ErrorBoundary } from './ErrorBoundary';

const ThrowError: React.FC = () => {
  const [armed, setArmed] = React.useState(false);
  if (armed) throw new Error('Storybook crash test');
  return (
    <div className="p-4">
      <p className="mb-2">Click the button to simulate an error inside the boundary.</p>
      <button
        className="px-3 py-1 bg-red-600 text-white rounded"
        onClick={() => setArmed(true)}
      >
        Trigger error
      </button>
    </div>
  );
};

const meta = {
  title: 'System/ErrorBoundary',
  component: ErrorBoundary,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CatchesError: Story = {
  render: () => (
    <ErrorBoundary>
      <ThrowError />
    </ErrorBoundary>
  ),
};

export const WithFallback: Story = {
  render: () => (
    <ErrorBoundary
      fallback={(
        <div className="h-screen w-screen flex items-center justify-center bg-slate-950 text-slate-100 text-sm">
          Custom fallback
        </div>
      )}
    >
      <ThrowError />
    </ErrorBoundary>
  ),
};
