import { useGlossaryStore } from '../../stores/useGlossaryStore';
import {
  ProtectedTokenReplacement,
  escapeRegExp,
  buildLooseTokenPattern,
  isLikelyStructuredOcrGarbageToken,
} from '../ocr/ocrTextHeuristics';
import {
  normalizeWhitespace,
  normalizeTranslationLanguage,
} from '../ocr/ocrTextNormalizer';
import { lookupShortPhraseTh } from './offlineTranslationService';
import { isKnownShortWordHelper, isLikelyEnglishDialogue } from '../ocr/ocrSafetyLineDedup';

export const titleCaseWord = (value: string): string => {
  const lower = String(value || '').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
};

export const SCI_SYMBOL_ALLOWED_REGEX = /^[A-Za-z0-9()\[\]{}_,.%:+\-*/^=<>|~'"\s\u00B0\u0391-\u03C9\u2190-\u2193\u2212\u2032\u2033]+$/;
export const SCI_SYMBOL_SIGNAL_REGEX = /[0-9\u0391-\u03C9()_+\-*/^=<>%\u00B0\u2190-\u2193\u2212\u2032\u2033]/;
export const SCI_FORCE_COMPONENT_TOKEN_REGEX = /\b(?:F|M)(?:x|y|z|\d{1,2})\b/gi;
export const SCI_NOTATION_LINE_REGEX = /^(?:fig(?:ure)?\.?\s*\d+(?:[-–]\d+)?(?:\s*[a-z])?|table\s*\d+(?:[-–]\d+)?|chapter\s*\d+|[A-Za-z]?\d+(?:[-–]\d+)?|\(\s*[a-z0-9]{1,3}\s*\)|[A-Za-z]\.|[A-Za-z]{1,2}\d{1,2})$/i;
export const SCI_MATH_LINE_REGEX = /^[A-Za-z0-9\u0391-\u03C9()_+\-*/^=<>%\u00B0\u2190-\u2193\u2212\u2032\u2033\s]+$/;

export const isScientificSymbolLikeLine = (text: string, sourceLanguage?: string): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;

  // Remove trailing/leading underscores before checking exemption
  const noUnderscore = normalized.replace(/^_+|_+$/g, '');
  const noUnderscoreUpper = noUnderscore.toUpperCase();

  // If it contains multiple English-like words, it's probably dialogue, not a symbol
  const ocrWords = noUnderscore.split(/\s+/g).filter(Boolean);
  const alphaWordCount = ocrWords.filter((w) => w.length >= 2 && /[A-Za-z]/.test(w)).length;
  if (alphaWordCount >= 2 && !/[=<>+\-*/^]/.test(noUnderscore)) {
    return false;
  }

  const asciiCompact = noUnderscoreUpper.replace(/[^A-Z0-9]/g, '');
  const isKnownShort = /^[IAO]$/i.test(asciiCompact) || 
    /^(?:OK|NO|HI|OH|AM|AN|AS|AT|BE|BY|DO|GO|HE|IF|IN|IS|IT|ME|MY|OF|ON|OR|SO|TO|UP|US|WE|YE|AH|HA|EH|UH|LO|YA|UM|YES|FOR|AND|BUT|YOU|THE|NOT|HER|HIS|HIM|SHE|CAN|OUT|GET|HOW|WHO|WHY|HEY|BOY|RUN|SAY|SEE|MAN|OUR|DAY|NEW|TOO|ALL|ANY|BAD|BIG|CRY|DID|EAT|END|FAR|FIT|FLY|FUN|GUY|HOT|ITS|JOB|KEY|LET|LIE|LOT|MAD|MAY|MOM|DAD|OLD|ONE|TWO|OWN|PAY|SAD|SON|TRY|USE|WAY|WIN|YET|WOW|YAY|YEP|NAH|NOP|DIE|PIG|CUM|COCK|OHHH|OHHHH|OHHHHH|AGAA|MORE|YOURE|STOOOOP|STOAOOP|STOAAOP|LIKETHIS|LIKE|WASTOYED|UPLOOKING|SIR|YESSIR|QUCK|QUICK|USTHE|NOWI|II|IIM|ONA|YYOU|IIS|IIT|IIN|SSHE|HHE|TTHEY|WWE|TTHIS|TTHAT|NNO|MME|III|MEEE|MEEEE|5O|S0|6O|OFME|EROMANGA|OFMEEROMANGA|BLOWJOB|IM|NURSE|BEINGTOO|SUDDENLY|ILL|RESTA|THESEX|WELLSINCE|JUST|ILLNESSBE|METHOD|FROMTHE|ITFEELS|OUTINSIDE|STILLFULL|BLOWTOB|NOU|DISEASE|FOUNDA|II333S|S3HS|INSIDEI|INSIDE|WHTTTTT|RESTRAINT|GOO|IHNH|ISIHS|2IHG|EIH3|IIMOM|OD111|VAYS|BEEELEE|WNTTTT|HERPUSSY|WOMB|MING|CUMMING|WAYTOO|GOOD|TOMAKETHREADS|MYCUM|THATS|NOTNECESSARY|ADYDO|UMEAN|WERE|PLEASE|CUMALOTJUSTLIKETHAT)$/i.test(asciiCompact);
  if (isKnownShort) {
    return false;
  }

  const normalizedSourceLanguage = normalizeTranslationLanguage(sourceLanguage || 'en', 'en');
  if (normalizedSourceLanguage === 'es') {
    if (/^(?:SI|NO|EL|LA|UN|YO|TU|SU|ES|EN|DE|AL|LO|TE|ME|SE)$/i.test(noUnderscore)) {
      return false;
    }
  }
  const forceComponentTokens = normalized.match(SCI_FORCE_COMPONENT_TOKEN_REGEX) || [];
  if (forceComponentTokens.length > 0) {
    if (normalized.length <= 48 && ocrWords.length <= 8 && !/[.!?]/.test(normalized)) {
      return true;
    }
  }

  const hasMathSignals = /[0-9=<>%^]/.test(normalized);
  const naturalLanguageLike = alphaWordCount >= 3 && !hasMathSignals;
  if (naturalLanguageLike) {
    return false;
  }

  if (normalized.length > 28) return false;
  if (!SCI_SYMBOL_ALLOWED_REGEX.test(normalized)) return false;

  const tokens = ocrWords;
  if (tokens.length > 5) return false;

  const alnum = normalized.replace(/[^A-Za-z0-9\u0391-\u03C9]/g, '');
  if (alnum.length > 16) return false;

  const compact = normalized.replace(/\s+/g, ' ');
  if (SCI_NOTATION_LINE_REGEX.test(compact)) {
    return true;
  }

  const hasExplicitSciSignal = SCI_SYMBOL_SIGNAL_REGEX.test(normalized);
  if (!hasExplicitSciSignal) {
    return normalized === normalized.toUpperCase() && tokens.length <= 2 && alnum.length <= 2;
  }

  // Check for real English words BEFORE math-like detection to avoid
  // false positives like "HMM_ GUESS" being treated as a formula
  const alphaTokens = tokens
    .map((token) => token.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean);
  const longAlphaTokenCount = alphaTokens.filter((token) => token.length >= 4).length;
  if (longAlphaTokenCount >= 1) {
    return false;
  }

  const hasMathLikeContent = SCI_MATH_LINE_REGEX.test(normalized)
    && /[\u0391-\u03C9_+\-*/^=<>\u00B0\u2190-\u2193\u2212\u2032\u2033]/.test(normalized);
  if (hasMathLikeContent) {
    return true;
  }

  return tokens.length <= 2 && alnum.length <= 6;
};

