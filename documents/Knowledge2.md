# Knowledge 2 — OCR Accuracy, Layout Segmentation, PDF Editability, and RAG Integration

> Goal: Build a robust OCR pipeline that minimizes hallucinated text (“text ghosts”), accurately segments text regions/elements, preserves coordinates for overlay, handles global + local skew, and integrates clean text into translation + LLM polishing (and optionally RAG).

---

## 0) Key Concept Map (Don’t Confuse Layers)

### OCR (Computer Vision / DIP layer)
- Input: image / scanned PDF page
- Output: text + confidence + bounding boxes (geometry)
- Core problems: denoise, binarize, detect text, correct skew, recognize characters

### PDF Editability (Document Structure layer)
There are 2 major PDF types:
1) **Born-digital PDF (has text layer)**
   - Contains actual text objects (glyphs), fonts, and transforms.
   - Can be extracted and edited like Word (highly accurate).
   - No OCR needed (or only partial OCR for embedded images).
2) **Scanned PDF (image-only)**
   - Must run Document AI pipeline:
     layout analysis → text detection → local deskew → OCR → reconstruction

### RAG (Information Retrieval layer)
- Starts AFTER you have text.
- Pipeline: text → chunk → embed → vector store → retrieval → LLM answer.
- OCR is optional upstream if your sources are images/scans.

---

## 1) Why Canva/Acrobat/Word “Edit PDF” So Well

### The secret: They often avoid OCR entirely
- For born-digital PDFs, they parse:
  - text objects (content streams)
  - bounding boxes + font metrics
  - transforms (rotation, scale)
  - vector graphics and images as separate objects
- They can segment “elements” (text blocks, shapes, images) reliably because PDF internally already stores structure.

### When OCR is required (scanned PDFs)
They use a multi-model Document AI stack:
- Layout analysis (document structure classification)
- Text detection (word/line polygons)
- Local skew correction (per region)
- OCR recognition
- Reconstruction (reading order, paragraphs, tables)

---

## 2) Production-grade OCR Pipeline (Recommended)

### High-level flow
1) **Decide extraction mode per page (critical)**
   - If PDF has a text layer → use PDF parsing (best accuracy, near-zero ghosts).
   - Else → OCR fallback.

2) **OCR fallback pipeline**
   - Render page at 300–400 DPI
   - Illumination correction / shadow removal
   - Denoise (bilateral / NLM)
   - Adaptive binarization (Sauvola/Wolf/Niblack)
   - Morphological cleanup (opening/closing)
   - Layout analysis (optional but recommended)
   - Text detection (DBNet/CRAFT/EAST)
   - Global deskew (page-level)
   - Local deskew (region-level)
   - OCR (Tesseract/PaddleOCR/TrOCR)
   - Post-processing (confidence gating + LM correction)
   - Export: text + boxes + angle + confidence

---

## 3) The “Two-Mode” Architecture (Must-have for Overlay Apps)

### Mode A: PDF Text Extraction (Preferred)
Use PDF parser to extract:
- text spans
- bounding boxes in PDF coordinate space
- font size/style if needed
Then map to screen overlay coordinates.

**Benefits**
- Highest accuracy
- Perfect positioning
- Minimal hallucination
- Fast

### Mode B: OCR Fallback (Per-page or Per-region)
Only run OCR on:
- scanned pages
- embedded images with text
- pages where extracted text layer is missing/garbled

**Hybrid pages**
- Some PDFs contain both text layer and scanned images.
- Run extraction for text objects + OCR only on image regions.

---

## 4) Layout & Element Segmentation (What You Need for “Editable Feeling”)

### What segmentation means here
You need to detect and categorize:
- text blocks
- lines/words
- tables
- figures/images
- headers/footers
- captions

### Approaches
- Heuristic layout:
  - connected components grouping
  - whitespace projection profiles
  - line clustering by y-coordinate
- ML layout:
  - document layout detection models (block classification)
  - text detectors that output polygons

**Minimum viable segmentation for overlay**
- Detect text regions and lines accurately (word/line polygons).
- Maintain reading order (top-to-bottom, left-to-right with columns).

---

## 5) Coordinate Systems & Overlay Mapping

### Store geometry in a normalized format
Always save:
- polygon or bbox in page pixel space
- angle per region
- confidence per token/word/line

