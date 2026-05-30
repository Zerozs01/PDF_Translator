# OCR Benchmark Matrix

- generatedAt: 2026-05-30T21:28:14.013Z
- pipeline: panel
- quality: best
- baseUrl: http://localhost:5173
- manifest: public/fixtures/ocr/manga/expectations.json
- partialMode: enabled (--skip-missing)
- requiredLanguages: (none)
- methodology: ocr-composite-v1
- compositeWeights: raw=0.35, lexical=0.45, yield=0.2

| Engine | Pages | Composite | Efficiency (/s) | Raw (35%) | Lexical (45%) | Yield (20%) | WER | CER | Garbage | Expect Fail | Risky Pages | Words | Suspicious | Avg ms | P50 ms | P90 ms | Status |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| tesseract | 3 | 59.09 | 24.31 | 92.38 | 37.23 | 50.00 | 0.9833 | 0.9742 | 0.1000 | 3 | 3 | 1 | 0 | 2430.7 | 2244 | 2244 | risk |
| paddleocr | 3 | 59.09 | 21.57 | 92.38 | 37.23 | 50.00 | 0.9833 | 0.9742 | 0.1000 | 3 | 3 | 1 | 0 | 2739 | 2518 | 2518 | risk |

## Gate

- PASS criteria per engine: expectationFailures = 0 and riskyPages = 0
- Efficiency formula: CompositeScore / RuntimeSeconds (runtime uses per-engine avg ms)
- overallStatus: risk

## Failures

- tesseract: risk_detected (expectationFailures=3, riskyPages=3)
- paddleocr: risk_detected (expectationFailures=3, riskyPages=3)