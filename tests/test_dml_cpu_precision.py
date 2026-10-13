import sys, os
import numpy as np
from shapely.geometry import Polygon

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'scripts')))
import external_ocr_bridge as bridge
from paddleocr import PaddleOCR

def calculate_polygon_iou(poly1_pts, poly2_pts):
    p1 = Polygon(poly1_pts)
    p2 = Polygon(poly2_pts)
    if not p1.is_valid or not p2.is_valid:
        p1 = p1.buffer(0)
        p2 = p2.buffer(0)
    inter_area = p1.intersection(p2).area
    union_area = p1.union(p2).area
    if union_area == 0:
        return 1.0 if inter_area == 0 else 0.0
    return inter_area / union_area

def main():
    img_path = 'public/fixtures/ocr/manga/manga1.png'
    
    # 1. DirectML pass
    bridge.GLOBAL_USE_DML = True
    kw_dml = bridge.build_paddle_constructor_kwargs('en', 'cpu_panel_accurate')
    ocr_dml = PaddleOCR(**kw_dml)
    # 1 warm-up
    _ = ocr_dml.ocr(img_path, cls=True)
    res_dml = ocr_dml.ocr(img_path, cls=True)
    
    # 2. Pure CPU pass
    bridge.GLOBAL_USE_DML = False
    kw_cpu = bridge.build_paddle_constructor_kwargs('en', 'cpu_panel_accurate')
    kw_cpu['use_onnx'] = False
    ocr_cpu = PaddleOCR(**kw_cpu)
    # 1 warm-up
    _ = ocr_cpu.ocr(img_path, cls=True)
    res_cpu = ocr_cpu.ocr(img_path, cls=True)
    
    lines_dml = res_dml[0] or []
    lines_cpu = res_cpu[0] or []
    
    print(f"Total Lines: DML={len(lines_dml)}, CPU={len(lines_cpu)}")
    assert len(lines_dml) == len(lines_cpu), "Line count mismatch between DML and CPU!"
    
    ious = []
    score_diffs = []
    
    for i in range(len(lines_dml)):
        box_d, (text_d, score_d) = lines_dml[i]
        box_c, (text_c, score_c) = lines_cpu[i]
        
        iou = calculate_polygon_iou(box_d, box_c)
        score_diff = abs(float(score_d) - float(score_c))
        
        ious.append(iou)
        score_diffs.append(score_diff)
        
        if iou < 0.99 or score_diff > 0.01:
            print(f"Noticeable Diff at line {i}: text_dml='{text_d}' vs text_cpu='{text_c}', IoU={iou:.4f}, score_d={score_d:.4f}, score_c={score_c:.4f}, diff={score_diff:.4f}")
            
    print("\n=== Precision Metrics Summary ===")
    print(f"Min IoU:          {np.min(ious):.6f}")
    print(f"Mean IoU:         {np.mean(ious):.6f}")
    print(f"Max IoU:          {np.max(ious):.6f}")
    print(f"Max Abs Diff (Score):  {np.max(score_diffs):.6f}")
    print(f"Mean Abs Diff (Score): {np.mean(score_diffs):.6f}")

if __name__ == '__main__':
    main()
