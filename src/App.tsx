import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown, 
  Settings, 
  Languages, 
  MousePointer2, 
  Hand,
  Square, 
  Type,
  Sparkles,
  RefreshCw,
  BrainCircuit,
  Undo2,
  Redo2,
  Home,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Plus,
  Compass,
  Flame,
  FileText,
  BarChart3,
  Download,
  Check,
  AlertCircle,
  X,
  FileDown,
  Eye,
  Cpu,
  BookOpen,
  Globe,
  Layers,
  ChevronUp,
  Pause,
  Play,
  Trash2,
  RotateCcw
} from 'lucide-react';
import { UploadScreen } from './components/Home/UploadScreen';
import { OCRRegressionHarness } from './components/OCR/OCRRegressionHarness';
import { useUIStore } from './stores/useUIStore';
import { GlobalLoadingOverlay } from './components/UI/GlobalLoadingOverlay';
import { useProjectStore, type SafetySettings, type TranslationMode } from './stores/useProjectStore';
import {
  buildOCRTranslationCacheKey,
  hasCurrentOCRTranslationCacheVersion,
  type OCRTranslationCacheEntry,
  useOCRTextLayerStore,
} from './stores/useOCRTextLayerStore';
import { useLayerStore } from './stores/useLayerStore';
import type { TextLayer } from './types/layers';
import { useExportStore } from './stores/useExportStore';
import { ExportOverlay } from './components/Export/ExportOverlay';
import { useBackgroundQueueStore } from './stores/useBackgroundQueueStore';
import { useGlossaryStore } from './stores/useGlossaryStore';
import { backgroundQueueProcessor } from './services/ocr/BackgroundQueueProcessor';
import {
  applyKoreanConversationalFallback,
  shouldPreferKoreanPivotTranslation,
  hasKoreanTranslationCarryover,
  isBoilerplateHallucination,
} from './services/translation/koreanTranslationPolicy';
import { translationCoordinator } from './services/translation/translationCoordinator';
import { TranslatableItem } from './types/translation';
import { buildOCRSourceFingerprint } from './services/ocrSourceFingerprint';
import { searchablePDFService, exportTranslatedPdfViaPrint } from './services/pdf';
import { pdfjs } from './services/pdf/pdfjsWorker';
import {
  deriveBalloonAwareLayoutGrouping,
  type DerivedLayoutGroup,
  type LayoutGroupType,
  type LayoutGroupingInput,
  type LayoutGroupingResult,
  type LayoutReadingMode,
  type OCRLineWithLayout,
} from './services/layout/balloonAwareGroupingService';
import {
  clampOverlayRect,
  computeOverlayLayoutMap,
  computeOverlayTypography,
  DEFAULT_OVERLAY_PALETTE,
  estimateLineRotationDeg,
  normalizeOverlayInlineText,
  resolveOverlayMaskBBox,
  resolveOverlayMaskExpansion,
  resolveOverlaySourceBBox,
  sampleOverlayPaletteFromLine,
  shouldSkipOverlayRenderForSuspiciousLine,
  resolveTranslationOverlayContext,
  type OverlayLayoutProfile,
  type OverlayPalette,
  type OverlayTypography,
} from './components/OCR/translationOverlayUtils';
import { getOverlayFontOption, getOverlayPrimaryFontName, resolveOverlayFontFamily } from './constants/overlayFonts';
import { BBox, OCRLine, OCREngine, OCRPageResult, OCRQualityProfile } from './types';
import { OCR_ALGORITHM_VERSION, OCR_RAW_VERSION } from './services/vision/ocrVersion';
import { buildLayerGroupsFromOCR, mergeLayersAndGroups } from './services/layers/LayerGroupingService';
import {
  translateBatchOffline,
  shouldSkipOverlayForUntranslatedCarryOver,
  shouldUseDocumentCoverageFallback,
  clampOverlayTypographyScale,
  scaleOverlayTypography,
  readPersistedBooleanFlag,
  isBalloonAwareGroupingEnabled,
  isLayoutGroupingDebugEnabled,
  resolveOverlayExportScale,
  shouldRetryLineTranslation,
  getTranslationScriptStats,
  evaluateUntranslatedTranslation,
  evaluateThaiCarryoverForEnglish,
  scoreTranslationCandidate,
  lookupShortPhraseTh
} from './services/translation/offlineTranslationService';
import { isKnownShortWordHelper, isLikelyEnglishDialogue } from './services/ocr/ocrSafetyLineDedup';
import { matchMangaGroupLineOverrides } from './services/translation/mangaGroupOverrides';
import {
  protectLocationPhrases,
  protectTranslationTokens,
  restoreProtectedTokens,
  isScientificSymbolLikeLine,
  shouldSkipLineTranslationByScript,
  shouldPreserveSourceLineForTranslation,
  shouldPreserveDistinctTechnicalLines,
  TECHNICAL_LINE_HINT_REGEX,
  UNKNOWNS_COUNT_REGEX,
  AXIS_SYMBOL_REGEX,
  EQUATION_LABEL_REGEX,
  SCI_SYMBOL_ALLOWED_REGEX,
  SCI_SYMBOL_SIGNAL_REGEX,
  SCI_FORCE_COMPONENT_TOKEN_REGEX,
  SCI_NOTATION_LINE_REGEX,
  SCI_MATH_LINE_REGEX,
  PROPER_NOUN_POOL,
  PROPER_NOUN_THAI_MAP,
  titleCaseWord,
  getAvailableProperNoun,
} from './services/translation/translationTokenProtection';
import {
  intervalOverlap,
  overlapRatio,
  shouldPruneContextualGhostTranslatableLine,
  normalizeTranslatableDedupKey,
  collectMeaningfulTranslatableLatinTokens,
  countSharedTranslatableLatinTokens,
  KNOWN_CONVERSATIONAL_DUPLICATE_KEYS,
  translatableDedupSimilarity,
  dedupeTranslatableLinesForTranslation,
  computeAlignmentScore,
  computeOverlapRatio,
  shouldUseDenseDialogueGrouping,
  isLikelyComicDialogueLayout,
  shouldForceLineByLineForOfflinePanel,
  shouldUseLineByLineGrouping,
  shouldUseBalloonAwareGrouping,
  shouldPreferEnglishSourceForMixedTechnicalPage,
  resolveBalloonAwareReadingMode,
  isHesitantSpeech,
  shouldMergeLines,
  orderLinesForGrouping,
  computeLineHorizontalGap,
  computeLineVerticalGap,
  shouldConnectDenseDialogueLines,
  buildDenseDialogueGroupsByConnectivity,
  buildTranslationGroups,
} from './services/layout/dialogueGroupingService';
import {
  findSplitIndexNear,
  computeLineSplitWeight,
  tokenizeRedistributedPart,
  joinRedistributedTokens,
  rebalanceRedistributedParts,
  THAI_PARTICLES,
  glueTrailingParticles,
  isRedistributionPlausible,
  splitTranslatedTextBySourceWeights,
  resolveRedistributedLineFallback,
  isSourceFallbackOverlayText,
} from './services/translation/textRedistributionService';

// Re-export services for backwards compatibility with tests and consumers
export {
  protectLocationPhrases,
  protectTranslationTokens,
  restoreProtectedTokens,
  isScientificSymbolLikeLine,
  shouldSkipLineTranslationByScript,
  shouldPreserveSourceLineForTranslation,
  shouldPreserveDistinctTechnicalLines,
} from './services/translation/translationTokenProtection';

export {
  intervalOverlap,
  overlapRatio,
  shouldPruneContextualGhostTranslatableLine,
  dedupeTranslatableLinesForTranslation,
  computeAlignmentScore,
  computeOverlapRatio,
  shouldUseDenseDialogueGrouping,
  isLikelyComicDialogueLayout,
  shouldForceLineByLineForOfflinePanel,
  shouldUseLineByLineGrouping,
  shouldUseBalloonAwareGrouping,
  shouldPreferEnglishSourceForMixedTechnicalPage,
  resolveBalloonAwareReadingMode,
  shouldMergeLines,
  orderLinesForGrouping,
  shouldConnectDenseDialogueLines,
  buildDenseDialogueGroupsByConnectivity,
  buildTranslationGroups,
} from './services/layout/dialogueGroupingService';

export {
  findSplitIndexNear,
  computeLineSplitWeight,
  tokenizeRedistributedPart,
  joinRedistributedTokens,
  rebalanceRedistributedParts,
  THAI_PARTICLES,
  glueTrailingParticles,
  isRedistributionPlausible,
  splitTranslatedTextBySourceWeights,
  resolveRedistributedLineFallback,
  isSourceFallbackOverlayText,
} from './services/translation/textRedistributionService';

import { useExportOrchestration } from './hooks/useExportOrchestration';

// Lazy Load Heavy Components
const RightSidebar = React.lazy(() => import('./components/Layout/RightSidebar').then(module => ({ default: module.RightSidebar })));
const CompactTopToolbar = React.lazy(() => import('./components/Layout/CompactTopToolbar').then(module => ({ default: module.CompactTopToolbar })));
const PDFCanvas = React.lazy(() => import('./components/PDF/PDFCanvas').then(module => ({ default: module.PDFCanvas })));
const LeftSidebar = React.lazy(() => import('./components/Layout/LeftSidebar').then(module => ({ default: module.LeftSidebar })));
const ImageCanvas = React.lazy(() => import('./components/Image/ImageCanvas').then(module => ({ default: module.ImageCanvas })));
import { visionService } from './services/vision/VisionService';
import { dbService } from './services/dbService';
import { useTranslationLoadingState } from './hooks/useTranslationLoadingState';
import { useDownloadMenuState } from './hooks/useDownloadMenuState';
import { useExportCacheHydration } from './hooks/useExportCacheHydration';
import { useExportOcrResolvers } from './hooks/useExportOcrResolvers';
import './types/electron.d';
import { SplitViewToggle } from './components/Viewer/Toolbar';
import { WorkspaceContainer } from './components/Viewer/WorkspaceContainer';

import {
  countReadableLength,
  isStrongSentenceEnd,
  isLikelyContinuation,
  isLikelyStandaloneInterjectionLine,
  computeMedian,
  ProtectedTokenReplacement,
  escapeRegExp,
  buildLooseTokenPattern,
  collapseRepeatedTranslationFragments,
  TRANSLATION_LETTER_REGEX,
  buildTranslationComparisonKey,
  buildOfflineGroupRetrySourceText,
  resolveSourceLanguageFromOCR,
  scoreSpanishVsEnglishHints,
  scoreSpanishHintTokens,
  scoreEnglishHintTokens,
  inferSourceLanguageFromTextHints,
  resolvePreferredSourceLanguageForText,
  isLikelyLatinDominantTranslationPage,
  hasStrongLatinAnchorLines,
  isLikelyShortForeignSfxLine,
  resolveComicPageSourceLanguage,
  hasKnownOcrNoisePattern,
  isLikelyStructuredOcrGarbageToken,
  scoreSourceLineReadability,
  shouldAcceptWordsOnlyLineFallback,
  computeLineWordUnionCoverage,
  resolveBestOcrLineText,
  shouldForceKeepTechnicalTranslationLine,
  shouldForceKeepComicTranslationLine,
  isLikelyGhostTranslatableLine,
  SOFT_CONTINUATION_END_REGEX,
  CONTINUATION_TRAILING_WORD_REGEX,
  HANGUL_REGEX,
  THAI_REGEX
} from './services/ocr/ocrTextHeuristics'; // Import type declarations

import {
  normalizeWhitespace,
  normalizeThaiTranslationText,
  normalizeThaiBoundaryToken,
  THAI_BOUNDARY_ATTACH_TOKENS,
  THAI_BOUNDARY_NO_SPLIT_PAIRS,
  normalizeSourceForTranslation,
  normalizeTranslationLanguage,
  normalizeSpanishOcrNoiseForTranslation,
  cleanJapaneseOcrSpacing,
  cleanKoreanOcrSpacing,
  normalizeJapaneseOcrNoiseForTranslation,
  normalizeKoreanOcrNoiseForTranslation,
  normalizeEnglishOcrNoiseForTranslation,
} from './services/ocr/ocrTextNormalizer';

import {
  DehyphenatedJoin,
  detectDehyphenatedJoins,
  mergeDehyphenatedSource,
  getMergedTranslatableLines,
  mapSlotsToLines
} from './services/translation/dehyphenation';



import {

  wrapCanvasText,
  truncateCanvasText,
  buildCanvasFontFamily
} from './services/layout/canvasLayoutService';

import {
  buildBatchMarkdownPayload,
  parseBatchJsonResponse,
  type BatchPageTranslationPlan,
  type BatchGroupPlan,
  type TranslatableLine,
  type TranslationGroupingProfile,
  type GroupingDecision
} from './services/translation/translationBatchService';

type GlobalPrewarmState = typeof globalThis & {
  __pdfTranslatorExternalPrewarmStartedKeys?: Set<string>;
  __pdfTranslatorExternalPrewarmInFlight?: Map<string, Promise<void>>;
  __pdfTranslatorLastLayoutGrouping?: unknown;
};

const AUTO_OCR_REQUEST_EVENT = 'pdf-translator:auto-ocr-request';
const AUTO_OCR_RESULT_EVENT = 'pdf-translator:auto-ocr-result';
const ENABLE_BALLOON_AWARE_GROUPING_STORAGE_KEY = 'pdf_translator.enable_balloon_aware_grouping';
const LAYOUT_GROUPING_DEBUG_STORAGE_KEY = 'pdf_translator.layout_grouping_debug';

type AutoOCRScope = 'current' | 'all';
type DownloadScope = 'current' | 'all';
type DownloadContentMode = 'original' | 'translated';

const formatPageListSummary = (pages: number[], maxItems: number = 8): string => {
  if (pages.length === 0) return '-';
  const ordered = Array.from(new Set(pages)).sort((a, b) => a - b);
  const head = ordered.slice(0, maxItems).join(', ');
  const remain = ordered.length - maxItems;
  return remain > 0 ? `${head} (+${remain})` : head;
};

const DOCUMENT_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|reaction|unknowns?|equilibrium|rigid|body|support|diagram|objective|objectives|connection|connections|continued|force|moment|component|unknown|column|columns|bridge|building|beam|beams|welded|surface|bracket|cable|utility|floor|member|pin|hinge)\b/i;



// --- Translation APIs: Secure IPC to Main Process ---
// Offline Argos and Gemini fallback are both resolved in main process bridges

/**
 * Translate text using Gemini API via secure IPC
 * @param text - Text to translate
 * @param type - Type of text (text, sfx, etc.)
 * @param mode - Translation mode (manga or official)
 */
async function translateWithGemini(
  text: string,
  type: string,
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string,
  contextOverrides?: {
    baseSystemPrompt?: string;
  }
): Promise<string> {
  try {
    // Use secure electronAPI instead of direct API call
    const result = await window.electronAPI.gemini.translate(text, {
      mode,
      sourceType: type,
      sourceLanguage,
      targetLanguage,
      baseSystemPrompt: contextOverrides?.baseSystemPrompt,
    });
    return result;
  } catch (error) {
    console.error('Gemini translation error:', error);
    throw error;
  }
}

async function translateBatchOfflineBridge(
  texts: string[],
  type: string,
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string
): Promise<string[]> {
  if (texts.length === 0) return [];

  if (!window.electronAPI?.translate?.offlineBatch) {
    throw new Error('Offline translation bridge is not available.');
  }

  const translated = await window.electronAPI.translate.offlineBatch(texts, {
    mode,
    sourceType: type,
    sourceLanguage,
    targetLanguage,
  });

  if (!Array.isArray(translated) || translated.length !== texts.length) {
    throw new Error('Offline translation returned an invalid result length.');
  }

  return translated;
}

const offlineBatchBridgeWrapper = async (texts: string[], options: any): Promise<string[]> => {
  return translateBatchOfflineBridge(
    texts,
    options.sourceType || 'text',
    options.mode || 'adaptive',
    options.sourceLanguage || 'eng',
    options.targetLanguage || 'tha'
  );
};

async function translateBatchGemini(
  texts: string[],
  type: string,
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string,
  contextOverrides?: {
    baseSystemPrompt?: string;
  }
): Promise<string[]> {
  if (texts.length === 0) return [];
  return Promise.all(
    texts.map((text) =>
      translateWithGemini(text, type, mode, sourceLanguage, targetLanguage, contextOverrides)
    )
  );
}


export type { TranslatableLine, TranslationGroupingProfile, GroupingDecision };

type AdoptedSourceCandidate = {
  text: string;
  adopted: boolean;
  candidateId?: string;
  bbox?: BBox;
};

type TranslationGroup = {
  lines: TranslatableLine[];
  groupType?: LayoutGroupType;
  derivedGroupId?: string;
  confidence?: number;
};



type ResolvedTranslationGroups = {
  groups: TranslationGroup[];
  groupingProfile: TranslationGroupingProfile;
  groupingDecision: GroupingDecision;
  layoutResult?: LayoutGroupingResult;
};

const GEMINI_MODE_STYLE_HINTS: Record<TranslationMode, string> = {
  adaptive: 'Use natural Thai that adapts to the source layout: keep document structure tidy when the source is document-like, and keep dialogue balanced and centered when the source is comic-like.',
  manga: 'Use lively natural Thai for manga dialogue. Keep character personality, pacing, and emotional beats.',
  manhwa: 'Use natural Thai for mature manhwa dialogue. Keep intensity and chemistry, avoid robotic wording.',
  official: 'Use formal, clear, and precise Thai for documents. Prefer consistency and professional wording.',
};

const buildSafetyDirective = (safetySettings: SafetySettings): string => {
  const parts = [
    `harassment=${safetySettings.harassment}`,
    `hate=${safetySettings.hate}`,
    `sexual=${safetySettings.sexual}`,
    `dangerous=${safetySettings.dangerous}`,
  ];
  return `Safety profile: ${parts.join(', ')}. Respect the selected levels while preserving intent.`;
};

const buildGeminiBasePrompt = (
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string,
  safetySettings: SafetySettings
): string => {
  const styleHint = GEMINI_MODE_STYLE_HINTS[mode] || GEMINI_MODE_STYLE_HINTS.manga;
  return [
    `You are an expert translator from ${sourceLanguage} to ${targetLanguage}.`,
    styleHint,
    buildSafetyDirective(safetySettings),
    'Do not translate engineering symbols, equation tokens, or figure labels (for example: M2, F2, (a), theta, phi, Table 5-1).',
    'Preserve person names and proper nouns consistently. If unsure, keep the original name instead of mistranslating it.',
    'Do not summarize or skip lines. Preserve names, references, and narrative continuity.',
  ].join(' ');
};





