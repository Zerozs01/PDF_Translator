import { create } from 'zustand';
import { ToolType } from '../types';

interface UIState {
  // Sidebar
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (isOpen: boolean) => void;

  // Canvas State
  zoom: number;
  pan: { x: number; y: number };
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  resetView: () => void;

  // Tools
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;
}

export const useUIStore = create<UIState>((set) => ({
  // Sidebar
  isSidebarOpen: true,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (isOpen) => set({ isSidebarOpen: isOpen }),

  // Canvas
  zoom: 1,
  pan: { x: 0, y: 0 },
  setZoom: (zoom) => set({ zoom }),
  setPan: (x, y) => set({ pan: { x, y } }),
  resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 } }),

  // Tools
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool }),
}));
