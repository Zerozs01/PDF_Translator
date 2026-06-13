# OCR Engine Selection Policy

Version: 1.1
Scope: Electron / Offline-first OCR Pipeline
Target Engines: PaddleOCR, EasyOCR
Purpose: Define when each OCR engine should be used, in what order, and under what fallback conditions.

---

## 1. Core Principle

Do not treat all OCR engines as equal.

Each engine has different strengths:

- **PaddleOCR**
  - Best default engine for general-purpose OCR
  - Strong text detection + recognition pipeline
  - Good for mixed layouts, rotated text, scene text, multilingual support
  - Best primary engine for most screenshots, photos, documents, and UI captures

- **EasyOCR**
  - Good fallback engine when PaddleOCR underperforms on stylized or irregular scene text
  - Useful for quick experimentation and some multilingual cases
  - Less ideal as the sole engine in a production pipeline

---

## 2. Recommended Default Order

Primary execution order:

1. **PaddleOCR**
2. **EasyOCR** for hard visual text cases or secondary recovery

Default strategy:

- Start with **PaddleOCR** for most inputs
- Route to **EasyOCR** when the text is visually complex, stylized, low-structure, or scene-like

---

## 3. Input Classification Before OCR

Every image must be classified into one of these categories before selecting an OCR engine:

### A. Clean Document

Characteristics:

- flat background
- mostly black text on white/light paper
- little perspective distortion
- horizontal text lines
- high line regularity
- low background clutter

Preferred engine:

- PaddleOCR

Best choice:

- Use **PaddleOCR** for all document layouts.

---

### B. Camera-Captured Document

Characteristics:

- mobile photo of paper
- uneven lighting
- shadows
- mild perspective distortion
- slight blur or noise

Preferred engine:

- PaddleOCR

Fallback:

- EasyOCR after strong preprocessing or layout normalization.

---

### C. Scene Text / Natural Image Text

Characteristics:

- text on signboards, packaging, labels, screens, posters, UI
- colored background
- non-uniform lighting
- arbitrary font scale or rotation
- background textures

Preferred engine:

- PaddleOCR

Fallback:

- EasyOCR

---

### D. Screenshot / UI Text

Characteristics:

- sharp edges
- digital rendering
- high contrast
- predictable geometry

Preferred engine:

- PaddleOCR

Fallback:

- EasyOCR for stylized titles or mixed-language UI

---

### E. Low-Quality Receipt / Invoice / Thermal Print

Characteristics:

- Faded text
- Broken strokes
- Noisy background
- Curved paper
- Low contrast

Preferred engine:

- PaddleOCR

Fallback:

- EasyOCR if text shape remains inconsistent after preprocessing

---

### F. Small Cropped Single-Line / Single-Word Region

Characteristics:

- Already cropped text ROI
- Recognition more important than detection

Preferred engine:

- PaddleOCR or EasyOCR

---

## 4. Hard Routing Rules

### Use PaddleOCR as primary when

- text detection is needed
- image contains multiple text regions
- text may be rotated
- text is embedded in natural scenes
- layout is unknown
- multilingual OCR is needed
- image comes from camera capture

### Use EasyOCR as primary only when

- PaddleOCR is unavailable
- rapid prototyping is needed
- scene text or stylized text needs a second opinion
- you need an alternate recognizer for comparison

---

## 5. Fallback Rules

Fallback must not be random. Use measurable triggers.

### Trigger fallback when any of these happens

- output text length is suspiciously short
- average confidence below threshold
- too many empty lines
- too many non-language garbage symbols
- bounding boxes found but recognition nearly empty
- known expected pattern fails validation

### Suggested fallback logic

1. Run PaddleOCR
2. Validate output
3. If result is weak:
   - Run EasyOCR
4. If both are weak:
   - retry with alternate preprocessing profile

---

## 6. Confidence Policy

Never trust raw OCR confidence blindly.

Use confidence together with:

- text length
- language validity
- regex validation
- expected character distribution
- line consistency
- duplicate symbol rate

Example:

- confidence 0.90 but output is "I|1|||" => still low-quality
- confidence 0.65 but output matches valid invoice number/date/name => may be acceptable

---

## 7. Task-Specific Recommendations

### General app OCR

