# OCR Validation Rules

Version: 1.0
Scope: PaddleOCR / EasyOCR / Tesseract / Electron OCR Runtime
Purpose: Define deterministic validation rules for deciding whether an OCR result is acceptable, weak, or should trigger fallback.

---

## 1. Core Principle

OCR output must never be accepted solely because the engine returned text.

A result is valid only if it passes quality checks relevant to the task.

Validation exists to:

- reject obviously bad OCR output
- trigger fallback only when justified
- reduce silent failures
- prevent garbage text from reaching UI or downstream logic
- support predictable multi-engine routing

Validation must be:

- deterministic
- explainable
- testable
- task-aware

Do not use vague intuition as validation logic.

---

## 2. Validation Outcome Model

Every OCR result must end in one of these states:

- **accepted**
- **accepted_with_warnings**
- **weak_result**
- **rejected**

Meaning:

### accepted

Result is strong enough for normal app use.

### accepted_with_warnings

Result is usable, but some signals indicate risk.
UI may still show it, but internal logs should preserve the warning reasons.

### weak_result

Result is probably wrong or incomplete.
Fallback should be considered.

### rejected

Result is unusable.
Fallback or user correction is required.

---

## 3. Validation Layers

Validation must happen in layers:

1. **Structural Validation**
2. **Confidence Validation**
3. **Content Validation**
4. **Language Validation**
5. **Task-Specific Validation**
6. **Spatial/Layout Validation**

Do not collapse everything into one confidence threshold.

---

## 4. Structural Validation

Structural validation checks whether the OCR output is physically plausible.

Check:

- any text exists
- line count > 0 when text is expected
- bounding boxes exist when engine supports them
- line ordering is not obviously broken
- text is not empty after normalization
- output is not composed only of whitespace or separators

Fail conditions:

- no detected text
- all lines empty
- all confidences missing and no usable content
- all bounding boxes invalid or zero-area
- output contains only punctuation/noise

Example weak reasons:

- no_text_detected
- empty_normalized_text
- invalid_geometry
- zero_area_boxes
- line_structure_missing

---

## 5. Confidence Validation

Confidence is one signal, not the truth.

### Rules

- normalize all engine confidence values to 0..1
- calculate mean confidence
- optionally calculate median confidence
- optionally calculate min confidence for critical fields

### Suggested thresholds

These are starting points, not absolute truth:

- **>= 0.85** strong
- **0.70 - 0.84** usable
- **0.50 - 0.69** weak
- **< 0.50** likely reject

### Important

Do not reject purely by confidence if:

- text matches expected patterns strongly
- task-specific fields validate correctly
- engine is known to underestimate confidence

Do not accept purely by confidence if:

- content is garbage
- symbols dominate
- extracted text is implausibly short

Example weak reasons:

- low_mean_confidence
- low_median_confidence
- critical_field_low_confidence

---

## 6. Content Validation

Content validation checks whether the extracted text looks meaningful.

Check:

- text length
- word count
- ratio of alphanumeric or language-valid characters
- excessive repeated symbols
- excessive OCR garbage characters
- suspiciously short output for the image type
- duplicated fragments
- impossible token shapes

### Examples of suspicious output

- `|||1|I||`
- `...,,,---`
- repeated random fragments
- long line with only punctuation
- one character extracted from a full-page document

### Generic rules

Mark weak if:

- normalized text length is below minimum expectation
- symbol-only ratio is too high
- repeated same-character sequences dominate output
- many control-like or replacement characters appear

Example weak reasons:

- suspiciously_short_text
- too_many_noise_symbols
- repeated_character_artifacts
- low_alnum_ratio
- content_implausible

---

## 7. Language Validation

Language validation checks whether output matches the expected language set.

Use when:

- app knows requested language(s)
- task domain is language-specific
- multilingual OCR requires sanity checks

Check:

- detected language ratio
- valid Unicode block distribution
- unexpected script dominance
- impossible character mixtures for the task

Examples:

- expected English receipt, but output is mostly random symbols
- expected Thai/English UI, but output is mostly Cyrillic-like junk
- expected numeric field, but output contains many alphabetic artifacts

Do not:

- over-reject mixed-language real-world text
- assume one language only if the UI or document is multilingual

Example weak reasons:

- invalid_language_ratio
- unexpected_script_dominance
- language_mismatch

---

## 8. Spatial/Layout Validation

This layer checks whether text geometry and ordering make sense.

Check:

- line ordering is plausible
- boxes do not overlap absurdly
- text grouped into lines logically
- reading order is stable
- orientation is consistent enough
- line heights are not wildly inconsistent without reason

Use cases:

- receipts
- forms
- screenshots
- multi-line document OCR

Weak conditions:

- words merged across unrelated rows
- reading order scrambled
- large amount of text assigned to overlapping boxes
- vertically stacked text interpreted as one corrupted line

Example weak reasons:

- line_order_broken
- unstable_reading_order
- extreme_box_overlap
- malformed_line_grouping

---

## 9. Task-Specific Validation

General validation is not enough.
Different OCR tasks need different acceptance rules.

Supported task families:

- free_text
- receipt
- invoice
- screenshot_ui
- document_page
- id_like_field
- numeric_field
- single_word
- single_line

Each task may add its own rules.

---

## 10. Free Text Validation

Use for:

- plain OCR reading
- notes
- general screenshots
- arbitrary text extraction

Validate:

- text exists
- confidence reasonable
- line ordering plausible
- content not dominated by garbage
- text length plausible for visible text density

