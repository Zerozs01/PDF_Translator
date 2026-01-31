
import type { Meta, StoryObj } from '@storybook/react';
import { RightSidebar } from './RightSidebar';
import { useProjectStore } from '../../stores/useProjectStore';
import { useSegmentationStore } from '../../stores/useSegmentationStore';
import { useEffect } from 'react';

// Mock component for OCRTextLayerPanel since it has its own complex logic
// We can also create a story for it separately
// eslint-disable-next-line react/display-name
const MockOCRTextLayerPanel = () => (
  <div className="p-4 border border-dashed border-slate-600 rounded bg-slate-800/50 text-slate-400 text-center">
    OCR Text Layer Panel Mock
  </div>
);

// We need to mock the module import for OCRTextLayerPanel if we want to isolate it completely,
// but for now, let's assume it renders typically or we can rely on the real one if it's pure enough.
// Actually, looking at the code, RightSidebar imports OCRTextLayerPanel. 
// If we want to strictly unit test visually, we might want to mock it, but integration test style is also fine.

const meta: Meta<typeof RightSidebar> = {
  title: 'Layout/RightSidebar',
  component: RightSidebar,
  parameters: {
    layout: 'fullscreen',
  },
  // Decorator to reset stores
  decorators: [
    (Story) => {
      // Reset stores to default before each story
       useEffect(() => {
        useProjectStore.setState({
            fileUrl: 'https://raw.githubusercontent.com/mozilla/pdf.js/ba2edeae/examples/learning/helloworld.pdf',
            currentPage: 1,
            totalPages: 5,
            fileType: 'pdf',
        });
        useSegmentationStore.setState({
            isProcessing: false,
            regions: [],
        });
      }, []);
      
      return (
        <div className="h-screen w-80 bg-slate-900 flex">
            <Story />
        </div>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof RightSidebar>;

export const Default: Story = {
  render: () => <RightSidebar />,
};

export const WithRegions: Story = {
    decorators: [
        (Story) => {
            useEffect(() => {
                 useSegmentationStore.setState({
                    regions: [
                        { id: '1', type: 'balloon', confidence: 0.95, originalText: 'Hello World' },
                        { id: '2', type: 'sfx', confidence: 0.85, originalText: 'BOOM!' },
                        { id: '3', type: 'text', confidence: 0.90, originalText: 'Some narration text' },
                    ] as any 
                 })
            }, []);
            return <Story />
        }
    ]
};

export const Processing: Story = {
    decorators: [
        (Story) => {
             useEffect(() => {
                 useSegmentationStore.setState({
                    isProcessing: true,
                    regions: []
                 })
            }, []);
            return <Story />
        }
    ]
};

export const ImageMode: Story = {
     decorators: [
        (Story) => {
             useEffect(() => {
                 useProjectStore.setState({
                    fileType: 'image'
                 })
            }, []);
            return <Story />
        }
    ]
}
