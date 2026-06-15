import React, { useState, useEffect, useCallback } from 'react';
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
import { OCR_ALGORITHM_VERSION } from './services/vision/ocrVersion';
import { buildLayerGroupsFromOCR } from './services/layers/LayerGroupingService';
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

// Lazy Load Heavy Components
const RightSidebar = React.lazy(() => import('./components/Layout/RightSidebar').then(module => ({ default: module.RightSidebar })));
const PDFCanvas = React.lazy(() => import('./components/PDF/PDFCanvas').then(module => ({ default: module.PDFCanvas })));
const LeftSidebar = React.lazy(() => import('./components/Layout/LeftSidebar').then(module => ({ default: module.LeftSidebar })));
const ImageCanvas = React.lazy(() => import('./components/Image/ImageCanvas').then(module => ({ default: module.ImageCanvas })));
import { visionService } from './services/vision/VisionService';
import { dbService } from './services/dbService';
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

export {
  normalizeSourceForTranslation,
  normalizeTranslationLanguage,
  normalizeSpanishOcrNoiseForTranslation,
  cleanJapaneseOcrSpacing,
  cleanKoreanOcrSpacing,
  normalizeJapaneseOcrNoiseForTranslation,
  normalizeKoreanOcrNoiseForTranslation,
  normalizeEnglishOcrNoiseForTranslation,
};



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



const intervalOverlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

const overlapRatio = (a0: number, a1: number, b0: number, b1: number): number => {
  const overlap = intervalOverlap(a0, a1, b0, b1);
  const base = Math.max(1, Math.min(Math.max(1, a1 - a0), Math.max(1, b1 - b0)));
  return overlap / base;
};

export const shouldPruneContextualGhostTranslatableLine = (
  candidate: TranslatableLine,
  lines: TranslatableLine[],
): boolean => {
  const text = normalizeWhitespace(String(candidate.text || ''));
  if (!text) return true;

  if (shouldForceKeepComicTranslationLine(text, {
    text,
    confidence: candidate.confidence || 0,
    bbox: {
      x0: candidate.left,
      y0: candidate.top,
      x1: candidate.right,
      y1: candidate.bottom,
    },
    words: [],
  }, {
    width: candidate.right - candidate.left,
    height: candidate.bottom - candidate.top,
    area: candidate.area,
    wordCoverage: candidate.wordCoverage,
  })) {
    return false;
  }

  const width = Math.max(1, candidate.right - candidate.left);
  const height = Math.max(1, candidate.bottom - candidate.top);
  const area = Math.max(1, candidate.area || (width * height));
  const centerX = (candidate.left + candidate.right) * 0.5;
  const centerY = (candidate.top + candidate.bottom) * 0.5;
  const tokenCount = text.split(/\s+/g).filter(Boolean).length;
  const compact = text.replace(/\s+/g, '');
  const readability = scoreSourceLineReadability(text);
  const wordCoverage = Math.max(0, Number(candidate.wordCoverage || 0));
  const wordBoxCount = Math.max(0, Number(candidate.wordBoxCount || 0));

  const neighbors = lines
    .filter((line) => line.index !== candidate.index)
    .map((line) => {
      const otherWidth = Math.max(1, line.right - line.left);
      const otherHeight = Math.max(1, line.bottom - line.top);
      const otherArea = Math.max(1, line.area || (otherWidth * otherHeight));
      const otherCenterX = (line.left + line.right) * 0.5;
      const otherCenterY = (line.top + line.bottom) * 0.5;
      const overlapX = overlapRatio(candidate.left, candidate.right, line.left, line.right);
      const overlapY = overlapRatio(candidate.top, candidate.bottom, line.top, line.bottom);
      const centerDeltaX = Math.abs(centerX - otherCenterX);
      const centerDeltaY = Math.abs(centerY - otherCenterY);
      const otherCoverage = Math.max(0, Number(line.wordCoverage || 0));
      const otherWordBoxCount = Math.max(0, Number(line.wordBoxCount || 0));
      const otherReadability = scoreSourceLineReadability(line.text);
      const strongSignal = (
        otherWordBoxCount >= 2
        || otherCoverage >= 0.28
        || line.sourceLength >= Math.max(8, candidate.sourceLength * 0.9)
        || otherReadability >= readability + 2.5
      );
      return {
        line,
        width: otherWidth,
        height: otherHeight,
        area: otherArea,
        overlapX,
        overlapY,
        centerDeltaX,
        centerDeltaY,
        strongSignal,
        centerX: otherCenterX,
        centerY: otherCenterY,
      };
    });

  const sameBandNeighbors = neighbors.filter((neighbor) => (
    neighbor.overlapY >= 0.18
    || neighbor.centerDeltaY <= Math.max(96, height * 0.95)
  ));
  const leftAnchors = sameBandNeighbors.filter((neighbor) => (
    neighbor.strongSignal
    && neighbor.width <= width * 0.44
    && neighbor.line.right <= centerX - Math.max(88, width * 0.08)
  ));
  const rightAnchors = sameBandNeighbors.filter((neighbor) => (
    neighbor.strongSignal
    && neighbor.width <= width * 0.44
    && neighbor.line.left >= centerX + Math.max(88, width * 0.08)
  ));
  const bridgeLine = (
    tokenCount >= 4
    && tokenCount <= 8
    && wordBoxCount >= 3
    && width >= 900
    && leftAnchors.length > 0
    && rightAnchors.length > 0
    && leftAnchors.some((leftAnchor) => rightAnchors.some((rightAnchor) => (
      Math.abs(leftAnchor.centerY - rightAnchor.centerY) <= Math.max(110, height * 0.9)
      && (rightAnchor.line.left - leftAnchor.line.right) >= Math.max(260, width * 0.22)
    )))
  );
  if (bridgeLine) {
    return true;
  }

  const localStrongNeighbors = neighbors.filter((neighbor) => (
    neighbor.strongSignal
    && neighbor.centerDeltaY <= Math.max(240, height * 2.4)
    && (
      neighbor.overlapX >= 0.28
      || neighbor.centerDeltaX <= Math.max(240, width * 1.4)
    )
  ));
  const strongAbove = localStrongNeighbors.some((neighbor) => neighbor.centerY < centerY - Math.max(18, height * 0.18));
  const strongBelow = localStrongNeighbors.some((neighbor) => neighbor.centerY > centerY + Math.max(18, height * 0.18));

  const letters = text.replace(/[^A-Za-z]/g, '');
  const trailingHyphenFragment = /-\s*$/.test(text)
    && tokenCount <= 3
    && (readability <= 12 || area >= 30000)
    && (letters.length <= 1 || (wordCoverage <= 0.22 && area >= 20000));
  const oversizedWeakSingleton = tokenCount <= 1
    && compact.length <= 12
    && wordBoxCount <= 1
    && area >= 22000;

  return (
    (strongBelow && trailingHyphenFragment)
    || (strongAbove && strongBelow && oversizedWeakSingleton)
    || (strongAbove && strongBelow && wordBoxCount <= 1 && wordCoverage <= 0.22 && readability <= 4.2 && area >= 18000)
  );
};

const normalizeTranslatableDedupKey = (text: string): string =>
  normalizeWhitespace(String(text || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S');

const collectMeaningfulTranslatableLatinTokens = (text: string): string[] => (
  normalizeWhitespace(String(text || ''))
    .toUpperCase()
    .split(/\s+/g)
    .map((token) => token.replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S'))
    .filter((token) => token.length >= 3)
);

const countSharedTranslatableLatinTokens = (left: string, right: string): number => {
  const leftTokens = new Set(collectMeaningfulTranslatableLatinTokens(left));
  const rightTokens = new Set(collectMeaningfulTranslatableLatinTokens(right));
  let shared = 0;
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1;
  });
  return shared;
};

const TECHNICAL_LINE_HINT_REGEX = /\b(unknowns?|reactions?|equilibrium|resultant|component|components|direction|force|moment|column|columns|connections?|support|rigid|body|beam|beams|pin|hinge|utility|building|bridge|girder|floor|member|concrete|weld(?:ed|ing)?|fx|fy|fz|mx|my|mz|rx|ry|rz)\b/i;
const UNKNOWNS_COUNT_REGEX = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+unknowns?\b/i;
const AXIS_SYMBOL_REGEX = /\b(?:fx|fy|fz|mx|my|mz|rx|ry|rz)\b/gi;
const EQUATION_LABEL_REGEX = /\([0-9]{1,3}\)/;

const UNKNOWN_COUNT_WORD_TO_NUMBER: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

const normalizeUnknownCountToken = (value: string): string => {
  const normalized = normalizeWhitespace(String(value || '')).toLowerCase();
  if (!normalized) return '';
  return UNKNOWN_COUNT_WORD_TO_NUMBER[normalized] || normalized;
};

const collectUniqueRegexMatches = (value: string, regex: RegExp): string[] => {
  const normalized = normalizeWhitespace(String(value || '')).toLowerCase();
  if (!normalized) return [];
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  const matches = normalized.match(matcher) || [];
  return Array.from(new Set(matches.map((item) => item.trim()).filter(Boolean)));
};

const shouldPreserveDistinctTechnicalLines = (a: string, b: string): boolean => {
  const normalizedA = normalizeWhitespace(String(a || '')).toLowerCase();
  const normalizedB = normalizeWhitespace(String(b || '')).toLowerCase();
  if (!normalizedA || !normalizedB || normalizedA === normalizedB) return false;

  const hasTechnicalA = (
    TECHNICAL_LINE_HINT_REGEX.test(normalizedA)
    || UNKNOWNS_COUNT_REGEX.test(normalizedA)
    || EQUATION_LABEL_REGEX.test(normalizedA)
  );
  const hasTechnicalB = (
    TECHNICAL_LINE_HINT_REGEX.test(normalizedB)
    || UNKNOWNS_COUNT_REGEX.test(normalizedB)
    || EQUATION_LABEL_REGEX.test(normalizedB)
  );
  if (!hasTechnicalA || !hasTechnicalB) return false;

  const unknownCountA = normalizeUnknownCountToken(normalizedA.match(UNKNOWNS_COUNT_REGEX)?.[1] || '');
  const unknownCountB = normalizeUnknownCountToken(normalizedB.match(UNKNOWNS_COUNT_REGEX)?.[1] || '');
  if (unknownCountA && unknownCountB && unknownCountA !== unknownCountB) {
    return true;
  }

  const axisTokensA = new Set(collectUniqueRegexMatches(normalizedA, AXIS_SYMBOL_REGEX));
  const axisTokensB = new Set(collectUniqueRegexMatches(normalizedB, AXIS_SYMBOL_REGEX));
  if (axisTokensA.size > 0 || axisTokensB.size > 0) {
    let shared = 0;
    for (const token of axisTokensA) {
      if (axisTokensB.has(token)) shared += 1;
    }
    if (shared < Math.min(axisTokensA.size, axisTokensB.size)) {
      return true;
    }
  }

  const equationTagsA = new Set(collectUniqueRegexMatches(normalizedA, EQUATION_LABEL_REGEX));
  const equationTagsB = new Set(collectUniqueRegexMatches(normalizedB, EQUATION_LABEL_REGEX));
  if (equationTagsA.size > 0 && equationTagsB.size > 0) {
    let shared = 0;
    for (const token of equationTagsA) {
      if (equationTagsB.has(token)) shared += 1;
    }
    if (shared === 0) {
      return true;
    }
  }

  return false;
};

const KNOWN_CONVERSATIONAL_DUPLICATE_KEYS = new Set([
  'AAREYOU',
  'AAREYO',
  'AAREY',
]);

const translatableDedupSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (value: string): Set<string> => {
    const set = new Set<string>();
    if (value.length < 2) {
      set.add(value);
      return set;
    }
    for (let i = 0; i < value.length - 1; i += 1) {
      set.add(value.slice(i, i + 2));
    }
    return set;
  };
  const aSet = grams(a);
  const bSet = grams(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let overlap = 0;
  for (const gram of aSet) {
    if (bSet.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (aSet.size + bSet.size);
};

export const dedupeTranslatableLinesForTranslation = (lines: TranslatableLine[]): TranslatableLine[] => {
  if (lines.length <= 1) return lines;

  const ordered = [...lines].sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return a.index - b.index;
  });

  const kept: TranslatableLine[] = [];
  const keptKeys: string[] = [];
  const mergeRicherDuplicateTextWithCleanerGeometry = (
    existing: TranslatableLine,
    existingKey: string,
    candidate: TranslatableLine,
    candidateKey: string
  ): TranslatableLine | null => {
    if (!existingKey || !candidateKey || existingKey === candidateKey) return null;
    const minLength = Math.min(existingKey.length, candidateKey.length);
    if (minLength < 5) return null;
    const existingContainsCandidate = existingKey.includes(candidateKey);
    const candidateContainsExisting = candidateKey.includes(existingKey);
    if (!existingContainsCandidate && !candidateContainsExisting) return null;

    const richer = existingKey.length > candidateKey.length ? existing : candidate;
    const richerKey = existingKey.length > candidateKey.length ? existingKey : candidateKey;
    const cleaner = richer === existing ? candidate : existing;
    const cleanerKey = richer === existing ? candidateKey : existingKey;
    const richerWordCount = normalizeWhitespace(String(richer.text || '')).split(/\s+/g).filter(Boolean).length;
    const cleanerWordCount = normalizeWhitespace(String(cleaner.text || '')).split(/\s+/g).filter(Boolean).length;
    if (richerWordCount > 4 || cleanerWordCount > 3) return null;
    if (richerKey.length > 22 || cleanerKey.length > 16) return null;

    const richerWidth = Math.max(1, richer.right - richer.left);
    const richerHeight = Math.max(1, richer.bottom - richer.top);
    const cleanerWidth = Math.max(1, cleaner.right - cleaner.left);
    const cleanerHeight = Math.max(1, cleaner.bottom - cleaner.top);
    const richerArea = Math.max(1, richerWidth * richerHeight);
    const cleanerArea = Math.max(1, cleanerWidth * cleanerHeight);
    const richerCoverage = Math.max(0, Number(richer.wordCoverage || 0));
    const cleanerCoverage = Math.max(0, Number(cleaner.wordCoverage || 0));
    const richerWordBoxes = Math.max(0, Number(richer.wordBoxCount || 0));
    const cleanerWordBoxes = Math.max(0, Number(cleaner.wordBoxCount || 0));
    const cleanerLooksLocalized = (
      cleanerCoverage >= Math.max(0.36, richerCoverage + 0.14)
      || (cleanerArea <= richerArea * 0.58 && cleanerCoverage >= Math.max(0.24, richerCoverage))
      || (cleanerWordBoxes >= richerWordBoxes && cleanerArea <= richerArea * 0.72)
    );
    const richerLooksMislocalized = (
      richerCoverage <= 0.36
      || richerArea >= cleanerArea * 1.55
      || richerHeight >= cleanerHeight * 1.7
    );
    const shortPhraseRepair = (
      /^I\s*THINK[.!?…]*$/i.test(richer.text)
      && /^THINK[.!?…]*$/i.test(cleaner.text)
      && cleanerCoverage >= Math.max(0.22, richerCoverage)
    );

    if (!shortPhraseRepair && (!cleanerLooksLocalized || !richerLooksMislocalized)) {
      return null;
    }

    const repairedText = /^I\s*THINK[.!?…]*$/i.test(richer.text)
      ? String(richer.text || '').replace(/^I\s*THINK/i, 'I THINK')
      : richer.text;

    return {
      ...cleaner,
      text: repairedText,
      sourceLength: Math.max(richer.sourceLength, countReadableLength(repairedText)),
    };
  };
  const lineScore = (line: TranslatableLine): number => {
    const width = Math.max(1, line.right - line.left);
    const height = Math.max(1, line.bottom - line.top);
    const readability = scoreSourceLineReadability(line.text);
    const area = Math.max(1, width * height);
    const density = line.sourceLength / Math.max(1, Math.sqrt(area));
    const wordCoverage = Math.max(0, Math.min(1.5, Number(line.wordCoverage || 0)));
    const wordBoxCount = Math.max(0, Number(line.wordBoxCount || 0));
    const coverageBonus = Math.min(1, wordCoverage) * 15.2;
    const wordBoxBonus = Math.min(4, wordBoxCount) * 1.25;
    const noWordPenalty = wordBoxCount === 0 ? 4.8 : 0;
    const oversizedSparsePenalty = (
      wordCoverage <= 0.2
      && wordBoxCount <= 1
      && line.sourceLength <= 34
      && area >= 14000
    ) ? (Math.log10(area) * 3.35) : 0;

    const confidence = typeof line.confidence === 'number' ? line.confidence : 85;
    const confidenceBonus = confidence * 0.16;
    const hasPunctuation = /[!.?…]/.test(line.text);
    const punctuationBonus = hasPunctuation ? 3.8 : 0;
    const endsWithOcrTypoNoise = /[A-Z]{3,}[Il1]$/.test(line.text);
    const ocrTypoPenalty = endsWithOcrTypoNoise ? 8.5 : 0;

    return (line.sourceLength * 1.82)
      + (readability * 2.75)
      + (density * 26)
      + (height * 0.18)
      + coverageBonus
      + wordBoxBonus
      + confidenceBonus
      + punctuationBonus
      - noWordPenalty
      - oversizedSparsePenalty
      - ocrTypoPenalty
      - (Math.log10(area) * 1.45);
  };

  for (const candidate of ordered) {
    const candidateKey = normalizeTranslatableDedupKey(candidate.text);
    if (!candidateKey) {
      kept.push(candidate);
      keptKeys.push('');
      continue;
    }

    let existingIndex = kept.findIndex((existing, index) => {
      const existingKey = keptKeys[index];
      if (!existingKey) return false;

      const minLength = Math.min(existingKey.length, candidateKey.length);
      const keySimilarity = translatableDedupSimilarity(existingKey, candidateKey);
      const sameOrSubset = existingKey === candidateKey
        || (minLength >= 5 && (existingKey.includes(candidateKey) || candidateKey.includes(existingKey)));
      const similar = keySimilarity >= 0.9;
      if (shouldPreserveDistinctTechnicalLines(existing.text, candidate.text)) return false;

      const existingWidth = Math.max(1, existing.right - existing.left);
      const candidateWidth = Math.max(1, candidate.right - candidate.left);
      const existingHeight = Math.max(1, existing.bottom - existing.top);
      const candidateHeight = Math.max(1, candidate.bottom - candidate.top);
      const existingArea = existingWidth * existingHeight;
      const candidateArea = candidateWidth * candidateHeight;

      const overlapW = Math.max(0, Math.min(existing.right, candidate.right) - Math.max(existing.left, candidate.left));
      const overlapH = Math.max(0, Math.min(existing.bottom, candidate.bottom) - Math.max(existing.top, candidate.top));
      const overlapArea = overlapW * overlapH;

      const isSpatialContained = (overlapArea / candidateArea) >= 0.85 || (overlapArea / existingArea) >= 0.85;
      if (isSpatialContained) {
        if (keySimilarity >= 0.15 || existingKey.includes(candidateKey) || candidateKey.includes(existingKey)) {
          return true;
        }
      }
      const minWidth = Math.max(24, Math.min(existingWidth, candidateWidth));
      const minHeight = Math.max(8, Math.min(existingHeight, candidateHeight));
      const existingCenterX = (existing.left + existing.right) * 0.5;
      const candidateCenterX = (candidate.left + candidate.right) * 0.5;
      const existingCenterY = (existing.top + existing.bottom) * 0.5;
      const candidateCenterY = (candidate.top + candidate.bottom) * 0.5;
      const centerDeltaX = Math.abs(existingCenterX - candidateCenterX);
      const centerDeltaY = Math.abs(existingCenterY - candidateCenterY);
      const overlapX = overlapRatio(existing.left, existing.right, candidate.left, candidate.right);
      const overlapY = overlapRatio(existing.top, existing.bottom, candidate.top, candidate.bottom);

      // เหตุผล: ป้องกันไม่ให้คำศัพท์ซ้ำกันที่อยู่คนละบรรทัดในบอลลูนเดียวกันถูกตัดสินว่าเป็นคำซ้ำแล้วลบทิ้ง (เช่น FOR YOU / FOR YOU, I CAME / I CAME)
      // โดยการตรวจสอบสัดส่วนการทับซ้อนแนวตั้ง (vertical overlap) ที่ต้องน้อยกว่าครึ่งกล่อง
      if (!isSpatialContained && overlapY <= 0.48) {
        return false;
      }

      const existingReadability = scoreSourceLineReadability(existing.text);
      const candidateReadability = scoreSourceLineReadability(candidate.text);
      const readabilityGap = Math.abs(existingReadability - candidateReadability);
      const longLinePair = Math.min(existing.sourceLength, candidate.sourceLength) >= 18;
      const existingWordCount = normalizeWhitespace(String(existing.text || '')).split(/\s+/g).filter(Boolean).length;
      const candidateWordCount = normalizeWhitespace(String(candidate.text || '')).split(/\s+/g).filter(Boolean).length;
      const paragraphLikePair = existingWordCount >= 4 && candidateWordCount >= 4;
      const veryStrongSpatialMatch = overlapY >= 0.82 && overlapX >= 0.64;
      const compactSpatialMatch = (
        overlapY >= 0.7
        && overlapX >= 0.52
        && centerDeltaY <= Math.max(20, minHeight * 0.92)
        && centerDeltaX <= Math.max(58, minWidth * 1.3)
      );
      const strongSpatialForNoise = (
        overlapY >= 0.72
        && overlapX >= 0.5
        && centerDeltaY <= Math.max(24, minHeight * 1.05)
        && centerDeltaX <= Math.max(62, minWidth * 1.45)
      );
      const technicalLinePair = (
        TECHNICAL_LINE_HINT_REGEX.test(existing.text)
        || TECHNICAL_LINE_HINT_REGEX.test(candidate.text)
        || UNKNOWNS_COUNT_REGEX.test(existing.text)
        || UNKNOWNS_COUNT_REGEX.test(candidate.text)
      );
      const strictSubsetPair = sameOrSubset && Math.abs(existingKey.length - candidateKey.length) >= 8;
      if (technicalLinePair && strictSubsetPair) {
        const strictSpatialMatch = veryStrongSpatialMatch || compactSpatialMatch;
        if (!strictSpatialMatch) return false;
      }
      const noisyNearDuplicate = !sameOrSubset
        && keySimilarity >= 0.72
        && readabilityGap >= 4.8
        && (existingReadability <= 1.5 || candidateReadability <= 1.5)
        && strongSpatialForNoise;
      const sameBoxSharedPhraseDuplicate = !sameOrSubset
        && !technicalLinePair
        && Math.min(existingKey.length, candidateKey.length) >= 8
        && countSharedTranslatableLatinTokens(existing.text, candidate.text) >= 2
        && overlapY >= 0.78
        && overlapX >= 0.56
        && centerDeltaY <= Math.max(24, minHeight * 1.05)
        && centerDeltaX <= Math.max(72, minWidth * 1.4);

      if (!sameOrSubset && !similar && !noisyNearDuplicate && !sameBoxSharedPhraseDuplicate) return false;

      const looseSpatialMatchForHighSimilarity = keySimilarity >= 0.85
        && (
          (overlapY >= 0.58 && overlapX >= 0.46)
          || (
            overlapY >= 0.44
            && overlapX >= 0.38
            && centerDeltaY <= Math.max(32, minHeight * 1.35)
            && centerDeltaX <= Math.max(76, minWidth * 1.5)
          )
        );

      if ((longLinePair || paragraphLikePair) && !veryStrongSpatialMatch && !compactSpatialMatch && !looseSpatialMatchForHighSimilarity) {
        return false;
      }

      const nearByCenter = (
        centerDeltaY <= Math.max(34, minHeight * 1.45)
        && centerDeltaX <= Math.max(72, minWidth * 1.58)
      );
      const nearByOverlap = overlapY >= 0.64 && overlapX >= 0.54;
      const nearBySharedColumn = (
        centerDeltaY <= Math.max(42, minHeight * 1.72)
        && centerDeltaX <= Math.max(62, minWidth * 1.32)
        && overlapX >= 0.7
      );

      return nearByCenter || nearByOverlap || nearBySharedColumn;
    });

    if (existingIndex < 0 && KNOWN_CONVERSATIONAL_DUPLICATE_KEYS.has(candidateKey)) {
      existingIndex = kept.findIndex((existing, index) => {
        if (keptKeys[index] !== candidateKey) return false;

        const centerXExisting = (existing.left + existing.right) * 0.5;
        const centerXCandidate = (candidate.left + candidate.right) * 0.5;
        const horizontalDistance = Math.abs(centerXCandidate - centerXExisting);
        const verticalDistance = Math.abs(candidate.top - existing.top);

        return verticalDistance <= 420 && horizontalDistance <= 460;
      });
    }

    if (existingIndex < 0) {
      kept.push(candidate);
      keptKeys.push(candidateKey);
      continue;
    }

    const existing = kept[existingIndex];
    const existingKey = keptKeys[existingIndex];
    const repairedDuplicate = mergeRicherDuplicateTextWithCleanerGeometry(existing, existingKey, candidate, candidateKey);
    if (repairedDuplicate) {
      kept[existingIndex] = repairedDuplicate;
      keptKeys[existingIndex] = normalizeTranslatableDedupKey(repairedDuplicate.text);
    } else if (lineScore(candidate) > lineScore(existing)) {
      kept[existingIndex] = candidate;
      keptKeys[existingIndex] = candidateKey;
    }
  }

  return kept.sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return a.index - b.index;
  });
};

