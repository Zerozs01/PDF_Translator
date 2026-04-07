# OCR Adapter Contract (TypeScript)

Version: 1.0
Scope: PaddleOCR / EasyOCR / Tesseract / Electron OCR Runtime
Purpose: Define the TypeScript contracts for integrating OCR engines behind one stable adapter interface.

---

## 1. Core Principle

Do not let the orchestrator talk to OCR engines in their native raw formats.

Each OCR engine must be wrapped by an adapter that:

- accepts a normalized engine input
- returns a raw-but-structured engine result
- exposes availability and metadata in a consistent way
- isolates engine-specific launch and parsing logic

The orchestrator must depend on interfaces, not implementations.

---

## 2. Design Goals

This contract must guarantee:

- one adapter interface for all OCR engines
- one shared engine input model
- one shared raw result envelope
- one shared engine capability description
- deterministic error handling
- swappable engine implementations

This contract is not the final app-level OCR schema.
It sits between:

- runtime orchestration
- engine-specific execution

Flow:

- orchestrator -> adapter -> raw engine result -> normalizer -> unified OCR schema

---

## 3. Recommended File Name

Recommended runtime filename:

- `ocr-engine-adapter.ts`

This markdown file defines the contract and a production-ready starter structure.

---

## 4. TypeScript Contract

