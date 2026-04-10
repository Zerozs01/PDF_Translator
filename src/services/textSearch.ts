export type TextSearchPattern = {
  source: string;
  matcher: RegExp;
  isRegexLiteral: boolean;
};

const REGEX_LITERAL_PATTERN = /^\/([\s\S]*)\/([dgimsuy]*)$/;
const VALID_REGEX_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'u', 'y']);

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeRegexFlags = (flags: string): string => {
  const normalized: string[] = [];
  for (const flag of String(flags || '')) {
    if (!VALID_REGEX_FLAGS.has(flag)) continue;
    if (normalized.includes(flag)) continue;
    normalized.push(flag);
  }
  if (!normalized.includes('g')) {
    normalized.push('g');
  }
  return normalized.join('');
};

const buildLiteralPattern = (query: string): TextSearchPattern => ({
  source: query,
  matcher: new RegExp(escapeRegExp(query), 'gi'),
  isRegexLiteral: false,
});

export const buildTextSearchPattern = (query: string): TextSearchPattern | null => {
  const normalized = String(query || '').trim();
  if (!normalized) return null;

  const literalMatch = normalized.match(REGEX_LITERAL_PATTERN);
  if (!literalMatch) {
    return buildLiteralPattern(normalized);
  }

  const [, body, flags] = literalMatch;
  try {
    return {
      source: normalized,
      matcher: new RegExp(body, normalizeRegexFlags(flags)),
      isRegexLiteral: true,
    };
  } catch {
    // Fall back to literal search if regex literal is invalid.
    return buildLiteralPattern(normalized);
  }
};

export const collectTextSearchMatches = (
  text: string,
  pattern: TextSearchPattern | null
): Array<{ start: number; end: number }> => {
  const haystack = String(text || '');
  if (!haystack || !pattern) return [];

  const flags = pattern.matcher.flags.includes('g')
    ? pattern.matcher.flags
    : `${pattern.matcher.flags}g`;
  const matcher = new RegExp(pattern.matcher.source, flags);
  const matches: Array<{ start: number; end: number }> = [];

  let result: RegExpExecArray | null;
  while ((result = matcher.exec(haystack)) !== null) {
    const matchText = String(result[0] || '');
    const start = result.index;
    const end = start + matchText.length;

    if (end > start) {
      matches.push({ start, end });
      continue;
    }

    // Guard against zero-length regex matches that can loop forever.
    matcher.lastIndex += 1;
  }

  return matches;
};

export const hasTextSearchMatch = (text: string, pattern: TextSearchPattern | null): boolean =>
  collectTextSearchMatches(text, pattern).length > 0;
