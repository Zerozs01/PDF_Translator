import { BBox, OCRLine, OCREngine, OCRPageResult } from '../../types';
import { hasCurrentOCRTranslationCacheVersion, OCRPreviewMode, OCRTranslationCacheEntry } from '../../stores/useOCRTextLayerStore';
import { buildOCRSourceFingerprint } from '../../services/ocrSourceFingerprint';

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
  translationMode: 'adaptive' | 'manga' | 'manhwa' | 'official';
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
    if (!hasCurrentOCRTranslationCacheVersion(entry.key)) return false;
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
  const preferredEntry = currentEntries.find((entry) => matchesContext(entry));
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
    shouldRender: translationPreviewMode === 'translated' && translatedByIndex.size > 0 && !isStale,
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
  forceSingleLine: boolean;
  estimatedLines: number;
  contentHeight: number;
};

export type OverlayTypographyHints = {
  sourceText?: string;
  sourceBoxWidth?: number;
  sourceBoxHeight?: number;
  sourceLineCount?: number;
  fontFamily?: string;
  profile?: OverlayLayoutProfile;
  styleKind?: OverlayStyleKind;
};

export type OverlayTypographyInput = {
  index: number;
  text: string;
  width: number;
  height: number;
  bbox: BBox;
  line?: OCRLine;
  hints?: OverlayTypographyHints;
};

export type OverlayLayoutProfile = 'official' | 'adaptive' | 'manga' | 'manhwa';

export type OverlayStyleKind = 'document-heading' | 'document-body' | 'comic-bubble' | 'comic-box' | 'comic-line';

export type OverlayLayout = {
  typography: OverlayTypography;
  alignment?: 'left' | 'center';
  effectiveProfile?: OverlayLayoutProfile;
  styleKind?: OverlayStyleKind;
  sharedTextStartX?: number;
  sharedCenterX?: number;
  sharedBoxLeftX?: number;
  renderText?: string;
  mergedBBox?: BBox;
  mergedMaskBBox?: BBox;
  hidden?: boolean;
};

export type OverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type OverlayMaskExpansion = {
  expandXRatio: number;
  expandTopRatio: number;
  expandBottomRatio: number;
  maxExpandX: number;
  maxExpandTop: number;
  maxExpandBottom: number;
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
  forceSingleLine: false,
  estimatedLines: 1,
  contentHeight: 18,
};

const blendRgb = (base: RGB, target: RGB, ratio: number): RGB => ({
  r: Math.round(base.r + (target.r - base.r) * ratio),
  g: Math.round(base.g + (target.g - base.g) * ratio),
  b: Math.round(base.b + (target.b - base.b) * ratio),
});

const rgbDistance = (a: RGB, b: RGB): number => {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
};

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

export const resolveOverlaySourceBBox = (line: OCRLine): BBox => {
  if (!Array.isArray(line.words) || line.words.length === 0) {
    return line.bbox;
  }

  const validWords = line.words.filter((word) => hasPositiveBBox(word?.bbox));
  const meaningfulWords = validWords.filter((word) => MEANINGFUL_WORD_REGEX.test(String(word.text || '').trim()));
  const wordSource = meaningfulWords.length > 0 ? meaningfulWords : validWords;
  const validWordBoxes = wordSource.map((word) => word.bbox);

  if (validWordBoxes.length === 0) {
    return line.bbox;
  }

  return validWordBoxes.reduce<BBox>((acc, bbox) => ({
    x0: Math.min(acc.x0, bbox.x0),
    y0: Math.min(acc.y0, bbox.y0),
    x1: Math.max(acc.x1, bbox.x1),
    y1: Math.max(acc.y1, bbox.y1),
  }), {
    ...validWordBoxes[0],
  });
};

export const resolveOverlayMaskBBox = (line: OCRLine): BBox => {
  const sourceBbox = resolveOverlaySourceBBox(line);
  if (!hasPositiveBBox(line.bbox)) {
    return sourceBbox;
  }

  return {
    x0: Math.min(line.bbox.x0, sourceBbox.x0),
    y0: Math.min(line.bbox.y0, sourceBbox.y0),
    x1: Math.max(line.bbox.x1, sourceBbox.x1),
    y1: Math.max(line.bbox.y1, sourceBbox.y1),
  };
};

const MEANINGFUL_WORD_REGEX = /[\p{L}\p{N}]/u;

