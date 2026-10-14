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
  status: 'pending' | 'queued' | 'processing' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'partial_success' | 'api_failed';
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
  ocrDpi?: number;
  ocrPageSegMode?: number | null;
  ocrQualityProfile?: 'fast' | 'balanced' | 'best';
  useAngleCls?: boolean;
  backend?: 'paddle' | 'ort_dml';
  startTime?: number;
  completedTime?: number;
}

interface BackgroundQueueState {
  jobs: BackgroundJob[];
  activeJobId: string | null;
  isPaused: boolean; // การควบคุมคิวภาพรวม (Pause/Resume Queue Processor)
  isPausedForForeground: boolean; // true เมื่อการประมวลผลหน้าหลัก (Foreground) กำลังทำงานอยู่

  // Actions
  addJob: (jobData: Omit<BackgroundJob, 'id' | 'createdAt' | 'status' | 'progress' | 'currentPage' | 'message' | 'priority'>) => string;
  // Foreground-priority add: แทรกขึ้นด้านบนสุดของคิว (หลัง running job) ลบ duplicate ที่ค้างอยู่ก่อน (Case 2)
  addJobAsForeground: (jobData: Omit<BackgroundJob, 'id' | 'createdAt' | 'status' | 'progress' | 'currentPage' | 'message' | 'priority'>) => string;
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
  
  // Queue reordering (used by Queue Monitor ^\/v buttons)
  moveJobUp: (id: string) => void;
  moveJobDown: (id: string) => void;

  // Foreground preemption: สั่งพักคิวเบื้องหลังชั่วคราวเมื่อหน้าหลักกำลังประมวลผล
  setForegroundProcessingActive: (active: boolean) => void;

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
        ? { ...job, status: 'queued' as const, message: 'รอประมวลผลต่อ...' } 
        : job
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ jobs: sanitizedJobs, isPaused }));
  } catch (err) {
    console.error('[QueueStore] Failed to persist background queue:', err);
  }
};

const readPersistedQueue = (): { jobs: BackgroundJob[]; isPaused: boolean } => {
  if (typeof window === 'undefined') return { jobs: [], isPaused: false };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.jobs)) {
        const jobs = parsed.jobs.map((job: BackgroundJob) =>
          job.status === 'processing'
            ? { ...job, status: 'queued' as const, message: 'รอดำเนินการต่อ...' }
            : job
        );
        return { jobs, isPaused: Boolean(parsed.isPaused) };
      }
    }
  } catch (err) {
    console.error('[QueueStore] Failed to read persisted background queue:', err);
  }
  return { jobs: [], isPaused: false };
};

const initialPersisted = readPersistedQueue();

