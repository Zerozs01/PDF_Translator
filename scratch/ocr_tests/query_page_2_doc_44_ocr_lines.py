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

cur.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 44 AND page_number = 2 AND ocr_engine = 'paddleocr'")
row = cur.fetchone()
if row:
    data = json.loads(row[0])
    for idx, line in enumerate(data.get('lines', [])):
        if idx <= 35:
            text = line.get('text')
            print(f"Line {idx}: {repr(text)}")
            print(f"  BBox: {line.get('bbox')}")
else:
    print("No cache row found for paddleocr")

conn.close()
