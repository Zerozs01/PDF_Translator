/**
 * Translation Constants & Common Types
 */
import type { BBox, OCRLine, OCRPageResult, OCREngine } from '../types';
import type { TranslatableLine, TranslationGroupingProfile, GroupingDecision } from '../services/translation/translationBatchService';
import type { LayoutGroupType, LayoutGroupingResult } from '../services/layout/balloonAwareGroupingService';

export type { TranslatableLine, TranslationGroupingProfile, GroupingDecision };
export type { LayoutGroupType, LayoutGroupingResult };

export const AUTO_OCR_REQUEST_EVENT = 'pdf-translator:auto-ocr-request';
export const AUTO_OCR_RESULT_EVENT = 'pdf-translator:auto-ocr-result';
export const ENABLE_BALLOON_AWARE_GROUPING_STORAGE_KEY = 'pdf_translator.enable_balloon_aware_grouping';
export const LAYOUT_GROUPING_DEBUG_STORAGE_KEY = 'pdf_translator.layout_grouping_debug';

export type AutoOCRScope = 'current' | 'all';
export type DownloadScope = 'current' | 'all';
export type DownloadContentMode = 'original' | 'translated';

export const formatPageListSummary = (pages: number[], maxItems: number = 8): string => {
  if (pages.length === 0) return '-';
  const ordered = Array.from(new Set(pages)).sort((a, b) => a - b);
  const head = ordered.slice(0, maxItems).join(', ');
  const remain = ordered.length - maxItems;
  return remain > 0 ? `${head} (+${remain})` : head;
};

export const DOCUMENT_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|reaction|unknowns?|equilibrium|rigid|body|support|diagram|objective|objectives|connection|connections|continued|force|moment|component|unknown|column|columns|bridge|building|beam|beams|welded|surface|bracket|cable|utility|floor|member|pin|hinge)\b/i;

export type AdoptedSourceCandidate = {
  text: string;
  adopted: boolean;
  candidateId?: string;
  bbox?: BBox;
};

export type TranslationGroup = {
  lines: TranslatableLine[];
  groupType?: LayoutGroupType;
  derivedGroupId?: string;
  confidence?: number;
};

export type ResolvedTranslationGroups = {
  groups: TranslationGroup[];
  groupingProfile: TranslationGroupingProfile;
  groupingDecision: GroupingDecision;
  layoutResult?: LayoutGroupingResult;
};
