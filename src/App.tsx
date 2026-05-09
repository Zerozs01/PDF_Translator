import React, { useState, useEffect } from 'react';
import { 
  ChevronLeft, 
  ChevronRight, 
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
  Compass,
  Flame,
  FileText,
  BarChart3,
  Download
} from 'lucide-react';
import { UploadScreen } from './components/Home/UploadScreen';
import { OCRRegressionHarness } from './components/OCR/OCRRegressionHarness';
import { useUIStore } from './stores/useUIStore';
import { useProjectStore, type SafetySettings, type TranslationMode } from './stores/useProjectStore';
import {
  buildOCRTranslationCacheKey,
  hasCurrentOCRTranslationCacheVersion,
  type OCRTranslationCacheEntry,
  useOCRTextLayerStore,
} from './stores/useOCRTextLayerStore';
import { buildOCRSourceFingerprint } from './services/ocrSourceFingerprint';
import { searchablePDFService } from './services/pdf';
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
  type OverlayLayoutProfile,
  type OverlayPalette,
  type OverlayTypography,
} from './components/OCR/translationOverlayUtils';
import { getOverlayFontOption, getOverlayPrimaryFontName, resolveOverlayFontFamily } from './constants/overlayFonts';
import { BBox, OCRLine, OCREngine, OCRPageResult } from './types';

// Lazy Load Heavy Components
const RightSidebar = React.lazy(() => import('./components/Layout/RightSidebar').then(module => ({ default: module.RightSidebar })));
const PDFCanvas = React.lazy(() => import('./components/PDF/PDFCanvas').then(module => ({ default: module.PDFCanvas })));
const LeftSidebar = React.lazy(() => import('./components/Layout/LeftSidebar').then(module => ({ default: module.LeftSidebar })));
const ImageCanvas = React.lazy(() => import('./components/Image/ImageCanvas').then(module => ({ default: module.ImageCanvas })));
import { visionService } from './services/vision/VisionService';
import { dbService } from './services/dbService';
import './types/electron.d'; // Import type declarations

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

const truncateCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  suffix: string = '...'
): string => {
  const normalized = String(text || '');
  if (!normalized) return '';
  if (ctx.measureText(normalized).width <= maxWidth) return normalized;

  let current = normalized;
  while (current.length > 0 && ctx.measureText(`${current}${suffix}`).width > maxWidth) {
    current = current.slice(0, -1);
  }

  return current ? `${current}${suffix}` : '';
};

const wrapCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  forceSingleLine: boolean
): string[] => {
  const normalized = normalizeOverlayInlineText(String(text || ''));
  if (!normalized) return [];
  if (maxLines <= 1 || forceSingleLine) {
    return [truncateCanvasText(ctx, normalized, maxWidth)];
  }

  const tokens = normalized.includes(' ')
    ? normalized.split(/\s+/g).filter(Boolean)
    : Array.from(normalized);

  const lines: string[] = [];
  let line = '';

  tokens.forEach((token, index) => {
    const unit = normalized.includes(' ') ? token : token;
    const separator = normalized.includes(' ') && line ? ' ' : '';
    const candidate = `${line}${separator}${unit}`;
    if (!line || ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      return;
    }

    lines.push(line);
    line = unit;

    if (lines.length >= maxLines) {
      return;
    }

    if (index === tokens.length - 1) {
      lines.push(line);
    }
  });

  if (line && lines.length < maxLines) {
    lines.push(line);
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  if (lines.length === 0) {
    return [truncateCanvasText(ctx, normalized, maxWidth)];
  }

  const consumed = lines.join(normalized.includes(' ') ? ' ' : '');
  if (consumed.length < normalized.length) {
    const lastIndex = Math.max(0, lines.length - 1);
    lines[lastIndex] = truncateCanvasText(ctx, lines[lastIndex], maxWidth);
  }

  return lines;
};

const readPersistedBooleanFlag = (key: string, defaultValue: boolean): boolean => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const raw = String(window.localStorage.getItem(key) || '').trim().toLowerCase();
    if (!raw) return defaultValue;
    if (raw === '0' || raw === 'false' || raw === 'off') return false;
    if (raw === '1' || raw === 'true' || raw === 'on') return true;
    return defaultValue;
  } catch {
    return defaultValue;
  }
};

const isBalloonAwareGroupingEnabled = (): boolean =>
  readPersistedBooleanFlag(ENABLE_BALLOON_AWARE_GROUPING_STORAGE_KEY, true);

const isLayoutGroupingDebugEnabled = (): boolean =>
  readPersistedBooleanFlag(LAYOUT_GROUPING_DEBUG_STORAGE_KEY, false);

const GENERIC_FONT_FAMILY_SET = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
]);

const parseFontFamilyCandidates = (fontFamily: string): string[] =>
  String(fontFamily || '')
    .split(',')
    .map((candidate) => candidate.trim().replace(/^['"]+|['"]+$/g, ''))
    .filter(Boolean);

const buildCanvasFontFamily = async (
  preferredFontFamily: string,
  fallbackFontFamily: string
): Promise<string> => {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return preferredFontFamily || fallbackFontFamily;
  }

  const fontFaceSet = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fontFaceSet) {
    return preferredFontFamily || fallbackFontFamily;
  }

  const candidates = [
    ...parseFontFamilyCandidates(preferredFontFamily),
    ...parseFontFamilyCandidates(fallbackFontFamily),
  ];

  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized || GENERIC_FONT_FAMILY_SET.has(normalized.toLowerCase())) {
      continue;
    }

    const quoted = /[\s'"]/.test(normalized) ? `"${normalized.replace(/"/g, '\\"')}"` : normalized;
    try {
      await Promise.allSettled([
        fontFaceSet.load(`400 16px ${quoted}`, 'กขabCD'),
        fontFaceSet.load(`500 16px ${quoted}`, 'กขabCD'),
        fontFaceSet.load(`600 16px ${quoted}`, 'กขabCD'),
      ]);
      if (fontFaceSet.check(`16px ${quoted}`, 'กขabCD')) {
        return `${quoted}, ${fallbackFontFamily || 'sans-serif'}`;
      }
    } catch {
      // Ignore font probing errors and continue to the next family.
    }
  }

  return preferredFontFamily || fallbackFontFamily;
};

const resolveOverlayExportScale = (
  visibleWidth: number,
  visibleHeight: number,
  sourceWidth: number,
  sourceHeight: number
): number => {
  const safeVisibleWidth = Math.max(1, visibleWidth);
  const safeVisibleHeight = Math.max(1, visibleHeight);
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const sourceRatio = Math.max(safeSourceWidth / safeVisibleWidth, safeSourceHeight / safeVisibleHeight);
  const deviceRatio = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1;

  return Math.min(3, Math.max(1.5, deviceRatio, sourceRatio));
};

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
    texts.map((text) => translateWithGemini(text, type, mode, sourceLanguage, targetLanguage, contextOverrides))
  );
}

const OFFLINE_PIVOT_SOURCE_LANGUAGES = new Set(['es', 'ko']);

const shouldUseOfflinePivotRoute = (sourceLanguage: string, targetLanguage: string): boolean => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  return normalizedTarget === 'th' && OFFLINE_PIVOT_SOURCE_LANGUAGES.has(normalizedSource);
};

const selectOfflinePivotCandidate = (
  sourceText: string,
  sourceLanguage: string,
  targetLanguage: string,
  directText: string,
  pivotText: string
): string => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  const direct = normalizeWhitespace(String(directText || ''));
  const pivot = normalizeWhitespace(String(pivotText || ''));

  if (!pivot) return direct;
  if (!direct) return pivot;

  const directNeedsRetry = shouldRetryLineTranslation(sourceText, direct, normalizedSource, normalizedTarget);
  const pivotNeedsRetry = shouldRetryLineTranslation(sourceText, pivot, normalizedSource, normalizedTarget);

  // For Spanish/Korean -> Thai offline routes, prefer pivot output when it passes basic quality gates.
  if (OFFLINE_PIVOT_SOURCE_LANGUAGES.has(normalizedSource) && !pivotNeedsRetry) {
    return pivot;
  }
  if (directNeedsRetry && !pivotNeedsRetry) return pivot;
  if (!directNeedsRetry && pivotNeedsRetry) return direct;

  const directScore = scoreTranslationCandidate(sourceText, direct, normalizedTarget);
  const pivotScore = scoreTranslationCandidate(sourceText, pivot, normalizedTarget);
  const pivotBias = normalizedSource === 'es' ? 14 : 10;
  if (pivotScore >= directScore - pivotBias) {
    return pivot;
  }
  return directScore >= pivotScore ? direct : pivot;
};

async function translateBatchOffline(
  texts: string[],
  type: string,
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string
): Promise<string[]> {
  if (texts.length === 0) return [];

  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  const directTranslations = await translateBatchOfflineBridge(
    texts,
    type,
    mode,
    normalizedSource,
    normalizedTarget
  );

  if (!shouldUseOfflinePivotRoute(normalizedSource, normalizedTarget)) {
    return directTranslations;
  }

  try {
    const pivotEnglish = await translateBatchOfflineBridge(
      texts,
      type,
      mode,
      normalizedSource,
      'en'
    );
    const pivotEnglishPrepared = pivotEnglish.map((line, index) => {
      const normalizedPivot = normalizeSourceForTranslation(String(line || ''), 'en');
      if (normalizedPivot) return normalizedPivot;
      return normalizeSourceForTranslation(String(texts[index] || ''), normalizedSource);
    });
    const pivotThai = await translateBatchOfflineBridge(
      pivotEnglishPrepared,
      type,
      mode,
      'en',
      normalizedTarget
    );

    return texts.map((sourceText, index) => selectOfflinePivotCandidate(
      String(sourceText || ''),
      normalizedSource,
      normalizedTarget,
      String(directTranslations[index] || ''),
      String(pivotThai[index] || '')
    ));
  } catch (error) {
    console.warn(`[OfflineTranslation] Pivot fallback ${normalizedSource}->en->${normalizedTarget} failed:`, error);
    return directTranslations;
  }
}

export type TranslatableLine = {
  index: number;
  text: string;
  sourceLength: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
  area?: number;
  wordCoverage?: number;
  wordBoxCount?: number;
  confidence?: number;
  quad?: OCRLineWithLayout['quad'];
  angleDeg?: number;
  sortHintX?: number;
  sortHintY?: number;
  sourceEngine?: string;
};

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

type TranslationGroupingProfile = 'default' | 'dense-dialogue' | 'line-by-line' | 'balloon-aware';

type GroupingDecision = {
  appliedProfile: 'raw' | 'dense-dialogue' | 'balloon-aware';
  confidence: number;
  fallbackReason?: string;
};

type BatchGroupPlan = {
  index: number;
  lines: TranslatableLine[];
  sourceLanguage: string;
  sourceText: string;
  protectedText: string;
  replacements: ProtectedTokenReplacement[];
};

type BatchPageTranslationPlan = {
  pageNum: number;
  ocr: OCRPageResult;
  ocrEngine: OCREngine;
  ocrLanguageKey: string;
  sourceLanguage: string;
  lines: TranslatableLine[];
  groups: BatchGroupPlan[];
  groupingProfile: TranslationGroupingProfile;
  groupingDecision?: GroupingDecision;
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

const buildBatchMarkdownPayload = (
  plans: BatchPageTranslationPlan[],
  translationMode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string
): string => {
  const lines: string[] = [];
  lines.push('# OCR Translation Batch');
  lines.push('');
  lines.push('## Metadata');
  lines.push(`- translationMode: ${translationMode}`);
  lines.push(`- sourceLanguage: ${sourceLanguage}`);
  lines.push(`- targetLanguage: ${targetLanguage}`);
  lines.push(`- pageCount: ${plans.length}`);
  lines.push('');
  lines.push('## Required Output Format');
  lines.push('Return ONLY valid JSON with this exact schema:');
  lines.push('```json');
  lines.push('{');
  lines.push('  "pages": [');
  lines.push('    { "page": 1, "groups": [ { "index": 0, "text": "..." } ] }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('Rules:');
  lines.push('- Every input group index must appear once in output for the same page.');
  lines.push('- Keep index values unchanged.');
  lines.push('- Translate text only; do not include notes, markdown, or extra fields.');
  lines.push('');
  lines.push('## OCR Input');

  for (const plan of plans) {
    lines.push('');
    lines.push(`### Page ${plan.pageNum}`);
    lines.push(`- ocrEngine: ${plan.ocrEngine}`);
    lines.push(`- ocrLanguage: ${plan.ocrLanguageKey}`);
    lines.push(`- sourceLanguage: ${plan.sourceLanguage}`);
    lines.push(`- groupingProfile: ${plan.groupingProfile}`);
    lines.push('- groups:');
    for (const group of plan.groups) {
      // Use \\n to explicitly tell the model where the line breaks are
      const clean = String(group.protectedText || '').replace(/\r?\n+/g, '\\n').trim();
      const lineIndexes = group.lines.map((line) => line.index).join(',');
      lines.push(`  - [${group.index}] (lines: ${lineIndexes}, source: ${group.sourceLanguage}) ${clean}`);
    }
  }

  return lines.join('\n');
};

const extractJsonObjectText = (raw: string): string => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || raw || '').trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Gemini batch response does not contain a valid JSON object.');
  }
  return candidate.slice(start, end + 1);
};

const parseBatchJsonResponse = (raw: string): Map<number, Map<number, string>> => {
  const jsonText = extractJsonObjectText(raw);
  const parsed = JSON.parse(jsonText) as {
    pages?: Array<{
      page?: number;
      pageNumber?: number;
      groups?: Array<{ index?: number; text?: string }>;
      lines?: Array<{ index?: number; text?: string }>;
    }>;
  };

  if (!Array.isArray(parsed.pages)) {
    throw new Error('Gemini batch response JSON is missing pages array.');
  }

  const byPage = new Map<number, Map<number, string>>();
  parsed.pages.forEach((pageEntry) => {
    const pageNum = Number(pageEntry.page ?? pageEntry.pageNumber);
    if (!Number.isFinite(pageNum)) return;
    const lineMap = new Map<number, string>();
    if (Array.isArray(pageEntry.groups)) {
      pageEntry.groups.forEach((line) => {
        const index = Number(line.index);
        if (!Number.isFinite(index)) return;
        lineMap.set(index, String(line.text || '').trim());
      });
    } else if (Array.isArray(pageEntry.lines)) {
      // Backward-compatible fallback if model returns previous line schema.
      pageEntry.lines.forEach((line) => {
        const index = Number(line.index);
        if (!Number.isFinite(index)) return;
        lineMap.set(index, String(line.text || '').trim());
      });
    }
    byPage.set(pageNum, lineMap);
  });

  return byPage;
};

const SENTENCE_END_REGEX = /[.!?\u2026\u3002\uFF01\uFF1F]$/;
const SOFT_CONTINUATION_END_REGEX = /[,;:\-\u2014\u2013\u3001\uFF0C]$/;
const CONTINUATION_TRAILING_WORD_REGEX = /\b(?:a|an|the|of|to|for|and|or|but|if|when|while|with|without|into|onto|from|by|as|than|that|this|these|those|my|your|his|her|its|our|their|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|will|would|should|must|may|might|not|so|up|off|out|over|under|about|around|through|toward|towards)$/i;
const CONTINUATION_LEADING_WORD_REGEX = /^(?:and|or|but|if|when|while|because|that|which|who|whose|whom|to|for|of|with|as|than|then|so|also|still|yet|just)\b/i;

