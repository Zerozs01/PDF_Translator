# OCR Classifier Rules

Version: 1.0
Scope: Electron OCR Runtime / PaddleOCR / EasyOCR / Tesseract
Purpose: Define deterministic rules for classifying OCR input into the correct preprocessing and engine-selection profile.

---

## 1. Core Principle

The classifier does not decide what the final OCR text should be.

Its only job is to classify the input image into the most appropriate OCR profile.

Supported profile classes:

- clean_document
- camera_document
- screenshot_ui
- receipt_thermal
- scene_text

This classifier must be:

- deterministic
- explainable
- testable
- cheap to run

Do not build a vague black-box classifier before you have benchmarked a strong rule-based version.

---

## 2. Why Classification Matters

Classification drives:

- preprocessing profile selection
- primary engine selection
- validation expectations
- fallback planning

If classification is wrong:

- the wrong transforms get applied
- OCR quality drops
- fallback costs increase
- debugging becomes harder

So the classifier is not optional.
It is a control layer.

---

## 3. Input Signals

The classifier may use only cheap, deterministic signals available before OCR.

Recommended signal groups:

### A. Source Hints

- file extension
- mime type
- user-selected mode
- screenshot flag
- taskType
- ROI presence

### B. Geometry Signals

- width
- height
- aspect ratio
- estimated skew
- rectangular page contour presence
- perspective distortion cues

### C. Visual Signals

- color variance
- grayscale dominance
- edge density
- local contrast variance
- background uniformity
- text-line regularity estimate
- texture complexity
- highlight/shadow presence

### D. Structural Signals

- presence of page-like border
- long horizontal text-line patterns
- column-like structure
- receipt-like narrow tall layout
- UI-like rectangular widgets
- scene-like clutter

Do not use OCR output itself in the first-stage classifier.
This classifier must run before OCR.

---

## 4. Classification Order of Authority

When multiple signals exist, follow this priority:

1. explicit user override
2. hard taskType bias
3. strong source hint
4. strong structural/visual evidence
5. safe default fallback

Example:

- if user explicitly selects screenshot_ui, use screenshot_ui unless the input is invalid
- if taskType is receipt, bias strongly toward receipt_thermal
- if source is clearly a PNG screen capture with flat UI structure, bias toward screenshot_ui

Do not let weak heuristics override strong explicit intent.

---

## 5. Supported Output

Classifier must return a structured result, not just a string.

Example:

