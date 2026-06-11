import os
import re

app_tsx = os.path.join(os.path.dirname(__file__), '..', 'src', 'App.tsx')

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

    all_code_blocks = [
        sci_allowed, sci_signal, sci_force, sci_notation, sci_math,
        is_garbage, is_sci, is_skip, is_preserve
    ]
    
    cleaned_blocks = []
    for block in all_code_blocks:
        # Remove TypeScript type signatures of parameter lists: e.g. text: string or ocrLanguageHint?: string
        block_clean = re.sub(r'\??:\s*[\w\[\]\s|]+', '', block)
        # Remove return type casts 'as string' or similar
        block_clean = re.sub(r'\s+as\s+\w+', '', block_clean)
        # Remove 'export' keyword
        block_clean = block_clean.replace('export ', '')
        cleaned_blocks.append(block_clean)
        
    temp_js = os.path.join(os.path.dirname(__file__), 'temp_test_filter.js')
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
        for cb in cleaned_blocks:
            f_out.write(cb + "\n\n")
            
        f_out.write("""
const testTexts = ["682110209", "Come with me", "MAMA"];
console.log("=== Testing with real cleaned functions ===");
testTexts.forEach(t => {
  const garbage = isLikelyStructuredOcrGarbageToken(t);
  const sci = isScientificSymbolLikeLine(t, "en");
  const scriptSkip = shouldSkipLineTranslationByScript(t, "en", "eng");
  const preserve = shouldPreserveSourceLineForTranslation(t, "en", "eng");
  
  console.log(`\\nText: "${t}"`);
  console.log(`- garbage: ${garbage}`);
  console.log(`- sci: ${sci}`);
  console.log(`- scriptSkip: ${scriptSkip}`);
  console.log(`- preserve (final): ${preserve}`);
});
""")
    print("TypeScript cleaning complete. Running test with Node...")
    import subprocess
    result = subprocess.run(['node', temp_js], capture_output=True, text=True, encoding='utf-8')
    print(result.stdout)
    if result.stderr:
        print("ERRORS:")
        print(result.stderr)
        
except Exception as e:
    import traceback
    traceback.print_exc()
