# OCR Output Schema

Version: 1.0
Scope: PaddleOCR / EasyOCR / Electron OCR Runtime
Purpose: Define a unified output contract so all OCR engines can be consumed through one consistent interface.

---

## 1. Core Principle

Do not let each OCR engine return its own raw format to the application layer.

All OCR engines must be normalized into one unified schema.

This prevents:

- engine-specific branching everywhere
- fragile UI logic
- inconsistent confidence handling
- duplicated parsing logic
- vendor lock-in at the application layer

The application must consume one schema only.

---

## 2. Top-Level Output Contract

```json
{
  "requestId": "string",
  "engine": "paddleocr | easyocr",
  "profile": "clean_document | camera_document | screenshot_ui | receipt_thermal | scene_text",
  "source": {
    "path": "string | null",
    "width": 0,
    "height": 0,
    "channels": 0,
    "mimeType": "string | null"
  },
  "timing": {
    "preprocessMs": 0,
    "ocrMs": 0,
    "postprocessMs": 0,
    "totalMs": 0
  },
  "quality": {
    "meanConfidence": 0,
    "textDensity": 0,
    "isWeakResult": false,
    "weakReasons": []
  },
  "text": {
    "fullText": "string",
    "normalizedText": "string"
  },
  "language": {
    "requested": ["string"],
    "detected": ["string"]
  },
  "blocks": [],
  "lines": [],
  "words": [],
  "symbols": [],
  "metadata": {
    "rotationApplied": 0,
    "deskewApplied": false,
    "perspectiveCorrected": false,
    "binarized": false,
    "preprocessingSteps": [],
    "fallbackFrom": null,
    "validationPassed": true
  },
  "errors": []
}
```

---

## 3. Required Top-Level Fields

### requestId

Unique ID for tracing one OCR job through logs, retries, and fallback.

### engine

The engine that produced the final accepted result:

- paddleocr
- easyocr

### profile

The preprocessing/routing profile used:

- clean_document
- camera_document
- screenshot_ui
- receipt_thermal
- scene_text

### source

Stores source image metadata.

### timing

Stores stage timing for performance analysis.

### quality

Stores result-level quality metrics.

### text

Stores extracted text in raw and normalized forms.

### blocks / lines / words / symbols

Hierarchical OCR structures.
Not every engine will provide all levels natively.
Missing levels may be synthesized during postprocessing.

### metadata

Stores operational facts about the pipeline.

### errors

Operational or semantic errors encountered during OCR.

---

## 4. Source Object

```json
{
  "path": "string | null",
  "width": 1920,
  "height": 1080,
  "channels": 3,
  "mimeType": "image/png"
}
```

Rules:

- `path` may be null for in-memory input
- width and height are required
- channels should reflect actual processed input
- mimeType may be inferred if unavailable

---

## 5. Timing Object

```json
{
  "preprocessMs": 18,
  "ocrMs": 243,
  "postprocessMs": 7,
  "totalMs": 268
}
```

Rules:

- all times are milliseconds
- `totalMs` must reflect end-to-end latency
- timing is required for benchmarking and fallback tuning

---

## 6. Quality Object

```json
{
  "meanConfidence": 0.87,
  "textDensity": 0.13,
  "isWeakResult": false,
  "weakReasons": []
}
```

### meanConfidence

Average line-level or word-level confidence after normalization to 0..1.

### textDensity

Approximate ratio of text-covered area to total image area.

### isWeakResult

Boolean summary used for fallback decisions.

### weakReasons

Examples:

- low_confidence
- suspiciously_short_text
- invalid_language_ratio
- regex_validation_failed
- too_many_noise_symbols
- no_text_detected
- line_structure_broken

Important:

- `isWeakResult` must not be based on confidence alone

---

## 7. Text Object

```json
{
  "fullText": "RAW OCR OUTPUT",
  "normalizedText": "normalized ocr output"
}
```

### fullText

Raw engine output with line breaks preserved as much as possible.

### normalizedText

Normalized version used for search, comparison, and validation.

Normalization may include:

- Unicode normalization
- whitespace collapsing
- newline cleanup
- punctuation cleanup
- common OCR symbol repair only if rule-based and safe

Do not:

- silently destroy meaningful formatting
- overwrite raw output with normalized output

---

## 8. Language Object

```json
{
  "requested": ["en", "th"],
  "detected": ["en"]
}
```

Use:

- `requested` for the app input configuration
- `detected` for post-OCR language analysis

If unknown:

- return empty array, not null

---

## 9. Geometric Primitive

Every block/line/word/symbol item may contain polygon geometry.

Standard polygon format:

```json
[[x1, y1], [x2, y2], [x3, y3], [x4, y4]]
```

Rules:

- clockwise or counterclockwise is acceptable, but stay consistent
- use integer pixels when possible
- if engine gives only rectangle:

  - convert to 4-point polygon
- also store axis-aligned bbox for convenience

Axis-aligned bbox format:

