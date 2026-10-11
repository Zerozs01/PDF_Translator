import type { OCREngine, OCRPageResult } from '../../types';
import type { TextLayer } from '../../types/layers';
import type { TranslationMode } from '../../stores/useProjectStore';
import type { TranslatableLine, TranslationGroupingProfile, BatchGroupPlan } from './translationBatchService';
import { collectTranslatableLines } from './translatableLineCollector';
import { buildTranslationLinesWithCrossEngineFallback } from './translationLineResolver';
import { dedupeTranslatableLinesForTranslation, shouldForceLineByLineForOfflinePanel, shouldPreferEnglishSourceForMixedTechnicalPage, shouldUseDenseDialogueGrouping, shouldUseLineByLineGrouping } from '../layout/dialogueGroupingService';
import { inferSourceLanguageFromTextHints, isLikelyLatinDominantTranslationPage, isLikelyShortForeignSfxLine, resolveComicPageSourceLanguage, resolvePreferredSourceLanguageForText, resolveSourceLanguageFromOCR, hasStrongLatinAnchorLines } from '../ocr/ocrTextHeuristics';
import { normalizeEnglishOcrNoiseForTranslation, normalizeSourceForTranslation, normalizeSpanishOcrNoiseForTranslation, normalizeTranslationLanguage, normalizeWhitespace, normalizeThaiTranslationText } from '../ocr/ocrTextNormalizer';
import { protectTranslationTokens, restoreProtectedTokens, shouldPreserveSourceLineForTranslation } from './translationTokenProtection';
import { composeGroupSourceText, pushLayoutGroupingDebugPayload, resolveTranslationGroupsWithLayout } from './translationGrouping';
import { getMergedTranslatableLines, mapSlotsToLines } from './dehyphenation';
import { resolveRedistributedLineFallback, splitTranslatedTextBySourceWeights } from './textRedistributionService';
import { finalizeTranslatedLine } from './technicalGlossary';
import { setSlangGroupContext } from './thaiConversationalGlossary';
import { lookupShortPhraseTh } from './offlineTranslationService';
import { applyKoreanConversationalFallback, hasKoreanTranslationCarryover, isBoilerplateHallucination } from './koreanTranslationPolicy';
import { matchMangaGroupLineOverrides } from './mangaGroupOverrides';

export interface PreparedPageTranslationPlan {
  pageNum: number;
  pageOCR: OCRPageResult;
  ocrEngine: OCREngine;
  ocrLanguageKey: string;
  sourceLanguage: string;
  targetLanguage: string;
  translationSourceLanguage: string;
  translatableLines: TranslatableLine[];
  rawTranslatableLines: TranslatableLine[];
  groupingProfile: TranslationGroupingProfile;
  preparedGroups: BatchGroupPlan[];
  crossEngineAssistCount: number;
  preservedSourceLineCount: number;
  detectedLanguageSwitch?: {
    sourceLanguage: string;
    ocrLanguageKey: string;
    languageName: string;
    confidence: number;
  };
}

export interface PreparePagePlanOptions {
  layerOverrides?: TextLayer[];
  alternativeEnginePages?: OCRPageResult[];
  userSourceLanguage?: string;
  ocrLanguageOverride?: string;
  targetLanguage?: string;
  translationMode?: TranslationMode;
  engine?: 'offline' | 'ai' | 'm2m100';
}

/**
 * Pure function: เตรียม Translatable Lines และ Translation Groups พร้อม Token Protection สำหรับ 1 หน้า
 */