export const shouldSkipLineTranslationByScript = (
  text: string,
  sourceLanguage: string,
  ocrLanguageHint?: string
): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return true;

  const resolvedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedOcrLanguageHint = String(ocrLanguageHint || '')
    .split('+')
    .map((part) => normalizeTranslationLanguage(part, ''))
    .filter(Boolean);
  const hasOcrCjkHint = normalizedOcrLanguageHint.some((lang) =>
    ['ko', 'ja', 'zh', 'th'].includes(lang)
  );
  if (resolvedSource === 'ko' || resolvedSource === 'ja' || resolvedSource === 'zh' || resolvedSource === 'th') {
    return false;
  }
  if (hasOcrCjkHint) {
    return false;
  }

  const hasLatin = /[A-Za-z]/.test(normalized);
  const hasHangul = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(normalized);
  const hasKana = /[\u3040-\u30FF]/.test(normalized);
  const hasHan = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(normalized);
  const hasThai = /[\u0E00-\u0E7F]/.test(normalized);
  const tokenCount = normalized.split(/\s+/g).filter(Boolean).length;
  const compactLength = normalized.replace(/\s+/g, '').length;
  const shortTokenLike = compactLength <= 10 || tokenCount <= 2;

  const isCjkText = hasHangul || hasKana;
  const skipCondition = isCjkText ? (compactLength <= 3) : shortTokenLike;
  
  if (!hasLatin && skipCondition && (hasHangul || hasKana || hasHan || hasThai)) {
    return true;
  }

  return false;
};

