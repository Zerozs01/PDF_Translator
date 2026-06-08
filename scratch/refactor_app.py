import os

app_tsx_path = r"c:\App\Electron\PDF_Translator\src\App.tsx"

with open(app_tsx_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. ค้นหาบล็อก Heuristics เพื่อลบออก
start_pattern = "const SENTENCE_END_REGEX = /[.!?\\u2026\\u3002\\uFF01\\uFF1F]$/;"
end_pattern = "  return false;\n};\n\nconst intervalOverlap"

if start_pattern not in content:
    print("Error: Start pattern not found in App.tsx!")
    exit(1)
if end_pattern not in content:
    # ลองหาแบบ \r\n
    end_pattern_rn = "  return false;\r\n};\r\n\r\nconst intervalOverlap"
    if end_pattern_rn not in content:
        print("Error: End pattern not found in App.tsx!")
        exit(1)
    else:
        end_pattern = end_pattern_rn

# หาจุดเริ่มและจุดจบ
start_idx = content.find(start_pattern)
# ค้นหาจุดสิ้นสุดของ isLikelyGhostTranslatableLine (ก่อน const intervalOverlap)
end_idx = content.find(end_pattern) + len("  return false;\n};\n\n") if "\r\n" not in end_pattern else content.find(end_pattern) + len("  return false;\r\n};\r\n\r\n")

heuristics_block = content[start_idx:end_idx]
print(f"Heuristics block found! Size: {len(heuristics_block)} characters")

# ลบบล็อกนี้ออก
new_content = content[:start_idx] + content[end_idx:]

# 2. ค้นหาจุดที่จะแทรก Import
import_marker = "import './types/electron.d';"
if import_marker not in new_content:
    print("Error: Import marker not found!")
    exit(1)

import_statement = """import {
  countReadableLength,
  isStrongSentenceEnd,
  isLikelyContinuation,
  isLikelyStandaloneInterjectionLine,
  computeMedian,
  ProtectedTokenReplacement,
  escapeRegExp,
  buildLooseTokenPattern,
  collapseRepeatedTranslationFragments,
  TRANSLATION_LETTER_REGEX,
  buildTranslationComparisonKey,
  buildOfflineGroupRetrySourceText,
  resolveSourceLanguageFromOCR,
  scoreSpanishVsEnglishHints,
  scoreSpanishHintTokens,
  scoreEnglishHintTokens,
  inferSourceLanguageFromTextHints,
  resolvePreferredSourceLanguageForText,
  isLikelyLatinDominantTranslationPage,
  hasStrongLatinAnchorLines,
  isLikelyShortForeignSfxLine,
  resolveComicPageSourceLanguage,
  hasKnownOcrNoisePattern,
  isLikelyStructuredOcrGarbageToken,
  scoreSourceLineReadability,
  shouldAcceptWordsOnlyLineFallback,
  computeLineWordUnionCoverage,
  resolveBestOcrLineText,
  shouldForceKeepTechnicalTranslationLine,
  shouldForceKeepComicTranslationLine,
  isLikelyGhostTranslatableLine,
  HANGUL_REGEX,
  THAI_REGEX
} from './services/ocr/ocrTextHeuristics';"""

marker_idx = new_content.find(import_marker) + len(import_marker)
new_content = new_content[:marker_idx] + "\n\n" + import_statement + new_content[marker_idx:]

with open(app_tsx_path, "w", encoding="utf-8") as f:
    f.write(new_content)

print("App.tsx refactored successfully!")
