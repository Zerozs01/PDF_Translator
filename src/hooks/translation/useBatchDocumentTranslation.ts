import { useCallback } from 'react';
import type { OCREngine } from '../../types';
import { useBackgroundQueueStore } from '../../stores/useBackgroundQueueStore';
import type { SafetySettings, TranslationMode } from '../../stores/useProjectStore';

export interface UseBatchDocumentTranslationOptions {
  fileName: string;
  filePath: string | null;
  fileType: string | null;
  totalPages: number;
  ensureDocumentId: () => Promise<number | null>;
  sourceLanguage: string;
  targetLanguage: string;
  translationMode: TranslationMode;
  safetySettings: SafetySettings;
  hasGeminiApiKey: boolean;
  ocrOptions: {
    language: string;
    engine?: string;
    dpi?: number;
    pageSegMode?: number;
    ocrQualityProfile?: string;
    useAngleCls?: boolean;
  };
  setTranslationStatus: (status: { kind: 'info' | 'success' | 'error'; message: string } | null) => void;
}

export function useBatchDocumentTranslation({
  fileName,
  filePath,
  fileType,
  totalPages,
  ensureDocumentId,
  sourceLanguage,
  targetLanguage,
  translationMode,
  ocrOptions,
  setTranslationStatus,
}: UseBatchDocumentTranslationOptions) {
  const handleOfflineTranslateAllPages = useCallback(async () => {
    if (fileType !== 'pdf') {
      setTranslationStatus({ kind: 'error', message: 'การแปลทุกหน้า (All Pages) รองรับเฉพาะไฟล์เอกสาร PDF เท่านั้น.' });
      return;
    }
    const docId = await ensureDocumentId();
    if (!docId || !filePath) {
      setTranslationStatus({ kind: 'error', message: 'กรุณาเซฟและยืนยันข้อมูลไฟล์ก่อนประมวลผล.' });
      return;
    }

    const hasRunningJob = useBackgroundQueueStore.getState().jobs.some((j) => j.status === 'processing');
    setTranslationStatus({
      kind: 'info',
      message: hasRunningJob
        ? 'กำลังแทรคิวและหยุดงานเดิมชั่วคราว... รอสักครู่'
        : 'เพิ่มงานเข้าคิว...',
    });

    useBackgroundQueueStore.getState().addJobAsForeground({
      documentId: docId,
      filename: fileName,
      filepath: filePath,
      engine: (ocrOptions.engine || 'paddleocr') as OCREngine,
      type: 'offline_all',
      totalPages: Math.max(1, totalPages),
      ocrLanguage: ocrOptions.language,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      translationMode: translationMode,
      ocrDpi: ocrOptions.dpi,
      ocrPageSegMode: ocrOptions.pageSegMode,
      ocrQualityProfile: ocrOptions.ocrQualityProfile as 'fast' | 'balanced' | 'best' | undefined,
      useAngleCls: ocrOptions.useAngleCls,
    });

    setTranslationStatus({
      kind: 'success',
      message: `เพิ่มงาน Offline All Pages เข้าสู่คิวประมวลผลพื้นหลังเรียบร้อยแล้ว!`,
    });
  }, [
    ensureDocumentId,
    fileName,
    filePath,
    fileType,
    ocrOptions.dpi,
    ocrOptions.engine,
    ocrOptions.language,
    ocrOptions.ocrQualityProfile,
    ocrOptions.pageSegMode,
    ocrOptions.useAngleCls,
    setTranslationStatus,
    sourceLanguage,
    targetLanguage,
    totalPages,
    translationMode,
  ]);

  const handleAiTranslateAllPages = useCallback(async () => {
    if (fileType !== 'pdf') {
      setTranslationStatus({ kind: 'error', message: 'การแปลทุกหน้า (All Pages) รองรับเฉพาะไฟล์เอกสาร PDF เท่านั้น.' });
      return;
    }
    const docId = await ensureDocumentId();
    if (!docId || !filePath) {
      setTranslationStatus({ kind: 'error', message: 'กรุณาเซฟและยืนยันข้อมูลไฟล์ก่อนประมวลผล.' });
      return;
    }

    const hasRunningJob = useBackgroundQueueStore.getState().jobs.some((j) => j.status === 'processing');
    setTranslationStatus({
      kind: 'info',
      message: hasRunningJob
        ? 'กำลังแทรคิวและหยุดงานเดิมชั่วคราว... รอสักครู่'
        : 'เพิ่มงานเข้าคิว...',
    });

    useBackgroundQueueStore.getState().addJobAsForeground({
      documentId: docId,
      filename: fileName,
      filepath: filePath,
      engine: (ocrOptions.engine || 'paddleocr') as OCREngine,
      type: 'ai_all',
      totalPages: Math.max(1, totalPages),
      ocrLanguage: ocrOptions.language,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      translationMode: translationMode,
      ocrDpi: ocrOptions.dpi,
      ocrPageSegMode: ocrOptions.pageSegMode,
      ocrQualityProfile: ocrOptions.ocrQualityProfile as 'fast' | 'balanced' | 'best' | undefined,
      useAngleCls: ocrOptions.useAngleCls,
    });

    setTranslationStatus({
      kind: 'success',
      message: `เพิ่มงาน AI All Pages เข้าสู่คิวประมวลผลพื้นหลังเรียบร้อยแล้ว!`,
    });
  }, [
    ensureDocumentId,
    fileName,
    filePath,
    fileType,
    ocrOptions.dpi,
    ocrOptions.engine,
    ocrOptions.language,
    ocrOptions.ocrQualityProfile,
    ocrOptions.pageSegMode,
    ocrOptions.useAngleCls,
    setTranslationStatus,
    sourceLanguage,
    targetLanguage,
    totalPages,
    translationMode,
  ]);

  return {
    handleOfflineTranslateAllPages,
    handleAiTranslateAllPages,
  };
}
