import json

with open('scratch/page21_ocr.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

lines = data.get('lines', [])
print(f"Total lines: {len(lines)}")
for idx, line in enumerate(lines):
    if line.get('_sourceIndex') in [8, 9, 10]:
        print(f"Index: {idx} | _sourceIndex: {line.get('_sourceIndex')} | Text: {repr(line.get('text'))}")
        print(f"  BBox: {line.get('bbox')}")
        print(f"  Words:")
        for w in line.get('words', []):
            print(f"    - {repr(w.get('text'))} bbox: {w.get('bbox')}")
        print("-" * 40)
