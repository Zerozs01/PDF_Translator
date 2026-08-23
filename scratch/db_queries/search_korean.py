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

search_words = ["남편이랑", "마리코", "안갔지", "코토미"]

print("Searching database...")

# 1. Search in documents
cur.execute("SELECT id, filename FROM documents")
docs = cur.fetchall()
for doc_id, filename in docs:
    if any(w in filename for w in search_words):
        print(f"Document match: ID {doc_id} -> {filename}")

# 2. Search in ocr_cache_engine
cur.execute("SELECT document_id, page_number, ocr_engine, ocr_data FROM ocr_cache_engine")
rows = cur.fetchall()
for doc_id, page_num, engine, ocr_data_json in rows:
    if any(w in ocr_data_json for w in search_words):
        print(f"OCR Match in Doc {doc_id} Page {page_num} ({engine})")
        # Try to parse it and print lines
        try:
            data = json.loads(ocr_data_json)
            for line in data.get('lines', []):
                txt = line.get('text', '')
                if any(w in txt for w in search_words):
                    print(f"  Line: {txt} @ box {line.get('box')}")
        except Exception as e:
            print(f"  Error parsing json: {e}")

# 3. Search in translation_cache
cur.execute("SELECT document_id, page_number, translator_engine, translated_text, translated_by_index FROM translation_cache")
trans_rows = cur.fetchall()
for doc_id, page_num, trans_engine, trans_text, trans_by_idx in trans_rows:
    if any(w in trans_text or w in trans_by_idx for w in search_words):
        print(f"Translation Match in Doc {doc_id} Page {page_num} ({trans_engine})")
        print(f"  Text excerpt: {trans_text[:200]}")

conn.close()
