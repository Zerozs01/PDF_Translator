import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useEffect } from 'react';
import { PDFCanvas } from './PDFCanvas';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { useLayerStore } from '../../stores/useLayerStore';

const meta = {
  title: 'PDF/PDFCanvas',
  component: PDFCanvas,
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
          totalPages: 1,
          viewMode: 'single',
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
} satisfies Meta<typeof PDFCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
