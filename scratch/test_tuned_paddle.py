import os
import sys

# Force disable MKLDNN / OneDNN to prevent CPU crashes
os.environ["GLOG_minloglevel"] = "3"
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["FLAGS_use_onednn"] = "0"
os.environ["PADDLE_USE_MKLDNN"] = "0"

try:
    import paddle
    from paddle import inference
    original_create_predictor = inference.create_predictor
    def patched_create_predictor(config):
        config.disable_mkldnn()
        return original_create_predictor(config)
    inference.create_predictor = patched_create_predictor
except Exception:
    pass

import fitz # PyMuPDF
from paddleocr import PaddleOCR

pdf_path = "C:\\Users\\auand\\AppData\\Roaming\\pdf_translator\\imports\\dc62baf683eac2a57e2c7fb3.pdf"
print("Checking PDF path:", pdf_path)
print("File exists:", os.path.exists(pdf_path))

doc = fitz.open(pdf_path)
page = doc[0]

# Render page
pix = page.get_pixmap(dpi=150)
img_path = "c:\\App\\Electron\\PDF_Translator\\scratch\\syunichi_page1_test.png"
pix.save(img_path)

# Run PaddleOCR with TUNED parameters for manga handwriting
print("\n--- Running PaddleOCR with TUNED parameters ---")
ocr = PaddleOCR(
    use_angle_cls=True, 
    lang="en",
    det_db_thresh=0.15,
    det_db_box_thresh=0.30,  # Lower threshold to detect faint/thin fonts
    det_db_unclip_ratio=2.0,  # Wider unclip to merge characters into phrases
    use_gpu=False,
    enable_mkldnn=False,
    show_log=False
)
result = ocr.ocr(img_path, cls=True)

if result and result[0]:
    for idx, line in enumerate(result[0]):
        box, (text, conf) = line
        print(f"[{idx}] text='{text}' conf={conf:.3f} bbox={box}")
else:
    print("No OCR result returned.")
