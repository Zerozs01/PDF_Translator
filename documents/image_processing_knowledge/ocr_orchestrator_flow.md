# OCR Orchestrator Flow

Version: 1.0
Scope: Electron OCR Runtime / PaddleOCR / EasyOCR
Purpose: Define the deterministic end-to-end execution flow for OCR requests from input receipt to final normalized result.

---

## 1. Core Principle

The orchestrator is the control plane of the OCR subsystem.

It does not implement OCR engines directly.
It does not contain renderer UI logic.
It does not perform engine-specific parsing.
It does not decide by guesswork.

Its job is to:

- receive OCR requests
- classify input
- choose preprocessing profile
- choose engine
- execute OCR
- validate results
- trigger controlled fallback
- normalize final output
- return one stable result contract

If this layer is weak, the whole OCR system becomes inconsistent.

---

## 2. Responsibilities

The orchestrator must own these decisions:

1. request acceptance
2. input inspection
3. profile selection
4. engine selection
5. preprocessing execution
6. OCR engine invocation
7. validation
8. fallback routing
9. normalization to app schema
10. metrics/logging hooks

The orchestrator must not own:

- low-level image transform implementations
- raw OCR parser details
- renderer display behavior
- ad hoc task-specific hacks inside UI

---

## 3. Flow Summary

```text
receive request
  -> validate request shape
  -> inspect input metadata
  -> classify input
  -> choose preprocessing profile
  -> preprocess image
  -> choose primary engine
  -> run adapter
  -> normalize raw engine result (intermediate)
  -> validate result
  -> if weak and retry allowed:
       choose fallback path
       rerun with alternate profile or engine
  -> choose final accepted candidate
  -> normalize to unified app schema
  -> return result + metadata
```

This flow must be deterministic and fully traceable.

---

## 4. Input Contract

The orchestrator should accept one request contract.

Example:

```ts
export interface OcrRequest {
  requestId: string;
  taskType:
    | 'free_text'
    | 'document_page'
    | 'receipt'
    | 'invoice'
    | 'screenshot_ui'
    | 'single_line'
    | 'single_word'
    | 'numeric_field';
  source: {
    path?: string | null;
    imageBuffer?: Buffer;
    mimeType?: string | null;
    width?: number;
    height?: number;
  };
  languages: {
    requested: string[];
    allowAutoDetect?: boolean;
  };
  userHints?: {
    profile?: 'clean_document' | 'camera_document' | 'screenshot_ui' | 'receipt_thermal' | 'scene_text';
    isScreenshot?: boolean;
    roi?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
  runtime: {
    timeoutMs: number;
    allowFallback: boolean;
    maxAttempts: number;
  };
}
```

Rules:

- `requestId` is required
- `taskType` is required
- at least one source transport must exist: `path` or `imageBuffer`
- timeout must be explicit
- fallback policy must be explicit

---

## 5. Stage 1: Request Validation

Before doing anything expensive, validate the request itself.

Check:

- requestId exists
- taskType is supported
- source exists
- source path or buffer exists
- timeoutMs is within safe bounds
- language config is structurally valid
- ROI, if present, is valid

If request is invalid:

- fail fast
- do not invoke preprocessing
- do not invoke OCR engine

Example failure reasons:

- invalid_request
- missing_source
- invalid_roi
- unsupported_task_type
- invalid_timeout

---

## 6. Stage 2: Source Inspection

Inspect the input before classifying it.

Extract or infer:

- width
- height
- aspect ratio
- channel count if available
- file type / mime type
- whether alpha exists
- whether image is likely screenshot-like
- whether image is likely document-like

This stage is descriptive, not decisive.
It prepares signals for classification.

---

## 7. Stage 3: Input Classification

The classifier chooses one profile family.

Supported profiles:

- clean_document
- camera_document
- screenshot_ui
- receipt_thermal
- scene_text

Classification inputs may include:

- user hints
- mime type
- aspect ratio
- edge density
- color variance
- texture complexity
- line regularity
- estimated skew
- expected task type

Priority order:

1. explicit user profile hint
2. strong deterministic hint from task type
3. heuristic classifier output
4. safe fallback default

Example:

- `taskType = receipt` strongly biases toward `receipt_thermal`
- `userHints.isScreenshot = true` strongly biases toward `screenshot_ui`

Do not:

- silently ignore explicit user hints unless unsafe
- run classifier twice with different hidden logic

---

## 8. Stage 4: Preprocessing Profile Selection

After classification, select the preprocessing profile config.

Rules:

