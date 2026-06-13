import { create } from 'zustand';
import { ToolType } from '../types';

export interface GlobalLoadingState {
  active: boolean;
  message: string;
  progress?: number;
}

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
  /** Atomic update for both pan and zoom in a single Zustand set (avoids double re-render) */
  setView: (pan: { x: number; y: number }, zoom: number) => void;
  resetView: () => void;

  // Tools
  activeTool: ToolType;
  setActiveTool: (tool: ToolType) => void;

  // Global Loading State
  loadingState: GlobalLoadingState | null;
  setLoadingState: (state: GlobalLoadingState | null) => void;

  // Split View & Page Modes
  viewMode: 'overlay' | 'split';
  setViewMode: (mode: 'overlay' | 'split') => void;
  pageMode: 'single' | 'scroll';
  setPageMode: (mode: 'single' | 'scroll') => void;
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
  setView: (pan, zoom) => set({ pan, zoom }),
  resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 }, viewMode: 'overlay' }),

  // Tools
  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool }),

  // Global Loading State
  loadingState: null,
  setLoadingState: (loadingState) => set({ loadingState }),

  // Split View & Page Modes
  viewMode: 'overlay',
  setViewMode: (viewMode) => set({ viewMode }),
  pageMode: 'single',
  setPageMode: (pageMode) => set({ pageMode }),
}));

