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

cur.execute("SELECT page_number, ocr_engine, ocr_data FROM ocr_cache_engine WHERE document_id = 44 ORDER BY page_number")
rows = cur.fetchall()

print(f"Found {len(rows)} cache entries for doc 44.")

for page_number, ocr_engine, ocr_data_json in rows:
    try:
        data = json.loads(ocr_data_json)
        dropped = data.get('debug', {}).get('droppedWords', [])
        kept_count = len(data.get('lines', []))
        
        # We also check if the text matches any of the query words
        query_words = ["giant", "pussy", "field", "cum", "s-sto", "shame", "two", "ah", "seems", "other", "all!!"]
        matching_kept = []
        for line in data.get('lines', []):
            txt = line.get('text', '')
            if any(q in txt.lower() for q in query_words):
                matching_kept.append(txt)
                
        print(f"--- Page {page_number} ({ocr_engine}) ---")
        print(f"  Kept lines count: {kept_count}")
        if matching_kept:
            print(f"  Matching kept lines: {matching_kept}")
        if dropped:
            print(f"  Dropped words count: {len(dropped)}")
            for d in dropped:
                txt = d.get('text', '')
                reason = d.get('reason', '')
                filter_name = d.get('filter', '')
                print(f"    * Text: {repr(txt)} | Reason: {reason} | Filter: {filter_name} | BBox: {d.get('bbox')}")
        else:
            print("  No dropped words.")
    except Exception as e:
        print(f"Error parsing page {page_number}: {e}")

conn.close()
