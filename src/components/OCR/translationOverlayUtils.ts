import { BBox, OCRLine, OCREngine, OCRPageResult } from '../../types';
import { OCRPreviewMode, OCRTranslationCacheEntry } from '../../stores/useOCRTextLayerStore';

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

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalizeCacheLanguageKey = (value: string): string =>
  String(value || '')
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join('+') || 'eng';

const normalizeTranslationLanguageKey = (value: string, fallback: string): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (TRANSLATION_LANGUAGE_ALIASES[raw]) return TRANSLATION_LANGUAGE_ALIASES[raw];
  const primary = raw.split('-')[0].trim();
  if (!primary) return fallback;
  return TRANSLATION_LANGUAGE_ALIASES[primary] || primary;
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

const buildOCRSourceFingerprint = (result: OCRPageResult, fallbackEngine: OCREngine): string => {
  const effectiveEngine = result.ocrEngine || fallbackEngine;
  return [
    result.algorithmVersion,
    effectiveEngine,
    result.pipelineProfile || 'panel',
    result.language || 'eng',
    result.words.length,
    result.lines.length,
    String(result.text || '').replace(/\s+/g, ' ').trim().length,
  ].join('|');
};

export type TranslationOverlayContext = {
  shouldRender: boolean;
  isStale: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  translatedByIndex: Map<number, string>;
  entry?: OCRTranslationCacheEntry;
};

type ResolveTranslationOverlayArgs = {
  currentPageOCR?: OCRPageResult;
  optionsEngine: OCREngine;
  optionsLanguage: string;
  translationMode: 'manga' | 'official';
  sourceLanguage: string;
  targetLanguage: string;
  translationPreviewMode: OCRPreviewMode;
  currentPageTranslationMap?: Map<string, OCRTranslationCacheEntry>;
  activeTranslationKey?: string;
};

export const resolveTranslationOverlayContext = ({
  currentPageOCR,
  optionsEngine,
  optionsLanguage,
  translationMode,
  sourceLanguage,
  targetLanguage,
  translationPreviewMode,
  currentPageTranslationMap,
  activeTranslationKey,
}: ResolveTranslationOverlayArgs): TranslationOverlayContext => {
  const fallbackSource = normalizeTranslationLanguageKey(sourceLanguage || '', 'en');
  const normalizedTarget = normalizeTranslationLanguageKey(targetLanguage || '', 'th');
  const ocrLanguageKey = currentPageOCR?.language || optionsLanguage || 'eng';
  const normalizedSource = resolveTranslationSourceFromOCRKey(ocrLanguageKey, fallbackSource);

  if (!currentPageOCR || !currentPageTranslationMap || currentPageTranslationMap.size === 0) {
    return {
      shouldRender: false,
      isStale: false,
      sourceLanguage: normalizedSource,
      targetLanguage: normalizedTarget,
      translatedByIndex: new Map<number, string>(),
    };
  }

  const currentEntries = Array.from(currentPageTranslationMap.values()).sort((a, b) => b.createdAt - a.createdAt);
  const currentEngine = (currentPageOCR.ocrEngine || optionsEngine || 'tesseract') as OCREngine;
  const sourceFingerprint = buildOCRSourceFingerprint(currentPageOCR, currentEngine);
  const normalizedCurrentLanguage = normalizeCacheLanguageKey(ocrLanguageKey);

  const matchesContext = (entry: OCRTranslationCacheEntry): boolean => {
    if (entry.ocrEngine !== currentEngine) return false;
    if (entry.translationMode !== translationMode) return false;
    if (normalizeTranslationLanguageKey(entry.sourceLanguage || '', 'en') !== normalizedSource) return false;
    if (normalizeTranslationLanguageKey(entry.targetLanguage || '', 'th') !== normalizedTarget) return false;

    const normalizedEntryLanguage = normalizeCacheLanguageKey(entry.ocrLanguage);
    if (normalizedEntryLanguage === normalizedCurrentLanguage) return true;

    // Fallback for language-key drift across sessions (e.g. kor vs eng+kor) when OCR snapshot is the same.
    if (entry.sourceFingerprint === sourceFingerprint) return true;
    return false;
  };

  const activeEntry = activeTranslationKey && currentPageTranslationMap.has(activeTranslationKey)
    ? currentPageTranslationMap.get(activeTranslationKey)
    : currentEntries[0];
  const preferredEntry = currentEntries.find(matchesContext);
  const resolvedEntry = activeEntry && matchesContext(activeEntry)
    ? activeEntry
    : preferredEntry;

  if (!resolvedEntry) {
    return {
      shouldRender: false,
      isStale: false,
      sourceLanguage: normalizedSource,
      targetLanguage: normalizedTarget,
      translatedByIndex: new Map<number, string>(),
    };
  }

  const isStale = resolvedEntry.sourceFingerprint !== sourceFingerprint;
  const translatedByIndex = new Map<number, string>(
    resolvedEntry.translatedByIndex
      .filter((item) => Number.isFinite(item.index) && String(item.text || '').trim().length > 0)
      .map((item) => [item.index, item.text])
  );

  return {
    shouldRender: translationPreviewMode === 'translated' && !isStale && translatedByIndex.size > 0,
    isStale,
    sourceLanguage: normalizedSource,
    targetLanguage: normalizedTarget,
    translatedByIndex,
    entry: resolvedEntry,
  };
};

