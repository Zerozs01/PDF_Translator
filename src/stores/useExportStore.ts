import { create } from 'zustand';

interface ExportState {
  isExporting: boolean;
  totalPages: number;
  completedPages: number;
  startTime: number | null;
  etaSeconds: number | null;
  title?: string;
  subtitle?: string;
  
  startExport: (total: number, title?: string, subtitle?: string) => void;
  updateProgress: (completed: number, subtitle?: string) => void;
  finishExport: () => void;
}

export const useExportStore = create<ExportState>((set, get) => ({
  isExporting: false,
  totalPages: 0,
  completedPages: 0,
  startTime: null,
  etaSeconds: null,
  title: undefined,
  subtitle: undefined,

  startExport: (total, title, subtitle) => set({ 
    isExporting: true, 
    totalPages: Math.max(1, total), 
    completedPages: 0, 
    startTime: Date.now(),
    etaSeconds: null,
    title: title || 'กำลังส่งออกไฟล์ PDF...',
    subtitle,
  }),

  updateProgress: (completed, subtitle) => {
    const { startTime, totalPages } = get();
    if (!startTime) return;
    if (completed <= 0) return; // ป้องกันการหารด้วยศูนย์ (Division by zero safety)

    const elapsedMs = Date.now() - startTime;
    const timePerPageMs = elapsedMs / completed;
    const remainingPages = Math.max(0, totalPages - completed);
    const remainingSeconds = Math.ceil((timePerPageMs * remainingPages) / 1000);

    set({ 
      completedPages: completed, 
      etaSeconds: remainingSeconds >= 0 ? remainingSeconds : 0,
      ...(subtitle !== undefined ? { subtitle } : {}),
    });
  },

  finishExport: () => set({ 
    isExporting: false, 
    startTime: null, 
    etaSeconds: null,
    title: undefined,
    subtitle: undefined,
  }),
}));
