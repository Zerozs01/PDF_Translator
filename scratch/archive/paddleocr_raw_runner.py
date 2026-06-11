#!/usr/bin/env python3
"""Simple PaddleOCR raw runner.

Runs PaddleOCR directly with minimal processing to measure model-only runtime.
Accepts --image and --language and prints a JSON result to stdout.
"""
from __future__ import annotations

import argparse
import json
import time
import sys
import traceback
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--language", default="en")
    parser.add_argument(
        "--max-side-len",
        type=int,
        default=4800,
        help=(
            "Maximum det_limit_side_len for PaddleOCR detection. "
            "Hard-capped at 6000 to prevent DB++ Donut Effect. Default: 4800."
        ),
    )
    args = parser.parse_args()

    img_path = Path(args.image)
    if not img_path.exists():
        print(json.dumps({"ok": False, "error": f"image not found: {img_path}"}))
        raise SystemExit(2)

    try:
        from paddleocr import PaddleOCR
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"missing paddleocr: {exc}"}))
        raise SystemExit(3)

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

    # Normalize language codes (external bridge sometimes uses 'eng')
    lang_norm = str(args.language or "").strip().lower()
    if lang_norm in {"eng", "english"}:
        lang_norm = "en"
    elif lang_norm in {"tha", "thai"}:
        lang_norm = "th"

    # Build constructor kwargs depending on PaddleOCR version to avoid deprecation warnings
    try:
        import inspect
        from PIL import Image as _PILImage  # type: ignore

        # Determine the natural maximum side length of the source image so we
        # can set det_limit_side_len to exactly what the model needs — no more.
        # Hard cap at 6000 to prevent the DB++ "Donut Effect" (receptive field
        # saturation when characters are too large relative to the detection kernel).
        _DONUT_HARD_CAP = 6000
        _user_cap = max(1, int(getattr(args, "max_side_len", 4800) or 4800))
        _user_cap = min(_user_cap, _DONUT_HARD_CAP)
        try:
            with _PILImage.open(str(img_path)) as _img:
                _img_max_side = max(_img.width, _img.height)
            # Only raise the limit if the image actually needs it.
            # For images smaller than the cap, use the natural size so PaddleOCR
            # doesn't upscale and waste memory.
            det_limit = min(_img_max_side, _user_cap)
        except Exception:
            # If we can't read the image here, fall back to the user cap.
            det_limit = _user_cap

        sig = inspect.signature(PaddleOCR)
        params = {}
        if 'use_textline_orientation' in sig.parameters:
            params['use_textline_orientation'] = True
        elif 'use_angle_cls' in sig.parameters:
            params['use_angle_cls'] = True

        if 'text_det_limit_side_len' in sig.parameters:
            params['text_det_limit_side_len'] = det_limit
        elif 'det_limit_side_len' in sig.parameters:
            params['det_limit_side_len'] = det_limit

        if 'text_det_limit_type' in sig.parameters:
            params['text_det_limit_type'] = 'max'
        elif 'det_limit_type' in sig.parameters:
            params['det_limit_type'] = 'max'
    except Exception:
        params = {'use_angle_cls': True, 'det_limit_side_len': 4800, 'det_limit_type': 'max'}

    t0 = time.perf_counter()
    try:
        # Detect with dynamic side-length limit (avoids Donut Effect on high-DPI scans)
        ocr = PaddleOCR(lang=lang_norm, **params)
        if hasattr(ocr, "predict"):
            raw = ocr.predict(str(img_path))
        else:
            raw = ocr.ocr(str(img_path))
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        words = []
        lines = []
        result_items = raw if isinstance(raw, list) else [raw]
        for item in result_items:
            rec_texts = as_list(read_field(item, "rec_texts", []))
            rec_scores = as_list(read_field(item, "rec_scores", []))
            rec_boxes = as_list(read_field(item, "rec_boxes", []))
            rec_polys = as_list(read_field(item, "rec_polys", []))
            for index, text in enumerate(rec_texts):
                text_value = str(text or "").strip()
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
                    "text": text_value,
                    "confidence": score,
                    "bbox": bbox,
                    "words": [{"text": text_value, "confidence": score, "bbox": bbox}],
                })

        result = {
            "ok": True,
            "engine": "paddleocr-true-raw",
            "elapsed_ms": round(elapsed_ms, 1),
            "word_count": len(words),
            "words": words,
            "lines": lines,
            "confidence": 0.0,
            "text": " ".join(words),
        }
        print(json.dumps(result, ensure_ascii=True))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc), "traceback": traceback.format_exc()}))
        raise SystemExit(4)


if __name__ == "__main__":
    main()
