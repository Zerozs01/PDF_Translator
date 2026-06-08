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

print("=== ocr_cache_engine count ===")
cur.execute("SELECT ocr_engine, count(*) FROM ocr_cache_engine GROUP BY ocr_engine")
print(cur.fetchall())

print("=== sample from ocr_cache_engine ===")
cur.execute("SELECT document_id, page_number, ocr_engine, ocr_data FROM ocr_cache_engine LIMIT 5")
rows = cur.fetchall()
for row in rows:
    doc_id, page_num, engine, data_str = row
    data = json.loads(data_str)
    # Print some text snippets
    lines = data.get('lines', [])
    texts = [line.get('text', '') for line in lines[:5]]
    print(f"Doc: {doc_id}, Page: {page_num}, Engine: {engine}, Text: {texts}")

conn.close()
