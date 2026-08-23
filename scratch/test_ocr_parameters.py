import os
import sys
import pypdfium2 as pdfium
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')

# Setup paths
pdf_path = r"C:\Users\auand\AppData\Roaming\pdf_translator\imports\12cea9b328a503f47ce0de6e.pdf"
scripts_dir = os.path.abspath("scripts")
sys.path.insert(0, scripts_dir)

from external_ocr_bridge import get_paddle_ocr

def test_page(page_num, det_limit, det_thresh, det_box_thresh, det_unclip_ratio):
    print(f"\n==================================================")
    print(f"Testing Page {page_num} with: det_limit={det_limit}, det_thresh={det_thresh}, det_box_thresh={det_box_thresh}, det_unclip_ratio={det_unclip_ratio}")
    print(f"==================================================")
    
    doc = pdfium.PdfDocument(pdf_path)
    page = doc[page_num - 1] # 1-based page_num to 0-based index
    
    # Render at 300 DPI
    scale = 300 / 72
    bitmap = page.render(scale=scale)
    img = bitmap.to_pil()
    
    temp_img_path = f"scratch/temp_page_{page_num}.png"
    img.save(temp_img_path)
    
    # Initialize PaddleOCR with test kwargs
    predict_kwargs = {
        "text_det_limit_type": "max",
        "text_det_limit_side_len": det_limit,
        "text_recognition_batch_size": 8,
        "text_det_thresh": det_thresh,
        "text_det_box_thresh": det_box_thresh,
        "text_det_unclip_ratio": det_unclip_ratio,
        "text_rec_score_thresh": 0.22
    }
    
    try:
        # We instantiate a new detector to avoid cache pollution
        ocr = get_paddle_ocr("en", "cpu_panel_accurate", "best", predict_kwargs)
        result = ocr.ocr(temp_img_path, cls=False)
        
        lines = []
        if result and result[0]:
            for res in result[0]:
                box, (text, score) = res
                lines.append((text, score, box))
                
        print(f"Found {len(lines)} lines:")
        for idx, (text, score, box) in enumerate(lines):
            # Print if it contains our target words to keep output readable
            txt_upper = text.upper()
            is_target = any(w in txt_upper for w in ["YOU", "FRONT", "OUT IN", "OUUUUT", "STINKY", "COMING", "SHOOT", "SADNESS", "RECAPTUR", "ARISTOCRATS", "KING AND", "ALL-OUT"])
            if is_target or len(text) < 15:
                print(f"  Line {idx}: {repr(text)} (score: {score:.3f}) box: {box}")
                
    except Exception as e:
        print("OCR execution failed:", e)
    finally:
        if os.path.exists(temp_img_path):
            os.remove(temp_img_path)

# Run test configurations
# Let's test with the currently edited configurations (3200 limit)
test_page(3, det_limit=3200, det_thresh=0.14, det_box_thresh=0.40, det_unclip_ratio=1.90)
# Let's test with higher resolution (det_limit=4200)
test_page(3, det_limit=4200, det_thresh=0.14, det_box_thresh=0.40, det_unclip_ratio=1.90)
# Let's test with lower thresholds (det_box_thresh=0.30)
test_page(3, det_limit=3200, det_thresh=0.14, det_box_thresh=0.30, det_unclip_ratio=1.90)
# Let's test Page 11 (the OUUUUT!! page)
test_page(11, det_limit=3200, det_thresh=0.14, det_box_thresh=0.40, det_unclip_ratio=1.90)
test_page(11, det_limit=4200, det_thresh=0.14, det_box_thresh=0.40, det_unclip_ratio=1.90)
