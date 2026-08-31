import type { OCREngine, OCRPageResult } from '../../types';
import type { TranslationMode } from '../../stores/useProjectStore';
import { useOCRTextLayerStore, buildOCRTranslationCacheKey } from '../../stores/useOCRTextLayerStore';
import { useLayerStore } from '../../stores/useLayerStore';
import { dbService } from '../dbService';
import { buildOCRSourceFingerprint } from '../ocrSourceFingerprint';
import { buildLayerGroupsFromOCR, mergeLayersAndGroups } from '../layers/LayerGroupingService';
import { preparePageTranslationPlan, redistributeTranslatedGroups, type PreparedPageTranslationPlan } from './pageTranslationPipeline';
import { translationCoordinator } from './translationCoordinator';
import { translateBatchOffline } from './offlineTranslationService';
import { offlineBatchBridgeWrapper } from './translationBridge';
import { restoreProtectedTokens } from './translationTokenProtection';
import { normalizeThaiTranslationText } from '../ocr/ocrTextNormalizer';

export interface OfflineBatchOptions {
  concurrency?: number;
  ocrLanguage?: string;
  sourceLanguage?: string;
  targetLanguage?: string;
  translationMode?: TranslationMode;
  signal?: AbortSignal;
  onProgress?: (progress: { pageNum: number; index: number; total: number; message: string }) => void;
  documentIdOverride?: number;
}

export interface OfflineBatchResult {
  translatedPages: number;
  skippedPages: number;
  failedPages: number;
  totalLines: number;
}

/**
 * High-throughput, concurrent sliding-window pipeline สำหรับ Offline All-Page translation
 */