- Primary: PaddleOCR
- Fallback: EasyOCR for scene text and complex documents

### PDF page OCR

- If text layer exists: do not OCR
- If scanned or photographed page: PaddleOCR
- Fallback: EasyOCR if layout is complex

### Screenshot OCR

- Primary: PaddleOCR
- Secondary: EasyOCR

### Receipt OCR

- Primary: PaddleOCR
- Secondary: EasyOCR after thermal-print preprocessing

### Stylized poster/signboard OCR

- Primary: PaddleOCR
- Secondary: EasyOCR

### Structured form OCR

- Detection: PaddleOCR
- Recognition/verification: EasyOCR for specific fields if needed

---

## 8. Anti-Patterns

Do not:

- always run all engines on every image
- assume EasyOCR is more robust than PaddleOCR by default
- trust confidence alone
- apply the same preprocessing to every image
- binarize aggressively before scene-text OCR unless tested

---

## 9. Final Operational Policy

Recommended production default:

- **PaddleOCR = system default**
- **EasyOCR = fallback specialist for difficult visual text**

If no classifier exists yet:

- choose PaddleOCR first
- only call EasyOCR when PaddleOCR output is weak on scene/stylized text

---

## 10. Minimal Decision Tree

```text
if text_layer_exists:
    use text extraction, not OCR

else if image_type in [camera_document, receipt, scene_text, mixed_layout, screenshot, clean_document]:
    run PaddleOCR first

    if result weak and image looks like scene/stylized/complex text:
        run EasyOCR
```

---

## 11. Minimal Validation Rules

A result is considered weak when one or more are true:

- mean confidence < 0.70
- extracted text length < expected minimum
- too many replacement/noise characters
- language ratio invalid
- regex pattern for expected field fails
- line segmentation obviously broken

---

## 12. Bottom Line

Use:

- **PaddleOCR for most real-world OCR**
- **EasyOCR as a selective fallback, not the architecture center**

---

