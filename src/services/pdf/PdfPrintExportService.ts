import {
  getOverlayFontOption,
  getOverlayPrimaryFontName,
  resolveOverlayFontFamily,
  type OverlayFontPreset,
} from '../../constants/overlayFonts';
import {
  resolveTranslationOverlayContext,
  type OverlayLayoutProfile,
} from '../../components/OCR/translationOverlayUtils';
import { buildCanvasFontFamily } from '../layout/canvasLayoutService';
import { buildLayerGroupsFromOCR } from '../layers/LayerGroupingService';
import type { OCRPageResult } from '../../types';
import type { TextLayer } from '../../types/layers';
import type { OCRTranslationCacheEntry } from '../../stores/useOCRTextLayerStore';
import type {
  PdfPrintExportFileType,
  PdfPrintExportJob,
  PdfPrintExportPageConfig,
  ExportOverlayPaletteEntry,
} from '../../types/pdfExport';
import { useExportStore } from '../../stores/useExportStore';
import { useLayerStore } from '../../stores/useLayerStore';
import { normalizeWhitespace } from '../ocr/ocrTextNormalizer';

type ExportTranslatedPdfInput = {
  fileType: PdfPrintExportFileType;
  sourceBytes?: ArrayBuffer;
  sourceFilePath?: string | null;
  sourceMimeType?: string;
  pageRange: number[];
  sourcePageMap: Map<number, OCRPageResult>;
  translatedEntryMap: Map<number, OCRTranslationCacheEntry>;
  translationMode: string;
  overlayFontPreset: OverlayFontPreset;
  overlayThaiFontEnabled: boolean;
  targetLanguage: string;
  overlayFontSizeScale: number;
  /** palette ที่ sample จากรูปต้นฉบับ — key = pageNum, value = array of palette per line */
  paletteByPage?: Map<number, ExportOverlayPaletteEntry[]>;
};

const resolveOverlayLayoutProfile = (translationMode: string): OverlayLayoutProfile => {
  if (translationMode === 'official') return 'official';
  if (translationMode === 'adaptive') return 'adaptive';
  if (translationMode === 'manhwa') return 'manhwa';
  return 'manga';
};

const buildPageConfig = async (
  pageNum: number,
  sourceOCR: OCRPageResult,
  translatedEntry: OCRTranslationCacheEntry,
  input: ExportTranslatedPdfInput,
  overlayFontFamily: string
): Promise<PdfPrintExportPageConfig> => {
  const layerStore = useLayerStore.getState();
  let pageLayers = layerStore.layersByPage.get(pageNum) || [];
  const deletedLineIndexes = Array.from(
    layerStore.deletedLineIndexesByPage.get(pageNum) || []
  );

  // ทำไมถึงเขียนแบบนี้: ถ้าหน้านี้ยังไม่มี layers (ไม่เคยเปิดดู)
  // ให้ build layers จาก OCR + translation cache ก่อน export
  // มิฉะนั้น layer จะเป็น undefined ทุก line → เข้าเงื่อนไข !layer
  // → shouldSkipOverlayRenderForSuspiciousLine และ shouldSkipOverlayForUntranslatedCarryOver
  // จะ filter lines สั้น/ไม่มีภาษาไทยออก ทำให้ dialog สั้นๆ หายไปจาก export
  if (pageLayers.length === 0) {
    try {
      const translatedMap = new Map<number, string>(
        translatedEntry.translatedByIndex
          .filter((item) => Number.isFinite(item.index) && String(item.text || '').trim().length > 0)
          .map((item) => [item.index, item.text])
      );
      const layerResult = buildLayerGroupsFromOCR(sourceOCR, translatedMap);
      pageLayers = layerResult.layers;
    } catch (err) {
      console.warn(`[ExportPageConfig] Failed to build layers for page ${pageNum}:`, err);
    }
  }

  const translationMap = new Map<string, OCRTranslationCacheEntry>();
  translationMap.set(translatedEntry.key, translatedEntry);

  const overlayContext = resolveTranslationOverlayContext({
    currentPageOCR: sourceOCR,
    optionsEngine: (sourceOCR.ocrEngine || 'paddleocr') as any,
    optionsLanguage: sourceOCR.language || 'eng',
    translationMode: resolveOverlayLayoutProfile(input.translationMode),
    sourceLanguage: 'en',
    targetLanguage: input.targetLanguage,
    translationPreviewMode: 'translated',
    currentPageTranslationMap: translationMap,
    activeTranslationKey: translatedEntry.key,
  });

  const translatedByIndex = Array.from(overlayContext.translatedByIndex.entries()).map(([index, text]) => ({
    index,
    text: normalizeWhitespace(String(text || '')),
  }));

  return {
    pageNum,
    sourceOCR,
    translatedByIndex,
    pageLayers: pageLayers as TextLayer[],
    deletedLineIndexes,
    overlayLayoutProfile: resolveOverlayLayoutProfile(input.translationMode) as OverlayLayoutProfile,
    overlayFontFamily,
    overlayFontSizeScale: input.overlayFontSizeScale,
    targetLanguage: input.targetLanguage,
    paletteByIndex: input.paletteByPage?.get(pageNum),
  };
};

