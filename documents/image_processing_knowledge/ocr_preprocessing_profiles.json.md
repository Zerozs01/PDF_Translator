# OCR Preprocessing Profiles JSON Spec

Version: 1.0
Scope: PaddleOCR / EasyOCR / Tesseract / Electron OCR Runtime
Purpose: Define deterministic preprocessing profiles as configuration data instead of hardcoded logic.

---

## 1. Core Principle

Do not hardcode preprocessing rules deep inside OCR service logic.

Preprocessing profiles should be represented as structured configuration.
This makes the OCR pipeline:

- testable
- editable
- versionable
- benchmarkable
- safer to tune over time

The orchestrator should choose a profile.
The preprocessing engine should execute the profile.

---

## 2. Design Goal

Each OCR profile must describe:

- when it should be used
- which transformations are enabled
- their execution order
- parameter values
- engine compatibility notes
- validation expectations

Profiles must be deterministic.
They must not depend on vague runtime intuition.

---

## 3. Recommended File Format

Use JSON-like config as the runtime source of truth.

Recommended filename:

- `ocr-preprocessing-profiles.json`

This markdown file defines the schema and a production-ready starter example.

---

## 4. Profile Names

Supported baseline profiles:

- `clean_document`
- `camera_document`
- `screenshot_ui`
- `receipt_thermal`
- `scene_text`

Optional future profiles:

- `handwriting_note`
- `low_light_photo`
- `table_form`
- `id_card`
- `book_page_curved`

Do not create too many profiles early.
Start small and benchmark.

---

## 5. Top-Level JSON Structure

