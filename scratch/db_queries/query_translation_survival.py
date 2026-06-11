import sqlite3
import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()

print("=== Checking sentence_translation_cache ===")
cur.execute("""
    SELECT source_text, translated_text, translator_engine 
    FROM sentence_translation_cache 
    WHERE source_text LIKE '%would be%' OR source_text LIKE '%getting%' OR source_text LIKE '%profit%'
""")
rows = cur.fetchall()
for r in rows:
    print(f"Source: {repr(r[0])}")
    print(f"  Translation: {repr(r[1])} | Engine: {r[2]}")
    print()

print("\n=== Checking translation_cache for Doc 44 Page 2 ===")
cur.execute("""
    SELECT translation_mode, translator_engine, translated_by_index 
    FROM translation_cache 
    WHERE document_id = 44 AND page_number = 2
""")
rows = cur.fetchall()
for r in rows:
    print("Mode:", r[0], "Engine:", r[1])
    translated_list = json.loads(r[2])
    print(f"Total translated items: {len(translated_list)}")
    for item in translated_list:
        print(f"  Index: {item.get('index')} -> {repr(item.get('text'))}")

conn.close()
