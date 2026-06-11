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

lines_to_search = [
    "I WOuLD BE",
    "GETTING 4O% OF",
    "GETTING 40% OF",
    "THE PROFITS HAD",
    "I SOLD it.",
    "I would be getting 40% of the profits had i sold it."
]

print("=== sentence_translation_cache ===")
for line in lines_to_search:
    cur.execute("""
        SELECT source_text, translated_text, target_language 
        FROM sentence_translation_cache 
        WHERE source_text LIKE ?
    """, (f"%{line}%",))
    print(f"Searching for: {repr(line)}")
    for row in cur.fetchall():
        print(f"  SRC: {repr(row[0])} -> TGT: {repr(row[1])} (LANG: {row[2]})")

conn.close()
