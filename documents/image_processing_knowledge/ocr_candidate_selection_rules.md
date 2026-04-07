# OCR Candidate Selection Rules

Version: 1.0
Scope: Electron OCR Runtime / PaddleOCR / EasyOCR / Tesseract
Purpose: Define deterministic rules for selecting the best final OCR candidate when multiple attempts, profiles, or engines produce competing results.

---

## 1. Core Principle

When multiple OCR attempts exist, the system must not choose the winner by raw confidence alone.

The final candidate must be selected using a deterministic comparison policy that considers:

- validation outcome
- task fitness
- text completeness
- structural quality
- warning severity
- confidence as a secondary signal

This layer exists because:

- the first OCR attempt is not always the best one
- a fallback result may be better than the primary result
- high confidence can still produce garbage
- low confidence can still produce operationally valid text

---

## 2. Why Candidate Selection Exists

Candidate selection is required when:

- multiple engines are used
- the same engine is retried with another profile
- the same input produces multiple acceptable outputs
- one result is structurally cleaner but another has higher confidence
- task-specific validation signals disagree

Without this layer, the system becomes unstable:

- one run picks the first result
- another run picks the highest confidence
- another run picks the latest attempt

That is unacceptable.

---

## 3. Candidate Definition

A candidate is one fully evaluated OCR attempt.

Each candidate should already contain:

- engine
- profile
- attempt number
- normalized text
- validation status
- validation score
- validation reasons
- confidence metrics
- structure metrics
- task-specific metrics
- warning list
- timing metadata

Candidate selection must happen **after validation**.
Do not compare raw OCR outputs directly.

---

## 4. Required Candidate Shape

Example conceptual structure:

```ts
export interface OcrAttemptCandidate {
  attemptNumber: number;
  engine: 'paddleocr' | 'easyocr' | 'tesseract';
  profile:
    | 'clean_document'
    | 'camera_document'
    | 'screenshot_ui'
    | 'receipt_thermal'
    | 'scene_text';
  normalizedText: string;
  meanConfidence: number | null;
  warnings: Array<{
    code: string;
    message: string;
    severity?: 'low' | 'medium' | 'high';
  }>;
  validation: {
    status: 'accepted' | 'accepted_with_warnings' | 'weak_result' | 'rejected';
    score: number;
    reasons: string[];
    signals: Record<string, unknown>;
  };
  metrics: {
    textLength: number;
    lineCount: number;
    validCharacterRatio: number | null;
    regexMatchCount: number;
    structuralCompleteness: number | null;
  };
}
````

The exact shape may differ, but these fields must exist in some form.

---

## 5. Primary Selection Rule

Selection priority must be:

1. validation status
2. validation score
3. task-specific success signals
4. structural quality
5. warning severity
6. text completeness
7. mean confidence
8. earlier attempt as deterministic tie-breaker

This order is intentional.

Do not move confidence above validation status.

---

## 6. Validation Status Priority

Use this strict status ranking:

1. `accepted`
2. `accepted_with_warnings`
3. `weak_result`
4. `rejected`

A candidate with a better status always outranks a candidate with a worse status unless there is explicit override logic for a special task.

Examples:

- `accepted` beats `weak_result` even if confidence is lower
- `accepted_with_warnings` beats `rejected` always
- `weak_result` may beat another `weak_result`, but not an `accepted`

This is the first and strongest filter.

---

## 7. Validation Score Comparison

If two candidates share the same validation status, compare their validation score.

Rules:

- higher score wins
- use score only within the same status band or adjacent acceptable bands when policy allows
- scores must come from the same validator logic

Do not compare scores produced by different incompatible scoring systems.

---

## 8. Task-Specific Signal Priority

After status and score, compare task-specific signals.

Examples:

- receipt candidate with valid total/date/amount pattern should beat one without them
- numeric field candidate with valid numeric pattern should beat one with cleaner text but malformed numeric structure
- screenshot_ui candidate with correct short labels should beat longer noisy output
- document_page candidate with better paragraph continuity should beat fragmented line soup

Task-specific success is often more important than generic confidence.

---

## 9. Structural Quality Comparison

Structural quality matters because OCR output is not just text length.

Useful structural indicators:

- line count plausibility
- line ordering stability
- box grouping quality
- paragraph continuity
- absence of severe overlap corruption
- preserved segmentation quality

Prefer the candidate whose structure better matches the expected task.

Examples:

- a receipt with aligned rows beats one long collapsed paragraph
- a document page with correct line flow beats one with similar text but scrambled order
- a single-word task should not be penalized for low line count

---

## 10. Warning Severity Comparison

Warnings are negative evidence.

If two candidates are close, prefer the one with:

- fewer warnings
- lower severity warnings
- fewer high-severity warnings

Suggested severity interpretation:

- `low` = mild concern, result likely usable
- `medium` = meaningful degradation
- `high` = substantial risk, likely corrupt or incomplete

Examples of severe warnings:

- line_order_broken
- no_text_regions_but_text_returned
- regex_validation_failed_for_critical_field
- partial_output
- malformed_geometry

A candidate with fewer severe warnings should usually win over one with more severe warnings, even if confidence is slightly lower.

---

## 11. Text Completeness Comparison

Completeness matters, but only when it matches task expectations.

Useful completeness signals:

- normalized text length
- number of non-empty lines
- expected field coverage
- region coverage
- underextraction detection

Examples:

- for document_page, longer complete text may be better
- for screenshot_ui, short correct output may beat long noisy output
- for numeric_field, one correct number beats a longer corrupted string
- for receipt, candidate with merchant/date/total coverage beats candidate with random extra junk

Do not reward longer text blindly.

---

## 12. Confidence as Secondary Signal

Confidence is useful only after stronger criteria are considered.

Use confidence to break ties when:

- validation status is same
- validation score is close
- task-specific signals are similar
- structural quality is comparable

Confidence must not dominate earlier rules.

Examples:

- `accepted` at 0.68 can beat `weak_result` at 0.92
- candidate matching expected invoice total at 0.61 can beat clean-looking nonsense at 0.88

---

## 13. Tie-Breaking Rule

If candidates remain effectively tied after all major comparisons:

Prefer:

1. fewer high-severity warnings
2. simpler successful path
3. earlier attempt number

Rationale:

- fewer severe warnings = lower risk
- simpler path = often more stable
- earlier attempt = deterministic and avoids fallback bias

Do not use random ordering.
Do not rely on array position unless it is intentionally defined as attempt order.

---

## 14. Simpler Path Preference

When two candidates are nearly equal, prefer the one produced by the simpler path.

Path simplicity examples:

- primary engine without fallback
- fewer preprocessing mutations
- no aggressive recovery steps
- fewer retries

Reason:
A simpler successful path is usually:

- easier to debug
- easier to reproduce
- less likely to overfit strange cases

This is a tie-breaker, not a primary rule.

---

## 15. Candidate Rejection Before Ranking

Before ranking, remove candidates that are operationally unusable.

Hard reject candidates with conditions like:

- empty normalized text
- invalid request mapping
- corrupted output object
- unrecoverable parsing failure
- missing validation result
- catastrophic structural failure
- explicit `rejected` status with no usable text and severe warnings

Do not waste ranking logic on garbage candidates.

---

## 16. Single-Candidate Rule

If only one candidate exists:

- return it
- do not force fallback comparison logic
- still preserve validation metadata

This seems obvious, but the implementation should make it explicit.

---

## 17. Pairwise Comparison Rule

A clean implementation approach is pairwise comparison.

Pseudo-order:

- compare A vs B
- keep winner
- compare winner vs next candidate
- continue until exhausted

This avoids brittle giant nested if-else chains.

Conceptual comparator priority:

```ts
function compareCandidates(a: OcrAttemptCandidate, b: OcrAttemptCandidate): number {
  // negative => a wins
  // positive => b wins
  // zero => tie
}
```

Recommended comparison stages:

1. compare validation status rank
2. compare validation score
3. compare task-specific metrics
4. compare structural quality
5. compare warning severity
6. compare completeness
7. compare confidence
8. compare simpler path / earlier attempt

---

## 18. Suggested Status Rank Mapping

Example deterministic mapping:

```ts
const STATUS_RANK: Record<OcrAttemptCandidate['validation']['status'], number> = {
  accepted: 4,
  accepted_with_warnings: 3,
  weak_result: 2,
  rejected: 1
};
```

Higher rank wins.

---

## 19. Suggested Warning Penalty Model

A simple penalty model is useful for close candidates.

Example:

- low severity warning = -1
- medium severity warning = -3
- high severity warning = -6

Then compare:

- total penalty
- high severity warning count
- count of critical warning codes

This keeps warning comparison explainable.

---

## 20. Suggested Completeness Interpretation by Task

### document_page

Prefer:

- more complete line extraction
- stable order
- better paragraph continuity

### receipt / invoice

Prefer:

- correct merchant/date/total structure
- multiple plausible item lines
- valid money patterns

### screenshot_ui

Prefer:

- fewer tiny noisy fragments
- correct short labels
- minimal icon misread

### single_line / single_word

Prefer:

- exact concise output
- plausible token shape
- no extra garbage

### numeric_field

Prefer:

- valid numeric pattern
- correct length range
- minimal substitutions

This must be task-aware or it will produce bad winners.

---

## 21. Comparison Reason Logging

The selector should log why a winner was chosen.

Required output should include something like:

- finalWinnerAttempt
- comparedAgainstAttempts
- decisiveFactors

Example:

- better_validation_status
- higher_validation_score
- stronger_receipt_pattern_match
- fewer_high_severity_warnings
- better_line_structure
- earlier_attempt_tie_break

Do not make final selection opaque.

---

## 22. Example Decision Cases

### Case A

- Candidate A: accepted, score 78, confidence 0.69
- Candidate B: weak_result, score 82, confidence 0.93

Winner:

- Candidate A

Reason:

- accepted outranks weak_result

---

### Case B

- Candidate A: accepted_with_warnings, score 74, receipt total matched
- Candidate B: accepted_with_warnings, score 77, no total match

Winner:

- usually Candidate A for receipt task

Reason:

- task-specific critical signal beats small score gap

---

### Case C

- Candidate A: accepted, score 81, many high-severity structure warnings
- Candidate B: accepted, score 79, fewer warnings, better line ordering

Winner:

- usually Candidate B

Reason:

- severe structure problems may outweigh a tiny score advantage

---

### Case D

- Candidate A: accepted_with_warnings, short but correct UI labels
- Candidate B: accepted_with_warnings, longer noisy output

Winner:

- Candidate A for screenshot_ui

Reason:

- task-specific completeness is not equal to length

---

## 23. Anti-Patterns

Do not:

- always choose highest confidence
- always choose latest retry
- always choose longest text
- always choose first successful result
- compare candidates before validation
- ignore task type
- ignore warnings
- hide selection reasons from logs

These are the exact mistakes that make OCR systems unstable.

---

## 24. Minimal Selector Output Contract

Example:

```json
{
  "selectedAttempt": 2,
  "selectionReasons": [
    "better_validation_status",
    "stronger_receipt_pattern_match",
    "fewer_high_severity_warnings"
  ],
  "comparedAttempts": [1, 2]
}
```

This can be internal metadata, but it should exist.

---

## 25. Final Operational Rule

Candidate selection is the final decision layer between multiple OCR attempts and the returned app result.

Use it to:

- rank validated candidates deterministically
- prefer task-fit over cosmetic confidence
- avoid random fallback winners
- preserve clear reasoning for debugging

Bottom line:
The best OCR result is not the loudest one.
It is the one that best satisfies the task with the lowest operational risk.
