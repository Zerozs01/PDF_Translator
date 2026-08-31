/**
 * Translation Grouping — รวมและจัดกลุ่มบรรทัดข้อความสำหรับการแปลแบบกลุ่ม (Balloon-aware grouping & dialogue connectivity)
 *
 * ย้ายจาก App.tsx เพื่อแยก 2D spatial / balloon grouping logic ออกจาก React component
 */
import type { OCRPageResult } from '../../types';
import type { TranslationMode } from '../../stores/useProjectStore';
import type {
  TranslatableLine,
  TranslationGroupingProfile,
  GroupingDecision,
} from './translationBatchService';
import type {
  TranslationGroup,
  ResolvedTranslationGroups,
} from '../../constants/translationConstants';
import type {
  DerivedLayoutGroup,
  LayoutGroupType,
  LayoutGroupingInput,
  LayoutGroupingResult,
  OCRLineWithLayout,
} from '../layout/balloonAwareGroupingService';
import type { TextLayer } from '../../types/layers';
import { useLayerStore } from '../../stores/useLayerStore';
import {
  normalizeEnglishOcrNoiseForTranslation,
  normalizeWhitespace,
} from '../ocr/ocrTextNormalizer';
import type { DehyphenatedJoin } from './dehyphenation';
import {
  resolveBalloonAwareReadingMode,
  buildTranslationGroups,
  shouldUseBalloonAwareGrouping,
} from '../layout/dialogueGroupingService';
import { buildLayerGroupsFromOCR } from '../layers/LayerGroupingService';
import {
  isBalloonAwareGroupingEnabled,
  isLayoutGroupingDebugEnabled,
} from './offlineTranslationService';
import { deriveBalloonAwareLayoutGrouping } from '../layout/balloonAwareGroupingService';

type GlobalPrewarmState = typeof globalThis & {
  __pdfTranslatorLastLayoutGrouping?: unknown;
};

