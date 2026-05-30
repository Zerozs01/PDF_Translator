import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useEffect } from 'react';
import { LayerPanel } from './LayerPanel';
import { useProjectStore } from '../../stores/useProjectStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { useLayerStore } from '../../stores/useLayerStore';
import type { OCRLine, OCRPageResult } from '../../types';
import type { TextLayer, TextLayerGroup } from '../../types/layers';

const makeLine = (text: string, x: number, y: number): OCRLine => ({
  text,
  confidence: 92,
  bbox: { x0: x, y0: y, x1: x + 220, y1: y + 32 },
  words: [
    {
      text: text.split(' ')[0] || text,
      confidence: 92,
      bbox: { x0: x, y0: y, x1: x + 80, y1: y + 32 },
    },
  ],
});

const mockLines = [
  makeLine('Hello there', 120, 160),
  makeLine('We are ready', 120, 220),
  makeLine('Boom', 420, 420),
];

const mockOcr: OCRPageResult = {
  pageNumber: 1,
  width: 1200,
  height: 1600,
  dpi: 300,
  language: 'eng',
  algorithmVersion: 1,
  pipelineProfile: 'panel',
  ocrEngine: 'tesseract',
  ocrQualityProfile: 'best',
  lines: mockLines,
  words: mockLines.flatMap((line) => line.words),
  text: mockLines.map((line) => line.text).join('\n'),
  confidence: 92,
};

const mockLayers: TextLayer[] = [
  {
    id: 'layer-1',
    lineIndex: 0,
    groupId: 'group-1',
    text: 'Hello there',
    sourceText: 'Hello there',
    bbox: { x0: 120, y0: 160, x1: 340, y1: 192 },
    originalBBox: { x0: 120, y0: 160, x1: 340, y1: 192 },
    fontSize: 18,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 1,
    userEdited: false,
    confidence: 96,
  },
  {
    id: 'layer-2',
    lineIndex: 1,
    groupId: 'group-1',
    text: 'We are ready',
    sourceText: 'We are ready',
    bbox: { x0: 120, y0: 220, x1: 360, y1: 252 },
    originalBBox: { x0: 120, y0: 220, x1: 360, y1: 252 },
    fontSize: 18,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 1,
    userEdited: false,
    confidence: 94,
  },
  {
    id: 'layer-3',
    lineIndex: 2,
    groupId: 'group-2',
    text: 'Boom',
    sourceText: 'Boom',
    bbox: { x0: 420, y0: 420, x1: 520, y1: 452 },
    originalBBox: { x0: 420, y0: 420, x1: 520, y1: 452 },
    fontSize: 20,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    zIndex: 2,
    userEdited: false,
    confidence: 91,
  },
];

const mockGroups: TextLayerGroup[] = [
  {
    id: 'group-1',
    label: 'Balloon 1',
    layerIds: ['layer-1', 'layer-2'],
    mergedBBox: { x0: 110, y0: 150, x1: 380, y1: 270 },
    collapsed: false,
    locked: false,
    visible: true,
    groupType: 'balloon',
    confidence: 90,
    userCreated: false,
    color: '#3B82F6',
  },
  {
    id: 'group-2',
    label: 'SFX',
    layerIds: ['layer-3'],
    mergedBBox: { x0: 410, y0: 410, x1: 540, y1: 470 },
    collapsed: false,
    locked: false,
    visible: true,
    groupType: 'sfx',
    confidence: 86,
    userCreated: false,
    color: '#F59E0B',
  },
];

const meta = {
  title: 'Layers/LayerPanel',
  component: LayerPanel,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => {
      useEffect(() => {
        useProjectStore.setState({
          currentPage: 1,
          sourceLanguage: 'eng',
          targetLanguage: 'th',
          translationMode: 'adaptive',
        });

        const baseOptions = useOCRTextLayerStore.getState().options;
        useOCRTextLayerStore.setState({
          options: { ...baseOptions, language: 'eng', engine: 'tesseract', dpi: 300 },
          allPagesOCR: new Map([[1, mockOcr]]),
          ocrByPageEngine: new Map([[1, new Map([['tesseract', mockOcr]])]]),
          translationPreviewMode: 'translated',
          translationCacheByPage: new Map(),
          activeTranslationKeyByPage: new Map(),
        });

        useLayerStore.setState({
          layersByPage: new Map([[1, mockLayers]]),
          groupsByPage: new Map([[1, mockGroups]]),
          selectedLayerIds: new Set(['layer-2']),
          hoveredLayerId: null,
          hoveredGroupId: null,
          editingLayerId: null,
          activeDragItem: null,
          deletedLineIndexesByPage: new Map(),
        });
      }, []);

      return (
        <div className="h-screen w-64 bg-slate-950 border border-white/5">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof LayerPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
