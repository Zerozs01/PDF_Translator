
const HANGUL_REGEX = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
const THAI_REGEX = /[\u0E00-\u0E7F]/;

const TRANSLATION_LANGUAGE_ALIASES = {
  en: 'en', eng: 'en', english: 'en',
  th: 'th', tha: 'th', thai: 'th',
  ja: 'ja', jpn: 'ja', ko: 'ko', kor: 'ko'
};

const normalizeWhitespace = (text) => text.replace(/\s+/g, ' ').trim();
const normalizeTranslationLanguage = (value, fallback) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (TRANSLATION_LANGUAGE_ALIASES[raw]) return TRANSLATION_LANGUAGE_ALIASES[raw];
  const primary = raw.split('-')[0].trim();
  if (!primary) return fallback;
  return TRANSLATION_LANGUAGE_ALIASES[primary] || primary;
};

const SCI_SYMBOL_ALLOWED_REGEX = /^[A-Za-z0-9()\[\]{}_,.%:+\-*/^=<>|~'"\s\u00B0\u0391-\u03C9\u2190-\u2193\u2212\u2032\u2033]+$/;

const SCI_SYMBOL_SIGNAL_REGEX = /[0-9\u0391-\u03C9()_+\-*/^=<>%\u00B0\u2190-\u2193\u2212\u2032\u2033]/;

const SCI_FORCE_COMPONENT_TOKEN_REGEX = /\b()(\d{1,2})\b/gi;

const SCI_NOTATION_LINE_REGEX = /^(()?\.?\s*\d+(-–]\d+)?(?:\s*[a-z])?|table\s*\d+(-–]\d+)?|chapter\s*\d+|[A-Za-z]?\d+(-–]\d+)?|\(\s*[a-z0-9]{1,3}\s*\)|[A-Za-z]\.|[A-Za-z]{1,2}\d{1,2})$/i;

const SCI_MATH_LINE_REGEX = /^[A-Za-z0-9\u0391-\u03C9()_+\-*/^=<>%\u00B0\u2190-\u2193\u2212\u2032\u2033\s]+$/;


const isLikelyStructuredOcrGarbageToken = (text) => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;

  const hasHangul = HANGUL_REGEX.test(normalized);
  const hasKana = /[\u3040-\u30FF]/.test(normalized);
  const hasHan = /[\u3400-\u9FFF]/.test(normalized);
  const hasThai = THAI_REGEX.test(normalized);
  if (hasHangul || hasKana || hasHan || hasThai) return false;

  const compact = normalized.replace(/\s+/g, '');
  if (compact.length > 14) return false;

  const alphaCount = (compact.match(/[A-Za-z]/g) || []).length;
  const digitCount = (compact.match(/[0-9]/g) || []).length;
  const symbolCount = (compact.match(/[^A-Za-z0-9]/g) || []).length;
  const bracketCount = (compact.match(/[()[\Suggested]{}<>]/g) || []).length;

  const hasMixedSymbolNoise = bracketCount >= 1 && symbolCount >= 2;
  const looksFragmented = compact.length <= 10 && alphaCount <= 5 && digitCount >= 1 && hasMixedSymbolNoise;
  
  console.log(`[isLikelyStructuredOcrGarbageToken] "${text}" -> alphaCount=${alphaCount}, digitCount=${digitCount}, symbolCount=${symbolCount}, looksFragmented=${looksFragmented}`);
  if (!looksFragmented) return false;

  return true;
};

