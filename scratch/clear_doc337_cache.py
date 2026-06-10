import sqlite3
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

# ล้างแคชหน้า 1 ถึง 50 ของ Doc 337 เพื่อให้ครอบคลุมทุกหน้าที่มีปัญหาและบังคับให้สแกน/แปลใหม่ทั้งหมด
pages = list(range(1, 51))

for page in pages:
    cur.execute("DELETE FROM ocr_cache_engine WHERE document_id = 337 AND page_number = ?", (page,))
    cur.execute("DELETE FROM ocr_cache WHERE document_id = 337 AND page_number = ?", (page,))
    cur.execute("DELETE FROM translation_cache WHERE document_id = 337 AND page_number = ?", (page,))

conn.commit()
conn.close()
print("All caches for Doc 337 (Pages 1-50) cleared successfully.")
