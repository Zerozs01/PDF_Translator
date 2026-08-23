import os
import fitz # PyMuPDF
from paddleocr import PaddleOCR

# The correct import path from app data
pdf_path = "C:\\Users\\auand\\AppData\\Roaming\\pdf_translator\\imports\\dc62baf683eac2a57e2c7fb3.pdf"
print("Checking PDF path:", pdf_path)
print("File exists:", os.path.exists(pdf_path))

doc = fitz.open(pdf_path)
page = doc[0]

# Render page at 150 DPI
pix = page.get_pixmap(dpi=150)
img_path = "c:\\App\\Electron\\PDF_Translator\\scratch\\syunichi_page1_test.png"
pix.save(img_path)
print("Saved page 1 as image to:", img_path)

# Run PaddleOCR directly (RAW)
ocr = PaddleOCR(use_angle_cls=True, lang="en")
result = ocr.ocr(img_path, cls=True)

print("\n--- RAW PaddleOCR Result on Syunichi Page 1 ---")
if result and result[0]:
    for idx, line in enumerate(result[0]):
        box, (text, conf) = line
        print(f"[{idx}] text='{text}' conf={conf:.3f} bbox={box}")
else:
    print("No OCR result returned.")
