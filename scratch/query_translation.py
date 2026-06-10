import sqlite3
import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

cur.execute("""
    SELECT translation_mode, translator_engine, translated_by_index 
    FROM translation_cache 
    WHERE document_id = 110 AND page_number = 3
""")
rows = cur.fetchall()
for r in rows:
    print("Mode:", r[0], "Engine:", r[1])
    translated_list = json.loads(r[2])
    print(f"Total translated items: {len(translated_list)}")
    for item in translated_list:
        print(f"  Index: {item.get('index')} -> {repr(item.get('text'))}")

conn.close()