```md
# ocr_preprocessing_rules.md

# OCR Preprocessing Rules
Version: 1.0
Scope: PaddleOCR / EasyOCR / Tesseract
Purpose: Define image preprocessing policies that improve OCR accuracy without causing unnecessary distortion.

---

## 1. Core Principle

Preprocessing is not decoration.
It exists to improve text separability, text geometry, and stroke readability.

Bad preprocessing can reduce OCR accuracy even when the original image was acceptable.

Therefore:
- preprocess conditionally
- avoid global over-processing
- use measurable triggers
- keep the pipeline reversible and testable

---

## 2. Golden Rule

Apply the minimum effective transformation.

Priority:
1. fix geometry
2. fix contrast
3. remove destructive noise
4. repair broken strokes only if needed
5. sharpen only when justified

Do not:
- stack many filters blindly
- binarize too early for scene text
- oversharpen small text
- denoise until strokes disappear

---

## 3. Preprocessing Stages

### Stage A: Input Normalization
Standardize the image before any heavy operation.

Actions:
- convert to a known color format
- normalize orientation metadata
- remove alpha channel if present
- preserve original image copy
- record width, height, aspect ratio, bit depth

Recommended:
- keep original RGB copy
- create grayscale working copy only when needed

---

### Stage B: Resolution Handling
Text that is too small will fail regardless of OCR engine.

Rules:
- if text height is too small, upscale before OCR
- avoid repeated resize cycles
- use bilinear or bicubic interpolation
- avoid nearest-neighbor for OCR preprocessing

Guideline:
- upscale only when characters are visibly undersampled
- do not upscale excessively, as fake detail is not real detail

Use cases:
- small UI labels
- compressed screenshots
- low-resolution document crops

---

### Stage C: Geometry Correction
OCR accuracy collapses when text lines are not geometrically stable.

#### 1. Rotation / Deskew
Apply when:
- baseline tilt is visible
- document scan/photo is rotated
- horizontal text lines are not level

Preferred fixes:
- estimate skew angle
- rotate once with proper interpolation
- preserve margins

Important:
- Tesseract benefits heavily from deskew
- PaddleOCR is more tolerant, but still improves with corrected geometry

#### 2. Perspective Correction
Apply when:
- camera photo of document is trapezoidal
- page edges converge
- text line heights vary by position

Use:
- corner detection or contour-based document detection
- perspective warp to flatten the page

Important:
- do this before thresholding
- especially important for receipts, books, forms, and photographed paper

---

## 4. Contrast and Illumination Rules

### 4.1 Global Contrast Adjustment
Apply when:
- text is present but washed out
- foreground/background intensity gap is weak

Good tools:
- linear contrast stretch
- gamma correction

Use gamma:
- brighten dark image
- compress overexposed highlights
- normalize phone camera capture

Avoid:
- global contrast boost when background texture is heavy

---

### 4.2 Local Contrast Enhancement
Apply when:
- lighting is uneven
- one side of page is darker
- shadows or gradients exist

Preferred:
- CLAHE

Use carefully:
- helps faded receipts and uneven document photos
- may amplify background texture if overused

Recommended:
- use mild CLAHE, not aggressive settings

---

## 5. Noise Removal Rules

### 5.1 Salt-and-Pepper Noise
Symptoms:
- isolated black/white dots
- scanner dust
- random impulse artifacts

Preferred:
- median filter

Do not:
- use strong Gaussian blur first

---

### 5.2 Mild Sensor Noise / Compression Noise
Symptoms:
- fine grain
- JPEG artifacts
- light random noise

Preferred:
- mild Gaussian blur
- bilateral filter if edge preservation matters

Trade-off:
- too much smoothing destroys character edges

---

### 5.3 Background Texture Noise
Symptoms:
- paper fibers
- patterned background
- cloth, wall, wood texture behind text

Preferred:
- local contrast separation
- masking
- region cropping
- adaptive threshold only if text/background separation is strong enough

Avoid:
- heavy blur that smears text strokes into background

---

## 6. Binarization Rules

Binarization is highly useful for Tesseract and classic document OCR.
It is not always the best first move for scene text.

### Use global thresholding when:
- background is uniform
- page is clean
- illumination is stable

### Use Otsu when:
- document is mostly bimodal
- grayscale text-vs-background separation is reasonable

### Use adaptive thresholding when:
- illumination is uneven
- receipt print is faded
- shadows exist
- local contrast varies heavily

### Avoid early binarization when:
- text is colored and background is complex
- scene text must preserve subtle gradients
- PaddleOCR detector works better on original RGB/grayscale image

Practical rule:
- **Tesseract often wants better binarization**
- **PaddleOCR often wants cleaner but not necessarily fully binarized input**
- **EasyOCR usually benefits from readable contrast, not aggressive threshold damage**

---

## 7. Morphological Repair Rules

Morphology is for fixing text structure, not for blindly modifying every image.

### Use dilation when:
- text strokes are too faint
- thermal print is broken
- dot-matrix or fragmented characters exist

Risk:
- characters merge together if overapplied

---

### Use erosion when:
- ink bleed causes touching characters
- thick blobs merge into each other

Risk:
- thin characters may disappear

---

### Use opening when:
- tiny isolated foreground specks exist

### Use closing when:
- characters have small internal gaps
- broken strokes need reconnecting

Rule:
- use small kernels
- choose kernel shape based on expected text orientation and scale

Do not:
- apply morphology globally on unknown images without tests

---

## 8. Sharpening Rules

Sharpening is useful only when text edges are soft but still recoverable.

Use when:
- mild blur
- slightly soft screenshot
- phone photo with edge softness

Methods:
- unsharp masking
- Laplacian-based edge enhancement
- mild high-frequency emphasis

Do not sharpen when:
- image already noisy
- JPEG artifacts are strong
- thermal print is fragmented
- blur is severe enough that deblurring would be needed instead

Reason:
- sharpening noise creates fake edges and hurts OCR

---

## 9. Deblurring Rules

Deblurring is expensive and risky.
Do not enable it by default.

Consider only when:
- motion blur or out-of-focus blur is obvious
- text edges are broad and smeared
- ordinary sharpening fails

Options:
- Wiener filtering
- deconvolution
- learned deblur model

Policy:
- use as an optional recovery path
- trigger only if blur score is below threshold
- log its activation because it changes image semantics

---

## 10. Color Handling Rules

### Convert to grayscale when:
- document-style OCR
- clean machine text
- color carries little useful information

### Preserve color or HSV logic when:
- text and background differ more by hue than brightness
- red text on dark blue background
- neon signs
- UI text with colored highlights

Important:
- scene-text OCR may benefit from retaining RGB
- do not force grayscale too early for all inputs

---

## 11. Region Cropping Rules

OCR works better on smaller relevant regions than on full noisy canvases.

Apply cropping when:
- document region can be isolated
- UI panel boundaries are known
- user selects ROI
- detector already found probable text region

Benefits:
- less background confusion
- lower compute cost
- better recognition quality

---

## 12. Engine-Specific Preprocessing Policy

### PaddleOCR
Best with:
- corrected geometry
- good contrast
- moderate denoising
- RGB or readable grayscale
- not always aggressively binarized

Avoid:
- forcing harsh black/white threshold on scene text unless tested

---

### EasyOCR
Best with:
- readable contrast
- reasonable crop quality
- mild denoising
- preserved visual structure

Avoid:
- overprocessed morphology that distorts character shape

---

### Tesseract
Best with:
- deskewed image
- clean binarization
- simple layout
- strong foreground/background separation
- adequate DPI / scale

Avoid:
- feeding raw camera photos without cleanup
- complex textured scene text

---

## 13. Minimal Preprocessing Profiles

### Profile A: Clean Document
- grayscale
- deskew
- Otsu or simple threshold
- optional light median filter
- send to Tesseract or PaddleOCR

### Profile B: Camera Document
- orientation normalize
- perspective correction
- grayscale or keep RGB copy
- CLAHE
- adaptive threshold if needed
- light morphology if strokes are broken
- send to PaddleOCR first

### Profile C: Screenshot / UI
- upscale if tiny
- optional mild sharpen
- preserve RGB or grayscale
- minimal denoise
- send to PaddleOCR first

### Profile D: Receipt / Thermal Print
- grayscale
- CLAHE
- adaptive threshold
- closing or dilation if broken strokes
- deskew
- send to PaddleOCR first, Tesseract second

### Profile E: Scene Text
- preserve RGB
- crop ROI if possible
- mild denoise
- avoid destructive thresholding
- send to PaddleOCR first, EasyOCR second

---

## 14. Validation Rules After Preprocessing

Always verify whether preprocessing helped.

Check:
- character edges clearer?
- text/background separation improved?
- noise reduced without losing strokes?
- connected characters still separable?
- OCR confidence or valid text rate increased?

If not improved:
- revert
- try alternate profile
- do not chain more random filters

---

## 15. Anti-Patterns

Do not:
- always grayscale first
- always threshold first
- always sharpen first
- always denoise first
- always run morphology
- resize multiple times
- apply one universal preprocessing pipeline to every image

---

## 16. Final Operational Policy

Use preprocessing as a controlled decision system:

- fix geometry first
- improve contrast second
- denoise only as needed
- binarize mainly for document OCR
- repair text structure only when broken
- preserve scene-text information unless proven harmful

Bottom line:
- **Tesseract wants stronger preprocessing**
- **PaddleOCR wants smarter preprocessing**
- **EasyOCR wants readable preprocessing**

# ocr_output_schema.md

# OCR Output Schema
Version: 1.0
Scope: PaddleOCR / EasyOCR / Tesseract / Electron OCR Runtime
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
  "engine": "paddleocr | easyocr | tesseract",
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
````

---

## 3. Required Top-Level Fields

### requestId

Unique ID for tracing one OCR job through logs, retries, and fallback.

### engine

The engine that produced the final accepted result:

- paddleocr
- easyocr
- tesseract

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

### Tesseract

May return TSV/HOCR/ALTO-like hierarchy.
Preferred mapping:

- blocks
- lines
- words
- confidence normalized from engine scale if needed

Important:
Do not expose raw engine format directly to app consumers.

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

The UI and business logic must never care whether OCR came from PaddleOCR, EasyOCR, or Tesseract.

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

---

```md
# electron_ocr_runtime_architecture.md

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

OCR on large images can explode memory usage.

Rules:

- downscale oversized images when full resolution is unnecessary
- release intermediate buffers aggressively
- avoid multiple full-frame copies
- use streaming/temp files when needed
- limit concurrent OCR jobs

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
