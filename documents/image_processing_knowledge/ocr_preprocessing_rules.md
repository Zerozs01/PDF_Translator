# OCR Preprocessing Rules

Version: 1.0
Scope: PaddleOCR / EasyOCR / Tesseract
Purpose: Define image preprocessing policies that improve OCR accuracy without causing unnecessary distortion.

---

## 1. Core Principle

Preprocessing is not decoration.
It exists to improve text separability, text geometry, and stroke readability.

Bad preprocessing can reduce OCR accuracy even when the original image was acceptable.

Therefore:

- preprocess conditionally
- avoid global over-processing
- use measurable triggers
- keep the pipeline reversible and testable

---

## 2. Golden Rule

Apply the minimum effective transformation.

Priority:

1. fix geometry
2. fix contrast
3. remove destructive noise
4. repair broken strokes only if needed
5. sharpen only when justified

Do not:

- stack many filters blindly
- binarize too early for scene text
- oversharpen small text
- denoise until strokes disappear

---

## 3. Preprocessing Stages

### Stage A: Input Normalization

Standardize the image before any heavy operation.

Actions:

- convert to a known color format
- normalize orientation metadata
- remove alpha channel if present
- preserve original image copy
- record width, height, aspect ratio, bit depth

Recommended:

- keep original RGB copy
- create grayscale working copy only when needed

---

### Stage B: Resolution Handling

Text that is too small will fail regardless of OCR engine.

Rules:

- if text height is too small, upscale before OCR
- avoid repeated resize cycles
- use bilinear or bicubic interpolation
- avoid nearest-neighbor for OCR preprocessing

Guideline:

- upscale only when characters are visibly undersampled
- do not upscale excessively, as fake detail is not real detail

Use cases:

- small UI labels
- compressed screenshots
- low-resolution document crops

---

### Stage C: Geometry Correction

OCR accuracy collapses when text lines are not geometrically stable.

#### 1. Rotation / Deskew

Apply when:

- baseline tilt is visible
- document scan/photo is rotated
- horizontal text lines are not level

Preferred fixes:

- estimate skew angle
- rotate once with proper interpolation
- preserve margins

Important:

- Tesseract benefits heavily from deskew
- PaddleOCR is more tolerant, but still improves with corrected geometry

#### 2. Perspective Correction

Apply when:

- camera photo of document is trapezoidal
- page edges converge
- text line heights vary by position

Use:

- corner detection or contour-based document detection
- perspective warp to flatten the page

Important:

- do this before thresholding
- especially important for receipts, books, forms, and photographed paper

---

## 4. Contrast and Illumination Rules

### 4.1 Global Contrast Adjustment

Apply when:

- text is present but washed out
- foreground/background intensity gap is weak

Good tools:

- linear contrast stretch
- gamma correction

Use gamma:

- brighten dark image
- compress overexposed highlights
- normalize phone camera capture

Avoid:

- global contrast boost when background texture is heavy

---

### 4.2 Local Contrast Enhancement

Apply when:

- lighting is uneven
- one side of page is darker
- shadows or gradients exist

Preferred:

- CLAHE

Use carefully:

- helps faded receipts and uneven document photos
- may amplify background texture if overused

Recommended:

- use mild CLAHE, not aggressive settings

---

## 5. Noise Removal Rules

### 5.1 Salt-and-Pepper Noise

Symptoms:

- isolated black/white dots
- scanner dust
- random impulse artifacts

Preferred:

- median filter

Do not:

- use strong Gaussian blur first

---

### 5.2 Mild Sensor Noise / Compression Noise

Symptoms:

- fine grain
- JPEG artifacts
- light random noise

Preferred:

- mild Gaussian blur
- bilateral filter if edge preservation matters

Trade-off:

- too much smoothing destroys character edges

---

### 5.3 Background Texture Noise

Symptoms:

- paper fibers
- patterned background
- cloth, wall, wood texture behind text

Preferred:

- local contrast separation
- masking
- region cropping
- adaptive threshold only if text/background separation is strong enough

Avoid:

- heavy blur that smears text strokes into background

---

## 6. Binarization Rules

Binarization is highly useful for Tesseract and classic document OCR.
It is not always the best first move for scene text.

### Use global thresholding when

- background is uniform
- page is clean
- illumination is stable

### Use Otsu when

- document is mostly bimodal
- grayscale text-vs-background separation is reasonable

### Use adaptive thresholding when

- illumination is uneven
- receipt print is faded
- shadows exist
- local contrast varies heavily

### Avoid early binarization when

- text is colored and background is complex
- scene text must preserve subtle gradients
- PaddleOCR detector works better on original RGB/grayscale image

Practical rule:

- **Tesseract often wants better binarization**
- **PaddleOCR often wants cleaner but not necessarily fully binarized input**
- **EasyOCR usually benefits from readable contrast, not aggressive threshold damage**

