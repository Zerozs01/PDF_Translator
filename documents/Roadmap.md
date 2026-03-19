# OCR Accuracy & Refactor Roadmap

Last updated: 2026-03-10

---

## ปัญหาหลัก: OCR ตรวจจับข้อความไม่ครบในหน้าเดียวกัน

จากการวิเคราะห์ภาพ debug overlay ที่วงกรอบสีเขียว พบว่าข้อความที่อยู่ใกล้กัน (ห่างกันไม่กี่ช่องไฟ/ไม่กี่บรรทัด) ถูก **กรองทิ้ง** หรือ **Tesseract ไม่เห็น** มาตั้งแต่แรก

### สาเหตุหลัก 5 ข้อ

| # | สาเหตุ | ไฟล์ | ผลกระทบ |
|---|--------|------|---------|
| 1 | **Otsu Binarization ทำลาย speech bubbles สี** | `ocr-preprocessing.ts` | Korean text บน colored bubble หาย |
| 2 | **Image Tile Mask กรองผิด** | `ocr-filtering.ts:buildImageTileMask` | คำบน tile ที่ถูก mark เป็น image จะถูก drop |
| 3 | **Background Variance Filter เกิน** | `ocr-filtering.ts:filterWordsByBackground` | text บนฉากที่มีรายละเอียดถูก drop |
| 4 | **Noise Filter Thresholds สูงเกิน** | `ocr-filtering.ts:cleanLineNoise` | คำสั้นๆ ที่ conf < 55 ถูกตัดออก |
| 5 | **CJK Fallback ไม่ cover ทุกกรณี** | `ocr-fallback.ts` | บริเวณที่ fallback ไม่ถูก scan จะพลาดข้อความ |

---

## สถานะ Refactoring

### ✅ Phase B: Refactor `worker.ts` (COMPLETED)

`worker.ts` ถูก refactor จาก **2636 บรรทัด** เหลือ **~500 บรรทัด** โดยแยกเป็น modules:

| ไฟล์ | บรรทัด | หน้าที่ |
|------|--------|---------|
| `ocr-types.ts` | ~43 | Type definitions (BBox, OCRWord, TesseractResult) |
| `ocr-config.ts` | ~120 | CONFIG thresholds (ค่าตรงกับ original ทุกตัว) |
| `ocr-text-utils.ts` | ~114 | Character detection, language helpers, word joining |
| `ocr-preprocessing.ts` | ~101 | Image loading, binarization, dimension detection |
| `ocr-parsing.ts` | ~280 | TSV parsing, PCA-based word sorting, line/bbox utilities |
| `ocr-filtering.ts` | ~400 | Noise filter, image tile mask, background variance filter |
| `ocr-fallback.ts` | ~180 | Region re-OCR, chunked recognition, vertical gap detection |
| `ocr-region.ts` | ~112 | Region classification & word grouping |
| `worker.ts` | ~500 | Message handler + imports only |

### ✅ Phase A1: Ghost Text Reduction (2026-03-10)

**สิ่งที่ทำ:**
- สร้าง `worker-boot.ts` boot loader สำหรับ primary worker crash recovery
- เปลี่ยน `worker-stable.ts` จาก basic 4-rule filter เป็น 7-layer filtering pipeline
- เพิ่ม lexical dictionary (`LATIN_COMMON` ~200+ คำ) แทน pure heuristics
- เพิ่ม readability scoring + watermark detection (manga sites, URLs)
- Ghost text ลดลงมาก: P2 59→22, P3 25→12, P5 60→25

**บัคที่ยังเหลือ:**
- Tesseract misread: `XUJIA TOWN` → `AVIA TOdl CR En Se` (P2)
- Ghost fragments: `CREAweaErSRETHIbe` (P3), `vided/Wis/wraphimills` (P5)
- Missing text: `THIS KIND OF STUFF` (P5), `THE PEOPLE HERE?` (P10)
- Word merging: `TAKEA LOOK`, `NowI`, `MAKEDO`

### ⚠️ Phase A: บทเรียนจาก "relaxed filters"

**Phase A ที่พยายาม relax thresholds ทำให้แย่ลง:**
- ลด `IMG_VARIANCE` (820→1050), `IMG_EDGE_VARIANCE` (480→620) → ทำให้ image tiles detect น้อยลง → false text noise เพิ่ม
- ลด `IMG_TEXT_CONF_MIN` (80→65) → tiles ที่มี garbage word ยังถือเป็น text-likely
- เพิ่ม `PHOTO_BG_VARIANCE` (850→1200) → photo filter ไม่ทำงานแทบเลย
- เพิ่ม bypass: `if (nonLatin && word.confidence >= 40) return true;` → Korean noise ผ่านหมด
- เพิ่ม `gapBudget` (20→40) → fallback OCR สร้าง garbage words เพิ่ม

**ผลลัพธ์: ยิ่ง relax ยิ่ง detect ตำแหน่งภาพเยอะจนเป็น noise** → **Reverted ทั้งหมดกลับค่า original**

### สรุป: ต้องทำ Phase A แบบ targeted ไม่ใช่ global

แทนที่จะ relax ค่า threshold ทั่วไป ต้อง:
1. **วิเคราะห์ per-word ว่าถูก drop ที่ stage ไหน** — เปิด `CONFIG.DEBUG_LOG_DROPS = true`
2. **ดูว่า speech bubble text หายเพราะอะไร** — อาจเป็น Tesseract ไม่เห็นตั้งแต่แรก ไม่ใช่ filter
3. **ถ้าเป็น filter** — tune เฉพาะ filter ที่ drop + เฉพาะ condition ที่ trigger

