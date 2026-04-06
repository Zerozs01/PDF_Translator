export type OverlayFontPreset = 'sarabun' | 'mitr' | 'supermarket' | 'fc-iconic' | 'system-th';

export type OverlayFontOption = {
  value: OverlayFontPreset;
  label: string;
  description: string;
  fontFamily: string;
};

export const DEFAULT_OVERLAY_FONT_PRESET: OverlayFontPreset = 'sarabun';

export const OVERLAY_FONT_OPTIONS: OverlayFontOption[] = [
  {
    value: 'sarabun',
    label: 'TH Sarabun',
    description: 'Formal document tone with wide compatibility for Thai text.',
    fontFamily: "'TH Sarabun New', 'TH SarabunPSK', 'Sarabun', 'Mitr', 'Noto Sans Thai', 'Tahoma', sans-serif",
  },
  {
    value: 'mitr',
    label: 'Mitr',
    description: 'Rounded modern Thai style with clean readability in bubbles.',
    fontFamily: "'Mitr', 'Sarabun', 'Noto Sans Thai', 'Tahoma', sans-serif",
  },
  {
    value: 'supermarket',
    label: 'Supermarket',
    description: 'Casual manga/manhwa vibe (bundled via npm postinstall font bootstrap).',
    fontFamily: "'Supermarket', 'Mitr', 'Sarabun', 'Noto Sans Thai', 'Tahoma', sans-serif",
  },
  {
    value: 'fc-iconic',
    label: 'FC Iconic',
    description: 'Stylized display look (bundled via npm postinstall font bootstrap).',
    fontFamily: "'FC Iconic', 'Mitr', 'Sarabun', 'Noto Sans Thai', 'Tahoma', sans-serif",
  },
  {
    value: 'system-th',
    label: 'System Thai',
    description: 'Use device Thai fonts for maximum fallback stability.',
    fontFamily: "'Leelawadee UI', 'Noto Sans Thai', 'Tahoma', sans-serif",
  },
];

const OVERLAY_FONT_PRESET_SET = new Set<OverlayFontPreset>(OVERLAY_FONT_OPTIONS.map((option) => option.value));

const THAI_LANGUAGE_KEYS = new Set(['th', 'tha', 'thai']);

export const isOverlayFontPreset = (value: string): value is OverlayFontPreset =>
  OVERLAY_FONT_PRESET_SET.has(value as OverlayFontPreset);

export const getOverlayFontOption = (preset: OverlayFontPreset): OverlayFontOption =>
  OVERLAY_FONT_OPTIONS.find((candidate) => candidate.value === preset) || OVERLAY_FONT_OPTIONS[0];

export const getOverlayPrimaryFontName = (preset: OverlayFontPreset): string => {
  const family = getOverlayFontOption(preset).fontFamily;
  const primary = String(family || '').split(',')[0] || '';
  return primary.replace(/^['"]+|['"]+$/g, '').trim();
};

const normalizeLanguageKey = (value: string): string => String(value || '').trim().toLowerCase();

export const resolveOverlayFontFamily = ({
  preset,
  enabled,
  targetLanguage,
}: {
  preset: OverlayFontPreset;
  enabled: boolean;
  targetLanguage: string;
}): string | undefined => {
  if (!enabled) return undefined;

  const normalizedTarget = normalizeLanguageKey(targetLanguage).split('-')[0];
  if (!THAI_LANGUAGE_KEYS.has(normalizedTarget)) return undefined;

  return getOverlayFontOption(preset).fontFamily;
};