const resolveOverlayTextStartX = (line: OCRLine, bbox: BBox): number => {
  if (!Array.isArray(line.words) || line.words.length === 0) return bbox.x0;

  const validWords = line.words.filter((word) => hasPositiveBBox(word?.bbox));
  if (validWords.length === 0) return bbox.x0;

  const meaningful = validWords.find((word) => MEANINGFUL_WORD_REGEX.test(String(word.text || '').trim()));
  return (meaningful || validWords[0]).bbox.x0;
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

const sampleForegroundRgbFromLine = (
  context: CanvasRenderingContext2D,
  line: OCRLine,
  sourceWidth: number,
  sourceHeight: number,
  sampleWidth: number,
  sampleHeight: number,
  background: RGB
): RGB | null => {
  if (!sourceWidth || !sourceHeight || !sampleWidth || !sampleHeight) return null;

  const wordBoxes = Array.isArray(line.words)
    ? line.words.map((word) => word.bbox).filter(hasPositiveBBox)
    : [];

  const regions = wordBoxes.length > 0
    ? wordBoxes
    : (hasPositiveBBox(line.bbox) ? [line.bbox] : []);

  if (regions.length === 0) return null;

  const stats = createPaletteSampleStats();

  regions.forEach((bbox) => {
    const mappedX0 = Math.floor((bbox.x0 / sourceWidth) * sampleWidth);
    const mappedX1 = Math.ceil((bbox.x1 / sourceWidth) * sampleWidth);
    const mappedY0 = Math.floor((bbox.y0 / sourceHeight) * sampleHeight);
    const mappedY1 = Math.ceil((bbox.y1 / sourceHeight) * sampleHeight);

    const x0 = clamp(mappedX0, 0, sampleWidth - 1);
    const y0 = clamp(mappedY0, 0, sampleHeight - 1);
    const x1 = clamp(mappedX1, x0 + 1, sampleWidth);
    const y1 = clamp(mappedY1, y0 + 1, sampleHeight);

    const readW = Math.max(1, x1 - x0);
    const readH = Math.max(1, y1 - y0);
    let imageData: ImageData;
    try {
      imageData = context.getImageData(x0, y0, readW, readH);
    } catch {
      return;
    }

    const pixels = imageData.data;
    const stride = Math.max(1, Math.floor(Math.sqrt((readW * readH) / 260)));
    const centerX = (readW - 1) / 2;
    const centerY = (readH - 1) / 2;

    for (let y = 0; y < readH; y += stride) {
      for (let x = 0; x < readW; x += stride) {
        const idx = (y * readW + x) * 4;
        const alpha = pixels[idx + 3] / 255;
        if (alpha <= 0.08) continue;

        const rgb: RGB = { r: pixels[idx], g: pixels[idx + 1], b: pixels[idx + 2] };
        const distance = rgbDistance(rgb, background);
        if (distance < 34) continue;

        const contrast = contrastRatio(rgb, background);
        if (contrast < 1.35) continue;

        const saturation = computeSaturation(rgb.r, rgb.g, rgb.b);
        const dx = (x - centerX) / Math.max(1, readW * 0.5);
        const dy = (y - centerY) / Math.max(1, readH * 0.5);
        const radialDistance = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const centerWeight = clamp(1 - radialDistance * 0.55, 0.3, 1);
        let weight = alpha * centerWeight * clamp(distance / 160, 0.28, 1.36) * clamp(contrast / 2.8, 0.52, 1.32);

        // Prefer colorful non-black text when available (e.g., blue headers).
        if (saturation >= 0.16) {
          weight *= 1.25;
        }

        registerPaletteSample(stats, rgb.r, rgb.g, rgb.b, weight, radialDistance);
      }
    }
  });

  if (stats.totalWeight <= 0) return null;
  const candidate = resolveSampleRgb(stats);
  if (rgbDistance(candidate, background) < 26) return null;
  return candidate;
};

const ensureReadableTextColor = (candidate: RGB, background: RGB, fallback: RGB): RGB => {
  const dark: RGB = { r: 12, g: 14, b: 18 };
  const light: RGB = { r: 248, g: 250, b: 252 };
  const saturation = computeSaturation(candidate.r, candidate.g, candidate.b);
  const initialContrast = contrastRatio(candidate, background);
  const colorSpread = Math.max(candidate.r, candidate.g, candidate.b) - Math.min(candidate.r, candidate.g, candidate.b);

  // If candidate is basically neutral/black-ish, fallback keeps readability stable.
  if (saturation < 0.08 && colorSpread < 18) {
    return fallback;
  }

  if (initialContrast >= 2.55) {
    return candidate;
  }

  const target = contrastRatio(dark, background) >= contrastRatio(light, background) ? dark : light;
  let adjusted = candidate;
  for (let i = 0; i < 4; i += 1) {
    adjusted = blendRgb(adjusted, target, 0.22);
    if (contrastRatio(adjusted, background) >= 2.55) {
      return adjusted;
    }
  }

  return fallback;
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
  const foregroundCandidate = sampleForegroundRgbFromLine(
    context,
    line,
    sourceWidth,
    sourceHeight,
    sampleWidth,
    sampleHeight,
    pair.bg
  );
  const resolvedText = foregroundCandidate
    ? ensureReadableTextColor(
      foregroundCandidate,
      pair.bg,
      pair.text
    )
    : pair.text;

  return {
    backgroundColor: `rgb(${pair.bg.r}, ${pair.bg.g}, ${pair.bg.b})`,
    textColor: `rgb(${resolvedText.r}, ${resolvedText.g}, ${resolvedText.b})`,
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

const estimateLineCountHeuristic = (text: string, width: number, fontSize: number): number => {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  if (!compact) return 1;
  const averageCharWidth = fontSize * 0.56;
  const charsPerLine = Math.max(2, Math.floor(width / Math.max(1, averageCharWidth)));
  return Math.max(1, Math.ceil(compact.length / charsPerLine));
};

const compactTextLength = (value: string): number =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .length;

const tightenBracketSpacing = (value: string): string =>
  String(value || '')
    .replace(/([\(\[\{])\s+/g, '$1')
    .replace(/\s+([\)\]\}])/g, '$1');

export const normalizeOverlayInlineText = (value: string): string =>
  tightenBracketSpacing(String(value || ''))
    .replace(/\s{2,}/g, ' ')
    .trim();

const LABEL_TOKEN_REGEX = /^[\(\[\{]?[A-Za-z0-9\u0E00-\u0E7F]{1,8}[\)\]\}]?$/;
const SHORT_SYMBOLIC_LINE_REGEX = /^[A-Za-z0-9\u0E00-\u0E7F\(\)\[\]\{\}\.,:;+\-_/=<>]+$/;
const THAI_CHAR_REGEX = /[\u0E00-\u0E7F]/;
const CJK_CHAR_REGEX = /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;
const HEADING_SOURCE_HINT_REGEX = /\b(chapter|objective|objectives|condition|conditions|equilibrium|rigid(?:-body)?|body|summary|introduction|appendix|section|support|diagram)\b/i;

type TextMeasureContext = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;

let textMeasureContext: TextMeasureContext | null | undefined;
const textSegmenterCache = new Map<string, Intl.Segmenter | null>();

const getTextMeasureContext = (): TextMeasureContext | null => {
  if (textMeasureContext !== undefined) return textMeasureContext;

  try {
    if (typeof document !== 'undefined') {
      textMeasureContext = document.createElement('canvas').getContext('2d');
      return textMeasureContext;
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      const context = new OffscreenCanvas(1, 1).getContext('2d');
      textMeasureContext = context ? context as unknown as TextMeasureContext : null;
      return textMeasureContext;
    }
  } catch {
    // Fall back to heuristic-only sizing when canvas measurement is unavailable.
  }

  textMeasureContext = null;
  return textMeasureContext;
};

const buildMeasureFont = (fontSize: number, fontFamily?: string): string =>
  `400 ${fontSize}px ${fontFamily || 'sans-serif'}`;

const getTextSegmenter = (locale: string): Intl.Segmenter | null => {
  const key = locale || 'default';
  if (textSegmenterCache.has(key)) {
    return textSegmenterCache.get(key) || null;
  }

  try {
    const SegmenterCtor = (Intl as typeof Intl & { Segmenter?: typeof Intl.Segmenter }).Segmenter;
    if (!SegmenterCtor) {
      textSegmenterCache.set(key, null);
      return null;
    }
    const segmenter = new SegmenterCtor(locale || undefined, { granularity: 'word' });
    textSegmenterCache.set(key, segmenter);
    return segmenter;
  } catch {
    textSegmenterCache.set(key, null);
    return null;
  }
};

const tokenizeForWrap = (text: string): { tokens: string[]; joinWithSpace: boolean } => {
  const normalized = normalizeOverlayInlineText(text);
  if (!normalized) return { tokens: [], joinWithSpace: true };

  const containsThai = THAI_CHAR_REGEX.test(normalized);
  const containsCjk = CJK_CHAR_REGEX.test(normalized);
  if (!containsThai && !containsCjk) {
    return {
      tokens: normalized.split(/\s+/g).filter(Boolean),
      joinWithSpace: true,
    };
  }

  const locale = containsThai ? 'th' : 'ja';
  const segmenter = getTextSegmenter(locale);
  if (!segmenter) {
    return {
      tokens: normalized.split(/\s+/g).filter(Boolean),
      joinWithSpace: !containsThai && !containsCjk,
    };
  }

  const tokens = Array.from(segmenter.segment(normalized))
    .map((segment) => segment.segment.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return {
      tokens: normalized.split(/\s+/g).filter(Boolean),
      joinWithSpace: !containsThai && !containsCjk,
    };
  }

  return { tokens, joinWithSpace: false };
};

const countWords = (value: string): number =>
  normalizeOverlayInlineText(value)
    .split(/\s+/g)
    .filter(Boolean)
    .length;

const looksDocumentLikeSourceText = (value: string): boolean => {
  const normalized = normalizeOverlayInlineText(value);
  if (!normalized) return false;
  const wordCount = countWords(normalized);
  if (wordCount < 3) return false;
  return /[a-z]/.test(normalized);
};

const looksHeadingLikeSourceLine = (value: string): boolean => {
  const normalized = normalizeOverlayInlineText(value);
  if (!normalized) return false;
  if (/[.!?]$/.test(normalized)) return false;

  const words = normalized.split(/\s+/g).filter(Boolean);
  if (words.length === 0 || words.length > 10) return false;

  const uppercaseWords = words.filter((word) => {
    const letters = word.replace(/[^A-Za-z]/g, '');
    return letters.length >= 2 && letters === letters.toUpperCase();
  }).length;
  const titleCaseWords = words.filter((word) => /^[A-Z][A-Za-z0-9-]+$/.test(word)).length;

  return (
    HEADING_SOURCE_HINT_REGEX.test(normalized)
    || uppercaseWords >= Math.max(1, Math.ceil(words.length * 0.45))
    || titleCaseWords >= Math.max(2, Math.floor(words.length * 0.55))
  );
};

const resolveDocumentHeadingBoost = (
  sourceText: string,
  sourceBoxWidth: number,
  sourceBoxHeight: number
): number => {
  if (!looksHeadingLikeSourceLine(sourceText)) return 1;
  const width = Math.max(1, sourceBoxWidth);
  const height = Math.max(1, sourceBoxHeight);
  const aspectRatio = width / height;
  if (aspectRatio >= 8.5) return 1.4;
  if (aspectRatio >= 6.5) return 1.34;
  return 1.28;
};

const resolveDocumentStyleKind = (sourceText: string): OverlayStyleKind => (
  looksHeadingLikeSourceLine(sourceText) ? 'document-heading' : 'document-body'
);

const resolveOverlayStyleKind = (
  effectiveProfile: OverlayLayoutProfile,
  sourceText: string,
  options?: { merged?: boolean; boxed?: boolean }
): OverlayStyleKind => {
  if (effectiveProfile === 'official') {
    return resolveDocumentStyleKind(sourceText);
  }
  if (options?.merged) return 'comic-bubble';
  if (options?.boxed) return 'comic-box';
  return 'comic-line';
};

const shouldUseDocumentTypographyProfile = (
  profile: OverlayLayoutProfile,
  text: string,
  hints?: OverlayTypographyHints
): boolean => {
  if (profile === 'official') return true;
  const sourceText = hints?.sourceText || '';
  const sourceBoxWidth = Math.max(1, hints?.sourceBoxWidth ?? 0);
  const sourceBoxHeight = Math.max(1, hints?.sourceBoxHeight ?? 0);
  const elongatedLine = sourceBoxWidth / sourceBoxHeight >= 6.2;
  const headingElongatedLine = sourceBoxWidth / sourceBoxHeight >= 4.4;
  const longSource = compactTextLength(sourceText) >= 18;
  const paragraphish = countWords(sourceText) >= 4 || countWords(text) >= 4;
  const headingLike = looksHeadingLikeSourceLine(sourceText) && headingElongatedLine && countWords(sourceText) >= 2;
  const bodyLike = looksDocumentLikeSourceText(sourceText) && elongatedLine && longSource && paragraphish;
  if (profile === 'adaptive') {
    return headingLike || bodyLike;
  }
  if (profile === 'manga' || profile === 'manhwa') {
    return bodyLike;
  }
  return headingLike || bodyLike;
};

const resolveOverlayLineHeight = (text: string): number => (
  THAI_CHAR_REGEX.test(text) ? 1.16 : CJK_CHAR_REGEX.test(text) ? 1.08 : 1.11
);

const resolveOverlayPadding = (fontSize: number, text: string): { padX: number; padY: number } => {
  const containsThai = THAI_CHAR_REGEX.test(text);
  return {
    padX: Math.max(1, Math.round(fontSize * (containsThai ? 0.08 : 0.1))),
    padY: Math.max(1, Math.round(fontSize * (containsThai ? 0.08 : 0.09))),
  };
};

export const resolveOverlayMaskExpansion = (line: OCRLine): OverlayMaskExpansion => {
  const compactLabel = isSingleLineLabelCandidate(line.text, line.text) || (line.words?.length ?? 0) <= 3;
  return compactLabel
    ? {
        expandXRatio: 0.04,
        expandTopRatio: 0.02,
        expandBottomRatio: 0.02,
        maxExpandX: 4,
        maxExpandTop: 3,
        maxExpandBottom: 3,
      }
    : {
        expandXRatio: 0.05,
        expandTopRatio: 0.025,
        expandBottomRatio: 0.03,
        maxExpandX: 5,
        maxExpandTop: 3,
        maxExpandBottom: 4,
      };
};

const isSingleLineLabelCandidate = (text: string, sourceText?: string): boolean => {
  const normalized = normalizeOverlayInlineText(text);
  const sourceNormalized = normalizeOverlayInlineText(sourceText || '');
  const compact = normalized.replace(/\s+/g, '');
  const sourceCompact = sourceNormalized.replace(/\s+/g, '');

  if (!compact) return false;
  if (LABEL_TOKEN_REGEX.test(compact)) return true;
  if (sourceCompact && LABEL_TOKEN_REGEX.test(sourceCompact) && compact.length <= 20) return true;

  const words = normalized.split(/\s+/g).filter(Boolean);
  if (
    compact.length <= 14
    && words.length <= 3
    && SHORT_SYMBOLIC_LINE_REGEX.test(compact)
    && !/[\u0E00-\u0E7F]{5,}/.test(compact)
  ) {
    return true;
  }

  return false;
};

const estimateSingleLineWidthHeuristic = (text: string, fontSize: number): number => {
  const normalized = normalizeOverlayInlineText(text);
  if (!normalized) return fontSize;

  let total = 0;
  for (const ch of normalized) {
    if (/\s/.test(ch)) {
      total += fontSize * 0.28;
    } else if (/[A-Z]/.test(ch)) {
      total += fontSize * 0.58;
    } else if (/[a-z0-9]/.test(ch)) {
      total += fontSize * 0.54;
    } else if (/[\u0E00-\u0E7F]/.test(ch)) {
      total += fontSize * 0.64;
    } else if (/[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(ch)) {
      total += fontSize * 0.9;
    } else if (/[\(\)\[\]\{\}\.,:;]/.test(ch)) {
      total += fontSize * 0.34;
    } else {
      total += fontSize * 0.5;
    }
  }
  return total;
};

const measureSingleLineWidth = (text: string, fontSize: number, fontFamily?: string): number => {
  const normalized = normalizeOverlayInlineText(text);
  if (!normalized) return fontSize;

  const context = getTextMeasureContext();
  if (!context) {
    return estimateSingleLineWidthHeuristic(normalized, fontSize);
  }

  context.font = buildMeasureFont(fontSize, fontFamily);
  return context.measureText(normalized).width;
};

const countWrappedLines = (
  text: string,
  width: number,
  fontSize: number,
  fontFamily?: string
): number => {
  const normalized = normalizeOverlayInlineText(text);
  if (!normalized) return 1;

  const context = getTextMeasureContext();
  if (!context) {
    return estimateLineCountHeuristic(normalized, width, fontSize);
  }

  context.font = buildMeasureFont(fontSize, fontFamily);
  if (!/\s/.test(normalized) && !THAI_CHAR_REGEX.test(normalized) && !CJK_CHAR_REGEX.test(normalized)) {
    return Math.max(1, Math.ceil(context.measureText(normalized).width / Math.max(1, width)));
  }

  const { tokens: words, joinWithSpace } = tokenizeForWrap(normalized);
  if (words.length === 0) return 1;

  let lines = 1;
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine
      ? (joinWithSpace ? `${currentLine} ${word}` : `${currentLine}${word}`)
      : word;
    if (!currentLine || context.measureText(candidate).width <= width) {
      currentLine = candidate;
      continue;
    }

    lines += 1;
    currentLine = word;
  }

  return Math.max(1, lines);
};

const resolveWrappedLineEstimate = (
  text: string,
  width: number,
  fontSize: number,
  fontFamily: string | undefined,
  styleKind: OverlayStyleKind,
  boxWidth: number,
  boxHeight: number
): number => {
  const baseLines = countWrappedLines(text, width, fontSize, fontFamily);
  if (baseLines <= 1) return 1;

  const normalized = normalizeOverlayInlineText(text);
  const containsThai = THAI_CHAR_REGEX.test(normalized);
  const containsLatinLike = /[A-Za-z\u00C0-\u024F]/.test(normalized);
  const tokenCount = countWords(normalized);
  const compactLength = compactTextLength(normalized);
  const aspectRatio = boxWidth / Math.max(1, boxHeight);

  let extraLines = 0;

  if (containsThai) {
    if (styleKind === 'comic-bubble') {
      if (tokenCount >= 4 || compactLength >= 18) extraLines += 1.15;
      if (aspectRatio <= 3.6) extraLines += 0.45;
    } else if (styleKind === 'comic-box') {
      if (tokenCount >= 4 || compactLength >= 16) extraLines += 0.82;
      if (aspectRatio <= 3) extraLines += 0.3;
    } else if (styleKind === 'comic-line' && compactLength >= 16) {
      extraLines += 0.35;
    }
  } else if (containsLatinLike && (styleKind === 'comic-bubble' || styleKind === 'comic-box')) {
    if (tokenCount >= 6 && compactLength >= 20) extraLines += 0.42;
    if (aspectRatio <= 3.4) extraLines += 0.22;
  }

  return Math.max(baseLines, Math.ceil(baseLines + extraLines - 0.001));
};

const resolveSourceLineFloor = (
  styleKind: OverlayStyleKind,
  sourceLineCount: number,
  sourceLength: number,
  targetLength: number,
  containsThai: boolean,
  containsCjk: boolean,
  preferSingleLine: boolean
): number => {
  if (preferSingleLine || sourceLineCount <= 1) return 1;
  if (styleKind !== 'comic-bubble' && styleKind !== 'comic-box') return 1;

  const densityRatio = sourceLength > 0 && targetLength > 0
    ? clamp(targetLength / sourceLength, containsThai ? 0.54 : containsCjk ? 0.58 : 0.6, 1.25)
    : 1;
  const baseRatio = styleKind === 'comic-bubble'
    ? (containsThai ? 0.9 : containsCjk ? 0.86 : 0.84)
    : (containsThai ? 0.84 : containsCjk ? 0.8 : 0.78);
  const densityBoost = densityRatio >= 0.88
    ? 1
    : densityRatio >= 0.72
      ? 0.94
      : densityRatio >= 0.58
        ? 0.86
        : 0.76;

  const computedFloor = Math.max(1, Math.ceil(sourceLineCount * baseRatio * densityBoost));
  if (containsThai && styleKind === 'comic-bubble' && sourceLineCount >= 3) {
    return Math.max(computedFloor, sourceLineCount);
  }
  if (containsThai && styleKind === 'comic-box' && sourceLineCount >= 3) {
    return Math.max(computedFloor, sourceLineCount - 1);
  }
  return computedFloor;
};

export const computeOverlayTypography = (
  text: string,
  width: number,
  height: number,
  hints?: OverlayTypographyHints
): OverlayTypography => {
  const safeWidth = Math.max(8, width);
  const safeHeight = Math.max(8, height);
  const sourceWidth = Math.max(8, hints?.sourceBoxWidth ?? safeWidth);
  const sourceHeight = Math.max(8, hints?.sourceBoxHeight ?? safeHeight);
  const sourceLength = compactTextLength(hints?.sourceText || '');
  const targetLength = compactTextLength(text);
  const sourceWordCount = countWords(hints?.sourceText || '');
  const sourceLineCount = Math.max(1, hints?.sourceLineCount ?? 1);
  const containsThai = THAI_CHAR_REGEX.test(text);
  const containsCjk = CJK_CHAR_REGEX.test(text);
  const sourceAspectRatio = sourceWidth / Math.max(1, sourceHeight);
  const profile = hints?.profile || 'official';
  const styleKind = hints?.styleKind || (
    shouldUseDocumentTypographyProfile(profile, text, hints)
      ? resolveDocumentStyleKind(hints?.sourceText || text)
      : 'comic-line'
  );
  const useDocumentTypographyProfile = styleKind === 'document-heading' || styleKind === 'document-body';
  const isAdaptiveProfile = profile === 'adaptive';
  const isComicLikeProfile = styleKind === 'comic-bubble' || styleKind === 'comic-box' || styleKind === 'comic-line';
  const isComicBubble = styleKind === 'comic-bubble';
  const isComicBox = styleKind === 'comic-box';
  const sourceLooksHeading = styleKind === 'document-heading';
  const documentBodyLike = styleKind === 'document-body' && countWords(hints?.sourceText || text) >= 7;
  const documentBodyBoost = styleKind === 'document-body'
    ? (documentBodyLike ? (containsThai ? 1.16 : 1.1) : (containsThai ? 1.11 : 1.07))
    : 1;
  const comicProfileScale = isComicBubble
    ? (profile === 'manga' ? 1.12 : profile === 'manhwa' ? 1.08 : 1.04)
    : isComicBox
      ? (profile === 'manga' ? 1.06 : profile === 'manhwa' ? 1.04 : 1)
      : (profile === 'manga' ? 1 : profile === 'manhwa' ? 0.98 : 0.95);
  const riskyNarrowBox = safeWidth <= 28 || (safeWidth <= 36 && safeWidth < safeHeight * 0.92);
  const severeWrapRisk = riskyNarrowBox && targetLength >= 4;
  const sourceSingleLineHint = !useDocumentTypographyProfile
    && sourceAspectRatio >= (profile === 'manga' || profile === 'manhwa' ? 2.8 : 3.2)
    && sourceWordCount >= 2
    && sourceLength >= 8;
  const preferSingleLine = !isComicBubble && (
    isSingleLineLabelCandidate(text, hints?.sourceText)
    || severeWrapRisk
    || (sourceSingleLineHint && targetLength <= Math.max(sourceLength * 1.6, 28))
    || (sourceLength > 0 && safeHeight <= sourceHeight * 1.42)
  );
  const normalizedInlineText = normalizeOverlayInlineText(text);
  const ratio = sourceLength > 0 && targetLength > 0
    ? clamp(
      Math.pow(sourceLength / targetLength, containsThai ? 0.72 : containsCjk ? 0.68 : 0.76),
      containsThai ? 0.66 : containsCjk ? 0.7 : 0.58,
      isComicBubble ? (isAdaptiveProfile ? 1.18 : 1.22) : isComicBox ? (isAdaptiveProfile ? 1.14 : 1.18) : isComicLikeProfile ? (isAdaptiveProfile ? 1.12 : 1.16) : 1.08
    )
    : 1;
  const scriptScale = isComicLikeProfile
    ? ((containsThai ? (isComicBubble ? 1.08 : isComicBox ? 1.06 : 1.04) : containsCjk ? 1.01 : (isComicBubble ? 1.04 : isComicBox ? 1.02 : 1)) * comicProfileScale)
    : (containsThai ? (sourceLooksHeading ? 1 : 0.96) : containsCjk ? 0.95 : (sourceLooksHeading ? 0.98 : 0.95));
  const documentHeadingBoost = sourceLooksHeading
    ? resolveDocumentHeadingBoost(hints?.sourceText || '', sourceWidth, sourceHeight)
    : documentBodyBoost;

  const sourceDriven = sourceHeight
    * (preferSingleLine ? (isComicBubble ? 0.8 : isComicBox ? 0.75 : useDocumentTypographyProfile ? 0.72 : 0.7) : (isComicBubble ? 0.76 : isComicBox ? 0.7 : useDocumentTypographyProfile ? 0.66 : 0.63))
    * ratio
    * scriptScale
    * documentHeadingBoost;
  const minFontSize = clamp(
    sourceHeight * (
      preferSingleLine
        ? (isComicBubble ? 0.58 : isComicLikeProfile ? 0.48 : (sourceLooksHeading ? 0.43 : 0.39))
        : (isComicBubble ? 0.54 : isComicBox ? 0.46 : isComicLikeProfile ? 0.41 : (sourceLooksHeading ? 0.4 : 0.38))
    ) * (containsThai ? (isComicLikeProfile ? 0.94 : 0.92) : 1),
    6,
    isComicBubble ? 22 : isComicBox ? 20 : isComicLikeProfile ? 18 : (sourceLooksHeading ? 20 : 16)
  );
  let fontSize = clamp(
    Math.min(
      sourceDriven,
      safeHeight * (
        preferSingleLine
          ? (isComicBubble ? 0.88 : isComicLikeProfile ? 0.8 : (sourceLooksHeading ? 0.74 : 0.6))
          : (isComicBubble ? 0.88 : isComicBox ? 0.84 : isComicLikeProfile ? 0.8 : (sourceLooksHeading ? 0.78 : 0.68))
      ),
      safeWidth * (
        preferSingleLine
          ? (isComicBubble ? 0.48 : isComicBox ? 0.43 : isComicLikeProfile ? 0.4 : (sourceLooksHeading ? 0.38 : 0.3))
          : (isComicBubble ? 0.52 : isComicBox ? 0.47 : isComicLikeProfile ? 0.44 : (sourceLooksHeading ? 0.44 : 0.36))
      ),
      sourceWidth * (
        preferSingleLine
          ? (isComicBubble ? 0.43 : isComicBox ? 0.38 : isComicLikeProfile ? 0.35 : (sourceLooksHeading ? 0.33 : 0.25))
          : (isComicBubble ? 0.46 : isComicBox ? 0.41 : isComicLikeProfile ? 0.38 : (sourceLooksHeading ? 0.38 : 0.3))
      )
    ),
    minFontSize,
    sourceLooksHeading ? 34 : 30
  );
  fontSize *= preferSingleLine
    ? (isComicBubble ? (isAdaptiveProfile ? 1.12 : 1.14) : isComicBox ? (isAdaptiveProfile ? 1.04 : 1.06) : isComicLikeProfile ? (isAdaptiveProfile ? 0.98 : 1) : (sourceLooksHeading ? 1.02 : 0.8))
    : (isComicBubble ? (isAdaptiveProfile ? 1.04 : 1.08) : isComicBox ? (isAdaptiveProfile ? 0.98 : 1) : isComicLikeProfile ? (isAdaptiveProfile ? 0.94 : 0.96) : (sourceLooksHeading ? 1 : styleKind === 'document-body' ? (containsThai ? 0.95 : 0.92) : 0.89));
  const lineHeight = resolveOverlayLineHeight(text)
    + (
      containsThai
        ? (isComicBubble ? 0.08 : isComicBox ? 0.05 : isComicLikeProfile ? 0.03 : styleKind === 'document-body' ? 0.02 : 0)
        : 0
    );

  for (let i = 0; i < 32; i += 1) {
    const snappedFont = Math.round(fontSize * 4) / 4;
    const { padX, padY } = resolveOverlayPadding(snappedFont, text);
    const usableWidth = Math.max(4, safeWidth - padX * 2);
    const usableHeight = Math.max(4, safeHeight - padY * 2);
    const singleLineWidth = measureSingleLineWidth(normalizedInlineText, snappedFont, hints?.fontFamily);
    const effectiveSingleLine = preferSingleLine
      && singleLineWidth <= usableWidth * (containsThai ? 1.02 : 1);
    const estimatedLines = Math.max(
      effectiveSingleLine
      ? 1
      : resolveWrappedLineEstimate(
          text,
          usableWidth,
          snappedFont,
          hints?.fontFamily,
          styleKind,
          safeWidth,
          safeHeight
        ),
      resolveSourceLineFloor(
        styleKind,
        sourceLineCount,
        sourceLength,
        targetLength,
        containsThai,
        containsCjk,
        effectiveSingleLine
      )
    );
    const ascenderSafety = Math.max(1, Math.round(snappedFont * (containsThai ? (useDocumentTypographyProfile ? 0.14 : isComicBubble ? 0.12 : 0.1) : 0.05)));
    const descenderSafety = Math.max(1, Math.round(snappedFont * (containsThai ? (useDocumentTypographyProfile ? 0.22 : isComicBubble ? 0.2 : 0.18) : 0.14)));
    const requiredHeight = estimatedLines * snappedFont * lineHeight + ascenderSafety + descenderSafety;
    const widthFits = effectiveSingleLine || estimatedLines > 1 || singleLineWidth <= usableWidth;
    if ((requiredHeight <= usableHeight && widthFits) || fontSize <= minFontSize) {
      return {
        fontSize: snappedFont,
        lineHeight,
        padX,
        padY,
        forceSingleLine: effectiveSingleLine,
        estimatedLines,
        contentHeight: requiredHeight,
      };
    }
    fontSize -= fontSize >= 16 ? 0.9 : 0.55;
  }

  return DEFAULT_OVERLAY_TYPOGRAPHY;
};

const resolveHorizontalOverlapRatio = (a: BBox, b: BBox): number => {
  const overlap = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  return overlap / Math.max(1, Math.min(a.x1 - a.x0, b.x1 - b.x0));
};

const isParagraphLikeOverlayInput = (input: OverlayTypographyInput): boolean => {
  const wordCount = input.line?.words?.length || 0;
  return wordCount >= 4 || compactTextLength(input.text) >= 24;
};

const resolveMedian = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) * 0.5;
};

const resolveLowerBandAverage = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const bandSize = Math.max(1, Math.ceil(sorted.length / 2));
  const band = sorted.slice(0, bandSize);
  return band.reduce((sum, value) => sum + value, 0) / band.length;
};