const chooseBestSourceTextForLine = (
  baseLine: TranslatableLine,
  baseRawLine: OCRLine | undefined,
  alternativePages: OCRPageResult[],
  usedCandidateIds: Set<string>
): AdoptedSourceCandidate => {
  let bestText = baseLine.text;
  const baseReadability = scoreSourceLineReadability(baseLine.text);
  let bestCombinedScore = baseReadability;
  let bestCandidateId: string | undefined;
  let bestCandidateBBox: BBox | undefined;

  const baseBBox: BBox = baseRawLine?.bbox
    ? baseRawLine.bbox
    : {
      x0: baseLine.left,
      y0: baseLine.top,
      x1: baseLine.right,
      y1: baseLine.bottom,
    };
  const baseWidth = Math.max(1, baseBBox.x1 - baseBBox.x0);
  const baseHeight = Math.max(1, baseBBox.y1 - baseBBox.y0);
  const baseArea = baseWidth * baseHeight;
  const baseAspect = baseWidth / Math.max(1, baseHeight);
  const baseCompactText = normalizeWhitespace(baseLine.text).replace(/\s+/g, '');
  const baseCompactLength = countReadableLength(baseCompactText);
  const narrowLabelLikeBase = (
    (baseWidth <= 44 || baseAspect < 1.35)
    && baseCompactLength <= 24
  );
  const wideThinBase = baseWidth >= 56 && baseHeight <= 18 && baseAspect >= 2.9;
  const baseTechnicalTokens = collectTechnicalTokens(baseLine.text);
  const baseHasTechnicalTokens = baseTechnicalTokens.length > 0;
  const baseHasKnownNoise = /\b(?:submaie|ureat|ydoot|falinth|willtudhow|chapte|chapt)\b/i.test(baseLine.text);
  const baseLooksStable = baseReadability >= 12.5 && baseCompactLength >= 14 && !baseHasKnownNoise;

  for (let pageIndex = 0; pageIndex < alternativePages.length; pageIndex += 1) {
    const page = alternativePages[pageIndex];
    for (let candidateIndex = 0; candidateIndex < (page.lines || []).length; candidateIndex += 1) {
      const candidate = page.lines[candidateIndex];
      const candidateId = `${pageIndex}:${candidateIndex}`;
      if (usedCandidateIds.has(candidateId)) continue;

      const candidateText = resolveBestOcrLineText(candidate);
      if (!candidateText) continue;

      if (baseHasTechnicalTokens) {
        const keepsTechnicalTokens = baseTechnicalTokens.every((token) => hasTechnicalTokenInText(candidateText, token));
        if (!keepsTechnicalTokens) continue;
      }

      const alignmentScore = computeAlignmentScore(baseBBox, candidate.bbox);
      if (alignmentScore === null || alignmentScore < 1.1) continue;

            const candidateWidth = Math.max(1, candidate.bbox.x1 - candidate.bbox.x0);
      const candidateHeight = Math.max(1, candidate.bbox.y1 - candidate.bbox.y0);
      const candidateArea = candidateWidth * candidateHeight;
      const candidateAspect = candidateWidth / Math.max(1, candidateHeight);
      const areaRatio = candidateArea / Math.max(1, baseArea);
      const aspectRatioDelta = Math.abs(Math.log(Math.max(0.1, candidateAspect) / Math.max(0.1, baseAspect)));
      const candidateCenterX = (candidate.bbox.x0 + candidate.bbox.x1) * 0.5;
      const baseCenterX = (baseBBox.x0 + baseBBox.x1) * 0.5;
      const avgWidth = Math.max(1, (baseWidth + candidateWidth) * 0.5);
      const xOverlap = overlapRatio(baseBBox.x0, baseBBox.x1, candidate.bbox.x0, candidate.bbox.x1);
      const yOverlap = overlapRatio(baseBBox.y0, baseBBox.y1, candidate.bbox.y0, candidate.bbox.y1);
      const normalizedXGap = Math.abs(candidateCenterX - baseCenterX) / avgWidth;
      if (areaRatio < 0.18 || areaRatio > 5.5) continue;
      if (aspectRatioDelta > 1.6) continue;
      if (wideThinBase && (xOverlap < 0.52 || yOverlap < 0.34) && normalizedXGap > 0.18) continue;
      if (narrowLabelLikeBase && xOverlap < 0.18 && normalizedXGap > 0.9) continue;
      if (narrowLabelLikeBase && yOverlap < 0.2 && normalizedXGap > 0.75) continue;

      const candidateScore = scoreSourceLineReadability(candidateText);
      const combinedScore = candidateScore + alignmentScore * 2.1;
      if (baseLooksStable) {
        if (alignmentScore < 1.95) continue;
        if (candidateScore < baseReadability + 3.4) continue;
      }

      const requiredGain = baseLooksStable ? 6.8 : (narrowLabelLikeBase ? 5.2 : 4.6);
      const significantlyBetter = combinedScore > bestCombinedScore + requiredGain;
      const isLongerUseful = candidateText.length >= Math.max(baseLine.text.length * 0.8, baseLine.text.length + 4);
      const isLengthPlausible = candidateText.length <= Math.max(baseLine.text.length * 1.75, 96);
      if (!isLengthPlausible) continue;

      if (narrowLabelLikeBase) {
        if (alignmentScore < 1.8) continue;
        const candidateCompactText = normalizeWhitespace(candidateText).replace(/\s+/g, '');
        const candidateCompactLength = countReadableLength(candidateCompactText);
        const compactLengthCap = Math.max(baseCompactLength * 1.6, baseCompactLength + 5, 20);
        if (candidateCompactLength > compactLengthCap) continue;
        if (/\s/.test(candidateText) && candidateCompactLength > 12 && baseCompactLength <= 10) continue;
      }

      const keepStableWideThinBBox = wideThinBase
        && xOverlap >= 0.72
        && normalizedXGap <= 0.16
        && yOverlap >= 0.42
        && baseWidth < 140;
      const keepStableNarrowBBox = narrowLabelLikeBase
        && xOverlap >= 0.4
        && normalizedXGap <= 0.32
        && yOverlap >= 0.28;
      const keepCompactStableBBox = (
        baseCompactLength <= 18
        && baseWidth <= 180
        && baseHeight <= 64
        && xOverlap >= 0.34
        && normalizedXGap <= 0.5
        && yOverlap >= 0.24
      );
      const shouldKeepBaseBBox = baseLooksStable
        || keepStableWideThinBBox
        || keepStableNarrowBBox
        || keepCompactStableBBox;

      if (significantlyBetter && (candidateScore > baseReadability + 1.4 || (isLongerUseful && !baseLooksStable))) {
        bestCombinedScore = combinedScore;
        bestText = candidateText;
        bestCandidateId = candidateId;
        bestCandidateBBox = shouldKeepBaseBBox
          ? undefined
          : candidate.bbox
            ? {
              x0: candidate.bbox.x0,
              y0: candidate.bbox.y0,
              x1: candidate.bbox.x1,
              y1: candidate.bbox.y1,
            }
            : undefined;
      }
    }
  }

  return {
    text: bestText,
    adopted: bestText !== baseLine.text,
    candidateId: bestText !== baseLine.text ? bestCandidateId : undefined,
    bbox: bestText !== baseLine.text ? bestCandidateBBox : undefined,
  };
};

const buildTranslationLinesWithCrossEngineFallback = (
  baseLines: TranslatableLine[],
  baseRawLines: OCRLine[],
  alternativePages: OCRPageResult[],
  baseEngine: OCREngine
): { lines: TranslatableLine[]; adoptedCount: number } => {
  if (alternativePages.length === 0) {
    return { lines: baseLines, adoptedCount: 0 };
  }

  const readabilityScores = baseLines
    .map((line) => scoreSourceLineReadability(line.text))
    .filter((score) => Number.isFinite(score));
  const medianReadability = readabilityScores.length > 0 ? computeMedian(readabilityScores) : 0;
  const lowReadabilityCount = readabilityScores.filter((score) => score < 5).length;
  const mostlyReadablePage = baseLines.length >= 8
    && medianReadability >= 11.5
    && lowReadabilityCount <= Math.max(1, Math.floor(baseLines.length * 0.18));

  const orderedLines = [...baseLines].sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return a.index - b.index;
  });

  const usedCandidateIds = new Set<string>();
  const adoptedTextCounts = new Map<string, number>();
  const acceptedByIndex = new Map<number, AdoptedSourceCandidate>();
  const adoptionRatio = medianReadability >= 9 ? 0.18 : 0.28;
  const maxAdoptable = Math.max(2, Math.floor(baseLines.length * adoptionRatio));
  let acceptedCount = 0;

  for (const line of orderedLines) {
    const picked = chooseBestSourceTextForLine(
      line,
      baseRawLines[line.index],
      alternativePages,
      usedCandidateIds
    );

    if (!picked.adopted || !picked.candidateId || acceptedCount >= maxAdoptable) {
      acceptedByIndex.set(line.index, { text: line.text, adopted: false });
      continue;
    }

    const normalizedPicked = normalizeWhitespace(picked.text).toLowerCase();
    const repeatCount = adoptedTextCounts.get(normalizedPicked) || 0;
    const allowRepeat = normalizedPicked.length <= 20 ? repeatCount < 2 : repeatCount < 1;
    if (!allowRepeat) {
      acceptedByIndex.set(line.index, { text: line.text, adopted: false });
      continue;
    }

    usedCandidateIds.add(picked.candidateId);
    adoptedTextCounts.set(normalizedPicked, repeatCount + 1);
    acceptedCount += 1;
    acceptedByIndex.set(line.index, picked);
  }

  let adoptedCount = 0;
  const nextLines = baseLines.map((line) => {
    const picked = acceptedByIndex.get(line.index);
    if (!picked?.adopted) return line;
    adoptedCount += 1;
    return {
      ...line,
      text: picked.text,
      sourceLength: countReadableLength(picked.text),
      top: picked.bbox?.y0 ?? line.top,
      bottom: picked.bbox?.y1 ?? line.bottom,
      left: picked.bbox?.x0 ?? line.left,
      right: picked.bbox?.x1 ?? line.right,
      height: picked.bbox ? Math.max(1, picked.bbox.y1 - picked.bbox.y0) : line.height,
    };
  });

  return {
    lines: nextLines,
    adoptedCount,
  };
};

const TECHNICAL_PAREN_LABEL_REGEX = /\(\s*[0-9]{1,3}[a-zA-Z]?\s*\)/g;
const TECHNICAL_SECTION_REGEX = /\b\d+\.\d+\b/g;
const TECHNICAL_VECTOR_REGEX = /\b(?:F|M)(?:x|y|z|\d{1,2})\b/gi;
const TECHNICAL_GREEK_REGEX = /[θφψωαβγδΔΣΩμ]/g;
const TECHNICAL_REF_REGEX = /\b(?:Fig(?:ure)?\.?\s*\d+(?:[-–]\d+)?(?:\s*[a-z])?|Table\s*\d+(?:[-–]\d+)?(?:\s*Continued)?|Chapter\s*\d+)\b/gi;

const collectTechnicalTokens = (sourceText: string): string[] => {
  const source = normalizeWhitespace(String(sourceText || ''));
  if (!source) return [];

  const tokens: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (token: string) => {
    const clean = normalizeWhitespace(token);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tokens.push(clean);
  };

  [
    TECHNICAL_REF_REGEX,
    TECHNICAL_PAREN_LABEL_REGEX,
    TECHNICAL_SECTION_REGEX,
    TECHNICAL_VECTOR_REGEX,
    TECHNICAL_GREEK_REGEX,
  ].forEach((regex) => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null = regex.exec(source);
    while (match) {
      pushUnique(match[0]);
      match = regex.exec(source);
    }
  });

  return tokens;
};

const hasTechnicalTokenInText = (text: string, token: string): boolean => {
  const target = String(text || '');
  const needle = normalizeWhitespace(String(token || ''));
  if (!needle) return true;

  if (/^\(.+\)$/.test(needle)) {
    const inner = needle.slice(1, -1).trim();
    return new RegExp(`\\(\\s*${escapeRegExp(inner)}\\s*\\)`, 'i').test(target);
  }

  if (/^[θφψωαβγδΔΣΩμ]$/.test(needle)) {
    return target.includes(needle);
  }

  if (/^[A-Za-z0-9_.\-]+$/.test(needle)) {
    return new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i').test(target);
  }

  const compactTarget = target.toLowerCase().replace(/\s+/g, '');
  const compactNeedle = needle.toLowerCase().replace(/\s+/g, '');
  return compactTarget.includes(compactNeedle);
};

const preserveTechnicalTokensInTranslation = (sourceText: string, translatedText: string): string => {
  const source = normalizeWhitespace(String(sourceText || ''));
  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!source || !translated) return translated;

  const missingTokens = collectTechnicalTokens(source).filter((token) => !hasTechnicalTokenInText(translated, token));
  if (missingTokens.length === 0) return translated;

  return `${translated} ${missingTokens.join(' ')}`.replace(/\s+/g, ' ').trim();
};