Recommended structure:
- bbox: [x_min, y_min, x_max, y_max]
- polygon: [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
- angle: degrees (local rotation)
- conf: 0..1

### Normalization (resolution invariant)
Store also:
- x_norm = x / page_width
- y_norm = y / page_height

Overlay pipeline:
- convert normalized coords to current viewport coords
- handle zoom/scroll precisely

---

## 6) Skew Correction (Global vs Local)

### Global deskew (whole page)
Use when the page is uniformly rotated.
Methods:
- Hough transform on text baselines
- PCA on text contours
Output: page angle θ_global

### Local deskew (region-level)
Required when only some blocks are rotated.
Steps:
1) detect text regions (polygons)
2) estimate angle per region θ_i
3) rotate/crop only that patch
4) OCR patch
5) inverse transform coords back to page space

**This is essential for accurate OCR on “partially tilted” text.**

---

## 7) “Text Ghost” Root Causes & How to Kill Them

### Causes
- noise and compression artifacts
- shadows and uneven illumination
- aggressive sharpening
- wrong thresholding
- running OCR on non-text regions
- wrong language constraints
- low-resolution rendering

### Countermeasures
1) Never OCR whole page blindly
   - run text detection first
2) Illumination correction
3) Adaptive thresholding, not global
4) Morphology + connected component filtering
5) Confidence gating:
   - discard low-confidence words/characters
6) Region validity checks:
   - aspect ratio constraints
   - min area constraints
   - stroke width sanity checks (optional)

---

## 8) Tesseract Tuning (If You Must Use It)

### Recommended baseline
- Use `tessdata_best`
- Use LSTM OCR engine:
  - `--oem 1`
- Choose `--psm` based on layout:
  - `6` for a uniform block of text
  - `11` for sparse text (scattered)

### Critical rule
Tesseract performs best on clean, cropped, deskewed text blocks.
So:
- run text detection (DBNet/CRAFT) first
- crop per region
- local deskew per crop
- OCR per crop
This reduces ghosts drastically.

### Post-filter
- remove tokens below confidence threshold
- optionally apply dictionary/LM corrections

---

## 9) Translation & LLM Polishing Pipeline (Your Project)

### Recommended stages
1) OCR/extract
2) cleaning & normalization
   - remove garbage tokens
   - fix whitespace
   - preserve paragraph breaks
3) translate
   - cloud translate (Google) OR local (Docker-based engines)
4) LLM polish (Gemini API)
   - rewrite to professional style
   - preserve meaning & terminology
5) re-inject into overlay / export

### Keep “structure” separate from “content”
- Store layout geometry and ordering as metadata
- Store cleaned text as content
- Translation & polish should not destroy alignment to geometry

---

## 10) RAG Integration (Optional, After You Have Text)

### What to store in vector DB
- chunked text
- metadata:
  - page index
  - bbox/polygon references (optional)
  - section label (title/paragraph/table)

### Retrieval usage
- For search, summarization, question answering over extracted documents

**Note**: RAG improves retrieval + reasoning, not OCR accuracy.
OCR accuracy must be solved upstream.

---

## 11) Implementation Checklist (Practical)

### Page-level decision
- [ ] Detect if PDF page has text layer
- [ ] Extract text + bboxes if available
- [ ] Identify image regions needing OCR

### OCR fallback
- [ ] Render at 300–400 DPI
- [ ] Illumination correction
- [ ] Denoise
- [ ] Adaptive binarization
- [ ] Morphology cleanup
- [ ] Text detection (word/line)
- [ ] Global + local deskew
- [ ] OCR per region
- [ ] Confidence gating
- [ ] Reading order reconstruction

### Overlay export
- [ ] Save normalized geometry
- [ ] Save text + confidence
- [ ] Build mapping to viewport coords
- [ ] Provide editing UI to correct text and keep alignment

---

## 12) Recommended Next Steps (For Accuracy Gains Fast)
1) Implement “Text-layer-first” extraction
2) Add text detection before Tesseract (region OCR)
3) Add local deskew per region
4) Add confidence gating + discard low-conf tokens
5) Only then optimize preprocessing further

---

## 13) Notes / DIP grounding
OCR workflow aligns with standard DIP pipeline:
Image Acquisition → Enhancement → Restoration → Morphological Processing → Segmentation → Representation/Description → Object Recognition.
