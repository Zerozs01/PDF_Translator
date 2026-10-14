# DirectML Parity & Performance Benchmark Report (ADR-0005)

**Date:** 2026-10-14 06:53:47
**Hardware / GPU Adapter:** AMD Radeon RX 6700 XT (Index 0)
**Baseline Engine:** Paddle Native CPU (`OCR_BACKEND=paddle`)
**Candidate Engine:** DirectML GPU (`OCR_BACKEND=ort_dml`)

---

## 1. Quality Parity Gate (Task B Verification)

| Quality Gate Metric | Target Threshold | Actual Result | Gate Status |
|---|---|---|---|
| **Box Count Parity** | 100% (or $\le 2$ margin) | 259/259 boxes (100.0%) | **PASS** |
| **Bounding Box IoU** | $\ge 0.98$ | 1.0000 | **PASS** |
| **Text Similarity** | $\ge 99.8\%$ | 100.00% | **PASS** |
| **Confidence Delta** | $\le \pm 0.005$ | $\pm 0.00003$ | **PASS** |
| **Overall Parity Gate** | All Passed | **PASS** | **PASS** |

---

## 2. Performance & Throughput Benchmark Matrix (Task A)

| Batch Size | Metric | Paddle Native CPU | DirectML GPU (ort_dml) | Speedup / Delta |
|---|---|---|---|---|
| **Batch 4** | Cold Prewarm Latency | 8336.93 ms | 10048.95 ms | +1712.0 ms |
| | First Page Latency | 20722.73 ms | 918.17 ms | -19804.6 ms |
| | Steady-State Latency | 17941.76 ms/page | 513.45 ms/page | **34.94x Faster** |
| | Steady-State Throughput | 0.06 pages/sec | 1.95 pages/sec | **+1.89 pps** |
| | Peak Process Memory (RSS) | 4.36 MB | 4.4 MB | +0.0 MB |
| **Batch 8** | Cold Prewarm Latency | 9438.99 ms | 9712.74 ms | +273.8 ms |
| | First Page Latency | 17842.47 ms | 1021.95 ms | -16820.5 ms |
| | Steady-State Latency | 15234.78 ms/page | 708.27 ms/page | **21.51x Faster** |
| | Steady-State Throughput | 0.07 pages/sec | 1.41 pages/sec | **+1.34 pps** |
| | Peak Process Memory (RSS) | 4.37 MB | 4.38 MB | +0.0 MB |

---

## 3. Engineering Conclusion & Recommendations
- **Runtime Stability:** DirectML Execution Provider runs smoothly with sequential concurrency (`concurrency = 1`).
- **Quality Parity:** Bounding boxes and recognized texts achieve complete fidelity with CPU baseline.
- **Safety Baseline Invariant:** Hard default remains `paddle` (Paddle Native CPU). DirectML GPU is strictly Opt-in.

---

## 4. ADR-0008 Session Tuning & `rec_batch_num` Parity Evaluation

### 4.1 ONNX Runtime Session Tuning
- Graph Optimization enabled: `ort.GraphOptimizationLevel.ORT_ENABLE_ALL`
- Memory Pattern disabled: `sess_opts.enable_mem_pattern = False` (required for DML dynamic shape stability)

### 4.2 Empirical Batch Size Parity Test Matrix
Evaluated on `public/fixtures/ocr/document_test/document1.png` against baseline (`b = 6`):

| `rec_batch_num` | Bounding Box IoU | Text Similarity ($\ge 99.8\%$) | Max Conf Delta ($\le 0.005$) | Parity Status |
|---|---|---|---|---|
| **16** | 1.0000 | 98.88% (FAIL) | 1.01633 (FAIL) | **REJECTED** |
| **12** | 1.0000 | 98.83% (FAIL) | 0.72898 (FAIL) | **REJECTED** |
| **8** | 1.0000 | 97.23% (FAIL) | 0.72146 (FAIL) | **REJECTED** |
| **6** | 1.0000 | 100.00% (PASS) | 0.00002 (PASS) | **APPROVED & LOCKED** |

### 4.3 Root Cause & Default Lock Decision
PaddleOCR's recognition module (`ch_PP-OCRv4_rec_infer`) performs batching by zero-padding crops to the maximum width in the batch. Larger batch sizes (> 6) introduce extreme width variance across dissimilar text snippets, skewing padding ratios and drifting CTC decoder confidence scores beyond the strict $\pm 0.005$ threshold.

**Decision:**
Per the **Strict Parity Invariant**, the hard default for `OCR_DML_REC_BATCH_NUM` is strictly locked to `6`. Speed improvements are achieved safely via ONNX Runtime graph optimizations (`ORT_ENABLE_ALL`) and pipeline concurrency (producer-consumer overlapping).