export const shouldPreserveSourceLineForTranslation = (
  text: string,
  sourceLanguage: string,
  ocrLanguageHint?: string
): boolean => {
  const normSrc = normalizeTranslationLanguage(sourceLanguage, 'en');
  const isNonLatinScript = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(text);
  if (!isNonLatinScript && (normSrc === 'en' || normSrc === 'es')) {
    return false; // Valid Latin dialogue lines on English/Spanish pages must NEVER be preserved/skipped!
  }
  if (!isNonLatinScript || ['ja', 'ko', 'zh', 'es'].includes(normSrc)) {
    if (lookupShortPhraseTh(text) || isLikelyEnglishDialogue(text) || isKnownShortWordHelper(text)) return false;
  }
  if (/^\s*#?\s*(?:P\.?\s*)?\d{1,4}\.?\s*$/i.test(text) || /^\s*[-–—]\s*\d{1,4}\s*[-–—]\s*$/i.test(text)) {
    if (text.trim() === '69' || lookupShortPhraseTh(text)) return false;
    return true;
  }
  if (isLikelyStructuredOcrGarbageToken(text)) return true;
  if (isScientificSymbolLikeLine(text, sourceLanguage)) return true;
  return shouldSkipLineTranslationByScript(text, sourceLanguage, ocrLanguageHint);
};

export const TECHNICAL_LINE_HINT_REGEX = /\b(unknowns?|reactions?|equilibrium|resultant|component|components|direction|force|moment|column|columns|connections?|support|rigid|body|beam|beams|pin|hinge|utility|building|bridge|girder|floor|member|concrete|weld(?:ed|ing)?|fx|fy|fz|mx|my|mz|rx|ry|rz)\b/i;
export const UNKNOWNS_COUNT_REGEX = /\b(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+unknowns?\b/i;
export const AXIS_SYMBOL_REGEX = /\b(?:fx|fy|fz|mx|my|mz|rx|ry|rz)\b/gi;
export const EQUATION_LABEL_REGEX = /\([0-9]{1,3}\)/;

export const UNKNOWN_COUNT_WORD_TO_NUMBER: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
};

export const normalizeUnknownCountToken = (value: string): string => {
  const normalized = normalizeWhitespace(String(value || '')).toLowerCase();
  if (!normalized) return '';
  return UNKNOWN_COUNT_WORD_TO_NUMBER[normalized] || normalized;
};

export const collectUniqueRegexMatches = (value: string, regex: RegExp): string[] => {
  const normalized = normalizeWhitespace(String(value || '')).toLowerCase();
  if (!normalized) return [];
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const matcher = new RegExp(regex.source, flags);
  const matches = normalized.match(matcher) || [];
  return Array.from(new Set(matches.map((item) => item.trim()).filter(Boolean)));
};

export const shouldPreserveDistinctTechnicalLines = (a: string, b: string): boolean => {
  const normalizedA = normalizeWhitespace(String(a || '')).toLowerCase();
  const normalizedB = normalizeWhitespace(String(b || '')).toLowerCase();
  if (!normalizedA || !normalizedB || normalizedA === normalizedB) return false;

  const hasTechnicalA = (
    TECHNICAL_LINE_HINT_REGEX.test(normalizedA)
    || UNKNOWNS_COUNT_REGEX.test(normalizedA)
    || EQUATION_LABEL_REGEX.test(normalizedA)
  );
  const hasTechnicalB = (
    TECHNICAL_LINE_HINT_REGEX.test(normalizedB)
    || UNKNOWNS_COUNT_REGEX.test(normalizedB)
    || EQUATION_LABEL_REGEX.test(normalizedB)
  );
  if (!hasTechnicalA || !hasTechnicalB) return false;

  const unknownCountA = normalizeUnknownCountToken(normalizedA.match(UNKNOWNS_COUNT_REGEX)?.[1] || '');
  const unknownCountB = normalizeUnknownCountToken(normalizedB.match(UNKNOWNS_COUNT_REGEX)?.[1] || '');
  if (unknownCountA && unknownCountB && unknownCountA !== unknownCountB) {
    return true;
  }

  const axisTokensA = new Set(collectUniqueRegexMatches(normalizedA, AXIS_SYMBOL_REGEX));
  const axisTokensB = new Set(collectUniqueRegexMatches(normalizedB, AXIS_SYMBOL_REGEX));
  if (axisTokensA.size > 0 || axisTokensB.size > 0) {
    let shared = 0;
    for (const token of axisTokensA) {
      if (axisTokensB.has(token)) shared += 1;
    }
    if (shared < Math.min(axisTokensA.size, axisTokensB.size)) {
      return true;
    }
  }

  const equationTagsA = new Set(collectUniqueRegexMatches(normalizedA, EQUATION_LABEL_REGEX));
  const equationTagsB = new Set(collectUniqueRegexMatches(normalizedB, EQUATION_LABEL_REGEX));
  if (equationTagsA.size > 0 && equationTagsB.size > 0) {
    let shared = 0;
    for (const token of equationTagsA) {
      if (equationTagsB.has(token)) shared += 1;
    }
    if (shared === 0) {
      return true;
    }
  }

  return false;
};

