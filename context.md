# Architecture Context & Index (L1)

## 1. System High-Level
- Summary: แอปพลิเคชันเดสก์ท็อปสำหรับการแปลเอกสารและมังงะ/มันฮวาแบบออฟไลน์ 100% พร้อมระบบจัดกลุ่มบอลลูนคำพูดและฐานข้อมูล SQLite ประสิทธิภาพสูง (WAL mode)
- Core Stack:
  - Frontend: React 19, TypeScript (Strict), Vite, TailwindCSS v4
  - Backend Shell: Tauri 2.x (Rust)
  - Native Engine: Rust (Tokio, Rusqlite, Pdfium Render, Rayon)
  - Database: Rusqlite (WAL mode, multi-threaded native access)
  - State: Zustand (5.x) with custom persistent storage
  - IPC: Tauri IPC commands + Custom Binary Protocol (`pdf-page://` / `http://pdf-page.localhost/`)
  - Python Daemons: Subprocess JSONL bridge for PaddleOCR / EasyOCR and Argos Translate
- Key Entry Points:
  - Client / UI: src/main.tsx -> src/App.tsx
  - Rust Backend: src-tauri/src/main.rs, src-tauri/src/lib.rs
  - Native Commands: src-tauri/src/commands/ (database.rs, sidecar.rs, pdf.rs)
  - Platform Bridge: src/services/bridge/index.ts -> TauriBridge.ts

## 2. Architecture & Data Flow
User Interaction -> React Component / Canvas -> Zustand Store / Hook -> Platform Bridge (TauriBridge) -> Tauri IPC / Rust Native Engine / Python Subprocess -> Rusqlite / Pdfium Streaming Protocol (`pdf-page://`)
- Global State:
  - src/stores/useProjectStore.ts (Active document, pages, zoom, app modes)
  - src/stores/useOCRTextLayerStore.ts (OCR bounding boxes, lines, detection engine cache)
  - src/stores/useLayerStore.ts (Translated layers, positions, balloon groups)
  - src/stores/useBackgroundQueueStore.ts (Batch background OCR and translation tasks)
  - src/stores/useGlossaryStore.ts (User custom dictionary, terms, SFX overrides)
  - src/stores/useFileBrowserStore.ts (Project tree, file management, favorites)
  - src/stores/useExportStore.ts (Export queue, modal state, output parameters)
  - src/stores/useUIStore.ts (Sidebar toggles, modals, viewer layout state)
- Shared Modules / Services:
  - src/services/bridge/ (Unified Platform Bridge, TauriBridge, PDF Stream Protocol)
  - src/services/ocr/ (Background OCR pipeline, text normalization, heuristics)
  - src/services/translation/ (Translation orchestration, offline NMT, dictionaries)
  - src/services/layers/ & src/services/layout/ (Spatial grouping, balloon detection)
  - src/services/native/ (Zero-GC Union-Find clustering, bigram popcount similarity)
  - src/services/pdf/ (PDF.js rendering, text layer, searchable PDF generator, overlayCanvasRenderer)
  - src-tauri/src/core/ (Rusqlite database manager, Python sidecar manager, Pdfium engine, LRU cache)

## 3. Directory Map (Critical Only)
- src-tauri/ -> Tauri 2.x backend, Rust native engine, Pdfium bindings, Rusqlite, and custom protocol
- src-tauri/binaries/ -> Dynamic Libraries (pdfium.dll, pdfium-x86_64-pc-windows-msvc.dll)
- src-tauri/resources/ -> External resources, OCR/NMT models, and dictionaries
- scripts/ -> สคริปต์ Python OCR Bridge, Argos NMT Bridge, และการทดสอบ Benchmark
- src/components/ -> React UI Components (Viewer, PDF Canvas, Layers, Export, Modals)
- src/hooks/ -> Custom React Hooks ควบคุม Business Flow (Translation, Export, Queue Sync)
- src/services/ -> Business Logic หลัก (Bridge, OCR, Translation, Layout, Native Buffers, PDF)
- src/stores/ -> Zustand Stores จัดการ State ส่วนกลางและการบันทึกค่าถาวร
- src/types/ -> TypeScript Type Definitions, Platform Contracts, และ Data Schemas
- documents/ -> เอกสารสถาปัตยกรรมฉบับเต็ม, บันทึกการเพิ่มประสิทธิภาพ, และ Knowledge Base
- BENCHMARK_REPORT.md -> ผลการทดสอบ Regression Test Matrix & Performance Baseline Audit

