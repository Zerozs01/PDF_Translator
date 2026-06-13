# Electron OCR Runtime Architecture

Version: 1.0
Scope: Electron Desktop App / Offline-first OCR System
Target Engines: PaddleOCR, EasyOCR, Tesseract
Purpose: Define a maintainable runtime architecture for integrating OCR engines into an Electron application.

---

## 1. Core Principle

Do not run OCR logic directly inside the renderer.

OCR is CPU-heavy, memory-heavy, and failure-prone.
It must be isolated from UI rendering.

The Electron app should treat OCR as a separate runtime service layer.

Architecture goal:

- keep UI responsive
- isolate engine crashes
- standardize OCR interfaces
- support fallback and benchmarking
- make engine replacement easy

---

## 2. Recommended High-Level Architecture

```text
Renderer UI
  -> IPC Request
Main Process
  -> OCR Orchestrator
      -> Input Classifier
      -> Preprocessing Pipeline
      -> Engine Adapter
          -> PaddleOCR Adapter
          -> EasyOCR Adapter
          -> Tesseract Adapter
      -> Output Normalizer
      -> Result Validator
      -> Fallback Router
      -> Cache / Job Store
````

Renderer only requests OCR and receives normalized results.
Renderer must not manage engine-specific details.

---

## 3. Process Responsibility Split

### Renderer Process

Responsibilities:

- file selection
- screenshot capture
- ROI selection
- progress UI
- result display
- user corrections
- export actions

Must not:

- spawn OCR engines directly
- hold engine-specific logic
- run heavy image pipelines if avoidable

---

### Main Process

Responsibilities:

- receive OCR job requests
- validate input
- dispatch to OCR orchestrator
- coordinate worker processes
- manage cancellation, timeout, retries
- persist logs and cache if needed

---

### OCR Worker Layer

Responsibilities:

- preprocessing
- engine execution
- output normalization
- result validation
- fallback execution

This should run outside the renderer.
Preferred:

- worker thread
- child process
- external Python sidecar if required by engine integration

---

## 4. Recommended Module Structure

```text
src/
  main/
    ipc/
      ocr.ipc.ts
    services/
      ocr/
        orchestrator.ts
        classifier.ts
        validator.ts
        fallback.ts
        cache.ts
        profiles.ts
        schema.ts
        errors.ts
        metrics.ts
      image/
        preprocess.ts
        geometry.ts
        threshold.ts
        morphology.ts
        quality.ts
    adapters/
      paddleocr.adapter.ts
      easyocr.adapter.ts
      tesseract.adapter.ts
    workers/
      ocr.worker.ts

  renderer/
    features/
      ocr/
        hooks/
        state/
        components/
        views/
```

Rule:

- adapter layer must hide engine-specific APIs
- orchestrator must depend on interfaces, not concrete engines
- preprocessing logic must be composable and testable

---

## 5. Adapter Pattern Requirement

Each OCR engine must implement the same interface.

Example:

```ts
export interface OcrEngineAdapter {
  name: 'paddleocr' | 'easyocr' | 'tesseract';

  isAvailable(): Promise<boolean>;

  run(input: OcrEngineInput): Promise<OcrEngineRawResult>;
}
```

Do not let orchestrator know engine-specific argument shapes.

Each adapter handles:

- executable invocation
- model path resolution
- language configuration
- timeout handling
- raw result parsing
- engine-specific errors

---

## 6. Orchestrator Responsibilities

The orchestrator is the system brain.

It must:

1. receive OCR request
2. inspect source metadata
3. classify input type
4. choose preprocessing profile
5. choose primary engine
6. execute OCR
7. normalize output
8. validate quality
9. trigger fallback if needed
10. return unified schema

Do not let UI call engines directly.

---

## 7. Input Classifier

Before OCR begins, classify the input into one profile:

- clean_document
- camera_document
- screenshot_ui
- receipt_thermal
- scene_text

Classifier signals may include:

- aspect ratio
- edge density
- text region distribution
- color variance
- contrast stability
- perspective cues
- background complexity
- user-selected mode

First version may be heuristic, not ML.
That is acceptable.

Important:
A simple deterministic classifier is better than none.

---

## 8. Preprocessing Pipeline Design

Preprocessing must be profile-driven.

Example:

```ts
type OcrProfile =
  | 'clean_document'
  | 'camera_document'
  | 'screenshot_ui'
  | 'receipt_thermal'
  | 'scene_text';