type RGB = { r: number; g: number; b: number };

export type OverlayPalette = {
  backgroundColor: string;
  textColor: string;
};

export type OverlayTypography = {
  fontSize: number;
  lineHeight: number;
  padX: number;
  padY: number;
};

export type OverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const DEFAULT_SAMPLE_RGB: RGB = { r: 255, g: 255, b: 255 };

export const DEFAULT_OVERLAY_PALETTE: OverlayPalette = {
  backgroundColor: 'rgb(255, 255, 255)',
  textColor: '#111111',
};

const DEFAULT_OVERLAY_TYPOGRAPHY: OverlayTypography = {
  fontSize: 14,
  lineHeight: 1.12,
  padX: 3,
  padY: 2,
};

const blendRgb = (base: RGB, target: RGB, ratio: number): RGB => ({
  r: Math.round(base.r + (target.r - base.r) * ratio),
  g: Math.round(base.g + (target.g - base.g) * ratio),
  b: Math.round(base.b + (target.b - base.b) * ratio),
});

const srgbToLinear = (value: number): number => {
  const normalized = value / 255;
  if (normalized <= 0.04045) return normalized / 12.92;
  return Math.pow((normalized + 0.055) / 1.055, 2.4);
};

const luminance = (rgb: RGB): number => (
  0.2126 * srgbToLinear(rgb.r)
  + 0.7152 * srgbToLinear(rgb.g)
  + 0.0722 * srgbToLinear(rgb.b)
);

const contrastRatio = (a: RGB, b: RGB): number => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (bright + 0.05) / (dark + 0.05);
};

const chooseReadablePair = (rawBackground: RGB): { bg: RGB; text: RGB } => {
  const white: RGB = { r: 248, g: 250, b: 252 };
  const black: RGB = { r: 12, g: 14, b: 18 };

  const max = Math.max(rawBackground.r, rawBackground.g, rawBackground.b);
  const min = Math.min(rawBackground.r, rawBackground.g, rawBackground.b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const rawLuminance = luminance(rawBackground);

  let background = rawBackground;
  if (rawLuminance > 0.9 || (rawLuminance > 0.78 && saturation < 0.18)) {
    background = { r: 255, g: 255, b: 255 };
  }

  let bestText = contrastRatio(background, black) >= contrastRatio(background, white) ? black : white;
  let bestContrast = contrastRatio(background, bestText);

  for (let i = 0; i < 4 && bestContrast < 4.5; i += 1) {
    if (bestText === black) {
      background = blendRgb(background, { r: 255, g: 255, b: 255 }, 0.16);
    } else {
      background = blendRgb(background, { r: 0, g: 0, b: 0 }, 0.16);
    }
    bestText = contrastRatio(background, black) >= contrastRatio(background, white) ? black : white;
    bestContrast = contrastRatio(background, bestText);
  }

  return { bg: background, text: bestText };
};

const quantizeChannel = (value: number, step: number): number => {
  const q = Math.round(value / step) * step;
  return clamp(q, 0, 255);
};

const computeSaturation = (r: number, g: number, b: number): number => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max <= 0) return 0;
  return (max - min) / max;
};

const hasPositiveBBox = (bbox?: BBox): bbox is BBox => {
  if (!bbox) return false;
  return (bbox.x1 - bbox.x0) > 0 && (bbox.y1 - bbox.y0) > 0;
};

type PaletteSampleBucket = {
  weight: number;
  r: number;
  g: number;
  b: number;
  distance: number;
};

type PaletteSampleStats = {
  totalWeight: number;
  totalR: number;
  totalG: number;
  totalB: number;
  buckets: Map<string, PaletteSampleBucket>;
};