## 4. Feature-to-File Routing
- Native PDF Engine & Streaming
  - Primary: src-tauri/src/core/pdf/engine.rs, src-tauri/src/protocol/document_stream.rs
  - Secondary: src/services/bridge/pdfBridge.ts, src-tauri/src/core/pdf/cache.rs, src-tauri/src/core/pdf/reconstructor.rs
  - Scope: ประมวลผลและสตรีมภาพ PDF ผ่านโปรโตคอล `pdf-page://` และประกอบ Canvas Overlay + Invisible Text Layer คืนเอกสาร Searchable PDF
- OCR Processing, Hardware Acceleration & Lifecycle
  - Primary: src/services/ocr/BackgroundQueueProcessor.ts, src/services/ocr/ConcurrencyLimiter.ts
  - Secondary: src-tauri/src/core/process_manager.rs, scripts/external_ocr_bridge.py, src/services/ocr/ocrBackendBootstrap.ts, src/services/ocr/ocrBackendBootstrap.test.ts, src/services/ocr/DirectMLFallbackAndConcurrency.test.ts, src/services/ocr/BoundedPipeline.test.ts, scripts/benchmark_dml_parity.py, docs/dml-parity-benchmark-report.md, docs/adr/0005-directml-runtime-truth-and-pipeline-optimization.md, src/stores/useOCRTextLayerStore.ts, src/components/OCR/EngineSelector/OCREngineSelector.tsx
  - Scope: ควบคุมคิว OCR เบื้องหลังแบบ Bounded 3-Tier Pipeline (`inFlightLimiter=3`, `ocrStageLimiter=1`, `translationStageLimiter=1`), จัดการ Concurrency Slot ปลอดภัยจาก Unhandled Rejection, รองรับ Hardware Discovery (`list-adapters`), Fast DirectML Probe (<0.8s ด้วย ONNX minimal probe), Worker Idempotency ป้องกัน Thrashing Restarts, Single-Flight Boot Sync (`bootstrapOcrBackend` พร้อม Auto-Promotion), DirectML Opt-in พร้อม Fail-Closed Fallback (Default Paddle Native CPU ปลอดภัย 100%), Strict Parity Gate (`rec_batch_num=6`), Zero-Leak OffscreenCanvas Rendering (`canvas.width=0; height=0`), Stdio Protocol Isolation (`_ipc_stdout`), และ IPC ID แบบ Monotonic Sequence ป้องกัน Race Condition
- Offline Translation Pipeline
  - Primary: src/services/translation/translationCoordinator.ts, src/hooks/useDocumentTranslation.ts
  - Secondary: src/hooks/translation/useTranslationCachePersister.ts, src/services/translation/offlineTranslationService.ts, scripts/argos_translate_bridge.py, src-tauri/src/core/translation_manager.rs, docs/adr/0009-argos-ctranslate2-vectorization-and-pipeline-decoupling.md, docs/postmortems/2026-10-14-adr-0009-argos-ctranslate2-optimization-and-queue-bottleneck.md
  - Scope: ประสานงานแปลออฟไลน์ กรองคำสแลง เชื่อมต่อพจนานุกรม และมี Cross-Document Isolation (`persistTranslationResultCore`) ป้องกัน State Bleed ข้ามเอกสารขณะแปลพื้นหลัง พร้อม Vectorized CTranslate2 Batching (`translate_batch`, `max_batch_size=1024`), 4096-entry LRU Cache และ Intra-Batch Deduplication บน Argos NMT Daemon ควบคู่กับ Stdio Protocol Isolation, OpenMP/MKL Thread Tuning, Stage Decoupling (`transQueueWait`), Selective Store Hydration สำหรับ Active Page เท่านั้น และ Multi-Row Chunked SQLite Writes (100 รายการ/batch)
- Text Layer Grouping & Balloon Detection
  - Primary: src/services/layout/balloonAwareGroupingService.ts
  - Secondary: src/services/layers/LayerGroupingService.ts, src/services/native/fastSpatialCluster.ts
  - Scope: จัดกลุ่มบอลลูนคำพูด 2 มิติ คำนวณขอบเขต และรักษาระเบียบการอ่าน
- Database & Persistence
  - Primary: src-tauri/src/core/db.rs, src-tauri/src/commands/database.rs
  - Secondary: src/services/bridge/TauriBridge.ts, src/services/dbService.ts
  - Scope: อ่าน/เขียนฐานข้อมูล SQLite ในเครื่อง (WAL mode) จัดการแคช OCR และ Benchmark

