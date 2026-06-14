import type { OCREngine, OCRPageResult } from '../../types';
import type { TranslationMode } from '../../stores/useProjectStore';
import type { OCRLineWithLayout } from '../layout/balloonAwareGroupingService';
import { sanitizeTranslationResult } from './translationCoordinator';
import type { DehyphenatedJoin } from './dehyphenation';

export type ProtectedTokenReplacement = {
  token: string;
  replacement: string;
};

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

export type TranslationGroupingProfile = 'default' | 'dense-dialogue' | 'line-by-line' | 'balloon-aware';

export type GroupingDecision = {
  appliedProfile: 'raw' | 'dense-dialogue' | 'balloon-aware';
  confidence: number;
  fallbackReason?: string;
};

export type BatchGroupPlan = {
  index: number;
  lines: TranslatableLine[];
  sourceLanguage: string;
  sourceText: string;
  protectedText: string;
  replacements: ProtectedTokenReplacement[];
  dehyphenJoins?: DehyphenatedJoin[];
};

export type BatchPageTranslationPlan = {
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

export const buildBatchMarkdownPayload = (
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

export const extractJsonObjectText = (raw: string): string => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || raw || '').trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Gemini batch response does not contain a valid JSON object.');
  }
  return candidate.slice(start, end + 1);
};

export const parseBatchJsonResponse = (raw: string): Map<number, Map<number, string>> => {
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
        lineMap.set(index, sanitizeTranslationResult(String(line.text || '')));
      });
    } else if (Array.isArray(pageEntry.lines)) {
      // Backward-compatible fallback if model returns previous line schema.
      pageEntry.lines.forEach((line) => {
        const index = Number(line.index);
        if (!Number.isFinite(index)) return;
        lineMap.set(index, sanitizeTranslationResult(String(line.text || '')));
      });
    }
    byPage.set(pageNum, lineMap);
  });

  return byPage;
};