const createPaletteSampleStats = (): PaletteSampleStats => ({
  totalWeight: 0,
  totalR: 0,
  totalG: 0,
  totalB: 0,
  buckets: new Map<string, PaletteSampleBucket>(),
});

const registerPaletteSample = (
  stats: PaletteSampleStats,
  r: number,
  g: number,
  b: number,
  weight: number,
  distance: number
) => {
  if (weight <= 0) return;
  const step = 18;
  const key = `${quantizeChannel(r, step)}|${quantizeChannel(g, step)}|${quantizeChannel(b, step)}`;
  const bucket = stats.buckets.get(key) || { weight: 0, r: 0, g: 0, b: 0, distance: 0 };
  bucket.weight += weight;
  bucket.r += r * weight;
  bucket.g += g * weight;
  bucket.b += b * weight;
  bucket.distance += distance * weight;
  stats.buckets.set(key, bucket);

  stats.totalWeight += weight;
  stats.totalR += r * weight;
  stats.totalG += g * weight;
  stats.totalB += b * weight;
};

const accumulateRegionSamples = (
  context: CanvasRenderingContext2D,
  bbox: BBox,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number,
  expandXRatio: number,
  expandYRatio: number,
  maxExpandX: number,
  maxExpandY: number,
  regionWeight: number,
  stats: PaletteSampleStats
) => {
  if (!sourceWidth || !sourceHeight || !sampleWidth || !sampleHeight || regionWeight <= 0) return;

  const mappedX0 = Math.floor((bbox.x0 / sourceWidth) * sampleWidth);
  const mappedX1 = Math.ceil((bbox.x1 / sourceWidth) * sampleWidth);
  const mappedY0 = Math.floor((bbox.y0 / sourceHeight) * sampleHeight);
  const mappedY1 = Math.ceil((bbox.y1 / sourceHeight) * sampleHeight);

  const boxW = Math.max(1, mappedX1 - mappedX0);
  const boxH = Math.max(1, mappedY1 - mappedY0);
  const expandX = Math.min(maxExpandX, Math.max(1, Math.floor(boxW * expandXRatio)));
  const expandY = Math.min(maxExpandY, Math.max(1, Math.floor(boxH * expandYRatio)));

  const x0 = clamp(mappedX0 - expandX, 0, sampleWidth - 1);
  const y0 = clamp(mappedY0 - expandY, 0, sampleHeight - 1);
  const x1 = clamp(mappedX1 + expandX, x0 + 1, sampleWidth);
  const y1 = clamp(mappedY1 + expandY, y0 + 1, sampleHeight);

  const readW = Math.max(1, x1 - x0);
  const readH = Math.max(1, y1 - y0);

  let imageData: ImageData;
  try {
    imageData = context.getImageData(x0, y0, readW, readH);
  } catch {
    return;
  }

  const pixels = imageData.data;
  const stride = Math.max(1, Math.floor(Math.sqrt((readW * readH) / 240)));
  const centerX = (readW - 1) / 2;
  const centerY = (readH - 1) / 2;

  for (let y = 0; y < readH; y += stride) {
    for (let x = 0; x < readW; x += stride) {
      const idx = (y * readW + x) * 4;
      const alpha = pixels[idx + 3] / 255;
      if (alpha <= 0.05) continue;

      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];

      const dx = (x - centerX) / Math.max(1, readW * 0.5);
      const dy = (y - centerY) / Math.max(1, readH * 0.5);
      const distance = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const centerWeight = clamp(1 - distance * 0.7, 0.16, 1);

      const lum = luminance({ r, g, b });
      let weight = alpha * centerWeight * regionWeight;
      if (lum < 0.15) {
        weight *= 0.06;
      } else if (lum < 0.28) {
        weight *= 0.42;
      }

      registerPaletteSample(stats, r, g, b, weight, distance);
    }
  }
};

const resolveBucketRgb = (bucket: PaletteSampleBucket): RGB => ({
  r: Math.round(bucket.r / Math.max(1e-6, bucket.weight)),
  g: Math.round(bucket.g / Math.max(1e-6, bucket.weight)),
  b: Math.round(bucket.b / Math.max(1e-6, bucket.weight)),
});

