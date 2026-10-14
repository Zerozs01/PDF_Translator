# Post-Mortem: ADR-0009 Argos / CTranslate2 Offline Translation Optimization & Queue Bottleneck Elimination

**Date:** 2026-10-14  
**Author / Team:** Antigravity Engineering  
**Status:** Resolved & Validated  
**Affected Components:** `scripts/argos_translate_bridge.py`, `src/services/ocr/BackgroundQueueProcessor.ts`, `src/services/bridge/index.ts`, `scripts/benchmark_runner.py`  

---

### 1. Summary
Offline document translation using Argos Translate (CTranslate2 backend) on CPU was suffering from high per-page latency (~1,066 ms/page) and an apparent massive queue delay (last page waiting up to 207 seconds in `queueWait`). Sequential loop model invocations, per-sentence unbatched SQLite transactions, and unselective Zustand store cloning were compounded by an unmasked telemetry bug (`ocrIpcDurationMs` variable shadowing) that masked ~5.2s/page of CPU OCR time as 0ms, wrongly attributing the delay to translation queue overhead. The pipeline was overhauled with CTranslate2 vectorized batching (`translate_batch`), in-memory sentence LRU caching, decoupled limiter stages (`transQueueWait`), multi-row chunked SQLite writes, selective store hydration for active visible pages, and accurate telemetry. Per-page translation latency dropped to **238.78 ms** (4.46x faster), translation queue wait dropped to **0.01 ms** (virtually zero), and p95 IPC dropped to **88.3 ms** (23.6x faster), with 100% test pass rate (407/407 tests).

---

### 2. Symptom
During offline batch translation on a 36-page Manga corpus (`Chapter 33.5 - Super no Ura de Yani Suu Futari - MangaDex_19-8-2569.pdf`, Document ID `515`):
- Total job wall clock was **235,995 ms** (~236 seconds).
- Per-page translation stage mean was **1,066.06 ms** (median 654.80 ms, max 8,837.30 ms).
- IPC `p95` was **2,090.2 ms**.
- `queueWait` accumulated monotonically up to **207,541 ms** (~207.5 seconds) for page 36.
- The telemetry table reported `2. OCR (IPC Round-Trip)` as `0.00 ms` for all 36 pages, suggesting ~5.2s per page of mysterious "invisible time" was lost in background queue coordination.

---

### 3. Root Cause
The performance regression and diagnostic confusion stemmed from four distinct mechanisms:

1. **Sequential Model Forward Passes in Python Bridge:**
   `scripts/argos_translate_bridge.py` called `argos_model.translate(text)` in a standard Python `for` loop per sentence. This executed separate CTranslate2 forward passes with single-sentence tensor allocations and repeated Python GIL acquisition overhead instead of batching.

2. **Telemetry Variable Shadowing Masking OCR Duration:**
   In `src/services/ocr/BackgroundQueueProcessor.ts`, `let ocrIpcDurationMs = 0` was declared in the outer scope of `executePageOCR`, but re-declared with `let ocrIpcDurationMs = 0;` inside the inner `try` block around `performance.measure()`. The measured duration was assigned to the inner shadowed variable, leaving the outer variable at `0`. This caused all 36 pages to report OCR duration as `0 ms`, creating the illusion of 5.2 seconds per page of "invisible queue delay."

3. **In-Flight Slot Coupling & Limiter Blocking:**
   In `BackgroundQueueProcessor.ts`, `inFlightLimiter` held the page slot across both the OCR stage and the translation stage. As long as translation was in flight, the slot was held, artificially delaying the enqueueing and processing of subsequent pages.

4. **Unbatched SQLite I/O & Zustand Store Churn:**
   - In `src/services/bridge/index.ts`, `saveSentenceTranslationBatch` executed individual sequential `INSERT OR REPLACE INTO sentence_translation_cache` statements per sentence.
   - In `BackgroundQueueProcessor.ts`, `useOCRTextLayerStore.getState().setPageOCR(pageNum, ocrResult)` was invoked for all 36 pages in the background, creating 36 full map clones (`new Map(allPagesOCR)`) and triggering continuous React re-render cycles in the viewer.

---

### 4. Why It Produced the Symptom
- Because `ocrIpcDurationMs` was shadowed and returned `0`, the 5.16s/page CPU OCR execution time was completely hidden from telemetry. The only visible high number was `queueWait` (198–207s), leading engineers to suspect a deadlock or queue scheduling bug when in reality pages were simply waiting for PaddleOCR on CPU.
- Because CTranslate2 processed sentences one-by-one, pages with 20+ dialogue bubbles took 3–8 seconds in translation alone.
- Because background pages updated UI stores, Chromium spent CPU cycles re-rendering off-screen React components and serializing DB sentences individually, compounding thread pool contention with Python child processes.

---

### 5. Fix
The fix was implemented across four phases (Steps 2a–2d):

1. **Vectorized CTranslate2 Batching (Step 2a - `scripts/argos_translate_bridge.py`):**
   Extracted the underlying CTranslate2 `translator` instance from Argos Translate and replaced the Python loop with vectorized batch inference:
   ```python
   results = argos_model.model.translator.translate_batch(
       tokens_batch,
       batch_type="tokens",
       max_batch_size=1024
   )
   ```
