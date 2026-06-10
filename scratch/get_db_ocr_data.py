import os
import sqlite3
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT ocr_data FROM ocr_cache_engine WHERE document_id = 44 AND page_number = 2 AND ocr_engine = 'paddleocr'")
row = cursor.fetchone()
if row:
    ocr_data = json.loads(row[0])
    print("=== Cache Metadata ===")
    print("Language:", ocr_data.get("language"))
    print("Engine:", ocr_data.get("ocrEngine"))
    print("Pipeline Profile:", ocr_data.get("pipelineProfile"))
    print("Quality Profile:", ocr_data.get("ocrQualityProfile"))
    if "debug" in ocr_data:
        print("\n=== Debug Info ===")
        debug = ocr_data["debug"]
        for k, v in debug.items():
            if k != "droppedWords":
                print(f"  {k}: {v}")
            else:
                print(f"  droppedWords count: {len(v)}")
                for dw in v:
                    print(f"    - Text: {repr(dw.get('text'))} | Reason: {dw.get('reason')} | Filter: {dw.get('filter')} | Confidence: {dw.get('confidence')}")
else:
    print("No cache found")

conn.close()