---

## Roadmap: ลำดับงานถัดไป

### Phase A2: แก้ปัญหา OCR ข้อความหาย (ต้อง debug ก่อน tune)

- [ ] **A2.1. เปิด DEBUG_LOG_DROPS** — เปิด `CONFIG.DEBUG_LOG_DROPS = true` แล้ว OCR ซ้ำ 
  - ดู console ว่า word ถูก drop ที่ filter ไหน (bgVariance / imgTile / noise)
  - ถ้าไม่มี drop log → ปัญหาอยู่ที่ Tesseract ไม่เห็น text ตั้งแต่แรก

- [ ] **A2.2. ใช้ PSM ที่เหมาะสมกับ webtoon** — ลอง `PSM.SPARSE_TEXT` เป็น default แทน `PSM.AUTO`
  - Webtoon มี text กระจายตัว speech bubbles → SPARSE_TEXT เหมาะกว่า AUTO

- [ ] **A2.3. Speech bubble detection** — เพิ่ม logic ตรวจ uniform-color region 
  - ถ้า background variance ของ tile < 200 → ถือเป็น text-only area (ไม่ต้อง filter)
  - ต่างจาก Phase A ที่ relax ค่าทั่วไป — อันนี้เช็ค per-tile ว่าเป็น uniform background

- [ ] **A2.4. Bounding box padding สำหรับ CJK speech bubble**
  - ตัวอักษรที่มุมของ bubble มักถูก crop พอดี → เพิ่ม padding เมื่อ re-OCR region

### Phase A3: แก้บัคที่เหลือจาก Ghost Text Reduction (2026-03-10)

- [ ] **A3.1. Tighten mixed-case readability gate** — `CREAweaErSRETHIbe` ยังผ่าน filter ได้ ต้องเพิ่ม readability threshold สำหรับ mixed-case tokens
- [ ] **A3.2. Single-word non-lexical filter** — fragments เช่น `vided`, `Wis`, `wraphimills` ต้องถูกกรองออก (single-word line + ไม่อยู่ใน dictionary + conf ไม่สูง)
- [ ] **A3.3. Word-merging post-processing** — แก้ `TAKEA` → `TAKE A`, `NowI` → `Now I`, `MAKEDO` → `MAKE DO` ด้วย dictionary-based word splitting
- [ ] **A3.4. Fix primary worker crash** — ใช้ boot loader error output วิเคราะห์ root cause ว่า Vite module worker + large import tree crash เพราะอะไร
- [ ] **A3.5. Investigate missing text** — `THIS KIND OF STUFF` (P5) และ `THE PEOPLE HERE?` (P10) ไม่ถูก detect เลย → ต้อง debug ว่า Tesseract ไม่เห็นหรือถูก filter drop

---

### Phase C: Optimize Performance

- [ ] **C1. Adaptive tile sampling** — เพิ่ม `IMG_TILE_SAMPLE_STEP` ตามขนาดภาพ
- [ ] **C2. Skip photo filter เมื่อ text-heavy** — ถ้า > 80% ของ tiles ไม่ใช่ image → skip filter
- [ ] **C3. Cache preprocessed image** — ใช้ร่วมกันระหว่าง passes
- [ ] **C4. Reduce fallback re-OCR calls** — batch logic ให้ทำ OCR น้อยรอบลง

---

### Phase D: Code Quality & Testing

- [ ] **D1. Unit tests สำหรับ filter functions** (parseTSV, cleanLineNoise, buildImageTileMask)
- [ ] **D2. ลด `any` type** — `processedInput as any`, `words: unknown[]`
- [ ] **D3. ลด code duplication** — fallback OCR ซ้ำกัน 3 จุด
- [ ] **D4. Error boundaries** — `recognizeRegion` ไม่มี try/catch

---

### Phase E: UX Improvements

- [ ] **E1. แสดง word ที่ถูก filter ออกใน debug overlay** (highlight สีแดง)
- [ ] **E2. เพิ่ม "Accuracy" preset ที่ skip all filters**
- [ ] **E3. เพิ่ม per-page OCR timing & confidence breakdown**
- [ ] **E4. Save/Load OCR result as JSON สำหรับ debug**

---

## Priority Matrix

```
Urgent + Important → Phase A2 (debug ก่อน tune)
Important         → Phase C, D
Nice to have      → Phase E
Already done      → Phase B (refactor ✅)
```

## Files ที่เกี่ยวข้อง

| File | Lines | Role |
|------|-------|------|
| `worker-boot.ts` | ~50 | Boot loader: dynamic import + crash recovery |
| `worker.ts` | ~3519 | Full OCR pipeline (currently crashes in dev) |
| `worker-stable.ts` | ~738 | Fallback worker with 7-layer filtering pipeline |
| `VisionService.ts` | ~572 | Worker pool management + boot loader handling |
| `ocr-config.ts` | ~120 | Centralized thresholds |
| `ocr-filtering.ts` | ~400 | All filter logic (primary worker) |
| `ocr-fallback.ts` | ~180 | Region re-OCR, chunking |
| `ocr-parsing.ts` | ~280 | TSV parsing, line building |
| `ocr-preprocessing.ts` | ~100 | Image preprocessing |
| `ocr-text-utils.ts` | ~114 | Text utilities |
| `ocr-region.ts` | ~112 | Region classification |
| `ocr-types.ts` | ~43 | Shared types |
| `OCRTextLayerPanel.tsx` | ~834 | UI, page rendering, OCR trigger |