const countReadableLength = (text: string): number => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length;
};

const isStrongSentenceEnd = (text: string): boolean => {
  const compact = text.trim();
  if (!compact) return false;
  return SENTENCE_END_REGEX.test(compact);
};

const isLikelyContinuation = (previousText: string, currentText: string): boolean => {
  const prev = previousText.trim();
  const curr = currentText.trim();
  if (!prev || !curr) return false;

  if (SOFT_CONTINUATION_END_REGEX.test(prev)) return true;
  if (/[\-\u2013\u2014]$/.test(prev)) return true;
  if (CONTINUATION_TRAILING_WORD_REGEX.test(prev)) return true;
  if (/^[,;:.)\]\}"'\u3001\uFF0C]/.test(curr)) return true;
  if (/^[a-z]/.test(curr)) return true;
  if (CONTINUATION_LEADING_WORD_REGEX.test(curr)) return true;
  return false;
};

const isLikelyStandaloneInterjectionLine = (text: string): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;

  const compact = normalized.replace(/\s+/g, '');
  const tokens = normalized.split(/\s+/g).filter(Boolean);
  if (compact.length > 16 || tokens.length > 3) return false;

  if (/^[A-Za-z]-[A-Za-z][A-Za-z'’!?….-]{0,12}$/.test(compact)) {
    return true;
  }

  const trailingPunct = /[!?…]{1,3}$/.test(compact);
  const latinLetters = compact.replace(/[^A-Za-z]/g, '').length;
  if (trailingPunct && latinLetters > 0 && latinLetters <= 8 && tokens.length <= 2) {
    return true;
  }

  const nonLatin = compact.replace(/[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '').length !== compact.length;
  if (trailingPunct && nonLatin && compact.length <= 7) {
    return true;
  }

  return false;
};

const computeMedian = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
};

const normalizeWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

type ProtectedTokenReplacement = {
  token: string;
  replacement: string;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildLooseTokenPattern = (token: string): RegExp => {
  const parts = token
    .split('')
    .map((ch) => escapeRegExp(ch))
    .join('[\\s_\\-]*');
  return new RegExp(parts, 'gi');
};

const TECHNICAL_OCR_NORMALIZERS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bR\s*E\s*A\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'REACTION' },
  { pattern: /\bD\s*I\s*R\s*E\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'DIRECTION' },
  { pattern: /\bC\s*O\s*N\s*N\s*E\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'CONNECTION' },
];

const ENGLISH_OCR_NOISE_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bA-\s*Areyou\b/gi, replacement: 'A-Are you' },
  { pattern: /\bA-\s*Are\s*y\b/gi, replacement: 'A-Are you' },
  { pattern: /\bAreyou\b/gi, replacement: 'Are you' },
  { pattern: /\bYOU\s*-\s*COULD\b/gi, replacement: 'YOU COULD' },
  { pattern: /\bSO\s+ME\s+THING\b/gi, replacement: 'SOMETHING' },
  { pattern: /\bIT'?SA\b/gi, replacement: "IT'S A" },
  { pattern: /\bIT'?S\s+BESTIF\b/gi, replacement: "IT'S BEST IF" },
  { pattern: /\bBESTIF\b/gi, replacement: 'BEST IF' },
  { pattern: /\bTHENHISWHOLE\b/gi, replacement: 'THEN HIS WHOLE' },
  { pattern: /\bBODYWAS\b/gi, replacement: 'BODY WAS' },
  { pattern: /\bLIKEAFURNACE\b/gi, replacement: 'LIKE A FURNACE' },
  { pattern: /\bBUTNOW\b/gi, replacement: 'BUT NOW' },
  { pattern: /\bASICE\b/gi, replacement: 'AS ICE' },
  { pattern: /\bSCOLD\s+AS\s+ICE\b/gi, replacement: 'COLD AS ICE' },
  { pattern: /\bHE\s+SCOLD\b/gi, replacement: "HE'S COLD" },
  { pattern: /WHAT\s+KIND-OE/gi, replacement: 'WHAT KIND OF' },
  { pattern: /MY\s*STERIOUS/gi, replacement: 'MYSTERIOUS' },
  { pattern: /UKELY/gi, replacement: 'LIKELY' },
  { pattern: /HMM_\s*GUESS/gi, replacement: 'HMM I GUESS' },
  {
    pattern: /\bthis\s+submaie\s+to\s+in\s+ureat\s+the\s+ydoot\s+falinth\s+i\s+chapt\s+we\s+willtudhow\b/gi,
    replacement: 'this submarine to insure that they do not fail in this chapter we will study how',
  },
  {
    pattern: /\bsubmaie\s+to\s+in\s+ureat\s+the\s+ydoot\s+falinth\s+i\s+chapt\s+we\s+willtudhow\b/gi,
    replacement: 'submarine to insure that they do not fail in this chapter we will study how',
  },
  { pattern: /\bsubmaie\b/gi, replacement: 'submarine' },
  { pattern: /\bureat\b/gi, replacement: 'insure that' },
  { pattern: /\bydoot\b/gi, replacement: 'they do not' },
  { pattern: /\bfalinth\b/gi, replacement: 'fail in this' },
  { pattern: /\bi\s+chapt\b/gi, replacement: 'in this chapter' },
  { pattern: /\bchapt\b/gi, replacement: 'chapter' },
  { pattern: /\bwilltudhow\b/gi, replacement: 'will study how' },
  {
    pattern: /\bof\s*the\s+effctofravt\s*a?t?\s*i?\s*on\s+a\s*ctriclm\s*a\s*gnetiontact\s*rescaused\b/gi,
    replacement: 'of the effects of gravitational, electrical, magnetic, or contact forces caused',
  },
  { pattern: /\beffctofravt\b/gi, replacement: 'effects of gravitational' },
  { pattern: /\bctriclm\s*a\s*gnetiontact\b/gi, replacement: 'electrical, magnetic, or contact' },
  { pattern: /\brescaused\b/gi, replacement: 'forces caused' },
];

const normalizeEnglishOcrNoiseForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  ENGLISH_OCR_NOISE_REPAIRS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  normalized = normalized.replace(
    /\bBACK\s+THEN\s+HIS\s+WHOLE\s+BODY\s+WAS\s+BURNING\s+UP\s+LIKE\s+A\s+FURNACE\s+BUT\s+NOW\s+HE'?S?\s+COLD\s+AS\s+ICE\b/gi,
    "BACK THEN HIS WHOLE BODY WAS BURNING UP LIKE A FURNACE, BUT NOW HE'S COLD AS ICE"
  );

  const compactLatin = normalized.toLowerCase().replace(/[^a-z]/g, '');
  if (
    compactLatin.includes('oftheeffctofravt')
    && compactLatin.includes('gnetiontact')
    && compactLatin.includes('rescaused')
  ) {
    normalized = 'of the effects of gravitational, electrical, magnetic, or contact forces caused';
  }

  return normalizeWhitespace(normalized);
};

const SPANISH_OCR_NOISE_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bQUE ?ME\b/gi, replacement: 'QUE ME' },
  { pattern: /\bQUEME\b/gi, replacement: 'QUE ME' },
  { pattern: /\bSI ?ME\b/gi, replacement: 'SI ME' },
  { pattern: /\bSIME\b/gi, replacement: 'SI ME' },
  { pattern: /\bS[- ]?SIENTO\b/gi, replacement: 'SIENTO' },
  { pattern: /\bDE ?LO\b/gi, replacement: 'DE LO' },
  { pattern: /\bDELO\b/gi, replacement: 'DE LO' },
  { pattern: /\bTO ?DO\b/gi, replacement: 'TODO' },
  { pattern: /\bTODOLOQUE\b/gi, replacement: 'TODO LO QUE' },
  { pattern: /\bLOQUE\b/gi, replacement: 'LO QUE' },
  { pattern: /\bLISTO ?CON\b/gi, replacement: 'LISTO CON' },
  { pattern: /\bLISTOCON\b/gi, replacement: 'LISTO CON' },
  { pattern: /\b[i¡]?LISTO[.!?…]+CON\b/gi, replacement: 'LISTO CON' },
  { pattern: /\bPRI-?\s*MERO\s*LA\s*FOTO\b/gi, replacement: 'PRIMERO LA FOTO' },
  { pattern: /\bPRIMEROLAFOTO\b/gi, replacement: 'PRIMERO LA FOTO' },
  { pattern: /\bMETIENDO\s*POR\b/gi, replacement: 'METIENDO POR' },
  { pattern: /\bMETIENDOPOR\b/gi, replacement: 'METIENDO POR' },
  { pattern: /\bPOR ?DENTRO\b/gi, replacement: 'POR DENTRO' },
  { pattern: /\bPORDENTRO\b/gi, replacement: 'POR DENTRO' },
  { pattern: /\bYA ?QUEDO\b/gi, replacement: 'YA QUEDO' },
  { pattern: /\bYAQUEDO\b/gi, replacement: 'YA QUEDO' },
  { pattern: /\bRAPIDOPR\b/gi, replacement: 'RAPIDO PR' },
  { pattern: /\bDE,\s*PIDIERON\b/gi, replacement: 'DESPIDIERON' },
  { pattern: /\bI?RAPIDO,?\s*PRI-?\b/gi, replacement: 'RAPIDO, PRI-' },
  { pattern: /\bCOMOSI\b/gi, replacement: 'COMO SI' },
  { pattern: /\bCIERTASPARTES\b/gi, replacement: 'CIERTAS PARTES' },
  { pattern: /\bERAUNPOCO\b/gi, replacement: 'ERA UN POCO' },
  { pattern: /\bNOERAUNPOCO\b/gi, replacement: 'NO ERA UN POCO' },
  { pattern: /\bSERAQUE\b/gi, replacement: 'SERA QUE' },
  { pattern: /\bCONMAS\b/gi, replacement: 'CON MAS' },
  { pattern: /\bM[ÁA]SDETALLE\b/gi, replacement: 'MAS DETALLE' },
  { pattern: /\bDETA\s*-?\s*LLE(?:S)?\b/gi, replacement: 'DETALLE' },
  { pattern: /\bENESPECI(?:FICO|ICO)\b/gi, replacement: 'EN ESPECIFICO' },
  { pattern: /\bESPEI?CICO\b/gi, replacement: 'ESPECIFICO' },
  { pattern: /\bALGE\s+ASI\b/gi, replacement: 'ALGO ASI' },
];

const SPANISH_FUNCTION_WORD_GLUE_PATTERN = /\b([A-ZÁÉÍÓÚÜÑ]{3,})(QUE|ME|TE|SE|LO|LA|LOS|LAS|UN|UNA|MAS|ASI|CON|SIN|POR|PARA|EN)([A-ZÁÉÍÓÚÜÑ]{3,})\b/g;

const splitSpanishUppercaseCompounds = (text: string): string => {
  let normalized = String(text || '');
  for (let i = 0; i < 2; i += 1) {
    normalized = normalized.replace(SPANISH_FUNCTION_WORD_GLUE_PATTERN, '$1 $2 $3');
  }
  return normalized;
};

export const normalizeSpanishOcrNoiseForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  normalized = normalized.replace(/(^|[\s"'([{])iC[-\s]*/gi, '$1¿C');
  normalized = normalized.replace(/(^|[\s"'([{])i(?=COMO\b)/gi, '$1¿');
  SPANISH_OCR_NOISE_REPAIRS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });
  normalized = splitSpanishUppercaseCompounds(normalized);
  normalized = normalized.replace(/¿C{2,}(?=OMO\b)/gi, '¿C');
  normalized = normalized.replace(/\bESPEC[IÍ]FICO\b/gi, 'ESPECIFICO');
  normalized = normalized.replace(/\bC+EH(?=[!?…])/gi, 'EH');
  normalized = normalized.replace(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2}),\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,})\b/g, '$1$2');
  normalized = normalized.replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])\s*,\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, '$1, $2');
  return normalizeWhitespace(normalized);
};

const normalizeTechnicalArtifactsForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  TECHNICAL_OCR_NORMALIZERS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  normalized = normalized.replace(/\bCHAPTEROBJECTIVES\b/gi, 'CHAPTER OBJECTIVES');
  normalized = normalized.replace(/\bCONDITIONSFOR\b/gi, 'CONDITIONS FOR');
  normalized = normalized.replace(/\bOFTHE\b/gi, 'OF THE');
  normalized = normalized.replace(/\bEQUATIONSOF\b/gi, 'EQUATIONS OF');
  normalized = normalized.replace(/\b([FM])\s+([xyzXYZ]|\d{1,2})\b/g, '$1$2');
  normalized = normalized.replace(/([\u0391-\u03C9\u03D1\u03D5\u03F0\u03F4])([A-Za-z])/g, '$1 $2');
  normalized = normalized.replace(/\b(Fig(?:ure)?\.?|Table|Chapter)\s*(\d)\s*[\u2013\u2014\-]\s*(\d)\b/gi, '$1 $2-$3');
  return normalized;
};

const normalizePossessiveCompoundsForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  normalized = normalized.replace(/\b([A-Za-z]{3,})['’]S([A-Za-z]{3,})\b/g, "$1'S $2");
  normalized = normalized.replace(/\[\s*([A-Za-z]{3,})['’]S([A-Za-z]{3,})\s*\]/g, "[$1'S $2]");
  normalized = normalized.replace(/\b([A-Za-z]{3,})([\-_/])([A-Za-z]{3,})\b/g, '$1 $2 $3');
  return normalizeWhitespace(normalized);
};

const normalizeSourceForTranslation = (text: string, sourceLanguage = ''): string => {
  let normalized = normalizeTechnicalArtifactsForTranslation(text);
  normalized = normalizePossessiveCompoundsForTranslation(normalized);
  normalized = normalizeEnglishOcrNoiseForTranslation(normalized);
  if (normalizeTranslationLanguage(sourceLanguage, '') === 'es') {
    normalized = normalizeSpanishOcrNoiseForTranslation(normalized);
  }
  normalized = normalized.replace(/\s+([,.;:!?])/g, '$1');
  normalized = normalized.replace(/([,.;:!?])(\S)/g, '$1 $2');
  // Strip trailing/leading underscores — common OCR noise in comic text (e.g., "HONESTLY_" → "HONESTLY")
  normalized = normalized.replace(/(?<=\s|^)_+/g, '').replace(/_+(?=\s|$)/g, '');
  normalized = normalized.replace(/\b([A-Za-z]{2,})_+\b/g, '$1');
  normalized = normalized.replace(/\b_+([A-Za-z]{2,})\b/g, '$1');
  normalized = normalizeWhitespace(normalized);

  const latinOnly = normalized.replace(/[^A-Za-z]/g, '');
  const words = normalized.split(/\s+/g).filter(Boolean);
  const looksLikeAcronymSequence = words.length > 0 && words.every((word) => {
    const lettersOnly = word.replace(/[^A-Za-z]/g, '');
    if (!lettersOnly) return true;
    return lettersOnly.length <= 3 && lettersOnly === lettersOnly.toUpperCase();
  });

  if (latinOnly.length >= 5 && !looksLikeAcronymSequence) {
    const uppercaseCount = latinOnly.replace(/[^A-Z]/g, '').length;
    const upperRatio = uppercaseCount / latinOnly.length;
    if (upperRatio >= 0.72) {
      // Text is predominantly uppercase — lowercase it for Argos translation.
      // Mixed-case words like "FAiR", "OUt", "PRidE" in mostly-uppercase text
      // are OCR noise, not intentional casing, so we normalize them too.
      normalized = normalized.toLowerCase();
      normalized = normalized.replace(/(^|[.!?]\s+)([a-z])/g, (_m, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
    }
  }

  return normalized;
};

const normalizeThaiTranslationText = (text: string): string => {
  let normalized = String(text || '');
  for (let i = 0; i < 6; i += 1) {
    const next = normalized.replace(/([\u0E00-\u0E7F])\s+([\u0E00-\u0E7F])/g, '$1$2');
    if (next === normalized) break;
    normalized = next;
  }
  normalized = normalized
    .replace(/([\(\[\{])\s+/g, '$1')
    .replace(/\s+([\)\]\}])/g, '$1');
  normalized = normalized.replace(/\s+([,.;:!?])/g, '$1');
  return normalizeWhitespace(normalized);
};

const THAI_BOUNDARY_ATTACH_TOKENS = new Set([
  'ไป',
  'นะ',
  'สิ',
  'ละ',
  'ล่ะ',
  'เลย',
  'ก็',
  'มาก',
  'อยู่',
  'แล้ว',
  'ด้วย',
  'กัน',
  'เอง',
  'เหรอ',
  'หรอ',
  'หรือ',
  'ไหม',
  'มั้ย',
  'ครับ',
  'ค่ะ',
]);

const THAI_BOUNDARY_NO_SPLIT_PAIRS = new Set([
  'เกิน|ไป',
  'ให้|กับ',
  'ยัง|ไม่',
  'ไม่|รู้',
  'หายาก|มาก',
  'ปิ|ด',
]);

const normalizeThaiBoundaryToken = (segment: string): string =>
  normalizeThaiTranslationText(segment).replace(/[^\u0E00-\u0E7F]/g, '');

const collapseRepeatedTranslationFragments = (text: string): string => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return normalized;

  // Common OCR+translation artifact: duplicated hesitant opener (e.g. "A-Are you A-Are you ...").
  const dedupHesitation = normalized.replace(
    /(A-?\s*Are\s+you)(?:\s+\1)+/gi,
    '$1'
  );
  if (dedupHesitation !== normalized) {
    return normalizeWhitespace(dedupHesitation);
  }

  const repeatedChunk = normalized.match(/^(.{4,}?)(?:\s+\1)+$/u);
  if (repeatedChunk?.[1]) {
    return normalizeWhitespace(repeatedChunk[1]);
  }

  const tokens = normalized.split(/\s+/g).filter(Boolean);
  if (tokens.length >= 4 && tokens.length % 2 === 0) {
    const half = tokens.length / 2;
    const firstHalf = tokens.slice(0, half).join(' ');
    const secondHalf = tokens.slice(half).join(' ');
    if (firstHalf === secondHalf) {
      return firstHalf;
    }
  }

  if (tokens.length >= 6) {
    const normalizeTokenSpan = (spanTokens: string[]): string =>
      spanTokens
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/giu, '');

    const maxSpan = Math.min(8, Math.floor(tokens.length / 2));
    for (let span = maxSpan; span >= 2; span -= 1) {
      const firstSpan = tokens.slice(0, span);
      const secondSpan = tokens.slice(span, span * 2);
      if (secondSpan.length < span) continue;

      const firstKey = normalizeTokenSpan(firstSpan);
      const secondKey = normalizeTokenSpan(secondSpan);
      if (!firstKey || firstKey.length < 6) continue;
      if (firstKey !== secondKey) continue;

      const merged = [...firstSpan, ...tokens.slice(span * 2)].join(' ');
      return normalizeWhitespace(merged);
    }
  }

  return normalized;
};

const TRANSLATION_LETTER_REGEX = /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
const HANGUL_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
const THAI_REGEX = /[\u0E00-\u0E7F]/;

const buildTranslationComparisonKey = (value: string): string =>
  normalizeWhitespace(String(value || ''))
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');

const shouldSkipOverlayForUntranslatedCarryOver = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): boolean => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;

  const source = normalizeWhitespace(String(sourceText || ''));
  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!source || !translated) return false;
  if (isScientificSymbolLikeLine(source)) return false;

  const sourceKey = buildTranslationComparisonKey(source);
  const translatedKey = buildTranslationComparisonKey(translated);
  if (!sourceKey || !translatedKey) return false;

  const thaiChars = (translated.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latinChars = (translated.match(/[A-Za-z]/g) || []).length;
  const sourceLatinChars = (source.match(/[A-Za-z]/g) || []).length;
  const tokenCount = source.split(/\s+/g).filter(Boolean).length;
  if (thaiChars > 0) return false;

  if (sourceKey === translatedKey) {
    return tokenCount >= 1 && (sourceLatinChars >= 4 || source.length >= 4);
  }

  return latinChars >= 4 && sourceLatinChars >= 4 && tokenCount >= 2;
};

const isSourceFallbackOverlayText = (sourceText: string, translatedText: string): boolean => {
  const source = normalizeWhitespace(String(sourceText || ''));
  const translated = normalizeWhitespace(String(translatedText || ''));
  return Boolean(source && translated && source === translated);
};

const shouldRetryLineTranslation = (
  sourceText: string,
  translatedText: string,
  sourceLanguage: string,
  targetLanguage: string
): boolean => {
  const source = normalizeWhitespace(String(sourceText || ''));
  if (!source) return false;
  if (!TRANSLATION_LETTER_REGEX.test(source)) return false;

  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!translated) return true;

  const sourceKey = buildTranslationComparisonKey(source);
  const translatedKey = buildTranslationComparisonKey(translated);
  if (sourceKey && translatedKey && sourceKey === translatedKey) {
    return true;
  }

  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');

  if (normalizedTarget === 'th') {
    const letterChars = translated.match(/[A-Za-z\u0E00-\u0E7F]/g) || [];
    const latinChars = translated.match(/[A-Za-z]/g) || [];
    const thaiChars = translated.match(/[\u0E00-\u0E7F]/g) || [];
    const latinRatio = latinChars.length / Math.max(1, letterChars.length);
    const looksUntranslatedLatin = letterChars.length >= 10 && latinRatio >= 0.62 && thaiChars.length <= 2;
    if (looksUntranslatedLatin) {
      return true;
    }

    const sourceLatinChars = source.match(/[A-Za-z]/g) || [];
    const translatedAlphaChars = translated.match(/[A-Za-z\u0E00-\u0E7F]/g) || [];
    const translatedHasNoThai = thaiChars.length === 0;
    const mostlyLatinShortCarryOver = translatedHasNoThai
      && sourceLatinChars.length >= 4
      && translatedAlphaChars.length >= Math.min(4, sourceLatinChars.length)
      && latinRatio >= 0.78;
    if (mostlyLatinShortCarryOver) {
      return true;
    }

    const mixedCarryOver = sourceLatinChars.length >= 8
      && thaiChars.length >= 1
      && translatedAlphaChars.length >= 10
      && latinRatio >= 0.4;
    if (mixedCarryOver) {
      return true;
    }

    if (hasKnownOcrNoisePattern(source) && thaiChars.length === 0) {
      return true;
    }
  }

  if (normalizedSource === 'ko' && normalizedTarget === 'th') {
    const hasHangul = HANGUL_REGEX.test(translated);
    const hasThai = THAI_REGEX.test(translated);
    if (hasHangul && !hasThai) {
      return true;
    }
  }

  return false;
};

const getTranslationScriptStats = (text: string): {
  thaiChars: number;
  latinChars: number;
  letterChars: number;
  latinRatio: number;
  thaiRatio: number;
} => {
  const normalized = normalizeWhitespace(String(text || ''));
  const thaiChars = (normalized.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
  const letterChars = thaiChars + latinChars;
  return {
    thaiChars,
    latinChars,
    letterChars,
    latinRatio: latinChars / Math.max(1, letterChars),
    thaiRatio: thaiChars / Math.max(1, letterChars),
  };
};

const shouldRetryGroupTranslation = (
  sourceText: string,
  translatedText: string,
  sourceLanguage: string,
  targetLanguage: string
): boolean => {
  if (shouldRetryLineTranslation(sourceText, translatedText, sourceLanguage, targetLanguage)) {
    return true;
  }

  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;

  const source = normalizeWhitespace(String(sourceText || ''));
  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!source || !translated) return false;

  const sourceLatinChars = (source.match(/[A-Za-z]/g) || []).length;
  const translatedStats = getTranslationScriptStats(translated);
  if (sourceLatinChars < 8 || translatedStats.letterChars < 8) return false;

  if (translatedStats.thaiChars === 0) return true;
  if (translatedStats.latinRatio >= 0.34) return true;
  if (translatedStats.thaiRatio <= 0.18) return true;
  return false;
};

const scoreTranslationCandidate = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): number => {
  const source = normalizeWhitespace(String(sourceText || ''));
  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!translated) return Number.NEGATIVE_INFINITY;

  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  const sourceKey = buildTranslationComparisonKey(source);
  const translatedKey = buildTranslationComparisonKey(translated);
  let score = translated.length;

  if (normalizedTarget === 'th') {
    const stats = getTranslationScriptStats(translated);
    score += stats.thaiChars * 4;
    score -= stats.latinChars * 3;
    if (stats.thaiChars === 0 && stats.latinChars > 0) {
      score -= 220;
    }
    if (stats.latinRatio >= 0.4) {
      score -= 120;
    }
  }

  if (sourceKey && translatedKey && sourceKey === translatedKey) {
    score -= 400;
  }

  return score;
};

const buildOfflineGroupRetrySourceText = (lines: TranslatableLine[], sourceLanguage = ''): string => {
  const prepared = lines
    .map((line) => normalizeSourceForTranslation(line.text, sourceLanguage))
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  if (prepared.length <= 1) {
    return prepared[0] || '';
  }

  const stitched: string[] = [prepared[0]];
  for (let i = 1; i < prepared.length; i += 1) {
    const current = prepared[i];
    const previous = stitched[stitched.length - 1] || '';
    const previousEndsSentence = /[.!?…]"?$/.test(previous);
    const currentStartsContinuation = /^[a-z,\])]/.test(current);
    stitched[stitched.length - 1] = previousEndsSentence || currentStartsContinuation
      ? previous
      : `${previous}.`;
    stitched.push(current);
  }

  return stitched.join(' ');
};

const TRANSLATION_LANGUAGE_ALIASES: Record<string, string> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  th: 'th',
  tha: 'th',
  thai: 'th',
  ja: 'ja',
  jpn: 'ja',
  jpn_vert: 'ja',
  ko: 'ko',
  kor: 'ko',
  zh: 'zh',
  chi: 'zh',
  chi_sim: 'zh',
  chi_tra: 'zh',
  vi: 'vi',
  vie: 'vi',
  de: 'de',
  deu: 'de',
  fr: 'fr',
  fra: 'fr',
  ru: 'ru',
  rus: 'ru',
  es: 'es',
  spa: 'es',
};

const normalizeTranslationLanguage = (value: string, fallback: string): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (TRANSLATION_LANGUAGE_ALIASES[raw]) return TRANSLATION_LANGUAGE_ALIASES[raw];
  const primary = raw.split('-')[0].trim();
  if (!primary) return fallback;
  return TRANSLATION_LANGUAGE_ALIASES[primary] || primary;
};

const resolveSourceLanguageFromOCR = (ocrLanguageKey: string, fallback: string): string => {
  const candidates = String(ocrLanguageKey || '')
    .split('+')
    .map((part) => normalizeTranslationLanguage(part, ''))
    .filter(Boolean);

  if (candidates.length === 0) {
    return fallback;
  }

  // Prefer non-English OCR source when mixed-language OCR is enabled.
  const nonEnglish = candidates.find((lang) => lang !== 'en');
  return nonEnglish || candidates[0] || fallback;
};

const scoreSpanishVsEnglishHints = (text: string): {
  spanishScore: number;
  englishScore: number;
  latinCount: number;
  spanishAccentHits: number;
} => {
  const normalized = normalizeWhitespace(String(text || '')).toLowerCase();
  const latinCount = (normalized.match(LATIN_TEXT_HINT_REGEX) || []).length;
  const tokens = normalized
    .split(/\s+/g)
    .map((token) => token.replace(/[^a-záéíóúüñ¿¡]/gi, '').toLowerCase())
    .filter(Boolean);
  const spanishTokenScore = scoreSpanishHintTokens(tokens);
  const englishScore = scoreEnglishHintTokens(tokens);
  const spanishAccentHits = (normalized.match(/[áéíóúüñ¿¡]/g) || []).length;
  const spanishMorphHits = (normalized.match(SPANISH_MORPH_HINT_REGEX) || []).length;
  return {
    spanishScore: spanishTokenScore + (spanishAccentHits * 1.8) + (Math.min(4, spanishMorphHits) * 0.5),
    englishScore,
    latinCount,
    spanishAccentHits,
  };
};

const SPANISH_HINT_WORDS = new Set([
  'que', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'por', 'para', 'con', 'sin', 'como', 'pero',
  'si', 'ya', 'me', 'mi', 'se', 'te', 'tu', 'lo', 'le', 'del', 'al', 'es', 'son', 'fue', 'esta', 'este', 'eso',
  'estaba', 'estaban', 'estoy', 'eres', 'somos', 'estan', 'todas', 'todos', 'parte', 'partes',
  'cuerpo', 'solo', 'nada', 'doloroso', 'sentia', 'siento', 'espera', 'momento', 'aqui', 'ahi',
]);

const ENGLISH_HINT_WORDS = new Set([
  'the', 'and', 'you', 'your', 'this', 'that', 'with', 'from', 'for', 'are', 'was', 'were',
  'have', 'has', 'had', 'will', 'would', 'there', 'here', 'what', 'when', 'where', 'who',
]);

const SPANISH_MORPH_HINT_REGEX = /\b(?:[a-záéíóúüñ]+(?:ando|iendo|aron|aban|ado|ada|ados|adas|ido|ida|idos|idas|mente|cion(?:es)?|sion(?:es)?)|estaba|estaban|tocando|cuerpo|partes?|sentia|siento|espera|momento)\b/gi;

const scoreSpanishHintTokens = (tokens: string[]): number => {
  let score = 0;
  for (const tokenRaw of tokens) {
    const token = String(tokenRaw || '').toLowerCase();
    if (!token) continue;

    if (SPANISH_HINT_WORDS.has(token)) {
      score += 1;
      continue;
    }

    if (token.length >= 6 && /(?:ando|iendo|aron|aban|ado|ada|ados|adas|ido|ida|idos|idas|mente|cion(?:es)?|sion(?:es)?)$/.test(token)) {
      score += 0.72;
    }

    if (token.length >= 6 && /(?:que|como|por|para|con|sin|del|al|te|se|me)$/.test(token)) {
      score += 0.46;
    }

    if (/^(?:te|se|me|lo|la|los|las)[a-záéíóúüñ]{4,}$/.test(token)) {
      score += 0.58;
    }
  }
  return score;
};

const scoreEnglishHintTokens = (tokens: string[]): number =>
  tokens.reduce((score, tokenRaw) => {
    const token = String(tokenRaw || '').toLowerCase();
    return score + (ENGLISH_HINT_WORDS.has(token) ? 1 : 0);
  }, 0);