---

## 7. Morphological Repair Rules

Morphology is for fixing text structure, not for blindly modifying every image.

### Use dilation when

- text strokes are too faint
- thermal print is broken
- dot-matrix or fragmented characters exist

Risk:

- characters merge together if overapplied

---

### Use erosion when

- ink bleed causes touching characters
- thick blobs merge into each other

Risk:

- thin characters may disappear

---

### Use opening when

- tiny isolated foreground specks exist

### Use closing when

- characters have small internal gaps
- broken strokes need reconnecting

Rule:

- use small kernels
- choose kernel shape based on expected text orientation and scale

Do not:

- apply morphology globally on unknown images without tests

---

## 8. Sharpening Rules

Sharpening is useful only when text edges are soft but still recoverable.

Use when:

- mild blur
- slightly soft screenshot
- phone photo with edge softness

Methods:

- unsharp masking
- Laplacian-based edge enhancement
- mild high-frequency emphasis

Do not sharpen when:

- image already noisy
- JPEG artifacts are strong
- thermal print is fragmented
- blur is severe enough that deblurring would be needed instead

Reason:

- sharpening noise creates fake edges and hurts OCR

---

## 9. Deblurring Rules

Deblurring is expensive and risky.
Do not enable it by default.

Consider only when:

- motion blur or out-of-focus blur is obvious
- text edges are broad and smeared
- ordinary sharpening fails

Options:

- Wiener filtering
- deconvolution
- learned deblur model

Policy:

- use as an optional recovery path
- trigger only if blur score is below threshold
- log its activation because it changes image semantics

---

## 10. Color Handling Rules

### Convert to grayscale when

- document-style OCR
- clean machine text
- color carries little useful information

### Preserve color or HSV logic when

- text and background differ more by hue than brightness
- red text on dark blue background
- neon signs
- UI text with colored highlights

Important:

- scene-text OCR may benefit from retaining RGB
- do not force grayscale too early for all inputs

---

## 11. Region Cropping Rules

OCR works better on smaller relevant regions than on full noisy canvases.

Apply cropping when:

- document region can be isolated
- UI panel boundaries are known
- user selects ROI
- detector already found probable text region

Benefits:

- less background confusion
- lower compute cost
- better recognition quality

---

## 12. Engine-Specific Preprocessing Policy

### PaddleOCR

Best with:

- corrected geometry
- good contrast
- moderate denoising
- RGB or readable grayscale
- not always aggressively binarized

Avoid:

- forcing harsh black/white threshold on scene text unless tested

---

### EasyOCR

Best with:

- readable contrast
- reasonable crop quality
- mild denoising
- preserved visual structure

Avoid:

- overprocessed morphology that distorts character shape

---

### Tesseract

Best with:

- deskewed image
- clean binarization
- simple layout
- strong foreground/background separation
- adequate DPI / scale

Avoid:

- feeding raw camera photos without cleanup
- complex textured scene text

---

## 13. Minimal Preprocessing Profiles

### Profile A: Clean Document

- grayscale
- deskew
- Otsu or simple threshold
- optional light median filter
- send to Tesseract or PaddleOCR

### Profile B: Camera Document

- orientation normalize
- perspective correction
- grayscale or keep RGB copy
- CLAHE
- adaptive threshold if needed
- light morphology if strokes are broken
- send to PaddleOCR first

### Profile C: Screenshot / UI

- upscale if tiny
- optional mild sharpen
- preserve RGB or grayscale
- minimal denoise
- send to PaddleOCR first

### Profile D: Receipt / Thermal Print

- grayscale
- CLAHE
- adaptive threshold
- closing or dilation if broken strokes
- deskew
- send to PaddleOCR first, Tesseract second

### Profile E: Scene Text

- preserve RGB
- crop ROI if possible
- mild denoise
- avoid destructive thresholding
- send to PaddleOCR first, EasyOCR second

---

## 14. Validation Rules After Preprocessing

Always verify whether preprocessing helped.

Check:

- character edges clearer?
- text/background separation improved?
- noise reduced without losing strokes?
- connected characters still separable?
- OCR confidence or valid text rate increased?

If not improved:

- revert
- try alternate profile
- do not chain more random filters

---

## 15. Anti-Patterns

Do not:

- always grayscale first
- always threshold first
- always sharpen first
- always denoise first
- always run morphology
- resize multiple times
- apply one universal preprocessing pipeline to every image

---

## 16. Final Operational Policy

Use preprocessing as a controlled decision system:

- fix geometry first
- improve contrast second
- denoise only as needed
- binarize mainly for document OCR
- repair text structure only when broken
- preserve scene-text information unless proven harmful

Bottom line:

- **Tesseract wants stronger preprocessing**
- **PaddleOCR wants smarter preprocessing**
- **EasyOCR wants readable preprocessing**