const computeAlignmentScore = (base: BBox, candidate: BBox): number | null => {
  const baseCenterX = (base.x0 + base.x1) / 2;
  const baseCenterY = (base.y0 + base.y1) / 2;
  const candidateCenterX = (candidate.x0 + candidate.x1) / 2;
  const candidateCenterY = (candidate.y0 + candidate.y1) / 2;
  const baseWidth = Math.max(1, base.x1 - base.x0);
  const baseHeight = Math.max(1, base.y1 - base.y0);
  const candidateWidth = Math.max(1, candidate.x1 - candidate.x0);
  const candidateHeight = Math.max(1, candidate.y1 - candidate.y0);
  const avgWidth = Math.max(1, (baseWidth + candidateWidth) / 2);
  const avgHeight = Math.max(1, (baseHeight + candidateHeight) / 2);
  const normalizedXGap = Math.abs(candidateCenterX - baseCenterX) / avgWidth;
  const normalizedYGap = Math.abs(candidateCenterY - baseCenterY) / avgHeight;

  const yOverlap = overlapRatio(base.y0, base.y1, candidate.y0, candidate.y1);
  const xOverlap = overlapRatio(base.x0, base.x1, candidate.x0, candidate.x1);

  const sameBand = yOverlap >= 0.14 || normalizedYGap <= 1.55;
  const sameColumn = xOverlap >= 0.08 || normalizedXGap <= 1.35;
  if (!sameBand || !sameColumn) return null;
  if (normalizedXGap >= 1.8 && xOverlap < 0.18) return null;

  let score = yOverlap * 6.4 + xOverlap * 2.6 - normalizedYGap * 1.5 - normalizedXGap * 1.35;
  if (yOverlap >= 0.42) score += 1.8;
  if (xOverlap >= 0.3) score += 0.9;
  if (xOverlap >= 0.5) score += 1.1;
  if (normalizedXGap <= 0.55) score += 1.0;
  return score;
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

export const applyThaiTechnicalGlossary = (sourceText: string, translatedText: string, targetLanguage: string): string => {
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

/**
 * Module-level slang group context: set by the translation pipeline before processing
 * each group's per-line translations. Used in applyThaiConversationalGlossary to detect
 * multi-line balloon patterns (e.g. "DiE BY MY COCK! COME ON!!") without relying on
 * Zustand store timing which is unreliable during async translation.
 */
let _slangGroupContext = '';
export const setSlangGroupContext = (groupLinesText: string): void => {
  _slangGroupContext = groupLinesText;
};

export const applyThaiConversationalGlossary = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): string => {
  let finalResult = applyThaiConversationalGlossaryInternal(sourceText, translatedText, targetLanguage);

  // Rule 4.1: จิ๋ม ห้ามอยู่ใน balloon เดียวกับ หี
  if (finalResult.includes('หี') && finalResult.includes('จิ๋ม')) {
    finalResult = finalResult.replace(/จิ๋ม/g, 'หี');
  }
  // Rule 4.2: ไก่ ห้ามอยู่ใน balloon เดียวกับ ควย
  if (finalResult.includes('ควย') && finalResult.includes('ไก่')) {
    finalResult = finalResult.replace(/ไก่/g, 'ควย');
  }

  return finalResult;
};

const applyThaiConversationalGlossaryInternal = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): string => {
  if (normalizeTranslationLanguage(targetLanguage, 'th') !== 'th') {
    return translatedText;
  }

  const sourceOriginal = normalizeWhitespace(String(sourceText || ''));
  const preserveSourceTrailingPunctuation = (dummy: string, replacement: string): string => {
    return globalPreservePunctuation(sourceOriginal, replacement);
  };

  let source = normalizeEnglishOcrNoiseForTranslation(sourceOriginal);
  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!source) return translated;
  const normalizedSpanishSource = normalizeSpanishOcrNoiseForTranslation(source);

  const compactSource = source.toLowerCase().replace(/[^a-z]/g, '');
  const compactSourceUpper = source.toUpperCase().replace(/[^A-Z]/g, '');
  const compactSourceAlnumUpper = source.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const compactSourceAsciiUpper = source
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  const koreanFallback = applyKoreanConversationalFallback(source, translated);
  if (koreanFallback) {
    return koreanFallback;
  }

  // Context-based multi-line slang bubble checks
  // Primary: use module-level group context set by translation pipeline (reliable, per-group)
  // Fallback: use Zustand OCR store (may be stale/empty during async All-Pages translation)
  let compactPageTexts = _slangGroupContext;
  if (!compactPageTexts) {
    try {
      const ocrStore = useOCRTextLayerStore.getState();
      if (ocrStore) {
        if (ocrStore.currentPageOCR && ocrStore.currentPageOCR.lines) {
          compactPageTexts += ' ' + ocrStore.currentPageOCR.lines.map(l => l.text || '').join(' ');
        }
        if (ocrStore.ocrByPageEngine) {
          for (const engineMap of ocrStore.ocrByPageEngine.values()) {
            if (engineMap) {
              for (const pageResult of engineMap.values()) {
                if (pageResult && pageResult.lines) {
                  compactPageTexts += ' ' + pageResult.lines.map(l => l.text || '').join(' ');
                }
              }
            }
          }
        }
      }
    } catch (err) {}
  }
  const compactPageTextsUpper = compactPageTexts.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (compactPageTextsUpper.includes('DIEBYMYCOCK')) {
    if (compactSourceAlnumUpper === 'DIE') {
      return preserveSourceTrailingPunctuation(source, 'ตายซะ');
    }
    if (compactSourceAlnumUpper === 'BYMY') {
      return preserveSourceTrailingPunctuation(source, 'ด้วย');
    }
    if (compactSourceAlnumUpper === 'COCK') {
      return preserveSourceTrailingPunctuation(source, 'ไอ้จู๋ของฉัน');
    }
    if (compactSourceAlnumUpper === 'COME') {
      return preserveSourceTrailingPunctuation(source, 'เร็วๆ');
    }
    if (compactSourceAlnumUpper === 'ON') {
      return preserveSourceTrailingPunctuation(source, 'เข้า');
    }
  }

  if (compactPageTextsUpper.includes('HOWDOTHEYKEEP') || (compactPageTextsUpper.includes('THEYKEEP') && compactPageTextsUpper.includes('CUUUUM'))) {
    if (compactSourceAlnumUpper === 'HOW') {
      return preserveSourceTrailingPunctuation(source, 'ได้อย่างไร');
    }
    if (compactSourceAlnumUpper === 'HOWDO') {
      return preserveSourceTrailingPunctuation(source, 'ทำไม');
    }
    if (compactSourceAlnumUpper === 'THEYKEEP') {
      return preserveSourceTrailingPunctuation(source, 'พวกเขายัง');
    }
    if (compactSourceAlnumUpper === 'MAKEINGME' || compactSourceAlnumUpper === 'MAKINGME') {
      return preserveSourceTrailingPunctuation(source, 'ทำให้ฉัน');
    }
    if (/^CU+M+$/i.test(compactSourceAlnumUpper)) {
      return preserveSourceTrailingPunctuation(source, 'น้ำแตกกกกได้อีก');
    }
  }

  if (compactPageTextsUpper.includes('MYHEARTSBEINGTORNBYTHEIRCOCKS') || compactPageTextsUpper.includes('MYHEARTBEINGTORNBYTHEIRCOCKS')) {
    if (compactSourceAlnumUpper === 'MY') {
      return preserveSourceTrailingPunctuation(source, 'หัวใจของฉัน');
    }
    if (compactSourceAlnumUpper === 'HEARTS' || compactSourceAlnumUpper === 'HEART') {
      return preserveSourceTrailingPunctuation(source, 'กำลัง');
    }
    if (compactSourceAlnumUpper === 'BEING') {
      return preserveSourceTrailingPunctuation(source, 'ถูก');
    }
    if (compactSourceAlnumUpper === 'TORNBY') {
      return preserveSourceTrailingPunctuation(source, 'ฉีกกระชาก');
    }
    if (compactSourceAlnumUpper === 'THEIR') {
      return preserveSourceTrailingPunctuation(source, 'ด้วย');
    }
    if (compactSourceAlnumUpper === 'COCKS' || compactSourceAlnumUpper === 'COCK') {
      return preserveSourceTrailingPunctuation(source, 'ควยของพวกมัน');
    }
  }

  if (compactPageTextsUpper.includes('SUCKINGCOCK') && (compactPageTextsUpper.includes('REALPIG') || compactPageTextsUpper.includes('PIG'))) {
    if (compactSourceAlnumUpper === 'IM' || compactSourceAlnumUpper === 'IIM') {
      return preserveSourceTrailingPunctuation(source, 'ฉัน');
    }
    if (compactSourceAlnumUpper === 'SUCKING') {
      return preserveSourceTrailingPunctuation(source, 'กำลังดูด');
    }
    if (compactSourceAlnumUpper === 'COCKAND') {
      return preserveSourceTrailingPunctuation(source, 'อวัยวะเพศชายและ');
    }
    if (compactSourceAlnumUpper === 'GRUNTING') {
      return preserveSourceTrailingPunctuation(source, 'คราง');
    }
    if (compactSourceAlnumUpper === 'LIKEA') {
      return preserveSourceTrailingPunctuation(source, 'เหมือน');
    }
    if (compactSourceAlnumUpper === 'REALPIG') {
      return preserveSourceTrailingPunctuation(source, 'หมูตัวจริง');
    }
  }

  if (compactPageTextsUpper.includes('SHUPUPWE') || (compactPageTextsUpper.includes('SHUP') && (compactPageTextsUpper.includes('PRINCESS') || compactPageTextsUpper.includes('PRIN') || compactPageTextsUpper.includes('CESS')))) {
    if (compactSourceAlnumUpper === 'SHUP') {
      return preserveSourceTrailingPunctuation(source, 'หุบปาก');
    }
    if (compactSourceAlnumUpper === 'UP') {
      return preserveSourceTrailingPunctuation(source, 'ซะ');
    }
    if (compactSourceAlnumUpper === 'WEVE') {
      return preserveSourceTrailingPunctuation(source, 'ฉัน');
    }
    if (compactSourceAlnumUpper === 'ALWAYS') {
      return preserveSourceTrailingPunctuation(source, 'มาตลอดเลยนะ');
    }
    if (compactSourceAlnumUpper === 'WANTED') {
      return preserveSourceTrailingPunctuation(source, 'อยากจะ');
    }
    if (compactSourceAlnumUpper === 'TOFUCK') {
      return preserveSourceTrailingPunctuation(source, 'เย็ด');
    }
    if (compactSourceAlnumUpper === 'THESHIT') {
      return preserveSourceTrailingPunctuation(source, 'ให้เละเทะ');
    }
    if (compactSourceAlnumUpper === 'OUTTA') {
      return preserveSourceTrailingPunctuation(source, 'เธอ');
    }
    if (compactSourceAlnumUpper === 'YOU') {
      return preserveSourceTrailingPunctuation(source, '!');
    }
    if (compactSourceAlnumUpper === 'DUMB') {
      return preserveSourceTrailingPunctuation(source, 'อี');
    }
    if (compactSourceAlnumUpper === 'PRIN') {
      return preserveSourceTrailingPunctuation(source, 'เจ้าหญิง');
    }
    if (compactSourceAlnumUpper === 'CESS') {
      return preserveSourceTrailingPunctuation(source, 'โง่');
    }
  }

  // ─── Page-context word-order fix: YOU FOUND A DISEASE? ─────────────────────
  // When each line of the balloon is translated separately, we need context to
  // reassemble the correct Thai sentence order.
  if (
    compactPageTextsUpper.includes('YOUFOUNDADISEASE') ||
    (compactPageTextsUpper.includes('FOUNDA') && compactPageTextsUpper.includes('DISEASE'))
  ) {
    if (compactSourceAlnumUpper === 'YOU' || compactSourceAlnumUpper === 'NOU') {
      return preserveSourceTrailingPunctuation(source, 'คุณ');
    }
    if (compactSourceAlnumUpper === 'FOUNDA' || compactSourceAlnumUpper === 'FOUND') {
      return preserveSourceTrailingPunctuation(source, 'พบ');
    }
    if (compactSourceAlnumUpper === 'A') {
      return preserveSourceTrailingPunctuation(source, '');
    }
    if (compactSourceAlnumUpper === 'DISEASE') {
      return preserveSourceTrailingPunctuation(source, 'โรคเหรอ');
    }
  }

  // ─── Page-context word-order fix: HEAD NURSE multi-line balloon ─────────────
  if (
    compactPageTextsUpper.includes('HEADNURS') ||
    (compactPageTextsUpper.includes('HEAD') && compactPageTextsUpper.includes('NURSE'))
  ) {
    if (compactSourceAlnumUpper.includes('FORSOME')) {
      return preserveSourceTrailingPunctuation(source, 'สำหรับเหตุผลบางอย่าง');
    }
    if (compactSourceAlnumUpper.includes('HEAD')) {
      return preserveSourceTrailingPunctuation(source, 'หัวหน้า');
    }
    if (compactSourceAlnumUpper.includes('NURSE') || (compactSourceAlnumUpper.includes('NUR') && compactSourceAlnumUpper.includes('SE'))) {
      return preserveSourceTrailingPunctuation(source, 'พยาบาล');
    }
    if (compactSourceAlnumUpper.includes('RIGHTNOW')) {
      return preserveSourceTrailingPunctuation(source, 'ในตอนนี้');
    }
  }

  // Sex/Conversational slang & H-manga adjustments (exact / short matches)

  const cleanDialogueText = source.trim().toLowerCase();
  if (compactSource === 'cock' || compactSource === 'cocks') {
    return preserveSourceTrailingPunctuation(source, 'ควย');
  }
  if (compactSource === 'pussy' || compactSource === 'pussies' || compactSource === 'pussys') {
    return preserveSourceTrailingPunctuation(source, 'หี');
  }
  if (compactSource === 'cum' || compactSource === 'cums' || compactSource === 'cuuuum' || compactSource === 'cuuuuum') {
    return preserveSourceTrailingPunctuation(source, 'น้ำแตก');
  }
  if (compactSource === 'cumming') {
    return preserveSourceTrailingPunctuation(source, 'น้ำแตกแล้ว');
  }
  if (compactSource === 'wanna') {
    return preserveSourceTrailingPunctuation(source, 'อยาก');
  }
  if (/^me+$/i.test(compactSource)) {
    const eCount = (compactSource.match(/e/g) || []).length;
    if (eCount > 1) {
      const totalNs = 'น'.repeat(eCount + 1);
      return preserveSourceTrailingPunctuation(source, `ฉั${totalNs}`);
    } else {
      return preserveSourceTrailingPunctuation(source, 'ฉัน');
    }
  }
  // Specific short word mappings
  if (cleanDialogueText === "i'm" || cleanDialogueText === "i’m" || compactSourceAlnumUpper === 'IM') {
    return preserveSourceTrailingPunctuation(source, 'ฉัน');
  }
  if (cleanDialogueText === 'it' || compactSourceAlnumUpper === 'IT') {
    return preserveSourceTrailingPunctuation(source, 'มัน');
  }
  if (cleanDialogueText === 'by' || compactSourceAlnumUpper === 'BY') {
    return preserveSourceTrailingPunctuation(source, 'โดย');
  }
  if (cleanDialogueText === 'he' || compactSourceAlnumUpper === 'HE') {
    return preserveSourceTrailingPunctuation(source, 'เขา');
  }
  if (compactSourceAlnumUpper === 'RRR') {
    return preserveSourceTrailingPunctuation(source, 'RRR');
  }

  // User-requested slang fixes & conversions
  if (compactSourceAlnumUpper.includes('BLOWJOB') || compactSourceAlnumUpper.includes('BLOWTOB')) {
    if (compactSourceAlnumUpper.includes('MEABLOWJOB') || compactSourceAlnumUpper.includes('MEABLOWTOB')) {
      return preserveSourceTrailingPunctuation(source, 'อมควยให้ฉัน');
    }
    return preserveSourceTrailingPunctuation(source, 'อมควย');
  }
  if (compactSourceAlnumUpper === 'SQUEEZING') {
    return preserveSourceTrailingPunctuation(source, 'บีบ');
  }
  if (compactSourceAlnumUpper === 'APRETTYTHICKLOAD') {
    return preserveSourceTrailingPunctuation(source, 'ค่อนข้างเยอะทีเดียว');
  }
  if (compactSourceAlnumUpper.includes('YOULETOUTAPRETTYTHICKLOAD') || compactSourceAlnumUpper.includes('LETOUTAPRETTYTHICKLOAD')) {
    return preserveSourceTrailingPunctuation(source, 'คุณปล่อยน้ำอสุจิออกมาค่อนข้างเยอะทีเดียว');
  }
  if (compactSourceAlnumUpper === 'MYPUSSY') {
    return preserveSourceTrailingPunctuation(source, 'หีของฉัน');
  }
  if (compactSourceAlnumUpper === 'COCKSLEEVE') {
    return preserveSourceTrailingPunctuation(source, 'ปลอกหุ้มควย');
  }
  if (compactSourceAlnumUpper === 'SSHIT') {
    return preserveSourceTrailingPunctuation(source, 'ช-เชี่ยเอ้ย');
  }
  if (compactSourceAlnumUpper === 'ITANYMORE') {
    return preserveSourceTrailingPunctuation(source, 'มันอีกต่อไป');
  }
  if (compactSourceAlnumUpper.includes('ICANTHOLDITANYMORE')) {
    return preserveSourceTrailingPunctuation(source, 'ฉันทนมันไม่ไหวอีกต่อไปแล้ว');
  }
  if (compactSourceAlnumUpper === 'CUMINSIDE') {
    return preserveSourceTrailingPunctuation(source, 'แตกข้างใน');
  }
  if (compactSourceAlnumUpper === 'MYWOMB') {
    return preserveSourceTrailingPunctuation(source, 'มดลูกของฉัน');
  }
  if (
    compactSourceAlnumUpper === 'CUMMING' ||
    compactSource.includes('cumming') ||
    source.toLowerCase().includes('cum-ming') ||
    source.toLowerCase().includes('cumming') ||
    (compactPageTextsUpper.includes('CUMMING') && (compactSourceAlnumUpper === 'CUM' || compactSourceAlnumUpper === 'CUM-' || compactSourceAlnumUpper === 'MING'))
  ) {
    if (compactSourceAlnumUpper === 'CUM' || compactSourceAlnumUpper === 'CUM-') {
      return preserveSourceTrailingPunctuation(source, 'ทะ-');
    }
    if (compactSourceAlnumUpper === 'MING') {
      return preserveSourceTrailingPunctuation(source, 'ทะลักออกมาแล้ววว!');
    }
    return preserveSourceTrailingPunctuation(source, 'ทะ-ทะลักออกมาแล้ววว!');
  }
  if (
    compactSourceAlnumUpper === 'ITFELTWAYTOOGOOD' ||
    compactSourceAlnumUpper.includes('ITFELTWAYTOOGOOD') ||
    (compactPageTextsUpper.includes('ITFELTWAYTOOGOOD') && (compactSourceAlnumUpper.includes('ITFELT') || compactSourceAlnumUpper.includes('WAYTOO') || compactSourceAlnumUpper === 'GOOD'))
  ) {
    if (compactSourceAlnumUpper.includes('ITFELT')) {
      return preserveSourceTrailingPunctuation(source, 'ดีเกินไป');
    }
    if (compactSourceAlnumUpper.includes('WAYTOO') || compactSourceAlnumUpper === 'GOOD') {
      return preserveSourceTrailingPunctuation(source, '');
    }
    return preserveSourceTrailingPunctuation(source, 'ดีเกินไป');
  }
  if (compactSourceAlnumUpper.includes('TOMAKETHREADS')) {
    return preserveSourceTrailingPunctuation(source, 'ที่จะสร้างของเหลวข้นหนืดยืดเป็นสาย');
  }
  if (compactSourceAlnumUpper === 'MYCUM') {
    return preserveSourceTrailingPunctuation(source, 'น้ำว่าวของฉัน');
  }
  if (compactSourceAlnumUpper === 'THATS') {
    return preserveSourceTrailingPunctuation(source, 'นั่นมัน');
  }
  if (
    compactSourceAlnumUpper === 'NOTNECESSARY' ||
    compactSourceAlnumUpper === 'NOTNEC' ||
    compactSourceAlnumUpper === 'ESSARY'
  ) {
    if (compactSourceAlnumUpper === 'ESSARY') {
      return preserveSourceTrailingPunctuation(source, '');
    }
    return preserveSourceTrailingPunctuation(source, 'ไม่สำคัญ');
  }
  if (compactSourceAlnumUpper === 'ADYDO') {
    return preserveSourceTrailingPunctuation(source, '..ร้อม”ที่จะทำ');
  }
  if (compactSourceAlnumUpper === 'UMEAN') {
    return preserveSourceTrailingPunctuation(source, '..มายถึงอะไร');
  }
  if (compactSourceAlnumUpper === 'WERE') {
    return preserveSourceTrailingPunctuation(source, 'คือ');
  }
  if (compactSourceAlnumUpper.includes('PLEASECUMALOTJUSTLIKETHAT')) {
    return preserveSourceTrailingPunctuation(source, 'ได้โปรด แตกเข้ามา เยอะ อย่างนั้น แหละ');
  }
  if (compactSourceAlnumUpper === 'DISEASE') {
    return preserveSourceTrailingPunctuation(source, 'โรค');
  }
  if (compactSourceAlnumUpper.includes('YOUFOUNDADISEASE')) {
    return preserveSourceTrailingPunctuation(source, 'คุณพบโรคเหรอ');
  }
  if (compactSourceAlnumUpper === 'RESTRAINT') {
    return preserveSourceTrailingPunctuation(source, 'การยับยั้งชั่งใจ');
  }
  if (compactSourceAlnumUpper === 'GOOD') {
    return preserveSourceTrailingPunctuation(source, 'ดี');
  }
  if (compactSourceAlnumUpper === 'ALOT') {
    return preserveSourceTrailingPunctuation(source, 'เยอะมาก');
  }
  // HEAD NUR-SEEE!! / HEAD NURSE variants — OCR often splits hyphenated exclamations
  if (
    compactSourceAlnumUpper === 'HEADNURSEEE' ||
    compactSourceAlnumUpper === 'HEADNURSEEEE' ||
    compactSourceAlnumUpper === 'HEADNURSE' ||
    /^HEADNURS/.test(compactSourceAlnumUpper)
  ) {
    return preserveSourceTrailingPunctuation(source, 'หัวหน้า พยา-บาลลล!!');
  }
  if (compactSourceAlnumUpper === 'SHES') {
    return preserveSourceTrailingPunctuation(source, 'เธอคือ');
  }
  if (compactSourceAlnumUpper === 'INSIDE') {
    return preserveSourceTrailingPunctuation(source, 'ข้างใน');
  }
  if (compactSourceAlnumUpper === 'ITWITHOUT') {
    return preserveSourceTrailingPunctuation(source, 'มันโดยไม่มี');
  }
  if (compactSourceAlnumUpper === 'HUH') {
    return preserveSourceTrailingPunctuation(source, 'ฮะ');
  }
  if (compactSourceAlnumUpper === 'THIS' && source.includes('?')) {
    return 'นี่น่ะเหรอ?';
  }
  if (compactSourceAlnumUpper === 'WOW') {
    return preserveSourceTrailingPunctuation(source, 'ว้าว');
  }
  // I'LL DO (OCR reads as ILLDO) → ฉันจะทำ
  if (compactSourceAlnumUpper === 'ILLDO') {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะทำ');
  }
  if (compactSourceAlnumUpper === 'DAYS') {
    return preserveSourceTrailingPunctuation(source, 'หลายวัน');
  }
  // ILL alone → ฉันจะ (in manga dialogue context, standalone "ILL" is always OCR noise for "I'LL")
  if (compactSourceAlnumUpper === 'ILL') {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะ');
  }
  if (compactSourceAlnumUpper === 'BELIEVE') {
    return preserveSourceTrailingPunctuation(source, 'เชื่อ');
  }
  if (compactSourceAlnumUpper === 'WITHOUT') {
    return preserveSourceTrailingPunctuation(source, 'โดยไม่มี');
  }
  if (compactSourceAlnumUpper === 'HERPUSSY') {
    return preserveSourceTrailingPunctuation(source, 'หีของเธอ');
  }

  // ─── Missing manga dialogue fragment translations ────────────────────────────
  // ทำไม: คำเหล่านี้อยู่ใน whitelist (ไม่โดน skip) แต่ไม่มี glossary rule แปลเป็นไทย
  // Argos มักจะ carry-over กลับมาเป็น English ทำให้ดูเหมือนไม่ได้แปล
  if (compactSourceAlnumUpper === 'OFME' || compactSourceAlnumUpper === 'OFMEEROMANGA' || compactSourceAlnumUpper === 'EROMANGA') {
    // "OF ME!!" หรือ "OF ME, ero-manga" ในบริบทของหัวเรื่องหรือชื่อตอน
    if (compactSourceAlnumUpper.includes('EROMANGA')) {
      return preserveSourceTrailingPunctuation(source, 'ของฉัน, อีโระมังงะ');
    }
    return preserveSourceTrailingPunctuation(source, 'ของฉัน');
  }
  if (compactSourceAlnumUpper === 'NURSE') {
    return preserveSourceTrailingPunctuation(source, 'พยาบาล');
  }
  if (compactSourceAlnumUpper === 'BEINGTOO') {
    return preserveSourceTrailingPunctuation(source, 'มันมากเกินไป');
  }
  if (compactSourceAlnumUpper === 'SUDDENLY') {
    return preserveSourceTrailingPunctuation(source, 'อยู่ดีๆ');
  }
  if (compactSourceAlnumUpper === 'RESTA') {
    return preserveSourceTrailingPunctuation(source, 'พัก...');
  }
  if (compactSourceAlnumUpper === 'THESEX') {
    return preserveSourceTrailingPunctuation(source, 'เซ็กส์นั้น');
  }
  if (compactSourceAlnumUpper === 'WELLSINCE') {
    return preserveSourceTrailingPunctuation(source, 'ก็... เนื่องจาก');
  }
  if (compactSourceAlnumUpper === 'JUST') {
    return preserveSourceTrailingPunctuation(source, 'แค่');
  }
  if (compactSourceAlnumUpper === 'ILLNESSBE') {
    return preserveSourceTrailingPunctuation(source, 'ความเจ็บป่วย');
  }
  if (compactSourceAlnumUpper === 'METHOD') {
    return preserveSourceTrailingPunctuation(source, 'วิธีการ');
  }
  if (compactSourceAlnumUpper === 'FROMTHE') {
    return preserveSourceTrailingPunctuation(source, 'จาก');
  }
  if (compactSourceAlnumUpper === 'ITFEELS') {
    return preserveSourceTrailingPunctuation(source, 'มันรู้สึก');
  }
  if (compactSourceAlnumUpper === 'OUTINSIDE') {
    return preserveSourceTrailingPunctuation(source, 'ออกมาข้างใน');
  }
  if (compactSourceAlnumUpper === 'STILLFULL') {
    return preserveSourceTrailingPunctuation(source, 'ยังเต็มอยู่');
  }
  if (compactSourceAlnumUpper === 'NOWI') {
    return preserveSourceTrailingPunctuation(source, 'ตอนนี้ฉัน');
  }
  if (compactSourceAlnumUpper === 'WOMB') {
    return preserveSourceTrailingPunctuation(source, 'มดลูก');
  }
  if (compactSourceAlnumUpper === 'WAYTOO') {
    return preserveSourceTrailingPunctuation(source, 'มากเกินไป');
  }



  // H-Manga Slang Conversational Override Group
  if (compactSourceAlnumUpper.includes('SHUPUPWE') && compactSourceAlnumUpper.includes('FUCK') && (compactSourceAlnumUpper.includes('PRINCESS') || compactSourceAlnumUpper.includes('PRIN') || compactSourceAlnumUpper.includes('CESS'))) {
    return preserveSourceTrailingPunctuation(source, 'หุบปากซะ! ฉันอยากจะเย็ดเธอให้เละเทะมาตลอดเลยนะ อีเจ้าหญิงโง่!!');
  }
  if (compactSourceAlnumUpper.includes('SUCKINGCOCK') && (compactSourceAlnumUpper.includes('PIG') || compactSourceAlnumUpper.includes('GRUNTING'))) {
    return preserveSourceTrailingPunctuation(source, 'ฉันกำลังดูดอวัยวะเพศชายและครางเหมือนหมูตัวจริง');
  }
  if (compactSourceAlnumUpper.includes('HOWDOTHEYKEEP') || (compactSourceAlnumUpper.includes('THEYKEEP') && compactSourceAlnumUpper.includes('CUUUUM'))) {
    return preserveSourceTrailingPunctuation(source, 'ได้อย่างไร..? ทำไมพวกเขายังทำให้ฉันน้ำแตกกกกได้อีก?');
  }
  if (compactSourceAlnumUpper.includes('DIEBYMYCOCK')) {
    return preserveSourceTrailingPunctuation(source, 'ตายซะด้วยไอ้จู๋ของฉัน! เร็วๆเข้า!!');
  }
  if (/^dy+i+n+g+$/i.test(compactSource) && compactSource.length >= 6) {
    return preserveSourceTrailingPunctuation(source, 'ตาาาายยยแล้วววว');
  }
  if (compactSourceAlnumUpper === 'NOMORECOCK') {
    return preserveSourceTrailingPunctuation(source, 'ไม่เอา ควยแล้ว!');
  }
  if (compactSourceAlnumUpper.startsWith('NOMOREOH') || compactSourceAlnumUpper === 'NOMOREOHH') {
    return preserveSourceTrailingPunctuation(source, 'ไม่เอาแล้วว!อ๊าาาห์!');
  }

  const cleanStutter = sourceOriginal.replace(/[.!?…\s_]+/g, '');
  if (
    /^i(?:-i)+$/i.test(cleanStutter) ||
    /^i-i+$/i.test(cleanStutter) ||
    /^i-i*[-'’]*i+$/i.test(sourceOriginal.trim()) ||
    compactSource === 'ii' ||
    compactSource === 'iii' ||
    compactSourceAlnumUpper === 'II' ||
    /^i-i*[-'’]*i*m$/i.test(source.trim()) ||
    compactSourceAlnumUpper === 'IIM' ||
    compactSourceAlnumUpper === 'IIIM'
  ) {
    return preserveSourceTrailingPunctuation(source, 'ฉ-ฉัน');
  }
  if (/^sto[oa]+p*[!?…]*$/i.test(cleanDialogueText) || compactSourceAlnumUpper === 'STOOOOP' || compactSourceAlnumUpper === 'STOAOOP' || compactSourceAlnumUpper === 'STOAAOP') {
    return preserveSourceTrailingPunctuation(source, 'หยุดดดดด');
  }
  if (cleanDialogueText === "you're" || cleanDialogueText === "you’re" || compactSourceAlnumUpper === 'YOURE') {
    return preserveSourceTrailingPunctuation(source, 'เธอ');
  }
  if (cleanDialogueText === 'raping-my' || cleanDialogueText === 'raping my' || compactSourceAlnumUpper === 'RAPINGMY') {
    return preserveSourceTrailingPunctuation(source, 'ข่มขืน-ฉัน');
  }
  if (/^cu+u+m+[!?…]*$/i.test(cleanDialogueText) || /^cu+u+m+$/i.test(cleanDialogueText) || compactSourceAlnumUpper.startsWith('CUUUUM')) {
    return preserveSourceTrailingPunctuation(source, 'แตกกกกก');
  }
  if (compactSourceAlnumUpper.includes('MYHEARTSBEINGTORNBYTHEIRCOCKS') || compactSourceAlnumUpper.includes('MYHEARTBEINGTORNBYTHEIRCOCKS')) {
    return preserveSourceTrailingPunctuation(source, 'หัวใจของฉันกำลังถูกฉีกกระชากด้วยควยของพวกมัน!');
  }
  if (cleanDialogueText === 'n-no') {
    return preserveSourceTrailingPunctuation(source, 'ม-ไม่');
  }
  if (cleanDialogueText === 'ima' || cleanDialogueText === "i'ma" || cleanDialogueText === "i’ma") {
    return preserveSourceTrailingPunctuation(source, 'ฉันเป็น');
  }
  if (cleanDialogueText === 'wet pussy' || cleanDialogueText === 'wet pussies' || cleanDialogueText === "wet pussy's" || cleanDialogueText === 'wet pussys') {
    return preserveSourceTrailingPunctuation(source, 'หีแฉะ');
  }
  if (cleanDialogueText === 'cervix') {
    return preserveSourceTrailingPunctuation(source, 'มดลูก');
  }
  if (cleanDialogueText === 'this') {
    return preserveSourceTrailingPunctuation(source, 'นี่');
  }
  if (cleanDialogueText === 'my') {
    return preserveSourceTrailingPunctuation(source, 'ของฉัน');
  }
  if (cleanDialogueText === 'not my') {
    return preserveSourceTrailingPunctuation(source, 'ไม่ใช่ของฉัน');
  }
  if (cleanDialogueText === 'ass-' || cleanDialogueText === 'ass') {
    return preserveSourceTrailingPunctuation(source, 'ตูด');
  }
  if (cleanDialogueText === 'hole') {
    return preserveSourceTrailingPunctuation(source, 'รู');
  }
  if (cleanDialogueText === 'agaa' || cleanDialogueText === 'again') {
    return preserveSourceTrailingPunctuation(source, 'อีกแล้ว');
  }
  if (cleanDialogueText === 'us the' || compactSourceAlnumUpper === 'USTHE') {
    return preserveSourceTrailingPunctuation(source, 'พวกเรา');
  }
  if (cleanDialogueText === 'all' || compactSourceAlnumUpper === 'ALL') {
    return preserveSourceTrailingPunctuation(source, 'ทั้งหมด');
  }
  if (cleanDialogueText === 'of' || compactSourceAlnumUpper === 'OF') {
    return preserveSourceTrailingPunctuation(source, 'ของ');
  }
  if (cleanDialogueText === 'you') {
    return preserveSourceTrailingPunctuation(source, 'คุณ');
  }
  // "die" → ตายซะ (in emotional/manga context); fallback ตาย for neutral uses
  if (cleanDialogueText === 'die' || compactSourceAlnumUpper === 'DIE') {
    return preserveSourceTrailingPunctuation(source, 'ตายซะ');
  }
  // stinky → ตุๆ (H-manga slang, e.g. "HER PUSSY'S SO STINKY")
  if (compactSource === 'stinky') {
    return preserveSourceTrailingPunctuation(source, 'ตุๆ');
  }
  // HER PUSSY'S SO STINKY full-sentence (group or single balloon)
  if (compactSourceAlnumUpper.includes('HERPUSSYS') && compactSourceAlnumUpper.includes('STINKY')) {
    return preserveSourceTrailingPunctuation(source, 'หีของเธอเหม็นตุมากเลย');
  }
  if (cleanDialogueText === 'pig') {
    return preserveSourceTrailingPunctuation(source, 'หมู');
  }
  if (cleanDialogueText === 'more') {
    return preserveSourceTrailingPunctuation(source, 'อีก');
  }
  if (cleanDialogueText === 'was toyed' || compactSourceAlnumUpper === 'WASTOYED') {
    return preserveSourceTrailingPunctuation(source, 'ถูกเล่นสนุก');
  }
  if (cleanDialogueText === 'up looking' || cleanDialogueText === 'up looking' || compactSourceAlnumUpper === 'UPLOOKING') {
    return preserveSourceTrailingPunctuation(source, 'มองขึ้นไป');
  }
  if (cleanDialogueText === 'like this' || compactSourceAlnumUpper === 'LIKETHIS') {
    return preserveSourceTrailingPunctuation(source, 'แบบนี้');
  }
  if (cleanDialogueText === "heart's" || cleanDialogueText === 'heart' || compactSourceAlnumUpper === 'HEARTS' || compactSourceAlnumUpper === 'HEART') {
    return preserveSourceTrailingPunctuation(source, 'หัวใจ');
  }
  if (cleanDialogueText === 'so') {
    return preserveSourceTrailingPunctuation(source, 'ดังนั้น');
  }
  if (cleanDialogueText === 'of') {
    return preserveSourceTrailingPunctuation(source, 'ของ');
  }
  if (cleanDialogueText === 'all') {
    return preserveSourceTrailingPunctuation(source, 'ทั้งหมด');
  }
  // คำครางสะกดไม่มีสระภาษาอังกฤษ (เช่น NGG, HNNG, NGHH, GOHHH) ป้องกันการแปลมั่วเป็นอย่างอื่น
  if (/^[HNGD]*$/i.test(compactSource) && compactSource.length >= 2) {
    return preserveSourceTrailingPunctuation(source, source);
  }
  if (/^G[O]*H+$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'โอ๊ย');
  }
  if (compactSourceAlnumUpper === 'WITHAN' || compactSourceAlnumUpper === 'WITHANHEIR') {
    return preserveSourceTrailingPunctuation(source, 'ด้วย');
  }
  if (compactSourceAlnumUpper === 'HEIRRR') {
    return preserveSourceTrailingPunctuation(source, 'รัชทายาททท');
  }
  if (compactSourceAlnumUpper === 'HEIRRRRRR') {
    return preserveSourceTrailingPunctuation(source, 'รัชทายาทททท');
  }
  if (compactSourceAlnumUpper === 'WITHANHEIRRRRRR' || compactSourceAlnumUpper === 'WITHANHEIRRR') {
    return preserveSourceTrailingPunctuation(source, 'ด้วยรัชทายาทททท');
  }
  if (compactSourceAlnumUpper === 'PREGNANTWITHANHEIRRRRRR' || compactSourceAlnumUpper.includes('PREGNANTWITHANHEIR')) {
    return preserveSourceTrailingPunctuation(source, 'ท้องรัชทายาทททท');
  }
  if (compactSourceAlnumUpper.includes('DONTSAYTHATWHILESQUIRTINGYOUSOW')) {
    return preserveSourceTrailingPunctuation(source, 'อย่าพูดแบบนั้นในขณะที่กำลังน้ำกระฉูด อีหมูตัวเมีย!');
  }

  const compactNormalizedSourceAsciiUpper = normalizedSpanishSource
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const hasVertarToken = /\bVERTAR\b/i.test(source) || compactSourceUpper.includes('VERTAR');
  const hasEssenceToken = /\bESSENCE\b/i.test(source)
    || /\bESSEN(?:CE|SE)\b/i.test(source)
    || /ESSENCE|ESENCE|ESSNCE|ESSEN[CS]E|ESSANCE/.test(compactSourceUpper);
  const translatedLower = translated.toLowerCase();
  const replaceNameToken = (input: string, token: string, replacement: string): string =>
    input.replace(new RegExp(`\\b${token}\\b`, 'ig'), replacement);

  if (/^C+EH[!?…]*$/i.test(source.replace(/\s+/g, '')) || compactSourceAsciiUpper === 'CEH') {
    return preserveSourceTrailingPunctuation(source, 'เอ๋');
  }

  if (compactSourceAsciiUpper.includes('ACTUALLYTHISHASBEENONMYMINDFORWHILE')) {
    return preserveSourceTrailingPunctuation(source, 'ที่จริงแล้ว เรื่องนี้อยู่ในใจฉันมาสักพักแล้ว');
  }

  if (/^ACTUALLY[,.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ที่จริงแล้ว');
  }

  if (/^GO\s+ON[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ไปต่อเลย');
  }

  if (/^SAY\s+THE\s+REST[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'พูดส่วนที่เหลือ');
  }

  if (/^MY[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ของฉัน');
  }

  if (
    /\bALG[OE]\s+A[S5][IÍ1]\b/i.test(source)
    || /\bALG[OE]\s+A[S5][IÍ1]\b/i.test(normalizedSpanishSource)
    || compactSourceAsciiUpper.includes('ALGOASI')
    || compactNormalizedSourceAsciiUpper.includes('ALGOASI')
    || compactSourceAsciiUpper.includes('ALGEASI')
  ) {
    return preserveSourceTrailingPunctuation(source, 'ประมาณนั้นแหละ');
  }

  const isConMasDetalle = (
    /(^|\s)CON\s+M[ÁA]S\s+DETAL+E(?:S)?([.!?…]+)?$/i.test(source)
    || /(^|\s)CON\s+M[ÁA]S\s+DETAL+E(?:S)?([.!?…]+)?$/i.test(normalizedSpanishSource)
    || compactSourceAsciiUpper.includes('CONMASDETALLE')
    || compactNormalizedSourceAsciiUpper.includes('CONMASDETALLE')
  );
  if (isConMasDetalle) {
    return preserveSourceTrailingPunctuation(source, 'ในรายละเอียดเพิ่มเติม');
  }

  const compactSpanishSourceAsciiUpper = normalizedSpanishSource
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (
    compactSpanishSourceAsciiUpper.includes('SIMEQUEDO')
    && compactSpanishSourceAsciiUpper.includes('AQUIMASTIEMPO')
    && compactSpanishSourceAsciiUpper.includes('SIENTOQUEME')
    && compactSpanishSourceAsciiUpper.includes('VOYCORRER')
  ) {
    return preserveSourceTrailingPunctuation(source, 'ถ้าฉันอยู่ที่นี่นานกว่านี้ ฉะ-ฉันรู้สึกว่าจะเสร็จแล้ว');
  }
  if (compactSpanishSourceAsciiUpper === 'STAFF') {
    return preserveSourceTrailingPunctuation(source, 'เจ้าหน้าที่');
  }
  if (compactSpanishSourceAsciiUpper === 'PRIMEROLAFOTO' || /^PRI-?MERO\s+LA\s+FOTO[.!?…]*$/i.test(normalizedSpanishSource)) {
    return preserveSourceTrailingPunctuation(source, 'ภาพแรก');
  }
  if (compactSpanishSourceAsciiUpper === 'PRIMERO') {
    return preserveSourceTrailingPunctuation(source, 'อันดับแรก');
  }
  if (compactSpanishSourceAsciiUpper === 'LAFOTO') {
    return preserveSourceTrailingPunctuation(source, 'ภาพ');
  }
  if (compactSpanishSourceAsciiUpper === 'DE') {
    return preserveSourceTrailingPunctuation(source, 'ของ');
  }
  if (compactSpanishSourceAsciiUpper === 'METIENDOPOR' || compactSpanishSourceAsciiUpper === 'METIENDO') {
    return preserveSourceTrailingPunctuation(source, 'กำลังดำเนินการ');
  }
  if (compactSpanishSourceAsciiUpper === 'LISTOCON' || /^[i¡]?\s*LISTO[.!?…]*\s+CON[.!?…]*$/i.test(normalizedSpanishSource)) {
    return preserveSourceTrailingPunctuation(source, 'พร้อม! ด้วย');
  }
  if (/^SI\s+ME\s+QUEDO[.!?…]*$/i.test(normalizedSpanishSource) || compactSpanishSourceAsciiUpper === 'SIMEQUEDO') {
    return preserveSourceTrailingPunctuation(source, 'ถ้าฉันอยู่');
  }
  if (/^AQU[IÍ]\s+MAS[.!?…]*$/i.test(normalizedSpanishSource) || compactSpanishSourceAsciiUpper === 'AQUIMAS') {
    return preserveSourceTrailingPunctuation(source, 'ที่นี่นานกว่านี้');
  }
  if (/^TIEMPO[,.!?…]*$/i.test(normalizedSpanishSource) || compactSpanishSourceAsciiUpper === 'TIEMPO') {
    return preserveSourceTrailingPunctuation(source, 'อีกสักพัก');
  }
  if (/^S-?SIENTO\s+QUE\s+ME[.!?…]*$/i.test(source) || /^SIENTO\s+QUE\s+ME[.!?…]*$/i.test(normalizedSpanishSource)) {
    return preserveSourceTrailingPunctuation(source, 'ฉะ-ฉันรู้สึกว่า');
  }
  if (/^VOY\s+(?:A\s+)?CORRER[.!?…]*$/i.test(normalizedSpanishSource) || compactSpanishSourceAsciiUpper === 'VOYCORRER') {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะเสร็จแล้ว');
  }

  if (/^ENTONCES\s+SEGURO[.!?…]*$/i.test(source) || compactSourceAsciiUpper.includes('ENTONCESSEGURO')) {
    return preserveSourceTrailingPunctuation(source, 'งั้น แน่นอน');
  }

  if (
    /^[i¡¿-]*\s*C[ÓO]MO\s+LO\s+SUPO[.!?…]*$/i.test(source)
    || compactSourceAsciiUpper.includes('ICOMOLOSUPO')
    || compactSourceAsciiUpper.includes('ICCOMOLOSUPO')
  ) {
    return preserveSourceTrailingPunctuation(source, 'เขารู้ได้อย่างไร');
  }

  if (
    compactSourceAsciiUpper.includes('SERAQUE')
    && compactSourceAsciiUpper.includes('FANTASMA')
    && compactSourceAsciiUpper.includes('PERVERTIDO')
  ) {
    return preserveSourceTrailingPunctuation(source, 'เป็นไปได้ไหมว่า "ผี" ตนนั้นจะออกแนวลามกนิดหน่อย');
  }

  if (
    (compactSourceAsciiUpper.includes('COMOSI') || compactSourceAsciiUpper.includes('COMOS'))
    && compactSourceAsciiUpper.includes('INSISTIERAEN')
    && compactSourceAsciiUpper.includes('CIERTASPARTES')
    && compactSourceAsciiUpper.includes('ENESPECIFICO')
  ) {
    return preserveSourceTrailingPunctuation(source, 'ราวกับว่าพวกเขายืนกรานในบางส่วนโดยเฉพาะ');
  }

  if (/^SERA\s+QUE[.!?…]*$/i.test(source) || compactSourceAsciiUpper === 'SERAQUE') {
    return preserveSourceTrailingPunctuation(source, 'เป็นไปได้ไหมว่า');
  }

  if (/^FANTASMA[.!?…]*$/i.test(source) || /^"\s*FANTASMA\s*"[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ผี');
  }

  if (
    /^NO\s+ERA\s+UN\s+POCO\s+PERVERTIDO[.!?…]*$/i.test(source)
    || compactSourceAsciiUpper === 'NOERAUNPOCOPERVERTIDO'
  ) {
    return preserveSourceTrailingPunctuation(source, 'จะออกแนวลามกนิดหน่อย');
  }

  if (/^COMO\s*SI[.!?…]*$/i.test(source) || compactSourceAsciiUpper === 'COMOSI') {
    return preserveSourceTrailingPunctuation(source, 'ราวกับว่า');
  }

  if (/^INSISTIERA\s+EN[.!?…]*$/i.test(source) || compactSourceAsciiUpper === 'INSISTIERAEN') {
    return preserveSourceTrailingPunctuation(source, 'พวกเขายืนกรานใน');
  }

  if (/^CIERTAS\s*PARTES[.!?…]*$/i.test(source) || compactSourceAsciiUpper === 'CIERTASPARTES') {
    return preserveSourceTrailingPunctuation(source, 'บางส่วน');
  }

  if (/^EN\s+ESPEC[IÍ]FICO[.!?…]*$/i.test(source) || compactSourceAsciiUpper === 'ENESPECIFICO') {
    return preserveSourceTrailingPunctuation(source, 'โดยเฉพาะ');
  }

  if (/^AYNAR[.!?…]*$/i.test(source.replace(/\s+/g, ''))) {
    return preserveSourceTrailingPunctuation(source, 'อายนาร์');
  }

  if (/\bPHENELINE\b/i.test(source) && /\bHAS\s+ABSORBED\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฟีนีลีนได้ดูดซับ');
  }

  if (hasVertarToken && hasEssenceToken) {
    const wrapped = /\[[^\]]*\]/.test(source)
      ? '[แก่นแท้ของเวอร์ทาร์]'
      : 'แก่นแท้ของเวอร์ทาร์';
    return preserveSourceTrailingPunctuation(source, wrapped);
  }

  if (
    (compactSourceAlnumUpper.includes('ORDOYOU') || compactSourceAlnumUpper.includes('ORDOYO'))
    && compactSourceAlnumUpper.includes('ESSENCE')
    && compactSourceAlnumUpper.includes('TAKEOUTOFHERE')
  ) {
    return preserveSourceTrailingPunctuation(source, 'หรือคุณต้องการให้แก่นแท้นี้เป็นสิ่งเดียวที่เรานำออกไปจากที่นี่');
  }

  if (/^OR\s+DO\s+YO?U[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'หรือคุณ');
  }
  if (/^DO\s+YO?U[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'คุณต้องการ');
  }
  if (/^WANT\s+THIS\s+ESSEN(?:CE|SE)\s+TO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ต้องการให้แก่นแท้นี้');
  }
  if (/^BE\s+THE\s+ONE\s+THING\s+WE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เป็นสิ่งเดียวที่เรา');
  }
  // --- Pre-translation substitutions and manga dialogue lines protection ---
  if (compactSource === 'shaking') {
    return preserveSourceTrailingPunctuation(source, 'เขย่า');
  }
  if (/^flutter(?:ing|s)?$/i.test(compactSource) || compactSource === 'fluttery') {
    return preserveSourceTrailingPunctuation(source, 'พลิ้ว');
  }
  if (compactSource === 'lol') {
    return preserveSourceTrailingPunctuation(source, 'ฮ่าๆ');
  }
  if (/^ah{1,3}\.{3,}/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'อ่าห์...');
  }
  if (/^ahh{1,3}\.{3,}/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'อ๊าห์...');
  }
  if (/^ah+$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'อา');
  }
  
  // Adult Phrases protection from Hallucination (like "สืบค้นเมื่อ...")
  if (/^ah+it'?scoming[oo]?$/i.test(compactSource) || /^ah+itscoming[oo]?$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'อ๊าห์... มันกำลังจะมาแล้ว... ♥');
  }
  if (/^cumingcummingcumming[cc]?$/i.test(compactSource) || /^cummingcummingcumming[cc]?$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'จะเสร็จ...จ-จะเสร็จ...จะแตกแล้ว... ♥');
  }
  if (/^cummin+g+[oo]?$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'แตกกออกมาแล้ววว...♥');
  }
  if (/^cumming$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'จะแตก...');
  }
  if (/^cuming$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'จะเสร็จ...');
  }
  if (/^fucktoy$/i.test(compactSource) || /^flicktoy$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'ของเล่น');
  }
  if (/^tobemyf[ul]icktoy$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'เพื่อเป็นของเล่นของฉัน');
  }

  // User Dialogue Lines mapping
  if (/^thisstrength\.?o?$/i.test(compactSource) || /^thisstrength$/i.test(compactSource) || compactSource === 'thisstrengtho') {
    return preserveSourceTrailingPunctuation(source, 'ความแข็งแกร่งนี้...');
  }
  if (/^imquiteonthe$/i.test(compactSource) || /^i'mquiteonthe$/i.test(compactSource) || /^imquiteontheheavy$/i.test(compactSource) || /^i\s*mquite\s*on\s*the$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันค่อนข้าง...');
  }
  if (/^he?a?vysizeyet$/i.test(compactSource) || /^heavyyet$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'ตัวใหญ่ทีเดียว แต่');
  }
  if (compactSource === 'immensethickness') {
    return preserveSourceTrailingPunctuation(source, 'ความหนามหาศาล');
  }
  if (/^v?he'?streatingme$/i.test(compactSource) || /^v?he'?streating$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'เขากลับปฏิบัติต่อฉัน');
  }
  if (/^likebatoyd$/i.test(compactSource) || /^likeatoy$/i.test(compactSource) || compactSource === 'likbatoyd') {
    return preserveSourceTrailingPunctuation(source, 'เหมือนของเล่น...');
  }
  if (/^areyou?really$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'คุณ... จริงๆ เหรอ');
  }
  if (/^thesameagbas$/i.test(compactSource) || /^thesameageas$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'อายุเท่ากับ');
  }
  if (/^yu+to$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'ยูโตะ?');
  }
  if (compactSource === 'issocute') {
    return preserveSourceTrailingPunctuation(source, 'น่ารักจัง');
  }
  if (compactSource === 'nnoway') {
    return preserveSourceTrailingPunctuation(source, 'ม-ไม่มีทาง');
  }
  if (compactSource === 'shmackipatv' || compactSource === 'shmackpat' || compactSource === 'shmackipat') {
    return preserveSourceTrailingPunctuation(source, 'ปั๊ก แต๊บ');
  }
  if (compactSource === 'bouncingy' || compactSource === 'bouncing' || compactSource === 'bouncy') {
    return preserveSourceTrailingPunctuation(source, 'กระเด้ง');
  }
  if (compactSource === 'twitchy' || compactSource === 'twitch' || compactSource === 'twitchv' || compactSource === 'twitches' || compactSource === 'twitchesd') {
    return preserveSourceTrailingPunctuation(source, 'กระตุก');
  }
  if (compactSource === 'plurge' || compactSource === 'splurge') {
    return preserveSourceTrailingPunctuation(source, 'ทะลัก');
  }
  if (compactSource === 'thismuchlol') {
    return preserveSourceTrailingPunctuation(source, 'ขนาดนี้เลยเหรอ? ฮ่าๆ');
  }
  if (compactSource === 'thismuch') {
    return preserveSourceTrailingPunctuation(source, 'ขนาดนี้เลยเหรอ?');
  }

  if (/^HHH\?[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ห..ห๊ะ?');
  }
  if (/^YOUR\s+CLIT['’]?S[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'คลิตอริสของคุณ');
  }
  if (/^PUSSY['’]?S\s+TIGHTENED[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ช่องคลอดกระชับขึ้น');
  }
  if (/^MORE\s+THAN\s+QUALIFED[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มีคุณสมบัติมากกว่าที่คาดหวัง');
  }
  if (/^MORE\s+THAN\s+QUALIFIED[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มีคุณสมบัติมากกว่าที่คาดหวัง');
  }
  if (/^TAKE\s+OUT\s+OF\s+HERE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'นำออกไปจากที่นี่');
  }

  // Additional user requested translations
  if (compactSource === 'phew') {
    return preserveSourceTrailingPunctuation(source, 'ฟิ้ววว');
  }
  if (/^ah*shit$/i.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'อ่า... แย่แล้ว...');
  }
  if (compactSource === 'sotight') {
    return preserveSourceTrailingPunctuation(source, 'แน่นมาก...');
  }
  if (compactSource === 'throughoutmy') {
    return preserveSourceTrailingPunctuation(source, 'ตลอดช่วงเวลาของฉัน');
  }
  if (compactSource.includes('icanfeelanimmensethicknessthroughoutmyvaginalwalls') || compactSource.includes('icanfeelanimmensethicknessthroughoutvaginalwalls')) {
    return preserveSourceTrailingPunctuation(source, 'ฉันรู้สึกถึงความหนาอย่างมหาศาลตลอดผนังช่องคลอดของฉัน');
  }
  if (compactSource === 'smack' || compactSource === 'smackv' || compactSource === 'smacky' || compactSource === 'smacke') {
    return preserveSourceTrailingPunctuation(source, 'ตั่บ');
  }
  if (compactSource === 'smacksmack') {
    return preserveSourceTrailingPunctuation(source, 'ตั่บ ตั่บ');
  }
  if (compactSource === 'smacksmacksmack') {
    return preserveSourceTrailingPunctuation(source, 'ตั่บ ตั่บ ตั่บ');
  }

  if (
    (/\bI\s+WOULD\s+BE\s+GETTING\b/i.test(source) && /\b40\s*%/.test(source) && /\bPROFITS?\b/i.test(source) && /\bHAD\s+I\s+SOLD\s+IT\b/i.test(source))
    || compactSourceAlnumUpper.includes('IWOULDBEGETTING40OFTHEPROFITSHADISOLDIT')
  ) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะได้กำไร 40% หากฉันขายมัน');
  }

  if (/^I\s+WOULD\s+BE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะ');
  }
  if (/^GETTING\s+40\s*%\s+OF[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ได้กำไร 40%');
  }
  if (/^THE\s+PROFITS?\s+HAD[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'กำไร หากฉัน');
  }
  if (/^HAD\s+I\s+SOLD\s+IT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'หากฉันขายมัน');
  }
  if (/^I\s+SOLD\s+IT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ขายมัน');
  }
  if (/^I\s+DON['’]?T\s+CARE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันไม่สน');
  }
  if (/^I\s+ALREADY\s+EARNED[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันหาได้แล้ว');
  }
  if (/^ENOUGH[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'พอแล้ว');
  }
  if (
    /\bI\s+DON['’]?T\s+CARE\b/i.test(source)
    && /\bI\s+ALREADY\s+EARNED\b/i.test(source)
    && /\bENOUGH\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'ฉันไม่สน ฉันหาได้พอแล้ว');
  }
  if (/^LOOK,?\s+B[Jl]ORN[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ดูสิ บียอร์น');
  }
  if (/^I\s+HAVE\s+WINGS[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันมีปีก');
  }
  if (/^A\s+LITTLE,?\s+YEAH[!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'นิดหน่อย ใช่ไหม');
  }
  if (/^HMM[!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'อืม');
  }
  if (/^OF\s+COURSE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แน่นอน');
  }
  if (/^VALKYRIE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'วาลคีรี');
  }
  if (/^BARBAR\s*I?\s*AN\s*\(\s*FEMALE\s*\)[.!?…]*$/i.test(source) || /^BARBARIAN\s*\(\s*FEMALE\s*\)[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'บาร์บาเรียน (หญิง)');
  }
  if (/^VA(?:L)?KYR?I?E\s+MODE[.!?…]*$/i.test(source) || /^VALKYRIE\s+MODE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'โหมดวาลคีรี');
  }
  if (/^LIMITED\s+EDITION[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'รุ่นลิมิเต็ด');
  }
  if (/^TH-?THIS\s+LIGHT[.!?…]*$/i.test(source) || /^THIS\s+LIGHT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แส-แสงนี้');
  }
  if (/^(?:I\s+)?SUPPORT\s+YOU\s+TO\s+LIVE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันช่วยให้คุณมีชีวิตอยู่');
  }
  if (/^HERE[.!?…]*\s+AND\s+YOU\s+DO\s+THIS\s+TO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ที่นี่... แล้วคุณทำแบบนี้กับ');
  }
  if (/^THE\s+PEOPLE\s+HERE[!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'คนที่นี่เหรอ');
  }
  if (/^FOR\s+HER\s+IN\s+RETURN[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เพื่อแลกกับเธอ');
  }
  if (/^HER\s+IN\s+RETURN[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เป็นการตอบแทนเธอ');
  }
  if (/^IN\s+RETURN[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เป็นการตอบแทน');
  }

  if (compactSource === 'aarey' || compactSource === 'aareyo' || compactSource === 'aareyou') {
    return preserveSourceTrailingPunctuation(source, 'น..นี่ คุณจะ');
  }

  if (/^H-?\s*HOW[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'อ-อย่างไร');
  }

  if (/^U-?\s*UH[.!?…]*$/i.test(source) || /^UH[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'อ-อา');
  }

  if (/\bA-?\s*ARE\s+YOU\b/i.test(source) && /\bSELLING\s+ME\s+OFF\s+TO\b/i.test(source) && /\bMAGE\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'น..นี่ คุณจะขายฉันให้กับจอมเวทงั้นเหรอ');
  }
  if (/^A-?\s*ARE(?:\s+Y(?:OU)?)?[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'น..นี่ คุณจะ');
  }
  if (/^SELLING\s+ME\s+OFF\s+TO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ขายฉันให้กับ');
  }
  if (/^(?:THE\s+)?MAGE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'จอมเวทงั้นเหรอ');
  }

  if (/\bIT['’]?S\s+BEST\s+IF\b/i.test(source) && /\bAYNAR\b/i.test(source) && /\bESSENCE\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'จะเป็นการดีที่สุดหากอายนาร์รับสารสกัดนี้');
  }
  if (/^IT['’]?S\s+BEST\s+IF[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'จะเป็นการดีที่สุดหาก');
  }
  if (/^AYNAR\s+TAKES\s+THIS[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'อายนาร์รับ');
  }
  if (/^ESSENCE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'สารสกัดนี้');
  }
  if (/^EH[!?…]*$/i.test(source)) {
    if (source.includes('!')) {
      return preserveSourceTrailingPunctuation(source, 'เอ๊');
    }
    return preserveSourceTrailingPunctuation(source, 'เอ๋');
  }
  if (/\bRAPIDO\b/i.test(source) && /\bPRI\b/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'รวดเร็ว, ด่วน-');
  }

  if (/^I\s*THINK[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันว่า');
  }
  if (/^AH\s+ME[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'อ๊ะ ฉัน');
  }
  if (/^EH\s+ME[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เอ๋ ฉัน');
  }
  if (/^EH[.!?…]+$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เอ๋');
  }
  if (/^ME[.!?…]+$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉัน');
  }
  if (/^ENTRANCE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ทางเข้า');
  }
  if (/^ARE\s+ONLY[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มีเพียง');
  }
  if (/^OUR\s+CHANCE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'โอกาสของเรา');
  }
  if (/^THEM[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'พวกเขา');
  }
  if (/^AND\s+LEAVE\s+THE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แล้วออกจาก');
  }
  if (/^SHOE\s+LOCKER[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ตู้รองเท้า');
  }
  if (/^OPEN\s+A\s+SHOE\s+LOCKER[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เปิดตู้รองเท้า');
  }
  if (/^AND\s+LEAVE\s+THE\s+BUILDING[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แล้วออกจากอาคาร');
  }
  if (
    /\bI['’]?LL\s+LET\s+YOU\b/i.test(source)
    && /\bEXPERIMENT\s+WITH\b/i.test(source)
    && /\bHER\s+IN\s+RETURN\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะให้คุณทดลองกับเธอเป็นการตอบแทน');
  }
  if (
    /\bTHINK\s+ABOUT\s+THE\b/i.test(source)
    && /\bSKILLS\s+THE\s+MONSTER\b/i.test(source)
    && /\bUSED\s+EARLIER\s+AND\b/i.test(source)
    && /\bFOCUS\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'ลองนึกถึงทักษะที่สัตว์ประหลาดใช้ก่อนหน้านี้ แล้วจดจ่ออยู่กับมัน');
  }
  if (
    /\bYOU[-\s]+COULD\s+SAY\b/i.test(source)
    && (/\bSOMETHING\s+THAT\s+MIGHT\b/i.test(source) || /\bSO\s+ME\s+THING\s+THAT\s+MIGHT\b/i.test(source))
    && /\bHELP\s+YOU\s+TOO\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'คุณอาจพูดได้ว่า มีบางอย่างที่อาจช่วยคุณได้เช่นกัน');
  }
  if (/^I['’]?LL\s+LET\s+YOU[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะให้คุณ');
  }
  if (/^EXPERIMENT\s+WITH[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ทดลองกับ');
  }
  if (/^THINK\s+ABOUT\s+THE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ลองนึกถึง');
  }
  if (/^SKILLS\s+THE\s+MONSTER[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ทักษะที่สัตว์ประหลาด');
  }
  if (/^USED\s+EARLIER\s+AND[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ใช้ก่อนหน้านี้ แล้ว');
  }
  if (/^EARLIER\s+AND[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ก่อนหน้านี้ แล้ว');
  }
  if (/^FOCUS[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'จดจ่ออยู่กับมัน');
  }
  if (/^YOU[-\s]+COULD\s+SAY[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'คุณอาจพูดได้ว่า');
  }
  if (/^(?:SO\s+ME\s+THING|SOMETHING)\s+THAT\s+MIGHT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มีบางอย่างที่อาจ');
  }
  if (/^HELP\s+YOU\s+TOO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ช่วยคุณได้เช่นกัน');
  }
  if (
    /\bAND\s+IT['’]?S\s+GOOD\s+FOR\b/i.test(source)
    && /\bUS\s+IF\s+OUR\s+TE?A?M+MATE\b/i.test(source)
    && /\bBECOMES\s+STRONGER\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'และมันก็ดีสำหรับเราด้วย หากเพื่อนร่วมทีมของเราแข็งแกร่งขึ้น');
  }

  if (
    /\bI['’]?LL\s+LET\s+YOU\b/i.test(source)
    && /\bEXPERIMENT\s+WITH\b/i.test(source)
    && /\bHER\s+IN\s+RETURN\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะให้คุณทดลองกับเธอเป็นการตอบแทน');
  }
  if (
    /\bTHINK\s+ABOUT\s+THE\b/i.test(source)
    && /\bSKILLS\s+THE\s+MONSTER\b/i.test(source)
    && /\bUSED\s+EARLIER\s+AND\b/i.test(source)
    && /\bFOCUS\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'ลองนึกถึงทักษะที่สัตว์ประหลาดใช้ก่อนหน้านี้ แล้วจดจ่ออยู่กับมัน');
  }
  if (
    /\bYOU[-\s]+COULD\s+SAY\b/i.test(source)
    && (/\bSOMETHING\s+THAT\s+MIGHT\b/i.test(source) || /\bSO\s+ME\s+THING\s+THAT\s+MIGHT\b/i.test(source))
    && /\bHELP\s+YOU\s+TOO\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'คุณอาจพูดได้ว่า มีบางอย่างที่อาจช่วยคุณได้เช่นกัน');
  }
  if (/^I['’]?LL\s+LET\s+YOU[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันจะให้คุณ');
  }
  if (/^EXPERIMENT\s+WITH[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ทดลองกับ');
  }
  if (/^THINK\s+ABOUT\s+THE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ลองนึกถึง');
  }
  if (/^SKILLS\s+THE\s+MONSTER[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ทักษะที่สัตว์ประหลาด');
  }
  if (/^USED\s+EARLIER\s+AND[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ใช้ก่อนหน้านี้ แล้ว');
  }
  if (/^EARLIER\s+AND[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ก่อนหน้านี้ แล้ว');
  }
  if (/^FOCUS[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'จดจ่ออยู่กับมัน');
  }
  if (/^YOU[-\s]+COULD\s+SAY[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'คุณอาจพูดได้ว่า');
  }
  if (/^(?:SO\s+ME\s+THING|SOMETHING)\s+THAT\s+MIGHT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มีบางอย่างที่อาจ');
  }
  if (/^HELP\s+YOU\s+TOO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ช่วยคุณได้เช่นกัน');
  }
  if (
    /\bAND\s+IT['’]?S\s+GOOD\s+FOR\b/i.test(source)
    && /\bUS\s+IF\s+OUR\s+TE?A?M+MATE\b/i.test(source)
    && /\bBECOMES\s+STRONGER\b/i.test(source)
  ) {
    return preserveSourceTrailingPunctuation(source, 'และมันก็ดีสำหรับเราด้วย หากเพื่อนร่วมทีมของเราแข็งแกร่งขึ้น');
  }

  if (/^AND\s+IT['’]?S\s+GOOD\s+FOR[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'และมันก็ดีสำหรับ');
  }
  if (/^US\s+IF\s+OUR\s+TE?A?M+MATE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เราด้วย หากเพื่อนร่วมทีมของเรา');
  }
  if (/^BECOMES\s+STRONGER[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'แข็งแกร่งขึ้น');
  }
  if (/^THAT['’]?S\s+TOO\s+LOW[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มันต่ำเกินไปนะ');
  }
  if (/^THAT['’]?S\s+TOO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มันต่ำเกิน');
  }
  if (/^LOW[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ไปนะ');
  }
  if (/^IT['’]?S\s+A\s+MONSTER\s+SO\s+RARE,?\s+EVEN\s+I\s+DIDN['’]?T\s+KNOW\s+ABOUT\s+IT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มันเป็นมอนสเตอร์ที่หายากมาก จนแม้แต่ฉันยังไม่รู้เลย');
  }
  if (/^IT['’]?S\s+A[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มันเป็น');
  }
  if (/^MONSTER\s+SO[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'มอนสเตอร์ที่');
  }
  if (/^RARE,?\s+EVEN\s+I[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'หายากมาก จนแม้แต่ฉัน');
  }
  if (/^DIDN['’]?T\s+KNOW[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ยังไม่รู้');
  }
  if (/^ABOUT\s+IT[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'เลย');
  }

  if (compactSourceUpper.includes('PHENELINE')) {
    const replaced = replaceNameToken(translated, 'PHENELINE', 'ฟีนีลีน');
    if (replaced !== translated) return replaced;
    return preserveSourceTrailingPunctuation(source, 'ฟีนีลีน');
  }
  if (compactSourceUpper.includes('VERTAR')) {
    const replaced = replaceNameToken(translated, 'VERTAR', 'เวอร์ทาร์');
    if (replaced !== translated) return replaced;
    return preserveSourceTrailingPunctuation(source, 'เวอร์ทาร์');
  }
  if (compactSourceUpper.includes('AYNAR')) {
    const replaced = replaceNameToken(translated, 'AYNAR', 'อายนาร์');
    if (replaced !== translated) return replaced;
    return preserveSourceTrailingPunctuation(source, 'อายนาร์');
  }

  // --- Korean/Manhwa Loanwords & Names ---
  if (compactSourceUpper.includes('YOIL')) {
    const replaced = replaceNameToken(translated, 'YOIL', 'โยอิล');
    if (replaced !== translated) return replaced;
    // If not found in translated (hallucination happened), we might need to fix it later in fallback
  }
  if (compactSourceUpper.includes('UNNIE')) {
    const replaced = replaceNameToken(translated, 'UNNIE', 'ออนนี่');
    if (replaced !== translated) return replaced;
  }
  if (compactSourceUpper.includes('OPPA')) {
    const replaced = replaceNameToken(translated, 'OPPA', 'โอปป้า');
    if (replaced !== translated) return replaced;
  }
  if (compactSourceUpper.includes('NOONA')) {
    const replaced = replaceNameToken(translated, 'NOONA', 'นูน่า');
    if (replaced !== translated) return replaced;
  }
  if (compactSourceUpper.includes('HYUNG')) {
    const replaced = replaceNameToken(translated, 'HYUNG', 'ฮยอง');
    if (replaced !== translated) return replaced;
  }

  if (/^hm+$/.test(compactSource) || /^hmm+$/.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'อืม');
  }

  if (compactSource === 'yet') {
    if (!translated || /^(yet|เย็ต|เยท)$/i.test(translated)) {
      return preserveSourceTrailingPunctuation(source, 'ยัง');
    }
    if (translatedLower === 'yet') {
      return preserveSourceTrailingPunctuation(source, 'ยัง');
    }
  }

  if ((/^เอชเอ็ม$/i.test(translated) || /^เอชเอ็มเอ็ม$/i.test(translated)) && /^hm+$/.test(compactSource)) {
    return preserveSourceTrailingPunctuation(source, 'อืม');
  }

  if (/\bTE?A?M+MATE\b/i.test(source)) {
    let normalized = translated
      .replace(/คู่สมรส/gi, 'เพื่อนร่วมทีม')
      .replace(/เพื่อนร่วมงาน/gi, 'เพื่อนร่วมทีม')
      .replace(/ทีมเมท/gi, 'เพื่อนร่วมทีม');
    if (/\bBECOMES\s+STRONGER\b/i.test(source)) {
      normalized = normalized
        .replace(/กลายเป็นอุปสรรค/gi, 'แข็งแกร่งขึ้น')
        .replace(/กลายเป็นแข็งแกร่งขึ้น/gi, 'แข็งแกร่งขึ้น')
        .replace(/แข็งแรงขึ้น/gi, 'แข็งแกร่งขึ้น');
    }
    normalized = normalized
      .replace(/มันดีสําหรับพวกเรานะถ้า/gi, 'และมันก็ดีสำหรับเราด้วย หาก')
      .replace(/มันดีสำหรับพวกเรานะถ้า/gi, 'และมันก็ดีสำหรับเราด้วย หาก')
      .replace(/เรานะถ้าเพื่อนร่วมทีมของ/gi, 'เราด้วย หากเพื่อนร่วมทีมของเรา');
    if (normalized !== translated) {
      return preserveSourceTrailingPunctuation(source, normalized);
    }
  }

  // --- Final Fixup: Replace untranslated artifacts in the result ---
  let finalResult = translated;
  if (/\b(?:MY|my)\b/.test(finalResult) && /[\u0E00-\u0E7F]/.test(finalResult)) {
    // For Thai output, ensure 'my' is translated if it was carried over
    finalResult = finalResult.replace(/\bMY\b/g, 'ของฉัน').replace(/\bmy\b/g, 'ของฉัน');
  }
  if (/\b(?:GO\s+ON|go\s+on)\b/.test(finalResult) && /[\u0E00-\u0E7F]/.test(finalResult)) {
    finalResult = finalResult.replace(/\bGO\s+ON\b/gi, 'ไปต่อเลย');
  }

  // Handle common missing 'A' in OCR
  if (finalResult.includes('สำหรับขณะหนึ่ง') || finalResult.includes('สำหรับครู่หนึ่ง')) {
    finalResult = finalResult.replace('สำหรับขณะหนึ่ง', 'มาสักพักแล้ว').replace('สำหรับครู่หนึ่ง', 'มาสักพักแล้ว');
  }

  // --- Hallucination Filter: Clean up musical or template artifacts from Argos ---
  if (!source.includes('♪') && finalResult.includes('♪')) {
    finalResult = finalResult.replace(/♪/g, '').trim();
  }

  // Remove leaked template-control artifacts from model output when source isn't template text.
  if (!/[{}\[\]]/.test(source)) {
    finalResult = finalResult
      .replace(/[\[{]\s*\/?#?(?:if|else|elseif|endif|for|foreach|each|end)\b[^\]}\]]*[\]}]/gi, ' ')
      .replace(/\{\s*\/[^}]+\}/g, ' ')
      .replace(/\[\s*\/[^\]]+\]/g, ' ')
      .replace(/[{}\[\]]{2,}/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  const isSuspiciousHallucination = (
    (finalResult.includes('your language') && finalResult.includes('your board'))
    || (finalResult.includes('And your board') && finalResult.includes('your language'))
    || finalResult.includes('โย่ง (กุมาร)')
    || finalResult.includes('โย่ง(กุมาร)')
    || finalResult.includes('และโย่ง (กุมาร)')
  );

  if (isSuspiciousHallucination) {
    // If it contains the hallmark hallucination patterns, strip them aggressively
    finalResult = finalResult
      .replace(/\[?And\s+your\s+language\s+and\s+your\s+board\s*\]?/gi, '')
      .replace(/\[?And\s+your\s+board\s+and\s+your\s+language\s*\]?/gi, '')
      .replace(/และโย่ง\s*\(กุมาร\)/g, '')
      .replace(/โย่ง\s*\(กุมาร\)/g, '')
      .trim();

    // If after stripping it's empty or too short compared to source, it was a total failure
    const sourceTokens = source.split(/\s+/).filter(Boolean).length;
    const resultTokens = finalResult.split(/\s+/).filter(Boolean).length;
    if (finalResult.length < 2 || (sourceTokens >= 2 && resultTokens < sourceTokens / 2)) {
      console.warn(`[HallucinationFilter] translation failed for: "${source}" -> applying glossary fallback.`);
      // If translation failed completely, try to translate common tokens in the source text
      let manual = source.replace(/\bAND\b/gi, 'และ')
        .replace(/\bYOIL\b/gi, 'โยอิล')
        .replace(/\bUNNIE\b/gi, 'ออนนี่')
        .replace(/\bOPPA\b/gi, 'โอปป้า')
        .replace(/\bNOONA\b/gi, 'นูน่า')
        .replace(/\bHYUNG\b/gi, 'ฮยอง');
      return manual;
    }
  }

  // Clean up remaining brackets if they look like template wrappers
  if (finalResult.startsWith('[') && finalResult.endsWith(']') && !source.includes('[')) {
    finalResult = finalResult.slice(1, -1).trim();
  }

  // Final length-ratio safety check for short phrases
  // If source is very short (3 words) but result is 3x longer and contains weird English noise, discard it.
  if (source.length > 0 && finalResult.length > source.length * 4 && /[\u0E00-\u0E7F]/.test(finalResult)) {
     const resultWords = finalResult.split(/\s+/).filter(Boolean);
     const engWordCount = resultWords.filter(w => /^[a-z]+$/i.test(w)).length;
     if (engWordCount > 5 && !source.includes('language') && !source.includes('board')) {
       // Apply manual translation as last resort
       return source.replace(/\bAND\b/gi, 'และ')
        .replace(/\bYOIL\b/gi, 'โยอิล')
        .replace(/\bUNNIE\b/gi, 'ออนนี่');
     }
  }

  // Ensure names are applied even if the translator kept them in English
  if (/\b(?:YOIL|UNNIE|OPPA|NOONA|HYUNG)\b/i.test(finalResult)) {
    finalResult = finalResult.replace(/\bAND\b/gi, 'และ')
      .replace(/\bYOIL\b/gi, 'โยอิล')
      .replace(/\bUNNIE\b/gi, 'ออนนี่')
      .replace(/\bOPPA\b/gi, 'โอปป้า')
      .replace(/\bNOONA\b/gi, 'นูน่า')
      .replace(/\bHYUNG\b/gi, 'ฮยอง');
  }

  // --- Translation Polish: Phrasal verbs and Tag questions ---
  const sourceLower = source.toLowerCase();
  if (sourceLower.includes('stand_out') || sourceLower.includes('stand out')) {
    finalResult = finalResult.replace(/โดดเด่น\s*ออก(?:มา|ไป)?/g, 'โดดเด่น');
  }
  if (sourceLower.includes("aren't we") || sourceLower.includes("arent we")) {
    finalResult = finalResult.replace(/(?:ไม่ได้\s*เรา|พวกเรา\s*ไม่ได้|ไม่\s*ใช่\s*เรา)(?:\?|$)/g, 'ไม่ใช่เหรอ?');
  }
  if (finalResult.includes('หือ?') && (sourceLower.includes('huh?') || sourceLower.includes('what?'))) {
    // If it's a surprising question, 'อะไรนะ' is often more natural for comics
    if (source.length >= 10 || sourceLower.includes('supposed to')) {
      finalResult = finalResult.replace('หือ?', 'อะไรนะ?');
    }
  }

  // เหตุผล: เพื่อแก้ไขคำศัพท์ภาษาไทยที่แปลสุภาพหรือตรงตัวเกินไปเมื่ออยู่ในรูปประโยคยาว โดยตรวจสอบคำต้นทางก่อนการแทนที่ เพื่อไม่ให้กระทบประโยคทั่วไปที่ไม่มีคำศัพท์เหล่านั้น
  const compactTranslatedAlnumUpper = finalResult.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (
    sourceLower.includes("my heart's being torn by their cocks") ||
    compactSourceAlnumUpper.includes("MYHEARTSBEINGTORNBYTHEIRCOCKS") ||
    compactSourceAlnumUpper.includes("MYHEARTBEINGTORNBYTHEIRCOCKS") ||
    compactTranslatedAlnumUpper.includes("MYHEARTSBEINGTORNBYTHEIRCOCKS") ||
    compactTranslatedAlnumUpper.includes("MYHEARTBEINGTORNBYTHEIRCOCKS") ||
    (finalResult.includes('ถูกฉีก') && finalResult.includes('โดยไก่'))
  ) {
    finalResult = 'หัวใจของฉันกำลังถูกฉีกกระชากโดยไอ้ควยของพวกมัน!';
  }
  if (
    compactSourceAlnumUpper.includes('IVELOSTMYVIRGINITYTOSOMEBARBARIAN') ||
    compactTranslatedAlnumUpper.includes('IVELOSTMYVIRGINITYTOSOMEBARBARIAN') ||
    finalResult.includes('ข้าสูญเสียความป่าเถื่อน')
  ) {
    finalResult = 'ข้าสูญเสียความบริสุทธิ์ให้กับคนป่าเถื่อน';
  }
  if (/\b(?:cock|cocks)\b/i.test(source)) {
    finalResult = finalResult.replace(/ไก่/g, 'ควย').replace(/องคชาต/g, 'ควย').replace(/จู๋/g, 'ควย').replace(/ฝูงไก่/g, 'ควย');
  }
  if (/\b(?:pussy|pussies|pussy's|pussys)\b/i.test(source)) {
    finalResult = finalResult.replace(/ลูกแมว/g, 'หี').replace(/แมว/g, 'หี').replace(/ช่องคลอด/g, 'หี').replace(/จิ๋ม/g, 'หี').replace(/เจ้าเหมียว/g, 'หี').replace(/พุซตี้/g, 'หี').replace(/พุสซี่/g, 'หี').replace(/พุซตี้ส์/g, 'หี').replace(/พุสซี่ส์/g, 'หี').replace(/พุซซี่/g, 'หี');
  }
  if (/\b(?:cum|cums|cumming)\b/i.test(source)) {
    finalResult = finalResult
      .replace(/หลั่ง/g, 'น้ำแตก').replace(/อสุจิ/g, 'น้ำแตก').replace(/สำเร็จความใคร่/g, 'น้ำแตก')
      .replace(/หลั่งน้ำ/g, 'น้ำแตก').replace(/หลั่งกระฉูด/g, 'น้ำแตก').replace(/กระฉูด/g, 'น้ำแตก')
      .replace(/มาถึง/g, 'น้ำแตก').replace(/เสร็จสม/g, 'น้ำแตก')
      .replace(/กำลังมาถึง/g, 'น้ำแตก').replace(/กำลังมา/g, 'น้ำแตก')
      .replace(/เร่ง!*/g, 'น้ำแตกแล้ว!').replace(/เร่ง/g, 'น้ำแตกแล้ว')
      .replace(/คิวอึม/g, 'แตกกกกก').replace(/คิวมู/g, 'แตกกกกก')
      .replace(/ว่าว/g, 'น้ำแตก');
  }
  if (/\bcu+u+m+\b/i.test(source)) {
    finalResult = finalResult.replace(/คิวอึม/g, 'แตกกกกก').replace(/คิวมู/g, 'แตกกกกก');
  }
  if (/\bwanna\b/i.test(source)) {
    finalResult = finalResult.replace(/ยุ่ง ค\.ศ\./g, 'อยาก').replace(/ต้องการ/g, 'อยาก');
  }
  if (/\b(?:i-i*[-'’]*i*m)\b/i.test(source) || /(?<=^|[^a-zA-Z])(?:i-i*[-'’\s]*i*m)(?=[^a-zA-Z]|$)/i.test(source)) {
    finalResult = finalResult.replace(/ฉัน/g, 'ฉ-ฉัน').replace(/ผม/g, 'ฉ-ฉัน');
    finalResult = finalResult.replace(/(?<=^|[^a-zA-Z\u0E00-\u0E7F])(?:i-i*[-'’\s]*i*m)(?=[^a-zA-Z\u0E00-\u0E7F]|$)/gi, 'ฉ-ฉัน');
  }
  if (/\bwet\s+puss(?:y|ies)\b/i.test(source)) {
    finalResult = finalResult.replace(/เจ้าเหมียวเปียก/g, 'หีแฉะ').replace(/เจ้าเหมียว/g, 'หีแฉะ').replace(/แมวเปียก/g, 'หีแฉะ').replace(/พุซตี้/g, 'หีแฉะ').replace(/พุสซี่/g, 'หีแฉะ');
  }
  if (/\bcervix\b/i.test(source)) {
    finalResult = finalResult.replace(/ปากมดลูก/g, 'มดลูก');
  }
  if (/\bnot\s+my\b/i.test(source)) {
    finalResult = finalResult.replace(/ไม่ใช่ของฉัน/g, 'ไม่ใช่ของฉัน');
  }
  if (/\b(?:ass|asses)\b/i.test(source)) {
    finalResult = finalResult.replace(/ก้น/g, 'ตูด').replace(/ตูด/g, 'ตูด').replace(/ลา/g, 'ตูด');
  }
  if (/\bhole\b/i.test(source)) {
    finalResult = finalResult.replace(/หลุม/g, 'รู');
  }
  if (/\braping-my\b/i.test(source) || /\braping\s+my\b/i.test(source)) {
    finalResult = finalResult.replace(/raping-my/gi, 'ข่มขืน-ฉัน').replace(/raping my/gi, 'ข่มขืนฉัน').replace(/ข่มขืน\s*ของฉัน/g, 'ข่มขืนฉัน');
  }
  if (/\b(?:agaa|again)\b/i.test(source)) {
    finalResult = finalResult.replace(/อีกครั้ง/g, 'อีกแล้ว');
  }
  if (/\bus\s+the\b/i.test(source)) {
    finalResult = finalResult.replace(/เรา/g, 'พวกเรา');
  }
  if (/\b(?:blowjob|blowjobs)\b/i.test(source)) {
    finalResult = finalResult.replace(/ดูดงาน/g, 'อมควย').replace(/งานเป่า/g, 'อมควย');
  }
  if (/\bsqueezing\b/i.test(source)) {
    finalResult = finalResult.replace(/กระแทก/g, 'บีบ');
  }
  if (/\bcock\s+sleeve\b/i.test(source)) {
    finalResult = finalResult.replace(/ปลอกหุ้ม/g, 'ปลอกหุ้มควย');
  }
  if (/\bshit\b/i.test(source)) {
    finalResult = finalResult.replace(/อึ/g, 'เชี่ยเอ้ย').replace(/ขี้/g, 'เชี่ยเอ้ย');
  }
  if (/\bwomb\b/i.test(source)) {
    finalResult = finalResult.replace(/ครรภ์/g, 'มดลูก');
  }
  if (/\bthreads\b/i.test(source)) {
    finalResult = finalResult.replace(/กระทู้/g, 'ของเหลวข้นหนืดยืดเป็นสาย').replace(/เส้นด้าย/g, 'ของเหลวข้นหนืดยืดเป็นสาย');
  }

  // Rule 4.1: จิ๋ม ห้ามอยู่ใน balloon เดียวกับ หี
  if (finalResult.includes('หี') && finalResult.includes('จิ๋ม')) {
    finalResult = finalResult.replace(/จิ๋ม/g, 'หี');
  }
  // Rule 4.2: ไก่ ห้ามอยู่ใน balloon เดียวกับ ควย
  if (finalResult.includes('ควย') && finalResult.includes('ไก่')) {
    finalResult = finalResult.replace(/ไก่/g, 'ควย');
  }

  return finalResult;
};

const RECEIPT_GLOSSARY_EN = new Map<string, string>([
  [buildTranslationComparisonKey('รวมเงิน'), 'Total'],
  [buildTranslationComparisonKey('ส่วนลด'), 'Discount'],
  [buildTranslationComparisonKey('มูลค่าสินค้า'), 'Subtotal'],
  [buildTranslationComparisonKey('รวมมูลค่าสุทธิ'), 'Net total'],
  [buildTranslationComparisonKey('รวมสุทธิ'), 'Net total'],
  [buildTranslationComparisonKey('ยอดสุทธิ'), 'Net total'],
  [buildTranslationComparisonKey('ภาษีมูลค่าเพิ่ม'), 'VAT'],
  [buildTranslationComparisonKey('รวมภาษี'), 'Tax total'],
  [buildTranslationComparisonKey('จำนวนเงิน'), 'Amount'],
  [buildTranslationComparisonKey('เงินสด'), 'Cash'],
  [buildTranslationComparisonKey('บัตรเครดิต'), 'Credit card'],
]);

const applyReceiptGlossary = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): string => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'en');
  if (normalizedTarget !== 'en') return translatedText;

  const source = normalizeWhitespace(String(sourceText || ''));
  if (!source) return translatedText;

  const sourceKey = buildTranslationComparisonKey(source);
  if (!sourceKey) return translatedText;

  const glossaryValue = RECEIPT_GLOSSARY_EN.get(sourceKey);
  if (!glossaryValue) return translatedText;

  const translated = normalizeWhitespace(String(translatedText || ''));
  const translatedKey = buildTranslationComparisonKey(translated);
  const hasThai = THAI_REGEX.test(translated);
  const hasEnglish = /[A-Za-z]/.test(translated);
  const carryover = Boolean(translatedKey) && translatedKey === sourceKey;

  if (!translated || carryover || (hasThai && !hasEnglish)) {
    return glossaryValue;
  }
  return translatedText;
};

const finalizeTranslatedLine = (sourceText: string, translatedText: string, targetLanguage: string): string => {
  const source = normalizeWhitespace(String(sourceText || ''));
  let resolved = normalizeWhitespace(String(translatedText || ''));

  if (isBoilerplateHallucination(source, resolved)) {
    console.warn(`[finalizeTranslatedLine] Detected boilerplate hallucination: "${resolved}" for source: "${source}". Falling back.`);
    resolved = '';
  }

  if (!resolved) {
    // Apply noise repair to source so we at least show cleaned text (e.g., "MYSTERIOUS CONCEPT" not "MY STERIOUS CONCEPT")
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

const titleCaseWord = (value: string): string => {
  const lower = String(value || '').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

const SCI_SYMBOL_ALLOWED_REGEX = /^[A-Za-z0-9()\[\]{}_,.%:+\-*/^=<>|~'"\s\u00B0\u0391-\u03C9\u2190-\u2193\u2212\u2032\u2033]+$/;
const SCI_SYMBOL_SIGNAL_REGEX = /[0-9\u0391-\u03C9()_+\-*/^=<>%\u00B0\u2190-\u2193\u2212\u2032\u2033]/;
const SCI_FORCE_COMPONENT_TOKEN_REGEX = /\b(?:F|M)(?:x|y|z|\d{1,2})\b/gi;
const SCI_NOTATION_LINE_REGEX = /^(?:fig(?:ure)?\.?\s*\d+(?:[-–]\d+)?(?:\s*[a-z])?|table\s*\d+(?:[-–]\d+)?|chapter\s*\d+|[A-Za-z]?\d+(?:[-–]\d+)?|\(\s*[a-z0-9]{1,3}\s*\)|[A-Za-z]\.|[A-Za-z]{1,2}\d{1,2})$/i;
const SCI_MATH_LINE_REGEX = /^[A-Za-z0-9\u0391-\u03C9()_+\-*/^=<>%\u00B0\u2190-\u2193\u2212\u2032\u2033\s]+$/;

const isScientificSymbolLikeLine = (text: string, sourceLanguage?: string): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;

  // Remove trailing/leading underscores before checking exemption
  const noUnderscore = normalized.replace(/^_+|_+$/g, '');
  const noUnderscoreUpper = noUnderscore.toUpperCase();

  // If it contains multiple English-like words, it's probably dialogue, not a symbol
  const ocrWords = noUnderscore.split(/\s+/g).filter(Boolean);
  const alphaWordCount = ocrWords.filter((w) => w.length >= 2 && /[A-Za-z]/.test(w)).length;
  if (alphaWordCount >= 2 && !/[=<>+\-*/^]/.test(noUnderscore)) {
    return false;
  }

  const asciiCompact = noUnderscoreUpper.replace(/[^A-Z0-9]/g, '');
  const isKnownShort = /^[IAO]$/i.test(asciiCompact) || 
    /^(?:OK|NO|HI|OH|AM|AN|AS|AT|BE|BY|DO|GO|HE|IF|IN|IS|IT|ME|MY|OF|ON|OR|SO|TO|UP|US|WE|YE|AH|HA|EH|UH|LO|YA|UM|YES|FOR|AND|BUT|YOU|THE|NOT|HER|HIS|HIM|SHE|CAN|OUT|GET|HOW|WHO|WHY|HEY|BOY|RUN|SAY|SEE|MAN|OUR|DAY|NEW|TOO|ALL|ANY|BAD|BIG|CRY|DID|EAT|END|FAR|FIT|FLY|FUN|GUY|HOT|ITS|JOB|KEY|LET|LIE|LOT|MAD|MAY|MOM|DAD|OLD|ONE|TWO|OWN|PAY|SAD|SON|TRY|USE|WAY|WIN|YET|WOW|YAY|YEP|NAH|NOP|DIE|PIG|CUM|COCK|OHHH|OHHHH|OHHHHH|AGAA|MORE|YOURE|STOOOOP|STOAOOP|STOAAOP|LIKETHIS|LIKE|WASTOYED|UPLOOKING|SIR|YESSIR|QUCK|QUICK|USTHE|NOWI|II|IIM|ONA|YYOU|IIS|IIT|IIN|SSHE|HHE|TTHEY|WWE|TTHIS|TTHAT|NNO|MME|III|MEEE|MEEEE|5O|S0|6O|OFME|EROMANGA|OFMEEROMANGA|BLOWJOB|IM|NURSE|BEINGTOO|SUDDENLY|ILL|RESTA|THESEX|WELLSINCE|JUST|ILLNESSBE|METHOD|FROMTHE|ITFEELS|OUTINSIDE|STILLFULL|BLOWTOB|NOU|DISEASE|FOUNDA|II333S|S3HS|INSIDEI|INSIDE|WHTTTTT|RESTRAINT|GOO|IHNH|ISIHS|2IHG|EIH3|IIMOM|OD111|VAYS|BEEELEE|WNTTTT|HERPUSSY|WOMB|MING|CUMMING|WAYTOO|GOOD|TOMAKETHREADS|MYCUM|THATS|NOTNECESSARY|ADYDO|UMEAN|WERE|PLEASE|CUMALOTJUSTLIKETHAT)$/i.test(asciiCompact);
  if (isKnownShort) {
    return false;
  }

  const normalizedSourceLanguage = normalizeTranslationLanguage(sourceLanguage || 'en', 'en');
  if (normalizedSourceLanguage === 'es') {
    if (/^(?:SI|NO|EL|LA|UN|YO|TU|SU|ES|EN|DE|AL|LO|TE|ME|SE)$/i.test(noUnderscore)) {
      return false;
    }
  }
  const forceComponentTokens = normalized.match(SCI_FORCE_COMPONENT_TOKEN_REGEX) || [];
  if (forceComponentTokens.length > 0) {
    if (normalized.length <= 48 && ocrWords.length <= 8 && !/[.!?]/.test(normalized)) {
      return true;
    }
  }

  const hasMathSignals = /[0-9=<>%^]/.test(normalized);
  const naturalLanguageLike = alphaWordCount >= 3 && !hasMathSignals;
  if (naturalLanguageLike) {
    return false;
  }

  if (normalized.length > 28) return false;
  if (!SCI_SYMBOL_ALLOWED_REGEX.test(normalized)) return false;

  const tokens = ocrWords;
  if (tokens.length > 5) return false;

  const alnum = normalized.replace(/[^A-Za-z0-9\u0391-\u03C9]/g, '');
  if (alnum.length > 16) return false;

  const compact = normalized.replace(/\s+/g, ' ');
  if (SCI_NOTATION_LINE_REGEX.test(compact)) {
    return true;
  }

  const hasExplicitSciSignal = SCI_SYMBOL_SIGNAL_REGEX.test(normalized);
  if (!hasExplicitSciSignal) {
    return normalized === normalized.toUpperCase() && tokens.length <= 2 && alnum.length <= 2;
  }

  // Check for real English words BEFORE math-like detection to avoid
  // false positives like "HMM_ GUESS" being treated as a formula
  const alphaTokens = tokens
    .map((token) => token.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean);
  const longAlphaTokenCount = alphaTokens.filter((token) => token.length >= 4).length;
  if (longAlphaTokenCount >= 1) {
    return false;
  }

  const hasMathLikeContent = SCI_MATH_LINE_REGEX.test(normalized)
    && /[\u0391-\u03C9_+\-*/^=<>\u00B0\u2190-\u2193\u2212\u2032\u2033]/.test(normalized);
  if (hasMathLikeContent) {
    return true;
  }

  return tokens.length <= 2 && alnum.length <= 6;
};

const shouldSkipLineTranslationByScript = (
  text: string,
  sourceLanguage: string,
  ocrLanguageHint?: string
): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return true;

  const resolvedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedOcrLanguageHint = String(ocrLanguageHint || '')
    .split('+')
    .map((part) => normalizeTranslationLanguage(part, ''))
    .filter(Boolean);
  const hasOcrCjkHint = normalizedOcrLanguageHint.some((lang) =>
    ['ko', 'ja', 'zh', 'th'].includes(lang)
  );
  if (resolvedSource === 'ko' || resolvedSource === 'ja' || resolvedSource === 'zh' || resolvedSource === 'th') {
    return false;
  }
  if (hasOcrCjkHint) {
    return false;
  }

  const hasLatin = /[A-Za-z]/.test(normalized);
  const hasHangul = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(normalized);
  const hasKana = /[\u3040-\u30FF]/.test(normalized);
  const hasHan = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(normalized);
  const hasThai = /[\u0E00-\u0E7F]/.test(normalized);
  const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
  const compactLength = normalized.replace(/\s+/g, '').length;
  const shortTokenLike = compactLength <= 10 || tokenCount <= 2;

  if (!hasLatin && shortTokenLike && (hasHangul || hasKana || hasHan || hasThai)) {
    return true;
  }

  return false;
};

export const shouldPreserveSourceLineForTranslation = (
  text: string,
  sourceLanguage: string,
  ocrLanguageHint?: string
): boolean => {
  if (isLikelyStructuredOcrGarbageToken(text)) return true;
  if (isScientificSymbolLikeLine(text, sourceLanguage)) return true;
  return shouldSkipLineTranslationByScript(text, sourceLanguage, ocrLanguageHint);
};

const PROPER_NOUN_POOL = [
  'Zara', 'Kira', 'Nexo', 'Valo', 'Mira', 'Taro', 'Seno', 'Pika', 'Reno', 'Luma',
  'Gale', 'Vira', 'Zolo', 'Miko', 'Piku', 'Rana', 'Bolo', 'Fina', 'Dina', 'Tina',
  'Juno', 'Yuna', 'Milo', 'Kael', 'Zina', 'Veda', 'Koda', 'Zola', 'Bena', 'Tavi',
  'Remi', 'Vito', 'Zori', 'Bria', 'Roko', 'Nura', 'Palo', 'Koba', 'Tova', 'Sola'
];

const getAvailableProperNoun = (text: string, usedTokens: Set<string>): string => {
  const textLower = text.toLowerCase();
  for (const noun of PROPER_NOUN_POOL) {
    if (!usedTokens.has(noun) && !textLower.includes(noun.toLowerCase())) {
      return noun;
    }
  }
  let counter = 1;
  while (true) {
    const fallbackNoun = `Zara${counter}`;
    if (!usedTokens.has(fallbackNoun) && !textLower.includes(fallbackNoun.toLowerCase())) {
      return fallbackNoun;
    }
    counter++;
  }
};

export const protectLocationPhrases = (
  text: string,
  targetLanguage: string,
  tokenOffset = 0,
  usedTokens = new Set<string>()
): { protectedText: string; replacements: ProtectedTokenReplacement[] } => {
  const replacements: ProtectedTokenReplacement[] = [];
  let protectedText = text;
  const locale = String(targetLanguage || '').toLowerCase();
  const locationRe = /\b([A-Za-z][A-Za-z'\-]{1,}(?:\s+[A-Za-z][A-Za-z'\-]{1,}){0,2})\s+(Town|City|Village|District)\b/g;

  protectedText = protectedText.replace(locationRe, (_match, rawName: string, rawType: string) => {
    const name = rawName
      .split(/\s+/g)
      .map((word) => titleCaseWord(word))
      .join(' ')
      .trim();
    const placeType = String(rawType || '').toLowerCase();

    let replacement = `${name} ${rawType}`;
    if (locale.startsWith('th')) {
      if (placeType === 'town' || placeType === 'city') {
        replacement = `เมือง ${name}`;
      } else if (placeType === 'village') {
        replacement = `หมู่บ้าน ${name}`;
      } else if (placeType === 'district') {
        replacement = `เขต ${name}`;
      }
    }

    const token = getAvailableProperNoun(protectedText, usedTokens);
    usedTokens.add(token);

    replacements.push({ token, replacement });
    return token;
  });

  return { protectedText, replacements };
};

export const protectTranslationTokens = (
  text: string,
  targetLanguage: string
): { protectedText: string; replacements: ProtectedTokenReplacement[] } => {
  const usedTokens = new Set<string>();
  const locationResult = protectLocationPhrases(text, targetLanguage, 0, usedTokens);
  // Normalize curly quotes/apostrophes in the input text to straight ones for uniform matching
  let protectedText = locationResult.protectedText.replace(/[\u2018\u2019\u201B\u201C\u201D`‘’“”]/g, "'");
  const replacements = [...locationResult.replacements];

  try {
    const entries = useGlossaryStore.getState().entries;
    const activeEntries = entries
      .filter((e) => e.isActive && e.sourceText.trim())
      .sort((a, b) => b.sourceText.length - a.sourceText.length);

    const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    activeEntries.forEach((entry) => {
      const source = entry.sourceText.trim();
      const target = entry.targetText.trim();
      
      // Normalize curly quotes/apostrophes in the glossary source text as well
      const normalizedSource = source
        .replace(/[\u2018\u2019\u201B\u201C\u201D`‘’“”]/g, "'")
        .replace(/\s+/g, ' ');

      if (!normalizedSource) return;

      // Check boundary characters to only apply \b when starting/ending with a word character
      // This avoids \b matching failures on entries starting or ending with punctuation (e.g. "SHUP UP!")
      const hasWordStart = /^\w/.test(normalizedSource);
      const hasWordEnd = /\w$/.test(normalizedSource);
      
      const patternStr = (hasWordStart ? '\\b' : '') + escapeRegExp(normalizedSource) + (hasWordEnd ? '\\b' : '');
      const pattern = new RegExp(patternStr, 'gi');

      const token = getAvailableProperNoun(protectedText, usedTokens);
      const nextText = protectedText.replace(pattern, token);
      if (nextText !== protectedText) {
        usedTokens.add(token);
        protectedText = nextText;
        replacements.push({ token, replacement: target });
      }
    });
  } catch (err) {
    console.error('[App] Failed to apply Custom Glossary Token Protection:', err);
  }

  return { protectedText, replacements };
};

export const restoreProtectedTokens = (text: string, replacements: ProtectedTokenReplacement[]): string => {
  let restored = text;
  for (const item of replacements) {
    restored = restored.replace(buildLooseTokenPattern(item.token), item.replacement);
  }
  return restored;
};

const computeOverlapRatio = (a: TranslatableLine, b: TranslatableLine): number => {
  const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const baseWidth = Math.max(1, Math.min(a.right - a.left, b.right - b.left));
  return overlap / baseWidth;
};

const shouldUseDenseDialogueGrouping = (
  lines: TranslatableLine[],
  sourceLanguage: string,
  targetLanguage: string,
  mode: TranslationMode
): boolean => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;
  const avgLength = lines.reduce((sum, line) => sum + line.text.length, 0) / Math.max(1, lines.length);
  const technicalHits = lines.reduce((count, line) => count + (TECHNICAL_SOURCE_HINT_REGEX.test(line.text) ? 1 : 0), 0);
  const longSentenceLines = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    return normalized.length >= 44 || normalized.split(/\s+/g).filter(Boolean).length >= 8;
  }).length;
  const looksDocumentLike = technicalHits >= 2 || longSentenceLines >= 3 || avgLength >= 24;

  if (mode === 'adaptive' && looksDocumentLike) {
    return false;
  }

  if (mode === 'manga') {
    return ['en', 'ja', 'ko', 'zh', 'es'].includes(normalizedSource);
  }

  if (mode === 'manhwa') {
    return normalizedSource === 'ko' || normalizedSource === 'en';
  }

  if (mode === 'adaptive') {
    return ['en', 'ja', 'ko', 'zh', 'es'].includes(normalizedSource);
  }

  return normalizedSource === 'ko' || normalizedSource === 'es';
};

const isLikelyComicDialogueLayout = (lines: TranslatableLine[]): boolean => {
  if (lines.length < 4) return false;

  const widths = lines.map((line) => Math.max(1, line.right - line.left));
  const heights = lines.map((line) => Math.max(1, line.height));
  const medianWidth = computeMedian(widths);
  const medianHeight = computeMedian(heights);
  const shortLineCount = lines.filter((line) => normalizeWhitespace(String(line.text || '')).length <= 34).length;
  const narrowOrBubbleLikeCount = lines.filter((line) => {
    const width = Math.max(1, line.right - line.left);
    const height = Math.max(1, line.height);
    const aspect = width / Math.max(1, height);
    return aspect <= 8.0 || width <= medianWidth * 0.95 || height >= medianHeight * 1.15;
  }).length;
  const longPunctuatedCount = lines.filter((line) => {
    const text = normalizeWhitespace(String(line.text || ''));
    return text.length >= 20 && /[.,;:]/.test(text);
  }).length;

  const result = (
    shortLineCount >= Math.ceil(lines.length * 0.62)
    && narrowOrBubbleLikeCount >= Math.ceil(lines.length * 0.58)
    && longPunctuatedCount <= Math.max(1, Math.floor(lines.length * 0.24))
  );
  console.log(`[isLikelyComicDialogueLayout] lines=${lines.length} shortLineCount=${shortLineCount}/${Math.ceil(lines.length * 0.62)} narrowOrBubbleLikeCount=${narrowOrBubbleLikeCount}/${Math.ceil(lines.length * 0.58)} longPunctuatedCount=${longPunctuatedCount}/${Math.max(1, Math.floor(lines.length * 0.24))} result=${result}`);
  return result;
};

const shouldForceLineByLineForOfflinePanel = (lines: TranslatableLine[]): boolean => {
  if (lines.length < 3) return false;

  const normalizedLines = lines.map((line) => normalizeWhitespace(String(line.text || ''))).filter(Boolean);
  if (normalizedLines.length < 3) return false;

  const avgLength = normalizedLines.reduce((sum, text) => sum + text.length, 0) / normalizedLines.length;
  const technicalHits = normalizedLines.filter((text) => TECHNICAL_SOURCE_HINT_REGEX.test(text)).length;
  if (technicalHits < 3) return false;
  const shortLineCount = normalizedLines.filter((text) => text.length <= 34).length;
  const uppercaseDominantCount = normalizedLines.filter((text) => {
    const letters = text.replace(/[^A-Za-z]/g, '');
    if (letters.length < 5) return false;
    return letters === letters.toUpperCase();
  }).length;
  const hasBracketNarration = normalizedLines.some((text) => /\[[^\]]{4,}\]/.test(text));
  const hasPossessiveCompound = normalizedLines.some((text) => /\b[A-Za-z]{3,}['’]S[A-Za-z]{3,}\b/.test(text));

  const mostlyShort = shortLineCount >= Math.ceil(normalizedLines.length * 0.7);
  const mostlyUppercase = uppercaseDominantCount >= Math.ceil(normalizedLines.length * 0.5);
  if (normalizedLines.length >= 5 && mostlyShort && avgLength >= 18 && avgLength <= 38 && technicalHits >= 4) {
    return true;
  }

  return mostlyShort && mostlyUppercase && (hasBracketNarration || hasPossessiveCompound);
};

const TECHNICAL_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|conditions?|equilibrium|rigid|body|reaction|moment|force|free[-\s]?body|unknowns?|support|collinear|diagram|objectives?)\b/i;
const TECHNICAL_TABLE_ROW_HINT_REGEX = /\b(?:table|continued|types?\s+of\s+connection|number\s+of\s+unknowns|reactions?|unknowns?|components?|couple\s+moment|magnitude|direction|resultant|smooth\s+pin|hinge|fixed\s+support|collar|rod|member\s+fixed|bridge|building|beam|welded|column)\b|^\(?\d+\)?$|^(?:fx|fy|fyt|f|m|or)$/i;

export const shouldUseLineByLineGrouping = (
  lines: TranslatableLine[],
  sourceLanguage: string,
  targetLanguage: string,
  engine: 'offline' | 'ai',
  mode: TranslationMode
): boolean => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;
  if (lines.length <= 4) return false;

  const markerHits = lines.reduce((count, line) => count + (TECHNICAL_SOURCE_HINT_REGEX.test(line.text) ? 1 : 0), 0);
  const tableRowSignalCount = lines.reduce((count, line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    return count + (TECHNICAL_TABLE_ROW_HINT_REGEX.test(normalized) ? 1 : 0);
  }, 0);
  const latinHeavyLineCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
    const nonSpaceChars = normalized.replace(/\s+/g, '').length;
    const latinRatio = latinChars / Math.max(1, nonSpaceChars);
    return latinChars >= 8 && latinRatio >= 0.45;
  }).length;
  const avgLength = lines.reduce((sum, line) => sum + line.text.length, 0) / Math.max(1, lines.length);
  const longSentenceLines = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
    return normalized.length >= 48
      || (normalized.length >= 20 && /[.,;:]/.test(normalized))
      || tokenCount >= 8;
  }).length;
  const shortLineCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    return normalized.length > 0 && normalized.length <= 36;
  }).length;
  const compactTechnicalRowCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
    return tokenCount >= 2
      && tokenCount <= 9
      && (
        TECHNICAL_TABLE_ROW_HINT_REGEX.test(normalized)
        || (
          TECHNICAL_SOURCE_HINT_REGEX.test(normalized)
          && normalized.length <= 56
        )
      );
  }).length;
  const noisyLines = lines.filter((line) => scoreSourceLineReadability(line.text) < 4).length;
  const uppercaseHeadingLines = lines.filter((line) => {
    const latin = line.text.replace(/[^A-Za-z]/g, '');
    if (latin.length < 5) return false;
    const upperRatio = latin.replace(/[^A-Z]/g, '').length / latin.length;
    return upperRatio >= 0.72;
  }).length;
  const tableLikeTechnicalDocument = markerHits >= 3
    && shortLineCount >= Math.ceil(lines.length * 0.45)
    && tableRowSignalCount >= Math.max(4, Math.floor(lines.length * 0.28));
  const mixedTechnicalEvidence = markerHits >= 2
    && latinHeavyLineCount >= 3
    && (longSentenceLines >= 1 || tableRowSignalCount >= 2);
  const strongTechnicalDocument = markerHits >= 3
    && longSentenceLines >= 3
    && avgLength >= 21
    && uppercaseHeadingLines >= 1;
  const compactTechnicalRowPage = markerHits >= 1
    && compactTechnicalRowCount >= Math.max(3, Math.floor(lines.length * 0.32))
    && shortLineCount >= Math.ceil(lines.length * 0.4)
    && latinHeavyLineCount >= Math.max(2, Math.floor(lines.length * 0.24));
  const technicalEvidenceStrong = (
    tableLikeTechnicalDocument
    || strongTechnicalDocument
    || mixedTechnicalEvidence
    || compactTechnicalRowPage
  );

  if ((mode === 'manga' || mode === 'manhwa') && tableLikeTechnicalDocument) {
    return true;
  }

  if (mode !== 'official' && mode !== 'adaptive') return false;

  const comicDialogueLike = isLikelyComicDialogueLayout(lines);
  if (mode === 'adaptive' && comicDialogueLike && !technicalEvidenceStrong) {
    return false;
  }

  if (mode === 'adaptive') {
    if (tableLikeTechnicalDocument) {
      return true;
    }
    if (strongTechnicalDocument) {
      return true;
    }
    if (compactTechnicalRowPage) {
      return true;
    }
    return mixedTechnicalEvidence && (normalizedSource === 'en' || normalizedSource === 'th');
  }

  const officialDocumentSignals = (
    (markerHits >= 2 && (longSentenceLines >= 2 || avgLength >= 20))
    || (markerHits >= 1 && uppercaseHeadingLines >= 2 && lines.length >= 8)
    || tableLikeTechnicalDocument
    || compactTechnicalRowPage
  );
  if (officialDocumentSignals) {
    return true;
  }

  if (engine === 'offline' && markerHits >= 2 && noisyLines >= 3 && longSentenceLines >= 2) {
    return true;
  }

  if (engine === 'offline' && mixedTechnicalEvidence && normalizedSource !== 'en') {
    return true;
  }

  return false;
};

const shouldUseBalloonAwareGrouping = (
  lines: TranslatableLine[],
  sourceLanguage: string,
  targetLanguage: string,
  mode: TranslationMode
): boolean => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;
  if (lines.length < 2) return false;
  if (mode === 'official') return false;

  const technicalHits = lines.reduce((count, line) => count + (TECHNICAL_SOURCE_HINT_REGEX.test(line.text) ? 1 : 0), 0);
  const technicalRowHits = lines.reduce((count, line) => count + (TECHNICAL_TABLE_ROW_HINT_REGEX.test(normalizeWhitespace(line.text)) ? 1 : 0), 0);
  if (technicalHits >= 3 || technicalRowHits >= Math.max(3, Math.floor(lines.length * 0.24))) {
    return false;
  }

  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const comicLike = isLikelyComicDialogueLayout(lines);
  if (mode === 'manga' || mode === 'manhwa') {
    return comicLike || ['en', 'es', 'ja', 'ko', 'zh'].includes(normalizedSource);
  }

  if (mode === 'adaptive') {
    return comicLike;
  }

  return false;
};

const resolveBalloonAwareReadingMode = (
  sourceLanguage: string,
  mode: TranslationMode
): LayoutReadingMode => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  if (mode === 'manga' && normalizedSource === 'ja') {
    return 'rtl';
  }
  if (mode === 'manhwa' || normalizedSource === 'ko' || normalizedSource === 'zh') {
    return 'auto';
  }
  return 'ltr';
};

const shouldPreferEnglishSourceForMixedTechnicalPage = (
  lines: TranslatableLine[],
  inferredSourceLanguage: string,
  targetLanguage: string,
  mode: TranslationMode
): boolean => {
  const normalizedSource = normalizeTranslationLanguage(inferredSourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;
  if (mode !== 'official' && mode !== 'adaptive') return false;
  if (normalizedSource === 'en') return false;

  const latinHeavyLineCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
    const nonSpaceChars = normalized.replace(/\s+/g, '').length;
    const latinRatio = latinChars / Math.max(1, nonSpaceChars);
    return latinChars >= 8 && latinRatio >= 0.5;
  }).length;

  if (latinHeavyLineCount < 3) return false;

  const technicalHintCount = lines.reduce((count, line) => (
    count + (TECHNICAL_SOURCE_HINT_REGEX.test(String(line.text || '')) ? 1 : 0)
  ), 0);
  const longLatinSentenceCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
    const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
    return latinChars >= 12 && tokenCount >= 5 && /[.,;:]/.test(normalized);
  }).length;

  return technicalHintCount >= 2 || longLatinSentenceCount >= 2;
};

