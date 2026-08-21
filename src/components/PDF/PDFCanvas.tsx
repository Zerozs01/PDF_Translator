import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Document, Page } from 'react-pdf';
import '../../services/pdf/pdfjsWorker';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useSegmentationStore } from '../../stores/useSegmentationStore';
import { useOCRTextLayerStore, OCRTranslationCacheEntry, hasCurrentOCRTranslationCacheVersion } from '../../stores/useOCRTextLayerStore';
import { dbService } from '../../services/dbService';
import { OCR_ALGORITHM_VERSION, OCR_RAW_VERSION } from '../../services/vision/ocrVersion';
import { OCREngine } from '../../types';
import { useLayerStore } from '../../stores/useLayerStore';
import type { TextLayer, TextLayerGroup } from '../../types/layers';
import { InteractiveLayerOverlay } from '../Layers/InteractiveLayerOverlay';
import { visionService } from '../../services/vision/VisionService';
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
} from '../OCR/translationOverlayUtils';
import { resolveOverlayFontFamily } from '../../constants/overlayFonts';
import { buildTextSearchPattern, collectTextSearchMatches, hasTextSearchMatch, type TextSearchPattern } from '../../services/textSearch';
import { buildLayerGroupsFromOCR, mergeLayersAndGroups } from '../../services/layers/LayerGroupingService';
import { lookupShortPhraseTh } from '../../services/translation/offlineTranslationService';
import { isKnownShortWordHelper } from '../../services/ocr/ocrSafetyLineDedup';

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

const isSourceFallbackOverlayText = (sourceText: string, translatedText: string): boolean => {
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

const clampOverlayTypographyScale = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  if (value < 0.7) return 0.7;
  if (value > 1.6) return 1.6;
  return value;
};

const scaleOverlayTypography = (typography: OverlayTypography, scale: number): OverlayTypography => {
  const normalizedScale = clampOverlayTypographyScale(scale);
  if (Math.abs(normalizedScale - 1) < 0.0001) return typography;

  return {
    ...typography,
    fontSize: Math.max(8, Number((typography.fontSize * normalizedScale).toFixed(2))),
    lineHeight: Number((typography.lineHeight * normalizedScale).toFixed(3)),
    padX: Math.max(1, Math.round(typography.padX * normalizedScale)),
    padY: Math.max(1, Math.round(typography.padY * normalizedScale)),
    contentHeight: Math.max(1, Number((typography.contentHeight * normalizedScale).toFixed(2))),
  };
};

const renderOverlayTextWithSearchHighlight = (
  text: string,
  continuationText: string,
  defaultColor: string,
  continuationColor: string,
  searchPattern: TextSearchPattern | null
): React.ReactNode => {
  const fullText = String(text || '');
  if (!fullText) return '';

  const continuationStart = continuationText ? fullText.indexOf(continuationText) : -1;
  const continuationEnd = continuationStart >= 0 ? continuationStart + continuationText.length : -1;
  const matches = collectTextSearchMatches(fullText, searchPattern);

  if (matches.length === 0 && continuationStart < 0) {
    return fullText;
  }

  const boundaries = new Set<number>([0, fullText.length]);
  matches.forEach((match) => {
    boundaries.add(match.start);
    boundaries.add(match.end);
  });
  if (continuationStart >= 0 && continuationEnd > continuationStart) {
    boundaries.add(continuationStart);
    boundaries.add(continuationEnd);
  }

  const sortedBoundaries = Array.from(boundaries)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= fullText.length)
    .sort((a, b) => a - b);

  const pieces: React.ReactNode[] = [];
  for (let i = 0; i < sortedBoundaries.length - 1; i += 1) {
    const start = sortedBoundaries[i];
    const end = sortedBoundaries[i + 1];
    if (end <= start) continue;

    const slice = fullText.slice(start, end);
    if (!slice) continue;

    const inContinuation = continuationStart >= 0 && start >= continuationStart && end <= continuationEnd;
    const inMatch = matches.some((match) => start >= match.start && end <= match.end);

    if (!inContinuation && !inMatch) {
      pieces.push(<React.Fragment key={`plain-${start}`}>{slice}</React.Fragment>);
      continue;
    }

    pieces.push(
      <span
        key={`seg-${start}`}
        style={{
          color: inContinuation ? continuationColor : defaultColor,
          backgroundColor: inMatch ? 'rgba(250, 204, 21, 0.28)' : undefined,
          borderRadius: inMatch ? 3 : undefined,
          paddingInline: inMatch ? 1 : 0,
          boxShadow: inMatch ? 'inset 0 0 0 1px rgba(250, 204, 21, 0.22)' : undefined,
        }}
      >
        {slice}
      </span>
    );
  }

  return pieces;
};

// ─── Sub-component: PDFPageOverlay ───────────────────────────────
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