```json
{
  "version": "1.0",
  "profiles": {
    "clean_document": {},
    "camera_document": {},
    "screenshot_ui": {},
    "receipt_thermal": {},
    "scene_text": {}
  }
}
````

---

## 6. Per-Profile Structure

Each profile should follow this structure:

```json
{
  "id": "clean_document",
  "enabled": true,
  "description": "Preprocessing chain for flat, high-contrast document images",
  "inputHints": {
    "documentLike": true,
    "sceneLike": false,
    "uiLike": false,
    "receiptLike": false
  },
  "enginePreference": {
    "primary": ["tesseract", "paddleocr"],
    "fallback": ["paddleocr", "easyocr"]
  },
  "steps": [],
  "validationHints": {
    "expectedTextDensity": "medium_to_high",
    "expectedLineCount": "multi_line",
    "preferBinarizedOutput": true
  }
}
```

---

## 7. Step Object Schema

Each preprocessing step should be represented as a declarative object.

```json
{
  "name": "grayscale",
  "enabled": true,
  "order": 10,
  "params": {}
}
```

Rules:

- `name` is required
- `enabled` is required
- `order` is required
- `params` is required, even if empty

Do not encode logic in free text.

---

## 8. Supported Step Names

Baseline supported steps:

- `orientation_normalize`
- `remove_alpha`
- `preserve_rgb`
- `grayscale`
- `upscale`
- `downscale`
- `gamma_correction`
- `contrast_stretch`
- `clahe`
- `median_filter`
- `gaussian_blur`
- `bilateral_filter`
- `deskew`
- `perspective_warp`
- `otsu_threshold`
- `adaptive_threshold`
- `invert_if_needed`
- `dilation`
- `erosion`
- `opening`
- `closing`
- `sharpen`
- `crop_roi`
- `pad_border`

Do not enable all of them in one profile.

---

## 9. Parameter Rules

Each step must have explicit parameters.
No hidden defaults in business logic unless they are documented centrally.

Examples:

### upscale

```json
{
  "name": "upscale",
  "enabled": true,
  "order": 20,
  "params": {
    "scale": 2.0,
    "interpolation": "bicubic",
    "onlyIfMinDimensionBelow": 1200
  }
}
```

### clahe

```json
{
  "name": "clahe",
  "enabled": true,
  "order": 40,
  "params": {
    "clipLimit": 2.0,
    "tileGridSize": [8, 8]
  }
}
```

### deskew

```json
{
  "name": "deskew",
  "enabled": true,
  "order": 50,
  "params": {
    "maxAngle": 10,
    "method": "projection_profile"
  }
}
```

### adaptive_threshold

```json
{
  "name": "adaptive_threshold",
  "enabled": true,
  "order": 60,
  "params": {
    "method": "gaussian",
    "blockSize": 31,
    "c": 15
  }
}
```

### closing

```json
{
  "name": "closing",
  "enabled": true,
  "order": 70,
  "params": {
    "kernelShape": "rect",
    "kernelSize": [2, 2],
    "iterations": 1
  }
}
```

---

## 10. Execution Rules

Execution engine must:

- sort steps by `order`
- skip disabled steps
- validate parameter schema before running
- record every executed step in metadata
- fail safely if a step config is invalid

Do not:

- silently change order at runtime
- inject surprise transforms outside the profile
- mutate profile definitions in memory without versioning

---

## 11. Recommended Starter Profiles

Below is the full recommended starter config.

```json
{
  "version": "1.0",
  "profiles": {
    "clean_document": {
      "id": "clean_document",
      "enabled": true,
      "description": "For flat scanned pages or very clean document photos with strong foreground/background separation.",
      "inputHints": {
        "documentLike": true,
        "sceneLike": false,
        "uiLike": false,
        "receiptLike": false
      },
      "enginePreference": {
        "primary": ["tesseract", "paddleocr"],
        "fallback": ["paddleocr", "easyocr"]
      },
      "steps": [
        {
          "name": "orientation_normalize",
          "enabled": true,
          "order": 10,
          "params": {}
        },
        {
          "name": "remove_alpha",
          "enabled": true,
          "order": 20,
          "params": {}
        },
        {
          "name": "grayscale",
          "enabled": true,
          "order": 30,
          "params": {}
        },
        {
          "name": "deskew",
          "enabled": true,
          "order": 40,
          "params": {
            "maxAngle": 8,
            "method": "projection_profile"
          }
        },
        {
          "name": "median_filter",
          "enabled": false,
          "order": 50,
          "params": {
            "kernelSize": 3
          }
        },
        {
          "name": "otsu_threshold",
          "enabled": true,
          "order": 60,
          "params": {}
        },
        {
          "name": "pad_border",
          "enabled": true,
          "order": 70,
          "params": {
            "size": 12,
            "mode": "constant",
            "value": 255
          }
        }
      ],
      "validationHints": {
        "expectedTextDensity": "medium_to_high",
        "expectedLineCount": "multi_line",
        "preferBinarizedOutput": true
      }
    },

    "camera_document": {
      "id": "camera_document",
      "enabled": true,
      "description": "For mobile photos of documents with perspective distortion, shadows, and uneven lighting.",
      "inputHints": {
        "documentLike": true,
        "sceneLike": false,
        "uiLike": false,
        "receiptLike": false
      },
      "enginePreference": {
        "primary": ["paddleocr"],
        "fallback": ["tesseract", "easyocr"]
      },
      "steps": [
        {
          "name": "orientation_normalize",
          "enabled": true,
          "order": 10,
          "params": {}
        },
        {
          "name": "remove_alpha",
          "enabled": true,
          "order": 20,
          "params": {}
        },
        {
          "name": "perspective_warp",
          "enabled": true,
          "order": 30,
          "params": {
            "method": "document_contour",
            "fallbackToOriginalIfNotFound": true
          }
        },
        {
          "name": "grayscale",
          "enabled": true,
          "order": 40,
          "params": {}
        },
        {
          "name": "clahe",
          "enabled": true,
          "order": 50,
          "params": {
            "clipLimit": 2.0,
            "tileGridSize": [8, 8]
          }
        },
        {
          "name": "deskew",
          "enabled": true,
          "order": 60,
          "params": {
            "maxAngle": 10,
            "method": "projection_profile"
          }
        },
        {
          "name": "adaptive_threshold",
          "enabled": false,
          "order": 70,
          "params": {
            "method": "gaussian",
            "blockSize": 31,
            "c": 15
          }
        },
        {
          "name": "pad_border",
          "enabled": true,
          "order": 80,
          "params": {
            "size": 10,
            "mode": "constant",
            "value": 255
          }
        }
      ],
      "validationHints": {
        "expectedTextDensity": "medium",
        "expectedLineCount": "multi_line",
        "preferBinarizedOutput": false
      }
    },

    "screenshot_ui": {
      "id": "screenshot_ui",
      "enabled": true,
      "description": "For UI screenshots, app windows, menus, labels, and digital text rendered by software.",
      "inputHints": {
        "documentLike": false,
        "sceneLike": false,
        "uiLike": true,
        "receiptLike": false
      },
      "enginePreference": {
        "primary": ["paddleocr"],
        "fallback": ["tesseract", "easyocr"]
      },
      "steps": [
        {
          "name": "orientation_normalize",
          "enabled": true,
          "order": 10,
          "params": {}
        },
        {
          "name": "remove_alpha",
          "enabled": true,
          "order": 20,
          "params": {}
        },
        {
          "name": "upscale",
          "enabled": true,
          "order": 30,
          "params": {
            "scale": 2.0,
            "interpolation": "bicubic",
            "onlyIfMinDimensionBelow": 1000
          }
        },
        {
          "name": "preserve_rgb",
          "enabled": true,
          "order": 40,
          "params": {}
        },
        {
          "name": "sharpen",
          "enabled": true,
          "order": 50,
          "params": {
            "method": "unsharp_mask",
            "amount": 0.8,
            "radius": 1.0,
            "threshold": 3
          }
        }
      ],
      "validationHints": {
        "expectedTextDensity": "low_to_medium",
        "expectedLineCount": "short_fragments_or_multi_line",
        "preferBinarizedOutput": false
      }
    },

    "receipt_thermal": {
      "id": "receipt_thermal",
      "enabled": true,
      "description": "For faded receipts, thermal paper, low contrast item lines, and broken print strokes.",
      "inputHints": {
        "documentLike": true,
        "sceneLike": false,
        "uiLike": false,
        "receiptLike": true
      },
      "enginePreference": {
        "primary": ["paddleocr"],
        "fallback": ["tesseract", "easyocr"]
      },
      "steps": [
        {
          "name": "orientation_normalize",
          "enabled": true,
          "order": 10,
          "params": {}
        },
        {
          "name": "remove_alpha",
          "enabled": true,
          "order": 20,
          "params": {}
        },
        {
          "name": "grayscale",
          "enabled": true,
          "order": 30,
          "params": {}
        },
        {
          "name": "clahe",
          "enabled": true,
          "order": 40,
          "params": {
            "clipLimit": 2.5,
            "tileGridSize": [8, 8]
          }
        },
        {
          "name": "adaptive_threshold",
          "enabled": true,
          "order": 50,
          "params": {
            "method": "gaussian",
            "blockSize": 35,
            "c": 12
          }
        },
        {
          "name": "closing",
          "enabled": true,
          "order": 60,
          "params": {
            "kernelShape": "rect",
            "kernelSize": [2, 2],
            "iterations": 1
          }
        },
        {
          "name": "deskew",
          "enabled": true,
          "order": 70,
          "params": {
            "maxAngle": 12,
            "method": "projection_profile"
          }
        },
        {
          "name": "pad_border",
          "enabled": true,
          "order": 80,
          "params": {
            "size": 12,
            "mode": "constant",
            "value": 255
          }
        }
      ],
      "validationHints": {
        "expectedTextDensity": "medium",
        "expectedLineCount": "multi_line",
        "preferBinarizedOutput": true
      }
    },

    "scene_text": {
      "id": "scene_text",
      "enabled": true,
      "description": "For natural scene text such as signs, labels, posters, packaging, and mixed background imagery.",
      "inputHints": {
        "documentLike": false,
        "sceneLike": true,
        "uiLike": false,
        "receiptLike": false
      },
      "enginePreference": {
        "primary": ["paddleocr"],
        "fallback": ["easyocr", "tesseract"]
      },
      "steps": [
        {
          "name": "orientation_normalize",
          "enabled": true,
          "order": 10,
          "params": {}
        },
        {
          "name": "remove_alpha",
          "enabled": true,
          "order": 20,
          "params": {}
        },
        {
          "name": "preserve_rgb",
          "enabled": true,
          "order": 30,
          "params": {}
        },
        {
          "name": "upscale",
          "enabled": true,
          "order": 40,
          "params": {
            "scale": 1.5,
            "interpolation": "bicubic",
            "onlyIfMinDimensionBelow": 960
          }
        },
        {
          "name": "bilateral_filter",
          "enabled": true,
          "order": 50,
          "params": {
            "diameter": 5,
            "sigmaColor": 50,
            "sigmaSpace": 50
          }
        },
        {
          "name": "crop_roi",
          "enabled": false,
          "order": 60,
          "params": {
            "source": "detector_or_user_selection"
          }
        }
      ],
      "validationHints": {
        "expectedTextDensity": "low_to_medium",
        "expectedLineCount": "fragmented_or_multi_region",
        "preferBinarizedOutput": false
      }
    }
  }
}
```

---

## 12. Runtime Rules for Profile Selection

Profile selection must happen before preprocessing.

Suggested selection order:

1. use explicit user-selected mode if provided
2. otherwise use classifier result
3. otherwise fall back to a safe default:

   - `camera_document` for document-like photo
   - `screenshot_ui` for screenshots
   - `scene_text` for natural image text
   - `clean_document` for flat scanned pages

Do not:

- pick a random profile
- switch profile mid-pipeline without recording why

---

## 13. Alternate Profile Retry Policy

If validation fails, the orchestrator may retry with a different profile.

Recommended controlled retries:

- `camera_document` -> retry with `clean_document` if image becomes flat and binarized after preprocessing
- `receipt_thermal` -> retry with same profile but disable `closing` if characters merge
- `scene_text` -> retry with `screenshot_ui` if image is actually digital UI
- `screenshot_ui` -> retry with `scene_text` if stylized colored text fails

Do not:

- chain unlimited retries
- try every profile blindly
- hide retry history from metadata

---

## 14. Metadata Logging Rule

The runtime must log:

- selected profile id
- executed steps
- disabled steps skipped
- parameter values used
- retry profile if any
- validation result after profile execution

This is required for:

- debugging
- benchmarking
- regression testing
- profile tuning

---

## 15. Versioning Rule

Profiles must be versioned.

At minimum:

- top-level config version
- optional per-profile revision number

Why:

- OCR accuracy changes after tiny parameter changes
- benchmark comparisons are meaningless without profile version tracking
- cache keys depend on profile version

---

## 16. Validation Hint Usage

`validationHints` are not preprocessing steps.
They are downstream hints for validator and fallback policy.

Examples:

- `preferBinarizedOutput = true`
- `expectedLineCount = multi_line`
- `expectedTextDensity = low_to_medium`

Use them to:

- adjust validation thresholds
- adjust fallback sensitivity
- improve task fit

Do not:

- treat them as executable image transforms

---

## 17. Engine Compatibility Notes

### clean_document

Best with:

- Tesseract
- PaddleOCR

### camera_document

Best with:

- PaddleOCR

### screenshot_ui

Best with:

- PaddleOCR
- Tesseract for simple block text

### receipt_thermal

Best with:

- PaddleOCR first
- Tesseract after successful thresholding

### scene_text

Best with:

- PaddleOCR
- EasyOCR as fallback

Do not assume one profile is universally good for all engines.

---

## 18. Anti-Patterns

Do not:

- create one giant default profile for all inputs
- let code override parameters silently
- hide engine-specific tuning inside unrelated modules
- enable heavy morphology everywhere
- threshold scene text by default
- sharpen noisy receipts aggressively
- keep profile definitions outside version control

---

## 19. Final Operational Rule

Profiles are the executable bridge between OCR policy and OCR code.

Use:

- profile-driven preprocessing
- deterministic ordering
- explicit parameters
- versioned config
- measured retries only

Bottom line:
Do not hardcode preprocessing behavior as scattered if-else logic.
Centralize it as data, benchmark it, and evolve it deliberately.
