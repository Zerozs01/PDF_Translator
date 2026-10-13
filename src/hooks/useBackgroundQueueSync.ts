import React, { useEffect } from 'react';
import { useGlossaryStore } from '../stores/useGlossaryStore';
import { useBackgroundQueueStore } from '../stores/useBackgroundQueueStore';
import { backgroundQueueProcessor } from '../services/ocr/BackgroundQueueProcessor';
import type { OCREngine, OCROptions } from '../types';
import type { TranslationMode } from '../stores/useProjectStore';

export interface UseBackgroundQueueSyncParams {
  documentId: number | null;
  currentPage: number;
  file: File | null;
  filePath: string | null;
  isAiProcessingRaw: boolean;
  isOfflineProcessingRaw: boolean;
  ocrOptions: OCROptions;
  sourceLanguage: string;
  targetLanguage: string;
  translationMode: TranslationMode;
  runCurrentPageTranslation: (engine: 'offline' | 'ai', pageNum: number, options?: any) => Promise<boolean>;
}

export interface ExecuteTranslationPayload {
  docId: number;
  pageNum: number;
  ocrResult: any;
  engine: 'offline' | 'ai';
  signal?: AbortSignal;
  options?: {
    ocrLanguage?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    translationMode?: TranslationMode;
  };
}

export async function executePageTranslation(
  payload: ExecuteTranslationPayload,
  translationRunner: (engine: 'offline' | 'ai', pageNum: number, options?: any) => Promise<boolean>
): Promise<boolean> {
  const { docId, pageNum, ocrResult, engine, signal, options } = payload;
  return translationRunner(engine, pageNum, {
    suppressStatus: true,
    bypassPageCache: false,
    ocrLanguage: options?.ocrLanguage,
    sourceLanguage: options?.sourceLanguage,
    targetLanguage: options?.targetLanguage,
    translationMode: options?.translationMode,
    ocrResultOverride: ocrResult,
    documentIdOverride: docId,
    signal,
  });
}

export function useBackgroundQueueSync({
  documentId,
  currentPage,
  file,
  filePath,
  isAiProcessingRaw,
  isOfflineProcessingRaw,
  ocrOptions,
  sourceLanguage,
  targetLanguage,
  translationMode,
  runCurrentPageTranslation,
}: UseBackgroundQueueSyncParams) {
  const runCurrentPageTranslationRef = React.useRef(runCurrentPageTranslation);
  useEffect(() => {
    runCurrentPageTranslationRef.current = runCurrentPageTranslation;
  }, [runCurrentPageTranslation]);

  useEffect(() => {
    // Initialize user glossary sync with SQLite database
    useGlossaryStore.getState().initSync();

    backgroundQueueProcessor.registerHandlers({
      translatePage: async (docId, pageNum, ocrResult, engine, signal, options) => {
        try {
          return await executePageTranslation(
            { docId, pageNum, ocrResult, engine, signal, options },
            runCurrentPageTranslationRef.current
          );
        } catch (err) {
          console.error(`[AppQueueHandler] translatePage error on page ${pageNum}:`, err);
          throw err;
        }
      }
    });
  }, []);

  // ดักจับเมื่อผู้เปลี่ยนหน้าหรือไฟล์ ขณะที่การแปลหน้าเดี่ยวยังทำงาน inline ค้างอยู่
  // เพื่อนำไปประมวลผลต่อใน Background Queue
  const prevPageRef = React.useRef(currentPage);
  const prevDocIdRef = React.useRef(documentId);

  useEffect(() => {
    const pageChanged = prevPageRef.current !== currentPage;
    const docChanged = prevDocIdRef.current !== documentId;

    if ((pageChanged || docChanged) && (isOfflineProcessingRaw || isAiProcessingRaw)) {
      const prevPage = prevPageRef.current;
      const prevDocId = prevDocIdRef.current;
      const prevFile = file;
      const prevFilePath = filePath;

      if (prevDocId && prevFile && prevFilePath) {
        const engineType = isAiProcessingRaw ? 'ai_single' : 'offline_single';
        console.log(`[App] Switched page/file while translation was active. Delegating page ${prevPage} of doc ${prevDocId} to Background Queue.`);
        
        useBackgroundQueueStore.getState().addJob({
          documentId: prevDocId,
          filename: prevFile.name,
          filepath: prevFilePath,
          engine: (ocrOptions.engine || 'paddleocr') as OCREngine,
          type: engineType,
          totalPages: 1,
          targetPage: prevPage,
          ocrLanguage: ocrOptions.language,
          sourceLanguage,
          targetLanguage,
          translationMode,
          ocrDpi: ocrOptions.dpi,
          ocrPageSegMode: ocrOptions.pageSegMode,
          ocrQualityProfile: ocrOptions.ocrQualityProfile,
          useAngleCls: ocrOptions.useAngleCls,
        });
      }
    }

    prevPageRef.current = currentPage;
    prevDocIdRef.current = documentId;
  }, [
    currentPage,
    documentId,
    isOfflineProcessingRaw,
    isAiProcessingRaw,
    file,
    filePath,
    ocrOptions.engine,
    ocrOptions.language,
    sourceLanguage,
    targetLanguage,
    translationMode,
    ocrOptions.dpi,
    ocrOptions.pageSegMode,
    ocrOptions.ocrQualityProfile,
    ocrOptions.useAngleCls,
  ]);

  // Sync Foreground status to Queue Store
  useEffect(() => {
    const isForegroundActive = isOfflineProcessingRaw || isAiProcessingRaw;
    useBackgroundQueueStore.getState().setForegroundProcessingActive(isForegroundActive);
  }, [isOfflineProcessingRaw, isAiProcessingRaw]);
}
