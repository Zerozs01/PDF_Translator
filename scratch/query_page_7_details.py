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

cur.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 337 AND page_number = 7 AND ocr_engine = 'paddleocr'")
row = cur.fetchone()
if row:
    data = json.loads(row[0])
    kept = data.get('lines', [])
    dropped = data.get('debug', {}).get('droppedWords', [])
    
    print("=== ALL PADDLEOCR LINES ON PAGE 7 ===")
    all_lines = []
    for line in kept:
        all_lines.append(("KEPT", line))
    for d in dropped:
        # dropped words in debug is formatted slightly differently, let's normalize
        all_lines.append(("DROPPED", d))
        
    for status, line in all_lines:
        text = line.get('text')
        bbox = line.get('bbox')
        conf = line.get('confidence')
        reason = line.get('reason', '')
        print(f"[{status}] {repr(text)}")
        print(f"  BBox: {bbox}")
        print(f"  Conf: {conf} | Reason: {reason}")
else:
    print("Page 7 cache row not found.")

conn.close()