const PDFPageOverlay: React.FC<{
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
      const result = buildLayerGroupsFromOCR(
        currentPageOCRResolved,
        translationPreviewMode === 'translated' ? currentTranslationMap : undefined
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

        const next = new Map<number, OverlayPalette>();
        currentPageOCRResolved.lines.forEach((line, index) => {
          if (!translationOverlayContext.translatedByIndex.has(index)) return;
          const translatedText = translationOverlayContext.translatedByIndex.get(index) || '';
          if (shouldSkipOverlayRenderForSuspiciousLine(line) && !isSourceFallbackOverlayText(line.text, translatedText)) return;
          next.set(index, sampleOverlayPaletteFromLine(
            context,
            line,
            currentPageOCRResolved.width,
            currentPageOCRResolved.height,
            sampleCanvas.width,
            sampleCanvas.height
          ));
        });
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
              // 1. ถ้า layout.renderText มีข้อมูลและเป็นภาษาไทย (รวมถึงกรณี Manga Bubble Merge ที่รวมข้อความทุกบรรทัดในบอลลูนเข้าด้วยกัน) ให้ใช้ layout.renderText
              if (layout?.renderText !== undefined && layout.renderText.trim()) {
                if (/[\u0E00-\u0E7F]/.test(layout.renderText)) {
                  return layout.renderText;
                }
                // ถ้า layout.renderText เป็นภาษาต่างประเทศ และมีคำแปลภาษาไทย ให้ใช้คำแปลภาษาไทยแทน
                if (translatedText && /[\u0E00-\u0E7F]/.test(translatedText)) {
                  return translatedText;
                }
                return layout.renderText;
              }
              // 2. Fallback เป็น translatedText
              return translatedText || '';
            })();

            if (!renderText.trim() && !isMaskOnlyLine) {
              return null;
            }

            const hasThaiText = /[\u0E00-\u0E7F]/.test(renderText);

            const effectiveProfile = layout?.effectiveProfile || overlayLayoutProfile;
            const styleKind = layout?.styleKind;
            const isDocumentLikeOverlay = styleKind
              ? styleKind === 'document-heading' || styleKind === 'document-body'
              : effectiveProfile === 'official';
            const isComicLikeOverlay = !isDocumentLikeOverlay;
            const useLayerBbox = Boolean(layer && layer.userEdited);
            const maskBbox = useLayerBbox
              ? layer!.bbox
              : ((!isMaskOnlyLine && layout?.mergedMaskBBox) || resolveOverlayMaskBBox(line));
            const resolvedSourceBbox = useLayerBbox
              ? layer!.bbox
              : resolveOverlaySourceBBox(line);
            const sourceWidthRaw = Math.max(1, resolvedSourceBbox.x1 - resolvedSourceBbox.x0);
            const sourceHeightRaw = Math.max(1, resolvedSourceBbox.y1 - resolvedSourceBbox.y0);
            const sourceAreaRaw = sourceWidthRaw * sourceHeightRaw;
            const maskWidthRaw = Math.max(1, maskBbox.x1 - maskBbox.x0);
            const maskHeightRaw = Math.max(1, maskBbox.y1 - maskBbox.y0);
            const maskAreaRaw = maskWidthRaw * maskHeightRaw;
            const widthCoverage = sourceWidthRaw / maskWidthRaw;
            const areaCoverage = sourceAreaRaw / maskAreaRaw;
            const lowCoverageSource = shouldUseDocumentCoverageFallback(line.text)
              && widthCoverage < 0.84
              && areaCoverage < 0.86;
            const sourceBbox = useLayerBbox
              ? layer!.bbox
              : (isMaskOnlyLine
                ? resolvedSourceBbox
                : (layout?.mergedBBox || (isDocumentLikeOverlay || lowCoverageSource ? maskBbox : resolvedSourceBbox)));
            const maskRenderSourceLeft = maskBbox.x0;
            const renderSourceLeft = layout?.alignment === 'left' && layout.sharedBoxLeftX !== undefined
              ? Math.min(sourceBbox.x0, layout.sharedBoxLeftX)
              : sourceBbox.x0;
            const maskBaseWidth = Math.max(1, (maskBbox.x1 - maskRenderSourceLeft) * ocrOverlayTransform.scaleX);
            const maskBaseHeight = Math.max(1, (maskBbox.y1 - maskBbox.y0) * ocrOverlayTransform.scaleY);
            const baseWidth = Math.max(1, (sourceBbox.x1 - renderSourceLeft) * ocrOverlayTransform.scaleX);
            const baseHeight = Math.max(1, (sourceBbox.y1 - sourceBbox.y0) * ocrOverlayTransform.scaleY);
            const expansion = resolveOverlayMaskExpansion(line);
            const mergedMaskBoost = 0;
            const comicMaskBoostX = 0;
            const comicMaskBoostTop = 0;
            const comicMaskBoostBottom = 0;
            const maskExpandX = Math.min(
              expansion.maxExpandX + mergedMaskBoost + comicMaskBoostX,
              Math.max(1, Math.round(maskBaseHeight * expansion.expandXRatio)) + mergedMaskBoost + comicMaskBoostX
            );
            const maskExpandLeft = Math.min(isComicLikeOverlay ? 4 : 1, maskExpandX);
            const maskExpandRight = maskExpandX;
            const maskExpandTop = Math.min(
              expansion.maxExpandTop + mergedMaskBoost + comicMaskBoostTop,
              Math.max(1, Math.round(maskBaseHeight * expansion.expandTopRatio)) + mergedMaskBoost + comicMaskBoostTop
            );
            const thaiBottomBoost = hasThaiText ? Math.min(3, Math.max(1, Math.round(maskBaseHeight * 0.08))) : 0;
            const documentBottomBoost = isDocumentLikeOverlay
              ? Math.min(8, Math.max(2, Math.round(maskBaseHeight * 0.16)))
              : 0;
            const maskExpandBottom = Math.min(
              expansion.maxExpandBottom + thaiBottomBoost + documentBottomBoost + mergedMaskBoost + comicMaskBoostBottom,
              Math.max(1, Math.round(maskBaseHeight * expansion.expandBottomRatio)) + thaiBottomBoost + documentBottomBoost + mergedMaskBoost + comicMaskBoostBottom
            );
            const maskBleed = 2.5; // ถมสีกว้างกว่า border area เล็กน้อยเพื่อไม่ให้เหลือเศษตัวอักษรเดิม
            const rawMaskLeft = ocrOverlayTransform.offsetX + maskRenderSourceLeft * ocrOverlayTransform.scaleX - maskExpandLeft - maskBleed;
            const rawMaskTop = ocrOverlayTransform.offsetY + maskBbox.y0 * ocrOverlayTransform.scaleY - maskExpandTop - maskBleed;
            const rawMaskWidth = maskBaseWidth + maskExpandLeft + maskExpandRight + (maskBleed * 2);
            const rawMaskHeight = maskBaseHeight + maskExpandTop + maskExpandBottom + (maskBleed * 2);
            const maskRect = clampOverlayRect(rawMaskLeft, rawMaskTop, rawMaskWidth, rawMaskHeight, {
              x0: ocrOverlayTransform.offsetX,
              y0: ocrOverlayTransform.offsetY,
              x1: ocrOverlayTransform.offsetX + currentPageOCRResolved.width * ocrOverlayTransform.scaleX,
              y1: ocrOverlayTransform.offsetY + currentPageOCRResolved.height * ocrOverlayTransform.scaleY,
            });
            const useMergedComicTextRect = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && !isMaskOnlyLine && Boolean(layout?.mergedMaskBBox);
            const textSourceLeft = useMergedComicTextRect ? maskRenderSourceLeft : renderSourceLeft;
            const textSourceTop = useMergedComicTextRect ? maskBbox.y0 : sourceBbox.y0;
            const textBaseWidth = useMergedComicTextRect ? Math.max(baseWidth, maskBaseWidth) : baseWidth;
            const textBaseHeight = useMergedComicTextRect ? Math.max(baseHeight, maskBaseHeight) : baseHeight;
            const mergedComicTextTopLift = 0;
            const mergedComicTextExtraHeight = 0;
            const rawTextLeft = ocrOverlayTransform.offsetX + textSourceLeft * ocrOverlayTransform.scaleX - (layout?.alignment === 'center' ? 0 : maskExpandLeft);
            const rawTextTop = ocrOverlayTransform.offsetY + textSourceTop * ocrOverlayTransform.scaleY - maskExpandTop - mergedComicTextTopLift;
            const rawTextWidth = textBaseWidth + (layout?.alignment === 'center' ? 0 : maskExpandLeft + maskExpandRight);
            const rawTextHeight = textBaseHeight + maskExpandTop + maskExpandBottom + mergedComicTextTopLift + mergedComicTextExtraHeight;
            let textRect = clampOverlayRect(rawTextLeft, rawTextTop, rawTextWidth, rawTextHeight, {
              x0: ocrOverlayTransform.offsetX,
              y0: ocrOverlayTransform.offsetY,
              x1: ocrOverlayTransform.offsetX + currentPageOCRResolved.width * ocrOverlayTransform.scaleX,
              y1: ocrOverlayTransform.offsetY + currentPageOCRResolved.height * ocrOverlayTransform.scaleY,
            });
            if (!isDocumentLikeOverlay) {
              textRect = clampOverlayRect(textRect.left, textRect.top, textRect.width, textRect.height, {
                x0: Math.max(ocrOverlayTransform.offsetX, maskRect.left - 1),
                y0: Math.max(ocrOverlayTransform.offsetY, maskRect.top - 1),
                x1: Math.min(ocrOverlayTransform.offsetX + currentPageOCRResolved.width * ocrOverlayTransform.scaleX, maskRect.left + maskRect.width + 1),
                y1: Math.min(ocrOverlayTransform.offsetY + currentPageOCRResolved.height * ocrOverlayTransform.scaleY, maskRect.top + maskRect.height + 1),
              });
            }
            const palette = translatedLinePalette.get(idx) || DEFAULT_OVERLAY_PALETTE;
            const continuationPalette = layout?.highlightTextColorSourceIndex !== undefined
              ? (translatedLinePalette.get(layout.highlightTextColorSourceIndex) || palette)
              : palette;
            const maskBackgroundColor = layer?.backgroundColor !== undefined ? layer.backgroundColor : palette.backgroundColor;
            const thaiDocumentHeadroom = isDocumentLikeOverlay && hasThaiText
              ? Math.max(4, Math.round(Math.max(baseHeight, maskBaseHeight) * 0.4))
              : 0;
            const documentTypographyWidth = lowCoverageSource
              ? Math.max(baseWidth, maskBaseWidth)
              : Math.max(baseWidth, textRect.width * 0.96);
            const typographyWidth = isDocumentLikeOverlay ? documentTypographyWidth : textRect.width;
            // Manga bubble merge: use the full balloon height for font sizing, not just the first line height
            const mergedBalloonHeight = useMergedComicTextRect ? maskBaseHeight : 0;
            const typographyHeight = isDocumentLikeOverlay
              ? Math.min(
                textRect.height,
                Math.max(baseHeight + thaiDocumentHeadroom, (lowCoverageSource ? maskBaseHeight : baseHeight) + thaiDocumentHeadroom)
              )
              : (mergedBalloonHeight > baseHeight ? mergedBalloonHeight : textRect.height);
            const sourceBoxHeightForTypography = isDocumentLikeOverlay
              ? (lowCoverageSource ? Math.max(baseHeight, maskBaseHeight) : baseHeight) + thaiDocumentHeadroom
              : (mergedBalloonHeight > baseHeight ? mergedBalloonHeight : baseHeight);
            const baseTypography = layout?.typography || computeOverlayTypography(renderText, typographyWidth, typographyHeight, {
              sourceText: line.text,
              sourceBoxWidth: isDocumentLikeOverlay && lowCoverageSource ? Math.max(baseWidth, maskBaseWidth) : baseWidth,
              sourceBoxHeight: sourceBoxHeightForTypography,
              sourceLineCount: 1,
              fontFamily: overlayFontFamily,
              profile: effectiveProfile,
              styleKind,
            });

            const typography = scaleOverlayTypography(baseTypography, overlayFontSizeScale);
            if (layer && layer.userEdited) {
              typography.fontSize = (layer.fontSize || 14) * ocrOverlayTransform.scaleX;
            }
            const extraTopPad = hasThaiText ? Math.max(1, Math.round(typography.fontSize * 0.08)) : 0;
            const extraBottomPad = hasThaiText ? Math.max(1, Math.round(typography.fontSize * 0.06)) : 0;
            const textStartOffset = layout?.sharedTextStartX !== undefined
              ? Math.max(0, (layout.sharedTextStartX - renderSourceLeft) * ocrOverlayTransform.scaleX)
              : 0;
            const centerOffset = layout?.sharedCenterX !== undefined
              ? ((layout.sharedCenterX - renderSourceLeft) * ocrOverlayTransform.scaleX) - (textRect.width * 0.5)
              : 0;
            const innerLeft = layout?.alignment === 'center'
              ? (effectiveProfile === 'manga' || effectiveProfile === 'manhwa'
                ? centerOffset
                : Math.max(0, Math.min(textRect.width * 0.12, centerOffset)))
              : Math.max(0, Math.min(textRect.width - 1, maskExpandLeft + textStartOffset));
            const innerWidth = layout?.alignment === 'center'
              ? textRect.width
              : Math.max(1, textRect.width - innerLeft);
            const overlayText = typography.forceSingleLine
              ? normalizeOverlayInlineText(renderText)
              : renderText;
            const highlightContinuationText = layout?.highlightContinuationText
              ? (typography.forceSingleLine
                ? normalizeOverlayInlineText(layout.highlightContinuationText)
                : layout.highlightContinuationText)
              : '';
            
            const layerTextColor = layer?.textColor !== undefined ? layer.textColor : palette.textColor;
            const layerContinuationColor = layer?.textColor !== undefined ? layer.textColor : continuationPalette.textColor;
            const overlayContent = renderOverlayTextWithSearchHighlight(
              overlayText,
              highlightContinuationText,
              layerTextColor,
              layerContinuationColor,
              overlaySearchPattern
            );
            const overlayStrokeBaseWidth = Number(palette.textStrokeWidth || 0);
            const overlayStrokeWidth = overlayStrokeBaseWidth > 0
              ? Math.max(0.55, Math.min(1.35, overlayStrokeBaseWidth * (typography.fontSize / 14)))
              : 0;
            const overlayTextWeight = Math.max(400, Math.min(700, Math.round(Number(palette.textFillWeight || 400))));
            const rotationDeg = layer ? (layer.rotation || 0) : estimateLineRotationDeg(line);
            const rotationOrigin = layer ? 'center center' : 'left top';
            const thaiComicLine = hasThaiText && (styleKind === 'comic-bubble' || styleKind === 'comic-box');
            const isComicCenter = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && layout?.alignment === 'center';
            const minFillRatio = typography.estimatedLines > 1
              ? (thaiComicLine ? 0.82 : 0.74)
              : (thaiComicLine ? 0.58 : 0.5);
            const naturalPaintHeight = typography.contentHeight + typography.padY * 2 + extraTopPad + extraBottomPad;
            const paintHeight = isComicCenter
              ? Math.min(textRect.height * 1.25, naturalPaintHeight)
              : Math.min(
                  textRect.height * 1.25,
                  Math.max(naturalPaintHeight, textRect.height * minFillRatio)
                );
            const thaiVisualShift = (isComicCenter && hasThaiText)
              ? Math.round(maskRect.height * 0.035)
              : 0;
            const paintOffsetTop = isComicCenter
              ? Math.max(0, Math.min(textRect.height - paintHeight, Math.round((maskRect.top - textRect.top) + (maskRect.height - paintHeight) * 0.5 - thaiVisualShift)))
              : Math.max(
                  hasThaiText ? 1 : 0,
                  Math.min(textRect.height - paintHeight, Math.round(textRect.height * (thaiComicLine ? 0.04 : 0.08)))
                );

            const centerX = textRect.left + textRect.width * 0.5;
            const centerY = textRect.top + textRect.height * 0.5;
            const normalizedText = renderText.trim().replace(/\s+/g, ' ');
            if (normalizedText) {
              const isDuplicateOverlay = renderedOverlayTracker.some((prev) => {
                const dx = Math.abs(prev.centerX - centerX);
                const dy = Math.abs(prev.centerY - centerY);
                const dw = Math.abs(prev.width - textRect.width);
                const dh = Math.abs(prev.height - textRect.height);
                const isExactColocation = dx < 4 && dy < 4 && dw < 8 && dh < 8;
                return isExactColocation && (prev.text === normalizedText || prev.text.includes(normalizedText) || normalizedText.includes(prev.text));
              });
              if (isDuplicateOverlay) {
                return null;
              }
              renderedOverlayTracker.push({ centerX, centerY, width: textRect.width, height: textRect.height, text: normalizedText });
            }

            return (
              <React.Fragment key={`ocr-translation-line-${idx}`}>
                <div
                  id={layer ? `layer-mask-${layer.id}` : `layer-mask-${idx}`}
                  style={{
                    left: maskRect.left,
                    top: maskRect.top,
                    width: maskRect.width,
                    maxWidth: maskRect.width,
                    minWidth: maskRect.width,
                    height: maskRect.height,
                    maxHeight: maskRect.height,
                    minHeight: maskRect.height,
                    backgroundColor: maskBackgroundColor,
                    overflow: 'hidden',
                    zIndex: Math.max(1, Math.round(maskRect.top)),
                    transform: rotationDeg !== 0 ? `rotate(${rotationDeg.toFixed(2)}deg)` : undefined,
                    transformOrigin: rotationDeg !== 0 ? rotationOrigin : undefined,
                  }}
                  className="absolute"
                />
                {isMaskOnlyLine ? null : (
                  <div
                    id={layer ? `layer-text-${layer.id}` : `layer-text-${idx}`}
                    style={{
                      left: textRect.left,
                      top: textRect.top,
                      width: textRect.width,
                      maxWidth: textRect.width,
                      minWidth: textRect.width,
                      height: textRect.height,
                      maxHeight: textRect.height,
                      minHeight: textRect.height,
                      overflow: 'visible',
                      zIndex: 1000 + Math.max(1, Math.round(textRect.top)),
                      transform: rotationDeg !== 0 ? `rotate(${rotationDeg.toFixed(2)}deg)` : undefined,
                      transformOrigin: rotationDeg !== 0 ? rotationOrigin : undefined,
                    }}
                    className="absolute"
                  >
                    <div
                      style={{
                        position: 'absolute',
                        left: innerLeft,
                        top: paintOffsetTop,
                        width: innerWidth,
                        maxWidth: innerWidth,
                        minWidth: innerWidth,
                        height: paintHeight,
                        maxHeight: paintHeight,
                        minHeight: paintHeight,
                        padding: `${typography.padY + extraTopPad}px ${typography.padX}px ${typography.padY + extraBottomPad}px ${typography.padX}px`,
                        color: layerTextColor,
                        fontSize: typography.fontSize,
                        lineHeight: typography.lineHeight,
                        fontFamily: overlayFontFamily,
                        fontWeight: layer?.bold ? 'bold' : overlayTextWeight,
                        boxSizing: 'border-box',
                        display: 'flex',
                        alignItems: isComicCenter ? 'center' : 'flex-start',
                        justifyContent: layout?.alignment === 'center' ? 'center' : 'flex-start',
                        textAlign: layout?.alignment === 'center' ? 'center' : 'left',
                        whiteSpace: typography.forceSingleLine ? 'nowrap' : 'pre-wrap',
                        wordBreak: 'normal',
                        lineBreak: hasThaiText ? 'auto' : 'normal',
                        WebkitTextStrokeWidth: overlayStrokeWidth > 0 ? `${overlayStrokeWidth.toFixed(2)}px` : undefined,
                        WebkitTextStrokeColor: overlayStrokeWidth > 0 ? palette.textStrokeColor : undefined,
                        textShadow: palette.textShadow,
                        overflowWrap: 'break-word',
                        overflow: 'visible',
                      }}
                    >
                          {overlayContent}
                    </div>
                  </div>
                )}
              </React.Fragment>
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
      />
    </>
  );
});
PDFPageOverlay.displayName = 'PDFPageOverlay';

