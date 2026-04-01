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
  BarChart3
} from 'lucide-react';
import { UploadScreen } from './components/Home/UploadScreen';
import { OCRRegressionHarness } from './components/OCR/OCRRegressionHarness';
import { useUIStore } from './stores/useUIStore';
import { useProjectStore } from './stores/useProjectStore';
import { buildOCRTranslationCacheKey, useOCRTextLayerStore } from './stores/useOCRTextLayerStore';
import { OCRLine, OCREngine, OCRPageResult } from './types';

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
  mode: 'manga' | 'official',
  sourceLanguage: string,
  targetLanguage: string
): Promise<string> {
  try {
    // Use secure electronAPI instead of direct API call
    const result = await window.electronAPI.gemini.translate(text, {
      mode,
      sourceType: type,
      sourceLanguage,
      targetLanguage
    });
    return result;
  } catch (error) {
    console.error('Gemini translation error:', error);
    throw error;
  }
}

async function translateBatchOffline(
  texts: string[],
  type: string,
  mode: 'manga' | 'official',
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
  mode: 'manga' | 'official',
  sourceLanguage: string,
  targetLanguage: string
): Promise<string[]> {
  if (texts.length === 0) return [];
  return Promise.all(
    texts.map((text) => translateWithGemini(text, type, mode, sourceLanguage, targetLanguage))
  );
}

type TranslatableLine = {
  index: number;
  text: string;
  sourceLength: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  height: number;
};

type TranslationGroup = {
  lines: TranslatableLine[];
};

const SENTENCE_END_REGEX = /[.!?\u2026\u3002\uFF01\uFF1F]$/;
const SOFT_CONTINUATION_END_REGEX = /[,;:\-\u2014\u2013\u3001\uFF0C]$/;

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
  if (!isStrongSentenceEnd(prev)) return true;
  if (/^[,;:.)\]\}"'\u3001\uFF0C]/.test(curr)) return true;
  if (/^[a-z]/.test(curr)) return true;
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