export const composeGroupSourceText = (
  lines: TranslatableLine[],
  groupType: string = 'unknown',
  groupingProfile: TranslationGroupingProfile = 'default'
): { composed: string; dehyphenJoins: DehyphenatedJoin[] } => {
  const items = lines.map((line, originalIdx) => {
    const rawText = line.text != null ? String(line.text) : '';
    const cleaned = normalizeEnglishOcrNoiseForTranslation(rawText);
    return {
      text: normalizeWhitespace(cleaned),
      originalIdx,
    };
  });

  const activeItems = items.filter((item) => Boolean(item.text));

  if (activeItems.length === 0) {
    return { composed: '', dehyphenJoins: [] };
  }
  if (activeItems.length === 1) {
    return { composed: activeItems[0].text.replace(/-$/, ''), dehyphenJoins: [] };
  }

  const isNarrative =
    groupType === 'balloon' ||
    groupType === 'narration' ||
    groupType === 'dialogue' ||
    groupType === 'unknown';

  if (!isNarrative) {
    const composed = activeItems.map((item) => item.text).join('\n');
    return { composed, dehyphenJoins: [] };
  }

  const joins: DehyphenatedJoin[] = [];

  // 1. Merge split COOOOOOOCKS across lines
  for (let i = 0; i < activeItems.length; i++) {
    const currItem = activeItems[i];
    if (!currItem.text) continue;
    const curr = currItem.text.toUpperCase().replace(/[^A-Z0-9]/g, '');

    // Case 1: COO + OOO + OCKS (3 lines)
    if (i < activeItems.length - 2) {
      const n1Item = activeItems[i + 1];
      const n2Item = activeItems[i + 2];
      if (n1Item.text && n2Item.text) {
        const next1 = n1Item.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const next2 = n2Item.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (
          /^COO+$/i.test(curr) &&
          /^[0O]{3,}$/i.test(next1) &&
          /^[70Z]?OCKS$/i.test(next2)
        ) {
          currItem.text = 'COOOOOOOCKS';
          n1Item.text = '';
          n2Item.text = '';
          joins.push({ parentIdx: currItem.originalIdx, childIdx: n1Item.originalIdx });
          joins.push({ parentIdx: currItem.originalIdx, childIdx: n2Item.originalIdx });
          continue;
        }
      }
    }

    // Case 2: COO + OCKS (2 lines)
    if (i < activeItems.length - 1) {
      const n1Item = activeItems[i + 1];
      if (n1Item.text) {
        const next = n1Item.text.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (
          /^COO+$/i.test(curr) &&
          /^[70Z]?OCKS$/i.test(next)
        ) {
          currItem.text = 'COOOOOOOCKS';
          n1Item.text = '';
          joins.push({ parentIdx: currItem.originalIdx, childIdx: n1Item.originalIdx });
          continue;
        }
      }
    }
  }

  // Filter out any blanked items from step 1
  const remainingItems = activeItems.filter((item) => Boolean(item.text));

  // 2. Perform hyphenation merges on the remaining lines
  for (let i = 0; i < remainingItems.length - 1; i++) {
    const currItem = remainingItems[i];
    const nextItem = remainingItems[i + 1];

    if (
      currItem.text &&
      nextItem.text &&
      /[A-Za-z][\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00AD]$/.test(currItem.text) &&
      /^[A-Za-z0-9]/.test(nextItem.text)
    ) {
      // Check if nextItem starts with a Japanese honorific like SAN, CHAN, KUN, SAMA, SENSEI, SENPAI
      const honorificMatch = nextItem.text.match(/^(SAN|CHAN|KUN|SAMA|SENSEI|SENPAI|DONO)(['’]S)?(\b.*)$/i);
      if (honorificMatch) {
        const cleanParentText = currItem.text.replace(/[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00AD]$/, '');
        const honorific = honorificMatch[1];
        const suffix = honorificMatch[2] || '';
        const restOfNext = (honorificMatch[3] || '').trim();

        if (!restOfNext) {
          currItem.text = `${cleanParentText}-${honorific}${suffix}`;
          nextItem.text = '';
          joins.push({ parentIdx: currItem.originalIdx, childIdx: nextItem.originalIdx });
        } else {
          currItem.text = `${cleanParentText}-${honorific}${suffix}`;
          nextItem.text = restOfNext;
        }
        continue;
      }

      const cleanParentText = currItem.text.replace(/[\u002D\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u00AD]$/, '');
      const nextTokens = nextItem.text.trim().split(/\s+/);
      const firstToken = nextTokens[0] || '';
      const restTokens = nextTokens.slice(1).join(' ');

      if (!restTokens) {
        currItem.text = cleanParentText + firstToken;
        nextItem.text = '';
        joins.push({ parentIdx: currItem.originalIdx, childIdx: nextItem.originalIdx });
      } else {
        currItem.text = cleanParentText + firstToken;
        nextItem.text = restTokens;
      }
    }
  }

  // Filter out any blanked items from step 2
  const finalItems = remainingItems.filter((item) => Boolean(item.text));
  const composed = finalItems.map((item) => item.text).join(' ');

  return { composed, dehyphenJoins: joins };
};

export const createBalloonAwareGroupingInput = (
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

export const buildTranslationGroupsFromDerivedLayout = (
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

export const pushLayoutGroupingDebugPayload = (
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

export const resolveTranslationGroupsWithLayout = (
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

    // If store is empty (e.g. in Background Queue or fresh document load),
    // compute fresh canonical 2D spatial layer groups directly via buildLayerGroupsFromOCR(pageOCR)
    let effectiveStoreGroups = storeGroups;
    let effectiveStoreLayers = storeLayers;

    if (!effectiveStoreGroups || effectiveStoreGroups.length === 0 || !effectiveStoreLayers || effectiveStoreLayers.length === 0) {
      if (pageOCR && Array.isArray(pageOCR.lines) && pageOCR.lines.length > 0) {
        const generated = buildLayerGroupsFromOCR(pageOCR);
        effectiveStoreGroups = generated.groups;
        effectiveStoreLayers = generated.layers;
      }
    }

    if (effectiveStoreGroups && effectiveStoreGroups.length > 0 && effectiveStoreLayers && effectiveStoreLayers.length > 0) {
      const lineMap = new Map<number, TranslatableLine>(lines.map((line) => [line.index, line]));
      const layerMap = new Map<string, TextLayer>(effectiveStoreLayers.map((l) => [l.id, l]));

      let matchedLayerCount = 0;
      let totalStoreLayers = 0;
      const translationGroups: TranslationGroup[] = [];
      effectiveStoreGroups.forEach((sg) => {
        totalStoreLayers += sg.layerIds.length;
        const groupLines = sg.layerIds
          .map((id) => layerMap.get(id))
          .filter((l): l is TextLayer => Boolean(l))
          .map((l) => {
            const line = lineMap.get(l.lineIndex);
            if (line) matchedLayerCount += 1;
            return line;
          })
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
            confidence: sg.confidence ?? 0.95,
          });
        }
      });

      const matchRatio = totalStoreLayers > 0 ? matchedLayerCount / totalStoreLayers : 0;
      if (translationGroups.length > 0 && matchRatio >= 0.75) {
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

        console.log(`[resolveTranslationGroupsWithLayout] Using canonical 2D spatial groups for page ${pageNum}: count=${translationGroups.length} (fromStore=${Boolean(storeGroups && storeGroups.length > 0)})`);
        translationGroups.forEach((tg, gIdx) => {
          console.log(`[DBG-groups-p${pageNum}] Group #${gIdx} (${tg.lines.length} lines, type=${tg.groupType}):`, tg.lines.map(l => `[${l.index}] "${l.text}"`).join(' | '));
        });
        return {
          groups: translationGroups,
          groupingProfile: 'balloon-aware',
          groupingDecision: {
            appliedProfile: 'balloon-aware',
            confidence: 1.0,
            fallbackReason: storeGroups && storeGroups.length > 0 ? 'use_store_groups' : 'use_canonical_ocr_groups',
          },
        };
      }
    }
  } catch (err) {
    console.warn('[resolveTranslationGroupsWithLayout] Failed to resolve groups from store/canonical:', err);
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
