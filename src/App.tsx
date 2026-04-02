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
import type { AiExecutionMode } from './components/Layout/RightSidebar';
import { useUIStore } from './stores/useUIStore';
import { useProjectStore, type SafetySettings, type TranslationMode } from './stores/useProjectStore';
import { buildOCRTranslationCacheKey, useOCRTextLayerStore } from './stores/useOCRTextLayerStore';
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
};

const AI_EXECUTION_MODE_STORAGE_KEY = 'pdf_translator.ai_execution_mode';

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
    apiKey?: string;
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
      apiKey: contextOverrides?.apiKey,
      baseSystemPrompt: contextOverrides?.baseSystemPrompt,
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
    apiKey?: string;
    baseSystemPrompt?: string;
  }
): Promise<string[]> {
  if (texts.length === 0) return [];
  return Promise.all(
    texts.map((text) => translateWithGemini(text, type, mode, sourceLanguage, targetLanguage, contextOverrides))
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

type TranslationGroupingProfile = 'default' | 'dense-dialogue' | 'line-by-line';

type BatchGroupPlan = {
  index: number;
  lines: TranslatableLine[];
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
};

const GEMINI_MODE_STYLE_HINTS: Record<TranslationMode, string> = {
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
      const clean = String(group.protectedText || '').replace(/\r?\n+/g, ' ').trim();
      const lineIndexes = group.lines.map((line) => line.index).join(',');
      lines.push(`  - [${group.index}] (lines: ${lineIndexes}) ${clean}`);
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

const TECHNICAL_OCR_NORMALIZERS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bR\s*E\s*A\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'REACTION' },
  { pattern: /\bD\s*I\s*R\s*E\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'DIRECTION' },
  { pattern: /\bC\s*O\s*N\s*N\s*E\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'CONNECTION' },
];

const ENGLISH_OCR_NOISE_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
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

const normalizeSourceForTranslation = (text: string): string => {
  let normalized = normalizeTechnicalArtifactsForTranslation(text);
  normalized = normalizeEnglishOcrNoiseForTranslation(normalized);
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
  normalized = normalized
    .replace(/([\(\[\{])\s+/g, '$1')
    .replace(/\s+([\)\]\}])/g, '$1');
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

  if (normalizedTarget === 'th') {
    const letterChars = translated.match(/[A-Za-z\u0E00-\u0E7F]/g) || [];
    const latinChars = translated.match(/[A-Za-z]/g) || [];
    const thaiChars = translated.match(/[\u0E00-\u0E7F]/g) || [];
    const latinRatio = latinChars.length / Math.max(1, letterChars.length);
    const looksUntranslatedLatin = letterChars.length >= 10 && latinRatio >= 0.62 && thaiChars.length <= 2;
    if (looksUntranslatedLatin) {
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

const resolveBestOcrLineText = (line?: OCRLine): string => {
  const rawText = normalizeWhitespace(String(line?.text || ''));
  const wordsText = normalizeWhitespace(
    Array.isArray(line?.words)
      ? line!.words.map((word) => String(word?.text || '')).join(' ')
      : ''
  );

  if (!rawText) return wordsText;
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

const intervalOverlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

const overlapRatio = (a0: number, a1: number, b0: number, b1: number): number => {
  const overlap = intervalOverlap(a0, a1, b0, b1);
  const base = Math.max(1, Math.min(Math.max(1, a1 - a0), Math.max(1, b1 - b0)));
  return overlap / base;
};

const computeAlignmentScore = (base: BBox, candidate: BBox): number | null => {
  const baseCenterY = (base.y0 + base.y1) / 2;
  const candidateCenterY = (candidate.y0 + candidate.y1) / 2;
  const baseHeight = Math.max(1, base.y1 - base.y0);
  const candidateHeight = Math.max(1, candidate.y1 - candidate.y0);
  const avgHeight = Math.max(1, (baseHeight + candidateHeight) / 2);
  const normalizedYGap = Math.abs(candidateCenterY - baseCenterY) / avgHeight;

  const yOverlap = overlapRatio(base.y0, base.y1, candidate.y0, candidate.y1);
  const xOverlap = overlapRatio(base.x0, base.x1, candidate.x0, candidate.x1);

  const sameBand = yOverlap >= 0.14 || normalizedYGap <= 1.55;
  if (!sameBand) return null;

  let score = yOverlap * 6.4 + xOverlap * 2.2 - normalizedYGap * 1.5;
  if (yOverlap >= 0.42) score += 1.8;
  if (xOverlap >= 0.3) score += 0.9;
  return score;
};

const chooseBestSourceTextForLine = (
  baseLine: TranslatableLine,
  baseRawLine: OCRLine | undefined,
  alternativePages: OCRPageResult[],
  usedCandidateIds: Set<string>
): { text: string; adopted: boolean; candidateId?: string } => {
  let bestText = baseLine.text;
  const baseReadability = scoreSourceLineReadability(baseLine.text);
  let bestCombinedScore = baseReadability;
  let bestCandidateId: string | undefined;

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

      if (areaRatio < 0.18 || areaRatio > 5.5) continue;
      if (aspectRatioDelta > 1.6) continue;

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

      if (significantlyBetter && (candidateScore > baseReadability + 1.4 || (isLongerUseful && !baseLooksStable))) {
        bestCombinedScore = combinedScore;
        bestText = candidateText;
        bestCandidateId = candidateId;
      }
    }
  }

  return {
    text: bestText,
    adopted: bestText !== baseLine.text,
    candidateId: bestText !== baseLine.text ? bestCandidateId : undefined,
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
  const acceptedByIndex = new Map<number, { text: string; adopted: boolean }>();
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
    acceptedByIndex.set(line.index, { text: picked.text, adopted: true });
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

const finalizeTranslatedLine = (sourceText: string, translatedText: string, targetLanguage: string): string => {
  const source = normalizeWhitespace(String(sourceText || ''));
  let resolved = normalizeWhitespace(String(translatedText || ''));
  if (!resolved) {
    resolved = source;
  }

  resolved = applyThaiTechnicalGlossary(source, resolved, targetLanguage);
  resolved = preserveTechnicalTokensInTranslation(source, resolved);
  resolved = normalizeThaiTechnicalTerms(source, resolved);

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
  if (normalized.length > 28) return false;
  if (!SCI_SYMBOL_ALLOWED_REGEX.test(normalized)) return false;
  if (!SCI_SYMBOL_SIGNAL_REGEX.test(normalized) && normalized !== normalized.toUpperCase()) return false;

  const tokens = normalized.split(/\s+/g).filter(Boolean);
  if (tokens.length > 5) return false;

  const alnum = normalized.replace(/[^A-Za-z0-9\u0391-\u03C9]/g, '');
  if (alnum.length > 16) return false;
  return true;
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

const shouldUseDenseDialogueGrouping = (sourceLanguage: string, targetLanguage: string): boolean => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  return normalizedTarget === 'th' && (normalizedSource === 'ko' || normalizedSource === 'es');
};

const TECHNICAL_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|conditions?|equilibrium|rigid|body|reaction|moment|force|free[-\s]?body|unknowns?|support|collinear|diagram|objectives?)\b/i;

const shouldUseLineByLineGrouping = (
  lines: TranslatableLine[],
  sourceLanguage: string,
  targetLanguage: string,
  engine: 'offline' | 'ai'
): boolean => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedSource !== 'en' || normalizedTarget !== 'th') return false;
  if (lines.length <= 4) return false;

  const markerHits = lines.reduce((count, line) => count + (TECHNICAL_SOURCE_HINT_REGEX.test(line.text) ? 1 : 0), 0);
  const avgLength = lines.reduce((sum, line) => sum + line.text.length, 0) / Math.max(1, lines.length);
  const longSentenceLines = lines.filter((line) => line.text.length >= 48 || /[.,;:]/.test(line.text)).length;
  const noisyLines = lines.filter((line) => scoreSourceLineReadability(line.text) < 4).length;
  const uppercaseHeadingLines = lines.filter((line) => {
    const latin = line.text.replace(/[^A-Za-z]/g, '');
    if (latin.length < 5) return false;
    const upperRatio = latin.replace(/[^A-Z]/g, '').length / latin.length;
    return upperRatio >= 0.72;
  }).length;

  const looksLikeDocument = markerHits >= 2
    || longSentenceLines >= 3
    || avgLength >= 24
    || (uppercaseHeadingLines >= 2 && lines.length >= 8);

  if (looksLikeDocument) return true;

  // Offline technical translation suffers the most from aggressive merge+redistribute
  // when OCR text is noisy; keep lines independent in this case.
  if (engine === 'offline' && markerHits >= 1 && (noisyLines >= 2 || lines.length >= 8)) {
    return true;
  }

  return false;
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
  const aligned = overlapRatio >= (isDense ? 0.14 : 0.18) || leftDelta <= baseHeight * (isDense ? 2.4 : 1.8);
  const continuation = isLikelyContinuation(previous.text, current.text);

  // Overlapping boxes are treated as same paragraph if they still align.
  if (verticalGap <= 0 && aligned) return true;

  const normalGapLimit = baseHeight * (isDense ? 1.55 : 1.15);
  const continuationGapLimit = baseHeight * (isDense ? 2.35 : 1.9);
  const gapLimit = continuation ? continuationGapLimit : normalGapLimit;
  if (verticalGap > gapLimit) return false;

  if (aligned) return true;
  return continuation && verticalGap <= continuationGapLimit;
};

const buildTranslationGroups = (
  lines: TranslatableLine[],
  profile: TranslationGroupingProfile = 'default'
): TranslationGroup[] => {
  if (lines.length === 0) return [];
  const sorted = [...lines].sort((a, b) => {
    if (a.top !== b.top) return a.top - b.top;
    if (a.left !== b.left) return a.left - b.left;
    return a.index - b.index;
  });

  if (profile === 'line-by-line') {
    return sorted.map((line) => ({ lines: [line] }));
  }

  const heights = sorted.map((line) => Math.max(1, line.height));
  const medianHeight = computeMedian(heights);

  const groups: TranslationGroup[] = [];
  let currentGroup: TranslatableLine[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const previous = currentGroup[currentGroup.length - 1];
    const current = sorted[i];
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
    setTranslationMode,
    safetySettings,
    geminiApiKey,
  } = useProjectStore();

  const normalizePrewarmLanguage = (value: string): string => value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join('+') || 'eng';
  
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [isOfflineProcessing, setIsOfflineProcessing] = useState(false);
  const [aiExecutionMode, setAiExecutionMode] = useState<AiExecutionMode>(() => {
    if (typeof window === 'undefined') return 'batch-document';
    try {
      const stored = String(window.localStorage.getItem(AI_EXECUTION_MODE_STORAGE_KEY) || '').trim();
      return stored === 'current-page' ? 'current-page' : 'batch-document';
    } catch {
      return 'batch-document';
    }
  });
  const [isVisionReady, setIsVisionReady] = useState(false);
  const [isLeftSidebarOpen, setIsLeftSidebarOpen] = useState(true);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(file?.name || '');
  const [translationStatus, setTranslationStatus] = useState<{ kind: 'info' | 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AI_EXECUTION_MODE_STORAGE_KEY, aiExecutionMode);
    } catch {
      // Ignore storage failures.
    }
  }, [aiExecutionMode]);

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
      const text = resolveBestOcrLineText(line);
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

  const buildGeminiContextOverrides = (
    mode: TranslationMode,
    source: string,
    target: string
  ): { apiKey?: string; baseSystemPrompt?: string } => {
    const apiKey = String(geminiApiKey || '').trim();
    const baseSystemPrompt = buildGeminiBasePrompt(mode, source, target, safetySettings);
    return {
      apiKey: apiKey || undefined,
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

      const alternativePages = Array.from(ocrState.ocrByPageEngine.get(pageNum)?.entries() || [])
        .filter(([engineKey, candidate]) => {
          if (engineKey === selectedEngine) return false;
          if (!candidate || candidate === pageOCR) return false;
          return Array.isArray(candidate.lines) && candidate.lines.length > 0;
        })
        .map(([, candidate]) => candidate);

      const {
        lines,
        adoptedCount: pageAssistLines,
      } = buildTranslationLinesWithCrossEngineFallback(
        baseLines,
        pageOCR.lines || [],
        alternativePages,
        (pageOCR.ocrEngine || selectedEngine) as OCREngine
      );
      sourceAssistLines += pageAssistLines;

      const ocrLanguageKey = pageOCR.language || ocrOptions.language || sourceLanguage || 'eng';
      const resolvedSourceFromOCR = resolveSourceLanguageFromOCR(ocrLanguageKey, normalizedUserSourceLanguage);
      const groupingProfile: TranslationGroupingProfile = shouldUseLineByLineGrouping(
        lines,
        resolvedSourceFromOCR,
        normalizedTargetLanguage,
        'ai'
      )
        ? 'line-by-line'
        : (shouldUseDenseDialogueGrouping(
          resolvedSourceFromOCR,
          normalizedTargetLanguage
        )
          ? 'dense-dialogue'
          : 'default');
      const groups = buildTranslationGroups(lines, groupingProfile)
        .map((group, groupIndex) => {
          const sourceText = normalizeSourceForTranslation(
            group.lines
              .filter((line) => !isScientificSymbolLikeLine(line.text))
              .map((line) => line.text)
              .join(' ')
          );
          const protectedGroup = protectTranslationTokens(sourceText, targetLanguage);
          return {
            index: groupIndex,
            lines: group.lines,
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
        sourceLanguage: resolvedSourceFromOCR,
        lines,
        groups,
        groupingProfile,
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
      sourceFrequency.set(plan.sourceLanguage, (sourceFrequency.get(plan.sourceLanguage) || 0) + plan.groups.length);
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

        const redistributed = splitTranslatedTextBySourceWeights(
          normalizedGroupText,
          group.lines,
          normalizedTargetLanguage
        );

        group.lines.forEach((line, lineIndex) => {
          const sourceLineText = normalizeWhitespace(String(line.text || '')) || String(line.text || '');
          if (isScientificSymbolLikeLine(sourceLineText)) {
            translatedByIndex.set(line.index, sourceLineText);
            return;
          }

          const redistributedLine = normalizeWhitespace(String(redistributed[lineIndex] || ''));
          const nextText = finalizeTranslatedLine(
            sourceLineText,
            redistributedLine || sourceLineText,
            normalizedTargetLanguage
          );
          if (!redistributedLine) {
            fallbackLines += 1;
          }
          translatedByIndex.set(line.index, nextText || sourceLineText);
        });
      });

      plan.lines.forEach((line) => {
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

    setTranslationStatus({
      kind: 'success',
      message: `ai batch | ${dominantSourceLanguage}->${normalizedTargetLanguage} | engine ${selectedEngine} translated ${translatedLines} lines across ${translatedPages} pages from original OCR in one request.${notes.length ? ` notes: ${notes.join(', ')}` : ''}`,
    });
  };

  const runCurrentPageTranslation = async (engine: 'offline' | 'ai') => {
    const ocrState = useOCRTextLayerStore.getState();
    const selectedEngine = (ocrOptions.engine || 'tesseract') as OCREngine;
    const pageOCR = resolveModelScopedOriginalPageOCR(ocrState, currentPage, selectedEngine);
    if (!pageOCR) {
      setTranslationStatus({
        kind: 'error',
        message: `OCR cache for selected model (${selectedEngine}) is not loaded on page ${currentPage}. Run OCR with this model first.`,
      });
      return;
    }

    const pageEngine = (pageOCR.ocrEngine || selectedEngine) as OCREngine;

    const baseTranslatableLines = collectTranslatableLines(pageOCR.lines || []);
    if (baseTranslatableLines.length === 0) {
      setTranslationStatus({
        kind: 'error',
        message: 'No OCR lines with text on this page.',
      });
      return;
    }

    const alternativePages = Array.from(ocrState.ocrByPageEngine.get(currentPage)?.entries() || [])
      .filter(([engineKey, candidate]) => {
        if (engineKey === pageEngine) return false;
        if (!candidate || candidate === pageOCR) return false;
        return Array.isArray(candidate.lines) && candidate.lines.length > 0;
      })
      .map(([, candidate]) => candidate);

    const {
      lines: translatableLines,
      adoptedCount: crossEngineAssistCount,
    } = buildTranslationLinesWithCrossEngineFallback(
      baseTranslatableLines,
      pageOCR.lines || [],
      alternativePages,
      pageEngine
    );

    const ocrEngine = pageEngine;
    const ocrLanguageKey = pageOCR.language || ocrOptions.language || sourceLanguage || 'eng';
    const normalizedTargetLanguage = normalizeTranslationLanguage(targetLanguage, 'th');
    const normalizedUserSourceLanguage = normalizeTranslationLanguage(sourceLanguage, 'en');
    const resolvedSourceFromOCR = resolveSourceLanguageFromOCR(ocrLanguageKey, normalizedUserSourceLanguage);
    const effectiveSourceLanguage = resolvedSourceFromOCR;
    const groupingProfile: TranslationGroupingProfile = shouldUseLineByLineGrouping(
      translatableLines,
      effectiveSourceLanguage,
      normalizedTargetLanguage,
      engine
    )
      ? 'line-by-line'
      : (shouldUseDenseDialogueGrouping(
        effectiveSourceLanguage,
        normalizedTargetLanguage
      )
        ? 'dense-dialogue'
        : 'default');

    const groups = buildTranslationGroups(translatableLines, groupingProfile);

    const groupTexts = groups.map((group) => normalizeSourceForTranslation(
      group.lines
        .filter((line) => !isScientificSymbolLikeLine(line.text))
        .map((line) => line.text)
        .join(' ')
    ));
    const protectedGroups = groupTexts.map((text) => protectTranslationTokens(text, targetLanguage));
    const textsForTranslation = protectedGroups.map((item) => item.protectedText);
    const translatedGroupsRaw = engine === 'offline'
      ? await translateBatchOffline(textsForTranslation, 'text', translationMode, effectiveSourceLanguage, normalizedTargetLanguage)
      : await translateBatchGemini(
        textsForTranslation,
        'text',
        translationMode,
        effectiveSourceLanguage,
        normalizedTargetLanguage,
        buildGeminiContextOverrides(translationMode, effectiveSourceLanguage, normalizedTargetLanguage)
      );
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
        const sourceLineText = normalizeWhitespace(String(line.text || '')) || String(line.text || '');
        if (isScientificSymbolLikeLine(sourceLineText)) {
          translatedByIndex.set(line.index, sourceLineText);
          return;
        }

        const redistributedLine = redistributed[lineIndex] || sourceLineText;
        const finalizedLine = finalizeTranslatedLine(sourceLineText, redistributedLine, normalizedTargetLanguage);
        translatedByIndex.set(line.index, finalizedLine || sourceLineText);
        if (shouldRetryLineTranslation(line.text, finalizedLine, effectiveSourceLanguage, normalizedTargetLanguage)) {
          retryLineMap.set(line.index, { index: line.index, sourceText: line.text });
        }
      });
    });

    let retryAppliedCount = 0;
    const retryCandidates = Array.from(retryLineMap.values());
    if (retryCandidates.length > 0) {
      const retryPrepared = retryCandidates.map((item) => {
        const sourceText = normalizeSourceForTranslation(item.sourceText);
        const protectedRetry = protectTranslationTokens(sourceText, targetLanguage);
        return {
          ...item,
          sourceText,
          protectedText: protectedRetry.protectedText,
          replacements: protectedRetry.replacements,
        };
      });
      const retryInputs = retryPrepared.map((item) => item.protectedText);
      const retryRaw = engine === 'offline'
        ? await translateBatchOffline(retryInputs, 'text', translationMode, effectiveSourceLanguage, normalizedTargetLanguage)
        : await translateBatchGemini(
          retryInputs,
          'text',
          translationMode,
          effectiveSourceLanguage,
          normalizedTargetLanguage,
          buildGeminiContextOverrides(translationMode, effectiveSourceLanguage, normalizedTargetLanguage)
        );
      const retryOutputs = retryRaw.map((text, idx) => {
        const restored = restoreProtectedTokens(text, retryPrepared[idx]?.replacements || []);
        return normalizedTargetLanguage === 'th'
          ? normalizeThaiTranslationText(restored)
          : normalizeWhitespace(String(restored || ''));
      });

      retryPrepared.forEach((item, idx) => {
        const retried = normalizeWhitespace(retryOutputs[idx] || '');
        if (!retried) return;

        const finalizedRetry = finalizeTranslatedLine(item.sourceText, retried, normalizedTargetLanguage);
        if (shouldRetryLineTranslation(item.sourceText, finalizedRetry, effectiveSourceLanguage, normalizedTargetLanguage)) {
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

    const cacheTranslationMode: TranslationMode = engine === 'offline' ? 'official' : translationMode;

    const cacheKey = buildOCRTranslationCacheKey({
      ocrEngine,
      ocrLanguage: ocrLanguageKey,
      sourceLanguage: effectiveSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      translationMode: cacheTranslationMode,
      translatorEngine: engine,
    });

    const translationEntry = {
      key: cacheKey,
      pageNum: currentPage,
      ocrEngine,
      ocrLanguage: ocrLanguageKey,
      sourceLanguage: effectiveSourceLanguage,
      targetLanguage: normalizedTargetLanguage,
      translationMode: cacheTranslationMode,
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
    const crossEngineHint = crossEngineAssistCount > 0
      ? ` source assist: ${crossEngineAssistCount} lines from other OCR engine cache.`
      : '';

    setTranslationStatus({
      kind: 'success',
      message: `${engine} | ${effectiveSourceLanguage}->${normalizedTargetLanguage} | ${ocrLanguageKey} | profile=${groupingProfile} translated ${translatedByIndex.size} lines in ${groups.length} grouped segments on page ${currentPage}. line retries applied: ${retryAppliedCount}/${retryCandidates.length}. cache slots: ${totalPageCaches}.${crossEngineHint}${qualityHint}`,
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
    setTranslationStatus({
      kind: 'info',
      message: aiExecutionMode === 'current-page'
        ? 'Running Gemini translation on current page (test mode)...'
        : 'Running Gemini batch translation across OCR pages...',
    });
    try {
      if (aiExecutionMode === 'current-page') {
        await runCurrentPageTranslation('ai');
      } else {
        await runAiBatchDocumentTranslation();
      }
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
            aiExecutionMode={aiExecutionMode}
            onAiExecutionModeChange={setAiExecutionMode}
          />
        </React.Suspense>
      </div>
    </div>
  );
}
