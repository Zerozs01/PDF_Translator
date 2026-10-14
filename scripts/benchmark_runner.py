"""ADR-0009 Benchmark Helper & Database Cache Cleaner

Usage:
  python scripts/benchmark_runner.py --doc-id 515 --mode warm
  python scripts/benchmark_runner.py --doc-id 515 --mode cold
  python scripts/benchmark_runner.py --status
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

DB_PATH = Path(os.path.expandvars(r"%APPDATA%\com.pdftranslator.app\pdf_translator.db"))
BACKUP_PATH = Path(os.path.expandvars(r"%APPDATA%\com.pdftranslator.app\pdf_translator_backup_adr0009.db"))


def get_connection() -> sqlite3.Connection:
    if not DB_PATH.exists():
        print(f"[ERROR] Database not found at: {DB_PATH}", file=sys.stderr)
        sys.exit(1)
    return sqlite3.connect(DB_PATH)


def ensure_backup() -> None:
    if not BACKUP_PATH.exists():
        print(f"[Backup] Creating safety backup of database to: {BACKUP_PATH}")
        shutil.copy2(DB_PATH, BACKUP_PATH)
    else:
        print(f"[Backup] Safety backup already exists at: {BACKUP_PATH}")


def print_status(doc_id: int | None = None) -> None:
    conn = get_connection()
    try:
        c = conn.cursor()
        print("=" * 60)
        print("  ADR-0009 Benchmark Corpus & Cache Status")
        print("=" * 60)
        print(f"Database: {DB_PATH}")

        total_sentence_cache = c.execute("SELECT count(*) FROM sentence_translation_cache").fetchone()[0]
        total_trans_cache = c.execute("SELECT count(*) FROM translation_cache").fetchone()[0]
        total_ocr_cache = c.execute("SELECT count(*) FROM ocr_cache_engine").fetchone()[0]

        print(f"Global sentence_translation_cache: {total_sentence_cache} rows")
        print(f"Global translation_cache:          {total_trans_cache} rows")
        print(f"Global ocr_cache_engine:            {total_ocr_cache} rows")

        if doc_id:
            doc = c.execute("SELECT id, filename, total_pages FROM documents WHERE id=?", (doc_id,)).fetchone()
            if doc:
                print(f"\nDocument [{doc[0]}]: '{doc[1]}' ({doc[2]} pages)")
                d_ocr = c.execute("SELECT count(*) FROM ocr_cache_engine WHERE document_id=?", (doc_id,)).fetchone()[0]
                d_trans = c.execute("SELECT count(*) FROM translation_cache WHERE document_id=?", (doc_id,)).fetchone()[0]
                print(f" - Cached OCR pages:         {d_ocr} / {doc[2]}")
                print(f" - Cached Translation pages: {d_trans} / {doc[2]}")
            else:
                print(f"\n[Warning] Document ID {doc_id} not found in database.")
    finally:
        conn.close()


def prepare_benchmark(doc_id: int, mode: str) -> None:
    ensure_backup()
    conn = get_connection()
    try:
        c = conn.cursor()

        print("\n" + "=" * 60)
        if mode == "warm":
            print(f"  Preparing Mode: OCR Warm + แปล Cold (Doc ID: {doc_id})")
            print("=" * 60)
            c.execute("DELETE FROM translation_cache WHERE document_id = ?", (doc_id,))
            del_trans = c.rowcount
            c.execute("DELETE FROM sentence_translation_cache")
            del_sent = c.rowcount
            conn.commit()
            print(f"[Cache Cleaned] Deleted {del_trans} rows from translation_cache (doc {doc_id})")
            print(f"[Cache Cleaned] Deleted {del_sent} rows from sentence_translation_cache (all)")
            print("[Status] OCR Cache kept intact for Warm OCR.")

        elif mode == "cold":
            print(f"  Preparing Mode: OCR Cold + แปล Cold (Doc ID: {doc_id})")
            print("=" * 60)
            c.execute("DELETE FROM translation_cache WHERE document_id = ?", (doc_id,))
            del_trans = c.rowcount
            c.execute("DELETE FROM sentence_translation_cache")
            del_sent = c.rowcount
            c.execute("DELETE FROM ocr_cache WHERE document_id = ?", (doc_id,))
            del_ocr = c.rowcount
            c.execute("DELETE FROM ocr_cache_engine WHERE document_id = ?", (doc_id,))
            del_ocr_eng = c.rowcount
            conn.commit()
            print(f"[Cache Cleaned] Deleted {del_trans} rows from translation_cache (doc {doc_id})")
            print(f"[Cache Cleaned] Deleted {del_sent} rows from sentence_translation_cache (all)")
            print(f"[Cache Cleaned] Deleted {del_ocr} rows from ocr_cache (doc {doc_id})")
            print(f"[Cache Cleaned] Deleted {del_ocr_eng} rows from ocr_cache_engine (doc {doc_id})")
            print("[Status] Both OCR & Translation caches fully cleared for Cold Run.")
    finally:
        conn.close()

    print("\n>>> NEXT STEP IN APP:")
    print("1. In browser/webview Console (F12), ensure profiling flag is set:")
    print("   localStorage.setItem('pdf_translator_argos_profile', '1');")
    print(f"2. Select Document {doc_id} in the app UI.")
    print("3. Click 'Offline All Pages' to run the benchmark.")
    print("4. When complete, copy the output of window.__LAST_ARGOS_BENCHMARK_REPORT__")


def main() -> None:
    parser = argparse.ArgumentParser(description="ADR-0009 Benchmark Protocol Runner")
    parser.add_argument("--doc-id", type=int, default=515, help="Document ID for Corpus (Default: 515, 36 pages)")
    parser.add_argument("--mode", choices=["warm", "cold"], help="Benchmark mode: 'warm' (OCR Warm + Trans Cold) or 'cold' (OCR Cold + Trans Cold)")
    parser.add_argument("--status", action="store_true", help="Print current database cache status")

    args = parser.parse_args()

    if args.status or not args.mode:
        print_status(args.doc_id)
        if not args.mode:
            print("\nTip: Specify --mode warm or --mode cold to prepare database for benchmark.")
        return

    prepare_benchmark(args.doc_id, args.mode)


if __name__ == "__main__":
    main()
