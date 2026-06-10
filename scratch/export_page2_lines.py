import sqlite3
import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
if not os.path.exists(db_path):
    print("No database found.")
    sys.exit(1)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 44 AND page_number = 2 AND ocr_engine = 'paddleocr'")
row = cur.fetchone()
if row:
    with open('scratch/page2_ocr.json', 'w', encoding='utf-8') as f:
        f.write(row[0])
    print("Exported to scratch/page2_ocr.json successfully")
else:
    print("No cache row found for paddleocr")

conn.close()