export async function executeOfflineAllPagesPipeline(
  pageNumbers: number[],
  selectedEngine: OCREngine,
  options?: OfflineBatchOptions
): Promise<OfflineBatchResult> {
  const concurrency = Math.max(1, Math.min(3, options?.concurrency || 2));
  const total = pageNumbers.length;
  let translatedPages = 0;
  let skippedPages = 0;
  let failedPages = 0;
  let totalLines = 0;

  const ocrState = useOCRTextLayerStore.getState();
  const queue = [...pageNumbers];
  const activeTasks = new Set<Promise<void>>();

  const processSinglePage = async (pageNum: number, pageIndex: number): Promise<void> => {
    if (options?.signal?.aborted) {
      throw new Error('Batch translation aborted by signal');
    }

    options?.onProgress?.({
      pageNum,
      index: pageIndex + 1,
      total,
      message: `Offline Batch: กำลังเตรียมและแปลหน้าที่ ${pageNum} (${pageIndex + 1}/${total})...`,
    });

    const pageOCR = ocrState.ocrByPageEngine.get(pageNum)?.get(selectedEngine)
      || ocrState.allPagesOCR.get(pageNum);

    if (!pageOCR || !pageOCR.lines || pageOCR.lines.length === 0) {
      skippedPages += 1;
      return;
    }

    const alternativePages = Array.from(ocrState.ocrByPageEngine.get(pageNum)?.entries() || [])
      .filter(([engineKey, candidate]) => engineKey !== selectedEngine && candidate && Array.isArray(candidate.lines) && candidate.lines.length > 0)
      .map(([, candidate]) => candidate!);

    const currentLayers = useLayerStore.getState().getPageLayers(pageNum);

    const plan = preparePageTranslationPlan(pageNum, pageOCR, selectedEngine, {
      layerOverrides: currentLayers,
      alternativeEnginePages: alternativePages,
      ocrLanguageOverride: options?.ocrLanguage,
      userSourceLanguage: options?.sourceLanguage,
      targetLanguage: options?.targetLanguage,
      translationMode: options?.translationMode,
      engine: 'offline',
    });

    if (!plan || plan.preparedGroups.length === 0) {
      skippedPages += 1;
      return;
    }

    const translatableItems = plan.preparedGroups.map((group, groupIndex) => ({
      id: String(groupIndex),
      text: group.protectedText || group.sourceText || '',
      groupType: 'ungrouped' as const,
      sourceLanguage: group.sourceLanguage,
    }));

    try {
      const translationResults = await translationCoordinator.runTranslation(
        'argos',
        translatableItems,
        {
          sourceLanguage: plan.translationSourceLanguage,
          targetLanguage: plan.targetLanguage,
          translationMode: options?.translationMode || 'manga',
          translateBatchOffline: (texts, type, mode, src, tgt, batchEngine) =>
            translateBatchOffline(texts, type, mode, src, tgt, offlineBatchBridgeWrapper, batchEngine),
        }
      );

      const translatedGroupsRaw = new Array<string>(plan.preparedGroups.length).fill('');
      translationResults.forEach((res) => {
        const idx = Number(res.id);
        if (!Number.isNaN(idx) && idx >= 0 && idx < translatedGroupsRaw.length) {
          translatedGroupsRaw[idx] = res.translatedText;
        }
      });

      const translatedGroups = translatedGroupsRaw.map((text, index) => {
        const restored = restoreProtectedTokens(text, plan.preparedGroups[index]?.replacements || []);
        if (plan.targetLanguage === 'th') {
          return normalizeThaiTranslationText(restored);
        }
        return restored;
      });

      const groupLineOverrides = new Map<number, string[]>();
      const translatedByIndex = redistributeTranslatedGroups(plan, translatedGroups, groupLineOverrides);

      const updatedLines = (plan.pageOCR.lines || []).map((line, lineIndex) => {
        const translatedText = translatedByIndex.get(lineIndex);
        if (!translatedText) return line;
        return {
          ...line,
          text: translatedText,
        };
      });

      const cacheKey = buildOCRTranslationCacheKey({
        ocrEngine: plan.ocrEngine,
        ocrLanguage: plan.ocrLanguageKey,
        sourceLanguage: plan.translationSourceLanguage,
        targetLanguage: plan.targetLanguage,
        translationMode: options?.translationMode || 'manga',
        translatorEngine: 'offline',
      });

      const translationEntry = {
        key: cacheKey,
        pageNum: plan.pageNum,
        ocrEngine: plan.ocrEngine,
        ocrLanguage: plan.ocrLanguageKey,
        sourceLanguage: plan.translationSourceLanguage,
        targetLanguage: plan.targetLanguage,
        translationMode: options?.translationMode || ('manga' as TranslationMode),
        translatorEngine: 'offline' as const,
        sourceFingerprint: buildOCRSourceFingerprint(plan.pageOCR, plan.ocrEngine),
        translatedByIndex: Array.from(translatedByIndex.entries()).map(([index, text]) => {
          const ocrLine = plan.pageOCR.lines[index];
          return {
            index,
            text,
            bbox: ocrLine?.bbox,
            sourceText: ocrLine?.text,
          };
        }),
        translatedText: updatedLines.map((line) => line.text).join('\n').trim(),
        lineCount: translatedByIndex.size,
        groupCount: plan.preparedGroups.length,
        createdAt: Date.now(),
        width: plan.pageOCR.width,
        height: plan.pageOCR.height,
      };

      ocrState.setTranslationCacheEntry(plan.pageNum, cacheKey, translationEntry);

      const docId = options?.documentIdOverride;
      if (docId) {
        await dbService.saveTranslationCache(docId, plan.pageNum, cacheKey, translationEntry).catch((err) => {
          console.warn(`[OfflineBatchPipeline] DB save warning for page ${plan.pageNum}:`, err);
        });
      }

      // Sync into active layer store
      try {
        const layerStore = useLayerStore.getState();
        const existingLayers = layerStore.getPageLayers(plan.pageNum);
        const existingGroups = layerStore.getPageGroups(plan.pageNum);
        const hasUserModifications = existingLayers.some((l) => l.userEdited || l.id.startsWith('manual-layer-'))
          || existingGroups.some((g) => g.userCreated);

        const freshResult = buildLayerGroupsFromOCR(plan.pageOCR, translatedByIndex);
        if (existingLayers.length > 0 && hasUserModifications) {
          const merged = mergeLayersAndGroups(freshResult, existingLayers, existingGroups);
          layerStore.setPageLayers(plan.pageNum, merged);
        } else {
          layerStore.setPageLayers(plan.pageNum, freshResult);
        }
      } catch (err) {
        console.warn(`[OfflineBatchPipeline] Layer sync warning for page ${plan.pageNum}:`, err);
      }

      translatedPages += 1;
      totalLines += translatedByIndex.size;
    } catch (err) {
      failedPages += 1;
      console.error(`[OfflineBatchPipeline] Failed on page ${pageNum}:`, err);
    }
  };

  let pageIndex = 0;
  while (queue.length > 0 || activeTasks.size > 0) {
    if (options?.signal?.aborted) {
      throw new Error('Offline batch translation cancelled by user.');
    }

    while (activeTasks.size < concurrency && queue.length > 0) {
      const pageNum = queue.shift()!;
      const currentIndex = pageIndex++;
      const task = processSinglePage(pageNum, currentIndex).finally(() => {
        activeTasks.delete(task);
      });
      activeTasks.add(task);
    }

    if (activeTasks.size > 0) {
      await Promise.race(activeTasks);
    }
  }

  return {
    translatedPages,
    skippedPages,
    failedPages,
    totalLines,
  };
}
