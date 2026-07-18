// Increment this when OCR preprocessing/logic changes
// to invalidate cached OCR results.
// v219: Bumped to apply systemic English word dictionary fallback for untranslated words
export const OCR_ALGORITHM_VERSION = 219;

// Tracks the raw PaddleOCR/EasyOCR engine output version.
// Increment this when PaddleOCR model, quality profile logic, or bridge script changes
// so that stale raw-engine cache can be detected and invalidated separately from TS dedup.
// v4: Bumped to force invalidation of raw cache after fixing standard aspect-ratio page chunking bug.
export const OCR_RAW_VERSION = 4;

