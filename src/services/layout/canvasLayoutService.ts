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
  if (maxLines <= 1 || (forceSingleLine && maxLines === 1)) {
    return [truncateCanvasText(ctx, normalized, maxWidth)];
  }

  // Check if string contains Thai or CJK characters
  const containsThai = /[\u0E00-\u0E7F]/.test(normalized);
  const containsCjk = /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(normalized);
  const hasWhitespaceBoundaries = /\s/.test(normalized);

  let tokens: string[];
  let joinWithSpace = true;

  if (!containsThai && !containsCjk) {
    tokens = normalized.split(/\s+/g).filter(Boolean);
    joinWithSpace = true;
  } else if (containsThai && hasWhitespaceBoundaries) {
    // Keep explicit spacing for Thai when present to avoid breaking semantic phrase boundaries.
    tokens = normalized.split(/\s+/g).filter(Boolean);
    joinWithSpace = true;
  } else {
    // Attempt to segment Thai or CJK using Intl.Segmenter
    let segmenter: any = null;
    try {
      const SegmenterCtor = (Intl as any).Segmenter;
      if (SegmenterCtor) {
        segmenter = new SegmenterCtor(containsThai ? 'th' : 'ja', { granularity: 'word' });
      }
    } catch (e) {
      segmenter = null;
    }

    if (segmenter) {
      tokens = Array.from(segmenter.segment(normalized))
        .map((segment: any) => segment.segment)
        .filter(Boolean);
      joinWithSpace = false;
    } else {
      // Fallback to character-level wrapping
      tokens = Array.from(normalized);
      joinWithSpace = false;
    }
  }

  const lines: string[] = [];
  let line = '';

  tokens.forEach((token, index) => {
    const unit = token;
    const separator = joinWithSpace && line ? ' ' : '';
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

  const consumed = lines.join(joinWithSpace ? ' ' : '');
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

/**
 * คำนวณความกว้างสูงสุดของข้อความในแต่ละบรรทัดตามสมการวงรีแนบใน (Inscribed Ellipse Constraint)
 * ถอดสมการคณิตศาสตร์จาก koharu-renderer (bubble.rs / layout.rs)
 * ช่วยให้ข้อความในบอลลูนมังงะ/มันฮวาจัดรูปทรงป่องตรงกลางและสอบแคบที่หัว-ท้ายอย่างสวยงาม (< 0.05 ms)
 *
 * @param boxWidth ความกว้างของ Bounding Box (พิกเซล)
 * @param boxHeight ความสูงของ Bounding Box (พิกเซล)
 * @param lineIndex ดัชนีบรรทัด (0-indexed)
 * @param totalLines จำนวนบรรทัดทั้งหมด
 * @param paddingRatio อัตราส่วนเว้นขอบความปลอดภัย (Default: 0.08 หรือ 8%)
 * @param minWidthRatio อัตราส่วนความกว้างขั้นต่ำเพื่อไม่ให้บรรทัดหัว-ท้ายแคบเกินไป (Default: 0.35)
 */
export const computeInscribedEllipseLineWidth = (
  boxWidth: number,
  boxHeight: number,
  lineIndex: number,
  totalLines: number,
  paddingRatio: number = 0.08,
  minWidthRatio: number = 0.35
): number => {
  if (totalLines <= 1) {
    return Math.max(16, Math.round(boxWidth * (1 - paddingRatio * 2)));
  }

  const safeWidth = Math.max(16, boxWidth);
  const safeHeight = Math.max(16, boxHeight);
  const effectiveWidth = safeWidth * (1 - paddingRatio * 2);

  // คำนวณตำแหน่ง y สัมพัทธ์จากจุดกึ่งกลางวงรี ในช่วง [-1, 1]
  const yNorm = ((lineIndex + 0.5) / totalLines - 0.5) * 2;
  const clampedY = Math.max(-0.95, Math.min(0.95, yNorm));

  // สมการวงรีแนบใน: (x/a)^2 + (y/b)^2 = 1 => x = a * sqrt(1 - (y/b)^2)
  const ellipseFactor = Math.sqrt(Math.max(0, 1 - clampedY * clampedY));
  const normalizedFactor = Math.max(minWidthRatio, ellipseFactor);

  return Math.round(effectiveWidth * normalizedFactor);
};

/**
 * คำนวณความกว้างสูงสุดตามสมการขนมเปียกปูนแนบใน (Inscribed Diamond Constraint)
 * สำหรับบอลลูนที่มีความคม/เหลี่ยม
 */
export const computeInscribedDiamondLineWidth = (
  boxWidth: number,
  boxHeight: number,
  lineIndex: number,
  totalLines: number,
  paddingRatio: number = 0.08,
  minWidthRatio: number = 0.3
): number => {
  if (totalLines <= 1) {
    return Math.max(16, Math.round(boxWidth * (1 - paddingRatio * 2)));
  }

  const effectiveWidth = Math.max(16, boxWidth) * (1 - paddingRatio * 2);
  const yNorm = Math.abs(((lineIndex + 0.5) / totalLines - 0.5) * 2);
  const diamondFactor = Math.max(minWidthRatio, 1 - Math.min(0.95, yNorm));

  return Math.round(effectiveWidth * diamondFactor);
};

/**
 * กะขนาดฟอนต์ที่พอดีที่สุดภายในกรอบบอลลูนวงรี (Inscribed Ellipse Area Constraint)
 * คำนวณอย่างรวดเร็ว < 0.1ms เพื่อใช้เป็นค่าตั้งต้นก่อนวาด Canvas
 */
export const estimateBalloonFontSize = (
  text: string,
  boxWidth: number,
  boxHeight: number,
  options?: {
    minFontSize?: number;
    maxFontSize?: number;
    shape?: 'ellipse' | 'diamond' | 'rectangle';
  }
): number => {
  const normalized = normalizeOverlayInlineText(String(text || ''));
  if (!normalized) return options?.minFontSize ?? 12;

  const charCount = normalized.length;
  const safeWidth = Math.max(16, boxWidth);
  const safeHeight = Math.max(16, boxHeight);

  // พื้นที่เรขาคณิตปลอดภัยของทรงบอลลูน
  const shape = options?.shape || 'ellipse';
  const shapeFactor = shape === 'ellipse'
    ? (Math.PI / 4) * 0.9 // ~0.707 (วงรีพร้อม safety margin)
    : shape === 'diamond'
      ? 0.45
      : 0.85;

  const effectiveArea = safeWidth * safeHeight * shapeFactor;

  // สำหรับภาษาไทย สระบน-ล่างและวรรณยุกต์ ทำให้อัตราส่วนตัวอักษรเฉลี่ยใช้พื้นที่ประมาณ 0.62 * fontSize^2
  const isThai = /[\u0E00-\u0E7F]/.test(normalized);
  const charAreaFactor = isThai ? 0.62 : 0.55;

  const rawSize = Math.sqrt(effectiveArea / Math.max(1, charCount * charAreaFactor));

  const minSize = options?.minFontSize ?? 10;
  const maxSize = options?.maxFontSize ?? Math.min(safeHeight * 0.7, 72);

  return Math.max(minSize, Math.min(maxSize, Math.round(rawSize)));
};

/**
 * ตัดบรรทัดข้อความลงบน Canvas โดยคำนวณความกว้างของแต่ละบรรทัดตามทรงบอลลูนวงรี (Balloon-Aware Wrapping)
 * เหมาะสำหรับข้อความภาษาไทยในมังงะ/มันฮวา เพื่อให้จัดกึ่งกลางแบบป่องกลางสวยงามตามธรรมชาติ
 */
export const wrapBalloonCanvasText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  boxWidth: number,
  boxHeight: number,
  maxLines: number = 6,
  options?: {
    shape?: 'ellipse' | 'diamond' | 'rectangle';
    paddingRatio?: number;
    forceSingleLine?: boolean;
  }
): { lines: string[]; lineWidths: number[] } => {
  const normalized = normalizeOverlayInlineText(String(text || ''));
  if (!normalized) return { lines: [], lineWidths: [] };

  if (maxLines <= 1 || (options?.forceSingleLine && maxLines === 1)) {
    const w = computeInscribedEllipseLineWidth(boxWidth, boxHeight, 0, 1, options?.paddingRatio);
    const line = truncateCanvasText(ctx, normalized, w);
    return { lines: [line], lineWidths: [w] };
  }

  const containsThai = /[\u0E00-\u0E7F]/.test(normalized);
  const containsCjk = /[\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(normalized);
  const hasWhitespaceBoundaries = /\s/.test(normalized);

  let tokens: string[];
  let joinWithSpace = true;

  if (!containsThai && !containsCjk) {
    tokens = normalized.split(/\s+/g).filter(Boolean);
    joinWithSpace = true;
  } else if (containsThai && hasWhitespaceBoundaries) {
    tokens = normalized.split(/\s+/g).filter(Boolean);
    joinWithSpace = true;
  } else {
    let segmenter: any = null;
    try {
      const SegmenterCtor = (Intl as any).Segmenter;
      if (SegmenterCtor) {
        segmenter = new SegmenterCtor(containsThai ? 'th' : 'ja', { granularity: 'word' });
      }
    } catch {
      segmenter = null;
    }

    if (segmenter) {
      tokens = Array.from(segmenter.segment(normalized))
        .map((segment: any) => segment.segment)
        .filter(Boolean);
      joinWithSpace = false;
    } else {
      tokens = Array.from(normalized);
      joinWithSpace = false;
    }
  }

  const estimatedLineCount = Math.max(2, Math.min(maxLines, Math.ceil(ctx.measureText(normalized).width / Math.max(1, boxWidth * 0.75))));

  const shape = options?.shape || 'ellipse';
  const getLineWidth = (lineIdx: number, totalL: number) => {
    return shape === 'ellipse'
      ? computeInscribedEllipseLineWidth(boxWidth, boxHeight, lineIdx, totalL, options?.paddingRatio)
      : shape === 'diamond'
        ? computeInscribedDiamondLineWidth(boxWidth, boxHeight, lineIdx, totalL, options?.paddingRatio)
        : Math.round(boxWidth * (1 - (options?.paddingRatio ?? 0.08) * 2));
  };

  const lines: string[] = [];
  const lineWidths: number[] = [];
  let currentLine = '';
  let currentAllowedWidth = getLineWidth(0, estimatedLineCount);

  tokens.forEach((token, index) => {
    const separator = joinWithSpace && currentLine ? ' ' : '';
    const candidate = `${currentLine}${separator}${token}`;

    if (!currentLine || ctx.measureText(candidate).width <= currentAllowedWidth) {
      currentLine = candidate;
      return;
    }

    lines.push(currentLine);
    lineWidths.push(currentAllowedWidth);
    currentLine = token;

    if (lines.length >= maxLines) {
      return;
    }

    currentAllowedWidth = getLineWidth(lines.length, estimatedLineCount);

    if (index === tokens.length - 1) {
      lines.push(currentLine);
      lineWidths.push(currentAllowedWidth);
    }
  });

  if (currentLine && lines.length < maxLines) {
    lines.push(currentLine);
    lineWidths.push(currentAllowedWidth);
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
    lineWidths.length = maxLines;
  }

  if (lines.length === 0) {
    const singleW = getLineWidth(0, 1);
    return {
      lines: [truncateCanvasText(ctx, normalized, singleW)],
      lineWidths: [singleW],
    };
  }

  const consumed = lines.join(joinWithSpace ? ' ' : '');
  if (consumed.length < normalized.length) {
    const lastIndex = Math.max(0, lines.length - 1);
    lines[lastIndex] = truncateCanvasText(ctx, lines[lastIndex], lineWidths[lastIndex]);
  }

  return { lines, lineWidths };
};

