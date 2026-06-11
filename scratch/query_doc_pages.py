import sqlite3
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
if not os.path.exists(db_path):
    print("No database found.")
    sys.exit(0)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("SELECT id, filepath, filename, total_pages FROM documents WHERE id = 44")
doc = cur.fetchone()
if doc:
    print(f"Document ID: {doc[0]}\nPath: {doc[1]}\nName: {doc[2]}\nTotal Pages: {doc[3]}\n")
else:
    print("Document 44 not found.")

cur.execute("SELECT DISTINCT page_number FROM ocr_cache_engine WHERE document_id = 44 ORDER BY page_number")
pages = cur.fetchall()
print("Pages with OCR cache in ocr_cache_engine:", [p[0] for p in pages])

cur.execute("SELECT DISTINCT page_number FROM ocr_cache WHERE document_id = 44 ORDER BY page_number")
pages_old = cur.fetchall()
print("Pages with OCR cache in ocr_cache (old table):", [p[0] for p in pages_old])

conn.close()
