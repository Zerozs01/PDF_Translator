import os
import sqlite3
import re

db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
print("Connecting to SQLite database for Deep Cleanup:", db_path)

if not os.path.exists(db_path):
    print("Database file does not exist!")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    # 1. ลบแคช OCR ทั้งเก่าและใหม่ทั้งหมด เพื่อให้ PaddleOCR คำนวณขอบเขตคำด้วย thresholds ใหม่ทุกหน้า
    cursor.execute("DELETE FROM ocr_cache")
    deleted_legacy_ocr = cursor.rowcount
    print(f"Deleted {deleted_legacy_ocr} legacy OCR cache entries (ocr_cache).")

    cursor.execute("DELETE FROM ocr_cache_engine")
    deleted_engine_ocr = cursor.rowcount
    print(f"Deleted {deleted_engine_ocr} engine OCR cache entries (ocr_cache_engine).")

    # 2. ลบแคชการแปลระดับหน้า (translation_cache) ทั้งหมด เพื่อบังคับแปลใหม่ทุกหน้าทุกไฟล์
    cursor.execute("DELETE FROM translation_cache")
    deleted_translation_pages = cursor.rowcount
    print(f"Deleted {deleted_translation_pages} page-level translation cache entries (translation_cache).")

    # 3. ลบแคชระดับประโยค (sentence_translation_cache) ที่เป็นคำแปลขยะ
    cursor.execute("""
        DELETE FROM sentence_translation_cache
        WHERE translated_text LIKE '%เกี่ยวกับเรา%'
           OR translated_text LIKE '%ปรับเทียบสี%'
           OR translated_text LIKE '%กับเรา%'
           OR translated_text LIKE '%สังเกต%'
    """)
    deleted_garbage_sentences = cursor.rowcount
    print(f"Deleted {deleted_garbage_sentences} garbage sentence translation entries.")

    # 4. ดึงข้อมูลใน sentence_translation_cache ทั้งหมดมาตรวจสอบตัวอักษรเกาหลี (Hangul) ด้วย Python REGEX และลบออก
    cursor.execute("SELECT source_text, source_language, target_language, translator_engine, translation_mode FROM sentence_translation_cache")
    rows = cursor.fetchall()
    
    korean_pattern = re.compile(r'[\uac00-\ud7af]')
    deleted_korean_sentences = 0
    
    for row in rows:
        source_text = row[0]
        if korean_pattern.search(source_text):
            cursor.execute("""
                DELETE FROM sentence_translation_cache
                WHERE source_text = ? AND source_language = ? AND target_language = ? AND translator_engine = ? AND translation_mode = ?
            """, row)
            deleted_korean_sentences += cursor.rowcount
            
    print(f"Deleted {deleted_korean_sentences} Korean sentence translation entries via regex filter.")

    conn.commit()
    print("Deep Database cleanup successfully completed.")
except Exception as e:
    conn.rollback()
    print("Error during database transaction:", e)
finally:
    conn.close()
