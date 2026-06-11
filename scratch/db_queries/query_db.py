import os
import sqlite3
import json

db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
output_path = os.path.join(os.path.dirname(__file__), 'query_output.txt')

print("Connecting to DB:", db_path)
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

with open(output_path, 'w', encoding='utf-8') as f:
    f.write("=== Reading Sentence Translation Cache ===\n")
    cursor.execute("""
        SELECT source_text, source_language, target_language, translator_engine, translated_text
        FROM sentence_translation_cache
        WHERE translated_text LIKE '%เกี่ยวกับเรา%' OR translated_text LIKE '%ปรับเทียบสี%' OR translated_text LIKE '%กับเรา%' OR translated_text LIKE '%สังเกต%'
    """)
    rows = cursor.fetchall()
    print(f"Found {len(rows)} matching entries in sentence_translation_cache:")
    for row in rows:
        line = f"Source: {repr(row[0])} | Lang: {row[1]}->{row[2]} | Engine: {row[3]} | Translation: {repr(row[4])}\n"
        f.write(line)

conn.close()
print("Query complete.")

