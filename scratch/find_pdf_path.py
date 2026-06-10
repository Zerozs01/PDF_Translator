import os
import sqlite3
import sys

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT id, filepath, filename FROM documents")
for r in cursor.fetchall():
    print(f"ID={r[0]}, Path={r[1]}, Name={r[2]}")

conn.close()