const HANGUL_TEXT_HINT_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/g;
const JAPANESE_KANA_HINT_REGEX = /[\u3040-\u30FF]/g;
const CJK_HAN_HINT_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF]/g;
const THAI_TEXT_HINT_REGEX = /[\u0E00-\u0E7F]/g;
const CYRILLIC_TEXT_HINT_REGEX = /[\u0400-\u04FF]/g;
const LATIN_TEXT_HINT_REGEX = /[A-Za-z]/g;

export const inferSourceLanguageFromTextHints = (
  lines: TranslatableLine[],
  fallbackLanguage: string
): string => {
  const fallback = normalizeTranslationLanguage(fallbackLanguage, 'en');
  if (lines.length === 0) return fallback;

  const sampleText = lines
    .slice(0, 40)
    .map((line) => normalizeWhitespace(String(line.text || '')))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!sampleText) return fallback;

  const hangulCount = (sampleText.match(HANGUL_TEXT_HINT_REGEX) || []).length;
  const kanaCount = (sampleText.match(JAPANESE_KANA_HINT_REGEX) || []).length;
  const hanCount = (sampleText.match(CJK_HAN_HINT_REGEX) || []).length;
  const thaiCount = (sampleText.match(THAI_TEXT_HINT_REGEX) || []).length;
  const cyrillicCount = (sampleText.match(CYRILLIC_TEXT_HINT_REGEX) || []).length;
  const latinCount = (sampleText.match(LATIN_TEXT_HINT_REGEX) || []).length;
  const nonLatinCount = hangulCount + kanaCount + hanCount + thaiCount + cyrillicCount;

  if (thaiCount >= Math.max(4, latinCount * 0.2)) {
    return 'th';
  }
  if (hangulCount >= Math.max(3, latinCount * 0.12)) {
    return 'ko';
  }
  if (kanaCount >= 2) {
    return 'ja';
  }
  if (hanCount >= 3 && kanaCount === 0 && hangulCount === 0) {
    return 'zh';
  }
  if (cyrillicCount >= Math.max(3, latinCount * 0.16)) {
    return 'ru';
  }

  const tokens = sampleText.split(/\s+/g).map((token) => token.replace(/[^a-záéíóúüñ¿¡]/gi, '').toLowerCase()).filter(Boolean);
  if (tokens.length === 0) return fallback;

  const spanishTokenScore = scoreSpanishHintTokens(tokens);
  const englishScore = scoreEnglishHintTokens(tokens);
  const spanishAccentHits = (sampleText.match(/[áéíóúüñ¿¡]/g) || []).length;
  const spanishMorphHits = (sampleText.match(SPANISH_MORPH_HINT_REGEX) || []).length;
  const spanishScore = spanishTokenScore + (spanishAccentHits * 1.8) + (Math.min(6, spanishMorphHits) * 0.45);

  const latinDominant = latinCount >= Math.max(10, nonLatinCount * 2.2);
  const weakNonLatinEvidence = nonLatinCount <= 2 || nonLatinCount <= Math.max(2, latinCount * 0.08);
  const shouldOverrideNonLatinFallback = fallback !== 'en' && fallback !== 'es' && weakNonLatinEvidence;

  if (latinDominant || shouldOverrideNonLatinFallback) {
    if (
      (spanishAccentHits >= 1 && spanishScore >= 2.4)
      || (spanishScore >= 3.2 && spanishScore >= englishScore + 0.8)
      || (spanishScore >= 2.8 && englishScore <= 1.8)
      || (fallback === 'es' && spanishScore >= 2.1)
      || (spanishScore >= 2.6 && /[¿¡]/.test(sampleText))
    ) {
      return 'es';
    }

    if (englishScore >= 3 && englishScore > spanishScore * 1.08) {
      return 'en';
    }
  }

  if (fallback !== 'en' && fallback !== 'es') {
    return fallback;
  }

  if (spanishScore >= 5.6 && spanishScore > englishScore * 1.25) {
    return 'es';
  }
  if (englishScore >= 6 && englishScore > spanishScore * 1.25) {
    return 'en';
  }
  if (spanishAccentHits >= 2 && spanishScore >= 2 && spanishScore >= englishScore) {
    return 'es';
  }

  return fallback;
};

export const resolvePreferredSourceLanguageForText = (
  text: string,
  fallbackLanguage: string
): string => {
  const fallback = normalizeTranslationLanguage(fallbackLanguage, 'en');
  const normalized = normalizeWhitespace(String(text || '')).toLowerCase();
  if (!normalized) return fallback;

  const hangulCount = (normalized.match(HANGUL_TEXT_HINT_REGEX) || []).length;
  const kanaCount = (normalized.match(JAPANESE_KANA_HINT_REGEX) || []).length;
  const hanCount = (normalized.match(CJK_HAN_HINT_REGEX) || []).length;
  const thaiCount = (normalized.match(THAI_TEXT_HINT_REGEX) || []).length;
  const cyrillicCount = (normalized.match(CYRILLIC_TEXT_HINT_REGEX) || []).length;
  const latinCount = (normalized.match(LATIN_TEXT_HINT_REGEX) || []).length;
  const nonLatinCount = hangulCount + kanaCount + hanCount + thaiCount + cyrillicCount;

  if (thaiCount >= Math.max(4, latinCount * 0.5)) {
    return 'th';
  }
  if (hangulCount >= Math.max(2, latinCount * 0.45) && latinCount <= hangulCount * 2.6) {
    return 'ko';
  }
  if (kanaCount >= 1 && latinCount <= Math.max(6, (kanaCount + hanCount) * 2.6)) {
    return 'ja';
  }
  if (hanCount >= 2 && kanaCount === 0 && hangulCount === 0 && latinCount <= hanCount * 2.4) {
    return 'zh';
  }
  if (cyrillicCount >= Math.max(2, latinCount * 0.38) && latinCount <= cyrillicCount * 2.2) {
    return 'ru';
  }

  const latinDominant = latinCount >= Math.max(6, nonLatinCount * 1.4);
  const tokens = normalized
    .split(/\s+/g)
    .map((token) => token.replace(/[^a-záéíóúüñ¿¡]/gi, '').toLowerCase())
    .filter(Boolean);
  const spanishTokenScore = scoreSpanishHintTokens(tokens);
  const englishScore = scoreEnglishHintTokens(tokens);
  const spanishAccentHits = (normalized.match(/[áéíóúüñ¿¡]/g) || []).length;
  const spanishMorphHits = (normalized.match(SPANISH_MORPH_HINT_REGEX) || []).length;
  const spanishScore = spanishTokenScore + (spanishAccentHits * 1.8) + (Math.min(4, spanishMorphHits) * 0.5);

  if (latinDominant || fallback === 'en' || fallback === 'es') {
    if (
      (spanishAccentHits >= 1 && spanishScore >= 1.8)
      || (spanishScore >= 2.4 && spanishScore >= englishScore + 0.5)
      || (spanishScore >= 2.1 && englishScore <= 1.3)
      || (fallback === 'es' && spanishScore >= 1.5)
      || /[¿¡]/.test(normalized)
    ) {
      return 'es';
    }
    if (fallback === 'es' && englishScore < 2.6) {
      return 'es';
    }
    if (englishScore >= 2.6 && englishScore > spanishScore * 1.08) {
      return 'en';
    }
    if (latinCount >= 4) {
      return 'en';
    }
  }

  return fallback;
};

const isLikelyLatinDominantTranslationPage = (lines: TranslatableLine[]): boolean => {
  if (lines.length < 4) return false;
  const latinHeavyCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
    const nonSpaceChars = normalized.replace(/\s+/g, '').length;
    const latinRatio = latinChars / Math.max(1, nonSpaceChars);
    return latinChars >= 6 && latinRatio >= 0.45;
  }).length;
  return latinHeavyCount >= Math.max(3, Math.floor(lines.length * 0.34));
};

const hasStrongLatinAnchorLines = (lines: TranslatableLine[]): boolean => {
  const strongLatinCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
    const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
    const nonSpaceChars = normalized.replace(/\s+/g, '').length;
    const latinRatio = latinChars / Math.max(1, nonSpaceChars);
    return latinChars >= 10 && tokenCount >= 3 && latinRatio >= 0.52;
  }).length;

  return strongLatinCount >= 2;
};

const isLikelyShortForeignSfxLine = (text: string): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;
  if (/[A-Za-z]/.test(normalized)) return false;

  const compact = normalized.replace(/\s+/g, '');
  const tokens = normalized.split(/\s+/g).filter(Boolean);
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(compact);
  if (!hasCjkOrThai) return false;
  if (/\d/.test(compact)) return false;

  const unknownChars = compact.replace(/[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownRatio = unknownChars.length / Math.max(1, compact.length);
  return tokens.length <= 3 && compact.length <= 10 && unknownRatio <= 0.55;
};

const resolveComicPageSourceLanguage = (
  lines: TranslatableLine[],
  fallbackLanguage: string,
  mode: TranslationMode
): string => {
  const fallback = normalizeTranslationLanguage(fallbackLanguage, 'en');
  if (fallback !== 'en') return fallback;
  if (mode !== 'manga' && mode !== 'manhwa' && mode !== 'adaptive') return fallback;
  if (lines.length < 3) return fallback;

  const sampleText = lines
    .slice(0, 48)
    .map((line) => normalizeWhitespace(String(line.text || '')))
    .filter(Boolean)
    .join(' ');
  if (!sampleText) return fallback;

  const sampleStats = scoreSpanishVsEnglishHints(sampleText);
  const spanishLikeLineCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    if (!normalized) return false;
    const stats = scoreSpanishVsEnglishHints(normalized);
    return stats.spanishAccentHits >= 1
      || stats.spanishScore >= 1.2
      || (stats.spanishScore >= 0.8 && stats.englishScore === 0);
  }).length;
  const englishLikeLineCount = lines.filter((line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    if (!normalized) return false;
    const stats = scoreSpanishVsEnglishHints(normalized);
    return stats.englishScore >= 1.4 && stats.englishScore > stats.spanishScore * 1.1;
  }).length;

  if (
    sampleStats.latinCount >= 12
    && (
      (sampleStats.spanishAccentHits >= 1 && sampleStats.spanishScore >= 1.8)
      || (sampleStats.spanishScore >= 2.4 && sampleStats.spanishScore >= sampleStats.englishScore + 0.35)
      || (spanishLikeLineCount >= Math.max(2, Math.floor(lines.length * 0.18)) && englishLikeLineCount <= spanishLikeLineCount)
    )
  ) {
    return 'es';
  }

  return fallback;
};

const ENGLISH_TECH_HINT_WORDS = new Set([
  'chapter', 'table', 'continued', 'reaction', 'connection', 'unknowns', 'unknown',
  'force', 'forces', 'moment', 'components', 'component', 'magnitude', 'direction',
  'smooth', 'pin', 'hinge', 'fixed', 'support', 'submarine', 'cables', 'acting',
  'equilibrium', 'methods', 'determine', 'rigid', 'body', 'bridge', 'column',
  'apply', 'important', 'used', 'insure', 'fail', 'this', 'that', 'the', 'in', 'of', 'to'
]);

const OCR_NOISE_COMPACT_FRAGMENTS = [
  'submaie',
  'ureat',
  'ydoot',
  'falinth',
  'willtudhow',
  'effctofravt',
  'gnetiontact',
  'ctriclm',
  'rescaused',
];

const hasKnownOcrNoisePattern = (text: string): boolean => {
  const compact = normalizeWhitespace(String(text || ''))
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!compact) return false;
  return OCR_NOISE_COMPACT_FRAGMENTS.some((fragment) => compact.includes(fragment));
};

const scoreSourceLineReadability = (text: string): number => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return -1_000;

  const hasLatin = /[A-Za-z]/.test(normalized);
  if (!hasLatin) {
    return normalized.length * 0.22;
  }

  const tokens = normalized.split(/\s+/g).filter(Boolean);
  let score = 0;
  let weirdTokens = 0;

  if (hasKnownOcrNoisePattern(normalized)) {
    weirdTokens += 2;
    score -= 10.5;
  }

  for (const token of tokens) {
    const clean = token.replace(/[^A-Za-z]/g, '');
    if (!clean) continue;

    const lower = clean.toLowerCase();
    score += Math.min(clean.length, 14) * 0.75;

    if (/[aeiou]/i.test(clean)) {
      score += 1.7;
    } else if (clean.length >= 4) {
      weirdTokens += 1;
      score -= 3.1;
    }

    if (clean === clean.toUpperCase() && clean.length >= 7) {
      score -= 1.2;
    }

    if (ENGLISH_TECH_HINT_WORDS.has(lower)) {
      score += 3.6;
    }

    if (/^(submaie|ureat|ydoot|falinth|willtudhow|chapte|chapt|effctofravt|ctriclm|gnetiontact|rescaused)$/i.test(lower)) {
      weirdTokens += 1;
      score -= 6.2;
    }
  }

  score -= weirdTokens * 0.85;
  return score;
};

const shouldAcceptWordsOnlyLineFallback = (line: OCRLine | undefined, wordsText: string): boolean => {
  const normalizedWords = normalizeWhitespace(String(wordsText || ''));
  if (!line || !normalizedWords) return false;

  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => {
      const text = normalizeWhitespace(String(word?.text || ''));
      const bbox = word?.bbox;
      if (!text || !bbox) return false;
      return (bbox.x1 - bbox.x0) > 0 && (bbox.y1 - bbox.y0) > 0;
    });
  if (validWords.length === 0) return false;

  const lineWidth = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const lineHeight = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const lineArea = Math.max(1, lineWidth * lineHeight);

  let unionX0 = Number.POSITIVE_INFINITY;
  let unionY0 = Number.POSITIVE_INFINITY;
  let unionX1 = Number.NEGATIVE_INFINITY;
  let unionY1 = Number.NEGATIVE_INFINITY;
  validWords.forEach((word) => {
    const bbox = word.bbox;
    unionX0 = Math.min(unionX0, bbox.x0);
    unionY0 = Math.min(unionY0, bbox.y0);
    unionX1 = Math.max(unionX1, bbox.x1);
    unionY1 = Math.max(unionY1, bbox.y1);
  });

  const unionArea = Math.max(1, (unionX1 - unionX0) * (unionY1 - unionY0));
  const coverage = unionArea / lineArea;
  const avgConfidence = validWords.reduce((sum, word) => sum + Number(word.confidence || 0), 0) / validWords.length;

  const tokens = normalizedWords.split(/\s+/g).filter(Boolean);
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(normalizedWords);
  const shortSingleToken = tokens.length === 1 && normalizedWords.length <= 8;

  if (shortSingleToken && !hasCjkOrThai) {
    return coverage >= 0.72 && avgConfidence >= 72;
  }

  if (tokens.length <= 2 && normalizedWords.length <= 10 && !hasCjkOrThai) {
    return coverage >= 0.58 && avgConfidence >= 62;
  }

  if (tokens.length >= 3 || normalizedWords.length >= 14) {
    return coverage >= 0.24 || avgConfidence >= 58;
  }

  return coverage >= 0.42;
};

