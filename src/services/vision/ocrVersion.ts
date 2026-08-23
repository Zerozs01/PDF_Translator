export const OCR_ALGORITHM_VERSION = 230;

// Increment this when OCR preprocessing/logic changes
// to invalidate cached OCR results.
// v230: Centered dialogue balloon overlap relaxation and fresh cache invalidation

// Tracks the raw PaddleOCR/EasyOCR engine output version.
// Increment this when PaddleOCR model, quality profile logic, or bridge script changes
// so that stale raw-engine cache can be detected and invalidated separately from TS dedup.
// v7: Invalidate stale raw OCR cache and ensure 100% queue parity
export const OCR_RAW_VERSION = 7;