- exactly one primary profile is selected for attempt 1
- profile must come from versioned config
- applied profile must be logged in metadata
- profile selection must be reproducible

If user supplied valid profile override:

- use it
- record that selection source = user_override

Else:

- use classifier-selected profile
- record selection source = classifier

---

## 9. Stage 5: Engine Selection

Select the primary OCR engine from policy.

Primary rule set:

- PaddleOCR = general default and primary engine
- EasyOCR = fallback engine for difficult visual text or secondary recovery

Suggested mapping:

- clean_document -> PaddleOCR
- camera_document -> PaddleOCR
- screenshot_ui -> PaddleOCR
- receipt_thermal -> PaddleOCR
- scene_text -> PaddleOCR

Additional factors:

- engine availability
- language support
- taskType constraints
- previous failed attempts

Priority order:

1. profile engine preference
2. engine availability
3. task fit
4. fallback history

Do not:

- choose unavailable engines
- choose all engines at once by default
- let adapters override orchestration policy

---

## 10. Stage 6: Preprocessing Execution

Run the selected preprocessing profile on the source image.

Requirements:

- preserve original source
- execute steps in profile order
- stop on fatal transform failure
- record executed steps and parameters
- emit processed image artifact for engine input

Output of this stage should include:

- processed image reference
- preprocessing metadata
- quality signals if available

Example metadata:

- profileId
- profileVersion
- executedSteps
- skippedSteps
- processingDurationMs

---

## 11. Stage 7: OCR Engine Invocation

Invoke the selected adapter with:

- requestId
- taskType
- profile
- processed image
- language config
- timeoutMs

The orchestrator must not care about:

- CLI flags
- Python wrapper details
- stdout parsing rules
- engine-native payload formats

That belongs inside the adapter.

The orchestrator only expects:

- `OcrEngineRawResult`

---

## 12. Stage 8: Intermediate Result Normalization

Before validation, perform intermediate normalization.

Purpose:

- create a consistent comparable candidate object across engines
- normalize confidence scale
- assemble text
- preserve regions
- attach preprocessing metadata
- attach engine metadata

This is not yet the final UI schema.
It is a candidate representation used for evaluation.

Example candidate fields:

- attemptNumber
- engine
- profile
- rawText
- normalizedText
- meanConfidence
- regions
- warnings
- timing
- preprocessingMetadata

---

## 13. Stage 9: Validation

Pass the candidate through the validator.

Validator must return:

- status
- score
- reasons
- signals
- shouldFallback

Possible statuses:

- accepted
- accepted_with_warnings
- weak_result
- rejected

The orchestrator must never skip validation, even if confidence looks high.

Validation decision must combine:

- structural signals
- confidence
- content plausibility
- language fit
- task-specific checks
- layout plausibility

---

## 14. Stage 10: Attempt Decision

After validation, decide whether to stop or continue.

Stop immediately when:

- status = accepted
- status = accepted_with_warnings and fallback not justified
- fallback not allowed
- maxAttempts reached

Continue when:

- status = weak_result or rejected
- allowFallback = true
- remaining attempts exist
- a valid retry plan exists

Do not retry blindly.

---

## 15. Retry Strategy Types

Allowed retry strategies:

### A. Same Engine, Different Profile

Use when:

- engine is still likely suitable
- preprocessing probably caused failure
- example: scene_text mistaken as screenshot_ui

### B. Different Engine, Same Profile

Use when:

- preprocessing seems acceptable
- engine appears to underperform on the current input

### C. Different Engine, Different Profile

Use only when:

- first attempt failed strongly
- classification or preprocessing assumption looks wrong
- retry budget allows it

Do not:

- try every combination exhaustively
- exceed maxAttempts
- hide retry path from metadata

---

## 16. Recommended Retry Matrix

### clean_document

Attempt 1:

- profile = clean_document
- engine = paddleocr

Attempt 2:

- retry with camera_document profile or scene_text profile using paddleocr
  or
- fallback to easyocr

### camera_document

Attempt 1:

- profile = camera_document
- engine = paddleocr

Attempt 2:

- retry with clean_document profile if preprocessing strongly simplified page geometry
  or
- fallback to easyocr

### screenshot_ui

Attempt 1:

- profile = screenshot_ui
- engine = paddleocr

Attempt 2:

- fallback to easyocr if stylized colored text is suspected

### receipt_thermal

Attempt 1:

- profile = receipt_thermal
- engine = paddleocr

Attempt 2:

- receipt_thermal variant without closing if characters merged
  or
- fallback to easyocr

### scene_text

Attempt 1:

- profile = scene_text
- engine = paddleocr

