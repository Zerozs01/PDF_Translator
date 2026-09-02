import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useSegmentationStore } from '../../stores/useSegmentationStore';
import { useOCRTextLayerStore } from '../../stores/useOCRTextLayerStore';
import { OCREngine } from '../../types';
import { useLayerStore } from '../../stores/useLayerStore';
import type { TextLayer, TextLayerGroup } from '../../types/layers';
import { InteractiveLayerOverlay } from '../Layers/InteractiveLayerOverlay';
import {
  clampOverlayRect,
  computeOverlayTypography,
  computeOverlayLayoutMap,
  DEFAULT_OVERLAY_PALETTE,
  estimateLineRotationDeg,
  normalizeOverlayInlineText,
  resolveOverlayMaskBBox,
  resolveOverlayMaskExpansion,
  type OverlayPalette,
  type OverlayLayout,
  type OverlayLayoutProfile,
  type OverlayTypography,
  resolveTranslationOverlayContext,
  resolveOverlaySourceBBox,
  shouldSkipOverlayRenderForSuspiciousLine,
  sampleOverlayPaletteFromLine,
  sampleOverlayPalettesBatch,
} from '../OCR/translationOverlayUtils';
import { resolveOverlayFontFamily } from '../../constants/overlayFonts';
import { buildTextSearchPattern, collectTextSearchMatches, hasTextSearchMatch, type TextSearchPattern } from '../../services/textSearch';
import { buildLayerGroupsFromOCR, mergeLayersAndGroups } from '../../services/layers/LayerGroupingService';
import { lookupShortPhraseTh } from '../../services/translation/offlineTranslationService';
import { isKnownShortWordHelper } from '../../services/ocr/ocrSafetyLineDedup';
import { OverlayLineItem } from './OverlayLineItem';

// ─── Helper Functions ───────────────────────────────────────────

const formatOverlayRatioLabel = (value: number): string => `${Math.max(1, Math.round(value * 100))}%`;

const DOCUMENT_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|reaction|unknowns?|equilibrium|rigid|body|support|diagram|objective|objectives|connection|connections|continued|force|moment|component|unknown|column|columns|bridge|building|beam|beams|welded|surface|bracket|cable|utility|floor|member|pin|hinge)\b/i;

const shouldUseDocumentCoverageFallback = (sourceText: string): boolean => {
  const normalized = normalizeOverlayInlineText(String(sourceText || ''));
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/g).filter(Boolean).length;
  const thaiCharCount = (normalized.match(/[\u0E00-\u0E7F]/g) || []).length;
  const technicalLike = DOCUMENT_SOURCE_HINT_REGEX.test(normalized);
  const numericDocumentLike = wordCount >= 6 && /[0-9()\-]/.test(normalized);
  const thaiDocumentLike = thaiCharCount >= 12
    && (wordCount >= 3 || /[0-9()\[\].,:;\-]/.test(normalized));
  return technicalLike || numericDocumentLike || thaiDocumentLike;
};

