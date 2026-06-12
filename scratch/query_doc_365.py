import sqlite3
import json
import os

db_path = r"C:\Users\auand\AppData\Roaming\pdf_translator\pdf_translator.db"

if not os.path.exists(db_path):
    print("Database file not found!")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

print("Querying Document 365 cache...")

# ดึงข้อมูลการแปลหน้า 1 ของเอกสาร 365
cursor.execute("""
    SELECT page_number, cache_key, ocr_engine, ocr_language, 
           source_language, target_language, translator_engine, translation_mode, 
           translated_by_index, translated_text
    FROM translation_cache 
    WHERE document_id = 365
""")
rows = cursor.fetchall()

print(f"Found {len(rows)} translation cache rows:")
for row in rows:
    page_number, cache_key, ocr_engine, ocr_language, source_language, target_language, translator_engine, translation_mode, translated_by_index_str, translated_text = row
    print(f"Page Number: {page_number}")
    print(f"Cache Key: {cache_key}")
    print("Translation Info:")
    print(f"  OCR Engine: {ocr_engine}")
    print(f"  OCR Language: {ocr_language}")
    print(f"  Source Language: {source_language}")
    print(f"  Target Language: {target_language}")
    print(f"  Translator Engine: {translator_engine}")
    print(f"  Translation Mode: {translation_mode}")
    print(f"  First 3 translations:")
    try:
        translated_by_index = json.loads(translated_by_index_str)
        for item in translated_by_index[:3]:
            print(f"    Line {item.get('index')}: '{item.get('sourceText')}' -> '{item.get('text')}'")
    except Exception as e:
        print(f"    Failed to parse translated_by_index JSON: {e}")
    print("-" * 60)

# ดึงข้อมูล OCR หน้า 1
cursor.execute("SELECT page_number, ocr_engine, ocr_data FROM ocr_cache_engine WHERE document_id = 365")
ocr_rows = cursor.fetchall()
print(f"Found {len(ocr_rows)} OCR cache rows in ocr_cache_engine:")
for page_number, ocr_engine, ocr_data_str in ocr_rows:
    print(f"Page Number: {page_number}")
    print(f"Engine: {ocr_engine}")
    try:
        payload = json.loads(ocr_data_str)
        print(f"  Lines Count: {len(payload.get('lines', []))}")
        print(f"  Language: {payload.get('language')}")
        print(f"  First 3 lines:")
        for line in payload.get('lines', [])[:3]:
            print(f"    '{line.get('text')}'")
    except Exception as e:
        print(f"  Failed to parse OCR JSON: {e}")
    print("-" * 60)

conn.close()
