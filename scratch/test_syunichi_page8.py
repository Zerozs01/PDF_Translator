import os
import sys

# Force DLL directories for PyTorch to prevent shm.dll error on Windows CPU
if sys.platform == "win32":
    import ctypes
    found_torch_libs = []
    for p in sys.path:
        torch_lib = os.path.join(p, "torch", "lib")
        if os.path.isdir(torch_lib):
            found_torch_libs.append(torch_lib)
            try:
                os.add_dll_directory(torch_lib)
            except Exception:
                pass
    # Pre-load critical dlls using CDLL
    for lib_dir in found_torch_libs:
        for dll in ["uv.dll", "c10.dll", "libiomp5md.dll", "shm.dll"]:
            dll_path = os.path.join(lib_dir, dll)
            if os.path.exists(dll_path):
                try:
                    ctypes.CDLL(dll_path)
                except Exception:
                    pass

# Force disable MKLDNN to prevent CPU crashes
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
import easyocr

pdf_path = "C:\\Users\\auand\\AppData\\Roaming\\pdf_translator\\imports\\dc62baf683eac2a57e2c7fb3.pdf"
print("Checking PDF path:", pdf_path)

doc = fitz.open(pdf_path)
page = doc[7] # Page 8 (0-indexed)

# Render page
pix = page.get_pixmap(dpi=150)
img_path = "c:\\App\\Electron\\PDF_Translator\\scratch\\syunichi_page8_test.png"
pix.save(img_path)
print("Saved page 8 as image.")

# 1. Run RAW PaddleOCR (lang="en")
print("\n--- Running PaddleOCR (lang='en') ---")
ocr_en = PaddleOCR(use_angle_cls=True, lang="en", use_gpu=False, enable_mkldnn=False, show_log=False)
res_en = ocr_en.ocr(img_path, cls=True)
if res_en and res_en[0]:
    for idx, line in enumerate(res_en[0]):
        box, (text, conf) = line
        print(f"[{idx}] text='{text}' conf={conf:.3f} bbox={box}")

# 2. Run EasyOCR (lang="en")
print("\n--- Running EasyOCR (lang='en') ---")
reader = easyocr.Reader(['en'], gpu=False)
res_easy = reader.readtext(img_path)
for idx, (bbox, text, conf) in enumerate(res_easy):
    print(f"[{idx}] text='{text}' conf={conf:.3f} bbox={bbox}")
