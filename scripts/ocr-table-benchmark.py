#!/usr/bin/env python3
"""
ocr-table-benchmark.py
----------------------
รัน OCR เปรียบเทียบหลาย engine บน fixture images แล้วสรุปออกเป็นตาราง
ไม่ต้องผ่าน Playwright / Electron / browser เลย

Usage:
  python scripts/ocr-table-benchmark.py
  python scripts/ocr-table-benchmark.py --engines tesseract paddleocr easyocr
  python scripts/ocr-table-benchmark.py --out results.md --images public/fixtures/ocr/manga/manga1.png
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
BRIDGE_SCRIPT = SCRIPT_DIR / "external_ocr_bridge.py"
DEFAULT_IMAGES = [
    REPO_ROOT / "public/fixtures/ocr/manga/manga1.png",
    REPO_ROOT / "public/fixtures/ocr/manga/manga2.png",
    REPO_ROOT / "public/fixtures/ocr/manga/manga3.png",
]


# ─── Tesseract via pytesseract ────────────────────────────────────────────────

def run_tesseract(image_path: Path, language: str = "eng") -> dict[str, Any]:
    cmd = [
        "node", str(SCRIPT_DIR / "ocr-tesseract-helper.js"),
        str(image_path), language
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=60)
        if proc.returncode != 0:
            err = proc.stderr.strip() or proc.stdout.strip()
            return {"ok": False, "error": f"node error: {err[:200]}"}
        result = json.loads(proc.stdout.strip())
        return result
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ─── PaddleOCR / EasyOCR via external_ocr_bridge.py ─────────────────────────

def run_bridge(engine: str, image_path: Path, language: str = "eng") -> dict[str, Any]:
    from PIL import Image
    img = Image.open(image_path)
    w, h = img.size
    cmd = [
        sys.executable, str(BRIDGE_SCRIPT),
        "--action", "ocr",
        "--engine", engine,
        "--image", str(image_path),
        "--language", language,
        "--width", str(w),
        "--height", str(h),
        "--dpi", "300",
        "--pipeline-profile", "panel",
        "--quality-profile", "best",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=300)
        if proc.returncode != 0:
            err = proc.stderr.strip() or proc.stdout.strip()
            return {"ok": False, "error": f"exit {proc.returncode}: {err[:200]}"}
        result = json.loads(proc.stdout.strip())
        if not result.get("ok"):
            return {"ok": False, "error": result.get("reason", "bridge returned ok=false")}

        lines = result.get("lines", [])
        words = [w for line in lines for w in line.get("words", [])]
        confs = [float(w.get("confidence", 0)) for w in words if w.get("confidence")]
        avg_conf = sum(confs) / len(confs) if confs else 0.0
        texts = [str(w.get("text", "")) for w in words if str(w.get("text", "")).strip()]
        return {
            "ok": True,
            "lines": len(lines),
            "words": texts,
            "confidence": avg_conf,
            "text": " ".join(texts),
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout (>300s)"}
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"JSON parse error: {exc}"}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


# ─── Scoring (เลียนแบบ ocr-regression-report.js) ─────────────────────────────

SHORT_KEEP = {"i","a","go","to","do","in","on","of","if","is","be","we","us","my","or","an","at","as","am","up","it"}

def count_meaningful(words: list[str]) -> int:
    import re
    count = 0
    for w in words:
        tok = re.sub(r"[^\w]", "", w.lower())
        if not tok:
            continue
        if tok in SHORT_KEEP:
            count += 1
        elif len(tok) >= 3 and re.search(r"[aeiou]", tok) and not re.search(r"[bcdfghjklmnpqrstvwxyz]{5,}", tok):
            count += 1
    return count

def count_suspicious(words: list[str]) -> int:
    import re
    count = 0
    for w in words:
        tok = re.sub(r"[^\w]", "", w.lower())
        if not tok:
            continue
        if len(tok) == 1 and tok not in SHORT_KEEP:
            count += 1
    return count


# ─── Table rendering ──────────────────────────────────────────────────────────

def fmt(val: Any, decimals: int = 2) -> str:
    if val is None:
        return "-"
    try:
        return f"{float(val):.{decimals}f}"
    except Exception:
        return str(val)


def build_table(rows: list[dict]) -> str:
    headers = [
        "Engine", "Image", "Status",
        "Words", "Lines", "Meaningful",
        "Suspicious", "Avg Conf (%)",
        "Time (ms)",
    ]
    col_rows = []
    for r in rows:
        col_rows.append([
            r["engine"],
            r["image"],
            r["status"],
            str(r.get("word_count", "-")),
            str(r.get("line_count", "-")),
            str(r.get("meaningful", "-")),
            str(r.get("suspicious", "-")),
            fmt(r.get("confidence"), 1),
            fmt(r.get("elapsed_ms"), 0),
        ])
    widths = [len(h) for h in headers]
    for row in col_rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def fmt_row(cells):
        return "| " + " | ".join(c.ljust(widths[i]) for i, c in enumerate(cells)) + " |"

    sep = "| " + " | ".join("-" * w for w in widths) + " |"
    lines = [fmt_row(headers), sep] + [fmt_row(r) for r in col_rows]
    return "\n".join(lines)


def build_summary_table(rows: list[dict]) -> str:
    from collections import defaultdict
    engines = list(dict.fromkeys(r["engine"] for r in rows))
    by_engine: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_engine[r["engine"]].append(r)

    headers = [
        "Engine", "Status", "Images",
        "Avg Words", "Avg Lines", "Avg Meaningful",
        "Avg Conf (%)", "Avg Time (ms)", "P50 ms", "P90 ms",
    ]
    col_rows = []
    for eng in engines:
        eng_rows = by_engine[eng]
        ok_rows = [r for r in eng_rows if r["status"] == "ok"]
        all_statuses = set(r["status"] for r in eng_rows)
        status = "ok" if all_statuses == {"ok"} else ("/".join(sorted(all_statuses)))
        if not ok_rows:
            col_rows.append([eng, status, str(len(eng_rows))] + ["-"] * 7)
            continue

        times = sorted(r["elapsed_ms"] for r in ok_rows)
        avg_t = sum(times) / len(times)
        p50 = times[len(times) // 2]
        p90 = times[min(len(times)-1, int(len(times) * 0.9))]

        col_rows.append([
            eng,
            status,
            str(len(eng_rows)),
            fmt(sum(r.get("word_count", 0) for r in ok_rows) / len(ok_rows), 1),
            fmt(sum(r.get("line_count", 0) for r in ok_rows) / len(ok_rows), 1),
            fmt(sum(r.get("meaningful", 0) for r in ok_rows) / len(ok_rows), 1),
            fmt(sum(r.get("confidence", 0) for r in ok_rows) / len(ok_rows), 1),
            fmt(avg_t, 0),
            fmt(p50, 0),
            fmt(p90, 0),
        ])

    widths = [len(h) for h in headers]
    for row in col_rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def fmt_row(cells):
        return "| " + " | ".join(c.ljust(widths[i]) for i, c in enumerate(cells)) + " |"

    sep = "| " + " | ".join("-" * w for w in widths) + " |"
    lines = [fmt_row(headers), sep] + [fmt_row(r) for r in col_rows]
    return "\n".join(lines)


# ─── Main ────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="OCR Engine Direct Benchmark")
    parser.add_argument("--engines", nargs="+", default=["tesseract", "paddleocr"],
                        choices=["tesseract", "paddleocr", "easyocr"],
                        help="Engines to benchmark")
    parser.add_argument("--images", nargs="+", default=None,
                        help="Image paths (default: public/fixtures/ocr/manga/*.png)")
    parser.add_argument("--language", default="eng")
    parser.add_argument("--out", default=None, help="Save markdown table to this file")
    args = parser.parse_args()

    images = [Path(p) for p in args.images] if args.images else DEFAULT_IMAGES
    images = [p for p in images if p.exists()]

    if not images:
        print("[ERROR] No image files found. Check --images or public/fixtures/ocr/manga/")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  OCR Direct Benchmark")
    print(f"  Engines : {', '.join(args.engines)}")
    print(f"  Images  : {len(images)} files")
    print(f"  Language: {args.language}")
    print(f"{'='*60}\n")

    rows: list[dict] = []

    for engine in args.engines:
        for img_path in images:
            img_name = img_path.name
            print(f"  [{engine}] {img_name} ... ", end="", flush=True)
            t0 = time.perf_counter()

            if engine == "tesseract":
                result = run_tesseract(img_path, args.language)
            else:
                result = run_bridge(engine, img_path, args.language)

            elapsed_ms = (time.perf_counter() - t0) * 1000

            if result.get("ok"):
                words = result.get("words", [])
                row = {
                    "engine": engine,
                    "image": img_name,
                    "status": "ok",
                    "word_count": len(words),
                    "line_count": result.get("lines", 0),
                    "meaningful": count_meaningful(words),
                    "suspicious": count_suspicious(words),
                    "confidence": result.get("confidence", 0.0),
                    "elapsed_ms": elapsed_ms,
                    "text_preview": " ".join(words[:12]) + ("..." if len(words) > 12 else ""),
                }
                print(f"ok  | {len(words)} words | {elapsed_ms:.0f} ms")
            else:
                row = {
                    "engine": engine,
                    "image": img_name,
                    "status": f"error: {result.get('error', '?')[:60]}",
                    "word_count": 0,
                    "line_count": 0,
                    "meaningful": 0,
                    "suspicious": 0,
                    "confidence": 0.0,
                    "elapsed_ms": elapsed_ms,
                    "text_preview": "",
                }
                print(f"FAIL: {result.get('error', '?')[:60]}")

            rows.append(row)

    print(f"\n{'='*60}")
    print("  Per-Image Results")
    print(f"{'='*60}\n")
    detail_table = build_table(rows)
    print(detail_table)

    print(f"\n{'='*60}")
    print("  Summary (aggregated per engine)")
    print(f"{'='*60}\n")
    summary_table = build_summary_table(rows)
    print(summary_table)

    # Save markdown
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    md_content = f"""# OCR Engine Benchmark

Generated: {timestamp}  
Engines: {', '.join(args.engines)}  
Images: {', '.join(p.name for p in images)}  
Language: {args.language}

## Summary

{summary_table}

## Per-Image Detail

{detail_table}
"""

    out_path = Path(args.out) if args.out else REPO_ROOT / ".tmp-ocr-direct-benchmark.md"
    out_path.write_text(md_content, encoding="utf-8")
    print(f"\n[Saved] {out_path}")
    print()


if __name__ == "__main__":
    main()
