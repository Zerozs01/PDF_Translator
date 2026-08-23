import sqlite3
import os
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')
db_path = os.path.join(os.environ['APPDATA'], 'pdf_translator', 'pdf_translator.db')
if not os.path.exists(db_path):
    print(f"DB not found at: {db_path}")
    possible_paths = [
        os.path.join(os.environ['LOCALAPPDATA'], 'pdf_translator', 'pdf_translator.db'),
        os.path.join(os.path.expanduser('~'), '.pdf_translator', 'pdf_translator.db'),
    ]
    for p in possible_paths:
        if os.path.exists(p):
            db_path = p
            print(f"Found DB at: {db_path}")
            break

if os.path.exists(db_path):
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    
    cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cur.fetchall()
    print(f"Tables: {tables}")
    
    search_terms = ["just", "illness", "method", "blowjob", "nurse", "suddenly", "feels"]
    
    cur.execute("SELECT document_id, page_number, ocr_engine, ocr_data, algorithm_version FROM ocr_cache_engine")
    rows = cur.fetchall()
    print(f"Total cached rows: {len(rows)}")
    
    for doc_id, page_num, engine, ocr_data_json, alg_ver in rows:
        try:
            data = json.loads(ocr_data_json)
            lines = data.get('lines', [])
            for line in lines:
                txt = line.get('text', '')
                if any(term in txt.lower() for term in search_terms):
                    print(f"[FOUND Kept] Doc {doc_id} Page {page_num} ({engine}) AlgVer {alg_ver}: {txt}")
            
            # ตรวจสอบ debug keys
            debug_info = data.get('debug', {})
            dropped = debug_info.get('droppedLines', []) or debug_info.get('droppedWords', [])
            for d in dropped:
                txt = d.get('text', '') if isinstance(d, dict) else str(d)
                if any(term in txt.lower() for term in search_terms):
                    reason = d.get('reason') if isinstance(d, dict) else 'unknown'
                    filter_name = d.get('filter') if isinstance(d, dict) else 'unknown'
                    print(f"[FOUND Dropped] Doc {doc_id} Page {page_num} ({engine}) AlgVer {alg_ver}: {txt} | Reason: {reason} | Filter: {filter_name}")
        except Exception as e:
            pass
    conn.close()
else:
    print("Database file could not be found.")