```ts
export type OcrEngineName = 'paddleocr' | 'easyocr' | 'tesseract';

export type OcrProfile =
  | 'clean_document'
  | 'camera_document'
  | 'screenshot_ui'
  | 'receipt_thermal'
  | 'scene_text';

export type OcrTaskType =
  | 'free_text'
  | 'document_page'
  | 'receipt'
  | 'invoice'
  | 'screenshot_ui'
  | 'single_line'
  | 'single_word'
  | 'numeric_field';

export interface ImageSourceRef {
  path?: string | null;
  mimeType?: string | null;
  width: number;
  height: number;
  channels?: number | null;
}

export interface OcrLanguageConfig {
  requested: string[];
  allowAutoDetect?: boolean;
}

export interface OcrEngineInput {
  requestId: string;
  profile: OcrProfile;
  taskType: OcrTaskType;
  source: ImageSourceRef;
  imageBuffer?: Buffer;
  tempFilePath?: string | null;
  languages: OcrLanguageConfig;
  timeoutMs: number;
  metadata?: Record<string, unknown>;
}

export interface OcrEngineCapability {
  engine: OcrEngineName;
  supportsDetection: boolean;
  supportsRecognition: boolean;
  supportsAngleClassification: boolean;
  supportsWordLevelBoxes: boolean;
  supportsLineLevelBoxes: boolean;
  supportsSymbolLevelBoxes: boolean;
  supportsStructuredOutput: boolean;
  supportsMultiLanguage: boolean;
  requiresExternalRuntime: boolean;
}

export interface OcrEngineHealth {
  available: boolean;
  version?: string | null;
  details?: string | null;
}

export interface OcrEngineWarning {
  code: string;
  message: string;
}

export interface OcrPolygon {
  points: [number, number][];
}

export interface OcrBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrRawTextRegion {
  id: string;
  level: 'block' | 'line' | 'word' | 'symbol' | 'unknown';
  text: string;
  confidence: number | null;
  polygon?: OcrPolygon | null;
  bbox?: OcrBoundingBox | null;
  angle?: number | null;
  parentId?: string | null;
  childrenIds?: string[];
  raw?: Record<string, unknown>;
}

export interface OcrEngineRawResult {
  requestId: string;
  engine: OcrEngineName;
  profile: OcrProfile;
  taskType: OcrTaskType;
  success: boolean;
  rawText: string;
  meanConfidence: number | null;
  regions: OcrRawTextRegion[];
  warnings: OcrEngineWarning[];
  timing: {
    startedAt: string;
    finishedAt: string;
    durationMs: number;
  };
  rawPayload?: unknown;
  stderr?: string | null;
  stdout?: string | null;
}

export interface OcrEngineAdapter {
  readonly name: OcrEngineName;

  getCapabilities(): OcrEngineCapability;

  isAvailable(): Promise<OcrEngineHealth>;

  run(input: OcrEngineInput): Promise<OcrEngineRawResult>;
}
````

---

## 5. Contract Explanation

### OcrEngineName

The list of supported engines is intentionally narrow:

- paddleocr
- easyocr
- tesseract

Do not use arbitrary string names across the codebase.

---

### OcrProfile

This must match the preprocessing profile system exactly.

Do not let adapters invent profile names.
Profiles are selected by the orchestrator, not by adapters.

---

### OcrTaskType

Task type exists because engine parameters may differ by task.

Examples:

- `single_line` may imply different Tesseract PSM
- `receipt` may imply different postprocessing expectations
- `numeric_field` may imply stricter whitelist behavior

Adapters may use task type to map into engine-specific flags.
They must not reinterpret task type semantically beyond execution tuning.

---

### ImageSourceRef

Describes the processed image that will be sent to the OCR engine.

Rules:

- width and height are required
- path is optional
- `imageBuffer` and `tempFilePath` may coexist
- if engine only accepts file path, adapter may require tempFilePath
- renderer must never construct this directly for engine use

---

### OcrLanguageConfig

Language behavior must be explicit.

Use:

- `requested` for desired language list
- `allowAutoDetect` only when supported by engine/runtime policy

Do not:

- silently auto-detect when the app requested fixed language behavior

---

## 6. Capability Contract

`getCapabilities()` is required because not all engines support the same granularity.

Examples:

- Tesseract may support structured word-level output better than EasyOCR
- PaddleOCR may support detection + recognition strongly
- EasyOCR may provide region outputs but with different granularity

This allows the orchestrator and normalizer to:

- make safe assumptions
- avoid requesting unsupported detail
- benchmark engine fit per task

Capability must be static or شبه-static for a given adapter build.

Do not make it depend on a random runtime mood.

---

## 7. Availability Contract

`isAvailable()` must be lightweight and deterministic.

It should verify:

- executable presence if needed
- model/resource availability if required
- adapter can actually launch the engine

It must return:

- `available = true` only when the engine is operational enough to be called
- `version` if known
- `details` if some diagnostic context is useful

Do not:

- perform full OCR inference just to answer availability
- crash on missing dependency
- throw for simple unavailability unless the runtime truly failed unexpectedly

---

## 8. Run Contract

`run(input)` is the only execution entry point.

It must:

- respect timeoutMs
- return a valid `OcrEngineRawResult`
- throw only for exceptional adapter failures
- prefer structured warning/error capture over untyped crash behavior

The adapter is responsible for:

- engine invocation
- argument mapping
- temp file handling if required
- parsing stdout/stderr or API result
- confidence normalization if possible
- region extraction when available

It is not responsible for:

- fallback policy
- final app-level schema normalization
- final business acceptance validation

---

## 9. Raw Result Envelope

`OcrEngineRawResult` is intentionally not the final user-facing schema.

It exists so the normalizer has access to:

- raw text
- region hierarchy
- timing
- engine warnings
- raw payload for debugging
- stdout/stderr for internal logs

The application layer must not consume this directly.

---

## 10. Confidence Rules

`confidence` and `meanConfidence` must be normalized into 0..1 when possible.

If engine confidence is unavailable or unreliable:

- set `confidence` to null
- do not fabricate numbers

Do not:

- assume all engines use the same confidence scale
- average invalid values as if they were real
- convert unknown confidence into zero unless explicitly intended

---

## 11. Geometry Rules

Every `OcrRawTextRegion` may provide:

- polygon
- bbox
- angle

At minimum, provide `bbox` if possible.
If both polygon and bbox exist:

- bbox should be derived or consistent with polygon

If engine gives only rectangular boxes:

- convert to bbox
- optionally derive polygon with 4 corners

Do not emit impossible geometry:

- negative width/height
- NaN coordinates
- zero-area boxes unless raw engine truly emitted them and they are flagged

---

## 12. Region Hierarchy Rules

`regions` should preserve as much engine structure as possible.

Recommended levels:

- block
- line
- word
- symbol
- unknown

Use:

- `parentId` for upward relation
- `childrenIds` for downward relation

If the engine only provides line-like regions:

- emit line level
- do not hallucinate blocks or symbols

If the engine provides TSV/HOCR-like hierarchy:

- preserve it faithfully

---

## 13. Warning Contract

Adapters should capture recoverable issues as warnings, not crashes.

Examples:

- low_confidence_output
- partial_output
- language_fallback_used
- angle_classifier_unavailable
- structured_boxes_missing
- stderr_nonfatal

Example:

```ts
const warnings: OcrEngineWarning[] = [
  {
    code: 'STRUCTURED_BOXES_MISSING',
    message: 'Engine returned text but no reliable word-level boxes.'
  }
];
```

This helps downstream logic stay deterministic.

---

## 14. Error Handling Rule

There are 2 error classes:

### A. Recoverable engine result

Engine ran, but output quality is weak.
This should return:

- `success: true` or `success: false` depending on adapter policy
- warnings populated
- raw text and raw payload if available

### B. Exceptional adapter failure

Examples:

- subprocess spawn failed
- parser crashed
- timeout kill failed
- malformed engine response beyond recovery

This may throw, but should prefer typed internal errors in the real implementation.

Do not:

- dump raw stderr directly into UI-facing layers
- treat every weak OCR result as thrown exception

---

## 15. Minimal Typed Error Model

Recommended internal extension:

```ts
export type OcrAdapterErrorCode =
  | 'ENGINE_UNAVAILABLE'
  | 'ENGINE_TIMEOUT'
  | 'ENGINE_PROCESS_FAILED'
  | 'ENGINE_RESPONSE_INVALID'
  | 'TEMP_FILE_ERROR'
  | 'UNSUPPORTED_INPUT'
  | 'ADAPTER_INTERNAL_ERROR';

