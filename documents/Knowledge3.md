# Knowledge 3 — Roadmap & Architecture: OCR Overlay → Translate → Manga Editor → PSD Export (Phase-based)

> Purpose: Provide a phased plan and technical architecture for building an Electron app that:
> Phase 1: OCR overlay + accurate positioning + minimal text ghosts  
> Phase 2: Translation pipeline + overlay replacement + editing workflow  
> Phase 3: Manga-style editing (bubble-aware) + background cleanup  
> Phase 4: Export PSD with layered structure (text layers, masks, background)

---

## 0) Design Principles (Non-negotiable)

1) **Text-layer-first** (avoid OCR when PDF already has selectable text)
- Always attempt PDF text extraction first.
- OCR is fallback for scanned pages or raster-only regions.

2) **Detection-first OCR**
- Never OCR the whole page blindly.
- Run text detection (word/line regions) first → crop → local deskew → OCR.

3) **Geometry is a first-class citizen**
- Store all text as: bbox/polygon + angle + confidence + normalized coords.
- UI overlay must be coordinate-accurate across zoom/scroll.

king
Overlay MVP (Accuracy & Position)
**Goal:** Detect text regions, OCR them, overlay text with correct positions.

Deliverables:
- Page rendering (300–400 DPI) for scanned pages
- Text detection + OCR per region (min ghosts)
- Output JSON: tokens/words/lines + geometry + confidence
- Overlay UI:
  - show bounding boxes
  - show recognized text anchored to region geometry
  - allow manual correction per region
- Caching per page (avoid re-OCR)

Success criteria:
- Text regions cover most text
- Overlay alignment is “pixel-trustworthy”
- Ghost rate is low (confidence gating works)

---

### Phase 2 — Translate + Replace Overlay (Editing Workflow)
**Goal:** Replace original text with translation overlay while preserving layout.

Deliverables:
- Clean text pipeline:
  - normalize whitespace
  - remove garbage tokens
  - preserve paragraph/line breaks
- Translation options:
  - Cloud (Google Translate) OR Local (Docker engine)
- Post-polish:
  - LLM rewrite (Gemini API) without breaking meaning/terminology
- Editing UX:
  - per-region text editor
  - font size / line breaks
  - region-level reflow rules (simple)
- Export:
  - layered image export (flattened) OR vector overlay export (internal)

Success criteria:
- End-to-end: OCR → cleaned text → translation → overlay replacement
- User can correct text and keep alignment

---

### Phase 3 — Manga Editor Mode (Bubble-aware)
**Goal:** Turn scans into editable manga pages (bubble segmentation + cleanup).

Deliverables:
- Bubble detection/segmentation:
  - detect speech bubbles (white regions + contours)
  - create masks per bubble
- Text removal:
  - mask original text regions
  - inpainting fill (classical first, advanced later)
- Rebuild:
  - place translated text as vector text object inside bubble
  - text layout constraints within bubble boundary

Success criteria:
- Bubble segmentation works reliably on target data
- Text removal looks acceptable
- Translated text fits bubble without constant manual work

---

### Phase 4 — PSD Export (True Layer Export)
**Goal:** Export PSD with layers like pro tools:
- Background layer (clean art)
- Bubble masks layer/group
- Text layers (editable type layers)
- Optional effects (stroke/shadow) as layer styles

Deliverables:
- PSD writer implementation:
  - layer groups
  - raster layers (background)
  - text layers (type tool layers)
  - masks
  - blending modes
- Mapping:
  - internal layer tree → PSD structures
  - geometry transforms preserved

Success criteria:
- PSD opens in Photoshop with editable text layers
- Layers are logically grouped and aligned

---

## 2) Core Architecture (Modules)

### 2.1 Document Ingestion
- Input: PDF, images (PNG/JPG), CBZ (future)
- Per page:
  - detect text layer (PDF parsing)
  - rasterize page for OCR fallback

### 2.2 OCR Engine
- Preprocess:
  - illumination correction
  - denoise
  - adaptive binarization
  - morphology cleanup
- Detect:
  - DBNet/CRAFT/EAST (region polygons)
