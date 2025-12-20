import { create } from 'zustand';
import { Region } from '../types';

interface SegmentationState {
  regions: Region[];
  isProcessing: boolean;
  setRegions: (regions: Region[]) => void;
  addRegion: (region: Region) => void;
  updateRegion: (id: string, updates: Partial<Region>) => void;
  removeRegion: (id: string) => void;
  setIsProcessing: (isProcessing: boolean) => void;
}

export const useSegmentationStore = create<SegmentationState>((set) => ({
  regions: [],
  isProcessing: false,
  setRegions: (regions) => set({ regions }),
  addRegion: (region) => set((state) => ({ regions: [...state.regions, region] })),
  updateRegion: (id, updates) => set((state) => ({
    regions: state.regions.map((r) => (r.id === id ? { ...r, ...updates } : r)),
  })),
  removeRegion: (id) => set((state) => ({
    regions: state.regions.filter((r) => r.id !== id),
  })),
  setIsProcessing: (isProcessing) => set({ isProcessing }),
}));