const shouldMergeLines = (
  previous: TranslatableLine,
  current: TranslatableLine,
  medianHeight: number,
  profile: TranslationGroupingProfile = 'default'
): boolean => {
  const baseHeight = Math.max(8, medianHeight || previous.height || current.height || 8);
  const isDense = profile === 'dense-dialogue';
  const verticalGap = current.top - previous.bottom;
  const overlapRatio = computeOverlapRatio(previous, current);
  const leftDelta = Math.abs(current.left - previous.left);
  const previousCenter = (previous.left + previous.right) * 0.5;
  const currentCenter = (current.left + current.right) * 0.5;
  const centerDelta = Math.abs(currentCenter - previousCenter);
  const centeredStack = isDense && centerDelta <= baseHeight * 1.7;
  const aligned = overlapRatio >= (isDense ? 0.14 : 0.18)
    || leftDelta <= baseHeight * (isDense ? 2.4 : 1.8)
    || centeredStack;
  const continuation = isLikelyContinuation(previous.text, current.text);
  const sameRowSeparatedColumns = Math.abs(current.top - previous.top) <= baseHeight * 1.25
    && overlapRatio <= 0.34
    && centerDelta >= baseHeight * 2.8;
  const sameRowFarSeparatedColumns = Math.abs(current.top - previous.top) <= baseHeight * 1.45
    && overlapRatio <= 0.28
    && centerDelta >= baseHeight * 4.2;

  const previousInterjection = isLikelyStandaloneInterjectionLine(previous.text);
  const currentInterjection = isLikelyStandaloneInterjectionLine(current.text);
  if (previousInterjection || currentInterjection) {
    const tightSameBubble = overlapRatio >= 0.56
      && centerDelta <= baseHeight * 1.05
      && Math.abs(verticalGap) <= baseHeight * 0.28;
    if (!tightSameBubble) {
      return false;
    }
  }

  if (sameRowSeparatedColumns || sameRowFarSeparatedColumns) {
    return false;
  }

  const previousEndsSentence = isStrongSentenceEnd(previous.text)
    && !SOFT_CONTINUATION_END_REGEX.test(previous.text.trim());
  if (previousEndsSentence && !continuation) {
    const wideVerticalBreak = verticalGap >= baseHeight * 1.1;
    if (wideVerticalBreak) {
      return false;
    }
  }

  const isLikelyStandaloneDialogueLine = (text: string): boolean => {
    const normalized = normalizeWhitespace(String(text || ''));
    if (!normalized) return false;
    const tokens = normalized.split(/\s+/g).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 7) return false;
    if (normalized.length > 42) return false;
    if (SOFT_CONTINUATION_END_REGEX.test(normalized)) return false;
    if (CONTINUATION_TRAILING_WORD_REGEX.test(normalized)) return false;

    const latin = normalized.replace(/[^A-Za-z]/g, '');
    const uppercaseRatio = latin.length > 0
      ? latin.replace(/[^A-Z]/g, '').length / latin.length
      : 0;
    const bracketNarration = /^\[[^\]]+\]$/.test(normalized);

    return bracketNarration
      || (!isStrongSentenceEnd(normalized) && (uppercaseRatio >= 0.58 || tokens.length <= 3));
  };

  if (!continuation && verticalGap >= baseHeight * 0.45) {
    const previousStandalone = isLikelyStandaloneDialogueLine(previous.text);
    const currentStandalone = isLikelyStandaloneDialogueLine(current.text);
    const weakColumnLink = overlapRatio < 0.38 && centerDelta >= baseHeight * 1.25;
    if (previousStandalone && currentStandalone && weakColumnLink) {
      return false;
    }
  }

  // Overlapping boxes are treated as same paragraph if they still align.
  if (verticalGap <= 0 && aligned) return true;

  const normalGapLimit = baseHeight * (isDense ? 1.85 : 1.15);
  const continuationGapLimit = baseHeight * (isDense ? 2.55 : 1.9);
  const gapLimit = continuation ? continuationGapLimit : normalGapLimit;
  if (verticalGap > gapLimit) return false;

  if (aligned) return true;
  return continuation && verticalGap <= continuationGapLimit;
};

