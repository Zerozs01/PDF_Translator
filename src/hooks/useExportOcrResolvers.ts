import { useCallback } from "react";
import type { OCREngine, OCRPageResult, OCRLine, BBox } from "../types";
import {
  useOCRTextLayerStore,
  type OCRTranslationCacheEntry,
  hasCurrentOCRTranslationCacheVersion,
} from "../stores/useOCRTextLayerStore";
import {
  normalizeWhitespace,
  normalizeTranslationLanguage,
} from "../services/ocr/ocrTextNormalizer";
import { buildOCRSourceFingerprint } from "../services/ocrSourceFingerprint";

type UseExportOcrResolversOptions = {
  currentPage: number;
  fileType: string | null;
  totalPages: number;
  targetLanguage: string;
  translationMode: string;
  defaultEngine: OCREngine;
};

export function resolveModelScopedOriginalPageOCR(
  ocrState: ReturnType<typeof useOCRTextLayerStore.getState>,
  pageNum: number,
  selectedEngine: OCREngine
): OCRPageResult | undefined {
  const engineScoped = ocrState.ocrByPageEngine.get(pageNum)?.get(selectedEngine);
  if (engineScoped) return engineScoped;

  const pageScopedEntries = ocrState.ocrByPageEngine.get(pageNum);
  if (pageScopedEntries && pageScopedEntries.size > 0) {
    const fallbackEntry = Array.from(pageScopedEntries.entries())[0]?.[1];
    if (fallbackEntry) return fallbackEntry;
  }

  const fallback = ocrState.allPagesOCR.get(pageNum);
  return fallback || undefined;
}

export function hasModelScopedCachedOCR(
  ocrState: ReturnType<typeof useOCRTextLayerStore.getState>,
  pageNum: number,
  selectedEngine: OCREngine
): boolean {
  const engineScoped = ocrState.ocrByPageEngine.get(pageNum)?.get(selectedEngine);
  if (engineScoped) return true;

  const fallback = ocrState.allPagesOCR.get(pageNum);
  if (fallback && (fallback.ocrEngine || "paddleocr") === selectedEngine) {
    return true;
  }
  return false;
}

