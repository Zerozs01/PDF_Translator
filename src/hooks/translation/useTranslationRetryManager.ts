import { useCallback } from 'react';
import type { TranslationMode } from '../../stores/useProjectStore';
import type { BatchGroupPlan } from '../../services/translation/translationBatchService';
import { shouldRetryLineTranslation, scoreTranslationCandidate, translateBatchOffline, lookupShortPhraseTh } from '../../services/translation/offlineTranslationService';
import { offlineBatchBridgeWrapper, translateBatchGemini } from '../../services/translation/translationBridge';
import { protectTranslationTokens, restoreProtectedTokens } from '../../services/translation/translationTokenProtection';
import { buildOfflineGroupRetrySourceText, buildTranslationComparisonKey } from '../../services/ocr/ocrTextHeuristics';
import { normalizeSourceForTranslation, normalizeTranslationLanguage, normalizeWhitespace, normalizeThaiTranslationText } from '../../services/ocr/ocrTextNormalizer';
import { finalizeTranslatedLine } from '../../services/translation/technicalGlossary';
import { setSlangGroupContext } from '../../services/translation/thaiConversationalGlossary';

export interface RetryEvaluationParams {
  preparedGroups: BatchGroupPlan[];
  translatedGroups: string[];
  effectiveEngine: 'offline' | 'ai' | 'm2m100';
  effectiveTranslationMode: TranslationMode;
  normalizedTargetLanguage: string;
  targetLanguage: string;
  geminiContextOverrides?: { baseSystemPrompt?: string };
}

export function useTranslationRetryManager() {
  const evaluateAndApplyGroupRetries = useCallback(async ({
    preparedGroups,
    translatedGroups,
    effectiveEngine,
    effectiveTranslationMode,
    normalizedTargetLanguage,
    targetLanguage,
  }: RetryEvaluationParams): Promise<{
    groupLineOverrides: Map<number, string[]>;
    groupRetryAppliedCount: number;
  }> => {
    const groupLineOverrides = new Map<number, string[]>();
    let groupRetryAppliedCount = 0;

    if (effectiveEngine !== 'offline') {
      return { groupLineOverrides, groupRetryAppliedCount };
    }

    // Limit maximum group retries to prevent pathological slowdowns
    const MAX_GROUP_RETRIES = 10;
    let evaluatedRetries = 0;

    for (let groupIndex = 0; groupIndex < preparedGroups.length; groupIndex += 1) {
      if (evaluatedRetries >= MAX_GROUP_RETRIES) break;

      const group = preparedGroups[groupIndex];
      if (!group || (group.replacements && group.replacements.length > 0) || !group.lines || group.lines.length <= 1) {
        continue;
      }

      const groupSourceLanguage = group.sourceLanguage;
      const sourceGroupText = group.sourceText || '';
      const initialTranslated = translatedGroups[groupIndex] || sourceGroupText;

      if (!shouldRetryLineTranslation(
        sourceGroupText,
        initialTranslated,
        groupSourceLanguage,
        normalizedTargetLanguage
      )) {
        continue;
      }

      evaluatedRetries += 1;

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
          effectiveTranslationMode,
          groupSourceLanguage,
          normalizedTargetLanguage,
          offlineBatchBridgeWrapper
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
        effectiveTranslationMode,
        groupSourceLanguage,
        normalizedTargetLanguage,
        offlineBatchBridgeWrapper
      );
      setSlangGroupContext(group.lines.map((l) => l.text || '').join(' '));
      const retryLineOutputs = group.lines.map((line, lineIndex) => {
        const restored = restoreProtectedTokens(
          retryLineRaw[lineIndex] || '',
          retryLineProtected[lineIndex]?.replacements || []
        );
        return finalizeTranslatedLine(line.text, restored, normalizedTargetLanguage);
      });
      setSlangGroupContext('');
      candidateScores.push({
        kind: 'per-line',
        score: retryLineOutputs.reduce(
          (sum, lineText, lineIndex) => sum + scoreTranslationCandidate(group.lines[lineIndex]?.text || '', lineText, normalizedTargetLanguage),
          0
        ) / Math.max(1, group.lines.length),
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

    return { groupLineOverrides, groupRetryAppliedCount };
  }, []);

  const applyLineLevelRetries = useCallback(async (
    retryLineMap: Map<number, { index: number; sourceText: string; sourceLanguage: string }>,
    effectiveEngine: 'offline' | 'ai' | 'm2m100',
    effectiveTranslationMode: TranslationMode,
    translationSourceLanguage: string,
    normalizedTargetLanguage: string,
    targetLanguage: string,
    geminiContextOverrides?: { baseSystemPrompt?: string }
  ): Promise<{ appliedMap: Map<number, string>; retryAppliedCount: number }> => {
    const appliedMap = new Map<number, string>();
    let retryAppliedCount = 0;
    const retryCandidates = Array.from(retryLineMap.values());
    if (retryCandidates.length === 0) {
      return { appliedMap, retryAppliedCount };
    }

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
      const retryRaw = effectiveEngine === 'offline'
        ? await translateBatchOffline(retryInputs, 'text', effectiveTranslationMode, retrySourceLanguage, normalizedTargetLanguage, offlineBatchBridgeWrapper)
        : await translateBatchGemini(
          retryInputs,
          'text',
          effectiveTranslationMode,
          retrySourceLanguage,
          normalizedTargetLanguage,
          geminiContextOverrides
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

      let finalizedRetry = finalizeTranslatedLine(item.sourceText, retried, normalizedTargetLanguage);

      if (normalizedTargetLanguage === 'th') {
        const directTranslation = lookupShortPhraseTh(item.sourceText);
        if (directTranslation) {
          finalizedRetry = directTranslation;
        }
      }

      if (shouldRetryLineTranslation(item.sourceText, finalizedRetry, item.sourceLanguage, normalizedTargetLanguage)) {
        const hasGlossaryMatch = normalizedTargetLanguage === 'th' && lookupShortPhraseTh(item.sourceText);
        if (!hasGlossaryMatch) {
          return;
        }
      }
      appliedMap.set(item.index, finalizedRetry);
      retryAppliedCount += 1;
    });

    return { appliedMap, retryAppliedCount };
  }, []);

  return {
    evaluateAndApplyGroupRetries,
    applyLineLevelRetries,
  };
}