```

Each profile maps to a fixed, testable transformation chain.

Example:

- clean_document -> grayscale -> deskew -> otsu
- camera_document -> perspective warp -> clahe -> adaptive threshold
- screenshot_ui -> optional upscale -> mild sharpen
- receipt_thermal -> clahe -> adaptive threshold -> closing
- scene_text -> preserve rgb -> mild denoise -> crop roi if possible

Avoid:

- one giant universal preprocessing function
- random filter chaining

---

## 9. Engine Execution Strategy

Recommended default:

- primary engine selected by policy
- fallback engine triggered only if validation fails

Do not:

- run all engines every time
- combine engines blindly
- waste CPU on parallel OCR unless benchmark proves value

Preferred logic:

1. run one engine first
2. validate output
3. retry with alternate profile or fallback engine only if needed

This keeps latency and power use under control.

---

## 10. Engine Integration Models

### Option A: Native CLI / Subprocess

Use when engine is exposed via CLI or Python script.

Pros:

- crash isolation
- simple boundary
- easier timeout/kill
- language/runtime agnostic

Cons:

- serialization overhead
- process startup cost

Best for:

- Tesseract
- Python-based PaddleOCR/EasyOCR wrappers

---

### Option B: Worker Thread

Use when preprocessing is implemented in Node side and is CPU-heavy.

Pros:

- better than blocking main thread
- lower overhead than full process spawn

Cons:

- native dependency crashes may still affect app stability

Best for:

- image preprocessing
- validation
- lightweight local transforms

---

### Option C: External Sidecar Service

Use when Python OCR stack becomes complex.

Pros:

- strongest isolation
- easier model lifecycle management
- easier dependency separation

Cons:

- more deployment complexity
- IPC/service management overhead

Best for:

- production app with multiple Python-based OCR engines

---

## 11. Practical Recommendation for Electron

Best pragmatic architecture:

- Electron Main Process = coordinator
- Node worker thread = image preprocessing and orchestration support
- Python subprocess or sidecar = PaddleOCR / EasyOCR
- Tesseract CLI subprocess = Tesseract
- unified schema returned to Electron main, then renderer

This is the cleanest balance of:

- maintainability
- crash isolation
- packaging realism
- performance

---

## 12. Caching Policy

Cache only what is worth reusing.

Good cache targets:

- source image hash
- preprocessing output hash
- OCR final result
- detected profile
- engine selection result

Do not cache:

- huge intermediate buffers blindly
- engine-specific raw junk that app never uses

Cache keys should include:

- image hash
- preprocessing profile version
- engine name
- language config
- app version if schema changes

---

## 13. Timeout and Cancellation Policy

Every OCR job must be cancellable and time-bounded.

Requirements:

- per-job timeout
- manual cancel support
- kill subprocess if timeout exceeded
- propagate cancellation state to UI

Reason:
OCR engines can hang on malformed inputs or oversized images.

Do not trust external processes to exit cleanly on their own.

---

## 14. Error Handling Policy

Classify errors into:

- input errors
- preprocessing errors
- engine launch errors
- engine runtime errors
- normalization errors
- validation failures

Return normalized errors, not raw stderr dumps to UI.

Log raw details internally.
Expose safe summaries externally.

---

## 15. Performance Policy

Optimize for:

- responsiveness first
- deterministic latency second
- maximum throughput third

Rules:

- never block renderer
- avoid unnecessary full-resolution processing
- crop ROI early when possible
- resize only once
- avoid running multiple heavy engines in parallel by default
- warm reusable processes if benchmark proves value

---

## 16. Memory Policy

OCR on large images and daemon processes can explode memory usage over long uptimes.

Rules:

- downscale oversized images when full resolution is unnecessary
- release intermediate buffers aggressively
- avoid multiple full-frame copies
- use streaming/temp files when needed
- limit concurrent OCR jobs
- **Lazy Loading**: Spawn python/engine subprocesses only when explicitly requested, preventing idle resource usage on startup.
- **Explicit Cleanup**: Run garbage collection (`gc.collect()`) and release CUDA cache (e.g. `torch.cuda.empty_cache()` / `paddle.device.cuda.empty_cache()`) immediately after completing each request inside the daemon.
- **Idle Process Lifecycle**: Track inactive workers and automatically terminate daemon processes after 5 minutes of total inactivity.
- **Workspace-based Teardown**: Gracefully kill daemon processes immediately when the active document or workspace is closed by the user.

Recommended:

- queue OCR jobs if user submits many images at once

---

## 17. Benchmarking Policy

You cannot optimize what you do not measure.

Track per engine/profile:

- preprocess time
- OCR time
- total latency
- mean confidence
- accepted vs fallback rate
- memory usage
- regex/task validation success

Benchmark by real task class:

- screenshot
- scanned document
- thermal receipt
- camera document
- scene text

Do not benchmark only on one easy dataset.

---

## 18. Logging and Observability

Every OCR job should log:

- requestId
- input dimensions
- selected profile
- selected engine
- preprocessing steps
- timing
- weak result reasons
- fallback activation
- final acceptance

This is critical for debugging field failures.

---

## 19. Packaging Policy

Do not tightly couple app startup to OCR model initialization if startup cost is high.

Recommended:

- lazy-load engines
- verify engine availability on demand
- store model files in predictable app-managed paths
- version model assets explicitly

For Python-based engines:

- isolate Python environment assumptions
- make executable paths configurable internally
- avoid hidden global system dependency if packaging for end users

---

## 20. Testing Policy

Minimum required tests:

### Unit Tests

- classifier decisions
- preprocessing profile selection
- output normalization
- weak-result detection
- fallback routing

### Integration Tests

- each adapter returns valid schema
- timeout handling works
- cancellation works
- OCR pipeline survives engine failure

### Golden Sample Tests

Keep a fixed dataset of:

- clean documents
- screenshots
- receipts
- noisy photos
- scene text

Verify:

- output text
- line ordering
- validation status
- regression changes over time

---

## 21. Anti-Patterns

Do not:

- run OCR in renderer
- hardcode engine calls into UI components
- let adapters leak engine-specific output upward
- run all engines for every image
- make preprocessing untestable
- ignore timeout/cancel paths
- build fallback rules from intuition only
- assume confidence equals correctness

---

## 22. Final Operational Rule

Electron app architecture should be:

- UI for interaction
- Main process for coordination
- Worker/process layer for heavy OCR execution
- Adapter layer for engine isolation
- Orchestrator for policy and fallback
- Unified schema for all outputs

Bottom line:
Treat OCR as a subsystem, not a utility function.
