# PaddleOCR Thai Model Fix - TODO

Status: **GREEN — Thai PaddleOCR daemon prewarm verified end-to-end**

Last test (CLI): `{"ok": true, "available": true, "runtime": "Python bridge", "description": "PaddleOCR warmed (th, cpu_panel_fast)"}`

---

## Steps

1. [x] Create paddle model directory `public/paddle/models/inference/`
2. [x] Verify CLI / models cached. Cache lives in `~/.paddlex/official_models/` (NOT `~/.paddleocr/whl/` — PaddleOCR v5 uses paddlex backend).
   - Confirmed dirs: `PP-OCRv5_mobile_det`, `th_PP-OCRv5_mobile_rec`, `PP-LCNet_x1_0_textline_ori`, `PP-OCRv5_server_det`, `PP-OCRv5_server_rec`, `PP-LCNet_x1_0_doc_ori`, `UVDoc`, `en_PP-OCRv5_mobile_rec`, `korean_PP-OCRv5_mobile_rec`.
3. [~] OBSOLETE — symlink not needed; auto-discovery works. `LOCAL_MODEL_BASE` retained as offline override for portable builds.
4. [x] `scripts/external_ocr_bridge.py`:
   - `from pathlib import Path` ✅
   - `LOCAL_MODEL_BASE = repo/public/paddle/models/inference` ✅
   - `resolve_local_model_dir(subdir)` helper (verifies `inference.pdmodel/json/yml`) ✅
   - `build_paddle_constructor_kwargs`: for `lang=='th'` sets `text_recognition_model_name="th_PP-OCRv5_mobile_rec"` + optional local-dir overrides ✅
5. [x] **Environment fix**: `.venv-ocr` had `numpy 2.2.6` → conflicted with `paddle 3.3.1` (built against numpy<2). Stale `numpy/_core/` dir caused `DLL load failed _multiarray_umath`. Fixed by force-reinstall `numpy==1.26.4` after killing daemons + manual `~ore/~ft/~inalg/~andom` cleanup.
6. [x] Standalone bridge prewarm test (Thai) ✅
7. [ ] Electron integration test — `npm run dev` → load Thai image → verify Thai text via OCR panel
8. [ ] NPM bootstrap script: `package.json` → `"paddle-thai:download": "python scripts/download-paddle-thai-models.py"`
9. [ ] UI status indicator in `src/components/OCR/OCRTextLayerPanel.tsx`: "Thai models ✓ cached"
10. [ ] Docs: `documents/LOCAL_PADDLE_MODELS.md`

---

## Critical Notes (for future me)

- **NEVER mix numpy 2.x with paddle ≤3.3 in the same venv.** Pin `numpy<2` in `requirements-ocr.txt`.
- `~/.paddlex/official_models/` is the canonical cache — do NOT depend on `~/.paddleocr/`.
- When uninstalling numpy on Windows, kill ALL Python daemons first. Stale `_core/` dirs from numpy 2.x break ABI even after fresh install of 1.x.
- Bridge expects `text_recognition_model_name="th_PP-OCRv5_mobile_rec"` for Thai (PP-OCRv5_server_rec is multilingual but slower; mobile_rec is the Thai-specialized model).