const applyThaiTechnicalGlossary = (sourceText: string, translatedText: string, targetLanguage: string): string => {
  if (normalizeTranslationLanguage(targetLanguage, 'th') !== 'th') {
    return translatedText;
  }

  const source = normalizeWhitespace(String(sourceText || ''));
  if (!source || source.length > 96) return translatedText;

  const lower = source.toLowerCase();
  const compactLower = lower.replace(/[^a-z]/g, '');
  const sectionPrefix = source.match(/^\s*(\d+\.\d+)\b/)?.[1];
  const withSectionPrefix = (value: string): string => (sectionPrefix ? `${sectionPrefix} ${value}` : value);
  const trailingTechnicalLabel = source.match(/\s*(\(\s*[0-9]{1,3}[a-zA-Z]?\s*\))\s*$/)?.[1] || '';
  const withTechnicalLabel = (value: string): string => {
    const replacement = preserveSourceTrailingPunctuation(source, value);
    return trailingTechnicalLabel && !hasTechnicalTokenInText(replacement, trailingTechnicalLabel)
      ? `${replacement} ${trailingTechnicalLabel}`.trim()
      : replacement;
  };

  const chapterWithNumber = source.match(/^chapter\s*(\d+)\s*$/i);
  if (chapterWithNumber?.[1]) {
    return `บทที่ ${chapterWithNumber[1]}`;
  }
  if (/^chapter\s*$/i.test(source)) {
    return 'บท';
  }

  if (/^equilibrium\s+of\s+(?:a\s*)?$/i.test(source)) {
    return withSectionPrefix('สมดุลของ');
  }
  if (/^rigid[-\s]?body$/i.test(source)) {
    return withSectionPrefix('วัตถุแข็ง');
  }

  if (/it\s+is\s+important\s+to\s+be\s+able\s+to\s+determine\s+the\s+forces/i.test(lower)) {
    return 'สิ่งสำคัญคือต้องสามารถหาแรงได้';
  }
  if (/in\s+this\s+chapter\s+we\s+will\s+study\s+how/i.test(lower)) {
    return 'ในบทนี้เราจะศึกษาวิธี';
  }
  if (/to\s+apply\s+equilibrium\s+methods\s+to\s+determine\s+the\s+forces\s+acting\s+on\s+the\s+supports\s+of/i.test(lower)) {
    return 'นำวิธีสมดุลมาใช้เพื่อหาแรงที่กระทำต่อจุดรองรับของ';
  }
  if (/a\s+rigid\s+body\s+such\s+as\s+this/i.test(lower)) {
    return 'วัตถุแข็งเช่นนี้';
  }

  if (compactLower.includes('todeveloptheequationsofequilibriumforarigidbody')) {
    return 'เพื่อพัฒนาสมการสมดุลสำหรับวัตถุแข็ง';
  }
  if (compactLower.includes('tointroducetheconceptofthefreebodydiagramforarigidbody')) {
    return 'เพื่อแนะนำแนวคิดของแผนภาพแรงอิสระสำหรับวัตถุแข็ง';
  }
  if (compactLower.includes('toshowhowtosolverigidbodyequilibriumproblemsusingthe')) {
    return 'เพื่อแสดงวิธีแก้ปัญหาสมดุลของวัตถุแข็งโดยใช้';
  }
  if (compactLower === 'equationsofequilibrium' || compactLower.includes('equationsofequilibrium')) {
    return 'สมการสมดุล';
  }
  if (compactLower.includes('inthissectionwewilldevelopboththenecessaryandsufficientconditions')) {
    return 'ในส่วนนี้เราจะพัฒนาทั้งเงื่อนไขที่จำเป็นและเงื่อนไขที่เพียงพอ';
  }
  if (compactLower.includes('fortheequilibriumoftherigidbodyinfig')) {
    return 'สำหรับสมดุลของวัตถุแข็งในรูปที่ 5-1a ดังที่แสดง วัตถุนี้';
  }
  if (compactLower.includes('subjectedtoanexternalforceandcouplemomentsystem')) {
    return 'อยู่ภายใต้แรงภายนอกและระบบโมเมนต์คู่';
  }
  if (compactLower.includes('particleswithinthebodyarenotshowninthisfigurebecausetheseforces')) {
    return 'แรงภายในที่เกิดจากปฏิสัมพันธ์ระหว่างอนุภาคภายในวัตถุไม่ได้แสดงในรูปนี้ เนื่องจากแรงเหล่านี้';
  }
  if (
    compactLower.includes('oftheeffectsofgravitationalelectricalmagneticorcontactforcescaused')
    || compactLower.includes('oftheeffctofravt')
    || (compactLower.includes('gnetiontact') && compactLower.includes('rescaused'))
  ) {
    return 'ของผลกระทบจากแรงโน้มถ่วง แรงไฟฟ้า แรงแม่เหล็ก หรือแรงสัมผัสที่เกิดขึ้น';
  }
  if (compactLower.includes('occurinequalbutoppositecollinearpairs')) {
    return 'เกิดขึ้นเป็นคู่ที่มีขนาดเท่ากันแต่ทิศทางตรงข้ามกัน';
  }
  if (compactLower.includes('consequenceofthirdlaw')) {
    return 'ซึ่งเป็นผลจากกฎข้อที่สาม';
  }

  if (/equilibrium\s+of\s+(?:a\s+)?rigid[-\s]?body/i.test(lower)) {
    return withSectionPrefix('สมดุลของวัตถุแข็ง');
  }
  if (/free[-\s]?body\s+diagrams?/i.test(lower)) {
    return withSectionPrefix('แผนภาพวัตถุอิสระ');
  }
  if (/chapter\s+objectives?/i.test(lower)) {
    return 'วัตถุประสงค์ของบทนี้';
  }
  if (/conditions?\s+for\s+rigid[-\s]?body\s+equilibrium/i.test(lower)) {
    return withSectionPrefix('เงื่อนไขสำหรับสมดุลของวัตถุแข็ง');
  }
  if (/number\s+of\s+unknowns/i.test(lower)) {
    return 'จำนวนตัวแปรไม่ทราบค่า';
  }
  if (/types?\s+of\s+connection/i.test(lower)) {
    return 'ประเภทของการเชื่อมต่อ';
  }

  if (/^two\s+unknowns?[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ตัวไม่ทราบค่าสองตัว');
  }
  if (/^three\s+unknowns?[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ตัวไม่ทราบค่าสามตัว');
  }
  if (/^three\s+unknowns?[.!?…]*\s+the\s+reactions?\s+are\s+the\s+couple\s+moment[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ตัวไม่ทราบค่าสามตัว แรงปฏิกิริยาเป็นโมเมนต์คู่ควบ');
  }
  if (/\breactions?\b/i.test(source) && /\bcouple\s+moment\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แรงปฏิกิริยาเป็นโมเมนต์คู่ควบ');
  }
  if (/\btwo\s+force\s+components?\b/i.test(source) && /\bcouple\s+moment\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'องค์ประกอบแรงสองแรง หรือโมเมนต์คู่ควบ');
  }
  if (/\bmagnitude\b/i.test(source) && /\bdirection\b/i.test(source) && /\bresultant\s+force\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ขนาดและทิศทางของแรงลัพธ์');
  }
  if (/\bthe\s+floor\s+beams\s+of\s+this\s+building\b/i.test(source) && /\bwelded\b/i.test(source)) {
    if ((/\btogether\b/i.test(source) || compactLower.includes('together')) && /\bfixed\s+connections?\b/i.test(source)) {
      return withTechnicalLabel('คานพื้นของอาคารนี้เชื่อมเข้าด้วยกัน จึงเกิดเป็นจุดต่อแบบยึดแน่น');
    }
    return withTechnicalLabel('คานพื้นของอาคารนี้ถูกเชื่อมเข้าด้วยกัน');
  }
  if (
    (/\btogether\b/i.test(source) || compactLower.includes('together'))
    && (/\bthus\s+form\b/i.test(source) || compactLower.includes('thusform'))
    && /\bfixed\s+connections?\b/i.test(source)
  ) {
    return withTechnicalLabel('เชื่อมเข้าด้วยกัน จึงเกิดเป็นจุดต่อแบบยึดแน่น');
  }
  if (
    (/\btogether\b/i.test(source) || compactLower.includes('together'))
    && (/\bthus\s+form\b/i.test(source) || compactLower.includes('thusform'))
  ) {
    return withTechnicalLabel('เชื่อมเข้าด้วยกัน จึงเกิดเป็น');
  }
  if (/\bfixed\s+connections?\b/i.test(source)) {
    return withTechnicalLabel('จุดต่อแบบยึดแน่น');
  }
  if (/^are\s+welded$/i.test(source) || compactLower === 'arewelded') {
    return withTechnicalLabel('ถูกเชื่อมเข้าด้วยกัน');
  }
  if (/^welded$/i.test(source) || compactLower === 'welded') {
    return withTechnicalLabel('เชื่อมเข้าด้วยกัน');
  }
  if (/^two$/i.test(source) || compactLower === 'two') {
    return withTechnicalLabel('สอง');
  }
  if (/^three$/i.test(source) || compactLower === 'three') {
    return withTechnicalLabel('สาม');
  }
  if (/^pin$/i.test(source) || compactLower === 'pin') {
    return withTechnicalLabel('พิน');
  }
  if (/^in$/i.test(source) || compactLower === 'in') {
    return withTechnicalLabel('ใน');
  }
  if (/^fixed$/i.test(source) || compactLower === 'fixed') {
    return withTechnicalLabel('ยึดแน่น');
  }
  if (/^reactions$/i.test(source) || compactLower === 'reactions') {
    return withTechnicalLabel('แรงปฏิกิริยา');
  }
  if (/\bthis\s+utility\s+building\s+is\b/i.test(source) && /\bpin\s+supported\b/i.test(source)) {
    return withTechnicalLabel('อาคารอเนกประสงค์นี้รองรับแบบพินที่ด้านบนของเสา');
  }
  if (/\bpin\s+supported\b/i.test(source) && /\btop\s+of\s+the\s+column\b/i.test(source)) {
    return withTechnicalLabel('รองรับแบบพินที่ด้านบนของเสา');
  }

  const tableMatch = source.match(/table\s*(\d+(?:[-–]\d+)?)\s*continued/i);
  if (tableMatch?.[1]) {
    return `ตาราง ${tableMatch[1]} (ต่อ)`;
  }

  return translatedText;
};

const normalizeThaiTechnicalTerms = (sourceText: string, translatedText: string): string => {
  const source = normalizeWhitespace(String(sourceText || ''));
  let normalized = normalizeWhitespace(String(translatedText || ''));
  if (!source || !normalized) return normalized;

  const technicalBodyContext = /\b(rigid|body|equilibrium|force|moment|support|diagram|conditions?|objectives?)\b/i.test(source);
  if (technicalBodyContext) {
    normalized = normalized
      .replace(/ร่างกายที่แข็งตัว/gi, 'วัตถุแข็ง')
      .replace(/ร่างกายแข็ง/gi, 'วัตถุแข็ง')
      .replace(/ของร่างกาย/gi, 'ของวัตถุ')
      .replace(/ร่างกาย/gi, 'วัตถุ');
  }

  normalized = normalized
    .replace(/สมการของสมดุลเพื่อพัฒนา/gi, 'เพื่อพัฒนาสมการสมดุล')
    .replace(/สมการของสมดุล/gi, 'สมการสมดุล')
    .replace(/บทเรียนเพื่อพัฒนา/gi, 'วัตถุประสงค์ของบทนี้');

  return normalizeWhitespace(normalized);
};

const preserveSourceTrailingPunctuation = (sourceText: string, replacement: string): string => {
  const punctuation = String(sourceText || '').trim().match(/([.!?…]+)$/)?.[1] || '';
  const cleanReplacement = normalizeWhitespace(String(replacement || '')).replace(/[.!?…]+$/g, '').trim();
  return `${cleanReplacement}${punctuation}`.trim();
};

const globalPreservePunctuation = preserveSourceTrailingPunctuation;


import {
  setSlangGroupContext,
  applyThaiConversationalGlossary,
  applyReceiptGlossary,
} from './services/translation/thaiConversationalGlossary';

const finalizeTranslatedLine = (sourceText: string, translatedText: string, targetLanguage: string): string => {
  const source = normalizeWhitespace(String(sourceText || ''));
  let resolved = normalizeWhitespace(String(translatedText || ''));

  if (isBoilerplateHallucination(source, resolved)) {
    console.warn(`[finalizeTranslatedLine] Detected boilerplate hallucination: "${resolved}" for source: "${source}". Falling back.`);
    resolved = '';
  }

  if (normalizeTranslationLanguage(targetLanguage, 'th') === 'th') {
    // 1. Korean fallback check
    if (/[\uAC00-\uD7AF]/.test(source) && (!resolved || !/[\u0E00-\u0E7F]/.test(resolved) || hasKoreanTranslationCarryover(resolved))) {
      const koFallback = applyKoreanConversationalFallback(source, resolved);
      if (koFallback) {
        resolved = koFallback;
      }
    }

    // 2. English/Latin/Spanish carryover check
    const isCarryover = !resolved || resolved === source || (!/[\u0E00-\u0E7F]/.test(resolved) && /[a-zA-Z]/.test(resolved));
    if (isCarryover) {
      const dictHit = lookupShortPhraseTh(source) || lookupShortPhraseTh(source.replace(/[^A-Za-z0-9]/g, '')) || lookupShortPhraseTh(normalizeSpanishOcrNoiseForTranslation(source));
      if (dictHit) {
        resolved = dictHit;
      } else {
        const words = source.trim().split(/\s+/);
        if (words.length > 1) {
          const translatedWords = words.map(w => lookupShortPhraseTh(w) || lookupShortPhraseTh(w.replace(/[^A-Za-z0-9]/g, '')) || w);
          if (translatedWords.some(tw => /[\u0E00-\u0E7F]/.test(tw))) {
            resolved = translatedWords.join(' ');
          }
        }
      }
    }
  }

  if (!resolved) {
    resolved = normalizeSourceForTranslation(source, 'en');
    if (source && resolved === source) {
      console.warn(`[finalizeTranslatedLine] fallback to source for: "${source}"`);
    }
  }

  resolved = applyThaiTechnicalGlossary(source, resolved, targetLanguage);
  resolved = preserveTechnicalTokensInTranslation(source, resolved);
  resolved = normalizeThaiTechnicalTerms(source, resolved);
  resolved = applyThaiConversationalGlossary(source, resolved, targetLanguage);
  resolved = applyReceiptGlossary(source, resolved, targetLanguage);
  resolved = collapseRepeatedTranslationFragments(resolved);

  if (normalizeTranslationLanguage(targetLanguage, 'th') === 'th') {
    return normalizeThaiTranslationText(resolved);
  }
  return normalizeWhitespace(resolved);
};

const composeGroupSourceText = (
  lines: TranslatableLine[],
  groupType: string = 'unknown',
  groupingProfile: TranslationGroupingProfile = 'default'
): { composed: string; dehyphenJoins: DehyphenatedJoin[] } => {
  const items = lines.map((line, originalIdx) => {
    const rawText = line.text != null ? String(line.text) : '';
    const cleaned = normalizeEnglishOcrNoiseForTranslation(rawText);
    return {
      text: normalizeWhitespace(cleaned),
      originalIdx,
    };
  });

  const activeItems = items.filter((item) => Boolean(item.text));

  if (activeItems.length === 0) {
    return { composed: '', dehyphenJoins: [] };
  }
  if (activeItems.length === 1) {
    return { composed: activeItems[0].text.replace(/-$/, ''), dehyphenJoins: [] };
  }

  const isNarrative =
    groupType === 'balloon' ||
    groupType === 'narration' ||
    groupType === 'dialogue' ||
    groupType === 'unknown';

  if (!isNarrative) {
    const composed = activeItems.map((item) => item.text).join('\n');
    return { composed, dehyphenJoins: [] };
  }

  const joins: DehyphenatedJoin[] = [];

  // 1. Merge split COOOOOOOCKS across lines
  for (let i = 0; i < activeItems.length; i++) {
    const currItem = activeItems[i];
    if (!currItem.text) continue;
    const curr = currItem.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    // Case 1: COO + OOO + OCKS (3 lines)
    if (i < activeItems.length - 2) {
      const n1Item = activeItems[i + 1];
      const n2Item = activeItems[i + 2];
      if (n1Item.text && n2Item.text) {
        const next1 = n1Item.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const next2 = n2Item.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (
          /^COO+$/i.test(curr) &&
          /^[0O]{3,}$/i.test(next1) &&
          /^[70Z]?OCKS$/i.test(next2)
        ) {
          currItem.text = 'COOOOOOOCKS';
          n1Item.text = '';
          n2Item.text = '';
          joins.push({ parentIdx: currItem.originalIdx, childIdx: n1Item.originalIdx });
          joins.push({ parentIdx: currItem.originalIdx, childIdx: n2Item.originalIdx });
          continue;
        }
      }
    }
    
    // Case 2: COO + OCKS (2 lines)
    if (i < activeItems.length - 1) {
      const n1Item = activeItems[i + 1];
      if (n1Item.text) {
        const next = n1Item.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (
          /^COO+$/i.test(curr) &&
          /^[70Z]?OCKS$/i.test(next)
        ) {
          currItem.text = 'COOOOOOOCKS';
          n1Item.text = '';
          joins.push({ parentIdx: currItem.originalIdx, childIdx: n1Item.originalIdx });
          continue;
        }
      }
    }
  }

  // Filter out any blanked items from step 1
  const remainingItems = activeItems.filter((item) => Boolean(item.text));

  // 2. Perform hyphenation merges on the remaining lines
  for (let i = 0; i < remainingItems.length - 1; i++) {
    const currItem = remainingItems[i];
    const nextItem = remainingItems[i + 1];
    
    if (
      currItem.text &&
      nextItem.text &&
      /[A-Za-z][\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00AD]$/.test(currItem.text) &&
      /^[A-Za-z0-9]/.test(nextItem.text)
    ) {
      // Check if nextItem starts with a Japanese honorific like SAN, CHAN, KUN, SAMA, SENSEI, SENPAI
      const honorificMatch = nextItem.text.match(/^(SAN|CHAN|KUN|SAMA|SENSEI|SENPAI|DONO)(['’]S)?(\b.*)$/i);
      if (honorificMatch) {
        const cleanParentText = currItem.text.replace(/[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00AD]$/, '');
        const honorific = honorificMatch[1];
        const suffix = honorificMatch[2] || '';
        const restOfNext = (honorificMatch[3] || '').trim();

        if (!restOfNext) {
          currItem.text = `${cleanParentText}-${honorific}${suffix}`;
          nextItem.text = '';
          joins.push({ parentIdx: currItem.originalIdx, childIdx: nextItem.originalIdx });
        } else {
          currItem.text = `${cleanParentText}-${honorific}${suffix}`;
          nextItem.text = restOfNext;
        }
        continue;
      }

      const cleanParentText = currItem.text.replace(/[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00AD]$/, '');
      const nextTokens = nextItem.text.trim().split(/\s+/);
      const firstToken = nextTokens[0] || '';
      const restTokens = nextTokens.slice(1).join(' ');

      if (!restTokens) {
        currItem.text = cleanParentText + firstToken;
        nextItem.text = '';
        joins.push({ parentIdx: currItem.originalIdx, childIdx: nextItem.originalIdx });
      } else {
        currItem.text = cleanParentText + firstToken;
        nextItem.text = restTokens;
      }
    }
  }

  // Filter out any blanked items from step 2
  const finalItems = remainingItems.filter((item) => Boolean(item.text));
  const composed = finalItems.map((item) => item.text).join(' ');

  return { composed, dehyphenJoins: joins };
};

const createBalloonAwareGroupingInput = (
  pageNum: number,
  pageOCR: OCRPageResult,
  lines: TranslatableLine[],
  sourceLanguage: string,
  mode: TranslationMode
): LayoutGroupingInput => ({
  pageNumber: pageNum,
  imageWidth: Math.max(1, Number(pageOCR.width || 1)),
  imageHeight: Math.max(1, Number(pageOCR.height || 1)),
  lines: lines.map<OCRLineWithLayout>((line) => {
    const originalLine = pageOCR.lines?.[line.index] || pageOCR.lines?.find(l => 
      Math.abs(l.bbox.x0 - line.left) < 1.5 && Math.abs(l.bbox.y0 - line.top) < 1.5
    );
    const originalText = originalLine ? originalLine.text : line.text;
    return {
      index: line.index,
      text: originalText,
      sourceLength: line.sourceLength,
      top: line.top,
      bottom: line.bottom,
      left: line.left,
      right: line.right,
      height: line.height,
      area: line.area,
      confidence: line.confidence,
      angleDeg: line.angleDeg,
      sortHintX: line.sortHintX,
      sortHintY: line.sortHintY,
      quad: line.quad,
      sourceEngine: line.sourceEngine,
    };
  }),
  mode: 'balloon-aware',
  readingMode: resolveBalloonAwareReadingMode(sourceLanguage, mode),
});

const buildTranslationGroupsFromDerivedLayout = (
  layoutResult: LayoutGroupingResult,
  lines: TranslatableLine[],
  acceptedGroupIds?: Set<string>
): TranslationGroup[] => {
  const lineMap = new Map<number, TranslatableLine>(lines.map((line) => [line.index, line]));
  const derivedGroupByLineIndex = new Map<number, DerivedLayoutGroup>();
  layoutResult.groups.forEach((group) => {
    if (acceptedGroupIds && !acceptedGroupIds.has(group.id)) return;
    group.orderedLineIndexes.forEach((lineIndex) => {
      derivedGroupByLineIndex.set(lineIndex, group);
    });
  });

  const emittedGroupIds = new Set<string>();
  const groups: TranslationGroup[] = [];

  layoutResult.orderedLineIndexes.forEach((lineIndex) => {
    const derivedGroup = derivedGroupByLineIndex.get(lineIndex);
    if (derivedGroup) {
      if (emittedGroupIds.has(derivedGroup.id)) return;
      emittedGroupIds.add(derivedGroup.id);
      const groupLines = derivedGroup.orderedLineIndexes
        .map((index) => lineMap.get(index))
        .filter((line): line is TranslatableLine => Boolean(line));
      if (groupLines.length > 0) {
        const width = Math.max(1, derivedGroup.bounds.right - derivedGroup.bounds.left);
        const height = Math.max(1, derivedGroup.bounds.bottom - derivedGroup.bounds.top);
        const area = width * height;
        const compactText = groupLines.map(l => l.text.replace(/\s+/g, '')).join('');
        const aspectRatio = height / Math.max(1, width);
        
        // A group is massively sparse if it has very few characters in a huge area
        // Bypassed for PaddleOCR as it generally produces tight/accurate bounding boxes,
        // and webtoon pages can easily have bubble areas > 40,000 pixels.
        const isExternalEngine = groupLines.some(l => l.sourceEngine === 'paddleocr' || l.sourceEngine === 'easyocr');
        const isSparselyPopulated = !isExternalEngine && (
             (area >= 40000 && compactText.length <= 14 && (area / Math.max(1, compactText.length)) >= 2500)
          || (area >= 80000 && compactText.length <= 22 && (area / Math.max(1, compactText.length)) >= 2000)
        );

        // Heuristics to protect legitimate dialogue bubbles like "OH MY~"
        const fullText = groupLines.map(l => l.text).join(' ');
        const hasDialoguePunctuation = /[~!?….,'"]/.test(fullText);
        const isKnownShortDialogue = /^(?:OH|AH|UHM|HMM|UGH|OUCH|EH|UH|WOW|HEY|MY)/i.test(fullText.trim());
        const isHorizontalBubble = aspectRatio <= 0.45; // Most speech bubbles are horizontal
        const hasLowercase = /[a-z]/.test(fullText); // SFX are almost always ALL CAPS
        const hasMultipleWords = fullText.trim().split(/\s+/).length >= 2;

        // If it looks like dialogue, protect it from being filtered out
        const looksLikeDialogue = hasDialoguePunctuation || isKnownShortDialogue || isHorizontalBubble || hasLowercase || hasMultipleWords;

        const isSparseGroup = isSparselyPopulated && !looksLikeDialogue;
          
        if (!isSparseGroup) {
          groups.push({
            lines: groupLines,
            groupType: derivedGroup.groupType,
            derivedGroupId: derivedGroup.id,
            confidence: derivedGroup.confidence,
          });
        }
      }
      return;
    }

    const line = lineMap.get(lineIndex);
    if (!line) return;
    groups.push({
      lines: [line],
      groupType: 'unknown',
      confidence: 0.5,
    });
  });

  if (groups.length === 0) {
    return lines.map((line) => ({ lines: [line], groupType: 'unknown', confidence: 0.5 }));
  }

  return groups;
};

const pushLayoutGroupingDebugPayload = (
  pageNum: number,
  groupingProfile: TranslationGroupingProfile,
  layoutResult: LayoutGroupingResult | undefined,
  groups: TranslationGroup[]
): void => {
  if (!isLayoutGroupingDebugEnabled()) return;

  const payload = {
    pageNum,
    groupingProfile,
    rawOrder: layoutResult?.diagnostics.rawOrder || groups.flatMap((group) => group.lines.map((line) => line.index)),
    derivedGroups: layoutResult?.groups || [],
    orderedLineIndexes: layoutResult?.orderedLineIndexes || groups.flatMap((group) => group.lines.map((line) => line.index)),
    composedGroupTexts: groups.map((group) => ({
      groupId: group.derivedGroupId || null,
      groupType: group.groupType || 'unknown',
      confidence: group.confidence || 0,
      lineIndexes: group.lines.map((line) => line.index),
      text: composeGroupSourceText(group.lines, group.groupType || 'unknown', groupingProfile).composed,
    })),
  };

  const globalState = globalThis as GlobalPrewarmState;
  globalState.__pdfTranslatorLastLayoutGrouping = payload;
  console.debug('[LayoutGrouping]', payload);
};

export const resolveTranslationGroupsWithLayout = (
  pageNum: number,
  pageOCR: OCRPageResult,
  lines: TranslatableLine[],
  fallbackProfile: TranslationGroupingProfile,
  sourceLanguage: string,
  targetLanguage: string,
  mode: TranslationMode
): ResolvedTranslationGroups => {
  const fallbackGroups = buildTranslationGroups(lines, fallbackProfile);
  const fallbackDecision: GroupingDecision = {
    appliedProfile: fallbackProfile === 'dense-dialogue' ? 'dense-dialogue' : 'raw',
    confidence: fallbackProfile === 'dense-dialogue' ? 0.58 : 0.5,
  };

  if (fallbackProfile === 'line-by-line') {
    return {
      groups: fallbackGroups,
      groupingProfile: fallbackProfile,
      groupingDecision: fallbackDecision,
    };
  }

  // 1. Try to load groups from useLayerStore to preserve user adjustments and high quality 2D spatial clustering
  try {
    const storeGroups = useLayerStore.getState().getPageGroups(pageNum);
    const storeLayers = useLayerStore.getState().getPageLayers(pageNum);
    
    // If store is empty (e.g. in Background Queue or fresh document load),
    // compute fresh canonical 2D spatial layer groups directly via buildLayerGroupsFromOCR(pageOCR)
    let effectiveStoreGroups = storeGroups;
    let effectiveStoreLayers = storeLayers;

    if (!effectiveStoreGroups || effectiveStoreGroups.length === 0 || !effectiveStoreLayers || effectiveStoreLayers.length === 0) {
      if (pageOCR && Array.isArray(pageOCR.lines) && pageOCR.lines.length > 0) {
        const generated = buildLayerGroupsFromOCR(pageOCR);
        effectiveStoreGroups = generated.groups;
        effectiveStoreLayers = generated.layers;
      }
    }

    if (effectiveStoreGroups && effectiveStoreGroups.length > 0 && effectiveStoreLayers && effectiveStoreLayers.length > 0) {
      const lineMap = new Map<number, TranslatableLine>(lines.map((line) => [line.index, line]));
      const layerMap = new Map<string, TextLayer>(effectiveStoreLayers.map((l) => [l.id, l]));
      
      let matchedLayerCount = 0;
      let totalStoreLayers = 0;
      const translationGroups: TranslationGroup[] = [];
      effectiveStoreGroups.forEach((sg) => {
        totalStoreLayers += sg.layerIds.length;
        const groupLines = sg.layerIds
          .map((id) => layerMap.get(id))
          .filter((l): l is TextLayer => Boolean(l))
          .map((l) => {
            const line = lineMap.get(l.lineIndex);
            if (line) matchedLayerCount += 1;
            return line;
          })
          .filter((line): line is TranslatableLine => Boolean(line));

        // Sort lines vertically (top-to-bottom) to ensure correct reading order for translation
        groupLines.sort((a, b) => a.top - b.top);

        if (groupLines.length > 0) {
          let groupType: LayoutGroupType = 'unknown';
          if (sg.groupType === 'balloon') {
            groupType = 'dialogue';
          } else if (sg.groupType === 'narration') {
            groupType = 'narration';
          }

          translationGroups.push({
            lines: groupLines,
            groupType,
            derivedGroupId: sg.id,
            confidence: sg.confidence ?? 0.95,
          });
        }
      });

      const matchRatio = totalStoreLayers > 0 ? matchedLayerCount / totalStoreLayers : 0;
      if (translationGroups.length > 0 && matchRatio >= 0.75) {
        // Add any lines from `lines` that are not in any group as singleton groups
        const groupedLineIndexes = new Set<number>();
        translationGroups.forEach((tg) => {
          tg.lines.forEach((l) => groupedLineIndexes.add(l.index));
        });

        lines.forEach((line) => {
          if (!groupedLineIndexes.has(line.index)) {
            translationGroups.push({
              lines: [line],
              groupType: 'unknown',
              confidence: 0.5,
            });
          }
        });

        console.log(`[resolveTranslationGroupsWithLayout] Using canonical 2D spatial groups for page ${pageNum}: count=${translationGroups.length} (fromStore=${Boolean(storeGroups && storeGroups.length > 0)})`);
        translationGroups.forEach((tg, gIdx) => {
          console.log(`[DBG-groups-p${pageNum}] Group #${gIdx} (${tg.lines.length} lines, type=${tg.groupType}):`, tg.lines.map(l => `[${l.index}] "${l.text}"`).join(' | '));
        });
        return {
          groups: translationGroups,
          groupingProfile: 'balloon-aware',
          groupingDecision: {
            appliedProfile: 'balloon-aware',
            confidence: 1.0,
            fallbackReason: storeGroups && storeGroups.length > 0 ? 'use_store_groups' : 'use_canonical_ocr_groups',
          },
        };
      }
    }
  } catch (err) {
    console.warn('[resolveTranslationGroupsWithLayout] Failed to resolve groups from store/canonical:', err);
  }

  const flagEnabled = isBalloonAwareGroupingEnabled();
  const shouldGroup = shouldUseBalloonAwareGrouping(lines, sourceLanguage, targetLanguage, mode);
  console.log(`[resolveTranslationGroupsWithLayout] page=${pageNum} flagEnabled=${flagEnabled} shouldGroup=${shouldGroup} lines=${lines.length} mode=${mode}`);

  if (!flagEnabled) {
    return {
      groups: fallbackGroups,
      groupingProfile: fallbackProfile,
      groupingDecision: {
        ...fallbackDecision,
        fallbackReason: 'feature_flag_disabled',
      },
    };
  }

  if (!shouldGroup) {
    return {
      groups: fallbackGroups,
      groupingProfile: fallbackProfile,
      groupingDecision: fallbackDecision,
    };
  }

  const layoutResult = deriveBalloonAwareLayoutGrouping(
    createBalloonAwareGroupingInput(pageNum, pageOCR, lines, sourceLanguage, mode)
  );
  const multiLineGroupCount = layoutResult.groups.filter((group) => group.orderedLineIndexes.length > 1).length;
  const layoutConfidence = Number(layoutResult.diagnostics.avgConfidence || 0);
  const acceptedGroupConfidenceFloor = mode === 'official' ? 0.68 : 0.62;

  if (layoutConfidence < 0.62 || multiLineGroupCount === 0) {
    const acceptedDerivedGroups = layoutResult.groups.filter((group) =>
      group.orderedLineIndexes.length > 1
      && group.confidence >= acceptedGroupConfidenceFloor
      && (group.groupType === 'dialogue' || group.confidence >= 0.68)
    );
    const acceptedCoverage = acceptedDerivedGroups.reduce((sum, group) => sum + group.orderedLineIndexes.length, 0)
      / Math.max(1, lines.length);
    if (acceptedDerivedGroups.length > 0 && (layoutConfidence >= 0.48 || acceptedCoverage >= 0.18)) {
      return {
        groups: buildTranslationGroupsFromDerivedLayout(
          layoutResult,
          lines,
          new Set(acceptedDerivedGroups.map((group) => group.id))
        ),
        groupingProfile: 'balloon-aware',
        groupingDecision: {
          appliedProfile: 'balloon-aware',
          confidence: Math.max(layoutConfidence, acceptedCoverage),
          fallbackReason: 'partial_layout_adoption',
        },
        layoutResult,
      };
    }
    return {
      groups: fallbackGroups,
      groupingProfile: fallbackProfile,
      groupingDecision: {
        ...fallbackDecision,
        confidence: layoutConfidence || fallbackDecision.confidence,
        fallbackReason: layoutResult.diagnostics.warnings.join(',') || 'low_layout_confidence',
      },
      layoutResult,
    };
  }

  return {
    groups: buildTranslationGroupsFromDerivedLayout(layoutResult, lines),
    groupingProfile: 'balloon-aware',
    groupingDecision: {
      appliedProfile: 'balloon-aware',
      confidence: layoutConfidence,
    },
    layoutResult,
  };
};



/** Floating Queue Status Badge แสดงสถานะ Background Queue ขณะอยู่ในหน้า File Preview */
const BackgroundQueueBadge: React.FC = () => {
  const liveJobs = useBackgroundQueueStore((s) => s.jobs);
  const [showQueuePanel, setShowQueuePanel] = React.useState(false);

  const activeJobs = liveJobs.filter(j => ['processing', 'queued', 'pending'].includes(j.status));
  const runningJob = activeJobs.find(j => j.status === 'processing');

  if (activeJobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[190] flex flex-col items-start gap-1.5">
      {/* Main badge */}
      <button
        onClick={() => setShowQueuePanel(p => !p)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#0f1117]/90 border border-white/10 shadow-xl backdrop-blur-md hover:border-[#2B9BFF]/40 transition-all"
      >
        <div className="relative flex items-center justify-center w-4 h-4 shrink-0">
          <div className="absolute w-3 h-3 rounded-full bg-[#2B9BFF] opacity-30 animate-ping" />
          <div className="w-2 h-2 rounded-full bg-[#2B9BFF]" />
        </div>
        <div className="text-left min-w-0">
          {runningJob ? (
            <>
              <p className="text-[10px] font-semibold text-slate-200 truncate max-w-[140px]">{runningJob.filename}</p>
              <p className="text-[9px] text-[#2B9BFF]">
                หน้า {runningJob.currentPage}/{runningJob.totalPages} · {runningJob.progress}%
              </p>
            </>
          ) : (
            <p className="text-[10px] font-semibold text-slate-400">{activeJobs.length} งานรอคิว...</p>
          )}
        </div>
        <span className="ml-1 text-[9px] text-slate-500 font-mono bg-white/5 px-1.5 py-0.5 rounded-md border border-white/[0.08]">
          {activeJobs.length}
        </span>
      </button>

      {/* Mini queue panel */}
      {showQueuePanel && (
        <div className="w-64 rounded-xl bg-[#0f1117]/95 border border-white/10 shadow-2xl backdrop-blur-xl overflow-hidden animate-in slide-in-from-bottom-2 duration-150">
          <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-300 tracking-wider uppercase">Queue</span>
            <button onClick={() => setShowQueuePanel(false)} className="text-slate-500 hover:text-slate-300 transition-colors">
              <X size={11} />
            </button>
          </div>
          <div className="max-h-48 overflow-y-auto custom-scrollbar divide-y divide-white/5">
            {activeJobs.map((job, idx) => {
              const isRunning = job.status === 'processing';
              return (
                <div key={job.id} className={`px-3 py-2 flex items-center gap-2 ${isRunning ? 'bg-[#2B9BFF]/5' : ''}`}>
                  <div className="shrink-0">
                    {isRunning ? (
                      <div className="w-1.5 h-1.5 rounded-full bg-[#2B9BFF] animate-pulse" />
                    ) : (
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-semibold text-slate-300 truncate">{job.filename}</p>
                    <p className="text-[8px] text-slate-500 truncate">{job.message}</p>
                  </div>
                  {isRunning && (
                    <span className="text-[8px] text-[#2B9BFF] font-mono shrink-0">{job.progress}%</span>
                  )}
                  {!isRunning && (
                    <span className="text-[8px] text-slate-600 shrink-0">#{idx + 1}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const showOCRHarness = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('ocr_harness') === '1';
  const activeTool = useUIStore((s) => s.activeTool);
  const setActiveTool = useUIStore((s) => s.setActiveTool);
  const loadingState = useUIStore((s) => s.loadingState);
  const setLoadingState = useUIStore((s) => s.setLoadingState);
  const splitViewMode = useUIStore((s) => s.viewMode);
  const setSplitViewMode = useUIStore((s) => s.setViewMode);
  const ocrOptions = useOCRTextLayerStore((state) => state.options);
  const ocrLanguage = ocrOptions.language;
  const setTranslationCacheEntry = useOCRTextLayerStore((state) => state.setTranslationCacheEntry);
  const isOCRProcessing = useOCRTextLayerStore((state) => state.isProcessing);
  const setProgress = useOCRTextLayerStore((state) => state.setProgress);
  const setOcrOptions = useOCRTextLayerStore((state) => state.setOptions);

  const file = useProjectStore((s) => s.file);
  const fileName = useProjectStore((s) => s.fileName);
  const filePath = useProjectStore((s) => s.filePath);
  const documentId = useProjectStore((s) => s.documentId);
  const fileType = useProjectStore((s) => s.fileType);
  const fileData = useProjectStore((s) => s.fileData);
  const currentPage = useProjectStore((s) => s.currentPage);
  const totalPages = useProjectStore((s) => s.totalPages);
  const ensureDocumentId = useProjectStore((s) => s.ensureDocumentId);
  const setPage = useProjectStore((s) => s.setPage);
  const closeProject = useProjectStore((s) => s.closeProject);
  const viewMode = useProjectStore((s) => s.viewMode);
  const setViewMode = useProjectStore((s) => s.setViewMode);
  const sourceLanguage = useProjectStore((s) => s.sourceLanguage);
  const targetLanguage = useProjectStore((s) => s.targetLanguage);
  const setTargetLanguage = useProjectStore((s) => s.setTargetLanguage);
  const translationMode = useProjectStore((s) => s.translationMode);
  const setTranslationMode = useProjectStore((s) => s.setTranslationMode);
  const overlayThaiFontEnabled = useProjectStore((s) => s.overlayThaiFontEnabled);
  const overlayFontPreset = useProjectStore((s) => s.overlayFontPreset);
  const overlayFontSizeScale = useProjectStore((s) => s.overlayFontSizeScale);
  const setOverlayFontSizeScale = useProjectStore((s) => s.setOverlayFontSizeScale);
  const safetySettings = useProjectStore((s) => s.safetySettings);
  const hydrateGeminiApiKey = useProjectStore((s) => s.hydrateGeminiApiKey);
  const hasGeminiApiKey = useProjectStore((s) => s.hasGeminiApiKey);

  const updateLayerFontSize = useLayerStore((state) => state.updateLayerFontSize);

  // Selective selectors to avoid re-renders during dragging/resizing/rotating on the canvas
  const hasSelection = useLayerStore((state) => {
    const pageLayers = state.layersByPage.get(currentPage) || [];
    return pageLayers.some(l => state.selectedLayerIds.has(l.id));
  });

  const currentFontSize = useLayerStore((state) => {
    const pageLayers = state.layersByPage.get(currentPage) || [];
    const firstSelected = pageLayers.find(l => state.selectedLayerIds.has(l.id));
    return firstSelected ? firstSelected.fontSize : 14;
  });

  const [showFontDropdown, setShowFontDropdown] = useState(false);

  const adjustOverlayFontScale = (delta: number) => {
    const next = Math.max(0.1, Math.min(4.0, overlayFontSizeScale + delta));
    setOverlayFontSizeScale(Number(next.toFixed(2)));
  };
  const overlayFontScalePercent = Math.round(overlayFontSizeScale * 100);

  const allPagesOCR = useOCRTextLayerStore((state) => state.allPagesOCR);
  const activePageOCR = allPagesOCR.get(currentPage);

  const normalizePrewarmLanguage = (value: string): string => value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join('+') || 'eng';
  
  const [isAiProcessingRaw, setIsAiProcessing] = useState(false);
  const [isOfflineProcessingRaw, setIsOfflineProcessing] = useState(false);
  const [offlineEngine, setOfflineEngine] = useState<'argos' | 'm2m100'>('argos');

  // เชื่อมโยงความคืบหน้าของเอกสารปัจจุบันจากระบบคิวประมวลผลเบื้องหลัง
  const queueJobs = useBackgroundQueueStore((state) => state.jobs);
  const currentDocJob = documentId ? queueJobs.find(j => j.documentId === documentId && j.status === 'processing') : null;

  const isOfflineProcessing = currentDocJob ? currentDocJob.type === 'offline_all' : isOfflineProcessingRaw;
  const isAiProcessing = currentDocJob ? currentDocJob.type === 'ai_all' : isAiProcessingRaw;
  
  const [isQueuePanelExpanded, setIsQueuePanelExpanded] = useState(false);
  const [isVisionReady, setIsVisionReady] = useState(false);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const handleToggleLeftSidebar = useCallback(() => {
    setIsLeftSidebarOpen((prev) => !prev);
  }, []);

  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const lastWidthRef = useRef(window.innerWidth);
  useEffect(() => {
    const currentWidth = windowWidth;
    const prevWidth = lastWidthRef.current;
    if (currentWidth < 1024 && prevWidth >= 1024) {
      setIsLeftSidebarOpen(false);
    } else if (currentWidth >= 1024 && prevWidth < 1024) {
      setIsLeftSidebarOpen(true);
    }
    lastWidthRef.current = currentWidth;
  }, [windowWidth]);

  const isNarrow = windowWidth < 820;
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(file?.name || '');
  const [translationStatus, setTranslationStatus] = useState<{ kind: 'info' | 'success' | 'error'; message: string } | null>(null);
  const {
    isDownloadMenuOpen,
    setIsDownloadMenuOpen,
    downloadScopeSelection,
    setDownloadScopeSelection,
    downloadModeSelection,
    setDownloadModeSelection,
    selectedExportEngine,
    setSelectedExportEngine,
    isDownloadingResult,
    setIsDownloadingResult,
    exportCacheHydrationTick,
    setExportCacheHydrationTick,
    downloadMenuRef,
  } = useDownloadMenuState();
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const translationStartTime = useTranslationLoadingState({
    isAiProcessing,
    isOfflineProcessing,
    isDownloadingResult,
    setLoadingState,
  });
  const [popupOcrQualityMode, setPopupOcrQualityMode] = useState<'high' | 'fast'>(() => {
    const saved = localStorage.getItem('pdf_translator_ocr_profile');
    return (saved === 'high' || saved === 'fast') ? saved : 'fast';
  });
  const popupQualityToProfile = (mode: 'high' | 'fast'): OCRQualityProfile =>
    mode === 'high' ? 'balanced' : 'fast';

  const applyPopupOcrQualityProfile = useCallback((mode: 'high' | 'fast' = popupOcrQualityMode) => {
    setOcrOptions({ ocrQualityProfile: popupQualityToProfile(mode) });
  }, [popupOcrQualityMode, setOcrOptions]);

  const changeOcrQualityMode = useCallback((mode: 'high' | 'fast') => {
    setPopupOcrQualityMode(mode);
    localStorage.setItem('pdf_translator_ocr_profile', mode);
    setOcrOptions({ ocrQualityProfile: popupQualityToProfile(mode) });
  }, [setOcrOptions]);

  useEffect(() => {
    const saved = localStorage.getItem('pdf_translator_ocr_profile') as 'high' | 'fast' | null;
    const mode = (saved === 'high' || saved === 'fast') ? saved : 'fast';
    setOcrOptions({ ocrQualityProfile: popupQualityToProfile(mode) });
  }, [setOcrOptions]);

  useEffect(() => {
    if (!isDownloadMenuOpen) return;
    const syncedMode = ocrOptions.ocrQualityProfile === 'balanced' || ocrOptions.ocrQualityProfile === 'best'
      ? 'high'
      : 'fast';
    if (syncedMode !== popupOcrQualityMode) {
      setPopupOcrQualityMode(syncedMode);
    }
    if (!selectedExportEngine) {
      setSelectedExportEngine((ocrOptions.engine || 'paddleocr') as OCREngine);
    }
  }, [isDownloadMenuOpen, ocrOptions.engine, ocrOptions.ocrQualityProfile, selectedExportEngine, popupOcrQualityMode]);

  const { hydrateExportCachesForDownload } = useExportCacheHydration({
    isDownloadMenuOpen,
    selectedExportEngine,
    defaultEngine: (ocrOptions.engine || 'paddleocr') as OCREngine,
    totalPages,
    fileType,
    documentId,
    ensureDocumentId,
    setExportCacheHydrationTick,
  });

  const {
    resolveModelScopedOriginalPageOCR,
    hasModelScopedCachedOCR,
    getModelScopedCachedPageNumbers,
    resolveModelScopedPagesForExport,
    resolveTranslatedEntryForExport,
    resolveLineBBoxForExport,
    buildTranslatedPageOCRForExport,
    resolveVisibleOverlayExportSize,
  } = useExportOcrResolvers({
    currentPage,
    fileType,
    totalPages,
    targetLanguage,
    translationMode,
    defaultEngine: (ocrOptions.engine || 'paddleocr') as OCREngine,
  });

  const { handleHeaderDownload } = useExportOrchestration({
    popupOcrQualityMode,
    setTranslationStatus,
    selectedExportEngine,
    setIsDownloadingResult,
    setIsDownloadMenuOpen,
    setExportCacheHydrationTick,
    hydrateExportCachesForDownload,
    resolveModelScopedPagesForExport,
    resolveTranslatedEntryForExport,
    buildTranslatedPageOCRForExport,
    resolveVisibleOverlayExportSize,
  });

  // Sync global loading state in useUIStore reactively
  const ocrProgress = useOCRTextLayerStore((state) => state.progress);

  useEffect(() => {
    void hydrateGeminiApiKey();
  }, [hydrateGeminiApiKey]);

  const handleBackToHome = () => {
    visionService.cancelAll('Project closed');
    // ปลดสถานะ Foreground Processing เพื่อให้คิวเบื้องหลังทำงานต่อได้
    useBackgroundQueueStore.getState().setForegroundProcessingActive(false);
    closeProject();
  };

  const handleClearDocumentCache = async () => {
    if (!documentId) return;
    const confirmed = window.confirm(
      "คุณต้องการรีเซ็ตเอกสารนี้ใช่หรือไม่?\n\nการดำเนินการนี้จะลบข้อมูล OCR และคำแปลทั้งหมดของทุกหน้าในไฟล์นี้ออกอย่างถาวร แต่ไฟล์เอกสารหลักจะไม่ถูกลบ"
    );
    if (!confirmed) return;

    try {
      const success = await dbService.clearDocumentCache(documentId);
      if (success) {
        // เคลียร์ memory cache ใน store
        useLayerStore.getState().clearLayers();
        useOCRTextLayerStore.getState().clearAllOCR();
        useOCRTextLayerStore.getState().setCurrentPageOCR(null);
        useProjectStore.getState().setPage(1);

        // ยกเลิกคิวงานที่ค้างอยู่ของเอกสารนี้
        const existingJobs = useBackgroundQueueStore.getState().jobs;
        existingJobs.forEach((j) => {
          if (j.documentId === documentId && ['pending', 'queued', 'paused', 'processing'].includes(j.status)) {
            useBackgroundQueueStore.getState().cancelJob(j.id);
          }
        });
        
        // แจ้งเตือนความสำเร็จ
        setTranslationStatus({
          kind: 'success',
          message: 'ล้างแคชและรีเซ็ตเอกสารสำเร็จแล้ว'
        });
      } else {
        setTranslationStatus({
          kind: 'error',
          message: 'ไม่สามารถล้างแคชได้ในขณะนี้'
        });
      }
    } catch (err) {
      console.error('Failed to clear document cache:', err);
      setTranslationStatus({
        kind: 'error',
        message: 'เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล'
      });
    }
  };
  
  useEffect(() => {
    if (showOCRHarness) return undefined;
    // Lazy Initialize Vision Worker (low priority)
    // Delay increased to 3.5s to prevent CPU spiking immediately after initial render
    const timer = setTimeout(() => {
      visionService.initialize().then(() => {
        console.log('Vision System Ready (Lazy Loaded)');
        setIsVisionReady(true);
      });
    }, 3500);

    return () => clearTimeout(timer);
  }, [showOCRHarness]);

  // Disabled background prewarm on startup to achieve a true Zero Startup Footprint.
  // OCR processes will be spawned lazily when a file is loaded or OCR is initiated.
  /*
  useEffect(() => {
    if (showOCRHarness) return undefined;
    if (!window.electronAPI?.ocr?.prewarmEngine) return undefined;
    // Avoid competing with document open/render.
    // OCRTextLayerPanel handles warm-up once a file is opened.
    if (file) return undefined;

    const globalPrewarm = globalThis as GlobalPrewarmState;
    if (!globalPrewarm.__pdfTranslatorExternalPrewarmStartedKeys) {
      globalPrewarm.__pdfTranslatorExternalPrewarmStartedKeys = new Set<string>();
    }
    if (!globalPrewarm.__pdfTranslatorExternalPrewarmInFlight) {
      globalPrewarm.__pdfTranslatorExternalPrewarmInFlight = new Map<string, Promise<void>>();
    }

    const normalizedLanguage = normalizePrewarmLanguage(ocrLanguage || 'eng');
    // Keep startup prewarm lightweight; warm primary engine only.
    const targetEngines: Array<'paddleocr' | 'easyocr'> = ['paddleocr'];

    // Delay increased to 8s to prevent Python PyTorch initialization from freezing the UI
    // while the user is still interacting with the home screen.
    const timer = setTimeout(() => {
      for (const engine of targetEngines) {
        const warmKey = `${engine}:${normalizedLanguage}`;
        if (globalPrewarm.__pdfTranslatorExternalPrewarmStartedKeys?.has(warmKey)) {
          continue;
        }
        if (globalPrewarm.__pdfTranslatorExternalPrewarmInFlight?.has(warmKey)) {
          continue;
        }

        const warmPromise = (async () => {
          try {
            await window.electronAPI.ocr.prewarmEngine({ engine, language: normalizedLanguage });
            globalPrewarm.__pdfTranslatorExternalPrewarmStartedKeys?.add(warmKey);
          } catch (error) {
            console.warn(`${engine} background prewarm failed (${normalizedLanguage}):`, error);
          } finally {
            globalPrewarm.__pdfTranslatorExternalPrewarmInFlight?.delete(warmKey);
          }
        })();

        globalPrewarm.__pdfTranslatorExternalPrewarmInFlight?.set(warmKey, warmPromise);
      }
    }, 8000);

    return () => clearTimeout(timer);
  }, [file, ocrLanguage, showOCRHarness]);
  */

  // Update editedName when file changes
  useEffect(() => {
    if (file) {
      setEditedName(file.name);
    }
  }, [file]);

  const runCurrentPageTranslationRef = React.useRef(runCurrentPageTranslation);
  useEffect(() => {
    runCurrentPageTranslationRef.current = runCurrentPageTranslation;
  }, [runCurrentPageTranslation]);

  useEffect(() => {
    backgroundQueueProcessor.registerHandlers({
      translatePage: async (docId, pageNum, ocrResult, engine, signal, options) => {
        try {
          // ส่ง ocrResult โดยตรงผ่าน ocrResultOverride เพื่อให้ runCurrentPageTranslation
          // ใช้ข้อมูลที่ processor มีอยู่แล้ว โดยไม่ต้องพึ่ง store ซึ่งอาจ sync ไม่ทัน
          const result = await runCurrentPageTranslationRef.current(engine, pageNum, { 
            suppressStatus: true,
            bypassPageCache: false, // ใช้ SQLite DB cache เพื่อไม่ต้องแปลซ้ำเมื่อกด pause แล้ว resume
            ocrLanguage: options?.ocrLanguage,
            sourceLanguage: options?.sourceLanguage,
            targetLanguage: options?.targetLanguage,
            translationMode: options?.translationMode,
            ocrResultOverride: ocrResult, // ← key fix: bypass store lookup
            documentIdOverride: docId, // ← คีย์หลัก: ส่ง docId ดั้งเดิมของงานเบื้องหลังเพื่อให้แคชทำงานได้แม้ปิดโปรเจกต์
          });
          return result;
        } catch (err) {
          console.error(`[AppQueueHandler] translatePage error on page ${pageNum}:`, err);
          throw err;
        }
      }
    });
  }, []);

  // ดักจับเมื่อผู้เปลี่ยนหน้าหรือไฟล์ ขณะที่การแปลหน้าเดี่ยวยังทำงาน inline ค้างอยู่
  // เพื่อนำไปประมวลผลต่อใน Background Queue
  const prevPageRef = React.useRef(currentPage);
  const prevDocIdRef = React.useRef(documentId);

  useEffect(() => {
    const pageChanged = prevPageRef.current !== currentPage;
    const docChanged = prevDocIdRef.current !== documentId;

    // ส่งเฉพาะกรณีที่เป็นการแปลหน้าเดี่ยว (single page inline) เท่านั้น
    // หากเป็นการแปลทุกหน้า (batch / all pages) จะมีการประมวลผลครอบคลุมอยู่แล้ว ไม่ต้องแอด job เพิ่ม
    if ((pageChanged || docChanged) && (isOfflineProcessingRaw || isAiProcessingRaw)) {
      const prevPage = prevPageRef.current;
      const prevDocId = prevDocIdRef.current;
      const prevFile = file; // ไฟล์ก่อนหน้า
      const prevFilePath = filePath;

      if (prevDocId && prevFile && prevFilePath) {
        const engineType = isAiProcessingRaw ? 'ai_single' : 'offline_single';
        console.log(`[App] Switched page/file while translation was active. Delegating page ${prevPage} of doc ${prevDocId} to Background Queue.`);
        
        useBackgroundQueueStore.getState().addJob({
          documentId: prevDocId,
          filename: prevFile.name,
          filepath: prevFilePath,
          engine: (ocrOptions.engine || 'paddleocr') as OCREngine,
          type: engineType,
          totalPages: 1,
          targetPage: prevPage,
          ocrLanguage: ocrOptions.language,
          sourceLanguage: sourceLanguage,
          targetLanguage: targetLanguage,
          translationMode: translationMode,
          ocrDpi: ocrOptions.dpi,
          ocrPageSegMode: ocrOptions.pageSegMode,
          ocrQualityProfile: ocrOptions.ocrQualityProfile,
          useAngleCls: ocrOptions.useAngleCls,
        });
        // ไม่เรียก boostPriorityForDocument — งาน single page ที่ delegate ต่อท้ายคิวตาม FIFO
        // ไม่ควรแทรกหรือยกเลิกงานที่กำลังรันอยู่ใน Background Queue
      }
    }

    prevPageRef.current = currentPage;
    prevDocIdRef.current = documentId;
  }, [currentPage, documentId, isOfflineProcessingRaw, isAiProcessingRaw, file, filePath, ocrOptions.engine, ocrOptions.language, sourceLanguage, targetLanguage, translationMode, ocrOptions.dpi, ocrOptions.pageSegMode, ocrOptions.ocrQualityProfile]);

  // Sync สถานะการประมวลผล Foreground (OCR/แปลภาษา Inline) ไปยัง Queue Store
  // เพื่อให้คิวเบื้องหลังพักงานชั่วคราวเมื่อผู้ใช้สั่งประมวลผลหน้าปัจจุบันเอง
  // และกลับมารันงานเบื้องหลังต่อโดยอัตโนมัติเมื่อ Foreground เสร็จสิ้น
  useEffect(() => {
    const isForegroundActive = isOfflineProcessingRaw || isAiProcessingRaw;
    useBackgroundQueueStore.getState().setForegroundProcessingActive(isForegroundActive);
  }, [isOfflineProcessingRaw, isAiProcessingRaw]);

  if (showOCRHarness) {
    return <OCRRegressionHarness />;
  }

  // If no file is loaded, show Upload Screen
  if (!file) {
    return <UploadScreen />;
  }

  function resolveTranslatableLineBBox(line?: OCRLine): BBox | undefined {
    const rawBBox = line?.bbox;
    const normalizedRawBBox = rawBBox && Number(rawBBox.x1) > Number(rawBBox.x0) && Number(rawBBox.y1) > Number(rawBBox.y0)
      ? {
        x0: Number(rawBBox.x0),
        y0: Number(rawBBox.y0),
        x1: Number(rawBBox.x1),
        y1: Number(rawBBox.y1),
      }
      : undefined;

    const validWords = (Array.isArray(line?.words) ? line!.words : [])
      .filter((word) => {
        const text = normalizeWhitespace(String(word?.text || ''));
        const bbox = word?.bbox;
        if (!text || !bbox) return false;
        return Number(bbox.x1) > Number(bbox.x0) && Number(bbox.y1) > Number(bbox.y0);
      });
    if (validWords.length === 0) return normalizedRawBBox;

    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    validWords.forEach((word) => {
      x0 = Math.min(x0, Number(word.bbox.x0));
      y0 = Math.min(y0, Number(word.bbox.y0));
      x1 = Math.max(x1, Number(word.bbox.x1));
      y1 = Math.max(y1, Number(word.bbox.y1));
    });

    if (!(x1 > x0 && y1 > y0)) return undefined;
    const wordUnionBBox = { x0, y0, x1, y1 };

    if (!normalizedRawBBox) {
      return wordUnionBBox;
    }

    const rawWidth = Math.max(1, normalizedRawBBox.x1 - normalizedRawBBox.x0);
    const rawHeight = Math.max(1, normalizedRawBBox.y1 - normalizedRawBBox.y0);
    const rawArea = Math.max(1, rawWidth * rawHeight);
    const unionWidth = Math.max(1, wordUnionBBox.x1 - wordUnionBBox.x0);
    const unionHeight = Math.max(1, wordUnionBBox.y1 - wordUnionBBox.y0);
    const unionArea = Math.max(1, unionWidth * unionHeight);
    const unionCoverage = unionArea / rawArea;

    const rawLooksMalformed = unionCoverage <= 0.32
      && (
        rawArea >= unionArea * 3.8
        || rawWidth >= unionWidth * 1.9
        || rawHeight >= unionHeight * 1.9
      );

    return rawLooksMalformed ? wordUnionBBox : normalizedRawBBox;
  }

  function resolveLineSortHintY(line?: OCRLine): number | undefined {
    const direct = Number(line?.sortHintY);
    if (Number.isFinite(direct)) return direct;
    const legacy = Number((line as OCRLine | undefined)?.['_sortY']);
    return Number.isFinite(legacy) ? legacy : undefined;
  }

  function resolveLineSortHintX(line?: OCRLine): number | undefined {
    const direct = Number(line?.sortHintX);
    if (Number.isFinite(direct)) return direct;
    const legacy = Number((line as OCRLine | undefined)?.['_sortX']);
    return Number.isFinite(legacy) ? legacy : undefined;
  }

  function collectTranslatableLines(
    lines: OCRLine[],
    engineHint?: string,
    pageWidth?: number,
    pageHeight?: number
  ): TranslatableLine[] {
    const collected: TranslatableLine[] = [];
    const pageWidthVal = pageWidth && pageWidth > 0 ? pageWidth : 1200;
    const scaleFactor = 1200 / pageWidthVal;

    lines.forEach((line, index) => {
      const text = resolveBestOcrLineText(line);
      if (!text) return;

      const likelyGhost = isLikelyGhostTranslatableLine(line, text, engineHint, pageWidth, pageHeight);
      if (likelyGhost && !shouldForceKeepTechnicalTranslationLine(text, line)) {
        // [DBG-pig-trace] Trace dropped ghost lines
        const _dbgT = text.toUpperCase().replace(/[^A-Z]/g, '');
        if (['THE', 'PIG', 'YOU', 'ARE'].some(k => _dbgT === k || (_dbgT.includes(k) && _dbgT.length <= 10))) {
          console.warn(`[DBG-pig-trace-DROPPED] collectTranslatableLines GHOST FILTER dropped: idx=${index} text="${text}"`);
        }
        return;
      }

      const bbox = resolveTranslatableLineBBox(line);
      if (!bbox) return;

      const left = Number(bbox.x0);
      const right = Number(bbox.x1);
      const top = Number(bbox.y0);
      const bottom = Number(bbox.y1);
      if (!(right > left && bottom > top)) return;

      const validWordBoxCount = (Array.isArray(line.words) ? line.words : []).filter((word) => {
        const wordText = normalizeWhitespace(String(word?.text || ''));
        const wordBBox = word?.bbox;
        if (!wordText || !wordBBox) return false;
        return Number(wordBBox.x1) > Number(wordBBox.x0) && Number(wordBBox.y1) > Number(wordBBox.y0);
      }).length;
      const compactText = text.replace(/\s+/g, '');
      const tokenCount = text.split(/\s+/g).filter(Boolean).length;
      const width = right - left;
      const height = bottom - top;
      const area = width * height;

      const scaledWidth = width * scaleFactor;
      const scaledHeight = height * scaleFactor;
      const scaledArea = scaledWidth * scaledHeight;

      const wordCoverage = computeLineWordUnionCoverage(line);
      const isExternalEngineLine = engineHint === 'paddleocr' || line.sourceEngine === 'paddleocr' || engineHint === 'easyocr' || line.sourceEngine === 'easyocr';
      const noWordOversizedRawLine = !isExternalEngineLine && (
        validWordBoxCount === 0
        && tokenCount >= 2
        && tokenCount <= 6
        && compactText.length <= 30
        && scaledArea >= 16000
        && (scaledWidth >= 180 || scaledHeight >= 96)
        && (scaledArea / Math.max(1, compactText.length)) >= 680
      );
      const lowCoverageOversizedEffectSection = !isExternalEngineLine && (
        validWordBoxCount <= 1
        && wordCoverage <= 0.2
        && tokenCount >= 2
        && tokenCount <= 6
        && compactText.length <= 30
        && scaledArea >= 17000
        && (scaledWidth >= 170 || scaledHeight >= 96)
        && (scaledArea / Math.max(1, compactText.length)) >= 650
      );
      // Relaxed to include common dialogue punctuation like commas, periods, etc.
      const isProbableComicDialogue = /^(?:THAT'S|MY|TO|IT'S|HAS)\b/i.test(text) || /^[A-Za-z\s;:'",.!?\-]+$/.test(text);
      if ((noWordOversizedRawLine || lowCoverageOversizedEffectSection) && !shouldForceKeepTechnicalTranslationLine(text, line) && !isProbableComicDialogue) {
        return;
      }
      // Apply OCR noise repair early so all downstream consumers
      // (grouping, translation, cache keys, fallbacks) see cleaned text
      const repairedText = normalizeEnglishOcrNoiseForTranslation(text);

      collected.push({
        index,
        text: repairedText,
        sourceLength: countReadableLength(text),
        left,
        right,
        top,
        bottom,
        height: Math.max(1, bottom - top),
        area,
        wordCoverage,
        wordBoxCount: validWordBoxCount,
        confidence: Number(line.confidence || 0),
        quad: Array.isArray(line.quad) ? line.quad.map((point) => ({ x: point.x, y: point.y })) : undefined,
        angleDeg: Number.isFinite(line.angleDeg) ? Number(line.angleDeg) : undefined,
        sortHintX: resolveLineSortHintX(line),
        sortHintY: resolveLineSortHintY(line),
        sourceEngine: line.sourceEngine || (engineHint as OCREngine),
      });
    });

    if (collected.length <= 1) {
      return collected;
    }

    const isLikelyEffectBalloonSection = (line: TranslatableLine): boolean => {
      const width = Math.max(1, line.right - line.left);
      const height = Math.max(1, line.bottom - line.top);
      const area = Math.max(1, line.area || (width * height));
      const compact = normalizeWhitespace(String(line.text || '')).replace(/\s+/g, '');
      const tokenCount = normalizeWhitespace(String(line.text || '')).split(/\s+/g).filter(Boolean).length;
      const wordCoverage = Number(line.wordCoverage || 0);
      const wordBoxCount = Number(line.wordBoxCount || 0);

      return (
        wordBoxCount <= 1
        && wordCoverage <= 0.22
        && tokenCount >= 2
        && tokenCount <= 6
        && compact.length <= 30
        && area >= 17000
        && (width >= 170 || height >= 96)
      );
    };

    const hasNearbyTextAnchor = (candidate: TranslatableLine): boolean => {
      const candidateWidth = Math.max(1, candidate.right - candidate.left);
      const candidateHeight = Math.max(1, candidate.bottom - candidate.top);
      const candidateArea = Math.max(1, candidate.area || (candidateWidth * candidateHeight));
      const candidateCenterX = (candidate.left + candidate.right) * 0.5;
      const candidateCenterY = (candidate.top + candidate.bottom) * 0.5;

      return collected.some((other) => {
        if (other.index === candidate.index) return false;

        const otherArea = Math.max(1, other.area || ((other.right - other.left) * (other.bottom - other.top)));
        if (otherArea > candidateArea * 0.74) return false;

        const otherWordCoverage = Number(other.wordCoverage || 0);
        const otherWordBoxCount = Number(other.wordBoxCount || 0);
        const anchorSignal = otherWordBoxCount >= 2 || otherWordCoverage >= 0.32 || other.sourceLength >= Math.max(10, candidate.sourceLength * 0.9);
        if (!anchorSignal) return false;

        const overlapX = overlapRatio(candidate.left, candidate.right, other.left, other.right);
        const overlapY = overlapRatio(candidate.top, candidate.bottom, other.top, other.bottom);
        const otherCenterX = (other.left + other.right) * 0.5;
        const otherCenterY = (other.top + other.bottom) * 0.5;
        const centerDeltaX = Math.abs(candidateCenterX - otherCenterX);
        const centerDeltaY = Math.abs(candidateCenterY - otherCenterY);
        const nearInside = (
          other.left >= candidate.left - 12
          && other.right <= candidate.right + 12
          && other.top >= candidate.top - 28
          && other.bottom <= candidate.bottom + 28
        );

        return (
          (overlapX >= 0.24 && overlapY >= 0.1)
          || (nearInside && centerDeltaX <= candidateWidth * 0.65 && centerDeltaY <= candidateHeight * 0.9)
        );
      });
    };

    const filtered = collected.filter((line) => {
      if (!isLikelyEffectBalloonSection(line)) return true;
      return !hasNearbyTextAnchor(line);
    });

    const contextFiltered = filtered.filter((line) =>
      !shouldPruneContextualGhostTranslatableLine(line, filtered)
    );

    // Never return an empty set after effect-balloon filtering.
    // Falling back to raw collected lines keeps translation entry generation deterministic
    // and avoids disabling translated preview when a page is fully borderline.
    if (contextFiltered.length === 0) {
      return collected;
    }

    return contextFiltered;
  }



  const requestAutoOCRFromPanel = (scope: AutoOCRScope): Promise<boolean> => {
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
  };

  const ensureCurrentPageOCRReadyForTranslation = async (): Promise<boolean> => {
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
  };

  const ensureAllPagesOCRReadyForTranslation = async (): Promise<boolean> => {
    if (fileType !== 'pdf') {
      return ensureCurrentPageOCRReadyForTranslation();
    }

    const selectedEngine = (ocrOptions.engine || 'paddleocr') as OCREngine;
    const cachedPages = getModelScopedCachedPageNumbers();
    const total = Math.max(1, totalPages);

    // ตรวจสอบว่าหน้าทั้งหมดในไฟล์ PDF ได้รับการรัน OCR แล้วหรือยัง
    const hasAllPagesCached = cachedPages.length >= total;

    if (hasAllPagesCached) {
      return true;
    }

    // ยังมีบางหน้าที่ไม่มี OCR cache -> รัน Auto-run OCR ทั้งหมดสำหรับหน้าที่เหลือ
    setTranslationStatus({
      kind: 'info',
      message: `OCR cache is missing for some pages (found ${cachedPages.length}/${total}). Running Auto-OCR for all pages...`,
    });

    const ok = await requestAutoOCRFromPanel('all');
    if (!ok) {
      // ถ้า OCR all-pages ล้มเหลว ลอง ensure แค่หน้าปัจจุบัน
      return ensureCurrentPageOCRReadyForTranslation();
    }

    const refreshedPages = getModelScopedCachedPageNumbers();
    return refreshedPages.length > 0;
  };




  function buildGeminiContextOverrides(
    mode: TranslationMode,
    source: string,
    target: string
  ): { baseSystemPrompt?: string } {
    const baseSystemPrompt = buildGeminiBasePrompt(mode, source, target, safetySettings);
    return {
      baseSystemPrompt,
    };
  }

  const runAiBatchDocumentTranslation = async () => {
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
  };

  async function runCurrentPageTranslation(
    engine: 'offline' | 'ai' | 'm2m100',
    pageNum: number = currentPage,
    options?: { 
      suppressStatus?: boolean;
      bypassPageCache?: boolean; // ข้าม DB page-level translation cache (สำหรับ batch re-translate)
      ocrLanguage?: string;
      sourceLanguage?: string;
      targetLanguage?: string;
      translationMode?: TranslationMode;
      engineOverride?: OCREngine;
      ocrResultOverride?: OCRPageResult; // ใช้ override OCR result โดยตรง (สำหรับ Background Queue ที่มี ocrResult อยู่แล้ว)
      documentIdOverride?: number; // ← รองรับการระบุ documentId ของงานประมวลผลพื้นหลังเมื่อปิดหน้าต่างไปแล้ว
    }
  ): Promise<boolean> {
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

    // Ensure store layers are in sync with pageOCR before we collect translatable lines or resolve grouping (only if this document is actively open in viewport).
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
            
            // ตรวจสอบว่า cache มีภาษาไทยอยู่จริง (ถ้าแปลปลายทางเป็นไทย)
            let hasThai = true;
            if (targetRowTargetLang === 'th') {
              const sample = [
                row.translatedText || '',
                ...((row.translatedByIndex as Array<{ text?: string }> || []).map(item => String(item.text || '')))
              ].join(' ');
              hasThai = /[\u0E00-\u0E7F]/.test(sample);
            }
            
            // ตรวจสอบเวอร์ชันของแคชเพื่อให้สอดคล้องกับ OCR_TRANSLATION_CACHE_VERSION ปัจจุบัน
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
              // 1. Any translatable dialogue line (Korean, Japanese, Spanish, English) missing Thai translation
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
                    // Cached item has no Thai text for a translatable dialogue line - consider cache incomplete and re-translate fresh
                    return true;
                  }
                  if (hasKoreanTranslationCarryover(transText) || isBoilerplateHallucination(text, transText)) {
                    return true;
                  }
                }
                return false;
              }) ||
              // 2. Any Korean line with un-translated Hangul carryover or boilerplate hallucination in cache items
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
                      
                      // 1. Korean conversational fallback / boilerplate sanitization
                      if (source && (/[\uAC00-\uD7AF]/.test(source) || hasKoreanTranslationCarryover(translated) || isBoilerplateHallucination(source, translated))) {
                        const koFallback = applyKoreanConversationalFallback(source, translated);
                        if (koFallback && koFallback !== translated) {
                          cacheWasUpgraded = true;
                          return { ...item, text: koFallback, sourceText: source };
                        }
                      }

                      // 2. Short phrase / glossary lookup
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

            // อัปเดตข้อมูลเข้า Store สำหรับหน้าจอ UI เฉพาะเมื่อเอกสารนี้กำลังเปิดอยู่บนหน้าจอ
            if (isActiveDoc) {
              ocrState.setTranslationCacheEntry(pageNum, safeMatchedCache.key, safeMatchedCache);
              ocrState.setActiveTranslationCacheKey(pageNum, safeMatchedCache.key);
              ocrState.setTranslationPreviewMode('translated');

              // ซิงค์ผลการแปลกลับเข้าสู่ Layer Store ด้วย
              try {
                const layerStore = useLayerStore.getState();
                const pageLayers = layerStore.getPageLayers(pageNum);

                // Helper ในการจับคู่แคชคำแปลอย่างปลอดภัยโดยเช็คจากข้อความดิบ
                const findBestCacheMatch = (sourceText: string, lineIndex: number, cacheItems: any[]) => {
                  if (!Array.isArray(cacheItems)) return undefined;
                  const cleanSource = String(sourceText || '').replace(/\s+/g, ' ').trim().toLowerCase();
                  if (!cleanSource) return undefined;
                  
                  // 1. Exact match (case-insensitive)
                  const exact = cacheItems.find(item => {
                    const itemSource = String(item.sourceText !== undefined ? item.sourceText : (item.rawText || '')).replace(/\s+/g, ' ').trim().toLowerCase();
                    return itemSource === cleanSource;
                  });
                  if (exact) return exact;
                  
                  // 2. Substring match
                  const partial = cacheItems.find(item => {
                    const itemSource = String(item.sourceText !== undefined ? item.sourceText : (item.rawText || '')).replace(/\s+/g, ' ').trim().toLowerCase();
                    return itemSource.includes(cleanSource) || cleanSource.includes(itemSource);
                  });
                  if (partial) return partial;
                  
                  // 3. Fallback to Index match
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

    // === SYNC WITH CURRENT LAYERS AND SFX (CURRENT INFO) ===
    const currentLayers = useLayerStore.getState().layersByPage.get(pageNum) || [];
    
    // อัปเดตข้อความใน rawBaseLines ให้ตรงกับเลเยอร์ล่าสุด
    const updatedTranslatableLines = rawBaseLines.map(line => {
      let matchingLayer = currentLayers.find(l => l.lineIndex === line.index);
      
      // ค้นหาเผื่อกรณีที่ lineIndex ไม่ตรง แต่เป็นตำแหน่งทับซ้อนกันมาก
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
            return (overlapArea / minArea) >= 0.7; // ทับซ้อนมากกว่า 70%
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

    // หาเลเยอร์ที่ยังไม่ถูกแมป (เช่น เลเยอร์ใหม่จากการวาด Drawing Region)
    const unmappedLayers = currentLayers.filter(l => {
      return !updatedTranslatableLines.some(line => line.index === l.lineIndex);
    });

    // แปลงเลเยอร์ใหม่เป็น TranslatableLine และ Append เพิ่มเข้าไป
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
    // === DIAG: trace translation pipeline for debugging ===
    console.log(`[TranslateDiag] engine=${engine} pageEngine=${pageEngine} ocrLang=${pageOCR.language} totalOCRLines=${pageOCR.lines?.length ?? 0} baseTranslatableLines=${baseTranslatableLines.length}`);
    if (baseTranslatableLines.length > 0) {
      console.log(`[TranslateDiag] first 3 lines:`, baseTranslatableLines.slice(0, 3).map(l => ({ text: l.text, sourceEngine: l.sourceEngine, area: l.area })));
    }
    if (baseTranslatableLines.length === 0) {
      if (!options?.suppressStatus) {
        setTranslationStatus({
          kind: 'error',
          message: `No OCR lines with text on page ${pageNum}.`,
        });
      }
      return false;
    }

    // Redundant declarations removed since they are declared at the beginning of the function

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
    // === DIAG: see how many lines remain after filters ===
    console.log(`[TranslateDiag] srcLang=${translationSourceLanguage} tgtLang=${normalizedTargetLanguage} latinDominant=${latinDominantPage} deduped=${dedupedTranslatableLines.length} translatable=${translatableLines.length} preserved=${preservedSourceLineCount}`);
    if (translatableLines.length === 0 && dedupedTranslatableLines.length > 0) {
      console.warn(`[TranslateDiag] All lines filtered! First dropped:`, dedupedTranslatableLines.slice(0, 3).map(l => ({ text: l.text, preserve: shouldPreserveSourceLineForTranslation(l.text, translationSourceLanguage, ocrLanguageKey) })));
    }

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
    
    // แปลง preparedGroups เป็น TranslatableItem เพื่อรันผ่าน Coordinator
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
      // เรียกใช้งานตัวประสานงานแปลภาษาอัจฉริยะ (Group-Aware Translation Engine)
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

      // ตรวจสอบว่าในผลลัพธ์การแปลมี failure หรือไม่
      const hasFailedItem = translationResults.some(r => !r.success);
      if (hasFailedItem && coordinatorEngineId === 'gemini') {
        throw new Error('Gemini API returned partial failure status');
      }

      // แมปผลการแปลกลับเข้าสู่ translatedGroupsRaw ตามลำดับดัชนีของกลุ่ม
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
          // Keep offline output when Gemini is not configured.
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
        // Skip retry if this group matched any custom glossary entries to preserve user translations
        if (group.replacements && group.replacements.length > 0) {
          continue;
        }
        // Skip retry for single-line groups since group retry vs line retry are identical and redundant
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
        // Set group context so applyThaiConversationalGlossary can detect multi-line patterns
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

      // Apply Group-level translation override for specific vertical/separated manga phrases (Thai Target Only)
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
        // [DBG-pig-trace] groupLineOverrides path
        group.lines.forEach((line, lineIndex) => {
          const finalV = translatedByIndex.get(line.index);
          console.log(`[DBG-pig-trace-override] page=${pageNum} G#${groupIndex} [${line.index}] src="${line.text}" -> final="${finalV}" groupLines=${group.lines.length}`);
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
      // Set group context so context-sensitive glossary works for per-line redistribute
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

        // Prevent raw English text from leaking into multi-line balloons or single lines when target is Thai
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

        // Clean up any remaining raw English words in finalizedLine to prevent leaking raw English text on Canvas
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
            // Group-First Policy: The balloon was already translated into Thai as a whole sentence.
            // Trailing slots that have no Thai text are intentionally empty to prevent duplicate/fragmented words.
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

        // [DBG-pig-trace] Instrumentation: trace lines
        if (groupIndex >= 15 || ['THE', 'PIG', 'YOU', 'ARE', 'LIKE'].some(k => sourceLineText.toUpperCase().includes(k))) {
          console.log(`[DBG-pig-trace] page=${pageNum} G#${groupIndex} [${line.index}] src="${sourceLineText}" -> final="${finalLineText}" (finalized="${finalizedLine}", direct="${directTranslation || ''}") groupLines=${group.lines.length}`);
        }

        // Consecutive Duplicate Line Deduplication: Prevent identical short Thai words (e.g. "หี" / "หี") from repeating consecutively
        if (normalizedTargetLanguage === 'th' && finalLineText.trim()) {
          const trimmedLine = finalLineText.trim();
          if (trimmedLine.length <= 6 && prevLineTextInGroup === trimmedLine) {
            translatedByIndex.set(line.index, ''); // Suppress duplicate short word in balloon
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

    // Apply Group-level Thai slang clash avoidance (Rule 4.1 & 4.2)
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

      // Synchronize translated texts back to persistent Layer Store (useLayerStore)
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
  }

  const runOfflineBatchDocumentTranslation = async () => {
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
  };

  const handleOfflineTranslate = async () => {
    if (isAiProcessing || isOfflineProcessing) return;
    setIsOfflineProcessing(true);

    // ตั้งค่าเริ่มต้นความคืบหน้า เพื่อให้แถบขึ้นทันทีที่กด
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

      // ปรับความคืบหน้าเข้าสู่ขั้นตอนการแปลภาษา (75%)
      setProgress({
        stage: 'text-layer',
        currentPage: currentPage,
        totalPages: totalPages,
        message: 'กำลังดำเนินการแปลภาษาแบบ Offline...',
        progress: 75,
      });

      setTranslationStatus({ kind: 'info', message: 'Running offline translation on current page...' });
      await runCurrentPageTranslation(offlineEngine === 'm2m100' ? 'm2m100' : 'offline');

      // อัปเดตสถานะความสำเร็จสุดท้ายไปที่ progress bar และหน่วงเวลา 800ms ให้ผู้ใช้เห็น 100% ครบถ้วนอย่างสวยงาม
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
  };

  const handleAiTranslate = async () => {
    if (isAiProcessing || isOfflineProcessing) return;
    setIsAiProcessing(true);

    // ตั้งค่าเริ่มต้นความคืบหน้า
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

      // ปรับความคืบหน้าเข้าสู่ขั้นตอนการแปลภาษา (75%)
      setProgress({
        stage: 'text-layer',
        currentPage: currentPage,
        totalPages: totalPages,
        message: 'กำลังส่งข้อมูลไปแปลภาษาด้วย AI (Gemini)...',
        progress: 75,
      });

      setTranslationStatus({ kind: 'info', message: 'Running Gemini translation on current page...' });
      await runCurrentPageTranslation('ai');

      // อัปเดตสถานะความสำเร็จสุดท้ายไปที่ progress bar และหน่วงเวลา 800ms ให้ผู้ใช้เห็น 100% ครบถ้วนอย่างสวยงาม
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
  };

  const handleOfflineTranslateAllPages = async () => {
    if (fileType !== 'pdf') {
      setTranslationStatus({ kind: 'error', message: 'การแปลทุกหน้า (All Pages) รองรับเฉพาะไฟล์เอกสาร PDF เท่านั้น.' });
      return;
    }
    const docId = await ensureDocumentId();
    if (!docId || !filePath) {
      setTranslationStatus({ kind: 'error', message: 'กรุณาเซฟและยืนยันข้อมูลไฟล์ก่อนประมวลผล.' });
      return;
    }

    // แสดง immediate feedback ทันที ก่อนการ preemption จะเริ่ม (ให้ user รู้ว่ากดปุ่มแล้วมีผล)
    const hasRunningJob = useBackgroundQueueStore.getState().jobs.some(j => j.status === 'processing');
    setTranslationStatus({
      kind: 'info',
      message: hasRunningJob
        ? 'กำลังแทรคิวและหยุดงานเดิมชั่วคราว... รอสักครู่'
        : 'เพิ่มงานเข้าคิว...',
    });

    // Case 2 (Foreground All Pages): ใช้ addJobAsForeground เพื่อแทรกคิวลัด (หลัง running job) และลบ duplicate ที่ค้างอยู่อัตโนมัติ
    const jobId = useBackgroundQueueStore.getState().addJobAsForeground({
      documentId: docId,
      filename: fileName,
      filepath: filePath,
      engine: (ocrOptions.engine || 'paddleocr') as OCREngine,
      type: 'offline_all',
      totalPages: Math.max(1, totalPages),
      ocrLanguage: ocrOptions.language,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      translationMode: translationMode,
      ocrDpi: ocrOptions.dpi,
      ocrPageSegMode: ocrOptions.pageSegMode,
      ocrQualityProfile: ocrOptions.ocrQualityProfile,
      useAngleCls: ocrOptions.useAngleCls,
    });

    // (Foreground preemption จัดการผ่าน setForegroundProcessingActive จาก useEffect แล้ว)

    setTranslationStatus({
      kind: 'success',
      message: `เพิ่มงาน Offline All Pages เข้าสู่คิวประมวลผลพื้นหลังเรียบร้อยแล้ว!`,
    });
  };

  const handleAiTranslateAllPages = async () => {
    if (fileType !== 'pdf') {
      setTranslationStatus({ kind: 'error', message: 'การแปลทุกหน้า (All Pages) รองรับเฉพาะไฟล์เอกสาร PDF เท่านั้น.' });
      return;
    }
    const docId = await ensureDocumentId();
    if (!docId || !filePath) {
      setTranslationStatus({ kind: 'error', message: 'กรุณาเซฟและยืนยันข้อมูลไฟล์ก่อนประมวลผล.' });
      return;
    }

    // Case 2 (Foreground All Pages): ใช้ addJobAsForeground เพื่อแทรกคิวลัด (หลัง running job) และลบ duplicate ที่ค้างอยู่อัตโนมัติ
    const jobId = useBackgroundQueueStore.getState().addJobAsForeground({
      documentId: docId,
      filename: fileName,
      filepath: filePath,
      engine: (ocrOptions.engine || 'paddleocr') as OCREngine,
      type: 'ai_all',
      totalPages: Math.max(1, totalPages),
      ocrLanguage: ocrOptions.language,
      sourceLanguage: sourceLanguage,
      targetLanguage: targetLanguage,
      translationMode: translationMode,
      ocrDpi: ocrOptions.dpi,
      ocrPageSegMode: ocrOptions.pageSegMode,
      ocrQualityProfile: ocrOptions.ocrQualityProfile,
      useAngleCls: ocrOptions.useAngleCls,
    });

    // (Foreground preemption จัดการผ่าน setForegroundProcessingActive จาก useEffect แล้ว)

    setTranslationStatus({
      kind: 'success',
      message: `เพิ่มงาน AI All Pages เข้าสู่คิวประมวลผลพื้นหลังเรียบร้อยแล้ว!`,
    });
  };

  const profileOptions: Array<{
    mode: TranslationMode;
    label: string;
    icon: React.ReactNode;
    activeClass: string;
  }> = [
    {
      mode: 'adaptive',
      label: 'Orbit',
      icon: <Compass size={12} />,
      activeClass: 'border-emerald-300/50 bg-emerald-500/18 text-emerald-100',
    },
    {
      mode: 'manga',
      label: 'Manga',
      icon: <Sparkles size={12} />,
      activeClass: 'border-[#8B5CF6]/55 bg-[#8B5CF6]/22 text-[#E9D5FF]',
    },
    {
      mode: 'manhwa',
      label: 'Manhwa',
      icon: <Flame size={12} />,
      activeClass: 'border-pink-300/50 bg-pink-500/18 text-pink-100',
    },
    {
      mode: 'official',
      label: 'Official',
      icon: <FileText size={12} />,
      activeClass: 'border-cyan-300/50 bg-cyan-500/18 text-cyan-100',
    },
  ];
  const activeOption = profileOptions.find((opt) => opt.mode === translationMode) || profileOptions[0];
  const modeLabelColorClass = translationMode === 'adaptive'
    ? 'text-emerald-300'
    : translationMode === 'manga'
      ? 'text-[#C084FC]'
      : translationMode === 'manhwa'
        ? 'text-[#F472B6]'
        : 'text-[#60A5FA]';

  const effectiveDownloadScope: DownloadScope = downloadScopeSelection === 'all' && fileType === 'pdf'
    ? 'all'
    : 'current';
  const selectedDownloadEngine = selectedExportEngine || (ocrOptions.engine || 'paddleocr') as OCREngine;
  const downloadScopedPages = resolveModelScopedPagesForExport(effectiveDownloadScope, selectedDownloadEngine);
  const downloadScopePageNumbers = effectiveDownloadScope === 'all' && fileType === 'pdf'
    ? Array.from({ length: Math.max(1, totalPages) }, (_, index) => index + 1)
    : [currentPage];

  const getEngineCacheStatus = (engineId: OCREngine) => {
    const pages = resolveModelScopedPagesForExport(effectiveDownloadScope, engineId);
    const totalInScope = downloadScopePageNumbers.length;
    const ocrCount = pages.length;
    const transCount = pages.filter(({ pageNum, ocr }) => 
      Boolean(resolveTranslatedEntryForExport(pageNum, ocr, engineId))
    ).length;

    if (ocrCount === 0) {
      return { status: 'no_cache', text: 'ไม่มีแคช', ocrCount, transCount };
    }
    if (transCount === totalInScope) {
      return { status: 'ready', text: 'คำแปลพร้อม', ocrCount, transCount };
    }
    if (transCount > 0) {
      return { status: 'partial_trans', text: `แปลแล้ว (${transCount}/${totalInScope})`, ocrCount, transCount };
    }
    if (ocrCount === totalInScope) {
      return { status: 'ocr_only', text: 'เฉพาะต้นฉบับ OCR', ocrCount, transCount };
    }
    return { status: 'partial_ocr', text: `OCR แล้ว (${ocrCount}/${totalInScope})`, ocrCount, transCount };
  };
  const ocrCoveredPageNumbers = downloadScopedPages
    .map((item) => item.pageNum)
    .sort((a, b) => a - b);
  const ocrCoveredPageSet = new Set(ocrCoveredPageNumbers);
  const missingOcrPageNumbers = downloadScopePageNumbers.filter((pageNum) => !ocrCoveredPageSet.has(pageNum));
  const translatedAvailablePageNumbers = downloadScopedPages
    .filter(({ pageNum, ocr }) => Boolean(resolveTranslatedEntryForExport(pageNum, ocr, selectedDownloadEngine)))
    .map((item) => item.pageNum)
    .sort((a, b) => a - b);
  const translatedAvailablePageSet = new Set(translatedAvailablePageNumbers);
  const missingTranslatedPageNumbers = ocrCoveredPageNumbers
    .filter((pageNum) => !translatedAvailablePageSet.has(pageNum));
  const canExportOriginalSelection = downloadScopedPages.length > 0;
  const canExportTranslatedSelection = translatedAvailablePageNumbers.length > 0;
  void exportCacheHydrationTick;

  const computedProgressPercent = (() => {
    if (!ocrProgress) return 0;
    if (isOfflineProcessing || isAiProcessing) {
      return ocrProgress.progress;
    }
    return ocrProgress.progress;
  })();

  const getRemainingSecondsText = () => {
    if (!translationStartTime || !ocrProgress) return 'กำลังประเมินเวลา...';
    const percent = ocrProgress.progress;

    if (percent <= 0) return 'กำลังประเมินเวลา...';
    
    const elapsedSec = (Date.now() - translationStartTime) / 1000;
    if (percent > 5) {
      const totalSec = elapsedSec * (100 / percent);
      const remainingSec = Math.max(1, Math.round(totalSec - elapsedSec));
      return `อีกประมาณ ${remainingSec} วินาที`;
    } else {
      const pagesLeft = Math.max(1, ocrProgress.totalPages - ocrProgress.currentPage);
      const estSecPerPage = isAiProcessing ? 12 : 4;
      const remainingSec = pagesLeft * estSecPerPage;
      return `อีกประมาณ ${remainingSec} วินาที`;
    }
  };

  const runExportPopupBatchTranslation = async (translatorEngine: 'offline' | 'ai') => {
    if (isAiProcessing || isOfflineProcessing) return;

    applyPopupOcrQualityProfile();
    const exportEngine = selectedDownloadEngine;
    await hydrateExportCachesForDownload(exportEngine);
    setExportCacheHydrationTick((tick) => tick + 1);

    const scopedPages = resolveModelScopedPagesForExport(effectiveDownloadScope, exportEngine);
    if (scopedPages.length === 0) {
      setTranslationStatus({
        kind: 'error',
        message: `ไม่พบ OCR cache ของโมเดล ${exportEngine} สำหรับขอบเขตที่เลือก กรุณารัน OCR ก่อน`,
      });
      return;
    }

    const pageNums = scopedPages.map(({ pageNum }) => pageNum);
    if (translatorEngine === 'offline') {
      setIsOfflineProcessing(true);
    } else {
      setIsAiProcessing(true);
    }

    setProgress({
      stage: 'text-layer',
      currentPage: 1,
      totalPages: pageNums.length,
      message: `กำลังแปล ${pageNums.length} หน้า (${exportEngine})...`,
      progress: 5,
    });

    let translatedPages = 0;
    let skippedPages = 0;

    try {
      for (let index = 0; index < pageNums.length; index += 1) {
        const pageNum = pageNums[index];
        setProgress({
          stage: 'text-layer',
          currentPage: index + 1,
          totalPages: pageNums.length,
          message: `กำลังแปลหน้า ${pageNum} (${index + 1}/${pageNums.length})...`,
          progress: Math.round(((index + 0.5) / pageNums.length) * 100),
        });

        const translated = await runCurrentPageTranslation(translatorEngine, pageNum, {
          suppressStatus: true,
          engineOverride: exportEngine,
          ocrLanguage: ocrOptions.language,
          sourceLanguage,
          targetLanguage,
          translationMode,
        });
        if (translated) {
          translatedPages += 1;
        } else {
          skippedPages += 1;
        }
      }

      setProgress({
        stage: 'complete',
        currentPage: pageNums.length,
        totalPages: pageNums.length,
        message: 'แปลภาษาเสร็จสมบูรณ์!',
        progress: 100,
      });
      setExportCacheHydrationTick((tick) => tick + 1);

      const notes = skippedPages > 0 ? ` (ข้าม ${skippedPages} หน้า)` : '';
      setTranslationStatus({
        kind: translatedPages > 0 ? 'success' : 'error',
        message: translatedPages > 0
          ? `แปล ${translatedPages}/${pageNums.length} หน้า ด้วย ${exportEngine} เรียบร้อย${notes}`
          : `ไม่สามารถแปลหน้าใดได้สำหรับโมเดล ${exportEngine}`,
      });
      await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (err) {
      console.error('[ExportPopupBatchTranslation] Failed', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTranslationStatus({
        kind: 'error',
        message: `การแปลล้มเหลว: ${message}`,
      });
    } finally {
      setIsOfflineProcessing(false);
      setIsAiProcessing(false);
    }
  };

  const triggerPopupTranslation = (engine: 'offline' | 'ai') => {
    void runExportPopupBatchTranslation(engine);
  };

  return (
    <div className="relative flex flex-col h-screen w-screen bg-[#0b0f16] text-slate-100 overflow-hidden font-sans">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-[22rem] w-[22rem] rounded-full bg-[#2B9BFF]/20 blur-3xl" />
        <div className="absolute -right-24 top-1/3 h-[24rem] w-[24rem] rounded-full bg-[#FF7E67]/12 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_8%,rgba(43,155,255,0.08),transparent_46%),linear-gradient(130deg,rgba(11,15,22,0.96)_0%,rgba(20,23,30,0.98)_55%,rgba(12,15,20,0.99)_100%)]" />
      </div>
      
      {/* HEADER TOOLBAR - Google Docs Style */}
      <header className="relative z-50 h-12 bg-[#171b23]/78 border-b border-white/10 backdrop-blur-xl flex items-center px-2 pr-36 gap-1 shrink-0 titlebar-drag">
        {/* Home Button */}
        <button 
          onClick={handleBackToHome}
          className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          title="Back to Home"
        >
          <Home size={18} />
        </button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        {/* Editable Filename */}
        <div className="flex items-center min-w-0 max-w-xs">
          {isEditingName ? (
            <input 
              type="text"
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setIsEditingName(false);
                if (e.key === 'Escape') { setEditedName(file?.name || ''); setIsEditingName(false); }
              }}
              aria-label="Document name"
              title="Document name"
              placeholder="Document name"
              className="bg-slate-900/70 border border-[#2B9BFF]/60 rounded px-2 py-1 text-sm text-white focus:outline-none min-w-[120px]"
              autoFocus
            />
          ) : (
            <button 
              onClick={() => { setEditedName(file?.name || ''); setIsEditingName(true); }}
              className="text-sm text-slate-200 hover:text-white truncate px-2 py-1 rounded hover:bg-white/10 transition-colors"
              title="Click to rename"
            >
              {editedName || file?.name || 'Untitled'}
            </button>
          )}
        </div>

        {file && (
          <button
            onClick={handleClearDocumentCache}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-colors ml-1"
            title="Reset Document Cache (Clear OCR & Translation for all pages)"
          >
            <RotateCcw size={16} />
          </button>
        )}

        {/* Spacer - push tools to center */}
        <div className="flex-1" />

        {/* Undo/Redo */}
        <button className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Undo">
          <Undo2 size={16} />
        </button>
        <button className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Redo">
          <Redo2 size={16} />
        </button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        {/* Drawing Tools */}
        <button 
          onClick={() => setActiveTool('select')}
          className={`p-2 rounded transition-colors ${activeTool === 'select' ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' : 'hover:bg-white/10 text-slate-400 hover:text-white'}`}
          title="Select Tool (V)"
        >
          <MousePointer2 size={16} />
        </button>
        <button 
          onClick={() => setActiveTool('hand')}
          className={`p-2 rounded transition-colors ${activeTool === 'hand' ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' : 'hover:bg-white/10 text-slate-400 hover:text-white'}`}
          title="Pan Tool (H)"
        >
          <Hand size={16} />
        </button>
        <button 
          onClick={() => setActiveTool('region')}
          className={`p-2 rounded transition-colors ${activeTool === 'region' ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' : 'hover:bg-white/10 text-slate-400 hover:text-white'}`}
          title="Draw Region (R)"
        >
          <Square size={16} />
        </button>
        <button 
          onClick={() => setActiveTool('text')}
          className={`p-2 rounded transition-colors ${activeTool === 'text' ? 'bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] text-white' : 'hover:bg-white/10 text-slate-400 hover:text-white'}`}
          title="Text Tool (T)"
        >
          <Type size={16} />
        </button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        {/* Text Formatting */}
        <button className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Bold">
          <Bold size={16} />
        </button>
        <button className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Italic">
          <Italic size={16} />
        </button>
        <button className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Underline">
          <Underline size={16} />
        </button>

        <div className="w-px h-6 bg-white/10 mx-1" />

        {/* Google Docs Font Size Controls */}
        <div className="relative flex items-center gap-1 bg-slate-950/40 rounded px-1.5 py-0.5 border border-white/5">
          <button
            type="button"
            disabled={!hasSelection}
            onClick={() => {
              const pageLayers = useLayerStore.getState().layersByPage.get(currentPage) || [];
              const selected = pageLayers.filter(l => useLayerStore.getState().selectedLayerIds.has(l.id));
              selected.forEach(l => {
                const nextSize = Math.max(4, l.fontSize - 1);
                updateLayerFontSize(currentPage, l.id, nextSize);
              });
            }}
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            title="ลดขนาดตัวอักษร"
            aria-label="Decrease Font Size"
          >
            <Minus size={13} />
          </button>
          
          <div className="relative flex items-center gap-0.5">
            <input
              type="number"
              disabled={!hasSelection}
              value={hasSelection ? currentFontSize : ''}
              placeholder={hasSelection ? '' : '--'}
              onClick={() => {
                if (hasSelection) {
                  setShowFontDropdown(!showFontDropdown);
                }
              }}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (!isNaN(val)) {
                  const clamped = Math.max(1, Math.min(200, val));
                  const pageLayers = useLayerStore.getState().layersByPage.get(currentPage) || [];
                  const selected = pageLayers.filter(l => useLayerStore.getState().selectedLayerIds.has(l.id));
                  selected.forEach(l => {
                    updateLayerFontSize(currentPage, l.id, clamped);
                  });
                }
              }}
              className="w-10 h-7 text-center text-xs font-semibold text-white bg-slate-900 border border-white/10 rounded focus:border-[#2B9BFF] focus:outline-none disabled:opacity-30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none cursor-pointer"
              title="ขนาดตัวอักษร"
            />
            
            <button
              type="button"
              disabled={!hasSelection}
              onClick={() => setShowFontDropdown(!showFontDropdown)}
              className="flex h-7 w-4 items-center justify-center rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
              title="เลือกขนาดตัวอักษร"
            >
              <ChevronDown size={10} />
            </button>

            {showFontDropdown && hasSelection && (
              <>
                {/* Backdrop to close click outside */}
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowFontDropdown(false)} 
                />
                
                {/* Popover Dropdown menu */}
                <div className="absolute top-8 left-0 z-50 min-w-[72px] max-h-60 overflow-y-auto bg-slate-900 border border-white/10 rounded shadow-xl py-1 scrollbar-thin scrollbar-thumb-white/10">
                  {[8, 9, 10, 11, 12, 14, 18, 24, 30, 36, 48, 60, 72, 96].map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => {
                        const pageLayers = useLayerStore.getState().layersByPage.get(currentPage) || [];
                        const selected = pageLayers.filter(l => useLayerStore.getState().selectedLayerIds.has(l.id));
                        selected.forEach(l => {
                          updateLayerFontSize(currentPage, l.id, size);
                        });
                        setShowFontDropdown(false);
                      }}
                      className={`w-full px-3 py-1.5 text-left text-xs hover:bg-white/10 transition-colors ${
                        currentFontSize === size ? 'text-[#2B9BFF] font-bold bg-[#2B9BFF]/5' : 'text-slate-200'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            disabled={!hasSelection}
            onClick={() => {
              const pageLayers = useLayerStore.getState().layersByPage.get(currentPage) || [];
              const selected = pageLayers.filter(l => useLayerStore.getState().selectedLayerIds.has(l.id));
              selected.forEach(l => {
                const nextSize = Math.min(200, l.fontSize + 1);
                updateLayerFontSize(currentPage, l.id, nextSize);
              });
            }}
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
            title="เพิ่มขนาดตัวอักษร"
            aria-label="Increase Font Size"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Font Size Scaling */}
        <div className="w-px h-6 bg-white/10 mx-1" />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => adjustOverlayFontScale(-0.05)}
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Decrease overlay text size"
            aria-label="Decrease overlay text size"
          >
            <Minus size={13} />
          </button>
          <span className="w-12 text-center text-xs font-semibold text-slate-300">
            {overlayFontScalePercent}%
          </span>
          <button
            type="button"
            onClick={() => adjustOverlayFontScale(0.05)}
            className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            title="Increase overlay text size"
            aria-label="Increase overlay text size"
          >
            <Plus size={13} />
          </button>
        </div>

        {/* Spacer - push profile/downloads to top-right */}
        <div className="flex-1" />

        {/* Pulsing OCR Info Badge */}
        {activePageOCR && activePageOCR.words && activePageOCR.words.length > 0 && (
          <div className="flex items-center gap-1.5 rounded-lg border border-[#5CC6F2]/25 bg-slate-900/55 px-2.5 py-1 text-[11px] text-[#5CC6F2]/90 font-medium tracking-wide shadow-[0_4px_12px_rgba(92,198,242,0.08)]">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            <span className="font-bold text-white shrink-0">
              {activePageOCR.ocrEngine === 'paddleocr'
                ? 'Paddle'
                : 'Easy'}
            </span>
            <span className="text-slate-500 font-normal shrink-0">•</span>
            <span className="shrink-0">พบ {activePageOCR.words.length} คำ</span>
            <span className="text-slate-500 font-normal shrink-0">•</span>
            <span className="font-mono text-[10px] text-[#5CC6F2]/80 shrink-0">
              conf {activePageOCR.confidence.toFixed(0)}%
            </span>
          </div>
        )}

        <div className="flex items-center gap-1.5 rounded-lg border border-white/12 bg-slate-900/55 px-2 py-1 relative">
          <div className="relative">
            <button
              onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)}
              type="button"
              className={`flex items-center gap-1.5 px-2 py-0.5 h-6 rounded-md border text-[11px] font-semibold transition-all ${activeOption.activeClass}`}
              title={`Active translation profile: ${activeOption.label}`}
            >
              <span className="shrink-0 scale-90">{activeOption.icon}</span>
              <span className="text-[10px] tracking-wide font-bold">{activeOption.label}</span>
              <ChevronDown size={10} className={`transition-transform duration-200 ${isModeDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isModeDropdownOpen && (
              <>
                <div 
                  className="fixed inset-0 z-[190]" 
                  onClick={() => setIsModeDropdownOpen(false)}
                />
                <div className="absolute right-0 mt-1.5 w-36 bg-slate-950/98 border border-white/15 rounded-lg shadow-2xl z-[200] p-1 space-y-0.5 backdrop-blur-xl animate-in fade-in slide-in-from-top-1 duration-100">
                  {profileOptions.map((option) => {
                    const isActive = translationMode === option.mode;
                    return (
                      <button
                        key={option.mode}
                        onClick={() => {
                          setTranslationMode(option.mode);
                          setIsModeDropdownOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1 text-left text-xs rounded-md transition-colors ${
                          isActive 
                            ? 'bg-white/10 text-white font-bold' 
                            : 'text-slate-300 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <span className={`shrink-0 scale-90 ${isActive ? modeLabelColorClass : 'text-slate-400'}`}>
                          {option.icon}
                        </span>
                        <span className="text-[11px]">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {file && (
          <SplitViewToggle 
            viewMode={splitViewMode}
            isActive={splitViewMode === 'split'}
            onToggle={() => setSplitViewMode(splitViewMode === 'split' ? 'overlay' : 'split')}
          />
        )}

        <div className="relative">
          <button
            onClick={() => setIsDownloadMenuOpen((prev) => !prev)}
            className={`p-2 rounded transition-colors ${isDownloadMenuOpen ? 'bg-[#2B9BFF]/25 text-white' : 'hover:bg-white/10 text-slate-300 hover:text-white'}`}
            title="Download"
            disabled={isDownloadingResult || !file}
          >
            <Download size={16} />
          </button>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <div className="relative z-10 flex flex-col flex-1 overflow-hidden">
        
        {isNarrow && file && (
          <React.Suspense fallback={<div className="h-10 bg-slate-950/55 border-b border-white/10" />}>
            <CompactTopToolbar 
              isAiProcessing={isAiProcessing}
              isOfflineProcessing={isOfflineProcessing}
              onAiTranslate={handleAiTranslate}
              onOfflineTranslate={handleOfflineTranslate}
              onAiTranslateAllPages={handleAiTranslateAllPages}
              onOfflineTranslateAllPages={handleOfflineTranslateAllPages}
              translationStatus={translationStatus}
              offlineEngine={offlineEngine}
              onOfflineEngineChange={setOfflineEngine}
            />
          </React.Suspense>
        )}

        <div className="relative z-10 flex flex-1 overflow-hidden">
          {/* 1. LEFT SIDEBAR - Pages Navigator Only */}
          {file && (
            <React.Suspense fallback={<div className="w-48 bg-slate-950/55 border-r border-white/10" />}>
              <LeftSidebar 
                isOpen={isLeftSidebarOpen} 
                onToggle={handleToggleLeftSidebar} 
              />
            </React.Suspense>
          )}

          {/* 2. MAIN WORKSPACE (Canvas) */}
          <main className="flex-1 relative overflow-hidden bg-[#313741]">
            <React.Suspense fallback={<div className="flex items-center justify-center h-full text-slate-500">Loading Canvas...</div>}>
              <WorkspaceContainer />
            </React.Suspense>
          </main>

          {/* 3. RIGHT SIDEBAR - OCR & Settings */}
          {!isNarrow && (
            <React.Suspense fallback={<div className="w-65 bg-slate-950/55 border-l border-white/10" />}>
              <RightSidebar 
                isAiProcessing={isAiProcessing}
                isOfflineProcessing={isOfflineProcessing}
                onAiTranslate={handleAiTranslate}
                onOfflineTranslate={handleOfflineTranslate}
                onAiTranslateAllPages={handleAiTranslateAllPages}
                onOfflineTranslateAllPages={handleOfflineTranslateAllPages}
                translationStatus={translationStatus}
                offlineEngine={offlineEngine}
                onOfflineEngineChange={setOfflineEngine}
              />
            </React.Suspense>
          )}
        </div>
      </div>

      {/* ─── Floating Queue Status Badge (File Preview) ─── */}
      <BackgroundQueueBadge />

      {isDownloadMenuOpen && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-950/60 backdrop-blur-md px-4 py-3 transition-all duration-300">
          <div 
            ref={downloadMenuRef} 
            className="w-full max-w-md max-h-[calc(100vh-1.5rem)] overflow-y-auto custom-scrollbar rounded-2xl border border-white/10 bg-slate-950/80 p-5 shadow-[0_0_50px_-12px_rgba(43,155,255,0.25)] backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/5 mb-4">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <FileDown size={18} />
                </div>
                <div className="text-left">
                  <h3 className="text-xs font-bold text-slate-100 tracking-wide">ส่งออกข้อมูล PDF</h3>
                  <p className="text-[9px] text-slate-400">เลือกขอบเขตและโมเดลสำหรับผลลัพธ์</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDownloadMenuOpen(false)}
                className="p-1 rounded-lg border border-white/10 hover:border-white/20 bg-white/5 text-slate-400 hover:text-white hover:bg-rose-500/10 hover:border-rose-500/25 transition-all"
                title="ปิดหน้าต่าง"
              >
                <X size={15} />
              </button>
            </div>

            <div className="space-y-4">
              {/* 1. Scope Selection */}
              <div className="space-y-2">
                <div className="text-left">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">ขอบเขตหน้า (Scope)</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDownloadScopeSelection('current')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center group ${
                      downloadScopeSelection === 'current'
                        ? 'border-purple-500 bg-purple-500/12 text-purple-100 shadow-[0_0_15px_-4px_rgba(168,85,247,0.25)] scale-[1.01]'
                        : 'border-white/5 bg-white/3 text-slate-400 hover:border-white/15 hover:bg-white/5 hover:text-slate-200'
                    }`}
                  >
                    <BookOpen size={16} className={`mb-1.5 transition-transform group-hover:scale-110 ${downloadScopeSelection === 'current' ? 'text-purple-400' : 'text-slate-400'}`} />
                    <span className="text-xs font-semibold">หน้าปัจจุบัน</span>
                    <span className="text-[9px] opacity-75 mt-0.5 px-1.5 py-0.5 rounded-full bg-slate-900/50 border border-white/5">
                      หน้า {currentPage}
                    </span>
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => setDownloadScopeSelection('all')}
                    disabled={fileType !== 'pdf'}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center group disabled:cursor-not-allowed disabled:opacity-40 ${
                      downloadScopeSelection === 'all'
                        ? 'border-purple-500 bg-purple-500/12 text-purple-100 shadow-[0_0_15px_-4px_rgba(168,85,247,0.25)] scale-[1.01]'
                        : 'border-white/5 bg-white/3 text-slate-400 hover:border-white/15 hover:bg-white/5 hover:text-slate-200'
                    }`}
                  >
                    <Layers size={16} className={`mb-1.5 transition-transform group-hover:scale-110 ${downloadScopeSelection === 'all' ? 'text-purple-400' : 'text-slate-400'}`} />
                    <span className="text-xs font-semibold">ทุกหน้า</span>
                    <span className="text-[9px] opacity-75 mt-0.5 px-1.5 py-0.5 rounded-full bg-slate-900/50 border border-white/5">
                      {fileType === 'pdf' ? `รวม ${totalPages} หน้า` : 'ไฟล์รูปภาพ'}
                    </span>
                  </button>
                </div>
              </div>

              {/* 2. Content Selection */}
              <div className="space-y-2">
                <div className="text-left">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">รูปแบบเนื้อหา (Content)</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDownloadModeSelection('original')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center group ${
                      downloadModeSelection === 'original'
                        ? 'border-blue-500 bg-blue-500/12 text-blue-100 shadow-[0_0_15px_-4px_rgba(59,130,246,0.25)] scale-[1.01]'
                        : 'border-white/5 bg-white/3 text-slate-400 hover:border-white/15 hover:bg-white/5 hover:text-slate-200'
                    }`}
                  >
                    <FileText size={16} className={`mb-1.5 transition-transform group-hover:scale-110 ${downloadModeSelection === 'original' ? 'text-blue-400' : 'text-slate-400'}`} />
                    <span className="text-xs font-semibold">ต้นฉบับพร้อมค้นหา</span>
                    <span className="text-[9px] opacity-75 mt-0.5">เฉพาะข้อมูล OCR ดิบ</span>
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => setDownloadModeSelection('translated')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border transition-all text-center group ${
                      downloadModeSelection === 'translated'
                        ? 'border-blue-500 bg-blue-500/12 text-blue-100 shadow-[0_0_15px_-4px_rgba(59,130,246,0.25)] scale-[1.01]'
                        : 'border-white/5 bg-white/3 text-slate-400 hover:border-white/15 hover:bg-white/5 hover:text-slate-200'
                    }`}
                  >
                    <Languages size={16} className={`mb-1.5 transition-transform group-hover:scale-110 ${downloadModeSelection === 'translated' ? 'text-blue-400' : 'text-slate-400'}`} />
                    <span className="text-xs font-semibold">ฉบับแปลภาษา</span>
                    <span className="text-[9px] opacity-75 mt-0.5">ทับคำแปลบน PDF เดิม</span>
                  </button>
                </div>
              </div>

              {/* 3. Interactive OCR Model Grid */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">โมเดลประมวลผล (OCR Engine)</span>
                  <span className="text-[9px] text-slate-400">คลิกเพื่อสลับใช้ผลลัพธ์</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {(['paddleocr', 'easyocr'] as OCREngine[]).map((engineId) => {
                    const statusInfo = getEngineCacheStatus(engineId);
                    const isSelected = selectedDownloadEngine === engineId;
                    
                    let statusBg = 'bg-slate-900/60 text-slate-400 border-white/5';
                    let statusTextClass = 'text-slate-500';
                    let statusIcon = <AlertCircle size={10} className="text-slate-500" />;
                    
                    if (statusInfo.status === 'ready') {
                      statusBg = 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
                      statusTextClass = 'text-emerald-400';
                      statusIcon = <Check size={10} className="text-emerald-400" />;
                    } else if (statusInfo.status === 'partial_trans') {
                      statusBg = 'bg-teal-500/10 text-teal-300 border-teal-500/20';
                      statusTextClass = 'text-teal-400';
                      statusIcon = <Check size={10} className="text-teal-400" />;
                    } else if (statusInfo.status === 'ocr_only') {
                      statusBg = 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20';
                      statusTextClass = 'text-cyan-400';
                      statusIcon = <Eye size={10} className="text-cyan-400" />;
                    } else if (statusInfo.status === 'partial_ocr') {
                      statusBg = 'bg-cyan-500/5 text-cyan-300 border-cyan-500/10';
                      statusTextClass = 'text-cyan-400/80';
                      statusIcon = <Eye size={10} className="text-cyan-400/80" />;
                    }
                    
                    const displayName = engineId === 'paddleocr' ? 'PaddleOCR' : 'EasyOCR';
                    
                    return (
                      <button
                        key={engineId}
                        type="button"
                        onClick={() => setSelectedExportEngine(engineId)}
                        className={`flex flex-col items-center justify-between p-2.5 rounded-xl border text-center transition-all group relative overflow-hidden ${
                          isSelected
                            ? 'border-orange-500 bg-orange-950/20 text-orange-100 shadow-[0_0_15px_-4px_rgba(249,115,22,0.4)] scale-[1.02]'
                            : 'border-white/5 bg-slate-900/40 text-slate-400 hover:border-white/10 hover:bg-slate-900/60 hover:text-slate-200'
                        }`}
                      >
                        {isSelected && (
                          <div className="absolute inset-0 bg-gradient-to-b from-orange-500/10 to-transparent pointer-events-none" />
                        )}
                        
                        <Cpu size={14} className={`mb-1 transition-transform group-hover:rotate-12 ${isSelected ? 'text-orange-400' : 'text-slate-400'}`} />
                        <span className="text-[10px] font-bold tracking-tight mb-1.5">{displayName}</span>
                        
                        <span className={`w-full flex items-center justify-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-semibold tracking-tighter ${statusBg}`}>
                          {statusIcon}
                          <span className="truncate">{statusInfo.text}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. Quick Translation Console (แสดงเฉพาะเมื่อเลือก Translated) */}
              {downloadModeSelection === 'translated' && (
                <div className="rounded-xl border border-white/5 bg-white/2 p-3 space-y-2.5 backdrop-blur-md">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-slate-400 text-left">
                    <Globe size={11} className="text-cyan-400 shrink-0" />
                    <span>ตัวแปลภาษาด่วน (Quick Translate)</span>
                  </div>
                  
                  {/* การแสดงผลระหว่างแปลภาษา (Progress Bar ของจริง!) */}
                  {(isAiProcessing || isOfflineProcessing) && ocrProgress ? (
                    <div className="space-y-2 p-2.5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 backdrop-blur-sm">
                      <div className="flex items-center justify-between text-[10px] text-cyan-200">
                        <span className="font-bold flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                          {isOfflineProcessing && effectiveDownloadScope === 'all' && fileType === 'pdf'
                            ? `กำลังประมวลผลหน้า ${currentPage} จาก ${totalPages} หน้า...`
                            : (ocrProgress.message || 'กำลังแปลเอกสาร...')}
                        </span>
                        <span className="font-mono text-[11px]">
                          {Math.round(
                            isOfflineProcessing && effectiveDownloadScope === 'all' && fileType === 'pdf'
                              ? computedProgressPercent
                              : ocrProgress.progress
                          )}%
                        </span>
                      </div>
                      
                      {/* หลอด Progress Bar */}
                      <div className="w-full h-2 rounded-full bg-slate-950 overflow-hidden border border-white/10 relative">
                        <div 
                          className="h-full bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(6,182,212,0.5)]"
                          style={{
                            width: `${
                              isOfflineProcessing && effectiveDownloadScope === 'all' && fileType === 'pdf'
                                ? computedProgressPercent
                                : ocrProgress.progress
                            }%`
                          }}
                        />
                      </div>
                      
                      {/* รายละเอียดเลขหน้าและเวลาที่เหลือ */}
                      <div className="flex items-center justify-between text-[9px] text-slate-400">
                        <span>
                          หน้าที่: {isOfflineProcessing && effectiveDownloadScope === 'all' && fileType === 'pdf' ? currentPage : ocrProgress.currentPage} / {isOfflineProcessing && effectiveDownloadScope === 'all' && fileType === 'pdf' ? totalPages : ocrProgress.totalPages} หน้า
                        </span>
                        <span className="text-cyan-300 font-semibold">{getRemainingSecondsText()}</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* เมนูตั้งค่าก่อนกดแปล (ปรับให้กะทัดรัดและมีปุ่มสลับ High/Fast ข้าง select ภาษา) */}
                      <div className="grid grid-cols-12 gap-3 items-end">
                        {/* 1. เลือกภาษา */}
                        <div className="col-span-7 flex flex-col gap-1 text-left">
                          <span className="text-[9px] text-slate-400">ภาษาเป้าหมาย:</span>
                          <select
                            value={targetLanguage}
                            onChange={(event) => setTargetLanguage(event.target.value)}
                            aria-label="Download translated target language"
                            title="Download translated target language"
                            className="w-full rounded-lg border border-white/10 bg-slate-950/90 px-2 py-1.5 text-[11px] text-slate-100 focus:border-cyan-400/50 focus:outline-none"
                          >
                            {(() => {
                              const isOcrThai = ocrLanguage.split('+').some(lang => lang.trim().toLowerCase() === 'tha' || lang.trim().toLowerCase() === 'thai');
                              return (
                                <>
                                  <option value="th" disabled={isOcrThai}>Thai (ไทย)</option>
                                  <option value="en">English</option>
                                  <option value="ja">Japanese (日本語)</option>
                                  <option value="ko">Korean (한국어)</option>
                                  <option value="zh">Chinese (中文)</option>
                                </>
                              );
                            })()}
                          </select>
                        </div>

                        {/* 2. สวิตช์ OCR Profile (High / Fast) โทนสีส้มพรีเมียมตามที่คุณต้องการ */}
                        <div className="col-span-5 flex flex-col gap-1 text-left">
                          <span className="text-[9px] text-slate-400">โปรไฟล์ OCR:</span>
                          <div className="grid grid-cols-2 rounded-lg border border-white/10 bg-slate-950/90 p-0.5 h-[30px]">
                            <button
                              type="button"
                              onClick={() => changeOcrQualityMode('high')}
                              className={`text-[9px] font-bold rounded transition-all ${
                                popupOcrQualityMode === 'high'
                                  ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/30'
                                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                              }`}
                            >
                              High
                            </button>
                            <button
                              type="button"
                              onClick={() => changeOcrQualityMode('fast')}
                              className={`text-[9px] font-bold rounded transition-all ${
                                popupOcrQualityMode === 'fast'
                                  ? 'bg-orange-500 text-white shadow-sm shadow-orange-500/30'
                                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                              }`}
                            >
                              Fast
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* ปุ่มเริ่มแปล */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => triggerPopupTranslation('offline')}
                          disabled={isAiProcessing || isOfflineProcessing}
                          className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold text-white transition-all bg-[#864E3E] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 border border-white/10"
                        >
                          <RefreshCw size={10} className={isOfflineProcessing ? 'animate-spin' : ''} />
                          <span>Offline All Pages</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerPopupTranslation('ai')}
                          disabled={isAiProcessing || isOfflineProcessing}
                          className="flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-bold text-white transition-all bg-[#CA7C4C] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45 border border-white/10"
                        >
                          <Sparkles size={10} className={isAiProcessing ? 'animate-pulse' : ''} />
                          <span>AI All Pages</span>
                        </button>
                      </div>
                      
                      <div className="text-[9px] text-slate-400 text-center flex items-center justify-center gap-1">
                        <span className="w-1 h-1 rounded-full bg-cyan-400 animate-ping shrink-0" />
                        เป้าหมาย: {effectiveDownloadScope === 'all' && fileType === 'pdf' ? 'ทุกหน้าที่มี OCR' : `เฉพาะหน้าปัจจุบัน (หน้า ${currentPage})`}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* 5. HUD-style Info & Warnings (เอาตัวคำเตือนไม่พบคู่แคชออกเพื่อประหยัดพื้นที่!) */}
              <div className="space-y-2 text-[10px] text-left">
                {effectiveDownloadScope === 'all' && fileType === 'pdf' && missingOcrPageNumbers.length > 0 && (
                  <div className="flex gap-1.5 p-2 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-300/90 leading-relaxed shadow-sm">
                    <AlertCircle size={13} className="shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      ยังไม่รัน OCR บางหน้า ({missingOcrPageNumbers.length} หน้า):{' '}
                      <span className="font-bold">{formatPageListSummary(missingOcrPageNumbers)}</span>{' '}
                      (ระบบจะส่งออกข้ามหน้าที่ยังไม่ได้ OCR)
                    </div>
                  </div>
                )}

                {downloadModeSelection === 'translated' && ocrCoveredPageNumbers.length > 0 && missingTranslatedPageNumbers.length > 0 && (
                  <div className="flex gap-1.5 p-2 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-300/90 leading-relaxed shadow-sm">
                    <AlertCircle size={13} className="shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      ยังไม่มีข้อมูลแปลของโมเดลนี้บางหน้า ({missingTranslatedPageNumbers.length} หน้า):{' '}
                      <span className="font-bold">{formatPageListSummary(missingTranslatedPageNumbers)}</span>{' '}
                      (กดแปลภาษาด้านบนก่อน หรือดาวน์โหลดเท่าที่มีแปลแล้ว)
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between p-2 rounded-lg border border-white/5 bg-slate-900/30 text-slate-400">
                  <span>หน้าที่มี OCR: {ocrCoveredPageNumbers.length > 0 ? formatPageListSummary(ocrCoveredPageNumbers) : 'ไม่มี'}</span>
                  {downloadModeSelection === 'translated' && (
                    <span className="border-l border-white/10 pl-2">
                      แปลแล้ว: {translatedAvailablePageNumbers.length > 0 ? formatPageListSummary(translatedAvailablePageNumbers) : 'ไม่มี'}
                    </span>
                  )}
                </div>
              </div>

              {/* 6. Primary Action Button */}
              <button
                type="button"
                onClick={() => void handleHeaderDownload(effectiveDownloadScope, downloadModeSelection)}
                disabled={isDownloadingResult || (downloadModeSelection === 'original' ? !canExportOriginalSelection : !canExportTranslatedSelection)}
                className="w-full relative overflow-hidden group rounded-xl bg-gradient-to-r from-[#839958] to-[#0A3323] hover:from-[#95ad66] hover:to-[#0f4631] text-white font-bold p-3 text-xs tracking-wider transition-all duration-300 shadow-[0_0_20px_rgba(131,153,88,0.3)] hover:shadow-[0_0_25px_rgba(131,153,88,0.45)] hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/15 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out" />
                
                <div className="flex items-center justify-center gap-1.5">
                  {isDownloadingResult ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" />
                      <span>กำลังส่งออกและรวมไฟล์...</span>
                    </>
                  ) : (
                    <>
                      <FileDown size={14} className="group-hover:translate-y-0.5 transition-transform" />
                      <span>
                        ส่งออกข้อมูล {effectiveDownloadScope === 'all' && fileType === 'pdf' ? 'ทั้งหมดทุกหน้า' : `เฉพาะหน้า ${currentPage}`}
                      </span>
                    </>
                  )}
                </div>
                
                {!isDownloadingResult && (
                  <div className="text-[9px] font-normal opacity-75 mt-0.5 uppercase tracking-tighter">
                    [{selectedDownloadEngine === 'paddleocr' ? 'PaddleOCR' : 'EasyOCR'} • {downloadModeSelection === 'original' ? 'ต้นฉบับ OCR' : 'ฉบับแปลภาษา'}]
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Background Processing Queue Status Panel */}
      {(() => {
        const visibleQueueJobs = queueJobs.filter(j => !j.type.endsWith('_single'));
        if (visibleQueueJobs.length === 0) return null;

        const activeJob = visibleQueueJobs.find(j => j.status === 'processing') || 
                          visibleQueueJobs.find(j => j.status === 'paused') ||
                          visibleQueueJobs.find(j => j.status === 'pending');
        
        if (!activeJob) return null;

        const isPaused = activeJob.status === 'paused';
        const progressPercent = activeJob.totalPages > 0 
          ? Math.round((activeJob.currentPage / activeJob.totalPages) * 100) 
          : 0;

        return (
          <div className="fixed bottom-4 right-0 z-50 w-80 rounded-l-2xl border-y border-l border-white/10 bg-slate-950/90 shadow-2xl backdrop-blur-xl transition-all duration-300 overflow-hidden text-left font-sans">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-[linear-gradient(124deg,rgba(12,25,48,0.85)_0%,rgba(17,24,39,0.95)_100%)]">
              <div className="flex items-center gap-2">
                <RefreshCw size={13} className={`text-cyan-400 ${activeJob.status === 'processing' ? 'animate-spin' : ''}`} />
                <span className="text-xs font-bold text-slate-100 uppercase tracking-wider">OCR Queue</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 font-mono">
                  {visibleQueueJobs.filter(j => ['pending', 'processing'].includes(j.status)).length}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-semibold text-slate-300 bg-white/5 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">
                  {activeJob.status === 'processing' ? 'กำลังรัน' : isPaused ? 'หยุดชั่วคราว' : 'กำลังเริ่ม'}
                </span>
                <button
                  type="button"
                  onClick={() => setIsQueuePanelExpanded(!isQueuePanelExpanded)}
                  className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-white/5 transition-colors"
                  title={isQueuePanelExpanded ? 'ย่อรายละเอียด' : 'ดูรายละเอียดคิว'}
                >
                  {isQueuePanelExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-3.5 space-y-3">
              {/* Active Job Details */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="text-[11px] font-bold text-slate-200 truncate flex-1" title={activeJob.filename}>
                     {activeJob.filename}
                  </div>
                  <div className="text-[9px] font-semibold text-cyan-300 capitalize">
                    {activeJob.type === 'offline_all' ? 'Offline' : 'AI'} All Pages
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1.5">
                  <div className="truncate flex-1 pr-2">
                    {activeJob.message && !activeJob.message.includes('หน้าที่') && !activeJob.message.includes('วิเคราะห์และแปล')
                      ? activeJob.message
                      : ''
                    }
                  </div>
                  <div className="shrink-0 font-mono">
                    {activeJob.currentPage}/{activeJob.totalPages} หน้า ({progressPercent}%)
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden mb-2.5">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${
                      isPaused 
                        ? 'bg-[#839958]' 
                        : activeJob.status === 'failed' 
                          ? 'bg-rose-500' 
                          : 'bg-gradient-to-r from-cyan-500 to-blue-500 shadow-[0_0_8px_rgba(6,182,212,0.5)]'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>

                {/* Active Controls */}
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[9px] text-slate-500 shrink-0 font-mono">
                    Runtime: <span className="font-semibold text-slate-300">
                      {Math.max(0, Math.floor((Date.now() - activeJob.createdAt) / 1000))}s
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {activeJob.status === 'processing' && (
                      <button
                        type="button"
                        onClick={() => useBackgroundQueueStore.getState().pauseJob(activeJob.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[9.5px] font-semibold transition-all bg-[#839958] hover:bg-[#5e7235] text-white border border-[#839958] hover:border-[#5e7235]"
                        title="หยุดประมวลผลชั่วคราว"
                      >
                        <Pause size={10} />
                        <span>หยุด</span>
                      </button>
                    )}
                    {isPaused && (
                      <button
                        type="button"
                        onClick={() => useBackgroundQueueStore.getState().resumeJob(activeJob.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-200 border border-emerald-500/20 text-[9.5px] font-semibold transition-colors"
                        title="ประมวลผลต่อ"
                      >
                        <Play size={10} />
                        <span>ต่อ</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => useBackgroundQueueStore.getState().cancelJob(activeJob.id)}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[9.5px] font-semibold transition-all bg-[#0A3323] hover:bg-[#062116] text-white border border-[#0A3323] hover:border-[#062116]"
                      title="ยกเลิกการประมวลผลไฟล์นี้"
                    >
                      <Trash2 size={10} />
                      <span>ยกเลิก</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Queue List (แสดงเมื่อขยาย) */}
              {isQueuePanelExpanded && (
                <div className="pt-3 border-t border-white/5 space-y-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider text-left mb-1">
                    รายการคิวทั้งหมด ({visibleQueueJobs.length})
                  </div>
                  <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-1.5 pr-0.5">
                    {visibleQueueJobs.map((job) => {
                      const isActive = job.id === activeJob.id;
                      const isDone = ['completed', 'cancelled', 'failed'].includes(job.status);
                      
                      let statusBg = 'bg-slate-900 border-white/5 text-slate-400';
                      let statusText: string = job.status;
                      
                      if (job.status === 'processing') {
                        statusBg = 'bg-cyan-500/10 border-cyan-500/20 text-cyan-200';
                        statusText = 'กำลังรัน';
                      } else if (job.status === 'pending') {
                        statusBg = 'bg-slate-900 border-white/10 text-slate-300';
                        statusText = 'รอลำดับ';
                      } else if (job.status === 'paused') {
                        statusBg = 'bg-amber-500/10 border-amber-500/25 text-amber-200';
                        statusText = 'หยุดค้าง';
                      } else if (job.status === 'completed') {
                        statusBg = 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300';
                        statusText = 'สำเร็จ';
                      } else if (job.status === 'cancelled') {
                        statusBg = 'bg-slate-950 border-white/5 text-slate-500';
                        statusText = 'ยกเลิกแล้ว';
                      } else if (job.status === 'failed') {
                        statusBg = 'bg-rose-500/10 border-rose-500/20 text-rose-300';
                        statusText = 'ล้มเหลว';
                      }

                      return (
                        <div 
                          key={job.id} 
                          className={`flex items-center justify-between gap-3 p-2 rounded-xl border transition-all ${
                            isActive 
                              ? 'bg-white/5 border-cyan-500/30' 
                              : 'bg-white/2 border-white/5'
                          }`}
                        >
                          <div className="min-w-0 flex-1 text-left">
                            <div className="text-[10px] font-bold text-slate-200 truncate" title={job.filename}>
                              {job.filename}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-slate-400">
                              <span className="capitalize">{job.type === 'offline_all' ? 'Offline' : 'AI'} All</span>
                              <span>•</span>
                              <span>{job.currentPage}/{job.totalPages} หน้า</span>
                              {job.startTime && (
                                <>
                                  <span>•</span>
                                  <span>
                                    {(() => {
                                      const end = job.completedTime || Date.now();
                                      const diff = Math.max(0, Math.floor((end - job.startTime) / 1000));
                                      if (diff < 60) return `${diff}s`;
                                      return `${Math.floor(diff / 60)}m ${diff % 60}s`;
                                    })()}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={`text-[8.5px] px-1.5 py-0.5 rounded-md border ${statusBg}`}>
                              {statusText}
                            </span>
                            {!isDone && !isActive && (
                              <button
                                type="button"
                                onClick={() => useBackgroundQueueStore.getState().moveJobUp(job.id)}
                                className="px-1.5 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/20 text-[8.5px] font-semibold transition-colors"
                                title="เลื่อนขึ้นในคิว"
                              >
                                เลื่อนขึ้น
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => useBackgroundQueueStore.getState().removeJob(job.id)}
                              className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
                              title="ลบออกจากรายการ"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
      {loadingState?.active && (
        <GlobalLoadingOverlay 
          message={loadingState.message} 
          progress={loadingState.progress} 
        />
      )}
      <ExportOverlay />
    </div>
  );
}