export const isSourceFallbackOverlayText = (sourceText: string, translatedText: string): boolean => {
  const source = normalizeOverlayInlineText(String(sourceText || ''));
  const translated = normalizeOverlayInlineText(String(translatedText || ''));
  if (Boolean(source && translated && source === translated)) return true;

  const sourceKey = String(sourceText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');
  const translatedKey = String(translatedText || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');
  return Boolean(sourceKey && translatedKey && sourceKey === translatedKey);
};


const getOffsetRelativeTo = (child: HTMLElement, ancestor: HTMLElement) => {
  let x = 0;
  let y = 0;
  let el: HTMLElement | null = child;
  while (el && el !== ancestor) {
    x += el.offsetLeft || 0;
    y += el.offsetTop || 0;
    el = el.offsetParent as HTMLElement | null;
  }
  return { x, y };
};

const EMPTY_ARRAY: any[] = [];

// ─── PDFPageOverlay Component ───────────────────────────────────

export const PDFPageOverlay: React.FC<{
  pageNum: number;
  pageRef: React.RefObject<HTMLDivElement | null>;
  pageRenderTick: number;
  isVisible: boolean;
  previewModeOverride?: 'original' | 'translated';
}> = React.memo(({ pageNum, pageRef, pageRenderTick, isVisible, previewModeOverride }) => {
  const isCurrentPage = useProjectStore((s) => s.currentPage === pageNum);
  const sourceLanguage = useProjectStore((s) => s.sourceLanguage);
  const targetLanguage = useProjectStore((s) => s.targetLanguage);
  const translationMode = useProjectStore((s) => s.translationMode);
  const overlayThaiFontEnabled = useProjectStore((s) => s.overlayThaiFontEnabled);
  const overlayFontPreset = useProjectStore((s) => s.overlayFontPreset);
  const overlayFontSizeScale = useProjectStore((s) => s.overlayFontSizeScale);

  const activeTool = useUIStore((s) => s.activeTool);
  const regions = useSegmentationStore((s) => s.regions);

  const showDebugOverlay = useOCRTextLayerStore((s) => s.showDebugOverlay);
  const storePreviewMode = useOCRTextLayerStore((s) => s.translationPreviewMode);
  const translationPreviewMode = previewModeOverride || storePreviewMode;
  const ocrResultSearchQuery = useOCRTextLayerStore((s) => s.ocrResultSearchQuery);
  const options = useOCRTextLayerStore((s) => s.options);

  const currentPageOCR = useOCRTextLayerStore((s) => {
    const selectedEngine = s.options.engine || 'paddleocr';
    const byEngine = s.ocrByPageEngine.get(pageNum)?.get(selectedEngine);
    if (byEngine) return byEngine;
    return s.allPagesOCR.get(pageNum);
  });

  const effectiveOCREngine = useOCRTextLayerStore((s) => {
    const selectedEngine = s.options.engine || 'paddleocr';
    const byEngine = s.ocrByPageEngine.get(pageNum)?.get(selectedEngine);
    if (byEngine) return selectedEngine;
    const fallback = s.allPagesOCR.get(pageNum);
    return fallback?.ocrEngine || selectedEngine;
  });

  const pageOCRsByEngine = useOCRTextLayerStore((s) => s.ocrByPageEngine.get(pageNum));
  const currentPageTranslationMap = useOCRTextLayerStore((s) => s.translationCacheByPage.get(pageNum));
  const activeTranslationKey = useOCRTextLayerStore((s) => s.activeTranslationKeyByPage.get(pageNum));

  const rawCurrentPageLayers = useLayerStore((s) => s.layersByPage.get(pageNum) || (EMPTY_ARRAY as TextLayer[]));
  const rawCurrentPageGroups = useLayerStore((s) => s.groupsByPage.get(pageNum) || (EMPTY_ARRAY as TextLayerGroup[]));
  const editingLayerId = useLayerStore((s) => s.editingLayerId);
  const deletedLineIndexes = useLayerStore((s) => s.deletedLineIndexesByPage.get(pageNum));

  const [ocrOverlayTransform, setOcrOverlayTransform] = useState({
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0
  });
  const [translatedLinePalette, setTranslatedLinePalette] = useState<Map<number, OverlayPalette>>(new Map());

  const resolveEngineScopedPageOCR = (pNum: number) => {
    const byEngine = pageOCRsByEngine?.get(effectiveOCREngine as OCREngine);
    if (byEngine) return { ocr: byEngine, effectiveEngine: effectiveOCREngine };

    const fallback = useOCRTextLayerStore.getState().allPagesOCR.get(pNum);
    if (!fallback) return undefined;
    const fallbackEngine = (fallback.ocrEngine || effectiveOCREngine);
    return { ocr: fallback, effectiveEngine: fallbackEngine };
  };

  const resolvedPageOCR = resolveEngineScopedPageOCR(pageNum);
  const currentPageOCRResolved = resolvedPageOCR?.ocr || currentPageOCR;
  const effectiveOCREngineResolved = resolvedPageOCR?.effectiveEngine || effectiveOCREngine;

  const translationOverlayContext = useMemo(() => resolveTranslationOverlayContext({
    currentPageOCR: currentPageOCRResolved,
    optionsEngine: effectiveOCREngineResolved as any,
    optionsLanguage: options.language || 'eng',
    translationMode,
    sourceLanguage,
    targetLanguage,
    translationPreviewMode,
    currentPageTranslationMap,
    activeTranslationKey,
    pageOCRsByEngine,
  }), [
    activeTranslationKey,
    currentPageOCRResolved,
    currentPageTranslationMap,
    effectiveOCREngineResolved,
    options.language,
    sourceLanguage,
    targetLanguage,
    translationMode,
    translationPreviewMode,
    pageOCRsByEngine,
  ]);

  // Real-Time Layer Ghost Noise Filter: surgical cleanup of spiky balloon border layers in frontend view
  const currentPageLayers = useMemo(() => {
    const thaiLayers = rawCurrentPageLayers.filter(l => 
      l && l.visible && /[\u0E00-\u0E7F]/.test(String(l.text || ''))
    );

    return rawCurrentPageLayers.filter((layer) => {
      if (!layer) return false;
      if (layer.userEdited) return true;

      const sourceText = String(layer.sourceText || '').trim();
      const currentText = String(layer.text || '').trim();
      const text = sourceText || currentText;
      if (!text) return false;

      const compact = text.replace(/\s+/g, '');
      const compactUpper = compact.toUpperCase();
      if (compactUpper === 'AAAANLWAL') return false; // Garbage filter

      if (compactUpper === 'BELIEVE') {
        const hasOverlapWithThai = thaiLayers.some(thaiLayer => {
          if (!layer.bbox || !thaiLayer.bbox) return false;
          const areaA = (layer.bbox.x1 - layer.bbox.x0) * (layer.bbox.y1 - layer.bbox.y0);
          if (areaA <= 0) return false;
          
          const interX0 = Math.max(layer.bbox.x0, thaiLayer.bbox.x0);
          const interY0 = Math.max(layer.bbox.y0, thaiLayer.bbox.y0);
          const interX1 = Math.min(layer.bbox.x1, thaiLayer.bbox.x1);
          const interY1 = Math.min(layer.bbox.y1, thaiLayer.bbox.y1);
          
          const interArea = Math.max(0, interX1 - interX0) * Math.max(0, interY1 - interY0);
          return (interArea / areaA) >= 0.7;
        });
        if (hasOverlapWithThai) {
          return false;
        }
      }

      const asciiCompact = compact.replace(/[^A-Za-z0-9]/g, '');
      const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(sourceText)
        || /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(currentText);

      const isPureSymbolNoise = !hasCjkOrThai && asciiCompact.length === 0;
      if (isPureSymbolNoise) return false;

      const isVerticalLineJunk = !hasCjkOrThai && /^[lI1|!/\\_\-]+$/i.test(compact) && !/^[IAO]$/i.test(asciiCompact);
      if (isVerticalLineJunk) return false;

      const isSingleCharJunk = !hasCjkOrThai && asciiCompact.length === 1 && !/^[IAO]$/i.test(asciiCompact) && !/^[0-9]$/.test(asciiCompact);
      if (isSingleCharJunk) return false;

      const bbox = layer.bbox;
      if (bbox) {
        const width = Math.max(1, Number(bbox.x1 || 0) - Number(bbox.x0 || 0));
        const height = Math.max(1, Number(bbox.y1 || 0) - Number(bbox.y0 || 0));
        const area = width * height;

        const isKnownShortWord = isKnownShortWordHelper(asciiCompact)
          || Boolean(lookupShortPhraseTh(sourceText))
          || Boolean(lookupShortPhraseTh(currentText))
          || Boolean(lookupShortPhraseTh(asciiCompact));
        const isTinyJunkBox = !hasCjkOrThai && asciiCompact.length <= 3 && area <= 8000 && !isKnownShortWord;

        if (isTinyJunkBox) return false;
      }

      return true;
    });
  }, [rawCurrentPageLayers]);

  // Synchronized groups filter to strip ghost layers and drop empty groups on Canvas
  const currentPageGroups = useMemo(() => {
    const activeLayerIds = new Set(currentPageLayers.map(l => l.id));
    return rawCurrentPageGroups.map(group => {
      const filteredLayerIds = group.layerIds.filter(id => activeLayerIds.has(id));
      return { ...group, layerIds: filteredLayerIds };
    }).filter(group => group.layerIds.length > 0);
  }, [rawCurrentPageGroups, currentPageLayers]);

  const hiddenLineIndexes = useMemo(() => {
    const hidden = new Set(currentPageLayers.filter(l => !l.visible).map(l => l.lineIndex));
    const editingLayer = currentPageLayers.find(l => l.id === editingLayerId);
    if (editingLayer) {
      hidden.add(editingLayer.lineIndex);
    }
    const deletedForPage = deletedLineIndexes;
    if (deletedForPage) {
      deletedForPage.forEach(idx => hidden.add(idx));
    }
    return hidden;
  }, [currentPageLayers, editingLayerId, deletedLineIndexes, pageNum]);

  const hasLayers = rawCurrentPageLayers.length > 0;

  const lastPageNumRef = useRef<number>(pageNum);
  const lastBuiltEngineRef = useRef<string | null>(null);
  const lastBuiltOcrRef = useRef<any>(null);
  const lastBuiltPreviewModeRef = useRef<string | null>(null);
  const lastBuiltTranslationMapRef = useRef<Map<number, string>>(new Map());
  const hasBuiltLayersForCurrentPageRef = useRef<boolean>(false);

  // Reset build refs if the component is reused for a different page number
  if (lastPageNumRef.current !== pageNum) {
    lastPageNumRef.current = pageNum;
    hasBuiltLayersForCurrentPageRef.current = false;
    lastBuiltEngineRef.current = null;
    lastBuiltOcrRef.current = null;
    lastBuiltPreviewModeRef.current = null;
    lastBuiltTranslationMapRef.current = new Map();
  }

  const samplingCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [liveUpdateTick, setLiveUpdateTick] = useState(0);

  useEffect(() => {
    const handleLiveUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<{ pageNum: number }>;
      if (customEvent.detail?.pageNum === pageNum) {
        setLiveUpdateTick((t) => t + 1);
      }
    };
    window.addEventListener('page-translation-updated', handleLiveUpdate);
    return () => window.removeEventListener('page-translation-updated', handleLiveUpdate);
  }, [pageNum]);

  useEffect(() => {
    if (!currentPageOCRResolved || !currentPageOCRResolved.lines || currentPageOCRResolved.lines.length === 0) return;

    const layers = useLayerStore.getState().layersByPage.get(pageNum) || [];
    const newEngine = String(currentPageOCRResolved.ocrEngine || 'paddleocr').toLowerCase();
    
    const lastEngine = lastBuiltEngineRef.current;
    const engineChanged = lastEngine !== null && lastEngine !== newEngine;
    const ocrDataChanged = lastBuiltOcrRef.current !== null && lastBuiltOcrRef.current !== currentPageOCRResolved;
    const lastPreviewMode = lastBuiltPreviewModeRef.current;
    const previewModeChanged = lastPreviewMode !== null && lastPreviewMode !== translationPreviewMode;

    const currentTranslationMap = translationOverlayContext.translatedByIndex;
    const lastTranslationMap = lastBuiltTranslationMapRef.current;
    
    // Check if the contents of the translation map actually changed (avoiding object reference drift loop)
    let translationChanged = false;
    if (currentTranslationMap.size !== lastTranslationMap.size) {
      translationChanged = true;
    } else {
      for (const [key, val] of currentTranslationMap) {
        if (lastTranslationMap.get(key) !== val) {
          translationChanged = true;
          break;
        }
      }
    }

    // Trigger rebuild only if:
    // 1. We have never built layers for this page view yet (layers.length === 0 and hasBuiltLayersForCurrentPageRef is false)
    const isFirstBuild = layers.length === 0 && !hasBuiltLayersForCurrentPageRef.current;
    const storeLayers = useLayerStore.getState().getPageLayers(pageNum);
    const existingGroups = useLayerStore.getState().getPageGroups(pageNum);
    const hasUserModifications = storeLayers.some(l => l.userEdited || l.id.startsWith('manual-layer-'))
      || existingGroups.some(g => g.userCreated);
    const isStoreStale = storeLayers.length === 0 ||
      storeLayers.length !== currentPageOCRResolved.lines.length ||
      storeLayers.some((l, idx) => {
        const ocrLine = currentPageOCRResolved.lines[l.lineIndex] || currentPageOCRResolved.lines[idx];
        if (!ocrLine) return true;
        return String(l.sourceText || '').replace(/\s+/g, ' ').trim() !== String(ocrLine.text || '').replace(/\s+/g, ' ').trim();
      });

    if (isFirstBuild || engineChanged || ocrDataChanged || previewModeChanged || translationChanged || (isStoreStale && !hasUserModifications)) {
      // In split view compare mode, secondary canvas (previewModeOverride === 'translated') must NOT clobber global useLayerStore
      if (previewModeOverride === 'translated') {
        lastBuiltEngineRef.current = newEngine;
        lastBuiltOcrRef.current = currentPageOCRResolved;
        lastBuiltPreviewModeRef.current = translationPreviewMode;
        lastBuiltTranslationMapRef.current = new Map(currentTranslationMap);
        hasBuiltLayersForCurrentPageRef.current = true;
        return;
      }

      const result = buildLayerGroupsFromOCR(
        currentPageOCRResolved,
        storePreviewMode === 'translated' ? currentTranslationMap : undefined
      );

      if (isFirstBuild || !lastEngine || (isStoreStale && !hasUserModifications)) {
        useLayerStore.getState().setPageLayers(pageNum, result);
      } else {
        const existingLayers = useLayerStore.getState().layersByPage.get(pageNum) || [];
        const existingGroups = useLayerStore.getState().groupsByPage.get(pageNum) || [];
        
        const hasUserModifications = existingLayers.some(l => l.userEdited || l.id.startsWith('manual-layer-'))
          || existingGroups.some(g => g.userCreated);

        if (!hasUserModifications) {
          useLayerStore.getState().setPageLayers(pageNum, result);
        } else {
          const mergedResult = mergeLayersAndGroups(result, existingLayers, existingGroups);
          useLayerStore.getState().setPageLayers(pageNum, mergedResult);
        }
      }

      lastBuiltEngineRef.current = newEngine;
      lastBuiltOcrRef.current = currentPageOCRResolved;
      lastBuiltPreviewModeRef.current = translationPreviewMode;
      lastBuiltTranslationMapRef.current = new Map(currentTranslationMap);
      hasBuiltLayersForCurrentPageRef.current = true;
    }
  }, [currentPageOCRResolved, pageNum, hasLayers, translationOverlayContext.translatedByIndex, translationPreviewMode, liveUpdateTick]);

  const overlayFontFamily = useMemo(() => resolveOverlayFontFamily({
    preset: overlayFontPreset,
    enabled: overlayThaiFontEnabled,
    targetLanguage,
  }), [overlayFontPreset, overlayThaiFontEnabled, targetLanguage]);

  const overlayLayoutProfile: OverlayLayoutProfile = translationMode === 'official'
    ? 'official'
    : translationMode === 'adaptive'
      ? 'adaptive'
    : translationMode === 'manhwa'
      ? 'manhwa'
      : 'manga';

  const normalizedOverlaySearch = useMemo(
    () => normalizeOverlayInlineText(ocrResultSearchQuery),
    [ocrResultSearchQuery]
  );

  const overlaySearchPattern = useMemo(
    () => buildTextSearchPattern(normalizedOverlaySearch),
    [normalizedOverlaySearch]
  );

  const originalOCRSearchPattern = useMemo(() => {
    if (translationPreviewMode !== 'original') return null;
    if (!normalizedOverlaySearch) return null;
    return buildTextSearchPattern(normalizedOverlaySearch);
  }, [normalizedOverlaySearch, translationPreviewMode]);

  const originalOCRMatchedLineIndexes = useMemo(() => {
    if (!currentPageOCRResolved || !originalOCRSearchPattern) return [] as number[];
    return currentPageOCRResolved.lines.reduce<number[]>((indexes, line, index) => {
      const lineText = normalizeOverlayInlineText(String(line.text || ''));
      if (lineText && hasTextSearchMatch(lineText, originalOCRSearchPattern)) {
        indexes.push(index);
      }
      return indexes;
    }, []);
  }, [currentPageOCRResolved, originalOCRSearchPattern]);

  const debugPageOCR = showDebugOverlay ? currentPageOCRResolved : undefined;
  const droppedDebugWords = useMemo(() => {
    if (!showDebugOverlay || !debugPageOCR?.debug?.droppedWords) return [];
    return debugPageOCR.debug.droppedWords.filter(item => {
      if (!item.bbox) return false;
      const w = item.bbox.x1 - item.bbox.x0;
      const h = item.bbox.y1 - item.bbox.y0;
      return w > 0 && h > 0;
    });
  }, [showDebugOverlay, debugPageOCR]);

  const overlayLayoutByIndex = useMemo(() => {
    if (!currentPageOCRResolved) {
      return new Map<number, OverlayLayout>();
    }

    return computeOverlayLayoutMap(
      currentPageOCRResolved.lines.flatMap((line, index) => {
        const lineLayer = currentPageLayers.find(l => l.lineIndex === index);
        const fallbackText = lineLayer?.translatedText
          || lineLayer?.text
          || lookupShortPhraseTh(line.text)
          || lookupShortPhraseTh(String(line.text || '').replace(/[^A-Za-z0-9]/g, ''))
          || line.text;
        const translatedText = translationOverlayContext.translatedByIndex.get(index) || fallbackText;
        if (!translatedText) return [];
        if (shouldSkipOverlayRenderForSuspiciousLine(line) && !isSourceFallbackOverlayText(line.text, translatedText)) return [];

        const layer = lineLayer;
        const balloonId = layer?.groupId;

        const sourceBbox = resolveOverlaySourceBBox(line);
        const maskBbox = resolveOverlayMaskBBox(line);
        const sourceWidthRaw = Math.max(1, sourceBbox.x1 - sourceBbox.x0);
        const sourceHeightRaw = Math.max(1, sourceBbox.y1 - sourceBbox.y0);
        const sourceAreaRaw = sourceWidthRaw * sourceHeightRaw;
        const maskWidthRaw = Math.max(1, maskBbox.x1 - maskBbox.x0);
        const maskHeightRaw = Math.max(1, maskBbox.y1 - maskBbox.y0);
        const maskAreaRaw = maskWidthRaw * maskHeightRaw;
        const widthCoverage = sourceWidthRaw / maskWidthRaw;
        const areaCoverage = sourceAreaRaw / maskAreaRaw;
        const lowCoverageSource = shouldUseDocumentCoverageFallback(line.text)
          && widthCoverage < 0.84
          && areaCoverage < 0.86;
        const effectiveSourceBbox = lowCoverageSource ? maskBbox : sourceBbox;
        const baseWidth = Math.max(1, (effectiveSourceBbox.x1 - effectiveSourceBbox.x0) * ocrOverlayTransform.scaleX);
        const baseHeight = Math.max(1, (effectiveSourceBbox.y1 - effectiveSourceBbox.y0) * ocrOverlayTransform.scaleY);
        const expansion = resolveOverlayMaskExpansion(line);
        const maskExpandX = Math.min(expansion.maxExpandX, Math.max(1, Math.round(baseHeight * expansion.expandXRatio)));
        const maskExpandTop = Math.min(expansion.maxExpandTop, Math.max(1, Math.round(baseHeight * expansion.expandTopRatio)));
        const maskExpandBottom = Math.min(expansion.maxExpandBottom, Math.max(1, Math.round(baseHeight * expansion.expandBottomRatio)));
        const rawLeft = ocrOverlayTransform.offsetX + effectiveSourceBbox.x0 * ocrOverlayTransform.scaleX - maskExpandX;
        const rawTop = ocrOverlayTransform.offsetY + effectiveSourceBbox.y0 * ocrOverlayTransform.scaleY - maskExpandTop;
        const rawWidth = baseWidth + maskExpandX * 2;
        const rawHeight = baseHeight + maskExpandTop + maskExpandBottom;
        const rect = clampOverlayRect(rawLeft, rawTop, rawWidth, rawHeight, {
          x0: ocrOverlayTransform.offsetX,
          y0: ocrOverlayTransform.offsetY,
          x1: ocrOverlayTransform.offsetX + currentPageOCRResolved.width * ocrOverlayTransform.scaleX,
          y1: ocrOverlayTransform.offsetY + currentPageOCRResolved.height * ocrOverlayTransform.scaleY,
        });
        const typographyWidth = overlayLayoutProfile === 'official' ? baseWidth : rect.width;
        const typographyHeight = overlayLayoutProfile === 'official' ? baseHeight : rect.height;

        const group = layer ? rawCurrentPageGroups.find(g => g.id === layer.groupId) : undefined;
        const groupType = group?.groupType;

        return [{
          index,
          text: translatedText,
          width: typographyWidth,
          height: typographyHeight,
          bbox: overlayLayoutProfile === 'official' ? maskBbox : effectiveSourceBbox,
          line,
          balloonId,
          hints: {
            sourceText: line.text,
            sourceBoxWidth: baseWidth,
            sourceBoxHeight: baseHeight,
            sourceLineCount: 1,
            fontFamily: overlayFontFamily,
            profile: overlayLayoutProfile,
            groupType,
          },
        }];
      }),
      { profile: overlayLayoutProfile }
    );
  }, [
    currentPageOCRResolved,
    ocrOverlayTransform.offsetX,
    ocrOverlayTransform.offsetY,
    ocrOverlayTransform.scaleX,
    ocrOverlayTransform.scaleY,
    overlayLayoutProfile,
    overlayFontFamily,
    translationOverlayContext.shouldRender,
    translationOverlayContext.translatedByIndex,
    currentPageLayers,
  ]);

  // ทำไมถึงเขียนแบบนี้: เคลียร์ค่าสีพื้นหลังที่เก็บไว้เมื่อมีการเปลี่ยนหน้า หรือรีเซ็ตคีย์แปลภาษา เพื่อไม่ให้สีของหน้าก่อนหน้าค้างแสดงผลผิดพลาดบนหน้าใหม่
  useEffect(() => {
    setTranslatedLinePalette(new Map());
  }, [pageNum, translationOverlayContext.entry?.key]);

  useEffect(() => {
    if (!translationOverlayContext.shouldRender || !currentPageOCRResolved || !pageRef.current || !isVisible) {
      setTranslatedLinePalette(new Map());
      return;
    }

    const canvas = pageRef.current.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      return;
    }

    let canceled = false;
    const timer = setTimeout(() => {
      const runSampling = () => {
        if (canceled) return;
        const sourceWidth = Math.max(1, canvas.width);
        const sourceHeight = Math.max(1, canvas.height);
        if (!sourceWidth || !sourceHeight) {
          return;
        }

        const maxSampleSide = 2400;
        const sampleScale = Math.min(1, maxSampleSide / Math.max(sourceWidth, sourceHeight));
        const targetWidth = Math.max(1, Math.round(sourceWidth * sampleScale));
        const targetHeight = Math.max(1, Math.round(sourceHeight * sampleScale));

        if (!samplingCanvasRef.current) {
          samplingCanvasRef.current = document.createElement('canvas');
        }
        const sampleCanvas = samplingCanvasRef.current;
        if (sampleCanvas.width !== targetWidth) sampleCanvas.width = targetWidth;
        if (sampleCanvas.height !== targetHeight) sampleCanvas.height = targetHeight;

        const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          return;
        }

        context.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);

        const activeLinesToSample: Array<{ line: typeof currentPageOCRResolved.lines[0]; index: number }> = [];
        currentPageOCRResolved.lines.forEach((line, index) => {
          if (!translationOverlayContext.translatedByIndex.has(index)) return;
          const translatedText = translationOverlayContext.translatedByIndex.get(index) || '';
          if (shouldSkipOverlayRenderForSuspiciousLine(line) && !isSourceFallbackOverlayText(line.text, translatedText)) return;
          activeLinesToSample.push({ line, index });
        });

        const next = sampleOverlayPalettesBatch(
          context,
          activeLinesToSample,
          currentPageOCRResolved.width,
          currentPageOCRResolved.height,
          sampleCanvas.width,
          sampleCanvas.height
        );
        setTranslatedLinePalette(next);
      };

      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => runSampling(), { timeout: 100 });
      } else {
        runSampling();
      }
    }, 150);

    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [
    pageNum,
    currentPageOCRResolved,
    pageRenderTick,
    translationOverlayContext.entry?.key,
    translationOverlayContext.shouldRender,
    translationOverlayContext.translatedByIndex,
    isVisible,
  ]);

  const lastCanvasSizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    if (!currentPageOCRResolved || !pageRef.current || !isVisible) return;

    const updateTransform = () => {
      const container = pageRef.current;
      const canvas = container?.querySelector('canvas') as HTMLCanvasElement | null;
      if (!container || !canvas) return;

      if (!currentPageOCRResolved.width || !currentPageOCRResolved.height) return;
      
      const canvasWidth = canvas.clientWidth || 0;
      const canvasHeight = canvas.clientHeight || 0;
      if (canvasWidth === 0 || canvasHeight === 0) return;

      const offsets = getOffsetRelativeTo(canvas, container);

      requestAnimationFrame(() => {
        React.startTransition(() => {
          setOcrOverlayTransform({
            scaleX: canvasWidth / currentPageOCRResolved.width,
            scaleY: canvasHeight / currentPageOCRResolved.height,
            offsetX: offsets.x,
            offsetY: offsets.y
          });
        });
      });
    };

    const container = pageRef.current;
    const canvas = container?.querySelector('canvas') as HTMLCanvasElement | null;
    
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        const prev = lastCanvasSizeRef.current;
        if (Math.abs(width - prev.width) > 1 || Math.abs(height - prev.height) > 1) {
          lastCanvasSizeRef.current = { width, height };
          updateTransform();
        }
      }
    });

    if (canvas) {
      resizeObserver.observe(canvas);
    }

    updateTransform();

    window.addEventListener('resize', updateTransform);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateTransform);
    };
  }, [currentPageOCRResolved, pageNum, pageRenderTick, isVisible]);

  return (
    <>
      {/* Regions Overlay */}
      {showDebugOverlay && isCurrentPage && regions.map(reg => (
        <div 
          key={reg.id}
          style={{
            left: reg.box.x,
            top: reg.box.y,
            width: reg.box.w,
            height: reg.box.h
          }}
          className={`absolute border-2 border-dashed transition-all cursor-pointer hover:bg-opacity-20 ${
            reg.type === 'balloon' ? 'border-green-500 bg-green-500/10' : 
            reg.type === 'sfx' ? 'border-orange-500 bg-orange-500/10' :
            'border-blue-500 bg-blue-500/10'
          }`}
        />
      ))}
      {/* OCR Debug Overlay */}
      {translationOverlayContext.shouldRender && currentPageOCRResolved && (
        <div 
          style={{
            willChange: 'transform',
            contain: 'layout style paint'
          }}
          className="absolute inset-0 pointer-events-none"
        >
          {(() => {
            const renderedOverlayTracker: Array<{ centerX: number; centerY: number; width: number; height: number; text: string }> = [];
            return currentPageOCRResolved.lines.map((line, idx) => {
              if (hiddenLineIndexes.has(idx)) {
                return null;
              }
              const layout = overlayLayoutByIndex.get(idx);
              const isMaskOnlyLine = Boolean(layout?.hidden);

              const layer = currentPageLayers.find(l => l.lineIndex === idx);
              const group = layer ? currentPageGroups.find(g => g.id === layer.groupId) : undefined;
              const isSfxGroup = group?.groupType === 'sfx';
              const translatedText = (() => {
                if (!layer) {
                  return translationOverlayContext.translatedByIndex.get(idx);
                }
                if (translationPreviewMode === 'original') {
                  return layer.sourceText || layer.text;
                }
                const hasTranslation = layer.userEdited || layer.text !== layer.sourceText;
                if (hasTranslation) return layer.text;
                const cachedText = translationOverlayContext.translatedByIndex.get(idx);
                return cachedText !== undefined ? cachedText : layer.text;
              })();

              if (!translatedText && !(isMaskOnlyLine && layout?.preserveMaskWhenHidden)) {
                return null;
              }
              if (translatedText && !layer && shouldSkipOverlayRenderForSuspiciousLine(line) && !isSourceFallbackOverlayText(line.text, translatedText)) {
                return null;
              }

              if (isMaskOnlyLine && !layout?.preserveMaskWhenHidden) {
                return null;
              }
              const isTextEdited = layer && layer.userEdited && layer.text !== layer.sourceText && layer.text !== translationOverlayContext.translatedByIndex.get(idx);
              const renderText = (() => {
                if (isTextEdited) {
                  return translationPreviewMode === 'original' ? (layer!.sourceText || layer!.text) : layer!.text;
                }
                if (translationPreviewMode === 'original') {
                  return layer?.sourceText || line.text;
                }
                if (layout?.renderText !== undefined && layout.renderText.trim()) {
                  if (/[\u0E00-\u0E7F]/.test(layout.renderText)) {
                    return layout.renderText;
                  }
                  if (translatedText && /[\u0E00-\u0E7F]/.test(translatedText)) {
                    return translatedText;
                  }
                  return layout.renderText;
                }
                return translatedText || '';
              })();

              if (!renderText.trim() && !isMaskOnlyLine) {
                return null;
              }

              const hasThaiText = /[\u0E00-\u0E7F]/.test(renderText);
              const palette = translatedLinePalette.get(idx) || DEFAULT_OVERLAY_PALETTE;
              const continuationPalette = layout?.highlightTextColorSourceIndex !== undefined
                ? (translatedLinePalette.get(layout.highlightTextColorSourceIndex) || palette)
                : palette;

              return (
                <OverlayLineItem
                  key={`ocr-translation-line-${idx}`}
                  idx={idx}
                  line={line}
                  layout={layout}
                  layer={layer}
                  renderText={renderText}
                  isMaskOnlyLine={isMaskOnlyLine}
                  hasThaiText={hasThaiText}
                  ocrOverlayTransform={ocrOverlayTransform}
                  overlayLayoutProfile={overlayLayoutProfile}
                  overlayFontFamily={overlayFontFamily}
                  overlayFontSizeScale={overlayFontSizeScale}
                  overlaySearchPattern={overlaySearchPattern}
                  palette={palette}
                  continuationPalette={continuationPalette}
                  pageWidth={currentPageOCRResolved.width}
                  pageHeight={currentPageOCRResolved.height}
                />
              );
            });
          })()}
        </div>

      )}
      {translationPreviewMode === 'original' && currentPageOCRResolved && originalOCRMatchedLineIndexes.length > 0 && (
        <div className="absolute inset-0 pointer-events-none">
          {originalOCRMatchedLineIndexes.map((lineIndex) => {
            const line = currentPageOCRResolved.lines[lineIndex];
            if (!line) return null;

            const sourceBBox = resolveOverlaySourceBBox(line);
            const rawLeft = ocrOverlayTransform.offsetX + sourceBBox.x0 * ocrOverlayTransform.scaleX - 2;
            const rawTop = ocrOverlayTransform.offsetY + sourceBBox.y0 * ocrOverlayTransform.scaleY - 2;
            const rawWidth = Math.max(1, (sourceBBox.x1 - sourceBBox.x0) * ocrOverlayTransform.scaleX + 4);
            const rawHeight = Math.max(1, (sourceBBox.y1 - sourceBBox.y0) * ocrOverlayTransform.scaleY + 4);
            const rect = clampOverlayRect(rawLeft, rawTop, rawWidth, rawHeight, {
              x0: ocrOverlayTransform.offsetX,
              y0: ocrOverlayTransform.offsetY,
              x1: ocrOverlayTransform.offsetX + currentPageOCRResolved.width * ocrOverlayTransform.scaleX,
              y1: ocrOverlayTransform.offsetY + currentPageOCRResolved.height * ocrOverlayTransform.scaleY,
            });

            return (
              <div
                key={`ocr-original-search-${lineIndex}`}
                style={{
                  left: rect.left,
                  top: rect.top,
                  width: rect.width,
                  height: rect.height,
                }}
                className="absolute rounded-sm border border-amber-500/90 bg-amber-300/40"
              />
            );
          })}
        </div>
      )}
      {showDebugOverlay && debugPageOCR && (
        <div className="absolute inset-0 pointer-events-none">
          {debugPageOCR.words.map((word, idx) => {
            const left = ocrOverlayTransform.offsetX + word.bbox.x0 * ocrOverlayTransform.scaleX;
            const top = ocrOverlayTransform.offsetY + word.bbox.y0 * ocrOverlayTransform.scaleY;
            const width = (word.bbox.x1 - word.bbox.x0) * ocrOverlayTransform.scaleX;
            const height = (word.bbox.y1 - word.bbox.y0) * ocrOverlayTransform.scaleY;
            const baselineY = ocrOverlayTransform.offsetY + word.bbox.y1 * ocrOverlayTransform.scaleY;
            return (
              <React.Fragment key={`ocr-word-${idx}`}>
                <div
                  style={{ left, top, width, height }}
                  className="absolute border border-red-400/60"
                />
                <div
                  style={{ left, top: baselineY, width, height: 1 }}
                  className="absolute bg-yellow-400/70"
                />
              </React.Fragment>
            );
          })}
          {droppedDebugWords.map((word, idx) => {
            const bbox = word.bbox!;
            const left = ocrOverlayTransform.offsetX + bbox.x0 * ocrOverlayTransform.scaleX;
            const top = ocrOverlayTransform.offsetY + bbox.y0 * ocrOverlayTransform.scaleY;
            const width = (bbox.x1 - bbox.x0) * ocrOverlayTransform.scaleX;
            const height = (bbox.y1 - bbox.y0) * ocrOverlayTransform.scaleY;
            return (
              <div
                key={`ocr-dropped-${idx}`}
                style={{ left, top, width, height }}
                title={`${word.filter}: ${word.text} (${word.reason})`}
                className="absolute border border-orange-400/70 border-dashed bg-orange-400/5"
              />
            );
          })}
        </div>
      )}
      <InteractiveLayerOverlay
        pageNum={pageNum}
        layers={currentPageLayers}
        groups={currentPageGroups}
        ocrTransform={ocrOverlayTransform}
        isActive={activeTool === 'select' || activeTool === 'region'}
        layouts={overlayLayoutByIndex}
        previewModeOverride={previewModeOverride}
      />
    </>
  );
});
PDFPageOverlay.displayName = 'PDFPageOverlay';
