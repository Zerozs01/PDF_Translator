import os

test_file_path = r"c:\App\Electron\PDF_Translator\src\components\OCR\translationOverlayUtils.test.ts"

if os.path.exists(test_file_path):
    with open(test_file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # แทนที่ v46 เป็น v47
    updated_content = content.replace("ver:v46", "ver:v47")
    
    with open(test_file_path, 'w', encoding='utf-8') as f:
        f.write(updated_content)
    print("Successfully updated ver:v46 to ver:v47 in translationOverlayUtils.test.ts")
else:
    print("Test file not found at:", test_file_path)
