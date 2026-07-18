// Increment this when OCR preprocessing/logic changes
// to invalidate cached OCR results.
// v223: Fix accidental bigram overlap false positive in samePositionDuplicateLine (e.g. YOUFRONT vs ICANT sharing 'NT')
export const OCR_ALGORITHM_VERSION = 223;

// Tracks the raw PaddleOCR/EasyOCR engine output version.
// Increment this when PaddleOCR model, quality profile logic, or bridge script changes
// so that stale raw-engine cache can be detected and invalidated separately from TS dedup.
// v5: Bumped to force invalidation of raw cache after fixing watermark garbage line suppression in Python.
export const OCR_RAW_VERSION = 5;

