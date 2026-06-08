import os
import sys
sys.path.insert(0, 'scripts')
sys.stdout.reconfigure(encoding='utf-8')

import paddle
try:
    paddle.set_flags({
        "FLAGS_use_onednn": False,
        "FLAGS_use_mkldnn": False,
    })
except Exception as e:
    print("Error setting flags:", e)

from paddleocr import PaddleOCR

img_path = "scratch/page2.png"

def run_test(name, constructor_kwargs):
    print(f"\n--- Running Test: {name} ---")
    print("Kwargs:", constructor_kwargs)
    try:
        ocr = PaddleOCR(**constructor_kwargs)
        res = ocr.ocr(img_path, cls=False)
        print("Results:")
        for line in res[0] if res else []:
            text = line[1][0]
            conf = line[1][1]
            bbox = line[0]
            print(f"  Text: {text} | Conf: {conf:.3f} | BBox: {bbox}")
    except Exception as e:
        print("Error:", e)

# Test 1: Defaults (how paddle behaves out of the box for Korean)
run_test("Defaults", {
    "lang": "korean",
    "show_log": False,
})

# Test 2: Custom thresholds with default Multilingual v3 detector
run_test("Custom Thresholds (unclip=1.95, thresh=0.18)", {
    "lang": "korean",
    "show_log": False,
    "det_db_unclip_ratio": 1.95,
    "det_db_thresh": 0.18,
    "det_db_box_thresh": 0.42,
})

# Test 3: Using ch_PP-OCRv4_det_infer as det model + default unclip
run_test("ch_PP-OCRv4 Detector with Default Thresholds", {
    "lang": "korean",
    "show_log": False,
    "det_model_dir": os.path.expanduser("~/.paddleocr/whl/det/ch/ch_PP-OCRv4_det_infer"),
})

# Test 4: Using ch_PP-OCRv4_det_infer as det model + unclip=1.95
run_test("ch_PP-OCRv4 Detector with unclip=1.95", {
    "lang": "korean",
    "show_log": False,
    "det_model_dir": os.path.expanduser("~/.paddleocr/whl/det/ch/ch_PP-OCRv4_det_infer"),
    "det_db_unclip_ratio": 1.95,
    "det_db_thresh": 0.18,
    "det_db_box_thresh": 0.42,
})