export class OcrAdapterError extends Error {
  public readonly code: OcrAdapterErrorCode;
  public readonly engine: OcrEngineName;
  public readonly cause?: unknown;

  constructor(params: {
    code: OcrAdapterErrorCode;
    engine: OcrEngineName;
    message: string;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = 'OcrAdapterError';
    this.code = params.code;
    this.engine = params.engine;
    this.cause = params.cause;
  }
}
```

This is strongly recommended even if the first implementation is simpler.

---

## 16. Recommended Base Adapter Shape

A shared base class is optional, but useful for subprocess-based engines.

Example:

```ts
export abstract class BaseOcrEngineAdapter implements OcrEngineAdapter {
  public abstract readonly name: OcrEngineName;

  public abstract getCapabilities(): OcrEngineCapability;

  public abstract isAvailable(): Promise<OcrEngineHealth>;

  public abstract run(input: OcrEngineInput): Promise<OcrEngineRawResult>;

  protected nowIso(): string {
    return new Date().toISOString();
  }

  protected normalizeConfidence(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }

    if (value < 0) return 0;
    if (value > 1) return value <= 100 ? value / 100 : 1;

    return value;
  }
}
```

Do not overabstract early.
Only share what is truly common.

---

## 17. Example Capability Definitions

### PaddleOCR

```ts
export const paddleOcrCapabilities: OcrEngineCapability = {
  engine: 'paddleocr',
  supportsDetection: true,
  supportsRecognition: true,
  supportsAngleClassification: true,
  supportsWordLevelBoxes: false,
  supportsLineLevelBoxes: true,
  supportsSymbolLevelBoxes: false,
  supportsStructuredOutput: true,
  supportsMultiLanguage: true,
  requiresExternalRuntime: true
};
```

### EasyOCR

```ts
export const easyOcrCapabilities: OcrEngineCapability = {
  engine: 'easyocr',
  supportsDetection: true,
  supportsRecognition: true,
  supportsAngleClassification: false,
  supportsWordLevelBoxes: false,
  supportsLineLevelBoxes: true,
  supportsSymbolLevelBoxes: false,
  supportsStructuredOutput: true,
  supportsMultiLanguage: true,
  requiresExternalRuntime: true
};
```

### Tesseract

```ts
export const tesseractCapabilities: OcrEngineCapability = {
  engine: 'tesseract',
  supportsDetection: false,
  supportsRecognition: true,
  supportsAngleClassification: false,
  supportsWordLevelBoxes: true,
  supportsLineLevelBoxes: true,
  supportsSymbolLevelBoxes: true,
  supportsStructuredOutput: true,
  supportsMultiLanguage: true,
  requiresExternalRuntime: true
};
```

These values may vary by exact integration, but the contract shape should stay fixed.

---

## 18. Example Adapter Skeletons

### PaddleOCR Adapter

```ts
export class PaddleOcrAdapter extends BaseOcrEngineAdapter {
  public readonly name = 'paddleocr' as const;

  public getCapabilities(): OcrEngineCapability {
    return paddleOcrCapabilities;
  }

  public async isAvailable(): Promise<OcrEngineHealth> {
    return {
      available: true,
      version: null,
      details: null
    };
  }

  public async run(input: OcrEngineInput): Promise<OcrEngineRawResult> {
    const startedAt = this.nowIso();

    // invoke Python wrapper or subprocess here
    // parse output here

    return {
      requestId: input.requestId,
      engine: this.name,
      profile: input.profile,
      taskType: input.taskType,
      success: true,
      rawText: '',
      meanConfidence: null,
      regions: [],
      warnings: [],
      timing: {
        startedAt,
        finishedAt: this.nowIso(),
        durationMs: 0
      },
      rawPayload: null,
      stderr: null,
      stdout: null
    };
  }
}
```

### EasyOCR Adapter

```ts
export class EasyOcrAdapter extends BaseOcrEngineAdapter {
  public readonly name = 'easyocr' as const;