- Deskew:
  - global page angle
  - local region angles
- Recognize:
  - Tesseract / PaddleOCR / TrOCR
- Output:
  - region objects with geometry + conf + text

### 2.3 Layout & Reading Order
- cluster regions into lines/paragraphs
- handle columns
- store reading order index

### 2.4 Text Cleaning & QA
- confidence gating:
  - discard low-conf tokens
- remove artifacts:
  - min-area filter
  - aspect sanity
- optional dictionary / LM correction (lightweight)

### 2.5 Translation Pipeline
- chunk rules:
  - per bubble or per paragraph
  - preserve placeholders for line breaks
- translation engine abstraction:
  - cloud/local interchangeable
- LLM polish:
  - style rewriting without breaking meaning
- glossary/term memory (optional)

### 2.6 Editor UI Model (Canvas)
Internal representation:
- Page
  - Layers
    - Background (raster)
    - Bubble masks (vector/mask)
    - Text objects (vector text)
    - Effects (styles)

Store:
- text object: content + font props + bounding polygon + anchor + rotation + style

### 2.7 Exporters
- Phase 1–2:
  - JSON + flattened PNG/PDF
- Phase 4:
  - PSD exporter (layered)

---

## 3) Data Model Spec (Stable Contracts)

### 3.1 Region (OCR output)
- id
- page_index
- polygon (4 points) or bbox
- angle_deg
- conf (0..1)
- text_raw
- text_clean
- reading_order
- source: "pdf_text" | "ocr"

### 3.2 TextObject (Editor model)
- id
- region_id (link)
- text_final (translated/polished)
- style:
  - font_family
  - font_size
  - fill_color
  - stroke (width/color)
  - shadow (params)
- transform:
  - position
  - rotation
  - scale
- container:
  - bubble_id (optional)
  - fit_mode: wrap | scale_to_fit | manual

### 3.3 Bubble (Phase 3+)
- id
- polygon/mask
- interior area
- linked regions (text regions inside)
- mask layer reference

### 3.4 PSD Layer Mapping (Phase 4)
- Background → raster layer
- Bubble masks → layer mask or shape layer
- Text objects → type layers + layer styles

---

## 4) Technical Strategy (Keep It Realistic)

### Recommended: Two-level extraction
1) PDF has text layer → parse and overlay (best)
2) else OCR fallback (scans)

### Recommended: Detection-first OCR
- Use detector to get crops, then run OCR per crop.
- This is the #1 ghost reduction method.

### Confidence gating is mandatory
- low conf → hide by default, require manual confirm
- avoid poisoning translation + LLM with garbage

### Phase boundary: PSD needs bubble + cleanup
If you export PSD without:
- text removal background
- bubble segmentation
the PSD will be “layers of lies” (text on top of noisy original). Usable but not pro.

---

## 5) Milestone Checklist (What to build next)

### Next milestone (Phase 1 completion)
- [ ] detect PDF text layer (skip OCR if present)
- [ ] text detection + local deskew + OCR per region
- [ ] JSON export of regions with normalized coords
- [ ] overlay UI that stays aligned at zoom
- [ ] manual correction per region saved back

### Phase 2 readiness
- [ ] cleaning pipeline + confidence gating
- [ ] translation adapter (cloud/local)
- [ ] LLM polish step
- [ ] editing UX for translated overlay

### Phase 3 readiness
- [ ] bubble segmentation POC
- [ ] inpainting POC
- [ ] bubble-constrained text layout

### Phase 4 readiness
- [ ] internal layer tree stable
- [ ] PSD library chosen & tested
- [ ] type layer export validated in Photoshop

---

## 6) Pitfalls (Avoid These)

- OCR whole page → ghost explosion
- No confidence gating → translation garbage
- No normalized coords → overlay drift on zoom/resize
- Attempt PSD too early → time sink + no user value
- Mixing structure + content → reflow breaks geometry

---

## 7) Decision Notes for This Project
- Primary target: OCR overlay + translate (Phase 1–2)
- Secondary target: PSD export in later phase (Phase 4)
- Therefore: focus on stable geometry + editing workflow first.
