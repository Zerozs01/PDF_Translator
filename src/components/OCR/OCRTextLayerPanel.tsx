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
  BarChart3,
  Sparkles,
  Zap,
  Gauge
} from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { BBox, OCRDroppedWord, OCREngine, OCRLine, OCRPageResult, OCRQualityProfile, BenchmarkMode } from '../../types';
import type { DBDocumentCacheCandidate } from '../../types/electron.d';
import {
  hasCurrentOCRTranslationCacheVersion,
  OCR_ENGINES,
  OCRTranslationCacheEntry,
  useOCRTextLayerStore,
} from '../../stores/useOCRTextLayerStore';
import { useLayerStore } from '../../stores/useLayerStore';
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
import { resolveMissingOverlayLineFallbackText } from './translationOverlayUtils';

import {
  applyPanelLanguageScriptGate
} from '../../services/vision/scriptGateService';

import {
  computeCompositeScore,
  normalizedEditError,
  levenshteinDistance,
  computeLexicalQuality,
  computeSuspiciousCount,
  toBenchmarkTokens,
  isCjkLikeLanguage,
  normalizeBenchmarkToken,
  BENCHMARK_SHORT_KEEP,
  BENCHMARK_DOMAIN_TOKENS,
  BENCHMARK_COMPOSITE_WEIGHTS
} from '../../services/vision/ocrBenchmarkService';

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

type BenchmarkRawSnapshot = {
  runtimeMs: number | null;
  confidence: number | null;
  compositeScore: number | null;
  lexicalAxis: number | null;
  yieldAxis: number | null;
  garbageRatio: number | null;
  efficiency: number | null;
  wordCount: number;
  lineCount: number;
  droppedCount: number;
  status: 'idle' | 'running' | 'done' | 'error';
  message?: string;
};