export const exportTranslatedPdfViaPrint = async (
  input: ExportTranslatedPdfInput,
  signal?: AbortSignal
): Promise<Uint8Array> => {
  if (!window.electronAPI?.pdfExport) {
    throw new Error('PDF print export is only available in the Electron app.');
  }

  const preferredFont = getOverlayFontOption(input.overlayFontPreset).fontFamily;
  const overlayFontFamily = await buildCanvasFontFamily(
    resolveOverlayFontFamily({
      preset: input.overlayFontPreset,
      enabled: input.overlayThaiFontEnabled,
      targetLanguage: input.targetLanguage,
    }) || preferredFont || "'Noto Sans Thai', 'Sarabun', 'Segoe UI', sans-serif",
    `${JSON.stringify(getOverlayPrimaryFontName(input.overlayFontPreset))}, 'Sarabun', 'Noto Sans Thai', sans-serif`
  );

  const pages: PdfPrintExportPageConfig[] = [];
  for (const pageNum of input.pageRange) {
    const sourceOCR = input.sourcePageMap.get(pageNum);
    const translatedEntry = input.translatedEntryMap.get(pageNum);
    if (!sourceOCR || !translatedEntry) continue;
    pages.push(await buildPageConfig(pageNum, sourceOCR, translatedEntry, input, overlayFontFamily));
  }

  if (pages.length === 0) {
    throw new Error('No exportable translated pages found.');
  }

  const hasSourceFilePath = Boolean(input.sourceFilePath?.trim());
  if (!hasSourceFilePath && !input.sourceBytes) {
    throw new Error('PDF export requires a source file path or in-memory bytes.');
  }

  const jobId = crypto.randomUUID();
  const job: PdfPrintExportJob = {
    jobId,
    fileType: input.fileType,
    sourceMimeType: input.sourceMimeType,
    sourceFilePath: hasSourceFilePath ? input.sourceFilePath : null,
    sourceBytes: hasSourceFilePath ? null : new Uint8Array(input.sourceBytes!),
    pages,
  };

  useExportStore.getState().startExport(pages.length);
  const unsubscribe = window.electronAPI.pdfExport.onProgress(({ done }) => {
    useExportStore.getState().updateProgress(done);
  });

  const abortHandler = () => {
    void window.electronAPI.pdfExport.cancel(jobId);
  };
  signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    const result = await window.electronAPI.pdfExport.start(job);
    if (!result.ok || !result.bytes) {
      throw new Error(result.error || 'PDF print export failed.');
    }
    return result.bytes;
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    unsubscribe();
    useExportStore.getState().finishExport();
  }
};