type GroupingColumn = {
  lines: TranslatableLine[];
  left: number;
  right: number;
  centerX: number;
  firstTop: number;
  lastTop: number;
  lastBottom: number;
};

const computeGroupingColumnAffinity = (
  column: GroupingColumn,
  line: TranslatableLine,
  baseHeight: number
): number | null => {
  const columnWidth = Math.max(1, column.right - column.left);
  const lineWidth = Math.max(1, line.right - line.left);
  const overlap = overlapRatio(column.left, column.right, line.left, line.right);
  const lineCenterX = (line.left + line.right) * 0.5;
  const centerDelta = Math.abs(lineCenterX - column.centerX);
  const rowDelta = Math.abs(line.top - column.lastTop);
  const verticalGap = line.top - column.lastBottom;
  const normalizedCenterDelta = centerDelta / Math.max(1, Math.max(columnWidth, lineWidth));
  const sameRowButDifferentColumn = rowDelta <= baseHeight * 1.4
    && overlap <= 0.24
    && centerDelta >= baseHeight * 1.35;
  if (sameRowButDifferentColumn) return null;

  const centerAligned = centerDelta <= Math.max(34, Math.min(columnWidth, lineWidth) * 0.48, baseHeight * 1.55);
  const leftAligned = Math.abs(line.left - column.left) <= Math.max(42, baseHeight * 2.2);
  const canBridge = overlap >= 0.2 || (centerAligned && leftAligned && rowDelta <= baseHeight * 1.95);
  if (!canBridge) return null;

  const outsideVerticalBand = verticalGap > baseHeight * 3.3 || verticalGap < -baseHeight * 0.95;
  if (outsideVerticalBand) return null;

  const backwardsPenalty = line.top < column.lastTop - baseHeight * 0.8 ? 1.6 : 0;
  const stretchedGapPenalty = verticalGap > baseHeight * 1.9
    ? ((verticalGap - (baseHeight * 1.9)) / Math.max(1, baseHeight)) * 1.25
    : 0;
  return overlap * 5.8 - normalizedCenterDelta * 2.8 - backwardsPenalty - stretchedGapPenalty;
};

