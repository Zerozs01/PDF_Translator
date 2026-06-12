import os
import sqlite3
import json

db_path = os.path.expandvars(r'%APPDATA%\pdf_translator\pdf_translator.db')
output_path = r'c:\App\Electron\PDF_Translator\scratch\db_queries\query_translations_result.json'

result = {}

try:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # 1. ดึงข้อมูลเอกสารล่าสุด
    cursor.execute('SELECT id, filename, filepath FROM documents ORDER BY last_accessed DESC LIMIT 1')
    latest_doc = cursor.fetchone()
    if latest_doc:
        result['latest_document'] = dict(latest_doc)
        doc_id = latest_doc['id']

        # 2. ตรวจสอบ OCR Cache
        cursor.execute('SELECT page_number, ocr_engine, length(ocr_data) as len FROM ocr_cache_engine WHERE document_id = ? ORDER BY page_number', (doc_id,))
        result['ocr_cache'] = [dict(row) for row in cursor.fetchall()]

        # 3. ตรวจสอบ Translation Cache
        cursor.execute('''
            SELECT page_number, cache_key, translator_engine, line_count, group_count, length(translated_text) as len, translated_text
            FROM translation_cache 
            WHERE document_id = ? 
            ORDER BY page_number
        ''', (doc_id,))
        result['translation_cache'] = [dict(row) for row in cursor.fetchall()]
    else:
        result['error'] = 'No documents found'

    conn.close()
except Exception as err:
    result['error'] = str(err)

with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print('Done writing results to:', output_path)