export const PROPER_NOUN_POOL = [
  'Zara', 'Kira', 'Nexo', 'Valo', 'Mira', 'Taro', 'Seno', 'Pika', 'Reno', 'Luma',
  'Gale', 'Vira', 'Zolo', 'Miko', 'Piku', 'Rana', 'Bolo', 'Fina', 'Dina', 'Tina',
  'Juno', 'Yuna', 'Milo', 'Kael', 'Zina', 'Veda', 'Koda', 'Zola', 'Bena', 'Tavi',
  'Remi', 'Vito', 'Zori', 'Bria', 'Roko', 'Nura', 'Palo', 'Koba', 'Tova', 'Sola'
];

export const PROPER_NOUN_THAI_MAP: Record<string, string[]> = {
  zara: ['ซาร่า', 'ซารา'],
  kira: ['คิรา', 'คีรา', 'กีร่า', 'กีรา'],
  nexo: ['เน็กโซ', 'เนกโซ'],
  valo: ['วาโล'],
  mira: ['มิรา', 'มีรา', 'มิร่า', 'มีร่า'],
  taro: ['ทาโร่', 'ทาโร'],
  seno: ['เซโน'],
  pika: ['ปิก้า', 'ปิกา', 'พีร่า'],
  reno: ['เรโน'],
  luma: ['ลูม่า', 'ลูมา'],
  gale: ['เกล'],
  vira: ['วิร่า', 'วิรา'],
  zolo: ['โซโล'],
  miko: ['มิโกะ', 'มิโก'],
  piku: ['ปิกุ', 'ปิกุ๊'],
  rana: ['ราน่า', 'รานา'],
  web: ['เว็บ'],
  bolo: ['โบโล'],
  fina: ['ฟีน่า', 'ฟีนา'],
  dina: ['ดีน่า', 'ดีนา'],
  tina: ['ทีน่า', 'ทีนา'],
  juno: ['จูโน่', 'จูโน'],
  yuna: ['ยูน่า', 'ยูนา'],
  milo: ['ไมโล'],
  kael: ['คาเอล'],
  zina: ['ซีนา', 'ซีน่า'],
  veda: ['เวดา', 'วีดา'],
  koda: ['โคดา', 'โคล่า'],
  zola: ['โซล่า', 'โซลา'],
  bena: ['เบน่า', 'เบนา'],
  tavi: ['ทาวี่', 'ทาวิ'],
  remi: ['เรมี่', 'เรมิ'],
  vito: ['วิโต้', 'วิโต'],
  zori: ['โซรี่', 'โซริ'],
  bria: ['เบรีย'],
  roko: ['โรโกะ', 'โรโก'],
  nura: ['นูร่า', 'นูรา'],
  palo: ['ปาโล'],
  koba: ['โคบา'],
  tova: ['โตวา', 'โทวา'],
  sola: ['โซล่า', 'โซลา']
};

export const getAvailableProperNoun = (text: string, usedTokens: Set<string>): string => {
  const textLower = text.toLowerCase();
  for (const noun of PROPER_NOUN_POOL) {
    if (!usedTokens.has(noun) && !textLower.includes(noun.toLowerCase())) {
      return noun;
    }
  }
  let counter = 1;
  while (true) {
    const fallbackNoun = `Zara${counter}`;
    if (!usedTokens.has(fallbackNoun) && !textLower.includes(fallbackNoun.toLowerCase())) {
      return fallbackNoun;
    }
    counter++;
  }
};