const resolveSampleRgb = (stats: PaletteSampleStats): RGB => {
  if (stats.totalWeight <= 0 || stats.buckets.size === 0) {
    return DEFAULT_SAMPLE_RGB;
  }

  const average: RGB = {
    r: Math.round(stats.totalR / stats.totalWeight),
    g: Math.round(stats.totalG / stats.totalWeight),
    b: Math.round(stats.totalB / stats.totalWeight),
  };

  let dominant: PaletteSampleBucket | undefined;
  stats.buckets.forEach((bucket) => {
    if (!dominant || bucket.weight > dominant.weight) {
      dominant = bucket;
    }
  });

  if (!dominant) return average;

  const dominantRgb = resolveBucketRgb(dominant);
  const dominantLum = luminance(dominantRgb);
  const dominantSat = computeSaturation(dominantRgb.r, dominantRgb.g, dominantRgb.b);
  const dominantDistance = dominant.distance / Math.max(1e-6, dominant.weight);

  let neutralCandidate: PaletteSampleBucket | undefined;
  let neutralScore = 0;

  stats.buckets.forEach((bucket) => {
    if (bucket.weight <= 0) return;
    const rgb = resolveBucketRgb(bucket);
    const lum = luminance(rgb);
    const sat = computeSaturation(rgb.r, rgb.g, rgb.b);
    if (lum < 0.74 || sat > 0.2) return;

    const avgDistance = bucket.distance / Math.max(1e-6, bucket.weight);
    const score = bucket.weight * (1.18 - Math.min(1, avgDistance));
    if (score > neutralScore) {
      neutralScore = score;
      neutralCandidate = bucket;
    }
  });

  let resolved = dominantRgb;
  if (neutralCandidate) {
    const neutralRgb = resolveBucketRgb(neutralCandidate);
    const neutralWeightRatio = neutralCandidate.weight / Math.max(1e-6, dominant.weight);
    const neutralDistance = neutralCandidate.distance / Math.max(1e-6, neutralCandidate.weight);
    const neutralCloser = neutralDistance + 0.06 < dominantDistance;
    const dominantBlueish = dominantRgb.b > dominantRgb.r + 12 && dominantRgb.b > dominantRgb.g + 8;

    const shouldUseNeutral = (
      (dominantBlueish && neutralWeightRatio >= 0.24 && neutralCloser)
      || (dominantSat >= 0.24 && neutralWeightRatio >= 0.5 && neutralCloser)
      || (dominantLum < 0.24 && neutralWeightRatio >= 0.22)
      || (neutralWeightRatio >= 0.75 && neutralCloser)
    );

    if (shouldUseNeutral) {
      resolved = neutralRgb;
    }
  }

  const dominanceRatio = dominant.weight / Math.max(1e-6, stats.totalWeight);
  if (dominanceRatio < 0.22) {
    return blendRgb(average, resolved, 0.62);
  }

  return resolved;
};

const sampleDominantRgb = (
  context: CanvasRenderingContext2D,
  bbox: BBox,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number
): RGB => {
  const stats = createPaletteSampleStats();
  if (!hasPositiveBBox(bbox)) return DEFAULT_SAMPLE_RGB;
  accumulateRegionSamples(
    context,
    bbox,
    sourceWidth,
    sourceHeight,
    sampleWidth,
    sampleHeight,
    0.32,
    0.42,
    44,
    52,
    1,
    stats
  );
  return resolveSampleRgb(stats);
};

const sampleDominantRgbFromLine = (
  context: CanvasRenderingContext2D,
  line: OCRLine,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number
): RGB => {
  const stats = createPaletteSampleStats();
  const wordBoxes = Array.isArray(line.words)
    ? line.words.map((word) => word.bbox).filter(hasPositiveBBox)
    : [];

  if (wordBoxes.length > 0) {
    wordBoxes.forEach((bbox) => {
      accumulateRegionSamples(
        context,
        bbox,
        sourceWidth,
        sourceHeight,
        sampleWidth,
        sampleHeight,
        0.2,
        0.28,
        20,
        24,
        1,
        stats
      );
    });
  }

  if (hasPositiveBBox(line.bbox)) {
    accumulateRegionSamples(
      context,
      line.bbox,
      sourceWidth,
      sourceHeight,
      sampleWidth,
      sampleHeight,
      0.14,
      0.18,
      16,
      18,
      wordBoxes.length > 0 ? 0.38 : 1,
      stats
    );
  }

  return resolveSampleRgb(stats);
};

