import sys, os, json
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts')))
import external_ocr_bridge

from paddlex import create_pipeline
p = create_pipeline(pipeline='scripts/paddle_thai_ocr.yaml')
res = list(p.predict('public/fixtures/ocr/baseline/THAI_NOTE_056354.jpg'))

texts = res[0]['rec_texts']
scores = res[0]['rec_scores']
boxes = res[0]['dt_polys']

lines = []
for t, s, b in zip(texts, scores, boxes):
    lines.append({
        "text": t,
        "score": round(float(s), 4),
        "box": b.tolist() if hasattr(b, 'tolist') else b
    })

out_path = 'public/fixtures/ocr/baseline/thai_note_ocr_result.json'
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({"image": "THAI_NOTE_056354.jpg", "lineCount": len(lines), "lines": lines}, f, indent=2, ensure_ascii=False)

print(f"Extracted {len(lines)} lines from THAI_NOTE_056354.jpg and saved to {out_path}")
print("First 10 lines:")
for i in range(min(10, len(lines))):
    # Print safe ascii repr so Windows console does not throw charmap error
    print(f"  [{i}] text={lines[i]['text']!r}, score={lines[i]['score']}")
