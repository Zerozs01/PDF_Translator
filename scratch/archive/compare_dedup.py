import difflib
import subprocess

def get_old_content():
    # Get the file content at commit 3483cb9dba0912d85c4dc588271836dd1d358b2c
    cmd = ["git", "show", "3483cb9dba0912d85c4dc588271836dd1d358b2c:src/components/OCR/OCRTextLayerPanel.tsx"]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    return res.stdout

def get_new_content():
    with open("src/services/ocr/ocrSafetyLineDedup.ts", "r", encoding="utf-8") as f:
        return f.read()

def extract_functions(content):
    # Extract functions related to deduplication
    lines = content.splitlines()
    funcs = {}
    current_func = None
    current_lines = []
    
    for line in lines:
        if line.strip().startswith("const ") or line.strip().startswith("export const ") or line.strip().startswith("function "):
            # Check if it's one of the dedup functions
            func_names = [
                "applyPanelSafetyLineDedup",
                "suppressDisplacedPrefixEchoes",
                "suppressDisplacedPanelLongPhraseEchoes",
                "mergePanelRicherTextWithCleanerDuplicateGeometry",
                "findTopWatermarkDialogueEchoTarget",
                "isLikelyPanelGhostLineForSafety",
                "isLikelyLargeBorderEffectLineForSafety",
                "isLikelyTinyMangaArtifactLineForSafety"
            ]
            matched = None
            for name in func_names:
                if name in line:
                    matched = name
                    break
            
            if matched:
                if current_func:
                    funcs[current_func] = "\n".join(current_lines)
                current_func = matched
                current_lines = [line]
                continue
        
        if current_func:
            current_lines.append(line)
            # Simple check for end of function block in typescript (closing brace on column 0 or 1)
            # or if next function starts, we handle it above.
            
    if current_func:
        funcs[current_func] = "\n".join(current_lines)
        
    return funcs

def main():
    old_code = get_old_content()
    new_code = get_new_content()
    
    old_funcs = extract_functions(old_code)
    new_funcs = extract_functions(new_code)
    
    print(f"Old functions found: {list(old_funcs.keys())}")
    print(f"New functions found: {list(new_funcs.keys())}")
    
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    for name in old_funcs:
        if name in new_funcs:
            old_f = old_funcs[name].splitlines()
            new_f = new_funcs[name].splitlines()
            diff = list(difflib.unified_diff(old_f, new_f, fromfile=f"old_{name}", tofile=f"new_{name}", lineterm=""))
            if diff:
                print(f"\n--- Diff for {name} ---")
                for line in diff[:80]:
                    try:
                        print(line)
                    except Exception:
                        print(line.encode('utf-8', errors='ignore').decode('utf-8'))
            else:
                print(f"Function {name} is identical.")
        else:
            print(f"Function {name} not found in new code.")

if __name__ == "__main__":
    main()
