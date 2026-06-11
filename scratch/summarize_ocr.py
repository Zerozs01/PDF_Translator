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
    print(f"=== Doc 44 Page 2 {engine} data ===")
    cur.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 44 AND page_number = 2 AND ocr_engine = ?", (engine,))
    row = cur.fetchone()
    if row:
        data = json.loads(row[0])
        lines = data.get('lines', [])
        print(f"Total lines: {len(lines)}")
        for idx, line in enumerate(lines):
            text = line.get('text')
            bbox = line.get('bbox')
            print(f"L{idx:02d}: {repr(text)} at ({int(bbox['x0'])}, {int(bbox['y0'])}) -> ({int(bbox['x1'])}, {int(bbox['y1'])})")
    else:
        print("No cache row found for", engine)
    print()

conn.close()