const normalizeSourceForTranslation = (text: string): string => {
  let normalized = String(text || '').replace(/\s+/g, ' ').trim();
  normalized = normalized.replace(/\s+([,.;:!?])/g, '$1');
  normalized = normalized.replace(/([,.;:!?])(\S)/g, '$1 $2');

  const latinOnly = normalized.replace(/[^A-Za-z]/g, '');
  if (latinOnly.length >= 12) {
    const uppercaseCount = latinOnly.replace(/[^A-Z]/g, '').length;
    const upperRatio = uppercaseCount / latinOnly.length;
    if (upperRatio >= 0.72) {
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
  normalized = normalized.replace(/\s+([,.;:!?])/g, '$1');
  return normalizeWhitespace(normalized);
};

const TRANSLATION_LETTER_REGEX = /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
const HANGUL_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
const THAI_REGEX = /[\u0E00-\u0E7F]/;

const buildTranslationComparisonKey = (value: string): string =>
  normalizeWhitespace(String(value || ''))
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');

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
  if (normalizedSource === 'ko' && normalizedTarget === 'th') {
    const hasHangul = HANGUL_REGEX.test(translated);
    const hasThai = THAI_REGEX.test(translated);
    if (hasHangul && !hasThai) {
      return true;
    }
  }

  return false;
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

const titleCaseWord = (value: string): string => {
  const lower = String(value || '').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

const protectLocationPhrases = (
  text: string,
  targetLanguage: string
): { protectedText: string; replacements: ProtectedTokenReplacement[] } => {
  const replacements: ProtectedTokenReplacement[] = [];
  let protectedText = text;
  const locale = String(targetLanguage || '').toLowerCase();
  const locationRe = /\b([A-Za-z][A-Za-z'\-]{1,}(?:\s+[A-Za-z][A-Za-z'\-]{1,}){0,2})\s+(Town|City|Village|District)\b/g;

  protectedText = protectedText.replace(locationRe, (_match, rawName: string, rawType: string) => {
    const token = `[[LOCMARK${replacements.length}ZZ]]`;
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

const restoreProtectedTokens = (text: string, replacements: ProtectedTokenReplacement[]): string => {
  let restored = text;
  for (const item of replacements) {
    restored = restored.replace(buildLooseTokenPattern(item.token), item.replacement);
  }
  return restored;
};

const buildOCRSourceFingerprint = (result: OCRPageResult, fallbackEngine: OCREngine): string => {
  const effectiveEngine = result.ocrEngine || fallbackEngine;
  return [
    result.algorithmVersion,
    effectiveEngine,
    result.pipelineProfile || 'panel',
    result.language || 'eng',
    result.words.length,
    result.lines.length,
    normalizeWhitespace(result.text || '').length,
  ].join('|');
};

const computeOverlapRatio = (a: TranslatableLine, b: TranslatableLine): number => {
  const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const baseWidth = Math.max(1, Math.min(a.right - a.left, b.right - b.left));
  return overlap / baseWidth;
};

const shouldMergeLines = (
  previous: TranslatableLine,
  current: TranslatableLine,
  medianHeight: number
): boolean => {
  const baseHeight = Math.max(8, medianHeight || previous.height || current.height || 8);
  const verticalGap = current.top - previous.bottom;
  const overlapRatio = computeOverlapRatio(previous, current);
  const leftDelta = Math.abs(current.left - previous.left);
  const aligned = overlapRatio >= 0.18 || leftDelta <= baseHeight * 1.8;
  const continuation = isLikelyContinuation(previous.text, current.text);

  // Overlapping boxes are treated as same paragraph if they still align.
  if (verticalGap <= 0 && aligned) return true;

  const normalGapLimit = baseHeight * 1.15;
  const continuationGapLimit = baseHeight * 1.9;
  const gapLimit = continuation ? continuationGapLimit : normalGapLimit;
  if (verticalGap > gapLimit) return false;

  if (aligned) return true;
  return continuation && verticalGap <= continuationGapLimit;
};

const buildTranslationGroups = (lines: TranslatableLine[]): TranslationGroup[] => {
  if (lines.length === 0) return [];
  const sorted = [...lines].sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return a.index - b.index;
  });
  const heights = sorted.map((line) => Math.max(1, line.height));
  const medianHeight = computeMedian(heights);

  const groups: TranslationGroup[] = [];
  let currentGroup: TranslatableLine[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const previous = currentGroup[currentGroup.length - 1];
    const current = sorted[i];
    if (shouldMergeLines(previous, current, medianHeight)) {
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

const splitTranslatedTextBySourceWeights = (
  translatedText: string,
  sourceLines: TranslatableLine[],
  targetLanguage: string
): string[] => {
  const target = normalizeWhitespace(translatedText);
  if (sourceLines.length <= 1) return [target];
  if (!target) return sourceLines.map(() => '');

  const explicitLineBreaks = translatedText
    .split(/\r?\n+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);

  if (explicitLineBreaks.length === sourceLines.length) {
    return explicitLineBreaks;
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

        const graphemeSeg = new intlWithSegmenter.Segmenter('th', { granularity: 'grapheme' });
        return Array.from(graphemeSeg.segment(target))
          .map((item) => item.segment)
          .filter((segment) => segment.length > 0);
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
      .map((line) => Math.max(1, line.sourceLength))
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
        .map((line) => Math.max(1, line.sourceLength))
        .reduce((acc, n) => acc + n, 0);
      const desiredEnd = Math.round((consumedSource / totalSource) * target.length);

      const minBoundary = startIndex + 1;
      const maxBoundary = Math.max(minBoundary, segments.length - (sourceLines.length - i - 1));
      let bestBoundary = minBoundary;
      let bestDistance = Number.POSITIVE_INFINITY;

      for (let boundary = minBoundary; boundary <= maxBoundary; boundary += 1) {
        const endChar = cumulative[boundary - 1] || 0;
        const distance = Math.abs(endChar - desiredEnd);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestBoundary = boundary;
        }
      }

      thaiParts.push(segments.slice(startIndex, bestBoundary).join('').trim());
      startIndex = bestBoundary;
    }

    return thaiParts.map((part, index) => part || sourceLines[index]?.text || '');
  }

  const totalSource = sourceLines
    .map((line) => Math.max(1, line.sourceLength))
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
      .map((line) => Math.max(1, line.sourceLength))
      .reduce((acc, n) => acc + n, 0);
    const desiredEnd = Math.round((consumedSource / totalSource) * target.length);
    const min = start + 1;
    const max = Math.max(min, target.length - (sourceLines.length - i - 1));
    const end = findSplitIndexNear(target, desiredEnd, min, max);
    parts.push(target.slice(start, end).trim());
    start = end;
  }

  return parts.map((part, index) => part || sourceLines[index]?.text || '');
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
    setTranslationMode
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

  const handleBackToHome = () => {
    visionService.cancelAll('Project closed');
    closeProject();
  };
  
  useEffect(() => {
    if (showOCRHarness) return undefined;
    // Lazy Initialize Vision Worker (low priority)
    const timer = setTimeout(() => {
      visionService.initialize().then(() => {
        console.log('Vision System Ready (Lazy Loaded)');
        setIsVisionReady(true);
      });
    }, 2000); // Delay 2s to let UI render first

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
    }, 2200);

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

  const collectTranslatableLines = (lines: OCRLine[]): TranslatableLine[] => {
    const collected: TranslatableLine[] = [];
    lines.forEach((line, index) => {
      const text = normalizeWhitespace(String(line.text || ''));
      if (text) {
        const left = Number(line.bbox?.x0 ?? 0);
        const right = Number(line.bbox?.x1 ?? left + Math.max(1, text.length * 8));
        const top = Number(line.bbox?.y0 ?? index * 32);
        const bottom = Number(line.bbox?.y1 ?? top + 24);
        collected.push({
          index,
          text,
          sourceLength: countReadableLength(text),
          left,
          right,
          top,
          bottom,
          height: Math.max(1, bottom - top),
        });
      }
    });
    return collected;
  };

  const runCurrentPageTranslation = async (engine: 'offline' | 'ai') => {
    const ocrState = useOCRTextLayerStore.getState();
    const selectedEngine = (ocrOptions.engine || 'tesseract') as OCREngine;
    const pageOCRFromEngine = ocrState.ocrByPageEngine.get(currentPage)?.get(selectedEngine);
    const fallbackPageOCR = ocrState.allPagesOCR.get(currentPage);
    const pageOCR = pageOCRFromEngine || fallbackPageOCR;
    if (!pageOCR) {
      setTranslationStatus({
        kind: 'error',
        message: 'No OCR data for this page. Run OCR first, then translate.',
      });
      return;
    }

    const pageEngine = (pageOCR.ocrEngine || selectedEngine) as OCREngine;
    if (!pageOCRFromEngine && pageEngine !== selectedEngine) {
      setTranslationStatus({
        kind: 'error',
        message: `OCR cache for selected model (${selectedEngine}) is not loaded on page ${currentPage}. Run OCR with this model first.`,
      });
      return;
    }

    const translatableLines = collectTranslatableLines(pageOCR.lines || []);
    if (translatableLines.length === 0) {
      setTranslationStatus({
        kind: 'error',
        message: 'No OCR lines with text on this page.',
      });
      return;
    }

    const groups = buildTranslationGroups(translatableLines);
    const ocrEngine = pageEngine;
    const ocrLanguageKey = pageOCR.language || ocrOptions.language || sourceLanguage || 'eng';
    const normalizedTargetLanguage = normalizeTranslationLanguage(targetLanguage, 'th');
    const normalizedUserSourceLanguage = normalizeTranslationLanguage(sourceLanguage, 'en');
    const resolvedSourceFromOCR = resolveSourceLanguageFromOCR(ocrLanguageKey, normalizedUserSourceLanguage);
    const effectiveSourceLanguage = resolvedSourceFromOCR;

    const groupTexts = groups.map((group) => normalizeSourceForTranslation(group.lines.map((line) => line.text).join(' ')));
    const protectedGroups = groupTexts.map((text) => protectLocationPhrases(text, targetLanguage));
    const textsForTranslation = protectedGroups.map((item) => item.protectedText);
    const translatedGroupsRaw = engine === 'offline'
      ? await translateBatchOffline(textsForTranslation, 'text', translationMode, effectiveSourceLanguage, normalizedTargetLanguage)
      : await translateBatchGemini(textsForTranslation, 'text', translationMode, effectiveSourceLanguage, normalizedTargetLanguage);
    const translatedGroups = translatedGroupsRaw.map((text, index) => {
      const restored = restoreProtectedTokens(text, protectedGroups[index]?.replacements || []);
      if (normalizedTargetLanguage === 'th') {
        return normalizeThaiTranslationText(restored);
      }
      return restored;
    });

    const translatedByIndex = new Map<number, string>();
    const retryLineMap = new Map<number, { index: number; sourceText: string }>();
    groups.forEach((group, groupIndex) => {
      const translatedGroup = translatedGroups[groupIndex] || groupTexts[groupIndex] || '';
      const redistributed = splitTranslatedTextBySourceWeights(translatedGroup, group.lines, normalizedTargetLanguage);
      group.lines.forEach((line, lineIndex) => {
        const redistributedLine = redistributed[lineIndex] || line.text;
        translatedByIndex.set(line.index, redistributedLine);
        if (shouldRetryLineTranslation(line.text, redistributedLine, effectiveSourceLanguage, normalizedTargetLanguage)) {
          retryLineMap.set(line.index, { index: line.index, sourceText: line.text });
        }
      });
    });

    let retryAppliedCount = 0;
    const retryCandidates = Array.from(retryLineMap.values());
    if (retryCandidates.length > 0) {
      const retryInputs = retryCandidates.map((item) => normalizeSourceForTranslation(item.sourceText));
      const retryRaw = engine === 'offline'
        ? await translateBatchOffline(retryInputs, 'text', translationMode, effectiveSourceLanguage, normalizedTargetLanguage)
        : await translateBatchGemini(retryInputs, 'text', translationMode, effectiveSourceLanguage, normalizedTargetLanguage);
      const retryOutputs = retryRaw.map((text) => (
        normalizedTargetLanguage === 'th'
          ? normalizeThaiTranslationText(text)
          : normalizeWhitespace(String(text || ''))
      ));

      retryCandidates.forEach((item, idx) => {
        const retried = normalizeWhitespace(retryOutputs[idx] || '');
        if (!retried) return;
        if (shouldRetryLineTranslation(item.sourceText, retried, effectiveSourceLanguage, normalizedTargetLanguage)) {
          return;
        }
        translatedByIndex.set(item.index, retried);
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

    const cacheKey = buildOCRTranslationCacheKey({
      ocrEngine,
      ocrLanguage: ocrLanguageKey,
      sourceLanguage: effectiveSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      translationMode,
      translatorEngine: engine,
    });

    const translationEntry = {
      key: cacheKey,
      pageNum: currentPage,
      ocrEngine,
      ocrLanguage: ocrLanguageKey,
      sourceLanguage: effectiveSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      translationMode,
      translatorEngine: engine,
      sourceFingerprint: buildOCRSourceFingerprint(pageOCR, ocrEngine),
      translatedByIndex: Array.from(translatedByIndex.entries()).map(([index, text]) => ({ index, text })),
      translatedText: updatedLines.map((line) => line.text).join('\n').trim(),
      lineCount: translatedByIndex.size,
      groupCount: groups.length,
      createdAt: Date.now(),
    };

    setTranslationCacheEntry(currentPage, cacheKey, translationEntry);

    const cacheDocId = await ensureDocumentId().catch(() => null);
    if (cacheDocId) {
      const persisted = await dbService.saveTranslationCache(cacheDocId, currentPage, cacheKey, translationEntry);
      if (!persisted) {
        console.warn(`[Translation] Failed to persist translation cache for page ${currentPage} (docId=${cacheDocId})`);
      }
    }

    const totalPageCaches = useOCRTextLayerStore.getState().getTranslationCacheEntries(currentPage).length;
    const lowQualityOfflinePath = engine === 'offline'
      && normalizedTargetLanguage === 'th'
      && (effectiveSourceLanguage === 'ko' || effectiveSourceLanguage === 'es');
    const qualityHint = lowQualityOfflinePath
      ? ' note: offline Argos quality for this language pair is limited; AI usually gives better Thai phrasing.'
      : '';

    setTranslationStatus({
      kind: 'success',
      message: `${engine} | ${effectiveSourceLanguage}->${normalizedTargetLanguage} | ${ocrLanguageKey} translated ${translatedByIndex.size} lines in ${groups.length} grouped segments on page ${currentPage}. line retries applied: ${retryAppliedCount}/${retryCandidates.length}. cache slots: ${totalPageCaches}.${qualityHint}`,
    });
  };

  const handleOfflineTranslate = async () => {
    if (isAiProcessing || isOfflineProcessing) return;
    setIsOfflineProcessing(true);
    setTranslationStatus({ kind: 'info', message: 'Running offline translation on current page...' });
    try {
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
    setTranslationStatus({ kind: 'info', message: 'Running Gemini translation on current page...' });
    try {
      await runCurrentPageTranslation('ai');
    } catch (err) {
      console.error('AI Translation Failed', err);
      const message = err instanceof Error ? err.message : 'Unknown error';
      setTranslationStatus({ kind: 'error', message: `AI translation failed: ${message}` });
    } finally {
      setIsAiProcessing(false);
    }
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

        <div className="w-px h-6 bg-white/10 mx-1" />

        {/* Spacer - balance tools to center */}
        <div className="flex-1" />
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
            translationStatus={translationStatus}
          />
        </React.Suspense>
      </div>
    </div>
  );
}
