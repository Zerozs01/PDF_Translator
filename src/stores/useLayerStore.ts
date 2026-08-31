/**
 * useLayerStore — Zustand store สำหรับ Position Layers feature
 * Phase 3: รองรับ Interactive Manipulation (Drag, Resize, Rotate, Inline Edit, Multi-Select)
 */

import { create } from 'zustand';
import type { BBox } from '../types';
import type { TextLayer, TextLayerGroup, LayerGroupingResult } from '../types/layers';
import { useOCRTextLayerStore } from './useOCRTextLayerStore';

interface LayerStoreState {
  // Layer data per page
  layersByPage: Map<number, TextLayer[]>;
  groupsByPage: Map<number, TextLayerGroup[]>;

  // Track deleted OCR line indexes เพื่อป้องกัน overlay rendering ค้างหลังลบ layer
  deletedLineIndexesByPage: Map<number, Set<number>>;

  // Selection — Set<string> รองรับ Multi-Selection
  selectedLayerIds: Set<string>;
  hoveredLayerId: string | null;
  hoveredGroupId: string | null;
  editingLayerId: string | null;
  activeDragItem: { type: 'layer' | 'group'; id: string; index: number } | null;

  // Undo stack — เก็บ snapshot ของ layers + groups + deletedLineIndexes ก่อนแต่ละ commit
  undoStackByPage: Map<number, Array<{ layers: TextLayer[]; groups: TextLayerGroup[]; deletedLineIndexes: Set<number> }>>;

  // Actions: Read
  getPageLayers: (pageNum: number) => TextLayer[];
  getPageGroups: (pageNum: number) => TextLayerGroup[];

  // Actions: Write (Batch)
  setPageLayers: (pageNum: number, result: LayerGroupingResult) => void;

  // Actions: Drag & Drop Sidebar
  setActiveDragItem: (item: { type: 'layer' | 'group'; id: string; index: number } | null) => void;

  // Actions: Visibility & Lock
  toggleLayerVisibility: (pageNum: number, layerId: string) => void;
  toggleGroupVisibility: (pageNum: number, groupId: string) => void;
  toggleGroupCollapsed: (pageNum: number, groupId: string) => void;
  toggleGroupLock: (pageNum: number, groupId: string) => void;
  expandGroup: (pageNum: number, groupId: string) => void;

  // Actions: Selection
  selectLayer: (layerId: string | null, addToSelection?: boolean) => void;
  clearSelection: () => void;
  setHoveredLayer: (layerId: string | null) => void;
  setHoveredGroup: (groupId: string | null) => void;
  setEditingLayerId: (layerId: string | null) => void;

  // Phase 3 Actions: Interactive Manipulation
  updateLayerBBox: (pageNum: number, layerId: string, newBBox: BBox) => void;
  updateLayerText: (pageNum: number, layerId: string, newText: string, isSource?: boolean) => void;
  batchUpdateLayerTexts: (pageNum: number, updates: Array<{ id: string; text: string }>, isAutoTranslation?: boolean) => void;
  updateLayerRotation: (pageNum: number, layerId: string, degrees: number) => void;
  updateLayerFontSize: (pageNum: number, layerId: string, size: number) => void;
  updateLayerBackgroundColor: (pageNum: number, layerId: string, color: string) => void;
  updateLayerTextColor: (pageNum: number, layerId: string, color: string) => void;
  updateLayerBold: (pageNum: number, layerId: string, bold: boolean) => void;
  updateMultiLayerBBoxDelta: (pageNum: number, layerIds: Set<string>, delta: { dx: number; dy: number }) => void;
  synchronizeGroupBBox: (pageNum: number, groupId: string) => void;
  deleteLayer: (pageNum: number, layerId: string) => void;
  deleteGroup: (pageNum: number, groupId: string) => void;
  deleteSelectedLayers: () => void;
  addManualLayer: (pageNum: number, bbox: BBox, text: string, lineIndex: number, options?: { backgroundColor?: string; textColor?: string }) => void;
  moveLayerToGroup: (pageNum: number, layerId: string, targetGroupId: string, targetIndex?: number) => void;
  reorderGroups: (pageNum: number, dragIndex: number, hoverIndex: number) => void;

