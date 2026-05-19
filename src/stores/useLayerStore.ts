/**
 * useLayerStore — Zustand store สำหรับ Position Layers feature
 */

import { create } from 'zustand';
import type { TextLayer, TextLayerGroup, LayerGroupingResult } from '../types/layers';

interface LayerStoreState {
  // Layer data per page
  layersByPage: Map<number, TextLayer[]>;
  groupsByPage: Map<number, TextLayerGroup[]>;

  // Selection
  selectedLayerIds: Set<string>;
  hoveredLayerId: string | null;
  hoveredGroupId: string | null;

  // Actions
  setPageLayers: (pageNum: number, result: LayerGroupingResult) => void;
  getPageLayers: (pageNum: number) => TextLayer[];
  getPageGroups: (pageNum: number) => TextLayerGroup[];
  
  toggleLayerVisibility: (pageNum: number, layerId: string) => void;
  toggleGroupVisibility: (pageNum: number, groupId: string) => void;
  toggleGroupCollapsed: (pageNum: number, groupId: string) => void;
  toggleGroupLock: (pageNum: number, groupId: string) => void;

  selectLayer: (layerId: string | null) => void;
  setHoveredLayer: (layerId: string | null) => void;
  setHoveredGroup: (groupId: string | null) => void;

  clearLayers: () => void;
}

export const useLayerStore = create<LayerStoreState>((set, get) => ({
  layersByPage: new Map(),
  groupsByPage: new Map(),
  selectedLayerIds: new Set(),
  hoveredLayerId: null,
  hoveredGroupId: null,

  setPageLayers: (pageNum, result) => set((state) => {
    const nextLayers = new Map(state.layersByPage);
    const nextGroups = new Map(state.groupsByPage);
    nextLayers.set(pageNum, result.layers);
    nextGroups.set(pageNum, result.groups);
    return { layersByPage: nextLayers, groupsByPage: nextGroups };
  }),

  getPageLayers: (pageNum) => get().layersByPage.get(pageNum) || [],
  getPageGroups: (pageNum) => get().groupsByPage.get(pageNum) || [],

  toggleLayerVisibility: (pageNum, layerId) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    if (!layers) return {};
    const updated = layers.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l);
    const next = new Map(state.layersByPage);
    next.set(pageNum, updated);
    return { layersByPage: next };
  }),

  toggleGroupVisibility: (pageNum, groupId) => set((state) => {
    const groups = state.groupsByPage.get(pageNum);
    const layers = state.layersByPage.get(pageNum);
    if (!groups || !layers) return {};

    const group = groups.find(g => g.id === groupId);
    if (!group) return {};

    const newVisible = !group.visible;
    const updatedGroups = groups.map(g => g.id === groupId ? { ...g, visible: newVisible } : g);
    const layerIdSet = new Set(group.layerIds);
    const updatedLayers = layers.map(l => layerIdSet.has(l.id) ? { ...l, visible: newVisible } : l);

    const nextGroups = new Map(state.groupsByPage);
    const nextLayers = new Map(state.layersByPage);
    nextGroups.set(pageNum, updatedGroups);
    nextLayers.set(pageNum, updatedLayers);
    return { groupsByPage: nextGroups, layersByPage: nextLayers };
  }),

  toggleGroupCollapsed: (pageNum, groupId) => set((state) => {
    const groups = state.groupsByPage.get(pageNum);
    if (!groups) return {};
    const updated = groups.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g);
    const next = new Map(state.groupsByPage);
    next.set(pageNum, updated);
    return { groupsByPage: next };
  }),

  toggleGroupLock: (pageNum, groupId) => set((state) => {
    const groups = state.groupsByPage.get(pageNum);
    const layers = state.layersByPage.get(pageNum);
    if (!groups || !layers) return {};

    const group = groups.find(g => g.id === groupId);
    if (!group) return {};

    const newLocked = !group.locked;
    const updatedGroups = groups.map(g => g.id === groupId ? { ...g, locked: newLocked } : g);
    const layerIdSet = new Set(group.layerIds);
    const updatedLayers = layers.map(l => layerIdSet.has(l.id) ? { ...l, locked: newLocked } : l);

    const nextGroups = new Map(state.groupsByPage);
    const nextLayers = new Map(state.layersByPage);
    nextGroups.set(pageNum, updatedGroups);
    nextLayers.set(pageNum, updatedLayers);
    return { groupsByPage: nextGroups, layersByPage: nextLayers };
  }),

  selectLayer: (layerId) => set(() => ({
    selectedLayerIds: layerId ? new Set([layerId]) : new Set(),
  })),

  setHoveredLayer: (layerId) => set({ hoveredLayerId: layerId }),
  setHoveredGroup: (groupId) => set({ hoveredGroupId: groupId }),

  clearLayers: () => set({
    layersByPage: new Map(),
    groupsByPage: new Map(),
    selectedLayerIds: new Set(),
    hoveredLayerId: null,
    hoveredGroupId: null,
  }),
}));