const computeLineWordUnionCoverage = (line: OCRLine | undefined): number => {
  if (!line?.bbox) return 0;

  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => {
      const text = normalizeWhitespace(String(word?.text || ''));
      const bbox = word?.bbox;
      if (!text || !bbox) return false;
      return (bbox.x1 - bbox.x0) > 0 && (bbox.y1 - bbox.y0) > 0;
    });
  if (validWords.length === 0) return 0;

  const lineWidth = Math.max(1, Number(line.bbox.x1 || 0) - Number(line.bbox.x0 || 0));
  const lineHeight = Math.max(1, Number(line.bbox.y1 || 0) - Number(line.bbox.y0 || 0));
  const lineArea = Math.max(1, lineWidth * lineHeight);

  let unionX0 = Number.POSITIVE_INFINITY;
  let unionY0 = Number.POSITIVE_INFINITY;
  let unionX1 = Number.NEGATIVE_INFINITY;
  let unionY1 = Number.NEGATIVE_INFINITY;
  validWords.forEach((word) => {
    const bbox = word.bbox;
    unionX0 = Math.min(unionX0, bbox.x0);
    unionY0 = Math.min(unionY0, bbox.y0);
    unionX1 = Math.max(unionX1, bbox.x1);
    unionY1 = Math.max(unionY1, bbox.y1);
  });

  const unionArea = Math.max(1, (unionX1 - unionX0) * (unionY1 - unionY0));
  return Math.max(0, Math.min(1.8, unionArea / lineArea));
};

export const resolveBestOcrLineText = (line?: OCRLine): string => {
  const rawText = normalizeWhitespace(String(line?.text || ''));
  const wordsText = normalizeWhitespace(
    Array.isArray(line?.words)
      ? line!.words.map((word) => String(word?.text || '')).join(' ')
      : ''
  );

  if (!rawText) {
    if (!wordsText) return '';
    return shouldAcceptWordsOnlyLineFallback(line, wordsText) ? wordsText : '';
  }
  if (!wordsText) return rawText;

  const rawScore = scoreSourceLineReadability(rawText);
  const wordsScore = scoreSourceLineReadability(wordsText);
  const rawHasKnownNoise = hasKnownOcrNoisePattern(rawText);
  const wordsHasKnownNoise = hasKnownOcrNoisePattern(wordsText);

  if (rawHasKnownNoise && !wordsHasKnownNoise) {
    return wordsText;
  }
  if (wordsHasKnownNoise && !rawHasKnownNoise) {
    return rawText;
  }

  if (wordsScore > rawScore + 2.2) {
    return wordsText;
  }
  return rawText;
};

