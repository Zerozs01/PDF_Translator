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

for engine in ['paddleocr']:
    print(f"=== Doc 44 Page 4 {engine} data ===")
    cur.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 44 AND page_number = 4 AND ocr_engine = ?", (engine,))
    row = cur.fetchone()
    if row:
        data = json.loads(row[0])
        for idx, line in enumerate(data.get('lines', [])):
            text = line.get('text')
            print(f"Line {idx}: {repr(text)}")
            print(f"  BBox: {line.get('bbox')}")
        if 'debug' in data:
            print("Debug info:", json.dumps(data['debug'], indent=2, ensure_ascii=False))
    else:
        print("No cache row found for", engine)

conn.close()
