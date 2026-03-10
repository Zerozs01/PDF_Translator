# Changelog (Documents Folder)

This file mirrors key updates that affect documentation in `documents/`.
For full project history, see `CHANGELOG.md` in the repo root.

## 2026-02-05

- Added `documents/ARCHITECTURE.md` (summary + links to root architecture).
- Added `documents/OCR_OPTIMIZATION.md` (OCR performance & tuning notes).
- Added `documents/LOCAL_TESSDATA.md` (offline language data setup).
- Updated `documents/Readme.md` with documentation index.
- Updated `documents/OCR_OPTIMIZATION.md` with fallback recovery + DIP-inspired preprocessing notes.
- Added `scripts/download-tessdata.js` and `npm run tessdata:download` for offline language data.
- Raised OCR chunk threshold and skip binarization for CJK languages to improve Korean/Japanese/Chinese accuracy.
- Added CJK retry pass (binarize + SPARSE_TEXT) and guarded fallback OCR to reduce slowdowns.
- Refined CJK retry to merge results and tightened image-tile filtering for non-Latin false positives.
- Preserve non-Latin text in image tiles when background variance is low (reduce missed speech bubbles).
- Relaxed non-Latin noise/background filtering and improved vertical-gap pass targeting for missing nearby lines.

## 2026-02-06

- Added CJK line rescan for low-coverage line boxes to recover missing tokens at line edges.
- Tuned gap recovery thresholds for CJK and allow longer CJK gap tokens.
- Reused non-binarized input for CJK rescans and fallbacks to reduce redundant preprocessing.
- Added low-coverage line rescan for Latin text and expanded rescan padding to recover trimmed words.

## 2026-02-07

- Updated `documents/ARCHITECTURE.md` with OCR cache and file source behavior.
- Added `road map.md` to track upcoming phases and priorities.
- Synced documentation notes with recent OCR cache + fileData changes.

## 2026-03-09

- Backed up latest OCR tuning notes after manual manga-page validation.
- Documented preprocessing upgrades: adaptive binarization, dark-border cleanup, and lightweight binary repair.
- Recorded that Page 3 lower line (`TAKE A LOOK!`) is now detected successfully.
- Recorded remaining OCR misses for follow-up:
	- Page 2 missing `Xujia town`
	- Page 5 missing / truncated lines including `IN THE PAST, I ONLY FOUND THE`, `WITH`, and `THIS KIND OF STUFF..`
	- Page 10 missing `THE PEOPLE HERE?`
- Documented decision to temporarily tolerate some extra background candidate boxes if they help OCR recall / segmentation.
