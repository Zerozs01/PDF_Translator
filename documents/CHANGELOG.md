# Documents Changelog

This file tracks documentation changes inside `documents/` only.

## 2026-03-21

- Rewrote the documentation set around the current code truth instead of older speculative plans.
- Declared `documents/` as the canonical working documentation folder.
- Updated architecture notes for:
  - single-worker OCR runtime
  - `worker-boot.ts` primary entry with `worker-stable.ts` fallback
  - cache aliasing by filename
  - `panel` / `export` pipeline profiles
  - `fast` / `balanced` / `best` quality profiles
  - secure Gemini IPC flow
- Replaced duplicate planning/history in `OCR_OPTIMIZATION.md` and `Roadmap.md` with current priorities.
- Consolidated the older research documents into one active summary file: `Knowledge.md`.
- Removed the obsolete archive-pointer files `Knowledge2.md` and `Knowledge3.md` after their content was fully consolidated.
- Kept `deep-research-report.md` as a research note because it contains active external OCR investigation, not just a stale redirect.
- Recorded the first Korean-focused v87 tuning pass and the current blocker: no reproducible Korean fixture bundle yet.
- Recorded the v88 follow-up that removes the generic CJK gate bottleneck for Korean heavy recovery and adds Korean line replacement during rescan.
- Recorded the v89 follow-up that relaxes Korean short-syllable acceptance in `lineRescan` / `gapFallback` after console traces showed recovered syllables were still being filtered out.
- Recorded the v90 follow-up that adds a binarized Korean line-rescan input and wider short-line crops after raw OCR still missed glyphs such as `왔` and `싫`.
- Recorded the v91 follow-up that lowers Korean source thresholds for bounded recovery and adds a tight `RAW_LINE` + upscale pass based on `deep-research-report2.md`.
- Recorded the v92 Latin core pass that introduces a shared line-quality assessment for Latin rescue/prune, adds `postPruneLine` candidate debug output, and shifts the next OCR work toward bounded region-recognition improvements instead of sample-specific threshold tweaks.
- Recorded the v93 Latin follow-up that fixes over-aggressive trailing non-lexical tail trimming, gates sparse probe additions with the shared Latin line assessment, and adds direct logging for late Latin tail cleanup.

## 2026-03-20

- Added notes for OCR regression harness preflight checks and partial-run mode.
- Documented timeout hardening and shared timeout constants.

## Historical Note

Older release-by-release OCR notes still exist in the root `CHANGELOG.md`, but this folder now keeps only the documentation view needed to work against the current codebase.
