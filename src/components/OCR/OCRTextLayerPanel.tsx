/**
 * OCRTextLayerPanel - UI สำหรับสร้าง Searchable PDF ด้วย OCR
 * 
 * Features:
 * - เลือกภาษา OCR
 * - เลือก OCR model
 * - แสดง Progress
 * - แสดงผล OCR ที่สแกนได้
 * - Export PDF
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Play, 
  RefreshCw,
  Eye,
  Search,
  ChevronDown,
  ChevronRight,
  Info,
  Copy,
  Check,
  Cpu,
  Trash2,
  X,
  Trophy,
  BarChart3
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { BBox, OCRDroppedWord, OCREngine, OCRLine, OCRPageResult, OCRQualityProfile } from '../../types';
import type { DBDocumentCacheCandidate } from '../../types/electron.d';
import {
  hasCurrentOCRTranslationCacheVersion,
  OCR_ENGINES,
  OCRTranslationCacheEntry,
  useOCRTextLayerStore,
} from '../../stores/useOCRTextLayerStore';
import { useProjectStore } from '../../stores/useProjectStore';
import { searchablePDFService } from '../../services/pdf';
import { dbService } from '../../services/dbService';
import { buildOCRSourceFingerprint } from '../../services/ocrSourceFingerprint';
import { visionService } from '../../services/vision/VisionService';
import {
  OCR_DIRECT_RENDER_TIMEOUT_MS_DEFAULT,
  resolvePerPageTimeoutSec,
  withPerPageOCRTimeout,
} from '../../services/vision/ocr-timeout';
import { OCR_ALGORITHM_VERSION } from '../../services/vision/ocrVersion';
import { pdfjs } from '../../services/pdf/pdfjsWorker';
import { buildTextSearchPattern, collectTextSearchMatches, hasTextSearchMatch, type TextSearchPattern } from '../../services/textSearch';

// PDF.js worker is configured via pdfjsWorker

type EngineWarmPhase = 'idle' | 'checking' | 'warming' | 'ready' | 'error';

type EngineWarmState = {
  phase: EngineWarmPhase;
  progress: number;
  runtime?: string;
  description?: string;
  etaSec?: number | null;
  languageKey?: string;
};

const SESSION_ENGINE_WARM_STATES: Record<string, EngineWarmState> = {};
const SESSION_PREWARM_REQUESTED = new Set<string>();
const SESSION_ENGINE_WARM_PROMISES = new Map<string, Promise<boolean>>();
const SESSION_ENGINE_READY_KEYS = new Set<string>();

const normalizeWarmLanguageKey = (value: string): string => value
  .split('+')
  .map((part) => part.trim())
  .filter(Boolean)
  .sort()
  .join('+') || 'eng';

const getEngineWarmSessionKey = (engine: OCREngine, language: string): string =>
  `${engine}:${normalizeWarmLanguageKey(language)}`;

const AUTO_OCR_REQUEST_EVENT = 'pdf-translator:auto-ocr-request';
const AUTO_OCR_RESULT_EVENT = 'pdf-translator:auto-ocr-result';
const OCR_MODEL_SECTION_OPEN_STORAGE_KEY = 'pdf_translator.ocr_model_section_open';

type AutoOCRScope = 'current' | 'all';

const readPersistedSectionOpen = (storageKey: string, defaultValue: boolean): boolean => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const raw = String(window.localStorage.getItem(storageKey) || '').trim().toLowerCase();
    if (raw === '1' || raw === 'true') return true;
    if (raw === '0' || raw === 'false') return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
};

const persistSectionOpen = (storageKey: string, value: boolean): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, value ? '1' : '0');
  } catch {
    // Ignore storage failures.
  }
};

type BenchmarkRow = {
  engine: OCREngine;
  engineName: string;
  status: 'idle' | 'running' | 'done' | 'error';
  cacheHit: boolean;
  runtimeMs: number | null;
  confidence: number | null;
  compositeScore: number | null;
  wordCount: number;
  lineCount: number;
  suspiciousCount: number;
  suspiciousRatio: number;
  droppedCount: number;
  message?: string;
};

const BENCHMARK_SHORT_KEEP = new Set(['i', 'a', 'go', 'to', 'do', 'in', 'on', 'of', 'if', 'is', 'be', 'we', 'us', 'my', 'or', 'an', 'at', 'as', 'am', 'up', 'it']);
const BENCHMARK_DOMAIN_TOKENS = new Set(['io', 'com', 'net', 'org', 'gg', 'tv']);

const normalizeBenchmarkToken = (token: string): string =>
  String(token || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();

const toBenchmarkTokens = (result: OCRPageResult): string[] => {
  if (Array.isArray(result.words) && result.words.length > 0) {
    return result.words
      .map((word) => String(word?.text || '').trim())
      .filter(Boolean);
  }
  if (Array.isArray(result.lines) && result.lines.length > 0) {
    return result.lines
      .flatMap((line) => String(line?.text || '').split(/\s+/g))
      .map((text) => text.trim())
      .filter(Boolean);
  }
  if (typeof result.text === 'string') {
    return result.text
      .split(/\s+/g)
      .map((text) => text.trim())
      .filter(Boolean);
  }
  return [];
};

const copyTextToClipboard = async (value: string): Promise<boolean> => {
  const normalized = String(value || '');
  if (!normalized.trim()) return false;

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(normalized);
      return true;
    } catch {
      // Fall back to execCommand for Electron/file contexts that reject clipboard API.
    }
  }

  if (typeof document === 'undefined') return false;

  const textarea = document.createElement('textarea');
  textarea.value = normalized;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.left = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
};

const isCjkLikeLanguage = (language: string): boolean => {
  const lang = String(language || '').toLowerCase();
  return lang.includes('kor') || lang.includes('jpn') || lang.includes('chi') || lang.includes('tha');
};

type LanguageScriptAllowance = {
  latin: boolean;
  hangul: boolean;
  kana: boolean;
  han: boolean;
  thai: boolean;
  cyrillic: boolean;
};

type ScriptCharStats = {
  latin: number;
  hangul: number;
  kana: number;
  han: number;
  thai: number;
  cyrillic: number;
  total: number;
  allowed: number;
  disallowed: number;
};

const buildLanguageScriptAllowance = (language: string): LanguageScriptAllowance => {
  const codes = String(language || 'eng')
    .split('+')
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);

  const hasCode = (value: string): boolean => codes.includes(value);
  const hasPrefix = (value: string): boolean => codes.some((code) => code.startsWith(value));
  const hasNonLatinRequested = hasCode('kor')
    || hasCode('jpn')
    || hasCode('jpn_vert')
    || hasPrefix('chi')
    || hasCode('tha')
    || hasCode('rus');
  const englishRequested = hasCode('eng') || hasCode('en');

  return {
    // Keep Latin only when explicitly requested (eng) or when no non-Latin OCR language is selected.
    latin: englishRequested || !hasNonLatinRequested,
    hangul: hasCode('kor'),
    kana: hasCode('jpn') || hasCode('jpn_vert'),
    han: hasPrefix('chi') || hasCode('jpn') || hasCode('jpn_vert'),
    thai: hasCode('tha'),
    cyrillic: hasCode('rus'),
  };
};

const collectScriptCharStats = (text: string, allowance: LanguageScriptAllowance): ScriptCharStats => {
  const stats: ScriptCharStats = {
    latin: 0,
    hangul: 0,
    kana: 0,
    han: 0,
    thai: 0,
    cyrillic: 0,
    total: 0,
    allowed: 0,
    disallowed: 0,
  };

  for (const ch of String(text || '')) {
    let bucket: keyof Pick<ScriptCharStats, 'latin' | 'hangul' | 'kana' | 'han' | 'thai' | 'cyrillic'> | null = null;
    if (/[A-Za-z\u00C0-\u024F]/.test(ch)) bucket = 'latin';
    else if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(ch)) bucket = 'hangul';
    else if (/[\u3040-\u30FF]/.test(ch)) bucket = 'kana';
    else if (/[\u3400-\u4DBF\u4E00-\u9FFF]/.test(ch)) bucket = 'han';
    else if (/[\u0E00-\u0E7F]/.test(ch)) bucket = 'thai';
    else if (/[\u0400-\u04FF]/.test(ch)) bucket = 'cyrillic';

    if (!bucket) continue;

    stats[bucket] += 1;
    stats.total += 1;
    const allowed = (
      (bucket === 'latin' && allowance.latin)
      || (bucket === 'hangul' && allowance.hangul)
      || (bucket === 'kana' && allowance.kana)
      || (bucket === 'han' && allowance.han)
      || (bucket === 'thai' && allowance.thai)
      || (bucket === 'cyrillic' && allowance.cyrillic)
    );
    if (allowed) {
      stats.allowed += 1;
    } else {
      stats.disallowed += 1;
    }
  }

  return stats;
};

const isStrictSingleLanguageScriptGate = (allowance: LanguageScriptAllowance): boolean => {
  const nonLatinAllowed = [allowance.hangul, allowance.kana, allowance.han, allowance.thai, allowance.cyrillic]
    .filter(Boolean)
    .length;
  return nonLatinAllowed <= 1;
};

const isLineLikelyScriptMismatch = (
  text: string,
  allowance: LanguageScriptAllowance,
  averageConfidence: number
): boolean => {
  const stats = collectScriptCharStats(text, allowance);
  if (stats.total === 0 || stats.disallowed <= 0) return false;

  const allowedRatio = stats.allowed / Math.max(1, stats.total);
  if (isStrictSingleLanguageScriptGate(allowance)) {
    const minAllowedChars = allowance.latin ? 1 : 2;
    const minAllowedRatio = allowance.latin ? 0.62 : 0.8;
    const lowConfidenceThreshold = allowance.latin ? 76 : 82;
    if (stats.allowed <= minAllowedChars && stats.disallowed >= 2) return true;
    if (allowedRatio < minAllowedRatio) return true;
    if (averageConfidence < lowConfidenceThreshold && stats.disallowed >= stats.allowed) return true;
    return false;
  }

  if (stats.allowed <= 1 && stats.disallowed >= 3) return true;
  return averageConfidence < 72 && stats.disallowed > (stats.allowed * 1.4);
};

const isWordAllowedByScriptGate = (text: string, allowance: LanguageScriptAllowance): boolean => {
  const normalized = normalizePreviewText(String(text || ''));
  if (!normalized) return false;

  const hasLatin = /[A-Za-z\u00C0-\u024F]/.test(normalized);
  const hasHangul = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(normalized);
  const hasKana = /[\u3040-\u30FF]/.test(normalized);
  const hasHan = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(normalized);
  const hasThai = /[\u0E00-\u0E7F]/.test(normalized);
  const hasCyrillic = /[\u0400-\u04FF]/.test(normalized);

  const hasScriptChar = hasLatin || hasHangul || hasKana || hasHan || hasThai || hasCyrillic;
  if (!hasScriptChar) {
    // Digits/punctuation-only tokens are neutral and safe to keep.
    return true;
  }

  const matchesAllowedScript = (
    (allowance.latin && hasLatin)
    || (allowance.hangul && hasHangul)
    || (allowance.kana && hasKana)
    || (allowance.han && hasHan)
    || (allowance.thai && hasThai)
    || (allowance.cyrillic && hasCyrillic)
  );

  if (!matchesAllowedScript) {
    return false;
  }

  const strictGate = isStrictSingleLanguageScriptGate(allowance);
  if (strictGate) {
    const stats = collectScriptCharStats(normalized, allowance);
    if (stats.disallowed <= 0) return true;
    if (!allowance.latin && stats.allowed < 2) return false;
    if (stats.allowed <= 1) return false;
    const allowedRatio = stats.allowed / Math.max(1, stats.total);
    return allowedRatio >= (allowance.latin ? 0.72 : 0.84);
  }

  return true;
};

const applyPanelLanguageScriptGate = (result: OCRPageResult, requestedLanguage: string): OCRPageResult => {
  const engine = (result.ocrEngine || 'tesseract') as OCREngine;
  const pipeline = result.pipelineProfile || 'panel';
  if (pipeline !== 'panel') return result;
  if (engine !== 'paddleocr' && engine !== 'easyocr') return result;

  const allowance = buildLanguageScriptAllowance(requestedLanguage || result.language || 'eng');
  const dropped: OCRDroppedWord[] = [];
  let changed = false;

  const gatedLines = (Array.isArray(result.lines) ? result.lines : [])
    .map((line) => {
      const lineWords = Array.isArray(line.words) ? line.words : [];
      const keptWords = lineWords.filter((word) => {
        const wordText = normalizePreviewText(String(word?.text || ''));
        if (!wordText) {
          changed = true;
          return false;
        }

        const allowed = isWordAllowedByScriptGate(wordText, allowance);
        if (!allowed) {
          changed = true;
          dropped.push({
            filter: 'panelLanguageScriptGate',
            reason: 'wordScriptMismatch',
            text: wordText,
            confidence: Number(word.confidence || 0),
            bbox: word.bbox,
          });
        }
        return allowed;
      });

      const rawLineText = normalizePreviewText(String(line.text || ''));
      const rawLineAllowed = rawLineText ? isWordAllowedByScriptGate(rawLineText, allowance) : false;
      const rebuiltFromWords = normalizePreviewText(keptWords.map((word) => String(word.text || '')).join(' '));
      const resolvedLineText = rawLineAllowed
        ? rawLineText
        : rebuiltFromWords;

      if (!resolvedLineText) {
        changed = true;
        dropped.push({
          filter: 'panelLanguageScriptGate',
          reason: 'lineScriptMismatch',
          text: rawLineText,
          confidence: Number(line.confidence || 0),
          bbox: line.bbox,
        });
        return null;
      }

      const confidenceSamples = keptWords.length > 0
        ? keptWords.map((word) => Number(word.confidence || 0))
        : [Number(line.confidence || 0)];
      const averageLineConfidence = confidenceSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, confidenceSamples.length);
      if (isLineLikelyScriptMismatch(resolvedLineText, allowance, averageLineConfidence)) {
        changed = true;
        dropped.push({
          filter: 'panelLanguageScriptGate',
          reason: 'lineLanguageMismatch',
          text: resolvedLineText,
          confidence: averageLineConfidence,
          bbox: line.bbox,
        });
        return null;
      }

      const resolvedWords = keptWords.length > 0
        ? keptWords
        : (hasPositivePanelBBox(line.bbox)
          ? [{
            text: resolvedLineText,
            confidence: Number(line.confidence || 0),
            bbox: line.bbox,
          }]
          : []);

      if (resolvedWords.length !== lineWords.length || resolvedLineText !== rawLineText) {
        changed = true;
        return {
          ...line,
          text: resolvedLineText,
          words: resolvedWords,
        } satisfies OCRLine;
      }

      return line;
    })
    .filter((line): line is OCRLine => Boolean(line));

  if (!changed) {
    return result;
  }

  const gatedWords = gatedLines.flatMap((line) => line.words || []);
  return {
    ...result,
    lines: gatedLines,
    words: gatedWords,
    text: gatedLines.map((line) => String(line.text || '')).filter(Boolean).join('\n').trim(),
    debug: {
      ...(result.debug || {}),
      dropCounts: {
        ...(result.debug?.dropCounts || {}),
        panelLanguageScriptGate: ((result.debug?.dropCounts?.panelLanguageScriptGate || 0) + dropped.length),
      },
      droppedWords: [
        ...(result.debug?.droppedWords || []),
        ...dropped,
      ],
    },
  };
};

const computeSuspiciousCount = (tokens: string[], language: string): number => {
  const cjkLike = isCjkLikeLanguage(language);
  const jamoRe = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/;
  const syllableRe = /[\uAC00-\uD7AF]/;
  const edgeJamoRe = /^[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]|[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]$/;
  let suspicious = 0;

  for (const token of tokens) {
    const clean = token.trim();
    if (!clean) continue;
    const normalized = normalizeBenchmarkToken(clean);
    const hasJamo = jamoRe.test(clean);
    const hasSyllable = syllableRe.test(clean);

    if (hasJamo && !hasSyllable) suspicious += 1;
    if (/^[0-9]{1,3}$/.test(clean)) suspicious += 1;
    if (cjkLike && /^[A-Za-z]{1,2}$/.test(clean)) suspicious += 1;
    if (hasSyllable && edgeJamoRe.test(clean) && clean.length <= 4) suspicious += 1;
    if (!cjkLike && normalized.length === 1 && !BENCHMARK_SHORT_KEEP.has(normalized)) suspicious += 1;
  }

  return suspicious;
};

const clampUnit = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const computeLexicalQuality = (tokens: string[], language: string): number => {
  if (tokens.length === 0) return 0;
  if (isCjkLikeLanguage(language)) {
    return 1;
  }

  const vowelLike = /[aeiouy]/i;
  let considered = 0;
  let strong = 0;
  let artifact = 0;

  for (const rawToken of tokens) {
    const normalized = normalizeBenchmarkToken(rawToken);
    if (!normalized) continue;

    considered += 1;

    if (BENCHMARK_DOMAIN_TOKENS.has(normalized)) {
      artifact += 1;
      continue;
    }

    if (/^[0-9]{1,4}$/.test(normalized)) {
      artifact += 1;
      continue;
    }

    if (BENCHMARK_SHORT_KEEP.has(normalized)) {
      strong += 1;
      continue;
    }

    if (normalized.length >= 5 || vowelLike.test(normalized)) {
      strong += 1;
    }
  }

  if (considered === 0) return 0;

  const strongRatio = strong / considered;
  const artifactRatio = artifact / considered;
  return clampUnit(strongRatio - (artifactRatio * 0.45));
};

const computeCompositeScore = (summary: {
  confidence: number;
  suspiciousRatio: number;
  droppedCount: number;
  wordCount: number;
  lexicalQuality: number;
}): number => {
  const confidenceScore = clampUnit(summary.confidence / 100);
  const cleanTokenScore = clampUnit(1 - summary.suspiciousRatio);
  const dropSafetyScore = clampUnit(1 - (summary.droppedCount / Math.max(summary.wordCount, 1)));
  const lexicalScore = clampUnit(summary.lexicalQuality);

  const composite = (
    (confidenceScore * 0.35)
    + (cleanTokenScore * 0.35)
    + (dropSafetyScore * 0.20)
    + (lexicalScore * 0.10)
  ) * 100;

  return Number(composite.toFixed(2));
};

const readRuntimeMs = (result: OCRPageResult): number | null => {
  const debug = result.debug as { runtimeMs?: number; timingsMs?: { ocr?: number } } | undefined;
  if (typeof debug?.runtimeMs === 'number' && Number.isFinite(debug.runtimeMs)) {
    return debug.runtimeMs;
  }
  if (typeof debug?.timingsMs?.ocr === 'number' && Number.isFinite(debug.timingsMs.ocr)) {
    return debug.timingsMs.ocr;
  }
  return null;
};

const normalizePreviewText = (text: string): string => String(text || '').replace(/\s+/g, ' ').trim();

const renderPreviewTextWithHighlight = (text: string, pattern: TextSearchPattern | null): React.ReactNode => {
  const normalizedText = String(text || '');
  if (!pattern || !normalizedText) return normalizedText;

  const matches = collectTextSearchMatches(normalizedText, pattern);
  if (matches.length === 0) return normalizedText;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  matches.forEach((match, index) => {
    if (match.start > cursor) {
      nodes.push(<React.Fragment key={`plain-${cursor}`}>{normalizedText.slice(cursor, match.start)}</React.Fragment>);
    }
    nodes.push(
      <mark key={`match-${index}-${match.start}`} className="rounded bg-amber-300/30 px-px text-amber-100">
        {normalizedText.slice(match.start, match.end)}
      </mark>
    );
    cursor = match.end;
  });

  if (cursor < normalizedText.length) {
    nodes.push(<React.Fragment key={`plain-tail-${cursor}`}>{normalizedText.slice(cursor)}</React.Fragment>);
  }

  return nodes;
};

const hasPositivePanelBBox = (bbox?: { x0: number; y0: number; x1: number; y1: number }): boolean => {
  if (!bbox) return false;
  return (Number(bbox.x1 || 0) - Number(bbox.x0 || 0)) > 0
    && (Number(bbox.y1 || 0) - Number(bbox.y0 || 0)) > 0;
};

const normalizePanelBBox = (bbox?: { x0?: number; y0?: number; x1?: number; y1?: number }): BBox | undefined => {
  const x0 = Number(bbox?.x0);
  const y0 = Number(bbox?.y0);
  const x1 = Number(bbox?.x1);
  const y1 = Number(bbox?.y1);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return undefined;
  if (!(x1 > x0 && y1 > y0)) return undefined;
  return { x0, y0, x1, y1 };
};

const isSamePanelBBox = (a?: BBox, b?: BBox): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
};

const resolvePanelLineBBoxForSafety = (line: OCRLine): BBox | undefined => {
  const normalizedRawBBox = normalizePanelBBox(line?.bbox);

  const validWords: Array<{ bbox: BBox }> = [];
  for (const word of Array.isArray(line.words) ? line.words : []) {
    const text = normalizePreviewText(String(word?.text || ''));
    if (!text) continue;
    const bbox = normalizePanelBBox(word?.bbox);
    if (!bbox) continue;
    validWords.push({ bbox });
  }

  if (validWords.length === 0) {
    return normalizedRawBBox;
  }

  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const word of validWords) {
    x0 = Math.min(x0, word.bbox.x0);
    y0 = Math.min(y0, word.bbox.y0);
    x1 = Math.max(x1, word.bbox.x1);
    y1 = Math.max(y1, word.bbox.y1);
  }

  if (!(x1 > x0 && y1 > y0)) {
    return normalizedRawBBox;
  }

  const wordUnionBBox: BBox = { x0, y0, x1, y1 };
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

  const rawLooksOversized = unionCoverage <= 0.32
    && (
      rawArea >= unionArea * 3.8
      || rawWidth >= unionWidth * 1.9
      || rawHeight >= unionHeight * 1.9
    );

  const rawLooksClipped = validWords.length >= 2
    && unionCoverage >= 2.2
    && unionCoverage <= 4.6
    && (
      unionWidth >= rawWidth * 1.8
      || unionHeight >= rawHeight * 1.8
    );

  return (rawLooksOversized || rawLooksClipped) ? wordUnionBBox : normalizedRawBBox;
};

const resolvePanelLineTextForSafety = (line: OCRLine): string => {
  const rawText = normalizePreviewText(String(line.text || ''));
  if (rawText) return rawText;

  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox))
    .map((word) => ({
      ...word,
      text: normalizePreviewText(String(word?.text || '')),
    }))
    .filter((word) => word.text.length > 0);

  if (validWords.length === 0) return '';

  const wordsText = normalizePreviewText(validWords.map((word) => word.text).join(' '));
  if (!wordsText) return '';

  const lineWidth = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const lineHeight = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const lineArea = Math.max(1, lineWidth * lineHeight);

  let unionX0 = Number.POSITIVE_INFINITY;
  let unionY0 = Number.POSITIVE_INFINITY;
  let unionX1 = Number.NEGATIVE_INFINITY;
  let unionY1 = Number.NEGATIVE_INFINITY;
  validWords.forEach((word) => {
    const bbox = word.bbox;
    unionX0 = Math.min(unionX0, Number(bbox.x0 || 0));
    unionY0 = Math.min(unionY0, Number(bbox.y0 || 0));
    unionX1 = Math.max(unionX1, Number(bbox.x1 || 0));
    unionY1 = Math.max(unionY1, Number(bbox.y1 || 0));
  });

  const unionArea = Math.max(1, (unionX1 - unionX0) * (unionY1 - unionY0));
  const coverage = unionArea / lineArea;
  const avgConfidence = validWords.reduce((sum, word) => sum + Number(word.confidence || 0), 0) / validWords.length;
  const tokens = wordsText.split(/\s+/g).filter(Boolean);
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(wordsText);
  const shortSingleToken = tokens.length === 1 && wordsText.length <= 8;

  if (shortSingleToken && !hasCjkOrThai) {
    return coverage >= 0.72 && avgConfidence >= 72 ? wordsText : '';
  }
  if (tokens.length <= 2 && wordsText.length <= 10 && !hasCjkOrThai) {
    return coverage >= 0.58 && avgConfidence >= 62 ? wordsText : '';
  }
  if (tokens.length >= 3 || wordsText.length >= 14) {
    return (coverage >= 0.24 || avgConfidence >= 58) ? wordsText : '';
  }
  return coverage >= 0.42 ? wordsText : '';
};

const PANEL_GHOST_PUNCT_ONLY_REGEX = /^[|¦│┃/\\_~.,:;'"`!?-]+$/;
const PANEL_GHOST_SHORT_TOKEN_REGEX = /^[A-Z0-9]{1,4}$/;
const PANEL_TECHNICAL_ROW_HINT_REGEX = /\b(resultant|magnitude|direction|force|column|columns|connections?|support|reaction|unknowns?|beam|beams|welded|rigid|types?|table|continued|hinge|pin|collar|utility|building|bridge|girder|floor|member|concrete)\b/i;
const PANEL_TECHNICAL_EQUATION_TAG_REGEX = /\(\s*\d{1,3}[a-z]?\s*\)/i;

const isLikelyTechnicalDocumentLineForSafety = (resolvedText: string): boolean => {
  const normalized = normalizePreviewText(String(resolvedText || ''));
  if (!normalized) return false;

  const alphaNumLength = normalized.replace(/[^A-Za-z0-9]/g, '').length;
  if (alphaNumLength < 6) return false;

  const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
  if (tokenCount < 2 || tokenCount > 20) return false;

  return PANEL_TECHNICAL_ROW_HINT_REGEX.test(normalized) || PANEL_TECHNICAL_EQUATION_TAG_REGEX.test(normalized);
};

const isLikelyDocumentLikePanelPage = (result: OCRPageResult): boolean => {
  const lines = Array.isArray(result.lines) ? result.lines : [];
  if (lines.length < 28) return false;

  const width = Math.max(1, Number(result.width || 0));
  const height = Math.max(1, Number(result.height || 0));
  const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height));
  if (aspectRatio > 2.25) return false;

  let wordCount = 0;
  for (const line of lines) {
    const lineWords = Array.isArray(line.words) ? line.words : [];
    if (lineWords.length > 0) {
      wordCount += lineWords.filter((word) => normalizePreviewText(String(word?.text || '')).length > 0).length;
      continue;
    }
    wordCount += normalizePreviewText(String(line.text || '')).split(/\s+/g).filter(Boolean).length;
  }

  const avgWordsPerLine = wordCount / Math.max(1, lines.length);
  return avgWordsPerLine >= 1.7;
};

const isLikelyLatinDominantPanelPage = (result: OCRPageResult): boolean => {
  const lines = Array.isArray(result.lines) ? result.lines : [];
  if (lines.length < 8) return false;

  let latinChars = 0;
  let nonLatinChars = 0;
  let latinHeavyLines = 0;

  for (const line of lines) {
    const text = normalizePreviewText(String(line?.text || ''));
    if (!text) continue;

    const lineLatin = (text.match(/[A-Za-z]/g) || []).length;
    const lineNonLatin = (text.match(/[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g) || []).length;
    const nonSpace = text.replace(/\s+/g, '').length;
    const latinRatio = lineLatin / Math.max(1, nonSpace);

    latinChars += lineLatin;
    nonLatinChars += lineNonLatin;
    if (lineLatin >= 6 && latinRatio >= 0.45) {
      latinHeavyLines += 1;
    }
  }

  if (latinChars < 18) return false;
  if (latinChars < Math.max(18, nonLatinChars * 0.9)) return false;
  if (latinHeavyLines < Math.max(3, Math.floor(lines.length * 0.24))) return false;
  return true;
};

const computePanelLineAverageConfidence = (line: OCRLine): number => {
  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
  if (validWords.length === 0) {
    return Number(line.confidence || 0);
  }
  return validWords.reduce((sum, word) => sum + Number(word.confidence || 0), 0) / validWords.length;
};

const computePanelLineWordUnionCoverage = (line: OCRLine): number => {
  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
  if (validWords.length === 0) return 0;

  let unionX0 = Number.POSITIVE_INFINITY;
  let unionY0 = Number.POSITIVE_INFINITY;
  let unionX1 = Number.NEGATIVE_INFINITY;
  let unionY1 = Number.NEGATIVE_INFINITY;
  validWords.forEach((word) => {
    const bbox = word.bbox;
    unionX0 = Math.min(unionX0, Number(bbox.x0 || 0));
    unionY0 = Math.min(unionY0, Number(bbox.y0 || 0));
    unionX1 = Math.max(unionX1, Number(bbox.x1 || 0));
    unionY1 = Math.max(unionY1, Number(bbox.y1 || 0));
  });

  const lineWidth = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const lineHeight = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const lineArea = Math.max(1, lineWidth * lineHeight);
  const unionArea = Math.max(1, (unionX1 - unionX0) * (unionY1 - unionY0));
  return Math.max(0, Math.min(1.8, unionArea / lineArea));
};

const isLikelyLargeBorderEffectLineForSafety = (
  line: OCRLine,
  resolvedText: string,
  pageWidth: number,
  pageHeight: number,
): boolean => {
  const text = normalizePreviewText(String(resolvedText || ''));
  if (!text || !line?.bbox) return false;

  const width = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const height = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const area = Math.max(1, width * height);
  const pageArea = Math.max(1, pageWidth * pageHeight);
  const widthRatio = width / Math.max(1, pageWidth);
  const heightRatio = height / Math.max(1, pageHeight);
  const areaRatio = area / pageArea;

  const compact = text.replace(/\s+/g, '');
  const alphaNum = compact.replace(/[^A-Za-z0-9]/g, '');
  const hasLatin = /[A-Za-z\u00C0-\u024F]/.test(compact);
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/.test(compact);
  const unknownChars = compact.replace(/[A-Za-z0-9\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownCharRatio = unknownChars.length / Math.max(1, compact.length);

  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
  const wordCount = validWords.length > 0
    ? validWords.length
    : text.split(/\s+/g).filter(Boolean).length;
  const tokenCount = text.split(/\s+/g).filter(Boolean).length;
  const avgConfidence = computePanelLineAverageConfidence(line);
  const wordCoverage = computePanelLineWordUnionCoverage(line);

  const looksLikeWideDocumentRow = widthRatio >= 0.66
    && heightRatio <= 0.085
    && tokenCount >= 4
    && compact.length >= 16;
  if (looksLikeWideDocumentRow) return false;

  const hugeBorderBox = areaRatio >= 0.038
    || (widthRatio >= 0.34 && heightRatio >= 0.16)
    || (widthRatio >= 0.2 && heightRatio >= 0.24);
  const mediumBorderBox = areaRatio >= 0.026
    && (widthRatio >= 0.18 || heightRatio >= 0.16)
    && (width >= 120 || height >= 92);
  if (!hugeBorderBox && !mediumBorderBox) return false;

  const sparsePhrase = wordCount <= 3 || compact.length <= 16;
  const sparseCjk = hasCjkOrThai && compact.length <= 8 && wordCount <= 3;
  const sparseLatin = hasLatin && alphaNum.length <= 18 && wordCount <= 4;
  const veryLowCoverage = wordCoverage <= 0.22;
  const lowCoverage = wordCoverage <= 0.30;
  const lowSignal = avgConfidence <= 92 || unknownCharRatio >= 0.25;

  if (veryLowCoverage && sparsePhrase && (sparseCjk || sparseLatin || unknownCharRatio >= 0.32)) {
    return true;
  }

  if (lowCoverage && (sparseCjk || sparseLatin) && lowSignal && areaRatio >= 0.05) {
    return true;
  }

  if (lowCoverage && sparsePhrase && (sparseCjk || sparseLatin || unknownCharRatio >= 0.28) && areaRatio >= 0.026) {
    return true;
  }

  const latinEffectSectionGhost = hasLatin
    && !hasCjkOrThai
    && validWords.length <= 1
    && tokenCount >= 2
    && tokenCount <= 7
    && alphaNum.length >= 6
    && alphaNum.length <= 34
    && areaRatio >= 0.022
    && widthRatio >= 0.14
    && heightRatio >= 0.1
    && wordCoverage <= 0.24
    && (area / Math.max(1, alphaNum.length)) >= 620;
  if (latinEffectSectionGhost) {
    return true;
  }

  return false;
};

const isLikelyPanelGhostLineForSafety = (
  line: OCRLine,
  resolvedText: string,
  pageWidth: number
): boolean => {
  const text = normalizePreviewText(String(resolvedText || ''));
  if (!text) return true;

  const width = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const height = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const area = Math.max(1, width * height);
  const compact = text.replace(/\s+/g, '');
  const asciiCompact = compact.replace(/[^A-Za-z0-9]/g, '');
  const latinCompact = compact.replace(/[^A-Za-z]/g, '');
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(compact);
  if (hasCjkOrThai) return false;

  const validWords = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
  const wordCount = validWords.length > 0
    ? validWords.length
    : text.split(/\s+/g).filter(Boolean).length;
  const avgConfidence = computePanelLineAverageConfidence(line);

  if (PANEL_GHOST_PUNCT_ONLY_REGEX.test(compact) && width <= 112 && height <= 44) {
    return true;
  }

  const compactUpper = compact.toUpperCase();
  const shortDigitArtifact = PANEL_GHOST_SHORT_TOKEN_REGEX.test(compactUpper)
    && /\d/.test(compactUpper)
    && !/[a-z]/.test(compact);
  if (shortDigitArtifact && wordCount <= 1 && width <= 96 && height <= 42 && avgConfidence <= 82) {
    return true;
  }

  const pxPerLatinChar = width / Math.max(1, latinCompact.length);
  const suspiciousTinyLongLatin = latinCompact.length >= 10
    && wordCount >= 3
    && pxPerLatinChar < 2.85
    && width <= Math.max(72, latinCompact.length * 5.4)
    && width <= Math.max(96, pageWidth * 0.06)
    && height <= 28
    && avgConfidence <= 84;
  if (suspiciousTinyLongLatin) {
    return true;
  }

  const pxPerAsciiChar = width / Math.max(1, asciiCompact.length);
  const tinyDenseAsciiArtifact = wordCount <= 2
    && asciiCompact.length >= 6
    && asciiCompact.length <= 14
    && pxPerAsciiChar < 2.9
    && width <= Math.max(118, pageWidth * 0.07)
    && height <= 30
    && avgConfidence <= 82;
  if (tinyDenseAsciiArtifact) {
    return true;
  }

  const lowSignalTinySingleton = wordCount <= 1
    && asciiCompact.length > 0
    && asciiCompact.length <= 4
    && area <= 2600
    && width <= 104
    && height <= 40
    && avgConfidence <= 78;
  if (lowSignalTinySingleton) {
    return true;
  }

  return false;
};

const isLikelyTinyMangaArtifactLineForSafety = (
  line: OCRLine,
  resolvedText: string,
  pageWidth: number,
  pageHeight: number,
  latinDominantPage: boolean,
): boolean => {
  const text = normalizePreviewText(String(resolvedText || ''));
  if (!text) return true;
  if (!line?.bbox) return false;

  const width = Math.max(1, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
  const height = Math.max(1, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
  const area = Math.max(1, width * height);
  const compact = text.replace(/\s+/g, '');
  const confidence = Number(line.confidence || 0);
  const words = (Array.isArray(line.words) ? line.words : [])
    .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
  const wordCount = words.length > 0
    ? words.length
    : text.split(/\s+/g).filter(Boolean).length;

  const hasLatin = /[A-Za-z\u00C0-\u024F]/.test(compact);
  const hasCjkOrThai = /[\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(compact);
  const alphaNum = compact.replace(/[^A-Za-z0-9]/g, '');
  const unknownChars = compact.replace(/[A-Za-z0-9\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '');
  const unknownCharRatio = unknownChars.length / Math.max(1, compact.length);
  const wordCoverage = computePanelLineWordUnionCoverage(line);

  if (wordCount <= 1 && width <= 68 && height <= 34 && area <= 1700) {
    if (hasCjkOrThai && compact.length <= 2 && confidence <= 90) {
      return true;
    }
    if (hasLatin && alphaNum.length <= 2 && confidence <= 84) {
      return true;
    }
  }

  if (wordCount <= 2 && width <= 84 && height <= 38 && area <= 2200) {
    if (hasCjkOrThai && compact.length <= 3 && confidence <= 80) {
      return true;
    }
    if (hasLatin && alphaNum.length <= 3 && confidence <= 76) {
      return true;
    }
  }

  const narrowTallLowSignalArtifact = wordCount <= 2
    && width <= Math.max(52, pageWidth * 0.03)
    && height <= Math.max(188, pageHeight * 0.08)
    && height >= Math.max(44, width * 1.2)
    && confidence <= 86;
  if (narrowTallLowSignalArtifact) {
    if (hasCjkOrThai && compact.length <= 2) return true;
    if (hasLatin && alphaNum.length <= 3) return true;
  }

  if (wordCount <= 2 && area <= 2800 && unknownCharRatio >= 0.45 && confidence <= 88) {
    return true;
  }

  const shortStylizedNonLatinSfx = hasCjkOrThai
    && wordCount <= 1
    && compact.length <= 3
    && width <= Math.max(132, pageWidth * 0.085)
    && height <= Math.max(112, pageHeight * 0.12)
    && area <= Math.max(11500, pageWidth * pageHeight * 0.008)
    && confidence <= 92
    && (unknownCharRatio >= 0.08 || height >= width * 0.6);
  if (shortStylizedNonLatinSfx) {
    return true;
  }

  if (hasCjkOrThai && wordCount <= 2 && compact.length <= 5 && area <= 6200 && wordCoverage <= 0.26) {
    if (confidence <= 92 || unknownCharRatio >= 0.2) {
      return true;
    }
  }

  const shortForeignSfxOnLatinPage = latinDominantPage
    && hasCjkOrThai
    && !hasLatin
    && wordCount <= 3
    && compact.length <= 12
    && width <= Math.max(220, pageWidth * 0.18)
    && height <= Math.max(220, pageHeight * 0.22)
    && area <= Math.max(26000, pageWidth * pageHeight * 0.015)
    && confidence <= 96;
  if (shortForeignSfxOnLatinPage) {
    return true;
  }

  return false;
};

const normalizePanelDedupTextKey = (value: string): string =>
  String(value || '')
    .toUpperCase()
    .replace(/[|¦│┃￨︱︲]+/g, '')
    .replace(/[^A-Z0-9\uAC00-\uD7A3\u3040-\u30FF\u3400-\u9FFF]+/g, '')
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/5/g, 'S');

const panelLineWidth = (line: OCRLine): number => Math.max(0, Number(line.bbox?.x1 || 0) - Number(line.bbox?.x0 || 0));
const panelLineHeight = (line: OCRLine): number => Math.max(0, Number(line.bbox?.y1 || 0) - Number(line.bbox?.y0 || 0));
const panelLineArea = (line: OCRLine): number => Math.max(1, panelLineWidth(line) * panelLineHeight(line));
const panelLineCenterX = (line: OCRLine): number => (Number(line.bbox?.x0 || 0) + Number(line.bbox?.x1 || 0)) * 0.5;
const panelLineCenterY = (line: OCRLine): number => (Number(line.bbox?.y0 || 0) + Number(line.bbox?.y1 || 0)) * 0.5;

const panelOverlapRatioX = (a: OCRLine, b: OCRLine): number => {
  const overlap = Math.max(0, Math.min(Number(a.bbox?.x1 || 0), Number(b.bbox?.x1 || 0)) - Math.max(Number(a.bbox?.x0 || 0), Number(b.bbox?.x0 || 0)));
  const minWidth = Math.max(1, Math.min(panelLineWidth(a), panelLineWidth(b)));
  return overlap / minWidth;
};

const panelOverlapRatioY = (a: OCRLine, b: OCRLine): number => {
  const overlap = Math.max(0, Math.min(Number(a.bbox?.y1 || 0), Number(b.bbox?.y1 || 0)) - Math.max(Number(a.bbox?.y0 || 0), Number(b.bbox?.y0 || 0)));
  const minHeight = Math.max(1, Math.min(panelLineHeight(a), panelLineHeight(b)));
  return overlap / minHeight;
};

const panelIoURatio = (a: OCRLine, b: OCRLine): number => {
  const overlapWidth = Math.max(0, Math.min(Number(a.bbox?.x1 || 0), Number(b.bbox?.x1 || 0)) - Math.max(Number(a.bbox?.x0 || 0), Number(b.bbox?.x0 || 0)));
  const overlapHeight = Math.max(0, Math.min(Number(a.bbox?.y1 || 0), Number(b.bbox?.y1 || 0)) - Math.max(Number(a.bbox?.y0 || 0), Number(b.bbox?.y0 || 0)));
  const intersection = overlapWidth * overlapHeight;
  if (intersection <= 0) return 0;

  const union = panelLineArea(a) + panelLineArea(b) - intersection;
  return union > 0 ? (intersection / union) : 0;
};

const buildPanelDedupBigrams = (value: string): Set<string> => {
  const compact = String(value || '').trim();
  const grams = new Set<string>();
  if (!compact) return grams;
  if (compact.length === 1) {
    grams.add(compact);
    return grams;
  }
  for (let i = 0; i < compact.length - 1; i += 1) {
    grams.add(compact.slice(i, i + 2));
  }
  return grams;
};

const panelDedupDiceSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  if (a === b) return 1;

  const aBigrams = buildPanelDedupBigrams(a);
  const bBigrams = buildPanelDedupBigrams(b);
  if (aBigrams.size === 0 || bBigrams.size === 0) return 0;

  let overlap = 0;
  for (const gram of aBigrams) {
    if (bBigrams.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (aBigrams.size + bBigrams.size);
};

const shouldCollapsePanelSafetyDuplicate = (
  existingLine: OCRLine,
  existingKey: string,
  candidateLine: OCRLine,
  candidateKey: string
): boolean => {
  if (!existingKey || !candidateKey) return false;

  const minLength = Math.min(existingKey.length, candidateKey.length);
  const sameOrSubset = existingKey === candidateKey
    || (minLength >= 5 && (existingKey.includes(candidateKey) || candidateKey.includes(existingKey)));
  if (!sameOrSubset) {
    const similarity = panelDedupDiceSimilarity(existingKey, candidateKey);
    if (similarity < 0.72) return false;
    if (minLength < 8 && similarity < 0.86) return false;
  }

  const overlapY = panelOverlapRatioY(existingLine, candidateLine);
  const overlapX = panelOverlapRatioX(existingLine, candidateLine);
  const iou = panelIoURatio(existingLine, candidateLine);
  const centerDeltaY = Math.abs(panelLineCenterY(existingLine) - panelLineCenterY(candidateLine));
  const centerDeltaX = Math.abs(panelLineCenterX(existingLine) - panelLineCenterX(candidateLine));
  const minHeight = Math.max(8, Math.min(panelLineHeight(existingLine), panelLineHeight(candidateLine)));
  const minWidth = Math.max(24, Math.min(panelLineWidth(existingLine), panelLineWidth(candidateLine)));
  const existingArea = Math.max(1, panelLineArea(existingLine));
  const candidateArea = Math.max(1, panelLineArea(candidateLine));
  const areaRatio = existingArea / candidateArea;
  const nearSizeMatch = areaRatio >= 0.64 && areaRatio <= 1.56;
  const strongSpatialMatch = (
    iou >= 0.58
    || (overlapY >= 0.86 && overlapX >= 0.74)
    || (
      overlapY >= 0.68
      && overlapX >= 0.46
      && centerDeltaY <= minHeight * 0.72
      && centerDeltaX <= minWidth * 0.62
    )
  );

  const existingPreview = normalizePreviewText(existingLine.text || '');
  const candidatePreview = normalizePreviewText(candidateLine.text || '');
  const technicalLinePair = (
    isLikelyTechnicalDocumentLineForSafety(existingPreview)
    || isLikelyTechnicalDocumentLineForSafety(candidatePreview)
  );

  // On technical/document rows, collapse duplicates only when the boxes strongly match.
  if (technicalLinePair) {
    return (
      iou >= 0.62
      || (
        overlapY >= 0.86
        && overlapX >= 0.74
        && centerDeltaY <= minHeight * 0.72
        && centerDeltaX <= minWidth * 0.62
      )
      || (
        overlapY >= 0.72
        && overlapX >= 0.58
        && nearSizeMatch
        && centerDeltaY <= minHeight * 0.86
        && centerDeltaX <= minWidth * 0.78
      )
    );
  }

  const exactKeyMatch = existingKey === candidateKey;
  const existingWordCount = existingPreview.split(/\s+/g).filter(Boolean).length;
  const candidateWordCount = candidatePreview.split(/\s+/g).filter(Boolean).length;
  const nearStackedBand = overlapY >= 0.02 || centerDeltaY <= Math.max(96, minHeight * 4.2);
  const shortExactPhrase = exactKeyMatch && candidateKey.length >= 4 && candidateKey.length <= 14;
  const looseAreaRatio = areaRatio >= 0.32 && areaRatio <= 3.2;
  const shortPhraseDuplicate = (
    shortExactPhrase
    && looseAreaRatio
    && centerDeltaY <= Math.max(126, minHeight * 6.2)
    && centerDeltaX <= Math.max(132, minWidth * 2.6)
    && (iou >= 0.12 || overlapY >= 0.24)
  );
  const stackedSameColumnShortDuplicate = (
    shortExactPhrase
    && candidateKey.length >= 10
    && looseAreaRatio
    && centerDeltaY <= Math.max(170, minHeight * 7.5)
    && centerDeltaX <= Math.max(64, minWidth * 1.25)
    && overlapX >= 0.7
  );
  const sameColumnEchoDuplicate = (
    exactKeyMatch
    && candidateKey.length >= 14
    && Math.min(existingWordCount, candidateWordCount) >= 3
    && looseAreaRatio
    && centerDeltaY <= Math.max(220, minHeight * 9.2)
    && centerDeltaX <= Math.max(72, minWidth * 1.35)
    && overlapX >= 0.52
  );
  const localStackedDuplicate = (
    exactKeyMatch
    && candidateKey.length >= 4
    && nearSizeMatch
    && centerDeltaY <= Math.max(112, minHeight * 4.8)
    && centerDeltaX <= Math.max(108, minWidth * 1.9)
    && overlapX >= 0.44
    && nearStackedBand
  );

  if (sameOrSubset) {
    return strongSpatialMatch
      || localStackedDuplicate
      || shortPhraseDuplicate
      || stackedSameColumnShortDuplicate
      || sameColumnEchoDuplicate;
  }

  return (
    iou >= 0.72
    || (overlapY >= 0.9 && overlapX >= 0.8)
    || (
      strongSpatialMatch
      && centerDeltaY <= minHeight * 0.6
      && centerDeltaX <= minWidth * 0.55
    )
  );
};

const applyPanelSafetyLineDedup = (result: OCRPageResult): OCRPageResult => {
  const inputLines = Array.isArray(result.lines) ? result.lines : [];
  if ((result.pipelineProfile || 'panel') !== 'panel') {
    return result;
  }
  if ((result.ocrEngine || 'tesseract') !== 'paddleocr') {
    return result;
  }
  const dropped: OCRDroppedWord[] = [];
  let normalizedTextChanges = 0;
  let normalizedGeometryChanges = 0;
  const pageWidth = Math.max(1, Number(result.width || 0));
  const pageHeight = Math.max(1, Number(result.height || 0));
  const documentLikePage = isLikelyDocumentLikePanelPage(result);
  const latinDominantPage = isLikelyLatinDominantPanelPage(result);
  const preparedLines = inputLines
    .map((line, index) => {
      const rawBBox = normalizePanelBBox(line.bbox);
      const resolvedBBox = resolvePanelLineBBoxForSafety(line);
      const bboxChanged = !isSamePanelBBox(rawBBox, resolvedBBox);
      const lineWithResolvedGeometry = bboxChanged && resolvedBBox
        ? {
          ...line,
          bbox: resolvedBBox,
        }
        : line;

      if (bboxChanged) {
        normalizedGeometryChanges += 1;
      }

      const resolvedText = resolvePanelLineTextForSafety(lineWithResolvedGeometry);
      if (!resolvedText) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostEmptyLine',
          text: normalizePreviewText(String(line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: lineWithResolvedGeometry.bbox,
        });
        return null;
      }

      const normalizedLineBBox = normalizePanelBBox(lineWithResolvedGeometry.bbox);
      if (!normalizedLineBBox) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'invalidLineBBox',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: lineWithResolvedGeometry.bbox,
        });
        return null;
      }

      const validWordCount = (Array.isArray(lineWithResolvedGeometry.words) ? lineWithResolvedGeometry.words : [])
        .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0)
        .length;
      const compactResolvedText = resolvedText.replace(/\s+/g, '');
      const bboxWidth = Math.max(1, normalizedLineBBox.x1 - normalizedLineBBox.x0);
      const bboxHeight = Math.max(1, normalizedLineBBox.y1 - normalizedLineBBox.y0);
      const bboxArea = Math.max(1, bboxWidth * bboxHeight);
      const tinyNoWordLatinArtifact = !documentLikePage
        && validWordCount === 0
        && /[A-Za-z0-9]/.test(compactResolvedText)
        && compactResolvedText.length <= 6
        && bboxWidth <= 96
        && bboxHeight <= 44
        && bboxArea <= 3000
        && Number(lineWithResolvedGeometry.confidence || 0) <= 94;
      if (tinyNoWordLatinArtifact) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostTinyNoWordLine',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: normalizedLineBBox,
        });
        return null;
      }

      const wordCoverage = computePanelLineWordUnionCoverage(lineWithResolvedGeometry);
      const hugeSparseBorderMismatch = !documentLikePage
        && compactResolvedText.length <= 12
        && validWordCount <= 1
        && bboxArea >= Math.max(15000, pageWidth * pageHeight * 0.012)
        && wordCoverage <= 0.18
        && Number(lineWithResolvedGeometry.confidence || 0) <= 95;
      if (hugeSparseBorderMismatch) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostBorderMismatchLine',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: normalizedLineBBox,
        });
        return null;
      }

      const technicalDocumentLine = isLikelyTechnicalDocumentLineForSafety(resolvedText);
      if (documentLikePage && !technicalDocumentLine && isLikelyPanelGhostLineForSafety(lineWithResolvedGeometry, resolvedText, pageWidth)) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostLowSignalLine',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: lineWithResolvedGeometry.bbox,
        });
        return null;
      }

      if (!documentLikePage && isLikelyLargeBorderEffectLineForSafety(lineWithResolvedGeometry, resolvedText, pageWidth, pageHeight)) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostLargeBorderEffectLine',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: lineWithResolvedGeometry.bbox,
        });
        return null;
      }

      if (!documentLikePage && isLikelyTinyMangaArtifactLineForSafety(lineWithResolvedGeometry, resolvedText, pageWidth, pageHeight, latinDominantPage)) {
        dropped.push({
          filter: 'panelSafetyDedup',
          reason: 'ghostTinyArtifactLine',
          text: normalizePreviewText(String(resolvedText || line.text || '')),
          confidence: Number(line.confidence || 0),
          bbox: lineWithResolvedGeometry.bbox,
        });
        return null;
      }

      if (resolvedText !== normalizePreviewText(String(line.text || ''))) {
        normalizedTextChanges += 1;
      }

      const normalizedLine = resolvedText === line.text && !bboxChanged
        ? lineWithResolvedGeometry
        : {
          ...lineWithResolvedGeometry,
          text: resolvedText,
        };

      return { line: normalizedLine, index };
    })
    .filter((item): item is { line: OCRLine; index: number } => Boolean(item));

  if (preparedLines.length === 0) {
    return {
      ...result,
      lines: [],
      words: [],
      text: '',
      debug: {
        ...(result.debug || {}),
        dropCounts: {
          ...(result.debug?.dropCounts || {}),
          panelSafetyDuplicate: ((result.debug?.dropCounts?.panelSafetyDuplicate || 0) + dropped.length),
        },
        droppedWords: [
          ...(result.debug?.droppedWords || []),
          ...dropped,
        ],
      },
    };
  }

  const orderedLines = preparedLines
    .sort((a, b) => {
      const ay = Number(a.line.bbox?.y0 || 0);
      const by = Number(b.line.bbox?.y0 || 0);
      if (ay !== by) return ay - by;
      const ax = Number(a.line.bbox?.x0 || 0);
      const bx = Number(b.line.bbox?.x0 || 0);
      if (ax !== bx) return ax - bx;
      return a.index - b.index;
    });

  const kept: OCRLine[] = [];
  const keptKeys: string[] = [];

  const lineScore = (line: OCRLine): number => {
    const confidence = Number(line.confidence || 0);
    const textLength = String(line.text || '').trim().length;
    return (confidence * 2.2) + textLength + (Math.log10(panelLineArea(line)) * 2.8);
  };

  for (const item of orderedLines) {
    const candidateLine = item.line;
    const candidateKey = normalizePanelDedupTextKey(candidateLine.text || '');
    if (!candidateKey) {
      kept.push(candidateLine);
      keptKeys.push('');
      continue;
    }

    const existingIndex = kept.findIndex((existingLine, index) =>
      shouldCollapsePanelSafetyDuplicate(existingLine, keptKeys[index], candidateLine, candidateKey)
    );
    if (existingIndex < 0) {
      kept.push(candidateLine);
      keptKeys.push(candidateKey);
      continue;
    }

    const existingLine = kept[existingIndex];
    const keepCandidate = lineScore(candidateLine) > lineScore(existingLine);
    const loserLine = keepCandidate ? existingLine : candidateLine;
    dropped.push({
      filter: 'panelSafetyDedup',
      reason: 'samePositionDuplicateLine',
      text: String(loserLine.text || '').trim(),
      confidence: Number(loserLine.confidence || 0),
      bbox: loserLine.bbox,
    });

    if (keepCandidate) {
      kept[existingIndex] = candidateLine;
      keptKeys[existingIndex] = candidateKey;
    }
  }

  if (dropped.length === 0 && normalizedTextChanges === 0 && normalizedGeometryChanges === 0 && preparedLines.length === inputLines.length) {
    return result;
  }

  const originalOrder = new Map<OCRLine, number>();
  preparedLines.forEach(({ line, index }) => {
    originalOrder.set(line, index);
  });

  const dedupedLines = kept.sort((a, b) => {
    const ay = Number(a.bbox?.y0 || 0);
    const by = Number(b.bbox?.y0 || 0);
    const minHeight = Math.max(8, Math.min(panelLineHeight(a), panelLineHeight(b)));
    if (Math.abs(ay - by) > minHeight * 0.55) return ay - by;

    const overlapX = panelOverlapRatioX(a, b);
    const minWidth = Math.max(24, Math.min(panelLineWidth(a), panelLineWidth(b)));
    const centerDeltaX = Math.abs(panelLineCenterX(a) - panelLineCenterX(b));
    const sameColumnLike = overlapX >= 0.64 || centerDeltaX <= minWidth * 0.45;
    if (sameColumnLike && ay !== by) {
      return ay - by;
    }

    const orderDelta = (originalOrder.get(a) || 0) - (originalOrder.get(b) || 0);
    if (orderDelta !== 0) return orderDelta;
    const ax = Number(a.bbox?.x0 || 0);
    const bx = Number(b.bbox?.x0 || 0);
    if (ax !== bx) return ax - bx;
    return 0;
  });
  const dedupedWords = dedupedLines.flatMap((line) => line.words || []);
  const confidenceSource = dedupedWords.length > 0
    ? dedupedWords.map((word) => Number(word.confidence || 0))
    : dedupedLines.map((line) => Number(line.confidence || 0));
  const dedupedConfidence = confidenceSource.length > 0
    ? (confidenceSource.reduce((sum, value) => sum + value, 0) / confidenceSource.length)
    : Number(result.confidence || 0);

  const dropCounts = {
    ...(result.debug?.dropCounts || {}),
    panelSafetyDuplicate: ((result.debug?.dropCounts?.panelSafetyDuplicate || 0) + dropped.length),
  };
  const droppedWords = [
    ...(result.debug?.droppedWords || []),
    ...dropped,
  ];

  return {
    ...result,
    lines: dedupedLines,
    words: dedupedWords,
    text: dedupedLines.map((line) => String(line.text || '')).filter(Boolean).join('\n').trim(),
    confidence: dedupedConfidence,
    debug: {
      ...(result.debug || {}),
      dropCounts,
      droppedWords,
    },
  };
};

const collectResidualRepeatedPanelKeys = (lines: OCRLine[]): Array<{ key: string; count: number; samples: string[] }> => {
  const grouped = new Map<string, OCRLine[]>();
  for (const line of lines) {
    const key = normalizePanelDedupTextKey(line.text || '');
    if (!key) continue;
    const current = grouped.get(key) || [];
    current.push(line);
    grouped.set(key, current);
  }

  const suspicious = Array.from(grouped.entries())
    .map(([key, keyLines]) => {
      if (keyLines.length <= 1) {
        return null;
      }

      const ordered = [...keyLines].sort((a, b) => {
        if (a.bbox.y0 !== b.bbox.y0) return a.bbox.y0 - b.bbox.y0;
        if (a.bbox.x0 !== b.bbox.x0) return a.bbox.x0 - b.bbox.x0;
        return 0;
      });
      const involved = new Set<number>();

      for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          const a = ordered[i];
          const b = ordered[j];
          const minHeight = Math.max(8, Math.min(panelLineHeight(a), panelLineHeight(b)));
          const minWidth = Math.max(24, Math.min(panelLineWidth(a), panelLineWidth(b)));
          const centerDeltaY = Math.abs(panelLineCenterY(a) - panelLineCenterY(b));
          const centerDeltaX = Math.abs(panelLineCenterX(a) - panelLineCenterX(b));
          if (centerDeltaY > Math.max(110, minHeight * 2.8)) {
            break;
          }
          if (centerDeltaX > Math.max(120, minWidth * 2.2)) {
            continue;
          }

          const overlapX = panelOverlapRatioX(a, b);
          const overlapY = panelOverlapRatioY(a, b);
          const iou = panelIoURatio(a, b);
          const likelyResidualDuplicate = (
            iou >= 0.3
            || (overlapY >= 0.42 && overlapX >= 0.52)
            || (overlapX >= 0.6 && centerDeltaY <= minHeight * 1.8)
          );
          if (!likelyResidualDuplicate) {
            continue;
          }

          involved.add(i);
          involved.add(j);
        }
      }

      if (involved.size <= 1) {
        return null;
      }

      const samples = Array.from(involved)
        .slice(0, 3)
        .map((index) => {
          const line = ordered[index];
          const bbox = line.bbox;
          return `${String(line.text || '').trim()} @ (${Math.round(Number(bbox?.x0 || 0))},${Math.round(Number(bbox?.y0 || 0))})-(${Math.round(Number(bbox?.x1 || 0))},${Math.round(Number(bbox?.y1 || 0))})`;
        });

      return {
        key,
        count: involved.size,
        samples,
      };
    })
    .filter((item): item is { key: string; count: number; samples: string[] } => Boolean(item));

  return suspicious
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)
    .map((item) => ({ key: item.key, count: item.count, samples: item.samples }));
};

const buildTranslationCacheSignature = (entry: OCRTranslationCacheEntry): string => [
  entry.key,
  entry.sourceFingerprint,
  entry.ocrEngine,
  entry.ocrLanguage,
  entry.sourceLanguage,
  entry.targetLanguage,
  entry.translationMode,
  entry.translatorEngine,
  entry.lineCount,
  entry.groupCount,
  entry.createdAt,
  entry.translatedByIndex.length,
  normalizePreviewText(entry.translatedText || '').length,
].join('|');

const normalizeCacheLanguageKey = (value: string): string =>
  String(value || '')
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('+') || 'eng';

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

const TRANSLATION_LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  th: 'Thai',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  vi: 'Vietnamese',
  de: 'German',
  fr: 'French',
  ru: 'Russian',
  es: 'Spanish',
};

const normalizeTranslationLanguageKey = (value: string, fallback: string): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (TRANSLATION_LANGUAGE_ALIASES[raw]) return TRANSLATION_LANGUAGE_ALIASES[raw];
  const primary = raw.split('-')[0].trim();
  if (!primary) return fallback;
  return TRANSLATION_LANGUAGE_ALIASES[primary] || primary;
};

const resolveTranslationLanguageLabel = (value: string): string => {
  const normalized = normalizeTranslationLanguageKey(value, '').trim();
  if (!normalized) return 'Unknown';
  return TRANSLATION_LANGUAGE_LABELS[normalized] || normalized.toUpperCase();
};

const resolveTranslationSourceFromOCRKey = (ocrLanguageKey: string, fallback: string): string => {
  const candidates = String(ocrLanguageKey || '')
    .split('+')
    .map((part) => normalizeTranslationLanguageKey(part, ''))
    .filter(Boolean);

  if (candidates.length === 0) {
    return fallback;
  }

  const nonEnglish = candidates.find((lang) => lang !== 'en');
  return nonEnglish || candidates[0] || fallback;
};

export const OCRTextLayerPanel: React.FC = () => {
  const DIRECT_RENDER_TIMEOUT_MS = OCR_DIRECT_RENDER_TIMEOUT_MS_DEFAULT;
  const EXTERNAL_OCR_RENDER_MAX_SIDE = 3800;
  const EXTERNAL_OCR_CJK_PANEL_MAX_SIDE = 11000;
  const EXTERNAL_OCR_CJK_PANEL_MAX_PIXELS = 34_000_000;

  const {
    file,
    fileUrl,
    fileData,
    fileType,
    currentPage,
    totalPages,
    ensureDocumentId,
    translationMode,
    sourceLanguage,
    targetLanguage,
  } = useProjectStore();
  const {
    options,
    setOptions,
    isProcessing,
    progress,
    setProgress,
    setIsProcessing,
    setPageOCR,
    removePageOCRForEngine,
    clearAllOCR,
    allPagesOCR,
    ocrByPageEngine,
    translationPreviewMode,
    setTranslationPreviewMode,
    translationCacheByPage,
    activeTranslationKeyByPage,
    setTranslationCacheEntry,
    setActiveTranslationCacheKey,
    clearTranslationCacheForEngine,
    showDebugOverlay,
    ocrResultSearchQuery,
    setOcrResultSearchQuery,
  } = useOCRTextLayerStore();

  const autoSyncedDocRef = useRef<number | null>(null);
  const persistedCacheRef = useRef<Map<string, string>>(new Map());
  const persistedTranslationCacheRef = useRef<Map<string, string>>(new Map());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const pdfLoadingRef = useRef<Promise<PDFDocumentProxy> | null>(null);
  const fileRef = useRef<File | null>(null);
  const pdfDataRef = useRef<ArrayBuffer | null>(null);
  const statusRefreshInFlightRef = useRef<Promise<void> | null>(null);
  // Keep OCR cache profile stable across translation context switches.
  // Translation mode should affect translation prompt/tone, not OCR cache identity.
  const activePipelineProfile: 'panel' | 'export' = 'panel';
  const normalizedWarmLanguage = normalizeWarmLanguageKey(options.language);
  const abortControllerRef = useRef<AbortController | null>(null);
  const ocrJobActiveRef = useRef(false);
  const suspendCacheReadsRef = useRef(false);
  const cacheLoadInFlightRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const aliasCandidateCacheRef = useRef<Map<string, DBDocumentCacheCandidate[]>>(new Map());
  const aliasCandidateInFlightRef = useRef<Map<string, Promise<DBDocumentCacheCandidate[]>>>(new Map());
  const ocrPreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const ocrPreviewSearchHeaderRef = useRef<HTMLDivElement | null>(null);
  const ocrPreviewLineRefs = useRef<Map<number, HTMLParagraphElement>>(new Map());
  // Tracks page+engine combos that were explicitly cleared by the user.
  // Alias probing is blocked for these keys until the file/pipeline resets.
  const clearedCacheKeysRef = useRef<Set<string>>(new Set());
  const [engineWarmStates, setEngineWarmStates] = useState<Record<string, EngineWarmState>>(() => ({ ...SESSION_ENGINE_WARM_STATES }));
  const pendingEngineSelectionRef = useRef<OCREngine | null>(null);
  const warmAnimationTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const externalProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const benchmarkAbortRef = useRef<AbortController | null>(null);
  const translationContextKeyRef = useRef<string>('');
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkTargetPage, setBenchmarkTargetPage] = useState<number | null>(null);
  const [cacheActionMessage, setCacheActionMessage] = useState<string>('');
  const [ocrInfoOpen, setOcrInfoOpen] = useState(false);
  const [isModelSectionOpen, setIsModelSectionOpen] = useState<boolean>(() =>
    readPersistedSectionOpen(OCR_MODEL_SECTION_OPEN_STORAGE_KEY, true)
  );
  const [copyFeedback, setCopyFeedback] = useState<'idle' | 'copied'>('idle');
  const [ocrPreviewSearchActiveIndex, setOcrPreviewSearchActiveIndex] = useState<number>(0);
  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>(() =>
    OCR_ENGINES.map((engine) => ({
      engine: engine.id,
      engineName: engine.name,
      status: 'idle',
      cacheHit: false,
      runtimeMs: null,
      confidence: null,
      compositeScore: null,
      wordCount: 0,
      lineCount: 0,
      suspiciousCount: 0,
      suspiciousRatio: 0,
      droppedCount: 0,
      message: '',
    }))
  );

  const isAbortError = useCallback(
    (error: unknown): boolean => error instanceof Error && error.name === 'AbortError',
    []
  );

  const shouldRecoverExternalEngine = useCallback((error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
      message.includes('daemon') ||
      message.includes('stdin is unavailable') ||
      message.includes('bridge is unavailable') ||
      message.includes('service terminated') ||
      message.includes('exited') ||
      message.includes('signal=sigterm') ||
      message.includes('external ocr canceled')
    );
  }, []);

  useEffect(() => {
    return () => {
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
      pdfLoadingRef.current = null;
      fileRef.current = null;
      pdfDataRef.current = null;
      abortControllerRef.current = null;
      for (const timer of warmAnimationTimersRef.current.values()) {
        clearInterval(timer);
      }
      warmAnimationTimersRef.current.clear();
      if (externalProgressTimerRef.current) {
        clearInterval(externalProgressTimerRef.current);
        externalProgressTimerRef.current = null;
      }
      benchmarkAbortRef.current?.abort();
      benchmarkAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    persistSectionOpen(OCR_MODEL_SECTION_OPEN_STORAGE_KEY, isModelSectionOpen);
  }, [isModelSectionOpen]);

  const setEngineWarmState = useCallback((engine: string, patch: Partial<EngineWarmState>) => {
    setEngineWarmStates((current) => {
      const previous = current[engine] || SESSION_ENGINE_WARM_STATES[engine] || { phase: 'idle' as EngineWarmPhase, progress: 0 };
      const nextState = Object.assign(
        { phase: 'idle' as EngineWarmPhase, progress: 0 },
        previous,
        patch
      );
      if (
        (nextState.phase === 'checking' || nextState.phase === 'warming')
        && (previous.phase === 'checking' || previous.phase === 'warming')
      ) {
        nextState.progress = Math.max(previous.progress || 0, nextState.progress || 0);
      }
      SESSION_ENGINE_WARM_STATES[engine] = nextState;
      return {
        ...current,
        [engine]: nextState,
      };
    });
  }, []);

  const stopWarmAnimation = useCallback((engine?: OCREngine) => {
    if (engine) {
      const timer = warmAnimationTimersRef.current.get(engine);
      if (timer) {
        clearInterval(timer);
        warmAnimationTimersRef.current.delete(engine);
      }
      return;
    }

    for (const timer of warmAnimationTimersRef.current.values()) {
      clearInterval(timer);
    }
    warmAnimationTimersRef.current.clear();
  }, []);

  const refreshExternalEngineStatuses = useCallback(async () => {
    if (statusRefreshInFlightRef.current) {
      return await statusRefreshInFlightRef.current;
    }

    const run = (async () => {
      setEngineWarmState('tesseract', {
        phase: 'ready',
        progress: 100,
        runtime: 'Built-in WASM',
        description: 'Current in-app OCR engine running the best-quality pipeline by default.',
        etaSec: 0,
        languageKey: normalizedWarmLanguage,
      });

      for (const engine of OCR_ENGINES) {
        if (engine.id === 'tesseract') continue;

        const sessionKey = getEngineWarmSessionKey(engine.id, normalizedWarmLanguage);
        const currentState = SESSION_ENGINE_WARM_STATES[engine.id];
        const isReadyForCurrentLanguage = SESSION_ENGINE_READY_KEYS.has(sessionKey)
          || (currentState?.phase === 'ready' && currentState.languageKey === normalizedWarmLanguage);

        if (isReadyForCurrentLanguage) {
          setEngineWarmState(engine.id, {
            phase: 'ready',
            progress: 100,
            runtime: currentState?.runtime || engine.runtime,
            description: currentState?.description || engine.description,
            etaSec: 0,
            languageKey: normalizedWarmLanguage,
          });
          continue;
        }

        if (currentState?.phase === 'warming' || currentState?.phase === 'checking') {
          setEngineWarmState(engine.id, {
            ...currentState,
            languageKey: normalizedWarmLanguage,
          });
          continue;
        }

        setEngineWarmState(engine.id, {
          phase: 'idle',
          progress: 0,
          runtime: engine.runtime,
          description: 'Click to check and warm this model',
          etaSec: null,
          languageKey: normalizedWarmLanguage,
        });
      }
    })();

    statusRefreshInFlightRef.current = run;
    try {
      await run;
    } finally {
      statusRefreshInFlightRef.current = null;
    }
  }, [normalizedWarmLanguage, setEngineWarmState]);

  const resetEngineWarmSession = useCallback((engine: OCREngine, description?: string) => {
    stopWarmAnimation(engine);
    for (const key of Array.from(SESSION_ENGINE_WARM_PROMISES.keys())) {
      if (key.startsWith(`${engine}:`)) {
        SESSION_ENGINE_WARM_PROMISES.delete(key);
      }
    }
    for (const key of Array.from(SESSION_ENGINE_READY_KEYS.values())) {
      if (key.startsWith(`${engine}:`)) {
        SESSION_ENGINE_READY_KEYS.delete(key);
      }
    }
    for (const key of Array.from(SESSION_PREWARM_REQUESTED.values())) {
      if (key.startsWith(`${engine}:`)) {
        SESSION_PREWARM_REQUESTED.delete(key);
      }
    }

    const runtime = OCR_ENGINES.find((candidate) => candidate.id === engine)?.runtime;
    setEngineWarmState(engine, {
      phase: 'idle',
      progress: 0,
      runtime,
      description: description || 'Click to check and warm this model',
      etaSec: null,
      languageKey: normalizedWarmLanguage,
    });
  }, [normalizedWarmLanguage, setEngineWarmState, stopWarmAnimation]);

  const startWarmAnimation = useCallback((engine: OCREngine, phase: EngineWarmPhase) => {
    if (engine === 'tesseract') return;

    stopWarmAnimation(engine);
    const startedAt = Date.now();
    const expectedMs = phase === 'checking'
      ? 8000
      : engine === 'paddleocr'
        ? 45000
        : 22000;
    const phaseStart = phase === 'checking' ? 8 : 34;
    const phaseCap = phase === 'checking' ? 28 : 92;

    const tick = () => {
      const elapsedMs = Date.now() - startedAt;
      const ratio = Math.min(0.98, elapsedMs / expectedMs);
      const progress = Math.min(phaseCap, phaseStart + ((phaseCap - phaseStart) * ratio));
      const etaSec = Math.max(1, Math.ceil((expectedMs - elapsedMs) / 1000));
      const description = phase === 'checking'
        ? 'Checking local OCR runtime...'
        : engine === 'paddleocr'
          ? elapsedMs < 10000
            ? 'Preparing PaddleOCR runtime...'
            : elapsedMs < 28000
              ? 'Loading detection/recognition models...'
              : 'Warming PaddleOCR for selection...'
          : elapsedMs < 7000
            ? 'Preparing EasyOCR runtime...'
            : 'Loading EasyOCR reader...';

      setEngineWarmState(engine, {
        phase,
        progress,
        etaSec,
        description,
      });
    };

    tick();
    const timer = setInterval(tick, 500);
    warmAnimationTimersRef.current.set(engine, timer);
  }, [setEngineWarmState, stopWarmAnimation]);

  const ensureEngineReady = useCallback(async (
    engine: OCREngine,
    config?: { selectOnReady?: boolean }
  ) => {
    if (engine === 'tesseract') {
      pendingEngineSelectionRef.current = null;
      setOptions({ engine });
      return true;
    }

    const sessionKey = getEngineWarmSessionKey(engine, normalizedWarmLanguage);
    const currentState = SESSION_ENGINE_WARM_STATES[engine];
    const isReadyForCurrentSession = SESSION_ENGINE_READY_KEYS.has(sessionKey);
    const isReadyForCurrentLanguage =
      currentState?.phase === 'ready' && currentState.languageKey === normalizedWarmLanguage;

    if (isReadyForCurrentLanguage || isReadyForCurrentSession) {
      pendingEngineSelectionRef.current = null;
      if (!isReadyForCurrentLanguage) {
        setEngineWarmState(engine, {
          phase: 'ready',
          progress: 100,
          etaSec: 0,
          runtime: currentState?.runtime,
          description: currentState?.description,
          languageKey: normalizedWarmLanguage,
        });
      }
      if (config?.selectOnReady) {
        setOptions({ engine });
      }
      return true;
    }

    const inFlight = SESSION_ENGINE_WARM_PROMISES.get(sessionKey);
    if (inFlight) {
      if (config?.selectOnReady) {
        pendingEngineSelectionRef.current = engine;
      }
      return await inFlight;
    }

    if (!window.electronAPI?.ocr?.prewarmEngine) {
      setEngineWarmState(engine, {
        phase: 'error',
        progress: 0,
        description: 'External OCR bridge is unavailable in this runtime',
      });
      return false;
    }

    if (config?.selectOnReady) {
      pendingEngineSelectionRef.current = engine;
    }

    const warmPromise = (async () => {
      try {
        setEngineWarmState(engine, {
          phase: 'warming',
          progress: 18,
          description: engine === 'paddleocr'
            ? 'Preparing PaddleOCR runtime...'
            : 'Preparing EasyOCR runtime...',
          etaSec: engine === 'paddleocr' ? 45 : 22,
          languageKey: normalizedWarmLanguage,
        });
        startWarmAnimation(engine, 'warming');

        const warmed = await window.electronAPI.ocr.prewarmEngine({
          engine,
          language: normalizedWarmLanguage,
        });
        stopWarmAnimation(engine);
        setEngineWarmState(engine, {
          phase: 'ready',
          progress: 100,
          runtime: warmed.runtime,
          description: warmed.description,
          etaSec: 0,
          languageKey: normalizedWarmLanguage,
        });
        SESSION_ENGINE_READY_KEYS.add(sessionKey);

        if (pendingEngineSelectionRef.current === engine || config?.selectOnReady) {
          pendingEngineSelectionRef.current = null;
          setOptions({ engine });
        }
        return true;
      } catch (error) {
        stopWarmAnimation(engine);
        setEngineWarmState(engine, {
          phase: 'error',
          progress: 0,
          description: error instanceof Error ? error.message : String(error),
          etaSec: null,
          languageKey: normalizedWarmLanguage,
        });
        SESSION_ENGINE_READY_KEYS.delete(sessionKey);
        if (pendingEngineSelectionRef.current === engine) {
          pendingEngineSelectionRef.current = null;
        }
        return false;
      } finally {
        SESSION_ENGINE_WARM_PROMISES.delete(sessionKey);
      }
    })();

    SESSION_ENGINE_WARM_PROMISES.set(sessionKey, warmPromise);
    return await warmPromise;
  }, [normalizedWarmLanguage, setEngineWarmState, setOptions, startWarmAnimation, stopWarmAnimation]);

  useEffect(() => {
    void refreshExternalEngineStatuses();
  }, [refreshExternalEngineStatuses]);

  // External engines are warmed on-demand when selected or when OCR starts.
  // This keeps first-open latency lower on slower machines.
  useEffect(() => {
    if (!file) return undefined;
    const canWarmAfterOpen = fileType !== 'pdf' || totalPages > 0;
    if (!canWarmAfterOpen) return undefined;
    let disposed = false;

    const scheduleWarm = (engine: OCREngine, delayMs: number, useIdle: boolean) => {
      const timer = setTimeout(() => {
        if (disposed) return;
        if (isProcessing) return;
        const sessionKey = getEngineWarmSessionKey(engine, normalizedWarmLanguage);
        if (SESSION_ENGINE_READY_KEYS.has(sessionKey)) return;
        if (SESSION_PREWARM_REQUESTED.has(sessionKey)) return;
        SESSION_PREWARM_REQUESTED.add(sessionKey);

        const idleApi = (window as Window & {
          requestIdleCallback?: (callback: () => void, opts?: { timeout: number }) => number;
        }).requestIdleCallback;

        const runWarm = () => {
          if (disposed) return;
          if (isProcessing) return;
          void ensureEngineReady(engine, { selectOnReady: false });
        };

        if (typeof idleApi === 'function') {
          idleApi(runWarm, { timeout: useIdle ? 6500 : 3200 });
        } else {
          const fallback = setTimeout(runWarm, useIdle ? 900 : 300);
          if (disposed) {
            clearTimeout(fallback);
          }
        }
      }, delayMs);
      return timer;
    };

    // Warm after document is visibly ready. Keep open/render responsiveness first.
    const preferredEngine = options.engine === 'paddleocr' || options.engine === 'easyocr'
      ? options.engine
      : 'paddleocr';
    const secondaryEngine: OCREngine = preferredEngine === 'paddleocr' ? 'easyocr' : 'paddleocr';

    const preferredTimer = scheduleWarm(preferredEngine, 1900, true);
    const secondaryTimer = scheduleWarm(secondaryEngine, 6200, true);

    return () => {
      disposed = true;
      clearTimeout(preferredTimer);
      clearTimeout(secondaryTimer);
    };
  }, [ensureEngineReady, file, fileType, isProcessing, normalizedWarmLanguage, options.engine, totalPages]);

  const recoverExternalEngine = useCallback((engine: OCREngine, reason?: string) => {
    if (engine === 'tesseract') return;
    resetEngineWarmSession(engine, reason);
    const sessionKey = getEngineWarmSessionKey(engine, normalizedWarmLanguage);
    SESSION_PREWARM_REQUESTED.add(sessionKey);
    void ensureEngineReady(engine, { selectOnReady: false });
  }, [ensureEngineReady, normalizedWarmLanguage, resetEngineWarmSession]);

  const stopExternalProgress = useCallback(() => {
    if (externalProgressTimerRef.current) {
      clearInterval(externalProgressTimerRef.current);
      externalProgressTimerRef.current = null;
    }
  }, []);

  const startExternalProgress = useCallback((pageNum: number, engine: OCREngine, imageWidth?: number, imageHeight?: number) => {
    stopExternalProgress();
    const startedAt = Date.now();
    const warmState = SESSION_ENGINE_WARM_STATES[engine];
    const engineReadyForLanguage = (
      warmState?.phase === 'ready' && warmState.languageKey === normalizedWarmLanguage
    ) || SESSION_ENGINE_READY_KEYS.has(getEngineWarmSessionKey(engine, normalizedWarmLanguage));
    let expectedMs = engine === 'paddleocr'
      ? (engineReadyForLanguage ? 24000 : 52000)
      : (engineReadyForLanguage ? 12000 : 26000);

    if (
      engine === 'paddleocr'
      && activePipelineProfile === 'panel'
      && imageWidth
      && imageHeight
    ) {
      const longest = Math.max(imageWidth, imageHeight);
      const shortest = Math.max(1, Math.min(imageWidth, imageHeight));
      const aspectRatio = longest / shortest;
      const cjkLike = options.language
        .split('+')
        .map(code => code.trim())
        .filter(Boolean)
        .some(code => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));
      const koreanLike = options.language
        .split('+')
        .map(code => code.trim())
        .filter(Boolean)
        .includes('kor');
      const chunkLikely = koreanLike
        ? (imageHeight >= 6200 || aspectRatio >= 2.4)
        : (!cjkLike && (imageHeight >= 5200 || aspectRatio >= 2.3));
      if (chunkLikely) {
        const estimatedChunkHeight = Math.min(
          Math.max(2200, Math.round(imageWidth * 0.95)),
          Math.max(2200, Math.round(imageHeight * 0.34)),
        );
        const estimatedStride = Math.max(1, estimatedChunkHeight - 220);
        const estimatedChunks = Math.max(1, Math.ceil((imageHeight - 220) / estimatedStride));
        expectedMs = engineReadyForLanguage
          ? (9000 + (estimatedChunks * 8500))
          : (22000 + (estimatedChunks * 10000));
      } else {
        const pixelCount = Math.max(1, imageWidth * imageHeight);
        const basePixels = 5_200_000;
        const pixelScale = Math.min(4.5, Math.max(1, pixelCount / basePixels));
        const latencyFactor = 1 + ((pixelScale - 1) * 1.6);
        expectedMs = Math.round(expectedMs * latencyFactor);
      }
    }

    const tick = () => {
      const elapsedMs = Date.now() - startedAt;
      const warmupProgress = 18 + ((Math.min(elapsedMs, expectedMs) / expectedMs) * 72);
      const tailProgress = elapsedMs > expectedMs
        ? Math.min(98, 90 + (Math.log1p((elapsedMs - expectedMs) / 4000) * 2.6))
        : warmupProgress;
      const progressValue = Math.max(18, Math.min(98, tailProgress));
      const statusText = engine === 'paddleocr'
        ? !engineReadyForLanguage && elapsedMs < 11000
          ? 'Preparing PaddleOCR runtime...'
          : !engineReadyForLanguage && elapsedMs < 28000
            ? 'Loading PaddleOCR model...'
            : 'Running PaddleOCR...'
        : !engineReadyForLanguage && elapsedMs < 6000
          ? 'Preparing EasyOCR runtime...'
          : !engineReadyForLanguage && elapsedMs < 16000
            ? 'Loading EasyOCR reader...'
          : 'Running external OCR...';

      setProgress({
        stage: 'ocr',
        currentPage: pageNum,
        totalPages: 1,
        message: `OCR page ${pageNum}: ${statusText}`,
        progress: progressValue,
      });
    };

    tick();
    externalProgressTimerRef.current = setInterval(tick, 700);
  }, [activePipelineProfile, normalizedWarmLanguage, options.language, setProgress, stopExternalProgress]);

  const getPdfDoc = useCallback(async () => {
    if (!file) {
      throw new Error('No PDF loaded');
    }

    // If file changed, reset cached doc
    if (fileRef.current && fileRef.current !== file) {
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
      pdfLoadingRef.current = null;
      pdfDataRef.current = null;
    }

    fileRef.current = file;

    if (pdfDocRef.current) {
      return pdfDocRef.current;
    }

    if (pdfLoadingRef.current) {
      return pdfLoadingRef.current;
    }

    const loadingPromise = (async () => {
      const cached = pdfDataRef.current && pdfDataRef.current.byteLength > 0
        ? pdfDataRef.current
        : null;
      if (!cached) {
        pdfDataRef.current = null;
      }
      const data = cached ?? (() => {
        if (fileData) {
          return fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength);
        }
        return null;
      })() ?? await file.arrayBuffer();
      pdfDataRef.current = data as ArrayBuffer;
      const loadingTask = pdfjs.getDocument({ data: data as ArrayBuffer });
      const doc = await loadingTask.promise;
      pdfDocRef.current = doc;
      pdfLoadingRef.current = null;
      return doc;
    })();

    pdfLoadingRef.current = loadingPromise;
    return loadingPromise;
  }, [file, fileData]);

  const normalizeLanguage = useCallback((value: string): string => {
    return value
      .split('+')
      .map(v => v.trim())
      .filter(Boolean)
      .sort()
      .join('+');
  }, []);

  const normalizeCacheProfile = useCallback((cached: OCRPageResult): OCRPageResult => {
    const normalizedProfile = (cached.pipelineProfile || 'panel') === 'panel'
      ? cached
      : {
        ...cached,
        pipelineProfile: 'panel' as const,
      };
    const scriptGated = applyPanelLanguageScriptGate(normalizedProfile, options.language);
    return applyPanelSafetyLineDedup(scriptGated);
  }, [options.language]);

  const isCacheCompatible = useCallback((cached: OCRPageResult): boolean => {
    if (normalizeLanguage(cached.language) !== normalizeLanguage(options.language)) return false;
    if (cached.dpi !== options.dpi) return false;
    if (options.pageSegMode !== undefined && cached.pageSegMode !== options.pageSegMode) return false;
    if (cached.algorithmVersion !== OCR_ALGORITHM_VERSION) return false;
    if ((cached.ocrEngine || 'tesseract') !== (options.engine || 'tesseract')) return false;
    return true;
  }, [options, normalizeLanguage]);

  const isCacheCompatibleForEngine = useCallback((cached: OCRPageResult, engine: OCREngine): boolean => {
    if (normalizeLanguage(cached.language) !== normalizeLanguage(options.language)) return false;
    if (cached.dpi !== options.dpi) return false;
    if (options.pageSegMode !== undefined && cached.pageSegMode !== options.pageSegMode) return false;
    if (cached.algorithmVersion !== OCR_ALGORITHM_VERSION) return false;
    if ((cached.ocrEngine || 'tesseract') !== engine) return false;
    return true;
  }, [normalizeLanguage, options.dpi, options.language, options.pageSegMode]);

  // UI preview can show stale algorithm cache (marked as stale in badge) to avoid blank panel
  // while still requiring language match.
  const isDisplayCacheCompatible = useCallback((cached: OCRPageResult): boolean => {
    if (!cached || !Array.isArray(cached.words) || !Array.isArray(cached.lines)) return false;
    if (cached.words.length === 0 && cached.lines.length === 0 && !(cached.text || '').trim()) return false;
    if (normalizeLanguage(cached.language) !== normalizeLanguage(options.language)) return false;
    if ((cached.ocrEngine || 'tesseract') !== (options.engine || 'tesseract')) return false;
    return true;
  }, [normalizeLanguage, options.engine, options.language]);

  const getFilenameCandidates = useCallback(async (
    filename: string,
    options?: { excludeDocId?: number; requireCachePages?: boolean; limit?: number }
  ): Promise<DBDocumentCacheCandidate[]> => {
    const normalizedName = String(filename || '').trim().toLowerCase();
    if (!normalizedName) return [];

    const applyFilters = (rows: DBDocumentCacheCandidate[]): DBDocumentCacheCandidate[] => {
      const requireCachePages = options?.requireCachePages ?? false;
      const excluded = options?.excludeDocId;
      const filtered = rows.filter((candidate) => {
        if (typeof excluded === 'number' && candidate.id === excluded) return false;
        if (requireCachePages && (candidate.cache_pages ?? 0) <= 0) return false;
        return true;
      });
      if (typeof options?.limit === 'number' && options.limit > 0) {
        return filtered.slice(0, options.limit);
      }
      return filtered;
    };

    const cached = aliasCandidateCacheRef.current.get(normalizedName);
    if (cached) {
      return applyFilters(cached);
    }

    let inFlight = aliasCandidateInFlightRef.current.get(normalizedName);
    if (!inFlight) {
      inFlight = dbService.findDocumentsByFilename(filename)
        .then((rows) => (Array.isArray(rows) ? rows : []))
        .catch((error) => {
          console.warn(`[OCRPanel] Failed to load filename alias candidates for "${filename}":`, error);
          return [];
        });
      aliasCandidateInFlightRef.current.set(normalizedName, inFlight);
    }

    try {
      const rows = await inFlight;
      aliasCandidateCacheRef.current.set(normalizedName, rows);
      return applyFilters(rows);
    } finally {
      aliasCandidateInFlightRef.current.delete(normalizedName);
    }
  }, []);

  const loadCachedOCR = useCallback(async (
    pageNum: number,
    options?: { allowDuringSuspension?: boolean }
  ): Promise<boolean> => {
    if (suspendCacheReadsRef.current && !options?.allowDuringSuspension) {
      console.log(`[OCRPanel] Skipping passive cache load for page ${pageNum} while OCR job is active`);
      return false;
    }

    const activeEngine = (useOCRTextLayerStore.getState().options.engine || 'tesseract') as OCREngine;

    const requestKey = [
      file?.name || 'no-file',
      pageNum,
      normalizeLanguage(options?.allowDuringSuspension ? useOCRTextLayerStore.getState().options.language : useOCRTextLayerStore.getState().options.language),
      useOCRTextLayerStore.getState().options.dpi,
      activeEngine,
      useOCRTextLayerStore.getState().options.pageSegMode ?? 'default',
      activePipelineProfile,
      options?.allowDuringSuspension ? 'forced' : 'passive',
    ].join('|');

    const existingRequest = cacheLoadInFlightRef.current.get(requestKey);
    if (existingRequest) {
      return existingRequest;
    }

    const loadPromise = (async (): Promise<boolean> => {
      const activeFile = file;
      const state = useOCRTextLayerStore.getState();

      // If the user explicitly cleared cache for this page+engine, block ALL
      // DB reads (primary + alias) so the cache can't resurrect from any docId.
      // The user must re-run OCR to populate this slot again.
      const clearedKey = `${pageNum}:${activeEngine}`;
      if (clearedCacheKeysRef.current.has(clearedKey)) {
        console.log(
          `[OCRPanel] All cache reads blocked for page ${pageNum} engine=${activeEngine} (recently cleared)`
        );
        return false;
      }

      const memoryCachedByEngine = state.ocrByPageEngine.get(pageNum)?.get(activeEngine);
      if (memoryCachedByEngine && isDisplayCacheCompatible(memoryCachedByEngine)) {
        if (useProjectStore.getState().file !== activeFile) return false;
        setPageOCR(pageNum, normalizeCacheProfile(memoryCachedByEngine));
        return true;
      }

      const memoryCached = state.allPagesOCR.get(pageNum);
      if (memoryCached && isDisplayCacheCompatible(memoryCached)) {
        if (useProjectStore.getState().file !== activeFile) return false;
        setPageOCR(pageNum, normalizeCacheProfile(memoryCached));
        return true;
      }

      let cacheDocId: number | null = null;
      try {
        cacheDocId = await ensureDocumentId();
      } catch (error) {
        console.warn('[OCRPanel] Failed to ensure document ID for OCR cache:', error);
        return false;
      }
      if (!cacheDocId) return false;
      console.log(`[OCRPanel] Checking DB cache for page ${pageNum} (docId=${cacheDocId}, engine=${activeEngine})`);

      const cached = await dbService.getOCR(cacheDocId, pageNum, activeEngine);
      if (cached && isDisplayCacheCompatible(cached)) {
        if (useProjectStore.getState().file !== activeFile) return false;
        
        // Final sanity check: ensure the engine in the data matches what we asked for
        const dataEngine = (cached.ocrEngine || 'tesseract').toLowerCase();
        if (dataEngine !== activeEngine.toLowerCase()) {
          console.warn(`[OCRPanel] Cache engine mismatch: requested ${activeEngine}, got ${dataEngine}`);
          return false;
        }

        cached.pageNumber = pageNum;
        setPageOCR(pageNum, normalizeCacheProfile(cached));
        return true;
      }

      // Alias fallback: same filename can exist under multiple document_id values
      // (legacy source path vs imported hash path). If current doc misses, probe
      // OCR-backed candidates and switch doc binding once a hit is found.
      if (file?.name) {
        const aliasLookupStart = Date.now();
        const aliasCandidates = await getFilenameCandidates(file.name, {
          excludeDocId: cacheDocId,
          requireCachePages: true,
          limit: 8,
        });

        if (aliasCandidates.length > 0) {
          console.log(
            `[OCRPanel] Alias OCR probe candidates=${aliasCandidates.length} page=${pageNum} resolved in ${Date.now() - aliasLookupStart}ms`
          );

          const aliasProbeResults = await Promise.all(
            aliasCandidates.map(async (candidate) => ({
              candidate,
              aliasCached: await dbService.getOCR(candidate.id, pageNum, activeEngine).catch(() => null),
            }))
          );

          const matchedAlias = aliasProbeResults.find((probe) => (
            probe.aliasCached && isDisplayCacheCompatible(probe.aliasCached)
          ));

          if (matchedAlias?.aliasCached) {
            if (useProjectStore.getState().file !== activeFile) return false;

            matchedAlias.aliasCached.pageNumber = pageNum;
            setPageOCR(pageNum, normalizeCacheProfile(matchedAlias.aliasCached));

            const currentProject = useProjectStore.getState();
            if (currentProject.documentId !== matchedAlias.candidate.id) {
              useProjectStore.setState({
                documentId: matchedAlias.candidate.id,
                filePath: matchedAlias.candidate.filepath
              });
              autoSyncedDocRef.current = matchedAlias.candidate.id;
              console.log(
                `[OCRPanel] Switched OCR cache binding: docId=${cacheDocId} -> docId=${matchedAlias.candidate.id}`
              );
            }
            return true;
          }
        }

        // Even when this page misses, keep the OCR cache binding on the only
        // OCR-backed alias so future page checks don't stay pinned to an empty doc.
        if (aliasCandidates.length === 1) {
          const preferred = aliasCandidates[0];
          const currentProject = useProjectStore.getState();
          if (currentProject.documentId === cacheDocId) {
            useProjectStore.setState({
              documentId: preferred.id,
              filePath: preferred.filepath
            });
            autoSyncedDocRef.current = preferred.id;
            console.log(
              `[OCRPanel] Rebound OCR cache docId=${cacheDocId} -> ${preferred.id} (page ${pageNum} still uncached)`
            );
          }
        }
      }

      return false;
    })();

    cacheLoadInFlightRef.current.set(requestKey, loadPromise);
    try {
      return await loadPromise;
    } finally {
      cacheLoadInFlightRef.current.delete(requestKey);
    }
  }, [activePipelineProfile, ensureDocumentId, file, getFilenameCandidates, isCacheCompatible, isDisplayCacheCompatible, normalizeCacheProfile, setPageOCR]);

  const syncOptionsFromLatestCache = useCallback(async (): Promise<void> => {
    if (!file) return;
    let docId: number | null = null;
    try {
      docId = await ensureDocumentId();
    } catch {
      return;
    }
    if (!docId) return;
    if (autoSyncedDocRef.current === docId) return;

    const latest = await dbService.getLatestOCR(docId);
    autoSyncedDocRef.current = docId;
    if (!latest?.ocr_data) return;

    const latestOCR = latest.ocr_data;
    const latestLang = normalizeLanguage(latestOCR.language || 'eng');
    const currentLang = normalizeLanguage(options.language || 'eng');
    const nextPatch: Partial<typeof options> = {};

    if (latestLang && latestLang !== currentLang) {
      nextPatch.language = latestLang;
    }
    if (latestOCR.pageSegMode !== options.pageSegMode) {
      nextPatch.pageSegMode = latestOCR.pageSegMode;
    }
    if ((latestOCR.ocrEngine || 'tesseract') !== (options.engine || 'tesseract')) {
      nextPatch.engine = latestOCR.ocrEngine || 'tesseract';
    }

    if (Object.keys(nextPatch).length > 0) {
      setOptions(nextPatch);
    }
  }, [ensureDocumentId, file, normalizeLanguage, options.engine, options.language, options.pageSegMode, setOptions]);

  const beginAbortableJob = useCallback(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    return controller;
  }, []);

  const cancelCurrentJob = useCallback(() => {
    abortControllerRef.current?.abort();
    if (options.engine && options.engine !== 'tesseract') {
      void window.electronAPI?.ocr?.cancelExternal?.({ engine: options.engine }).catch(() => {
        // Best effort external OCR cancellation.
      });
      recoverExternalEngine(options.engine, `${options.engine} canceled - reloading model cache...`);
    }
    visionService.cancelAll('OCR job canceled');
  }, [options.engine, recoverExternalEngine]);

  useEffect(() => {
    if (!file) return;
    if (isProcessing) return;
    void loadCachedOCR(currentPage);
  }, [file, currentPage, options.language, options.dpi, options.engine, options.pageSegMode, activePipelineProfile, loadCachedOCR, isProcessing]);

  useEffect(() => {
    autoSyncedDocRef.current = null;
    persistedCacheRef.current.clear();
    persistedTranslationCacheRef.current.clear();
    aliasCandidateCacheRef.current.clear();
    aliasCandidateInFlightRef.current.clear();
    clearedCacheKeysRef.current.clear();
    clearAllOCR();
  }, [file, activePipelineProfile, clearAllOCR]);

  useEffect(() => {
    if (!file) return;
    // Only auto-sync options if we haven't done it for this doc session yet.
    // This prevents engine/language choices from bouncing back after being changed.
    if (autoSyncedDocRef.current) return;
    void syncOptionsFromLatestCache();
  }, [file, syncOptionsFromLatestCache]);

  useEffect(() => {
    if (!file) return;
    let canceled = false;

    void (async () => {
      const docId = await ensureDocumentId().catch(() => null);
      if (!docId || canceled) return;

      let cacheOwnerDocId = docId;
      let rows = await dbService.getTranslationCachePage(docId, currentPage);

      if ((!rows || rows.length === 0) && file?.name) {
        const aliasLookupStart = Date.now();
        const aliasCandidates = await getFilenameCandidates(file.name, {
          excludeDocId: docId,
          requireCachePages: true,
          limit: 8,
        });

        if (aliasCandidates.length > 0) {
          console.log(
            `[OCRPanel] Alias translation probe candidates=${aliasCandidates.length} page=${currentPage} resolved in ${Date.now() - aliasLookupStart}ms`
          );

          const aliasRowsByCandidate = await Promise.all(
            aliasCandidates.map(async (candidate) => ({
              candidate,
              rows: await dbService.getTranslationCachePage(candidate.id, currentPage).catch(() => []),
            }))
          );

          const matched = aliasRowsByCandidate.find((item) => Array.isArray(item.rows) && item.rows.length > 0);
          if (matched) {
            rows = matched.rows;
            cacheOwnerDocId = matched.candidate.id;
          }
        }
      }

      if (canceled || rows.length === 0) return;

      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (canceled) return;
        const row = rows[i];
        const normalizedEntry: OCRTranslationCacheEntry = {
          ...row,
          pageNum: currentPage,
          ocrEngine: (row.ocrEngine || 'tesseract') as OCREngine,
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

        const existing = useOCRTextLayerStore
          .getState()
          .getTranslationCacheEntry(currentPage, normalizedEntry.key);

        if (existing && existing.createdAt >= normalizedEntry.createdAt) {
          persistedTranslationCacheRef.current.set(
            `${cacheOwnerDocId}:${currentPage}:${normalizedEntry.key}`,
            buildTranslationCacheSignature(existing)
          );
          continue;
        }

        setTranslationCacheEntry(currentPage, normalizedEntry.key, normalizedEntry);
        persistedTranslationCacheRef.current.set(
          `${cacheOwnerDocId}:${currentPage}:${normalizedEntry.key}`,
          buildTranslationCacheSignature(normalizedEntry)
        );
      }
    })();

    return () => {
      canceled = true;
    };
  }, [currentPage, ensureDocumentId, file, getFilenameCandidates, setTranslationCacheEntry]);

  useEffect(() => {
    if (!file || translationCacheByPage.size === 0) return;
    let canceled = false;

    void (async () => {
      const docId = await ensureDocumentId().catch(() => null);
      if (!docId || canceled) return;

      for (const [pageNum, pageMap] of translationCacheByPage.entries()) {
        if (canceled) return;
        for (const [cacheKey, entry] of pageMap.entries()) {
          if (canceled) return;
          const signature = buildTranslationCacheSignature(entry);
          const persistKey = `${docId}:${pageNum}:${cacheKey}`;
          if (persistedTranslationCacheRef.current.get(persistKey) === signature) {
            continue;
          }

          const saved = await dbService.saveTranslationCache(docId, pageNum, cacheKey, entry);
          if (saved) {
            persistedTranslationCacheRef.current.set(persistKey, signature);
          }
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [translationCacheByPage, ensureDocumentId, file]);

  // Self-healing persistence: if OCR results exist in memory, ensure they are flushed to DB.
  useEffect(() => {
    if (!file || allPagesOCR.size === 0) return;
    let canceled = false;
    void (async () => {
      const docId = await ensureDocumentId();
      if (!docId || canceled) return;

      for (const [pageNum, result] of allPagesOCR.entries()) {
        if (canceled) return;
        const activeEngine = result.ocrEngine || 'tesseract';

        // Don't re-persist data for page+engine combos the user explicitly cleared.
        // Otherwise self-healing would immediately undo the clear.
        const clearedKey = `${pageNum}:${activeEngine}`;
        if (clearedCacheKeysRef.current.has(clearedKey)) continue;

        const fp = `${result.algorithmVersion}|${result.dpi}|${result.pipelineProfile || 'panel'}|${activeEngine}|${normalizeLanguage(result.language)}|${result.words.length}|${result.text.length}`;
        const key = `${docId}:${pageNum}:${activeEngine}`;
        if (persistedCacheRef.current.get(key) === fp) continue;

        const saved = await dbService.saveOCR(docId, pageNum, result, activeEngine);
        if (saved) {
          persistedCacheRef.current.set(key, fp);
          // 🚀 Stability: once successfully saved, this page+engine combo is no longer 
          // considered "cleared", allowing the UI to read it normally again.
          if (clearedCacheKeysRef.current.has(clearedKey)) {
            clearedCacheKeysRef.current.delete(clearedKey);
          }
        }
      }
    })();

    return () => {
      canceled = true;
    };
  }, [allPagesOCR, ensureDocumentId, file, normalizeLanguage]);

  // Get current page OCR result
  const currentPageOCR = allPagesOCR.get(currentPage);
  const currentPageTranslationMap = translationCacheByPage.get(currentPage);
  const currentPageTranslationEntries = currentPageTranslationMap
    ? Array.from(currentPageTranslationMap.values()).sort((a, b) => b.createdAt - a.createdAt)
    : [];
  const selectedOcrEngine = (options.engine || 'tesseract') as OCREngine;
  const selectedEngineWarmState = selectedOcrEngine === 'tesseract'
    ? {
        phase: 'ready' as EngineWarmPhase,
        progress: 100,
        description: 'Tesseract is ready',
      }
    : (engineWarmStates[selectedOcrEngine] || {
      phase: 'idle' as EngineWarmPhase,
      progress: 0,
      description: 'Selected engine is not warmed yet',
    });
  const selectedEngineWarming = selectedOcrEngine !== 'tesseract'
    && (selectedEngineWarmState.phase === 'checking' || selectedEngineWarmState.phase === 'warming');
  const ocrActionDisabled = isProcessing || !file;
  const modelScopedOriginalOCR = ocrByPageEngine.get(currentPage)?.get(selectedOcrEngine) || currentPageOCR;
  const modelScopedFingerprint = modelScopedOriginalOCR
    ? buildOCRSourceFingerprint(modelScopedOriginalOCR, selectedOcrEngine)
    : '';
  const translationContextOCRLanguage = modelScopedOriginalOCR?.language || options.language || 'eng';
  const normalizedContextOCRLanguage = normalizeCacheLanguageKey(translationContextOCRLanguage);
  const normalizedContextSourceLanguage = resolveTranslationSourceFromOCRKey(
    translationContextOCRLanguage,
    normalizeTranslationLanguageKey(sourceLanguage || '', 'en')
  );
  const normalizedContextTargetLanguage = normalizeTranslationLanguageKey(targetLanguage || '', 'th');
  const activeTranslationKey = activeTranslationKeyByPage.get(currentPage);
  const activeTranslationEntry = activeTranslationKey && currentPageTranslationMap?.has(activeTranslationKey)
    ? currentPageTranslationMap.get(activeTranslationKey)
    : currentPageTranslationEntries[0];

  const matchesTranslationEntryContext = (entry: OCRTranslationCacheEntry): boolean => {
    if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
    if (entry.ocrEngine !== selectedOcrEngine) return false;
    if (entry.translationMode !== translationMode) return false;

    const normalizedEntrySource = normalizeTranslationLanguageKey(entry.sourceLanguage || '', 'en');
    const sourceMatches = normalizedEntrySource === normalizedContextSourceLanguage;
    if (!sourceMatches) {
      const sameSnapshot = modelScopedFingerprint && entry.sourceFingerprint === modelScopedFingerprint;
      const latinSourceDrift = Boolean(
        sameSnapshot
        && ['en', 'es'].includes(normalizedEntrySource)
        && ['en', 'es'].includes(normalizedContextSourceLanguage)
      );
      if (!latinSourceDrift) return false;
    }

    if (normalizeTranslationLanguageKey(entry.targetLanguage || '', 'th') !== normalizedContextTargetLanguage) return false;

    const normalizedEntryLanguage = normalizeCacheLanguageKey(entry.ocrLanguage);
    if (normalizedEntryLanguage === normalizedContextOCRLanguage) return true;

    // Language option can drift across sessions; fingerprint is the deterministic truth.
    if (modelScopedFingerprint && entry.sourceFingerprint === modelScopedFingerprint) return true;
    return false;
  };

  const activeTranslationEntryMatchesContext = Boolean(
    activeTranslationEntry
    && matchesTranslationEntryContext(activeTranslationEntry)
  );
  const preferredEntryForCurrentModel = currentPageTranslationEntries.find((entry) => matchesTranslationEntryContext(entry));
  const resolvedTranslationEntry = activeTranslationEntryMatchesContext
    ? activeTranslationEntry
    : preferredEntryForCurrentModel;
  const previewSourceOCR = translationPreviewMode === 'translated'
    ? (resolvedTranslationEntry
      ? (ocrByPageEngine.get(currentPage)?.get(resolvedTranslationEntry.ocrEngine) || modelScopedOriginalOCR)
      : modelScopedOriginalOCR)
    : modelScopedOriginalOCR;

  useEffect(() => {
    if (!currentPageTranslationMap || currentPageTranslationMap.size === 0) {
      if (activeTranslationKey) {
        setActiveTranslationCacheKey(currentPage, null);
      }
      return;
    }
    if (activeTranslationKey && currentPageTranslationMap.has(activeTranslationKey)) {
      return;
    }
    const newest = currentPageTranslationEntries[0];
    if (newest) {
      setActiveTranslationCacheKey(currentPage, newest.key);
    }
  }, [
    activeTranslationKey,
    currentPage,
    currentPageTranslationEntries,
    currentPageTranslationMap,
    setActiveTranslationCacheKey,
  ]);

  useEffect(() => {
    const nextPreferred = preferredEntryForCurrentModel;
    if (!nextPreferred) return;
    if (activeTranslationKey === nextPreferred.key) return;
    if (activeTranslationEntryMatchesContext) return;
    setActiveTranslationCacheKey(currentPage, nextPreferred.key);
  }, [
    activeTranslationEntryMatchesContext,
    activeTranslationKey,
    currentPage,
    preferredEntryForCurrentModel,
    setActiveTranslationCacheKey,
  ]);

  useEffect(() => {
    const contextKey = [
      currentPage,
      selectedOcrEngine,
      normalizedContextOCRLanguage,
      translationMode,
      normalizedContextSourceLanguage,
      normalizedContextTargetLanguage,
    ].join('|');

    if (translationContextKeyRef.current === contextKey) return;
    translationContextKeyRef.current = contextKey;

    const nextPreferred = preferredEntryForCurrentModel;
    if (nextPreferred) {
      setActiveTranslationCacheKey(currentPage, nextPreferred.key);
      setTranslationPreviewMode('translated');
      return;
    }

    setTranslationPreviewMode('original');
  }, [
    currentPage,
    normalizedContextOCRLanguage,
    normalizedContextSourceLanguage,
    normalizedContextTargetLanguage,
    selectedOcrEngine,
    preferredEntryForCurrentModel,
    setActiveTranslationCacheKey,
    setTranslationPreviewMode,
    translationMode,
  ]);

  const currentOcrFingerprint = previewSourceOCR
    ? buildOCRSourceFingerprint(previewSourceOCR, (options.engine || 'tesseract') as OCREngine)
    : '';
  const activeTranslationMatchesCurrentOCR = Boolean(
    resolvedTranslationEntry
    && currentOcrFingerprint
    && resolvedTranslationEntry.sourceFingerprint === currentOcrFingerprint
  );
  const effectivePreviewMode = (
    translationPreviewMode === 'translated'
    && Boolean(resolvedTranslationEntry)
    && activeTranslationMatchesCurrentOCR
  )
    ? 'translated'
    : 'original';

  const translatedByIndexMap = resolvedTranslationEntry
    ? new Map(resolvedTranslationEntry.translatedByIndex.map((item) => [item.index, item.text]))
    : new Map<number, string>();

  const previewLines = previewSourceOCR?.lines?.length
    ? previewSourceOCR.lines.map((line, index) => {
      if (effectivePreviewMode !== 'translated') return line;
      const translated = translatedByIndexMap.get(index);
      if (!translated) return line;
      return { ...line, text: translated };
    })
    : [];
  const previewWordsLength = previewSourceOCR?.words?.length || 0;
  const previewText = previewLines.length > 0
    ? previewLines.map((line) => line.text).join('\n').trim()
    : effectivePreviewMode === 'translated'
      ? normalizePreviewText(resolvedTranslationEntry?.translatedText || '')
      : normalizePreviewText(previewSourceOCR?.text || '');
  const previewCopyText = previewText || previewSourceOCR?.words.map((word) => word.text).join(' ') || '';
  const hasPreviewCopyText = Boolean(previewCopyText.trim());
  const normalizedPreviewSearch = normalizePreviewText(ocrResultSearchQuery);
  const previewSearchPattern = buildTextSearchPattern(normalizedPreviewSearch);
  const previewMatchedLineIndexes = previewSearchPattern
    ? previewLines
      .map((line, lineIndex) => ({
        lineIndex,
        text: normalizePreviewText(String(line.text || '')),
      }))
      .filter((entry) => hasTextSearchMatch(entry.text, previewSearchPattern))
      .map((entry) => entry.lineIndex)
    : [];
  const previewMatchedLineIndexSet = new Set<number>(previewMatchedLineIndexes);
  const previewSearchMatchCount = previewSearchPattern
    ? collectTextSearchMatches(previewText, previewSearchPattern).length
    : 0;
  const hasPreviewSearchMatches = previewMatchedLineIndexes.length > 0;
  const activePreviewMatchLineIndex = hasPreviewSearchMatches
    ? previewMatchedLineIndexes[Math.min(ocrPreviewSearchActiveIndex, previewMatchedLineIndexes.length - 1)]
    : -1;

  const handleCopyPreviewText = useCallback(async () => {
    if (!hasPreviewCopyText) {
      setCacheActionMessage('No OCR text to copy');
      return;
    }

    const copied = await copyTextToClipboard(previewCopyText);
    if (!copied) {
      setCacheActionMessage('Copy failed');
      return;
    }

    setCopyFeedback('copied');
    setCacheActionMessage(
      effectivePreviewMode === 'translated'
        ? 'Copied translated result'
        : 'Copied OCR result'
    );
  }, [effectivePreviewMode, hasPreviewCopyText, previewCopyText]);

  const handlePreviewSearchStep = useCallback((direction: -1 | 1) => {
    if (!normalizedPreviewSearch) return;
    if (previewMatchedLineIndexes.length === 0) {
      setCacheActionMessage('No match in OCR result');
      return;
    }

    setOcrPreviewSearchActiveIndex((current) => {
      const total = previewMatchedLineIndexes.length;
      if (total <= 1) return 0;
      return (current + direction + total) % total;
    });
  }, [normalizedPreviewSearch, previewMatchedLineIndexes.length]);

  const hasCjkOrThaiOcrLanguage = useCallback((language: string) => {
    const codes = language.split('+').map(code => code.trim()).filter(Boolean);
    return codes.some(code => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));
  }, []);

  const hasKoreanOcrLanguage = useCallback((language: string) => {
    const codes = language.split('+').map(code => code.trim()).filter(Boolean);
    return codes.includes('kor');
  }, []);

  type TallPageBoost = {
    minAspectRatio: number;
    minLongSide: number;
    boostedMaxSide: number;
    boostedMaxPixels: number;
  };

  type RenderConstraints = {
    maxSide?: number | null;
    maxPixels?: number | null;
    minWidth?: number | null;
    tallPageBoost?: TallPageBoost | null;
  };

  const resolveRenderConstraints = useCallback((engine?: string): RenderConstraints => {
    const cjkPanelExternal = activePipelineProfile === 'panel'
      && engine !== 'tesseract'
      && hasCjkOrThaiOcrLanguage(options.language);
    const koreanPaddlePanel = activePipelineProfile === 'panel'
      && engine === 'paddleocr'
      && hasKoreanOcrLanguage(options.language);

    // PaddleOCR: let the detector work on a moderate panel render budget.
    // The Python bridge already applies profile-aware det limits, so sending
    // 16-30MP renders here mostly burns renderer/pdf.js time without improving recall.
    if (engine === 'paddleocr') {
      if (koreanPaddlePanel) {
        return {
          maxSide: 16000,
          maxPixels: 22_000_000,
          minWidth: null,
          tallPageBoost: {
            minAspectRatio: 2.35,
            minLongSide: 9000,
            boostedMaxSide: 20000,
            boostedMaxPixels: 34_000_000,
          },
        };
      }
      if (cjkPanelExternal) {
        return {
          maxSide: 16000,
          maxPixels: 14_000_000,
          minWidth: null,
          tallPageBoost: {
            minAspectRatio: 2.35,
            minLongSide: 9000,
            boostedMaxSide: 20000,
            boostedMaxPixels: 28_000_000,
          },
        };
      }
      // Keep document-like pages close to native render size to improve bbox recall/coverage.
      return {
        maxSide: 16000,
        maxPixels: 8_400_000,
        minWidth: null,
        tallPageBoost: {
          minAspectRatio: 2.35,
          minLongSide: 9000,
          boostedMaxSide: 18000,
          boostedMaxPixels: 11_200_000,
        },
      };
    }
    // EasyOCR: moderate minWidth (650px) for readable text
    if (engine === 'easyocr') {
      if (cjkPanelExternal) {
        return {
          maxSide: 16000,
          maxPixels: 18_000_000,
          minWidth: null,
          tallPageBoost: {
            minAspectRatio: 2.35,
            minLongSide: 9000,
            boostedMaxSide: 19000,
            boostedMaxPixels: 24_000_000,
          },
        };
      }
      return { maxSide: 16000, maxPixels: 4_200_000, minWidth: 650 };
    }
    // Tesseract: highest minWidth (800px) but lower pixel budget for manga panels
    // to reduce ghost text from artwork textures and speed up processing.
    if (engine === 'tesseract') {
      return { maxSide: 16000, maxPixels: 2_800_000, minWidth: 800 };
    }
    return { maxSide: null, maxPixels: null, minWidth: null };
  }, [EXTERNAL_OCR_CJK_PANEL_MAX_PIXELS, EXTERNAL_OCR_CJK_PANEL_MAX_SIDE, EXTERNAL_OCR_RENDER_MAX_SIDE, activePipelineProfile, hasCjkOrThaiOcrLanguage, hasKoreanOcrLanguage, options.language]);

  const fitDimensionsToConstraints = useCallback((
    width: number,
    height: number,
    constraints?: RenderConstraints
  ) => {
    const maxSide = constraints?.maxSide ?? null;
    const maxPixels = constraints?.maxPixels ?? null;
    const minWidth = constraints?.minWidth ?? null;
    const tallPageBoost = constraints?.tallPageBoost ?? null;
    let effectiveMaxSide = maxSide;
    let effectiveMaxPixels = maxPixels;
    let appliedTallPageBoost = false;

    if (tallPageBoost) {
      const longSide = Math.max(width, height);
      const shortSide = Math.max(1, Math.min(width, height));
      const aspectRatio = longSide / shortSide;
      const qualifiesTallPage = longSide >= Math.max(1, tallPageBoost.minLongSide)
        && aspectRatio >= Math.max(1, tallPageBoost.minAspectRatio);
      if (qualifiesTallPage) {
        appliedTallPageBoost = true;
        if (tallPageBoost.boostedMaxSide > 0) {
          effectiveMaxSide = Math.max(effectiveMaxSide || 0, tallPageBoost.boostedMaxSide);
        }
        if (tallPageBoost.boostedMaxPixels > 0) {
          effectiveMaxPixels = Math.max(effectiveMaxPixels || 0, tallPageBoost.boostedMaxPixels);
        }
      }
    }

    let scaleFactor = 1;

    if (effectiveMaxSide && effectiveMaxSide > 0) {
      const longestSide = Math.max(width, height);
      if (longestSide > effectiveMaxSide) {
        scaleFactor = Math.min(scaleFactor, effectiveMaxSide / longestSide);
      }
    }

    if (effectiveMaxPixels && effectiveMaxPixels > 0) {
      const pixelCount = width * height;
      if (pixelCount > effectiveMaxPixels) {
        scaleFactor = Math.min(scaleFactor, Math.sqrt(effectiveMaxPixels / pixelCount));
      }
    }

    // Engine-specific minimum width guarantee for tall webtoon pages.
    // Only applies when the engine explicitly requests it (Tesseract=800, EasyOCR=650).
    // PaddleOCR sets minWidth=null so pixel budget controls everything → stays fast.
    if (minWidth && minWidth > 0 && scaleFactor < 1 && width * scaleFactor < minWidth && width > minWidth) {
      scaleFactor = minWidth / width;
    }

    if (scaleFactor >= 1) {
      return { width, height, scaleFactor: 1, appliedTallPageBoost };
    }

    return {
      width: Math.max(1, Math.floor(width * scaleFactor)),
      height: Math.max(1, Math.floor(height * scaleFactor)),
      scaleFactor,
      appliedTallPageBoost,
    };
  }, []);

  /**
   * Render PDF page to canvas at specified DPI
   * 
   * Strategy:
   * 1) Render directly with pdf.js at target DPI (best OCR accuracy)
   * 2) Fallback to existing react-pdf canvas if pdf.js render fails
   */
  const renderImageToCanvas = useCallback(async (renderOptions?: RenderConstraints) => {
    if (!file) throw new Error('No image loaded');
    const imageBlob = fileData
      ? new Blob([fileData as unknown as BlobPart], { type: file.type || 'image/png' })
      : file;

    const imageBitmap = await createImageBitmap(imageBlob);
    const fitted = fitDimensionsToConstraints(imageBitmap.width, imageBitmap.height, renderOptions);
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = fitted.width;
    outputCanvas.height = fitted.height;
    const ctx = outputCanvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Cannot get canvas context');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(imageBitmap, 0, 0, outputCanvas.width, outputCanvas.height);
    imageBitmap.close?.();
    return {
      canvas: outputCanvas,
      width: outputCanvas.width,
      height: outputCanvas.height
    };
  }, [file, fileData, fitDimensionsToConstraints]);

  const renderPageToCanvas = useCallback(async (
    pageNum: number,
    targetDpi: number,
    renderOptions?: RenderConstraints & { allowNavigationFallback?: boolean }
  ) => {
    if (!file) throw new Error('No PDF loaded');
    if (fileType !== 'pdf') {
      return renderImageToCanvas(renderOptions);
    }

    const renderFromExistingCanvas = async () => {
      const existingCanvas = document.querySelector(
        `.react-pdf__Page[data-page-number="${pageNum}"] canvas`
      ) as HTMLCanvasElement | null;

      if (existingCanvas && existingCanvas.width > 0 && existingCanvas.height > 0) {
        const currentWidth = existingCanvas.width;
        const currentHeight = existingCanvas.height;
        const estimatedCurrentDpi = Math.round((currentWidth / 595) * 72);
        const scaleFactor = Math.max(1, Math.min(targetDpi / Math.max(estimatedCurrentDpi, 72), 3.0));

        const scaledWidth = Math.round(currentWidth * scaleFactor);
        const scaledHeight = Math.round(currentHeight * scaleFactor);
        const fitted = fitDimensionsToConstraints(scaledWidth, scaledHeight, renderOptions);

        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = fitted.width;
        outputCanvas.height = fitted.height;
        const ctx = outputCanvas.getContext('2d');

        if (!ctx) throw new Error('Cannot get canvas context');

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(existingCanvas, 0, 0, outputCanvas.width, outputCanvas.height);

        return {
          canvas: outputCanvas,
          width: outputCanvas.width,
          height: outputCanvas.height
        };
      }

      if (!renderOptions?.allowNavigationFallback) {
        throw new Error(`No rendered canvas available for page ${pageNum}`);
      }

      // Navigate to the page and wait for canvas to appear (legacy fallback)
      console.log(`[OCRPanel] Navigating to page ${pageNum} and waiting for canvas...`);

      const { setPage } = useProjectStore.getState();
      const previousPage = useProjectStore.getState().currentPage;

      setPage(pageNum, { persist: false });

      const startTime = Date.now();
      const maxWaitTime = 10000;

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 500));

        const newCanvas = document.querySelector(
          `.react-pdf__Page[data-page-number="${pageNum}"] canvas`
        ) as HTMLCanvasElement | null;

        if (newCanvas && newCanvas.width > 0 && newCanvas.height > 0) {
          console.log(`[OCRPanel] Canvas appeared for page ${pageNum}: ${newCanvas.width}x${newCanvas.height}`);

          const currentWidth = newCanvas.width;
          const currentHeight = newCanvas.height;
          const estimatedCurrentDpi = Math.round((currentWidth / 595) * 72);
          const scaleFactor = targetDpi / Math.max(estimatedCurrentDpi, 72);

          const scaledWidth = Math.round(currentWidth * scaleFactor);
          const scaledHeight = Math.round(currentHeight * scaleFactor);
          const fitted = fitDimensionsToConstraints(scaledWidth, scaledHeight, renderOptions);

          const outputCanvas = document.createElement('canvas');
          outputCanvas.width = fitted.width;
          outputCanvas.height = fitted.height;
          const ctx = outputCanvas.getContext('2d');

          if (!ctx) throw new Error('Cannot get canvas context');

          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(newCanvas, 0, 0, outputCanvas.width, outputCanvas.height);

          return {
            canvas: outputCanvas,
            width: outputCanvas.width,
            height: outputCanvas.height
          };
        }
      }

      setPage(previousPage, { persist: false });
      throw new Error(`Timeout waiting for page ${pageNum} canvas to render`);
    };

    try {
      console.log(`[OCRPanel] Direct pdf.js render start for page ${pageNum} @ ${targetDpi} DPI`);
      const pdfDoc = await getPdfDoc();
      const page = await pdfDoc.getPage(pageNum);
      const requestedScale = targetDpi / 72;
      const requestedViewport = page.getViewport({ scale: requestedScale });
      const fitted = fitDimensionsToConstraints(requestedViewport.width, requestedViewport.height, renderOptions);
      const scale = requestedScale * fitted.scaleFactor;
      if (fitted.scaleFactor < 1) {
        const boostMarker = fitted.appliedTallPageBoost ? ' [tallBoost]' : '';
        console.log(
          `[OCRPanel] Downscaling render for page ${pageNum}: ` +
          `${Math.floor(requestedViewport.width)}x${Math.floor(requestedViewport.height)} -> ${fitted.width}x${fitted.height}${boostMarker}`
        );
      }
      const viewport = page.getViewport({ scale });

      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = Math.floor(viewport.width);
      outputCanvas.height = Math.floor(viewport.height);

      const ctx = outputCanvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Cannot get canvas context');

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);

      const renderTask = page.render({ canvasContext: ctx, viewport, intent: 'print', canvas: outputCanvas });
      await Promise.race([
        renderTask.promise,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Direct pdf.js render timeout after ${DIRECT_RENDER_TIMEOUT_MS}ms for page ${pageNum}`)), DIRECT_RENDER_TIMEOUT_MS);
        })
      ]);

      console.log(`[OCRPanel] Direct pdf.js render complete for page ${pageNum}: ${outputCanvas.width}x${outputCanvas.height}`);

      return {
        canvas: outputCanvas,
        width: outputCanvas.width,
        height: outputCanvas.height
      };
    } catch (error) {
      console.warn('[OCRPanel] pdf.js render failed, falling back to existing canvas:', error);
      return renderFromExistingCanvas();
    }
  }, [file, fileType, fitDimensionsToConstraints, getPdfDoc, renderImageToCanvas]);

  const runCurrentPageOCR = useCallback(async (
    pageNum: number,
    force: boolean,
    controller: AbortController
  ) => {
    const activeEngine = options.engine || 'tesseract';
    if (activeEngine !== 'tesseract') {
      const ready = await ensureEngineReady(activeEngine, { selectOnReady: false });
      if (!ready) {
        throw new Error(`${activeEngine} is not ready yet`);
      }
    }

    if (!force) {
      const loaded = await loadCachedOCR(pageNum, { allowDuringSuspension: true });
      if (loaded) {
        return;
      }
    }

    setIsProcessing(true);
    setProgress({
      stage: 'init',
      currentPage: pageNum,
      totalPages: 1,
      message: 'Initializing...',
      progress: 0
    });

    setProgress({
      stage: 'rendering',
      currentPage: pageNum,
      totalPages: 1,
      message: `Rendering page ${pageNum}...`,
      progress: 10
    });

    const renderConstraints = resolveRenderConstraints(options.engine);
    console.log(`[OCRPanel] Current-page OCR rendering start for page ${pageNum}`);

    const { canvas, width: imageWidth, height: imageHeight } = await renderPageToCanvas(pageNum, options.dpi, {
      allowNavigationFallback: true,
      ...renderConstraints,
    });

    console.log(`[OCRPanel] Current-page OCR render complete for page ${pageNum}: ${imageWidth}x${imageHeight}`);

    const imageBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to convert canvas to Blob'));
      }, 'image/png');
    });

    console.log(`[OCRPanel] Current-page OCR image blob ready for page ${pageNum}: ${imageBlob.size} bytes`);

    if (activeEngine === 'tesseract') {
      visionService.setProgressCallback((ocrProgress) => {
        const scaled = 15 + (ocrProgress.progress * 80);
        setProgress({
          stage: 'ocr',
          currentPage: pageNum,
          totalPages: 1,
          message: `OCR page ${pageNum}: ${ocrProgress.status} (${Math.round(ocrProgress.progress * 100)}%)`,
          progress: scaled
        });
      });
    } else {
      visionService.setProgressCallback(null);
      startExternalProgress(pageNum, activeEngine, imageWidth, imageHeight);
    }

    console.log(`[OCRPanel] Dispatching OCR request for page ${pageNum}`);

    const runAttemptWithTimeout = async (
      timeoutSec?: number,
      qualityProfile: OCRQualityProfile = 'best'
    ): Promise<import('../../types').OCRPageResult> => {
      const pageAbortController = new AbortController();
      const pageSignal = pageAbortController.signal;
      const parentAbortHandler = () => pageAbortController.abort();
      controller.signal.addEventListener('abort', parentAbortHandler, { once: true });

      const ocrPromise = visionService.ocrForTextLayer(
        imageBlob,
        imageWidth,
        imageHeight,
        options.language,
        options.dpi,
        options.pageSegMode,
        pageSignal,
        showDebugOverlay,
        activePipelineProfile,
        qualityProfile,
        activeEngine
      );

      try {
        return await withPerPageOCRTimeout(
          ocrPromise,
          pageNum,
          timeoutSec,
          () => {
            pageAbortController.abort();
            if (activeEngine === 'tesseract') {
              visionService.cancelAll(`OCR timeout on page ${pageNum}`);
            } else {
              void window.electronAPI?.ocr?.cancelExternal?.({ engine: activeEngine }).catch(() => {
                // Best effort external OCR cancellation.
              });
            }
          }
        );
      } finally {
        controller.signal.removeEventListener('abort', parentAbortHandler);
      }
    };

    const isTimeoutError = (error: unknown): boolean => (
      error instanceof Error && /OCR timeout: page \d+ exceeded \d+s/.test(error.message)
    );

    const effectiveTimeoutSec = resolvePerPageTimeoutSec(options.perPageTimeoutSec, options.engine || 'tesseract');
    const shouldPreferFastPaddleProfile = (() => {
      if (activeEngine !== 'paddleocr') return false;
      if (activePipelineProfile !== 'panel') return false;

      const isCjkLike = options.language
        .split('+')
        .map(code => code.trim())
        .filter(Boolean)
        .some(code => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));
      if (isCjkLike) return false;

      const longest = Math.max(imageWidth, imageHeight);
      const shortest = Math.max(1, Math.min(imageWidth, imageHeight));
      const aspectRatio = longest / shortest;
      const pixelCount = imageWidth * imageHeight;
      return pixelCount >= 3_600_000 || longest >= 5200 || aspectRatio <= 2.4;
    })();

    let resolvedQualityProfile: OCRQualityProfile = activeEngine === 'paddleocr'
      ? (shouldPreferFastPaddleProfile ? 'fast' : 'balanced')
      : 'best';
    let ocrResult: import('../../types').OCRPageResult;
    try {
      ocrResult = await runAttemptWithTimeout(effectiveTimeoutSec, resolvedQualityProfile);
    } catch (error) {
      if (activeEngine !== 'tesseract' && isTimeoutError(error) && !controller.signal.aborted) {
        const boostedTimeoutSec = Math.max((effectiveTimeoutSec || 180) + 120, 300);
        resolvedQualityProfile = activeEngine === 'paddleocr' ? 'fast' : 'balanced';
        setProgress({
          stage: 'ocr',
          currentPage: pageNum,
          totalPages: 1,
          message: `OCR page ${pageNum} timed out at ${effectiveTimeoutSec || 0}s, retrying with ${boostedTimeoutSec}s (${resolvedQualityProfile})...`,
          progress: 18,
        });
        ocrResult = await runAttemptWithTimeout(boostedTimeoutSec, resolvedQualityProfile);
      } else {
        throw error;
      }
    } finally {
      stopExternalProgress();
    }

    if (activePipelineProfile === 'panel') {
      ocrResult = applyPanelLanguageScriptGate(ocrResult, options.language);
      ocrResult = applyPanelSafetyLineDedup(ocrResult);
    }

    console.log(`[OCRPanel] OCR request resolved for page ${pageNum} with ${ocrResult.words.length} words`);
    const debugDrops = ocrResult.debug?.dropCounts || {};
    const debugDropWords = ocrResult.debug?.droppedWords || [];
    console.log(
      `[OCRPanel] OCR debug page ${pageNum}: engine=${activeEngine} pipeline=${activePipelineProfile} lang=${options.language} ` +
      `drops=${JSON.stringify(debugDrops)} droppedWords=${debugDropWords.length}`
    );
    if (debugDropWords.length > 0) {
      console.log('[OCRPanel] OCR droppedWords sample:', debugDropWords.slice(0, 8));
    }
    if (activePipelineProfile === 'panel') {
      const repeatedKeys = collectResidualRepeatedPanelKeys(ocrResult.lines || []);
      if (repeatedKeys.length > 0) {
        console.warn(
          `[OCRPanel] Residual repeated OCR keys on page ${pageNum}: ${JSON.stringify(repeatedKeys)}`
        );
      }
    }
    visionService.setProgressCallback(null);

    ocrResult.language = normalizeLanguage(options.language);
    ocrResult.pageNumber = pageNum;
    ocrResult.pipelineProfile = activePipelineProfile;
    ocrResult.ocrEngine = activeEngine;
    ocrResult.ocrQualityProfile = resolvedQualityProfile;
    if (activeEngine !== 'tesseract') {
      setEngineWarmState(activeEngine, {
        phase: 'ready',
        progress: 100,
        etaSec: 0,
        languageKey: normalizedWarmLanguage,
      });
    }
    setPageOCR(pageNum, ocrResult);

    const cacheDocId = await ensureDocumentId();
    if (cacheDocId) {
      const saved = await dbService.saveOCR(cacheDocId, pageNum, ocrResult, activeEngine);
      if (!saved) {
        console.warn(`[OCRPanel] Failed to persist OCR cache for page ${pageNum} (docId=${cacheDocId})`);
      }
    }

    setProgress({
      stage: 'complete',
      currentPage: pageNum,
      totalPages: 1,
      message: `OCR complete for page ${pageNum}`,
      progress: 100
    });
  }, [activePipelineProfile, ensureDocumentId, ensureEngineReady, loadCachedOCR, normalizeLanguage, normalizedWarmLanguage, options.dpi, options.engine, options.language, options.pageSegMode, renderPageToCanvas, resolveRenderConstraints, setEngineWarmState, setIsProcessing, setPageOCR, setProgress, showDebugOverlay, startExternalProgress, stopExternalProgress]);

  /**
   * Start OCR processing
   */
  const handleCurrentPageOCR = useCallback(async (pageNum: number, force: boolean = false) => {
    if (!file || !fileUrl) {
      console.error('No file loaded');
      return;
    }

    const activeEngine = (options.engine || 'tesseract') as OCREngine;

    if (selectedEngineWarming && activeEngine !== 'tesseract') {
      setProgress({
        stage: 'init',
        currentPage: pageNum,
        totalPages: 1,
        message: selectedEngineWarmState.description || 'Selected OCR model is warming up. Waiting to start OCR...',
        progress: Math.max(0, Math.min(100, Number(selectedEngineWarmState.progress || 0))),
      });

      const ready = await ensureEngineReady(activeEngine, { selectOnReady: false });
      if (!ready) {
        setProgress({
          stage: 'complete',
          currentPage: pageNum,
          totalPages: 1,
          message: `${activeEngine} is not ready yet`,
          progress: 0,
        });
        return;
      }
    }

    if (ocrJobActiveRef.current) {
      console.warn('[OCRPanel] Ignored current-page OCR request while another OCR job is active');
      return;
    }

    try {
      console.log(`[OCRPanel] Starting current-page OCR for page ${pageNum} (force=${force})`);
      ocrJobActiveRef.current = true;
      suspendCacheReadsRef.current = true;
      const controller = beginAbortableJob();
      await runCurrentPageOCR(pageNum, force, controller);
    } catch (error) {
      if (isAbortError(error)) {
        setProgress({
          stage: 'complete',
          currentPage: pageNum,
          totalPages: 1,
          message: 'OCR canceled',
          progress: 0
        });
      } else {
        console.error('[OCRPanel] Current page OCR failed:', error);
        if ((options.engine || 'tesseract') !== 'tesseract' && shouldRecoverExternalEngine(error)) {
          recoverExternalEngine(
            options.engine || 'paddleocr',
            error instanceof Error ? error.message : 'External OCR failed - reloading model cache...'
          );
        }
        setProgress({
          stage: 'complete',
          currentPage: pageNum,
          totalPages: 1,
          message: `OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          progress: 0
        });
      }
    } finally {
      visionService.setProgressCallback(null);
      stopExternalProgress();
      ocrJobActiveRef.current = false;
      suspendCacheReadsRef.current = false;
      setIsProcessing(false);
    }
  }, [beginAbortableJob, ensureEngineReady, file, fileUrl, isAbortError, options.engine, recoverExternalEngine, runCurrentPageOCR, selectedEngineWarmState.description, selectedEngineWarmState.progress, selectedEngineWarming, setIsProcessing, setProgress, shouldRecoverExternalEngine, stopExternalProgress]);

  const handleStartOCR = useCallback(async (targetPages?: number[], forceReOCR: boolean = false) => {
    if (!file || !fileUrl) {
      console.error('No file loaded');
      return;
    }

    const selectedEngine = (options.engine || 'tesseract') as OCREngine;

    if (selectedEngineWarming && selectedEngine !== 'tesseract') {
      setProgress({
        stage: 'init',
        currentPage: 0,
        totalPages: 0,
        message: selectedEngineWarmState.description || 'Selected OCR model is warming up. Waiting to start OCR...',
        progress: Math.max(0, Math.min(100, Number(selectedEngineWarmState.progress || 0))),
      });

      const ready = await ensureEngineReady(selectedEngine, { selectOnReady: false });
      if (!ready) {
        setProgress({
          stage: 'complete',
          currentPage: 0,
          totalPages: 0,
          message: `${selectedEngine} is not ready yet`,
          progress: 0,
        });
        return;
      }
    }

    if (ocrJobActiveRef.current) {
      console.warn('[OCRPanel] Ignored batch OCR request while another OCR job is active');
      return;
    }

    const activeFile = file;
    let cacheDocId: number | null = null;
    let wasCanceled = false;
    const completedPageResults = new Map<number, OCRPageResult>();
    const pendingCachePersistTasks = new Set<Promise<void>>();
    const trackCachePersistTask = (task: Promise<void>) => {
      pendingCachePersistTasks.add(task);
      void task.finally(() => {
        pendingCachePersistTasks.delete(task);
      });
    };

    try {
      console.log(`[OCRPanel] Starting batch OCR (forceReOCR=${forceReOCR}, targetPages=${targetPages?.join(',') || 'all'})`);
      const activeEngine = options.engine || 'tesseract';
      if (activeEngine !== 'tesseract') {
        const ready = await ensureEngineReady(activeEngine, { selectOnReady: false });
        if (!ready) {
          throw new Error(`${activeEngine} is not ready yet`);
        }
      }
      ocrJobActiveRef.current = true;
      suspendCacheReadsRef.current = true;
      const controller = beginAbortableJob();
      if (fileType !== 'pdf') {
        await runCurrentPageOCR(1, true, controller);
        return;
      }
      setIsProcessing(true);
      
      // Set initial progress (don't call reset() here!)
      setProgress({
        stage: 'init',
        currentPage: 0,
        totalPages: 0,
        message: 'กำลังเริ่มต้น...',
        progress: 0
      });

      // Set up progress callback
      searchablePDFService.setProgressCallback(setProgress);
      
      // Set up OCR result callback to store results for display
      searchablePDFService.setOCRResultCallback((pageNum, result) => {
        const normalizedResult = normalizeCacheProfile({
          ...result,
          pageNumber: pageNum,
          pipelineProfile: activePipelineProfile,
          ocrEngine: (result.ocrEngine || activeEngine) as OCREngine,
          language: normalizeLanguage(result.language || options.language),
        });

        setPageOCR(pageNum, normalizedResult);
        completedPageResults.set(pageNum, normalizedResult);

        if (!cacheDocId) {
          return;
        }

        const resultEngine = (normalizedResult.ocrEngine || activeEngine) as OCREngine;
        const persistTask = (async () => {
          try {
            const activeFileNow = useProjectStore.getState().file;
            if (activeFileNow !== activeFile) return;
            const saved = await dbService.saveOCR(cacheDocId as number, pageNum, normalizedResult, resultEngine);
            if (!saved) {
              console.warn(`[OCRPanel] Background cache persist failed for page ${pageNum} (docId=${cacheDocId})`);
            }
          } catch (error) {
            console.warn(`[OCRPanel] Background cache persist error for page ${pageNum}:`, error);
          }
        })();
        trackCachePersistTask(persistTask);
      });
      searchablePDFService.setCacheHitCallback(forceReOCR ? null : (pageNum) => {
        if (useProjectStore.getState().file !== activeFile) return;
      });

      // Read file as ArrayBuffer
      const arrayBuffer = fileData
        ? fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength)
        : await file.arrayBuffer();
      pdfDataRef.current = arrayBuffer as ArrayBuffer;

      // Create searchable PDF (also performs OCR)
      cacheDocId = await ensureDocumentId();
      if (!cacheDocId && dbService.isAvailable()) {
        console.warn('[OCRPanel] Batch OCR started without a document ID; completed pages may require post-cancel flush.');
      }
      const resultBytes = await searchablePDFService.createSearchablePDF(
        arrayBuffer as ArrayBuffer,
        options,
        (pageNum, dpi) => renderPageToCanvas(pageNum, dpi, {
          allowNavigationFallback: false,
          ...resolveRenderConstraints(options.engine),
        }),
        targetPages,
        cacheDocId ?? undefined,
        controller.signal,
        forceReOCR,
        showDebugOverlay,
        activePipelineProfile
      );
      void resultBytes;
      
      // Clear callback
      searchablePDFService.setOCRResultCallback(null);
      searchablePDFService.setCacheHitCallback(null);

    } catch (error) {
      if (isAbortError(error)) {
        wasCanceled = true;
        searchablePDFService.setOCRResultCallback(null);
        searchablePDFService.setCacheHitCallback(null);
        setProgress({
          stage: 'complete',
          currentPage: 0,
          totalPages: 0,
          message: 'OCR canceled',
          progress: 0
        });
      } else {
        console.error('[OCRPanel] OCR processing failed:', error);
        if ((options.engine || 'tesseract') !== 'tesseract' && shouldRecoverExternalEngine(error)) {
          recoverExternalEngine(
            options.engine || 'paddleocr',
            error instanceof Error ? error.message : 'External OCR failed - reloading model cache...'
          );
        }
        searchablePDFService.setOCRResultCallback(null);
        searchablePDFService.setCacheHitCallback(null);
        setProgress({
          stage: 'complete',
          currentPage: 0,
          totalPages: 0,
          message: `OCR failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          progress: 0
        });

      }
    } finally {
      searchablePDFService.setOCRResultCallback(null);
      searchablePDFService.setCacheHitCallback(null);
      searchablePDFService.setProgressCallback(null);

      if (pendingCachePersistTasks.size > 0) {
        await Promise.allSettled(Array.from(pendingCachePersistTasks));
      }

      if (
        completedPageResults.size > 0
        && dbService.isAvailable()
        && useProjectStore.getState().file === activeFile
      ) {
        let persistDocId = cacheDocId;
        if (!persistDocId) {
          persistDocId = await ensureDocumentId().catch(() => null);
        }

        if (persistDocId) {
          const recoveryTasks = Array.from(completedPageResults.entries()).map(async ([pageNum, result]) => {
            const resultEngine = (result.ocrEngine || selectedEngine) as OCREngine;
            const saved = await dbService.saveOCR(persistDocId as number, pageNum, result, resultEngine);
            if (!saved) {
              console.warn(`[OCRPanel] Post-cancel cache flush failed for page ${pageNum} (docId=${persistDocId})`);
            }
          });
          await Promise.allSettled(recoveryTasks);
        }
      }

      if (wasCanceled && completedPageResults.size > 0) {
        setProgress({
          stage: 'complete',
          currentPage: 0,
          totalPages: 0,
          message: `OCR canceled. Saved cache for ${completedPageResults.size} completed page(s).`,
          progress: 0,
        });
      }

      ocrJobActiveRef.current = false;
      suspendCacheReadsRef.current = false;
      setIsProcessing(false);
    }
  }, [activePipelineProfile, beginAbortableJob, ensureDocumentId, ensureEngineReady, file, fileData, fileType, fileUrl, isAbortError, normalizeCacheProfile, normalizeLanguage, options, recoverExternalEngine, renderPageToCanvas, resolveRenderConstraints, runCurrentPageOCR, selectedEngineWarmState.description, selectedEngineWarmState.progress, selectedEngineWarming, setIsProcessing, setPageOCR, setProgress, shouldRecoverExternalEngine, showDebugOverlay]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const dispatchAutoOCRResult = (scope: AutoOCRScope, ok: boolean, error?: string) => {
      window.dispatchEvent(new CustomEvent(AUTO_OCR_RESULT_EVENT, { detail: { scope, ok, error } }));
    };

    const handleAutoOCRRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: AutoOCRScope }>).detail;
      const scope: AutoOCRScope = detail?.scope === 'all' ? 'all' : 'current';

      void (async () => {
        if (!file || !fileUrl) {
          dispatchAutoOCRResult(scope, false, 'No file is open for OCR.');
          return;
        }

        if (isProcessing || ocrJobActiveRef.current) {
          dispatchAutoOCRResult(scope, false, 'OCR is already running.');
          return;
        }

        const selectedEngine = (options.engine || 'tesseract') as OCREngine;

        if (scope === 'all' && fileType === 'pdf') {
          await handleStartOCR(undefined, false);
          const state = useOCRTextLayerStore.getState();
          let cachedPages = 0;
          state.ocrByPageEngine.forEach((engineMap) => {
            if (engineMap.has(selectedEngine)) {
              cachedPages += 1;
            }
          });
          const expectedPages = Math.max(1, totalPages);
          const ok = cachedPages >= expectedPages;
          dispatchAutoOCRResult(
            scope,
            ok,
            ok ? undefined : `OCR finished but model cache is incomplete (${cachedPages}/${expectedPages}).`
          );
          return;
        }

        await handleCurrentPageOCR(currentPage, false);
        const state = useOCRTextLayerStore.getState();
        const hasCurrentPageCache = Boolean(state.ocrByPageEngine.get(currentPage)?.get(selectedEngine));
        dispatchAutoOCRResult(
          scope,
          hasCurrentPageCache,
          hasCurrentPageCache ? undefined : `OCR finished but no model cache was produced for page ${currentPage}.`
        );
      })().catch((error) => {
        const message = error instanceof Error ? error.message : 'Unknown OCR error';
        dispatchAutoOCRResult(scope, false, message);
      });
    };

    window.addEventListener(AUTO_OCR_REQUEST_EVENT, handleAutoOCRRequest as EventListener);
    return () => {
      window.removeEventListener(AUTO_OCR_REQUEST_EVENT, handleAutoOCRRequest as EventListener);
    };
  }, [currentPage, file, fileType, fileUrl, handleCurrentPageOCR, handleStartOCR, isProcessing, options.engine, totalPages]);

  const updateBenchmarkRow = useCallback((engine: OCREngine, patch: Partial<BenchmarkRow>) => {
    setBenchmarkRows((current) => current.map((row) => {
      if (row.engine !== engine) return row;
      return { ...row, ...patch };
    }));
  }, []);

  const resetBenchmarkRows = useCallback(() => {
    setBenchmarkRows(
      OCR_ENGINES.map((engine) => ({
        engine: engine.id,
        engineName: engine.name,
        status: 'idle',
        cacheHit: false,
        runtimeMs: null,
        confidence: null,
        compositeScore: null,
        wordCount: 0,
        lineCount: 0,
        suspiciousCount: 0,
        suspiciousRatio: 0,
        droppedCount: 0,
        message: '',
      }))
    );
  }, []);

  const summarizeBenchmarkResult = useCallback((result: OCRPageResult) => {
    const tokens = toBenchmarkTokens(result);
    const suspiciousCount = computeSuspiciousCount(tokens, result.language || options.language);
    const droppedWords = (result.debug as { droppedWords?: unknown[] } | undefined)?.droppedWords;
    const runtimeMs = readRuntimeMs(result);
    const lineCount = Array.isArray(result.lines) ? result.lines.length : 0;
    const confidence = Number(result.confidence.toFixed(2));
    const wordCount = Array.isArray(result.words) ? result.words.length : tokens.length;
    const suspiciousRatio = tokens.length > 0 ? suspiciousCount / tokens.length : 0;
    const droppedCount = Array.isArray(droppedWords) ? droppedWords.length : 0;
    const lexicalQuality = computeLexicalQuality(tokens, result.language || options.language);
    const compositeScore = computeCompositeScore({
      confidence,
      suspiciousRatio,
      droppedCount,
      wordCount,
      lexicalQuality,
    });

    return {
      runtimeMs,
      confidence,
      compositeScore,
      wordCount,
      lineCount,
      suspiciousCount,
      suspiciousRatio,
      droppedCount,
    };
  }, [options.language]);

  const handleBenchmarkCurrentPage = useCallback(async () => {
    if (!file || !fileUrl) return;
    if (isProcessing || benchmarkRunning || ocrJobActiveRef.current) return;

    setBenchmarkOpen(true);
    setBenchmarkTargetPage(currentPage);
    resetBenchmarkRows();
    setBenchmarkRunning(true);

    const controller = new AbortController();
    benchmarkAbortRef.current = controller;
    ocrJobActiveRef.current = true;
    const cacheDocId = await ensureDocumentId().catch(() => null);

    try {
      for (const engine of OCR_ENGINES) {
        if (controller.signal.aborted) break;
        updateBenchmarkRow(engine.id, {
          status: 'running',
          cacheHit: false,
          message: 'Running OCR...',
        });

        try {
          if (cacheDocId) {
            const cached = await dbService.getOCR(cacheDocId, currentPage, engine.id);
            if (cached && isCacheCompatibleForEngine(cached, engine.id)) {
              const normalizedCached = normalizeCacheProfile(cached);
              const summary = summarizeBenchmarkResult(normalizedCached);
              updateBenchmarkRow(engine.id, {
                status: 'done',
                cacheHit: true,
                ...summary,
                message: summary.runtimeMs != null
                  ? `Cache hit ${(summary.runtimeMs / 1000).toFixed(summary.runtimeMs >= 10000 ? 1 : 2)}s`
                  : 'Cache hit',
              });

              if ((options.engine || 'tesseract') === engine.id) {
                setPageOCR(currentPage, {
                  ...normalizedCached,
                  pageNumber: currentPage,
                });
              }
              continue;
            }
          }

          if (engine.id !== 'tesseract') {
            const ready = await ensureEngineReady(engine.id, { selectOnReady: false });
            if (!ready) {
              throw new Error(`${engine.name} is not ready`);
            }
          }

          const renderConstraints = resolveRenderConstraints(engine.id);
          const { canvas, width: imageWidth, height: imageHeight } = await renderPageToCanvas(currentPage, options.dpi, {
            allowNavigationFallback: true,
            ...renderConstraints,
          });

          const imageBlob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
              if (blob) resolve(blob);
              else reject(new Error('Failed to convert benchmark canvas to Blob'));
            }, 'image/png');
          });

          const result = await visionService.ocrForTextLayer(
            imageBlob,
            imageWidth,
            imageHeight,
            options.language,
            options.dpi,
            options.pageSegMode,
            controller.signal,
            showDebugOverlay,
            activePipelineProfile,
            'best',
            engine.id
          );

          result.language = normalizeLanguage(options.language);
          result.pageNumber = currentPage;
          result.pipelineProfile = activePipelineProfile;
          result.ocrEngine = engine.id;
          result.ocrQualityProfile = 'best';

          const normalizedResult = normalizeCacheProfile(result);

          const summary = summarizeBenchmarkResult(normalizedResult);

          updateBenchmarkRow(engine.id, {
            status: 'done',
            cacheHit: false,
            ...summary,
            message: summary.runtimeMs != null ? `Done in ${(summary.runtimeMs / 1000).toFixed(summary.runtimeMs >= 10000 ? 1 : 2)}s` : 'Done',
          });

          if (cacheDocId) {
            const saved = await dbService.saveOCR(cacheDocId, currentPage, normalizedResult, engine.id);
            if (!saved) {
              console.warn(`[OCRPanel] Failed to persist benchmark cache for page ${currentPage} (docId=${cacheDocId}, engine=${engine.id})`);
            }
          }

          if ((options.engine || 'tesseract') === engine.id) {
            setPageOCR(currentPage, normalizedResult);
          }
        } catch (error) {
          const aborted = controller.signal.aborted || isAbortError(error);
          updateBenchmarkRow(engine.id, {
            status: 'error',
            cacheHit: false,
            message: aborted
              ? 'Canceled'
              : (error instanceof Error ? error.message : 'Benchmark failed'),
          });
          if (aborted) {
            break;
          }
        }
      }
    } finally {
      benchmarkAbortRef.current = null;
      setBenchmarkRunning(false);
      ocrJobActiveRef.current = false;
      visionService.setProgressCallback(null);
      stopExternalProgress();
    }
  }, [activePipelineProfile, benchmarkRunning, currentPage, ensureDocumentId, ensureEngineReady, file, fileUrl, isAbortError, isCacheCompatibleForEngine, isProcessing, normalizeCacheProfile, normalizeLanguage, options.dpi, options.engine, options.language, options.pageSegMode, renderPageToCanvas, resetBenchmarkRows, resolveRenderConstraints, setPageOCR, showDebugOverlay, stopExternalProgress, summarizeBenchmarkResult, updateBenchmarkRow]);

  const handleCancelBenchmark = useCallback(() => {
    benchmarkAbortRef.current?.abort();
  }, []);

  const forgetPersistedTranslationCacheForPage = useCallback((docId: number, pageNum: number) => {
    const prefix = `${docId}:${pageNum}:`;
    for (const key of Array.from(persistedTranslationCacheRef.current.keys())) {
      if (key.startsWith(prefix)) {
        persistedTranslationCacheRef.current.delete(key);
      }
    }
  }, []);

  const handleClearCurrentModelCache = useCallback(async () => {
    if (!file) return;
    if (isProcessing || benchmarkRunning || ocrJobActiveRef.current) return;

    const docId = await ensureDocumentId().catch(() => null);
    if (!docId) {
      setCacheActionMessage('Cache clear failed: document is not ready');
      return;
    }

    const engine = (options.engine || 'tesseract') as OCREngine;

    // Clear cache for the current docId
    let anyCleared = await dbService.clearOCR(docId, currentPage, engine);
    const translationClearedCurrent = await dbService.clearTranslationCacheByEngine(docId, currentPage, engine);
    anyCleared = anyCleared || translationClearedCurrent;
    forgetPersistedTranslationCacheForPage(docId, currentPage);

    // Also clear ALL alias docIds sharing the same filename so the cache
    // can't resurrect via alias fallback probing.
    if (file.name) {
      try {
        const candidates = await getFilenameCandidates(file.name);
        for (const candidate of candidates) {
          if (candidate.id === docId) continue;
          const aliasCleared = await dbService.clearOCR(candidate.id, currentPage, engine);
          const aliasTranslationCleared = await dbService.clearTranslationCacheByEngine(candidate.id, currentPage, engine);
          if (aliasCleared) {
            console.log(
              `[OCRPanel] Also cleared alias cache: docId=${candidate.id}, page=${currentPage}, engine=${engine}`
            );
            anyCleared = true;
          }
          if (aliasTranslationCleared) {
            anyCleared = true;
          }
          persistedCacheRef.current.delete(`${candidate.id}:${currentPage}:${engine}`);
          forgetPersistedTranslationCacheForPage(candidate.id, currentPage);
        }
      } catch (error) {
        console.warn('[OCRPanel] Failed to clear alias caches:', error);
      }
    }

    if (!anyCleared) {
      setCacheActionMessage(`No cache found for page ${currentPage} (${engine})`);
      return;
    }

    // Block alias probing for this page+engine until the file/pipeline resets
    clearedCacheKeysRef.current.add(`${currentPage}:${engine}`);

    removePageOCRForEngine(currentPage, engine);
    clearTranslationCacheForEngine(currentPage, engine);
    persistedCacheRef.current.delete(`${docId}:${currentPage}:${engine}`);
    forgetPersistedTranslationCacheForPage(docId, currentPage);
    setCacheActionMessage(`Cleared cache page ${currentPage} (${engine})`);
  }, [
    allPagesOCR,
    benchmarkRunning,
    clearTranslationCacheForEngine,
    currentPage,
    ensureDocumentId,
    file,
    isProcessing,
    options.engine,
    getFilenameCandidates,
    forgetPersistedTranslationCacheForPage,
    removePageOCRForEngine,
  ]);

  useEffect(() => {
    if (!cacheActionMessage) return undefined;
    const timer = setTimeout(() => setCacheActionMessage(''), 2600);
    return () => clearTimeout(timer);
  }, [cacheActionMessage]);

  useEffect(() => {
    if (copyFeedback !== 'copied') return undefined;
    const timer = setTimeout(() => setCopyFeedback('idle'), 1600);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  useEffect(() => {
    if (!normalizedPreviewSearch || previewMatchedLineIndexes.length === 0) {
      if (ocrPreviewSearchActiveIndex !== 0) {
        setOcrPreviewSearchActiveIndex(0);
      }
      return;
    }

    if (ocrPreviewSearchActiveIndex > previewMatchedLineIndexes.length - 1) {
      setOcrPreviewSearchActiveIndex(previewMatchedLineIndexes.length - 1);
    }
  }, [normalizedPreviewSearch, ocrPreviewSearchActiveIndex, previewMatchedLineIndexes.length]);

  useEffect(() => {
    if (!normalizedPreviewSearch || !hasPreviewSearchMatches || activePreviewMatchLineIndex < 0) {
      return;
    }

    const container = ocrPreviewScrollRef.current;
    const targetLine = ocrPreviewLineRefs.current.get(activePreviewMatchLineIndex);
    if (!container || !targetLine) {
      return;
    }

    const stickyHeaderHeight = ocrPreviewSearchHeaderRef.current?.offsetHeight ?? 0;
    const targetTop = Math.max(0, targetLine.offsetTop - stickyHeaderHeight - 8);

    container.scrollTo({
      top: targetTop,
      behavior: 'smooth',
    });
  }, [activePreviewMatchLineIndex, hasPreviewSearchMatches, normalizedPreviewSearch, previewLines.length]);

  useEffect(() => {
    const handler = () => {
      if (benchmarkRunning) {
        setBenchmarkOpen(true);
        return;
      }
      void handleBenchmarkCurrentPage();
    };
    window.addEventListener('ocr:benchmark-current-page', handler);
    return () => {
      window.removeEventListener('ocr:benchmark-current-page', handler);
    };
  }, [benchmarkRunning, handleBenchmarkCurrentPage]);

  // Total OCR stats
  const totalOCRPages = allPagesOCR.size;
  const totalWords = Array.from(allPagesOCR.values()).reduce((sum, r) => sum + r.words.length, 0);
  const currentDroppedCount = previewSourceOCR?.debug?.droppedWords?.length ?? 0;
  const currentDropSummary = previewSourceOCR?.debug?.dropCounts
    ? Object.entries(previewSourceOCR.debug.dropCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([filter, count]) => `${filter}:${count}`)
      .join(', ')
    : '';
  const currentStageSummary = previewSourceOCR?.debug?.stageMetrics
    ? previewSourceOCR.debug.stageMetrics
      .map((metric) => {
        const deltaWords = metric.wordsAfter - metric.wordsBefore;
        const deltaLines = metric.linesAfter - metric.linesBefore;
        const replacementSuffix = metric.replacements && metric.replacements > 0
          ? `/${metric.replacements}r`
          : '';
        return `${metric.stage}:${deltaWords >= 0 ? '+' : ''}${deltaWords}w/${deltaLines >= 0 ? '+' : ''}${deltaLines}l${replacementSuffix}`;
      })
      .join(', ')
    : '';
  const currentCandidateSummary = previewSourceOCR?.debug?.candidates
    ? (() => {
      const rejected = previewSourceOCR.debug.candidates.filter(candidate => !candidate.accepted);
      const accepted = previewSourceOCR.debug.candidates.filter(candidate => candidate.accepted).length;
      const rejectReasons = rejected.reduce<Record<string, number>>((acc, candidate) => {
        const key = candidate.reason || 'unknown';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      const topRejects = Object.entries(rejectReasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => `${reason}:${count}`)
        .join(', ');
      if (!topRejects && accepted === 0) return '';
      return `candidates accepted:${accepted}${topRejects ? ` | reject ${topRejects}` : ''}`;
    })()
    : '';
  const currentSkipReason = previewSourceOCR?.debug?.skipReason || '';
  const hasProcessInfo = Boolean(
    currentDroppedCount
    || currentDropSummary
    || currentStageSummary
    || currentCandidateSummary
    || currentSkipReason
  );
  const currentRuntimeMs = previewSourceOCR?.debug?.runtimeMs
    ?? (previewSourceOCR?.debug as { timingsMs?: { ocr?: number } } | undefined)?.timingsMs?.ocr;
  const currentRuntimeSecLabel = typeof currentRuntimeMs === 'number'
    ? `${(currentRuntimeMs / 1000).toFixed(currentRuntimeMs >= 10000 ? 1 : 2)}s`
    : '-';
  const currentEngine = OCR_ENGINES.find(engine => engine.id === (previewSourceOCR?.ocrEngine || 'tesseract')) || OCR_ENGINES[0];
  const translatedCacheSlotCount = currentPageTranslationEntries.length;
  const translatedTargetLanguages = Array.from(new Set(
    currentPageTranslationEntries
      .map((entry) => resolveTranslationLanguageLabel(entry.targetLanguage))
      .filter(Boolean)
  ));
  const translatedLanguageSummary = translatedTargetLanguages.length <= 3
    ? translatedTargetLanguages.join(', ')
    : `${translatedTargetLanguages.slice(0, 3).join(', ')} +${translatedTargetLanguages.length - 3}`;
  const canToggleToTranslated = Boolean(preferredEntryForCurrentModel || resolvedTranslationEntry);
  const previewToggleLabel = effectivePreviewMode === 'translated' ? 'Original OCR' : 'Translated Result';
  const previewToggleDisabled = effectivePreviewMode === 'translated' ? false : !canToggleToTranslated;
  const benchmarkDoneRows = benchmarkRows.filter((row) => row.status === 'done');
  const benchmarkFastest = benchmarkDoneRows
    .filter((row) => typeof row.runtimeMs === 'number')
    .sort((a, b) => (a.runtimeMs || Number.MAX_SAFE_INTEGER) - (b.runtimeMs || Number.MAX_SAFE_INTEGER))[0];
  const benchmarkMostAccurate = benchmarkDoneRows
    .filter((row) => typeof row.confidence === 'number')
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
  const benchmarkBestOverall = benchmarkDoneRows
    .filter((row) => typeof row.compositeScore === 'number')
    .sort((a, b) => (b.compositeScore || 0) - (a.compositeScore || 0))[0];
  const benchmarkLeastGhost = benchmarkDoneRows
    .sort((a, b) => a.suspiciousRatio - b.suspiciousRatio)[0];

  return (
    <div className="flex flex-col gap-1 p-2.5 pt-2">
      {/* OCR Model Selector */}
      <div className="-mx-2 order-1 space-y-1">
        <div className="flex items-center justify-between gap-3 border-y border-black/55 bg-[linear-gradient(124deg,rgba(234,179,8,0.30)_0%,rgba(249,115,22,0.24)_56%,rgba(17,24,39,0.92)_100%)] px-3 py-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-white">
            <Cpu size={12} />
            OCR Model
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleBenchmarkCurrentPage()}
              disabled={isProcessing || !file}
              className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-black/70 px-2 py-1 text-[10px] font-semibold text-white transition-colors hover:bg-black/85 disabled:cursor-not-allowed disabled:opacity-50"
              title="Benchmark current page using OCR cache + missing-engine run"
            >
              <BarChart3 size={11} />
              Benchmark
            </button>

            <button
              type="button"
              onClick={() => setIsModelSectionOpen((current) => !current)}
              className="flex h-6 w-6 items-center justify-center rounded-md border border-amber-200/45 bg-slate-950/60 text-amber-100 transition-colors hover:border-amber-100/60"
              title={isModelSectionOpen ? 'Collapse OCR model section' : 'Expand OCR model section'}
              aria-label={isModelSectionOpen ? 'Collapse OCR model section' : 'Expand OCR model section'}
            >
              {isModelSectionOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
          </div>
        </div>

        {isModelSectionOpen && (
          <div className="px-2 pt-0.5">
            <div className="grid grid-cols-3 gap-2">
              {OCR_ENGINES.map((engine) => {
                const warmState = engine.id === 'tesseract'
                  ? {
                      phase: 'ready' as EngineWarmPhase,
                      progress: 100,
                      runtime: engine.runtime,
                      description: engine.description,
                      etaSec: 0,
                    }
                  : engineWarmStates[engine.id] || {
                      phase: 'idle' as EngineWarmPhase,
                      progress: 0,
                      runtime: engine.runtime,
                      description: 'Click to check and warm this model',
                      etaSec: null,
                    };
                const isCurrent = (options.engine || 'tesseract') === engine.id;
                const isBusy = warmState.phase === 'checking' || warmState.phase === 'warming';
                const isReady = warmState.phase === 'ready';
                const canSelect = engine.id === 'tesseract' || isReady;

                return (
                  <button
                    key={engine.id}
                    type="button"
                    disabled={isProcessing || isBusy}
                    onClick={() => {
                      if (engine.id === 'tesseract') {
                        void ensureEngineReady('tesseract', { selectOnReady: true });
                        return;
                      }
                      if (canSelect) {
                        setOptions({ engine: engine.id });
                        return;
                      }
                      void ensureEngineReady(engine.id, { selectOnReady: true });
                    }}
                    title={warmState.description || engine.description}
                    className={`relative overflow-hidden rounded-xl border px-2 py-2 text-left transition-all ${
                      isCurrent
                        ? 'border-[#5CC6F2]/70 bg-gradient-to-r from-[#2B9BFF]/25 to-[#2776FF]/20 shadow-[0_10px_24px_rgba(43,155,255,0.18)]'
                        : 'border-white/10 bg-slate-900/45 hover:border-white/20'
                    } disabled:opacity-70`}
                  >
                    {isBusy && (
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#2B9BFF]/20 via-[#5CC6F2]/25 to-transparent transition-[width] duration-500"
                        style={{ width: `${warmState.progress}%` }}
                      />
                    )}
                    <div className="relative z-10 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-white">{engine.name}</span>
                        <span className={`text-[9px] font-medium ${
                          warmState.phase === 'ready'
                            ? 'text-emerald-300'
                            : warmState.phase === 'error'
                              ? 'text-rose-300'
                              : 'text-slate-400'
                        }`}>
                          {warmState.phase === 'ready'
                            ? 'Ready'
                            : warmState.phase === 'error'
                              ? 'Unavailable'
                              : warmState.phase === 'warming'
                                ? 'Loading'
                                : 'Check'}
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-950/80 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-500 ${
                            warmState.phase === 'ready'
                              ? 'bg-gradient-to-r from-emerald-400 to-emerald-300'
                              : warmState.phase === 'error'
                                ? 'bg-gradient-to-r from-rose-500 to-orange-400'
                                : 'bg-gradient-to-r from-[#2B9BFF] via-[#5CC6F2] to-[#89E6FF]'
                          }`}
                          style={{ width: `${Math.max(warmState.progress, warmState.phase === 'idle' ? 4 : 8)}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {isProcessing && (
        <div className="order-2 space-y-2 bg-slate-900/55 rounded-lg p-3 border border-white/10">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 truncate max-w-[180px]">
              {progress?.message || 'กำลังเริ่มต้น...'}
            </span>
            <span className="text-[#5CC6F2] font-mono">
              {progress ? Math.round(progress.progress) : 0}%
            </span>
          </div>
          <div className="h-2 bg-slate-950 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-[#2B9BFF] to-[#5CC6F2] transition-all duration-150"
              style={{ width: `${progress?.progress || 0}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>
              {progress?.stage === 'rendering' && '📄 Rendering...'}
              {progress?.stage === 'ocr' && '🔍 OCR Processing...'}
              {progress?.stage === 'text-layer' && '✍️ Adding Text...'}
              {progress?.stage === 'saving' && '💾 Saving...'}
              {!progress && '⏳ Initializing...'}
            </span>
            <span>
              {progress?.currentPage || 0} / {progress?.totalPages || '?'}
            </span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="order-2 space-y-1.5">
        {selectedEngineWarming && !isProcessing && (
          <div className="rounded-md border border-amber-400/35 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-100">
            selected model is warming: {selectedEngineWarmState.description || 'Please wait until it is ready'}
          </div>
        )}

        <div className="flex gap-2">
          {fileType === 'pdf' && (
            <button
              onClick={() => handleCurrentPageOCR(useProjectStore.getState().currentPage, true)}
              disabled={ocrActionDisabled}
              className="flex-[0.32] bg-gradient-to-r from-[#7C5CFF]/88 to-[#9A6BFF]/82 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white py-1.5 rounded-lg flex items-center justify-center transition-all shadow-[0_5px_14px_rgba(124,92,255,0.18)] border border-[#A992FF]/35"
              title={selectedEngineWarming ? 'Wait for selected model warm-up to finish' : 'Process current page only'}
            >
              <span className="text-[10px] font-semibold">Current</span>
            </button>
          )}

          {/* Main Button */}
          <button
            onClick={() => handleStartOCR()}
            disabled={ocrActionDisabled}
            className="flex-1 bg-gradient-to-r from-[#2B9BFF] to-[#2776FF] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white py-1.5 rounded-lg font-semibold text-[10px] flex items-center justify-center gap-1.5 transition-all shadow-[0_5px_14px_rgba(43,155,255,0.24)]"
            title={selectedEngineWarming
              ? 'Wait for selected model warm-up to finish'
              : (fileType === 'pdf' ? 'Process all pages' : 'Process image')}
          >
            {isProcessing ? (
              <>
                <RefreshCw size={14} className="animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Play size={14} fill="currentColor" />
                {fileType === 'pdf' ? 'All Pages' : 'Run OCR'}
              </>
            )}
          </button>
        </div>

        {fileType === 'pdf' && !isProcessing && (
          <div className="flex gap-2">
            <button
              onClick={() => handleStartOCR(undefined, true)}
              disabled={!file || isProcessing}
              className="flex-[1.2] bg-gradient-to-r from-[#FF8705] to-[#FF9A3D] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white py-1.5 rounded-lg font-semibold text-[10px] flex items-center justify-center gap-1.5 transition-all shadow-[0_5px_14px_rgba(255,135,5,0.2)]"
              title={selectedEngineWarming
                ? 'Wait for selected model warm-up to finish'
                : 'Force re-run OCR for all pages (ignore cache)'}
            >
              <RefreshCw size={13} />
              Re-OCR All (Ignore Cache)
            </button>

            <button
              onClick={() => void handleClearCurrentModelCache()}
              disabled={!file}
              className="flex-1 border border-rose-400/45 bg-rose-500/12 text-rose-100 py-1.5 rounded-lg font-semibold text-[10px] flex items-center justify-center gap-1.5 hover:bg-rose-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              title="Clear cache only for current page and selected OCR model"
            >
              <Trash2 size={12} />
              Clear Cache P{currentPage}
            </button>
          </div>
        )}

        {cacheActionMessage && (
          <div className="rounded-md border border-cyan-500/35 bg-cyan-500/12 px-2 py-1 text-[10px] text-cyan-100">
            {cacheActionMessage}
          </div>
        )}

        {isProcessing && (
          <button
            onClick={cancelCurrentJob}
            className="w-full bg-red-600 hover:bg-red-500 text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg"
            title="Cancel OCR"
          >
            Cancel
          </button>
        )}

      </div>

      {/* OCR Results Preview */}
      {previewSourceOCR && !isProcessing && (
        <div className="order-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
            <Eye size={12} className="text-[#5CC6F2]" />
            OCR Result - หน้า {currentPage}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOcrInfoOpen(true)}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-slate-900/70 text-slate-300 transition-colors hover:border-sky-400/40 hover:text-sky-100"
                title="Open OCR process info"
              >
                <Info size={12} />
              </button>
              <span className="text-[11px] font-medium text-sky-300/95">
                {`runtime ${currentRuntimeSecLabel}`}
              </span>
              <button
                type="button"
                onClick={() => {
                  if (effectivePreviewMode === 'translated') {
                    setTranslationPreviewMode('original');
                    return;
                  }
                  if (!canToggleToTranslated) return;
                  const preferredKey = preferredEntryForCurrentModel?.key || resolvedTranslationEntry?.key;
                  if (preferredKey) {
                    setActiveTranslationCacheKey(currentPage, preferredKey);
                  }
                  setTranslationPreviewMode('translated');
                }}
                disabled={previewToggleDisabled}
                className={`rounded-md border px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                  effectivePreviewMode === 'translated'
                    ? 'border-cyan-400/55 bg-cyan-500/20 text-cyan-100 hover:border-cyan-300/70 hover:bg-cyan-500/28'
                    : 'border-emerald-400/55 bg-emerald-500/18 text-emerald-100 hover:border-emerald-300/70 hover:bg-emerald-500/28'
                } disabled:cursor-not-allowed disabled:opacity-45`}
                title={previewToggleDisabled ? 'No translated cache available for this context' : (effectivePreviewMode === 'translated' ? 'Show original OCR cache' : 'Show translated result cache')}
              >
                {previewToggleLabel}
              </button>
            </div>
          </div>
          <div className="rounded-lg border border-emerald-700/60 bg-emerald-900/20 px-3 py-2 text-[11px] text-emerald-300">
            model {currentEngine.name} • พบ {previewSourceOCR.words.length} คำ • raw conf {previewSourceOCR.confidence.toFixed(0)}%
          </div>
          {translatedTargetLanguages.length > 0 && (
            <div className="rounded-lg border border-sky-500/35 bg-sky-500/12 px-3 py-2 text-[11px] text-sky-100">
              translated cache on this page: {translatedLanguageSummary}
            </div>
          )}
          {translationPreviewMode === 'translated' && !activeTranslationMatchesCurrentOCR && translatedCacheSlotCount > 0 && (
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
              translated cache is stale for current OCR source, showing original OCR
            </div>
          )}
          
          <div className="relative bg-slate-900/55 border border-white/10 rounded-lg min-h-56 max-h-[40vh] overflow-hidden">
            <div className="pointer-events-none absolute right-2 top-2 z-20">
              <button
                type="button"
                onClick={() => void handleCopyPreviewText()}
                disabled={!hasPreviewCopyText}
                className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-full border border-white/10 bg-slate-950/80 text-slate-300 shadow-[0_6px_14px_rgba(2,8,23,0.45)] transition-colors hover:border-cyan-300/60 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-45"
                title={hasPreviewCopyText ? 'Copy all OCR text in the current preview' : 'No OCR text to copy'}
                aria-label={copyFeedback === 'copied' ? 'Copied OCR text' : 'Copy all OCR text'}
              >
                {copyFeedback === 'copied' ? <Check size={13} /> : <Copy size={13} />}
              </button>
            </div>
            <div ref={ocrPreviewScrollRef} className="h-full max-h-[40vh] overflow-y-auto px-2 pt-1 pb-4">
              <div ref={ocrPreviewSearchHeaderRef} className="sticky top-0 z-10 mb-1.5 rounded-md border border-white/10 bg-slate-950/88 px-2 py-1 backdrop-blur">
                <div className="flex items-center gap-1.5">
                  <Search size={12} className="text-slate-400" />
                  <input
                    type="text"
                    value={ocrResultSearchQuery}
                    onChange={(event) => {
                      setOcrResultSearchQuery(event.target.value);
                      setOcrPreviewSearchActiveIndex(0);
                    }}
                    placeholder="Search OCR result..."
                    className="h-7 flex-1 rounded-md border border-white/10 bg-slate-900/75 px-2 text-[11px] text-slate-100 placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handlePreviewSearchStep(-1)}
                    disabled={!hasPreviewSearchMatches}
                    className="h-7 rounded-md border border-white/12 bg-slate-900/75 px-2 text-[10px] font-semibold text-slate-200 transition-colors hover:border-cyan-400/45 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-45"
                    title="Previous match"
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePreviewSearchStep(1)}
                    disabled={!hasPreviewSearchMatches}
                    className="h-7 rounded-md border border-white/12 bg-slate-900/75 px-2 text-[10px] font-semibold text-slate-200 transition-colors hover:border-cyan-400/45 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-45"
                    title="Next match"
                  >
                    Next
                  </button>
                </div>
                {normalizedPreviewSearch && (
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    {hasPreviewSearchMatches
                      ? `matches ${previewSearchMatchCount} • line ${ocrPreviewSearchActiveIndex + 1}/${previewMatchedLineIndexes.length}`
                      : 'No match'}
                  </div>
                )}
              </div>
              {previewWordsLength > 0 ? (
                <div className="space-y-1">
                  {/* Show text grouped by lines for better readability */}
                  {previewLines && previewLines.length > 0 ? (
                    previewLines.map((line, i) => {
                      const matchedLine = previewMatchedLineIndexSet.has(i);
                      const activeMatchLine = matchedLine && i === activePreviewMatchLineIndex;
                      return (
                        <p
                          key={i}
                          className={`text-xs leading-relaxed ${
                            activeMatchLine
                              ? 'scroll-mt-24 rounded bg-cyan-500/14 px-1 py-0.5 text-cyan-50 ring-1 ring-cyan-400/35'
                              : matchedLine
                                ? 'scroll-mt-24 text-slate-100'
                                : 'text-slate-300'
                          }`}
                          ref={(element) => {
                            if (element) {
                              ocrPreviewLineRefs.current.set(i, element);
                            } else {
                              ocrPreviewLineRefs.current.delete(i);
                            }
                          }}
                        >
                          {renderPreviewTextWithHighlight(line.text, previewSearchPattern)}
                        </p>
                      );
                    })
                  ) : (
                    // Fallback: show words joined
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {renderPreviewTextWithHighlight(previewText || previewSourceOCR.words.map(w => w.text).join(' '), previewSearchPattern)}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500 italic text-center py-2">
                  ไม่พบข้อความในหน้านี้
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Hidden canvas for rendering */}
      <canvas ref={canvasRef} className="hidden" />

      {ocrInfoOpen && previewSourceOCR && createPortal(
        <div className="fixed inset-0 z-[195] flex items-center justify-center bg-black/72 backdrop-blur-md px-4 py-6">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-[#081321]/95 shadow-[0_24px_60px_rgba(0,0,0,0.42)]">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-white">OCR Process Info</h3>
                <p className="mt-1 text-[11px] text-slate-400">
                  หน้า {currentPage} • {currentEngine.name} • runtime {currentRuntimeSecLabel}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOcrInfoOpen(false)}
                className="rounded-lg border border-white/10 bg-white/5 p-2 text-slate-300 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
                title="Close OCR process info"
              >
                <X size={14} />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/85">
                  Summary
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-200">
                  <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Mode</div>
                    <div className="mt-1 font-medium text-white">
                      {effectivePreviewMode === 'translated' ? 'Translated Preview' : 'Original OCR'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Words</div>
                    <div className="mt-1 font-medium text-white">{previewSourceOCR.words.length}</div>
                  </div>
                  <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Raw Conf</div>
                    <div className="mt-1 font-medium text-white">{previewSourceOCR.confidence.toFixed(0)}%</div>
                  </div>
                  <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Cache Slots</div>
                    <div className="mt-1 font-medium text-white">{translatedCacheSlotCount}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-900/65 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300/90">
                    Process Log
                  </div>
                  {!hasProcessInfo && (
                    <span className="text-[10px] text-slate-500">No extra diagnostics for this page</span>
                  )}
                </div>

                <div className="mt-3 space-y-2 text-[11px] text-slate-200">
                  {currentDroppedCount > 0 && (
                    <div className="rounded-lg border border-orange-500/20 bg-orange-500/8 px-3 py-2 text-orange-100">
                      dropped {currentDroppedCount} คำ{currentDropSummary ? ` (${currentDropSummary})` : ''}
                    </div>
                  )}
                  {currentStageSummary && (
                    <div className="rounded-lg border border-sky-500/20 bg-sky-500/8 px-3 py-2 text-sky-100">
                      stages {currentStageSummary}
                    </div>
                  )}
                  {currentCandidateSummary && (
                    <div className="rounded-lg border border-fuchsia-500/20 bg-fuchsia-500/8 px-3 py-2 text-fuchsia-100">
                      {currentCandidateSummary}
                    </div>
                  )}
                  {currentSkipReason && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-amber-100">
                      skipReason {currentSkipReason}
                    </div>
                  )}
                  {showDebugOverlay && (
                    <div className="rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-slate-300">
                      visual debug overlay is currently enabled
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {benchmarkOpen && createPortal(
        <div className="fixed inset-0 z-190 flex items-center justify-center bg-black/72 backdrop-blur-md px-4 py-6">
          <div className="flex max-h-[90vh] w-[min(96vw,1240px)] flex-col rounded-2xl border border-white/15 bg-slate-950/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-100">OCR Benchmark Summary</h3>
                <p className="mt-1 text-xs text-slate-400">
                  page {benchmarkTargetPage ?? currentPage} • pipeline {activePipelineProfile} • lang {options.language} • dpi {options.dpi}
                </p>
                <p className="mt-1 text-[11px] text-amber-200/90">
                  confidence เป็น raw score ของแต่ละ engine (ยังไม่ calibrated ข้าม model)
                </p>
                <p className="mt-1 text-[11px] text-cyan-200/90">
                  composite score = 35% raw conf + 35% clean token + 20% drop-safe + 10% lexical quality
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!benchmarkRunning) setBenchmarkOpen(false);
                }}
                disabled={benchmarkRunning}
                className="rounded-lg border border-white/10 p-1.5 text-slate-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                title={benchmarkRunning ? 'Wait for benchmark to finish or cancel first' : 'Close benchmark summary'}
              >
                <X size={14} />
              </button>
            </div>

            <div className="mt-4 flex-1 overflow-auto rounded-xl border border-white/10">
              <table className="min-w-full table-fixed text-xs text-slate-200">
                <thead className="bg-slate-900/85 text-slate-300">
                  <tr>
                    <th className="px-3 py-2 text-left">Engine</th>
                    <th className="px-3 py-2 text-right">Runtime</th>
                    <th className="px-3 py-2 text-right">Raw Conf</th>
                    <th className="px-3 py-2 text-right">Composite</th>
                    <th className="px-3 py-2 text-right">Words</th>
                    <th className="px-3 py-2 text-right">Lines</th>
                    <th className="px-3 py-2 text-right">Ghost Ratio</th>
                    <th className="px-3 py-2 text-right">Dropped</th>
                    <th className="px-3 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmarkRows.map((row) => (
                    <tr key={row.engine} className="border-t border-white/10 bg-slate-900/35">
                      <td className="px-3 py-2 font-semibold text-slate-100">{row.engineName}</td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        {row.runtimeMs != null ? `${(row.runtimeMs / 1000).toFixed(row.runtimeMs >= 10000 ? 1 : 2)}s` : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        {row.confidence != null ? `${row.confidence.toFixed(0)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        {row.compositeScore != null ? `${row.compositeScore.toFixed(1)}` : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">{row.wordCount || '-'}</td>
                      <td className="px-3 py-2 text-right text-slate-200">{row.lineCount || '-'}</td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        {row.wordCount > 0 ? `${(row.suspiciousRatio * 100).toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">{row.droppedCount || '-'}</td>
                      <td className="px-3 py-2 text-left">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          row.status === 'done'
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : row.status === 'running'
                              ? 'bg-sky-500/20 text-sky-300'
                              : row.status === 'error'
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'bg-slate-500/20 text-slate-300'
                        }`}>
                          {row.message || row.status}
                        </span>
                        {row.cacheHit && (
                          <span className="ml-1.5 inline-flex rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                            cache
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Trophy size={12} />
                  Fastest
                </div>
                <div className="mt-1">{benchmarkFastest ? `${benchmarkFastest.engineName} (${((benchmarkFastest.runtimeMs || 0) / 1000).toFixed(2)}s)` : '-'}</div>
              </div>
              <div className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Trophy size={12} />
                  Best Overall (Composite)
                </div>
                <div className="mt-1">{benchmarkBestOverall ? `${benchmarkBestOverall.engineName} (${(benchmarkBestOverall.compositeScore || 0).toFixed(1)})` : '-'}</div>
              </div>
              <div className="rounded-lg border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-xs text-sky-200">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Trophy size={12} />
                  Highest Raw Conf
                </div>
                <div className="mt-1">{benchmarkMostAccurate ? `${benchmarkMostAccurate.engineName} (${(benchmarkMostAccurate.confidence || 0).toFixed(0)}%)` : '-'}</div>
              </div>
              <div className="rounded-lg border border-fuchsia-500/35 bg-fuchsia-500/10 px-3 py-2 text-xs text-fuchsia-200">
                <div className="flex items-center gap-1.5 font-semibold">
                  <Trophy size={12} />
                  Lowest Ghost Ratio
                </div>
                <div className="mt-1">{benchmarkLeastGhost ? `${benchmarkLeastGhost.engineName} (${(benchmarkLeastGhost.suspiciousRatio * 100).toFixed(1)}%)` : '-'}</div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              {benchmarkRunning ? (
                <button
                  type="button"
                  onClick={handleCancelBenchmark}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
                >
                  Stop Benchmark
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setBenchmarkOpen(false)}
                    className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleBenchmarkCurrentPage()}
                    disabled={isProcessing || benchmarkRunning || !file}
                    className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Re-run
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