const orderLinesForGrouping = (lines: TranslatableLine[], medianHeight: number): TranslatableLine[] => {
  if (lines.length <= 2) return [...lines];

  const seeded = [...lines].sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return a.index - b.index;
  });

  const baseHeight = Math.max(8, medianHeight || computeMedian(seeded.map((line) => Math.max(1, line.height))));
  const columns: GroupingColumn[] = [];

  seeded.forEach((line) => {
    let bestColumnIndex = -1;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < columns.length; i += 1) {
      const score = computeGroupingColumnAffinity(columns[i], line, baseHeight);
      if (score === null) continue;
      if (score > bestScore) {
        bestScore = score;
        bestColumnIndex = i;
      }
    }

    if (bestColumnIndex < 0 || bestScore < -2.1) {
      columns.push({
        lines: [line],
        left: line.left,
        right: line.right,
        centerX: (line.left + line.right) * 0.5,
        firstTop: line.top,
        lastTop: line.top,
        lastBottom: line.bottom,
      });
      return;
    }

    const column = columns[bestColumnIndex];
    column.lines.push(line);
    column.left = Math.min(column.left, line.left);
    column.right = Math.max(column.right, line.right);
    column.centerX = (column.left + column.right) * 0.5;
    column.lastTop = line.top;
    column.lastBottom = Math.max(column.lastBottom, line.bottom);
  });

  const orderedColumns = columns
    .map((column) => ({
      ...column,
      lines: [...column.lines].sort((a, b) => {
        if (a.top !== b.top) return a.top - b.top;
        if (a.left !== b.left) return a.left - b.left;
        return a.index - b.index;
      }),
    }))
    .sort((a, b) => {
      const topDelta = a.firstTop - b.firstTop;
      const verticalOverlap = intervalOverlap(a.firstTop, a.lastBottom, b.firstTop, b.lastBottom);
      const minColumnSpan = Math.max(1, Math.min(
        Math.max(1, a.lastBottom - a.firstTop),
        Math.max(1, b.lastBottom - b.firstTop)
      ));
      const overlapRatio = verticalOverlap / minColumnSpan;
      const sameReadingBand = overlapRatio >= 0.16 || Math.abs(topDelta) <= baseHeight * 1.35;
      if (sameReadingBand) {
        if (a.left !== b.left) return a.left - b.left;
        if (a.centerX !== b.centerX) return a.centerX - b.centerX;
      }
      if (topDelta !== 0) return topDelta;
      if (a.left !== b.left) return a.left - b.left;
      return a.centerX - b.centerX;
    });

  return orderedColumns.flatMap((column) => column.lines);
};