const isScientificSymbolLikeLine = (text, sourceLanguage) => {
  console.log(`[isScientificSymbolLikeLine] Start checking "${text}"`);
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) {
    console.log(`- Empty text -> false`);
    return false;
  }

  const noUnderscore = normalized.replace(/^_+|_+$/g, '');
  const noUnderscoreUpper = noUnderscore.toUpperCase();

  const ocrWords = noUnderscore.split(/\s+/g).filter(Boolean);
  const alphaWordCount = ocrWords.filter((w) => w.length >= 2 && /[A-Za-z]/.test(w)).length;
  console.log(`- alphaWordCount=${alphaWordCount}, ocrWords=${JSON.stringify(ocrWords)}`);
  
  if (alphaWordCount >= 2 && !/[=<>+\-*/^]/.test(noUnderscore)) {
    console.log(`- alphaWordCount >= 2 and no math symbols -> Return FALSE early!`);
    return false;
  }

  if (/^[IAO]$/.test(noUnderscoreUpper)
    || /^(?:OK|NO|HI|HUH|OH|GO|ON|MY|IT|BE|WE|ME|SO|UP|AM|IF|OR|AS|AT|IN|TO|OF|IS)$/i.test(noUnderscore)
    || /^I[''\u2019](?:M|VE|LL|D)$/i.test(noUnderscore)) {
    console.log(`- Exemption short word -> Return FALSE early!`);
    return false;
  }

  const normalizedSourceLanguage = normalizeTranslationLanguage(sourceLanguage || 'en', 'en');
  if (normalizedSourceLanguage === 'es') {
    if (/^(?:SI|NO|EL|LA|UN|YO|TU|SU|ES|EN|DE|AL|LO|TE|ME|SE)$/i.test(noUnderscore)) {
      console.log(`- Spanish short word exemption -> Return FALSE early!`);
      return false;
    }
  }
  
  const forceComponentTokens = normalized.match(SCI_FORCE_COMPONENT_TOKEN_REGEX) || [];
  if (forceComponentTokens.length > 0) {
    if (normalized.length <= 48 && ocrWords.length <= 8 && !/[.!?]/.test(normalized)) {
      console.log(`- Force component tokens matched -> Return TRUE!`);
      return true;
    }
  }

  const hasMathSignals = /[0-9=<>%^]/.test(normalized);
  const naturalLanguageLike = alphaWordCount >= 3 && !hasMathSignals;
  if (naturalLanguageLike) {
    console.log(`- Natural language like (alphaWordCount >= 3 and no math signals) -> Return FALSE!`);
    return false;
  }

  if (normalized.length > 28) {
    console.log(`- Length ${normalized.length} > 28 -> Return FALSE!`);
    return false;
  }
  if (!SCI_SYMBOL_ALLOWED_REGEX.test(normalized)) {
    console.log(`- Allowed regex test failed -> Return FALSE!`);
    return false;
  }

  const tokens = ocrWords;
  if (tokens.length > 5) {
    console.log(`- Tokens count ${tokens.length} > 5 -> Return FALSE!`);
    return false;
  }

  const alnum = normalized.replace(/[^A-Za-z0-9\u0391-\u03C9]/g, '');
  if (alnum.length > 16) {
    console.log(`- Alnum length ${alnum.length} > 16 -> Return FALSE!`);
    return false;
  }

  const compact = normalized.replace(/\s+/g, ' ');
  if (SCI_NOTATION_LINE_REGEX.test(compact)) {
    console.log(`- Notation line regex matched -> Return TRUE!`);
    return true;
  }

  const hasExplicitSciSignal = SCI_SYMBOL_SIGNAL_REGEX.test(normalized);
  if (!hasExplicitSciSignal) {
    const res = normalized === normalized.toUpperCase() && tokens.length <= 2 && alnum.length <= 2;
    console.log(`- No explicit sci signal -> Check upper + tokens<=2 + alnum<=2 -> ${res}`);
    return res;
  }

  const alphaTokens = tokens
    .map((token) => token.replace(/[^A-Za-z]/g, ''))
    .filter(Boolean);
  const longAlphaTokenCount = alphaTokens.filter((token) => token.length >= 4).length;
  if (longAlphaTokenCount >= 1) {
    console.log(`- Long alpha token count >= 1 -> Return FALSE!`);
    return false;
  }

  const hasMathLikeContent = SCI_MATH_LINE_REGEX.test(normalized)
    && /[\u0391-\u03C9_+\-*/^=<>°\u2190-\u2193\u2212\u2032\u2033]/.test(normalized);
  if (hasMathLikeContent) {
    console.log(`- Math like content matched -> Return TRUE!`);
    return true;
  }

  const finalRes = tokens.length <= 2 && alnum.length <= 6;
  console.log(`- Final check: tokens.length <= 2 (${tokens.length <= 2}) && alnum.length <= 6 (${alnum.length <= 6}) -> ${finalRes}`);
  return finalRes;
};

const shouldSkipLineTranslationByScript = (text, sourceLanguage, ocrLanguageHint) => {
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

  const res = !hasLatin && shortTokenLike && (hasHangul || hasKana || hasHan || hasThai);
  console.log(`[shouldSkipLineTranslationByScript] "${text}" -> hasLatin=${hasLatin}, shortTokenLike=${shortTokenLike}, res=${res}`);
  return res;
};

const shouldPreserveSourceLineForTranslation = (text, sourceLanguage, ocrLanguageHint) => {
  if (isLikelyStructuredOcrGarbageToken(text)) return true;
  if (isScientificSymbolLikeLine(text, sourceLanguage)) return true;
  return shouldSkipLineTranslationByScript(text, sourceLanguage, ocrLanguageHint);
};

const testTexts = ["682110209", "Come with me", "MAMA", "Come with me MAMA"];
console.log("=== RUNNING DETAILED FILTER TEST ===");
testTexts.forEach(t => {
  console.log(`\n--------------------------------------------------`);
  const res = shouldPreserveSourceLineForTranslation(t, "en", "eng");
  console.log(`>>> OVERALL PRESERVE RESULT for "${t}": ${res}`);
});
