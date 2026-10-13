import sys, os, json
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts')))
import external_ocr_bridge as bridge
from paddleocr import PaddleOCR

fixtures = [
    ('manga1', 'public/fixtures/ocr/manga/manga1.png', 2),
    ('manga2', 'public/fixtures/ocr/manga/manga2.png', 3),
    ('manga3', 'public/fixtures/ocr/manga/manga3.png', 5),
    ('document1', 'public/fixtures/ocr/document_test/document1.png', 101),
    ('document2', 'public/fixtures/ocr/document_test/document2.png', 102),
    ('document3', 'public/fixtures/ocr/document_test/document3.png', 103),
]

# Initialize candidate OCR with DirectML
bridge.GLOBAL_USE_DML = True
ocr = bridge.get_paddle_ocr('en', 'cpu_panel_accurate', 'best')

# Load golden snapshot
with open('public/fixtures/ocr/baseline/golden-snapshot-main.json', 'r', encoding='utf-8') as f:
    golden_snap = json.load(f)

print(f"{'Page / Fixture':<15} | {'Golden Words':<12} | {'Cand Words':<12} | {'Delta':<8} | {'Diff Details'}")
print("-" * 80)

total_g = 0
total_c = 0
page_diffs = {}

for case in golden_snap['cases']:
    fid = case['id']
    img_path = case['path']
    g_lines = case['lines']
    
    # Golden words
    g_words = []
    for l in g_lines:
        g_words.extend(l['text'].split())
    
    # Run candidate through raw + wrapper pipeline
    try:
        raw = ocr.ocr(img_path, cls=True)
    except TypeError:
        raw = ocr.ocr(img_path)
    normalized = bridge.normalize_paddle_output(raw)
    cleaned = bridge.cleanup_external_result(
        normalized,
        "paddleocr",
        "panel",
        0, 0,
        "eng",
        quality_profile="best"
    )
    
    c_lines = cleaned.get('lines', [])
    c_words = []
    for l in c_lines:
        c_words.extend(str(l.get('text') or '').split())
        
    g_len = len(g_words)
    c_len = len(c_words)
    total_g += g_len
    total_c += c_len
    delta = c_len - g_len
    
    # Compute detailed differences
    # Find tokens added or removed
    from collections import Counter
    g_cnt = Counter([w.strip() for w in g_words if w.strip()])
    c_cnt = Counter([w.strip() for w in c_words if w.strip()])
    
    added = []
    removed = []
    for w, count in c_cnt.items():
        if count > g_cnt.get(w, 0):
            added.append(f"{w} (+{count - g_cnt.get(w, 0)})")
    for w, count in g_cnt.items():
        if count > c_cnt.get(w, 0):
            removed.append(f"{w} (-{count - c_cnt.get(w, 0)})")
            
    diff_desc = []
    if added:
        diff_desc.append("Added: " + ", ".join(added[:5]))
    if removed:
        diff_desc.append("Removed: " + ", ".join(removed[:5]))
    if not diff_desc:
        diff_desc.append("Identical token set")
        
    line_str = f"{fid:<15} | {g_len:<12} | {c_len:<12} | {delta:<+8} | {'; '.join(diff_desc)}"
    sys.stdout.buffer.write((line_str + "\n").encode('utf-8', errors='replace'))
    page_diffs[fid] = {
        "golden_count": g_len,
        "cand_count": c_len,
        "delta": delta,
        "added": added,
        "removed": removed,
        "cand_lines": [
            {"text": l.get("text"), "bbox": l.get("bbox")}
            for l in c_lines
        ],
        "golden_lines": [
            {"text": l.get("text"), "box": l.get("box")}
            for l in g_lines
        ]
    }

print("-" * 80)
total_msg = f"TOTAL: Golden Words = {total_g}, Candidate Words = {total_c}, Delta = {total_c - total_g:+d}"
sys.stdout.buffer.write((total_msg + "\n").encode('utf-8', errors='replace'))

os.makedirs('scratch', exist_ok=True)
with open('scratch/reconcile_details.json', 'w', encoding='utf-8') as f_out:
    json.dump({
        "total_golden": total_g,
        "total_cand": total_c,
        "delta": total_c - total_g,
        "pages": page_diffs
    }, f_out, ensure_ascii=False, indent=2)
print("[OK] Saved full reconcile details to scratch/reconcile_details.json")
