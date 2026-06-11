import sqlite3
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

print("Deleting OCR cache for Doc 44 Page 2...")
cur.execute("DELETE FROM ocr_cache_engine WHERE document_id = 44 AND page_number = 2")
deleted_ocr = cur.rowcount
print(f"Deleted {deleted_ocr} rows from ocr_cache_engine.")

print("Deleting Translation cache for Doc 44 Page 2...")
cur.execute("DELETE FROM translation_cache WHERE document_id = 44 AND page_number = 2")
deleted_trans = cur.rowcount
print(f"Deleted {deleted_trans} rows from translation_cache.")

conn.commit()
conn.close()
print("Database caches cleared successfully.")