let activePageChangeTimeout: ReturnType<typeof setTimeout> | null = null;
let lastPageUpdateTime = 0;
let pendingPage = 1;
let isUserInteracting = false;
let userInteractionTimer: ReturnType<typeof setTimeout> | null = null;

const startUserInteraction = () => {
  isUserInteracting = true;
  if (userInteractionTimer) {
    clearTimeout(userInteractionTimer);
    userInteractionTimer = null;
  }
};

const endUserInteraction = (delay = 800) => {
  if (userInteractionTimer) {
    clearTimeout(userInteractionTimer);
  }
  userInteractionTimer = setTimeout(() => {
    isUserInteracting = false;
    userInteractionTimer = null;
  }, delay);
};

const PDFPageContainer: React.FC<{
  pageNum: number;
  onPageLoadSuccess?: (page: any) => void;
  onPageRenderSuccess?: () => void;
  isProgrammaticScrollRef?: React.RefObject<boolean>;
  previewModeOverride?: 'original' | 'translated';
}> = ({ pageNum, onPageLoadSuccess: externalOnLoadSuccess, onPageRenderSuccess: externalOnRenderSuccess, isProgrammaticScrollRef, previewModeOverride }) => {
  const {
    viewMode,
    setPage,
    documentId,
    fileUrl,
  } = useProjectStore();

  const options = useOCRTextLayerStore((s) => s.options);

  const [pageRenderTick, setPageRenderTick] = useState(0);
  const [isCacheLoading, setIsCacheLoading] = useState(false);
  const [isVisible, setIsVisible] = useState(viewMode === 'single');
  const [hasBeenVisible, setHasBeenVisible] = useState(viewMode === 'single');
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible) {
      setHasBeenVisible(true);
    }
  }, [isVisible]);

  useEffect(() => {
    if (viewMode === 'single') {
      setIsVisible(true);
      return;
    }

    const preloadObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting);
        });
      },
      {
        rootMargin: '1400px 0px 1400px 0px',
      }
    );

    const activePageObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (
            entry.isIntersecting &&
            !isProgrammaticScrollRef?.current &&
            isUserInteracting &&
            previewModeOverride !== 'translated' &&
            useProjectStore.getState().currentPage !== pageNum
          ) {
            const now = performance.now();
            pendingPage = pageNum;
            lastPageUpdateTime = now;
            const capturedTime = now;

            if (activePageChangeTimeout) {
              clearTimeout(activePageChangeTimeout);
            }
            activePageChangeTimeout = setTimeout(() => {
              React.startTransition(() => {
                if (capturedTime < lastPageUpdateTime) return;
                if (isProgrammaticScrollRef?.current || !isUserInteracting) return;
                setPage(pendingPage);
              });
              activePageChangeTimeout = null;
            }, 150);
          }
        });
      },
      {
        threshold: 0,
        rootMargin: '-45% 0px -45% 0px',
      }
    );

    if (pageRef.current) {
      preloadObserver.observe(pageRef.current);
      activePageObserver.observe(pageRef.current);
    }

    return () => {
      preloadObserver.disconnect();
      activePageObserver.disconnect();
    };
  }, [pageNum, viewMode, isProgrammaticScrollRef, setPage]);

  // Background load OCR and translation cache from IndexedDB/SQLite for this page when it mounts
  useEffect(() => {
    if (!documentId) return;
    if (!isVisible) return; // Only load cache if page is visible or preloading
    let canceled = false;
    const activeEngine = (options.engine || 'paddleocr') as OCREngine;
    const ocrState = useOCRTextLayerStore.getState();

    const loadCache = async () => {
      // 1. Load OCR cache if not in memory
      const hasOcr = ocrState.ocrByPageEngine.get(pageNum)?.has(activeEngine);
      const hasTranslation = ocrState.translationCacheByPage.has(pageNum);

      let startedLoading = false;
      if (!hasOcr || !hasTranslation) {
        setIsCacheLoading(true);
        startedLoading = true;
      }

      try {
        const ocrPromise = !hasOcr
          ? dbService.getOCR(documentId, pageNum, activeEngine).catch((err) => {
              console.warn(`[PDFPageContainer] Failed to load OCR cache for page ${pageNum}:`, err);
              return null;
            })
          : Promise.resolve(null);

        const transPromise = !hasTranslation
          ? dbService.getTranslationCachePage(documentId, pageNum).catch((err) => {
              console.warn(`[PDFPageContainer] Failed to load translation cache for page ${pageNum}:`, err);
              return null;
            })
          : Promise.resolve(null);

        const [cached, rows] = await Promise.all([ocrPromise, transPromise]);

        if (cached && !canceled) {
          if (cached.algorithmVersion === OCR_ALGORITHM_VERSION && (cached.ocrRawVersion ?? 0) >= OCR_RAW_VERSION) {
            cached.pageNumber = pageNum;
            ocrState.setPageOCRForEngine(pageNum, activeEngine, cached);
            console.log(`[PDFPageContainer] Background loaded OCR cache for page ${pageNum} engine=${activeEngine}`);
          } else {
            console.log(`[PDFPageContainer] Background OCR cache version mismatch for page ${pageNum}: expected algorithm v${OCR_ALGORITHM_VERSION} & raw v${OCR_RAW_VERSION}, got algorithm v${cached.algorithmVersion} & raw v${cached.ocrRawVersion ?? 0}`);
          }
        }

        // 2. Load Translation cache if not in memory
        if (Array.isArray(rows) && rows.length > 0 && !canceled) {
          console.log(`[PDFPageContainer] Background loaded translation cache for page ${pageNum} rows=${rows.length}`);
          let preferredKey: string | null = null;
          const sortedRows = [...rows].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

          for (const row of sortedRows) {
            if (row.key && !hasCurrentOCRTranslationCacheVersion(row.key)) {
              continue;
            }
            const normalizedEntry: OCRTranslationCacheEntry = {
              ...row,
              pageNum,
              ocrEngine: (row.ocrEngine || 'paddleocr') as OCREngine,
              translationMode: row.translationMode === 'official' ? 'official' : row.translationMode === 'adaptive' ? 'adaptive' : row.translationMode === 'manhwa' ? 'manhwa' : 'manga',
              translatorEngine: row.translatorEngine === 'ai' ? 'ai' : 'offline',
              translatedByIndex: Array.isArray(row.translatedByIndex) ? row.translatedByIndex.map((item: any) => {
                if (item) {
                  const source = String(item.sourceText || '').trim();
                  const translated = String(item.text || '').trim();
                  const cleanSource = source.toUpperCase().replace(/[^A-Z0-9]/g, '');
                  const cleanTrans = translated.toUpperCase().replace(/[^A-Z0-9]/g, '');
                  if (!translated || cleanSource === cleanTrans || (/[a-zA-Z]/.test(translated) && !/[\u0E00-\u0E7F]/.test(translated))) {
                    const glossaryMatch = lookupShortPhraseTh(source) || lookupShortPhraseTh(cleanSource);
                    if (glossaryMatch) {
                      return { ...item, text: glossaryMatch };
                    }
                    const words = source.trim().split(/\s+/);
                    if (words.length > 1) {
                      const translatedWords = words.map(w => lookupShortPhraseTh(w) || lookupShortPhraseTh(w.replace(/[^A-Za-z0-9]/g, '')) || w);
                      if (translatedWords.some(tw => /[\u0E00-\u0E7F]/.test(tw))) {
                        return { ...item, text: translatedWords.join(' ') };
                      }
                    }
                  }
                }
                return item;
              }) : [],
            };
            ocrState.setTranslationCacheEntry(pageNum, normalizedEntry.key, normalizedEntry);

            if (!preferredKey && row.key && row.key.includes(activeEngine)) {
              preferredKey = row.key;
            }
          }

          if (!preferredKey && sortedRows.length > 0 && sortedRows[0].key) {
            preferredKey = sortedRows[0].key;
          }

          if (preferredKey) {
            ocrState.setActiveTranslationCacheKey(pageNum, preferredKey);
            ocrState.setTranslationPreviewMode('translated');
          }
        }
      } finally {
        if (startedLoading && !canceled) {
          setIsCacheLoading(false);
        }
      }
    };

    // Fast cache loader: Load database cache quickly (40ms debounce) without 1000ms idle callback blocker
    const timer = setTimeout(() => {
      if (!canceled) void loadCache();
    }, 40);

    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [pageNum, documentId, options.engine, fileUrl, isVisible]);

  const handlePageClick = useCallback(() => {
    if (useProjectStore.getState().currentPage !== pageNum) {
      setPage(pageNum);
    }
  }, [pageNum, setPage]);

  const onPageLoadSuccess = useCallback((page: any) => {
    if (externalOnLoadSuccess) {
      externalOnLoadSuccess(page);
    }
  }, [externalOnLoadSuccess]);

  const onPageRenderSuccess = useCallback(() => {
    setPageRenderTick((prev) => prev + 1);
    if (externalOnRenderSuccess) {
      externalOnRenderSuccess();
    }
  }, [externalOnRenderSuccess]);

  return (
    <div 
      ref={pageRef}
      onMouseDown={handlePageClick}
      data-page-container={pageNum}
      style={{ minHeight: pageRenderTick > 0 ? undefined : 1130 }}
      className="relative mb-4 group pdf-page-container"
    >
      <Page 
        pageNumber={pageNum} 
        renderTextLayer={false} 
        renderAnnotationLayer={false}
        className="border border-slate-700 bg-white"
        width={800}
        onLoadSuccess={onPageLoadSuccess}
        onRenderSuccess={onPageRenderSuccess}
      />
      {isCacheLoading && (
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-700/50 text-xs text-slate-200 shadow-lg animate-pulse pointer-events-none select-none">
          <svg className="animate-spin h-3.5 w-3.5 text-sky-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="font-medium tracking-wide">กำลังโหลดแคช...</span>
        </div>
      )}
      {hasBeenVisible && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ display: isVisible ? 'block' : 'none' }}
        >
          <PDFPageOverlay
            pageNum={pageNum}
            pageRef={pageRef}
            pageRenderTick={pageRenderTick}
            isVisible={isVisible}
            previewModeOverride={previewModeOverride}
          />
        </div>
      )}
    </div>
  );
};