  public getCapabilities(): OcrEngineCapability {
    return easyOcrCapabilities;
  }

  public async isAvailable(): Promise<OcrEngineHealth> {
    return {
      available: true,
      version: null,
      details: null
    };
  }

  public async run(input: OcrEngineInput): Promise<OcrEngineRawResult> {
    const startedAt = this.nowIso();

    return {
      requestId: input.requestId,
      engine: this.name,
      profile: input.profile,
      taskType: input.taskType,
      success: true,
      rawText: '',
      meanConfidence: null,
      regions: [],
      warnings: [],
      timing: {
        startedAt,
        finishedAt: this.nowIso(),
        durationMs: 0
      },
      rawPayload: null,
      stderr: null,
      stdout: null
    };
  }
}
```

### Tesseract Adapter

```ts
export class TesseractAdapter extends BaseOcrEngineAdapter {
  public readonly name = 'tesseract' as const;

  public getCapabilities(): OcrEngineCapability {
    return tesseractCapabilities;
  }

  public async isAvailable(): Promise<OcrEngineHealth> {
    return {
      available: true,
      version: null,
      details: null
    };
  }

  public async run(input: OcrEngineInput): Promise<OcrEngineRawResult> {
    const startedAt = this.nowIso();

    return {
      requestId: input.requestId,
      engine: this.name,
      profile: input.profile,
      taskType: input.taskType,
      success: true,
      rawText: '',
      meanConfidence: null,
      regions: [],
      warnings: [],
      timing: {
        startedAt,
        finishedAt: this.nowIso(),
        durationMs: 0
      },
      rawPayload: null,
      stderr: null,
      stdout: null
    };
  }
}
```

---

## 19. Engine-Specific Mapping Rules

Adapters may map shared input into engine-specific flags.

Examples:

### Tesseract

May map:

- `taskType: single_line` -> psm tuned for single line
- `taskType: single_word` -> psm tuned for single word
- `languages.requested` -> `-l eng+tha`

### PaddleOCR

May map:

- `profile` -> angle classifier on/off
- `languages.requested` -> model/lang selection
- `taskType` -> detection/recognition mode tuning if supported

### EasyOCR

May map:

- `languages.requested` -> reader language list
- `profile` -> optional detail level
- `taskType` -> postparse expectations

But adapters must not leak those flags upward into orchestrator logic.

---

## 20. Input Transport Rules

An adapter may prefer:

- image buffer
- temp file path
- source path

Policy:

- orchestrator may provide both buffer and temp file path
- adapter chooses what it needs
- adapter must not require renderer-specific file assumptions

Recommended:

- standardize temp file lifecycle outside adapter when possible
- keep adapter focused on engine invocation, not app file management chaos

---

## 21. Timeout Rules

Adapters must respect `timeoutMs`.

Required behavior:

- start timed execution
- kill subprocess or reject long-running call on timeout
- throw typed timeout error or return typed failure according to adapter policy

Do not:

- ignore timeoutMs
- leave orphan OCR processes running
- wait forever for stalled stdout

---

## 22. Logging Rules

Adapters should not own full application logging policy, but they should emit enough context for diagnostics.

Useful internal log fields:

- requestId
- engine
- command path
- argument summary
- durationMs
- timeoutMs
- warning count
- region count

Do not log:

- full sensitive OCR content by default
- raw image buffers
- giant payload dumps in production logs

---

## 23. Testing Requirements

Minimum tests per adapter:

### Unit

- capability object shape
- confidence normalization
- parser behavior on valid engine payload
- parser behavior on malformed payload
- timeout path

### Integration

- isAvailable on actual environment
- run on golden sample image
- output envelope shape valid
- raw regions mapped correctly

### Failure Cases

- missing executable
- missing model
- invalid temp path
- timeout exceeded
- empty OCR output

Do not ship adapters untested.
This layer is where OCR integration usually becomes brittle.

---

## 24. Anti-Patterns

Do not:

- let orchestrator call subprocesses directly
- put engine-specific parsing in normalizer
- return different object shapes per engine
- fabricate confidence values
- fabricate word/symbol boxes when engine never returned them
- mix final app schema with raw engine schema
- hardcode engine selection inside adapters
- store UI concerns in adapter layer

---

## 25. Final Operational Rule

The adapter layer exists to isolate volatility.

Use it to contain:

- engine runtime differences
- parser differences
- confidence differences
- output granularity differences
- dependency/runtime differences

Bottom line:
The orchestrator should know which engine it wants.
The adapter should know how to talk to that engine.
Everything else should stay outside this boundary.
