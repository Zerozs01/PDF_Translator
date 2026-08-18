export const OCR_ALGORITHM_VERSION = 229;

// Increment this when OCR preprocessing/logic changes
// to invalidate cached OCR results.
// v229: Improved DB text detector thresholds to capture small/bottom dialogue lines in balloons

// Tracks the raw PaddleOCR/EasyOCR engine output version.
// Increment this when PaddleOCR model, quality profile logic, or bridge script changes
// so that stale raw-engine cache can be detected and invalidated separately from TS dedup.
// v6: Refresh raw OCR cache with tuned det_thresh & det_box_thresh
export const OCR_RAW_VERSION = 6;

