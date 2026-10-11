import { useCallback } from 'react';
import type { OCREngine, OCRPageResult } from '../../types';
import type { TranslationMode } from '../../stores/useProjectStore';
import { useOCRTextLayerStore, buildOCRTranslationCacheKey } from '../../stores/useOCRTextLayerStore';
import { useLayerStore } from '../../stores/useLayerStore';
import { dbService } from '../../services/dbService';
import { buildOCRSourceFingerprint } from '../../services/ocrSourceFingerprint';
import { buildLayerGroupsFromOCR, mergeLayersAndGroups } from '../../services/layers/LayerGroupingService';

export interface PersistTranslationParams {
  pageNum: number;
  pageOCR: OCRPageResult;
  ocrEngine: OCREngine;
  ocrLanguageKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  effectiveTranslationMode: TranslationMode;
  effectiveEngine: 'offline' | 'ai' | 'm2m100';
  translatedByIndex: Map<number, string>;
  groupCount: number;
  isActiveDoc: boolean;
  cacheDocId: number | null;
}

export function useTranslationCachePersister() {
  const persistTranslationResult = useCallback(async ({
    pageNum,
    pageOCR,
    ocrEngine,
    ocrLanguageKey,
    sourceLanguage,
    targetLanguage,
    effectiveTranslationMode,
    effectiveEngine,
    translatedByIndex,
    groupCount,
    isActiveDoc,
    cacheDocId,
  }: PersistTranslationParams): Promise<{ cacheKey: string }> => {
    const updatedLines = (pageOCR.lines || []).map((line, lineIndex) => {
      const translatedText = translatedByIndex.get(lineIndex);
      if (!translatedText) return line;
      return {
        ...line,
        text: translatedText,
      };
    });

    const cacheKey = buildOCRTranslationCacheKey({
      ocrEngine,
      ocrLanguage: ocrLanguageKey,
      sourceLanguage,
      targetLanguage,
      translationMode: effectiveTranslationMode,
      translatorEngine: effectiveEngine,
    });

    const translationEntry = {
      key: cacheKey,
      pageNum,
      ocrEngine,
      ocrLanguage: ocrLanguageKey,
      sourceLanguage,
      targetLanguage,
      translationMode: effectiveTranslationMode,
      translatorEngine: effectiveEngine,
      sourceFingerprint: buildOCRSourceFingerprint(pageOCR, ocrEngine),
      translatedByIndex: Array.from(translatedByIndex.entries()).map(([index, text]) => {
        const ocrLine = pageOCR.lines[index];
        return {
          index,
          text,
          bbox: ocrLine?.bbox,
          sourceText: ocrLine?.text,
        };
      }),
      translatedText: updatedLines.map((line) => line.text).join('\n').trim(),
      lineCount: translatedByIndex.size,
      groupCount,
      createdAt: Date.now(),
      width: pageOCR.width,
      height: pageOCR.height,
    };

    if (isActiveDoc) {
      const ocrState = useOCRTextLayerStore.getState();
      ocrState.setTranslationCacheEntry(pageNum, cacheKey, translationEntry);
      ocrState.setTranslationPreviewMode('translated');

      try {
        const layerStore = useLayerStore.getState();
        const pageLayers = layerStore.getPageLayers(pageNum);
        const existingGroups = layerStore.getPageGroups(pageNum);
        const hasUserModifications = pageLayers.some((l) => l.userEdited || l.id.startsWith('manual-layer-'))
          || existingGroups.some((g) => g.userCreated);

        const freshResult = buildLayerGroupsFromOCR(pageOCR, translatedByIndex);
        if (pageLayers.length > 0 && hasUserModifications) {
          const merged = mergeLayersAndGroups(freshResult, pageLayers, existingGroups);
          layerStore.setPageLayers(pageNum, merged);
        } else {
          layerStore.setPageLayers(pageNum, freshResult);
        }
      } catch (err) {
        console.warn('[TranslationSync] Failed to synchronize translation back to Layer Store:', err);
      }
    }

    if (cacheDocId) {
      await dbService.saveTranslationCache(cacheDocId, pageNum, cacheKey, translationEntry).catch((err: unknown) => {
        console.warn(`[Translation] Failed to persist translation cache for page ${pageNum} (docId=${cacheDocId}):`, err);
      });
    }

    return { cacheKey };
  }, []);

  return {
    persistTranslationResult,
  };
}
