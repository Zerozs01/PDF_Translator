import type { OCRPageResult } from '../../types';

export const BENCHMARK_SHORT_KEEP = new Set([
  'i', 'a', 'go', 'to', 'do', 'in', 'on', 'of', 'if', 'is', 'be', 'we', 'us', 'my', 'or', 'an', 'at', 'as', 'am', 'up', 'it',
  // Cyrillic (Russian) common short words to prevent false garbage flags
  'в', 'и', 'с', 'я', 'к', 'о', 'а', 'у', 'он', 'не', 'по', 'на', 'из', 'от', 'до', 'за', 'да', 'но', 'вы', 'ты', 'мы'
]);

export const BENCHMARK_DOMAIN_TOKENS = new Set(['io', 'com', 'net', 'org', 'gg', 'tv']);

export const BENCHMARK_COMPOSITE_WEIGHTS = Object.freeze({
  rawConfidence: 0.35,
  lexicalErrorPenalization: 0.45,
  yieldPreservationDropSafe: 0.20,
});

export const normalizeBenchmarkToken = (token: string): string =>
  String(token || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .trim();

export const isCjkLikeLanguage = (language: string): boolean => {
  const lang = String(language || '').toLowerCase();
  return lang.includes('kor') || lang.includes('ko') ||
         lang.includes('jpn') || lang.includes('ja') ||
         lang.includes('chi') || lang.includes('zh') ||
         lang.includes('tha') || lang.includes('thai') || lang.includes('th');
};

export const toBenchmarkTokens = (result: OCRPageResult): string[] => {
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

export const computeSuspiciousCount = (tokens: string[], language: string): number => {
  const cjkLike = isCjkLikeLanguage(language);
  const jamoRe = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/;
  const syllableRe = /[\uAC00-\uD7AF]/;
  const edgeJamoRe = /^[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]|[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]$/;
  const thaiConsoOnly = /^[\u0E00-\u0E2E]+$/;

  let suspicious = 0;

  const isThai = language.includes('tha') || language.includes('thai') || language.includes('th');

  for (const token of tokens) {
    const clean = token.trim();
    if (!clean) continue;
    const normalized = normalizeBenchmarkToken(clean);
    
    // Flag heavy special characters (punctuation, symbols) as garbage, ignoring letters/numbers of any language
    const specialCharsCount = (clean.match(/[^\p{L}\p{N}\s]/gu) || []).length;
    if (specialCharsCount > 0 && specialCharsCount >= clean.length * 0.5) {
      suspicious += 1;
      continue;
    }

    const hasJamo = jamoRe.test(clean);
    const hasSyllable = syllableRe.test(clean);

    if (hasJamo && !hasSyllable) { suspicious += 1; continue; }
    if (/^[0-9]{1,3}$/.test(clean)) { suspicious += 1; continue; }
    if (cjkLike && /^[A-Za-z]{1,2}$/.test(clean) && !BENCHMARK_SHORT_KEEP.has(clean.toLowerCase())) { suspicious += 1; continue; }
    if (hasSyllable && edgeJamoRe.test(clean) && clean.length <= 4) { suspicious += 1; continue; }
    
    // Thai-specific noise: String of consonants with no vowels/tones
    if (isThai && thaiConsoOnly.test(clean)) {
      if (clean.length === 1 && !['ก็','ณ','ธ'].includes(clean)) {
        suspicious += 1; continue;
      }
      if (clean.length >= 4) {
        suspicious += 1; continue; // 4+ consonants without vowel is highly likely noise (e.g. ดกทศ)
      }
    }

    if (!cjkLike && normalized.length === 1 && !BENCHMARK_SHORT_KEEP.has(normalized)) { suspicious += 1; continue; }
  }

  return suspicious;
};

export const clampUnit = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

export const computeLexicalQuality = (tokens: string[], language: string): number => {
  if (tokens.length === 0) return 0;
  
  const isCjk = isCjkLikeLanguage(language);
  const isThai = language.includes('tha') || language.includes('thai') || language.includes('th');
  const vowelLike = /[aeiouyаеёиоуыэюя]/i; // Includes Latin and Cyrillic vowels
  const thaiVowelTone = /[\u0E30-\u0E4E]/;
  const cjkChars = /[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7A3]/;

  let considered = 0;
  let strong = 0;
  let artifact = 0;

  for (const rawToken of tokens) {
    const normalized = normalizeBenchmarkToken(rawToken);
    if (!normalized) continue;

    considered += 1;

    if (BENCHMARK_DOMAIN_TOKENS.has(normalized) || /^[0-9]{1,4}$/.test(normalized)) {
      artifact += 1;
      continue;
    }

    if (BENCHMARK_SHORT_KEEP.has(normalized)) {
      strong += 1;
      continue;
    }

    if (isThai) {
      if (thaiVowelTone.test(rawToken)) {
        strong += 1;
      } else if (rawToken.length === 1) {
        artifact += 1;
      } else if (rawToken.length >= 2) {
        strong += 0.5; // partial credit
      }
    } else if (isCjk) {
       if (cjkChars.test(rawToken)) strong += 1;
       else if (rawToken.length === 1) artifact += 1;
       else strong += 0.5;
    } else {
      if (normalized.length >= 5 || vowelLike.test(normalized)) {
        strong += 1;
      }
    }
  }

  if (considered === 0) return 0;

  const strongRatio = strong / considered;
  const artifactRatio = artifact / considered;
  return clampUnit(strongRatio - (artifactRatio * 0.45));
};

export const normalizeBenchmarkConfidence = (confidence: number): number => {
  if (!Number.isFinite(confidence)) return 0;
  if (confidence <= 1) return clampUnit(confidence);
  return clampUnit(confidence / 100);
};

export const levenshteinDistance = (left: readonly string[], right: readonly string[]): number => {
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = new Array(right.length + 1).fill(0);
  const current = new Array(right.length + 1).fill(0);

  for (let j = 0; j <= right.length; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost
      );
    }

    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length];
};