interface PDFCanvasProps {
  previewModeOverride?: 'original' | 'translated';
}

export const PDFCanvas: React.FC<PDFCanvasProps> = React.memo(({ previewModeOverride }) => {
  const {
    fileUrl,
    fileData,
    currentPage,
    totalPages,
    setTotalPages,
    viewMode,
  } = useProjectStore();

  const zoom = useUIStore((s) => s.zoom);
  const pan = useUIStore((s) => s.pan);
  const setZoom = useUIStore((s) => s.setZoom);
  const setPan = useUIStore((s) => s.setPan);
  const setView = useUIStore((s) => s.setView);
  const activeTool = useUIStore((s) => s.activeTool);
  const { regions, setRegions, setIsProcessing, processRequest } = useSegmentationStore();
  const sourceLanguage = useProjectStore((s) => s.sourceLanguage);


  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement>(null);
  const panRef = useRef(pan);
  
  const wheelTransformRafRef = useRef<number | null>(null);
  const wheelIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragTransformRafRef = useRef<number | null>(null);

  const stateRef = useRef({ zoom, pan });

  useEffect(() => {
    stateRef.current = { zoom, pan };
    if (!isDragging) {
      panRef.current = pan;
    }
  }, [zoom, pan, isDragging]);

  const prevPageRef = useRef<number | null>(null);
  const prevViewModeRef = useRef(viewMode);

  // Track programmatic scrolling to lock active page updates during animations & initial mount
  const isProgrammaticScrollRef = useRef(currentPage > 1);

  // Sync scroll position when switching to continuous viewMode or clicking LeftSidebar thumbnails or on initial load
  useEffect(() => {
    const pageChanged = prevPageRef.current !== null && currentPage !== prevPageRef.current;
    const viewModeChanged = viewMode !== prevViewModeRef.current;
    const isInitialMount = prevPageRef.current === null;

    if (viewMode === 'continuous' && (pageChanged || viewModeChanged || (isInitialMount && currentPage > 1))) {
      if (isUserInteracting) {
        prevPageRef.current = currentPage;
        prevViewModeRef.current = viewMode;
        return;
      }
      
      // Set programmatic scroll lock to prevent IntersectionObservers on off-target pages
      // from firing setPage and overriding the target page before the scroll snap finishes.
      isProgrammaticScrollRef.current = true;
      if (activePageChangeTimeout) {
        clearTimeout(activePageChangeTimeout);
        activePageChangeTimeout = null;
      }

      const timer = setTimeout(() => {
        const pageElement = (
          containerRef.current?.querySelector(
            `.pdf-canvas-document [data-page-container="${currentPage}"]`
          ) || document.querySelector(
            `.pdf-canvas-document [data-page-container="${currentPage}"]`
          )
        ) as HTMLElement | null;

        if (containerRef.current) {
          const estimatedOffsetTop = (currentPage - 1) * 1146;
          const offsetTop = pageElement && pageElement.offsetTop > 0 ? pageElement.offsetTop : estimatedOffsetTop;
          const targetY = -(offsetTop * zoom) + 20;

          // Read the latest pan.y from the stateRef to check if the change was substantial
          const currentPanY = stateRef.current.pan.y;
          const diff = Math.abs(currentPanY - targetY);

          // Snap if the offset diff is substantial or if on initial load / mode switch
          if (diff > 20 || viewModeChanged || isInitialMount) {
            const { clientWidth } = containerRef.current;
            const pageWidth = pageElement?.clientWidth || 800;
            const scaledWidth = pageWidth * zoom;
            const targetX = (clientWidth - scaledWidth) / 2;

            setPan(targetX, targetY);
          }
        }

        // Release the programmatic scroll lock after the transition animation (0.1s transform duration + buffer)
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 500);

      }, isInitialMount ? 150 : 80);

      prevPageRef.current = currentPage;
      prevViewModeRef.current = viewMode;
      return () => {
        clearTimeout(timer);
        isProgrammaticScrollRef.current = false;
      };
    }

    prevPageRef.current = currentPage;
    prevViewModeRef.current = viewMode;
  }, [currentPage, viewMode, zoom, setPan]);

  const onDocumentLoadSuccess = React.useCallback(({ numPages }: { numPages: number }) => {
    setTotalPages(numPages);
  }, [setTotalPages]);

  const onPageLoadSuccess = React.useCallback(async (page: any) => {
    if (previewModeOverride === 'translated') {
      // Secondary split-view canvas should not reset or recalculate global zoom/pan
      return;
    }

    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      const { width, height } = page.originalWidth ? { width: page.originalWidth, height: page.originalHeight } : page;
      
      const scaleX = (clientWidth - 40) / width;
      const scaleY = (clientHeight - 40) / height;
      const fitScale = Math.min(scaleX, scaleY, 1);
      
      if (stateRef.current.zoom === 1) {
        setZoom(fitScale);
      }
      
      const scaledWidth = width * fitScale;
      const x = (clientWidth - scaledWidth) / 2;
      
      if (useProjectStore.getState().viewMode === 'single') {
        setPan(x, 20);
      } else {
        const targetPage = useProjectStore.getState().currentPage;
        if (targetPage > 1) {
          isProgrammaticScrollRef.current = true;
          if (activePageChangeTimeout) {
            clearTimeout(activePageChangeTimeout);
            activePageChangeTimeout = null;
          }
          const pageElement = (
            containerRef.current?.querySelector(
              `.pdf-canvas-document [data-page-container="${targetPage}"]`
            ) || document.querySelector(
              `.pdf-canvas-document [data-page-container="${targetPage}"]`
            )
          ) as HTMLElement | null;
          const estimatedOffsetTop = (targetPage - 1) * 1146;
          const offsetTop = pageElement && pageElement.offsetTop > 0 ? pageElement.offsetTop : estimatedOffsetTop;
          const targetY = -(offsetTop * fitScale) + 20;
          setPan(x, targetY);
          setTimeout(() => {
            isProgrammaticScrollRef.current = false;
          }, 500);
        } else {
          // Keep current vertical pan or default to top
          setPan(x, stateRef.current.pan.y !== 0 ? stateRef.current.pan.y : 20);
        }
      }
    }
  }, [setZoom, setPan, previewModeOverride]);

  const syncContentTransform = useCallback((nextPan: { x: number; y: number }, nextZoom: number) => {
    if (!contentRef.current) return;
    const transformStr = `translate(${nextPan.x}px, ${nextPan.y}px) scale(${nextZoom})`;
    contentRef.current.style.transform = transformStr;

    // Real-time synchronization for split-view:
    const isSplit = useUIStore.getState().viewMode === 'split';
    if (isSplit) {
      const workspace = contentRef.current.closest('.workspace-viewport');
      if (workspace) {
        const allContents = workspace.querySelectorAll('.pdf-canvas-content, .image-canvas-content');
        allContents.forEach((el) => {
          if (el !== contentRef.current) {
            (el as HTMLElement).style.transform = transformStr;
          }
        });
      }
    }
  }, []);

  useEffect(() => {
    if (processRequest > 0) {
      captureAndProcess();
    }
  }, [processRequest]);

  const captureAndProcess = async () => {
    console.log("[PDFCanvas] Processing Triggered...");
    const canvas = document.querySelector(`.pdf-canvas-document .react-pdf__Page[data-page-number="${currentPage}"] canvas`) as HTMLCanvasElement;
    
    if (!canvas) {
      console.warn("[PDFCanvas] Canvas not found for vision processing");
      return;
    }

    console.log("[PDFCanvas] Canvas found, sending to Vision Service...");
    setIsProcessing(true);
    
    try {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const ctx = tempCanvas.getContext('2d');
      
      let imageUrl = '';
      
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(canvas, 0, 0);
        imageUrl = tempCanvas.toDataURL('image/jpeg', 0.95);
        // Optimize Memory: Explicitly release memory by resizing to 0x0
        try {
          tempCanvas.width = 0;
          tempCanvas.height = 0;
        } catch (e) { /* ignore */ }
      } else {
        imageUrl = canvas.toDataURL('image/jpeg', 0.95);
      }

      console.log(`[PDFCanvas] Image captured: ${canvas.width}x${canvas.height}, URL length: ${imageUrl.length}`);
      console.log(`[PDFCanvas] OCR Language: ${sourceLanguage}`);
      
      const translationMode = useProjectStore.getState().translationMode;
      const documentType = translationMode === 'official' || translationMode === 'adaptive' ? 'document' : 'manga';
      
      console.log(`[PDFCanvas] Document type: ${documentType}`);
      
      const detectedRegions = await visionService.segmentImage(
        imageUrl, 
        sourceLanguage,
        documentType
      );
      
      console.log(`[PDFCanvas] Vision Service returned ${detectedRegions.length} regions:`, 
        detectedRegions.map(r => `${r.type}(${r.originalText?.substring(0, 20)}...)`).join(', ')
      );
      
      setRegions(detectedRegions);
      
    } catch (error) {
      console.error("[PDFCanvas] Vision Service Error:", error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[PDFCanvas] OCR Failed: ${errorMessage}`);
      setRegions([]);
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      startUserInteraction();

      // Immediately kill CSS transition via direct DOM — zero React re-render cost
      if (contentRef.current) {
        contentRef.current.style.transition = 'none';
      }

      if (wheelIdleTimerRef.current) {
        clearTimeout(wheelIdleTimerRef.current);
      }

      if (e.ctrlKey) {
        const scaleAmount = -e.deltaY * 0.001;
        const newZoom = Math.min(Math.max(0.1, stateRef.current.zoom + scaleAmount), 5);
        
        // คำนวณจุดหมุนและระยะเลื่อนชดเชยของภาพ เพื่อซูมตามตำแหน่งเมาส์ (Zoom-to-Mouse Anchor)
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const zoomFactor = newZoom / stateRef.current.zoom;
        const nextPan = {
          x: mouseX - (mouseX - stateRef.current.pan.x) * zoomFactor,
          y: mouseY - (mouseY - stateRef.current.pan.y) * zoomFactor,
        };

        panRef.current = nextPan;
        // Keep stateRef in sync so rapid zoom events accumulate correctly
        stateRef.current = { zoom: newZoom, pan: nextPan };

        if (wheelTransformRafRef.current !== null) {
          cancelAnimationFrame(wheelTransformRafRef.current);
        }
        wheelTransformRafRef.current = requestAnimationFrame(() => {
          syncContentTransform(nextPan, newZoom);
          wheelTransformRafRef.current = null;
        });
      } else {
        const nextPan = {
          x: stateRef.current.pan.x - e.deltaX,
          y: stateRef.current.pan.y - e.deltaY,
        };
        panRef.current = nextPan;
        // Keep stateRef in sync so rapid scroll events accumulate correctly
        stateRef.current = { ...stateRef.current, pan: nextPan };

        if (wheelTransformRafRef.current !== null) {
          cancelAnimationFrame(wheelTransformRafRef.current);
        }
        wheelTransformRafRef.current = requestAnimationFrame(() => {
          syncContentTransform(nextPan, stateRef.current.zoom);
          wheelTransformRafRef.current = null;
        });
      }

      // Commit to Zustand exactly once when scrolling stops (~120 ms after last tick).
      // Using setView (atomic pan+zoom) → single React re-render instead of two.
      // React then restores the CSS transition via the rendered style prop.
      wheelIdleTimerRef.current = setTimeout(() => {
        wheelIdleTimerRef.current = null;
        setView(panRef.current, stateRef.current.zoom);
        endUserInteraction(200);
      }, 120);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [setView, syncContentTransform]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'hand' || e.button === 1 || e.ctrlKey) { 
      setIsDragging(true);
      startUserInteraction();
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      e.preventDefault();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      e.preventDefault();
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      panRef.current = { x: newX, y: newY };

      if (dragTransformRafRef.current !== null) {
        cancelAnimationFrame(dragTransformRafRef.current);
      }
      dragTransformRafRef.current = requestAnimationFrame(() => {
        if (contentRef.current) {
          const transformStr = `translate(${newX}px, ${newY}px) scale(${stateRef.current.zoom})`;
          contentRef.current.style.transform = transformStr;

          // Real-time synchronization for split-view:
          const isSplit = useUIStore.getState().viewMode === 'split';
          if (isSplit) {
            const workspace = contentRef.current.closest('.workspace-viewport');
            if (workspace) {
              const allContents = workspace.querySelectorAll('.pdf-canvas-content, .image-canvas-content');
              allContents.forEach((el) => {
                if (el !== contentRef.current) {
                  (el as HTMLElement).style.transform = transformStr;
                }
              });
            }
          }
        }
        dragTransformRafRef.current = null;
      });
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      if (dragTransformRafRef.current !== null) {
        cancelAnimationFrame(dragTransformRafRef.current);
        dragTransformRafRef.current = null;
      }
      setPan(panRef.current.x, panRef.current.y);
      endUserInteraction(800);
    }
  };

  useEffect(() => {
    return () => {
      if (wheelTransformRafRef.current !== null) {
        cancelAnimationFrame(wheelTransformRafRef.current);
        wheelTransformRafRef.current = null;
      }
      if (dragTransformRafRef.current !== null) {
        cancelAnimationFrame(dragTransformRafRef.current);
        dragTransformRafRef.current = null;
      }
      if (wheelIdleTimerRef.current) {
        clearTimeout(wheelIdleTimerRef.current);
        wheelIdleTimerRef.current = null;
      }
    };
  }, []);

  const pdfSource = useMemo(() => {
    if (fileUrl) return fileUrl;
    if (!fileData) return null;
    return { data: new Uint8Array(fileData) };
  }, [fileUrl, fileData]);

  const docKey = fileUrl ?? 'pdf-document';

  return (
    <div 
      ref={containerRef}
      className={`w-full h-full overflow-hidden relative bg-slate-900/50 ${activeTool === 'hand' ? 'cursor-grab active:cursor-grabbing' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div 
        ref={contentRef}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          // During wheel scroll, transition is disabled directly on the DOM element
          // (contentRef.current.style.transition = 'none') without React re-renders.
          // React restores this value after the idle commit via setView.
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          willChange: 'transform'
        }}
        className="absolute top-0 left-0 origin-top-left pdf-canvas-content"
      >
        <div className="relative shadow-2xl">
          <Document
            key={docKey}
            file={pdfSource}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(error) => console.error('[PDFCanvas] PDF load error:', error)}
            className="flex flex-col gap-4 pdf-canvas-document"
          >
            {viewMode === 'single' ? (
              <PDFPageContainer
                pageNum={currentPage}
                onPageLoadSuccess={onPageLoadSuccess}
                isProgrammaticScrollRef={isProgrammaticScrollRef}
                previewModeOverride={previewModeOverride}
              />
            ) : (
              Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <PDFPageContainer
                  key={`page_${pageNum}`}
                  pageNum={pageNum}
                  onPageLoadSuccess={pageNum === 1 ? onPageLoadSuccess : undefined}
                  isProgrammaticScrollRef={isProgrammaticScrollRef}
                  previewModeOverride={previewModeOverride}
                />
              ))
            )}
          </Document>
        </div>
      </div>

    </div>
  );
});

PDFCanvas.displayName = 'PDFCanvas';
