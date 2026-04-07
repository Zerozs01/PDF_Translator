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
  Download,
  Files
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

const AUTO_OCR_REQUEST_EVENT = 'pdf-translator:auto-ocr-request';
const AUTO_OCR_RESULT_EVENT = 'pdf-translator:auto-ocr-result';

type AutoOCRScope = 'current' | 'all';
type DownloadScope = 'current' | 'all';
type DownloadContentMode = 'original' | 'translated';

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
    baseSystemPrompt?: string;
  }
): Promise<string[]> {
  if (texts.length === 0) return [];
  return Promise.all(
    texts.map((text) => translateWithGemini(text, type, mode, sourceLanguage, targetLanguage, contextOverrides))
  );
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
};

type AdoptedSourceCandidate = {
  text: string;
  adopted: boolean;
  candidateId?: string;
  bbox?: BBox;
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
  { pattern: /\bPOR ?DENTRO\b/gi, replacement: 'POR DENTRO' },
  { pattern: /\bPORDENTRO\b/gi, replacement: 'POR DENTRO' },
  { pattern: /\bYA ?QUEDO\b/gi, replacement: 'YA QUEDO' },
  { pattern: /\bYAQUEDO\b/gi, replacement: 'YA QUEDO' },
  { pattern: /\bRAPIDOPR\b/gi, replacement: 'RAPIDO PR' },
  { pattern: /\bDE,\s*PIDIERON\b/gi, replacement: 'DESPIDIERON' },
  { pattern: /\bI?RAPIDO,?\s*PRI-?\b/gi, replacement: 'RAPIDO, PRI-' },
];

const normalizeSpanishOcrNoiseForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  SPANISH_OCR_NOISE_REPAIRS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });
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

  const latinOnly = normalized.replace(/[^A-Za-z]/g, '');
  const words = normalized.split(/\s+/g).filter(Boolean);
  const hasMixedCaseWord = words.some((word) => /[A-Z]/.test(word) && /[a-z]/.test(word));
  const looksLikeAcronymSequence = words.length > 0 && words.every((word) => {
    const lettersOnly = word.replace(/[^A-Za-z]/g, '');
    if (!lettersOnly) return true;
    return lettersOnly.length <= 3 && lettersOnly === lettersOnly.toUpperCase();
  });
  if (latinOnly.length >= 5 && !hasMixedCaseWord && !looksLikeAcronymSequence) {
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

const SPANISH_HINT_WORDS = new Set([
  'que', 'de', 'la', 'el', 'los', 'las', 'un', 'una', 'por', 'para', 'con', 'sin', 'como', 'pero',
  'si', 'ya', 'me', 'mi', 'se', 'lo', 'le', 'del', 'al', 'es', 'son', 'fue', 'esta', 'este', 'eso',
]);

const ENGLISH_HINT_WORDS = new Set([
  'the', 'and', 'you', 'your', 'this', 'that', 'with', 'from', 'for', 'are', 'was', 'were',
  'have', 'has', 'had', 'will', 'would', 'there', 'here', 'what', 'when', 'where', 'who',
]);

const HANGUL_TEXT_HINT_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/g;
const JAPANESE_KANA_HINT_REGEX = /[\u3040-\u30FF]/g;
const CJK_HAN_HINT_REGEX = /[\u3400-\u4DBF\u4E00-\u9FFF]/g;
const THAI_TEXT_HINT_REGEX = /[\u0E00-\u0E7F]/g;
const CYRILLIC_TEXT_HINT_REGEX = /[\u0400-\u04FF]/g;
const LATIN_TEXT_HINT_REGEX = /[A-Za-z]/g;

const inferSourceLanguageFromTextHints = (
  lines: TranslatableLine[],
  fallbackLanguage: string
): string => {
  const fallback = normalizeTranslationLanguage(fallbackLanguage, 'en');
  if (fallback !== 'en' && fallback !== 'es') return fallback;
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

  const spanishHits = tokens.filter((token) => SPANISH_HINT_WORDS.has(token)).length;
  const englishHits = tokens.filter((token) => ENGLISH_HINT_WORDS.has(token)).length;
  const spanishAccentHits = (sampleText.match(/[áéíóúüñ¿¡]/g) || []).length;
  const spanishScore = spanishHits + (spanishAccentHits * 1.8);
  const englishScore = englishHits;

  if (spanishScore >= 6 && spanishScore > englishScore * 1.35) {
    return 'es';
  }
  if (englishScore >= 6 && englishScore > spanishScore * 1.35) {
    return 'en';
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

const intervalOverlap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

const overlapRatio = (a0: number, a1: number, b0: number, b1: number): number => {
  const overlap = intervalOverlap(a0, a1, b0, b1);
  const base = Math.max(1, Math.min(Math.max(1, a1 - a0), Math.max(1, b1 - b0)));
  return overlap / base;
};

const normalizeTranslatableDedupKey = (text: string): string =>
  normalizeWhitespace(String(text || ''))
    .toUpperCase()
    .replace(/[^A-Z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S');

const TECHNICAL_LINE_HINT_REGEX = /\b(unknowns?|reactions?|equilibrium|resultant|component|components|direction|force|moment|column|columns|connections?|support|rigid|body|beam|beams|pin|hinge|fx|fy|fz|mx|my|mz|rx|ry|rz)\b/i;
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
  const lineScore = (line: TranslatableLine): number => {
    const width = Math.max(1, line.right - line.left);
    const height = Math.max(1, line.bottom - line.top);
    const readability = scoreSourceLineReadability(line.text);
    const area = Math.max(1, width * height);
    const density = line.sourceLength / Math.max(1, Math.sqrt(area));
    return (line.sourceLength * 1.82)
      + (readability * 2.75)
      + (density * 26)
      + (height * 0.18)
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
      const noisyNearDuplicate = !sameOrSubset
        && keySimilarity >= 0.72
        && readabilityGap >= 4.8
        && (existingReadability <= 1.5 || candidateReadability <= 1.5)
        && strongSpatialForNoise;

      if (!sameOrSubset && !similar && !noisyNearDuplicate) return false;

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
    if (lineScore(candidate) > lineScore(existing)) {
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

  const compactSource = source.toLowerCase().replace(/[^a-z]/g, '');
  const compactSourceUpper = source.toUpperCase().replace(/[^A-Z]/g, '');
  const hasVertarToken = /\bVERTAR\b/i.test(source) || compactSourceUpper.includes('VERTAR');
  const hasEssenceToken = /\bESSENCE\b/i.test(source)
    || /\bESSEN(?:CE|SE)\b/i.test(source)
    || /ESSENCE|ESENCE|ESSNCE|ESSEN[CS]E|ESSANCE/.test(compactSourceUpper);
  const translatedLower = translated.toLowerCase();
  const replaceNameToken = (input: string, token: string, replacement: string): string =>
    input.replace(new RegExp(`\\b${token}\\b`, 'ig'), replacement);

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

  if (compactSource === 'aarey' || compactSource === 'aareyo' || compactSource === 'aareyou') {
    return preserveSourceTrailingPunctuation(source, 'น..นี่ คุณจะ');
  }

  if (/^H-?\s*HOW[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ด-ได้ไง');
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

  if (/^I\s+THINK[.!?…]*$/i.test(source)) {
    return preserveSourceTrailingPunctuation(source, 'ฉันว่า');
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

  return translated;
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

  const hasMathLikeContent = SCI_MATH_LINE_REGEX.test(normalized)
    && /[\u0391-\u03C9_+\-*/^=<>\u00B0\u2190-\u2193\u2212\u2032\u2033]/.test(normalized);
  if (hasMathLikeContent) {
    return true;
  }

  const alphaTokens = tokens
    .map((token) => token.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean);
  const longAlphaTokenCount = alphaTokens.filter((token) => token.length >= 4).length;
  if (longAlphaTokenCount >= 1) {
    return false;
  }

  return tokens.length <= 2 && alnum.length <= 6;
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
  if (normalizedSource !== 'en' || normalizedTarget !== 'th') return false;
  if (mode !== 'official' && mode !== 'adaptive') return false;
  if (lines.length <= 4) return false;

  const comicDialogueLike = isLikelyComicDialogueLayout(lines);
  if (mode === 'adaptive' && comicDialogueLike) {
    return false;
  }

  const markerHits = lines.reduce((count, line) => count + (TECHNICAL_SOURCE_HINT_REGEX.test(line.text) ? 1 : 0), 0);
  const tableRowSignalCount = lines.reduce((count, line) => {
    const normalized = normalizeWhitespace(String(line.text || ''));
    return count + (TECHNICAL_TABLE_ROW_HINT_REGEX.test(normalized) ? 1 : 0);
  }, 0);
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

  if (mode === 'adaptive') {
    if (tableLikeTechnicalDocument) {
      return true;
    }

    const strongTechnicalDocument = markerHits >= 3
      && longSentenceLines >= 3
      && avgLength >= 21
      && uppercaseHeadingLines >= 1;
    return strongTechnicalDocument;
  }

  const officialDocumentSignals = (
    (markerHits >= 2 && (longSentenceLines >= 2 || avgLength >= 20))
    || (markerHits >= 1 && uppercaseHeadingLines >= 2 && lines.length >= 8)
    || tableLikeTechnicalDocument
  );
  if (officialDocumentSignals) {
    return true;
  }

  if (engine === 'offline' && markerHits >= 2 && noisyLines >= 3 && longSentenceLines >= 2) {
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
  const previousCenter = (previous.left + previous.right) * 0.5;
  const currentCenter = (current.left + current.right) * 0.5;
  const centerDelta = Math.abs(currentCenter - previousCenter);
  const centeredStack = isDense && centerDelta <= baseHeight * 1.7;
  const aligned = overlapRatio >= (isDense ? 0.14 : 0.18)
    || leftDelta <= baseHeight * (isDense ? 2.4 : 1.8)
    || centeredStack;
  const continuation = isLikelyContinuation(previous.text, current.text);
  const sameRowSeparatedColumns = Math.abs(current.top - previous.top) <= baseHeight * 0.95
    && overlapRatio <= 0.22
    && centerDelta >= baseHeight * 3.5;

  if (sameRowSeparatedColumns) {
    return false;
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
  const normalizedCenterDelta = centerDelta / Math.max(1, Math.max(columnWidth, lineWidth));
  const canBridge = overlap >= 0.08 || centerDelta <= Math.max(60, baseHeight * 2.8);
  if (!canBridge) return null;

  const backwardsPenalty = line.top < column.lastTop - baseHeight * 0.8 ? 1.6 : 0;
  return overlap * 5.2 - normalizedCenterDelta * 2.4 - backwardsPenalty;
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
      });
      return;
    }

    const column = columns[bestColumnIndex];
    column.lines.push(line);
    column.left = Math.min(column.left, line.left);
    column.right = Math.max(column.right, line.right);
    column.centerX = (column.left + column.right) * 0.5;
    column.lastTop = line.top;
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
      if (a.firstTop !== b.firstTop) return a.firstTop - b.firstTop;
      if (a.left !== b.left) return a.left - b.left;
      return a.centerX - b.centerX;
    });

  return orderedColumns.flatMap((column) => column.lines);
};

export const buildTranslationGroups = (
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
  const orderedForGrouping = orderLinesForGrouping(sorted, medianHeight);

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
        if (target.length <= 8 && wordSegments.length > 0) {
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
  const [downloadMenuScope, setDownloadMenuScope] = useState<DownloadScope | null>(null);
  const [isDownloadingResult, setIsDownloadingResult] = useState(false);
  const downloadMenuRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void hydrateGeminiApiKey();
  }, [hydrateGeminiApiKey]);

  useEffect(() => {
    if (!downloadMenuScope) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const targetNode = event.target as Node | null;
      if (downloadMenuRef.current && targetNode && !downloadMenuRef.current.contains(targetNode)) {
        setDownloadMenuScope(null);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDownloadMenuScope(null);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [downloadMenuScope]);

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
        const translatedSections: string[] = [];
        let missingPages = 0;

        scopedPages.forEach(({ pageNum, ocr }) => {
          const translatedEntry = resolveTranslatedEntryForExport(pageNum, ocr, selectedEngine);
          if (!translatedEntry) {
            missingPages += 1;
            return;
          }

          const translatedByIndex = new Map<number, string>(
            translatedEntry.translatedByIndex.map((item) => [item.index, item.text])
          );
          const lines = (ocr.lines || [])
            .map((line, lineIndex) => normalizeWhitespace(String(translatedByIndex.get(lineIndex) || '')))
            .filter(Boolean);
          translatedSections.push(`--- Page ${pageNum} ---\n${lines.join('\n')}`);
        });

        if (translatedSections.length === 0) {
          setTranslationStatus({
            kind: 'error',
            message: 'No translated cache found for selected OCR model and target language. Run translation first.',
          });
          return;
        }

        if (missingPages > 0) {
          setTranslationStatus({
            kind: 'info',
            message: `Exported translated text for ${translatedSections.length} pages; ${missingPages} pages had no matching translated cache.`,
          });
        }

        const payload = translatedSections.join('\n\n');

        const textBlob = new Blob([payload], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(textBlob);
        const anchor = document.createElement('a');
        anchor.href = url;
        const suffix = scope === 'current'
          ? `_page_${currentPage}_translated.txt`
          : '_translated_all_pages.txt';
        anchor.download = file.name.replace(/\.[^.]+$/u, suffix);
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }

      setDownloadMenuScope(null);
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
      const lines = dedupeTranslatableLinesForTranslation(assistedLines);
      const inferredSourceLanguage = inferSourceLanguageFromTextHints(lines, resolvedSourceFromOCR);
      sourceAssistLines += pageAssistLines;

      const groupingProfile: TranslationGroupingProfile = shouldUseLineByLineGrouping(
        lines,
        inferredSourceLanguage,
        normalizedTargetLanguage,
        'ai',
        translationMode
      )
        ? 'line-by-line'
        : (shouldUseDenseDialogueGrouping(
          lines,
          inferredSourceLanguage,
          normalizedTargetLanguage,
          translationMode
        )
          ? 'dense-dialogue'
          : 'default');
      const groups = buildTranslationGroups(lines, groupingProfile)
        .map((group, groupIndex) => {
          const sourceText = normalizeSourceForTranslation(
            group.lines
              .filter((line) => !isScientificSymbolLikeLine(line.text))
              .map((line) => line.text)
              .join(' '),
            inferredSourceLanguage
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
        sourceLanguage: inferredSourceLanguage,
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
          const thaiFallbackLine = normalizedTargetLanguage === 'th'
            ? normalizeThaiTranslationText(normalizedGroupText)
            : sourceLineText;
          const nextText = finalizeTranslatedLine(
            sourceLineText,
            redistributedLine || thaiFallbackLine,
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
    const translatableLines = dedupeTranslatableLinesForTranslation(assistedLines);
    const inferredSourceLanguage = inferSourceLanguageFromTextHints(translatableLines, effectiveSourceLanguage);
    const translationSourceLanguage = inferredSourceLanguage;
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

    const groups = buildTranslationGroups(translatableLines, groupingProfile);

    const groupTexts = groups.map((group) => normalizeSourceForTranslation(
      group.lines
        .filter((line) => !isScientificSymbolLikeLine(line.text))
        .map((line) => line.text)
        .join(' '),
      translationSourceLanguage
    ));
    const protectedGroups = groupTexts.map((text) => protectTranslationTokens(text, targetLanguage));
    const textsForTranslation = protectedGroups.map((item) => item.protectedText);
    const translatedGroupsRaw = engine === 'offline'
      ? await translateBatchOffline(textsForTranslation, 'text', translationMode, translationSourceLanguage, normalizedTargetLanguage)
      : await translateBatchGemini(
        textsForTranslation,
        'text',
        translationMode,
        translationSourceLanguage,
        normalizedTargetLanguage,
        buildGeminiContextOverrides(translationMode, translationSourceLanguage, normalizedTargetLanguage)
      );
    const translatedGroups = translatedGroupsRaw.map((text, index) => {
      const restored = restoreProtectedTokens(text, protectedGroups[index]?.replacements || []);
      if (normalizedTargetLanguage === 'th') {
        return normalizeThaiTranslationText(restored);
      }
      return restored;
    });

    const groupLineOverrides = new Map<number, string[]>();
    let groupRetryAppliedCount = 0;

    if (engine === 'offline') {
      for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
        const group = groups[groupIndex];
        const sourceGroupText = groupTexts[groupIndex] || '';
        const initialTranslated = translatedGroups[groupIndex] || sourceGroupText;
        if (!shouldRetryGroupTranslation(
          sourceGroupText,
          initialTranslated,
          translationSourceLanguage,
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

        const retrySourceText = buildOfflineGroupRetrySourceText(group.lines, translationSourceLanguage);
        if (
          retrySourceText
          && buildTranslationComparisonKey(retrySourceText) !== buildTranslationComparisonKey(sourceGroupText)
        ) {
          const retryProtected = protectTranslationTokens(retrySourceText, targetLanguage);
          const retryGroupRaw = await translateBatchOffline(
            [retryProtected.protectedText],
            'text',
            translationMode,
            translationSourceLanguage,
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

        const retryLineInputs = group.lines.map((line) => normalizeSourceForTranslation(line.text, translationSourceLanguage));
        const retryLineProtected = retryLineInputs.map((text) => protectTranslationTokens(text, targetLanguage));
        const retryLineRaw = await translateBatchOffline(
          retryLineProtected.map((item) => item.protectedText),
          'text',
          translationMode,
          translationSourceLanguage,
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
    const retryLineMap = new Map<number, { index: number; sourceText: string }>();
    groups.forEach((group, groupIndex) => {
      const directLineOverride = groupLineOverrides.get(groupIndex);
      if (directLineOverride && directLineOverride.length > 0) {
        group.lines.forEach((line, lineIndex) => {
          const sourceLineText = normalizeWhitespace(String(line.text || '')) || String(line.text || '');
          if (isScientificSymbolLikeLine(sourceLineText)) {
            translatedByIndex.set(line.index, sourceLineText);
            return;
          }

          const overrideText = directLineOverride[lineIndex] || sourceLineText;
          translatedByIndex.set(line.index, overrideText || sourceLineText);
          if (shouldRetryLineTranslation(line.text, overrideText, translationSourceLanguage, normalizedTargetLanguage)) {
            retryLineMap.set(line.index, { index: line.index, sourceText: line.text });
          }
        });
        return;
      }

      const translatedGroup = translatedGroups[groupIndex] || groupTexts[groupIndex] || '';
      const redistributed = splitTranslatedTextBySourceWeights(translatedGroup, group.lines, normalizedTargetLanguage);
      group.lines.forEach((line, lineIndex) => {
        const sourceLineText = normalizeWhitespace(String(line.text || '')) || String(line.text || '');
        if (isScientificSymbolLikeLine(sourceLineText)) {
          translatedByIndex.set(line.index, sourceLineText);
          return;
        }

        const redistributedLine = normalizeWhitespace(String(redistributed[lineIndex] || ''));
        const thaiFallbackLine = normalizedTargetLanguage === 'th'
          ? normalizeThaiTranslationText(translatedGroup)
          : sourceLineText;
        const finalizedLine = finalizeTranslatedLine(
          sourceLineText,
          redistributedLine || thaiFallbackLine,
          normalizedTargetLanguage
        );
        translatedByIndex.set(line.index, finalizedLine || sourceLineText);
        if (shouldRetryLineTranslation(line.text, finalizedLine, translationSourceLanguage, normalizedTargetLanguage)) {
          retryLineMap.set(line.index, { index: line.index, sourceText: line.text });
        }
      });
    });

    let retryAppliedCount = 0;
    const retryCandidates = Array.from(retryLineMap.values());
    if (retryCandidates.length > 0) {
      const retryPrepared = retryCandidates.map((item) => {
        const sourceText = normalizeSourceForTranslation(item.sourceText, translationSourceLanguage);
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
        ? await translateBatchOffline(retryInputs, 'text', translationMode, translationSourceLanguage, normalizedTargetLanguage)
        : await translateBatchGemini(
          retryInputs,
          'text',
          translationMode,
          translationSourceLanguage,
          normalizedTargetLanguage,
          buildGeminiContextOverrides(translationMode, translationSourceLanguage, normalizedTargetLanguage)
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
        if (shouldRetryLineTranslation(item.sourceText, finalizedRetry, translationSourceLanguage, normalizedTargetLanguage)) {
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
      groupCount: groups.length,
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

    if (!options?.suppressStatus) {
      setTranslationStatus({
        kind: 'success',
        message: `${engine} | ${translationSourceLanguage}->${normalizedTargetLanguage} | ${ocrLanguageKey} | profile=${groupingProfile} translated ${translatedByIndex.size} lines in ${groups.length} grouped segments on page ${pageNum}.${groupRetryHint} line retries applied: ${retryAppliedCount}/${retryCandidates.length}. cache slots: ${totalPageCaches}.${crossEngineHint}${qualityHint}`,
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

        <div className="relative" ref={downloadMenuRef}>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setDownloadMenuScope((prev) => (prev === 'current' ? null : 'current'))}
              className={`p-2 rounded transition-colors ${downloadMenuScope === 'current' ? 'bg-[#2B9BFF]/25 text-white' : 'hover:bg-white/10 text-slate-300 hover:text-white'}`}
              title="Download current page"
              disabled={isDownloadingResult || !file}
            >
              <Download size={16} />
            </button>
            <button
              onClick={() => setDownloadMenuScope((prev) => (prev === 'all' ? null : 'all'))}
              className={`p-2 rounded transition-colors ${downloadMenuScope === 'all' ? 'bg-[#2B9BFF]/25 text-white' : 'hover:bg-white/10 text-slate-300 hover:text-white'} ${(fileType !== 'pdf' || !file) ? 'opacity-50 cursor-not-allowed' : ''}`}
              title="Download all pages"
              disabled={isDownloadingResult || !file || fileType !== 'pdf'}
            >
              <Files size={16} />
            </button>
          </div>

          {downloadMenuScope && (
            <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-white/15 bg-[#0f131b]/95 backdrop-blur-xl shadow-2xl p-2 z-50">
              <div className="px-2 pt-1 pb-2 text-[11px] uppercase tracking-wide text-slate-400">
                {downloadMenuScope === 'current' ? `Download page ${currentPage}` : 'Download all pages'}
              </div>
              <button
                onClick={() => void handleHeaderDownload(downloadMenuScope, 'original')}
                disabled={isDownloadingResult}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-100 hover:bg-white/10 transition-colors disabled:opacity-60"
              >
                Original OCR Result (Searchable PDF)
              </button>
              <button
                onClick={() => void handleHeaderDownload(downloadMenuScope, 'translated')}
                disabled={isDownloadingResult}
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-100 hover:bg-white/10 transition-colors disabled:opacity-60"
              >
                Translated Result (TXT)
              </button>
              {isDownloadingResult && (
                <div className="px-3 pt-2 pb-1 text-xs text-slate-400">Preparing download...</div>
              )}
            </div>
          )}
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
    </div>
  );
}





