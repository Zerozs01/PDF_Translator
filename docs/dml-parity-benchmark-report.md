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
