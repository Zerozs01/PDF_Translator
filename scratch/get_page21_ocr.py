import os
import sqlite3
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 337 AND page_number = 21 AND ocr_engine = 'paddleocr'")
row = cursor.fetchone()
if row:
    ocr_data = json.loads(row[0])
    with open('scratch/page21_ocr.json', 'w', encoding='utf-8') as f:
        json.dump(ocr_data, f, ensure_ascii=False, indent=2)
    print("Successfully wrote scratch/page21_ocr.json")
else:
    print("No cache found for Doc 337 Page 21 PaddleOCR")

conn.close()
