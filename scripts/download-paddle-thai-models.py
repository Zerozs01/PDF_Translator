"""
Download PaddleOCR Thai (PP-OCRv5) models via the official PaddleOCR API.

Strategy:
  - PaddleOCR v5 auto-downloads detection + recognition models on first init.
  - Cache lives in ~/.paddleocr/ (Windows: C:\\Users\\<user>\\.paddleocr\\)
  - We trigger the download by instantiating PaddleOCR(lang='th', ...) once.
  - Optionally mirror to public/paddle/models/inference/ for offline/portable use.

Usage:
  python scripts/download-paddle-thai-models.py            # download + cache
  python scripts/download-paddle-thai-models.py --mirror   # also copy into public/paddle/models/inference
"""
from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

# Force CPU + disable network checks that sometimes hang on Windows
os.environ.setdefault("FLAGS_enable_pir_api", "0")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")


def trigger_download() -> Path:
    try:
        from paddleocr import PaddleOCR
    except ImportError as exc:
        print(f"[FATAL] paddleocr not installed in this Python: {exc}", file=sys.stderr)
        print("Hint: .venv-ocr\\Scripts\\python.exe -m pip install paddleocr", file=sys.stderr)
        sys.exit(2)

    print("[INFO] Initialising PaddleOCR(lang='th') — this triggers model download on first run...")
    PaddleOCR(
        lang="th",
        device="cpu",
        enable_mkldnn=False,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=True,
        text_detection_model_name="PP-OCRv5_mobile_det",
    )
    cache = Path(os.path.expanduser("~/.paddleocr"))
    print(f"[OK]   PaddleOCR initialised. Cache root: {cache}")
    if not cache.exists():
        print("[WARN] ~/.paddleocr does not exist after init — models may have been written elsewhere.")
    return cache


def list_cached_models(cache: Path) -> list[Path]:
    if not cache.exists():
        return []
    return [p for p in cache.rglob("*") if p.is_dir() and any(
        (p / fname).exists() for fname in ("inference.pdmodel", "inference.json", "inference.yml")
    )]


def mirror_to_public(cache: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True)
    model_dirs = list_cached_models(cache)
    if not model_dirs:
        print("[WARN] No model dirs (containing inference.*) found under cache — skip mirror.")
        return
    for src in model_dirs:
        dst = target / src.name
        if dst.exists():
            print(f"[SKIP] {dst} already exists")
            continue
        print(f"[COPY] {src} -> {dst}")
        shutil.copytree(src, dst)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mirror", action="store_true",
                        help="Copy downloaded models into public/paddle/models/inference/")
    args = parser.parse_args()

    cache = trigger_download()

    print("\n[INFO] Cached model directories:")
    for d in list_cached_models(cache):
        print(f"  - {d}")

    if args.mirror:
        target = Path(__file__).parent.parent / "public" / "paddle" / "models" / "inference"
        print(f"\n[INFO] Mirroring to {target}")
        mirror_to_public(cache, target)

    print("\n[DONE]")


if __name__ == "__main__":
    main()
