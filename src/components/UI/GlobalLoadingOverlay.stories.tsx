import type { Meta, StoryObj } from '@storybook/react-vite';
import { GlobalLoadingOverlay } from './GlobalLoadingOverlay';

const meta = {
  title: 'UI/GlobalLoadingOverlay',
  component: GlobalLoadingOverlay,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div className="h-screen w-screen bg-slate-950">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GlobalLoadingOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    message: 'Running OCR on page 1',
    progress: 38,
  },
};

export const WithoutProgress: Story = {
  args: {
    message: 'Preparing OCR pipeline',
  },
};
