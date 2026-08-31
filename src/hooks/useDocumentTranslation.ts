import React, { useCallback, useRef } from 'react';
import type { OCREngine, OCRPageResult } from '../types';
import {
  useOCRTextLayerStore,
  buildOCRTranslationCacheKey,
  hasCurrentOCRTranslationCacheVersion,
} from '../stores/useOCRTextLayerStore';
import { useLayerStore } from '../stores/useLayerStore';
import { useProjectStore, type SafetySettings, type TranslationMode } from '../stores/useProjectStore';
import { useBackgroundQueueStore } from '../stores/useBackgroundQueueStore';
import { dbService } from '../services/dbService';
import { translationCoordinator } from '../services/translation/translationCoordinator';
import type { TranslatableItem } from '../types/translation';
import { buildOCRSourceFingerprint } from '../services/ocrSourceFingerprint';
import {
  AUTO_OCR_REQUEST_EVENT,
  AUTO_OCR_RESULT_EVENT,
  type AutoOCRScope,
  type TranslatableLine,
  type TranslationGroupingProfile,
} from '../constants/translationConstants';
import {
  collectTranslatableLines,
} from '../services/translation/translatableLineCollector';
import {
  buildTranslationLinesWithCrossEngineFallback,
} from '../services/translation/translationLineResolver';
import {
  composeGroupSourceText,
  pushLayoutGroupingDebugPayload,
  resolveTranslationGroupsWithLayout,
} from '../services/translation/translationGrouping';
import {
  buildBatchMarkdownPayload,
  parseBatchJsonResponse,
  type BatchPageTranslationPlan,
  type BatchGroupPlan,
} from '../services/translation/translationBatchService';
import {
  translateBatchOffline,
  evaluateUntranslatedTranslation,
  evaluateThaiCarryoverForEnglish,
  shouldRetryLineTranslation,
  scoreTranslationCandidate,
  lookupShortPhraseTh,
} from '../services/translation/offlineTranslationService';
import {
  translateWithGemini,
  translateBatchGemini,
  offlineBatchBridgeWrapper,
} from '../services/translation/translationBridge';
import { buildGeminiBasePrompt } from '../services/translation/geminiPromptBuilder';
import {
  protectTranslationTokens,
  restoreProtectedTokens,
  shouldPreserveSourceLineForTranslation,
} from '../services/translation/translationTokenProtection';
import {
  normalizeSourceForTranslation,
  normalizeTranslationLanguage,
  normalizeThaiTranslationText,
  normalizeSpanishOcrNoiseForTranslation,
  normalizeEnglishOcrNoiseForTranslation,
  normalizeWhitespace,
} from '../services/ocr/ocrTextNormalizer';
import {
  splitTranslatedTextBySourceWeights,
  resolveRedistributedLineFallback,
} from '../services/translation/textRedistributionService';
import {
  getMergedTranslatableLines,
  mapSlotsToLines,
} from '../services/translation/dehyphenation';
import { finalizeTranslatedLine } from '../services/translation/technicalGlossary';
import { setSlangGroupContext } from '../services/translation/thaiConversationalGlossary';
import {
  buildLayerGroupsFromOCR,
  mergeLayersAndGroups,
} from '../services/layers/LayerGroupingService';
import { matchMangaGroupLineOverrides } from '../services/translation/mangaGroupOverrides';
import {
  applyKoreanConversationalFallback,
  hasKoreanTranslationCarryover,
  isBoilerplateHallucination,
} from '../services/translation/koreanTranslationPolicy';
import {
  resolveSourceLanguageFromOCR,
  inferSourceLanguageFromTextHints,
  resolveComicPageSourceLanguage,
  isLikelyLatinDominantTranslationPage,
  hasStrongLatinAnchorLines,
  isLikelyShortForeignSfxLine,
  resolvePreferredSourceLanguageForText,
  buildOfflineGroupRetrySourceText,
  buildTranslationComparisonKey,
  THAI_REGEX,
} from '../services/ocr/ocrTextHeuristics';
import { isKnownShortWordHelper } from '../services/ocr/ocrSafetyLineDedup';
import {
  shouldUseLineByLineGrouping,
  shouldUseDenseDialogueGrouping,
  shouldForceLineByLineForOfflinePanel,
  dedupeTranslatableLinesForTranslation,
  shouldPreferEnglishSourceForMixedTechnicalPage,
} from '../services/layout/dialogueGroupingService';
import {
  resolveModelScopedOriginalPageOCR,
  hasModelScopedCachedOCR,
} from './useExportOcrResolvers';
import { useBatchDocumentTranslation } from './translation/useBatchDocumentTranslation';

export interface UseDocumentTranslationOptions {
  file: File | null;
  fileName: string;
  filePath: string | null;
  documentId: number | null;
  fileType: string | null;
  currentPage: number;
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
  offlineEngine: 'argos' | 'm2m100';
  isAiProcessing: boolean;
  setIsAiProcessing: (v: boolean) => void;
  isOfflineProcessing: boolean;
  setIsOfflineProcessing: (v: boolean) => void;
  getModelScopedCachedPageNumbers: (engineOverride?: OCREngine) => number[];
}