```ts
export type OcrProfile =
  | 'clean_document'
  | 'camera_document'
  | 'screenshot_ui'
  | 'receipt_thermal'
  | 'scene_text';

export interface OcrClassifierResult {
  profile: OcrProfile;
  confidenceBand: 'high' | 'medium' | 'low';
  reasons: string[];
  signals: Record<string, number | boolean | string | null>;
}
````

Rules:

- `profile` is required
- `confidenceBand` is required
- `reasons` must be human-readable and deterministic
- `signals` should preserve the key metrics that led to the decision

---

## 6. Hard Overrides

The classifier should accept explicit override inputs.

Examples:

- `userHints.profile`
- `userHints.isScreenshot`
- `taskType = receipt`
- `taskType = screenshot_ui`

### Override policy

- explicit `userHints.profile` wins
- strong taskType may bias or override if user did not explicitly choose a profile
- invalid override should be rejected or ignored with logged reason

Do not silently discard explicit profile overrides.

---

## 7. Profile Definitions

### clean_document

Typical properties:

- flat page
- near-horizontal text lines
- mostly dark text on light background
- low clutter
- little perspective distortion
- medium-to-high line regularity
- often scanned or high-quality photographed page

### camera_document

Typical properties:

- paper captured by phone camera
- mild or visible perspective distortion
- shadows or uneven lighting
- page contour may be visible
- skew likely
- still document-like, but not flat-clean

### screenshot_ui

Typical properties:

- digital rendering
- crisp edges
- flat color regions
- rectangular UI components
- sharp text
- little sensor noise
- often PNG or direct screen capture

### receipt_thermal

Typical properties:

- narrow tall layout
- faded low-contrast print
- broken strokes
- repetitive line-item structure
- mostly grayscale or washed-out tone
- receipt-like aspect ratio or content intent

### scene_text

Typical properties:

- text embedded in natural image
- cluttered or textured background
- colorful or irregular lighting
- arbitrary perspective
- poster/sign/label/packaging style
- no strong page or UI structure

---

## 8. Base Heuristic Features

Below are the main heuristic features.

### 8.1 Screenshot Likelihood

Strong positive indicators:

- source hint says screenshot
- PNG with alpha or flat UI palette
- extremely sharp edges
- low sensor-like noise
- many flat-color regions
- rectangular component boundaries
- uniform rendering style

Negative indicators:

- perspective distortion
- camera shadows
- paper contour
- natural texture background

---

### 8.2 Document Likelihood

Strong positive indicators:

- large near-rectangular page region
- light background dominates
- long horizontal line clusters
- paragraph-like spacing
- low background clutter
- moderate skew but readable line structure

Negative indicators:

- heavily textured background
- irregular non-page composition
- UI widgets or scene objects dominate

---

### 8.3 Camera Capture Likelihood

Strong positive indicators:

- perspective skew
- shadow gradients
- highlight glare
- uneven illumination
- page contour not axis-aligned
- slight blur or camera noise

Negative indicators:

- perfectly flat text rasterization
- no lighting variation
- typical screenshot characteristics

---

### 8.4 Receipt Likelihood

Strong positive indicators:

- narrow width and tall height
- many short horizontal text lines
- repetitive numeric fragments
- low contrast thermal-print look
- blank margins small or irregular
- faded grayscale look
- user taskType = receipt or invoice

Negative indicators:

- colorful scene background
- polished page layout like book/article
- strong UI widget structure

---

### 8.5 Scene Text Likelihood

Strong positive indicators:

- textured or cluttered background
- text mixed with objects or environment
- colorful local regions
- perspective and nonuniform orientation
- no page-like or UI-like structure
- signboard/poster/product packaging feel

Negative indicators:

- flat scanned page
- screen-rendered UI
- narrow receipt-like layout

---

## 9. Rule-Based Decision Strategy

Use a weighted rule system.
Do not rely on one signal only.

Recommended internal scores:

- screenshotScore
- documentScore
- cameraDocumentScore
- receiptScore
- sceneTextScore

Then select the highest valid class after rule adjustment.

Important:
Some classes are hierarchical.

Example:

- a receipt is also a kind of document
- a camera document is also a kind of document
- screenshot_ui and scene_text should usually be mutually exclusive

So scoring must include disambiguation rules.

---

## 10. Recommended Disambiguation Logic

### Step 1: Apply explicit override

If `userHints.profile` exists and is valid:

- return it immediately

### Step 2: Apply strong task biases

Examples:

- `taskType = receipt` -> strong boost to receipt_thermal
- `taskType = screenshot_ui` -> strong boost to screenshot_ui
- `taskType = document_page` -> boost clean_document or camera_document

### Step 3: Compute feature scores

Compute all five class scores.

### Step 4: Resolve special cases

- if receiptScore is high, prefer receipt_thermal over generic document classes
- if screenshotScore is high, suppress sceneTextScore unless strong natural-image evidence exists
- if documentScore is high and camera cues are high, choose camera_document
- if documentScore is high and camera cues are low, choose clean_document

### Step 5: Apply safe fallback

If no class is strong:

- prefer camera_document for uncertain paper-like images
- prefer scene_text for uncertain natural-image text
- prefer screenshot_ui for explicit screen-capture source

---

## 11. Suggested Deterministic Rules

### Rule A: screenshot_ui

Classify as `screenshot_ui` if most of these are true:

- explicit screenshot hint exists
- very sharp text-like edges
- low noise
- flat-color region count high
- no perspective distortion
- no page contour
- UI block structure likely

### Rule B: receipt_thermal

Classify as `receipt_thermal` if most of these are true:

- taskType is receipt or invoice
- aspect ratio is narrow/tall
- many short horizontal lines
- grayscale/washed appearance
- low contrast or broken strokes
- document-like but not page-like

### Rule C: camera_document

Classify as `camera_document` if most of these are true:

- page/document structure likely
- perspective distortion or skew exists
- lighting unevenness exists
- shadows/glare present
- camera-like noise or blur present

### Rule D: clean_document

Classify as `clean_document` if most of these are true:

- document structure likely
- near-flat geometry
- stable line spacing
- low clutter
- strong text/background separation
- low perspective distortion

### Rule E: scene_text

Classify as `scene_text` if most of these are true:

- text likely exists in natural image
- no page-like structure
- no UI-like flat rendering
- clutter or texture high
- arbitrary background colors
- perspective/orientation irregular

---

## 12. Confidence Band Logic

Confidence band is about confidence in the classification, not OCR success.

Suggested logic:

### high

- winning score clearly exceeds second-best
- strong reasons are consistent
- explicit user override or strong task/source evidence exists

### medium

- class is likely, but overlap with another class exists

### low

- weak signals
- close score competition
- image ambiguous
- fallback profile may be needed quickly if OCR fails

The classifier must expose low-confidence decisions clearly so orchestrator can react conservatively.

---

## 13. Required Reason Codes

Classifier reasons should be readable and stable.

Examples:

- user_profile_override
- task_receipt_bias
- task_screenshot_bias
- page_contour_detected
- perspective_distortion_detected
- uneven_lighting_detected
- flat_ui_structure_detected
- narrow_tall_layout_detected
- thermal_print_pattern_detected
- cluttered_background_detected
- no_page_structure_detected
- low_noise_digital_rendering_detected

Do not return vague reasons like:

- looked_like_document
- seemed_good
- classifier_guess

---

## 14. Minimal Numeric Signal Set

The classifier should compute and preserve a compact signal set.

Recommended signals:

- aspectRatio
- estimatedSkewDeg
- perspectiveScore
- noiseScore
- colorVarianceScore
- edgeDensityScore
- textureComplexityScore
- lineRegularityScore
- pageContourScore
- flatUiScore
- receiptLayoutScore
- lightingVarianceScore

Not all need to be perfect in v1.
But the structure should exist.

---

## 15. Example Classification Result

```json
{
  "profile": "camera_document",
  "confidenceBand": "high",
  "reasons": [
    "page_contour_detected",
    "perspective_distortion_detected",
    "uneven_lighting_detected"
  ],
  "signals": {
    "aspectRatio": 1.41,
    "estimatedSkewDeg": 3.4,
    "perspectiveScore": 0.81,
    "noiseScore": 0.18,
    "colorVarianceScore": 0.22,
    "edgeDensityScore": 0.44,
    "textureComplexityScore": 0.21,
    "lineRegularityScore": 0.72,
    "pageContourScore": 0.88,
    "flatUiScore": 0.06,
    "receiptLayoutScore": 0.12,
    "lightingVarianceScore": 0.67
  }
}
```

This output is useful for:

- logging
- tests
- debugging
- profile selection review

---

## 16. Recommended Scoring Skeleton

Example conceptual model:

```ts
interface OcrClassifierScores {
  screenshotScore: number;
  documentScore: number;
  cameraDocumentScore: number;
  receiptScore: number;
  sceneTextScore: number;
}
```

Suggested rough strategy:

- additive weighted scores
- hard boosts from taskType
- hard suppression for contradictory evidence
- class-specific thresholds before selection

Example:

- pageContourScore strongly boosts document classes
- perspectiveScore strongly boosts camera_document
- flatUiScore strongly boosts screenshot_ui
- receiptLayoutScore strongly boosts receipt_thermal
- textureComplexityScore strongly boosts scene_text and suppresses clean_document

Do not use dozens of hidden magic thresholds with no tests.

---

## 17. Fallback-Oriented Interpretation

The classifier should support downstream retry planning.

Examples:

- if result is `camera_document` with low confidence and OCR fails, retry as `clean_document`
- if result is `screenshot_ui` with low confidence and OCR fails on stylized text, retry as `scene_text`
- if result is `receipt_thermal` but structure is weak, retry with receipt variant or generic camera_document

So classifier output is not just one label.
It also informs the retry neighborhood.

---

## 18. Anti-Patterns

Do not:

- classify based only on file extension
- classify based only on aspect ratio
- classify based only on user hint if it is clearly invalid
- use OCR text output to justify first-stage profile classification
- collapse clean_document and camera_document into one class
- treat receipt as ordinary document by default
- confuse screenshot_ui with scene_text because both may contain short text
- return only a string label with no reasons

---

## 19. Testing Requirements

Minimum tests should include samples for:

- clean scanned page
- phone photo of paper
- receipt photo
- screenshot with small UI text
- poster/sign natural image
- ambiguous borderline cases

Each test should assert:

- selected profile
- confidence band
- presence of specific reasons
- stability of key signals

Regression tests are required whenever thresholds change.

---

## 20. Final Operational Rule

The classifier is a cheap deterministic routing decision layer.

Use it to:

- separate document from non-document input
- separate clean paper from camera paper
- separate screenshot UI from natural scene text
- isolate receipt-specific handling

Bottom line:
Do not let preprocessing and engine selection start from a blind guess.
Classify first, classify deterministically, and preserve the reasons.