```json
{
  "x": 0,
  "y": 0,
  "width": 100,
  "height": 20
}
```

---

## 10. Line Object

```json
{
  "id": "line_001",
  "blockId": "block_001",
  "text": "Total 129.00",
  "normalizedText": "total 129.00",
  "confidence": 0.91,
  "polygon": [[10, 20], [210, 20], [210, 50], [10, 50]],
  "bbox": {
    "x": 10,
    "y": 20,
    "width": 200,
    "height": 30
  },
  "angle": 0,
  "wordIds": ["word_001", "word_002"]
}
```

Required fields:

- id
- text
- confidence
- bbox

Preferred fields:

- polygon
- normalizedText
- blockId
- angle
- wordIds

---

## 11. Word Object

```json
{
  "id": "word_001",
  "lineId": "line_001",
  "text": "Total",
  "normalizedText": "total",
  "confidence": 0.95,
  "polygon": [[10, 20], [90, 20], [90, 50], [10, 50]],
  "bbox": {
    "x": 10,
    "y": 20,
    "width": 80,
    "height": 30
  },
  "symbolIds": []
}
```

If word segmentation is unavailable from engine:

- synthesize only if reliable
- otherwise leave `words` empty

Do not hallucinate fine-grained segmentation

---

## 12. Block Object

```json
{
  "id": "block_001",
  "type": "text",
  "confidence": 0.88,
  "polygon": [[8, 18], [212, 18], [212, 120], [8, 120]],
  "bbox": {
    "x": 8,
    "y": 18,
    "width": 204,
    "height": 102
  },
  "lineIds": ["line_001", "line_002", "line_003"]
}
```

Block type examples:

- text
- table_cell
- title
- caption
- unknown

If engine does not support block grouping:

- group lines heuristically only if deterministic enough
- otherwise emit one block per line group or omit blocks

---

## 13. Symbol Object

Use only when engine or postprocessor can provide character-level data reliably.

```json
{
  "id": "symbol_001",
  "wordId": "word_001",
  "text": "T",
  "confidence": 0.96,
  "bbox": {
    "x": 10,
    "y": 20,
    "width": 14,
    "height": 30
  }
}
```

Rules:

- optional
- do not fabricate symbol boxes from proportional text width guesses

---

## 14. Metadata Object

```json
{
  "rotationApplied": -1.8,
  "deskewApplied": true,
  "perspectiveCorrected": false,
  "binarized": true,
  "preprocessingSteps": [
    "grayscale",
    "clahe",
    "adaptive_threshold",
    "deskew"
  ],
  "fallbackFrom": "paddleocr",
  "validationPassed": true
}
```

### preprocessingSteps

Allowed examples:

- orientation_normalize
- rgb_preserved
- grayscale
- upscale_2x
- gamma_correction
- clahe
- median_filter
- bilateral_filter
- otsu_threshold
- adaptive_threshold
- deskew
- perspective_warp
- dilation
- erosion
- opening
- closing
- sharpen
- crop_roi

This field is critical for debugging.

---

## 15. Errors Array

Example:

```json
[
  {
    "code": "NO_TEXT_DETECTED",
    "message": "OCR engine returned no text regions"
  }
]
```

Error codes may include:

- NO_TEXT_DETECTED
- ENGINE_TIMEOUT
- ENGINE_CRASH
- INVALID_IMAGE
- UNSUPPORTED_FORMAT
- LOW_QUALITY_RESULT
- PREPROCESS_FAILED
- POSTPROCESS_FAILED

Rules:

- errors do not always mean job failure
- weak but usable results may still return output plus warnings

---

## 16. Normalization Rules Across Engines

### PaddleOCR

Usually returns polygons, text, confidence.
Map naturally into:

- lines
- optional blocks
- fullText assembled from line ordering

### EasyOCR

Usually returns text segments with boxes and confidence.
Map into:

- lines or words depending on granularity
- assemble fullText by spatial ordering

### Tesseract (Deprecated & Removed)

Tesseract engine has been completely removed from the pipeline.

---

## 17. Spatial Ordering Rules

When assembling `fullText`:

- sort by reading order
- prefer top-to-bottom, then left-to-right for horizontal scripts
- merge nearby words into lines using stable distance thresholds
- preserve paragraph/line breaks when confidence is sufficient

Do not:

- concatenate everything by confidence rank
- flatten all text into one line

---

## 18. Weak Result Policy

Set `quality.isWeakResult = true` when one or more are true:

- meanConfidence below threshold
- extracted text length too short for expected task
- output dominated by symbols/noise
- line order clearly broken
- validation rules fail
- text boxes exist but text content is mostly empty

This field should directly support fallback routing.

---

## 19. Final Contract Rule

The UI and business logic must never care whether OCR came from PaddleOCR or EasyOCR.

They must consume:

- `text.fullText`
- `lines`
- `quality`
- `metadata`
- `errors`

Everything else is internal detail.

Bottom line:
One app-level OCR schema.
No engine-specific leakage above the adapter layer.
