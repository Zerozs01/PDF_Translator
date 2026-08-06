export const OCR_ALGORITHM_VERSION = 227;

// Increment this when OCR preprocessing/logic changes
// to invalidate cached OCR results.
// v227: Bumping raw & algorithm version to invalidate stale raw OCR cache and force re-OCR of vertical/manga dialogue lines

// Tracks the raw PaddleOCR/EasyOCR engine output version.
// Increment this when PaddleOCR model, quality profile logic, or bridge script changes
// so that stale raw-engine cache can be detected and invalidated separately from TS dedup.
// v4: Invalidate old raw OCR cache stored in IndexedDB/SQLite to force best quality profile & english dialogue safety gate
export const OCR_RAW_VERSION = 4;
