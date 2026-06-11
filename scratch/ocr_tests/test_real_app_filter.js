const fs = require('fs');
const path = require('path');

// Read App.tsx code
const appCodePath = path.join(__dirname, '..', 'src', 'App.tsx');
if (!fs.existsSync(appCodePath)) {
  console.error("App.tsx not found!");
  process.exit(1);
}

const code = fs.readFileSync(appCodePath, 'utf8');

// We need to extract the functions we want to test:
// 1. isScientificSymbolLikeLine
// 2. isLikelyStructuredOcrGarbageToken
// 3. shouldSkipLineTranslationByScript
// 4. shouldPreserveSourceLineForTranslation

// Instead of extracting via regex which can be fragile, let's write a small node script
// that mocks the environment and evals the extracted functions.
// We can extract them by finding the function definitions and matching curly braces.

function extractFunction(codeStr, funcName) {
  const startIndex = codeStr.indexOf(funcName);
  if (startIndex === -1) {
    throw new Error(`Function ${funcName} not found`);
  }
  
  // Find the opening brace '{'
  let braceIndex = codeStr.indexOf('{', startIndex);
  let openBraces = 1;
  let index = braceIndex + 1;
  
  while (openBraces > 0 && index < codeStr.length) {
    if (codeStr[index] === '{') {
      openBraces++;
    } else if (codeStr[index] === '}') {
      openBraces--;
    }
    index++;
  }
  
  const funcBody = codeStr.slice(startIndex, index);
  return funcBody;
}

try {
  // Extract all helper functions and variables
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

  // Extract function definitions from App.tsx
  const isGarbageCode = extractFunction(code, 'const isLikelyStructuredOcrGarbageToken =');
  const isSciCode = extractFunction(code, 'const isScientificSymbolLikeLine =');
  const isSkipCode = extractFunction(code, 'const shouldSkipLineTranslationByScript =');
  const isPreserveCode = extractFunction(code, 'export const shouldPreserveSourceLineForTranslation =');
  
  // Extract regexes
  const sciAllowedRegexCode = code.match(/const SCI_SYMBOL_ALLOWED_REGEX =.*/)[0];
  const sciSignalRegexCode = code.match(/const SCI_SYMBOL_SIGNAL_REGEX =.*/)[0];
  const sciForceRegexCode = code.match(/const SCI_FORCE_COMPONENT_TOKEN_REGEX =.*/)[0];
  const sciNotationRegexCode = code.match(/const SCI_NOTATION_LINE_REGEX =.*/)[0];
  const sciMathRegexCode = code.match(/const SCI_MATH_LINE_REGEX =.*/)[0];

  // Evaluate them in this context
  eval(sciAllowedRegexCode);
  eval(sciSignalRegexCode);
  eval(sciForceRegexCode);
  eval(sciNotationRegexCode);
  eval(sciMathRegexCode);
  
  eval(isGarbageCode);
  eval(isSciCode);
  eval(isSkipCode);
  eval(isPreserveCode);

  // Test
  const testTexts = ["682110209", "Come with me", "MAMA"];
  console.log("=== Testing with real extracted functions from App.tsx ===");
  testTexts.forEach(t => {
    const garbage = isLikelyStructuredOcrGarbageToken(t);
    const sci = isScientificSymbolLikeLine(t, "en");
    const scriptSkip = shouldSkipLineTranslationByScript(t, "en", "eng");
    const preserve = shouldPreserveSourceLineForTranslation(t, "en", "eng");
    
    console.log(`\nText: "${t}"`);
    console.log(`- garbage: ${garbage}`);
    console.log(`- sci: ${sci}`);
    console.log(`- scriptSkip: ${scriptSkip}`);
    console.log(`- preserve (final): ${preserve}`);
  });

} catch (err) {
  console.error("Error during extraction or evaluation:", err);
}
