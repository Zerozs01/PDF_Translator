import os

# 1. แก้ไข ocrTextHeuristics.ts เพื่อ export regex
heuristics_path = r"c:\App\Electron\PDF_Translator\src\services\ocr\ocrTextHeuristics.ts"
with open(heuristics_path, "r", encoding="utf-8") as f:
    heuristics_content = f.read()

heuristics_content = heuristics_content.replace(
    "const SOFT_CONTINUATION_END_REGEX =",
    "export const SOFT_CONTINUATION_END_REGEX ="
)
heuristics_content = heuristics_content.replace(
    "const CONTINUATION_TRAILING_WORD_REGEX =",
    "export const CONTINUATION_TRAILING_WORD_REGEX ="
)

with open(heuristics_path, "w", encoding="utf-8") as f:
    f.write(heuristics_content)
print("ocrTextHeuristics.ts regex exported!")

# 2. แก้ไข App.tsx เพื่อนำเข้า regex เพิ่มเติม
app_path = r"c:\App\Electron\PDF_Translator\src\App.tsx"
with open(app_path, "r", encoding="utf-8") as f:
    app_content = f.read()

import_target = "isLikelyGhostTranslatableLine,"
if import_target in app_content:
    app_content = app_content.replace(
        import_target,
        f"{import_target}\n  SOFT_CONTINUATION_END_REGEX,\n  CONTINUATION_TRAILING_WORD_REGEX,"
    )
    with open(app_path, "w", encoding="utf-8") as f:
        f.write(app_content)
    print("App.tsx imports updated with regex!")
else:
    print("Error: import_target not found in App.tsx!")

# 3. แก้ไข App.translationDedupe.test.ts
test_path = r"c:\App\Electron\PDF_Translator\src\App.translationDedupe.test.ts"
with open(test_path, "r", encoding="utf-8") as f:
    test_content = f.read()

# นำเข้า heuristics module
test_content = test_content.replace(
    "const appModule = await import('./App');",
    "const appModule = await import('./App');\n  const heuristicsModule = await import('./services/ocr/ocrTextHeuristics');"
)

# สลับการนำเข้า
test_content = test_content.replace(
    "resolveBestOcrLineText = appModule.resolveBestOcrLineText;",
    "resolveBestOcrLineText = heuristicsModule.resolveBestOcrLineText;"
)
test_content = test_content.replace(
    "inferSourceLanguageFromTextHints = appModule.inferSourceLanguageFromTextHints;",
    "inferSourceLanguageFromTextHints = heuristicsModule.inferSourceLanguageFromTextHints;"
)
test_content = test_content.replace(
    "resolvePreferredSourceLanguageForText = appModule.resolvePreferredSourceLanguageForText;",
    "resolvePreferredSourceLanguageForText = heuristicsModule.resolvePreferredSourceLanguageForText;"
)
test_content = test_content.replace(
    "isLikelyGhostTranslatableLine = appModule.isLikelyGhostTranslatableLine;",
    "isLikelyGhostTranslatableLine = heuristicsModule.isLikelyGhostTranslatableLine;"
)

with open(test_path, "w", encoding="utf-8") as f:
    f.write(test_content)
print("App.translationDedupe.test.ts updated successfully!")