export const protectLocationPhrases = (
  text: string,
  targetLanguage: string,
  tokenOffset = 0,
  usedTokens = new Set<string>()
): { protectedText: string; replacements: ProtectedTokenReplacement[] } => {
  const replacements: ProtectedTokenReplacement[] = [];
  let protectedText = text;
  const locale = String(targetLanguage || '').toLowerCase();
  const locationRe = /\b([A-Za-z][A-Za-z'\-]{1,}(?:\s+[A-Za-z][A-Za-z'\-]{1,}){0,2})\s+(Town|City|Village|District)\b/g;

  protectedText = protectedText.replace(locationRe, (_match, rawName: string, rawType: string) => {
    const name = rawName
      .split(/\s+/g)
      .map((word) => titleCaseWord(word))
      .join(' ')
      .trim();
    const placeType = String(rawType || '').toLowerCase();

    let replacement = `${name} ${rawType}`;
    if (locale.startsWith('th')) {
      if (placeType === 'town' || placeType === 'city') {
        replacement = `เมือง ${name}`;
      } else if (placeType === 'village') {
        replacement = `หมู่บ้าน ${name}`;
      } else if (placeType === 'district') {
        replacement = `เขต ${name}`;
      }
    }

    const token = getAvailableProperNoun(protectedText, usedTokens);
    usedTokens.add(token);

    replacements.push({ token, replacement });
    return token;
  });

  return { protectedText, replacements };
};

export const protectTranslationTokens = (
  text: string,
  targetLanguage: string
): { protectedText: string; replacements: ProtectedTokenReplacement[] } => {
  const usedTokens = new Set<string>();
  const locationResult = protectLocationPhrases(text, targetLanguage, 0, usedTokens);
  // Normalize curly quotes/apostrophes in the input text to straight ones for uniform matching
  let protectedText = locationResult.protectedText.replace(/[\u2018\u2019\u201B\u201C\u201D`‘’“”]/g, "'");
  const replacements = [...locationResult.replacements];

  try {
    const defaultEntries = [
      { sourceText: 'PDF Translator', targetText: 'PDF TRANSLATOR' },
      { sourceText: 'OCR', targetText: 'OCR' }
    ];
    const entries = [
      ...defaultEntries.map(e => ({ ...e, id: 'default-' + e.sourceText, isActive: true, type: 'TERM' as const })),
      ...useGlossaryStore.getState().entries
    ];
    const activeEntries = entries
      .filter((e) => e.isActive && e.sourceText.trim())
      .sort((a, b) => b.sourceText.length - a.sourceText.length);

    const escapeReg = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    activeEntries.forEach((entry) => {
      const source = entry.sourceText.trim();
      const target = entry.targetText.trim();
      
      // Normalize curly quotes/apostrophes in the glossary source text as well
      const normalizedSource = source
        .replace(/[\u2018\u2019\u201B\u201C\u201D`‘’“”]/g, "'")
        .replace(/\s+/g, ' ');

      if (!normalizedSource) return;

      // Check boundary characters to only apply \b when starting/ending with a word character
      // This avoids \b matching failures on entries starting or ending with punctuation (e.g. "SHUP UP!")
      const hasWordStart = /^\w/.test(normalizedSource);
      const hasWordEnd = /\w$/.test(normalizedSource);
      
      const patternStr = (hasWordStart ? '\\b' : '') + escapeReg(normalizedSource) + (hasWordEnd ? '\\b' : '');
      const pattern = new RegExp(patternStr, 'gi');

      const token = getAvailableProperNoun(protectedText, usedTokens);
      const nextText = protectedText.replace(pattern, token);
      if (nextText !== protectedText) {
        usedTokens.add(token);
        protectedText = nextText;
        replacements.push({ token, replacement: target });
      }
    });
  } catch (err) {
    console.error('[App] Failed to apply Custom Glossary Token Protection:', err);
  }

  return { protectedText, replacements };
};

export const restoreProtectedTokens = (text: string, replacements: ProtectedTokenReplacement[]): string => {
  let restored = text;
  for (const item of replacements) {
    const englishPattern = buildLooseTokenPattern(item.token);
    let nextRestored = restored.replace(englishPattern, item.replacement);
    
    if (nextRestored === restored) {
      const lowerToken = item.token.toLowerCase();
      const thaiAliases = PROPER_NOUN_THAI_MAP[lowerToken] || [];
      for (const alias of thaiAliases) {
        const thaiPattern = new RegExp(escapeRegExp(alias), 'gi');
        nextRestored = nextRestored.replace(thaiPattern, item.replacement);
      }
    }
    restored = nextRestored;
  }
  return restored;
};
