import React from 'react';
import { FileText } from 'lucide-react';
import type { SafetySettings } from '../../stores/useProjectStore';
import type { DBTag, DBProject } from '../../types/electron.d';
import { THEMED_LIBRARY_ACCENTS } from '../../constants/colorPalettes';

export type SidebarPage = 'home' | 'projects' | 'settings';

export const SAFETY_LEVEL_PREVIEW: Record<keyof SafetySettings, Record<'off' | 'low' | 'medium' | 'high', string>> = {
  harassment: {
    off: 'อนุญาตโทนกระทบกระทั่งตามบริบท เช่น "แกมันบ้าไปแล้ว"',
    low: 'ลดคำโจมตีตรงๆ แต่ยังคงอารมณ์เผ็ดได้',
    medium: 'ตัดการเหยียด/ด่ารุนแรง ให้ใช้โทนโต้เถียงสุภาพขึ้น',
    high: 'บังคับโทนปลอดภัยสูงสุด หลีกเลี่ยงการโจมตีตัวบุคคล',
  },
  hate: {
    off: 'คงเนื้อหาเข้มตามต้นฉบับ (ถ้ามี)',
    low: 'ลดคำล่อแหลมเชิงอคติ แต่ยังคงความหมายหลัก',
    medium: 'แทนถ้อยคำเกลียดชังด้วยคำกลางที่ปลอดภัย',
    high: 'บังคับกรองเข้มงวด หลีกเลี่ยงถ้อยคำแบ่งแยกทั้งหมด',
  },
  sexual: {
    off: 'โทนตรงไปตรงมา เหมาะงานผู้ใหญ่/manhwa',
    low: 'ลดความ explicit ลงเล็กน้อย',
    medium: 'ใช้คำกลางมากขึ้น ลดรายละเอียดทางเพศ',
    high: 'หลีกเลี่ยงถ้อยคำเชิงเพศชัดเจน',
  },
  dangerous: {
    off: 'เก็บโทนขู่/รุนแรงตามบทสนทนา',
    low: 'ลดคำชี้นำรุนแรงโดยตรง',
    medium: 'แทนคำอันตรายด้วยถ้อยคำทั่วไป',
    high: 'กรองเข้ม ปลอดภัยสูงสุดสำหรับงานทั่วไป',
  },
};

// Format file size
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

// Format date
export const formatDate = (dateValue: string | number): string => {
  const date = new Date(dateValue);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
};

export const decodeFileData = (data: Uint8Array | ArrayBuffer | string): Uint8Array => {
  if (typeof data === 'string') {
    const binaryString = atob(data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  return new Uint8Array();
};

export type FileOpenContext = 'recent' | 'browse' | 'drag_drop' | 'file_input';

export type FileOpenErrorEntry = {
  id: string;
  context: FileOpenContext;
  message: string;
  details?: string;
  filename?: string;
  filepath?: string;
  docId?: number;
  timestamp: number;
};

export const FILE_OPEN_LOG_KEY = 'pdf_translator.file_open_errors';

export const recordFileOpenError = (entry: FileOpenErrorEntry): void => {
  try {
    const existingRaw = window.localStorage.getItem(FILE_OPEN_LOG_KEY);
    const existing = existingRaw ? (JSON.parse(existingRaw) as FileOpenErrorEntry[]) : [];
    const next = [entry, ...existing].slice(0, 50);
    window.localStorage.setItem(FILE_OPEN_LOG_KEY, JSON.stringify(next));
  } catch {
    // ignore telemetry persistence errors
  }
  console.error('[FileOpenTelemetry]', entry);
};

export const getFileOpenHint = (message: string): string => {
  const lower = message.toLowerCase();
  if (lower.includes('file not found')) {
    return 'File not found. It may have been moved or deleted. Please re-import it.';
  }
  if (lower.includes('permission') || lower.includes('access') || lower.includes('denied')) {
    return 'Permission denied. Close the file in other apps or move it to a writable folder.';
  }
  if (lower.includes('unsupported') || lower.includes('mime')) {
    return 'Unsupported file type. Please choose a PDF, PNG, or JPEG.';
  }
  return 'Try re-importing the file or open it from a different location.';
};

// Get file icon based on type
export const getFileIcon = (fileType: string) => {
  if (fileType === 'pdf') {
    return <FileText className="text-slate-300" size={20} />;
  }
  return <FileText className="text-slate-400" size={20} />;
};

export const resolveThemedAccent = (index: number): string =>
  THEMED_LIBRARY_ACCENTS[Math.abs(index) % THEMED_LIBRARY_ACCENTS.length];

export const hexToRgba = (hex: string, alpha: number): string => {
  const normalized = hex.replace('#', '');
  const full = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized;
  const value = Number.parseInt(full, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const resolveStableAccent = (seed: number | string): string => {
  if (typeof seed === 'number') {
    return resolveThemedAccent(seed);
  }

  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return resolveThemedAccent(hash);
};

export type MenuActionDialogState = {
  isOpen: boolean;
  name: string;
  documentId: number | null;
  parentId?: number | null;
  color?: string;
};

export type MenuPosition = {
  x: number;
  y: number;
};

export type DeleteTagDialogState = {
  isOpen: boolean;
  tag: DBTag | null;
  confirmation: string;
};

export type DeleteProjectDialogState = {
  isOpen: boolean;
  project: DBProject | null;
  confirmation: string;
};

export const getFloatingMenuPosition = (
  x: number,
  y: number,
  width: number,
  height: number
): MenuPosition => {
  if (typeof window === 'undefined') {
    return { x, y };
  }

  const padding = 12;
  const clampedX = Math.min(
    Math.max(padding, x),
    Math.max(padding, window.innerWidth - width - padding)
  );
  const clampedY = Math.min(
    Math.max(padding, y),
    Math.max(padding, window.innerHeight - height - padding)
  );

  return { x: clampedX, y: clampedY };
};