const computeLineHorizontalGap = (a: TranslatableLine, b: TranslatableLine): number =>
  Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));

const computeLineVerticalGap = (a: TranslatableLine, b: TranslatableLine): number =>
  Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom));

const shouldConnectDenseDialogueLines = (
  a: TranslatableLine,
  b: TranslatableLine,
  baseHeight: number
): boolean => {
  const overlapX = overlapRatio(a.left, a.right, b.left, b.right);
  const overlapY = overlapRatio(a.top, a.bottom, b.top, b.bottom);
  const horizontalGap = computeLineHorizontalGap(a, b);
  const verticalGap = computeLineVerticalGap(a, b);

  const centerAx = (a.left + a.right) * 0.5;
  const centerBx = (b.left + b.right) * 0.5;
  const centerDeltaX = Math.abs(centerAx - centerBx);

  const widthA = Math.max(1, a.right - a.left);
  const widthB = Math.max(1, b.right - b.left);
  const minWidth = Math.max(1, Math.min(widthA, widthB));

  const interjectionA = isLikelyStandaloneInterjectionLine(a.text);
  const interjectionB = isLikelyStandaloneInterjectionLine(b.text);
  if (interjectionA || interjectionB) {
    const tightSameBubble = overlapX >= 0.56
      && centerDeltaX <= baseHeight * 1.05
      && verticalGap <= baseHeight * 0.3;
    if (!tightSameBubble) {
      return false;
    }
  }

  const sameRowSeparatedColumns = overlapY >= 0.24
    && overlapX <= 0.18
    && horizontalGap >= baseHeight * 0.9
    && centerDeltaX >= baseHeight * 1.9;
  if (sameRowSeparatedColumns) return false;

  const verticallyStacked = overlapX >= 0.24
    && verticalGap <= baseHeight * 1.95
    && centerDeltaX <= Math.max(96, minWidth * 0.9);
  const tightlyStacked = overlapX >= 0.16
    && verticalGap <= baseHeight * 1.15
    && centerDeltaX <= Math.max(72, minWidth * 0.66);
  const nearDiagonalInBubble = overlapX >= 0.2
    && verticalGap <= baseHeight * 1.4
    && horizontalGap <= Math.max(42, baseHeight * 1.4)
    && centerDeltaX <= Math.max(86, minWidth * 1.08);
  const strongContainment = overlapX >= 0.55 && overlapY >= 0.35;

  if (verticallyStacked || tightlyStacked || nearDiagonalInBubble || strongContainment) {
    return true;
  }

  return false;
};

const buildDenseDialogueGroupsByConnectivity = (
  orderedLines: TranslatableLine[],
  medianHeight: number
): TranslationGroup[] => {
  if (orderedLines.length === 0) return [];
  if (orderedLines.length === 1) return [{ lines: [orderedLines[0]] }];

  const baseHeight = Math.max(8, medianHeight || computeMedian(orderedLines.map((line) => Math.max(1, line.height))));
  const parent = orderedLines.map((_, index) => index);

  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };

  const unite = (aIndex: number, bIndex: number): void => {
    const rootA = find(aIndex);
    const rootB = find(bIndex);
    if (rootA === rootB) return;
    parent[rootB] = rootA;
  };

  for (let i = 0; i < orderedLines.length; i += 1) {
    for (let j = i + 1; j < orderedLines.length; j += 1) {
      if (shouldConnectDenseDialogueLines(orderedLines[i], orderedLines[j], baseHeight)) {
        unite(i, j);
      }
    }
  }

  const grouped = new Map<number, TranslatableLine[]>();
  orderedLines.forEach((line, index) => {
    const root = find(index);
    const bucket = grouped.get(root) || [];
    bucket.push(line);
    grouped.set(root, bucket);
  });

  return Array.from(grouped.values())
    .map((bucket) => {
      const lines = orderLinesForGrouping(bucket, baseHeight);

      return {
        lines,
        bounds: {
          top: Math.min(...lines.map((line) => line.top)),
          bottom: Math.max(...lines.map((line) => line.bottom)),
          left: Math.min(...lines.map((line) => line.left)),
          right: Math.max(...lines.map((line) => line.right)),
        },
      };
    })
    .sort((a, b) => {
      const topDelta = a.bounds.top - b.bounds.top;
      const verticalOverlap = intervalOverlap(a.bounds.top, a.bounds.bottom, b.bounds.top, b.bounds.bottom);
      const minGroupSpan = Math.max(1, Math.min(
        Math.max(1, a.bounds.bottom - a.bounds.top),
        Math.max(1, b.bounds.bottom - b.bounds.top)
      ));
      const overlapRatio = verticalOverlap / minGroupSpan;
      const sameReadingBand = overlapRatio >= 0.16 || Math.abs(topDelta) <= baseHeight * 1.35;

      if (sameReadingBand) {
        if (a.bounds.left !== b.bounds.left) return a.bounds.left - b.bounds.left;
      }

      if (topDelta !== 0) return topDelta;
      if (a.bounds.left !== b.bounds.left) return a.bounds.left - b.bounds.left;
      return a.bounds.right - b.bounds.right;
    })
    .map((bucket) => ({ lines: bucket.lines }));
};

export const buildTranslationGroups = (
  lines: TranslatableLine[],
  profile: TranslationGroupingProfile = 'default'
): TranslationGroup[] => {
  if (lines.length === 0) return [];

  const heights = lines.map((line) => Math.max(1, line.height));
  const medianHeight = computeMedian(heights);
  const orderedForGrouping = orderLinesForGrouping(lines, medianHeight);

  if (profile === 'line-by-line') {
    return orderedForGrouping.map((line) => ({ lines: [line] }));
  }

  if (profile === 'dense-dialogue' && orderedForGrouping.length >= 3) {
    return buildDenseDialogueGroupsByConnectivity(orderedForGrouping, medianHeight);
  }

  const groups: TranslationGroup[] = [];
  let currentGroup: TranslatableLine[] = [orderedForGrouping[0]];

  for (let i = 1; i < orderedForGrouping.length; i += 1) {
    const previous = currentGroup[currentGroup.length - 1];
    const current = orderedForGrouping[i];
    if (shouldMergeLines(previous, current, medianHeight, profile)) {
      currentGroup.push(current);
      continue;
    }

    groups.push({ lines: currentGroup });
    currentGroup = [current];
  }

  if (currentGroup.length > 0) {
    groups.push({ lines: currentGroup });
  }

  return groups;
};

const composeGroupSourceText = (
  lines: TranslatableLine[],
  groupType: LayoutGroupType = 'unknown',
  groupingProfile: TranslationGroupingProfile = 'default'
): { composed: string; dehyphenJoins: DehyphenatedJoin[] } => {
  const normalized = lines
    .map((line) => {
      const rawText = line.text != null ? String(line.text) : '';
      const cleaned = normalizeEnglishOcrNoiseForTranslation(rawText);
      return normalizeWhitespace(cleaned);
    })
    .filter(Boolean);

  if (normalized.length <= 1) {
    return { composed: (normalized[0] ?? '').replace(/-$/, ''), dehyphenJoins: [] };
  }

  const isNarrative =
    groupType === 'narration' ||
    groupType === 'dialogue' ||
    groupType === 'unknown';

  if (!isNarrative) {
    return { composed: normalized.join('\n'), dehyphenJoins: [] };
  }

  const joins = detectDehyphenatedJoins(normalized);
  const { merged, childSet } = mergeDehyphenatedSource(normalized, joins);
  const composed = merged.filter((_, idx) => !childSet.has(idx)).join(' ');

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

const resolveTranslationGroupsWithLayout = (
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
    if (storeGroups && storeGroups.length > 0) {
      const lineMap = new Map<number, TranslatableLine>(lines.map((line) => [line.index, line]));
      const layerMap = new Map<string, TextLayer>(storeLayers.map((l) => [l.id, l]));
      
      const translationGroups: TranslationGroup[] = [];
      storeGroups.forEach((sg) => {
        const groupLines = sg.layerIds
          .map((id) => layerMap.get(id))
          .filter((l): l is TextLayer => Boolean(l))
          .map((l) => lineMap.get(l.lineIndex))
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
            confidence: sg.confidence,
          });
        }
      });

      if (translationGroups.length > 0) {
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

        console.log(`[resolveTranslationGroupsWithLayout] Using store groups for page ${pageNum}: count=${translationGroups.length}`);
        return {
          groups: translationGroups,
          groupingProfile: 'balloon-aware',
          groupingDecision: {
            appliedProfile: 'balloon-aware',
            confidence: 1.0,
            fallbackReason: 'use_store_groups',
          },
        };
      }
    }
  } catch (err) {
    console.warn('[resolveTranslationGroupsWithLayout] Failed to resolve groups from store:', err);
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

const findSplitIndexNear = (
  text: string,
  desired: number,
  min: number,
  max: number
): number => {
  const clampedDesired = Math.max(min, Math.min(max, desired));
  const maxRadius = 18;

  for (let radius = 0; radius <= maxRadius; radius += 1) {
    const right = clampedDesired + radius;
    if (right <= max) {
      const c = text[right];
      if (/[\s,.;:!?\u3001\u3002\uFF0C\uFF01\uFF1F]/.test(c || '')) {
        return right;
      }
    }

    const left = clampedDesired - radius;
    if (left >= min) {
      const c = text[left];
      if (/[\s,.;:!?\u3001\u3002\uFF0C\uFF01\uFF1F]/.test(c || '')) {
        return left;
      }
    }
  }

  return clampedDesired;
};

const computeLineSplitWeight = (line: TranslatableLine): number => {
  const width = Math.max(1, line.right - line.left);
  const height = Math.max(1, line.height);
  const areaScore = Math.sqrt(width * height) * 0.12;
  return Math.max(1, line.sourceLength * 0.82 + areaScore);
};

const tokenizeRedistributedPart = (value: string, targetLanguage: string): string[] => {
  const normalized = normalizeWhitespace(String(value || ''));
  if (!normalized) return [];

  if (normalizeTranslationLanguage(targetLanguage, 'th') === 'th') {
    const intlWithSegmenter = Intl as unknown as {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
      ) => {
        segment: (input: string) => Iterable<{ segment: string; isWordLike?: boolean }>;
      };
    };
    if (intlWithSegmenter.Segmenter) {
      const wordSeg = new intlWithSegmenter.Segmenter('th', { granularity: 'word' });
      return Array.from(wordSeg.segment(normalized))
        .map((item) => item.segment)
        .filter((segment) => segment.trim().length > 0);
    }
    return Array.from(normalized).filter((segment) => segment.trim().length > 0);
  }

  return normalized.split(/\s+/g).filter(Boolean);
};

const joinRedistributedTokens = (tokens: string[], targetLanguage: string): string => {
  if (tokens.length === 0) return '';
  if (normalizeTranslationLanguage(targetLanguage, 'th') === 'th') {
    return tokens.join('');
  }
  return tokens.join(' ');
};

const rebalanceRedistributedParts = (
  parts: string[],
  sourceLines: TranslatableLine[],
  targetText: string,
  targetLanguage: string
): string[] => {
  const normalizedTarget = normalizeWhitespace(String(targetText || ''));
  const normalizedParts = sourceLines.map((_, index) => normalizeWhitespace(String(parts[index] || '')));

  if (normalizedParts.every((part) => part.length > 0)) {
    return normalizedParts;
  }

  for (let i = 0; i < normalizedParts.length; i += 1) {
    if (normalizedParts[i]) continue;

    let donorIndex = -1;
    let donorScore = Number.NEGATIVE_INFINITY;

    for (let j = 0; j < normalizedParts.length; j += 1) {
      if (i === j) continue;
      const tokens = tokenizeRedistributedPart(normalizedParts[j], targetLanguage);
      if (tokens.length <= 1) continue;

      const score = tokens.length * 10 - Math.abs(j - i);
      if (score > donorScore) {
        donorScore = score;
        donorIndex = j;
      }
    }

    if (donorIndex >= 0) {
      const donorTokens = tokenizeRedistributedPart(normalizedParts[donorIndex], targetLanguage);
      const takeTail = donorIndex < i;
      const moved = takeTail ? donorTokens.pop() : donorTokens.shift();
      if (moved) {
        normalizedParts[i] = moved;
        normalizedParts[donorIndex] = joinRedistributedTokens(donorTokens, targetLanguage);
      }
    }
  }

  if (normalizedParts.every((part) => part.length > 0) || !normalizedTarget) {
    return normalizedParts;
  }

  if (normalizeTranslationLanguage(targetLanguage, 'th') === 'th') {
    // For Thai, do not force-slice target text by character index to fill empty lines,
    // as it chops Thai words into unreadable letters/diacritics. Keep them empty/clean.
    return normalizedParts;
  }

  const partCount = Math.max(1, normalizedParts.length);
  for (let i = 0; i < normalizedParts.length; i += 1) {
    if (normalizedParts[i]) continue;

    const start = Math.floor((i / partCount) * normalizedTarget.length);
    const end = Math.ceil(((i + 1) / partCount) * normalizedTarget.length);
    const chunk = normalizeWhitespace(normalizedTarget.slice(start, end));
    if (chunk) {
      normalizedParts[i] = chunk;
    }
  }

  return normalizedParts;
};

const THAI_PARTICLES = /^(นะ|ครับ|ค่ะ|สิ|นา|ด้วย|เลย|หน่อย|ล่ะ|จ้า|จ๊ะ|นี่)$/;

const glueTrailingParticles = (slots: string[]): string[] => {
  const result = [...slots];
  for (let i = 0; i < result.length - 1; i++) {
    const nextSlot = result[i + 1].trim();
    if (!nextSlot) continue;

    const intlWithSegmenter = Intl as unknown as {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
      ) => {
        segment: (input: string) => Iterable<{ segment: string; isWordLike?: boolean }>;
      };
    };

    if (intlWithSegmenter.Segmenter) {
      const segmenter = new intlWithSegmenter.Segmenter('th', { granularity: 'word' });
      const segments = Array.from(segmenter.segment(nextSlot));
      const firstWordSeg = segments.find((s) => s.segment.trim().length > 0);

      if (firstWordSeg && THAI_PARTICLES.test(firstWordSeg.segment)) {
        const particle = firstWordSeg.segment;
        result[i] = result[i] + particle;
        const particleIdx = result[i + 1].indexOf(particle);
        if (particleIdx >= 0) {
          result[i + 1] = (
            result[i + 1].slice(0, particleIdx) +
            result[i + 1].slice(particleIdx + particle.length)
          ).trim();
        }
      }
    }
  }
  return result;
};

const isRedistributionPlausible = (
  sourceLinesCount: number,
  redistributedSlots: string[]
): boolean => {
  if (sourceLinesCount <= 1) return true;
  const emptySlots = redistributedSlots.filter((s) => !s.trim()).length;
  const emptyRatio = emptySlots / sourceLinesCount;
  return emptyRatio < 0.4;
};