const resolveRange = (values: number[]): number => {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
};

const joinOverlayGroupText = (group: OverlayTypographyInput[]): string => normalizeOverlayInlineText(
  group
    .map((item) => String(item.text || '').trim())
    .filter(Boolean)
    .join(' ')
);

const shouldHarmonizeOverlayBlock = (
  previous: OverlayTypographyInput,
  current: OverlayTypographyInput,
  profile: OverlayLayoutProfile = 'official'
): boolean => {
  const isDocumentProfile = profile === 'official';
  const prevHeight = Math.max(1, previous.bbox.y1 - previous.bbox.y0);
  const currHeight = Math.max(1, current.bbox.y1 - current.bbox.y0);
  const avgHeight = (prevHeight + currHeight) * 0.5;
  const heightRatio = Math.max(prevHeight, currHeight) / Math.max(1, Math.min(prevHeight, currHeight));
  const verticalGap = current.bbox.y0 - previous.bbox.y1;
  const leftDelta = Math.abs(current.bbox.x0 - previous.bbox.x0);
  const overlapRatio = resolveHorizontalOverlapRatio(previous.bbox, current.bbox);
  const prevCenter = (previous.bbox.x0 + previous.bbox.x1) * 0.5;
  const currCenter = (current.bbox.x0 + current.bbox.x1) * 0.5;
  const centerDelta = Math.abs(prevCenter - currCenter);
  const previousParagraphLike = isParagraphLikeOverlayInput(previous);
  const currentParagraphLike = isParagraphLikeOverlayInput(current);
  const bothParagraphLike = previousParagraphLike && currentParagraphLike;
  const previousDocumentLike = looksDocumentLikeSourceText(previous.hints?.sourceText || previous.line?.text || '');
  const currentDocumentLike = looksDocumentLikeSourceText(current.hints?.sourceText || current.line?.text || '');
  const effectiveDocumentProfile = isDocumentProfile || (previousDocumentLike && currentDocumentLike);
  const centeredStackContinuity = overlapRatio >= 0.08 || leftDelta <= Math.max(12, avgHeight * 0.92);
  const shortComicFragmentPair = !effectiveDocumentProfile
    && !bothParagraphLike
    && countWords(previous.text) <= 5
    && countWords(current.text) <= 5
    && compactTextLength(previous.text) <= 26
    && compactTextLength(current.text) <= 26;

  if (effectiveDocumentProfile && previousParagraphLike !== currentParagraphLike) {
    return false;
  }

  if (!effectiveDocumentProfile) {
    const centeredStack = centerDelta <= Math.max(18, avgHeight * (profile === 'manga' ? 1.55 : profile === 'adaptive' ? 1.42 : 1.4));
    const centeredFragmentContinuity = shortComicFragmentPair
      && centerDelta <= Math.max(24, avgHeight * 1.9);
    const centeredFragmentMerge = centeredFragmentContinuity
      && centeredStack
      && heightRatio <= 2.8
      && verticalGap >= -avgHeight * 0.34
      && verticalGap <= Math.max(34, avgHeight * 2.4);
    if (centeredFragmentMerge) {
      return true;
    }
    if (
      centeredStackContinuity
      && overlapRatio >= 0.04
      && centeredStack
      && heightRatio <= 2.5
      && verticalGap >= -avgHeight * 0.28
      && verticalGap <= Math.max(28, avgHeight * (profile === 'manga' ? 2.1 : profile === 'adaptive' ? 1.9 : 1.8))
    ) {
      return true;
    }
  }

  if (
    bothParagraphLike
    && heightRatio <= 1.24
    && verticalGap >= -avgHeight * 0.18
    && verticalGap <= Math.max(22, avgHeight * 1.05)
  ) {
    return true;
  }

  return (
    heightRatio <= 1.15
    && verticalGap >= -avgHeight * 0.22
    && verticalGap <= Math.max(18, avgHeight * 0.78)
    && (overlapRatio >= 0.24 || leftDelta <= Math.max(18, avgHeight * 1.8))
  );
};

