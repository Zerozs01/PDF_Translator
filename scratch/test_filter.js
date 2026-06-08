const normalizeWhitespace = (text) => text.replace(/\s+/g, ' ').trim();

const TRANSLATION_LANGUAGE_ALIASES = {
  en: 'en', eng: 'en', english: 'en',
  th: 'th', tha: 'th', thai: 'th',
  ja: 'ja', jpn: 'ja', ko: 'ko', kor: 'ko'
};

const normalizeTranslationLanguage = (value, fallback) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (TRANSLATION_LANGUAGE_ALIASES[raw]) return TRANSLATION_LANGUAGE_ALIASES[raw];
  const primary = raw.split('-')[0].trim();
  if (!primary) return fallback;
  return TRANSLATION_LANGUAGE_ALIASES[primary] || primary;
};

const isLikelyStructuredOcrGarbageToken = (text) => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;

  const hasHangul = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/.test(normalized);
  const hasKana = /[\u3040-\u30FF]/.test(normalized);
  const hasHan = /[\u3400-\u9FFF]/.test(normalized);
  const hasThai = /[\u0E00-\u0E7F]/.test(normalized);
  if (hasHangul || hasKana || hasHan || hasThai) return false;

  const compact = normalized.replace(/\s+/g, '');
  if (compact.length > 14) return false;

  const alphaCount = (compact.match(/[A-Za-z]/g) || []).length;
  const digitCount = (compact.match(/[0-9]/g) || []).length;
  const symbolCount = (compact.match(/[^A-Za-z0-9]/g) || []).length;
  const bracketCount = (compact.match(/[()[\]{}<>]/g) || []).length;

  const hasMixedSymbolNoise = bracketCount >= 1 && symbolCount >= 2;
  const looksFragmented = compact.length <= 10 && alphaCount <= 5 && digitCount >= 1 && hasMixedSymbolNoise;
  if (!looksFragmented) return false;

  return true;
};

const SCI_SYMBOL_ALLOWED_REGEX = /^[A-Za-z0-9()\[\]{}_,.%:+\-*/^=<>|~'"\s\u00B0\u0391-\u03C9\u2190-\u2193\u2212\u2032\u2033]+$/;
const SCI_SYMBOL_SIGNAL_REGEX = /[0-9\u0391-\u03C9()_+\-*/^=<>%\u00B0\u2190-\u2193\u2212\u2032\u2033]/;
const SCI_FORCE_COMPONENT_TOKEN_REGEX = /\b(?:F|M)(?:x|y|z|\d{1,2})\b/gi;
const SCI_NOTATION_LINE_REGEX = /^(?:fig(?:ure)?\.?\s*\d+(?:[-–]\d+)?(?:\s*[a-z])?|table\s*\d+(?:[-–]\d+)?|chapter\s*\d+|[A-Za-z]?\d+(?:[-–]\d+)?|\(\s*[a-z0-9]{1,3}\s*\)|[A-Za-z]\.|[A-Za-z]{1,2}\d{1,2})$/i;

const isScientificSymbolLikeLine = (text, sourceLanguage) => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;

  const noUnderscore = normalized.replace(/^_+|_+$/g, '');
  const noUnderscoreUpper = noUnderscore.toUpperCase();

  const ocrWords = noUnderscore.split(/\s+/g).filter(Boolean);
  const alphaWordCount = ocrWords.filter((w) => w.length >= 2 && /[A-Za-z]/.test(w)).length;
  if (alphaWordCount >= 2 && !/[=<>+\-*/^]/.test(noUnderscore)) {
    return false;
  }

  if (/^[IAO]$/.test(noUnderscoreUpper)
    || /^(?:OK|NO|HI|HUH|OH|GO|ON|MY|IT|BE|WE|ME|SO|UP|AM|IF|OR|AS|AT|IN|TO|OF|IS)$/i.test(noUnderscore)
    || /^I[''\u2019](?:M|VE|LL|D)$/i.test(noUnderscore)) {
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
    const isUpper = normalized === normalized.toUpperCase();
    const tokenOk = tokens.length <= 2;
    const alnumOk = alnum.length <= 2;
    const finalVal = isUpper && tokenOk && alnumOk;
    return finalVal;
  }

  return false;
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

  if (!hasLatin && shortTokenLike && (hasHangul || hasKana || hasHan || hasThai)) {
    return true;
  }

  return false;
};

const shouldPreserveSourceLineForTranslation = (text, sourceLanguage, ocrLanguageHint) => {
  const garbage = isLikelyStructuredOcrGarbageToken(text);
  const sci = isScientificSymbolLikeLine(text, sourceLanguage);
  const scriptSkip = shouldSkipLineTranslationByScript(text, sourceLanguage, ocrLanguageHint);
  return {
    preserve: garbage || sci || scriptSkip,
    details: { garbage, sci, scriptSkip }
  };
};

const testTexts = ["682110209", "Come with me", "MAMA"];
testTexts.forEach(t => {
  console.log(`=== Test: "${t}" ===`);
  console.log(JSON.stringify(shouldPreserveSourceLineForTranslation(t, "en", "eng"), null, 2));
});
