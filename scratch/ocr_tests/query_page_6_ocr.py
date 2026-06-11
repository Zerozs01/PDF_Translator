import sqlite3
import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
if not os.path.exists(db_path):
    print("No database found.")
    sys.exit(0)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

for engine in ['paddleocr', 'easyocr']:
    print(f"=== Doc 31 Page 6 {engine} data ===")
    cur.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 31 AND page_number = 6 AND ocr_engine = ?", (engine,))
    row = cur.fetchone()
    if row:
        data = json.loads(row[0])
        for idx, line in enumerate(data.get('lines', [])):
            text = line.get('text')
            if 'link' in text.lower() or 'rod' in text.lower() or 'in (' in text.lower():
                print(f"Line {idx}: {repr(text)}")
                print(f"  BBox: {line.get('bbox')}")
                if 'words' in line:
                    print("  Words:")
                    for w in line['words']:
                        print(f"    - {repr(w.get('text'))} bbox: {w.get('bbox')}")
        if 'debug' in data:
            print("Debug info:", json.dumps(data['debug'], ensure_ascii=True))
    else:
        print("No cache row found for", engine)
    print()

conn.close()