export const useBackgroundQueueStore = create<BackgroundQueueState>((set, get) => ({
  jobs: initialPersisted.jobs,
  activeJobId: null,
  isPaused: initialPersisted.isPaused,
  isPausedForForeground: false,

  addJob: (jobData) => {
    const id = `${jobData.documentId}_${Date.now()}`;
    const newJob: BackgroundJob = {
      ...jobData,
      id,
      status: 'queued',
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
               ['pending', 'queued', 'processing', 'paused'].includes(j.status)
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

  addJobAsForeground: (jobData) => {
    const id = `${jobData.documentId}_fg_${Date.now()}`;
    const newJob: BackgroundJob = {
      ...jobData,
      id,
      status: 'queued',
      progress: 0,
      currentPage: 0,
      message: 'ลัดคิว (Foreground)...',
      priority: 50,
      createdAt: Date.now(),
    };

    set((state) => {
      // ลบ duplicate ที่ค้างอยู่ (queued/paused/pending) ก่อน เพื่อให้เพิ่มงานใหม่ได้เสมอ
      const filteredJobs = state.jobs.filter(
        (j) => !(
          j.documentId === jobData.documentId &&
          j.type === jobData.type &&
          j.engine === jobData.engine &&
          j.targetPage === jobData.targetPage &&
          ['pending', 'queued', 'paused'].includes(j.status) // ไม่ลบ processing
        )
      );

      // แทรกที่ position 0 เสมอ (ก่อน running job ทุกชนิด)
      // Subscriber จะ detect positional preemption: running job (index > 0) มีงาน queued อยู่ข้างหน้า
      // → Subscriber จะ set running job เป็น 'queued' (Pause) แล้ว abort อัตโนมัติ
      const nextJobs = [newJob, ...filteredJobs];

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
        job.id === id ? { ...job, status: 'queued' as const, message: 'รอดำเนินการต่อ...' } : job
      );
      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs };
    });
  },

  cancelJob: (id) => {
    set((state) => {
      const nextJobs = state.jobs.map((job) =>
        job.id === id ? { ...job, status: 'cancelled' as const, message: 'ยกเลิกแล้ว', progress: 0, completedTime: Date.now() } : job
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

        let startTime = job.startTime;
        let completedTime = job.completedTime;
        if (status === 'processing' && !startTime) {
          startTime = Date.now();
        }
        if (['completed', 'failed', 'cancelled'].includes(status)) {
          completedTime = Date.now();
        }

        return { ...job, status, message: msg, progress, startTime, completedTime };
      });
      
      // เมื่อ Active Job ปัจจุบันเสร็จสิ้นหรือยกเลิก/ล้มเหลว
      // หากไม่มีงาน pending/queued/processing ของ documentId นั้นเหลืออีก ให้คืนสถานะคืนงานที่เคย paused เพื่อหลีกทางกลับมารันต่อ
      const finishedJob = state.jobs.find(j => j.id === id);
      if (finishedJob && ['completed', 'failed', 'cancelled', 'partial_success', 'api_failed'].includes(status)) {
        const activeDocId = finishedJob.documentId;
        const hasMoreActiveDocJobs = nextJobs.some(
          j => j.documentId === activeDocId && ['pending', 'queued', 'processing'].includes(j.status)
        );
        
        if (!hasMoreActiveDocJobs) {
          nextJobs = nextJobs.map(job => 
            job.status === 'paused' && job.message.includes('หลีกทาง')
              ? { ...job, status: 'queued' as const, message: 'รอดำเนินการต่อ...' }
              : job
          );
        }
      }
      
      let nextActiveJobId = state.activeJobId;
      if (status === 'processing') {
        nextActiveJobId = id;
      } else if (state.activeJobId === id && ['completed', 'failed', 'cancelled', 'paused', 'partial_success', 'api_failed'].includes(status)) {
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
            return { ...job, priority: 0, status: 'queued' as const, message: 'รอดำเนินการต่อ...' };
          }
          return { ...job, priority: 0 };
        }
 
        // หากเป็นเอกสารที่กำลังเปิด (Boost Priority สูงสุด)
        if (job.documentId === documentId && ['pending', 'queued', 'paused'].includes(job.status)) {
          return { ...job, priority: 100, status: 'queued' as const, message: 'ลัดคิวประมวลผล...' };
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
    const { jobs, isPaused, isPausedForForeground } = get();
    // หากคิวภาพรวมถูก pause หรือ Foreground กำลังทำงานอยู่ ให้ไม่ดึงงานใหม่เลย
    if (isPaused || isPausedForForeground) return null;

    // ใช้ FIFO ตามลำดับใน array (ตำแหน่งในอาร์เรย์คือลำดับคิวที่ผู้ใช้เรียงไว้แล้ว)
    // สแกนหางานชิ้นแรกในอาร์เรย์ที่สถานะเป็น pending หรือ queued
    return jobs.find((job) => job.status === 'pending' || job.status === 'queued') ?? null;
  },

  moveJobUp: (id) => {
    set((state) => {
      const idx = state.jobs.findIndex((j) => j.id === id);
      if (idx <= 0) return { jobs: state.jobs }; // อยู่บนสุดแล้วหรือหาไม่เจอ
      const nextJobs = [...state.jobs];
      // สลับตำแหน่งกับงานด้านบน
      [nextJobs[idx - 1], nextJobs[idx]] = [nextJobs[idx], nextJobs[idx - 1]];
      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs };
    });
  },

  moveJobDown: (id) => {
    set((state) => {
      const idx = state.jobs.findIndex((j) => j.id === id);
      if (idx < 0 || idx >= state.jobs.length - 1) return { jobs: state.jobs }; // อยู่ล่างสุดแล้ว
      const nextJobs = [...state.jobs];
      // สลับตำแหน่งกับงานด้านล่าง
      [nextJobs[idx], nextJobs[idx + 1]] = [nextJobs[idx + 1], nextJobs[idx]];
      persistQueue(nextJobs, state.isPaused);
      return { jobs: nextJobs };
    });
  },

  setForegroundProcessingActive: (active) => {
    set((state) => {
      if (state.isPausedForForeground === active) return {}; // ไม่มีการเปลี่ยนแปลง

      let nextJobs = state.jobs;
      let nextActiveJobId = state.activeJobId;

      if (active && state.activeJobId) {
        // Foreground เริ่มทำงาน: พักงานเบื้องหลังที่กำลังรันอยู่ชั่วคราว
        nextJobs = state.jobs.map((job) =>
          job.id === state.activeJobId && job.status === 'processing'
            ? { ...job, status: 'queued' as const, message: 'พักชั่วคราว (รอหน้าหลักเสร็จ)...' }
            : job
        );
        nextActiveJobId = null;
      }

      persistQueue(nextJobs, state.isPaused);
      return { isPausedForForeground: active, jobs: nextJobs, activeJobId: nextActiveJobId };
    });
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
        (job) => !['completed', 'cancelled', 'failed', 'partial_success', 'api_failed'].includes(job.status)
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
              ? { ...job, status: 'queued' as const, message: 'รอดำเนินการต่อ...' } 
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
