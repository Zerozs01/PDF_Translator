import os
import sqlite3
import json

db_path = os.path.expandvars(r'%APPDATA%\pdf_translator\pdf_translator.db')
output_path = r'c:\App\Electron\PDF_Translator\scratch\db_queries\query_all_docs_result.json'

result = {}

try:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # 1. ดึงข้อมูล Documents ทั้งหมด
    cursor.execute('SELECT id, filename, filepath, total_pages FROM documents')
    docs = [dict(row) for row in cursor.fetchall()]
    result['documents'] = docs

    # 2. นับ OCR Cache ต่อ Document
    cursor.execute('SELECT document_id, COUNT(*) as count FROM ocr_cache_engine GROUP BY document_id')
    ocr_counts = [dict(row) for row in cursor.fetchall()]
    result['ocr_counts'] = ocr_counts

    # 3. นับ Translation Cache ต่อ Document
    cursor.execute('SELECT document_id, COUNT(*) as count FROM translation_cache GROUP BY document_id')
    trans_counts = [dict(row) for row in cursor.fetchall()]
    result['translation_counts'] = trans_counts

    conn.close()
except Exception as err:
    result['error'] = str(err)

with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print('Done writing results to:', output_path)
