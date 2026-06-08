import os
import re

app_tsx = r'c:\App\Electron\PDF_Translator\src\App.tsx'

with open(app_tsx, 'r', encoding='utf-8') as f:
    code = f.read()

def extract_function(code_str, func_name):
    start_idx = code_str.find(func_name)
    if start_idx == -1:
        raise ValueError(f"Function {func_name} not found")
    
    brace_idx = code_str.find('{', start_idx)
    open_braces = 1
    idx = brace_idx + 1
    
    while open_braces > 0 and idx < len(code_str):
        if code_str[idx] == '{':
            open_braces += 1
        elif code_str[idx] == '}':
            open_braces -= 1
        idx += 1
        
    return code_str[start_idx:idx]

try:
    is_garbage = extract_function(code, 'const isLikelyStructuredOcrGarbageToken =')
    is_sci = extract_function(code, 'const isScientificSymbolLikeLine =')
    is_skip = extract_function(code, 'const shouldSkipLineTranslationByScript =')
    is_preserve = extract_function(code, 'export const shouldPreserveSourceLineForTranslation =')
    
    sci_allowed = re.search(r'const SCI_SYMBOL_ALLOWED_REGEX =.*', code).group(0)
    sci_signal = re.search(r'const SCI_SYMBOL_SIGNAL_REGEX =.*', code).group(0)
    sci_force = re.search(r'const SCI_FORCE_COMPONENT_TOKEN_REGEX =.*', code).group(0)
    sci_notation = re.search(r'const SCI_NOTATION_LINE_REGEX =.*', code).group(0)
    sci_math = re.search(r'const SCI_MATH_LINE_REGEX =.*', code).group(0)

    # Clean TypeScript signatures
    all_code_blocks = [
        sci_allowed, sci_signal, sci_force, sci_notation, sci_math,
        is_garbage, is_sci, is_skip, is_preserve
    ]
    
    cleaned_blocks = []
    for block in all_code_blocks:
        block_clean = re.sub(r'\??:\s*[\w\[\]\s|]+', '', block)
        block_clean = re.sub(r'\s+as\s+\w+', '', block_clean)
        block_clean = block_clean.replace('export ', '')
        cleaned_blocks.append(block_clean)
        
    temp_js = r'c:\App\Electron\PDF_Translator\scratch\test_details.js'
    
    # Let's instrument isScientificSymbolLikeLine in cleaned_blocks[6] (which is is_sci)
    # and shouldSkipLineTranslationByScript in cleaned_blocks[7] (which is is_skip)
    # by replacing returns with console.logs
    
    with open(temp_js, 'w', encoding='utf-8') as f_out:
        f_out.write("""
const HANGUL_REGEX = /[\\u1100-\\u11FF\\u3130-\\u318F\\uAC00-\\uD7AF]/;
const THAI_REGEX = /[\\u0E00-\\u0E7F]/;

const TRANSLATION_LANGUAGE_ALIASES = {
  en: 'en', eng: 'en', english: 'en',
  th: 'th', tha: 'th', thai: 'th',
  ja: 'ja', jpn: 'ja', ko: 'ko', kor: 'ko'
};

const normalizeWhitespace = (text) => text.replace(/\\s+/g, ' ').trim();
const normalizeTranslationLanguage = (value, fallback) => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (TRANSLATION_LANGUAGE_ALIASES[raw]) return TRANSLATION_LANGUAGE_ALIASES[raw];
  const primary = raw.split('-')[0].trim();
  if (!primary) return fallback;
  return TRANSLATION_LANGUAGE_ALIASES[primary] || primary;
};
\n""")
        
        # We will write the regexes first
        for cb in cleaned_blocks[:5]:
            f_out.write(cb + "\n\n")
            
        # We will write manual instrumented functions instead of the extracted ones to debug
        f_out.write("""
const isLikelyStructuredOcrGarbageToken = (text) => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;

  const hasHangul = HANGUL_REGEX.test(normalized);
  const hasKana = /[\\u3040-\\u30FF]/.test(normalized);
  const hasHan = /[\\u3400-\\u9FFF]/.test(normalized);
  const hasThai = THAI_REGEX.test(normalized);
  if (hasHangul || hasKana || hasHan || hasThai) return false;

  const compact = normalized.replace(/\\s+/g, '');
  if (compact.length > 14) return false;

  const alphaCount = (compact.match(/[A-Za-z]/g) || []).length;
  const digitCount = (compact.match(/[0-9]/g) || []).length;
  const symbolCount = (compact.match(/[^A-Za-z0-9]/g) || []).length;
  const bracketCount = (compact.match(/[()[\\Suggested]{}<>]/g) || []).length;

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

  const ocrWords = noUnderscore.split(/\\s+/g).filter(Boolean);
  const alphaWordCount = ocrWords.filter((w) => w.length >= 2 && /[A-Za-z]/.test(w)).length;
  console.log(`- alphaWordCount=${alphaWordCount}, ocrWords=${JSON.stringify(ocrWords)}`);
  
  if (alphaWordCount >= 2 && !/[=<>+\\-*/^]/.test(noUnderscore)) {
    console.log(`- alphaWordCount >= 2 and no math symbols -> Return FALSE early!`);
    return false;
  }

  if (/^[IAO]$/.test(noUnderscoreUpper)
    || /^(?:OK|NO|HI|HUH|OH|GO|ON|MY|IT|BE|WE|ME|SO|UP|AM|IF|OR|AS|AT|IN|TO|OF|IS)$/i.test(noUnderscore)
    || /^I[''\\u2019](?:M|VE|LL|D)$/i.test(noUnderscore)) {
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

  const alnum = normalized.replace(/[^A-Za-z0-9\\u0391-\\u03C9]/g, '');
  if (alnum.length > 16) {
    console.log(`- Alnum length ${alnum.length} > 16 -> Return FALSE!`);
    return false;
  }

  const compact = normalized.replace(/\\s+/g, ' ');
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
    && /[\\u0391-\\u03C9_+\\-*/^=<>\u00B0\\u2190-\\u2193\\u2212\\u2032\\u2033]/.test(normalized);
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
  const hasHangul = /[\\u1100-\\u11FF\\u3130-\\u318F\\uAC00-\\uD7AF]/.test(normalized);
  const hasKana = /[\\u3040-\\u30FF]/.test(normalized);
  const hasHan = /[\\u3400-\\u4DBF\\u4E00-\\u9FFF]/.test(normalized);
  const hasThai = /[\\u0E00-\\u0E7F]/.test(normalized);
  const tokenCount = normalized.split(/\\s+/g).filter(Boolean).length;
  const compactLength = normalized.replace(/\\s+/g, '').length;
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
  console.log(`\\n--------------------------------------------------`);
  const res = shouldPreserveSourceLineForTranslation(t, "en", "eng");
  console.log(`>>> OVERALL PRESERVE RESULT for "${t}": ${res}`);
});
""")
    print("TypeScript cleaning & detail generation complete.")
    
except Exception as e:
    import traceback
    traceback.print_exc()