type BenchmarkRow = {
  engine: OCREngine;
  engineName: string;
  status: 'idle' | 'running' | 'done' | 'error';
  cacheHit: boolean;
  runtimeMs: number | null;
  confidence: number | null;
  compositeScore: number | null;
  efficiency: number | null;
  rawAxis: number | null;
  lexicalAxis: number | null;
  yieldAxis: number | null;
  werError: number | null;
  cerError: number | null;
  garbageRatio: number | null;
  wordCount: number;
  lineCount: number;
  suspiciousCount: number;
  suspiciousRatio: number;
  droppedCount: number;
  message?: string;
  /** dual mode: raw (no-pipeline) snapshot for delta comparison */
  rawSnapshot?: BenchmarkRawSnapshot;
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

  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  if (!(right > left && bottom > top)) return undefined;

  return { x0: left, y0: top, x1: right, y1: bottom };
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
  const veryLowCoverage = wordCoverage <= 0.16;
  const lowCoverage = wordCoverage <= 0.24;
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

  // A. Pure symbol/punctuation noise generated by spiky balloon edges
  const isPureSymbolNoise = asciiCompact.length === 0;
  if (isPureSymbolNoise) {
    return true;
  }

  // B. Repetitive vertical lines, slashes, or symbol junk (classic signature of spiky balloon borders, e.g. "lll", "III", "111", "I l I")
  const isVerticalLineJunk = /^[lI1|!/\\_\-s]+$/i.test(compact) && !/^[IAO]$/i.test(asciiCompact);
  if (isVerticalLineJunk) {
    return true;
  }

  // C. Single-character junk (English letters or digits that aren't valid single-letter words like I, A, O)
  const isSingleCharJunk = asciiCompact.length === 1 && !/^[IAO]$/i.test(asciiCompact);
  if (isSingleCharJunk) {
    return true;
  }

  // D. Tiny noise junk boxes
  const isKnownShortWord = /^[IAO]$/i.test(asciiCompact) || 
    /^(?:OK|NO|HI|OH|AM|AN|AS|AT|BE|BY|DO|GO|HE|IF|IN|IS|IT|ME|MY|OF|ON|OR|SO|TO|UP|US|WE|YE|AH|HA|EH|UH|LO|YA|UM|YES|FOR|AND|BUT|YOU|THE|NOT|HER|HIS|HIM|SHE|CAN|OUT|GET|HOW|WHO|WHY|HEY|BOY|RUN|SAY|SEE|MAN|OUR|DAY|NEW|TOO|ALL|ANY|BAD|BIG|CRY|DID|EAT|END|FAR|FIT|FLY|FUN|GUY|HOT|ITS|JOB|KEY|LET|LIE|LOT|MAD|MAY|MOM|DAD|OLD|ONE|TWO|OWN|PAY|SAD|SON|TRY|USE|WAY|WIN|YET|WOW|YAY|YEP|NAH|NOP)$/i.test(asciiCompact);
  const isTinyJunkBox = asciiCompact.length <= 3 && area <= 8000 && !isKnownShortWord;
  if (isTinyJunkBox) {
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
  const areaSpanRatio = Math.max(existingArea, candidateArea) / Math.max(1, Math.min(existingArea, candidateArea));
  const nearSizeMatch = areaRatio >= 0.64 && areaRatio <= 1.56;
  const existingCoverage = computePanelLineWordUnionCoverage(existingLine);
  const candidateCoverage = computePanelLineWordUnionCoverage(candidateLine);
  const dominantCoverage = Math.max(existingCoverage, candidateCoverage);
  const weakCoverage = Math.min(existingCoverage, candidateCoverage);
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

  const severeGeometryEcho = (
    overlapX >= 0.62
    && (overlapY >= 0.16 || iou >= 0.1)
    && centerDeltaX <= Math.max(104, minWidth * 1.2)
    && centerDeltaY <= Math.max(136, minHeight * 4.2)
    && areaSpanRatio >= 1.34
    && (dominantCoverage - weakCoverage) >= 0.16
    && weakCoverage <= 0.44
    && (technicalLinePair || Math.max(existingArea, candidateArea) >= 9000 || iou >= 0.22)
  );
  if (severeGeometryEcho) {
    return true;
  }

  const minLength = Math.min(existingKey.length, candidateKey.length);
  const sameOrSubset = existingKey === candidateKey
    || (minLength >= 5 && (existingKey.includes(candidateKey) || candidateKey.includes(existingKey)));
  if (!sameOrSubset) {
    const similarity = panelDedupDiceSimilarity(existingKey, candidateKey);
    if (similarity < 0.72) return false;
    if (minLength < 8 && similarity < 0.86) return false;
  }

  // On technical/document rows, collapse duplicates only when the boxes strongly match.
  if (technicalLinePair) {
    const technicalStackedEcho = (
      (sameOrSubset || panelDedupDiceSimilarity(existingKey, candidateKey) >= 0.88)
      && areaSpanRatio <= 2.8
      && overlapX >= 0.74
      && centerDeltaX <= Math.max(78, minWidth * 1.08)
      && centerDeltaY <= Math.max(142, minHeight * 4.8)
      && (overlapY >= 0.01 || iou >= 0.02)
    );
    return (
      technicalStackedEcho
      ||
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

const findTopWatermarkDialogueEchoTarget = (
  line: OCRLine,
  key: string,
  allLines: Array<{ line: OCRLine; index: number }>,
  pageWidth: number,
  pageHeight: number,
): { line: OCRLine; index: number } | null => {
  if (!key || key.length > 14) return null;
  if (key !== 'ITHINK' && key !== 'THINK') return null;
  const bbox = normalizePanelBBox(line.bbox);
  if (!bbox) return null;

  const width = Math.max(1, bbox.x1 - bbox.x0);
  const height = Math.max(1, bbox.y1 - bbox.y0);
  const area = Math.max(1, width * height);
  const centerX = (bbox.x0 + bbox.x1) * 0.5;
  const centerY = (bbox.y0 + bbox.y1) * 0.5;
  const topBand = bbox.y0 <= Math.max(160, pageHeight * 0.16) || centerY <= Math.max(190, pageHeight * 0.18);
  if (!topBand) return null;
  if (width > pageWidth * 0.44 || height > Math.max(72, pageHeight * 0.075) || area > pageWidth * pageHeight * 0.018) {
    return null;
  }

  const coverage = computePanelLineWordUnionCoverage(line);
  const lineLooksLikeTopWatermarkEcho = coverage <= 0.34 || centerX >= pageWidth * 0.58;
  const candidates = allLines.filter((candidate) => {
    if (candidate.line === line) return false;
    const candidateKey = normalizePanelDedupTextKey(candidate.line.text || '');
    if (!candidateKey) return false;
    const minLength = Math.min(key.length, candidateKey.length);
    const samePhraseFamily = key === candidateKey
      || (minLength >= 5 && (key.includes(candidateKey) || candidateKey.includes(key)));
    if (!samePhraseFamily) return false;

    const candidateBBox = normalizePanelBBox(candidate.line.bbox);
    if (!candidateBBox) return false;

    const candidateCoverage = computePanelLineWordUnionCoverage(candidate.line);
    const candidateHeight = Math.max(1, candidateBBox.y1 - candidateBBox.y0);
    const candidateCenterX = (candidateBBox.x0 + candidateBBox.x1) * 0.5;
    const candidateCenterY = (candidateBBox.y0 + candidateBBox.y1) * 0.5;
    const candidateTopBand = candidateBBox.y0 <= Math.max(160, pageHeight * 0.16)
      || candidateCenterY <= Math.max(190, pageHeight * 0.18);

    const lowerDialogueEcho = (
      lineLooksLikeTopWatermarkEcho
      && candidateBBox.y0 - bbox.y1 >= Math.max(110, pageHeight * 0.13)
      && candidateCoverage >= Math.max(0.2, coverage - 0.08)
      && candidateHeight >= Math.max(10, height * 0.72)
    );
    if (lowerDialogueEcho) return true;

    const sameTopBandRightWatermarkEcho = (
      candidateTopBand
      && centerX >= pageWidth * 0.58
      && candidateCenterX <= centerX - Math.max(96, pageWidth * 0.18)
      && Math.abs(candidateCenterY - centerY) <= Math.max(48, Math.min(height, candidateHeight) * 1.8)
      && candidateCoverage >= Math.max(0.18, coverage - 0.16)
      && candidateHeight >= Math.max(10, height * 0.62)
    );
    return sameTopBandRightWatermarkEcho;
  });

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => {
    const aBBox = normalizePanelBBox(a.line.bbox);
    const bBBox = normalizePanelBBox(b.line.bbox);
    const aLower = aBBox ? Math.max(0, aBBox.y0 - bbox.y1) : 0;
    const bLower = bBBox ? Math.max(0, bBBox.y0 - bbox.y1) : 0;
    if (aLower !== bLower) return bLower - aLower;
    if (aBBox && bBBox && aBBox.x0 !== bBBox.x0) return aBBox.x0 - bBBox.x0;
    return a.index - b.index;
  })[0];
};

const mergePanelRicherTextWithCleanerDuplicateGeometry = (
  existingLine: OCRLine,
  existingKey: string,
  candidateLine: OCRLine,
  candidateKey: string,
): OCRLine | null => {
  if (!existingKey || !candidateKey || existingKey === candidateKey) return null;
  const minLength = Math.min(existingKey.length, candidateKey.length);
  if (minLength < 5) return null;
  if (!existingKey.includes(candidateKey) && !candidateKey.includes(existingKey)) return null;

  const richer = existingKey.length > candidateKey.length ? existingLine : candidateLine;
  const cleaner = richer === existingLine ? candidateLine : existingLine;
  const richerKey = richer === existingLine ? existingKey : candidateKey;
  const cleanerKey = richer === existingLine ? candidateKey : existingKey;
  if (richerKey.length > 22 || cleanerKey.length > 16) return null;

  const richerCoverage = computePanelLineWordUnionCoverage(richer);
  const cleanerCoverage = computePanelLineWordUnionCoverage(cleaner);
  const richerArea = Math.max(1, panelLineArea(richer));
  const cleanerArea = Math.max(1, panelLineArea(cleaner));
  const richerHeight = Math.max(1, panelLineHeight(richer));
  const cleanerHeight = Math.max(1, panelLineHeight(cleaner));
  const cleanerLooksLocalized = (
    cleanerCoverage >= Math.max(0.36, richerCoverage + 0.14)
    || (cleanerArea <= richerArea * 0.58 && cleanerCoverage >= Math.max(0.24, richerCoverage))
    || cleanerHeight <= richerHeight * 0.72
  );
  const richerLooksMislocalized = richerCoverage <= 0.36
    || richerArea >= cleanerArea * 1.55
    || richerHeight >= cleanerHeight * 1.7;
  const shortThinkRepair = /^I\s*THINK[.!?…]*$/i.test(richer.text || '')
    && /^THINK[.!?…]*$/i.test(cleaner.text || '')
    && cleanerCoverage >= Math.max(0.2, richerCoverage - 0.08);

  if (!shortThinkRepair && (!cleanerLooksLocalized || !richerLooksMislocalized)) {
    return null;
  }

  const repairedText = /^I\s*THINK[.!?…]*$/i.test(richer.text || '')
    ? String(richer.text || '').replace(/^I\s*THINK/i, 'I THINK')
    : richer.text;

  return {
    ...cleaner,
    text: repairedText,
    confidence: Math.max(Number(cleaner.confidence || 0), Number(richer.confidence || 0)),
    layoutHints: {
      ...(cleaner.layoutHints || {}),
      repairedTextFromDuplicate: repairedText,
    },
  };
};

/**
 * Detects and removes "displaced prefix echoes" — ghost OCR lines whose text is a
 * true prefix/substring of a longer, better-placed line on the same page.
 *
 * Handles two distinct ghost patterns caused by spiky balloon borders:
 *
 * Case A – Spatially detached: PaddleOCR detects a small piece of the border edge
 *   as an independent text region (e.g. top-right spike area), displaced from the
 *   real dialogue bbox at the balloon center.
 *
 * Case B – Wrapping border: PaddleOCR assigns one very large bbox covering the entire
 *   spiky circle (border + interior). The text reads correctly but the bbox is 2–4×
 *   larger than the actual text region, giving very low word coverage. The real line
 *   (smaller, tightly-fitted) also exists as a separate detection.
 *
 * The ratio-based filters in isLikelyLargeBorderEffectLineForSafety break down on
 * extremely tall pages (e.g. 930×13964 OCR renders) because all height/area ratios
 * become negligibly small relative to page size, so we need pair-wise comparison.
 */
const suppressDisplacedPrefixEchoes = (
  items: Array<{ line: OCRLine; index: number }>,
): { items: Array<{ line: OCRLine; index: number }>; dropped: OCRDroppedWord[] } => {
  if (items.length <= 1) return { items, dropped: [] };

  const droppedIndexes = new Set<number>();
  const dropped: OCRDroppedWord[] = [];

  for (let i = 0; i < items.length; i++) {
    const ghostItem = items[i];
    if (droppedIndexes.has(ghostItem.index)) continue;

    const ghostText = normalizePreviewText(String(ghostItem.line.text || ''));
    const ghostKey = normalizePanelDedupTextKey(ghostText);
    // Only consider lines with meaningful content (>= 8 collapsed chars, 2–7 tokens)
    if (!ghostKey || ghostKey.length < 8) continue;
    const ghostTokens = ghostText.split(/\s+/g).filter(Boolean).length;
    if (ghostTokens < 2 || ghostTokens > 7) continue;

    // Ghost must have notably low word coverage — bbox much larger than the actual words
    const ghostCoverage = computePanelLineWordUnionCoverage(ghostItem.line);
    if (ghostCoverage > 0.44) continue;

    const ghostArea = panelLineArea(ghostItem.line);
    const ghostCenterX = panelLineCenterX(ghostItem.line);
    const ghostCenterY = panelLineCenterY(ghostItem.line);
    const ghostWidth = Math.max(24, panelLineWidth(ghostItem.line));
    const ghostHeight = Math.max(8, panelLineHeight(ghostItem.line));
    const ghostBBox = ghostItem.line.bbox;

    for (let j = 0; j < items.length; j++) {
      if (i === j || droppedIndexes.has(items[j].index)) continue;

      const realItem = items[j];
      const realKey = normalizePanelDedupTextKey(realItem.line.text || '');

      // realKey must be substantially longer AND contain the ghost key as prefix/substring
      if (!realKey || realKey.length < ghostKey.length + 8) continue;
      if (!realKey.includes(ghostKey)) continue;

      // Real line must have clearly better word coverage
      const realCoverage = computePanelLineWordUnionCoverage(realItem.line);
      if (realCoverage < ghostCoverage + 0.1 || realCoverage < 0.28) continue;

      const iou = panelIoURatio(ghostItem.line, realItem.line);
      const overlapX = panelOverlapRatioX(ghostItem.line, realItem.line);
      const overlapY = panelOverlapRatioY(ghostItem.line, realItem.line);
      const realArea = panelLineArea(realItem.line);
      const realCenterX = panelLineCenterX(realItem.line);
      const realCenterY = panelLineCenterY(realItem.line);
      const centerDeltaY = Math.abs(ghostCenterY - realCenterY);
      const centerDeltaX = Math.abs(ghostCenterX - realCenterX);

      // Case A: ghost bbox is spatially detached — small displaced piece at balloon edge
      const spatiallyDetached = (
        iou <= 0.22
        && (overlapX <= 0.62 || overlapY <= 0.52)
        && centerDeltaY <= Math.max(420, ghostHeight * 22)
        && centerDeltaX <= Math.max(420, ghostWidth * 6.5)
      );

      // Case B: ghost bbox wraps the real text — entire spiky circle covering interior text.
      // Ghost is substantially LARGER than real and real's center lies inside ghost bbox.
      const wrappingBorder = (
        ghostArea >= realArea * 1.55
        && ghostCoverage <= 0.36
        && realCoverage >= 0.38
        && ghostBBox != null
        && Number(ghostBBox.x0) <= realCenterX
        && Number(ghostBBox.x1) >= realCenterX
        && Number(ghostBBox.y0) <= realCenterY
        && Number(ghostBBox.y1) >= realCenterY
      );

      if (!spatiallyDetached && !wrappingBorder) continue;

      // Ghost is a displaced prefix echo — mark it for removal
      droppedIndexes.add(ghostItem.index);
      dropped.push({
        filter: 'panelSafetyDedup',
        reason: 'displacedPrefixEcho',
        text: ghostText,
        confidence: Number(ghostItem.line.confidence || 0),
        bbox: ghostItem.line.bbox,
      });
      break;
    }
  }

  if (droppedIndexes.size === 0) return { items, dropped: [] };
  return {
    items: items.filter((item) => !droppedIndexes.has(item.index)),
    dropped,
  };
};

const suppressDisplacedPanelLongPhraseEchoes = (
  items: Array<{ line: OCRLine; index: number }>,
): { items: Array<{ line: OCRLine; index: number }>; dropped: OCRDroppedWord[] } => {
  if (items.length <= 1) {
    return { items, dropped: [] };
  }

  type LineMetric = {
    item: { line: OCRLine; index: number };
    key: string;
    tokenCount: number;
    wordCount: number;
    coverage: number;
    confidence: number;
    area: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
    score: number;
  };

  const grouped = new Map<string, LineMetric[]>();
  items.forEach((item) => {
    const text = normalizePreviewText(String(item.line.text || ''));
    const key = normalizePanelDedupTextKey(text);
    if (!key) return;

    const tokenCount = text.split(/\s+/g).filter(Boolean).length;
    if (key.length < 14 || tokenCount < 3 || tokenCount > 12) return;

    const coverage = computePanelLineWordUnionCoverage(item.line);
    const words = (Array.isArray(item.line.words) ? item.line.words : [])
      .filter((word) => hasPositivePanelBBox(word?.bbox) && normalizePreviewText(String(word?.text || '')).length > 0);
    const wordCount = words.length > 0 ? words.length : tokenCount;
    const confidence = Number(item.line.confidence || 0);
    const area = Math.max(1, panelLineArea(item.line));
    const width = Math.max(1, panelLineWidth(item.line));
    const height = Math.max(1, panelLineHeight(item.line));
    const centerX = panelLineCenterX(item.line);
    const centerY = panelLineCenterY(item.line);
    const score = (coverage * 120) + (wordCount * 9) + (confidence * 0.22) - (Math.log10(area) * 6);

    const metric: LineMetric = {
      item,
      key,
      tokenCount,
      wordCount,
      coverage,
      confidence,
      area,
      width,
      height,
      centerX,
      centerY,
      score,
    };
    const current = grouped.get(key) || [];
    current.push(metric);
    grouped.set(key, current);
  });

  const droppedIndexes = new Set<number>();
  const dropped: OCRDroppedWord[] = [];

  grouped.forEach((metrics) => {
    if (metrics.length <= 1) return;
    const ordered = [...metrics].sort((a, b) => b.score - a.score);
    const anchor = ordered[0];
    if (!anchor) return;

    for (let i = 1; i < ordered.length; i += 1) {
      const candidate = ordered[i];
      if (!candidate || droppedIndexes.has(candidate.item.index)) continue;

      const overlapX = panelOverlapRatioX(anchor.item.line, candidate.item.line);
      const overlapY = panelOverlapRatioY(anchor.item.line, candidate.item.line);
      const minWidth = Math.max(24, Math.min(anchor.width, candidate.width));
      const minHeight = Math.max(8, Math.min(anchor.height, candidate.height));
      const centerDeltaX = Math.abs(anchor.centerX - candidate.centerX);
      const centerDeltaY = Math.abs(anchor.centerY - candidate.centerY);
      const areaRatio = candidate.area / Math.max(1, anchor.area);
      const widthRatio = candidate.width / Math.max(1, anchor.width);
      const heightRatio = candidate.height / Math.max(1, anchor.height);

      const spatiallyDetached = (
        overlapX <= 0.44
        || overlapY <= 0.34
        || centerDeltaX >= Math.max(96, minWidth * 1.2)
        || centerDeltaY >= Math.max(78, minHeight * 1.45)
      );
      const clearlyOversized = areaRatio >= 1.55 || widthRatio >= 1.42 || heightRatio >= 1.55;
      const lowCoverageEcho = candidate.coverage <= Math.max(0.34, anchor.coverage - 0.14);
      const weakerSignal = candidate.wordCount <= anchor.wordCount
        && candidate.confidence <= anchor.confidence + 4;

      if (!(spatiallyDetached && clearlyOversized && lowCoverageEcho && weakerSignal)) {
        continue;
      }

      droppedIndexes.add(candidate.item.index);
      dropped.push({
        filter: 'panelSafetyDedup',
        reason: 'displacedLongPhraseEcho',
        text: normalizePreviewText(String(candidate.item.line.text || '')),
        confidence: Number(candidate.item.line.confidence || 0),
        bbox: candidate.item.line.bbox,
      });
    }
  });

  if (droppedIndexes.size === 0) {
    return { items, dropped: [] };
  }

  return {
    items: items.filter((item) => !droppedIndexes.has(item.index)),
    dropped,
  };
};

const applyPanelSafetyLineDedup = (result: OCRPageResult): OCRPageResult => {
  const inputLines = Array.isArray(result.lines) ? result.lines : [];
  if ((result.pipelineProfile || 'panel') !== 'panel') {
    return result;
  }
  if ((result.ocrEngine || 'tesseract') !== 'paddleocr') {
    return result;
  }

  const markPanelSafetyNormalized = (value: OCRPageResult): OCRPageResult => {
    const debug = value.debug || { droppedWords: [], dropCounts: {} };
    return {
      ...value,
      debug: {
        ...debug,
        droppedWords: debug.droppedWords || [],
        dropCounts: debug.dropCounts || {},
        panelSafetyNormalizedVersion: OCR_ALGORITHM_VERSION,
      },
    };
  };

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
        && wordCoverage <= 0.12
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

  const echoTextRepairs = new Map<number, { text: string; confidence: number }>();
  const watermarkFilteredLines = preparedLines.filter((item) => {
    const key = normalizePanelDedupTextKey(item.line.text || '');
    const echoTarget = findTopWatermarkDialogueEchoTarget(item.line, key, preparedLines, pageWidth, pageHeight);
    if (!echoTarget) {
      return true;
    }
    const targetKey = normalizePanelDedupTextKey(echoTarget.line.text || '');
    if (key.length > targetKey.length) {
      const existingRepair = echoTextRepairs.get(echoTarget.index);
      if (!existingRepair || key.length > normalizePanelDedupTextKey(existingRepair.text).length) {
        const repairedEchoText = /^I\s*THINK[.!?…]*$/i.test(item.line.text || '')
          ? String(item.line.text || '').replace(/^I\s*THINK/i, 'I THINK')
          : normalizePreviewText(String(item.line.text || ''));
        echoTextRepairs.set(echoTarget.index, {
          text: repairedEchoText,
          confidence: Number(item.line.confidence || 0),
        });
      }
    }
    dropped.push({
      filter: 'panelSafetyDedup',
      reason: 'ghostTopWatermarkDialogueEcho',
      text: normalizePreviewText(String(item.line.text || '')),
      confidence: Number(item.line.confidence || 0),
      bbox: item.line.bbox,
    });
    return false;
  });

  const repairedWatermarkFilteredLines = watermarkFilteredLines.map((item) => {
    const repair = echoTextRepairs.get(item.index);
    if (!repair) return item;
    const currentKey = normalizePanelDedupTextKey(item.line.text || '');
    const repairKey = normalizePanelDedupTextKey(repair.text);
    if (!repairKey || repairKey.length <= currentKey.length) return item;
    normalizedTextChanges += 1;
    return {
      ...item,
      line: {
        ...item.line,
        text: repair.text,
        confidence: Math.max(Number(item.line.confidence || 0), repair.confidence),
        layoutHints: {
          ...(item.line.layoutHints || {}),
          repairedTextFromDialogueEcho: repair.text,
        },
      },
    };
  });

  const displacedEchoPrune = suppressDisplacedPanelLongPhraseEchoes(repairedWatermarkFilteredLines);
  if (displacedEchoPrune.dropped.length > 0) {
    dropped.push(...displacedEchoPrune.dropped);
  }

  // NEW: suppress ghost border prefix echoes (e.g. spiky balloon edge detected with partial dialogue text)
  const prefixEchoPrune = suppressDisplacedPrefixEchoes(displacedEchoPrune.items);
  if (prefixEchoPrune.dropped.length > 0) {
    dropped.push(...prefixEchoPrune.dropped);
  }
  const dedupInputLines = prefixEchoPrune.items;

  const orderedLines = dedupInputLines
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
    const coverage = computePanelLineWordUnionCoverage(line);
    return (confidence * 2.2) + textLength + (Math.log10(panelLineArea(line)) * 2.8) + (coverage * 28);
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
    const existingKey = keptKeys[existingIndex];
    const repairedLine = mergePanelRicherTextWithCleanerDuplicateGeometry(
      existingLine,
      existingKey,
      candidateLine,
      candidateKey,
    );
    if (repairedLine) {
      const loserLine = candidateKey.length > existingKey.length ? candidateLine : existingLine;
      dropped.push({
        filter: 'panelSafetyDedup',
        reason: 'samePositionDuplicateLineTextGeometryRepair',
        text: String(loserLine.text || '').trim(),
        confidence: Number(loserLine.confidence || 0),
        bbox: loserLine.bbox,
      });
      kept[existingIndex] = repairedLine;
      keptKeys[existingIndex] = normalizePanelDedupTextKey(repairedLine.text || '');
      continue;
    }

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
    return markPanelSafetyNormalized(result);
  }

  const originalOrder = new Map<OCRLine, number>();
  dedupInputLines.forEach(({ line, index }) => {
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

  return markPanelSafetyNormalized({
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
  });
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
    setPageOCRForEngine,
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
  const layersByPage = useLayerStore((state) => state.layersByPage);
  const currentPageLayers = layersByPage.get(currentPage) || [];

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
  const translationCacheRowsByPageRef = useRef<Map<string, Array<OCRTranslationCacheEntry>>>(new Map());
  const aliasCandidateCacheRef = useRef<Map<string, DBDocumentCacheCandidate[]>>(new Map());
  const aliasCandidateInFlightRef = useRef<Map<string, Promise<DBDocumentCacheCandidate[]>>>(new Map());
  const ocrPreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const ocrPreviewSearchHeaderRef = useRef<HTMLDivElement | null>(null);
  const ocrPreviewLineRefs = useRef<Map<number, HTMLParagraphElement>>(new Map());
  // Tracks page+engine combos that were explicitly cleared by the user.
  // Alias probing is blocked for these keys until the file/pipeline resets.
  const clearedCacheKeysRef = useRef<Set<string>>(new Set());
      const warmTimerIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [engineWarmStates, setEngineWarmStates] = useState<Record<string, EngineWarmState>>(() => ({ ...SESSION_ENGINE_WARM_STATES }));
  const pendingEngineSelectionRef = useRef<OCREngine | null>(null);
  const warmAnimationTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const externalProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Tracks when the current OCR job started — used to compute estimated time remaining */
  const ocrStartTimeRef = useRef<number | null>(null);
  const pageStartAtRef = useRef<number | null>(null);
  const lastProgressPageRef = useRef<number>(0);
  const pageDurationsRef = useRef<number[]>([]);
  const etaLabelRef = useRef<string | null>(null);
  const etaUpdatedAtRef = useRef<number>(0);
  const benchmarkAbortRef = useRef<AbortController | null>(null);
  const translationContextKeyRef = useRef<string>('');
  const translationCacheSessionKey = `${file?.name || fileUrl || 'unknown-file'}:${currentPage}`;
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkTargetPage, setBenchmarkTargetPage] = useState<number | null>(null);
  const [benchmarkMode, setBenchmarkMode] = useState<BenchmarkMode>('baseline');
  const [showMetricsInfo, setShowMetricsInfo] = useState(false);
  const [cacheActionMessage, setCacheActionMessage] = useState<string>('');
  const [ocrInfoOpen, setOcrInfoOpen] = useState(false);
  const [ocrQualityMode, setOcrQualityMode] = useState<'high' | 'fast'>('fast');
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
      efficiency: null,
      rawAxis: null,
      lexicalAxis: null,
      yieldAxis: null,
      werError: null,
      cerError: null,
      garbageRatio: null,
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

  // Reset ETA start-time whenever a job starts or stops
  useEffect(() => {
    if (isProcessing) {
      ocrStartTimeRef.current = Date.now();
      pageStartAtRef.current = null;
      lastProgressPageRef.current = 0;
      pageDurationsRef.current = [];
    } else {
      ocrStartTimeRef.current = null;
      pageStartAtRef.current = null;
      lastProgressPageRef.current = 0;
      pageDurationsRef.current = [];
      etaLabelRef.current = null;
      etaUpdatedAtRef.current = 0;
    }
  }, [isProcessing]);

  useEffect(() => {
    if (!isProcessing) return;
    const currentPage = progress?.currentPage ?? 0;
    const totalPages = progress?.totalPages ?? 0;
    if (currentPage <= 0 || totalPages <= 1) return;

    const now = Date.now();
    if (currentPage !== lastProgressPageRef.current) {
      if (lastProgressPageRef.current > 0 && pageStartAtRef.current !== null) {
        const durationMs = now - pageStartAtRef.current;
        if (durationMs > 250) {
          pageDurationsRef.current.push(durationMs);
        }
      }
      lastProgressPageRef.current = currentPage;
      pageStartAtRef.current = now;
    }

    if (progress?.stage === 'complete') {
      pageStartAtRef.current = null;
      lastProgressPageRef.current = 0;
    }
  }, [isProcessing, progress?.currentPage, progress?.stage, progress?.totalPages]);

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
    // PaddleOCR cold-start includes potential model download from paddlex servers
    // (th_PP-OCRv5_mobile_rec + PP-OCRv5_mobile_det can take 2-5 min on first run).
    // Use a generous 3-min window so the bar doesn't appear "stuck" before download finishes.
    const expectedMs = phase === 'checking'
      ? 8000
      : engine === 'paddleocr'
        ? 180000  // 3 min — covers model download + load
        : 28000;
    const phaseStart = phase === 'checking' ? 8 : 34;
    const phaseCap = phase === 'checking' ? 28 : 92;

    const tick = () => {
      const elapsedMs = Date.now() - startedAt;
      const ratio = Math.min(0.97, elapsedMs / expectedMs);
      const progress = Math.min(phaseCap, phaseStart + ((phaseCap - phaseStart) * ratio));
      const etaSec = Math.max(1, Math.ceil((expectedMs - elapsedMs) / 1000));
      const description = phase === 'checking'
        ? 'Checking local OCR runtime...'
        : engine === 'paddleocr'
          ? elapsedMs < 10000
            ? 'Preparing PaddleOCR runtime...'
            : elapsedMs < 35000
              ? 'Downloading / loading detection model...'
              : elapsedMs < 90000
                ? 'Downloading / loading recognition model...'
                : 'Warming PaddleOCR pipeline...'
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
    // Cold-start budget includes potential model download on first run (~2-5 min).
    // Warm-start is much faster since the model is cached in memory.
    let expectedMs = engine === 'paddleocr'
      ? (engineReadyForLanguage ? 28000 : 240000)  // cold: 4 min (download+load+infer)
      : (engineReadyForLanguage ? 14000 : 40000);

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
          Math.max(2200, Math.round(imageWidth * 1.05)),
          Math.max(2200, Math.round(imageHeight * 0.48)),
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
      // Linear progress from 18% → 90% within expectedMs,
      // then logarithmic tail that grows very slowly — prevents the bar from
      // appearing frozen at 98% when a model download takes longer than expected.
      const warmupProgress = 18 + ((Math.min(elapsedMs, expectedMs) / expectedMs) * 72);
      const overrunMs = Math.max(0, elapsedMs - expectedMs);
      // Tail: approaches 99 asymptotically (never actually reaches it)
      const tailProgress = elapsedMs > expectedMs
        ? Math.min(99, 90 + (Math.log1p(overrunMs / 12000) * 3.2))
        : warmupProgress;
      const progressValue = Math.max(18, Math.min(99, tailProgress));
      const statusText = engine === 'paddleocr'
        ? !engineReadyForLanguage && elapsedMs < 11000
          ? 'Preparing PaddleOCR runtime...'
          : !engineReadyForLanguage && elapsedMs < 40000
            ? 'Downloading / loading detection model...'
            : !engineReadyForLanguage && elapsedMs < 120000
              ? 'Downloading / loading recognition model...'
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
      .map(v => v.trim().toLowerCase())
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
    if (
      scriptGated.pipelineProfile === 'panel'
      && scriptGated.debug?.panelSafetyNormalizedVersion === OCR_ALGORITHM_VERSION
    ) {
      return scriptGated;
    }
    return applyPanelSafetyLineDedup(scriptGated);
  }, [options.language]);

  const isCacheCompatible = useCallback((cached: OCRPageResult): boolean => {
    if (normalizeLanguage(cached.language) !== normalizeLanguage(options.language)) return false;
    if (cached.dpi !== options.dpi) return false;
    
    const activeEngine = options.engine || 'tesseract';
    if (activeEngine === 'tesseract' && options.pageSegMode !== undefined && cached.pageSegMode !== options.pageSegMode) {
      return false;
    }
    
    if (cached.algorithmVersion !== OCR_ALGORITHM_VERSION) return false;
    if ((cached.ocrEngine || 'tesseract') !== activeEngine) return false;
    return true;
  }, [options, normalizeLanguage]);

  const isCacheCompatibleForEngine = useCallback((cached: OCRPageResult, engine: OCREngine): boolean => {
    if (normalizeLanguage(cached.language) !== normalizeLanguage(options.language)) return false;
    if (cached.dpi !== options.dpi) return false;
    
    if (engine === 'tesseract' && options.pageSegMode !== undefined && cached.pageSegMode !== options.pageSegMode) {
      return false;
    }
    
    if (cached.algorithmVersion !== OCR_ALGORITHM_VERSION) return false;
    if ((cached.ocrEngine || 'tesseract') !== engine) return false;
    return true;
  }, [normalizeLanguage, options.dpi, options.language, options.pageSegMode]);

  const isDisplayCacheCompatible = useCallback((cached: OCRPageResult): boolean => {
    if (!cached || !Array.isArray(cached.words) || !Array.isArray(cached.lines)) return false;
    if (cached.words.length === 0 && cached.lines.length === 0 && !(cached.text || '').trim()) return false;
    if (normalizeLanguage(cached.language) !== normalizeLanguage(options.language)) return false;
    if (cached.algorithmVersion !== OCR_ALGORITHM_VERSION) return false;
    if ((cached.ocrEngine || 'tesseract') !== (options.engine || 'tesseract')) return false;
    return true;
  }, [normalizeLanguage, options.engine, options.language]);

  const isDisplayCacheCompatibleForEngine = useCallback((cached: OCRPageResult, eng: OCREngine): boolean => {
    if (!cached || !Array.isArray(cached.words) || !Array.isArray(cached.lines)) return false;
    if (cached.words.length === 0 && cached.lines.length === 0 && !(cached.text || '').trim()) return false;
    if (normalizeLanguage(cached.language) !== normalizeLanguage(options.language)) return false;
    if (cached.algorithmVersion !== OCR_ALGORITHM_VERSION) return false;
    if ((cached.ocrEngine || 'tesseract') !== eng) return false;
    return true;
  }, [normalizeLanguage, options.language]);

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

      const loadOtherEnginesFromDB = async (
        docId: number,
        pNum: number,
        actEngine: OCREngine,
        actFile: File | null
      ) => {
        const enginesToLoad = (['tesseract', 'paddleocr', 'easyocr'] as OCREngine[]).filter(
          (eng) => eng !== actEngine
        );

        for (const eng of enginesToLoad) {
          try {
            const otherCached = await dbService.getOCR(docId, pNum, eng);
            if (otherCached && isDisplayCacheCompatibleForEngine(otherCached, eng)) {
              if (useProjectStore.getState().file !== actFile) continue;
              otherCached.pageNumber = pNum;
              setPageOCRForEngine(pNum, eng, normalizeCacheProfile(otherCached));
              console.log(`[OCRPanel] Background loaded DB cache for page ${pNum} engine=${eng}`);
            }
          } catch (err) {
            console.warn(`[OCRPanel] Failed to load background cache for page ${pNum} engine=${eng}:`, err);
          }
        }
      };

      const loadOtherEnginesBackground = async (pNum: number) => {
        const docId = await ensureDocumentId().catch(() => null);
        if (!docId) return;
        const state = useOCRTextLayerStore.getState();
        const enginesToLoad = (['tesseract', 'paddleocr', 'easyocr'] as OCREngine[]).filter((eng) => {
          const cachedInMemory = state.ocrByPageEngine.get(pNum)?.get(eng);
          return !cachedInMemory;
        });

        for (const eng of enginesToLoad) {
          try {
            const otherCached = await dbService.getOCR(docId, pNum, eng);
            if (otherCached && isDisplayCacheCompatibleForEngine(otherCached, eng)) {
              otherCached.pageNumber = pNum;
              setPageOCRForEngine(pNum, eng, normalizeCacheProfile(otherCached));
              console.log(`[OCRPanel] Background loaded DB cache (memory hit pathway) for page ${pNum} engine=${eng}`);
            }
          } catch (err) {
            console.warn(`[OCRPanel] Background loading other engine ${eng} failed:`, err);
          }
        }
      };

      const memoryCachedByEngine = state.ocrByPageEngine.get(pageNum)?.get(activeEngine);
      if (memoryCachedByEngine && isDisplayCacheCompatible(memoryCachedByEngine)) {
        if (useProjectStore.getState().file !== activeFile) return false;
        setPageOCR(pageNum, normalizeCacheProfile(memoryCachedByEngine));
        void loadOtherEnginesBackground(pageNum);
        return true;
      }

      const memoryCached = state.allPagesOCR.get(pageNum);
      if (memoryCached && isDisplayCacheCompatible(memoryCached)) {
        const memoryEngine = String(memoryCached.ocrEngine || 'tesseract').toLowerCase();
        if (memoryEngine === activeEngine.toLowerCase()) {
          if (useProjectStore.getState().file !== activeFile) return false;
          setPageOCR(pageNum, normalizeCacheProfile(memoryCached));
          void loadOtherEnginesBackground(pageNum);
          return true;
        }
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
      let activeLoaded = false;
      if (cached && isDisplayCacheCompatible(cached)) {
        if (useProjectStore.getState().file !== activeFile) return false;

        // Final sanity check: ensure the engine in the data matches what we asked for
        const dataEngine = (cached.ocrEngine || 'tesseract').toLowerCase();
        if (dataEngine === activeEngine.toLowerCase()) {
          cached.pageNumber = pageNum;
          setPageOCR(pageNum, normalizeCacheProfile(cached));
          activeLoaded = true;
        }
      }

      // Pre-load all other engines in background so cross-engine fuzzy match works
      void loadOtherEnginesFromDB(cacheDocId, pageNum, activeEngine, activeFile);

      if (activeLoaded) {
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
            // Pre-load other engines for the matched candidate id
            void loadOtherEnginesFromDB(matchedAlias.candidate.id, pageNum, activeEngine, activeFile);
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
  }, [activePipelineProfile, ensureDocumentId, file, getFilenameCandidates, isCacheCompatible, isDisplayCacheCompatible, isDisplayCacheCompatibleForEngine, normalizeCacheProfile, setPageOCR, setPageOCRForEngine]);

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
    // NOTE: We intentionally do NOT sync ocrEngine here.
    // syncOptionsFromLatestCache is meant to restore the language/segMode used last time,
    // but the user may have explicitly switched to a different engine (e.g., paddleocr vs easyocr).
    // Auto-changing the engine causes the silent bug where paddleocr silently becomes easyocr
    // after app reload because the DB stores the most recently run engine (which could be easyocr).

    if (Object.keys(nextPatch).length > 0) {
      setOptions(nextPatch);
    }
  }, [ensureDocumentId, file, normalizeLanguage, options.language, options.pageSegMode, setOptions]);

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

      const selectedEngine = (useOCRTextLayerStore.getState().options.engine || 'tesseract') as OCREngine;
      let cacheOwnerDocId = docId;
      let rows = translationCacheRowsByPageRef.current.get(translationCacheSessionKey);
      if (!rows) {
        rows = await dbService.getTranslationCachePage(docId, currentPage);
      }
      const hasSelectedEngineRows = Array.isArray(rows)
        && rows.some((row) => String(row.ocrEngine || 'tesseract').toLowerCase() === selectedEngine);
      if (Array.isArray(rows)) {
        const engineSummary = rows.reduce<Record<string, number>>((acc, row) => {
          const key = String(row.ocrEngine || 'tesseract').toLowerCase();
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {});
        console.log(
          `[OCRPanel] Translation cache rows page=${currentPage} docId=${docId} total=${rows.length} engines=${JSON.stringify(engineSummary)}`
        );
      }

      if (((!rows || rows.length === 0) || !hasSelectedEngineRows) && file?.name) {
        const aliasLookupStart = Date.now();
        const aliasCandidates = await getFilenameCandidates(file.name, {
          excludeDocId: docId,
          requireCachePages: true,
          limit: 8,
        });

        if (aliasCandidates.length > 0) {
          console.log(
            `[OCRPanel] Alias translation probe candidates=${aliasCandidates.length} page=${currentPage} engine=${selectedEngine} resolved in ${Date.now() - aliasLookupStart}ms`
          );

          const aliasRowsByCandidate = await Promise.all(
            aliasCandidates.map(async (candidate) => ({
              candidate,
              rows: await dbService.getTranslationCachePage(candidate.id, currentPage).catch(() => []),
            }))
          );

          const matched = aliasRowsByCandidate.find((item) => Array.isArray(item.rows)
            && item.rows.some((row) => String(row.ocrEngine || 'tesseract').toLowerCase() === selectedEngine));
          if (matched) {
            rows = matched.rows;
            cacheOwnerDocId = matched.candidate.id;
            console.log(
              `[OCRPanel] Translation cache alias hit page=${currentPage} docId=${cacheOwnerDocId} engine=${selectedEngine} rows=${rows.length}`
            );
          }
        }
      }

      if (canceled || rows.length === 0) return;
      translationCacheRowsByPageRef.current.set(translationCacheSessionKey, rows);

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

      const ocrState = useOCRTextLayerStore.getState();
      const activeKey = ocrState.getActiveTranslationCacheKey(currentPage);
      const activeEntry = activeKey ? ocrState.getTranslationCacheEntry(currentPage, activeKey) : undefined;
      if (!activeEntry || activeEntry.translatedByIndex.length === 0) return;

      const layerStore = useLayerStore.getState();
      const pageLayers = layerStore.getPageLayers(currentPage);
      if (pageLayers.length === 0) return;

      const translatedByIndex = new Map<number, string>(
        activeEntry.translatedByIndex
          .filter((item) => Number.isFinite(item.index) && String(item.text || '').trim().length > 0)
          .map((item) => [item.index, item.text])
      );

      if (translatedByIndex.size === 0) return;

      let hasLayerChanges = false;
      const updatedPageLayers = pageLayers.map((layer) => {
        const translatedText = translatedByIndex.get(layer.lineIndex);
        if (!translatedText || layer.userEdited) return layer;
        if (layer.text === translatedText && layer.translatedText === translatedText && layer.translationEngineUsed === activeEntry.translatorEngine) {
          return layer;
        }
        hasLayerChanges = true;
        return {
          ...layer,
          translatedText,
          text: translatedText,
          translationEngineUsed: activeEntry.translatorEngine,
        };
      });

      if (!hasLayerChanges) return;

      layerStore.setPageLayers(currentPage, {
        layers: updatedPageLayers,
        groups: layerStore.getPageGroups(currentPage),
      });
    })();

    return () => {
      canceled = true;
    };
  }, [currentPage, currentPageLayers, ensureDocumentId, file, getFilenameCandidates, options.engine, setTranslationCacheEntry]);

  useEffect(() => {
    if (!file) {
      translationCacheRowsByPageRef.current.clear();
      return;
    }

    const pageMap = translationCacheByPage.get(currentPage);
    if (!pageMap || pageMap.size === 0) return;

    translationCacheRowsByPageRef.current.set(
      translationCacheSessionKey,
      Array.from(pageMap.values())
    );
  }, [currentPage, file, translationCacheByPage, translationCacheSessionKey]);

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

  const matchesTranslationEntrySelection = (entry: OCRTranslationCacheEntry): boolean => {
    if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
    if (entry.ocrEngine !== selectedOcrEngine) return false;
    if (entry.translationMode !== translationMode) return false;
    if (normalizeTranslationLanguageKey(entry.sourceLanguage || '', 'en') !== normalizedContextSourceLanguage) return false;
    if (normalizeTranslationLanguageKey(entry.targetLanguage || '', 'th') !== normalizedContextTargetLanguage) return false;
    return normalizeCacheLanguageKey(entry.ocrLanguage) === normalizedContextOCRLanguage;
  };

  const matchesTranslationEntryEngineFallback = (entry: OCRTranslationCacheEntry): boolean => {
    if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
    if (entry.ocrEngine !== selectedOcrEngine) return false;
    if (normalizeTranslationLanguageKey(entry.targetLanguage || '', 'th') !== normalizedContextTargetLanguage) return false;
    return entry.translatedByIndex.length > 0 || Boolean(entry.translatedText?.trim());
  };

  const matchesTranslationEntryCrossEngine = (entry: OCRTranslationCacheEntry): boolean => {
    if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
    if (normalizeTranslationLanguageKey(entry.targetLanguage || '', 'th') !== normalizedContextTargetLanguage) return false;
    return entry.translatedByIndex.length > 0 || Boolean(entry.translatedText?.trim());
  };

  const getTranslationEntryMatchRank = (entry: OCRTranslationCacheEntry): number => {
    if (matchesTranslationEntryContext(entry)) return 4;
    if (matchesTranslationEntrySelection(entry)) return 3;
    if (matchesTranslationEntryEngineFallback(entry)) return 2;
    if (matchesTranslationEntryCrossEngine(entry)) return 1;
    return 0;
  };

  const hasThaiTranslation = (entry: OCRTranslationCacheEntry): boolean => {
    if (normalizedContextTargetLanguage !== 'th') return false;
    const sample = [
      entry.translatedText || '',
      ...entry.translatedByIndex.map((item) => String(item.text || '')),
    ].join(' ');
    return /[\u0E00-\u0E7F]/.test(sample);
  };

  const pickBestTranslationEntry = (entries: OCRTranslationCacheEntry[]): OCRTranslationCacheEntry | undefined => {
    if (entries.length === 0) return undefined;
    return entries
      .slice()
      .sort((a, b) => {
        const thaiDiff = Number(hasThaiTranslation(b)) - Number(hasThaiTranslation(a));
        if (thaiDiff !== 0) return thaiDiff;
        const rankDiff = getTranslationEntryMatchRank(b) - getTranslationEntryMatchRank(a);
        if (rankDiff !== 0) return rankDiff;
        return b.createdAt - a.createdAt;
      })[0];
  };

  const activeTranslationEntryMatchesContext = Boolean(
    activeTranslationEntry
    && matchesTranslationEntryContext(activeTranslationEntry)
  );
  const preferredEntryForCurrentModel = pickBestTranslationEntry(
    currentPageTranslationEntries.filter((entry) => matchesTranslationEntryContext(entry))
  );
  const candidateEntries = currentPageTranslationEntries.filter((entry) => getTranslationEntryMatchRank(entry) > 0);
  const fallbackEntryForCurrentModel = pickBestTranslationEntry(candidateEntries);
  const resolvedTranslationEntry = fallbackEntryForCurrentModel;
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
    const nextPreferred = fallbackEntryForCurrentModel;
    if (!nextPreferred) return;
    if (activeTranslationKey === nextPreferred.key) return;
    if (activeTranslationEntryMatchesContext) return;
    setActiveTranslationCacheKey(currentPage, nextPreferred.key);
    setTranslationPreviewMode('translated');
  }, [
    activeTranslationEntryMatchesContext,
    activeTranslationKey,
    currentPage,
    fallbackEntryForCurrentModel,
    setActiveTranslationCacheKey,
    setTranslationPreviewMode,
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

    const nextPreferred = fallbackEntryForCurrentModel;
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
    fallbackEntryForCurrentModel,
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
      const sourceText = normalizePreviewText(String(line.text || ''));
      const sourceKey = normalizePreviewText(sourceText).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const translatedKey = normalizePreviewText(String(translated || '')).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      const fallbackText = (!translated || (sourceKey && sourceKey === translatedKey))
        ? resolveMissingOverlayLineFallbackText(sourceText, targetLanguage)
        : translated;
      return { ...line, text: fallbackText || translated || sourceText };
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
        text: normalizePreviewText([
          String(line.text || ''),
          String(previewSourceOCR?.lines?.[lineIndex]?.text || ''),
        ].join(' ')),
      }))
      .filter((entry) => hasTextSearchMatch(entry.text, previewSearchPattern))
      .map((entry) => entry.lineIndex)
    : [];
  const previewMatchedLineIndexSet = new Set<number>(previewMatchedLineIndexes);
  const previewSearchMatchCount = previewSearchPattern
    ? collectTextSearchMatches([
      previewText,
      effectivePreviewMode === 'translated'
        ? (previewSourceOCR?.lines || []).map((line) => String(line.text || '')).join('\n')
        : '',
    ].join('\n'), previewSearchPattern).length
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
      if (ocrQualityMode === 'high') {
        return {
          maxSide:20000,
          maxPixels:23_000_000,
          minWidth: null,
          tallPageBoost: {
            minAspectRatio: 2.35,
            minLongSide: 9000,
            boostedMaxSide: 20000,
            boostedMaxPixels: 22_000_000,
          },
        };
      } else {
        // Fast Mode
        return {
          maxSide: 20000,
          maxPixels:18_750_000,
          minWidth: null,
          tallPageBoost: {
            minAspectRatio: 2.35,
            minLongSide: 9000,
            boostedMaxSide: 18500,
            boostedMaxPixels: 22_000_000,
          },
        };
      }
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
  }, [EXTERNAL_OCR_CJK_PANEL_MAX_PIXELS, EXTERNAL_OCR_CJK_PANEL_MAX_SIDE, EXTERNAL_OCR_RENDER_MAX_SIDE, activePipelineProfile, hasCjkOrThaiOcrLanguage, hasKoreanOcrLanguage, options.language, ocrQualityMode]);

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
      let minWidthScale = minWidth / width;
      if (effectiveMaxSide && effectiveMaxSide > 0) {
        minWidthScale = Math.min(minWidthScale, effectiveMaxSide / Math.max(width, height));
      }
      if (minWidthScale > scaleFactor) {
        scaleFactor = minWidthScale;
      }
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

  const isCanvasBlank = (canvas: HTMLCanvasElement): boolean => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return true;
    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return true;
    try {
      const sampleSize = 10;
      const dx = Math.floor(w / sampleSize);
      const dy = Math.floor(h / sampleSize);
      for (let x = 1; x < sampleSize; x++) {
        for (let y = 1; y < sampleSize; y++) {
          const imgData = ctx.getImageData(x * dx, y * dy, 1, 1).data;
          const r = imgData[0];
          const g = imgData[1];
          const b = imgData[2];
          const a = imgData[3];
          if (a > 0 && !(r === 255 && g === 255 && b === 255)) {
            return false;
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  };

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
      let existingCanvas = document.querySelector(
        `.pdf-canvas-document .react-pdf__Page[data-page-number="${pageNum}"] canvas`
      ) as HTMLCanvasElement | null;

      if (renderOptions?.allowNavigationFallback) {
        const startTime = Date.now();
        const maxWaitTime = 10000;
        while (Date.now() - startTime < maxWaitTime) {
          existingCanvas = document.querySelector(
            `.pdf-canvas-document .react-pdf__Page[data-page-number="${pageNum}"] canvas`
          ) as HTMLCanvasElement | null;

          if (existingCanvas && existingCanvas.width > 0 && existingCanvas.height > 0) {
            const blank = isCanvasBlank(existingCanvas);
            if (!blank) {
              console.log(`[OCRPanel] Found fully rendered canvas for page ${pageNum}`);
              break;
            }
            console.log(`[OCRPanel] Canvas for page ${pageNum} is still rendering/blank, waiting...`);
          }
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }

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
          `.pdf-canvas-document .react-pdf__Page[data-page-number="${pageNum}"] canvas`
        ) as HTMLCanvasElement | null;

        if (newCanvas && newCanvas.width > 0 && newCanvas.height > 0) {
          const blank = isCanvasBlank(newCanvas);
          if (!blank) {
            console.log(`[OCRPanel] Canvas appeared and finished rendering for page ${pageNum}: ${newCanvas.width}x${newCanvas.height}`);

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
          console.log(`[OCRPanel] Canvas appeared for page ${pageNum} but is still rendering, waiting...`);
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

    const effectiveTimeoutSec = (() => {
      const base = resolvePerPageTimeoutSec(options.perPageTimeoutSec, options.engine || 'tesseract');
      if (activeEngine === 'tesseract' || !base) return base;
      // Tall images are processed via overlapping chunk strips in the Python bridge.
      // Estimate chunk count and scale timeout so each chunk gets enough time.
      const aspectRatio = imageHeight / Math.max(1, imageWidth);
      const isTallImage = imageHeight >= 3000 && aspectRatio >= 4.0;
      if (!isTallImage) return base;
      const estimatedChunks = Math.max(1, Math.ceil((imageHeight - 120) / (2800 - 120)));
      const imageAwareSec = 45 + (estimatedChunks * 90);
      const resolved = Math.max(base, imageAwareSec);
      if (resolved > base) {
        console.log(
          `[OCRPanel] Tall image (${imageWidth}x${imageHeight}, ratio=${aspectRatio.toFixed(1)}): ` +
          `~${estimatedChunks} chunks expected, timeout ${base}s → ${resolved}s`
        );
      }
      return resolved;
    })();
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
      ? (ocrQualityMode === 'fast' ? 'fast' : (shouldPreferFastPaddleProfile ? 'fast' : 'balanced'))
      : 'best';
    let ocrResult: import('../../types').OCRPageResult;
    try {
      ocrResult = await runAttemptWithTimeout(effectiveTimeoutSec, resolvedQualityProfile);
    } catch (error) {
      if (activeEngine !== 'tesseract' && isTimeoutError(error) && !controller.signal.aborted) {
        const boostedTimeoutSec = Math.max((effectiveTimeoutSec || 180) + 120, 600);
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
      const prefixEchoDrops = debugDropWords.filter((d: any) => d.reason === 'displacedPrefixEcho');
      if (prefixEchoDrops.length > 0) {
        console.log(`[OCRPanel] displacedPrefixEcho drops page ${pageNum}:`, prefixEchoDrops);
      }
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

    setTranslationPreviewMode('original');

    setProgress({
      stage: 'complete',
      currentPage: pageNum,
      totalPages: 1,
      message: `OCR complete for page ${pageNum}`,
      progress: 100
    });
  }, [activePipelineProfile, ensureDocumentId, ensureEngineReady, loadCachedOCR, normalizeLanguage, normalizedWarmLanguage, options.dpi, options.engine, options.language, options.pageSegMode, renderPageToCanvas, resolveRenderConstraints, setEngineWarmState, setIsProcessing, setPageOCR, setProgress, showDebugOverlay, startExternalProgress, stopExternalProgress, setTranslationPreviewMode]);

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
        efficiency: null,
        rawAxis: null,
        lexicalAxis: null,
        yieldAxis: null,
        werError: null,
        cerError: null,
        garbageRatio: null,
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
    const wordCount = Array.isArray(result.words) && result.words.length > 0 ? result.words.length : tokens.length;
    const suspiciousRatio = tokens.length > 0 ? suspiciousCount / tokens.length : 0;
    const droppedCount = Array.isArray(droppedWords) ? droppedWords.length : 0;
    const lexicalQuality = computeLexicalQuality(tokens, result.language || options.language);
    const composite = computeCompositeScore({
      confidence,
      suspiciousRatio,
      droppedCount,
      wordCount,
      lexicalQuality,
      tokens,
      text: result.text || '',
      language: result.language || options.language,
    });
    const efficiency = runtimeMs != null && runtimeMs > 0
      ? Number((composite.compositeScore / (runtimeMs / 1000)).toFixed(4))
      : null;

    return {
      runtimeMs,
      confidence,
      compositeScore: composite.compositeScore,
      efficiency,
      rawAxis: Number((composite.rawAxis * 100).toFixed(2)),
      lexicalAxis: Number((composite.lexicalAxis * 100).toFixed(2)),
      yieldAxis: Number((composite.yieldAxis * 100).toFixed(2)),
      werError: Number(composite.werError.toFixed(4)),
      cerError: Number(composite.cerError.toFixed(4)),
      garbageRatio: Number(composite.garbageRatio.toFixed(4)),
      wordCount,
      lineCount,
      suspiciousCount,
      suspiciousRatio,
      droppedCount,
    };
  }, [options.language]);

  const cacheBenchmarkResultInMemory = useCallback((pageNum: number, engine: OCREngine, result: OCRPageResult) => {
    useOCRTextLayerStore.setState((state) => {
      const byPageEngine = new Map(state.ocrByPageEngine);
      const perPage = new Map(byPageEngine.get(pageNum) || new Map<OCREngine, OCRPageResult>());
      perPage.set(engine, result);
      byPageEngine.set(pageNum, perPage);

      const selectedEngine = (state.options.engine || 'tesseract') as OCREngine;
      if (engine !== selectedEngine && state.allPagesOCR.has(pageNum)) {
        return { ocrByPageEngine: byPageEngine };
      }

      const allPages = new Map(state.allPagesOCR);
      allPages.set(pageNum, result);
      return {
        ocrByPageEngine: byPageEngine,
        allPagesOCR: allPages,
      };
    });
  }, []);

  const handleBenchmarkCurrentPage = useCallback(async (ignoreCache: boolean = false) => {
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
          if (cacheDocId && !ignoreCache) {
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

              cacheBenchmarkResultInMemory(currentPage, engine.id, {
                ...normalizedCached,
                pageNumber: currentPage,
              });
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

          const benchmarkQualityProfile: OCRQualityProfile = (() => {
            if (engine.id !== 'paddleocr') return 'best';
            if (ocrQualityMode === 'fast') return 'fast';

            const isCjkLike = options.language
              .split('+')
              .map((code) => code.trim())
              .filter(Boolean)
              .some((code) => ['kor', 'jpn', 'jpn_vert', 'chi_sim', 'chi_tra', 'tha'].includes(code));

            if (activePipelineProfile !== 'panel') return 'balanced';
            if (isCjkLike) return 'balanced';

            const longest = Math.max(imageWidth, imageHeight);
            const shortest = Math.max(1, Math.min(imageWidth, imageHeight));
            const aspectRatio = longest / shortest;
            const pixelCount = imageWidth * imageHeight;
            const preferFast = pixelCount >= 3_600_000 || longest >= 5200 || aspectRatio <= 2.4;
            return preferFast ? 'fast' : 'balanced';
          })();

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
            benchmarkQualityProfile,
            engine.id
          );

          result.language = normalizeLanguage(options.language);
          result.pageNumber = currentPage;
          result.pipelineProfile = activePipelineProfile;
          result.ocrEngine = engine.id;
          result.ocrQualityProfile = benchmarkQualityProfile;

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

          cacheBenchmarkResultInMemory(currentPage, engine.id, normalizedResult);
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
  }, [activePipelineProfile, benchmarkRunning, cacheBenchmarkResultInMemory, currentPage, ensureDocumentId, ensureEngineReady, file, fileUrl, isAbortError, isCacheCompatibleForEngine, isProcessing, normalizeCacheProfile, normalizeLanguage, options.dpi, options.language, options.pageSegMode, renderPageToCanvas, resetBenchmarkRows, resolveRenderConstraints, showDebugOverlay, stopExternalProgress, summarizeBenchmarkResult, updateBenchmarkRow]);

  const handleRawBenchmark = useCallback(async (mode: BenchmarkMode, ignoreCache: boolean = false) => {
    if (mode === 'baseline') {
      setBenchmarkMode('baseline');
      await handleBenchmarkCurrentPage(ignoreCache);
      return;
    }

    // ── DUAL MODE: rawOCR → snapshot, then ocrForTextLayer → full row ──
    if (!file || !fileUrl) return;
    if (isProcessing || benchmarkRunning || ocrJobActiveRef.current) return;

    setBenchmarkMode('dual');
    setBenchmarkOpen(true);
    setBenchmarkTargetPage(currentPage);
    resetBenchmarkRows();
    setBenchmarkRunning(true);

    const controller = new AbortController();
    benchmarkAbortRef.current = controller;
    ocrJobActiveRef.current = true;

        // Get docId for DB cache lookups
        const cacheDocId = await ensureDocumentId().catch(() => null);

        // Check in-memory per-engine cache from previous OCR runs first.
        // This avoids re-running OCR when the user has already run a model individually.
        const engineMemoryCache: Record<string, OCRPageResult | null> = {};
        for (const engine of OCR_ENGINES) {
          if (ignoreCache) {
            engineMemoryCache[engine.id] = null;
            continue;
          }
          const cached = useOCRTextLayerStore.getState().ocrByPageEngine.get(currentPage)?.get(engine.id);
          if (cached && isCacheCompatibleForEngine(cached, engine.id)) {
            engineMemoryCache[engine.id] = cached;
          } else {
            engineMemoryCache[engine.id] = null;
          }
        }

        // Also check DB for engines not yet in memory
        const engineDbCache: Record<string, OCRPageResult | null> = {};
        for (const engine of OCR_ENGINES) {
          if (engineMemoryCache[engine.id] !== null || ignoreCache) {
            engineDbCache[engine.id] = null;
            continue;
          }
          if (cacheDocId) {
            try {
              const dbCached = await dbService.getOCR(cacheDocId, currentPage, engine.id);
              if (dbCached && isCacheCompatibleForEngine(dbCached, engine.id)) {
                engineDbCache[engine.id] = dbCached;
                cacheBenchmarkResultInMemory(currentPage, engine.id, dbCached);
              } else {
                engineDbCache[engine.id] = null;
              }
            } catch {
              engineDbCache[engine.id] = null;
            }
          } else {
            engineDbCache[engine.id] = null;
          }
        }

        try {
          for (const engine of OCR_ENGINES) {
            if (controller.signal.aborted) break;

            const supportsRaw = engine.id !== 'tesseract';

            // Use cached result if available (memory first, then DB)
            const memoryCached = engineMemoryCache[engine.id];
            const dbCached = engineDbCache[engine.id];
            const cachedResult = memoryCached ?? (dbCached ?? null);

            if (cachedResult) {
              const normalizedCached = normalizeCacheProfile(cachedResult);
              
              if (benchmarkMode === 'dual' && supportsRaw) {
                // Do not skip! We will run RAW pass and use the cached FULL result.
              } else {
                const summary = summarizeBenchmarkResult(normalizedCached);
                updateBenchmarkRow(engine.id, {
                  status: 'done',
                  cacheHit: true,
                  ...summary,
                  rawSnapshot: undefined,
                  message: summary.runtimeMs != null
                    ? `Cache hit ${(summary.runtimeMs / 1000).toFixed(summary.runtimeMs >= 10000 ? 1 : 2)}s`
                    : 'Cache hit (full pipeline)',
                });
                continue;
              }
            }

            updateBenchmarkRow(engine.id, {
              status: 'running',
              message: supportsRaw ? 'RAW pass...' : 'Running...',
            });

        try {
          // ── ensure engine ready ──
          if (engine.id !== 'tesseract') {
            const ready = await ensureEngineReady(engine.id, { selectOnReady: false });
            if (!ready) throw new Error(`${engine.name} is not ready`);
          }

          const renderConstraints = resolveRenderConstraints(engine.id);
          const { canvas, width: imgW, height: imgH } = await renderPageToCanvas(currentPage, options.dpi, {
            allowNavigationFallback: true,
            ...renderConstraints,
          });
          const imageBlob = await new Promise<Blob>((res, rej) => {
            canvas.toBlob((b) => b ? res(b) : rej(new Error('canvas toBlob failed')), 'image/png');
          });

          // ── SEQUENTIAL PROCESSING: Raw & Full Pipeline ──
          let rawSnapshot: BenchmarkRawSnapshot | undefined;
          let fullResult: OCRPageResult | undefined;
          
          const qualityProfile: OCRQualityProfile = (() => {
            if (engine.id !== 'paddleocr') return 'best';
            if (ocrQualityMode === 'fast') return 'fast';
            const isCjk = options.language.split('+').map(c => c.trim())
              .some(c => ['kor','jpn','jpn_vert','chi_sim','chi_tra','tha'].includes(c));
            if (activePipelineProfile !== 'panel' || isCjk) return 'balanced';
            const px = imgW * imgH;
            const longest = Math.max(imgW, imgH);
            const shortest = Math.min(imgW, imgH);
            const aspectRatio = longest / Math.max(1, shortest);
            const preferFast = px >= 3_600_000 || longest >= 5200 || aspectRatio <= 2.4;
            return preferFast ? 'fast' : 'balanced';
          })();

          const cachedFullResult = benchmarkMode === 'dual' && supportsRaw ? (engineMemoryCache[engine.id] ?? engineDbCache[engine.id]) : null;

          let rawSummary = null;
          if (supportsRaw) {
            updateBenchmarkRow(engine.id, { message: 'Running RAW pass...' });
            try {
              const rawResult = await visionService.rawOCR(
                imageBlob, imgW, imgH, options.language, options.dpi, options.pageSegMode,
                controller.signal, engine.id, qualityProfile
              );
              rawSummary = summarizeBenchmarkResult(rawResult);
            } catch (err) {
              throw new Error(`RAW Error: ${err instanceof Error ? err.message : 'Unknown'}`);
            }
          }

          updateBenchmarkRow(engine.id, { 
            message: cachedFullResult 
              ? 'Loading cached FULL...' 
              : 'Running FULL pipeline...' 
          });

          const rawFullResult = cachedFullResult
            ? normalizeCacheProfile(cachedFullResult)
            : await visionService.ocrForTextLayer(
                imageBlob, imgW, imgH, options.language, options.dpi, options.pageSegMode,
                controller.signal, showDebugOverlay, activePipelineProfile, qualityProfile, engine.id
              );

          if (rawSummary) {
            rawSnapshot = {
              status: 'done',
              runtimeMs: rawSummary.runtimeMs,
              confidence: rawSummary.confidence,
              compositeScore: rawSummary.compositeScore,
              lexicalAxis: rawSummary.lexicalAxis,
              yieldAxis: rawSummary.yieldAxis,
              garbageRatio: rawSummary.garbageRatio,
              efficiency: rawSummary.efficiency,
              wordCount: rawSummary.wordCount,
              lineCount: rawSummary.lineCount,
              droppedCount: rawSummary.droppedCount,
              message: 'raw done',
            };
          } else if (supportsRaw) {
             rawSnapshot = {
                status: 'error',
                runtimeMs: null, confidence: null, compositeScore: null,
                lexicalAxis: null, yieldAxis: null, garbageRatio: null,
                efficiency: null,
                wordCount: 0, lineCount: 0, droppedCount: 0,
                message: 'Raw failed',
              };
          }

          fullResult = rawFullResult;
          fullResult.language = normalizeLanguage(options.language);
          fullResult.pageNumber = currentPage;
          
          const normalized = normalizeCacheProfile(fullResult);
          const fullSummary = summarizeBenchmarkResult(normalized);

          updateBenchmarkRow(engine.id, {
            status: 'done',
            cacheHit: Boolean(cachedFullResult),
            ...fullSummary,
            rawSnapshot,
            message: cachedFullResult
              ? 'Cached'
              : (fullSummary.runtimeMs != null ? `Full ${(fullSummary.runtimeMs / 1000).toFixed(2)}s` : 'Done'),
          });

          cacheBenchmarkResultInMemory(currentPage, engine.id, normalized);
        } catch (error) {
          const aborted = controller.signal.aborted || isAbortError(error);
          updateBenchmarkRow(engine.id, {
            status: 'error',
            message: aborted ? 'Canceled' : (error instanceof Error ? error.message : 'Failed'),
          });
          if (aborted) break;
        }
      }
    } finally {
      benchmarkAbortRef.current = null;
      setBenchmarkRunning(false);
      ocrJobActiveRef.current = false;
      visionService.setProgressCallback(null);
      stopExternalProgress();
    }
  }, [activePipelineProfile, benchmarkRunning, cacheBenchmarkResultInMemory, currentPage,
        ensureDocumentId, ensureEngineReady, file, fileUrl, handleBenchmarkCurrentPage, isAbortError,
        isCacheCompatibleForEngine, isProcessing, normalizeCacheProfile, normalizeLanguage, options.dpi, options.language,
        options.pageSegMode, renderPageToCanvas, resetBenchmarkRows, resolveRenderConstraints,
        showDebugOverlay, stopExternalProgress, summarizeBenchmarkResult, updateBenchmarkRow]);

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
    // Explicitly wipe the active layers in the Layer Store for this page
    useLayerStore.getState().setPageLayers(currentPage, { layers: [], groups: [] });
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
  const currentRuntimeMs = previewSourceOCR?.debug?.runtimeMs
    ?? (previewSourceOCR?.debug as { timingsMs?: { ocr?: number } } | undefined)?.timingsMs?.ocr;
  const currentRuntimeSecLabel = typeof currentRuntimeMs === 'number'
    ? `${(currentRuntimeMs / 1000).toFixed(currentRuntimeMs >= 10000 ? 1 : 2)}s`
    : '-';
  const currentEngine = OCR_ENGINES.find(engine => engine.id === (previewSourceOCR?.ocrEngine || 'tesseract')) || OCR_ENGINES[0];
  const translatedCacheSlotCount = currentPageTranslationEntries.length;
  const currentSkipReason = previewSourceOCR?.debug?.skipReason || '';
  const isStaleTranslation = translationPreviewMode === 'translated' && !activeTranslationMatchesCurrentOCR && translatedCacheSlotCount > 0;
  const hasProcessInfo = Boolean(
    currentDroppedCount
    || currentDropSummary
    || currentStageSummary
    || currentCandidateSummary
    || currentSkipReason
    || isStaleTranslation
  );
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
    .sort((a, b) => (a.garbageRatio ?? a.suspiciousRatio) - (b.garbageRatio ?? b.suspiciousRatio))[0];

  return (
    <div className="flex flex-col gap-1.5 p-2.5 pt-0 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
      {/* OCR Model Selector */}
      <div className="-mx-2 order-1 space-y-1">
        <div className="flex items-center justify-between gap-3 border-y border-black/55 bg-[linear-gradient(124deg,rgba(234,179,8,0.30)_0%,rgba(249,115,22,0.24)_56%,rgba(17,24,39,0.92)_100%)] px-3 py-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-white">
            <Cpu size={12} />
            OCR Model
          </label>

          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setOcrQualityMode((prev) => (prev === 'high' ? 'fast' : 'high'))}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold transition-all shadow-sm ${
                  ocrQualityMode === 'high'
                    ? 'border-amber-400/40 bg-amber-950/70 text-amber-300 hover:bg-amber-900/60 hover:border-amber-300/60'
                    : 'border-cyan-400/40 bg-cyan-950/70 text-cyan-300 hover:bg-cyan-900/60 hover:border-cyan-300/60'
                }`}
                title={`OCR quality profile: ${ocrQualityMode === 'high' ? 'High Detail' : 'Fast Speed'}. Click to toggle.`}
              >
                {ocrQualityMode === 'high' ? (
                  <Zap size={10} className="text-amber-400" />
                ) : (
                  <Gauge size={10} className="text-cyan-400" />
                )}
                <span>{ocrQualityMode === 'high' ? 'High' : 'Fast'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleRawBenchmark('baseline', true)}
                disabled={isProcessing || !file}
                className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-slate-800/70 px-2 py-1 text-[10px] font-semibold text-slate-200 transition-colors hover:bg-slate-700/80 disabled:cursor-not-allowed disabled:opacity-50"
                title="Benchmark RAW engines (no preprocessing/filter/grouping)"
              >
                <Cpu size={10} />
                Base
              </button>
              <button
                type="button"
                onClick={() => void handleRawBenchmark('dual', true)}
                disabled={isProcessing || !file}
                className="inline-flex items-center gap-1 rounded-md border border-white/25 bg-black px-2 py-1 text-[10px] font-semibold text-white transition-all hover:bg-white/10 hover:border-white/45 disabled:cursor-not-allowed disabled:opacity-50"
                title="Benchmark RAW vs FULL pipeline → Δ metrics + side-by-side preview"
              >
                <Sparkles size={10} className="text-white" />
                Improve
              </button>
            </div>

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
                        ? 'border-[#8AB83F]/65 bg-gradient-to-r from-[#8AB83F]/15 to-[#5B8220]/10 shadow-[0_10px_24px_rgba(138,184,63,0.12)]'
                        : 'border-white/10 bg-slate-900/45 hover:border-white/20'
                    } disabled:opacity-70`}
                  >
                    {isBusy && (
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#8AB83F]/20 via-[#5B8220]/25 to-transparent transition-[width] duration-500"
                        style={{ width: `${warmState.progress}%` }}
                      />
                    )}
                    <div className="relative z-10 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold text-white">{engine.name}</span>
                        <span 
                          className="text-[9px] font-medium" 
                          style={
                            warmState.phase === 'ready'
                              ? { color: '#8AB83F' }
                              : warmState.phase === 'error'
                                ? { color: '#fda4af' }
                                : { color: '#94a3b8' }
                          }
                        >
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
                          className="h-full transition-all duration-500"
                          style={{
                            width: `${Math.max(warmState.progress, warmState.phase === 'idle' ? 4 : 8)}%`,
                            background:
                              warmState.phase === 'ready'
                                ? 'linear-gradient(90deg, #8AB83F 0%, #5B8220 100%)'
                                : warmState.phase === 'error'
                                  ? '#f43f5e'
                                  : '#3b82f6'
                          }}
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

      {/* Progress — compact single-line design */}
      {isProcessing && (() => {
        const pct = Math.round(progress?.progress ?? 0);
        const pg = progress?.currentPage;
        const tot = progress?.totalPages;
        // Compute rough ETA from elapsed time and current progress
        let etaLabel: string | null = null;
        const totalPages = progress?.totalPages ?? 0;
        const completedPages = pageDurationsRef.current.length;
        const remainingPages = Math.max(0, totalPages - completedPages);
        const canEstimateByPage = totalPages > 1 && completedPages > 0 && remainingPages > 0;
        const canEstimateByPercent = ocrStartTimeRef.current !== null && pct > 5;

        if (canEstimateByPage || canEstimateByPercent) {
          const now = Date.now();
          if (etaLabelRef.current === null || (now - etaUpdatedAtRef.current) >= 2000) {
            if (canEstimateByPage) {
              const sample = pageDurationsRef.current.slice(-5);
              const avgMs = sample.reduce((sum, value) => sum + value, 0) / Math.max(1, sample.length);
              const remainingMs = avgMs * remainingPages;
              const remSec = Math.round(remainingMs / 1000);
              etaLabelRef.current = remSec >= 0
                ? (remSec < 60 ? `~${remSec}s` : `~${Math.round(remSec / 60)}m`)
                : null;
            } else if (ocrStartTimeRef.current !== null) {
              const elapsed = now - ocrStartTimeRef.current;
              const remaining = (elapsed / pct) * (100 - pct);
              const remSec = Math.round(remaining / 1000);
              etaLabelRef.current = remSec >= 0
                ? (remSec < 60 ? `~${remSec}s` : `~${Math.round(remSec / 60)}m`)
                : null;
            }
            etaUpdatedAtRef.current = now;
          }
          etaLabel = etaLabelRef.current;
        } else {
          etaLabelRef.current = null;
          etaUpdatedAtRef.current = 0;
        }
        return (
          <div className="order-2 rounded-lg border border-white/10 bg-slate-900/55 px-3 py-2.5">
            {/* Label */}
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-200 truncate">
                {`OCR Processing${pg ? ` page:${pg}${tot ? `/${tot}` : ''}` : ''}`}
              </p>
              <span className="text-xs font-semibold text-[#5CC6F2] tabular-nums">
                {pct}%
              </span>
            </div>
            {/* Bar */}
            <div className="h-1.5 bg-slate-950 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#2B9BFF] to-[#5CC6F2] transition-all duration-150"
                style={{ width: `${pct}%` }}
              />
            </div>
            {/* ETA bottom-left */}
            {etaLabel && (
              <p className="mt-1.5 text-[10px] text-slate-500">
                ⏱ {etaLabel} remaining
              </p>
            )}
          </div>
        );
      })()}

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
              className="flex-[0.32] bg-[#864E3E] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white py-1.5 rounded-lg flex items-center justify-center transition-all shadow-[0_5px_14px_rgba(134,78,62,0.3)] border border-white/10"
              title={selectedEngineWarming ? 'Wait for selected model warm-up to finish' : 'Process current page only'}
            >
              <span className="text-[10px] font-semibold">Current</span>
            </button>
          )}

          {/* Main Button */}
          <button
            onClick={() => handleStartOCR()}
            disabled={ocrActionDisabled}
            className="flex-1 bg-[#CA7C4C] hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white py-1.5 rounded-lg font-semibold text-[10px] flex items-center justify-center gap-1.5 transition-all shadow-[0_5px_14px_rgba(202,124,76,0.3)]"
            title={selectedEngineWarming
              ? 'Wait for selected model warm-up to finish'
              : (fileType === 'pdf' ? 'Process all pages' : 'Process image')}
          >
            {isProcessing ? (
              <>
                <RefreshCw size={14} className="animate-spin" style={{ willChange: 'transform' }} />
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
              disabled={!file || isProcessing}
              style={{
                backgroundColor: '#FFFFFF',
                borderColor: '#CA7C4C',
                color: '#CA7C4C',
              }}
              className="flex-1 border py-1.5 rounded-lg font-semibold text-[10px] flex items-center justify-center gap-1.5 hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              title="Clear cache only for current page and selected OCR model"
            >
              <Trash2 size={12} style={{ color: '#CA7C4C' }} />
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
            style={{
              backgroundColor: '#BB8588',
            }}
            className="w-full hover:brightness-110 text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-[#BB8588]/20"
            title="Cancel OCR"
          >
            Cancel
          </button>
        )}

      </div>

      {/* OCR Results Preview */}
      {previewSourceOCR && !isProcessing && (
        <div className="order-3 space-y-1.5 flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex items-center gap-2 text-xs font-bold shrink-0">
            <span className="text-white">Result - </span>
            <span style={{ color: '#D7CE93' }}>P {currentPage}</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setOcrInfoOpen(true)}
                className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-slate-900/70 text-slate-300 transition-colors hover:border-sky-400/40 hover:text-sky-100"
                title="Open OCR process info"
              >
                <Info size={12} />
              </button>
              <span className="text-[11px] font-medium" style={{ color: '#D7CE93' }}>
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
                style={
                  effectivePreviewMode === 'translated'
                    ? {
                        borderColor: 'rgba(215, 206, 147, 0.65)',
                        backgroundColor: 'rgba(215, 206, 147, 0.22)',
                        color: '#fdfbf0',
                      }
                    : {
                        borderColor: 'rgba(215, 206, 147, 0.35)',
                        backgroundColor: 'rgba(215, 206, 147, 0.08)',
                        color: 'rgba(215, 206, 147, 0.90)',
                      }
                }
                className="rounded-md border px-2.5 py-1 text-[10px] font-semibold transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                title={previewToggleDisabled ? 'No translated cache available for this context' : (effectivePreviewMode === 'translated' ? 'Show original OCR cache' : 'Show translated result cache')}
              >
                {previewToggleLabel}
              </button>
            </div>
          </div>


          <div className="relative flex-1 bg-slate-900/55 border border-[#CA7C4C]/50 shadow-[0_4px_20px_rgba(202,124,76,0.08)] rounded-lg min-h-[140px] flex flex-col overflow-hidden">
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
            <div ref={ocrPreviewScrollRef} className="flex-1 overflow-y-auto px-2 pt-1 pb-4 custom-scrollbar">
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
                  {isStaleTranslation && (
                    <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-amber-100">
                      translated cache is stale for current OCR source, using cached translation
                    </div>
                  )}
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
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-100">OCR Benchmark Summary</h3>
                  <button
                    type="button"
                    onClick={() => setShowMetricsInfo((prev) => !prev)}
                    className={`rounded p-1 transition-colors hover:bg-white/10 ${showMetricsInfo ? 'text-emerald-300 bg-emerald-500/10' : 'text-slate-400'}`}
                    title="Toggle detailed metrics explanation"
                  >
                    <Info size={14} />
                  </button>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  page {benchmarkTargetPage ?? currentPage} • pipeline {activePipelineProfile} • lang {options.language} • dpi {options.dpi}
                </p>
                <p className="mt-1 text-[11px] text-amber-200/90">
                  confidence เป็น raw score ของแต่ละ engine (ยังไม่ calibrated ข้าม model)
                </p>
                <p className="mt-1 text-[11px] text-cyan-200/90">
                  composite score = 35% raw conf + 45% lexical quality (garbage penalization) + 20% yield/drop-safe
                </p>
                <p className="mt-1 text-[11px] text-cyan-200/75">
                  efficiency = composite score / runtime (seconds)
                </p>
                {showMetricsInfo && (
                  <div className="mt-3 space-y-1 rounded-lg bg-slate-900/50 p-3 text-[11px] leading-relaxed border border-white/5">
                    <p className="text-emerald-200/90 font-medium">✦ Improve Mode (RAW vs FULL Pipeline Comparison)</p>
                    <ul className="list-disc pl-4 text-slate-300 space-y-0.5">
                      <li><span className="text-cyan-300">Composite Score:</span> คะแนนรวม (35% Raw Conf + 45% Lexical Quality + 20% Yield) <span className="text-emerald-400">↑ ยิ่งสูงยิ่งดี</span> แปลว่าผลลัพธ์โดยรวมสมบูรณ์และถูกต้องมากขึ้น</li>
                      <li><span className="text-cyan-300">Lexical & Yield:</span> ความถูกต้องของคำ (Lexical) และปริมาณข้อความที่รักษาไว้ได้ (Yield) <span className="text-emerald-400">↑ สูง=ดี</span> หมายถึงลด Garbage ได้โดยไม่ทำให้ข้อความหลักหาย</li>
                      <li><span className="text-rose-300">Garbage Ratio:</span> สัดส่วนข้อความขยะ/ลายน้ำ หรือคำที่ผิดเพี้ยน <span className="text-emerald-400">↓ ยิ่งต่ำยิ่งดี</span> หมายถึง Pipeline สามารถกรองขยะและเส้นกวนทิ้งได้สำเร็จ</li>
                    </ul>
                  </div>
                )}
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
              {benchmarkMode === 'dual' && (
                <div className="flex items-center gap-2 border-b border-white/8 bg-gradient-to-r from-emerald-950/60 to-slate-950/60 px-3 py-2 text-[11px]">
                  <span className="font-semibold text-emerald-300">✦ Improve Mode</span>
                  <span className="text-slate-500">·</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">RAW</span>
                  <span className="text-slate-500">= no pipeline</span>
                  <span className="text-slate-500 mx-1">·</span>
                  <span className="rounded bg-cyan-900/50 px-1.5 py-0.5 text-[10px] text-cyan-300">FULL</span>
                  <span className="text-slate-500">= after processing</span>
                  <span className="ml-auto flex items-center gap-2 text-[10px] text-slate-500">
                    <span className="text-emerald-400 font-bold">↑</span> improved
                    <span className="text-rose-400 font-bold">↓</span> worse
                    <span className="mx-1">·</span>
                    Tesseract: no raw pass
                  </span>
                </div>
              )}
              <table className="min-w-full text-xs text-slate-200">
                <thead className="bg-slate-900/85 text-slate-400 text-[11px]">
                  <tr>
                    <th className="px-3 py-2 text-left w-28">Engine</th>
                    <th className="px-2 py-2 text-right">Runtime</th>
                    <th className="px-2 py-2 text-right">Conf</th>
                    <th className="px-2 py-2 text-right">Lexical</th>
                    <th className="px-2 py-2 text-right">Yield</th>
                    <th className="px-2 py-2 text-right">Composite</th>
                    <th className="px-2 py-2 text-right">Efficiency</th>
                    <th className="px-2 py-2 text-right">Garbage</th>
                    <th className="px-2 py-2 text-right">Words</th>
                    <th className="px-2 py-2 text-right">Dropped</th>
                    <th className="px-2 py-2 text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {benchmarkRows.map((row) => {
                    const snap = row.rawSnapshot;
                    const isDual = benchmarkMode === 'dual';
                    const hasSnap = isDual && snap?.status === 'done';

                    // Inline ↑/↓ badge: higher composite/lexical/yield/words = good; higher garbage/WER/CER = bad
                    const dir = (full: number | null, raw: number | null, higherIsBetter = true): React.ReactNode => {
                      if (full == null || raw == null) return null;
                      const delta = full - raw;
                      if (Math.abs(delta) < 0.0001) return null;
                      const improved = higherIsBetter ? delta > 0 : delta < 0;
                      const actualIncreased = delta > 0;
                      return (
                        <span className={`ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded text-[9px] font-bold leading-none ${improved ? 'bg-emerald-500/25 text-emerald-300' : 'bg-rose-500/25 text-rose-300'}`}>
                          {actualIncreased ? '↑' : '↓'}
                        </span>
                      );
                    };

                    const fmtMs = (ms: number | null) => ms != null ? `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s` : '—';
                    const fmtPct = (v: number | null, decimals = 0) => v != null ? `${v.toFixed(decimals)}%` : '—';
                    const fmtNum = (v: number | null, decimals = 1) => v != null ? v.toFixed(decimals) : '—';
                    const garbagePct = (r: { garbageRatio: number | null; suspiciousRatio: number; wordCount: number }) =>
                      r.garbageRatio != null ? r.garbageRatio : (r.wordCount > 0 ? r.suspiciousRatio : null);

                    // Status badge shared helper
                    const statusBadge = (s: 'idle' | 'running' | 'done' | 'error', msg?: string) => (
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        s === 'done' ? 'bg-emerald-500/20 text-emerald-300'
                        : s === 'running' ? 'bg-sky-500/20 text-sky-300'
                        : s === 'error' ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-slate-500/20 text-slate-400'
                      }`}>{msg || s}</span>
                    );

                    if (isDual && snap) {
                      // ── DUAL MODE: 2 rows per engine ──
                      const snapGarbage = snap.garbageRatio;
                      const fullGarbage = garbagePct(row);
                      return (
                        <React.Fragment key={row.engine}>
                          {/* ── FULL pipeline row (on top) ── */}
                          <tr className="border-t border-white/8 bg-slate-900/40">
                            <td className="px-3 py-1.5 align-middle" rowSpan={2}>
                              <div className="font-semibold text-slate-100 text-[12px]">{row.engineName}</div>
                              {row.cacheHit && (
                                <div className="mt-1">
                                  <span className="inline-flex rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">cache</span>
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <span className="rounded bg-cyan-900/50 px-1 py-0.5 text-[9px] text-cyan-400 mr-0.5">FULL</span>
                              <span className="text-slate-200">{fmtMs(row.runtimeMs)}</span>
                              {dir(row.runtimeMs, snap.runtimeMs, false)}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-200">
                              {fmtPct(row.confidence)}{dir(row.confidence, snap.confidence)}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-200">
                              {fmtPct(row.lexicalAxis, 1)}{dir(row.lexicalAxis, snap.lexicalAxis)}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-200">
                              {fmtPct(row.yieldAxis, 1)}{dir(row.yieldAxis, snap.yieldAxis)}
                            </td>
                            <td className="px-2 py-1.5 text-right font-semibold text-white">
                              {fmtNum(row.compositeScore)}{dir(row.compositeScore, snap.compositeScore)}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-200">{fmtNum(row.efficiency)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-200">
                              {fullGarbage != null ? fmtPct(fullGarbage * 100, 1) : '—'}
                              {dir(fullGarbage, snapGarbage, false)}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-200">
                              {row.wordCount ?? '—'}{dir(row.wordCount, snap.wordCount)}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-200">{row.droppedCount ?? '—'}</td>
                            <td className="px-2 py-1.5 text-left">
                              {statusBadge(row.status, row.message)}
                            </td>
                          </tr>
                          {/* ── RAW row (underneath) ── */}
                          <tr className="border-b-2 border-white/10 bg-slate-950/70">
                            <td className="px-2 py-1.5 text-right">
                              <span className="rounded bg-slate-800 px-1 py-0.5 text-[9px] text-slate-500 mr-0.5">RAW</span>
                              <span className="text-slate-500">{fmtMs(snap.runtimeMs)}</span>
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{fmtPct(snap.confidence)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{fmtPct(snap.lexicalAxis, 1)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{fmtPct(snap.yieldAxis, 1)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{fmtNum(snap.compositeScore)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{fmtNum(snap.efficiency)}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{snapGarbage != null ? fmtPct(snapGarbage * 100, 1) : '—'}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{snap.wordCount ?? '—'}</td>
                            <td className="px-2 py-1.5 text-right text-slate-500">{snap.droppedCount ?? '—'}</td>
                            <td className="px-2 py-1.5 text-left">
                              {snap.status === 'error'
                                ? statusBadge('error', snap.message)
                                : <span className="text-[10px] text-slate-500">raw pass</span>}
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    }

                    // ── BASE MODE: single row ──
                    return (
                      <tr key={row.engine} className="border-t border-white/10 bg-slate-900/35">
                        <td className="px-3 py-2 font-semibold text-slate-100">{row.engineName}</td>
                        <td className="px-2 py-2 text-right text-slate-200">{fmtMs(row.runtimeMs)}</td>
                        <td className="px-2 py-2 text-right text-slate-200">{fmtPct(row.confidence)}</td>
                        <td className="px-2 py-2 text-right text-slate-200">{fmtPct(row.lexicalAxis, 1)}</td>
                        <td className="px-2 py-2 text-right text-slate-200">{fmtPct(row.yieldAxis, 1)}</td>
                        <td className="px-2 py-2 text-right text-slate-200">{fmtNum(row.compositeScore)}</td>
                        <td className="px-2 py-2 text-right text-slate-200">{fmtNum(row.efficiency, 2)}</td>
                        <td className="px-2 py-2 text-right text-slate-200">
                          {(() => { const g = garbagePct(row); return g != null ? fmtPct(g * 100, 1) : '—'; })()}
                        </td>
                        <td className="px-2 py-2 text-right text-slate-200">{row.wordCount ?? '—'}</td>
                        <td className="px-2 py-2 text-right text-slate-200">{row.droppedCount ?? '—'}</td>
                        <td className="px-2 py-2 text-left">
                          {statusBadge(row.status, row.message)}
                          {row.cacheHit && <span className="ml-1.5 inline-flex rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">cache</span>}
                        </td>
                      </tr>
                    );
                  })}
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
                <div className="mt-1">
                  {benchmarkBestOverall
                    ? `${benchmarkBestOverall.engineName} (${(benchmarkBestOverall.compositeScore || 0).toFixed(1)})`
                    : '-'}
                </div>
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
                  Lowest Garbage Ratio
                </div>
                <div className="mt-1">{benchmarkLeastGhost ? `${benchmarkLeastGhost.engineName} (${(((benchmarkLeastGhost.garbageRatio ?? benchmarkLeastGhost.suspiciousRatio) || 0) * 100).toFixed(1)}%)` : '-'}</div>
              </div>
            </div>

            {/* ── Compact Improvement Insights ── */}
            {benchmarkMode === 'dual' && (() => {
              const completedEngines = benchmarkRows.filter(
                (row) => row.status === 'done' && row.rawSnapshot?.status === 'done'
              );
              if (completedEngines.length === 0) return null;

              return (
                <div className="mt-3.5 space-y-2 shrink-0">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    <Sparkles size={11} className="text-cyan-400" />
                    <span>วิเคราะห์ผลการจูนระบบ (Pipeline Optimization Insights)</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {completedEngines.map((row) => {
                      const snap = row.rawSnapshot!;
                      const scoreDelta = (row.compositeScore ?? 0) - (snap.compositeScore ?? 0);
                      const rawGarbage = snap.garbageRatio ?? 0;
                      const fullGarbage = row.garbageRatio ?? (row.wordCount > 0 ? row.suspiciousRatio : 0);
                      const garbageDelta = rawGarbage - fullGarbage;
                      const garbageReductionPct = rawGarbage > 0 ? (garbageDelta / rawGarbage) * 100 : 0;

                      let commentary = '';
                      if (scoreDelta > 0 && garbageDelta > 0) {
                        commentary = `ล้างสัญญาณรบกวน/ลายน้ำลงได้ ${garbageReductionPct.toFixed(0)}% ดึงคุณภาพคำแปลกลับมาสมบูรณ์ขึ้น (${scoreDelta.toFixed(1)} คะแนนดีขึ้น)`;
                      } else if (scoreDelta > 0) {
                        commentary = `ดึงความถูกต้องของประโยคเพิ่มขึ้น ${scoreDelta.toFixed(1)} คะแนน รักษาโครงสร้างประโยคได้คมชัดกว่าตัวดิบ`;
                      } else if (garbageDelta > 0) {
                        commentary = `ตรวจจับและปัดกวาดขยะทิ้งไปได้สำเร็จ ป้องกันปัญหาอักขระแปลกปลอมปะปนในประโยค`;
                      } else {
                        commentary = `รักษาความถูกต้องได้ใกล้เคียงกับฐานตัวดิบ ทำงานร่วมกับฟิลเตอร์ต่างๆ ได้อย่างมั่นคง`;
                      }

                      return (
                        <div key={row.engine} className="rounded-xl border border-white/8 bg-slate-900/40 p-2.5 flex flex-col justify-between hover:border-white/15 transition-all">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-bold text-white uppercase tracking-wider">{row.engineName}</span>
                                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400 border border-emerald-500/15">Active</span>
                              </div>
                              <p className="text-[10px] text-slate-400 font-normal leading-normal">{commentary}</p>
                            </div>

                            <div className="flex gap-2 shrink-0 text-right">
                              <div className="rounded bg-slate-950/40 px-2 py-1 border border-white/5 min-w-[54px]">
                                <div className="text-[8px] text-slate-500 uppercase tracking-wider font-semibold">คะแนนรวม</div>
                                <div className="text-[10px] font-bold text-white flex items-center justify-end gap-0.5 mt-0.5">
                                  <span>{(row.compositeScore ?? 0).toFixed(1)}</span>
                                  <span className={`text-[8px] font-bold ${scoreDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {scoreDelta >= 0 ? '↑' : '↓'}{Math.abs(scoreDelta).toFixed(1)}
                                  </span>
                                </div>
                              </div>
                              <div className="rounded bg-slate-950/40 px-2 py-1 border border-white/5 min-w-[54px]">
                                <div className="text-[8px] text-slate-500 uppercase tracking-wider font-semibold">ขยะขยุกขยิก</div>
                                <div className="text-[10px] font-bold text-white flex items-center justify-end gap-0.5 mt-0.5">
                                  <span>{(fullGarbage * 100).toFixed(0)}%</span>
                                  {rawGarbage > 0 && (
                                    <span className={`text-[8px] font-bold ${garbageDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {garbageDelta >= 0 ? '↓' : '↑'}{(Math.abs(garbageDelta) * 100).toFixed(0)}%
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>

                          {row.droppedCount > 0 && (
                            <div className="mt-2 flex items-center gap-1 rounded bg-orange-950/15 px-2 py-0.5 text-[9px] text-orange-200/90 border border-orange-500/10">
                              <Info size={9} className="shrink-0" />
                              <span>ตรวจพบและปัดกวาดขยะลายน้ำทิ้งได้เป็นจำนวน <strong>{row.droppedCount} คำ</strong></span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

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
