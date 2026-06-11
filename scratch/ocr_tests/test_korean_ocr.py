import os
import sys
sys.path.insert(0, 'scripts')
from paddleocr import PaddleOCR
from external_ocr_bridge import build_paddle_constructor_kwargs

img_path = r"C:\Users\auand\AppData\Roaming\pdf_translator\imports\8be1139eb9f20e91a53702df.jpg"
if not os.path.exists(img_path):
    print("Image not found:", img_path)
    sys.exit(1)

# Default korean profile kwargs
kwargs = build_paddle_constructor_kwargs("korean", "cpu_korean_default")
print("Initializing with:", kwargs)

ocr = PaddleOCR(**kwargs)
res = ocr.ocr(img_path, cls=False)
print("=== Results ===")
for line in res[0] if res else []:
    print(line)
