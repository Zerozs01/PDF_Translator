import sqlite3
import os
import sys
import json

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
if not os.path.exists(db_path):
    print("No database found.")
    sys.exit(0)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

print("=== Doc 250 Page 2 easyocr data ===")
cur.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 250 AND page_number = 2 AND ocr_engine = 'easyocr'")
row = cur.fetchone()
if row:
    data = json.loads(row[0])
    for line in data.get('lines', []):
        print(f"Text: {line.get('text')}, BBox: {line.get('bbox')}")

print("\n=== Doc 250 Page 2 paddleocr data ===")
cur.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 250 AND page_number = 2 AND ocr_engine = 'paddleocr'")
row = cur.fetchone()
if row:
    data = json.loads(row[0])
    for line in data.get('lines', []):
        print(f"Text: {line.get('text')}, BBox: {line.get('bbox')}")
    # Print debug info if exists
    if 'debug' in data:
        print("Debug info:", data['debug'])

conn.close()