export const sampleOverlayPaletteFromBbox = (
  context: CanvasRenderingContext2D,
  bbox: BBox,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number
): OverlayPalette => {
  const sample = sampleDominantRgb(context, bbox, sourceWidth, sourceHeight, sampleWidth, sampleHeight);
  const pair = chooseReadablePair(sample);
  return {
    backgroundColor: `rgb(${pair.bg.r}, ${pair.bg.g}, ${pair.bg.b})`,
    textColor: `rgb(${pair.text.r}, ${pair.text.g}, ${pair.text.b})`,
  };
};

export const sampleOverlayPaletteFromLine = (
  context: CanvasRenderingContext2D,
  line: OCRLine,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number
): OverlayPalette => {
  const sample = sampleDominantRgbFromLine(context, line, sourceWidth, sourceHeight, sampleWidth, sampleHeight);
  const pair = chooseReadablePair(sample);
  return {
    backgroundColor: `rgb(${pair.bg.r}, ${pair.bg.g}, ${pair.bg.b})`,
    textColor: `rgb(${pair.text.r}, ${pair.text.g}, ${pair.text.b})`,
  };
};

export const estimateLineRotationDeg = (line: OCRLine): number => {
  const words = Array.isArray(line.words)
    ? line.words.filter((word) => {
      const width = (word.bbox?.x1 ?? 0) - (word.bbox?.x0 ?? 0);
      const height = (word.bbox?.y1 ?? 0) - (word.bbox?.y0 ?? 0);
      return width > 0 && height > 0;
    })
    : [];

  if (words.length < 2) return 0;

  const points = words
    .map((word) => ({
      x: ((word.bbox?.x0 ?? 0) + (word.bbox?.x1 ?? 0)) / 2,
      y: ((word.bbox?.y0 ?? 0) + (word.bbox?.y1 ?? 0)) / 2,
    }))
    .sort((a, b) => a.x - b.x);

  const meanX = points.reduce((acc, p) => acc + p.x, 0) / points.length;
  const meanY = points.reduce((acc, p) => acc + p.y, 0) / points.length;

  let numerator = 0;
  let denominator = 0;
  points.forEach((point) => {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
  });

  if (Math.abs(denominator) < 1e-3) return 0;

  const slope = numerator / denominator;
  const degrees = (Math.atan(slope) * 180) / Math.PI;
  if (!Number.isFinite(degrees)) return 0;
  if (Math.abs(degrees) < 2) return 0;
  return clamp(degrees, -28, 28);
};

const estimateLineCount = (text: string, width: number, fontSize: number): number => {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return 1;
  const averageCharWidth = fontSize * 0.56;
  const charsPerLine = Math.max(2, Math.floor(width / Math.max(1, averageCharWidth)));
  return Math.max(1, Math.ceil(compact.length / charsPerLine));
};

export const computeOverlayTypography = (text: string, width: number, height: number): OverlayTypography => {
  const safeWidth = Math.max(8, width);
  const safeHeight = Math.max(8, height);
  let fontSize = clamp(Math.min(safeHeight * 0.96, safeWidth * 0.34), 11, 34);
  const lineHeight = 1.12;

  for (let i = 0; i < 32; i += 1) {
    const padX = Math.max(2, Math.round(fontSize * 0.18));
    const padY = Math.max(1, Math.round(fontSize * 0.08));
    const usableWidth = Math.max(4, safeWidth - padX * 2);
    const usableHeight = Math.max(4, safeHeight - padY * 2);
    const estimatedLines = estimateLineCount(text, usableWidth, fontSize);
    const requiredHeight = estimatedLines * fontSize * lineHeight;
    if (requiredHeight <= usableHeight || fontSize <= 9) {
      return {
        fontSize,
        lineHeight,
        padX,
        padY,
      };
    }
    fontSize -= 0.9;
  }

  return DEFAULT_OVERLAY_TYPOGRAPHY;
};

export const clampOverlayRect = (
  left: number,
  top: number,
  width: number,
  height: number,
  bounds: { x0: number; y0: number; x1: number; y1: number }
): OverlayRect => {
  const minWidth = 1;
  const minHeight = 1;
  const clampedLeft = clamp(left, bounds.x0, Math.max(bounds.x0, bounds.x1 - minWidth));
  const clampedTop = clamp(top, bounds.y0, Math.max(bounds.y0, bounds.y1 - minHeight));
  const maxWidth = Math.max(minWidth, bounds.x1 - clampedLeft);
  const maxHeight = Math.max(minHeight, bounds.y1 - clampedTop);

  return {
    left: clampedLeft,
    top: clampedTop,
    width: Math.max(minWidth, Math.min(width, maxWidth)),
    height: Math.max(minHeight, Math.min(height, maxHeight)),
  };
};