export const normalizedEditError = (reference: readonly string[], hypothesis: readonly string[]): number => {
  if (reference.length === 0) {
    return hypothesis.length === 0 ? 0 : 1;
  }
  const distance = levenshteinDistance(reference, hypothesis);
  return clampUnit(distance / Math.max(1, reference.length));
};

export const computeCompositeScore = (summary: {
  confidence: number;
  suspiciousRatio: number;
  droppedCount: number;
  wordCount: number;
  lexicalQuality: number;
  tokens: string[];
  text: string;
  language: string;
}): {
  compositeScore: number;
  rawAxis: number;
  lexicalAxis: number;
  yieldAxis: number;
  werError: number;
  cerError: number;
  garbageRatio: number;
} => {
  const confidenceScore = normalizeBenchmarkConfidence(summary.confidence);

  const werError = 0;
  const cerError = 0;

  const garbageRatio = clampUnit((summary.suspiciousRatio * 0.80) + ((1 - clampUnit(summary.lexicalQuality)) * 0.20));
  
  const lexicalPenalty = garbageRatio;
  const lexicalAxis = clampUnit(1 - lexicalPenalty);

  const effectiveWordCount = summary.wordCount * lexicalAxis;
  const yieldAxis = clampUnit(effectiveWordCount / Math.max(1, summary.wordCount + Math.max(0, summary.droppedCount)));

  const composite = (
    (confidenceScore * BENCHMARK_COMPOSITE_WEIGHTS.rawConfidence)
    + (lexicalAxis * BENCHMARK_COMPOSITE_WEIGHTS.lexicalErrorPenalization)
    + (yieldAxis * BENCHMARK_COMPOSITE_WEIGHTS.yieldPreservationDropSafe)
  ) * 100;

  return {
    compositeScore: Number(composite.toFixed(2)),
    rawAxis: confidenceScore,
    lexicalAxis,
    yieldAxis,
    werError,
    cerError,
    garbageRatio,
  };
};