export function preparePageTranslationPlan(
  pageNum: number,
  pageOCR: OCRPageResult,
  selectedEngine: OCREngine,
  options?: PreparePagePlanOptions
): PreparedPageTranslationPlan | null {
  const pageEngine = (pageOCR.ocrEngine || selectedEngine) as OCREngine;
  const ocrLanguageKey = options?.ocrLanguageOverride || pageOCR.language || 'eng';
  const normalizedTargetLanguage = normalizeTranslationLanguage(options?.targetLanguage || 'th', 'th');
  const normalizedUserSourceLanguage = normalizeTranslationLanguage(options?.userSourceLanguage || 'en', 'en');
  const resolvedSourceFromOCR = resolveSourceLanguageFromOCR(ocrLanguageKey, normalizedUserSourceLanguage);
  const effectiveTranslationMode: TranslationMode = options?.translationMode || 'manga';
  const engineType = options?.engine || 'offline';

  const rawBaseLines = collectTranslatableLines(
    pageOCR.lines || [],
    pageEngine as string,
    pageOCR.width,
    pageOCR.height
  );

  const currentLayers = options?.layerOverrides || [];
  const updatedTranslatableLines = rawBaseLines.map((line) => {
    let matchingLayer = currentLayers.find((l) => l.lineIndex === line.index);
    if (!matchingLayer) {
      matchingLayer = currentLayers.find((l) => {
        const lBbox = l.bbox;
        const overlapX = Math.max(0, Math.min(lBbox.x1, line.right) - Math.max(lBbox.x0, line.left));
        const overlapY = Math.max(0, Math.min(lBbox.y1, line.bottom) - Math.max(lBbox.y0, line.top));
        const overlapArea = overlapX * overlapY;
        if (overlapArea > 0) {
          const lineArea = (line.right - line.left) * (line.bottom - line.top);
          const layerArea = (lBbox.x1 - lBbox.x0) * (lBbox.y1 - lBbox.y0);
          const minArea = Math.min(lineArea, layerArea);
          return (overlapArea / minArea) >= 0.7;
        }
        return false;
      });
    }

    if (matchingLayer && (matchingLayer.userEdited || matchingLayer.id.startsWith('manual-layer-'))) {
      const layerSource = matchingLayer.sourceText;
      if (layerSource && layerSource.trim()) {
        return {
          ...line,
          text: layerSource,
        };
      }
    }
    return line;
  });

  const unmappedLayers = currentLayers.filter((l) => {
    return !updatedTranslatableLines.some((line) => line.index === l.lineIndex);
  });

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
      sourceEngine: 'manual',
    };
  });

  const baseTranslatableLines = [...updatedTranslatableLines, ...additionalLines];
  if (baseTranslatableLines.length === 0) {
    return null;
  }

  const alternativePages = options?.alternativeEnginePages || [];
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
  const inferredSourceLanguage = inferSourceLanguageFromTextHints(dedupedTranslatableLines, resolvedSourceFromOCR);
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

  const rawTranslatableLines = assistedLines.filter((line) => {
    if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage, ocrLanguageKey)) return false;
    if (latinDominantPage && isLikelyShortForeignSfxLine(line.text) && !lookupShortPhraseTh(line.text)) return false;
    return true;
  });

  let translatableLines = dedupedTranslatableLines.filter((line) => {
    if (shouldPreserveSourceLineForTranslation(line.text, translationSourceLanguage, ocrLanguageKey)) return false;
    if (latinDominantPage && isLikelyShortForeignSfxLine(line.text) && !lookupShortPhraseTh(line.text)) return false;
    return true;
  });

  const preservedSourceLineCount = dedupedTranslatableLines.length - translatableLines.length;
  if (translatableLines.length === 0) {
    return null;
  }

  let groupingProfile: TranslationGroupingProfile = shouldUseLineByLineGrouping(
    translatableLines,
    translationSourceLanguage,
    normalizedTargetLanguage,
    engineType,
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
    engineType === 'offline'
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

  const preparedGroups: BatchGroupPlan[] = resolvedGrouping.groups.map((group, groupIndex) => {
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
    const protectedGroup = protectTranslationTokens(sourceText, normalizedTargetLanguage);
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
    return null;
  }

  const SOURCE_LANG_TO_OCR_MAP: Record<string, { ocrKey: string; label: string }> = {
    es: { ocrKey: 'spa', label: 'ภาษาสเปน (Spanish)' },
    ko: { ocrKey: 'kor', label: 'ภาษาเกาหลี (Korean)' },
    ja: { ocrKey: 'jpn', label: 'ภาษาญี่ปุ่น (Japanese)' },
    zh: { ocrKey: 'chi_sim', label: 'ภาษาจีน (Chinese)' },
    ru: { ocrKey: 'rus', label: 'ภาษารัสเซีย (Russian)' },
    fr: { ocrKey: 'fra', label: 'ภาษาฝรั่งเศส (French)' },
    de: { ocrKey: 'deu', label: 'ภาษาเยอรมัน (German)' },
  };

  let detectedLanguageSwitch: PreparedPageTranslationPlan['detectedLanguageSwitch'] = undefined;
  if (
    inferredSourceLanguage !== normalizedUserSourceLanguage &&
    SOURCE_LANG_TO_OCR_MAP[inferredSourceLanguage]
  ) {
    const mapping = SOURCE_LANG_TO_OCR_MAP[inferredSourceLanguage];
    detectedLanguageSwitch = {
      sourceLanguage: inferredSourceLanguage,
      ocrLanguageKey: mapping.ocrKey,
      languageName: mapping.label,
      confidence: 0.9,
    };
  }

  return {
    pageNum,
    pageOCR,
    ocrEngine: pageEngine,
    ocrLanguageKey,
    sourceLanguage: resolvedSourceFromOCR,
    targetLanguage: normalizedTargetLanguage,
    translationSourceLanguage,
    translatableLines,
    rawTranslatableLines,
    groupingProfile,
    preparedGroups,
    crossEngineAssistCount,
    preservedSourceLineCount,
    detectedLanguageSwitch,
  };
}

/**
 * Pure function: กระจายผลลัพธ์การแปลแบบ Group กลับสู่แต่ละ Line Index พร้อมคำนวณ Slang, Fallback และ Dictionary Overrides
 */
export function redistributeTranslatedGroups(
  plan: PreparedPageTranslationPlan,
  translatedGroups: string[],
  groupLineOverrides?: Map<number, string[]>
): Map<number, string> {
  const translatedByIndex = new Map<number, string>();
  const normalizedTargetLanguage = normalizeTranslationLanguage(plan.targetLanguage, 'th');

  plan.preparedGroups.forEach((group, groupIndex) => {
    const groupSourceLanguage = group.sourceLanguage;

    if (normalizedTargetLanguage === 'th') {
      const combinedRaw = group.lines.map((l) => String(l.text || '').trim()).join(' ');
      const compactCombined = combinedRaw.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const matchedOverride = matchMangaGroupLineOverrides(compactCombined, group.lines);
      if (matchedOverride && matchedOverride.length > 0 && groupLineOverrides) {
        groupLineOverrides.set(groupIndex, matchedOverride);
      }
    }

    const directLineOverride = groupLineOverrides?.get(groupIndex);
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

      const groupHasThaiTranslation = normalizedTargetLanguage === 'th' && /[\u0E00-\u0E7F]/.test(translatedGroup);
      const hasThaiInFinal = /[\u0E00-\u0E7F]/.test(finalizedLine);

      let directTranslation: string | null = null;
      const lineNeedsFallback = (!groupHasThaiTranslation || group.lines.length <= 1)
        || (!hasThaiInFinal || hasKoreanTranslationCarryover(finalizedLine) || finalizedLine === sourceLineText || /[\uAC00-\uD7AF]/.test(finalizedLine));

      if (normalizedTargetLanguage === 'th' && lineNeedsFallback) {
        directTranslation = lookupShortPhraseTh(sourceLineText)
          || lookupShortPhraseTh(sourceLineText.replace(/[^A-Za-z0-9]/g, ''))
          || lookupShortPhraseTh(normalizeSpanishOcrNoiseForTranslation(sourceLineText)) || null;

        if (!directTranslation && /[\uAC00-\uD7AF]/.test(sourceLineText)) {
          directTranslation = applyKoreanConversationalFallback(sourceLineText, finalizedLine);
        }
        if (!directTranslation) {
          const words = sourceLineText.trim().split(/\s+/);
          if (words.length > 1) {
            const translatedWords = words.map((w) => lookupShortPhraseTh(w) || lookupShortPhraseTh(w.replace(/[^A-Za-z0-9]/g, '')) || w);
            if (translatedWords.some((tw) => /[\u0E00-\u0E7F]/.test(tw))) {
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

      if (normalizedTargetLanguage === 'th' && finalizedLine && /[a-zA-Z]{2,}/.test(finalizedLine)) {
        const sanitized = finalizedLine.replace(/\b[a-zA-Z]{2,}\b/g, (word) => {
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

      if (normalizedTargetLanguage === 'th' && finalLineText.trim()) {
        const trimmedLine = finalLineText.trim();
        if (trimmedLine.length <= 6 && prevLineTextInGroup === trimmedLine) {
          translatedByIndex.set(line.index, '');
        } else {
          prevLineTextInGroup = trimmedLine;
        }
      }
    });
    setSlangGroupContext('');
  });

  // Fallback for remaining translatable lines
  plan.translatableLines.forEach((line) => {
    if (shouldPreserveSourceLineForTranslation(line.text, plan.translationSourceLanguage, plan.ocrLanguageKey)) {
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
  });

  // Harmonize Thai slang terms within groups
  if (normalizedTargetLanguage === 'th') {
    plan.preparedGroups.forEach((group) => {
      if (!group.lines || group.lines.length <= 1) return;
      const lineIndices = group.lines.map((l) => l.index);
      const hasHee = lineIndices.some((idx) => {
        const t = translatedByIndex.get(idx);
        return t && t.includes('หี');
      });
      const hasJim = lineIndices.some((idx) => {
        const t = translatedByIndex.get(idx);
        return t && t.includes('จิ๋ม');
      });
      if (hasHee && hasJim) {
        lineIndices.forEach((idx) => {
          const t = translatedByIndex.get(idx);
          if (t && t.includes('จิ๋ม')) {
            translatedByIndex.set(idx, t.replace(/จิ๋ม/g, 'หี'));
          }
        });
      }
      const hasKuay = lineIndices.some((idx) => {
        const t = translatedByIndex.get(idx);
        return t && t.includes('ควย');
      });
      const hasKai = lineIndices.some((idx) => {
        const t = translatedByIndex.get(idx);
        return t && t.includes('ไก่');
      });
      if (hasKuay && hasKai) {
        lineIndices.forEach((idx) => {
          const t = translatedByIndex.get(idx);
          if (t && t.includes('ไก่')) {
            translatedByIndex.set(idx, t.replace(/ไก่/g, 'ควย'));
          }
        });
      }
    });
  }

  return translatedByIndex;
}
