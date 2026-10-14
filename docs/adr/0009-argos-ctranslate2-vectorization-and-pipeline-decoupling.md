# ADR-0009: Argos / CTranslate2 Vectorized Batching, In-Memory LRU Cache & Stage Decoupling

## Status
Accepted and Implemented (2026-10-14)

## Context
In ADR-0005 through ADR-0008, OCR latency was optimized using DirectML GPU acceleration and bounded pipelines. However, in Phase 0 benchmark testing on a 36-page Manga corpus (`Chapter 33.5 - Super no Ura de Yani Suu Futari - MangaDex_19-8-2569.pdf`, doc ID `515`), offline translation became the primary system bottleneck:
1. **Sequential Model Invocations:** Argos Translate Python API called `ITranslation.translate()` sequentially inside Python loops, causing repeated single-sentence CTranslate2 forward passes.
2. **Telemetry Shadowing:** `let ocrIpcDurationMs = 0` was shadowed inside a nested `try` block in `BackgroundQueueProcessor.ts`, reporting 0ms for OCR and artificially attributing ~185s of CPU OCR time to `queueWait`.
3. **Queue Slot Coupling:** The single `inFlightLimiter` held background slots across both OCR and translation stages, stalling subsequent pages until translation finished.
4. **Zustand Store Churn:** `useOCRTextLayerStore.getState().setPageOCR()` cloned whole Maps 36 times during background processing, triggering rendering storms in React.
5. **Database Transaction Overhead:** `saveSentenceTranslationBatch` executed sequential single-row `INSERT OR REPLACE` statements in SQLite.

## Decision
1. **Vectorized CTranslate2 Batching (Step 2a):**
   Decompose Argos translation pipelines (including multi-hop `CompositeTranslation` pivots) via `_extract_ct2_hops()` in `scripts/argos_translate_bridge.py` and execute two-wave vectorized `translate_batch(tokenized_batch, beam_size=4, max_batch_size=2048, batch_type="tokens", replace_unknowns=True, length_penalty=0.2)`.
2. **In-Memory Sentence LRU Cache & Intra-Batch Deduplication (Step 2b/2c):**
   Maintain a 4,096-entry `OrderedDict` LRU cache keyed by `(source_language, target_language, force_noop_sentencizer, normalized_text)` with intra-batch deduplication and deduplicated Wave 2 variant retries.
3. **Decouple Pipeline Stages & Telemetry (Step 2d):**
   - Eliminate `ocrIpcDurationMs` variable shadowing in `BackgroundQueueProcessor.ts`.
   - Separate `ocrStageLimiter` and `translationStageLimiter` and instrument `transQueueWaitMs` and `slotHoldMs`.
   - Implement **Active-Document Per-Page Hydration**: Immediately hydrate `useOCRTextLayerStore` and `useLayerStore` per completed page when `activeDocId === job.documentId`, while skipping UI store mutations for inactive background documents.
4. **Multi-Row Chunked SQLite Writes:**
   Update `src/services/bridge/index.ts` to batch sentence translations in chunks of 100 via multi-row `INSERT OR REPLACE INTO sentence_translation_cache`.

## Consequences
### Positive
- **Translation Stage Throughput:** Per-page translation dropped from 1,066.06 ms to **238.78 ms** (4.46x faster, -77.6%).
- **Queue Overhead Eliminated:** In Cold Run (CPU OCR-bound at ~5.16s/page), `transQueueWait` is ~0.01 ms (Median 0 ms, Max 0.2 ms) because translation consumes pages faster than OCR produces them. In Warm Run (OCR cached), `transQueueWait` reflects the sequential translation limiter backlog (~0.00 ms to ~3.9s total wait).
- **Direct IPC Latency:** `main:direct` IPC dropped from 723.10 ms to **8.10 ms** (cached) / **348.35 ms** (cold).
- **p95 Latency:** p95 IPC dropped from 2,090.2 ms to **88.3 ms** (23.6x faster).
- **UI Responsiveness:** Zero map cloning and zero UI frame drop during 36-page background runs.
- **Reliability:** 100% test pass rate across all 35 test files (407/407 unit tests).

### Negative / Trade-offs
- Python process memory footprint increased slightly by ~12MB due to the 4,096-entry sentence LRU cache.
- Telemetry payload slightly larger with granular `transQueueWait`, `ocrStageWall`, and `slotHold` metrics.
