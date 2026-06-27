export const OCR_ALGORITHM_VERSION = 215;

// Increment this when OCR preprocessing/logic changes
// to invalidate cached OCR results.
// v215: Bumped to invalidate stale raw OCR cache (PaddleOCR missed lines bug)

// Tracks the raw PaddleOCR/EasyOCR engine output version.
// Increment this when PaddleOCR model, quality profile logic, or bridge script changes
// so that stale raw-engine cache can be detected and invalidated separately from TS dedup.
// v2: Bumped to force invalidation of raw cache after PaddleX Thai OCR integration & config fixes.
export const OCR_RAW_VERSION = 2;