2. **In-Memory Sentence LRU Cache & Token Normalization (Step 2b/2c):**
   Added a 4,096-entry in-memory LRU cache in `argos_translate_bridge.py` with whitespace/punctuation preservation to instantly resolve repetitive dialogue and SFX in 3–8 ms without triggering CTranslate2 inference.
3. **Variable Shadowing Removal & Limiter Stage Decoupling (Step 2d - `BackgroundQueueProcessor.ts`):**
   - Removed the shadowed `let ocrIpcDurationMs = 0;` declaration, unmasking the true 5,163 ms mean OCR time.
   - Introduced dedicated `translationStageLimiter` and granular timing `transQueueWaitMs` to measure translation queue contention independently from OCR.
   - Implemented **Active-Document Per-Page Hydration**: Store hydration and layer syncing trigger immediately per completed page for the active document (`activeDocId === job.documentId`), unlocking instant per-page pop-in while skipping UI mutations for inactive background documents.
4. **Multi-Row Chunked SQLite Queries (`src/services/bridge/index.ts`):**
   Replaced sequential SQLite loops with multi-row `INSERT OR REPLACE` (100 sentences per chunk) and multi-item `SELECT ... WHERE source_text IN (...)`.
5. **Benchmark Harness Automation (`scripts/benchmark_runner.py`):**
   Created an automated CLI tool supporting `--mode warm` (tests translation speed with cached OCR) and `--mode cold` (cleans all caches with automated safety backup).

---

### 6. How It Was Found
- **Repro:** Run "Offline All Pages" on Document 515 with `localStorage.setItem('pdf_translator_argos_profile', '1')`.
- **Breakthrough 1 (Amdahl's Gate):** Phase 0 showed `main:direct` consumed 93.17% of IPC time (25.31s / 27.17s) while retries accounted for only 6.83%. This proved CTranslate2 inference—not retries—was the primary bottleneck.
- **Breakthrough 2 (Shadowing Discovery):** Code inspection of `executePageOCR` revealed line 984 declared `let ocrIpcDurationMs = 0;` inside the `try` block, discarding the duration and causing the 0 ms anomaly. Fixing it immediately accounted for 185s of the 208s wall clock.
- **Breakthrough 3 (Cache Isolation):** Direct CLI inspection via `benchmark_runner.py` proved the user was testing in Cold OCR mode, explaining why PaddleOCR re-ran.

---

### 7. Why It Slipped Through
- **Review Miss & Tooling Gap:** Variable shadowing within nested blocks was not flagged by standard TypeScript compiler settings (`noShadowedRestrictedNames` was not strict on local block variables).
- **Metric Conflation:** Earlier profiling lumped queue waiting and OCR into single end-to-end metrics, obscuring where the latency was spent until Step 2d introduced separate `transQueueWait` and `slotHold` instrumentation.

---

### 8. Validation

Validated on Windows 11 x64, Python 3.10 / CTranslate2, Corpus Document 515 (36 pages, MangaDex Chapter 33.5):

| Metric | Baseline (Phase 0) | Optimized (Phase 1 Final) | Delta |
| :--- | :--- | :--- | :--- |
| **Stage 4: Translation (Mean)** | 1,066.06 ms | **238.78 ms** | **-77.6% (4.46x faster)** |
| **Stage 4: Translation (Median)** | 654.80 ms | **240.25 ms** | **-63.3% (2.72x faster)** |
| **Translation Queue Wait (Mean)** | ~207,000 ms (conflated) | **0.01 ms** (Median 0 ms, Max 0.2 ms) | **~100% eliminated** |
| **`main:direct` IPC (Mean)** | 723.10 ms | **8.10 ms** (cached) / **348.35 ms** (cold) | **Up to 89.2x faster** |
| **`p95 IPC Latency`** | 2,090.20 ms | **88.30 ms** | **-95.8% (23.6x faster)** |
| **IPC Reliability** | 0 failures | **46 / 46 calls OK (0 errors, 0 timeouts)** | **100% stable** |
| **Test Suite** | 35 files / 407 tests | **35 files / 407 tests passing (100%)** | **0 regressions** |
| **Rust Backend Tests** | 7 tests | **7 tests passing (100%)** | **0 regressions** |

---

### 9. Action Items / Follow-ups
1. **ESLint Shadowing Rule:** Add `@typescript-eslint/no-shadow` to `.eslintrc` / `biome.json` to prevent local block re-declarations from masking outer telemetry variables.
2. **DirectML Translation Assessment:** Evaluate whether CTranslate2 can be linked to DirectML / ONNX Runtime for GPU-accelerated translation on non-NVIDIA GPUs if workloads exceed 100+ pages.
3. **Docs / ADR Synchronization:** Commit ADR-0009 architectural decision record to `docs/adr/0009-argos-ctranslate2-vectorization-and-pipeline-decoupling.md` and update `documents/CHANGELOG.md`.
