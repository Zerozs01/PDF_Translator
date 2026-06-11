import os
import sys
import json
import pypdfium2 as pdfium
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

# 1. Render PDF page 2 to image at 300 DPI
pdf_path = r"C:\Users\auand\AppData\Roaming\pdf_translator\imports\6f98100b27450dbfcac939ec.pdf"
print("Loading PDF:", pdf_path)
doc = pdfium.PdfDocument(pdf_path)
print("Total pages:", len(doc))
page = doc[1] # Page 2 is index 1
print("Page 2 size (pt):", page.get_size())

# Render at 300 DPI (scale = 300 / 72)
scale = 300 / 72
bitmap = page.render(scale=scale)
img = bitmap.to_pil()
print("Rendered image size:", img.size)

# Resize to user's downscaled resolution (1590x23858)
target_size = (1590, 23858)
img = img.resize(target_size, Image.Resampling.LANCZOS)
print("Resized to match user's resolution:", img.size)

# Save test image
test_img_path = r"scratch/test_page2_rendered.png"
img.save(test_img_path)
print("Saved rendered image to:", test_img_path)

# Add python path of scripts to import external_ocr_bridge
scripts_dir = os.path.abspath("scripts")
sys.path.insert(0, scripts_dir)

import argparse
# Import functions from bridge
from external_ocr_bridge import (
    chunk_tall_image_for_paddle,
    get_paddle_ocr,
    select_paddle_lang,
    get_paddle_profile_key,
    build_paddle_predict_kwargs,
    normalize_quality_profile,
    run_paddleocr_pass,
    merge_chunked_paddle_results,
    cleanup_external_result
)

# Setup arguments similar to bridge command-line for page 2 doc 44
# language=eng, pipeline-profile=panel, quality-profile=fast (!!! MATCH USER'S CACHE !!!)
args = argparse.Namespace(
    action="ocr",
    engine="paddleocr",
    image=test_img_path,
    language="eng",
    width=img.size[0],
    height=img.size[1],
    dpi=300,
    page_seg_mode=0,
    pipeline_profile="panel",
    quality_profile="fast",
    max_pixels=0,
    stdio_server=False
)

# 2. Perform chunking
CHUNK_HEIGHT = 2800
CHUNK_OVERLAP = 120
chunks = chunk_tall_image_for_paddle(test_img_path, max_chunk_height=CHUNK_HEIGHT, overlap_px=CHUNK_OVERLAP)
print(f"Created {len(chunks)} chunks.")

# 3. Load PaddleOCR engine
lang = select_paddle_lang(args.language)
profile_key = get_paddle_profile_key(args)
quality_profile = normalize_quality_profile("fast")
predict_kwargs = build_paddle_predict_kwargs(args)
ocr = get_paddle_ocr(lang, profile_key, quality_profile, predict_kwargs)

chunk_results = []
for idx, (chunk_path, y_offset, ch) in enumerate(chunks):
    print(f"\n--- Running OCR on Chunk {idx} (y_offset={y_offset}, height={ch}) ---")
    result = run_paddleocr_pass(
        ocr, chunk_path, args, predict_kwargs,
        profile_key, quality_profile, "chunk",
        scale_x=1.0, scale_y=1.0
    )
    
    # Print lines found in this chunk
    lines = result.get("lines") or []
    print(f"Chunk {idx} found {len(lines)} lines:")
    for l_idx, line in enumerate(lines):
        text = line.get("text")
        bbox = line.get("bbox")
        print(f"  L{l_idx}: {repr(text)} at bbox={bbox}")
        
    chunk_results.append((result, y_offset))

# Clean up chunks
for cp, _, _ in chunks:
    try:
        os.remove(cp)
    except OSError:
        pass

# 4. Merge results
print("\n=== Merging Results ===")
merged = merge_chunked_paddle_results(chunk_results, img.size[1], CHUNK_OVERLAP)
print(f"Merged output has {len(merged.get('lines', []))} lines.")
for idx, line in enumerate(merged.get('lines', [])):
    text = line.get("text")
    if "RETURN" in text.upper() or "LET" in text.upper() or "EXPERIMENT" in text.upper() or "HER" in text.upper():
        print(f"Merged Line {idx}: {repr(text)} bbox={line.get('bbox')}")
