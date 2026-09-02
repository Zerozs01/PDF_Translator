import React, { useCallback, useRef } from 'react';
import type { OCREngine, OCRPageResult } from '../types';
import {
  useOCRTextLayerStore,
  buildOCRTranslationCacheKey,
  hasCurrentOCRTranslationCacheVersion,
} from '../stores/useOCRTextLayerStore';
import { useLayerStore } from '../stores/useLayerStore';
import { useProjectStore, type SafetySettings, type TranslationMode } from '../stores/useProjectStore';
import { dbService } from '../services/dbService';
import { translationCoordinator } from '../services/translation/translationCoordinator';
import type { TranslatableItem } from '../types/translation';
import { buildOCRSourceFingerprint } from '../services/ocrSourceFingerprint';
import {
  AUTO_OCR_REQUEST_EVENT,
  AUTO_OCR_RESULT_EVENT,
  type AutoOCRScope,
} from '../constants/translationConstants';
import {
  buildBatchMarkdownPayload,
  parseBatchJsonResponse,
  type BatchPageTranslationPlan,
} from '../services/translation/translationBatchService';
import {
  translateBatchOffline,
  evaluateUntranslatedTranslation,
  evaluateThaiCarryoverForEnglish,
  lookupShortPhraseTh,
} from '../services/translation/offlineTranslationService';
import {
  translateWithGemini,
  offlineBatchBridgeWrapper,
} from '../services/translation/translationBridge';
import { buildGeminiBasePrompt } from '../services/translation/geminiPromptBuilder';
import {
  restoreProtectedTokens,
} from '../services/translation/translationTokenProtection';
import {
  normalizeTranslationLanguage,
  normalizeThaiTranslationText,
  normalizeWhitespace,
} from '../services/ocr/ocrTextNormalizer';
import {
  buildLayerGroupsFromOCR,
  mergeLayersAndGroups,
} from '../services/layers/LayerGroupingService';
import {
  resolveSourceLanguageFromOCR,
  THAI_REGEX,
} from '../services/ocr/ocrTextHeuristics';
import {
  resolveModelScopedOriginalPageOCR,
  hasModelScopedCachedOCR,
} from './useExportOcrResolvers';
import { useBatchDocumentTranslation } from './translation/useBatchDocumentTranslation';
import {
  preparePageTranslationPlan,
  redistributeTranslatedGroups,
} from '../services/translation/pageTranslationPipeline';
import { executeOfflineAllPagesPipeline } from '../services/translation/offlineBatchPipeline';
import { useTranslationCacheResolver } from './translation/useTranslationCacheResolver';
import { useTranslationRetryManager } from './translation/useTranslationRetryManager';
import { useTranslationCachePersister } from './translation/useTranslationCachePersister';

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

  const { checkAndApplyDBCache } = useTranslationCacheResolver();
  const { evaluateAndApplyGroupRetries, applyLineLevelRetries } = useTranslationRetryManager();
  const { persistTranslationResult } = useTranslationCachePersister();

  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelSinglePageTranslation = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsOfflineProcessing(false);
    setIsAiProcessing(false);
    setTranslationStatus({
      kind: 'info',
      message: 'ยกเลิกการแปลหน้าปัจจุบันเรียบร้อยแล้ว (Translation canceled)',
    });
    setProgress({
      stage: 'complete',
      currentPage,
      totalPages,
      message: 'ยกเลิกการแปลแล้ว',
      progress: 0,
    });
  }, [currentPage, totalPages, setIsOfflineProcessing, setIsAiProcessing, setTranslationStatus, setProgress]);

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
      signal?: AbortSignal;
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
    const effectiveTranslationMode = options?.translationMode || translationMode;

    const activeDocId = useProjectStore.getState().documentId;
    const matchedDocId = options?.documentIdOverride ?? (await ensureDocumentId().catch(() => null));
    const isActiveDoc = matchedDocId !== null && activeDocId !== null && activeDocId === matchedDocId;

    // 0. Verify and synchronously initialize store layers if missing or stale
    const layerStore = useLayerStore.getState();
    const existingLayers = layerStore.getPageLayers(pageNum);
    const hasUserModifications = existingLayers.some((l) => l.userEdited || l.id.startsWith('manual-layer-'))
      || layerStore.getPageGroups(pageNum).some((g) => g.userCreated);

    if (existingLayers.length === 0 || !hasUserModifications) {
      try {
        const isStoreStale = existingLayers.length === 0
          || existingLayers.length !== pageOCR.lines.length
          || existingLayers.some((l) => l.lineIndex >= pageOCR.lines.length)
          || (existingLayers.length > 0 && !hasUserModifications && existingLayers.some((l, idx) => l.sourceText !== String(pageOCR.lines[idx]?.text || '').replace(/\s+/g, ' ').trim()));

        if (isStoreStale) {
          const initialLayerResult = buildLayerGroupsFromOCR(pageOCR);
          layerStore.setPageLayers(pageNum, initialLayerResult);
          console.log(`[TranslationSync] Synchronously initialized store layers for page ${pageNum}.`);
        }
      } catch (err) {
        console.warn('[TranslationSync] Failed to verify/rebuild store layers:', err);
      }
    }

    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // 1. Check DB Cache
    const cacheHit = await checkAndApplyDBCache(
      matchedDocId,
      pageNum,
      pageOCR,
      (pageOCR.ocrEngine || selectedEngine) as OCREngine,
      normalizedTargetLanguage,
      resolvedSourceFromOCR,
      engine,
      effectiveTranslationMode,
      isActiveDoc,
      {
        bypassPageCache: options?.bypassPageCache,
        suppressStatus: options?.suppressStatus,
      }
    );

    if (cacheHit) {
      if (!options?.suppressStatus && isActiveDoc) {
        setTranslationStatus({
          kind: 'success',
          message: `Loaded translation cache for page ${pageNum} (${(pageOCR.ocrEngine || selectedEngine)} -> ${normalizedTargetLanguage}).`,
        });
      }
      return true;
    }

    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // 2. Prepare Translatable Lines & Groups
    const alternativePages = (selectedEngine !== 'paddleocr')
      ? Array.from(ocrState.ocrByPageEngine.get(pageNum)?.entries() || [])
        .filter(([engineKey, candidate]) => engineKey !== selectedEngine && candidate && Array.isArray(candidate.lines) && candidate.lines.length > 0)
        .map(([, candidate]) => candidate!)
      : [];

    const currentLayers = useLayerStore.getState().getPageLayers(pageNum);

    const plan = preparePageTranslationPlan(pageNum, pageOCR, selectedEngine, {
      layerOverrides: currentLayers,
      alternativeEnginePages: alternativePages,
      ocrLanguageOverride: ocrLanguageKey,
      userSourceLanguage: normalizedUserSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      translationMode: effectiveTranslationMode,
      engine,
    });

    if (!plan || plan.preparedGroups.length === 0) {
      if (!options?.suppressStatus) {
        setTranslationStatus({
          kind: 'error',
          message: `No translatable OCR lines or groups on page ${pageNum}.`,
        });
      }
      return false;
    }

    // Phase 2: Auto-detect & Sync Source & OCR Language if detected with high confidence
    if (plan.detectedLanguageSwitch) {
      const { sourceLanguage: detectedSource, ocrLanguageKey: detectedOcr, languageName } = plan.detectedLanguageSwitch;
      const currentProjectSource = useProjectStore.getState().sourceLanguage;
      const currentOcrLang = useOCRTextLayerStore.getState().options.language;
      if (currentProjectSource !== detectedSource || !currentOcrLang.includes(detectedOcr)) {
        console.log(`[LanguageAutoSync] Detected ${languageName} (${detectedSource}/${detectedOcr}). Auto-syncing stores.`);
        useProjectStore.getState().setSourceLanguage(detectedSource);
        useOCRTextLayerStore.getState().setOptions({ language: detectedOcr });
        if (!options?.suppressStatus) {
          setTranslationStatus({
            kind: 'info',
            message: `ตรวจพบภาษา ${languageName} (${detectedSource.toUpperCase()}) อัตโนมัติ — ระบบได้ปรับภาษาต้นทางให้เรียบร้อยแล้ว`,
          });
        }
      }
    }

    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    let translatedGroupsRaw = new Array<string>(plan.preparedGroups.length).fill('');
    const mapTranslationResults = (results: Array<{ id: string; translatedText: string }>) => {
      const nextRaw = new Array<string>(plan.preparedGroups.length).fill('');
      results.forEach((res) => {
        const idx = Number(res.id);
        if (!Number.isNaN(idx) && idx >= 0 && idx < nextRaw.length) {
          nextRaw[idx] = res.translatedText;
        }
      });
      return nextRaw;
    };

    const translatableItems: TranslatableItem[] = plan.preparedGroups.map((group, groupIndex) => {
      const sampleLine = group.lines[0];
      let groupType: any = 'ungrouped';
      if (sampleLine) {
        const matchingLayer = currentLayers.find((l) => l.lineIndex === sampleLine.index);
        if (matchingLayer && matchingLayer.groupId) {
          const pageGroups = useLayerStore.getState().getPageGroups(pageNum);
          const layerGroup = pageGroups.find((g) => g.id === matchingLayer.groupId);
          if (layerGroup) {
            groupType = layerGroup.groupType;
          }
        }
      }

      return {
        id: String(groupIndex),
        text: group.protectedText || group.sourceText || '',
        groupType,
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
          sourceLanguage: plan.translationSourceLanguage,
          targetLanguage: normalizedTargetLanguage,
          translationMode: effectiveTranslationMode,
          translateBatchOffline: (texts, type, mode, src, tgt, batchEngine) =>
            translateBatchOffline(texts, type, mode, src, tgt, offlineBatchBridgeWrapper, batchEngine || offlineEngine),
          translateBatchGemini: (texts, type, mode, src, tgt) =>
            translateBatchOffline(texts, type, mode, src, tgt, offlineBatchBridgeWrapper, offlineEngine),
        }
      );

      const hasFailedItem = translationResults.some((r) => !r.success);
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
              sourceLanguage: plan.translationSourceLanguage,
              targetLanguage: normalizedTargetLanguage,
              translationMode: effectiveTranslationMode,
              translateBatchOffline: (texts, type, mode, src, tgt, batchEngine) =>
                translateBatchOffline(texts, type, mode, src, tgt, offlineBatchBridgeWrapper, batchEngine || offlineEngine),
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
      const restored = restoreProtectedTokens(text, plan.preparedGroups[index]?.replacements || []);
      if (normalizedTargetLanguage === 'th') {
        return normalizeThaiTranslationText(restored);
      }
      return restored;
    });

    if (engine === 'offline' && plan.translationSourceLanguage === 'th' && normalizedTargetLanguage === 'en') {
      const carryover = evaluateThaiCarryoverForEnglish(plan.preparedGroups, translatedGroups, normalizedTargetLanguage);
      if (carryover.shouldFallback && hasGeminiApiKey) {
        try {
          const fallbackResults = await translationCoordinator.runTranslation(
            'gemini',
            translatableItems,
            {
              sourceLanguage: plan.translationSourceLanguage,
              targetLanguage: normalizedTargetLanguage,
              translationMode: effectiveTranslationMode,
              translateBatchOffline: (texts, type, mode, src, tgt) =>
                translateBatchOffline(texts, type, mode, src, tgt, offlineBatchBridgeWrapper, offlineEngine),
            }
          );
          translatedGroupsRaw = mapTranslationResults(fallbackResults);
          translatedGroups = translatedGroupsRaw.map((text, index) => {
            const restored = restoreProtectedTokens(text, plan.preparedGroups[index]?.replacements || []);
            return normalizeWhitespace(String(restored || ''));
          });
          effectiveEngine = 'ai';
          const thaiPct = Math.round(carryover.thaiRatio * 100);
          const carryPct = Math.round(carryover.carryoverRatio * 100);
          fallbackNote = ` fallback: offline->ai (${thaiPct}% Thai, ${carryPct}% carryover).`;
        } catch (fallbackError) {
          console.warn('[TranslationCoordinator] Gemini fallback failed:', fallbackError);
        }
      }
    }

    // 3. Evaluate Group Retries
    const { groupLineOverrides, groupRetryAppliedCount } = await evaluateAndApplyGroupRetries({
      preparedGroups: plan.preparedGroups,
      translatedGroups,
      effectiveEngine,
      effectiveTranslationMode,
      normalizedTargetLanguage,
      targetLanguage: options?.targetLanguage || targetLanguage,
    });

    // 4. Redistribute translated groups into line-level text
    const translatedByIndex = redistributeTranslatedGroups(plan, translatedGroups, groupLineOverrides);

    // 5. Line-level retry candidates
    const retryLineMap = new Map<number, { index: number; sourceText: string; sourceLanguage: string }>();
    plan.translatableLines.forEach((line) => {
      const lineText = translatedByIndex.get(line.index);
      if (lineText && normalizedTargetLanguage === 'th' && !/[\u0E00-\u0E7F]/.test(lineText)) {
        const directTranslation = lookupShortPhraseTh(line.text);
        if (!directTranslation) {
          retryLineMap.set(line.index, {
            index: line.index,
            sourceText: line.text,
            sourceLanguage: plan.translationSourceLanguage,
          });
        }
      }
    });

    const { appliedMap: retryAppliedMap, retryAppliedCount } = await applyLineLevelRetries(
      retryLineMap,
      effectiveEngine,
      effectiveTranslationMode,
      plan.translationSourceLanguage,
      normalizedTargetLanguage,
      options?.targetLanguage || targetLanguage,
      buildGeminiContextOverrides(effectiveTranslationMode, plan.translationSourceLanguage, normalizedTargetLanguage)
    );

    retryAppliedMap.forEach((text, index) => {
      translatedByIndex.set(index, text);
    });

    // 6. Translation Health Check
    const translationHealth = evaluateUntranslatedTranslation(
      plan.translatableLines,
      translatedByIndex,
      plan.translationSourceLanguage,
      normalizedTargetLanguage
    );

    if (translationHealth.shouldSkip && isActiveDoc) {
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

    // 7. Persist Result & Sync Stores
    await persistTranslationResult({
      pageNum,
      pageOCR: plan.pageOCR,
      ocrEngine: plan.ocrEngine,
      ocrLanguageKey: plan.ocrLanguageKey,
      sourceLanguage: plan.translationSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      effectiveTranslationMode,
      effectiveEngine,
      translatedByIndex,
      groupCount: plan.preparedGroups.length,
      isActiveDoc,
      cacheDocId: matchedDocId,
    });

    const totalPageCaches = useOCRTextLayerStore.getState().getTranslationCacheEntries(pageNum).length;
    const groupRetryHint = groupRetryAppliedCount > 0 ? ` group retries applied: ${groupRetryAppliedCount}.` : '';
    const preservedHint = plan.preservedSourceLineCount > 0 ? ` preserved-only lines skipped: ${plan.preservedSourceLineCount}.` : '';
    const crossEngineHint = plan.crossEngineAssistCount > 0 ? ` source assist: ${plan.crossEngineAssistCount} lines.` : '';

    if (!options?.suppressStatus) {
      setTranslationStatus({
        kind: 'success',
        message: `${effectiveEngine} | ${plan.translationSourceLanguage}->${normalizedTargetLanguage} | ${ocrLanguageKey} | profile=${plan.groupingProfile} translated ${translatedByIndex.size} lines in ${plan.preparedGroups.length} grouped segments on page ${pageNum}.${groupRetryHint} line retries: ${retryAppliedCount}/${retryLineMap.size}. cache slots: ${totalPageCaches}.${crossEngineHint}${preservedHint}${fallbackNote}`,
      });
    }

    return true;
  }, [
    applyLineLevelRetries,
    buildGeminiContextOverrides,
    checkAndApplyDBCache,
    currentPage,
    ensureDocumentId,
    evaluateAndApplyGroupRetries,
    hasGeminiApiKey,
    ocrOptions.engine,
    ocrOptions.language,
    offlineEngine,
    persistTranslationResult,
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
    let sourceAssistLines = 0;
    const maxPayloadChars = 120000;
    let runningPayloadEstimate = 1400;

    for (const pageNum of sortedPageNums) {
      const pageOCR = resolveModelScopedOriginalPageOCR(ocrState, pageNum, selectedEngine);
      if (!pageOCR || !pageOCR.lines || pageOCR.lines.length === 0) continue;

      const alternativePages = (selectedEngine !== 'paddleocr')
        ? Array.from(ocrState.ocrByPageEngine.get(pageNum)?.entries() || [])
          .filter(([engineKey, candidate]) => engineKey !== selectedEngine && candidate && Array.isArray(candidate.lines) && candidate.lines.length > 0)
          .map(([, candidate]) => candidate!)
        : [];

      const plan = preparePageTranslationPlan(pageNum, pageOCR, selectedEngine, {
        alternativeEnginePages: alternativePages,
        ocrLanguageOverride: ocrOptions.language,
        userSourceLanguage: normalizedUserSourceLanguage,
        targetLanguage: normalizedTargetLanguage,
        translationMode,
        engine: 'ai',
      });

      if (!plan || plan.preparedGroups.length === 0) continue;
      sourceAssistLines += plan.crossEngineAssistCount;

      const batchPlan: BatchPageTranslationPlan = {
        pageNum,
        ocr: plan.pageOCR,
        ocrEngine: plan.ocrEngine,
        ocrLanguageKey: plan.ocrLanguageKey,
        sourceLanguage: plan.translationSourceLanguage,
        lines: plan.translatableLines,
        groups: plan.preparedGroups,
        groupingProfile: plan.groupingProfile,
      };

      const pageEstimate = 260 + plan.preparedGroups.reduce((sum, group) => sum + String(group.protectedText || '').length + 28, 0);
      if (runningPayloadEstimate + pageEstimate > maxPayloadChars && plans.length > 0) {
        continue;
      }

      runningPayloadEstimate += pageEstimate;
      plans.push(batchPlan);
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

    for (const batchPlan of plans) {
      const translatedGroupMap = translatedByPage.get(batchPlan.pageNum) || new Map<number, string>();
      const translatedGroups = batchPlan.groups.map((group) => {
        const candidateGroupText = normalizeWhitespace(String(translatedGroupMap.get(group.index) || ''));
        const restored = restoreProtectedTokens(candidateGroupText || group.sourceText, group.replacements);
        return normalizedTargetLanguage === 'th' ? normalizeThaiTranslationText(restored) : normalizeWhitespace(restored);
      });

      const pagePlan = preparePageTranslationPlan(batchPlan.pageNum, batchPlan.ocr, batchPlan.ocrEngine, {
        ocrLanguageOverride: batchPlan.ocrLanguageKey,
        userSourceLanguage: dominantSourceLanguage,
        targetLanguage: normalizedTargetLanguage,
        translationMode,
        engine: 'ai',
      });

      if (!pagePlan) continue;

      const translatedByIndex = redistributeTranslatedGroups(pagePlan, translatedGroups);

      await persistTranslationResult({
        pageNum: batchPlan.pageNum,
        pageOCR: batchPlan.ocr,
        ocrEngine: batchPlan.ocrEngine,
        ocrLanguageKey: batchPlan.ocrLanguageKey,
        sourceLanguage: batchPlan.sourceLanguage,
        targetLanguage: normalizedTargetLanguage,
        effectiveTranslationMode: translationMode,
        effectiveEngine: 'ai',
        translatedByIndex,
        groupCount: batchPlan.groups.length,
        isActiveDoc: true,
        cacheDocId,
      });

      translatedPages += 1;
      translatedLines += translatedByIndex.size;
    }

    setTranslationStatus({
      kind: 'success',
      message: `ai batch | ${dominantSourceLanguage}->${normalizedTargetLanguage} | engine ${selectedEngine} translated ${translatedLines} lines across ${translatedPages} pages in one request.`,
    });
  }, [
    buildGeminiContextOverrides,
    ensureDocumentId,
    ocrOptions.engine,
    ocrOptions.language,
    persistTranslationResult,
    runCurrentPageTranslation,
    setTranslationStatus,
    sourceLanguage,
    targetLanguage,
    translationMode,
  ]);

  const runOfflineBatchDocumentTranslation = useCallback(async () => {
    const selectedEngine = (ocrOptions.engine || 'paddleocr') as OCREngine;
    const sortedPageNums = getModelScopedCachedPageNumbers();

    if (sortedPageNums.length === 0) {
      await runCurrentPageTranslation(offlineEngine === 'm2m100' ? 'm2m100' : 'offline');
      return;
    }

    const docId = await ensureDocumentId().catch(() => null);

    setTranslationStatus({
      kind: 'info',
      message: `Offline Batch: กำลังเริ่มแปล ${sortedPageNums.length} หน้าพร้อมกันด้วย Sliding Window...`,
    });

    const result = await executeOfflineAllPagesPipeline(sortedPageNums, selectedEngine, {
      concurrency: 2,
      ocrLanguage: ocrOptions.language,
      sourceLanguage,
      targetLanguage,
      translationMode,
      documentIdOverride: docId || undefined,
      onProgress: (prog) => {
        setTranslationStatus({
          kind: 'info',
          message: prog.message,
        });
      },
    });

    if (result.translatedPages === 0) {
      setTranslationStatus({
        kind: 'error',
        message: `Offline batch did not translate any pages for engine ${selectedEngine}.`,
      });
      return;
    }

    setTranslationStatus({
      kind: result.failedPages > 0 ? 'info' : 'success',
      message: `Offline batch translated ${result.translatedPages} pages (${result.totalLines} lines) using ${selectedEngine}.${result.failedPages > 0 ? ` (failed: ${result.failedPages})` : ''}`,
    });
  }, [
    ensureDocumentId,
    getModelScopedCachedPageNumbers,
    ocrOptions.engine,
    ocrOptions.language,
    offlineEngine,
    runCurrentPageTranslation,
    setTranslationStatus,
    sourceLanguage,
    targetLanguage,
    translationMode,
  ]);

  const handleOfflineTranslate = useCallback(async () => {
    if (isAiProcessing || isOfflineProcessing) return;
    setIsOfflineProcessing(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    setProgress({
      stage: 'ocr',
      currentPage,
      totalPages,
      message: 'กำลังตรวจหา cache หรือเริ่มตรวจจับข้อความ (OCR)...',
      progress: 15,
    });

    try {
      if (signal.aborted) return;
      const ocrReady = await ensureCurrentPageOCRReadyForTranslation();
      if (signal.aborted) return;
      if (!ocrReady) {
        setTranslationStatus({ kind: 'error', message: 'Auto OCR failed before offline translation.' });
        return;
      }

      setProgress({
        stage: 'text-layer',
        currentPage,
        totalPages,
        message: 'กำลังดำเนินการแปลภาษาแบบ Offline...',
        progress: 75,
      });

      setTranslationStatus({ kind: 'info', message: 'Running offline translation on current page...' });
      if (signal.aborted) return;
      await runCurrentPageTranslation(offlineEngine === 'm2m100' ? 'm2m100' : 'offline', currentPage, { signal });

      if (signal.aborted) return;
      setProgress({
        stage: 'complete',
        currentPage,
        totalPages,
        message: `แปลภาษาเสร็จสมบูรณ์!`,
        progress: 100,
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') {
        console.log('[OfflineTranslate] Canceled by user.');
        return;
      }
      console.error('Offline Translation Failed', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTranslationStatus({ kind: 'error', message: `Offline translation failed: ${message}` });
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
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

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    setProgress({
      stage: 'ocr',
      currentPage,
      totalPages,
      message: 'กำลังตรวจหา cache หรือเริ่มตรวจจับข้อความ (OCR)...',
      progress: 15,
    });

    try {
      if (signal.aborted) return;
      const ocrReady = await ensureCurrentPageOCRReadyForTranslation();
      if (signal.aborted) return;
      if (!ocrReady) {
        setTranslationStatus({ kind: 'error', message: 'Auto OCR failed before AI translation.' });
        return;
      }

      setProgress({
        stage: 'text-layer',
        currentPage,
        totalPages,
        message: 'กำลังส่งข้อมูลไปแปลภาษาด้วย AI (Gemini)...',
        progress: 75,
      });

      setTranslationStatus({ kind: 'info', message: 'Running Gemini translation on current page...' });
      if (signal.aborted) return;
      await runCurrentPageTranslation('ai', currentPage, { signal });

      if (signal.aborted) return;
      setProgress({
        stage: 'complete',
        currentPage,
        totalPages,
        message: `แปลภาษา AI เสร็จสมบูรณ์!`,
        progress: 100,
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (err: any) {
      if (signal.aborted || err?.name === 'AbortError') {
        console.log('[AiTranslate] Canceled by user.');
        return;
      }
      console.error('AI Translation Failed', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTranslationStatus({ kind: 'error', message: `AI translation failed: ${message}` });
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
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
    cancelSinglePageTranslation,
    handleOfflineTranslateAllPages,
    handleAiTranslateAllPages,
    ensureCurrentPageOCRReadyForTranslation,
    ensureAllPagesOCRReadyForTranslation,
    requestAutoOCRFromPanel,
  };
}