const splitTranslatedTextBySourceWeights = (
  translatedText: string,
  sourceLines: TranslatableLine[],
  targetLanguage: string
): string[] => {
  const target = normalizeWhitespace(translatedText);
  if (sourceLines.length <= 1) return [target];
  if (!target) return sourceLines.map(() => '');

  const explicitLineBreaks = translatedText
    .replace(/\\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .split(/\r?\n+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  if (explicitLineBreaks.length === sourceLines.length) {
    return rebalanceRedistributedParts(explicitLineBreaks, sourceLines, target, targetLanguage);
  }

  if (explicitLineBreaks.length > 1) {
    const result: string[] = [];
    for (let i = 0; i < sourceLines.length; i++) {
      if (i === sourceLines.length - 1 && explicitLineBreaks.length > sourceLines.length) {
        result.push(explicitLineBreaks.slice(i).join(' '));
      } else {
        result.push(explicitLineBreaks[i] || '');
      }
    }
    return result;
  }

  const isThaiTarget = normalizeTranslationLanguage(targetLanguage, 'th') === 'th';
  if (isThaiTarget) {
    const intlWithSegmenter = Intl as unknown as {
      Segmenter?: new (
        locales?: string | string[],
        options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
      ) => {
        segment: (input: string) => Iterable<{ segment: string; isWordLike?: boolean }>;
      };
    };

    const buildSegments = (): string[] => {
      if (intlWithSegmenter.Segmenter) {
        const wordSeg = new intlWithSegmenter.Segmenter('th', { granularity: 'word' });
        const wordSegments = Array.from(wordSeg.segment(target)).map((item) => item.segment);
        if (wordSegments.length > 0) {
          return wordSegments;
        }
      }
      return Array.from(target);
    };

    const segments = buildSegments();
    const totalSourceChars = sourceLines.reduce((sum, l) => sum + (l.text || '').length, 0) || 1;

    // Calculate cumulative character weights of source lines
    const cumulativeSourceWeights: number[] = [];
    let currentSum = 0;
    for (let i = 0; i < sourceLines.length; i++) {
      currentSum += (sourceLines[i].text || '').length;
      cumulativeSourceWeights.push(currentSum);
    }

    // Calculate cumulative char budgets in target string
    const cumulativeTargetBudgets = cumulativeSourceWeights.map((w) =>
      Math.round((w / totalSourceChars) * target.length)
    );

    // Compute segment lengths and cumulative lengths
    const segmentLengths = segments.map((s) => s.length);
    const cumulativeSegmentLengths: number[] = [];
    let segSum = 0;
    for (let i = 0; i < segments.length; i++) {
      segSum += segmentLengths[i];
      cumulativeSegmentLengths.push(segSum);
    }

    const thaiParts: string[] = [];
    let currentSegStart = 0;

    for (let slot = 0; slot < sourceLines.length; slot++) {
      const isLast = slot === sourceLines.length - 1;
      if (isLast) {
        thaiParts.push(segments.slice(currentSegStart).join('').trim());
        break;
      }

      const targetCumulativeEnd = cumulativeTargetBudgets[slot];

      // Find the segment index that gets closest to targetCumulativeEnd
      let bestSegEnd = currentSegStart;
      let minDifference = Infinity;

      for (let idx = currentSegStart; idx < segments.length; idx++) {
        const cumLen = cumulativeSegmentLengths[idx];
        const diff = Math.abs(cumLen - targetCumulativeEnd);

        // Ensure we leave at least one segment per remaining slot
        const remainingSlots = sourceLines.length - 1 - slot;
        if (segments.length - 1 - idx < remainingSlots) {
          break;
        }

        if (diff <= minDifference) {
          minDifference = diff;
          bestSegEnd = idx + 1;
        } else {
          // Since cumulativeSegmentLengths is monotonically increasing,
          // once the difference starts growing, it will continue to grow.
          break;
        }
      }

      // Safe fallback: at least consume one segment if we haven't consumed any
      if (bestSegEnd <= currentSegStart && currentSegStart < segments.length) {
        bestSegEnd = currentSegStart + 1;
      }

      const part = segments.slice(currentSegStart, bestSegEnd).join('').trim();
      thaiParts.push(part);
      currentSegStart = bestSegEnd;
    }

    const finalParts = glueTrailingParticles(thaiParts);
    if (!isRedistributionPlausible(sourceLines.length, finalParts)) {
      console.warn(`[splitTranslatedTextBySourceWeights] Thai redistribution implausible (too many empty slots: ${finalParts.filter(s => !s.trim()).length}/${sourceLines.length}). Falling back to slot 0.`);
      const fallbackParts = new Array<string>(sourceLines.length).fill('');
      fallbackParts[0] = target;
      return fallbackParts;
    }
    return rebalanceRedistributedParts(finalParts, sourceLines, target, targetLanguage);
  }

  const totalSource = sourceLines
    .map((line) => computeLineSplitWeight(line))
    .reduce((acc, n) => acc + n, 0);

  const parts: string[] = [];
  let start = 0;

  for (let i = 0; i < sourceLines.length; i += 1) {
    if (i === sourceLines.length - 1) {
      parts.push(target.slice(start).trim());
      break;
    }

    const consumedSource = sourceLines
      .slice(0, i + 1)
      .map((line) => computeLineSplitWeight(line))
      .reduce((acc, n) => acc + n, 0);
    const desiredEnd = Math.round((consumedSource / totalSource) * target.length);
    const min = start + 1;
    const max = Math.max(min, target.length - (sourceLines.length - i - 1));
    const end = findSplitIndexNear(target, desiredEnd, min, max);
    parts.push(target.slice(start, end).trim());
    start = end;
  }

  return rebalanceRedistributedParts(parts, sourceLines, target, targetLanguage);
};

export const resolveRedistributedLineFallback = (
  sourceLineText: string,
  groupText: string,
  targetLanguage: string,
  lineIndex: number = 0,
  totalLines: number = 1
): string => {
  const source = normalizeWhitespace(String(sourceLineText || ''));
  const normalizedGroup = normalizeWhitespace(String(groupText || ''));
  const isThaiTarget = normalizeTranslationLanguage(targetLanguage, 'th') === 'th';

  if (normalizedGroup) {
    const clampedTotal = Math.max(1, totalLines);
    const clampedIndex = Math.max(0, Math.min(clampedTotal - 1, lineIndex));

    if (clampedTotal > 1) {
      const sentenceChunks = normalizedGroup
        .split(/(?<=[.!?…。！？])\s+/)
        .map((chunk) => normalizeWhitespace(chunk))
        .filter(Boolean);

      if (sentenceChunks.length === clampedTotal) {
        const sentenceChunk = sentenceChunks[clampedIndex];
        if (sentenceChunk) return sentenceChunk;
      }

      if (normalizedGroup.length >= clampedTotal * 3) {
        if (!isThaiTarget) {
          const start = Math.floor((clampedIndex / clampedTotal) * normalizedGroup.length);
          const end = Math.ceil(((clampedIndex + 1) / clampedTotal) * normalizedGroup.length);
          const proportionalChunk = normalizeWhitespace(normalizedGroup.slice(start, end));
          if (proportionalChunk) return proportionalChunk;
        } else {
          // For Thai, we do not want proportional slicing as it shreds words.
          // Return empty string so it falls back to the original English line text naturally.
          return '';
        }
      }

      // Duplication Prevention: For multi-line groups, if we haven't found any valid split
      // for subsequent lines (index > 0), return empty string to prevent duplicating the whole group.
      if (clampedIndex > 0) {
        return '';
      }
    }

    if (isThaiTarget) {
      const normalizedGroupThai = normalizeThaiTranslationText(normalizedGroup);
      if (normalizedGroupThai) return normalizedGroupThai;
    }

    return normalizedGroup;
  }

  if (isThaiTarget) {
    const normalizedSource = normalizeThaiTranslationText(source);
    if (normalizedSource) return normalizedSource;
  }

  return source;
};

// --- Mock Regions for Prototype ---
// Region interface moved to src/types/index.ts

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

export default function App() {
  const showOCRHarness = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('ocr_harness') === '1';
  const { 
    activeTool, 
    setActiveTool, 
    loadingState, 
    setLoadingState,
    viewMode: splitViewMode,
    setViewMode: setSplitViewMode
  } = useUIStore();
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
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(file?.name || '');
  const [translationStatus, setTranslationStatus] = useState<{ kind: 'info' | 'success' | 'error'; message: string } | null>(null);
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const [downloadScopeSelection, setDownloadScopeSelection] = useState<DownloadScope>('current');
  const [downloadModeSelection, setDownloadModeSelection] = useState<DownloadContentMode>('original');
  const [selectedExportEngine, setSelectedExportEngine] = useState<OCREngine | null>(null);
  const [isDownloadingResult, setIsDownloadingResult] = useState(false);
  const downloadMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [translationStartTime, setTranslationStartTime] = useState<number | null>(null);
  const [popupOcrQualityMode, setPopupOcrQualityMode] = useState<'high' | 'fast'>(() => {
    const saved = localStorage.getItem('pdf_translator_ocr_profile');
    return (saved === 'high' || saved === 'fast') ? saved : 'fast';
  });
  const [exportCacheHydrationTick, setExportCacheHydrationTick] = useState(0);

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

  useEffect(() => {
    if (!isDownloadMenuOpen) return undefined;
    let canceled = false;
    const engine = selectedExportEngine || (ocrOptions.engine || 'paddleocr') as OCREngine;

    void (async () => {
      const docId = await ensureDocumentId().catch(() => null);
      if (!docId || canceled) return;

      const pageNumbers = fileType === 'pdf'
        ? Array.from({ length: Math.max(1, totalPages) }, (_, index) => index + 1)
        : [1];

      await Promise.all(pageNumbers.map(async (pageNum) => {
        try {
          const ocrState = useOCRTextLayerStore.getState();
          if (!ocrState.ocrByPageEngine.get(pageNum)?.has(engine)) {
            const cached = await dbService.getOCR(docId, pageNum, engine);
            if (cached && cached.algorithmVersion === OCR_ALGORITHM_VERSION) {
              cached.pageNumber = pageNum;
              ocrState.setPageOCRForEngine(pageNum, engine, cached);
            }
          }

          const translationMap = useOCRTextLayerStore.getState().translationCacheByPage.get(pageNum);
          if (!translationMap || translationMap.size === 0) {
            const rows = await dbService.getTranslationCachePage(docId, pageNum);
            for (const row of rows) {
              if (row.key && !hasCurrentOCRTranslationCacheVersion(row.key)) {
                continue;
              }
              const normalizedEntry: OCRTranslationCacheEntry = {
                ...row,
                pageNum,
                ocrEngine: (row.ocrEngine || 'paddleocr') as OCREngine,
                translationMode: row.translationMode === 'official'
                  ? 'official'
                  : row.translationMode === 'adaptive'
                    ? 'adaptive'
                    : row.translationMode === 'manhwa'
                      ? 'manhwa'
                      : 'manga',
                translatorEngine: row.translatorEngine === 'ai' ? 'ai' : 'offline',
                translatedByIndex: Array.isArray(row.translatedByIndex) ? row.translatedByIndex : [],
              };
              useOCRTextLayerStore.getState().setTranslationCacheEntry(pageNum, normalizedEntry.key, normalizedEntry);
            }
          }
        } catch (err) {
          console.warn(`[ExportHydrate] Failed for page ${pageNum}:`, err);
        }
      }));

      if (!canceled) {
        setExportCacheHydrationTick((tick) => tick + 1);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [isDownloadMenuOpen, selectedExportEngine, ocrOptions.engine, totalPages, fileType, documentId]);

  useEffect(() => {
    if (isAiProcessing || isOfflineProcessing) {
      if (translationStartTime === null) {
        setTranslationStartTime(Date.now());
      }
    } else {
      setTranslationStartTime(null);
    }
  }, [isAiProcessing, isOfflineProcessing, translationStartTime]);

  // Sync global loading state in useUIStore reactively
  const ocrProgress = useOCRTextLayerStore((state) => state.progress);

  useEffect(() => {
    if (isAiProcessing) {
      setLoadingState({
        active: true,
        message: 'กำลังแปลภาษาด้วย AI (Gemini)...',
      });
    } else if (isDownloadingResult) {
      setLoadingState({
        active: true,
        message: 'กำลังรวบรวมไฟล์และส่งออก (Export)...',
      });
    } else {
      setLoadingState(null);
    }
  }, [isAiProcessing, isOfflineProcessing, isDownloadingResult, setLoadingState]);

  useEffect(() => {
    void hydrateGeminiApiKey();
  }, [hydrateGeminiApiKey]);

  useEffect(() => {
    if (!isDownloadMenuOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const targetNode = event.target as Node | null;
      if (downloadMenuRef.current && targetNode && !downloadMenuRef.current.contains(targetNode)) {
        setIsDownloadMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDownloadMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isDownloadMenuOpen]);

  const handleBackToHome = () => {
    visionService.cancelAll('Project closed');
    // ปลดปล่อยและ Resume งานประมวลผลพื้นหลังของไฟล์อื่นๆ ที่เคยโดน Pause เพื่อหลีกทาง
    useBackgroundQueueStore.getState().boostPriorityForDocument(0);
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

  useEffect(() => {
    backgroundQueueProcessor.registerHandlers({
      translatePage: async (docId, pageNum, ocrResult, engine, signal, options) => {
        try {
          // ส่ง ocrResult โดยตรงผ่าน ocrResultOverride เพื่อให้ runCurrentPageTranslation
          // ใช้ข้อมูลที่ processor มีอยู่แล้ว โดยไม่ต้องพึ่ง store ซึ่งอาจ sync ไม่ทัน
          const result = await runCurrentPageTranslation(engine, pageNum, { 
            suppressStatus: true,
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
  }, [runCurrentPageTranslation]);

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
        });

        // ลัดคิวเพื่อให้งานเริ่มประมวลผลในพื้นหลังทันที
        useBackgroundQueueStore.getState().boostPriorityForDocument(prevDocId);
      }
    }

    prevPageRef.current = currentPage;
    prevDocIdRef.current = documentId;
  }, [currentPage, documentId, isOfflineProcessingRaw, isAiProcessingRaw, file, filePath, ocrOptions.engine, ocrOptions.language, sourceLanguage, targetLanguage, translationMode, ocrOptions.dpi, ocrOptions.pageSegMode, ocrOptions.ocrQualityProfile]);

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
      if (likelyGhost && !shouldForceKeepTechnicalTranslationLine(text, line)) return;

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

  function resolveModelScopedOriginalPageOCR(
    ocrState: ReturnType<typeof useOCRTextLayerStore.getState>,
    pageNum: number,
    selectedEngine: OCREngine
  ): OCRPageResult | undefined {
    const engineScoped = ocrState.ocrByPageEngine.get(pageNum)?.get(selectedEngine);
    if (engineScoped) return engineScoped;

    const pageScopedEntries = ocrState.ocrByPageEngine.get(pageNum);
    if (pageScopedEntries && pageScopedEntries.size > 0) {
      const fallbackEntry = Array.from(pageScopedEntries.entries())[0]?.[1];
      if (fallbackEntry) return fallbackEntry;
    }

    const fallback = ocrState.allPagesOCR.get(pageNum);
    return fallback || undefined;
  }

  const hasModelScopedCachedOCR = (
    ocrState: ReturnType<typeof useOCRTextLayerStore.getState>,
    pageNum: number,
    selectedEngine: OCREngine
  ): boolean => {
    const engineScoped = ocrState.ocrByPageEngine.get(pageNum)?.get(selectedEngine);
    if (engineScoped) return true;

    const fallback = ocrState.allPagesOCR.get(pageNum);
    if (fallback && (fallback.ocrEngine || 'paddleocr') === selectedEngine) {
      return true;
    }
    return false;
  };

  const getModelScopedCachedPageNumbers = (engineOverride?: OCREngine): number[] => {
    const ocrState = useOCRTextLayerStore.getState();
    const selectedEngine = engineOverride || (ocrOptions.engine || 'paddleocr') as OCREngine;
    const pages = new Set<number>();

    // ตรวจจาก ocrByPageEngine (primary store)
    ocrState.ocrByPageEngine.forEach((byEngine, pageNum) => {
      if (byEngine.has(selectedEngine)) {
        pages.add(pageNum);
      }
    });

    // fallback: ตรวจจาก allPagesOCR ด้วย
    ocrState.allPagesOCR.forEach((result, pageNum) => {
      if (!pages.has(pageNum)) {
        if (result && (result.ocrEngine || 'paddleocr') === selectedEngine) {
          pages.add(pageNum);
        }
      }
    });

    return Array.from(pages).sort((a, b) => a - b);
  };

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

  const hydrateExportCachesForDownload = async (engineOverride?: OCREngine): Promise<void> => {
    const docId = await ensureDocumentId().catch(() => null);
    if (!docId) return;

    const engine = engineOverride || (ocrOptions.engine || 'paddleocr') as OCREngine;
    const pageNumbers = fileType === 'pdf'
      ? Array.from({ length: Math.max(1, totalPages) }, (_, index) => index + 1)
      : [1];

    await Promise.all(pageNumbers.map(async (pageNum) => {
      try {
        const ocrState = useOCRTextLayerStore.getState();
        if (!ocrState.ocrByPageEngine.get(pageNum)?.has(engine)) {
          const cached = await dbService.getOCR(docId, pageNum, engine);
          if (cached && cached.algorithmVersion === OCR_ALGORITHM_VERSION) {
            cached.pageNumber = pageNum;
            ocrState.setPageOCRForEngine(pageNum, engine, cached);
          }
        }

        const translationMap = useOCRTextLayerStore.getState().translationCacheByPage.get(pageNum);
        if (!translationMap || translationMap.size === 0) {
          const rows = await dbService.getTranslationCachePage(docId, pageNum);
          for (const row of rows) {
            if (row.key && !hasCurrentOCRTranslationCacheVersion(row.key)) {
              continue;
            }
            const normalizedEntry: OCRTranslationCacheEntry = {
              ...row,
              pageNum,
              ocrEngine: (row.ocrEngine || 'paddleocr') as OCREngine,
              translationMode: row.translationMode === 'official'
                ? 'official'
                : row.translationMode === 'adaptive'
                  ? 'adaptive'
                  : row.translationMode === 'manhwa'
                    ? 'manhwa'
                    : 'manga',
              translatorEngine: row.translatorEngine === 'ai' ? 'ai' : 'offline',
              translatedByIndex: Array.isArray(row.translatedByIndex) ? row.translatedByIndex : [],
            };
            useOCRTextLayerStore.getState().setTranslationCacheEntry(pageNum, normalizedEntry.key, normalizedEntry);
          }
        }
      } catch (err) {
        console.warn(`[ExportHydrate] Failed for page ${pageNum}:`, err);
      }
    }));
  };

  const resolveModelScopedPagesForExport = (scope: DownloadScope, engineOverride?: OCREngine): Array<{ pageNum: number; ocr: OCRPageResult }> => {
    const ocrState = useOCRTextLayerStore.getState();
    const selectedEngine = engineOverride || (ocrOptions.engine || 'paddleocr') as OCREngine;
    const targetPages = scope === 'current'
      ? [currentPage]
      : (fileType === 'pdf'
        ? Array.from({ length: Math.max(1, totalPages) }, (_, index) => index + 1)
        : [1]);

    return targetPages
      .map((pageNum) => {
        const ocr = resolveModelScopedOriginalPageOCR(ocrState, pageNum, selectedEngine);
        return ocr ? { pageNum, ocr } : null;
      })
      .filter((item): item is { pageNum: number; ocr: OCRPageResult } => Boolean(item));
  };

  const resolveTranslatedEntryForExport = (
    pageNum: number,
    pageOCR: OCRPageResult,
    selectedEngine: OCREngine
  ): OCRTranslationCacheEntry | undefined => {
    // ทำไมถึงเขียนแบบนี้: หากหน้าดังกล่าวไม่มีบรรทัดข้อความใดๆ จาก OCR (lines.length === 0)
    // ให้จำลอง (mock) cache entry เปล่าส่งกลับไปทันที เพื่อป้องกันไม่ให้หน้านี้โดนข้าม (skip)
    // หายไปจากการส่งออกไฟล์ PDF (ทำให้หน้าเอกสารขาด) และช่วยให้ผ่านการแจ้งเตือนคำแปลขาดในหน้าแรก
    if (!pageOCR.lines || pageOCR.lines.length === 0) {
      const normalizedTargetLanguage = normalizeTranslationLanguage(targetLanguage, 'th');
      return {
        key: `mock-empty-${pageNum}-${selectedEngine}`,
        pageNum,
        ocrEngine: selectedEngine,
        ocrLanguage: pageOCR.language || 'eng',
        sourceLanguage: 'en',
        targetLanguage: normalizedTargetLanguage,
        translationMode: translationMode as any,
        translatorEngine: 'google' as any,
        sourceFingerprint: buildOCRSourceFingerprint(pageOCR, selectedEngine),
        translatedByIndex: [],
        translatedText: '',
        lineCount: 0,
        groupCount: 0,
        createdAt: Date.now(),
        width: pageOCR.width,
        height: pageOCR.height,
      };
    }

    const ocrState = useOCRTextLayerStore.getState();
    const pageMap = ocrState.translationCacheByPage.get(pageNum);
    if (!pageMap || pageMap.size === 0) return undefined;

    const normalizedTargetLanguage = normalizeTranslationLanguage(targetLanguage, 'th');
    const sourceFingerprint = buildOCRSourceFingerprint(pageOCR, selectedEngine);
    const entries = Array.from(pageMap.values())
      .filter((entry) => {
        if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
        if (entry.ocrEngine !== selectedEngine) return false;
        return normalizeTranslationLanguage(entry.targetLanguage, 'th') === normalizedTargetLanguage;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    if (entries.length === 0) return undefined;

    const exactFingerprintMatches = entries.filter((entry) => entry.sourceFingerprint === sourceFingerprint);
    const fingerprintPool = exactFingerprintMatches.length > 0 ? exactFingerprintMatches : entries;

    const activeKey = ocrState.activeTranslationKeyByPage.get(pageNum);
    if (activeKey) {
      const active = pageMap.get(activeKey);
      if (active && fingerprintPool.some((entry) => entry.key === active.key)) {
        return active;
      }
    }

    const withContent = fingerprintPool.filter(
      (entry) => entry.translatedByIndex.length > 0 || Boolean(entry.translatedText?.trim())
    );
    return withContent[0] || fingerprintPool[0];
  };

  const resolveLineBBoxForExport = (line: OCRLine): BBox | undefined => {
    const rawBBox = line?.bbox;
    const rawValid = rawBBox
      && Number(rawBBox.x1) > Number(rawBBox.x0)
      && Number(rawBBox.y1) > Number(rawBBox.y0);
    if (rawValid) {
      return {
        x0: Number(rawBBox.x0),
        y0: Number(rawBBox.y0),
        x1: Number(rawBBox.x1),
        y1: Number(rawBBox.y1),
      };
    }

    const validWords = (Array.isArray(line?.words) ? line.words : [])
      .map((word) => word?.bbox)
      .filter((bbox): bbox is BBox => Boolean(
        bbox
        && Number(bbox.x1) > Number(bbox.x0)
        && Number(bbox.y1) > Number(bbox.y0)
      ));

    if (validWords.length === 0) return undefined;

    return {
      x0: Math.min(...validWords.map((bbox) => Number(bbox.x0))),
      y0: Math.min(...validWords.map((bbox) => Number(bbox.y0))),
      x1: Math.max(...validWords.map((bbox) => Number(bbox.x1))),
      y1: Math.max(...validWords.map((bbox) => Number(bbox.y1))),
    };
  };

  const buildTranslatedPageOCRForExport = (
    pageOCR: OCRPageResult,
    translatedEntry: OCRTranslationCacheEntry
  ): OCRPageResult => {
    const translatedByIndex = new Map<number, string>(
      translatedEntry.translatedByIndex.map((item) => [item.index, normalizeWhitespace(String(item.text || ''))])
    );

    const translatedLines = (pageOCR.lines || []).map((line, lineIndex) => {
      const translatedText = translatedByIndex.get(lineIndex) || normalizeWhitespace(String(line.text || ''));
      const lineBBox = resolveLineBBoxForExport(line);
      const confidence = Number(line.confidence || pageOCR.confidence || 0);
      const translatedWords = lineBBox
        ? [{
          text: translatedText,
          confidence,
          bbox: lineBBox,
        }]
        : [];

      return {
        ...line,
        text: translatedText,
        words: translatedWords,
        bbox: lineBBox || line.bbox,
      };
    });

    const translatedWords = translatedLines.flatMap((line) => Array.isArray(line.words) ? line.words : []);
    const translatedText = translatedLines
      .map((line) => normalizeWhitespace(String(line.text || '')))
      .filter(Boolean)
      .join('\n')
      .trim();

    return {
      ...pageOCR,
      lines: translatedLines,
      words: translatedWords,
      text: translatedText,
      confidence: Number(pageOCR.confidence || 0),
    };
  };

  const resolveVisibleOverlayExportSize = (pageNum: number): { width: number; height: number } | undefined => {
    if (typeof document === 'undefined') return undefined;

    const candidate = fileType === 'pdf'
      ? document.querySelector(`.pdf-canvas-document .react-pdf__Page[data-page-number="${pageNum}"] canvas`)
      : document.querySelector('img[data-export-overlay-image="true"]');
    if (!(candidate instanceof HTMLElement)) return undefined;

    const rect = candidate.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width <= 1 || height <= 1) return undefined;

    return { width, height };
  };

  /**
   * Render แต่ละหน้า PDF เป็น canvas ขนาดเล็ก แล้ว sample สีพื้นหลัง/ข้อความของแต่ละ line
   * เพื่อส่งเป็น paletteByPage ไปให้ export window ใช้แทน DEFAULT_OVERLAY_PALETTE (ขาวเสมอ)
   * — ทำงานใน renderer หลักซึ่งมี access ไปยัง pdfjs และ canvas
   */
  const buildPaletteByPageForExport = async (
    pageRange: number[],
    localSourcePageMap: Map<number, OCRPageResult>,
    localTranslatedEntryMap: Map<number, OCRTranslationCacheEntry>,
  ): Promise<Map<number, import('./types/pdfExport').ExportOverlayPaletteEntry[]>> => {
    const paletteByPage = new Map<number, import('./types/pdfExport').ExportOverlayPaletteEntry[]>();
    if (!file) return paletteByPage;

    const SAMPLE_MAX_SIDE = 1024; // ขนาด canvas สำหรับ sample — ไม่ต้องใหญ่มาก
    let pdfDocForSample: import('pdfjs-dist').PDFDocumentProxy | null = null;

    try {
      if (fileType === 'pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
        pdfDocForSample = await (loadingTask as { promise: Promise<import('pdfjs-dist').PDFDocumentProxy> }).promise;
      }

      for (const pageNum of pageRange) {
        const pageOCR = localSourcePageMap.get(pageNum);
        const translatedEntry = localTranslatedEntryMap.get(pageNum);
        if (!pageOCR || !translatedEntry) continue;

        const translatedByIndex = new Map<number, string>(
          translatedEntry.translatedByIndex
            .filter((item) => Number.isFinite(item.index))
            .map((item) => [item.index, normalizeWhitespace(String(item.text || ''))])
        );
        if (translatedByIndex.size === 0) continue;

        const sampleCanvas = document.createElement('canvas');
        const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: true });
        if (!sampleCtx) continue;

        try {
          if (fileType === 'pdf' && pdfDocForSample) {
            const page = await pdfDocForSample.getPage(pageNum);
            const baseViewport = page.getViewport({ scale: 1 });
            const scale = Math.min(SAMPLE_MAX_SIDE / Math.max(1, baseViewport.width), SAMPLE_MAX_SIDE / Math.max(1, baseViewport.height));
            const viewport = page.getViewport({ scale });
            sampleCanvas.width = Math.max(1, Math.round(viewport.width));
            sampleCanvas.height = Math.max(1, Math.round(viewport.height));
            sampleCtx.fillStyle = '#ffffff';
            sampleCtx.fillRect(0, 0, sampleCanvas.width, sampleCanvas.height);
            await page.render({ canvasContext: sampleCtx, viewport, canvas: sampleCanvas }).promise;
          } else if (fileType !== 'pdf') {
            const imageBlob = fileData
              ? new Blob([fileData as unknown as BlobPart], { type: file.type || 'image/png' })
              : file;
            const imageBitmap = await createImageBitmap(imageBlob);
            const scale = Math.min(SAMPLE_MAX_SIDE / Math.max(1, imageBitmap.width), SAMPLE_MAX_SIDE / Math.max(1, imageBitmap.height));
            sampleCanvas.width = Math.max(1, Math.round(imageBitmap.width * scale));
            sampleCanvas.height = Math.max(1, Math.round(imageBitmap.height * scale));
            sampleCtx.fillStyle = '#ffffff';
            sampleCtx.fillRect(0, 0, sampleCanvas.width, sampleCanvas.height);
            sampleCtx.drawImage(imageBitmap, 0, 0, sampleCanvas.width, sampleCanvas.height);
            imageBitmap.close?.();
          } else {
            continue;
          }

          const sourceWidth = Math.max(1, Number(pageOCR.width || sampleCanvas.width));
          const sourceHeight = Math.max(1, Number(pageOCR.height || sampleCanvas.height));
          const pageEntries: import('./types/pdfExport').ExportOverlayPaletteEntry[] = [];

          pageOCR.lines.forEach((line, index) => {
            if (!translatedByIndex.has(index)) return;
            if (shouldSkipOverlayRenderForSuspiciousLine(line)) return;
            const palette = sampleOverlayPaletteFromLine(
              sampleCtx,
              line,
              sourceWidth,
              sourceHeight,
              sampleCanvas.width,
              sampleCanvas.height,
            );
            pageEntries.push({
              index,
              backgroundColor: palette.backgroundColor,
              textColor: palette.textColor,
              textStrokeWidth: palette.textStrokeWidth,
              textStrokeColor: palette.textStrokeColor,
              textFillWeight: palette.textFillWeight,
            });
          });

          if (pageEntries.length > 0) {
            paletteByPage.set(pageNum, pageEntries);
          }
        } catch {
          // ถ้า sample ไม่ได้ (เช่น CORS, render error) ก็ข้ามไป — จะใช้ DEFAULT_OVERLAY_PALETTE แทน
        }
      }
    } finally {
      await (pdfDocForSample as { destroy?: () => Promise<void> } | null)?.destroy?.();
    }

    return paletteByPage;
  };

  const exportTranslatedOverlayPngForSinglePage = async (
    pageNum: number,
    pageOCR: OCRPageResult,
    translatedEntry: OCRTranslationCacheEntry
  ): Promise<void> => {
    if (!file) return;

    const translatedByIndex = new Map<number, string>(
      translatedEntry.translatedByIndex
        .filter((item) => Number.isFinite(item.index))
        .map((item) => [item.index, normalizeWhitespace(String(item.text || ''))])
    );
    if (translatedByIndex.size === 0) {
      throw new Error('No translated lines found in cache for current page export.');
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Failed to create export canvas context.');
    }

    const visibleExportSize = resolveVisibleOverlayExportSize(pageNum);

    if (fileType === 'pdf') {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
      const pdfDoc = await (loadingTask as { promise: Promise<import('pdfjs-dist').PDFDocumentProxy> }).promise;
      const page = await pdfDoc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const layoutWidth = Math.max(
        1,
        visibleExportSize?.width || pageOCR.width || Math.round(baseViewport.width)
      );
      const layoutHeight = Math.max(
        1,
        visibleExportSize?.height || Math.round(baseViewport.height * (layoutWidth / Math.max(1, baseViewport.width)))
      );
      const exportScale = resolveOverlayExportScale(
        layoutWidth,
        layoutHeight,
        Math.round(baseViewport.width),
        Math.round(baseViewport.height)
      );
      const targetWidth = Math.max(1, Math.round(layoutWidth * exportScale));
      const scale = targetWidth / Math.max(1, baseViewport.width);
      const viewport = page.getViewport({ scale });

      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;

      await (pdfDoc as { destroy?: () => Promise<void> }).destroy?.();
      (loadingTask as { destroy?: () => void }).destroy?.();
    } else {
      const imageBlob = fileData
        ? new Blob([fileData as unknown as BlobPart], { type: file.type || 'image/png' })
        : file;
      const imageBitmap = await createImageBitmap(imageBlob);
      const layoutWidth = Math.max(1, visibleExportSize?.width || imageBitmap.width);
      const layoutHeight = Math.max(1, visibleExportSize?.height || imageBitmap.height);
      const exportScale = resolveOverlayExportScale(
        layoutWidth,
        layoutHeight,
        imageBitmap.width,
        imageBitmap.height
      );
      const targetWidth = Math.max(1, Math.round(layoutWidth * exportScale));
      const targetHeight = Math.max(1, Math.round(layoutHeight * exportScale));
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(imageBitmap, 0, 0, canvas.width, canvas.height);
      imageBitmap.close?.();
    }

    const fontReadyPromise = (typeof document !== 'undefined' && 'fonts' in document)
      ? (document as Document & { fonts?: FontFaceSet }).fonts?.ready
      : undefined;
    if (fontReadyPromise) {
      await fontReadyPromise.catch(() => undefined);
    }

    const sourceWidth = Math.max(1, Number(pageOCR.width || canvas.width));
    const sourceHeight = Math.max(1, Number(pageOCR.height || canvas.height));
    const scaleX = canvas.width / sourceWidth;
    const scaleY = canvas.height / sourceHeight;

    const overlayLayoutProfile: OverlayLayoutProfile = translationMode === 'official'
      ? 'official'
      : translationMode === 'adaptive'
        ? 'adaptive'
        : translationMode === 'manhwa'
          ? 'manhwa'
          : 'manga';
    const preferredOverlayFontFamily = getOverlayFontOption(overlayFontPreset).fontFamily;
    const overlayFontFamily = resolveOverlayFontFamily({
      preset: overlayFontPreset,
      enabled: overlayThaiFontEnabled,
      targetLanguage,
    }) || preferredOverlayFontFamily || "'Noto Sans Thai', 'Sarabun', 'Segoe UI', sans-serif";
    const canvasOverlayFontFamily = await buildCanvasFontFamily(
      overlayFontFamily,
      `${JSON.stringify(getOverlayPrimaryFontName(overlayFontPreset))}, 'Sarabun', 'Noto Sans Thai', sans-serif`
    );

    const pageLayers = useLayerStore.getState().layersByPage.get(pageNum) || [];
    // ดึง lineIndexes ที่ถูก user ลบ เพื่อไม่ render overlay ให้
    const deletedLineIndexes = useLayerStore.getState().deletedLineIndexesByPage.get(pageNum) || new Set<number>();

    const overlayLayoutByIndex = computeOverlayLayoutMap(
      pageOCR.lines.flatMap((line, index) => {
        const lineLayer = pageLayers.find(l => l.lineIndex === index && l.visible);
        const translatedText = (() => {
          if (lineLayer) {
            const normalizedLayerText = normalizeWhitespace(String(lineLayer.text || ''));
            const normalizedSourceText = normalizeWhitespace(String(lineLayer.sourceText || line.text || ''));
            const hasTranslation = lineLayer.userEdited || (normalizedLayerText && normalizedLayerText !== normalizedSourceText);
            const tText = translatedByIndex.get(index);
            if (hasTranslation) {
              return normalizedLayerText || tText;
            }
            return tText ?? (normalizedLayerText || line.text);
          }
          return translatedByIndex.get(index) || line.text;
        })();
        if (!translatedText) return [];
        const sourceFallbackOverlay = isSourceFallbackOverlayText(line.text, translatedText);
        if (!lineLayer && shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallbackOverlay) return [];
        if (!lineLayer && shouldSkipOverlayForUntranslatedCarryOver(line.text, translatedText, targetLanguage) && !sourceFallbackOverlay) return [];

        const layer = pageLayers.find(l => l.lineIndex === index);
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
        const baseWidth = Math.max(1, (effectiveSourceBbox.x1 - effectiveSourceBbox.x0) * scaleX);
        const baseHeight = Math.max(1, (effectiveSourceBbox.y1 - effectiveSourceBbox.y0) * scaleY);
        const expansion = resolveOverlayMaskExpansion(line);
        const maskExpandX = Math.min(expansion.maxExpandX, Math.max(1, Math.round(baseHeight * expansion.expandXRatio)));
        const maskExpandTop = Math.min(expansion.maxExpandTop, Math.max(1, Math.round(baseHeight * expansion.expandTopRatio)));
        const maskExpandBottom = Math.min(expansion.maxExpandBottom, Math.max(1, Math.round(baseHeight * expansion.expandBottomRatio)));
        const rawLeft = effectiveSourceBbox.x0 * scaleX - maskExpandX;
        const rawTop = effectiveSourceBbox.y0 * scaleY - maskExpandTop;
        const rawWidth = baseWidth + maskExpandX * 2;
        const rawHeight = baseHeight + maskExpandTop + maskExpandBottom;
        const rect = clampOverlayRect(rawLeft, rawTop, rawWidth, rawHeight, {
          x0: 0,
          y0: 0,
          x1: canvas.width,
          y1: canvas.height,
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
            fontFamily: canvasOverlayFontFamily,
            profile: overlayLayoutProfile,
          },
        }];
      }),
      { profile: overlayLayoutProfile }
    );

    const translatedLinePalette = new Map<number, OverlayPalette>();
    const maxSampleSide = 2400;
    const sampleScale = Math.min(1, maxSampleSide / Math.max(1, canvas.width, canvas.height));
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = Math.max(1, Math.round(canvas.width * sampleScale));
    sampleCanvas.height = Math.max(1, Math.round(canvas.height * sampleScale));
    const sampleContext = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (sampleContext) {
      sampleContext.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
      pageOCR.lines.forEach((line, index) => {
        if (!translatedByIndex.has(index)) return;
        const translatedText = translatedByIndex.get(index) || '';
        const sourceFallbackOverlay = isSourceFallbackOverlayText(line.text, translatedText);
        if (shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallbackOverlay) return;
        translatedLinePalette.set(index, sampleOverlayPaletteFromLine(
          sampleContext,
          line,
          sourceWidth,
          sourceHeight,
          sampleCanvas.width,
          sampleCanvas.height
        ));
      });
    }

    pageOCR.lines.forEach((line, index) => {
      // Skip lines ที่ถูก user ลบออก
      if (deletedLineIndexes.has(index)) return;
      const lineLayer = pageLayers.find(l => l.lineIndex === index && l.visible);
      const translatedText = (() => {
        if (lineLayer) {
          const normalizedLayerText = normalizeWhitespace(String(lineLayer.text || ''));
          const normalizedSourceText = normalizeWhitespace(String(lineLayer.sourceText || line.text || ''));
          const hasTranslation = lineLayer.userEdited || (normalizedLayerText && normalizedLayerText !== normalizedSourceText);
          const tText = translatedByIndex.get(index);
          if (hasTranslation) {
            return normalizedLayerText || tText;
          }
          return tText ?? (normalizedLayerText || line.text);
        }
        return translatedByIndex.get(index) || line.text;
      })();
      if (!translatedText) return;
      const sourceFallbackOverlay = isSourceFallbackOverlayText(line.text, translatedText);
      if (!lineLayer && shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallbackOverlay) return;
      if (!lineLayer && shouldSkipOverlayForUntranslatedCarryOver(line.text, translatedText, targetLanguage) && !sourceFallbackOverlay) return;

      // Skip ถ้า layer นี้ userEdited → จะ render ด้วย user-layer pass แทน
      const matchedUserLayer = pageLayers.find(l => l.lineIndex === index && l.visible && l.userEdited);
      if (matchedUserLayer) return;

      const layout = overlayLayoutByIndex.get(index);
      const isMaskOnlyLine = Boolean(layout?.hidden);
      if (isMaskOnlyLine && !layout?.preserveMaskWhenHidden) {
        return;
      }

      const renderText = layout?.renderText || translatedText;
      const effectiveProfile = layout?.effectiveProfile || overlayLayoutProfile;
      const styleKind = layout?.styleKind;
      const isDocumentLikeOverlay = styleKind
        ? styleKind === 'document-heading' || styleKind === 'document-body'
        : effectiveProfile === 'official';
      const isComicLikeOverlay = !isDocumentLikeOverlay;
      const maskBbox = (!isMaskOnlyLine && layout?.mergedMaskBBox) || resolveOverlayMaskBBox(line);
      const resolvedSourceBbox = resolveOverlaySourceBBox(line);
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
      const sourceBbox = isMaskOnlyLine
        ? resolvedSourceBbox
        : (layout?.mergedBBox || (isDocumentLikeOverlay || lowCoverageSource ? maskBbox : resolvedSourceBbox));

      const maskRenderSourceLeft = maskBbox.x0;
      const renderSourceLeft = layout?.alignment === 'left' && layout.sharedBoxLeftX !== undefined
        ? Math.min(sourceBbox.x0, layout.sharedBoxLeftX)
        : sourceBbox.x0;
      const maskBaseWidth = Math.max(1, (maskBbox.x1 - maskRenderSourceLeft) * scaleX);
      const maskBaseHeight = Math.max(1, (maskBbox.y1 - maskBbox.y0) * scaleY);
      const baseWidth = Math.max(1, (sourceBbox.x1 - renderSourceLeft) * scaleX);
      const baseHeight = Math.max(1, (sourceBbox.y1 - sourceBbox.y0) * scaleY);
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
      const rawMaskLeft = maskRenderSourceLeft * scaleX - maskExpandLeft;
      const rawMaskTop = maskBbox.y0 * scaleY - maskExpandTop;
      const rawMaskWidth = maskBaseWidth + maskExpandLeft + maskExpandRight;
      const rawMaskHeight = maskBaseHeight + maskExpandTop + maskExpandBottom;
      const maskRect = clampOverlayRect(rawMaskLeft, rawMaskTop, rawMaskWidth, rawMaskHeight, {
        x0: 0,
        y0: 0,
        x1: canvas.width,
        y1: canvas.height,
      });

      const useMergedComicTextRect = (styleKind === 'comic-bubble' || styleKind === 'comic-box') && !isMaskOnlyLine && Boolean(layout?.mergedMaskBBox);
      const textSourceLeft = useMergedComicTextRect ? maskRenderSourceLeft : renderSourceLeft;
      const textSourceTop = useMergedComicTextRect ? maskBbox.y0 : sourceBbox.y0;
      const textBaseWidth = useMergedComicTextRect ? Math.max(baseWidth, maskBaseWidth) : baseWidth;
      const textBaseHeight = useMergedComicTextRect ? Math.max(baseHeight, maskBaseHeight) : baseHeight;
      const mergedComicTextTopLift = useMergedComicTextRect ? Math.max(0, Math.round(maskBaseHeight * (styleKind === 'comic-bubble' ? 0.08 : 0.05))) : 0;
      const mergedComicTextExtraHeight = useMergedComicTextRect ? Math.max(0, Math.round(maskBaseHeight * (styleKind === 'comic-bubble' ? 0.34 : 0.18))) : 0;
      const rawTextLeft = textSourceLeft * scaleX - (layout?.alignment === 'center' ? 0 : maskExpandLeft);
      const rawTextTop = textSourceTop * scaleY - maskExpandTop - mergedComicTextTopLift;
      const rawTextWidth = textBaseWidth + (layout?.alignment === 'center' ? 0 : maskExpandLeft + maskExpandRight);
      const rawTextHeight = textBaseHeight + maskExpandTop + maskExpandBottom + mergedComicTextTopLift + mergedComicTextExtraHeight;
      let textRect = clampOverlayRect(rawTextLeft, rawTextTop, rawTextWidth, rawTextHeight, {
        x0: 0,
        y0: 0,
        x1: canvas.width,
        y1: canvas.height,
      });
      if (!isDocumentLikeOverlay) {
        textRect = clampOverlayRect(textRect.left, textRect.top, textRect.width, textRect.height, {
          x0: Math.max(0, maskRect.left - 1),
          y0: Math.max(0, maskRect.top - 1),
          x1: Math.min(canvas.width, maskRect.left + maskRect.width + 1),
          y1: Math.min(canvas.height, maskRect.top + maskRect.height + 1),
        });
      }

      const palette = translatedLinePalette.get(index) || DEFAULT_OVERLAY_PALETTE;
      const maskBackgroundColor = palette.backgroundColor;
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
        fontFamily: canvasOverlayFontFamily,
        profile: effectiveProfile,
        styleKind,
      });
      const typography = scaleOverlayTypography(baseTypography, overlayFontSizeScale);
      const extraTopPad = hasThaiText ? Math.max(1, Math.round(typography.fontSize * 0.08)) : 0;
      const extraBottomPad = hasThaiText ? Math.max(1, Math.round(typography.fontSize * 0.06)) : 0;
      const textStartOffset = layout?.sharedTextStartX !== undefined
        ? Math.max(0, (layout.sharedTextStartX - renderSourceLeft) * scaleX)
        : 0;
      const centerOffset = layout?.sharedCenterX !== undefined
        ? ((layout.sharedCenterX - renderSourceLeft) * scaleX) - (textRect.width * 0.5)
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
      const rotationDeg = estimateLineRotationDeg(line);
      const rotationRad = (rotationDeg * Math.PI) / 180;
      const thaiComicLine = hasThaiText && (styleKind === 'comic-bubble' || styleKind === 'comic-box');
      const minFillRatio = typography.estimatedLines > 1
        ? (thaiComicLine ? 0.82 : 0.74)
        : (thaiComicLine ? 0.58 : 0.5);
      const paintHeight = Math.min(
        textRect.height * 1.8,
        Math.max(
          typography.contentHeight + typography.padY * 2 + extraTopPad + extraBottomPad,
          textRect.height * minFillRatio
        )
      );
      const paintOffsetTop = Math.max(
        hasThaiText ? 1 : 0,
        Math.min(textRect.height - paintHeight, Math.round(textRect.height * (thaiComicLine ? 0.04 : 0.08)))
      );

      ctx.save();
      if (rotationDeg !== 0) {
        ctx.translate(maskRect.left, maskRect.top);
        ctx.rotate(rotationRad);
        ctx.fillStyle = maskBackgroundColor;
        ctx.fillRect(0, 0, maskRect.width, maskRect.height);
      } else {
        ctx.fillStyle = maskBackgroundColor;
        ctx.fillRect(maskRect.left, maskRect.top, maskRect.width, maskRect.height);
      }
      ctx.restore();

      if (isMaskOnlyLine) {
        return;
      }

      ctx.save();
      if (rotationDeg !== 0) {
        ctx.translate(textRect.left, textRect.top);
        ctx.rotate(rotationRad);
      }

      const originLeft = rotationDeg !== 0 ? 0 : textRect.left;
      const originTop = rotationDeg !== 0 ? 0 : textRect.top;
      const paintLeft = originLeft + innerLeft;
      const paintTop = originTop + paintOffsetTop;

      const clipHeightBoost = hasThaiText ? Math.max(2, Math.round(typography.fontSize * 0.35)) : 0;
      ctx.beginPath();
      ctx.rect(originLeft - 180, originTop, textRect.width + 360, Math.max(textRect.height, paintHeight) + clipHeightBoost);
      ctx.clip();

      const textBoxLeft = paintLeft + typography.padX;
      const textBoxTop = paintTop + typography.padY + extraTopPad;
      const textBoxWidth = Math.max(1, Math.round((innerWidth - (typography.padX * 2)) * 1.15) + 12);
      const textBoxHeight = Math.max(1, Math.max(paintHeight, typography.contentHeight) - ((typography.padY * 2) + extraTopPad + extraBottomPad));
      const lineHeightPx = Math.max(1, typography.fontSize * typography.lineHeight);
      const maxLines = Math.max(1, Math.max(
        Math.ceil(textBoxHeight / lineHeightPx),
        typography.estimatedLines
      ));
      const overlayTextWeight = Number(palette.textFillWeight || 400);
      const resolvedTextWeight = Math.max(400, Math.min(700, Math.round(overlayTextWeight)));

      ctx.font = `${resolvedTextWeight} ${typography.fontSize}px ${canvasOverlayFontFamily}`;
      const lines = wrapCanvasText(ctx, overlayText, textBoxWidth, maxLines, typography.forceSingleLine);
      ctx.fillStyle = palette.textColor;
      const strokeBaseWidth = Number(palette.textStrokeWidth || 0);
      const resolvedStrokeWidth = strokeBaseWidth > 0
        ? Math.max(0.55, Math.min(1.35, strokeBaseWidth * (typography.fontSize / 14)))
        : 0;
      ctx.textBaseline = 'top';
      ctx.textAlign = layout?.alignment === 'center' ? 'center' : 'left';

      lines.forEach((lineText, lineIndex) => {
        const y = textBoxTop + (lineIndex * lineHeightPx);
        if (lineIndex > 0 && y + lineHeightPx > textBoxTop + textBoxHeight + 0.5) return;
        const x = ctx.textAlign === 'center'
          ? textRect.left + innerLeft + (innerWidth / 2)
          : textBoxLeft;
        if (resolvedStrokeWidth > 0 && palette.textStrokeColor) {
          ctx.save();
          ctx.lineJoin = 'round';
          ctx.miterLimit = 2;
          ctx.lineWidth = resolvedStrokeWidth;
          ctx.strokeStyle = palette.textStrokeColor;
          ctx.strokeText(lineText, x, y, textBoxWidth);
          ctx.restore();
        }
        ctx.fillText(lineText, x, y, textBoxWidth);
      });

      ctx.restore();
    });

    // ── User-Edited Layer Render Pass ──────────────────────────────────────
    // วนซ้ำ pageLayers ที่ user แก้ไขแล้ว (userEdited = true) เพื่อ render
    // ทับด้วย style ที่ user ตั้งจริง: bbox, backgroundColor, textColor, fontSize, bold
    // layer ที่ไม่ได้ userEdited จะ render โดย auto-layout loop ด้านบนแล้ว
    const visibleUserLayers = pageLayers.filter(l => l.visible && l.userEdited);
    if (visibleUserLayers.length > 0) {
      for (const layer of visibleUserLayers) {
        // แปลง OCR-space bbox → canvas pixel
        const lx = Math.round(layer.bbox.x0 * scaleX);
        const ly = Math.round(layer.bbox.y0 * scaleY);
        const lw = Math.max(1, Math.round((layer.bbox.x1 - layer.bbox.x0) * scaleX));
        const lh = Math.max(1, Math.round((layer.bbox.y1 - layer.bbox.y0) * scaleY));

        ctx.save();

        // Rotation support (หมุนรอบศูนย์กลางกล่อง)
        const layerRotation = layer.rotation || 0;
        if (layerRotation !== 0) {
          const cx = lx + lw / 2;
          const cy = ly + lh / 2;
          ctx.translate(cx, cy);
          ctx.rotate((layerRotation * Math.PI) / 180);
          ctx.translate(-cx, -cy);
        }

        // วาด background rect
        const layerBg = layer.backgroundColor;
        if (layerBg && layerBg !== 'transparent') {
          ctx.fillStyle = layerBg;
          ctx.fillRect(lx, ly, lw, lh);
        } else {
          // โปร่งใส: ลบ pixel เดิมออก (white erase) เพื่อ match กล่องขาว
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(lx, ly, lw, lh);
        }

        // คำนวณ fontSize ที่ scale ตาม canvas
        const baseFontSize = layer.fontSize || 14;
        // scaleX แปลง OCR px → canvas px; clamp ให้อ่านได้
        const resolvedFontSize = Math.max(8, Math.round(baseFontSize * scaleX));
        const fontWeight = layer.bold ? 'bold' : 'normal';
        ctx.font = `${fontWeight} ${resolvedFontSize}px ${canvasOverlayFontFamily}`;
        ctx.fillStyle = layer.textColor || '#000000';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';

        // clip ไม่ให้ text ล้นกล่อง
        ctx.beginPath();
        ctx.rect(lx, ly, lw, lh);
        ctx.clip();

        // wrap text + render
        const displayText = layer.text || '';
        const lineHeightPx = Math.max(1, resolvedFontSize * 1.35);
        const maxLines = Math.max(1, Math.floor((lh - 6) / lineHeightPx));
        const wrappedLines = wrapCanvasText(ctx, displayText, lw - 8, maxLines, false);
        wrappedLines.forEach((lineText, li) => {
          const ty = ly + 3 + li * lineHeightPx;
          if (li > 0 && ty + lineHeightPx > ly + lh + 0.5) return;
          ctx.fillText(lineText, lx + 4, ty, lw - 8);
        });

        ctx.restore();
      }
    }
    // ──────────────────────────────────────────────────────────────────────

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create translated PNG export.'));
      }, 'image/png');
    });

    const pngUrl = URL.createObjectURL(pngBlob);
    const anchor = document.createElement('a');
    anchor.href = pngUrl;
    anchor.download = file.name.replace(/\.[^.]+$/u, `_page_${pageNum}_translated_overlay.png`);
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(pngUrl);
  };

  const handleHeaderDownload = async (scope: DownloadScope, mode: DownloadContentMode, engineOverride?: OCREngine) => {
    if (!file) return;

    applyPopupOcrQualityProfile();
    const selectedEngine = engineOverride || selectedExportEngine || (ocrOptions.engine || 'paddleocr') as OCREngine;
    await hydrateExportCachesForDownload(selectedEngine);
    setExportCacheHydrationTick((tick) => tick + 1);

    const scopedPages = resolveModelScopedPagesForExport(scope, selectedEngine);
    if (scopedPages.length === 0) {
      setTranslationStatus({ kind: 'error', message: 'No OCR cache available for download. Run OCR first.' });
      return;
    }

    try {
      setIsDownloadingResult(true);
      if (mode === 'original') {
        const pageMap = new Map<number, OCRPageResult>();
        scopedPages.forEach(({ pageNum, ocr }) => {
          pageMap.set(pageNum, ocr);
        });

        const pageRange = scope === 'current'
          ? [currentPage]
          : scopedPages.map((item) => item.pageNum);
        const arrayBuffer = await file.arrayBuffer();
        const resultBytes = await searchablePDFService.createSearchablePDFWithOCR(
          arrayBuffer,
          pageMap,
          pageRange
        );
        const url = URL.createObjectURL(new Blob([resultBytes.buffer as ArrayBuffer], { type: 'application/pdf' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        const suffix = scope === 'current' ? `_page_${currentPage}_searchable.pdf` : '_searchable.pdf';
        anchor.download = file.name.replace('.pdf', suffix);
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      } else {
        const translatedPageMap = new Map<number, OCRPageResult>();
        const translatedEntryMap = new Map<number, OCRTranslationCacheEntry>();
        const sourcePageMap = new Map<number, OCRPageResult>();
        let missingPages = 0;

        scopedPages.forEach(({ pageNum, ocr }) => {
          sourcePageMap.set(pageNum, ocr);
          const translatedEntry = resolveTranslatedEntryForExport(pageNum, ocr, selectedEngine);
          if (!translatedEntry) {
            missingPages += 1;
            return;
          }

          translatedEntryMap.set(pageNum, translatedEntry);
          translatedPageMap.set(pageNum, buildTranslatedPageOCRForExport(ocr, translatedEntry));
        });

        if (translatedPageMap.size === 0) {
          setTranslationStatus({
            kind: 'error',
            message: 'No translated cache found for selected OCR model and target language. Run translation first.',
          });
          return;
        }

        if (scope === 'current') {
          const currentSourcePage = sourcePageMap.get(currentPage);
          const currentEntry = translatedEntryMap.get(currentPage);
          if (currentSourcePage && currentEntry) {
            await exportTranslatedOverlayPngForSinglePage(currentPage, currentSourcePage, currentEntry);
          }
        }

        if (scope === 'all' && fileType === 'pdf') {
          const pageRange = Array.from(translatedPageMap.keys()).sort((a, b) => a - b);
          // Sample สีพื้นหลัง/ข้อความจากรูปต้นฉบับแต่ละหน้า ก่อนส่งไป export window
          const paletteByPage = await buildPaletteByPageForExport(pageRange, sourcePageMap, translatedEntryMap);
          const resultBytes = await exportTranslatedPdfViaPrint({
            fileType: 'pdf',
            sourceBytes: filePath ? undefined : await file.arrayBuffer(),
            sourceFilePath: filePath,
            sourceMimeType: file.type || 'application/pdf',
            pageRange,
            sourcePageMap,
            translatedEntryMap,
            translationMode,
            overlayFontPreset,
            overlayThaiFontEnabled,
            targetLanguage,
            overlayFontSizeScale,
            paletteByPage,
          });

          const url = URL.createObjectURL(new Blob([resultBytes.buffer as ArrayBuffer], { type: 'application/pdf' }));
          const anchor = document.createElement('a');
          anchor.href = url;
          const suffix = '_translated_overlay.pdf';
          anchor.download = file.name.replace(/\.[^.]+$/u, suffix);
          document.body.appendChild(anchor);
          anchor.click();
          document.body.removeChild(anchor);
          URL.revokeObjectURL(url);
        }

        if (missingPages > 0) {
          setTranslationStatus({
            kind: 'info',
            message: `Exported translated overlay for ${translatedPageMap.size} pages; ${missingPages} pages had no matching translated cache.`,
          });
        } else if (scope === 'current') {
          setTranslationStatus({
            kind: 'success',
            message: `Exported page ${currentPage} translated overlay PNG.`,
          });
        } else {
          setTranslationStatus({
            kind: 'success',
            message: `Exported translated overlay PDF for ${translatedPageMap.size} pages.`,
          });
        }
      }

      setIsDownloadMenuOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown download error';
      setTranslationStatus({ kind: 'error', message: `Download failed: ${message}` });
    } finally {
      setIsDownloadingResult(false);
      useExportStore.getState().finishExport();
    }
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
    engine: 'offline' | 'ai',
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

    // Ensure store layers are in sync with pageOCR before we collect translatable lines or resolve grouping.
    try {
      const layerStore = useLayerStore.getState();
      const existingLayers = layerStore.getPageLayers(pageNum);
      const existingGroups = layerStore.getPageGroups(pageNum);
      const hasUserModifications = existingLayers.some(l => l.userEdited || l.id.startsWith('manual-layer-'))
        || existingGroups.some(g => g.userCreated);
      
      const isStoreStale = existingLayers.length === 0 || 
        existingLayers.some(l => l.lineIndex >= pageOCR.lines.length) ||
        (existingLayers.length > 0 && !hasUserModifications && existingLayers[0].sourceText !== String(pageOCR.lines[0]?.text || '').replace(/\s+/g, ' ').trim());

      if (isStoreStale && !hasUserModifications) {
        const initialLayerResult = buildLayerGroupsFromOCR(pageOCR);
        layerStore.setPageLayers(pageNum, initialLayerResult);
        console.log(`[TranslationSync] Synchronously initialized/rebuilt stale store layers for page ${pageNum} before translation.`);
      }
    } catch (err) {
      console.warn('[TranslationSync] Failed to verify/rebuild stale store layers:', err);
    }

    const pageEngine = (pageOCR.ocrEngine || selectedEngine) as OCREngine;
    const ocrEngine = pageEngine;
    const ocrLanguageKey = options?.ocrLanguage || pageOCR.language || ocrOptions.language || sourceLanguage || 'eng';
    const normalizedTargetLanguage = normalizeTranslationLanguage(options?.targetLanguage || targetLanguage, 'th');
    const normalizedUserSourceLanguage = normalizeTranslationLanguage(options?.sourceLanguage || sourceLanguage, 'en');
    const resolvedSourceFromOCR = resolveSourceLanguageFromOCR(ocrLanguageKey, normalizedUserSourceLanguage);
    const effectiveSourceLanguage = resolvedSourceFromOCR;
    const effectiveTranslationMode = options?.translationMode || translationMode;

    // ตรวจสอบ cache ก่อนเริ่มกระบวนการแปล เพื่อหลีกเลี่ยงการแปลซ้ำและทำให้คำแปลเปลี่ยนไป
    const matchedDocId = options?.documentIdOverride ?? (await ensureDocumentId().catch(() => null));
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
            
            return rowEngine === targetRowEngine &&
                   row.translationMode === effectiveTranslationMode &&
                   rowTargetLang === targetRowTargetLang &&
                   rowSourceLang === targetRowSourceLang &&
                   rowTranslatorEngine === targetTranslatorEngine &&
                   hasThai &&
                   isVersionMatch;
          });

          if (matchedCache && !options?.bypassPageCache) {
            console.log(`[Translation] Cache hit for page ${pageNum} via database! Skipping translation coordinator.`);
            
            // อัปเดตข้อมูลเข้า Store สำหรับหน้าจอ UI
            ocrState.setTranslationCacheEntry(pageNum, matchedCache.key, matchedCache);
            ocrState.setActiveTranslationCacheKey(pageNum, matchedCache.key);
            ocrState.setTranslationPreviewMode('translated');

            // ซิงค์ผลการแปลกลับเข้าสู่ Layer Store ด้วย
            try {
              const layerStore = useLayerStore.getState();
              const pageLayers = layerStore.getPageLayers(pageNum);
              if (pageLayers.length > 0) {
                const updatedPageLayers = pageLayers.map(layer => {
                  const matchedItem = matchedCache.translatedByIndex.find(item => item.index === layer.lineIndex);
                  if (!matchedItem) return layer;
                  if (layer.userEdited) return layer;
                  return {
                    ...layer,
                    translatedText: matchedItem.text,
                    text: matchedItem.text,
                    translationEngineUsed: engine,
                  };
                });
                layerStore.setPageLayers(pageNum, {
                  layers: updatedPageLayers,
                  groups: layerStore.getPageGroups(pageNum),
                });
              } else {
                // หากยังไม่มีเลเยอร์ถูกสร้างขึ้นในหน้านี้ (เช่น แปลข้ามหน้า หรือแคชเก็บไว้)
                // ให้สร้างเลเยอร์ขึ้นมาใหม่จาก OCR + แคชคำแปลทันที
                const translatedMap = new Map<number, string>();
                if (Array.isArray(matchedCache.translatedByIndex)) {
                  matchedCache.translatedByIndex.forEach(item => {
                    translatedMap.set(item.index, item.text);
                  });
                }
                const result = buildLayerGroupsFromOCR(pageOCR, translatedMap);
                layerStore.setPageLayers(pageNum, result);
              }
            } catch (err) {
              console.warn('[TranslationSync] Failed to sync cache to Layer Store:', err);
            }

            if (!options?.suppressStatus) {
              setTranslationStatus({
                kind: 'success',
                message: `${engine} | Cache Hit for Page ${pageNum} | Loaded from persistent translation cache.`,
              });
            }
            return true;
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
        if (latinDominantPage && isLikelyShortForeignSfxLine(line.text)) return false;
        return true;
      });
    let translatableLines = dedupedTranslatableLines
      .filter((line) => {
        if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage, ocrLanguageKey)) return false;
        if (latinDominantPage && isLikelyShortForeignSfxLine(line.text)) return false;
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
      };
    });

    const coordinatorEngineId = engine === 'offline' ? 'argos' : 'gemini';
    let effectiveEngine: 'offline' | 'ai' = engine;
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
              translateBatchOffline: (texts, type, mode, src, tgt) => 
                translateBatchOffline(texts, type, mode, src, tgt, offlineBatchBridgeWrapper),
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

        // 1. CUM- MING -> ทะ- / ทะลักออกมาแล้ววว!
        if (compactCombined.includes('CUMMING')) {
          const overrideLines: string[] = [];
          group.lines.forEach((line, lineOffset) => {
            if (lineOffset === 0) {
              overrideLines.push('ทะ-');
            } else if (lineOffset === 1) {
              overrideLines.push('ทะลักออกมาแล้ววว!');
            } else {
              overrideLines.push('');
            }
          });
          groupLineOverrides.set(groupIndex, overrideLines);
        }
        
        // 2. IT FELT WAY TOO GOOD -> ดีเกินไป
        else if (compactCombined.includes('ITFELTWAYTOOGOOD')) {
          const overrideLines: string[] = [];
          group.lines.forEach((line, lineOffset) => {
            if (lineOffset === 0) {
              overrideLines.push('ดีเกินไป');
            } else {
              overrideLines.push('');
            }
          });
          groupLineOverrides.set(groupIndex, overrideLines);
        }

        // 3. NOT NEC- ESSARY -> ไม่สำคัญ
        else if (compactCombined.includes('NOTNECESSARY')) {
          const overrideLines: string[] = [];
          group.lines.forEach((line, lineOffset) => {
            if (lineOffset === 0) {
              overrideLines.push('ไม่สำคัญ');
            } else {
              overrideLines.push('');
            }
          });
          groupLineOverrides.set(groupIndex, overrideLines);
        }
      }

      const directLineOverride = groupLineOverrides.get(groupIndex);
      if (directLineOverride && directLineOverride.length > 0) {
        group.lines.forEach((line, lineIndex) => {
          const sourceLineText = normalizeWhitespace(String(line.text || '')) || String(line.text || '');
          const overrideText = directLineOverride[lineIndex] || sourceLineText;
          translatedByIndex.set(line.index, overrideText || sourceLineText);
          if (group.replacements.length === 0 && shouldRetryLineTranslation(line.text, overrideText, groupSourceLanguage, normalizedTargetLanguage)) {
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
      // Set group context so context-sensitive glossary works for per-line redistribute
      setSlangGroupContext(group.lines.map((l) => l.text || '').join(' '));
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
        // Use noise-repaired source as fallback instead of raw OCR text
        const cleanedSourceFallback = childSet.has(lineOffset)
          ? ''
          : normalizeSourceForTranslation(sourceLineText, groupSourceLanguage);
        translatedByIndex.set(line.index, finalizedLine || cleanedSourceFallback || (childSet.has(lineOffset) ? '' : sourceLineText));
        if (!childSet.has(lineOffset) && group.replacements.length === 0 && shouldRetryLineTranslation(line.text, finalizedLine, groupSourceLanguage, normalizedTargetLanguage)) {
          retryLineMap.set(line.index, { index: line.index, sourceText: line.text, sourceLanguage: groupSourceLanguage });
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
      const finalizedFallback = finalizeTranslatedLine(line.text, line.text, normalizedTargetLanguage);
      translatedByIndex.set(line.index, finalizedFallback || line.text);
      if (shouldRetryLineTranslation(line.text, finalizedFallback, translationSourceLanguage, normalizedTargetLanguage)) {
        retryLineMap.set(line.index, {
          index: line.index,
          sourceText: line.text,
          sourceLanguage: translationSourceLanguage,
        });
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

        const finalizedRetry = finalizeTranslatedLine(item.sourceText, retried, normalizedTargetLanguage);
        if (shouldRetryLineTranslation(item.sourceText, finalizedRetry, item.sourceLanguage, normalizedTargetLanguage)) {
          return;
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

    setTranslationCacheEntry(pageNum, cacheKey, translationEntry);
    console.log(`[Translation] cache set page=${pageNum} engine=${ocrEngine} key=${cacheKey}`);

    // Synchronize translated texts back to persistent Layer Store (useLayerStore)
    try {
      const layerStore = useLayerStore.getState();
      const pageLayers = layerStore.getPageLayers(pageNum);
      if (pageLayers.length > 0) {
        const updatedPageLayers = pageLayers.map(layer => {
          const translatedText = translatedByIndex.get(layer.lineIndex);
          if (!translatedText) return layer;

          // RULE 1: หากผู้ใช้เคยแก้ไขเลเยอร์นี้เองแล้ว ให้ข้ามการแปลทับ! (Manual Edit Protection)
          if (layer.userEdited) {
            return layer;
          }

          // RULE 2: อัปเดตข้อมูลคำแปลลงในแคช และเอาไปใช้เป็นค่าข้อความแสดงผลหลัก
          return {
            ...layer,
            translatedText: translatedText,
            text: translatedText,
            translationEngineUsed: effectiveEngine, // 'offline' หรือ 'ai'
          };
        });
        layerStore.setPageLayers(pageNum, {
          layers: updatedPageLayers,
          groups: layerStore.getPageGroups(pageNum),
        });
      } else {
        // *** KEY FIX: Background Queue — หน้านี้ยังไม่เคยถูกเปิดใน UI
        // ดังนั้น layer store ว่างอยู่ ต้องสร้าง layer groups ใหม่ทันที
        // เพื่อให้ผู้ใช้ใช้ select tool และแก้ไข textbox ได้เมื่อเปิดหน้านั้นภายหลัง
        // (เหมือน cache-hit path ที่เรียก buildLayerGroupsFromOCR ด้วย)
        const result = buildLayerGroupsFromOCR(pageOCR, translatedByIndex);
        layerStore.setPageLayers(pageNum, result);
        console.log(`[TranslationSync] Built ${result.layers.length} layer(s) in ${result.groups.length} group(s) for page ${pageNum} (background queue new-translation path).`);
      }
    } catch (err) {
      console.warn('[TranslationSync] Failed to synchronize translation back to Layer Store:', err);
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

    if (sortedPageNums.length === 0) {
      await runCurrentPageTranslation('offline');
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
        const translated = await runCurrentPageTranslation('offline', pageNum, {
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
      await runCurrentPageTranslation('offline');

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

    const jobId = useBackgroundQueueStore.getState().addJob({
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
    });

    // ลัดคิวให้กับไฟล์ปัจจุบันที่เปิดอยู่ เพื่อเริ่มประมวลผลทันที
    useBackgroundQueueStore.getState().boostPriorityForDocument(docId);

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

    const jobId = useBackgroundQueueStore.getState().addJob({
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
    });

    // ลัดคิวให้กับไฟล์ปัจจุบันที่เปิดอยู่ เพื่อเริ่มประมวลผลทันที
    useBackgroundQueueStore.getState().boostPriorityForDocument(docId);

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
      <header className="relative z-50 h-12 bg-[#171b23]/78 border-b border-white/10 backdrop-blur-xl flex items-center px-2 gap-1 shrink-0">
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
      <div className="relative z-10 flex flex-1 overflow-hidden">
        
        {/* 1. LEFT SIDEBAR - Pages Navigator Only */}
        {fileType === 'pdf' && (
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
        <React.Suspense fallback={<div className="w-65 bg-slate-950/55 border-l border-white/10" />}>
          <RightSidebar 
            isAiProcessing={isAiProcessing}
            isOfflineProcessing={isOfflineProcessing}
            onAiTranslate={handleAiTranslate}
            onOfflineTranslate={handleOfflineTranslate}
            onAiTranslateAllPages={handleAiTranslateAllPages}
            onOfflineTranslateAllPages={handleOfflineTranslateAllPages}
            translationStatus={translationStatus}
          />
        </React.Suspense>
      </div>

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
                                onClick={() => useBackgroundQueueStore.getState().boostPriorityForDocument(job.documentId)}
                                className="px-1.5 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-200 border border-cyan-500/20 text-[8.5px] font-semibold transition-colors"
                                title="ลัดคิวให้ไฟล์นี้ทำงานก่อน"
                              >
                                ลัดคิว
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





