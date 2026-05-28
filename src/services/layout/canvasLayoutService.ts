import { normalizeOverlayInlineText } from '../../components/OCR/translationOverlayUtils';

export const GENERIC_FONT_FAMILY_SET = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
]);

export interface FontFaceSet {
  load(font: string, text?: string): Promise<FontFace[]>;
  check(font: string, text?: string): boolean;
}

export const parseFontFamilyCandidates = (fontFamily: string): string[] =>
  String(fontFamily || '')
    .split(',')
    .map((candidate) => candidate.trim().replace(/^['"]+|['"]+$/g, ''))
    .filter(Boolean);

export const truncateCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  suffix: string = '...'
): string => {
  const normalized = String(text || '');
  if (!normalized) return '';
  if (ctx.measureText(normalized).width <= maxWidth) return normalized;

  let current = normalized;
  while (current.length > 0 && ctx.measureText(`${current}${suffix}`).width > maxWidth) {
    current = current.slice(0, -1);
  }

  return current ? `${current}${suffix}` : '';
};

export const wrapCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  forceSingleLine: boolean
): string[] => {
  const normalized = normalizeOverlayInlineText(String(text || ''));
  if (!normalized) return [];
  if (maxLines <= 1 || forceSingleLine) {
    return [truncateCanvasText(ctx, normalized, maxWidth)];
  }

  const tokens = normalized.includes(' ')
    ? normalized.split(/\s+/g).filter(Boolean)
    : Array.from(normalized);

  const lines: string[] = [];
  let line = '';

  tokens.forEach((token, index) => {
    const unit = normalized.includes(' ') ? token : token;
    const separator = normalized.includes(' ') && line ? ' ' : '';
    const candidate = `${line}${separator}${unit}`;
    if (!line || ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      return;
    }

    lines.push(line);
    line = unit;

    if (lines.length >= maxLines) {
      return;
    }

    if (index === tokens.length - 1) {
      lines.push(line);
    }
  });

  if (line && lines.length < maxLines) {
    lines.push(line);
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  if (lines.length === 0) {
    return [truncateCanvasText(ctx, normalized, maxWidth)];
  }

  const consumed = lines.join(normalized.includes(' ') ? ' ' : '');
  if (consumed.length < normalized.length) {
    const lastIndex = Math.max(0, lines.length - 1);
    lines[lastIndex] = truncateCanvasText(ctx, lines[lastIndex], maxWidth);
  }

  return lines;
};

export const buildCanvasFontFamily = async (
  preferredFontFamily: string,
  fallbackFontFamily: string
): Promise<string> => {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return preferredFontFamily || fallbackFontFamily;
  }

  const fontFaceSet = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fontFaceSet) {
    return preferredFontFamily || fallbackFontFamily;
  }

  const candidates = [
    ...parseFontFamilyCandidates(preferredFontFamily),
    ...parseFontFamilyCandidates(fallbackFontFamily),
  ];

  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized || GENERIC_FONT_FAMILY_SET.has(normalized.toLowerCase())) {
      continue;
    }

    const quoted = /[\s'"]/.test(normalized) ? `"${normalized.replace(/"/g, '\\"')}"` : normalized;
    try {
      await Promise.allSettled([
        fontFaceSet.load(`400 16px ${quoted}`, 'กขabCD'),
        fontFaceSet.load(`500 16px ${quoted}`, 'กขabCD'),
        fontFaceSet.load(`600 16px ${quoted}`, 'กขabCD'),
      ]);
      if (fontFaceSet.check(`16px ${quoted}`, 'กขabCD')) {
        return `${quoted}, ${fallbackFontFamily || 'sans-serif'}`;
      }
    } catch {
      // Ignore font probing errors and continue to the next family.
    }
  }

  return preferredFontFamily || fallbackFontFamily;
};
