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

search_words = ["giant", "pussy", "field", "cum", "s-sto", "shame", "two", "seems", "other", "you all!!", "do this"]

print("Searching ocr_cache_engine for keywords...")
cur.execute("SELECT document_id, page_number, ocr_engine, ocr_data FROM ocr_cache_engine")
rows = cur.fetchall()

found = False
for doc_id, page_num, engine, ocr_data_json in rows:
    try:
        data = json.loads(ocr_data_json)
        # Check kept lines
        matching_kept = []
        for line in data.get('lines', []):
            txt = line.get('text', '')
            if any(w in txt.lower() for w in search_words):
                matching_kept.append(txt)
                
        # Check dropped words
        dropped = data.get('debug', {}).get('droppedWords', [])
        matching_dropped = []
        for d in dropped:
            txt = d.get('text', '')
            if any(w in txt.lower() for w in search_words):
                matching_dropped.append(d)
                
        if matching_kept or matching_dropped:
            found = True
            print(f"=== Doc {doc_id} Page {page_num} ({engine}) ===")
            if matching_kept:
                print(f"  Kept matching: {matching_kept}")
            if matching_dropped:
                print(f"  Dropped matching:")
                for d in matching_dropped:
                    print(f"    * Text: {repr(d.get('text'))} | Reason: {d.get('reason')} | Filter: {d.get('filter')}")
    except Exception as e:
        print(f"Error reading doc {doc_id} page {page_num}: {e}")

if not found:
    print("No matching OCR entries found in the database.")

conn.close()
