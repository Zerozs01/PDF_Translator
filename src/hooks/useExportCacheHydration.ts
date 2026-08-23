import { useCallback, useEffect } from "react";
import type { OCREngine } from "../types";
import {
  hasCurrentOCRTranslationCacheVersion,
  type OCRTranslationCacheEntry,
  useOCRTextLayerStore,
} from "../stores/useOCRTextLayerStore";
import { dbService } from "../services/dbService";
import {
  OCR_ALGORITHM_VERSION,
  OCR_RAW_VERSION,
} from "../services/vision/ocrVersion";

type UseExportCacheHydrationOptions = {
  isDownloadMenuOpen: boolean;
  selectedExportEngine: OCREngine | null;
  defaultEngine: OCREngine;
  totalPages: number;
  fileType: string | null;
  documentId: number | null;
  ensureDocumentId: () => Promise<number | null | undefined>;
  setExportCacheHydrationTick: (updater: (tick: number) => number) => void;
};

export function useExportCacheHydration({
  isDownloadMenuOpen,
  selectedExportEngine,
  defaultEngine,
  totalPages,
  fileType,
  documentId,
  ensureDocumentId,
  setExportCacheHydrationTick,
}: UseExportCacheHydrationOptions) {
  const hydrateExportCachesForDownload = useCallback(
    async (engineOverride?: OCREngine): Promise<void> => {
      const docId = await ensureDocumentId().catch(() => null);
      if (!docId) return;

      const engine = engineOverride || defaultEngine;
      const pageNumbers =
        fileType === "pdf"
          ? Array.from(
              { length: Math.max(1, totalPages) },
              (_, index) => index + 1,
            )
          : [1];

      await Promise.all(
        pageNumbers.map(async (pageNum) => {
          try {
            const ocrState = useOCRTextLayerStore.getState();
            if (!ocrState.ocrByPageEngine.get(pageNum)?.has(engine)) {
              const cached = await dbService.getOCR(docId, pageNum, engine);
              if (
                cached &&
                cached.algorithmVersion === OCR_ALGORITHM_VERSION &&
                (cached.ocrRawVersion ?? 0) >= OCR_RAW_VERSION
              ) {
                cached.pageNumber = pageNum;
                ocrState.setPageOCRForEngine(pageNum, engine, cached);
              }
            }

            const translationMap = useOCRTextLayerStore
              .getState()
              .translationCacheByPage.get(pageNum);
            if (!translationMap || translationMap.size === 0) {
              const rows = await dbService.getTranslationCachePage(
                docId,
                pageNum,
              );
              for (const row of rows) {
                if (row.key && !hasCurrentOCRTranslationCacheVersion(row.key)) {
                  continue;
                }
                const normalizedEntry: OCRTranslationCacheEntry = {
                  ...row,
                  pageNum,
                  ocrEngine: (row.ocrEngine || "paddleocr") as OCREngine,
                  translationMode:
                    row.translationMode === "official"
                      ? "official"
                      : row.translationMode === "adaptive"
                        ? "adaptive"
                        : row.translationMode === "manhwa"
                          ? "manhwa"
                          : "manga",
                  translatorEngine:
                    row.translatorEngine === "ai" ? "ai" : "offline",
                  translatedByIndex: Array.isArray(row.translatedByIndex)
                    ? row.translatedByIndex
                    : [],
                };
                useOCRTextLayerStore
                  .getState()
                  .setTranslationCacheEntry(
                    pageNum,
                    normalizedEntry.key,
                    normalizedEntry,
                  );
              }
            }
          } catch (err) {
            console.warn(`[ExportHydrate] Failed for page ${pageNum}:`, err);
          }
        }),
      );
    },
    [defaultEngine, ensureDocumentId, fileType, totalPages],
  );

  useEffect(() => {
    if (!isDownloadMenuOpen) return undefined;
    let canceled = false;
    const engine = selectedExportEngine || defaultEngine;

    void (async () => {
      await hydrateExportCachesForDownload(engine);
      if (!canceled) {
        setExportCacheHydrationTick((tick) => tick + 1);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [
    defaultEngine,
    documentId,
    fileType,
    hydrateExportCachesForDownload,
    isDownloadMenuOpen,
    selectedExportEngine,
    setExportCacheHydrationTick,
    totalPages,
  ]);

  return { hydrateExportCachesForDownload };
}