export function useDocumentTranslation({
  file,
  fileName,
  filePath,
  documentId,
  fileType,
  currentPage,
  totalPages,
  ensureDocumentId,
  sourceLanguage,
  targetLanguage,
  translationMode,
  safetySettings,
  hasGeminiApiKey,
  ocrOptions,
  setTranslationStatus,
  offlineEngine,
  isAiProcessing,
  setIsAiProcessing,
  isOfflineProcessing,
  setIsOfflineProcessing,
  getModelScopedCachedPageNumbers,
}: UseDocumentTranslationOptions) {
  const setTranslationCacheEntry = useOCRTextLayerStore((s) => s.setTranslationCacheEntry);
  const setProgress = useOCRTextLayerStore((s) => s.setProgress);

  const requestAutoOCRFromPanel = useCallback((scope: AutoOCRScope): Promise<boolean> => {
    if (typeof window === 'undefined') return Promise.resolve(false);

    return new Promise((resolve) => {
      let settled = false;
      const timeoutMs = scope === 'all' ? 420_000 : 180_000;

      const cleanup = () => {
        window.removeEventListener(AUTO_OCR_RESULT_EVENT, handleResult as EventListener);
      };

      const resolveOnce = (value: boolean) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };

      const handleResult = (event: Event) => {
        const detail = (event as CustomEvent<{ scope?: AutoOCRScope; ok?: boolean; error?: string }>).detail;
        if (!detail || detail.scope !== scope) return;
        if (!detail.ok && detail.error) {
          setTranslationStatus({ kind: 'error', message: detail.error });
        }
        resolveOnce(Boolean(detail.ok));
      };

      window.addEventListener(AUTO_OCR_RESULT_EVENT, handleResult as EventListener);
      window.dispatchEvent(new CustomEvent(AUTO_OCR_REQUEST_EVENT, { detail: { scope } }));

      window.setTimeout(() => {
        resolveOnce(false);
      }, timeoutMs);
    });
  }, [setTranslationStatus]);

  const ensureCurrentPageOCRReadyForTranslation = useCallback(async (): Promise<boolean> => {
    const ocrState = useOCRTextLayerStore.getState();
    const selectedEngine = (ocrOptions.engine || 'paddleocr') as OCREngine;
    if (hasModelScopedCachedOCR(ocrState, currentPage, selectedEngine)) {
      return true;
    }

    setTranslationStatus({
      kind: 'info',
      message: `No OCR cache for ${selectedEngine} on page ${currentPage}. Auto-running OCR for this page...`,
    });

    const ok = await requestAutoOCRFromPanel('current');
    if (!ok) return false;

    const refreshed = useOCRTextLayerStore.getState();
    return hasModelScopedCachedOCR(refreshed, currentPage, selectedEngine);
  }, [currentPage, ocrOptions.engine, requestAutoOCRFromPanel, setTranslationStatus]);

  const ensureAllPagesOCRReadyForTranslation = useCallback(async (): Promise<boolean> => {
    if (fileType !== 'pdf') {
      return ensureCurrentPageOCRReadyForTranslation();
    }

    const cachedPages = getModelScopedCachedPageNumbers();
    const total = Math.max(1, totalPages);
    const hasAllPagesCached = cachedPages.length >= total;

    if (hasAllPagesCached) {
      return true;
    }

    setTranslationStatus({
      kind: 'info',
      message: `OCR cache is missing for some pages (found ${cachedPages.length}/${total}). Running Auto-OCR for all pages...`,
    });

    const ok = await requestAutoOCRFromPanel('all');
    if (!ok) {
      return ensureCurrentPageOCRReadyForTranslation();
    }

    const refreshedPages = getModelScopedCachedPageNumbers();
    return refreshedPages.length > 0;
  }, [ensureCurrentPageOCRReadyForTranslation, fileType, getModelScopedCachedPageNumbers, requestAutoOCRFromPanel, setTranslationStatus, totalPages]);

  const buildGeminiContextOverrides = useCallback((
    mode: TranslationMode,
    source: string,
    target: string
  ): { baseSystemPrompt?: string } => {
    const baseSystemPrompt = buildGeminiBasePrompt(mode, source, target, safetySettings);
    return { baseSystemPrompt };
  }, [safetySettings]);

  const runCurrentPageTranslation = useCallback(async (
    engine: 'offline' | 'ai' | 'm2m100',
    pageNum: number = currentPage,
    options?: {
      suppressStatus?: boolean;
      bypassPageCache?: boolean;
      ocrLanguage?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      translationMode?: TranslationMode;
      engineOverride?: OCREngine;
      ocrResultOverride?: OCRPageResult;
      documentIdOverride?: number;
    }
  ): Promise<boolean> => {
    const ocrState = useOCRTextLayerStore.getState();
    const selectedEngine = (options?.engineOverride || ocrOptions.engine || 'paddleocr') as OCREngine;
    const pageOCR = options?.ocrResultOverride ?? resolveModelScopedOriginalPageOCR(ocrState, pageNum, selectedEngine);
    if (!pageOCR) {
      if (!options?.suppressStatus) {
        setTranslationStatus({
          kind: 'error',
          message: `OCR cache for selected model (${selectedEngine}) is not loaded on page ${pageNum}. Run OCR with this model first.`,
        });
      }
      return false;
    }

    const pageEngine = (pageOCR.ocrEngine || selectedEngine) as OCREngine;
    const ocrEngine = pageEngine;
    const ocrLanguageKey = options?.ocrLanguage || pageOCR.language || ocrOptions.language || sourceLanguage || 'eng';
    const normalizedTargetLanguage = normalizeTranslationLanguage(options?.targetLanguage || targetLanguage, 'th');
    const normalizedUserSourceLanguage = normalizeTranslationLanguage(options?.sourceLanguage || sourceLanguage, 'en');
    const resolvedSourceFromOCR = resolveSourceLanguageFromOCR(ocrLanguageKey, normalizedUserSourceLanguage);
    const effectiveSourceLanguage = resolvedSourceFromOCR;
    const effectiveTranslationMode = options?.translationMode || translationMode;

    const activeDocId = useProjectStore.getState().documentId;
    const matchedDocId = options?.documentIdOverride ?? (await ensureDocumentId().catch(() => null));
    const isActiveDoc = matchedDocId !== null && activeDocId !== null && activeDocId === matchedDocId;

    if (isActiveDoc) {
      try {
        const layerStore = useLayerStore.getState();
        const existingLayers = layerStore.getPageLayers(pageNum);
        const existingGroups = layerStore.getPageGroups(pageNum);
        const hasUserModifications = existingLayers.some(l => l.userEdited || l.id.startsWith('manual-layer-'))
          || existingGroups.some(g => g.userCreated);
        
        const isStoreStale = existingLayers.length === 0 || 
          existingLayers.length !== pageOCR.lines.length ||
          existingLayers.some(l => l.lineIndex >= pageOCR.lines.length) ||
          (existingLayers.length > 0 && !hasUserModifications && existingLayers.some((l, idx) => l.sourceText !== String(pageOCR.lines[idx]?.text || '').replace(/\s+/g, ' ').trim()));

        if ((isStoreStale || !hasUserModifications) && !hasUserModifications) {
          const initialLayerResult = buildLayerGroupsFromOCR(pageOCR);
          layerStore.setPageLayers(pageNum, initialLayerResult);
          console.log(`[TranslationSync] Synchronously initialized/rebuilt store layers for page ${pageNum} before translation.`);
        }
      } catch (err) {
        console.warn('[TranslationSync] Failed to verify/rebuild stale store layers:', err);
      }
    }

    if (matchedDocId) {
      try {
        const transCache = await dbService.getTranslationCachePage(matchedDocId, pageNum);
        if (Array.isArray(transCache) && transCache.length > 0) {
          const matchedCache = transCache.find(row => {
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
                ...((row.translatedByIndex as Array<{ text?: string }> || []).map(item => String(item.text || '')))
              ].join(' ');
              hasThai = /[\u0E00-\u0E7F]/.test(sample);
            }
            
            const isVersionMatch = row.key ? hasCurrentOCRTranslationCacheVersion(row.key) : false;
            const activeFingerprint = buildOCRSourceFingerprint(pageOCR, ocrEngine);
            const isFingerprintMatch = row.sourceFingerprint === activeFingerprint;
            
            return rowEngine === targetRowEngine &&
                   row.translationMode === effectiveTranslationMode &&
                   rowTargetLang === targetRowTargetLang &&
                   rowSourceLang === targetRowSourceLang &&
                   rowTranslatorEngine === targetTranslatorEngine &&
                   hasThai &&
                   isVersionMatch &&
                   isFingerprintMatch;
          });

          if (matchedCache && !options?.bypassPageCache) {
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
                  if (!/[\u0E00-\u0E7F]/.test(transText)) {
                    return true;
                  }
                  if (hasKoreanTranslationCarryover(transText) || isBoilerplateHallucination(text, transText)) {
                    return true;
                  }
                }
                return false;
              }) ||
              (normalizedTargetLanguage === 'th' && (matchedCache.translatedByIndex as any[]).some((item: any) => {
                const src = String(item.sourceText || item.rawText || '').trim();
                const trans = String(item.text || '').trim();
                if (/[\uAC00-\uD7AF]/.test(src)) {
                  if (hasKoreanTranslationCarryover(trans) || isBoilerplateHallucination(src, trans)) {
                    return true;
                  }
                }
                return false;
              }))
            );

            if (isCacheIncomplete) {
              console.log(`[Translation] DB cache for page ${pageNum} is incomplete (missing translation for dialogue lines). Re-translating...`);
            } else {
              console.log(`[Translation] Cache hit for page ${pageNum} via database! Skipping translation coordinator.`);
              
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
                          const translatedWords = words.map(w => lookupShortPhraseTh(w) || lookupShortPhraseTh(w.replace(/[^A-Za-z0-9]/g, '')) || w);
                          if (translatedWords.some(tw => /[\u0E00-\u0E7F]/.test(tw))) {
                            cacheWasUpgraded = true;
                            return { ...item, text: translatedWords.join(' '), sourceText: source };
                          }
                        }
                      }
                    }
                    return item;
                  })
                };
              }

              if (cacheWasUpgraded && matchedDocId) {
                dbService.saveTranslationCache(matchedDocId, pageNum, safeMatchedCache.key, safeMatchedCache).catch((err: unknown) => {
                  console.warn('[Translation] Failed to persist upgraded cache to DB:', err);
                });
              }

              if (isActiveDoc) {
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
                    
                    const exact = cacheItems.find(item => {
                      const itemSource = String(item.sourceText !== undefined ? item.sourceText : (item.rawText || '')).replace(/\s+/g, ' ').trim().toLowerCase();
                      return itemSource === cleanSource;
                    });
                    if (exact) return exact;
                    
                    const partial = cacheItems.find(item => {
                      const itemSource = String(item.sourceText !== undefined ? item.sourceText : (item.rawText || '')).replace(/\s+/g, ' ').trim().toLowerCase();
                      return itemSource.includes(cleanSource) || cleanSource.includes(itemSource);
                    });
                    if (partial) return partial;
                    
                    return cacheItems.find(item => {
                      const idxVal = item.index !== undefined ? item.index : item.lineIndex;
                      return idxVal === lineIndex;
                    });
                  };

                  const hasUserModifications = pageLayers.some(l => l.userEdited || l.id.startsWith('manual-layer-'))
                    || layerStore.getPageGroups(pageNum).some(g => g.userCreated);

                  const translatedMap = new Map<number, string>();
                  if (Array.isArray(pageOCR?.lines)) {
                    pageOCR.lines.forEach((line, idx) => {
                      const matchedItem = findBestCacheMatch(line.text, idx, safeMatchedCache.translatedByIndex);
                      let finalText = matchedItem?.text;
                      const sourceClean = String(line.text || '').trim();
                      if (normalizedTargetLanguage === 'th' && (!finalText || finalText === sourceClean || (/[a-zA-Z]/.test(finalText) && !/[\u0E00-\u0E7F]/.test(finalText)))) {
                        const glossaryMatch = lookupShortPhraseTh(sourceClean)
                          || lookupShortPhraseTh(sourceClean.replace(/[^A-Za-z0-9]/g, ''));
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

              if (!options?.suppressStatus && isActiveDoc) {
                setTranslationStatus({
                  kind: 'success',
                  message: `${engine} | Cache Hit for Page ${pageNum} | Loaded from persistent translation cache.`,
                });
              }
              return true;
            }
          }
        }
      } catch (err) {
        console.warn(`[Translation] DB cache read warning for page ${pageNum}:`, err);
      }
    }

    const rawBaseLines = collectTranslatableLines(
      pageOCR.lines || [], 
      pageEngine as string,
      pageOCR.width,
      pageOCR.height
    );

    const currentLayers = useLayerStore.getState().layersByPage.get(pageNum) || [];
    
    const updatedTranslatableLines = rawBaseLines.map(line => {
      let matchingLayer = currentLayers.find(l => l.lineIndex === line.index);
      
      if (!matchingLayer) {
        matchingLayer = currentLayers.find(l => {
          const lBbox = l.bbox;
          const overlapX = Math.max(0, Math.min(lBbox.x1, line.right) - Math.max(lBbox.x0, line.left));
          const overlapY = Math.max(0, Math.min(lBbox.y1, line.bottom) - Math.max(lBbox.y0, line.top));
          const overlapArea = overlapX * overlapY;
          if (overlapArea > 0) {
            const lineArea = (line.right - line.left) * (line.bottom - line.top);
            const layerArea = (lBbox.x1 - lBbox.x0) * (lBbox.y1 - lBbox.y0);
            const minArea = Math.min(lineArea, layerArea);
            return (overlapArea / minArea) >= 0.7;
          }
          return false;
        });
      }

      if (matchingLayer && (matchingLayer.userEdited || matchingLayer.id.startsWith('manual-layer-'))) {
        const layerSource = matchingLayer.sourceText;
        if (layerSource && layerSource.trim()) {
          return {
            ...line,
            text: layerSource
          };
        }
      }
      return line;
    });

    const unmappedLayers = currentLayers.filter(l => {
      return !updatedTranslatableLines.some(line => line.index === l.lineIndex);
    });

    const additionalLines: TranslatableLine[] = unmappedLayers.map((l, idx) => {
      const bbox = l.bbox;
      const left = Number(bbox.x0);
      const right = Number(bbox.x1);
      const top = Number(bbox.y0);
      const bottom = Number(bbox.y1);
      const width = right - left;
      const height = bottom - top;
      
      let layerSource = l.sourceText || l.text || '';
      const hasThai = /[\u0E00-\u0E7F]/.test(layerSource);
      if (hasThai && l.sourceText) {
        layerSource = l.sourceText;
      }
      
      return {
        index: l.lineIndex >= 0 ? l.lineIndex : (20000 + idx),
        text: layerSource,
        sourceLength: layerSource.length,
        top,
        bottom,
        left,
        right,
        height,
        area: width * height,
        confidence: l.confidence || 100,
        sourceEngine: 'manual'
      };
    });

    const baseTranslatableLines = [...updatedTranslatableLines, ...additionalLines];
    if (baseTranslatableLines.length === 0) {
      if (!options?.suppressStatus) {
        setTranslationStatus({
          kind: 'error',
          message: `No OCR lines with text on page ${pageNum}.`,
        });
      }
      return false;
    }

    const shouldUseCrossEngineAssist = pageEngine !== 'paddleocr' && (
      effectiveTranslationMode === 'official'
      || (effectiveTranslationMode === 'adaptive' && shouldUseLineByLineGrouping(
        baseTranslatableLines,
        resolvedSourceFromOCR,
        normalizedTargetLanguage,
        engine,
        effectiveTranslationMode
      ))
    );
    const alternativePages = shouldUseCrossEngineAssist
      ? Array.from(ocrState.ocrByPageEngine.get(pageNum)?.entries() || [])
        .filter(([engineKey, candidate]) => {
          if (engineKey === pageEngine) return false;
          if (!candidate || candidate === pageOCR) return false;
          return Array.isArray(candidate.lines) && candidate.lines.length > 0;
        })
        .map(([, candidate]) => candidate)
      : [];

    const {
      lines: assistedLines,
      adoptedCount: crossEngineAssistCount,
    } = buildTranslationLinesWithCrossEngineFallback(
      baseTranslatableLines,
      pageOCR.lines || [],
      alternativePages,
      pageEngine
    );
    const dedupedTranslatableLines = dedupeTranslatableLinesForTranslation(assistedLines);
    const inferredSourceLanguage = inferSourceLanguageFromTextHints(dedupedTranslatableLines, effectiveSourceLanguage);
    const pageBiasedSourceLanguage = resolveComicPageSourceLanguage(
      dedupedTranslatableLines,
      inferredSourceLanguage,
      effectiveTranslationMode
    );
    let translationSourceLanguage = shouldPreferEnglishSourceForMixedTechnicalPage(
      dedupedTranslatableLines,
      pageBiasedSourceLanguage,
      normalizedTargetLanguage,
      effectiveTranslationMode
    )
      ? 'en'
      : pageBiasedSourceLanguage;

    if (translationSourceLanguage === normalizedTargetLanguage && normalizedUserSourceLanguage !== normalizedTargetLanguage) {
      translationSourceLanguage = normalizedUserSourceLanguage;
    }
    const latinDominantPage = isLikelyLatinDominantTranslationPage(dedupedTranslatableLines)
      || hasStrongLatinAnchorLines(dedupedTranslatableLines);
    const rawTranslatableLines = assistedLines
      .filter((line) => {
        if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage, ocrLanguageKey)) return false;
        if (latinDominantPage && isLikelyShortForeignSfxLine(line.text) && !lookupShortPhraseTh(line.text)) return false;
        return true;
      });
    let translatableLines = dedupedTranslatableLines
      .filter((line) => {
        if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage, ocrLanguageKey)) return false;
        if (latinDominantPage && isLikelyShortForeignSfxLine(line.text) && !lookupShortPhraseTh(line.text)) return false;
        return true;
      });
    const preservedSourceLineCount = dedupedTranslatableLines.length - translatableLines.length;

    if (translatableLines.length === 0) {
      if (!options?.suppressStatus) {
        setTranslationStatus({
          kind: 'error',
          message: `No translatable OCR lines on page ${pageNum}. Preserved-only lines were skipped to avoid ghost overlays.`,
        });
      }
      return false;
    }

    let groupingProfile: TranslationGroupingProfile = shouldUseLineByLineGrouping(
      translatableLines,
      translationSourceLanguage,
      normalizedTargetLanguage,
      engine,
      effectiveTranslationMode
    )
      ? 'line-by-line'
      : (shouldUseDenseDialogueGrouping(
        translatableLines,
        translationSourceLanguage,
        normalizedTargetLanguage,
        effectiveTranslationMode
      )
        ? 'dense-dialogue'
        : 'default');

    if (
      engine === 'offline'
      && pageEngine === 'paddleocr'
      && groupingProfile === 'dense-dialogue'
      && effectiveTranslationMode !== 'manga'
      && effectiveTranslationMode !== 'manhwa'
      && shouldForceLineByLineForOfflinePanel(translatableLines)
    ) {
      groupingProfile = 'line-by-line';
    }

    if (groupingProfile === 'line-by-line' && rawTranslatableLines.length > translatableLines.length) {
      translatableLines = rawTranslatableLines;
    }

    const resolvedGrouping = resolveTranslationGroupsWithLayout(
      pageNum,
      pageOCR,
      translatableLines,
      groupingProfile,
      translationSourceLanguage,
      normalizedTargetLanguage,
      effectiveTranslationMode
    );
    groupingProfile = resolvedGrouping.groupingProfile;
    pushLayoutGroupingDebugPayload(pageNum, groupingProfile, resolvedGrouping.layoutResult, resolvedGrouping.groups);

    const preparedGroups = resolvedGrouping.groups.map((group, groupIndex) => {
      const composeResult = composeGroupSourceText(
        group.lines,
        group.groupType || 'unknown',
        groupingProfile
      );
      const rawSourceText = composeResult.composed;
      const dehyphenJoins = composeResult.dehyphenJoins;
      let groupSourceLanguage = resolvePreferredSourceLanguageForText(rawSourceText, translationSourceLanguage);
      if (groupSourceLanguage === normalizedTargetLanguage && translationSourceLanguage !== normalizedTargetLanguage) {
        groupSourceLanguage = translationSourceLanguage;
      }
      const sourceText = normalizeSourceForTranslation(rawSourceText, groupSourceLanguage);
      const protectedGroup = protectTranslationTokens(sourceText, options?.targetLanguage || targetLanguage);
      return {
        index: groupIndex,
        lines: group.lines,
        sourceLanguage: groupSourceLanguage,
        sourceText,
        protectedText: protectedGroup.protectedText,
        replacements: protectedGroup.replacements,
        dehyphenJoins,
      };
    }).filter((group) => Boolean(group.protectedText));

    if (preparedGroups.length === 0) {
      if (!options?.suppressStatus) {
        setTranslationStatus({
          kind: 'error',
          message: `No translatable OCR groups on page ${pageNum} after source-language preparation.`,
        });
      }
      return false;
    }

    let translatedGroupsRaw = new Array<string>(preparedGroups.length).fill('');
    const mapTranslationResults = (results: Array<{ id: string; translatedText: string }>) => {
      const nextRaw = new Array<string>(preparedGroups.length).fill('');
      results.forEach((res) => {
        const idx = Number(res.id);
        if (!Number.isNaN(idx) && idx >= 0 && idx < nextRaw.length) {
          nextRaw[idx] = res.translatedText;
        }
      });
      return nextRaw;
    };
    
    const translatableItems: TranslatableItem[] = preparedGroups.map((group, groupIndex) => {
      const sampleLine = group.lines[0];
      let groupType: any = 'ungrouped';
      if (sampleLine) {
        const matchingLayer = currentLayers.find(l => l.lineIndex === sampleLine.index);
        if (matchingLayer && matchingLayer.groupId) {
          const pageGroups = useLayerStore.getState().getPageGroups(pageNum);
          const layerGroup = pageGroups.find(g => g.id === matchingLayer.groupId);
          if (layerGroup) {
            groupType = layerGroup.groupType;
          }
        }
      }

      return {
        id: String(groupIndex),
        text: group.protectedText || group.sourceText || '',
        groupType: groupType,
        sourceLanguage: group.sourceLanguage,
      };
    });

    const coordinatorEngineId = engine === 'offline' ? 'argos' : (engine === 'ai' ? 'gemini' : 'm2m100');
    let effectiveEngine: 'offline' | 'ai' | 'm2m100' = engine;
    let fallbackNote = '';
    
    try {
      const translationResults = await translationCoordinator.runTranslation(
        coordinatorEngineId,
        translatableItems,
        {
          sourceLanguage: translationSourceLanguage,
          targetLanguage: normalizedTargetLanguage,
          translationMode: effectiveTranslationMode,
          translateBatchOffline: (texts, type, mode, src, tgt, batchEngine) => 
            translateBatchOffline(texts, type, mode, src, tgt, offlineBatchBridgeWrapper, batchEngine),
          translateBatchGemini: (texts, type, mode, src, tgt) => 
            translateBatchGemini(
              texts, 
              type, 
              mode, 
              src, 
              tgt, 
              buildGeminiContextOverrides(effectiveTranslationMode, src, tgt)
            ),
        }
      );

      const hasFailedItem = translationResults.some(r => !r.success);
      if (hasFailedItem && coordinatorEngineId === 'gemini') {
        throw new Error('Gemini API returned partial failure status');
      }

      translatedGroupsRaw = mapTranslationResults(translationResults);
    } catch (err: any) {
      if (coordinatorEngineId === 'gemini') {
        console.warn(`[Translation] Gemini translation failed: ${err.message || err}. Initiating automatic fallback to Argos Translate...`);
        if (!options?.suppressStatus) {
          setTranslationStatus({
            kind: 'error',
            message: `Gemini API Error: ${err.message || 'API failed'}. Falling back to Argos Offline...`,
          });
        }
        try {
          const fallbackResults = await translationCoordinator.runTranslation(
            'argos',
            translatableItems,
            {
              sourceLanguage: translationSourceLanguage,
              targetLanguage: normalizedTargetLanguage,
              translationMode: effectiveTranslationMode,
              translateBatchOffline: (texts, type, mode, src, tgt, batchEngine) => 
                translateBatchOffline(texts, type, mode, src, tgt, offlineBatchBridgeWrapper, batchEngine),
            }
          );
          translatedGroupsRaw = mapTranslationResults(fallbackResults);
          effectiveEngine = 'offline';
          fallbackNote = ' (auto-fallback: gemini failed, used argos)';
        } catch (argosErr: any) {
          console.error(`[Translation] Argos fallback also failed:`, argosErr);
          throw new Error(`Both Gemini and Argos fallback failed: ${argosErr.message || argosErr}`);
        }
      } else {
        console.error('[TranslationCoordinator] Run translation error:', err);
        throw err;
      }
    }

    let translatedGroups = translatedGroupsRaw.map((text, index) => {
      const restored = restoreProtectedTokens(text, preparedGroups[index]?.replacements || []);
      if (normalizedTargetLanguage === 'th') {
        return normalizeThaiTranslationText(restored);
      }
      return restored;
    });

    if (engine === 'offline' && translationSourceLanguage === 'th' && normalizedTargetLanguage === 'en') {
      const carryover = evaluateThaiCarryoverForEnglish(preparedGroups, translatedGroups, normalizedTargetLanguage);
      if (carryover.shouldFallback) {
        if (!hasGeminiApiKey) {
          const thaiPct = Math.round(carryover.thaiRatio * 100);
          const carryPct = Math.round(carryover.carryoverRatio * 100);
          fallbackNote = ` fallback skipped: no Gemini API key (${thaiPct}% Thai, ${carryPct}% carryover).`;
          console.info(`[TranslateDiag] Offline carryover detected but Gemini key missing (Thai ${thaiPct}%, carryover ${carryPct}%).`);
        } else {
          try {
            const fallbackResults = await translationCoordinator.runTranslation(
              'gemini',
              translatableItems,
              {
                sourceLanguage: translationSourceLanguage,
                targetLanguage: normalizedTargetLanguage,
                translationMode: effectiveTranslationMode,
                translateBatchOffline: (texts, type, mode, src, tgt) =>
                  translateBatchOffline(texts, type, mode, src, tgt, offlineBatchBridgeWrapper),
                translateBatchGemini: (texts, type, mode, src, tgt) =>
                  translateBatchGemini(
                    texts,
                    type,
                    mode,
                    src,
                    tgt,
                    buildGeminiContextOverrides(effectiveTranslationMode, src, tgt)
                  ),
              }
            );
            translatedGroupsRaw = mapTranslationResults(fallbackResults);
            translatedGroups = translatedGroupsRaw.map((text, index) => {
              const restored = restoreProtectedTokens(text, preparedGroups[index]?.replacements || []);
              return normalizeWhitespace(String(restored || ''));
            });
            effectiveEngine = 'ai';
            const thaiPct = Math.round(carryover.thaiRatio * 100);
            const carryPct = Math.round(carryover.carryoverRatio * 100);
            fallbackNote = ` fallback: offline->ai (${thaiPct}% Thai, ${carryPct}% carryover).`;
            console.info(`[TranslateDiag] Offline carryover detected (Thai ${thaiPct}%, carryover ${carryPct}%), switching to Gemini.`);
          } catch (fallbackError) {
            console.warn('[TranslationCoordinator] Gemini fallback failed:', fallbackError);
          }
        }
      }
    }

    const groupLineOverrides = new Map<number, string[]>();
    let groupRetryAppliedCount = 0;

    if (effectiveEngine === 'offline') {
      for (let groupIndex = 0; groupIndex < preparedGroups.length; groupIndex += 1) {
        const group = preparedGroups[groupIndex];
        if (group.replacements && group.replacements.length > 0) {
          continue;
        }
        if (!group.lines || group.lines.length <= 1) {
          continue;
        }
        const groupSourceLanguage = group.sourceLanguage;
        const sourceGroupText = group.sourceText || '';
        const initialTranslated = translatedGroups[groupIndex] || sourceGroupText;
        if (!shouldRetryLineTranslation(
          sourceGroupText,
          initialTranslated,
          groupSourceLanguage,
          normalizedTargetLanguage
        )) {
          continue;
        }

        const candidateScores: Array<{ kind: 'group' | 'per-line'; score: number; text?: string; lines?: string[] }> = [
          {
            kind: 'group',
            score: scoreTranslationCandidate(sourceGroupText, initialTranslated, normalizedTargetLanguage),
            text: initialTranslated,
          },
        ];

        const retrySourceText = buildOfflineGroupRetrySourceText(group.lines, groupSourceLanguage);
        if (
          retrySourceText
          && buildTranslationComparisonKey(retrySourceText) !== buildTranslationComparisonKey(sourceGroupText)
        ) {
          const retryProtected = protectTranslationTokens(retrySourceText, options?.targetLanguage || targetLanguage);
          const retryGroupRaw = await translateBatchOffline(
            [retryProtected.protectedText],
            'text',
            effectiveTranslationMode,
            groupSourceLanguage,
            normalizedTargetLanguage,
            offlineBatchBridgeWrapper
          );
          const retryGroupRestored = restoreProtectedTokens(
            retryGroupRaw[0] || '',
            retryProtected.replacements
          );
          const retryGroupText = normalizedTargetLanguage === 'th'
            ? normalizeThaiTranslationText(retryGroupRestored)
            : normalizeWhitespace(retryGroupRestored);
          candidateScores.push({
            kind: 'group',
            score: scoreTranslationCandidate(sourceGroupText, retryGroupText, normalizedTargetLanguage),
            text: retryGroupText,
          });
        }

        const retryLineInputs = group.lines.map((line) => normalizeSourceForTranslation(line.text, groupSourceLanguage));
        const retryLineProtected = retryLineInputs.map((text) => protectTranslationTokens(text, options?.targetLanguage || targetLanguage));
        const retryLineRaw = await translateBatchOffline(
          retryLineProtected.map((item) => item.protectedText),
          'text',
          effectiveTranslationMode,
          groupSourceLanguage,
          normalizedTargetLanguage,
          offlineBatchBridgeWrapper
        );
        setSlangGroupContext(group.lines.map((l) => l.text || '').join(' '));
        const retryLineOutputs = group.lines.map((line, lineIndex) => {
          const restored = restoreProtectedTokens(
            retryLineRaw[lineIndex] || '',
            retryLineProtected[lineIndex]?.replacements || []
          );
          return finalizeTranslatedLine(line.text, restored, normalizedTargetLanguage);
        });
        setSlangGroupContext('');
        candidateScores.push({
          kind: 'per-line',
          score: retryLineOutputs.reduce(
            (sum, lineText, lineIndex) => sum + scoreTranslationCandidate(group.lines[lineIndex]?.text || '', lineText, normalizedTargetLanguage),
            0
          ) / Math.max(1, group.lines.length),
          lines: retryLineOutputs,
        });

        const bestCandidate = candidateScores
          .slice()
          .sort((a, b) => b.score - a.score)[0];
        const baselineScore = candidateScores[0]?.score ?? Number.NEGATIVE_INFINITY;
        if (!bestCandidate || bestCandidate.score <= baselineScore + 6) {
          continue;
        }

        if (bestCandidate.kind === 'per-line' && bestCandidate.lines) {
          groupLineOverrides.set(groupIndex, bestCandidate.lines);
        } else if (bestCandidate.text) {
          translatedGroups[groupIndex] = bestCandidate.text;
        }
        groupRetryAppliedCount += 1;
      }
    }

    const translatedByIndex = new Map<number, string>();
    const retryLineMap = new Map<number, { index: number; sourceText: string; sourceLanguage: string }>();
    preparedGroups.forEach((group, groupIndex) => {
      const groupSourceLanguage = group.sourceLanguage;

      if (normalizeTranslationLanguage(normalizedTargetLanguage, 'th') === 'th') {
        const combinedRaw = group.lines.map(l => String(l.text || '').trim()).join(' ');
        const compactCombined = combinedRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const matchedOverride = matchMangaGroupLineOverrides(compactCombined, group.lines);
        if (matchedOverride && matchedOverride.length > 0) {
          groupLineOverrides.set(groupIndex, matchedOverride);
        }
      }

      const directLineOverride = groupLineOverrides.get(groupIndex);
      if (directLineOverride && directLineOverride.length > 0) {
        group.lines.forEach((line, lineIndex) => {
          const sourceLineText = normalizeWhitespace(String(line.text || '')) || String(line.text || '');
          let overrideText = directLineOverride[lineIndex] !== undefined ? directLineOverride[lineIndex] : sourceLineText;
          const cleanOverride = overrideText.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
          const cleanSource = sourceLineText.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (normalizedTargetLanguage === 'th' && overrideText !== '' && (overrideText === sourceLineText || cleanOverride === cleanSource)) {
            const glossaryMatch = lookupShortPhraseTh(sourceLineText);
            if (glossaryMatch) {
              overrideText = glossaryMatch;
            }
          }
          const finalText = overrideText !== undefined ? overrideText : sourceLineText;
          translatedByIndex.set(line.index, finalText);
          if (overrideText !== '' && group.replacements.length === 0 && shouldRetryLineTranslation(line.text, finalText, groupSourceLanguage, normalizedTargetLanguage)) {
            retryLineMap.set(line.index, { index: line.index, sourceText: line.text, sourceLanguage: groupSourceLanguage });
          }
        });
        return;
      }

      const translatedGroup = translatedGroups[groupIndex] || group.sourceText || '';
      const eligibleLines = group.lines;
      const dehyphenJoins = group.dehyphenJoins || [];
      const mergedLines = getMergedTranslatableLines(eligibleLines, dehyphenJoins);

      const slots = splitTranslatedTextBySourceWeights(
        translatedGroup,
        mergedLines,
        normalizedTargetLanguage
      );
      const finalRedistributed = mapSlotsToLines(slots, eligibleLines.length, dehyphenJoins);

      let redistributedCursor = 0;
      let prevLineTextInGroup = '';
      const cleanedGroupContext = group.lines.map((l) => normalizeEnglishOcrNoiseForTranslation(l.text || '')).join(' ');
      setSlangGroupContext(cleanedGroupContext);
      const childSet = new Set(dehyphenJoins.map((j) => j.childIdx));
      group.lines.forEach((line, lineOffset) => {
        const sourceLineText = normalizeWhitespace(String(line.text || '')) || String(line.text || '');
        let finalizedLine = '';
        if (childSet.has(lineOffset)) {
          finalizedLine = '';
        } else {
          const redistributedLine = normalizeWhitespace(String(finalRedistributed[redistributedCursor] || ''));
          const fallbackLine = resolveRedistributedLineFallback(
            sourceLineText,
            translatedGroup,
            normalizedTargetLanguage,
            lineOffset,
            group.lines.length
          );
          finalizedLine = finalizeTranslatedLine(
            sourceLineText,
            redistributedLine || fallbackLine,
            normalizedTargetLanguage
          );
        }
        redistributedCursor += 1;

        const groupHasThaiTranslation = normalizedTargetLanguage === 'th' && /[\u0E00-\u0E7F]/.test(translatedGroup);
        const hasThaiInFinal = /[\u0E00-\u0E7F]/.test(finalizedLine);

        let directTranslation: string | null = null;
        const lineNeedsFallback = (!groupHasThaiTranslation || group.lines.length <= 1) || (!hasThaiInFinal || hasKoreanTranslationCarryover(finalizedLine) || finalizedLine === sourceLineText || /[\uAC00-\uD7AF]/.test(finalizedLine));
        if (normalizedTargetLanguage === 'th' && lineNeedsFallback) {
          directTranslation = lookupShortPhraseTh(sourceLineText) ||
            lookupShortPhraseTh(sourceLineText.replace(/[^A-Za-z0-9]/g, '')) ||
            lookupShortPhraseTh(normalizeSpanishOcrNoiseForTranslation(sourceLineText)) || null;

          if (!directTranslation && /[\uAC00-\uD7AF]/.test(sourceLineText)) {
            directTranslation = applyKoreanConversationalFallback(sourceLineText, finalizedLine);
          }
          if (!directTranslation) {
            const words = sourceLineText.trim().split(/\s+/);
            if (words.length > 1) {
              const translatedWords = words.map(w => lookupShortPhraseTh(w) || lookupShortPhraseTh(w.replace(/[^A-Za-z0-9]/g, '')) || w);
              if (translatedWords.some(tw => /[\u0E00-\u0E7F]/.test(tw))) {
                directTranslation = translatedWords.join(' ');
              }
            }
          }

          if (directTranslation && /[\u0E00-\u0E7F]/.test(directTranslation)) {
            const cleanFinal = finalizedLine.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            const cleanSource = sourceLineText.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (!finalizedLine || finalizedLine === sourceLineText || cleanFinal === cleanSource || !/[\u0E00-\u0E7F]/.test(finalizedLine) || hasKoreanTranslationCarryover(finalizedLine) || isBoilerplateHallucination(sourceLineText, finalizedLine)) {
              finalizedLine = directTranslation;
            }
          }
        }

        if (normalizedTargetLanguage === 'th' && finalizedLine && /[a-zA-Z]{2,}/.test(finalizedLine)) {
          let sanitized = finalizedLine.replace(/\b[a-zA-Z]{2,}\b/g, (word) => {
            const wordTh = lookupShortPhraseTh(word) || lookupShortPhraseTh(word.replace(/[^A-Za-z0-9]/g, ''));
            return (wordTh && /[\u0E00-\u0E7F]/.test(wordTh)) ? wordTh : word;
          });
          if (/[\u0E00-\u0E7F]/.test(sanitized)) {
            finalizedLine = sanitized.replace(/\b[a-zA-Z]{2,}\b/g, '').replace(/\s+/g, ' ').trim();
          }
        }
        
        let finalLineText = '';
        if (childSet.has(lineOffset)) {
          finalLineText = '';
        } else if (hasThaiInFinal) {
          finalLineText = finalizedLine;
        } else if (normalizedTargetLanguage === 'th') {
          if (groupHasThaiTranslation && group.lines.length > 1) {
            finalLineText = '';
          } else {
            const dictFallback = directTranslation || lookupShortPhraseTh(sourceLineText) || lookupShortPhraseTh(sourceLineText.replace(/[^A-Za-z0-9]/g, ''));
            if (dictFallback && /[\u0E00-\u0E7F]/.test(dictFallback)) {
              finalLineText = dictFallback;
            } else {
              const cleanedSourceFallback = normalizeSourceForTranslation(sourceLineText, groupSourceLanguage);
              const dictFromCleaned = lookupShortPhraseTh(cleanedSourceFallback) || lookupShortPhraseTh(cleanedSourceFallback.replace(/[^A-Za-z0-9]/g, ''));
              if (dictFromCleaned && /[\u0E00-\u0E7F]/.test(dictFromCleaned)) {
                finalLineText = dictFromCleaned;
              } else {
                finalLineText = finalizedLine || cleanedSourceFallback || sourceLineText;
              }
            }
          }
        } else {
          const cleanedSourceFallback = normalizeSourceForTranslation(sourceLineText, groupSourceLanguage);
          finalLineText = finalizedLine || cleanedSourceFallback || sourceLineText;
        }

        translatedByIndex.set(line.index, finalLineText);

        if (normalizedTargetLanguage === 'th' && finalLineText.trim()) {
          const trimmedLine = finalLineText.trim();
          if (trimmedLine.length <= 6 && prevLineTextInGroup === trimmedLine) {
            translatedByIndex.set(line.index, '');
          } else {
            prevLineTextInGroup = trimmedLine;
          }
        }
        if (!childSet.has(lineOffset) && group.replacements.length === 0 && shouldRetryLineTranslation(line.text, finalLineText, groupSourceLanguage, normalizedTargetLanguage)) {
          const hasGlossaryMatch = normalizedTargetLanguage === 'th' && lookupShortPhraseTh(sourceLineText);
          if (!hasGlossaryMatch) {
            retryLineMap.set(line.index, { index: line.index, sourceText: line.text, sourceLanguage: groupSourceLanguage });
          }
        }
      });
      setSlangGroupContext('');
    });

    translatableLines.forEach((line) => {
      if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage, ocrLanguageKey)) {
        return;
      }
      if (translatedByIndex.has(line.index)) {
        return;
      }
      let finalizedFallback = finalizeTranslatedLine(line.text, line.text, normalizedTargetLanguage);

      if (normalizedTargetLanguage === 'th') {
        const directTranslation = lookupShortPhraseTh(line.text);
        if (directTranslation) {
          finalizedFallback = directTranslation;
        }
      }

      translatedByIndex.set(line.index, finalizedFallback || line.text);
      if (shouldRetryLineTranslation(line.text, finalizedFallback, translationSourceLanguage, normalizedTargetLanguage)) {
        const hasGlossaryMatch = normalizedTargetLanguage === 'th' && lookupShortPhraseTh(line.text);
        if (!hasGlossaryMatch) {
          retryLineMap.set(line.index, {
            index: line.index,
            sourceText: line.text,
            sourceLanguage: translationSourceLanguage,
          });
        }
      }
    });

    let retryAppliedCount = 0;
    const retryCandidates = Array.from(retryLineMap.values());
    if (retryCandidates.length > 0) {
      const retryPrepared = retryCandidates.map((item) => {
        const resolvedRetrySourceLanguage = normalizeTranslationLanguage(item.sourceLanguage, translationSourceLanguage);
        const sourceText = normalizeSourceForTranslation(item.sourceText, resolvedRetrySourceLanguage);
        const protectedRetry = protectTranslationTokens(sourceText, options?.targetLanguage || targetLanguage);
        return {
          ...item,
          sourceLanguage: resolvedRetrySourceLanguage,
          sourceText,
          protectedText: protectedRetry.protectedText,
          replacements: protectedRetry.replacements,
        };
      });
      const retryOutputs = new Array<string>(retryPrepared.length).fill('');
      const retryBuckets = new Map<string, number[]>();
      retryPrepared.forEach((item, index) => {
        const bucket = retryBuckets.get(item.sourceLanguage) || [];
        bucket.push(index);
        retryBuckets.set(item.sourceLanguage, bucket);
      });

      for (const [retrySourceLanguage, indexes] of retryBuckets.entries()) {
        const retryInputs = indexes.map((index) => retryPrepared[index]?.protectedText || '');
        const retryRaw = effectiveEngine === 'offline'
          ? await translateBatchOffline(retryInputs, 'text', effectiveTranslationMode, retrySourceLanguage, normalizedTargetLanguage, offlineBatchBridgeWrapper)
          : await translateBatchGemini(
            retryInputs,
            'text',
            effectiveTranslationMode,
            retrySourceLanguage,
            normalizedTargetLanguage,
            buildGeminiContextOverrides(effectiveTranslationMode, retrySourceLanguage, normalizedTargetLanguage)
          );

        indexes.forEach((preparedIndex, bucketIndex) => {
          const restored = restoreProtectedTokens(
            retryRaw[bucketIndex] || '',
            retryPrepared[preparedIndex]?.replacements || []
          );
          retryOutputs[preparedIndex] = normalizedTargetLanguage === 'th'
            ? normalizeThaiTranslationText(restored)
            : normalizeWhitespace(String(restored || ''));
        });
      }

      retryPrepared.forEach((item, idx) => {
        const retried = normalizeWhitespace(retryOutputs[idx] || '');
        if (!retried) return;

        let finalizedRetry = finalizeTranslatedLine(item.sourceText, retried, normalizedTargetLanguage);

        if (normalizedTargetLanguage === 'th') {
          const directTranslation = lookupShortPhraseTh(item.sourceText);
          if (directTranslation) {
            finalizedRetry = directTranslation;
          }
        }

        if (shouldRetryLineTranslation(item.sourceText, finalizedRetry, item.sourceLanguage, normalizedTargetLanguage)) {
          const hasGlossaryMatch = normalizedTargetLanguage === 'th' && lookupShortPhraseTh(item.sourceText);
          if (!hasGlossaryMatch) {
            return;
          }
        }
        translatedByIndex.set(item.index, finalizedRetry);
        retryAppliedCount += 1;
      });
    }

    const translationHealth = evaluateUntranslatedTranslation(
      translatableLines,
      translatedByIndex,
      translationSourceLanguage,
      normalizedTargetLanguage
    );
    if (translationHealth.shouldSkip) {
      if (isActiveDoc) {
        const ocrStore = useOCRTextLayerStore.getState();
        const existingEntries = ocrStore.getTranslationCacheEntries(pageNum);
        const preserved = existingEntries.find((entry) => (
          entry.ocrEngine === ocrEngine
          && normalizeTranslationLanguage(entry.targetLanguage || '', 'th') === normalizedTargetLanguage
          && entry.translatedByIndex.some((item) => THAI_REGEX.test(String(item.text || '')))
        ));
        if (preserved) {
          ocrStore.setActiveTranslationCacheKey(pageNum, preserved.key);
          ocrStore.setTranslationPreviewMode('translated');
        }
        if (!options?.suppressStatus) {
          const retryPct = Math.round(translationHealth.retryRatio * 100);
          const thaiPct = Math.round(translationHealth.thaiRatio * 100);
          const engineLabel = effectiveEngine === 'offline' ? 'Offline' : 'AI';
          setTranslationStatus({
            kind: 'error',
            message: `${engineLabel} translation returned mostly source text (retry ${retryPct}%, Thai ${thaiPct}%). Cache preserved.`,
          });
        }
      }
    }

    if (normalizeTranslationLanguage(normalizedTargetLanguage, 'th') === 'th') {
      preparedGroups.forEach((group) => {
        if (!group.lines || group.lines.length <= 1) return;
        const lineIndices = group.lines.map(l => l.index);
        const hasHee = lineIndices.some(idx => {
          const t = translatedByIndex.get(idx);
          return t && t.includes('หี');
        });
        const hasJim = lineIndices.some(idx => {
          const t = translatedByIndex.get(idx);
          return t && t.includes('จิ๋ม');
        });
        if (hasHee && hasJim) {
          lineIndices.forEach(idx => {
            const t = translatedByIndex.get(idx);
            if (t && t.includes('จิ๋ม')) {
              translatedByIndex.set(idx, t.replace(/จิ๋ม/g, 'หี'));
            }
          });
        }
        const hasKuay = lineIndices.some(idx => {
          const t = translatedByIndex.get(idx);
          return t && t.includes('ควย');
        });
        const hasKai = lineIndices.some(idx => {
          const t = translatedByIndex.get(idx);
          return t && t.includes('ไก่');
        });
        if (hasKuay && hasKai) {
          lineIndices.forEach(idx => {
            const t = translatedByIndex.get(idx);
            if (t && t.includes('ไก่')) {
              translatedByIndex.set(idx, t.replace(/ไก่/g, 'ควย'));
            }
          });
        }
      });
    }

    const updatedLines = (pageOCR.lines || []).map((line, lineIndex) => {
      const translatedText = translatedByIndex.get(lineIndex);
      if (!translatedText) return line;
      return {
        ...line,
        text: translatedText,
      };
    });

    const cacheTranslationMode: TranslationMode = effectiveTranslationMode;

    const cacheKey = buildOCRTranslationCacheKey({
      ocrEngine,
      ocrLanguage: ocrLanguageKey,
      sourceLanguage: translationSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      translationMode: cacheTranslationMode,
      translatorEngine: effectiveEngine,
    });

    const translationEntry = {
      key: cacheKey,
      pageNum,
      ocrEngine,
      ocrLanguage: ocrLanguageKey,
      sourceLanguage: translationSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      translationMode: cacheTranslationMode,
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
      groupCount: preparedGroups.length,
      createdAt: Date.now(),
      width: pageOCR.width,
      height: pageOCR.height,
    };

    if (isActiveDoc) {
      setTranslationCacheEntry(pageNum, cacheKey, translationEntry);
      console.log(`[Translation] cache set page=${pageNum} engine=${ocrEngine} key=${cacheKey}`);

      try {
        const layerStore = useLayerStore.getState();
        const pageLayers = layerStore.getPageLayers(pageNum);
        const existingGroups = layerStore.getPageGroups(pageNum);
        const hasUserModifications = pageLayers.some(l => l.userEdited || l.id.startsWith('manual-layer-'))
          || existingGroups.some(g => g.userCreated);

        const freshResult = buildLayerGroupsFromOCR(pageOCR, translatedByIndex);
        if (pageLayers.length > 0 && hasUserModifications) {
          const merged = mergeLayersAndGroups(freshResult, pageLayers, existingGroups);
          layerStore.setPageLayers(pageNum, merged);
        } else {
          layerStore.setPageLayers(pageNum, freshResult);
          console.log(`[TranslationSync] Built ${freshResult.layers.length} layer(s) in ${freshResult.groups.length} group(s) for page ${pageNum} (fresh translation sync).`);
        }
      } catch (err) {
        console.warn('[TranslationSync] Failed to synchronize translation back to Layer Store:', err);
      }
    }

    const cacheDocId = options?.documentIdOverride ?? (await ensureDocumentId().catch(() => null));
    if (cacheDocId) {
      const persisted = await dbService.saveTranslationCache(cacheDocId, pageNum, cacheKey, translationEntry);
      if (!persisted) {
        console.warn(`[Translation] Failed to persist translation cache for page ${pageNum} (docId=${cacheDocId})`);
      }
    }

    const totalPageCaches = useOCRTextLayerStore.getState().getTranslationCacheEntries(pageNum).length;
    const lowQualityOfflinePath = effectiveEngine === 'offline'
      && normalizedTargetLanguage === 'th'
      && (translationSourceLanguage === 'ko' || translationSourceLanguage === 'es');
    const qualityHint = lowQualityOfflinePath
      ? ' note: offline Argos quality for this language pair is limited; AI usually gives better Thai phrasing.'
      : '';
    const crossEngineHint = crossEngineAssistCount > 0
      ? ` source assist: ${crossEngineAssistCount} lines from other OCR engine cache.`
      : '';
    const groupRetryHint = groupRetryAppliedCount > 0
      ? ` group retries applied: ${groupRetryAppliedCount}.`
      : '';
    const preservedHint = preservedSourceLineCount > 0
      ? ` preserved-only lines skipped: ${preservedSourceLineCount}.`
      : '';

    if (!options?.suppressStatus) {
      setTranslationStatus({
        kind: 'success',
        message: `${effectiveEngine} | ${translationSourceLanguage}->${normalizedTargetLanguage} | ${ocrLanguageKey} | profile=${groupingProfile} translated ${translatedByIndex.size} lines in ${preparedGroups.length} grouped segments on page ${pageNum}.${groupRetryHint} line retries applied: ${retryAppliedCount}/${retryCandidates.length}. cache slots: ${totalPageCaches}.${crossEngineHint}${preservedHint}${qualityHint}${fallbackNote}`,
      });
    }

    return true;
  }, [
    buildGeminiContextOverrides,
    currentPage,
    ensureDocumentId,
    hasGeminiApiKey,
    ocrOptions.engine,
    ocrOptions.language,
    setTranslationCacheEntry,
    setTranslationStatus,
    sourceLanguage,
    targetLanguage,
    translationMode,
  ]);

  const runAiBatchDocumentTranslation = useCallback(async () => {
    const ocrState = useOCRTextLayerStore.getState();
    const selectedEngine = (ocrOptions.engine || 'paddleocr') as OCREngine;
    const normalizedTargetLanguage = normalizeTranslationLanguage(targetLanguage, 'th');
    const normalizedUserSourceLanguage = normalizeTranslationLanguage(sourceLanguage, 'en');

    const pageCandidates = new Set<number>();
    ocrState.ocrByPageEngine.forEach((byEngine, pageNum) => {
      if (byEngine.has(selectedEngine)) {
        pageCandidates.add(pageNum);
      }
    });

    const sortedPageNums = Array.from(pageCandidates.values()).sort((a, b) => a - b);
    const plans: BatchPageTranslationPlan[] = [];
    let skippedNoModelCache = 0;
    let skippedNoText = 0;
    let skippedPreservedOnly = 0;
    let deferredByPayloadBudget = 0;
    let sourceAssistLines = 0;
    const maxPayloadChars = 120000;
    let runningPayloadEstimate = 1400;

    for (const pageNum of sortedPageNums) {
      const pageOCR = resolveModelScopedOriginalPageOCR(ocrState, pageNum, selectedEngine);

      if (!pageOCR) {
        skippedNoModelCache += 1;
        continue;
      }

      const baseLines = collectTranslatableLines(
        pageOCR.lines || [], 
        (pageOCR.ocrEngine || selectedEngine) as string,
        pageOCR.width,
        pageOCR.height
      );
      if (baseLines.length === 0) {
        skippedNoText += 1;
        continue;
      }

      const ocrLanguageKey = pageOCR.language || ocrOptions.language || sourceLanguage || 'eng';
      const resolvedSourceFromOCR = resolveSourceLanguageFromOCR(ocrLanguageKey, normalizedUserSourceLanguage);

      const shouldUseCrossEngineAssist = selectedEngine !== 'paddleocr' && (
        translationMode === 'official'
        || (translationMode === 'adaptive' && shouldUseLineByLineGrouping(
          baseLines,
          resolvedSourceFromOCR,
          normalizedTargetLanguage,
          'ai',
          translationMode
        ))
      );
      const alternativePages = shouldUseCrossEngineAssist
        ? Array.from(ocrState.ocrByPageEngine.get(pageNum)?.entries() || [])
          .filter(([engineKey, candidate]) => {
            if (engineKey === selectedEngine) return false;
            if (!candidate || candidate === pageOCR) return false;
            return Array.isArray(candidate.lines) && candidate.lines.length > 0;
          })
          .map(([, candidate]) => candidate)
        : [];

      const {
        lines: assistedLines,
        adoptedCount: pageAssistLines,
      } = buildTranslationLinesWithCrossEngineFallback(
        baseLines,
        pageOCR.lines || [],
        alternativePages,
        (pageOCR.ocrEngine || selectedEngine) as OCREngine
      );
      const dedupedLines = dedupeTranslatableLinesForTranslation(assistedLines);
      const inferredSourceLanguage = inferSourceLanguageFromTextHints(dedupedLines, resolvedSourceFromOCR);
      const pageBiasedSourceLanguage = resolveComicPageSourceLanguage(
        dedupedLines,
        inferredSourceLanguage,
        translationMode
      );
      let translationSourceLanguage = shouldPreferEnglishSourceForMixedTechnicalPage(
        dedupedLines,
        pageBiasedSourceLanguage,
        normalizedTargetLanguage,
        translationMode
      )
        ? 'en'
        : pageBiasedSourceLanguage;

      if (translationSourceLanguage === normalizedTargetLanguage && normalizedUserSourceLanguage !== normalizedTargetLanguage) {
        translationSourceLanguage = normalizedUserSourceLanguage;
      }
      const latinDominantPage = isLikelyLatinDominantTranslationPage(dedupedLines) || hasStrongLatinAnchorLines(dedupedLines);
      const rawLines = assistedLines.filter((line) => {
        if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage, ocrLanguageKey)) return false;
        if (latinDominantPage && isLikelyShortForeignSfxLine(line.text)) return false;
        return true;
      });
      let lines = dedupedLines.filter((line) => {
        if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage, ocrLanguageKey)) return false;
        if (latinDominantPage && isLikelyShortForeignSfxLine(line.text)) return false;
        return true;
      });
      sourceAssistLines += pageAssistLines;

      if (lines.length === 0) {
        skippedPreservedOnly += 1;
        continue;
      }

      let groupingProfile: TranslationGroupingProfile = shouldUseLineByLineGrouping(
        lines,
        translationSourceLanguage,
        normalizedTargetLanguage,
        'ai',
        translationMode
      )
        ? 'line-by-line'
        : (shouldUseDenseDialogueGrouping(
          lines,
          translationSourceLanguage,
          normalizedTargetLanguage,
          translationMode
        )
          ? 'dense-dialogue'
          : 'default');
      if (groupingProfile === 'line-by-line' && rawLines.length > lines.length) {
        lines = rawLines;
      }
      const resolvedGrouping = resolveTranslationGroupsWithLayout(
        pageNum,
        pageOCR,
        lines,
        groupingProfile,
        translationSourceLanguage,
        normalizedTargetLanguage,
        translationMode
      );
      groupingProfile = resolvedGrouping.groupingProfile;
      pushLayoutGroupingDebugPayload(pageNum, groupingProfile, resolvedGrouping.layoutResult, resolvedGrouping.groups);
      const groups = resolvedGrouping.groups
        .map((group, groupIndex) => {
          const composeResult = composeGroupSourceText(
            group.lines,
            group.groupType || 'unknown',
            groupingProfile
          );
          const rawSourceText = composeResult.composed;
          const dehyphenJoins = composeResult.dehyphenJoins;
          let groupSourceLanguage = resolvePreferredSourceLanguageForText(rawSourceText, translationSourceLanguage);
          if (groupSourceLanguage === normalizedTargetLanguage && translationSourceLanguage !== normalizedTargetLanguage) {
            groupSourceLanguage = translationSourceLanguage;
          }
          const sourceText = normalizeSourceForTranslation(
            rawSourceText,
            groupSourceLanguage
          );
          const protectedGroup = protectTranslationTokens(sourceText, targetLanguage);
          return {
            index: groupIndex,
            lines: group.lines,
            sourceLanguage: groupSourceLanguage,
            sourceText,
            protectedText: protectedGroup.protectedText,
            replacements: protectedGroup.replacements,
            dehyphenJoins,
          } satisfies BatchGroupPlan;
        })
        .filter((group) => Boolean(group.protectedText));

      if (groups.length === 0) {
        skippedNoText += 1;
        continue;
      }

      const plan: BatchPageTranslationPlan = {
        pageNum,
        ocr: pageOCR,
        ocrEngine: (pageOCR.ocrEngine || selectedEngine) as OCREngine,
        ocrLanguageKey,
        sourceLanguage: translationSourceLanguage,
        lines,
        groups,
        groupingProfile,
        groupingDecision: resolvedGrouping.groupingDecision,
      };

      const pageEstimate = 260 + groups.reduce((sum, group) => sum + String(group.protectedText || '').length + 28, 0);
      if (runningPayloadEstimate + pageEstimate > maxPayloadChars && plans.length > 0) {
        deferredByPayloadBudget += 1;
        continue;
      }

      runningPayloadEstimate += pageEstimate;
      plans.push(plan);
    }

    if (plans.length === 0) {
      await runCurrentPageTranslation('ai');
      return;
    }

    const sourceFrequency = new Map<string, number>();
    plans.forEach((plan) => {
      plan.groups.forEach((group) => {
        sourceFrequency.set(group.sourceLanguage, (sourceFrequency.get(group.sourceLanguage) || 0) + 1);
      });
    });
    const dominantSourceLanguage = Array.from(sourceFrequency.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || normalizedUserSourceLanguage;

    const markdownPayload = buildBatchMarkdownPayload(
      plans,
      translationMode,
      dominantSourceLanguage,
      normalizedTargetLanguage
    );

    const geminiResponse = await translateWithGemini(
      markdownPayload,
      'batch-markdown',
      translationMode,
      dominantSourceLanguage,
      normalizedTargetLanguage,
      buildGeminiContextOverrides(translationMode, dominantSourceLanguage, normalizedTargetLanguage)
    );

    const translatedByPage = parseBatchJsonResponse(geminiResponse);
    const cacheDocId = await ensureDocumentId().catch(() => null);

    let translatedPages = 0;
    let translatedLines = 0;
    let fallbackGroups = 0;
    let fallbackLines = 0;

    for (const plan of plans) {
      const translatedGroupMap = translatedByPage.get(plan.pageNum) || new Map<number, string>();
      const translatedByIndex = new Map<number, string>();

      plan.groups.forEach((group) => {
        const candidateGroupText = normalizeWhitespace(String(translatedGroupMap.get(group.index) || ''));
        if (!candidateGroupText) {
          fallbackGroups += 1;
        }

        const restoredGroupText = restoreProtectedTokens(
          candidateGroupText || group.sourceText,
          group.replacements
        );

        const normalizedGroupText = normalizedTargetLanguage === 'th'
          ? normalizeThaiTranslationText(restoredGroupText)
          : normalizeWhitespace(restoredGroupText);

        const eligibleLines = group.lines;
        const dehyphenJoins = group.dehyphenJoins || [];
        const mergedLines = getMergedTranslatableLines(eligibleLines, dehyphenJoins);

        const slots = splitTranslatedTextBySourceWeights(
          normalizedGroupText,
          mergedLines,
          normalizedTargetLanguage
        );
        const redistributed = mapSlotsToLines(slots, eligibleLines.length, dehyphenJoins);

        let redistributedCursor = 0;
        const childSet = new Set(dehyphenJoins.map((j) => j.childIdx));
        group.lines.forEach((line, lineOffset) => {
          const sourceLineText = normalizeWhitespace(String(line.text || '')) || String(line.text || '');
          let nextText = '';
          if (childSet.has(lineOffset)) {
            nextText = '';
          } else {
            const redistributedLine = normalizeWhitespace(String(redistributed[redistributedCursor] || ''));
            const fallbackLine = resolveRedistributedLineFallback(
              sourceLineText,
              normalizedGroupText,
              normalizedTargetLanguage,
              lineOffset,
              group.lines.length
            );
            nextText = finalizeTranslatedLine(
              sourceLineText,
              redistributedLine || fallbackLine,
              normalizedTargetLanguage
            );
            if (!redistributedLine) {
              fallbackLines += 1;
            }
          }
          redistributedCursor += 1;

          const cleanFinal = nextText.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
          const cleanSource = sourceLineText.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (normalizedTargetLanguage === 'th' && (!nextText || nextText === sourceLineText || cleanFinal === cleanSource)) {
            const directTranslation = lookupShortPhraseTh(sourceLineText);
            if (directTranslation) {
              nextText = directTranslation;
            }
          }

          translatedByIndex.set(line.index, nextText || (childSet.has(lineOffset) ? '' : sourceLineText));
        });
      });

      plan.lines.forEach((line) => {
        if (shouldPreserveSourceLineForTranslation(line.text, plan.sourceLanguage, plan.ocrLanguageKey)) {
          return;
        }
        if (!translatedByIndex.has(line.index)) {
          const fallbackLine = finalizeTranslatedLine(line.text, line.text, normalizedTargetLanguage);
          translatedByIndex.set(line.index, fallbackLine || line.text);
          fallbackLines += 1;
        }
      });

      const updatedLines = (plan.ocr.lines || []).map((line, lineIndex) => {
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
        sourceLanguage: plan.sourceLanguage,
        targetLanguage: normalizedTargetLanguage,
        translationMode,
        translatorEngine: 'ai',
      });

      const translationEntry = {
        key: cacheKey,
        pageNum: plan.pageNum,
        ocrEngine: plan.ocrEngine,
        ocrLanguage: plan.ocrLanguageKey,
        sourceLanguage: plan.sourceLanguage,
        targetLanguage: normalizedTargetLanguage,
        translationMode,
        translatorEngine: 'ai' as const,
        sourceFingerprint: buildOCRSourceFingerprint(plan.ocr, plan.ocrEngine),
        translatedByIndex: Array.from(translatedByIndex.entries()).map(([index, text]) => {
          const ocrLine = plan.ocr.lines[index];
          return {
            index,
            text,
            bbox: ocrLine?.bbox,
            sourceText: ocrLine?.text,
          };
        }),
        translatedText: updatedLines.map((line) => line.text).join('\n').trim(),
        lineCount: translatedByIndex.size,
        groupCount: plan.groups.length,
        createdAt: Date.now(),
        width: plan.ocr.width,
        height: plan.ocr.height,
      };

      setTranslationCacheEntry(plan.pageNum, cacheKey, translationEntry);

      if (cacheDocId) {
        await dbService.saveTranslationCache(cacheDocId, plan.pageNum, cacheKey, translationEntry);
      }

      translatedPages += 1;
      translatedLines += translatedByIndex.size;
    }

    const notes: string[] = [];
    if (fallbackGroups > 0) notes.push(`fallback groups ${fallbackGroups}`);
    if (fallbackLines > 0) notes.push(`fallback lines ${fallbackLines}`);
    if (sourceAssistLines > 0) notes.push(`source assist lines ${sourceAssistLines}`);
    if (deferredByPayloadBudget > 0) notes.push(`deferred pages ${deferredByPayloadBudget}`);
    if (skippedNoModelCache > 0) notes.push(`no-model-cache pages ${skippedNoModelCache}`);
    if (skippedNoText > 0) notes.push(`no-text pages ${skippedNoText}`);
    if (skippedPreservedOnly > 0) notes.push(`preserved-only pages ${skippedPreservedOnly}`);

    setTranslationStatus({
      kind: 'success',
      message: `ai batch | ${dominantSourceLanguage}->${normalizedTargetLanguage} | engine ${selectedEngine} translated ${translatedLines} lines across ${translatedPages} pages from original OCR in one request.${notes.length ? ` notes: ${notes.join(', ')}` : ''}`,
    });
  }, [
    buildGeminiContextOverrides,
    ensureDocumentId,
    ocrOptions.engine,
    ocrOptions.language,
    runCurrentPageTranslation,
    setTranslationCacheEntry,
    setTranslationStatus,
    sourceLanguage,
    targetLanguage,
    translationMode,
  ]);

  const runOfflineBatchDocumentTranslation = useCallback(async () => {
    const selectedEngine = (ocrOptions.engine || 'paddleocr') as OCREngine;
    const sortedPageNums = getModelScopedCachedPageNumbers();
    const targetEngine = offlineEngine === 'm2m100' ? 'm2m100' : 'offline';

    if (sortedPageNums.length === 0) {
      await runCurrentPageTranslation(targetEngine);
      return;
    }

    let translatedPages = 0;
    let skippedPages = 0;
    let failedPages = 0;

    for (let i = 0; i < sortedPageNums.length; i++) {
      const pageNum = sortedPageNums[i];
      setTranslationStatus({
        kind: 'info',
        message: `Offline Batch: translating page ${pageNum} (${i + 1}/${sortedPageNums.length})...`,
      });

      try {
        const translated = await runCurrentPageTranslation(targetEngine, pageNum, {
          suppressStatus: true,
          bypassPageCache: true,
        });
        if (translated) {
          translatedPages += 1;
        } else {
          skippedPages += 1;
        }
      } catch (error) {
        failedPages += 1;
        console.warn(`[OfflineBatch] Failed on page ${pageNum}:`, error);
      }
    }

    if (translatedPages === 0) {
      setTranslationStatus({
        kind: 'error',
        message: `offline batch did not translate any pages for engine ${selectedEngine}.`,
      });
      return;
    }

    const notes: string[] = [];
    if (skippedPages > 0) notes.push(`skipped ${skippedPages}`);
    if (failedPages > 0) notes.push(`failed ${failedPages}`);

    setTranslationStatus({
      kind: failedPages > 0 ? 'info' : 'success',
      message: `offline batch translated ${translatedPages} pages using ${selectedEngine}.${notes.length ? ` notes: ${notes.join(', ')}` : ''}`,
    });
  }, [
    getModelScopedCachedPageNumbers,
    ocrOptions.engine,
    offlineEngine,
    runCurrentPageTranslation,
    setTranslationStatus,
  ]);

  const handleOfflineTranslate = useCallback(async () => {
    if (isAiProcessing || isOfflineProcessing) return;
    setIsOfflineProcessing(true);

    setProgress({
      stage: 'ocr',
      currentPage: currentPage,
      totalPages: totalPages,
      message: 'กำลังตรวจหา cache หรือเริ่มตรวจจับข้อความ (OCR)...',
      progress: 15,
    });

    try {
      const ocrReady = await ensureCurrentPageOCRReadyForTranslation();
      if (!ocrReady) {
        setTranslationStatus({ kind: 'error', message: 'Auto OCR failed before offline translation.' });
        return;
      }

      setProgress({
        stage: 'text-layer',
        currentPage: currentPage,
        totalPages: totalPages,
        message: 'กำลังดำเนินการแปลภาษาแบบ Offline...',
        progress: 75,
      });

      setTranslationStatus({ kind: 'info', message: 'Running offline translation on current page...' });
      await runCurrentPageTranslation(offlineEngine === 'm2m100' ? 'm2m100' : 'offline');

      setProgress({
        stage: 'complete',
        currentPage: currentPage,
        totalPages: totalPages,
        message: `แปลภาษาเสร็จสมบูรณ์!`,
        progress: 100,
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (err) {
      console.error('Offline Translation Failed', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTranslationStatus({ kind: 'error', message: `Offline translation failed: ${message}` });
    } finally {
      setIsOfflineProcessing(false);
    }
  }, [
    currentPage,
    ensureCurrentPageOCRReadyForTranslation,
    isAiProcessing,
    isOfflineProcessing,
    offlineEngine,
    runCurrentPageTranslation,
    setIsOfflineProcessing,
    setProgress,
    setTranslationStatus,
    totalPages,
  ]);

  const handleAiTranslate = useCallback(async () => {
    if (isAiProcessing || isOfflineProcessing) return;
    setIsAiProcessing(true);

    setProgress({
      stage: 'ocr',
      currentPage: currentPage,
      totalPages: totalPages,
      message: 'กำลังตรวจหา cache หรือเริ่มตรวจจับข้อความ (OCR)...',
      progress: 15,
    });

    try {
      const ocrReady = await ensureCurrentPageOCRReadyForTranslation();
      if (!ocrReady) {
        setTranslationStatus({ kind: 'error', message: 'Auto OCR failed before AI translation.' });
        return;
      }

      setProgress({
        stage: 'text-layer',
        currentPage: currentPage,
        totalPages: totalPages,
        message: 'กำลังส่งข้อมูลไปแปลภาษาด้วย AI (Gemini)...',
        progress: 75,
      });

      setTranslationStatus({ kind: 'info', message: 'Running Gemini translation on current page...' });
      await runCurrentPageTranslation('ai');

      setProgress({
        stage: 'complete',
        currentPage: currentPage,
        totalPages: totalPages,
        message: `แปลภาษา AI เสร็จสมบูรณ์!`,
        progress: 100,
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (err) {
      console.error('AI Translation Failed', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTranslationStatus({ kind: 'error', message: `AI translation failed: ${message}` });
    } finally {
      setIsAiProcessing(false);
    }
  }, [
    currentPage,
    ensureCurrentPageOCRReadyForTranslation,
    isAiProcessing,
    isOfflineProcessing,
    runCurrentPageTranslation,
    setIsAiProcessing,
    setProgress,
    setTranslationStatus,
    totalPages,
  ]);

  const {
    handleOfflineTranslateAllPages,
    handleAiTranslateAllPages,
  } = useBatchDocumentTranslation({
    fileName,
    filePath,
    fileType,
    totalPages,
    ensureDocumentId,
    sourceLanguage,
    targetLanguage,
    translationMode,
    safetySettings,
    hasGeminiApiKey,
    ocrOptions,
    setTranslationStatus,
  });

  return {
    runCurrentPageTranslation,
    runAiBatchDocumentTranslation,
    runOfflineBatchDocumentTranslation,
    handleOfflineTranslate,
    handleAiTranslate,
    handleOfflineTranslateAllPages,
    handleAiTranslateAllPages,
    ensureCurrentPageOCRReadyForTranslation,
    ensureAllPagesOCRReadyForTranslation,
    requestAutoOCRFromPanel,
  };
}
