import { create } from 'zustand';

interface ExportState {
  isExporting: boolean;
  totalPages: number;
  completedPages: number;
  startTime: number | null;
  etaSeconds: number | null;
  
  startExport: (total: number) => void;
  updateProgress: (completed: number) => void;
  finishExport: () => void;
}

export const useExportStore = create<ExportState>((set, get) => ({
  isExporting: false,
  totalPages: 0,
  completedPages: 0,
  startTime: null,
  etaSeconds: null,

  startExport: (total) => set({ 
    isExporting: true, 
    totalPages: total, 
    completedPages: 0, 
    startTime: Date.now(),
    etaSeconds: null
  }),

  updateProgress: (completed) => {
    const { startTime, totalPages } = get();
    if (!startTime) return;
    if (completed <= 0) return; // ป้องกันการหารด้วยศูนย์ (Division by zero safety)

    const elapsedMs = Date.now() - startTime;
    const timePerPageMs = elapsedMs / completed;
    const remainingPages = Math.max(0, totalPages - completed);
    const remainingSeconds = Math.ceil((timePerPageMs * remainingPages) / 1000);

    set({ 
      completedPages: completed, 
      etaSeconds: remainingSeconds >= 0 ? remainingSeconds : 0 
    });
  },

  finishExport: () => set({ 
    isExporting: false, 
    startTime: null, 
    etaSeconds: null 
  }),
}));
