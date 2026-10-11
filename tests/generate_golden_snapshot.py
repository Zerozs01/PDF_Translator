import sys, os, json, time
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts')))
import external_ocr_bridge as bridge
from paddleocr import PaddleOCR

FIXTURES = [
    {"id": "manga1", "path": "public/fixtures/ocr/manga/manga1.png", "lang": "en"},
    {"id": "manga2", "path": "public/fixtures/ocr/manga/manga2.png", "lang": "en"},
    {"id": "manga3", "path": "public/fixtures/ocr/manga/manga3.png", "lang": "en"},
    {"id": "document1", "path": "public/fixtures/ocr/document_test/document1.png", "lang": "en"},
    {"id": "document2", "path": "public/fixtures/ocr/document_test/document2.png", "lang": "en"},
    {"id": "document3", "path": "public/fixtures/ocr/document_test/document3.png", "lang": "en"},
]

def main():
    bridge.GLOBAL_USE_DML = False  # Generate baseline on CPU to be purely canonical standard reference
    kw = bridge.build_paddle_constructor_kwargs('en', 'cpu_panel_accurate')
    kw['use_onnx'] = False
    ocr = PaddleOCR(**kw)
    
    snapshot = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "engine": "paddleocr-2.8.1-cpu-reference",
        "description": "Golden snapshot from main generated on CPU reference mode",
        "cases": []
    }
    
    for f in FIXTURES:
        p = f["path"]
        if not os.path.exists(p):
            print(f"Skipping {f['id']} (not found: {p})")
            continue
        print(f"Processing golden snapshot for {f['id']} ({p})...")
        t0 = time.perf_counter()
        res = ocr.ocr(p, cls=True)
        elapsed = time.perf_counter() - t0
        
        lines = []
        for line in (res[0] or []):
            box, (text, score) = line
            lines.append({
                "box": [[round(coord, 2) for coord in pt] for pt in box],
                "text": text,
                "score": round(float(score), 4)
            })
            
        snapshot["cases"].append({
            "id": f["id"],
            "path": p,
            "lang": f["lang"],
            "lineCount": len(lines),
            "runtimeSec": round(elapsed, 3),
            "lines": lines
        })
        print(f"  -> {f['id']}: {len(lines)} lines extracted in {elapsed:.2f}s")
        
    out_path = 'public/fixtures/ocr/baseline/golden-snapshot-main.json'
    with open(out_path, 'w', encoding='utf-8') as fp:
        json.dump(snapshot, fp, indent=2, ensure_ascii=False)
        
    print(f"\n[DONE] Saved golden snapshot with {len(snapshot['cases'])} cases to {out_path}")

if __name__ == '__main__':
    main()
