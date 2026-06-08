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
    is_ghost = extract_function(code, 'export const isLikelyGhostTranslatableLine =')
    score_read = extract_function(code, 'const scoreSourceLineReadability =')
    has_noise = extract_function(code, 'const hasKnownOcrNoisePattern =')
    
    # Clean TypeScript
    blocks = [is_ghost, score_read, has_noise]
    cleaned = []
    for b in blocks:
        b_clean = re.sub(r'\??:\s*[\w\[\]\s|{}<>]+', '', b)
        b_clean = re.sub(r'\s+as\s+\w+', '', b_clean)
        b_clean = b_clean.replace('export ', '')
        cleaned.append(b_clean)
        
    temp_js = r'c:\App\Electron\PDF_Translator\scratch\test_ghost.js'
    
    with open(temp_js, 'w', encoding='utf-8') as f_out:
        f_out.write("""
const HANGUL_REGEX = /[\\u1100-\\u11FF\\u3130-\\u318F\\uAC00-\\uD7AF]/;
const THAI_REGEX = /[\\u0E00-\\u0E7F]/;
const OCR_NOISE_COMPACT_FRAGMENTS = ['submaie', 'ureat', 'ydoot', 'falinth', 'willtudhow', 'chapte', 'chapt', 'effctofravt', 'ctriclm', 'gnetiontact', 'rescaused'];
const ENGLISH_TECH_HINT_WORDS = new Set(['chapter', 'table', 'fig', 'figure', 'conditions', 'equilibrium', 'rigid', 'body', 'reaction', 'moment', 'force', 'diagram']);

const normalizeWhitespace = (text) => text.replace(/\\s+/g, ' ').trim();
const computeLineWordUnionCoverage = (line) => 1.0; // Mocked
const shouldForceKeepComicTranslationLine = (text, line) => false;
const shouldForceKeepTechnicalTranslationLine = (text, line) => false;

const GHOST_TRANSLATION_PUNCT_ONLY_REGEX = /^[^A-Za-z0-9]+$/;
const GHOST_TRANSLATION_SHORT_TOKEN_REGEX = /^[A-Z0-9]{1,4}$/;

\n""")
        f_out.write(cleaned[2] + "\n\n") # hasKnownOcrNoisePattern
        f_out.write(cleaned[1] + "\n\n") # scoreSourceLineReadability
        f_out.write(cleaned[0] + "\n\n") # isLikelyGhostTranslatableLine
        
        f_out.write("""
const linesToTest = [
  {
    text: "682110209",
    line: {
      text: "682110209",
      confidence: 99.92,
      bbox: { x0: 1418, y0: 19, x1: 1669, y1: 75 },
      words: [{ text: "682110209", confidence: 99.92, bbox: { x0: 1418, y0: 19, x1: 1669, y1: 75 } }]
    }
  },
  {
    text: "MAMA",
    line: {
      text: "MAMA",
      confidence: 97.94,
      bbox: { x0: 1464, y0: 92, x1: 1632, y1: 169 },
      words: [{ text: "MAMA", confidence: 97.94, bbox: { x0: 1464, y0: 92, x1: 1632, y1: 169 } }]
    }
  },
  {
    text: "Come with me",
    line: {
      text: "Come with me",
      confidence: 95.44,
      bbox: { x0: 650, y0: 106, x1: 1018, y1: 199 },
      words: [
        { text: "Come", confidence: 95.44, bbox: { x0: 650, y0: 106, x1: 797.2, y1: 199 } },
        { text: "with", confidence: 95.44, bbox: { x0: 797.2, y0: 106, x1: 944.4, y1: 199 } },
        { text: "me", confidence: 95.44, bbox: { x0: 944.4, y0: 106, x1: 1018, y1: 199 } }
      ]
    }
  }
];

console.log("=== RUNNING GHOST FILTER TEST ===");
linesToTest.forEach(item => {
  const isGhost = isLikelyGhostTranslatableLine(item.line, item.text, "paddleocr", 1759, 867);
  console.log(`Text: "${item.text}" -> isGhost: ${isGhost}`);
});
""")
        
    print("TypeScript cleaning for Ghost Filter Test complete.")

except Exception as e:
    import traceback
    traceback.print_exc()