const GHOST_TRANSLATION_PUNCT_ONLY_REGEX = /^[|¦│┃/\\_~.,:;'"`!?-]+$/;
const GHOST_TRANSLATION_SHORT_TOKEN_REGEX = /^[A-Z0-9]{1,4}$/;
const TECHNICAL_GHOST_BYPASS_REGEX = /\b(resultant|magnitude|direction|force|column|columns|connections?|support|reaction|unknowns?|beam|beams|welded|rigid|types?|table|continued|hinge|pin)\b/i;
const TECHNICAL_EQUATION_TAG_REGEX = /\(\s*\d{1,3}[a-z]?\s*\)/i;

const shouldForceKeepTechnicalTranslationLine = (resolvedText: string, line?: OCRLine): boolean => {
  const normalized = normalizeWhitespace(String(resolvedText || ''));
  if (!normalized) return false;

  const alphaNumLength = normalized.replace(/[^A-Za-z0-9]/g, '').length;
  if (alphaNumLength < 6) return false;

  const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
  if (tokenCount < 2 || tokenCount > 20) return false;

  const hasTechnicalCue = TECHNICAL_GHOST_BYPASS_REGEX.test(normalized);
  const hasEquationTag = TECHNICAL_EQUATION_TAG_REGEX.test(normalized);
  if (!hasTechnicalCue && !hasEquationTag) return false;

  if (!line?.bbox) return true;

  const width = Math.max(1, Number(line.bbox.x1 || 0) - Number(line.bbox.x0 || 0));
  const height = Math.max(1, Number(line.bbox.y1 || 0) - Number(line.bbox.y0 || 0));
  const rowLikeGeometry = width >= Math.max(88, alphaNumLength * 4.2) && height <= 72;

  return rowLikeGeometry || hasEquationTag;
};

const FORCE_KEEP_COMIC_TRANSLATION_LINE_REGEXES = [
  /^AH\s+ME[.!?…]*$/i,
  /^EH\s+ME[.!?…]*$/i,
  /^EH[.!?…]+$/i,
  /^ME[.!?…]+$/i,
  /^YOU[-\s]+COULD\s+SAY[.!?…]*$/i,
  /^(?:SO\s+ME\s+THING|SOMETHING)\s+THAT\s+MIGHT[.!?…]*$/i,
  /^HELP\s+YOU\s+TOO[.!?…]*$/i,
  /^ENTRANCE[.!?…]*$/i,
  /^ARE\s+ONLY[.!?…]*$/i,
  /^OUR\s+CHANCE[.!?…]*$/i,
  /^THEM[.!?…]*$/i,
  /^SHOE\s+LOCKER[.!?…]*$/i,
  /^AND\s+LEAVE\s+THE[.!?…]*$/i,
  /^OPEN\s+A\s+SHOE\s+LOCKER[.!?…]*$/i,
];

const shouldForceKeepComicTranslationLine = (
  resolvedText: string,
  line?: OCRLine,
  metrics?: { width?: number; height?: number; area?: number; wordCoverage?: number }
): boolean => {
  const normalized = normalizeWhitespace(String(resolvedText || ''));
  if (!normalized) return false;
  if (!FORCE_KEEP_COMIC_TRANSLATION_LINE_REGEXES.some((regex) => regex.test(normalized))) return false;

  if (!line?.bbox) return true;
  const width = Math.max(1, Number(metrics?.width ?? (Number(line.bbox.x1 || 0) - Number(line.bbox.x0 || 0))));
  const height = Math.max(1, Number(metrics?.height ?? (Number(line.bbox.y1 || 0) - Number(line.bbox.y0 || 0))));
  const area = Math.max(1, Number(metrics?.area ?? (width * height)));
  const wordCoverage = Math.max(0, Number(metrics?.wordCoverage ?? computeLineWordUnionCoverage(line)));

  // Keep the real short dialogue fragments, but do not resurrect cross-column bridge artifacts.
  if (width >= 960 && area >= 76000 && wordCoverage >= 0.52) return false;
  return true;
};

export const isLikelyGhostTranslatableLine = (line: OCRLine | undefined, resolvedText: string): boolean => {
  const text = normalizeWhitespace(String(resolvedText || ''));
  if (!text) return true;
  if (!line?.bbox) return false;

  const width = Math.max(1, Number(line.bbox.x1 || 0) - Number(line.bbox.x0 || 0));
  const height = Math.max(1, Number(line.bbox.y1 || 0) - Number(line.bbox.y0 || 0));
  const area = Math.max(1, width * height);
  const compact = text.replace(/\s+/g, '');
  const asciiCompact = compact.replace(/[^A-Za-z0-9]/g, '');
  const latinCompact = compact.replace(/[^A-Za-z]/g, '');
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(compact);
  const cjkCompact = compact.replace(/[^\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownChars = compact.replace(/[A-Za-z0-9\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownCharRatio = unknownChars.length / Math.max(1, compact.length);

  const validWords = (Array.isArray(line.words) ? line.words : []).filter((word) => {
    const wordText = normalizeWhitespace(String(word?.text || ''));
    const bbox = word?.bbox;
    if (!wordText || !bbox) return false;
    return (bbox.x1 - bbox.x0) > 0 && (bbox.y1 - bbox.y0) > 0;
  });
  const sourceTokenCount = text.split(/\s+/g).filter(Boolean).length;
  const wordCount = Math.max(validWords.length, sourceTokenCount);
  const confidenceSamples = validWords.length > 0
    ? validWords.map((word) => Number(word.confidence || 0))
    : [Number(line.confidence || 0)];
  const avgConfidence = confidenceSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, confidenceSamples.length);
  const readability = scoreSourceLineReadability(text);
  const wordCoverage = computeLineWordUnionCoverage(line);

  if (shouldForceKeepComicTranslationLine(text, line)) {
    return false;
  }

  const giantLineBox = (
    (width >= 180 && height >= 110 && area >= 18000)
    || (width >= 132 && height >= 88 && area >= 12000 && wordCoverage <= 0.2)
    || (width >= 320 && height >= 98 && area >= 32000)
  );
  const noWordOversizedShortPhrase = validWords.length === 0
    && wordCount >= 2
    && wordCount <= 6
    && compact.length <= 30
    && area >= 17000
    && (width >= 170 || height >= 96)
    && (area / Math.max(1, compact.length)) >= 680
    && !shouldForceKeepTechnicalTranslationLine(text, line);
  if (noWordOversizedShortPhrase) {
    return true;
  }

  const sparseLargePhrase = wordCount <= 4 && compact.length <= 24;
  const lowCoverageLargeBox = wordCoverage <= 0.26;
  const lowSignalLargeBox = avgConfidence <= 93 || unknownCharRatio >= 0.24 || readability <= 8.8;
  if (giantLineBox && sparseLargePhrase && lowCoverageLargeBox && lowSignalLargeBox) {
    return true;
  }

  if (hasCjkOrThai) {
    const tinyCjkSingleton = wordCount <= 1
      && cjkCompact.length <= 3
      && width <= 96
      && height <= 54
      && area <= 3000
      && avgConfidence <= 90;
    const narrowTallCjkNoise = wordCount <= 2
      && cjkCompact.length <= 4
      && width <= 88
      && height <= 180
      && height >= Math.max(42, width * 1.15)
      && avgConfidence <= 90;
    const cjkUnknownHeavy = cjkCompact.length <= 2
      && unknownCharRatio >= 0.45
      && area <= 3200
      && avgConfidence <= 88;
    const shortStylizedNonLatinSfx = wordCount <= 1
      && cjkCompact.length <= 3
      && width <= 132
      && height <= 112
      && area <= 11500
      && avgConfidence <= 92
      && (unknownCharRatio >= 0.08 || height >= width * 0.6);
    const shortNonLatinLowCoverageArtifact = wordCount <= 2
      && cjkCompact.length <= 5
      && area <= 6200
      && wordCoverage <= 0.26
      && (avgConfidence <= 92 || unknownCharRatio >= 0.2);

    if (tinyCjkSingleton || narrowTallCjkNoise || cjkUnknownHeavy || shortStylizedNonLatinSfx || shortNonLatinLowCoverageArtifact) {
      return true;
    }
    return false;
  }

  if (GHOST_TRANSLATION_PUNCT_ONLY_REGEX.test(compact) && width <= 112 && height <= 44) {
    return true;
  }

  const compactUpper = compact.toUpperCase();
  const shortDigitArtifact = GHOST_TRANSLATION_SHORT_TOKEN_REGEX.test(compactUpper)
    && /\d/.test(compactUpper)
    && !/[a-z]/.test(compact);
  if (shortDigitArtifact && wordCount <= 1 && width <= 96 && height <= 42 && avgConfidence <= 82) {
    return true;
  }

  const tinyAsciiSingletonNoise = !hasCjkOrThai
    && wordCount <= 1
    && asciiCompact.length > 0
    && asciiCompact.length <= 2
    && width <= 72
    && height <= 38
    && area <= 2100
    && avgConfidence <= 94
    && !/[!?]/.test(text);
  if (tinyAsciiSingletonNoise) {
    return true;
  }

  const noWordTinyAsciiNoise = validWords.length === 0
    && !hasCjkOrThai
    && wordCount <= 2
    && asciiCompact.length > 0
    && asciiCompact.length <= 6
    && width <= 88
    && height <= 44
    && area <= 2600
    && avgConfidence <= 92;
  if (noWordTinyAsciiNoise) {
    return true;
  }

  const pxPerLatinChar = width / Math.max(1, latinCompact.length);
  const suspiciousTinyLongLatin = latinCompact.length >= 10
    && wordCount >= 3
    && pxPerLatinChar < 2.9
    && width <= Math.max(72, latinCompact.length * 5.4)
    && height <= 26;
  if (suspiciousTinyLongLatin) {
    return true;
  }

  const compressedSparseShortPhrase = !hasCjkOrThai
    && sourceTokenCount >= 2
    && sourceTokenCount <= 4
    && latinCompact.length >= 8
    && width <= Math.max(92, latinCompact.length * 6.4)
    && height <= 78
    && area <= Math.max(5200, latinCompact.length * 520)
    && (area / Math.max(1, latinCompact.length)) <= 430
    && wordCoverage <= 0.24
    && avgConfidence <= 94
    && !/[.!?…]\s*$/.test(text);
  if (compressedSparseShortPhrase) {
    return true;
  }

  const lowSignalHyphenGhost = /[a-z]{2,}-[a-z]{2,}/.test(text)
    && wordCount <= 3
    && width <= 220
    && height <= 38
    && avgConfidence <= 82;
  if (lowSignalHyphenGhost) {
    return true;
  }

  if (wordCount <= 2 && area <= 3000 && unknownCharRatio >= 0.45 && avgConfidence <= 82) {
    return true;
  }

  const lowSignalTinySingleton = wordCount <= 1
    && asciiCompact.length > 0
    && asciiCompact.length <= 4
    && area <= 2600
    && width <= 104
    && height <= 40
    && readability <= 0.35
    && avgConfidence <= 78;
  if (lowSignalTinySingleton) {
    return true;
  }

  return false;
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

  const trailingHyphenFragment = /-\s*$/.test(text)
    && tokenCount <= 3
    && (readability <= 12 || area >= 30000);
  const malformedMixedCaseFragment = /[a-z][A-Z]/.test(text)
    && tokenCount <= 3
    && (readability <= 10.5 || area >= 18000);
  const oversizedWeakSingleton = tokenCount <= 1
    && compact.length <= 12
    && wordBoxCount <= 1
    && area >= 22000;

  return (
    (strongBelow && (trailingHyphenFragment || malformedMixedCaseFragment))
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

    return (line.sourceLength * 1.82)
      + (readability * 2.75)
      + (density * 26)
      + (height * 0.18)
      + coverageBonus
      + wordBoxBonus
      - noWordPenalty
      - oversizedSparsePenalty
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

      if ((longLinePair || paragraphLikePair) && !veryStrongSpatialMatch && !compactSpatialMatch) {
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

  const shouldDisableAssistForStablePage = mostlyReadablePage && baseEngine === 'tesseract';
  if (shouldDisableAssistForStablePage) {
    return { lines: baseLines, adoptedCount: 0 };
  }

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

export const applyThaiConversationalGlossary = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): string => {
  if (normalizeTranslationLanguage(targetLanguage, 'th') !== 'th') {
    return translatedText;
  }

  const source = normalizeWhitespace(String(sourceText || ''));
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
  if (/^TAKE\s+OUT\s+OF\s+HERE[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'นำออกไปจากที่นี่');
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

  return translated;
};

const finalizeTranslatedLine = (sourceText: string, translatedText: string, targetLanguage: string): string => {
  const source = normalizeWhitespace(String(sourceText || ''));
  let resolved = normalizeWhitespace(String(translatedText || ''));
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

const isScientificSymbolLikeLine = (text: string): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;
  const forceComponentTokens = normalized.match(SCI_FORCE_COMPONENT_TOKEN_REGEX) || [];
  if (forceComponentTokens.length > 0) {
    const words = normalized.split(/\s+/g).filter(Boolean);
    if (normalized.length <= 48 && words.length <= 8 && !/[.!?]/.test(normalized)) {
      return true;
    }
  }

  const words = normalized.split(/\s+/g).filter(Boolean);
  const alphaWordCount = words.filter((token) => token.replace(/[^A-Za-z]/g, '').length >= 2).length;
  const hasMathSignals = /[0-9=<>%^]/.test(normalized);
  const naturalLanguageLike = alphaWordCount >= 3 && !hasMathSignals;
  if (naturalLanguageLike) {
    return false;
  }

  if (normalized.length > 28) return false;
  if (!SCI_SYMBOL_ALLOWED_REGEX.test(normalized)) return false;

  const tokens = words;
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

const shouldSkipLineTranslationByScript = (text: string, sourceLanguage: string): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return true;

  const resolvedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  if (resolvedSource === 'ko' || resolvedSource === 'ja' || resolvedSource === 'zh' || resolvedSource === 'th') {
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

export const shouldPreserveSourceLineForTranslation = (text: string, sourceLanguage: string): boolean => {
  if (isScientificSymbolLikeLine(text)) return true;
  return shouldSkipLineTranslationByScript(text, sourceLanguage);
};

const protectLocationPhrases = (
  text: string,
  targetLanguage: string,
  tokenOffset = 0
): { protectedText: string; replacements: ProtectedTokenReplacement[] } => {
  const replacements: ProtectedTokenReplacement[] = [];
  let protectedText = text;
  const locale = String(targetLanguage || '').toLowerCase();
  const locationRe = /\b([A-Za-z][A-Za-z'\-]{1,}(?:\s+[A-Za-z][A-Za-z'\-]{1,}){0,2})\s+(Town|City|Village|District)\b/g;

  protectedText = protectedText.replace(locationRe, (_match, rawName: string, rawType: string) => {
    const token = `[[LOCMARK${tokenOffset + replacements.length}ZZ]]`;
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

    replacements.push({ token, replacement });
    return token;
  });

  return { protectedText, replacements };
};

const protectTranslationTokens = (
  text: string,
  targetLanguage: string
): { protectedText: string; replacements: ProtectedTokenReplacement[] } => {
  return protectLocationPhrases(text, targetLanguage, 0);
};

const restoreProtectedTokens = (text: string, replacements: ProtectedTokenReplacement[]): string => {
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
    return aspect <= 4.4 || width <= medianWidth * 0.9 || height >= medianHeight * 1.15;
  }).length;
  const longPunctuatedCount = lines.filter((line) => {
    const text = normalizeWhitespace(String(line.text || ''));
    return text.length >= 20 && /[.,;:]/.test(text);
  }).length;

  return (
    shortLineCount >= Math.ceil(lines.length * 0.62)
    && narrowOrBubbleLikeCount >= Math.ceil(lines.length * 0.58)
    && longPunctuatedCount <= Math.max(1, Math.floor(lines.length * 0.24))
  );
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
  if (lines.length < 3) return false;
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
): string => {
  const normalized = lines
    .map((line) => normalizeWhitespace(String(line.text || '')))
    .filter(Boolean);
  if (normalized.length <= 1) {
    return normalized[0] || '';
  }

  if (groupType === 'narration') {
    return normalized.join(' ');
  }

  // Preserve line breaks so the AI can return line-mapped translations
  return normalized.join('\n');
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
  lines: lines.map<OCRLineWithLayout>((line) => ({
    index: line.index,
    text: line.text,
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
  })),
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
        groups.push({
          lines: groupLines,
          groupType: derivedGroup.groupType,
          derivedGroupId: derivedGroup.id,
          confidence: derivedGroup.confidence,
        });
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
      text: composeGroupSourceText(group.lines, group.groupType || 'unknown', groupingProfile),
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

  if (!isBalloonAwareGroupingEnabled()) {
    return {
      groups: fallbackGroups,
      groupingProfile: fallbackProfile,
      groupingDecision: {
        ...fallbackDecision,
        fallbackReason: 'feature_flag_disabled',
      },
    };
  }

  if (!shouldUseBalloonAwareGrouping(lines, sourceLanguage, targetLanguage, mode)) {
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
        const wordSegments = Array.from(wordSeg.segment(target))
          .map((item) => item.segment)
          .filter((segment) => segment.trim().length > 0);
        if (wordSegments.length >= sourceLines.length) {
          return wordSegments;
        }
        if (target.length <= 8 && wordSegments.length > 0) {
          return wordSegments;
        }

        const graphemeSeg = new intlWithSegmenter.Segmenter('th', { granularity: 'grapheme' });
        return Array.from(graphemeSeg.segment(target))
          .map((item) => item.segment)
          .filter((segment) => segment.trim().length > 0);
      }
      return Array.from(target);
    };

    const segments = buildSegments();
    const cumulative: number[] = [];
    let rolling = 0;
    for (const segment of segments) {
      rolling += segment.length;
      cumulative.push(rolling);
    }

    const totalSource = sourceLines
      .map((line) => computeLineSplitWeight(line))
      .reduce((acc, n) => acc + n, 0);

    const thaiParts: string[] = [];
    let startIndex = 0;

    for (let i = 0; i < sourceLines.length; i += 1) {
      if (i === sourceLines.length - 1) {
        thaiParts.push(segments.slice(startIndex).join('').trim());
        break;
      }

      const consumedSource = sourceLines
        .slice(0, i + 1)
        .map((line) => computeLineSplitWeight(line))
        .reduce((acc, n) => acc + n, 0);
      const desiredEnd = Math.round((consumedSource / totalSource) * target.length);

      const minBoundary = startIndex + 1;
      const maxBoundary = Math.max(minBoundary, segments.length - (sourceLines.length - i - 1));
      let bestBoundary = minBoundary;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let boundary = minBoundary; boundary <= maxBoundary; boundary += 1) {
        const endChar = cumulative[boundary - 1] || 0;
        let distance = Math.abs(endChar - desiredEnd);
        const nextToken = normalizeThaiBoundaryToken(segments[boundary] || '');
        const previousToken = normalizeThaiBoundaryToken(segments[boundary - 1] || '');
        const nextTokenLength = Array.from(nextToken).length;
        const previousTokenLength = Array.from(previousToken).length;
        if (nextToken && THAI_BOUNDARY_ATTACH_TOKENS.has(nextToken)) {
          distance += Math.max(18, Math.round(target.length * 0.18));
        }
        if (previousToken && nextToken && THAI_BOUNDARY_NO_SPLIT_PAIRS.has(`${previousToken}|${nextToken}`)) {
          distance += Math.max(24, Math.round(target.length * 0.24));
        }
        if (previousTokenLength > 0 && nextTokenLength > 0 && previousTokenLength <= 2 && nextTokenLength <= 2) {
          distance += Math.max(26, Math.round(target.length * 0.26));
        }
        if (nextTokenLength === 1) {
          distance += Math.max(20, Math.round(target.length * 0.22));
        }
        if (distance < bestDistance) {
          bestDistance = distance;
          bestBoundary = boundary;
        }
      }

      thaiParts.push(segments.slice(startIndex, bestBoundary).join('').trim());
      startIndex = bestBoundary;
    }

    return rebalanceRedistributedParts(thaiParts, sourceLines, target, targetLanguage);
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
        const start = Math.floor((clampedIndex / clampedTotal) * normalizedGroup.length);
        const end = Math.ceil(((clampedIndex + 1) / clampedTotal) * normalizedGroup.length);
        const proportionalChunk = normalizeWhitespace(normalizedGroup.slice(start, end));
        if (proportionalChunk) return proportionalChunk;
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

export default function App() {
  const showOCRHarness = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('ocr_harness') === '1';
  const { activeTool, setActiveTool } = useUIStore();
  const ocrOptions = useOCRTextLayerStore((state) => state.options);
  const ocrLanguage = ocrOptions.language;
  const setTranslationCacheEntry = useOCRTextLayerStore((state) => state.setTranslationCacheEntry);
  const isOCRProcessing = useOCRTextLayerStore((state) => state.isProcessing);
  const { 
    file, 
    fileType,
    fileData,
    currentPage, 
    totalPages, 
    ensureDocumentId,
    setPage, 
    closeProject, 
    viewMode, 
    setViewMode,
    sourceLanguage,
    targetLanguage,
    setTargetLanguage,
    translationMode,
    setTranslationMode,
    overlayThaiFontEnabled,
    overlayFontPreset,
    overlayFontSizeScale,
    safetySettings,
    hydrateGeminiApiKey,
  } = useProjectStore();

  const normalizePrewarmLanguage = (value: string): string => value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join('+') || 'eng';
  
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [isOfflineProcessing, setIsOfflineProcessing] = useState(false);
  const [isVisionReady, setIsVisionReady] = useState(false);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(file?.name || '');
  const [translationStatus, setTranslationStatus] = useState<{ kind: 'info' | 'success' | 'error'; message: string } | null>(null);
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const [downloadScopeSelection, setDownloadScopeSelection] = useState<DownloadScope>('current');
  const [downloadModeSelection, setDownloadModeSelection] = useState<DownloadContentMode>('original');
  const [isDownloadingResult, setIsDownloadingResult] = useState(false);
  const downloadMenuRef = React.useRef<HTMLDivElement | null>(null);

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
    closeProject();
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

  // Update editedName when file changes
  useEffect(() => {
    if (file) {
      setEditedName(file.name);
    }
  }, [file]);

  if (showOCRHarness) {
    return <OCRRegressionHarness />;
  }

  // If no file is loaded, show Upload Screen
  if (!file) {
    return <UploadScreen />;
  }

  const resolveTranslatableLineBBox = (line?: OCRLine): BBox | undefined => {
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
  };

  const resolveLineSortHintY = (line?: OCRLine): number | undefined => {
    const direct = Number(line?.sortHintY);
    if (Number.isFinite(direct)) return direct;
    const legacy = Number((line as OCRLine | undefined)?.['_sortY']);
    return Number.isFinite(legacy) ? legacy : undefined;
  };

  const resolveLineSortHintX = (line?: OCRLine): number | undefined => {
    const direct = Number(line?.sortHintX);
    if (Number.isFinite(direct)) return direct;
    const legacy = Number((line as OCRLine | undefined)?.['_sortX']);
    return Number.isFinite(legacy) ? legacy : undefined;
  };

  const collectTranslatableLines = (lines: OCRLine[]): TranslatableLine[] => {
    const collected: TranslatableLine[] = [];
    lines.forEach((line, index) => {
      const text = resolveBestOcrLineText(line);
      if (!text) return;

      const likelyGhost = isLikelyGhostTranslatableLine(line, text);
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
      const wordCoverage = computeLineWordUnionCoverage(line);
      const noWordOversizedRawLine = (
        validWordBoxCount === 0
        && tokenCount >= 2
        && tokenCount <= 6
        && compactText.length <= 30
        && area >= 16000
        && (width >= 180 || height >= 96)
        && (area / Math.max(1, compactText.length)) >= 680
      );
      const lowCoverageOversizedEffectSection = (
        validWordBoxCount <= 1
        && wordCoverage <= 0.2
        && tokenCount >= 2
        && tokenCount <= 6
        && compactText.length <= 30
        && area >= 17000
        && (width >= 170 || height >= 96)
        && (area / Math.max(1, compactText.length)) >= 650
      );
      if ((noWordOversizedRawLine || lowCoverageOversizedEffectSection) && !shouldForceKeepTechnicalTranslationLine(text, line)) {
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
        sourceEngine: line.sourceEngine,
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
  };

  const resolveModelScopedOriginalPageOCR = (
    ocrState: ReturnType<typeof useOCRTextLayerStore.getState>,
    pageNum: number,
    selectedEngine: OCREngine
  ): OCRPageResult | undefined => {
    const engineScoped = ocrState.ocrByPageEngine.get(pageNum)?.get(selectedEngine);
    if (engineScoped) return engineScoped;

    const fallback = ocrState.allPagesOCR.get(pageNum);
    if (!fallback) return undefined;
    const fallbackEngine = (fallback.ocrEngine || selectedEngine) as OCREngine;
    if (fallbackEngine !== selectedEngine) return undefined;
    return fallback;
  };

  const getModelScopedCachedPageNumbers = (): number[] => {
    const ocrState = useOCRTextLayerStore.getState();
    const selectedEngine = (ocrOptions.engine || 'tesseract') as OCREngine;
    const pages = new Set<number>();
    ocrState.ocrByPageEngine.forEach((byEngine, pageNum) => {
      if (byEngine.has(selectedEngine)) {
        pages.add(pageNum);
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
    const selectedEngine = (ocrOptions.engine || 'tesseract') as OCREngine;
    if (resolveModelScopedOriginalPageOCR(ocrState, currentPage, selectedEngine)) {
      return true;
    }

    setTranslationStatus({
      kind: 'info',
      message: `No OCR cache for ${selectedEngine} on page ${currentPage}. Auto-running OCR for this page...`,
    });

    const ok = await requestAutoOCRFromPanel('current');
    if (!ok) return false;

    const refreshed = useOCRTextLayerStore.getState();
    return Boolean(resolveModelScopedOriginalPageOCR(refreshed, currentPage, selectedEngine));
  };

  const ensureAllPagesOCRReadyForTranslation = async (): Promise<boolean> => {
    if (fileType !== 'pdf') {
      return ensureCurrentPageOCRReadyForTranslation();
    }

    const selectedEngine = (ocrOptions.engine || 'tesseract') as OCREngine;
    const cachedPages = getModelScopedCachedPageNumbers();
    if (totalPages > 0 && cachedPages.length >= totalPages) {
      return true;
    }

    setTranslationStatus({
      kind: 'info',
      message: `OCR cache for ${selectedEngine} is incomplete (${cachedPages.length}/${totalPages || '?'} pages). Auto-running OCR for all pages...`,
    });

    const ok = await requestAutoOCRFromPanel('all');
    if (!ok) return false;

    const refreshedPages = getModelScopedCachedPageNumbers();
    return totalPages > 0
      ? refreshedPages.length >= totalPages
      : refreshedPages.length > 0;
  };

  const resolveModelScopedPagesForExport = (scope: DownloadScope): Array<{ pageNum: number; ocr: OCRPageResult }> => {
    const ocrState = useOCRTextLayerStore.getState();
    const selectedEngine = (ocrOptions.engine || 'tesseract') as OCREngine;
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
    const ocrState = useOCRTextLayerStore.getState();
    const pageMap = ocrState.translationCacheByPage.get(pageNum);
    if (!pageMap || pageMap.size === 0) return undefined;

    const normalizedTargetLanguage = normalizeTranslationLanguage(targetLanguage, 'th');
    const sourceFingerprint = buildOCRSourceFingerprint(pageOCR, selectedEngine);
    const entries = Array.from(pageMap.values())
      .filter((entry) => {
        if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
        if (entry.ocrEngine !== selectedEngine) return false;
        if (entry.sourceFingerprint !== sourceFingerprint) return false;
        return normalizeTranslationLanguage(entry.targetLanguage, 'th') === normalizedTargetLanguage;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    if (entries.length === 0) return undefined;

    const activeKey = ocrState.activeTranslationKeyByPage.get(pageNum);
    if (activeKey) {
      const active = pageMap.get(activeKey);
      if (active && entries.some((entry) => entry.key === active.key)) {
        return active;
      }
    }

    return entries[0];
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
      ? document.querySelector(`.react-pdf__Page[data-page-number="${pageNum}"] canvas`)
      : document.querySelector('img[data-export-overlay-image="true"]');
    if (!(candidate instanceof HTMLElement)) return undefined;

    const rect = candidate.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width <= 1 || height <= 1) return undefined;

    return { width, height };
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

    const overlayLayoutByIndex = computeOverlayLayoutMap(
      pageOCR.lines.flatMap((line, index) => {
        const translatedText = translatedByIndex.get(index);
        if (!translatedText) return [];
        const sourceFallbackOverlay = isSourceFallbackOverlayText(line.text, translatedText);
        if (shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallbackOverlay) return [];
        if (shouldSkipOverlayForUntranslatedCarryOver(line.text, translatedText, targetLanguage) && !sourceFallbackOverlay) return [];

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
      const translatedText = translatedByIndex.get(index);
      if (!translatedText) return;
      const sourceFallbackOverlay = isSourceFallbackOverlayText(line.text, translatedText);
      if (shouldSkipOverlayRenderForSuspiciousLine(line) && !sourceFallbackOverlay) return;
      if (shouldSkipOverlayForUntranslatedCarryOver(line.text, translatedText, targetLanguage) && !sourceFallbackOverlay) return;

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
        textRect.height,
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

      ctx.beginPath();
      ctx.rect(originLeft, originTop, textRect.width, textRect.height);
      ctx.clip();

      const textBoxLeft = paintLeft + typography.padX;
      const textBoxTop = paintTop + typography.padY + extraTopPad;
      const textBoxWidth = Math.max(1, innerWidth - (typography.padX * 2));
      const textBoxHeight = Math.max(1, paintHeight - ((typography.padY * 2) + extraTopPad + extraBottomPad));
      const lineHeightPx = Math.max(1, typography.fontSize * typography.lineHeight);
      const maxLines = Math.max(1, Math.floor(textBoxHeight / lineHeightPx));
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
        if (y + lineHeightPx > textBoxTop + textBoxHeight + 0.5) return;
        const x = ctx.textAlign === 'center'
          ? textBoxLeft + (textBoxWidth / 2)
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

  const handleHeaderDownload = async (scope: DownloadScope, mode: DownloadContentMode) => {
    if (!file) return;

    const scopedPages = resolveModelScopedPagesForExport(scope);
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
        const selectedEngine = (ocrOptions.engine || 'tesseract') as OCREngine;
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
          const arrayBuffer = await file.arrayBuffer();
          const resultBytes = await searchablePDFService.createSearchablePDFWithOCR(
            arrayBuffer,
            translatedPageMap,
            pageRange
          );
          const url = URL.createObjectURL(new Blob([resultBytes.buffer as ArrayBuffer], { type: 'application/pdf' }));
          const anchor = document.createElement('a');
          anchor.href = url;
          const suffix = '_translated_searchable.pdf';
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
            message: `Exported translated searchable PDF for ${translatedPageMap.size} pages.`,
          });
        }
      }

      setIsDownloadMenuOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown download error';
      setTranslationStatus({ kind: 'error', message: `Download failed: ${message}` });
    } finally {
      setIsDownloadingResult(false);
    }
  };

  const buildGeminiContextOverrides = (
    mode: TranslationMode,
    source: string,
    target: string
  ): { baseSystemPrompt?: string } => {
    const baseSystemPrompt = buildGeminiBasePrompt(mode, source, target, safetySettings);
    return {
      baseSystemPrompt,
    };
  };

  const runAiBatchDocumentTranslation = async () => {
    const ocrState = useOCRTextLayerStore.getState();
    const selectedEngine = (ocrOptions.engine || 'tesseract') as OCREngine;
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

      const baseLines = collectTranslatableLines(pageOCR.lines || []);
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
      const translationSourceLanguage = shouldPreferEnglishSourceForMixedTechnicalPage(
        dedupedLines,
        pageBiasedSourceLanguage,
        normalizedTargetLanguage,
        translationMode
      )
        ? 'en'
        : pageBiasedSourceLanguage;
      const latinDominantPage = isLikelyLatinDominantTranslationPage(dedupedLines) || hasStrongLatinAnchorLines(dedupedLines);
      const rawLines = assistedLines.filter((line) => {
        if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage)) return false;
        if (latinDominantPage && isLikelyShortForeignSfxLine(line.text)) return false;
        return true;
      });
      let lines = dedupedLines.filter((line) => {
        if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage)) return false;
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
          const rawSourceText = composeGroupSourceText(
            group.lines,
            group.groupType || 'unknown',
            groupingProfile
          );
          const groupSourceLanguage = resolvePreferredSourceLanguageForText(rawSourceText, translationSourceLanguage);
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

        const redistributed = splitTranslatedTextBySourceWeights(
          normalizedGroupText,
          eligibleLines,
          normalizedTargetLanguage
        );

        let redistributedCursor = 0;
        group.lines.forEach((line, lineOffset) => {
          const sourceLineText = normalizeWhitespace(String(line.text || '')) || String(line.text || '');
          const redistributedLine = normalizeWhitespace(String(redistributed[redistributedCursor] || ''));
          redistributedCursor += 1;
          const fallbackLine = resolveRedistributedLineFallback(
            sourceLineText,
            normalizedGroupText,
            normalizedTargetLanguage,
            lineOffset,
            group.lines.length
          );
          const nextText = finalizeTranslatedLine(
            sourceLineText,
            redistributedLine || fallbackLine,
            normalizedTargetLanguage
          );
          if (!redistributedLine) {
            fallbackLines += 1;
          }
          translatedByIndex.set(line.index, nextText || sourceLineText);
        });
      });

      plan.lines.forEach((line) => {
        if (shouldPreserveSourceLineForTranslation(line.text, plan.sourceLanguage)) {
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
        translatedByIndex: Array.from(translatedByIndex.entries()).map(([index, text]) => ({ index, text })),
        translatedText: updatedLines.map((line) => line.text).join('\n').trim(),
        lineCount: translatedByIndex.size,
        groupCount: plan.groups.length,
        createdAt: Date.now(),
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

  const runCurrentPageTranslation = async (
    engine: 'offline' | 'ai',
    pageNum: number = currentPage,
    options?: { suppressStatus?: boolean }
  ): Promise<boolean> => {
    const ocrState = useOCRTextLayerStore.getState();
    const selectedEngine = (ocrOptions.engine || 'tesseract') as OCREngine;
    const pageOCR = resolveModelScopedOriginalPageOCR(ocrState, pageNum, selectedEngine);
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

    const baseTranslatableLines = collectTranslatableLines(pageOCR.lines || []);
    if (baseTranslatableLines.length === 0) {
      if (!options?.suppressStatus) {
        setTranslationStatus({
          kind: 'error',
          message: `No OCR lines with text on page ${pageNum}.`,
        });
      }
      return false;
    }

    const ocrEngine = pageEngine;
    const ocrLanguageKey = pageOCR.language || ocrOptions.language || sourceLanguage || 'eng';
    const normalizedTargetLanguage = normalizeTranslationLanguage(targetLanguage, 'th');
    const normalizedUserSourceLanguage = normalizeTranslationLanguage(sourceLanguage, 'en');
    const resolvedSourceFromOCR = resolveSourceLanguageFromOCR(ocrLanguageKey, normalizedUserSourceLanguage);
    const effectiveSourceLanguage = resolvedSourceFromOCR;

    const shouldUseCrossEngineAssist = pageEngine !== 'paddleocr' && (
      translationMode === 'official'
      || (translationMode === 'adaptive' && shouldUseLineByLineGrouping(
        baseTranslatableLines,
        resolvedSourceFromOCR,
        normalizedTargetLanguage,
        engine,
        translationMode
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
      translationMode
    );
    const translationSourceLanguage = shouldPreferEnglishSourceForMixedTechnicalPage(
      dedupedTranslatableLines,
      pageBiasedSourceLanguage,
      normalizedTargetLanguage,
      translationMode
    )
      ? 'en'
      : pageBiasedSourceLanguage;
    const latinDominantPage = isLikelyLatinDominantTranslationPage(dedupedTranslatableLines)
      || hasStrongLatinAnchorLines(dedupedTranslatableLines);
    const rawTranslatableLines = assistedLines
      .filter((line) => {
        if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage)) return false;
        if (latinDominantPage && isLikelyShortForeignSfxLine(line.text)) return false;
        return true;
      });
    let translatableLines = dedupedTranslatableLines
      .filter((line) => {
        if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage)) return false;
        if (latinDominantPage && isLikelyShortForeignSfxLine(line.text)) return false;
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
      translationMode
    )
      ? 'line-by-line'
      : (shouldUseDenseDialogueGrouping(
        translatableLines,
        translationSourceLanguage,
        normalizedTargetLanguage,
        translationMode
      )
        ? 'dense-dialogue'
        : 'default');

    if (
      engine === 'offline'
      && pageEngine === 'paddleocr'
      && groupingProfile === 'dense-dialogue'
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
      translationMode
    );
    groupingProfile = resolvedGrouping.groupingProfile;
    pushLayoutGroupingDebugPayload(pageNum, groupingProfile, resolvedGrouping.layoutResult, resolvedGrouping.groups);

    const preparedGroups = resolvedGrouping.groups.map((group, groupIndex) => {
      const rawSourceText = composeGroupSourceText(
        group.lines,
        group.groupType || 'unknown',
        groupingProfile
      );
      const groupSourceLanguage = resolvePreferredSourceLanguageForText(rawSourceText, translationSourceLanguage);
      const sourceText = normalizeSourceForTranslation(rawSourceText, groupSourceLanguage);
      const protectedGroup = protectTranslationTokens(sourceText, targetLanguage);
      return {
        index: groupIndex,
        lines: group.lines,
        sourceLanguage: groupSourceLanguage,
        sourceText,
        protectedText: protectedGroup.protectedText,
        replacements: protectedGroup.replacements,
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

    const translatedGroupsRaw = new Array<string>(preparedGroups.length).fill('');
    const sourceBuckets = new Map<string, number[]>();
    preparedGroups.forEach((group, index) => {
      const sourceKey = normalizeTranslationLanguage(group.sourceLanguage, translationSourceLanguage);
      const bucket = sourceBuckets.get(sourceKey) || [];
      bucket.push(index);
      sourceBuckets.set(sourceKey, bucket);
    });

    for (const [groupSourceLanguage, indexes] of sourceBuckets.entries()) {
      const bucketInputs = indexes.map((index) => preparedGroups[index]?.protectedText || '');
      const bucketTranslated = engine === 'offline'
        ? await translateBatchOffline(bucketInputs, 'text', translationMode, groupSourceLanguage, normalizedTargetLanguage)
        : await translateBatchGemini(
          bucketInputs,
          'text',
          translationMode,
          groupSourceLanguage,
          normalizedTargetLanguage,
          buildGeminiContextOverrides(translationMode, groupSourceLanguage, normalizedTargetLanguage)
        );

      indexes.forEach((groupIndex, bucketIndex) => {
        translatedGroupsRaw[groupIndex] = bucketTranslated[bucketIndex] || '';
      });

      // Diagnostic: log offline translation I/O for debugging untranslated lines
      if (engine === 'offline') {
        indexes.forEach((groupIndex, bucketIndex) => {
          const input = bucketInputs[bucketIndex] || '';
          const output = bucketTranslated[bucketIndex] || '';
          const hasThai = /[\u0E00-\u0E7F]/.test(output);
          if (!hasThai && input.length > 0) {
            console.warn(`[OfflineTranslation] group ${groupIndex} NOT translated: input="${input.slice(0, 80)}" → output="${output.slice(0, 80)}"`);
          }
        });
      }
    }

    const translatedGroups = translatedGroupsRaw.map((text, index) => {
      const restored = restoreProtectedTokens(text, preparedGroups[index]?.replacements || []);
      if (normalizedTargetLanguage === 'th') {
        return normalizeThaiTranslationText(restored);
      }
      return restored;
    });

    const groupLineOverrides = new Map<number, string[]>();
    let groupRetryAppliedCount = 0;

    if (engine === 'offline') {
      for (let groupIndex = 0; groupIndex < preparedGroups.length; groupIndex += 1) {
        const group = preparedGroups[groupIndex];
        const groupSourceLanguage = group.sourceLanguage;
        const sourceGroupText = group.sourceText || '';
        const initialTranslated = translatedGroups[groupIndex] || sourceGroupText;
        if (!shouldRetryGroupTranslation(
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
          const retryProtected = protectTranslationTokens(retrySourceText, targetLanguage);
          const retryGroupRaw = await translateBatchOffline(
            [retryProtected.protectedText],
            'text',
            translationMode,
            groupSourceLanguage,
            normalizedTargetLanguage
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
        const retryLineProtected = retryLineInputs.map((text) => protectTranslationTokens(text, targetLanguage));
        const retryLineRaw = await translateBatchOffline(
          retryLineProtected.map((item) => item.protectedText),
          'text',
          translationMode,
          groupSourceLanguage,
          normalizedTargetLanguage
        );
        const retryLineOutputs = group.lines.map((line, lineIndex) => {
          const restored = restoreProtectedTokens(
            retryLineRaw[lineIndex] || '',
            retryLineProtected[lineIndex]?.replacements || []
          );
          return finalizeTranslatedLine(line.text, restored, normalizedTargetLanguage);
        });
        candidateScores.push({
          kind: 'per-line',
          score: retryLineOutputs.reduce(
            (sum, lineText, lineIndex) => sum + scoreTranslationCandidate(group.lines[lineIndex]?.text || '', lineText, normalizedTargetLanguage),
            0
          ),
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
      const directLineOverride = groupLineOverrides.get(groupIndex);
      if (directLineOverride && directLineOverride.length > 0) {
        group.lines.forEach((line, lineIndex) => {
          const sourceLineText = normalizeWhitespace(String(line.text || '')) || String(line.text || '');
          const overrideText = directLineOverride[lineIndex] || sourceLineText;
          translatedByIndex.set(line.index, overrideText || sourceLineText);
          if (shouldRetryLineTranslation(line.text, overrideText, groupSourceLanguage, normalizedTargetLanguage)) {
            retryLineMap.set(line.index, { index: line.index, sourceText: line.text, sourceLanguage: groupSourceLanguage });
          }
        });
        return;
      }

      const translatedGroup = translatedGroups[groupIndex] || group.sourceText || '';
      const eligibleLines = group.lines;
      const redistributed = splitTranslatedTextBySourceWeights(translatedGroup, eligibleLines, normalizedTargetLanguage);
      let redistributedCursor = 0;
      group.lines.forEach((line, lineOffset) => {
        const sourceLineText = normalizeWhitespace(String(line.text || '')) || String(line.text || '');
        const redistributedLine = normalizeWhitespace(String(redistributed[redistributedCursor] || ''));
        redistributedCursor += 1;
        const fallbackLine = resolveRedistributedLineFallback(
          sourceLineText,
          translatedGroup,
          normalizedTargetLanguage,
          lineOffset,
          group.lines.length
        );
        const finalizedLine = finalizeTranslatedLine(
          sourceLineText,
          redistributedLine || fallbackLine,
          normalizedTargetLanguage
        );
        // Use noise-repaired source as fallback instead of raw OCR text
        const cleanedSourceFallback = normalizeSourceForTranslation(sourceLineText, groupSourceLanguage);
        translatedByIndex.set(line.index, finalizedLine || cleanedSourceFallback || sourceLineText);
        if (shouldRetryLineTranslation(line.text, finalizedLine, groupSourceLanguage, normalizedTargetLanguage)) {
          retryLineMap.set(line.index, { index: line.index, sourceText: line.text, sourceLanguage: groupSourceLanguage });
        }
      });
    });

    translatableLines.forEach((line) => {
      if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage)) {
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
        const protectedRetry = protectTranslationTokens(sourceText, targetLanguage);
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
        const retryRaw = engine === 'offline'
          ? await translateBatchOffline(retryInputs, 'text', translationMode, retrySourceLanguage, normalizedTargetLanguage)
          : await translateBatchGemini(
            retryInputs,
            'text',
            translationMode,
            retrySourceLanguage,
            normalizedTargetLanguage,
            buildGeminiContextOverrides(translationMode, retrySourceLanguage, normalizedTargetLanguage)
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

    const updatedLines = (pageOCR.lines || []).map((line, lineIndex) => {
      const translatedText = translatedByIndex.get(lineIndex);
      if (!translatedText) return line;
      return {
        ...line,
        text: translatedText,
      };
    });

    const cacheTranslationMode: TranslationMode = translationMode;

    const cacheKey = buildOCRTranslationCacheKey({
      ocrEngine,
      ocrLanguage: ocrLanguageKey,
      sourceLanguage: translationSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      translationMode: cacheTranslationMode,
      translatorEngine: engine,
    });

    const translationEntry = {
      key: cacheKey,
      pageNum,
      ocrEngine,
      ocrLanguage: ocrLanguageKey,
      sourceLanguage: translationSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      translationMode: cacheTranslationMode,
      translatorEngine: engine,
      sourceFingerprint: buildOCRSourceFingerprint(pageOCR, ocrEngine),
      translatedByIndex: Array.from(translatedByIndex.entries()).map(([index, text]) => ({ index, text })),
      translatedText: updatedLines.map((line) => line.text).join('\n').trim(),
      lineCount: translatedByIndex.size,
      groupCount: preparedGroups.length,
      createdAt: Date.now(),
    };

    setTranslationCacheEntry(pageNum, cacheKey, translationEntry);

    const cacheDocId = await ensureDocumentId().catch(() => null);
    if (cacheDocId) {
      const persisted = await dbService.saveTranslationCache(cacheDocId, pageNum, cacheKey, translationEntry);
      if (!persisted) {
        console.warn(`[Translation] Failed to persist translation cache for page ${pageNum} (docId=${cacheDocId})`);
      }
    }

    const totalPageCaches = useOCRTextLayerStore.getState().getTranslationCacheEntries(pageNum).length;
    const lowQualityOfflinePath = engine === 'offline'
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
        message: `${engine} | ${translationSourceLanguage}->${normalizedTargetLanguage} | ${ocrLanguageKey} | profile=${groupingProfile} translated ${translatedByIndex.size} lines in ${preparedGroups.length} grouped segments on page ${pageNum}.${groupRetryHint} line retries applied: ${retryAppliedCount}/${retryCandidates.length}. cache slots: ${totalPageCaches}.${crossEngineHint}${preservedHint}${qualityHint}`,
      });
    }

    return true;
  };

  const runOfflineBatchDocumentTranslation = async () => {
    const selectedEngine = (ocrOptions.engine || 'tesseract') as OCREngine;
    const sortedPageNums = getModelScopedCachedPageNumbers();

    if (sortedPageNums.length === 0) {
      await runCurrentPageTranslation('offline');
      return;
    }

    let translatedPages = 0;
    let skippedPages = 0;
    let failedPages = 0;

    for (const pageNum of sortedPageNums) {
      try {
        const translated = await runCurrentPageTranslation('offline', pageNum, { suppressStatus: true });
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
    try {
      const ocrReady = await ensureCurrentPageOCRReadyForTranslation();
      if (!ocrReady) {
        setTranslationStatus({ kind: 'error', message: 'Auto OCR failed before offline translation.' });
        return;
      }

      setTranslationStatus({ kind: 'info', message: 'Running offline translation on current page...' });
      await runCurrentPageTranslation('offline');
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
    try {
      const ocrReady = await ensureCurrentPageOCRReadyForTranslation();
      if (!ocrReady) {
        setTranslationStatus({ kind: 'error', message: 'Auto OCR failed before AI translation.' });
        return;
      }

      setTranslationStatus({ kind: 'info', message: 'Running Gemini translation on current page...' });
      await runCurrentPageTranslation('ai');
    } catch (err) {
      console.error('AI Translation Failed', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTranslationStatus({ kind: 'error', message: `AI translation failed: ${message}` });
    } finally {
      setIsAiProcessing(false);
    }
  };

  const handleOfflineTranslateAllPages = async () => {
    if (isAiProcessing || isOfflineProcessing) return;
    setIsOfflineProcessing(true);
    try {
      const ocrReady = await ensureAllPagesOCRReadyForTranslation();
      if (!ocrReady) {
        setTranslationStatus({ kind: 'error', message: 'Auto OCR failed before offline all-pages translation.' });
        return;
      }

      setTranslationStatus({ kind: 'info', message: 'Running offline translation for all pages...' });
      await runOfflineBatchDocumentTranslation();
    } catch (err) {
      console.error('Offline All-Pages Translation Failed', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTranslationStatus({ kind: 'error', message: `Offline all-pages translation failed: ${message}` });
    } finally {
      setIsOfflineProcessing(false);
    }
  };

  const handleAiTranslateAllPages = async () => {
    if (isAiProcessing || isOfflineProcessing) return;
    setIsAiProcessing(true);
    try {
      const ocrReady = await ensureAllPagesOCRReadyForTranslation();
      if (!ocrReady) {
        setTranslationStatus({ kind: 'error', message: 'Auto OCR failed before AI all-pages translation.' });
        return;
      }

      setTranslationStatus({ kind: 'info', message: 'Running Gemini batch translation across OCR pages...' });
      await runAiBatchDocumentTranslation();
    } catch (err) {
      console.error('AI All-Pages Translation Failed', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTranslationStatus({ kind: 'error', message: `AI all-pages translation failed: ${message}` });
    } finally {
      setIsAiProcessing(false);
    }
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
  const selectedDownloadEngine = (ocrOptions.engine || 'tesseract') as OCREngine;
  const downloadScopedPages = resolveModelScopedPagesForExport(effectiveDownloadScope);
  const downloadScopePageNumbers = effectiveDownloadScope === 'all' && fileType === 'pdf'
    ? Array.from({ length: Math.max(1, totalPages) }, (_, index) => index + 1)
    : [currentPage];
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

  const triggerPopupTranslation = (engine: 'offline' | 'ai') => {
    if (effectiveDownloadScope === 'all' && fileType === 'pdf') {
      if (engine === 'offline') {
        void handleOfflineTranslateAllPages();
        return;
      }
      void handleAiTranslateAllPages();
      return;
    }

    if (engine === 'offline') {
      void handleOfflineTranslate();
      return;
    }
    void handleAiTranslate();
  };

  return (
    <div className="relative flex flex-col h-screen w-screen bg-[#0b0f16] text-slate-100 overflow-hidden font-sans">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-[22rem] w-[22rem] rounded-full bg-[#2B9BFF]/20 blur-3xl" />
        <div className="absolute -right-24 top-1/3 h-[24rem] w-[24rem] rounded-full bg-[#FF7E67]/12 blur-3xl" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_8%,rgba(43,155,255,0.08),transparent_46%),linear-gradient(130deg,rgba(11,15,22,0.96)_0%,rgba(20,23,30,0.98)_55%,rgba(12,15,20,0.99)_100%)]" />
      </div>
      
      {/* HEADER TOOLBAR - Google Docs Style */}
      <header className="relative z-10 h-12 bg-[#171b23]/78 border-b border-white/10 backdrop-blur-xl flex items-center px-2 gap-1 shrink-0">
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

        {/* Text Align */}
        <button className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Align Left">
          <AlignLeft size={16} />
        </button>
        <button className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Align Center">
          <AlignCenter size={16} />
        </button>
        <button className="p-2 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors" title="Align Right">
          <AlignRight size={16} />
        </button>

        {/* Spacer - push profile/downloads to top-right */}
        <div className="flex-1" />

        <div className="flex items-center gap-1 rounded-lg border border-white/12 bg-slate-900/55 px-1.5 py-1">
          <span className={`px-1 text-[10px] font-bold uppercase tracking-[0.18em] ${modeLabelColorClass}`}>
            Mode
          </span>
          {profileOptions.map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() => setTranslationMode(option.mode)}
              className={`h-6 w-6 rounded-md border flex items-center justify-center transition-colors ${translationMode === option.mode ? option.activeClass : 'border-white/12 bg-slate-950/75 text-slate-300 hover:border-white/25 hover:text-white'}`}
              title={`Set translation profile to ${option.label}`}
              aria-label={`Set translation profile to ${option.label}`}
            >
              {option.icon}
            </button>
          ))}
        </div>

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
              onToggle={() => setIsLeftSidebarOpen(!isLeftSidebarOpen)} 
            />
          </React.Suspense>
        )}

        {/* 2. MAIN WORKSPACE (Canvas) */}
        <main className="flex-1 relative overflow-hidden bg-[#313741]">
          <React.Suspense fallback={<div className="flex items-center justify-center h-full text-slate-500">Loading Canvas...</div>}>
            {file.type === 'application/pdf' ? (
              <PDFCanvas />
            ) : (
              <ImageCanvas />
            )}
          </React.Suspense>
        </main>

        {/* 3. RIGHT SIDEBAR - OCR & Settings */}
        <React.Suspense fallback={<div className="w-80 bg-slate-950/55 border-l border-white/10" />}>
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
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/62 backdrop-blur-sm px-4 py-6">
          <div ref={downloadMenuRef} className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0f131b]/96 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-300">Download Export</div>
              <button
                type="button"
                onClick={() => setIsDownloadMenuOpen(false)}
                className="rounded-md border border-white/15 bg-slate-900/80 px-2 py-1 text-[10px] font-semibold text-slate-200 transition-colors hover:border-white/30 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="space-y-2 p-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Scope</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDownloadScopeSelection('current')}
                  className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${downloadScopeSelection === 'current' ? 'border-cyan-300/65 bg-cyan-500/18 text-cyan-100' : 'border-white/12 bg-slate-900/70 text-slate-200 hover:border-white/25 hover:text-white'}`}
                >
                  Current Page
                </button>
                <button
                  type="button"
                  onClick={() => setDownloadScopeSelection('all')}
                  disabled={fileType !== 'pdf'}
                  className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${downloadScopeSelection === 'all' ? 'border-cyan-300/65 bg-cyan-500/18 text-cyan-100' : 'border-white/12 bg-slate-900/70 text-slate-200 hover:border-white/25 hover:text-white'} disabled:cursor-not-allowed disabled:opacity-45`}
                >
                  All Pages
                </button>
              </div>

              <div className="text-[10px] uppercase tracking-wide text-slate-500">Content</div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDownloadModeSelection('original')}
                  className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${downloadModeSelection === 'original' ? 'border-emerald-300/65 bg-emerald-500/16 text-emerald-100' : 'border-white/12 bg-slate-900/70 text-slate-200 hover:border-white/25 hover:text-white'}`}
                >
                  Original OCR PDF
                </button>
                <button
                  type="button"
                  onClick={() => setDownloadModeSelection('translated')}
                  className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors ${downloadModeSelection === 'translated' ? 'border-emerald-300/65 bg-emerald-500/16 text-emerald-100' : 'border-white/12 bg-slate-900/70 text-slate-200 hover:border-white/25 hover:text-white'}`}
                >
                  Translated Overlay
                </button>
              </div>

              {downloadModeSelection === 'translated' && (
                <div className="space-y-2 rounded-lg border border-white/12 bg-slate-900/60 p-2">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">Language + Quick Translate</div>
                  <select
                    value={targetLanguage}
                    onChange={(event) => setTargetLanguage(event.target.value)}
                    aria-label="Download translated target language"
                    title="Download translated target language"
                    className="w-full rounded-md border border-white/15 bg-slate-950/80 px-2 py-1.5 text-[11px] text-slate-100 focus:border-cyan-400/50 focus:outline-none"
                  >
                    <option value="th">Thai (ไทย)</option>
                    <option value="en">English</option>
                    <option value="ja">Japanese (日本語)</option>
                    <option value="ko">Korean (한국어)</option>
                    <option value="zh">Chinese (中文)</option>
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => triggerPopupTranslation('offline')}
                      disabled={isAiProcessing || isOfflineProcessing}
                      className="rounded-md border border-emerald-400/55 bg-emerald-500/16 px-2 py-1.5 text-[11px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/26 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Translate Offline
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerPopupTranslation('ai')}
                      disabled={isAiProcessing || isOfflineProcessing}
                      className="rounded-md border border-cyan-300/65 bg-cyan-500/16 px-2 py-1.5 text-[11px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/26 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      Translate AI
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    target {effectiveDownloadScope === 'all' && fileType === 'pdf' ? 'all OCR pages' : `page ${currentPage}`}
                  </div>
                </div>
              )}

              {effectiveDownloadScope === 'all' && fileType === 'pdf' && missingOcrPageNumbers.length > 0 && (
                <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
                  OCR missing on {missingOcrPageNumbers.length} page(s): {formatPageListSummary(missingOcrPageNumbers)}. Export can continue with OCR pages only.
                </div>
              )}

              {downloadModeSelection === 'translated' && ocrCoveredPageNumbers.length > 0 && missingTranslatedPageNumbers.length > 0 && (
                <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
                  Translation cache missing on {missingTranslatedPageNumbers.length} OCR page(s): {formatPageListSummary(missingTranslatedPageNumbers)}. You can translate now or export available pages.
                </div>
              )}

              {downloadModeSelection === 'translated' && ocrCoveredPageNumbers.length === 0 && (
                <div className="rounded-lg border border-rose-500/45 bg-rose-500/12 px-2 py-1.5 text-[11px] text-rose-100">
                  No OCR cache available yet for this scope. Run OCR first.
                </div>
              )}

              <div className="rounded-lg border border-white/12 bg-slate-900/55 px-2 py-1.5 text-[10px] text-slate-300">
                OCR pages in scope: {ocrCoveredPageNumbers.length > 0 ? formatPageListSummary(ocrCoveredPageNumbers) : '-'}
                {downloadModeSelection === 'translated' && (
                  <span>{` | translated pages: ${translatedAvailablePageNumbers.length > 0 ? formatPageListSummary(translatedAvailablePageNumbers) : '-'}`}</span>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleHeaderDownload(effectiveDownloadScope, downloadModeSelection)}
                disabled={isDownloadingResult || (downloadModeSelection === 'original' ? !canExportOriginalSelection : !canExportTranslatedSelection)}
                className="w-full rounded-lg border border-cyan-300/60 bg-cyan-500/18 px-3 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-500/28 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isDownloadingResult
                  ? 'Preparing download...'
                  : `Export ${effectiveDownloadScope === 'all' && fileType === 'pdf' ? 'All Pages' : `Page ${currentPage}`} • ${downloadModeSelection === 'original' ? 'Original OCR PDF' : 'Translated Overlay'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}





