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
import traceback
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).parent
REPO_ROOT = SCRIPT_DIR.parent
BRIDGE_SCRIPT = SCRIPT_DIR / "external_ocr_bridge.py"
DEFAULT_IMAGES = [
    REPO_ROOT / "public/fixtures/ocr/manga/manga1.png",
    REPO_ROOT / "public/fixtures/ocr/manga/manga2.png",
    REPO_ROOT / "public/fixtures/ocr/manga/manga3.png",
    REPO_ROOT / "public/fixtures/ocr/document_test/document1.png",
    REPO_ROOT / "public/fixtures/ocr/document_test/document2.png",
    REPO_ROOT / "public/fixtures/ocr/document_test/document3.png",
]




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


# ─── True raw PaddleOCR (direct, no bridge) ──────────────────────────────────
def run_true_raw_paddle(image_path: Path, language: str = "en") -> dict[str, Any]:
    """
    True Raw PaddleOCR (No Safety Nets).
    ปลดลิมิต det_limit_side_len เพื่อบังคับให้ AI ประมวลผลภาพ 4K แบบเต็มความละเอียด
    เพื่อให้เห็น System Overhead ที่แท้จริงเวลาไม่ผ่าน Pipeline ของเรา
    """
    import time
    try:
        from paddleocr import PaddleOCR
    except ImportError as exc:
        return {"ok": False, "error": f"missing paddleocr: {exc}"}

    def bbox_from_points(points):
        try:
            import numpy as np  # type: ignore
            if isinstance(points, np.ndarray):
                arr = points
                if arr.ndim == 1 and arr.size >= 4:
                    x0, y0, x1, y1 = [float(v) for v in arr[:4]]
                    return {"x0": min(x0, x1), "y0": min(y0, y1), "x1": max(x0, x1), "y1": max(y0, y1)}
                if arr.ndim >= 2 and arr.shape[-1] >= 2:
                    xs = [float(p[0]) for p in arr]
                    ys = [float(p[1]) for p in arr]
                    return {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)}
        except Exception:
            pass

        xs = []
        ys = []
        if points is None:
            iterable = []
        else:
            iterable = points
        for point in iterable:
            try:
                xs.append(float(point[0]))
                ys.append(float(point[1]))
            except Exception:
                continue
        if not xs or not ys:
            return {"x0": 0.0, "y0": 0.0, "x1": 0.0, "y1": 0.0}
        return {"x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys)}

    def read_field(item, key, default=None):
        try:
            if isinstance(item, dict):
                return item.get(key, default)
            return item[key]
        except Exception:
            return getattr(item, key, default)

    def as_list(value):
        if value is None:
            return []
        if isinstance(value, list):
            return value
        if isinstance(value, tuple):
            return list(value)
        try:
            return list(value)
        except Exception:
            return [value]

    # Normalize common language codes (bridge uses 'eng' in some places)
    lang_norm = str(language or "").strip().lower()
    if lang_norm in {"eng", "english"}:
        lang_norm = "en"
    elif lang_norm in {"tha", "thai"}:
        lang_norm = "th"

    t0 = time.perf_counter()
    try:
        # Prefer new parameter names if available to avoid deprecation warnings
        try:
            import inspect
            sig = inspect.signature(PaddleOCR)
            params = {}
            if 'use_textline_orientation' in sig.parameters:
                params['use_textline_orientation'] = True
            elif 'use_angle_cls' in sig.parameters:
                params['use_angle_cls'] = True

            if 'text_det_limit_side_len' in sig.parameters:
                params['text_det_limit_side_len'] = 999999
            elif 'det_limit_side_len' in sig.parameters:
                params['det_limit_side_len'] = 999999

            if 'text_det_limit_type' in sig.parameters:
                params['text_det_limit_type'] = 'max'
            elif 'det_limit_type' in sig.parameters:
                params['det_limit_type'] = 'max'
        except Exception:
            params = {'use_angle_cls': True, 'det_limit_side_len': 999999, 'det_limit_type': 'max'}

        ocr = PaddleOCR(lang=lang_norm, **params)
        if hasattr(ocr, "predict"):
            raw_result = ocr.predict(str(image_path))
        else:
            raw_result = ocr.ocr(str(image_path))
        elapsed_ms = (time.perf_counter() - t0) * 1000

        words = []
        lines = []
        result_items = raw_result if isinstance(raw_result, list) else [raw_result]
        for item in result_items:
            rec_texts = as_list(read_field(item, 'rec_texts', []))
            rec_scores = as_list(read_field(item, 'rec_scores', []))
            rec_boxes = as_list(read_field(item, 'rec_boxes', []))
            rec_polys = as_list(read_field(item, 'rec_polys', []))
            for index, text in enumerate(rec_texts):
                text_value = str(text or '').strip()
                if not text_value:
                    continue
                score = 0.0
                if index < len(rec_scores):
                    try:
                        score = float(rec_scores[index])
                    except Exception:
                        score = 0.0
                points = None
                if index < len(rec_boxes):
                    points = rec_boxes[index]
                elif index < len(rec_polys):
                    points = rec_polys[index]
                bbox = bbox_from_points(points)
                words.append(text_value)
                lines.append({
                    'text': text_value,
                    'confidence': score,
                    'bbox': bbox,
                    'words': [{'text': text_value, 'confidence': score, 'bbox': bbox}],
                })

        return {
            "ok": True,
            "engine": "paddleocr-true-raw",
            "elapsed_ms": elapsed_ms,
            "word_count": len(words),
            "words": words,
            "lines": lines,
            "confidence": 0.0,
            "text": " ".join(words),
        }
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
    parser.add_argument("--engines", nargs="+", default=["paddleocr", "easyocr"],
                        choices=["paddleocr", "easyocr", "paddleocr-true-raw"],
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

            if engine == "paddleocr-true-raw":
                result = run_true_raw_paddle(img_path, args.language)
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