const isDocumentLikeOverlayGroup = (
  group: Array<OverlayTypographyInput & { typography: OverlayTypography }>,
  hasSharedLeftEdge: boolean,
  maxHeight: number,
  startXs: number[],
  profile: OverlayLayoutProfile
): boolean => {
  if (group.length < 2) return false;
  const paragraphLikeCount = group.filter((item) => isParagraphLikeOverlayInput(item)).length;
  const sourceTexts = group.map((item) => item.hints?.sourceText || item.line?.text || '');
  const documentLikeSourceCount = sourceTexts.filter((value) => looksDocumentLikeSourceText(value)).length;
  const headingLikeCount = sourceTexts.filter((value) => looksHeadingLikeSourceLine(value)).length;
  const allowHeadingPromotion = profile === 'adaptive' || profile === 'official';
  if (paragraphLikeCount === 0 && (!allowHeadingPromotion || headingLikeCount === 0)) return false;
  if (documentLikeSourceCount === 0 && (!allowHeadingPromotion || headingLikeCount === 0)) return false;
  const startRange = resolveRange(startXs);
  return hasSharedLeftEdge && startRange <= Math.max(8, maxHeight * 0.26);
};

export const computeOverlayLayoutMap = (
  inputs: OverlayTypographyInput[],
  options?: { profile?: OverlayLayoutProfile }
): Map<number, OverlayLayout> => {
  const profile = options?.profile || 'official';
  const isDocumentProfile = profile === 'official';
  const computed = inputs.map((input) => ({
    ...input,
    typography: computeOverlayTypography(input.text, input.width, input.height, input.hints),
  }));
  const result = new Map<number, OverlayLayout>();

  let groupStart = 0;
  const flushGroup = (endExclusive: number) => {
    const group = computed.slice(groupStart, endExclusive);
    if (group.length === 0) return;

    const fontSizes = group.map((item) => item.typography.fontSize);
    const minFontSize = Math.min(...fontSizes);
    const maxFontSize = Math.max(...fontSizes);
    const startXs = group.map((item) => item.line ? resolveOverlayTextStartX(item.line, item.bbox) : item.bbox.x0);
    const centerXs = group.map((item) => item.bbox.x0 + ((item.bbox.x1 - item.bbox.x0) * 0.5));
    const boxHeights = group.map((item) => item.bbox.y1 - item.bbox.y0);
    const maxHeight = Math.max(...boxHeights);
    const minStartX = Math.min(...startXs);
    const leftEdgeTolerance = Math.max(4, maxHeight * 0.22);
    const sharedLeftEdgeCount = startXs.filter((value) => Math.abs(value - minStartX) <= leftEdgeTolerance).length;
    const hasSharedLeftEdge = group.length >= 2
      && sharedLeftEdgeCount >= Math.max(2, Math.ceil(group.length * 0.6));
    const documentLikeItemCount = group.filter((item) => shouldUseDocumentTypographyProfile(profile, item.text, item.hints)).length;
    const effectiveProfile: OverlayLayoutProfile = (
      profile !== 'official' && (
        isDocumentLikeOverlayGroup(group, hasSharedLeftEdge, maxHeight, startXs, profile)
        || (group.length === 1 && documentLikeItemCount === 1)
      )
    )
      ? 'official'
      : profile;
    const effectiveDocumentProfile = effectiveProfile === 'official';
    const sharedCenterX = group.length >= 2 ? resolveMedian(centerXs) : undefined;
    const centerRangeLimit = effectiveProfile === 'manga'
      ? Math.max(20, maxHeight * 1.5)
      : effectiveProfile === 'adaptive'
        ? Math.max(19, maxHeight * 1.35)
      : effectiveProfile === 'manhwa'
        ? Math.max(18, maxHeight * 1.38)
        : Math.max(18, maxHeight * 1.25);
    const startVarianceLimit = effectiveProfile === 'manga'
      ? Math.max(4, maxHeight * 0.16)
      : effectiveProfile === 'adaptive'
        ? Math.max(5, maxHeight * 0.2)
      : effectiveProfile === 'manhwa'
        ? Math.max(5, maxHeight * 0.22)
        : Math.max(6, maxHeight * 0.35);
    const isCenteredBlock = group.length >= 2
      && resolveRange(centerXs) <= centerRangeLimit
      && (
        effectiveDocumentProfile
          ? (!hasSharedLeftEdge && resolveRange(startXs) >= startVarianceLimit)
          : resolveRange(startXs) >= startVarianceLimit
      );
    const defaultStyleKind = resolveOverlayStyleKind(
      effectiveProfile,
      group.map((item) => item.hints?.sourceText || item.line?.text || item.text).filter(Boolean).join(' '),
      {
        boxed: !effectiveDocumentProfile && hasSharedLeftEdge && group.length >= 2 && !isCenteredBlock,
      }
    );
    const groupStyleKinds = group.map((item) => effectiveDocumentProfile
      ? resolveDocumentStyleKind(item.hints?.sourceText || item.line?.text || item.text)
      : defaultStyleKind
    );
    const allDocumentBody = effectiveDocumentProfile && groupStyleKinds.every((kind) => kind === 'document-body');
    const normalizedFontSize = effectiveDocumentProfile
      ? (
        allDocumentBody
          ? Math.max(6, (resolveLowerBandAverage(fontSizes) ?? minFontSize) * 0.99)
          : Math.max(6, (resolveLowerBandAverage(fontSizes) ?? minFontSize) * 0.96)
      )
      : defaultStyleKind === 'comic-box'
        ? Math.max(resolveMedian(fontSizes) ?? minFontSize, (resolveLowerBandAverage(fontSizes) ?? minFontSize) * 1.08)
        : (resolveMedian(fontSizes) ?? resolveLowerBandAverage(fontSizes) ?? minFontSize);
    const shouldNormalize = effectiveDocumentProfile
      ? (allDocumentBody && group.length >= 2 && (maxFontSize - minFontSize) >= 0.18)
      : (group.length >= 2 && (isCenteredBlock || defaultStyleKind === 'comic-box' || (maxFontSize - minFontSize) >= 0.35));
    const alignment: 'left' | 'center' = isCenteredBlock ? 'center' : 'left';
    const sharedTextStartX = group.length >= 2
      ? (alignment === 'left' && effectiveDocumentProfile ? minStartX : resolveMedian(startXs))
      : undefined;
    const sharedBoxLeftX = group.length >= 2 && alignment === 'left' && effectiveDocumentProfile
      ? minStartX
      : undefined;
    const shouldMergeAsBubbleBlock = !effectiveDocumentProfile && isCenteredBlock && group.length >= 2;
    if (shouldMergeAsBubbleBlock) {
      const mergedSourceText = group
        .map((item) => item.hints?.sourceText || item.line?.text || '')
        .filter(Boolean)
        .join(' ');
      const firstMaskSource = group[0].line ? resolveOverlayMaskBBox(group[0].line) : group[0].bbox;
      const mergedBBox: BBox = {
        x0: Math.min(...group.map((item) => item.bbox.x0)),
        y0: Math.min(...group.map((item) => item.bbox.y0)),
        x1: Math.max(...group.map((item) => item.bbox.x1)),
        y1: Math.max(...group.map((item) => item.bbox.y1)),
      };
      const mergedMaskBBox: BBox = group.reduce<BBox>((acc, item) => {
        const source = item.line ? resolveOverlayMaskBBox(item.line) : item.bbox;
        return {
          x0: Math.min(acc.x0, source.x0),
          y0: Math.min(acc.y0, source.y0),
          x1: Math.max(acc.x1, source.x1),
          y1: Math.max(acc.y1, source.y1),
        };
      }, firstMaskSource);
      const mergedText = joinOverlayGroupText(group);
      const mergedScaleX = resolveMedian(
        group.map((item) => item.width / Math.max(1, item.bbox.x1 - item.bbox.x0))
      ) ?? 1;
      const mergedScaleY = resolveMedian(
        group.map((item) => item.height / Math.max(1, item.bbox.y1 - item.bbox.y0))
      ) ?? 1;
      const mergedWidth = Math.max(1, (mergedBBox.x1 - mergedBBox.x0) * mergedScaleX);
      const mergedHeight = Math.max(1, (mergedBBox.y1 - mergedBBox.y0) * mergedScaleY);
      const mergedTypography = computeOverlayTypography(
        mergedText,
        mergedWidth,
        mergedHeight,
        {
          sourceText: mergedSourceText,
          sourceBoxWidth: mergedWidth,
          sourceBoxHeight: mergedHeight,
          sourceLineCount: group.length,
          fontFamily: group[0]?.hints?.fontFamily,
          profile,
          styleKind: 'comic-bubble',
        }
      );
      const mergedBaselineFont = resolveMedian(fontSizes) ?? mergedTypography.fontSize;
      const sourceLineHeightMedian = resolveMedian(
        group.map((item) => Math.max(1, item.hints?.sourceBoxHeight ?? (item.bbox.y1 - item.bbox.y0)))
      ) ?? mergedHeight;
      const mergedTextContainsThai = THAI_CHAR_REGEX.test(mergedText);
      const mergedTextContainsCjk = CJK_CHAR_REGEX.test(mergedText);
      const mergedSourceDrivenFont = sourceLineHeightMedian
        * (mergedTextContainsThai ? 1.14 : mergedTextContainsCjk ? 1.02 : 1)
        * Math.sqrt(group.length / Math.max(1, mergedTypography.estimatedLines));
      const mergedPromotionFactor = mergedTextContainsThai && mergedTypography.estimatedLines >= 3 ? 1.12 : 1.34;
      const promotedMergedFont = Math.min(
        32,
        Math.max(
          mergedTypography.fontSize,
          mergedBaselineFont * mergedPromotionFactor,
          mergedSourceDrivenFont * (mergedTextContainsThai && mergedTypography.estimatedLines >= 3 ? 0.94 : 1)
        )
      );
      const mergedTypographyAdjusted = (() => {
        if (promotedMergedFont <= mergedTypography.fontSize + 0.01) return mergedTypography;
        const lineHeight = resolveOverlayLineHeight(mergedText) + (mergedTextContainsThai ? 0.08 : 0);
        const { padX, padY } = resolveOverlayPadding(promotedMergedFont, mergedText);
        const usableWidth = Math.max(4, mergedWidth - padX * 2);
        const estimatedLines = resolveWrappedLineEstimate(
          mergedText,
          usableWidth,
          promotedMergedFont,
          group[0]?.hints?.fontFamily,
          'comic-bubble',
          mergedWidth,
          mergedHeight
        );
        const sourceLineFloor = resolveSourceLineFloor(
          'comic-bubble',
          group.length,
          compactTextLength(mergedSourceText),
          compactTextLength(mergedText),
          mergedTextContainsThai,
          mergedTextContainsCjk,
          false
        );
        const adjustedEstimatedLines = Math.max(estimatedLines, sourceLineFloor);
        const ascenderSafety = Math.max(1, Math.round(promotedMergedFont * (THAI_CHAR_REGEX.test(mergedText) ? 0.1 : 0.05)));
        const descenderSafety = Math.max(1, Math.round(promotedMergedFont * (THAI_CHAR_REGEX.test(mergedText) ? 0.18 : 0.14)));
        const contentHeight = adjustedEstimatedLines * promotedMergedFont * lineHeight + ascenderSafety + descenderSafety;
        if (contentHeight > mergedHeight * 0.9) {
          return mergedTypography;
        }
        return {
          fontSize: promotedMergedFont,
          lineHeight,
          padX,
          padY,
          forceSingleLine: adjustedEstimatedLines <= 1,
          estimatedLines: adjustedEstimatedLines,
          contentHeight,
        };
      })();

      const mergeIsUseful = mergedTypographyAdjusted.estimatedLines >= 1
        && mergedTypographyAdjusted.fontSize >= mergedBaselineFont * 0.9;
      if (!mergeIsUseful) {
        // Fall back to per-line rendering when the merged block would collapse into one line
        // and hide the rest of the bubble content behind a large mask.
      } else {
        group.forEach((item, index) => {
          result.set(item.index, {
            typography: mergedTypographyAdjusted,
            alignment: 'center',
            effectiveProfile,
            styleKind: 'comic-bubble',
            sharedCenterX: sharedCenterX ?? (mergedBBox.x0 + mergedBBox.x1) * 0.5,
            mergedBBox,
            mergedMaskBBox,
            renderText: index === 0 ? mergedText : '',
            hidden: index !== 0,
          });
        });
        return;
      }
    }

    for (const item of group) {
      if (!shouldNormalize) {
        result.set(item.index, {
          typography: item.typography,
          alignment,
          effectiveProfile,
          styleKind: groupStyleKinds[group.indexOf(item)],
          sharedTextStartX,
          sharedCenterX,
          sharedBoxLeftX,
          renderText: item.text,
        });
        continue;
      }

      const lineHeight = resolveOverlayLineHeight(item.text);
      const { padX, padY } = resolveOverlayPadding(normalizedFontSize, item.text);
      const estimatedLines = item.typography.estimatedLines;
      const ascenderSafety = Math.max(1, Math.round(normalizedFontSize * (THAI_CHAR_REGEX.test(item.text) ? 0.1 : 0.05)));
      const descenderSafety = Math.max(1, Math.round(normalizedFontSize * (THAI_CHAR_REGEX.test(item.text) ? 0.18 : 0.14)));
      result.set(item.index, {
        typography: {
          fontSize: normalizedFontSize,
          lineHeight,
          padX,
          padY,
          forceSingleLine: item.typography.forceSingleLine,
          estimatedLines,
          contentHeight: estimatedLines * normalizedFontSize * lineHeight + ascenderSafety + descenderSafety,
        },
        alignment,
        effectiveProfile,
        styleKind: groupStyleKinds[group.indexOf(item)],
        sharedTextStartX,
        sharedCenterX,
        sharedBoxLeftX,
        renderText: item.text,
      });
    }
  };

  for (let i = 1; i < computed.length; i += 1) {
    if (!shouldHarmonizeOverlayBlock(computed[i - 1], computed[i], profile)) {
      flushGroup(i);
      groupStart = i;
    }
  }
  flushGroup(computed.length);

  return result;
};

export const computeOverlayTypographyMap = (
  inputs: OverlayTypographyInput[]
): Map<number, OverlayTypography> => {
  const layoutMap = computeOverlayLayoutMap(inputs);
  return new Map(Array.from(layoutMap.entries()).map(([index, layout]) => [index, layout.typography]));
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
