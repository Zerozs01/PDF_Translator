export const OCR_ALGORITHM_VERSION = 225;

// Increment this when OCR preprocessing/logic changes
// to invalidate cached OCR results.
// v225: Fixed isDuplicateOverlappingBBox to prevent collapsing different valid words (THE, PIG, YOU, ARE) in vertical manga balloons

// Tracks the raw PaddleOCR/EasyOCR engine output version.
// Increment this when PaddleOCR model, quality profile logic, or bridge script changes
// so that stale raw-engine cache can be detected and invalidated separately from TS dedup.
// v2: Invalidate old raw OCR cache stored in IndexedDB/SQLite
export const OCR_RAW_VERSION = 2;
