import { create } from 'zustand';
import { OCREngine } from '../types';
import type { TranslationMode } from './useProjectStore';

export interface BackgroundJob {
  id: string;              // UUID หรือ unique key
  documentId: number;      // documentId ใน DB
  filename: string;        // ชื่อไฟล์ PDF
  filepath: string;        // filesystem path ของไฟล์
  engine: OCREngine;       // OCREngine
  type: 'ocr_all' | 'offline_all' | 'ai_all' | 'ocr_single' | 'offline_single' | 'ai_single';
  status: 'pending' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled';
  progress: number;        // ความคืบหน้า 0-100%
  currentPage: number;     // หน้าปัจจุบัน
  totalPages: number;      // หน้าทั้งหมด
  message: string;         // ข้อความแสดงสถานะ
  priority: number;        // ลำดับความสำคัญ ( Active File = 100, ทั่วไป = 0 )
  createdAt: number;       // timestamp ที่สร้างงาน
  targetPage?: number;      // หน้าที่เลือกประมวลผลสำหรับงานเดี่ยว
  ocrLanguage?: string;     // ภาษาต้นทาง OCR
  sourceLanguage?: string;  // ภาษาต้นทางสำหรับการแปล
  targetLanguage?: string;  // ภาษาปลายทางสำหรับการแปล
  translationMode?: TranslationMode; // โหมดแปลภาษา
}

interface BackgroundQueueState {
  jobs: BackgroundJob[];
  activeJobId: string | null;
  isPaused: boolean; // การควบคุมคิวภาพรวม (Pause/Resume Queue Processor)

  // Actions
  addJob: (jobData: Omit<BackgroundJob, 'id' | 'createdAt' | 'status' | 'progress' | 'currentPage' | 'message' | 'priority'>) => string;
  pauseJob: (id: string) => void;
  resumeJob: (id: string) => void;
  cancelJob: (id: string) => void;
  removeJob: (id: string) => void;
  updateJobProgress: (id: string, progress: number, currentPage: number, message: string, totalPages?: number) => void;
  updateJobStatus: (id: string, status: BackgroundJob['status'], message?: string) => void;
  boostPriorityForDocument: (documentId: number) => void;
  getNextPendingJob: () => BackgroundJob | null;
  setQueuePaused: (paused: boolean) => void;
  clearCompletedJobs: () => void;
  
  // Persistence helpers
  loadPersistedQueue: () => void;
}

const STORAGE_KEY = 'pdf_translator.background_queue';

const persistQueue = (jobs: BackgroundJob[], isPaused: boolean) => {
  if (typeof window === 'undefined') return;
  try {
    // ปรับสถานะงานที่เป็น processing ให้กลับมาเป็น pending ตอนเซฟ เพื่อไม่ให้ค้างตอนเปิดแอปใหม่
    const sanitizedJobs = jobs.map(job => 
      job.status === 'processing' 
        ? { ...job, status: 'pending' as const, message: 'รอประมวลผลต่อ...' } 
        : job
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobs: sanitizedJobs, isPaused }));
  } catch (err) {
    console.error('[QueueStore] Failed to persist background queue:', err);
  }
};

