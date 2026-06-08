import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import { OCRRegressionHarness } from './OCRRegressionHarness';

const HarnessLauncher: React.FC = () => {
  const [enabled, setEnabled] = useState(false);

  const handleStart = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('fixture', 'page-02-students');
    url.searchParams.set('engine', 'paddleocr');
    url.searchParams.set('pipeline', 'panel');
    url.searchParams.set('quality', 'best');
    window.history.replaceState({}, '', url.toString());
    setEnabled(true);
  };

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-xl w-full rounded-2xl border border-white/10 bg-slate-900/70 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold">OCR Regression Harness</h2>
        <p className="mt-2 text-sm text-slate-400">
          This harness runs OCR fixtures and can be heavy. Click start to mount the harness.
        </p>
        <button
          type="button"
          onClick={handleStart}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:border-cyan-300/70 hover:bg-cyan-500/20"
        >
          Start Harness
        </button>

        {enabled && (
          <div className="mt-5 h-[70vh] overflow-hidden rounded-xl border border-white/10 bg-slate-950">
            <OCRRegressionHarness />
          </div>
        )}
      </div>
    </div>
  );
};

const meta = {
  title: 'OCR/OCRRegressionHarness',
  component: OCRRegressionHarness,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof OCRRegressionHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <HarnessLauncher />,
};
