import sys, os, json, subprocess

def main():
    batches = [1, 6, 16]
    results = {}
    
    for b in batches:
        out_file = f"scratch/determinism/manga3_batch_{b}.json"
        cmd = [
            sys.executable,
            "-c",
            f"""
import sys, os, json
sys.path.insert(0, 'scripts')
import external_ocr_bridge as bridge
bridge.GLOBAL_USE_DML = True
ocr = bridge.get_paddle_ocr('en', 'cpu_panel_accurate', 'best')
pipeline = getattr(ocr, 'paddlex_pipeline', None)
# Test with rec batch size
try:
    raw = ocr.predict('public/fixtures/ocr/manga/manga3.png', text_recognition_batch_size={b})
except Exception:
    raw = ocr.predict('public/fixtures/ocr/manga/manga3.png')

lines = []
if raw and isinstance(raw[0], dict):
    rec_texts = raw[0].get('rec_texts', [])
    rec_scores = raw[0].get('rec_scores', [])
    dt_polys = raw[0].get('dt_polys', [])
    for i in range(len(rec_texts)):
        lines.append({{
            'text': str(rec_texts[i]),
            'score': round(float(rec_scores[i]), 4),
            'box': dt_polys[i].tolist() if hasattr(dt_polys[i], 'tolist') else dt_polys[i]
        }})
with open('{out_file}', 'w', encoding='utf-8') as f:
    json.dump(lines, f, ensure_ascii=False, indent=2)
print('[OK] Batch {b} finished, lines:', len(lines))
"""
        ]
        subprocess.run(cmd, check=True)
        with open(out_file, 'r', encoding='utf-8') as f:
            results[b] = json.load(f)

    # Compare batch 1 vs 6 vs 16
    print("\n=== COMPARING REC_BATCH_NUM = 1 vs 6 vs 16 ===")
    ref = results[1]
    for b in [6, 16]:
        curr = results[b]
        diffs = []
        for i in range(max(len(ref), len(curr))):
            t1 = ref[i]['text'] if i < len(ref) else '<none>'
            s1 = ref[i]['score'] if i < len(ref) else 0.0
            t2 = curr[i]['text'] if i < len(curr) else '<none>'
            s2 = curr[i]['score'] if i < len(curr) else 0.0
            if t1 != t2 or abs(s1 - s2) > 0.001:
                diffs.append((i, t1, s1, t2, s2))
        print(f"Batch 1 vs Batch {b}: {len(diffs)} differences found.")
        for d in diffs:
            print(f"  Line {d[0]}: '{d[1]}' ({d[2]}) vs '{d[3]}' ({d[4]})")

if __name__ == '__main__':
    main()
