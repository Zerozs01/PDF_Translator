# OCR Regression Fixtures

Fixture images referenced by `expectations.json` are test artifacts for deterministic quality gate audits, regression harnesses, and multi-engine benchmarks.

## 1. Fixture Suite Categories

### A. Tall Comic Sparse Balloons (`manga/`)
- `manga1.png` (`manga-1`, page 2): Bathhouse scene with sparse dialogue bubbles, name tags ("Player Name: Azuma", "Player Name: Yuki"), and survival rate discussions.
- `manga2.png` (`manga-2`, page 3): Multi-area game rules with rectangular text panels ("THE INDOOR BATH", "OPEN A SHOE LOCKER").
- `manga3.png` (`manga-3`, page 5): High-contrast exclamation, character closeups, and sound effects ("DELIVERY EATERS!", "SHE'S GLARING FOR SOME REASON!").

### B. Dense Technical Tables & Labels (`document_test/`)
- `document1.png` (`doc-tech-1`, page 101): Engineering connection table ("TABLE 5-1 Continued", "Types of Connection", "Reaction", "Number of Unknowns") with photographic figure captions.
- `document2.png` (`doc-tech-2`, page 102): Chapter objectives, equilibrium conditions, and vector force diagram annotations ($F_1, F_2, F_3, F_4, M_1, M_2$).
- `document3.png` (`doc-tech-3`, page 103): Equations of equilibrium ($\Sigma M_A = 0$, $\Sigma M_B = 0$, $\Sigma M_C = 0$), equation references `(5-4)`, and structured procedure for analysis with bullet points.

## 2. Validation Commands

- Audit fixture assets and manifest: `npm run ocr:fixtures:check`
- Audit fixture assets requiring Korean support: `npm run ocr:fixtures:check:kor`
- Direct Python benchmark across engines without browser: `python scripts/ocr-table-benchmark.py`
- Browser-based regression run: `npm run ocr:regression:partial`
