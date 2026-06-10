import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Document, Page } from 'react-pdf';
import '../../services/pdf/pdfjsWorker';
import { useProjectStore } from '../../stores/useProjectStore';
import { useUIStore } from '../../stores/useUIStore';
import { useSegmentationStore } from '../../stores/useSegmentationStore';
import { useOCRTextLayerStore, OCRTranslationCacheEntry } from '../../stores/useOCRTextLayerStore';
import { dbService } from '../../services/dbService';
import { OCR_ALGORITHM_VERSION } from '../../services/vision/ocrVersion';
import { OCREngine } from '../../types';
import { useLayerStore } from '../../stores/useLayerStore';
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
  return Boolean(source && translated && source === translated);
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

const PDFPageContainer: React.FC<{
  pageNum: number;
  onPageLoadSuccess?: (page: any) => void;
  onPageRenderSuccess?: () => void;
  isProgrammaticScrollRef?: React.RefObject<boolean>;
}> = ({ pageNum, onPageLoadSuccess: externalOnLoadSuccess, onPageRenderSuccess: externalOnRenderSuccess, isProgrammaticScrollRef }) => {
  const {
    currentPage,
    viewMode,
    sourceLanguage,
    targetLanguage,
    translationMode,
    overlayThaiFontEnabled,
    overlayFontPreset,
    overlayFontSizeScale,
    setPage,
    documentId,
    fileUrl,
  } = useProjectStore();

  const { activeTool } = useUIStore();
  const regions = useSegmentationStore((s) => s.regions);

  const {
    allPagesOCR,
    ocrByPageEngine,
    showDebugOverlay,
    options,
    translationPreviewMode,
    translationCacheByPage,
    activeTranslationKeyByPage,
    ocrResultSearchQuery,
  } = useOCRTextLayerStore();

  const layersByPage = useLayerStore((state) => state.layersByPage);
  const groupsByPage = useLayerStore((state) => state.groupsByPage);
  const editingLayerId = useLayerStore((state) => state.editingLayerId);
  const deletedLineIndexesByPage = useLayerStore((state) => state.deletedLineIndexesByPage);

  const [ocrOverlayTransform, setOcrOverlayTransform] = useState({
    scaleX: 1,
    scaleY: 1,
    offsetX: 0,
    offsetY: 0
  });
  const [pageRenderTick, setPageRenderTick] = useState(0);
  const [translatedLinePalette, setTranslatedLinePalette] = useState<Map<number, OverlayPalette>>(new Map());
  const [isVisible, setIsVisible] = useState(viewMode === 'single');

  const pageRef = useRef<HTMLDivElement>(null);

  // Viewport observer: only render overlays when the page is visible or within 600px,
  // and sync currentPage state once a page is at least 50% visible in the viewport.
  useEffect(() => {
    if (viewMode === 'single') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            // Skip updating active page state during programmatic scrolling or view mode transition,
            // as this prevents the stale viewport position (e.g. at page 1) from reverting the active page
            // before the scroll-snap positioning completes.
            if (
              entry.intersectionRatio >= 0.5 &&
              !isProgrammaticScrollRef?.current &&
              useProjectStore.getState().currentPage !== pageNum
            ) {
              setPage(pageNum);
            }
          } else {
            if (entry.intersectionRatio === 0) {
              setIsVisible(false);
            }
          }
        });
      },
      {
        threshold: [0.0, 0.5],
        rootMargin: '600px 0px 600px 0px',
      }
    );

    if (pageRef.current) {
      observer.observe(pageRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [pageNum, viewMode, setPage, isProgrammaticScrollRef]);

  // Background load OCR and translation cache from IndexedDB/SQLite for this page when it mounts
  useEffect(() => {
    if (!documentId) return;
    let canceled = false;
    const activeEngine = (options.engine || 'paddleocr') as OCREngine;
    const ocrState = useOCRTextLayerStore.getState();

    const loadCache = async () => {
      // 1. Load OCR cache if not in memory
      const hasOcr = ocrState.ocrByPageEngine.get(pageNum)?.has(activeEngine);
      if (!hasOcr) {
        try {
          const cached = await dbService.getOCR(documentId, pageNum, activeEngine);
          if (cached && !canceled) {
            if (cached.algorithmVersion === OCR_ALGORITHM_VERSION) {
              cached.pageNumber = pageNum;
              ocrState.setPageOCRForEngine(pageNum, activeEngine, cached);
              console.log(`[PDFPageContainer] Background loaded OCR cache for page ${pageNum} engine=${activeEngine}`);
            } else {
              console.log(`[PDFPageContainer] Background OCR cache version mismatch for page ${pageNum}: expected ${OCR_ALGORITHM_VERSION}, got ${cached.algorithmVersion}`);
            }
          }
        } catch (err) {
          console.warn(`[PDFPageContainer] Failed to load OCR cache for page ${pageNum}:`, err);
        }
      }

      // 2. Load Translation cache if not in memory
      const hasTranslation = ocrState.translationCacheByPage.has(pageNum);
      if (!hasTranslation) {
        try {
          const rows = await dbService.getTranslationCachePage(documentId, pageNum);
          if (Array.isArray(rows) && rows.length > 0 && !canceled) {
            console.log(`[PDFPageContainer] Background loaded translation cache for page ${pageNum} rows=${rows.length}`);
            for (const row of rows) {
              const normalizedEntry: OCRTranslationCacheEntry = {
                ...row,
                pageNum,
                ocrEngine: (row.ocrEngine || 'paddleocr') as OCREngine,
                translationMode: row.translationMode === 'official' ? 'official' : row.translationMode === 'adaptive' ? 'adaptive' : row.translationMode === 'manhwa' ? 'manhwa' : 'manga',
                translatorEngine: row.translatorEngine === 'ai' ? 'ai' : 'offline',
                translatedByIndex: Array.isArray(row.translatedByIndex) ? row.translatedByIndex : [],
              };
              ocrState.setTranslationCacheEntry(pageNum, normalizedEntry.key, normalizedEntry);
            }
          }
        } catch (err) {
          console.warn(`[PDFPageContainer] Failed to load translation cache for page ${pageNum}:`, err);
        }
      }
    };

    // Wait slightly to prevent blocking initial render thread
    const timer = setTimeout(() => {
      void loadCache();
    }, 50);

    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [pageNum, documentId, options.engine, fileUrl]);

  const handlePageClick = useCallback(() => {
    if (useProjectStore.getState().currentPage !== pageNum) {
      setPage(pageNum);
    }
  }, [pageNum, setPage]);

  const selectedEngine = (options.engine || 'paddleocr');

  const resolveEngineScopedPageOCR = (pNum: number) => {
    const byEngine = ocrByPageEngine.get(pNum)?.get(selectedEngine);
    if (byEngine) return { ocr: byEngine, effectiveEngine: selectedEngine };

    const fallback = allPagesOCR.get(pNum);
    if (!fallback) return undefined;
    const fallbackEngine = (fallback.ocrEngine || selectedEngine);
    return { ocr: fallback, effectiveEngine: fallbackEngine };
  };

  const resolvedPageOCR = resolveEngineScopedPageOCR(pageNum);
  const currentPageOCR = resolvedPageOCR?.ocr;
  const effectiveOCREngine = resolvedPageOCR?.effectiveEngine || selectedEngine;
  const pageOCRsByEngine = ocrByPageEngine.get(pageNum);
  const currentPageTranslationMap = translationCacheByPage.get(pageNum);
  const activeTranslationKey = activeTranslationKeyByPage.get(pageNum);

  const translationOverlayContext = useMemo(() => resolveTranslationOverlayContext({
    currentPageOCR,
    optionsEngine: effectiveOCREngine as any,
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
    currentPageOCR,
    currentPageTranslationMap,
    effectiveOCREngine,
    options.language,
    sourceLanguage,
    targetLanguage,
    translationMode,
    translationPreviewMode,
    pageOCRsByEngine,
  ]);

  const rawCurrentPageLayers = layersByPage.get(pageNum) || [];
  const rawCurrentPageGroups = groupsByPage.get(pageNum) || [];

  // Real-Time Layer Ghost Noise Filter: surgical cleanup of spiky balloon border layers in frontend view
  const currentPageLayers = useMemo(() => {
    return rawCurrentPageLayers.filter((layer) => {
      if (!layer) return false;
      // 1. If explicitly edited by user, always keep it (safety first)
      if (layer.userEdited) return true;

      const text = String(layer.sourceText || layer.text || '').trim();
      if (!text) return false;

      const compact = text.replace(/\s+/g, '');
      const asciiCompact = compact.replace(/[^A-Za-z0-9]/g, '');
      const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(compact);

      // A. Pure symbol/punctuation noise layers generated by spiky balloon edges (e.g. "|||", "///", "\\", "---")
      const isPureSymbolNoise = !hasCjkOrThai && asciiCompact.length === 0;
      if (isPureSymbolNoise) {
        return false;
      }

      // B. Repetitive vertical lines, slashes, or symbol junk (classic signature of spiky balloon borders, e.g. "lll", "III", "111", "I l I")
      const isVerticalLineJunk = !hasCjkOrThai && /^[lI1|!/\\_\-s]+$/i.test(compact) && !/^[IAO]$/i.test(asciiCompact);
      if (isVerticalLineJunk) {
        return false;
      }

      // C. Single-character junk (English letters or digits that aren't valid single-letter words like I, A, O)
      const isSingleCharJunk = !hasCjkOrThai
        && asciiCompact.length === 1
        && !/^[IAO]$/i.test(asciiCompact);
      if (isSingleCharJunk) {
        return false;
      }

      // D. Tiny noise junk boxes with very small area and short ascii text (spiky edges yield high confidence/larger areas)
      const bbox = layer.bbox;
      if (bbox) {
        const width = Math.max(1, Number(bbox.x1 || 0) - Number(bbox.x0 || 0));
        const height = Math.max(1, Number(bbox.y1 || 0) - Number(bbox.y0 || 0));
        const area = width * height;

        const isKnownShortWord = /^[IAO]$/i.test(asciiCompact) || 
          /^(?:OK|NO|HI|OH|AM|AN|AS|AT|BE|BY|DO|GO|HE|IF|IN|IS|IT|ME|MY|OF|ON|OR|SO|TO|UP|US|WE|YE|AH|HA|EH|UH|LO|YA|UM|YES|FOR|AND|BUT|YOU|THE|NOT|HER|HIS|HIM|SHE|CAN|OUT|GET|HOW|WHO|WHY|HEY|BOY|RUN|SAY|SEE|MAN|OUR|DAY|NEW|TOO|ALL|ANY|BAD|BIG|CRY|DID|EAT|END|FAR|FIT|FLY|FUN|GUY|HOT|ITS|JOB|KEY|LET|LIE|LOT|MAD|MAY|MOM|DAD|OLD|ONE|TWO|OWN|PAY|SAD|SON|TRY|USE|WAY|WIN|YET|WOW|YAY|YEP|NAH|NOP|DIE|PIG|CUM|COCK|OHHH|OHHHH|OHHHHH|AGAA|MORE|YOURE|STOOOOP|STOAOOP|STOAAOP)$/i.test(asciiCompact);
        const isTinyJunkBox = !hasCjkOrThai
          && asciiCompact.length <= 3
          && area <= 8000
          && !isKnownShortWord;

        if (isTinyJunkBox) {
          return false;
        }
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
    const deletedForPage = deletedLineIndexesByPage.get(pageNum);
    if (deletedForPage) {
      deletedForPage.forEach(idx => hidden.add(idx));
    }
    return hidden;
  }, [currentPageLayers, editingLayerId, deletedLineIndexesByPage, pageNum]);

  const pageLayers = layersByPage.get(pageNum) || [];
  const hasLayers = pageLayers.length > 0;
  const lastBuiltEngineRef = useRef<string | null>(null);
  const lastBuiltOcrRef = useRef<any>(null);
  const lastBuiltPreviewModeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentPageOCR || !currentPageOCR.lines || currentPageOCR.lines.length === 0) return;

    const layers = useLayerStore.getState().layersByPage.get(pageNum) || [];
    const newEngine = String(currentPageOCR.ocrEngine || 'paddleocr').toLowerCase();
    const lastEngine = lastBuiltEngineRef.current;
    const engineChanged = lastEngine !== null && lastEngine !== newEngine;
    const ocrDataChanged = lastBuiltOcrRef.current !== null && lastBuiltOcrRef.current !== currentPageOCR;
    const lastPreviewMode = lastBuiltPreviewModeRef.current;
    const previewModeChanged = lastPreviewMode !== null && lastPreviewMode !== translationPreviewMode;

    if (layers.length === 0 || engineChanged || ocrDataChanged || previewModeChanged) {
      const result = buildLayerGroupsFromOCR(
        currentPageOCR,
        translationPreviewMode === 'translated' ? translationOverlayContext.translatedByIndex : undefined
      );

      if (layers.length === 0 || !lastEngine) {
        useLayerStore.getState().setPageLayers(pageNum, result);
      } else {
        const existingLayers = useLayerStore.getState().layersByPage.get(pageNum) || [];
        const existingGroups = useLayerStore.getState().groupsByPage.get(pageNum) || [];
        const mergedResult = mergeLayersAndGroups(result, existingLayers, existingGroups);
        useLayerStore.getState().setPageLayers(pageNum, mergedResult);
      }

      lastBuiltEngineRef.current = newEngine;
      lastBuiltOcrRef.current = currentPageOCR;
      lastBuiltPreviewModeRef.current = translationPreviewMode;
    }
  }, [currentPageOCR, pageNum, hasLayers, translationOverlayContext.translatedByIndex, translationPreviewMode]);

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
    if (!currentPageOCR || !originalOCRSearchPattern) return [] as number[];
    return currentPageOCR.lines.reduce<number[]>((indexes, line, index) => {
      const lineText = normalizeOverlayInlineText(String(line.text || ''));
      if (lineText && hasTextSearchMatch(lineText, originalOCRSearchPattern)) {
        indexes.push(index);
      }
      return indexes;
    }, []);
  }, [currentPageOCR, originalOCRSearchPattern]);

  const debugPageOCR = showDebugOverlay ? currentPageOCR : undefined;
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
    if (!translationOverlayContext.shouldRender || !currentPageOCR) {
      return new Map<number, OverlayLayout>();
    }

    return computeOverlayLayoutMap(
      currentPageOCR.lines.flatMap((line, index) => {
        const translatedText = translationOverlayContext.translatedByIndex.get(index);
        if (!translatedText) return [];
        if (shouldSkipOverlayRenderForSuspiciousLine(line) && !isSourceFallbackOverlayText(line.text, translatedText)) return [];

        const layer = currentPageLayers.find(l => l.lineIndex === index);
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
          x1: ocrOverlayTransform.offsetX + currentPageOCR.width * ocrOverlayTransform.scaleX,
          y1: ocrOverlayTransform.offsetY + currentPageOCR.height * ocrOverlayTransform.scaleY,
        });
        const typographyWidth = overlayLayoutProfile === 'official' ? baseWidth : rect.width;
        const typographyHeight = overlayLayoutProfile === 'official' ? baseHeight : rect.height;

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
          },
        }];
      }),
      { profile: overlayLayoutProfile }
    );
  }, [
    currentPageOCR,
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

  // Clear sampled palette when page, OCR data, or translation active key changes
  useEffect(() => {
    setTranslatedLinePalette(new Map());
  }, [pageNum, currentPageOCR, translationOverlayContext.entry?.key]);

  useEffect(() => {
    if (translatedLinePalette.size > 0) return;
    if (!translationOverlayContext.shouldRender || !currentPageOCR || !pageRef.current || !isVisible) {
      return;
    }

    const canvas = pageRef.current.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      return;
    }

    const timer = setTimeout(() => {
      const sourceWidth = Math.max(1, canvas.width);
      const sourceHeight = Math.max(1, canvas.height);
      if (!sourceWidth || !sourceHeight) {
        return;
      }

      const maxSampleSide = 2400;
      const sampleScale = Math.min(1, maxSampleSide / Math.max(sourceWidth, sourceHeight));
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = Math.max(1, Math.round(sourceWidth * sampleScale));
      sampleCanvas.height = Math.max(1, Math.round(sourceHeight * sampleScale));

      const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        return;
      }

      context.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);

      const next = new Map<number, OverlayPalette>();
      currentPageOCR.lines.forEach((line, index) => {
        if (!translationOverlayContext.translatedByIndex.has(index)) return;
        const translatedText = translationOverlayContext.translatedByIndex.get(index) || '';
        if (shouldSkipOverlayRenderForSuspiciousLine(line) && !isSourceFallbackOverlayText(line.text, translatedText)) return;
        next.set(index, sampleOverlayPaletteFromLine(
          context,
          line,
          currentPageOCR.width,
          currentPageOCR.height,
          sampleCanvas.width,
          sampleCanvas.height
        ));
      });
      setTranslatedLinePalette(next);

      // Optimize Memory: Explicitly release memory by resizing to 0x0
      try {
        sampleCanvas.width = 0;
        sampleCanvas.height = 0;
      } catch (e) { /* ignore */ }
    }, 150);

    return () => clearTimeout(timer);
  }, [
    pageNum,
    currentPageOCR,
    pageRenderTick,
    translationOverlayContext.entry?.key,
    translationOverlayContext.shouldRender,
    translationOverlayContext.translatedByIndex,
    isVisible,
    translatedLinePalette.size,
  ]);

  useEffect(() => {
    if (!currentPageOCR || !pageRef.current || !isVisible) return;

    let observedCanvas: HTMLCanvasElement | null = null;
    let rafId: number | null = null;

    const updateTransform = () => {
      const container = pageRef.current;
      const canvas = container?.querySelector('canvas') as HTMLCanvasElement | null;
      if (!container || !canvas) return;

      if (!currentPageOCR.width || !currentPageOCR.height) return;
      if (canvas.clientWidth === 0 || canvas.clientHeight === 0) return;

      if (canvas !== observedCanvas) {
        if (observedCanvas) {
          resizeObserver.unobserve(observedCanvas);
        }
        observedCanvas = canvas;
        resizeObserver.observe(canvas);
      }

      const canvasRect = canvas.getBoundingClientRect();
      const rootRect = container.getBoundingClientRect();
      const currentZoom = useUIStore.getState().zoom || 1;
      const offsetX = (canvasRect.left - rootRect.left) / currentZoom;
      const offsetY = (canvasRect.top - rootRect.top) / currentZoom;

      setOcrOverlayTransform({
        scaleX: canvas.clientWidth / currentPageOCR.width,
        scaleY: canvas.clientHeight / currentPageOCR.height,
        offsetX,
        offsetY
      });
    };

    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateTransform();
      });
    };

    scheduleUpdate(); // Initial call

    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(pageRef.current);
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
    };
  }, [currentPageOCR, pageNum, pageRenderTick, isVisible]);

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
      {isVisible && (
        <>
          {/* Regions Overlay */}
          {showDebugOverlay && currentPage === pageNum && regions.map(reg => (
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
              >
              </div>
            ))}
          {/* OCR Debug Overlay */}
          {translationOverlayContext.shouldRender && currentPageOCR && (
            <div className="absolute inset-0 pointer-events-none">
              {currentPageOCR.lines.map((line, idx) => {
                if (hiddenLineIndexes.has(idx)) {
                  return null;
                }
                const layer = currentPageLayers.find(l => l.lineIndex === idx);
                const translatedText = (() => {
                  if (!layer) {
                    return translationOverlayContext.translatedByIndex.get(idx);
                  }
                  if (translationPreviewMode === 'original') {
                    return layer.sourceText || layer.text;
                  }
                  const hasTranslation = layer.userEdited || layer.text !== layer.sourceText;
                  if (hasTranslation) return layer.text;
                  return translationOverlayContext.translatedByIndex.get(idx) || layer.text;
                })();
                if (!translatedText) return null;
                if (!layer && shouldSkipOverlayRenderForSuspiciousLine(line) && !isSourceFallbackOverlayText(line.text, translatedText)) {
                  return null;
                }

                const layout = overlayLayoutByIndex.get(idx);
                const isMaskOnlyLine = (layer && layer.userEdited) ? false : Boolean(layout?.hidden);
                if (isMaskOnlyLine && !layout?.preserveMaskWhenHidden) {
                  return null;
                }
                const renderText = (layer && layer.userEdited)
                  ? (translationPreviewMode === 'original' ? (layer.sourceText || layer.text) : layer.text)
                  : (layout?.renderText !== undefined ? layout.renderText : translatedText);
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
                const hasThaiText = /[\u0E00-\u0E7F]/.test(renderText);
                const expansion = resolveOverlayMaskExpansion(line);
                const mergedMaskBoost = isComicLikeOverlay && layout?.mergedBBox ? 4 : 0;
                const comicMaskBoostX = isComicLikeOverlay ? 3 : 0;
                const comicMaskBoostTop = isComicLikeOverlay ? 3 : 0;
                const comicMaskBoostBottom = isComicLikeOverlay ? 2 : 0;
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
                const rawMaskLeft = ocrOverlayTransform.offsetX + maskRenderSourceLeft * ocrOverlayTransform.scaleX - maskExpandLeft;
                const rawMaskTop = ocrOverlayTransform.offsetY + maskBbox.y0 * ocrOverlayTransform.scaleY - maskExpandTop;
                const rawMaskWidth = maskBaseWidth + maskExpandLeft + maskExpandRight;
                const rawMaskHeight = maskBaseHeight + maskExpandTop + maskExpandBottom;
                const maskRect = clampOverlayRect(rawMaskLeft, rawMaskTop, rawMaskWidth, rawMaskHeight, {
                  x0: ocrOverlayTransform.offsetX,
                  y0: ocrOverlayTransform.offsetY,
                  x1: ocrOverlayTransform.offsetX + currentPageOCR.width * ocrOverlayTransform.scaleX,
                  y1: ocrOverlayTransform.offsetY + currentPageOCR.height * ocrOverlayTransform.scaleY,
                });
                const useMergedComicTextRect = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && !isMaskOnlyLine && Boolean(layout?.mergedMaskBBox);
                const textSourceLeft = useMergedComicTextRect ? maskRenderSourceLeft : renderSourceLeft;
                const textSourceTop = useMergedComicTextRect ? maskBbox.y0 : sourceBbox.y0;
                const textBaseWidth = useMergedComicTextRect ? Math.max(baseWidth, maskBaseWidth) : baseWidth;
                const textBaseHeight = useMergedComicTextRect ? Math.max(baseHeight, maskBaseHeight) : baseHeight;
                const mergedComicTextTopLift = useMergedComicTextRect ? Math.max(0, Math.round(maskBaseHeight * (styleKind === 'comic-bubble' ? 0.08 : 0.05))) : 0;
                const mergedComicTextExtraHeight = useMergedComicTextRect ? Math.max(0, Math.round(maskBaseHeight * (styleKind === 'comic-bubble' ? 0.34 : 0.18))) : 0;
                const rawTextLeft = ocrOverlayTransform.offsetX + textSourceLeft * ocrOverlayTransform.scaleX - (layout?.alignment === 'center' ? 0 : maskExpandLeft);
                const rawTextTop = ocrOverlayTransform.offsetY + textSourceTop * ocrOverlayTransform.scaleY - maskExpandTop - mergedComicTextTopLift;
                const rawTextWidth = textBaseWidth + (layout?.alignment === 'center' ? 0 : maskExpandLeft + maskExpandRight);
                const rawTextHeight = textBaseHeight + maskExpandTop + maskExpandBottom + mergedComicTextTopLift + mergedComicTextExtraHeight;
                let textRect = clampOverlayRect(rawTextLeft, rawTextTop, rawTextWidth, rawTextHeight, {
                  x0: ocrOverlayTransform.offsetX,
                  y0: ocrOverlayTransform.offsetY,
                  x1: ocrOverlayTransform.offsetX + currentPageOCR.width * ocrOverlayTransform.scaleX,
                  y1: ocrOverlayTransform.offsetY + currentPageOCR.height * ocrOverlayTransform.scaleY,
                });
                if (!isDocumentLikeOverlay) {
                  textRect = clampOverlayRect(textRect.left, textRect.top, textRect.width, textRect.height, {
                    x0: Math.max(ocrOverlayTransform.offsetX, maskRect.left - 1),
                    y0: Math.max(ocrOverlayTransform.offsetY, maskRect.top - 1),
                    x1: Math.min(ocrOverlayTransform.offsetX + currentPageOCR.width * ocrOverlayTransform.scaleX, maskRect.left + maskRect.width + 1),
                    y1: Math.min(ocrOverlayTransform.offsetY + currentPageOCR.height * ocrOverlayTransform.scaleY, maskRect.top + maskRect.height + 1),
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
                const typographyHeight = isDocumentLikeOverlay
                  ? Math.min(
                    textRect.height,
                    Math.max(baseHeight + thaiDocumentHeadroom, (lowCoverageSource ? maskBaseHeight : baseHeight) + thaiDocumentHeadroom)
                  )
                  : textRect.height;
                const baseTypography = layout?.typography || computeOverlayTypography(renderText, typographyWidth, typographyHeight, {
                  sourceText: line.text,
                  sourceBoxWidth: isDocumentLikeOverlay && lowCoverageSource ? Math.max(baseWidth, maskBaseWidth) : baseWidth,
                  sourceBoxHeight: isDocumentLikeOverlay
                    ? (lowCoverageSource ? Math.max(baseHeight, maskBaseHeight) : baseHeight) + thaiDocumentHeadroom
                    : baseHeight,
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
                  ? Math.max(0, Math.min(textRect.width * 0.12, centerOffset))
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
                const minFillRatio = typography.estimatedLines > 1
                  ? (thaiComicLine ? 0.82 : 0.74)
                  : (thaiComicLine ? 0.58 : 0.5);
                const paintHeight = Math.min(
                  textRect.height * 1.25,
                  Math.max(
                    typography.contentHeight + typography.padY * 2 + extraTopPad + extraBottomPad,
                    textRect.height * minFillRatio
                  )
                );
                const paintOffsetTop = Math.max(
                  hasThaiText ? 1 : 0,
                  Math.min(textRect.height - paintHeight, Math.round(textRect.height * (thaiComicLine ? 0.04 : 0.08)))
                );

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
                            alignItems: 'flex-start',
                            textAlign: layout?.alignment === 'center' ? 'center' : 'left',
                            whiteSpace: typography.forceSingleLine ? 'nowrap' : 'normal',
                            wordBreak: 'normal',
                            lineBreak: hasThaiText ? 'auto' : 'normal',
                            WebkitTextStrokeWidth: overlayStrokeWidth > 0 ? `${overlayStrokeWidth.toFixed(2)}px` : undefined,
                            WebkitTextStrokeColor: overlayStrokeWidth > 0 ? palette.textStrokeColor : undefined,
                            textShadow: palette.textShadow,
                            overflowWrap: typography.forceSingleLine
                              ? 'normal'
                              : (hasThaiText ? 'normal' : 'break-word'),
                            overflow: 'visible',
                          }}
                        >
                              {overlayContent}
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          )}
          {translationPreviewMode === 'original' && currentPageOCR && originalOCRMatchedLineIndexes.length > 0 && (
            <div className="absolute inset-0 pointer-events-none">
              {originalOCRMatchedLineIndexes.map((lineIndex) => {
                const line = currentPageOCR.lines[lineIndex];
                if (!line) return null;

                const sourceBBox = resolveOverlaySourceBBox(line);
                const rawLeft = ocrOverlayTransform.offsetX + sourceBBox.x0 * ocrOverlayTransform.scaleX - 2;
                const rawTop = ocrOverlayTransform.offsetY + sourceBBox.y0 * ocrOverlayTransform.scaleY - 2;
                const rawWidth = Math.max(1, (sourceBBox.x1 - sourceBBox.x0) * ocrOverlayTransform.scaleX + 4);
                const rawHeight = Math.max(1, (sourceBBox.y1 - sourceBBox.y0) * ocrOverlayTransform.scaleY + 4);
                const rect = clampOverlayRect(rawLeft, rawTop, rawWidth, rawHeight, {
                  x0: ocrOverlayTransform.offsetX,
                  y0: ocrOverlayTransform.offsetY,
                  x1: ocrOverlayTransform.offsetX + currentPageOCR.width * ocrOverlayTransform.scaleX,
                  y1: ocrOverlayTransform.offsetY + currentPageOCR.height * ocrOverlayTransform.scaleY,
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
      )}
    </div>
  );
};

export const PDFCanvas: React.FC = React.memo(() => {
  const {
    fileUrl,
    fileData,
    currentPage,
    totalPages,
    setTotalPages,
    viewMode,
  } = useProjectStore();

  const { zoom, pan, setZoom, setPan, setView, activeTool } = useUIStore();
  const { regions, setRegions, setIsProcessing, processRequest } = useSegmentationStore();
  const sourceLanguage = useProjectStore((s) => s.sourceLanguage);


  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const contentRef = useRef<HTMLDivElement>(null);
  const panRef = useRef(pan);
  
  const wheelTransformRafRef = useRef<number | null>(null);
  const wheelIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stateRef = useRef({ zoom, pan });
  useEffect(() => {
    stateRef.current = { zoom, pan };
    if (!isDragging) {
      panRef.current = pan;
    }
  }, [zoom, pan, isDragging]);

  const prevPageRef = useRef(currentPage);
  const prevViewModeRef = useRef(viewMode);

  // Track programmatic scrolling to lock active page updates during animations
  const isProgrammaticScrollRef = useRef(false);

  // Sync scroll position when switching to continuous viewMode or clicking LeftSidebar thumbnails
  useEffect(() => {
    const pageChanged = currentPage !== prevPageRef.current;
    const viewModeChanged = viewMode !== prevViewModeRef.current;

    if (viewMode === 'continuous' && (pageChanged || viewModeChanged)) {
      // Set programmatic scroll lock to prevent IntersectionObservers on off-target pages
      // from firing setPage and overriding the target page before the scroll snap finishes.
      isProgrammaticScrollRef.current = true;

      const timer = setTimeout(() => {
        const pageElement = document.querySelector(
          `.pdf-canvas-document [data-page-container="${currentPage}"]`
        ) as HTMLElement | null;

        if (pageElement && containerRef.current) {
          const offsetTop = pageElement.offsetTop;
          const targetY = -(offsetTop * zoom) + 20;

          // Read the latest pan.y from the stateRef to check if the change was substantial
          const currentPanY = stateRef.current.pan.y;
          const diff = Math.abs(currentPanY - targetY);

          // Only snap if the offset diff is substantial (e.g. LeftSidebar click or viewMode toggle)
          // to avoid fighting manual user scrolls.
          if (diff > 150 || viewModeChanged) {
            const { clientWidth } = containerRef.current;
            const pageWidth = pageElement.clientWidth || 800;
            const scaledWidth = pageWidth * zoom;
            const targetX = (clientWidth - scaledWidth) / 2;

            setPan(targetX, targetY);
          }
        }

        // Release the programmatic scroll lock after the transition animation (0.1s transform duration + buffer)
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 150);

      }, 100);

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
        // Keep the current vertical pan in continuous mode to prevent resetting to page 1
        setPan(x, stateRef.current.pan.y);
      }
    }
  }, [setZoom, setPan]);

  const syncContentTransform = useCallback((nextPan: { x: number; y: number }, nextZoom: number) => {
    if (!contentRef.current) return;
    contentRef.current.style.transform = `translate(${nextPan.x}px, ${nextPan.y}px) scale(${nextZoom})`;
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
        // Keep stateRef in sync so rapid zoom events accumulate correctly
        stateRef.current = { ...stateRef.current, zoom: newZoom };

        if (wheelTransformRafRef.current !== null) {
          cancelAnimationFrame(wheelTransformRafRef.current);
        }
        wheelTransformRafRef.current = requestAnimationFrame(() => {
          syncContentTransform(stateRef.current.pan, newZoom);
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
      }, 120);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [setView, syncContentTransform]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === 'hand' || e.button === 1 || e.ctrlKey) { 
      setIsDragging(true);
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

      if (contentRef.current) {
        contentRef.current.style.transform = `translate(${newX}px, ${newY}px) scale(${stateRef.current.zoom})`;
      }
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      setPan(panRef.current.x, panRef.current.y);
    }
  };

  useEffect(() => {
    return () => {
      if (wheelTransformRafRef.current !== null) {
        cancelAnimationFrame(wheelTransformRafRef.current);
        wheelTransformRafRef.current = null;
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
        className="absolute top-0 left-0 origin-top-left"
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
              />
            ) : (
              Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                <PDFPageContainer
                  key={`page_${pageNum}`}
                  pageNum={pageNum}
                  onPageLoadSuccess={pageNum === 1 ? onPageLoadSuccess : undefined}
                  isProgrammaticScrollRef={isProgrammaticScrollRef}
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
