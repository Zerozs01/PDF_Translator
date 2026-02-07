
import type { Meta, StoryObj } from '@storybook/react';
import { OCRTextLayerPanel } from './OCRTextLayerPanel';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { useEffect } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';

const meta: Meta<typeof OCRTextLayerPanel> = {
  title: 'OCR/OCRTextLayerPanel',
  component: OCRTextLayerPanel,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => {
        useEffect(() => {
             // Ensure we have a file loaded so buttons aren't always disabled
             useProjectStore.setState({
                file: new File(["dummy"], "dummy.pdf", { type: "application/pdf" }),
                fileUrl: "dummy-url"
             });
             
             useOCRTextLayerStore.setState({
                isProcessing: false,
                searchablePDFBlob: null,
                progress: null
             });
        }, []);

        return (
            <div className="w-80 bg-slate-800 p-4 rounded-lg">
                <Story />
            </div>
        );
    }
  ]
};

export default meta;
type Story = StoryObj<typeof OCRTextLayerPanel>;

export const Idle: Story = {};

export const Processing: Story = {
    decorators: [
        (Story) => {
            useEffect(() => {
                useOCRTextLayerStore.setState({
                    isProcessing: true,
                    progress: {
                        stage: 'ocr',
                        currentPage: 1,
                        totalPages: 5,
                        message: 'Processing page 1...',
                        progress: 20
                    }
                });
            }, []);
            return <Story />;
        }
    ]
};

export const Complete: Story = {
    decorators: [
        (Story) => {
            useEffect(() => {
                useOCRTextLayerStore.setState({
                    isProcessing: false,
                    searchablePDFBlob: new Blob(['dummy'], { type: 'application/pdf' }), 
                    progress: {
                         stage: 'complete',
                         currentPage: 5,
                         totalPages: 5,
                         message: 'Completed',
                         progress: 100
                    }
                });
            }, []);
            return <Story />;
        }
    ]
};
