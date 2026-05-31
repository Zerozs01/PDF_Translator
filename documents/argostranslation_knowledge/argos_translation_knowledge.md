# Argos Translation Knowledge Base for Electron + TypeScript + PaddleOCR / EasyOCR / Tesseract

## TL;DR

เอกสารนี้ออกแบบมาเพื่อใช้เป็น **knowledge markdown / implementation spec** สำ([electronjs.org](https://electronjs.org/docs/latest/tutorial/security?utm_source=chatgpt.com))te แบบ local-first โดยใช้:

- **Argos Translate** = offline machine translation
- **PaddleOCR** = OCR หลัก
- **EasyOCR** = OCR สำรองสำหรับบางเคส
- **Tesseract** = OCR fallback / structured export / deterministic CLI use cases
- **Electron + TypeScript** = app shell, IPC, orchestration, UI

แนวทางที่ถูกต้องคือ:

1. **Renderer ห้ามเรียก OCR/Translate โดยตรง**
2. ใช้ **IPC ผ่าน preload**
3. ให้ **Main Process / Utility Process** เป็นตัว orchestrate
4. OCR/Translate ควรถูกรันใน **worker service แยก**
5. เก็บผล OCR เป็น **normalized schema กลาง** ก่อนค่อยส่งเข้า translation pipeline
6. อย่าผูก UI กับ engine ใด engine หนึ่ง

---

# 1) เป้าหมายของระบบ

## 1.1 เป้าหมายหลัก

ระบบนี้มีหน้าที่:

- อ่านข้อความจากภาพ / PDF / screenshot
- รองรับหลาย OCR engine
- แปลข้อความแบบออฟไลน์ให้เร็วและคุมต้นทุนได้
- แสดงผลต้นฉบับ + คำแปล + ตำแหน่งข้อความบนภาพ
- รองรับ batching, caching, retry และ fallback
- แยก concern ให้ maintainable

## 1.2 เป้าหมายเชิงสถาปัตยกรรม

- **Maintainability**: เปลี่ยน OCR engine ได้โดยไม่รื้อทั้งระบบ
- **Performance**: UI ไม่ค้างระหว่าง OCR/translation
- **Reliability**: engine ตัวใดล่ม ระบบยัง fallback ได้
- **Security**: renderer ไม่ถือสิทธิ์ OS/process เกินจำเป็น
- **Testability**: ทุกชั้น mock และ benchmark ได้

---

# 2) สิ่งที่แต่ละตัวควรรับผิดชอบ

## 2.1 Argos Translate

Argos Translate เป็น offline translation library ใช้งานได้ทั้งแบบ Python library, CLI และ GUI และรองรับการติดตั้ง language packages นามสกุล `.argosmodel` สำหรับคู่ภาษาแต่ละชุด โดย engine นี้ใช้ OpenNMT สำหรับแปล, SentencePiece สำหรับ tokenization และ Stanza สำหรับ sentence boundary detection. LibreTranslate เป็นชั้น API ที่สร้างทับบน Argos Translate อีกที ([github.com](https://github.com/argosopentech/argos-translate/?utm_source=chatgpt.com))

### เหมาะกับ

- แอปแปลข้อความออฟไลน์
- OCR → translate pipeline
- local-first desktop app
- use case ที่ไม่อยากพึ่ง external API key

### ไม่เหมาะกับ

- translation quality ระดับ SOTA แบบ cloud LLM/NMT เชิงพาณิชย์
- language routing ซับซ้อนมากโดยไม่จัดการ package เอง
- งานที่ต้องการ multilingual domain adaptation ระดับสูง

## 2.2 PaddleOCR

PaddleOCR รองรับงาน OCR แบบ end-to-end และปัจจุบันชูจุดขายเรื่องการแปลง PDF/ภาพไปเป็น structured output เช่น JSON/Markdown ได้โดยตรง รวมทั้งมีองค์ประกอบ detection, recognition และ angle classification แยกชัดเจน ([github.com](https://github.com/PADDLEPADDLE/PADDLEOCR?utm_source=chatgpt.com))

### ควรใช้เป็น OCR หลักเมื่อ

- ต้องการความแม่นกับเอกสารจริงจัง
- ต้องการ bounding boxes ที่เสถียร
- ต้องการรองรับ preprocessing / detection / recognition pipeline ชัดเจน
- ต้องการ scale กับ batch OCR

## 2.3 EasyOCR

EasyOCR เป็น OCR แบบ ready-to-use ที่รองรับหลายภาษาและมี API `readtext` ที่ปรับ parameter ด้าน decoder, contrast, detection, merging ได้ค่อนข้างง่าย เหมาะกับงานทดลองเร็วและ fallback บางประเภท ([github.com](https://github.com/JaidedAI/EasyOCR?utm_source=chatgpt.com))

## 2.4 Offline Quality Notes

For the current Electron pipeline, offline translation quality is improved when the system:

- normalizes OCR noise before sending text into Argos
- prefers pivot routing for Korean comic dialogue when direct output looks weak
- filters short mixed-symbol OCR garbage tokens before translation
- applies small local phrase repairs for recurring noisy lines instead of trusting Argos to recover them

### ควรใช้เมื่อ

- ต้องการ integrate เร็ว
- ต้องการ fallback ที่ setup ไม่หนัก
- ต้องการลองกับภาพ scene text หรือภาพ UI บางประเภท

## 2.4 Tesseract

Tesseract เป็น OCR engine แบบ mature ที่รองรับทั้ง CLI และ library มี LSTM-based OCR ตั้งแต่ v4 และยังรองรับ output แบบ HOCR/TSV/structured text ซึ่งมีประโยชน์มากสำหรับ pipeline ที่ต้องการผลลัพธ์ deterministic และแปลงต่อภายหลัง ([github.com](https://github.com/tesseract-ocr/tesseract?utm_source=chatgpt.com))

### ควรใช้เมื่อ

- ต้องการ CLI ที่เสถียรและ scriptable
- ต้องการ TSV / HOCR / searchable-text workflow
- ต้องการ fallback ที่เบาและ predictable
- ต้องการ debug OCR ง่าย

---

# 3) ข้อสรุปเชิงวิศวกรรม

## 3.1 โครงที่แนะนำ

**Renderer → Preload API → IPC → Main Process → OCR/Translation Worker**

เหตุผล:

- Electron แนะนำให้ใช้ preload + contextBridge เพื่อ expose API แบบจำกัด และไม่ควร expose `ipcRenderer` ตรง ๆ ไปยัง renderer เพราะเสี่ยงด้าน security ([electronjs.org](https://electronjs.org/docs/latest/tutorial/security?utm_source=chatgpt.com))
- งาน OCR/translation เป็นงาน CPU-intensive / crash-prone จึงเหมาะจะย้ายไปไว้ใน utility process หรือ worker แยกจาก renderer/main thread ([electronjs.org](https://electronjs.org/docs/latest/api/utility-process?utm_source=chatgpt.com))

## 3.2 สิ่งที่ไม่ควรทำ

- ให้ renderer เรียก Python process ตรง ๆ
- bind UI state เข้ากับ output format ของ engine ตัวใดตัวหนึ่ง
- ใช้ raw text output เป็น source of truth โดยไม่เก็บ bbox / confidence / page metadata
- translate ทีละ token หรือทีละบรรทัดแบบ naive ถ้ายังไม่จัด segmentation
- ยัดทุก logic ไว้ใน Electron main process

---

# 4) Architecture ที่ควรใช้

## 4.1 Logical Layers

```text
[Renderer UI]
  └─ OCR request / translation request / overlay state

[Preload Bridge]
  └─ safe typed API

[Main Process]
  └─ orchestration
  └─ job queue
  └─ cache lookup
  └─ worker lifecycle

[OCR Worker Layer]
  ├─ PaddleOCR adapter
  ├─ EasyOCR adapter
  └─ Tesseract adapter

[Translation Worker Layer]
  └─ Argos adapter

[Storage Layer]
  ├─ model registry
  ├─ package registry
  ├─ OCR cache
  ├─ translation cache
  └─ user settings
```

## 4.2 Recommended Runtime Split

### Electron Renderer
- UI only
- image preview
- text overlay rendering
- progress / cancel button
- result comparison view

### Electron Main / Utility Process
- process spawning
- job scheduling
- model availability checks
- task cancellation
- retries
- observability/logging

### Python OCR/Translate Services
- OCR inference
- text normalization
- translation execution
- language detection helper
- confidence / geometry normalization

---

# 5) Data Contract กลางที่ต้องมี

อย่าปล่อยให้แต่ละ engine คืนค่าคนละรูปแบบแล้วให้ UI มาปวดหัวทีหลัง

## 5.1 Canonical OCR Result

```ts
export type OcrEngine = 'paddleocr' | 'easyocr' | 'tesseract'

export interface Point {
  x: number
  y: number
}

export interface BoundingBox {
  points: [Point, Point, Point, Point]
}

export interface OcrLine {
  id: string
  text: string
  confidence: number | null
  bbox: BoundingBox
  page: number
  languageHint?: string
  blockId?: string
  lineIndex?: number
  sourceEngine: OcrEngine
}

export interface OcrPageResult {
  page: number
  width: number
  height: number
  lines: OcrLine[]
}

export interface OcrDocumentResult {
  jobId: string
  engine: OcrEngine
  pages: OcrPageResult[]
  durationMs: number
  warnings: string[]
  raw?: unknown
}
```

## 5.2 Canonical Translation Result

```ts
export interface TranslationSegment {
  segmentId: string
  sourceText: string
  translatedText: string
  sourceLang: string
  targetLang: string
  engine: 'argos'
  confidence?: number | null
  relatedOcrLineIds: string[]
}

export interface TranslationDocumentResult {
  jobId: string
  segments: TranslationSegment[]
  durationMs: number
  warnings: string[]
}
```

## 5.3 OCR + Translation Joined ViewModel

```ts
export interface OverlayLineViewModel {
  lineId: string
  bbox: BoundingBox
  originalText: string
  translatedText?: string
  page: number
  confidence: number | null
  engine: OcrEngine
}
```

---

# 6) Engine Adapter Pattern

## 6.1 Interface กลาง

```ts
export interface OcrAdapter {
  readonly engine: OcrEngine
  isAvailable(): Promise<boolean>
  recognize(input: OcrInput): Promise<OcrDocumentResult>
}

export interface TranslationAdapter {
  readonly engine: 'argos'
  isAvailable(): Promise<boolean>
  translate(input: TranslationInput): Promise<TranslationDocumentResult>
}

export interface OcrInput {
  filePath: string
  languages?: string[]
  pageRange?: { start: number; end: number }
  preprocessProfile?: PreprocessProfileName
}

export interface TranslationInput {
  segments: Array<{
    id: string
    text: string
    sourceLang: string
    targetLang: string
    relatedOcrLineIds: string[]
  }>
}

export type PreprocessProfileName =
  | 'document-default'
  | 'low-contrast'
  | 'small-text'
  | 'ui-screenshot'
  | 'scene-text'
```

## 6.2 เหตุผลที่ต้องมี adapter

- สลับ engine ได้
- benchmark เทียบ engine ได้
- ทำ fallback chain ได้
- test แบบ mock ได้ง่าย
- ลด tight coupling

---

# 7) Decision Rules: จะใช้ OCR ตัวไหนเมื่อไร

## 7.1 Recommended Default Policy

### ใช้ PaddleOCR เป็น default
เมื่อ:
- เป็นเอกสาร
- มีหลายบรรทัด
- ต้องการ bbox แม่น
- ต้องการ throughput ที่ดีใน batch

### ใช้ EasyOCR เป็น fallback
เมื่อ:
- PaddleOCR fail
- ต้องการลองอีก engine กับข้อความเฉพาะจุด
- เป็นภาพที่ detection แบบเดิมพลาด

### ใช้ Tesseract เป็น fallback / structured mode
เมื่อ:
- ต้องการ TSV/HOCR
- ต้องการตรวจผลแบบ deterministic
- ต้องการ pipeline แบบ CLI ง่ายต่อ debug

## 7.2 ตัวอย่าง policy จริง

```ts
export function chooseOcrEngine(input: {
  mode: 'document' | 'screenshot' | 'scene'
  needStructuredOutput: boolean
  forceEngine?: OcrEngine
}): OcrEngine[] {
  if (input.forceEngine) return [input.forceEngine]

  if (input.needStructuredOutput) {
    return ['tesseract', 'paddleocr', 'easyocr']
  }

  switch (input.mode) {
    case 'document':
      return ['paddleocr', 'easyocr', 'tesseract']
    case 'screenshot':
      return ['paddleocr', 'easyocr', 'tesseract']
    case 'scene':
      return ['paddleocr', 'easyocr', 'tesseract']
    default:
      return ['paddleocr', 'easyocr', 'tesseract']
  }
}
```

---

# 8) Decision Rules: จะส่งข้อความเข้า Argos อย่างไร

## 8.1 ห้าม translate แบบบรรทัดละ 1 ทันทีโดยไม่คิด

ปัญหา:
- context ขาด
- สำนวนพัง
- ภาษาที่เว้นวรรคไม่ดีจะเละ
- latency สูงเพราะ call เยอะ

## 8.2 แนวทางที่ถูกต้อง

1. OCR ออกมาเป็น lines
2. group lines ตาม block / paragraph
3. normalize spacing
4. detect source language
5. batch translate เป็น segment
6. map translation กลับไปยัง line ids

## 8.3 Canonical Segmentation Strategy

### ระดับ line
ใช้เมื่อ:
- overlay ทีละบรรทัด
- subtitle-like text
- UI text

### ระดับ block
ใช้เมื่อ:
- เอกสารทั่วไป
- ย่อหน้า
- translation quality สำคัญกว่า exact layout

### ระดับ page chunk
ใช้เมื่อ:
- ต้องการ throughput
- ไม่ซีเรียสกับ line-perfect overlay

## 8.4 Recommended Heuristic

```ts
export function chooseSegmentationMode(input: {
  overlayMode: boolean
  avgLineLength: number
  lineCount: number
}): 'line' | 'block' {
  if (input.overlayMode) return 'line'
  if (input.avgLineLength < 25 && input.lineCount < 8) return 'line'
  return 'block'
}
```

---

# 9) Preprocessing ที่ควรมี

OCR แพ้ตั้งแต่ input ห่วย ไม่ใช่แพ้ตอน model เสมอไป

## 9.1 Mandatory Preprocessing Profiles

### document-default
- grayscale
- denoise เบา ๆ
- adaptive threshold ถ้าจำเป็น
- deskew
- resize ตาม minimum text height

### low-contrast
- contrast stretching
- CLAHE
- sharpen เบา ๆ
- threshold แบบ adaptive

### small-text
- upscale 1.5x–3x
- sharpen เฉพาะขอบ
- reduce compression artifacts

### ui-screenshot
- preserve anti-aliased glyphs
- หลีกเลี่ยง threshold แรงเกิน
- crop margins

### scene-text
- perspective correction
- local contrast enhancement
- denoise เฉพาะจุด

## 9.2 ห้ามทำ preprocessing แบบเดียวกับทุก input

นั่นคือสูตรพังเร็วสุด

---

# 10) OCR Normalization Rules

หลัง OCR ต้องมี post-process เสมอ

## 10.1 Rules

- trim whitespace หัวท้าย
- collapse space ซ้ำเกินจำเป็น
- normalize Unicode
- fix common OCR confusions ตามภาษา
- merge line ที่แตกเพราะ detection เพี้ยน
- split line ที่โดนรวมผิด
- preserve original raw text แยกจาก cleaned text

## 10.2 Suggested schema

```ts
export interface NormalizedOcrLine extends OcrLine {
  rawText: string
  normalizedText: string
  normalizationFlags: string[]
}
```

---

# 11) Translation Package Management for Argos

Argos Translate ใช้ language model packages แบบ `.argosmodel` สำหรับคู่ภาษาแต่ละชุด และต้องติดตั้ง package ให้พร้อมก่อนใช้งานจริง ([github.com](https://github.com/argosopentech/argos-translate/?utm_source=chatgpt.com))

## 11.1 สิ่งที่ระบบต้องมี

- language package registry
- package availability check
- source-target pair validation
- offline install flow
- version tracking

## 11.2 Minimal local registry schema

```ts
export interface ArgosPackageRecord {
  from: string
  to: string
  installed: boolean
  version?: string
  path?: string
}
```

## 11.3 Rules

- ถ้า package ไม่มี ต้อง fail แบบ explicit
- ห้าม silently fallback เป็นภาษาอื่น
- ถ้าต้อง pivot language เช่น th -> en -> ja ต้องประกาศใน result ชัดเจน
- package validation ต้องทำตอน app startup และก่อน run job

---

# 12) Electron Integration Rules

## 12.1 Security Baseline

Electron แนะนำให้ใช้ preload script และ `contextBridge.exposeInMainWorld()` เพื่อส่ง API ที่จำเป็นเท่านั้นเข้า renderer และไม่ควร expose `ipcRenderer` ตรง ๆ เพราะ renderer จะได้สิทธิ์กว้างเกินไป ([electronjs.org](https://electronjs.org/docs/latest/tutorial/security?utm_source=chatgpt.com))

## 12.2 Recommended API surface

```ts
export interface DesktopOcrApi {
  runOcr(request: RunOcrRequest): Promise<OcrDocumentResult>
  runTranslate(request: RunTranslateRequest): Promise<TranslationDocumentResult>
  runOcrAndTranslate(request: RunOcrAndTranslateRequest): Promise<OverlayLineViewModel[]>
  cancelJob(jobId: string): Promise<void>
  getInstalledEngines(): Promise<InstalledEngineInfo[]>
  getInstalledTranslationPackages(): Promise<ArgosPackageRecord[]>
}
```

## 12.3 สิ่งที่ preload ควร expose

- method ที่ typed แล้วเท่านั้น
- progress events แบบจำกัด channel
- cancel job
- settings read/write เฉพาะที่ต้องใช้

## 12.4 สิ่งที่ preload ไม่ควร expose

- raw `ipcRenderer`
- shell access
- filesystem access แบบ unrestricted
- arbitrary process execution

---

# 13) Process Model ที่เหมาะกับงานนี้

Electron มี `utilityProcess` สำหรับงานที่เป็น child process ฝั่ง Node.js และเหมาะกับงานหนักหรือส่วนที่มีโอกาส crash ได้มากกว่าไปกองไว้ใน main/renderer โดยตรง ([electronjs.org](https://electronjs.org/docs/latest/api/utility-process?utm_source=chatgpt.com))

## 13.1 Recommended execution model

### Option A: Main Process + child_process spawn Python
เหมาะกับ:
- prototype ที่ยังเล็ก
- tooling เข้าใจง่าย

ข้อเสีย:
- main process รับภาระ orchestration มาก
- จัดการ lifecycle ยุ่งเมื่อระบบโต

### Option B: Utility Process เป็น service host
เหมาะกับ:
- production app
- OCR/translation heavy
- ต้องการ isolation สูงขึ้น

ข้อดี:
- main process สะอาดกว่า
- fault isolation ดีกว่า
- scale worker ได้ง่ายกว่า

## 13.2 Recommendation

ใช้ **Utility Process เป็น orchestration host** แล้วให้มัน spawn Python workers อีกชั้นถ้าจำเป็น

---

# 14) Python Service Strategy

## 14.1 อย่าพยายามเรียก Python library จาก Node แบบฝืน ๆ

ทางที่สะอาดกว่า:

- Node/Electron = orchestration
- Python = OCR/translation inference
- สื่อสารกันด้วย JSON over stdio / local HTTP / message port

## 14.2 Recommended protocol

### JSON over stdio
เหมาะกับ:
- local worker
- no-network dependency
- simple request/response

### local HTTP
เหมาะกับ:
- debug ง่าย
- แยก service ชัด
- อาจขยายสู่ external worker ได้

## 14.3 Recommendation

เริ่มจาก **JSON over stdio** ก่อน เพราะเบาและตรงที่สุดสำหรับ desktop app

---

# 15) File and Module Structure ที่แนะนำ

```text
src/
  main/
    ipc/
      ocr.ipc.ts
      translation.ipc.ts
    services/
      job-queue.service.ts
      worker-manager.service.ts
      cache.service.ts
      settings.service.ts
    workers/
      ocr-worker-host.ts
      translation-worker-host.ts
    main.ts

  preload/
    index.ts
    api/
      desktop-ocr.api.ts

  renderer/
    features/
      ocr/
        hooks/
        state/
        components/
        mappers/
      translation/
        hooks/
        state/
        components/
    shared/
      types/
      utils/

  shared/
    contracts/
      ocr.contract.ts
      translation.contract.ts
      engine.contract.ts
    domain/
      ocr.types.ts
      translation.types.ts
      job.types.ts

python/
  app/
    adapters/
      paddleocr_adapter.py
      easyocr_adapter.py
      tesseract_adapter.py
      argos_adapter.py
    preprocess/
      profiles.py
    normalize/
      text_normalizer.py
    services/
      ocr_service.py
      translation_service.py
    main.py
```

---

# 16) IPC Contract Example

```ts
export interface RunOcrRequest {
  jobId: string
  filePath: string
  engine?: OcrEngine
  languages?: string[]
  preprocessProfile?: PreprocessProfileName
}

export interface RunTranslateRequest {
  jobId: string
  segments: Array<{
    id: string
    text: string
    sourceLang: string
    targetLang: string
    relatedOcrLineIds: string[]
  }>
}

export interface RunOcrAndTranslateRequest {
  jobId: string
  filePath: string
  ocrEnginePriority?: OcrEngine[]
  sourceLang: string
  targetLang: string
  preprocessProfile?: PreprocessProfileName
  overlayMode?: boolean
}
```

---

# 17) Cache Strategy

## 17.1 OCR Cache Key

ควรผูกกับ:
- file hash
- page number
- preprocess profile
- engine
- engine version
- language set

## 17.2 Translation Cache Key

ควรผูกกับ:
- normalized source text
- source lang
- target lang
- argos package version

## 17.3 ทำไมสำคัญ

- เอกสารเดิม OCR ซ้ำบ่อย
- user เปลี่ยนเฉพาะ overlay mode
- แปลซ้ำประโยคเดิมบ่อยมาก

---

# 18) Fallback Strategy ที่ควรใช้จริง

## 18.1 OCR fallback

```text
PaddleOCR
  ↓ if failed or confidence below threshold
EasyOCR
  ↓ if failed or need structured export
Tesseract
```

## 18.2 Translation fallback

Argos ไม่มี package = fail แบบ explicit

ไม่ควร silently fallback ไป cloud หากระบบประกาศตัวว่า offline-first เว้นแต่ user เปิด setting อนุญาตเอง

## 18.3 Confidence policy

- page-level confidence ต่ำ → retry ด้วย preprocess profile อื่น
- line-level confidence ต่ำ → mark uncertain overlay
- low confidence + short token → อาจใช้ re-OCR crop เฉพาะจุด

---

# 19) Performance Rules

Electron แนะนำให้แยกงานหนักออกจาก renderer/main เพื่อช่วยลดการกิน CPU/Memory แบบไม่จำเป็นและทำให้แอป responsive มากขึ้น ([electronjs.org](https://electronjs.org/docs/latest/tutorial/performance?utm_source=chatgpt.com))

## 19.1 ทำสิ่งนี้

- batch OCR ต่อ page
- parallel เฉพาะจุดที่เครื่องรับไหว
- translate ทีละ segment batch
- cache ทุกชั้น
- lazy load engine metadata
- prewarm worker หลัง app idle

## 19.2 อย่าทำสิ่งนี้

- OCR ทุกหน้าพร้อมกันแบบไม่จำกัด
- spawn process ใหม่ทุกครั้ง
- โหลด model ทุก job
- rerender overlay ทั้งเอกสารทุก key stroke

---

# 20) Error Taxonomy

## 20.1 OCR Errors

- `ENGINE_NOT_INSTALLED`
- `MODEL_NOT_FOUND`
- `INVALID_INPUT_FILE`
- `PREPROCESS_FAILED`
- `OCR_TIMEOUT`
- `OCR_PROCESS_CRASHED`

## 20.2 Translation Errors

- `ARGOS_NOT_INSTALLED`
- `ARGOS_PACKAGE_NOT_FOUND`
- `UNSUPPORTED_LANGUAGE_PAIR`
- `TRANSLATION_TIMEOUT`
- `TRANSLATION_PROCESS_CRASHED`

## 20.3 UI Rules

- error ต้อง actionable
- บอก engine ไหนล้ม
- บอก retry path
- บอก package/lang pair ที่ขาด

---

# 21) Observability

## 21.1 Metrics ที่ควรเก็บ

- OCR duration per page
- Translation duration per segment batch
- cache hit rate
- engine fallback count
- average confidence per page
- crash count per engine

## 21.2 ทำไมสำคัญ

ถ้าไม่วัด คุณจะไม่รู้ว่า “ช้าเพราะ OCR”, “ช้าเพราะ preprocess”, หรือ “ช้าเพราะ Argos segmentation พัง”

---

# 22) Testing Strategy

## 22.1 Unit tests

- adapter contract tests
- normalization tests
- segmentation tests
- cache key tests
- fallback policy tests

## 22.2 Integration tests

- Electron IPC ↔ worker
- worker ↔ Python service
- OCR result normalization
- OCR → translation → overlay mapping

## 22.3 Golden dataset tests

เตรียมชุดภาพ/PDF จริง แบ่งเป็น:
- clean document
- low contrast document
- Thai text
- English text
- mixed language
- screenshot UI
- scene text
- rotated text

วัด:
- OCR text accuracy
- bbox usability
- translation completeness
- end-to-end latency

---

# 23) Recommended Product Features

## 23.1 ต้องมี

- engine selector
- auto fallback toggle
- preprocess profile selector
- source/target language selector
- installed model/package diagnostics
- confidence overlay
- export result as JSON/Markdown

## 23.2 ควรมี

- side-by-side original/translation view
- line merge/split correction UI
- manual re-run on selected region
- package download/install manager
- benchmark panel per engine

---

# 24) Hard Truths

## 24.1 อย่าคาดหวังว่า Argos จะชนะ cloud translate ทุกมิติ

ข้อดีมันคือ:
- offline
- free after install
- private/local-first

ข้อเสียคือ:
- quality ไม่ใช่ top-tier ทุกภาษา
- package coverage และคุณภาพไม่เท่ากัน

## 24.2 OCR quality ไม่ได้ขึ้นกับ model อย่างเดียว

ส่วนใหญ่งานพังคือ:
- input ห่วย
- segmentation ห่วย
- preprocessing ผิด
- mapping OCR→translation ไม่ดี
- UI overlay logic แย่

## 24.3 ถ้าอยาก “เต็มที่” จริง ต้องลงทุนกับสามจุดนี้

1. canonical schema
2. preprocessing profiles
3. benchmark dataset ของตัวเอง

---

# 25) Final Recommendation

## Stack Recommendation

### OCR Primary
- PaddleOCR

### OCR Secondary
- EasyOCR

### OCR Structured / Fallback
- Tesseract

### Translation
- Argos Translate

### Desktop Runtime
- Electron + TypeScript

### Process Model
- Preload + IPC + Main/Utility Process + Python worker

## Why this is the best balance

- maintainable กว่าโยนทุกอย่างเข้า Node หรือ renderer
- scale ได้
- debug ง่าย
- security ถูกทาง
- รองรับทั้ง speed, fallback, offline use

---

# 26) Implementation Priorities

## Phase 1

- canonical schema
- preload API
- IPC handlers
- PaddleOCR adapter
- Argos adapter
- end-to-end OCR → translation JSON result

## Phase 2

- EasyOCR adapter
- Tesseract adapter
- fallback chain
- cache layer
- diagnostics screen

## Phase 3

- region re-OCR
- benchmarking suite
- overlay editor
- export JSON/Markdown
- package manager UI

---

# 27) Minimal Production Rules

- renderer = presentation only
- all OCR/translation jobs are cancellable
- all engines must implement same adapter contract
- every OCR result must be normalized
- translation must run on grouped segments, not naive raw lines only
- cache aggressively
- never expose raw Electron internals to renderer
- track installed Argos packages explicitly

---

# 28) Key Source Notes

- Argos Translate ใช้งานได้แบบ Python library / CLI / GUI และติดตั้ง language model packages `.argosmodel` ได้ โดย LibreTranslate เป็น API layer ที่ใช้ Argos เป็น engine ข้างใต้ ([github.com](https://github.com/argosopentech/argos-translate/?utm_source=chatgpt.com))
- PaddleOCR รองรับ OCR pipeline ที่มี detection / recognition / angle classification และปัจจุบันชู structured output เช่น JSON/Markdown สำหรับ PDF/ภาพ ([github.com](https://github.com/PADDLEPADDLE/PADDLEOCR?utm_source=chatgpt.com))
- EasyOCR มี `readtext` API ที่ปรับ decoder / beam width / detection / merge behavior ได้ค่อนข้างสะดวก ([github.com](https://github.com/JaidedAI/EasyOCR?utm_source=chatgpt.com))
- Tesseract รองรับ CLI และ structured outputs เช่น HOCR ซึ่งเหมาะกับ fallback และ debugging pipeline ([github.com](https://github.com/tesseract-ocr/tesseract?utm_source=chatgpt.com))
- Electron แนะนำให้ใช้ preload + contextBridge, ไม่ expose raw `ipcRenderer`, และแยกงานหนักไป utility process เมื่อเหมาะสม ([electronjs.org](https://electronjs.org/docs/latest/tutorial/security?utm_source=chatgpt.com))

---

# 29) Practical Bottom Line

ถ้าคุณต้องการระบบที่ “ใช้ได้จริงในโปรดักชัน”:

- **อย่าเริ่มจาก UI**
- เริ่มจาก **contract + worker architecture + benchmark dataset**
- ให้ PaddleOCR เป็น main path
- ให้ Argos เป็น offline translation path
- ให้ EasyOCR/Tesseract เป็น strategic fallback
- แยกทุกอย่างผ่าน typed IPC

นั่นคือโครงที่ถูก ไม่ใช่แค่โครงที่รันผ่าน

