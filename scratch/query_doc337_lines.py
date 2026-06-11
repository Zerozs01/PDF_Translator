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

pages_to_query = [7, 9, 10, 11]

for page_num in pages_to_query:
    print(f"=== Doc 337 Page {page_num} ===")
    cur.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 337 AND page_number = ? AND ocr_engine = 'paddleocr'", (page_num,))
    row = cur.fetchone()
    if row:
        data = json.loads(row[0])
        print("  Kept lines:")
        for idx, line in enumerate(data.get('lines', [])):
            print(f"    Line {idx}: {repr(line.get('text'))}")
        dropped = data.get('debug', {}).get('droppedWords', [])
        if dropped:
            print("  Dropped words:")
            for d in dropped:
                print(f"    * Text: {repr(d.get('text'))} | Reason: {d.get('reason')} | Filter: {d.get('filter')}")
    else:
        print("  No cache row found.")
    print()

conn.close()