export const useBackgroundQueueStore = create<BackgroundQueueState>((set, get) => ({
  jobs: [],
  activeJobId: null,
  isPaused: false,

  addJob: (jobData) => {
    const id = `${jobData.documentId}_${Date.now()}`;
    const newJob: BackgroundJob = {
      ...jobData,
      id,
      status: 'pending',
      progress: 0,
      currentPage: 0,
      message: 'รอดำเนินการ...',
      priority: 0,
      createdAt: Date.now(),
    };

    set((state) => {
      // ตรวจสอบว่ามี Job เดียวกันที่ pending/processing อยู่แล้วหรือไม่เพื่อหลีกเลี่ยงการเพิ่มซ้ำ
      const duplicate = state.jobs.find(
        (j) => j.documentId === jobData.documentId && 
               j.type === jobData.type && 
               j.engine === jobData.engine &&
               j.targetPage === jobData.targetPage &&
               ['pending', 'processing', 'paused'].includes(j.status)
      );
      if (duplicate) {
        return { jobs: state.jobs }; // ไม่เพิ่มซ้ำ ส่งคืนคิวเดิม
      }

      const nextJobs = [...state.jobs, newJob];
      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs };
    });

    return id;
  },

  pauseJob: (id) => {
    set((state) => {
      const nextJobs = state.jobs.map((job) =>
        job.id === id ? { ...job, status: 'paused' as const, message: 'หยุดชั่วคราว' } : job
      );
      const nextActiveJobId = state.activeJobId === id ? null : state.activeJobId;
      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs, activeJobId: nextActiveJobId };
    });
  },

  resumeJob: (id) => {
    set((state) => {
      const nextJobs = state.jobs.map((job) =>
        job.id === id ? { ...job, status: 'pending' as const, message: 'รอดำเนินการต่อ...' } : job
      );
      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs };
    });
  },

  cancelJob: (id) => {
    set((state) => {
      const nextJobs = state.jobs.map((job) =>
        job.id === id ? { ...job, status: 'cancelled' as const, message: 'ยกเลิกแล้ว', progress: 0 } : job
      );
      const nextActiveJobId = state.activeJobId === id ? null : state.activeJobId;
      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs, activeJobId: nextActiveJobId };
    });
  },

  removeJob: (id) => {
    set((state) => {
      const nextJobs = state.jobs.filter((job) => job.id !== id);
      const nextActiveJobId = state.activeJobId === id ? null : state.activeJobId;
      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs, activeJobId: nextActiveJobId };
    });
  },

  updateJobProgress: (id, progress, currentPage, message, totalPages) => {
    set((state) => {
      const nextJobs = state.jobs.map((job) =>
        job.id === id 
          ? { 
              ...job, 
              progress, 
              currentPage, 
              message, 
              totalPages: typeof totalPages === 'number' ? totalPages : job.totalPages 
            } 
          : job
      );
      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs };
    });
  },

  updateJobStatus: (id, status, message) => {
    set((state) => {
      let nextJobs = state.jobs.map((job) => {
        if (job.id !== id) return job;
        const msg = message !== undefined ? message : (
          status === 'completed' ? 'เสร็จสมบูรณ์!' :
          status === 'failed' ? 'การประมวลผลล้มเหลว' :
          status === 'processing' ? 'กำลังประมวลผล...' : job.message
        );
        const progress = status === 'completed' ? 100 : job.progress;
        return { ...job, status, message: msg, progress };
      });
      
      // เมื่อ Active Job ปัจจุบันเสร็จสิ้นหรือยกเลิก/ล้มเหลว
      // หากไม่มีงาน pending/processing ของ documentId นั้นเหลืออีก ให้คืนสถานะคืนงานที่เคย paused เพื่อหลีกทางกลับมารันต่อ
      const finishedJob = state.jobs.find(j => j.id === id);
      if (finishedJob && ['completed', 'failed', 'cancelled'].includes(status)) {
        const activeDocId = finishedJob.documentId;
        const hasMoreActiveDocJobs = nextJobs.some(
          j => j.documentId === activeDocId && ['pending', 'processing'].includes(j.status)
        );
        
        if (!hasMoreActiveDocJobs) {
          nextJobs = nextJobs.map(job => 
            job.status === 'paused' && job.message.includes('หลีกทาง')
              ? { ...job, status: 'pending' as const, message: 'รอดำเนินการต่อ...' }
              : job
          );
        }
      }
      
      let nextActiveJobId = state.activeJobId;
      if (status === 'processing') {
        nextActiveJobId = id;
      } else if (state.activeJobId === id && ['completed', 'failed', 'cancelled', 'paused'].includes(status)) {
        nextActiveJobId = null;
      }

      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs, activeJobId: nextActiveJobId };
    });
  },

  boostPriorityForDocument: (documentId) => {
    set((state) => {
      let activeJobToPause: string | null = null;
      
      const nextJobs = state.jobs.map((job) => {
        // กรณีไม่มีเอกสารโฟกัส (เช่น ปิดเอกสาร/กลับหน้า Home)
        if (!documentId) {
          if (job.status === 'paused' && job.message.includes('หลีกทาง')) {
            return { ...job, priority: 0, status: 'pending' as const, message: 'รอดำเนินการต่อ...' };
          }
          return { ...job, priority: 0 };
        }

        // หากเป็นเอกสารที่กำลังเปิด (Boost Priority สูงสุด)
        if (job.documentId === documentId && ['pending', 'paused'].includes(job.status)) {
          return { ...job, priority: 100, status: 'pending' as const, message: 'ลัดคิวประมวลผล...' };
        }
        
        // หากไม่ใช่งานของเอกสารนี้ แต่รันอยู่ ให้ pause เพื่อให้หลีกทาง
        if (job.documentId !== documentId && job.status === 'processing') {
          activeJobToPause = job.id;
          return { ...job, priority: 0, status: 'paused' as const, message: 'พักคิวชั่วคราวเพื่อหลีกทาง...' };
        }
        
        // ลด priority ของงานอื่นๆ
        if (job.documentId !== documentId) {
          return { ...job, priority: 0 };
        }
        
        return job;
      });

      const nextActiveJobId = activeJobToPause && state.activeJobId === activeJobToPause ? null : state.activeJobId;
      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs, activeJobId: nextActiveJobId };
    });
  },

  getNextPendingJob: () => {
    const { jobs, isPaused } = get();
    if (isPaused) return null;

    // หาเฉพาะงานที่มีสถานะ pending
    const pendingJobs = jobs.filter((job) => job.status === 'pending');
    if (pendingJobs.length === 0) return null;

    // เรียงลำดับงานตาม Priority (สูงไปต่ำ) จากนั้นเรียงตาม createdAt (เก่าไปใหม่)
    return pendingJobs.sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.createdAt - b.createdAt;
    })[0];
  },

  setQueuePaused: (paused) => {
    set((state) => {
      persistQueue(state.jobs, paused);
      return { isPaused: paused };
    });
  },

  clearCompletedJobs: () => {
    set((state) => {
      const nextJobs = state.jobs.filter(
        (job) => !['completed', 'cancelled', 'failed'].includes(job.status)
      );
      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs };
    });
  },

  loadPersistedQueue: () => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.jobs)) {
          // รีเซ็ตงานที่มีสถานะ 'processing' ให้กลับไปเป็น 'pending' เผื่อกรณีปิดแอปกระทันหัน
          const jobs = parsed.jobs.map((job: BackgroundJob) => 
            job.status === 'processing' 
              ? { ...job, status: 'pending' as const, message: 'รอดำเนินการต่อ...' } 
              : job
          );
          set({ jobs, isPaused: Boolean(parsed.isPaused) });
          console.log('[QueueStore] Loaded persisted background queue. Job count:', jobs.length);
        }
      }
    } catch (err) {
      console.error('[QueueStore] Failed to load persisted background queue:', err);
    }
  },
}));
