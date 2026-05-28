/**
 * InteractiveLayerOverlay.stories.tsx
 * 
 * Storybook stories for Phase 3: Interactive Layer Manipulation Overlay.
 * Tests layer selection, multi-select, inline editing, drag/resize, and undo.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import { InteractiveLayerOverlay } from './InteractiveLayerOverlay';
import { useLayerStore } from '../../stores/useLayerStore';
import type { TextLayer, TextLayerGroup } from '../../types/layers';

// ─── Types (matching InteractiveLayerOverlay.tsx) ─────────────────────────────

interface OcrTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const makeMockLayer = (id: string, text: string, x: number, y: number, w = 120, h = 36): TextLayer => ({
  id,
  lineIndex: parseInt(id.replace('layer-', ''), 10) || 0,
  groupId: 'group-1',
  text,
  sourceText: text,
  bbox: { x0: x, y0: y, x1: x + w, y1: y + h },
  originalBBox: { x0: x, y0: y, x1: x + w, y1: y + h },
  fontSize: 18,
  textColor: '#000000',
  backgroundColor: '#FFFFFF',
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  zIndex: 1,
  userEdited: false,
  confidence: 92,
  bold: false,
});

const mockGroups: TextLayerGroup[] = [
  {
    id: 'group-1',
    label: 'Balloon 1',
    layerIds: ['layer-1', 'layer-2'],
    mergedBBox: { x0: 80, y0: 120, x1: 320, y1: 220 },
    collapsed: false,
    locked: false,
    visible: true,
    groupType: 'balloon',
    confidence: 88,
    userCreated: false,
    color: '#3B82F6',
  },
];

const defaultOcrTransform: OcrTransform = {
  scaleX: 1,
  scaleY: 1,
  offsetX: 0,
  offsetY: 0,
};

// ─── Story Props (matches InteractiveLayerOverlay Props interface) ─────────────

interface StoryProps {
  pageNum: number;
  layers: TextLayer[];
  groups: TextLayerGroup[];
  ocrTransform: OcrTransform;
  isActive: boolean;
}

// ─── Mock Store Setup ─────────────────────────────────────────────────────────

const setupStore = (
  layers: TextLayer[],
  selectedIds: string[] = [],
  editingId: string | null = null
) => {
  useLayerStore.setState({
    layersByPage: new Map([[1, layers]]),
    groupsByPage: new Map([[1, mockGroups]]),
    selectedLayerIds: new Set(selectedIds),
    editingLayerId: editingId,
    hoveredLayerId: null,
    hoveredGroupId: null,
    undoStackByPage: new Map(),
    deletedLineIndexesByPage: new Map(),
  });
};

// ─── Stories ────────────────────────────────────────────────────────────────────

const meta = {
  title: 'Layers/InteractiveLayerOverlay',
  component: InteractiveLayerOverlay,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<StoryProps>;

export default meta;
type Story = StoryObj<typeof meta>;

// Single layer selected (Canva-style selection box visible)
export const SingleLayerSelected: Story = {
  args: {
    pageNum: 1,
    layers: [makeMockLayer('layer-1', 'Hello World!', 100, 150)],
    groups: mockGroups,
    ocrTransform: defaultOcrTransform,
    isActive: true,
  },
  render: (args) => {
    const layers = args.layers;
    setupStore(layers, ['layer-1']);
    return <InteractiveLayerOverlay {...args} />;
  },
};

// Multi-select with Shift+click (two layers selected)
export const MultiLayerSelected: Story = {
  args: {
    pageNum: 1,
    layers: [
      makeMockLayer('layer-1', 'First line', 100, 150),
      makeMockLayer('layer-2', 'Second line', 100, 220),
    ],
    groups: mockGroups,
    ocrTransform: defaultOcrTransform,
    isActive: true,
  },
  render: (args) => {
    const layers = args.layers;
    setupStore(layers, ['layer-1', 'layer-2']);
    return <InteractiveLayerOverlay {...args} />;
  },
};

// Inline text editing active (editingLayerId set)
export const InlineEditingActive: Story = {
  args: {
    pageNum: 1,
    layers: [makeMockLayer('layer-1', 'Edit me!', 100, 150)],
    groups: mockGroups,
    ocrTransform: defaultOcrTransform,
    isActive: true,
  },
  render: (args) => {
    const layers = args.layers;
    setupStore(layers, ['layer-1'], 'layer-1');
    return <InteractiveLayerOverlay {...args} />;
  },
};

// Select tool with no selection, showing hover states
export const SelectToolNoSelection: Story = {
  args: {
    pageNum: 1,
    layers: [
      makeMockLayer('layer-1', 'Line one', 80, 120),
      makeMockLayer('layer-2', 'Line two', 80, 190),
      makeMockLayer('layer-3', 'Line three', 300, 300),
    ],
    groups: mockGroups,
    ocrTransform: defaultOcrTransform,
    isActive: true,
  },
  render: (args) => {
    const layers = args.layers;
    setupStore(layers, []);
    return <InteractiveLayerOverlay {...args} />;
  },
};

// User-edited layer (protected from auto-translation)
export const UserEditedLayer: Story = {
  args: {
    pageNum: 1,
    layers: [makeMockLayer('layer-1', 'Manually edited', 100, 150)],
    groups: mockGroups,
    ocrTransform: defaultOcrTransform,
    isActive: true,
  },
  render: (args) => {
    const editedLayer: TextLayer = { ...args.layers[0] };
    editedLayer.userEdited = true;
    editedLayer.textColor = '#1a1a2e';
    setupStore([editedLayer], ['layer-1']);
    return <InteractiveLayerOverlay {...args} layers={[editedLayer]} />;
  },
};

// Multiple balloon groups with different types and colors
export const MultipleGroups: Story = {
  args: {
    pageNum: 1,
    layers: [
      makeMockLayer('layer-1', 'Speech balloon text', 100, 100, 160, 50),
      makeMockLayer('layer-2', 'BOOM!', 500, 300, 120, 36),
      makeMockLayer('layer-3', 'Narration text here', 120, 460, 200, 32),
    ],
    groups: [
      {
        id: 'group-1',
        label: 'Balloon 1',
        layerIds: ['layer-1'],
        mergedBBox: { x0: 80, y0: 80, x1: 280, y1: 160 },
        collapsed: false,
        locked: false,
        visible: true,
        groupType: 'balloon' as const,
        confidence: 90,
        userCreated: false,
        color: '#3B82F6',
      },
      {
        id: 'group-2',
        label: 'SFX',
        layerIds: ['layer-2'],
        mergedBBox: { x0: 500, y0: 300, x1: 650, y1: 340 },
        collapsed: false,
        locked: false,
        visible: true,
        groupType: 'sfx' as const,
        confidence: 85,
        userCreated: false,
        color: '#f59e0b',
      },
      {
        id: 'group-3',
        label: 'Narration',
        layerIds: ['layer-3'],
        mergedBBox: { x0: 100, y0: 450, x1: 350, y1: 500 },
        collapsed: false,
        locked: false,
        visible: true,
        groupType: 'narration' as const,
        confidence: 92,
        userCreated: false,
        color: '#10b981',
      },
    ],
    ocrTransform: defaultOcrTransform,
    isActive: true,
  },
  render: (args) => {
    useLayerStore.setState({
      layersByPage: new Map([[1, args.layers]]),
      groupsByPage: new Map([[1, args.groups]]),
      selectedLayerIds: new Set(),
      editingLayerId: null,
      hoveredLayerId: null,
      hoveredGroupId: null,
      undoStackByPage: new Map(),
      deletedLineIndexesByPage: new Map(),
    });
    return <InteractiveLayerOverlay {...args} />;
  },
};

// Inactive state (overlay hidden or locked)
export const InactiveOverlay: Story = {
  args: {
    pageNum: 1,
    layers: [makeMockLayer('layer-1', 'Should be hidden', 100, 150)],
    groups: mockGroups,
    ocrTransform: defaultOcrTransform,
    isActive: false,
  },
  render: (args) => {
    const layers = args.layers;
    setupStore(layers, []);
    return <InteractiveLayerOverlay {...args} />;
  },
};

// Manual layer (userCreated = true, blue border)
export const ManualLayer: Story = {
  args: {
    pageNum: 1,
    layers: [makeMockLayer('manual-layer-123', 'Manual text box', 150, 250, 180, 40)],
    groups: [
      {
        id: 'group-manual-balloon-123',
        label: 'Balloon 1',
        layerIds: ['manual-layer-123'],
        mergedBBox: { x0: 150, y0: 250, x1: 330, y1: 290 },
        collapsed: false,
        locked: false,
        visible: true,
        groupType: 'balloon' as const,
        confidence: 100,
        userCreated: true,
        color: '#3B82F6',
      },
    ],
    ocrTransform: defaultOcrTransform,
    isActive: true,
  },
  render: (args) => {
    const manualLayer: TextLayer = { ...args.layers[0] };
    manualLayer.userEdited = true;
    manualLayer.fontSize = 16;

    useLayerStore.setState({
      layersByPage: new Map([[1, [manualLayer]]]),
      groupsByPage: new Map([[1, args.groups]]),
      selectedLayerIds: new Set(),
      editingLayerId: null,
      hoveredLayerId: null,
      hoveredGroupId: null,
      undoStackByPage: new Map(),
      deletedLineIndexesByPage: new Map(),
    });
    return <InteractiveLayerOverlay {...args} layers={[manualLayer]} />;
  },
};

// Undo available state (stack has entries)
export const UndoAvailable: Story = {
  args: {
    pageNum: 1,
    layers: [makeMockLayer('layer-1', 'After edit', 100, 150)],
    groups: mockGroups,
    ocrTransform: defaultOcrTransform,
    isActive: true,
  },
  render: (args) => {
    const layers = args.layers;
    // Push a snapshot to simulate undo state
    const initialLayer = makeMockLayer('layer-1', 'Before edit', 100, 150);
    useLayerStore.setState({
      layersByPage: new Map([[1, layers]]),
      groupsByPage: new Map([[1, mockGroups]]),
      selectedLayerIds: new Set(['layer-1']),
      editingLayerId: null,
      hoveredLayerId: null,
      hoveredGroupId: null,
      undoStackByPage: new Map([[1, [[initialLayer]]]]),
      deletedLineIndexesByPage: new Map(),
    });
    return <InteractiveLayerOverlay {...args} />;
  },
};