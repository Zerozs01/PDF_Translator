import { useCallback } from 'react';
import type { OCREngine, OCRPageResult } from '../../types';
import type { TranslationMode } from '../../stores/useProjectStore';
import { useOCRTextLayerStore, hasCurrentOCRTranslationCacheVersion } from '../../stores/useOCRTextLayerStore';
import { useLayerStore } from '../../stores/useLayerStore';
import { dbService } from '../../services/dbService';
import { buildOCRSourceFingerprint } from '../../services/ocrSourceFingerprint';
import { buildLayerGroupsFromOCR, mergeLayersAndGroups } from '../../services/layers/LayerGroupingService';
import { lookupShortPhraseTh } from '../../services/translation/offlineTranslationService';
import { applyKoreanConversationalFallback, hasKoreanTranslationCarryover, isBoilerplateHallucination } from '../../services/translation/koreanTranslationPolicy';
import { isKnownShortWordHelper } from '../../services/ocr/ocrSafetyLineDedup';
import { normalizeSpanishOcrNoiseForTranslation } from '../../services/ocr/ocrTextNormalizer';

export interface ResolveCacheOptions {
  bypassPageCache?: boolean;
  suppressStatus?: boolean;
}

export function useTranslationCacheResolver() {
  const checkAndApplyDBCache = useCallback(async (
    matchedDocId: number | null,
    pageNum: number,
    pageOCR: OCRPageResult,
    ocrEngine: OCREngine,
    normalizedTargetLanguage: string,
    resolvedSourceFromOCR: string,
    engine: 'offline' | 'ai' | 'm2m100',
    effectiveTranslationMode: TranslationMode,
    isActiveDoc: boolean,
    options?: ResolveCacheOptions
  ): Promise<boolean> => {
    if (!matchedDocId || options?.bypassPageCache) return false;

    try {
      const transCache = await dbService.getTranslationCachePage(matchedDocId, pageNum);
      if (!Array.isArray(transCache) || transCache.length === 0) return false;

      const matchedCache = transCache.find((row) => {
        const rowEngine = String(row.ocrEngine || '').toLowerCase();
        const targetRowEngine = String(ocrEngine).toLowerCase();
        const rowTargetLang = String(row.targetLanguage || '').toLowerCase();
        const targetRowTargetLang = String(normalizedTargetLanguage).toLowerCase();
        const rowSourceLang = String(row.sourceLanguage || '').toLowerCase();
        const targetRowSourceLang = String(resolvedSourceFromOCR).toLowerCase();
        const rowTranslatorEngine = String(row.translatorEngine || 'offline').toLowerCase();
        const targetTranslatorEngine = String(engine).toLowerCase();

        let hasThai = true;
        if (targetRowTargetLang === 'th') {
          const sample = [
            row.translatedText || '',
            ...((row.translatedByIndex as Array<{ text?: string }> || []).map((item) => String(item.text || ''))),
          ].join(' ');
          hasThai = /[\u0E00-\u0E7F]/.test(sample);
        }

        const isVersionMatch = row.key ? hasCurrentOCRTranslationCacheVersion(row.key) : false;
        const activeFingerprint = buildOCRSourceFingerprint(pageOCR, ocrEngine);
        const isFingerprintMatch = row.sourceFingerprint === activeFingerprint;

        return rowEngine === targetRowEngine
          && row.translationMode === effectiveTranslationMode
          && rowTargetLang === targetRowTargetLang
          && rowSourceLang === targetRowSourceLang
          && rowTranslatorEngine === targetTranslatorEngine
          && hasThai
          && isVersionMatch
          && isFingerprintMatch;
      });

      if (!matchedCache) return false;

      const isCacheIncomplete = Array.isArray(matchedCache.translatedByIndex) && (
        pageOCR.lines.some((line) => {
          const text = String(line.text || '').trim();
          if (!text) return false;
          const hasTranslatableChars = /[\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF]/.test(text) || /[a-zA-Z]{2,}/.test(text) || isKnownShortWordHelper(text.replace(/[^A-Za-z0-9]/g, ''));
          if (!hasTranslatableChars) return false;

          const item = (matchedCache.translatedByIndex as any[]).find((c: any) => {
            const itemSrc = String(c.sourceText || c.rawText || '').replace(/\s+/g, ' ').trim().toLowerCase();
            return itemSrc === text.toLowerCase();
          });

          if (!item || !item.text) return true;

          if (normalizedTargetLanguage === 'th') {
            const transText = String(item.text).trim();
            if (!/[\u0E00-\u0E7F]/.test(transText)) return true;
            if (hasKoreanTranslationCarryover(transText) || isBoilerplateHallucination(text, transText)) return true;
          }
          return false;
        }) || (normalizedTargetLanguage === 'th' && (matchedCache.translatedByIndex as any[]).some((item: any) => {
          const src = String(item.sourceText || item.rawText || '').trim();
          const trans = String(item.text || '').trim();
          if (/[\uAC00-\uD7AF]/.test(src)) {
            if (hasKoreanTranslationCarryover(trans) || isBoilerplateHallucination(src, trans)) return true;
          }
          return false;
        }))
      );

      if (isCacheIncomplete) {
        console.log(`[Translation] DB cache for page ${pageNum} is incomplete (missing translation for dialogue lines). Re-translating...`);
        return false;
      }

      console.log(`[Translation] Cache hit for page ${pageNum} via database!`);
      let safeMatchedCache = matchedCache;
      let cacheWasUpgraded = false;

      if (normalizedTargetLanguage === 'th' && matchedCache && Array.isArray(matchedCache.translatedByIndex)) {
        safeMatchedCache = {
          ...matchedCache,
          translatedByIndex: matchedCache.translatedByIndex.map((item: any) => {
            if (item) {
              const source = String(item.sourceText || item.rawText || '').trim();
              const translated = String(item.text || '').trim();
              const cleanSource = source.toUpperCase().replace(/[^A-Z0-9]/g, '');
              const cleanTrans = translated.toUpperCase().replace(/[^A-Z0-9]/g, '');

              if (source && (/[\uAC00-\uD7AF]/.test(source) || hasKoreanTranslationCarryover(translated) || isBoilerplateHallucination(source, translated))) {
                const koFallback = applyKoreanConversationalFallback(source, translated);
                if (koFallback && koFallback !== translated) {
                  cacheWasUpgraded = true;
                  return { ...item, text: koFallback, sourceText: source };
                }
              }

              if (!translated || cleanSource === cleanTrans || (/[a-zA-Z]/.test(translated) && !/[\u0E00-\u0E7F]/.test(translated))) {
                const glossaryMatch = lookupShortPhraseTh(source) || lookupShortPhraseTh(cleanSource) || lookupShortPhraseTh(normalizeSpanishOcrNoiseForTranslation(source));
                if (glossaryMatch && glossaryMatch !== translated) {
                  cacheWasUpgraded = true;
                  return { ...item, text: glossaryMatch, sourceText: source };
                }
                const words = source.trim().split(/\s+/);
                if (words.length > 1) {
                  const translatedWords = words.map((w) => lookupShortPhraseTh(w) || lookupShortPhraseTh(w.replace(/[^A-Za-z0-9]/g, '')) || w);
                  if (translatedWords.some((tw) => /[\u0E00-\u0E7F]/.test(tw))) {
                    cacheWasUpgraded = true;
                    return { ...item, text: translatedWords.join(' '), sourceText: source };
                  }
                }
              }
            }
            return item;
          }),
        };
      }

      if (cacheWasUpgraded && matchedDocId) {
        dbService.saveTranslationCache(matchedDocId, pageNum, safeMatchedCache.key, safeMatchedCache).catch((err: unknown) => {
          console.warn('[Translation] Failed to persist upgraded cache to DB:', err);
        });
      }

      if (isActiveDoc) {
        const ocrState = useOCRTextLayerStore.getState();
        ocrState.setTranslationCacheEntry(pageNum, safeMatchedCache.key, safeMatchedCache);
        ocrState.setActiveTranslationCacheKey(pageNum, safeMatchedCache.key);
        ocrState.setTranslationPreviewMode('translated');

        try {
          const layerStore = useLayerStore.getState();
          const pageLayers = layerStore.getPageLayers(pageNum);

          const findBestCacheMatch = (sourceText: string, lineIndex: number, cacheItems: any[]) => {
            if (!Array.isArray(cacheItems)) return undefined;
            const cleanSource = String(sourceText || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (!cleanSource) return undefined;

            const exact = cacheItems.find((item) => {
              const itemSource = String(item.sourceText !== undefined ? item.sourceText : (item.rawText || '')).replace(/\s+/g, ' ').trim().toLowerCase();
              return itemSource === cleanSource;
            });
            if (exact) return exact;

            const partial = cacheItems.find((item) => {
              const itemSource = String(item.sourceText !== undefined ? item.sourceText : (item.rawText || '')).replace(/\s+/g, ' ').trim().toLowerCase();
              return itemSource.includes(cleanSource) || cleanSource.includes(itemSource);
            });
            if (partial) return partial;

            return cacheItems.find((item) => {
              const idxVal = item.index !== undefined ? item.index : item.lineIndex;
              return idxVal === lineIndex;
            });
          };

          const hasUserModifications = pageLayers.some((l) => l.userEdited || l.id.startsWith('manual-layer-'))
            || layerStore.getPageGroups(pageNum).some((g) => g.userCreated);

          const translatedMap = new Map<number, string>();
          if (Array.isArray(pageOCR?.lines)) {
            pageOCR.lines.forEach((line, idx) => {
              const matchedItem = findBestCacheMatch(line.text, idx, safeMatchedCache.translatedByIndex);
              let finalText = matchedItem?.text;
              const sourceClean = String(line.text || '').trim();
              if (normalizedTargetLanguage === 'th' && (!finalText || finalText === sourceClean || (/[a-zA-Z]/.test(finalText) && !/[\u0E00-\u0E7F]/.test(finalText)))) {
                const glossaryMatch = lookupShortPhraseTh(sourceClean) || lookupShortPhraseTh(sourceClean.replace(/[^A-Za-z0-9]/g, ''));
                if (glossaryMatch) {
                  finalText = glossaryMatch;
                }
              }
              if (!finalText) {
                finalText = sourceClean;
              }
              translatedMap.set(idx, finalText);
            });
          }

          const freshResult = buildLayerGroupsFromOCR(pageOCR, translatedMap);
          if (pageLayers.length > 0 && hasUserModifications) {
            const merged = mergeLayersAndGroups(freshResult, pageLayers, layerStore.getPageGroups(pageNum));
            layerStore.setPageLayers(pageNum, merged);
          } else {
            layerStore.setPageLayers(pageNum, freshResult);
          }
        } catch (err) {
          console.warn('[TranslationSync] Failed to sync cache to Layer Store:', err);
        }
      }

      return true;
    } catch (err) {
      console.warn(`[Translation] DB cache read warning for page ${pageNum}:`, err);
      return false;
    }
  }, []);

  return {
    checkAndApplyDBCache,
  };
}
