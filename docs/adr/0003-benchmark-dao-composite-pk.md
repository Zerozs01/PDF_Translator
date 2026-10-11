# BenchmarkDAO Schema Alignment with Composite Primary Key

## Context
The SQLite schema for `benchmarks` defines the primary key as `PRIMARY KEY (document_id, page_number, mode, config_hash)` where `mode TEXT NOT NULL CHECK(mode IN ('baseline', 'improve'))`.
`BenchmarkDAO.ts` previously omitted the `mode` column in `INSERT` and `ON CONFLICT`, resulting in `NOT NULL constraint failed: benchmarks.mode` exceptions whenever benchmarks were recorded.

## Decision
Align `BenchmarkDAO` with the database schema by:
1. Adding `mode: 'baseline' | 'improve'` as an explicit parameter in `save`, `get`, `clear`, and `list` methods.
2. Correcting the `INSERT ... ON CONFLICT(document_id, page_number, mode, config_hash)` statement.
3. Updating IPC handlers (`electron/ipc/dbIpc.ts`), preload bridge (`electron/preload.ts`), and frontend service (`src/services/dbService.ts`) to cleanly pass `mode`.

## Consequences
- Benchmark results for `baseline` and `improve` modes are cleanly segregated in the database.
- Upsert queries succeed without schema violations.
- The `config_hash` column stores `${mode}:${configHash}:${engine}` to maintain full parity with the frontend's composite cache keys without requiring cache invalidation.