Accept even if:

- formatting is imperfect
- some words are noisy
- partial extraction still provides value

---

## 11. Receipt / Invoice Validation

Receipts and invoices are structured.
Validation should exploit that structure.

Check for presence of likely fields:

- date
- total
- subtotal
- amount
- currency
- tax/VAT
- merchant-like line
- multiple aligned line items

Accept more confidently when:

- total-like numeric pattern exists
- line item structure appears
- date/time pattern exists
- monetary values are internally plausible

Weak conditions:

- many isolated price-like fragments with broken line order
- merchant line missing and text very sparse
- numbers present but item structure destroyed

Example weak reasons:

- missing_total_pattern
- broken_receipt_structure
- numeric_fragments_without_context

---

## 12. Screenshot / UI Validation

UI screenshots often contain short but valid text.

Do not require long text length.

Check:

- labels and buttons are readable
- line/box positions correspond to UI regions
- short words are acceptable
- repeated OCR on icons or decorative shapes is suppressed

Weak conditions:

- OCR reading icon shapes as letters
- many tiny meaningless fragments
- high confidence but nonsense labels

Example weak reasons:

- ui_fragment_noise
- icon_text_confusion
- tiny_box_noise

---

## 13. Document Page Validation

For clean scanned or photographed pages:

Check:

- extracted text length roughly matches page density
- multiple lines exist when page is text-heavy
- line order is stable
- paragraph flow roughly preserved

Weak conditions:

- only a few lines extracted from a dense page
- line breaks collapse into disorder
- top half recognized, bottom half empty without reason

Example weak reasons:

- underextracted_page
- partial_page_detection
- paragraph_flow_broken

---

## 14. Single Word / Single Line Validation

Use for:

- labels
- cropped title
- serial field
- one-line captions

Check:

- output is non-empty
- confidence reasonable
- character composition plausible
- width-to-text-length relationship not absurd

Do not apply page-level expectations here.

Example weak reasons:

- empty_single_line_result
- implausible_single_token_shape

---

## 15. Numeric Field Validation

Use for:

- amounts
- totals
- quantities
- phone numbers
- codes with mostly digits

Check:

- numeric ratio high enough
- punctuation pattern plausible
- expected length range
- decimal separators valid if applicable

Weak conditions:

- many alphabetic substitutions in numeric field
- impossible decimal placement
- too many separators
- numeric length too short or too long

Example weak reasons:

- invalid_numeric_ratio
- malformed_decimal_pattern
- numeric_length_out_of_range

---

## 16. Pattern and Regex Validation

Regex validation is powerful for structured OCR.

Use it for:

- dates
- invoice numbers
- totals
- IDs
- phone numbers
- postal codes
- fixed UI labels

Policy:

- regex success increases confidence in acceptance
- regex failure alone should not always reject free text
- regex failure should strongly affect structured-field tasks

Examples:

- `dd/mm/yyyy`
- `yyyy-mm-dd`
- currency amount
- invoice ID
- order number

Example weak reasons:

- regex_validation_failed
- expected_pattern_missing

---

## 17. Cross-Signal Scoring

Validation should combine signals instead of relying on one variable.

Recommended signals:

- mean confidence
- normalized text length
- valid character ratio
- regex success count
- line structure quality
- task-specific field presence
- detected language compatibility

Simple scoring model example:

- start at 0
- add points for strong signals
- subtract for weak signals
- classify by final band

Example:
>
- >= 80 accepted
- 60-79 accepted_with_warnings
- 40-59 weak_result
- < 40 rejected

Important:
Keep scoring transparent and testable.
Do not bury rules in opaque heuristics.

---

## 18. Fallback Trigger Policy

Fallback should trigger when validation says result is weak or rejected.

Trigger fallback when:

- no text detected
- mean confidence below weak threshold and content weak
- structured task failed critical regex checks
- page underextracted severely
- language/script mismatch severe
- spatial ordering broken badly

Do not trigger fallback when:

- result is imperfect but usable
- confidence modest but task-specific checks are strong
- output is short because the image genuinely contains short text

---

## 19. User-Correctable Acceptance Policy

In some product flows, a weak result may still be shown if editable.

Recommended:

- show weak result with warning if user can correct it
- auto-fallback in background only if latency budget allows
- mark uncertain fields visually in UI when possible

This is useful for:

- receipts
- forms
- screenshots
- note extraction

---

## 20. Validation Metadata Contract

Validator should emit machine-readable metadata like this:

```json
{
  "status": "accepted_with_warnings",
  "score": 72,
  "reasons": [
    "low_mean_confidence",
    "regex_validation_failed"
  ],
  "signals": {
    "meanConfidence": 0.68,
    "normalizedTextLength": 148,
    "validCharacterRatio": 0.91,
    "regexMatches": 1,
    "lineCount": 9
  }
}
Rules:

status is required
reasons must be deterministic
signals should contain key numbers used in the decision
do not return only a boolean
21. Anti-Patterns

Do not:

accept OCR because engine returned something
reject OCR because one confidence number is low
use same thresholds for receipt, page, and single-word OCR
trust regex alone for free text
trust text length alone for screenshots
hide validation reasons from logs
trigger fallback without recording why
22. Final Operational Rule

Validation decides whether OCR output is operationally usable.

Use:

structural checks first
confidence checks second
content and language checks next
task-specific checks last
fallback only when the combined evidence is weak

Bottom line:
A valid OCR result is not the one that looks impressive.
It is the one that passes deterministic checks for the task it serves.