export function useExportOcrResolvers({
  currentPage,
  fileType,
  totalPages,
  targetLanguage,
  translationMode,
  defaultEngine,
}: UseExportOcrResolversOptions) {

  const getModelScopedCachedPageNumbers = useCallback(
    (engineOverride?: OCREngine): number[] => {
      const ocrState = useOCRTextLayerStore.getState();
      const selectedEngine = engineOverride || defaultEngine;
      const pages = new Set<number>();

      // ตรวจจาก ocrByPageEngine (primary store)
      ocrState.ocrByPageEngine.forEach((byEngine, pageNum) => {
        if (byEngine.has(selectedEngine)) {
          pages.add(pageNum);
        }
      });

      // fallback: ตรวจจาก allPagesOCR ด้วย
      ocrState.allPagesOCR.forEach((result, pageNum) => {
        if (!pages.has(pageNum)) {
          if (result && (result.ocrEngine || "paddleocr") === selectedEngine) {
            pages.add(pageNum);
          }
        }
      });

      return Array.from(pages).sort((a, b) => a - b);
    },
    [defaultEngine]
  );

  const resolveModelScopedPagesForExport = useCallback(
    (
      scope: "current" | "all",
      engineOverride?: OCREngine
    ): Array<{ pageNum: number; ocr: OCRPageResult }> => {
      const ocrState = useOCRTextLayerStore.getState();
      const selectedEngine = engineOverride || defaultEngine;
      const targetPages =
        scope === "current"
          ? [currentPage]
          : fileType === "pdf"
            ? Array.from(
                { length: Math.max(1, totalPages) },
                (_, index) => index + 1
              )
            : [1];

      return targetPages
        .map((pageNum) => {
          const ocr = resolveModelScopedOriginalPageOCR(
            ocrState,
            pageNum,
            selectedEngine
          );
          return ocr ? { pageNum, ocr } : null;
        })
        .filter(
          (item): item is { pageNum: number; ocr: OCRPageResult } =>
            Boolean(item)
        );
    },
    [
      currentPage,
      defaultEngine,
      fileType,
      resolveModelScopedOriginalPageOCR,
      totalPages,
    ]
  );

  const resolveTranslatedEntryForExport = useCallback(
    (
      pageNum: number,
      pageOCR: OCRPageResult,
      selectedEngine: OCREngine
    ): OCRTranslationCacheEntry | undefined => {
      if (!pageOCR.lines || pageOCR.lines.length === 0) {
        const normalizedTargetLanguage = normalizeTranslationLanguage(
          targetLanguage,
          "th"
        );
        return {
          key: `mock-empty-${pageNum}-${selectedEngine}`,
          pageNum,
          ocrEngine: selectedEngine,
          ocrLanguage: pageOCR.language || "eng",
          sourceLanguage: "en",
          targetLanguage: normalizedTargetLanguage,
          translationMode: translationMode as any,
          translatorEngine: "google" as any,
          sourceFingerprint: buildOCRSourceFingerprint(pageOCR, selectedEngine),
          translatedByIndex: [],
          translatedText: "",
          lineCount: 0,
          groupCount: 0,
          createdAt: Date.now(),
          width: pageOCR.width,
          height: pageOCR.height,
        };
      }

      const ocrState = useOCRTextLayerStore.getState();
      const pageMap = ocrState.translationCacheByPage.get(pageNum);
      if (!pageMap || pageMap.size === 0) return undefined;

      const normalizedTargetLanguage = normalizeTranslationLanguage(
        targetLanguage,
        "th"
      );
      const sourceFingerprint = buildOCRSourceFingerprint(
        pageOCR,
        selectedEngine
      );
      const entries = Array.from(pageMap.values())
        .filter((entry) => {
          if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
          if (entry.ocrEngine !== selectedEngine) return false;
          return (
            normalizeTranslationLanguage(entry.targetLanguage, "th") ===
            normalizedTargetLanguage
          );
        })
        .sort((a, b) => b.createdAt - a.createdAt);
      if (entries.length === 0) return undefined;

      const exactFingerprintMatches = entries.filter(
        (entry) => entry.sourceFingerprint === sourceFingerprint
      );
      const fingerprintPool =
        exactFingerprintMatches.length > 0 ? exactFingerprintMatches : entries;

      const activeKey = ocrState.activeTranslationKeyByPage.get(pageNum);
      if (activeKey) {
        const active = pageMap.get(activeKey);
        if (active && fingerprintPool.some((entry) => entry.key === active.key)) {
          return active;
        }
      }

      const withContent = fingerprintPool.filter(
        (entry) =>
          entry.translatedByIndex.length > 0 ||
          Boolean(entry.translatedText?.trim())
      );
      return withContent[0] || fingerprintPool[0];
    },
    [targetLanguage, translationMode]
  );

  const resolveLineBBoxForExport = useCallback((line: OCRLine): BBox | undefined => {
    const rawBBox = line?.bbox;
    const rawValid =
      rawBBox &&
      Number(rawBBox.x1) > Number(rawBBox.x0) &&
      Number(rawBBox.y1) > Number(rawBBox.y0);
    if (rawValid) {
      return {
        x0: Number(rawBBox.x0),
        y0: Number(rawBBox.y0),
        x1: Number(rawBBox.x1),
        y1: Number(rawBBox.y1),
      };
    }

    const validWords = (Array.isArray(line?.words) ? line.words : [])
      .map((word) => word?.bbox)
      .filter((bbox): bbox is BBox =>
        Boolean(
          bbox &&
            Number(bbox.x1) > Number(bbox.x0) &&
            Number(bbox.y1) > Number(bbox.y0)
        )
      );

    if (validWords.length === 0) return undefined;

    return {
      x0: Math.min(...validWords.map((bbox) => Number(bbox.x0))),
      y0: Math.min(...validWords.map((bbox) => Number(bbox.y0))),
      x1: Math.max(...validWords.map((bbox) => Number(bbox.x1))),
      y1: Math.max(...validWords.map((bbox) => Number(bbox.y1))),
    };
  }, []);

  const buildTranslatedPageOCRForExport = useCallback(
    (
      pageOCR: OCRPageResult,
      translatedEntry: OCRTranslationCacheEntry
    ): OCRPageResult => {
      const translatedByIndex = new Map<number, string>(
        translatedEntry.translatedByIndex.map((item) => [
          item.index,
          normalizeWhitespace(String(item.text || "")),
        ])
      );

      const translatedLines = (pageOCR.lines || []).map((line, lineIndex) => {
        const translatedText =
          translatedByIndex.get(lineIndex) ||
          normalizeWhitespace(String(line.text || ""));
        const lineBBox = resolveLineBBoxForExport(line);
        const confidence = Number(line.confidence || pageOCR.confidence || 0);
        const translatedWords = lineBBox
          ? [
              {
                text: translatedText,
                confidence,
                bbox: lineBBox,
              },
            ]
          : [];

        return {
          ...line,
          text: translatedText,
          words: translatedWords,
          bbox: lineBBox || line.bbox,
        };
      });

      const translatedWords = translatedLines.flatMap((line) =>
        Array.isArray(line.words) ? line.words : []
      );
      const translatedText = translatedLines
        .map((line) => normalizeWhitespace(String(line.text || "")))
        .filter(Boolean)
        .join("\n")
        .trim();

      return {
        ...pageOCR,
        lines: translatedLines,
        words: translatedWords,
        text: translatedText,
        confidence: Number(pageOCR.confidence || 0),
      };
    },
    [resolveLineBBoxForExport]
  );

  const resolveVisibleOverlayExportSize = useCallback(
    (pageNum: number): { width: number; height: number } | undefined => {
      if (typeof document === "undefined") return undefined;

      const candidate =
        fileType === "pdf"
          ? document.querySelector(
              `.pdf-canvas-document .react-pdf__Page[data-page-number="${pageNum}"] canvas`
            )
          : document.querySelector('img[data-export-overlay-image="true"]');
      if (!(candidate instanceof HTMLElement)) return undefined;

      const rect = candidate.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (width <= 1 || height <= 1) return undefined;

      return { width, height };
    },
    [fileType]
  );

  return {
    resolveModelScopedOriginalPageOCR,
    hasModelScopedCachedOCR,
    getModelScopedCachedPageNumbers,
    resolveModelScopedPagesForExport,
    resolveTranslatedEntryForExport,
    resolveLineBBoxForExport,
    buildTranslatedPageOCRForExport,
    resolveVisibleOverlayExportSize,
  };
}