  // Undo
  pushUndoSnapshot: (pageNum: number) => void;
  undoLastAction: (pageNum: number) => void;

  // Reset
  clearLayers: () => void;
}

// ────────────────────────────────────────────────────────────────
// Helper: คำนวณ Union BBox จาก BBox array
// ────────────────────────────────────────────────────────────────
const unionBBox = (bboxes: BBox[]): BBox => ({
  x0: Math.min(...bboxes.map(b => b.x0)),
  y0: Math.min(...bboxes.map(b => b.y0)),
  x1: Math.max(...bboxes.map(b => b.x1)),
  y1: Math.max(...bboxes.map(b => b.y1)),
});

const MAX_UNDO_DEPTH = 20;

export const useLayerStore = create<LayerStoreState>((set, get) => ({
  layersByPage: new Map(),
  groupsByPage: new Map(),
  deletedLineIndexesByPage: new Map(),
  selectedLayerIds: new Set(),
  hoveredLayerId: null,
  hoveredGroupId: null,
  editingLayerId: null,
  activeDragItem: null,
  undoStackByPage: new Map(),

  // ── Read ──────────────────────────────────────────────────────
  getPageLayers: (pageNum) => get().layersByPage.get(pageNum) || [],
  getPageGroups: (pageNum) => get().groupsByPage.get(pageNum) || [],

  // ── Batch Write ────────────────────────────────────────────────
  setPageLayers: (pageNum, result) => set((state) => {
    const nextLayers = new Map(state.layersByPage);
    const nextGroups = new Map(state.groupsByPage);
    nextLayers.set(pageNum, result.layers);
    nextGroups.set(pageNum, result.groups);
    return { layersByPage: nextLayers, groupsByPage: nextGroups };
  }),

  // ── Drag & Drop Sidebar ────────────────────────────────────────
  setActiveDragItem: (item) => set({ activeDragItem: item }),

  // ── Visibility / Lock ─────────────────────────────────────────
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

  expandGroup: (pageNum, groupId) => set((state) => {
    const groups = state.groupsByPage.get(pageNum);
    if (!groups) return {};
    const updated = groups.map(g => g.id === groupId ? { ...g, collapsed: false } : g);
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

  // ── Selection ─────────────────────────────────────────────────
  selectLayer: (layerId, addToSelection = false) => set((state) => {
    if (layerId === null) return { selectedLayerIds: new Set() };
    const nextSelected = addToSelection
      ? (() => {
          const next = new Set(state.selectedLayerIds);
          if (next.has(layerId)) {
            next.delete(layerId); // Toggle off
          } else {
            next.add(layerId);
          }
          return next;
        })()
      : new Set([layerId]);

    // Atomic group expansion: Auto-expand parent group instantly in the same state tick
    let nextGroups = state.groupsByPage;
    if (layerId && nextSelected.has(layerId)) {
      for (const [pageNum, groups] of state.groupsByPage.entries()) {
        const targetGroup = groups.find(g => g.collapsed && g.layerIds.includes(layerId));
        if (targetGroup) {
          const updated = groups.map(g => g.id === targetGroup.id ? { ...g, collapsed: false } : g);
          if (nextGroups === state.groupsByPage) {
            nextGroups = new Map(state.groupsByPage);
          }
          nextGroups.set(pageNum, updated);
          break;
        }
      }
    }

    return { 
      selectedLayerIds: nextSelected,
      groupsByPage: nextGroups,
    };
  }),

  clearSelection: () => set({ selectedLayerIds: new Set() }),
  setHoveredLayer: (layerId) => set({ hoveredLayerId: layerId }),
  setHoveredGroup: (groupId) => set({ hoveredGroupId: groupId }),
  setEditingLayerId: (layerId) => set({ editingLayerId: layerId }),

  // ── Phase 3: Interactive Manipulation ────────────────────────
  updateLayerBBox: (pageNum, layerId, newBBox) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    if (!layers) return {};
    const updated = layers.map(l => l.id === layerId
      ? { ...l, bbox: newBBox, userEdited: true }
      : l
    );
    const next = new Map(state.layersByPage);
    next.set(pageNum, updated);
    return { layersByPage: next };
  }),

  updateLayerText: (pageNum, layerId, newText, isSource = false) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    if (!layers) return {};
    const updated = layers.map(l => {
      if (l.id !== layerId) return l;
      if (isSource) {
        const syncText = l.text === l.sourceText || !l.text || l.text === l.translatedText;
        return {
          ...l,
          sourceText: newText,
          text: syncText ? newText : l.text,
          translatedText: undefined,
          userEdited: false, // Reset userEdited to allow re-translation since source changed!
        };
      } else {
        return {
          ...l,
          text: newText,
          userEdited: true, // Mark as user edited to protect from being auto-translated over!
        };
      }
    });
    const next = new Map(state.layersByPage);
    next.set(pageNum, updated);
    return { layersByPage: next };
  }),

  batchUpdateLayerTexts: (pageNum, updates, isAutoTranslation = false) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    if (!layers || updates.length === 0) return {};
    const updateMap = new Map(updates.map(u => [u.id, u.text]));
    const updated = layers.map(l => {
      if (!updateMap.has(l.id)) return l;
      const newText = updateMap.get(l.id)!;
      return {
        ...l,
        text: newText,
        userEdited: isAutoTranslation ? l.userEdited : true,
      };
    });
    const next = new Map(state.layersByPage);
    next.set(pageNum, updated);
    return { layersByPage: next };
  }),

  updateLayerRotation: (pageNum, layerId, degrees) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    if (!layers) return {};
    const updated = layers.map(l => l.id === layerId
      ? { ...l, rotation: degrees, userEdited: true }
      : l
    );
    const next = new Map(state.layersByPage);
    next.set(pageNum, updated);
    return { layersByPage: next };
  }),

  updateLayerFontSize: (pageNum, layerId, size) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    if (!layers) return {};
    const updated = layers.map(l => l.id === layerId
      ? { ...l, fontSize: size, userEdited: true }
      : l
    );
    const next = new Map(state.layersByPage);
    next.set(pageNum, updated);
    return { layersByPage: next };
  }),

  updateLayerBackgroundColor: (pageNum, layerId, color) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    if (!layers) return {};
    const updated = layers.map(l => l.id === layerId
      ? { ...l, backgroundColor: color, userEdited: true }
      : l
    );
    const next = new Map(state.layersByPage);
    next.set(pageNum, updated);
    return { layersByPage: next };
  }),

  updateLayerTextColor: (pageNum, layerId, color) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    if (!layers) return {};
    const updated = layers.map(l => l.id === layerId
      ? { ...l, textColor: color, userEdited: true }
      : l
    );
    const next = new Map(state.layersByPage);
    next.set(pageNum, updated);
    return { layersByPage: next };
  }),

  updateLayerBold: (pageNum, layerId, bold) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    if (!layers) return {};
    const updated = layers.map(l => l.id === layerId
      ? { ...l, bold, userEdited: true }
      : l
    );
    const next = new Map(state.layersByPage);
    next.set(pageNum, updated);
    return { layersByPage: next };
  }),

  // Move ทุก layer ที่อยู่ใน Set พร้อมกัน (Multi-Select Drag)
  updateMultiLayerBBoxDelta: (pageNum, layerIds, { dx, dy }) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    if (!layers) return {};
    const updated = layers.map(l => {
      if (!layerIds.has(l.id) || l.locked) return l;
      return {
        ...l,
        bbox: {
          x0: l.bbox.x0 + dx,
          y0: l.bbox.y0 + dy,
          x1: l.bbox.x1 + dx,
          y1: l.bbox.y1 + dy,
        },
        userEdited: true,
      };
    });
    const next = new Map(state.layersByPage);
    next.set(pageNum, updated);
    return { layersByPage: next };
  }),

  // คำนวณ Union BBox ของกลุ่มใหม่หลังลูกทีมโดนขยับ
  synchronizeGroupBBox: (pageNum, groupId) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    const groups = state.groupsByPage.get(pageNum);
    if (!layers || !groups) return {};
    const group = groups.find(g => g.id === groupId);
    if (!group) return {};
    const memberLayers = layers.filter(l => group.layerIds.includes(l.id));
    if (memberLayers.length === 0) return {};
    const newMergedBBox = unionBBox(memberLayers.map(l => l.bbox));
    const updatedGroups = groups.map(g => g.id === groupId ? { ...g, mergedBBox: newMergedBBox } : g);
    const next = new Map(state.groupsByPage);
    next.set(pageNum, updatedGroups);
    return { groupsByPage: next };
  }),

  deleteLayer: (pageNum, layerId) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    const groups = state.groupsByPage.get(pageNum);
    if (!layers) return {};

    // หา lineIndex ของ layer ที่กำลังจะลบ เพื่อ track ไว้ใน deletedLineIndexesByPage
    const layerToDelete = layers.find(l => l.id === layerId);
    const filteredLayers = layers.filter(l => l.id !== layerId);
    
    // Also remove from any groups
    const updatedGroups = groups ? groups.map(g => {
      if (g.layerIds.includes(layerId)) {
        const nextIds = g.layerIds.filter(id => id !== layerId);
        // Recalculate merged bbox for this group
        const memberLayers = filteredLayers.filter(l => nextIds.includes(l.id));
        const newBBox = memberLayers.length > 0 
          ? unionBBox(memberLayers.map(l => l.bbox))
          : { x0: 0, y0: 0, x1: 0, y1: 0 };
        return {
          ...g,
          layerIds: nextIds,
          mergedBBox: newBBox
        };
      }
      return g;
    }).filter(g => g.layerIds.length > 0) // Remove empty groups
    : [];

    const nextLayers = new Map(state.layersByPage);
    nextLayers.set(pageNum, filteredLayers);

    const nextGroups = new Map(state.groupsByPage);
    nextGroups.set(pageNum, updatedGroups);

    // Remove from selection
    const nextSelection = new Set(state.selectedLayerIds);
    nextSelection.delete(layerId);

    // Track deleted lineIndex เพื่อให้ PDFCanvas ซ่อน overlay ค้างของ line นี้
    const nextDeletedLineIndexes = new Map(state.deletedLineIndexesByPage);
    if (layerToDelete && layerToDelete.lineIndex >= 0) {
      const pageSet = new Set(nextDeletedLineIndexes.get(pageNum) || []);
      pageSet.add(layerToDelete.lineIndex);
      nextDeletedLineIndexes.set(pageNum, pageSet);
    }

    return {
      layersByPage: nextLayers,
      groupsByPage: nextGroups,
      selectedLayerIds: nextSelection,
      deletedLineIndexesByPage: nextDeletedLineIndexes,
    };
  }),

  deleteGroup: (pageNum, groupId) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    const groups = state.groupsByPage.get(pageNum);
    if (!groups || !layers) return {};

    const targetGroup = groups.find(g => g.id === groupId);
    if (!targetGroup) return {};

    const targetLayerIds = new Set(targetGroup.layerIds);

    // หา lineIndexes ของ layers ที่จะถูกลบ
    const deletedLayers = layers.filter(l => targetLayerIds.has(l.id));

    const filteredLayers = layers.filter(l => !targetLayerIds.has(l.id));
    const filteredGroups = groups.filter(g => g.id !== groupId);

    const nextLayers = new Map(state.layersByPage);
    nextLayers.set(pageNum, filteredLayers);

    const nextGroups = new Map(state.groupsByPage);
    nextGroups.set(pageNum, filteredGroups);

    // Remove deleted layers from selection
    const nextSelection = new Set(state.selectedLayerIds);
    targetLayerIds.forEach(id => nextSelection.delete(id));

    // Track deleted lineIndexes เพื่อให้ PDFCanvas ซ่อน overlay ค้าง
    const nextDeletedLineIndexes = new Map(state.deletedLineIndexesByPage);
    if (deletedLayers.length > 0) {
      const pageSet = new Set(nextDeletedLineIndexes.get(pageNum) || []);
      deletedLayers.forEach(l => {
        if (l.lineIndex >= 0) pageSet.add(l.lineIndex);
      });
      nextDeletedLineIndexes.set(pageNum, pageSet);
    }

    return {
      layersByPage: nextLayers,
      groupsByPage: nextGroups,
      selectedLayerIds: nextSelection,
      deletedLineIndexesByPage: nextDeletedLineIndexes,
    };
  }),

  deleteSelectedLayers: () => {
    const { selectedLayerIds, layersByPage, editingLayerId } = get();
    if (editingLayerId || selectedLayerIds.size === 0) return;

    // หาว่า selected layers อยู่ในหน้าไหนบ้าง
    const layersByTargetPage = new Map<number, string[]>();
    for (const [page, pageLayers] of layersByPage.entries()) {
      for (const layer of pageLayers) {
        if (selectedLayerIds.has(layer.id)) {
          const list = layersByTargetPage.get(page) || [];
          list.push(layer.id);
          layersByTargetPage.set(page, list);
        }
      }
    }

    if (layersByTargetPage.size === 0) {
      get().clearSelection();
      return;
    }

    for (const [page, layerIds] of layersByTargetPage.entries()) {
      get().pushUndoSnapshot(page);
      for (const id of layerIds) {
        get().deleteLayer(page, id);
      }
    }
    get().clearSelection();
  },

  addManualLayer: (pageNum, bbox, text, lineIndex, options) => set((state) => {
    const layers = [...(state.layersByPage.get(pageNum) || [])];
    const groups = [...(state.groupsByPage.get(pageNum) || [])];

    const layerId = `manual-layer-${Date.now()}`;
    const newLayer: TextLayer = {
      id: layerId,
      lineIndex: lineIndex,
      groupId: '', // will be set below
      text: text,
      sourceText: text,
      bbox: bbox,
      originalBBox: bbox,
      fontSize: 18, // default font size
      textColor: options?.textColor || '#000000',
      backgroundColor: options?.backgroundColor || '#FFFFFF',
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      zIndex: layers.length + 1,
      userEdited: true,
      confidence: 100,
      bold: false,
    };

    // Create a new individual Balloon Group for the manual layer to make it independent and modular
    const balloonGroupCount = groups.filter(g => g.groupType === 'balloon').length;
    const newGroupId = `group-manual-balloon-${Date.now()}`;
    const newGroup: TextLayerGroup = {
      id: newGroupId,
      label: `Balloon ${balloonGroupCount + 1}`,
      layerIds: [layerId],
      mergedBBox: bbox,
      collapsed: false,
      locked: false,
      visible: true,
      groupType: 'balloon',
      confidence: 100,
      userCreated: true,
      color: '#3B82F6', // Canva blue style
    };
    groups.push(newGroup);

    newLayer.groupId = newGroupId;
    layers.push(newLayer);

    const nextLayers = new Map(state.layersByPage);
    nextLayers.set(pageNum, layers);

    const nextGroups = new Map(state.groupsByPage);
    nextGroups.set(pageNum, groups);

    return {
      layersByPage: nextLayers,
      groupsByPage: nextGroups,
      selectedLayerIds: new Set([layerId]), // Auto-select the newly created layer!
      editingLayerId: layerId, // Auto-focus / Auto-edit the newly created layer!
    };
  }),

  moveLayerToGroup: (pageNum, layerId, targetGroupId, targetIndex) => set((state) => {
    const layers = state.layersByPage.get(pageNum);
    const groups = state.groupsByPage.get(pageNum);
    if (!layers || !groups) return {};

    // Find layer
    const layerIndex = layers.findIndex(l => l.id === layerId);
    if (layerIndex === -1) return {};
    const layer = layers[layerIndex];
    const sourceGroupId = layer.groupId;

    // Update layer's groupId in layers array
    const updatedLayers = layers.map(l => l.id === layerId ? { ...l, groupId: targetGroupId } : l);

    // Remove layerId from source group
    let updatedGroups = groups.map(g => {
      if (g.id === sourceGroupId) {
        const nextIds = g.layerIds.filter(id => id !== layerId);
        // Recalculate mergedBBox
        const memberLayers = updatedLayers.filter(l => nextIds.includes(l.id));
        const newBBox = memberLayers.length > 0
          ? unionBBox(memberLayers.map(l => l.bbox))
          : { x0: 0, y0: 0, x1: 0, y1: 0 };
        return {
          ...g,
          layerIds: nextIds,
          mergedBBox: newBBox
        };
      }
      return g;
    });

    // Remove empty groups (just like deleteLayer does)
    updatedGroups = updatedGroups.filter(g => g.layerIds.length > 0);

    // Add layerId to target group at targetIndex or append to end
    updatedGroups = updatedGroups.map(g => {
      if (g.id === targetGroupId) {
        // Ensure no duplicates
        const nextIds = g.layerIds.filter(id => id !== layerId);
        if (targetIndex !== undefined) {
          nextIds.splice(targetIndex, 0, layerId);
        } else {
          nextIds.push(layerId);
        }
        // Recalculate mergedBBox for target group
        const memberLayers = updatedLayers.filter(l => nextIds.includes(l.id));
        const newBBox = memberLayers.length > 0
          ? unionBBox(memberLayers.map(l => l.bbox))
          : { x0: 0, y0: 0, x1: 0, y1: 0 };
        return {
          ...g,
          layerIds: nextIds,
          mergedBBox: newBBox
        };
      }
      return g;
    });

    const nextLayers = new Map(state.layersByPage);
    nextLayers.set(pageNum, updatedLayers);

    const nextGroups = new Map(state.groupsByPage);
    nextGroups.set(pageNum, updatedGroups);

    return {
      layersByPage: nextLayers,
      groupsByPage: nextGroups
    };
  }),

  reorderGroups: (pageNum, dragIndex, hoverIndex) => set((state) => {
    const groups = state.groupsByPage.get(pageNum);
    if (!groups) return {};

    const updatedGroups = [...groups];
    if (dragIndex < 0 || dragIndex >= updatedGroups.length || hoverIndex < 0 || hoverIndex >= updatedGroups.length) {
      return {};
    }

    const [draggedGroup] = updatedGroups.splice(dragIndex, 1);
    updatedGroups.splice(hoverIndex, 0, draggedGroup);

    const nextGroups = new Map(state.groupsByPage);
    nextGroups.set(pageNum, updatedGroups);

    return {
      groupsByPage: nextGroups
    };
  }),

  // ── Undo ─────────────────────────────────────────────────────
  pushUndoSnapshot: (pageNum) => set((state) => {
    const currentLayers = state.layersByPage.get(pageNum);
    if (!currentLayers) return {};
    const currentGroups = state.groupsByPage.get(pageNum) || [];
    const currentDeletedIndexes = state.deletedLineIndexesByPage.get(pageNum) || new Set<number>();
    const undoStack = new Map(state.undoStackByPage);
    const stack = [...(undoStack.get(pageNum) || [])];
    // Deep clone snapshot — เก็บทั้ง layers, groups, และ deletedLineIndexes
    stack.push({
      layers: currentLayers.map(l => ({ ...l })),
      groups: currentGroups.map(g => ({ ...g, layerIds: [...g.layerIds] })),
      deletedLineIndexes: new Set(currentDeletedIndexes),
    });
    if (stack.length > MAX_UNDO_DEPTH) stack.shift();
    undoStack.set(pageNum, stack);
    return { undoStackByPage: undoStack };
  }),

  undoLastAction: (pageNum) => set((state) => {
    const undoStack = new Map(state.undoStackByPage);
    const stack = [...(undoStack.get(pageNum) || [])];
    if (stack.length === 0) return {};
    const snapshot = stack.pop()!;
    undoStack.set(pageNum, stack);
    const nextLayers = new Map(state.layersByPage);
    nextLayers.set(pageNum, snapshot.layers);
    const nextGroups = new Map(state.groupsByPage);
    nextGroups.set(pageNum, snapshot.groups);
    const nextDeletedIndexes = new Map(state.deletedLineIndexesByPage);
    nextDeletedIndexes.set(pageNum, snapshot.deletedLineIndexes);
    return {
      undoStackByPage: undoStack,
      layersByPage: nextLayers,
      groupsByPage: nextGroups,
      deletedLineIndexesByPage: nextDeletedIndexes,
    };
  }),

  // ── Reset ─────────────────────────────────────────────────────
  clearLayers: () => set({
    layersByPage: new Map(),
    groupsByPage: new Map(),
    deletedLineIndexesByPage: new Map(),
    selectedLayerIds: new Set(),
    hoveredLayerId: null,
    hoveredGroupId: null,
    undoStackByPage: new Map(),
  }),
}));