Attempt 2:

- fallback to easyocr
  or
- screenshot_ui if classifier likely misread a digital UI image

---

## 17. Candidate Comparison Rule

When multiple attempts exist, do not always accept the latest one.

Compare candidates using:

- validation status
- score
- regex/task validation success
- mean confidence
- text completeness
- line structure quality
- warning severity

Priority order:

1. accepted over weak_result
2. accepted_with_warnings over weak_result
3. higher validation score
4. better task-specific signals
5. fewer severe warnings
6. better confidence only as secondary tie-breaker

This is critical.
Do not use confidence alone as final winner selection.

---

## 18. Final Normalization

After the best candidate is selected, normalize it into the final app-level OCR schema.

Final output should include:

- unified text fields
- lines / words / blocks if available
- quality object
- metadata
- timing
- selected engine
- selected profile
- fallback history
- validation result
- errors / warnings

At this point, the application layer should no longer care which engine produced the result.

---

## 19. Metadata Requirements

The orchestrator must preserve enough metadata for debugging and benchmarking.

Required:

- requestId
- selected profile
- profile version
- selected engine
- attempts
- executed preprocessing steps
- validation status per attempt
- retry reasons
- final selection reason
- total duration

Without this, tuning becomes guesswork.

---

## 20. Logging Requirements

Log at least:

- request start
- request end
- request duration
- profile selection
- engine selection
- validation result
- fallback activation
- final outcome

Do not log:

- full OCR text by default in production
- raw image buffers
- sensitive content unless explicitly allowed by privacy policy

---

## 21. Timeout and Cancellation Behavior

Timeout and cancellation must propagate through the entire flow.

Requirements:

- if request times out, stop current preprocessing/OCR attempt
- kill subprocesses if needed
- mark unfinished attempts as aborted
- return typed timeout/cancel result
- do not continue fallback after cancellation

Cancellation has higher priority than fallback.

---

## 22. Error Handling Policy

The orchestrator should classify failures into:

- request_error
- preprocessing_error
- adapter_error
- validation_error
- orchestration_error
- timeout
- cancelled

Behavior:

- fail fast for invalid request
- fail current attempt for preprocessing/adapter error
- allow fallback only if policy permits and retry plan remains valid
- always preserve typed failure metadata

Do not:

- swallow errors silently
- collapse all failures into generic "OCR failed"

---

## 23. Pseudocode Example

```ts
async function runOcr(request: OcrRequest): Promise<UnifiedOcrResult> {
  validateRequestOrThrow(request);

  const sourceInfo = await inspectSource(request.source);

  const profile = selectProfile({
    request,
    sourceInfo
  });

  const attempts: OcrAttemptCandidate[] = [];
  let remainingPlan = buildAttemptPlan({
    request,
    initialProfile: profile
  });

  while (remainingPlan.hasNext()) {
    const plan = remainingPlan.next();

    const processed = await preprocess({
      source: request.source,
      profile: plan.profile
    });

    const adapter = adapterRegistry.get(plan.engine);

    const rawResult = await adapter.run({
      requestId: request.requestId,
      profile: plan.profile,
      taskType: request.taskType,
      source: processed.source,
      imageBuffer: processed.imageBuffer,
      tempFilePath: processed.tempFilePath,
      languages: request.languages,
      timeoutMs: request.runtime.timeoutMs
    });

    const candidate = normalizeCandidate({
      request,
      plan,
      processed,
      rawResult
    });

    const validation = validateCandidate(candidate, request.taskType);

    attempts.push({
      ...candidate,
      validation
    });

    if (shouldStop(validation, request.runtime, attempts)) {
      break;
    }

    remainingPlan = updateAttemptPlan({
      request,
      attempts,
      remainingPlan
    });
  }

  const best = selectBestCandidate(attempts);

  return finalizeUnifiedResult({
    request,
    attempts,
    best
  });
}
```

The exact implementation may differ, but this control logic should remain stable.

---

## 24. Anti-Patterns

Do not:

- let UI choose engines directly
- skip classification and always use one profile
- always run all engines in sequence
- always rerun on weak confidence only
- let adapters decide fallback policy
- compare candidates using only confidence
- drop retry metadata
- mutate request semantics mid-flow without recording why

---

## 25. Final Operational Rule

The orchestrator is the deterministic coordinator of OCR execution.

Use it to centralize:

- profile selection
- engine selection
- validation
- fallback
- candidate comparison
- final normalization

Bottom line:
OCR quality does not come from one engine alone.
It comes from a controlled flow that makes the right decisions at the right time.
