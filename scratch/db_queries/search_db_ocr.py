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

print("Searching database for 'fitting' or 'being'...")
cur.execute("SELECT document_id, page_number, ocr_engine, ocr_data FROM ocr_cache_engine")
rows = cur.fetchall()

found = False
for doc_id, page_num, engine, ocr_data_json in rows:
    data = json.loads(ocr_data_json)
    for line in data.get('lines', []):
        text = line.get('text', '')
        if 'fitting' in text.lower() or 'being' in text.lower():
            print(f"Match found in Doc {doc_id}, Page {page_num}, Engine {engine}:")
            print(f"Line Text: {text}")
            print(f"Line BBox: {line.get('bbox')}")
            print(f"Words: {line.get('words')}")
            found = True
            print("-" * 50)

if not found:
    print("No matching lines found in ocr_cache_engine.")

conn.close()
