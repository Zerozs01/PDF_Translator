import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useEffect } from 'react';
import { ImageCanvas } from './ImageCanvas';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { useLayerStore } from '../../stores/useLayerStore';

const meta = {
  title: 'Image/ImageCanvas',
  component: ImageCanvas,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => {
      useEffect(() => {
        useProjectStore.setState({
          fileUrl: '/fixtures/ocr/dummy.png',
          fileType: 'image',
          currentPage: 1,
          totalPages: 1,
        });
        useUIStore.getState().resetView();
        useOCRTextLayerStore.getState().reset();
        useLayerStore.getState().clearLayers();
      }, []);

      return (
        <div className="h-screen w-screen bg-slate-950">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof ImageCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
