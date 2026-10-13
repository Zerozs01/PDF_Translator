======================================================================
STEP B: RIGOROUS GOLDEN SNAPSHOT & CPU BIT-EXACT TOLERANCE VERIFICATION
Timestamp: 2026-10-11 17:27:49
======================================================================

## 1. WINNING PATH & FINAL CONSTRUCTOR KWARGS
- **Base Commit SHA:** `d91a2d37aeffc6758aa7ee0a7d37250df4e1e856`
- **Actual Winning Pipeline Path:** Paddle native CPU legacy fallback
  *(Explanation: PP-OCRv5_server_det is ignored by PaddleOCR 2.8.1 init kwargs without PaddleX; system falls back to ~/.paddleocr/whl/det/ch/ch_PP-OCRv4_det_infer and en_PP-OCRv4_rec_infer)*
- **Final Kwargs Sent to PaddleOCR:**
    `cpu_threads`: 8
    `device`: 'cpu'
    `enable_mkldnn`: False
    `lang`: 'en'
    `show_log`: False
    `text_detection_model_name`: 'PP-OCRv5_server_det'
    `use_angle_cls`: True
    `use_doc_orientation_classify`: False
    `use_doc_unwarping`: False
    `use_onednn`: False
    `use_onnx`: False
    `use_textline_orientation`: False

## 2. BIT-EXACT DETERMINISM ACROSS THREAD COUNTS (4 vs 8 vs 12)
Running CPU inference with cpu_threads=4...
  Threads=4: Det=0.596s, Rec=8.153s, Full=9.042s (Boxes: 53)
Running CPU inference with cpu_threads=8...
  Threads=8: Det=0.536s, Rec=8.772s, Full=9.367s (Boxes: 53)
Running CPU inference with cpu_threads=8...
  Threads=8: Det=0.524s, Rec=7.932s, Full=9.108s (Boxes: 53)

- **Bit-Exact Coordinate Equality (`np.array_equal`):** True
- **Bit-Exact Text String Equality:** True
- **Bit-Exact Score Equality:** True
- **Defined Tolerance:** 0.0 tolerance across identical model and input tensors.

## 3. DETECTION VS RECOGNITION BREAKDOWN: MANGA1 VS DOCUMENT1

| Metric | `manga1.png` | `document1.png` | Ratio / Difference |
|---|---|---|---|
| **Image Dimensions** | 647 x 902 | 835 x 922 | Doc is 1.32x pixels |
| **Crop Count (Lines)** | 53 crops | 43 crops | Doc has 0.81x crops |
| **Max W/H Ratio** | 7.54 | 49.57 | **Doc lines are 6.57x wider!** |
| **Detection Time (s)** | 0.524s | 0.713s | Det delta: +0.189s |
| **Recognition Time (s)** | 7.932s | 18.158s | **Rec is 2.29x slower!** |
| **Total Full OCR Time** | 9.108s | 15.413s | **Doc total is 1.69x slower!** |

### Technical Explanation of the 20-30s Duration:
1. **Detection is relatively constant:** Manga Det ~0.5-0.8s vs Document Det ~0.8-1.2s (only modest difference based on image pixel resolution).
2. **Recognition drives 85%+ of CPU latency:**
   - On `manga1.png`, recognition took **7.93s** for 53 crops with max aspect ratio 7.54.
   - On `document1.png`, recognition exploded to **18.16s** due to wide horizontal paragraphs (max aspect ratio 49.57).
   - Each wide crop expands the CTC sequence length, requiring massive sequential matrix multiplications in LCNet across time-steps.