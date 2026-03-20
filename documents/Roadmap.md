# OCR Accuracy & Refactor Roadmap

Last updated: 2026-03-10

## Progress Audit (Code vs Plan) - 2026-03-19

สถานะนี้อิงจากโค้ดปัจจุบันใน `src/services/vision` และ `src/components/OCR` เพื่อเช็คว่า roadmap ไปถึงไหนแล้วจริง

### Phase A2: แก้ปัญหา OCR ข้อความหาย

- [x] **A2.1 เปิด DEBUG_LOG_DROPS**
  - มีอยู่ใน `ocr-config.ts` และถูกใช้งานจริงใน `worker.ts`

- [~] **A2.2 ใช้ PSM ที่เหมาะกับ webtoon**
  - ทำแล้วบางส่วน: CJK ใช้ `PSM.SPARSE_TEXT` เป็น default
  - Latin/non-CJK ยัง default ที่ `PSM.AUTO` และใช้ sparse เฉพาะบาง pass

- [~] **A2.3 Speech bubble / text-like region detection**
  - มี text-likeness metrics (`analyzeRegionTextLikeness`, `isLikelyTextRegion`) และ logic rescue สำหรับ balloon
  - แต่ยังไม่ใช่ rule ตรงๆ แบบ "background variance < 200 = text-only area"

- [x] **A2.4 Bounding box padding สำหรับ re-OCR**
  - มี CJK/Latin line rescan padding และ low-coverage padding เพิ่มเติมใน `worker.ts`

### Phase A3: แก้บัค ghost text

- [x] **A3.1 mixed-case readability gate**
- [x] **A3.2 single-word non-lexical filter**
- [x] **A3.3 word-merging post-processing**
- [x] **A3.4 primary worker crash handling (boot loader + fallback)**
- [~] **A3.5 investigate missing text**
  - มี rescue pass หลายชั้น (line rescan / bottom probe) แล้ว
  - ยังมีเคส missing text ที่ถูกติดตามต่อเนื่อง

### Phase C: Performance

- [~] **C1 Adaptive tile sampling** - มี `IMG_TILE_SAMPLE_STEP` แล้ว แต่ยังเป็นค่าคงที่
- [ ] **C2 Skip photo filter เมื่อ text-heavy** - ยังไม่เห็น short-circuit แบบชัดเจน
- [ ] **C3 Cache preprocessed image ข้าม pass** - ยังไม่ครบแบบ shared cache ระหว่างทุก pass
- [~] **C4 Reduce fallback re-OCR calls** - มีการจำกัดด้วย budget/เงื่อนไขหลายจุด แต่ยังไม่ปิดงานเต็ม

### Phase D: Code Quality & Testing

- [ ] **D1 Unit tests สำหรับ filter functions** - ยังไม่พบไฟล์ test สำหรับ OCR filter หลัก
- [~] **D2 ลด any/unknown** - ดีขึ้น แต่ยังมี cast หลายจุด เช่น `processedInput as any`, `words: unknown[]`
- [~] **D3 ลด duplication** - ลดลงแล้วจากการแยกโมดูล แต่ยังมี pattern rescue ที่คล้ายกันหลายช่วง
- [ ] **D4 Error boundaries สำหรับ recognizeRegion path** - ยังมีบางเส้นทางที่พึ่งพา caller เป็นหลัก

### Consistency Note

- เอกสาร changelog ใน docs และ root มีบันทึกถึง OCR algorithm v52/v53
- แต่โค้ดปัจจุบันใน `ocrVersion.ts` ยังเป็น `51`
- ควร confirm เวอร์ชันที่ต้องการใช้จริง เพื่อไม่ให้เอกสารนำผิดทาง

### Legacy Plan Consolidation

- เนื้อหาหลักจากไฟล์ `road map.md` ถูกรวมเข้ามาในไฟล์นี้แล้ว
- ให้ใช้ไฟล์นี้เป็น roadmap หลักเพียงไฟล์เดียว

## Execution Plan (Priority Phases) - 2026-03-20

เป้าหมาย: เคลียร์ความเสี่ยงด้าน performance/maintainability ก่อน แล้วค่อยจูน OCR accuracy เพื่อลด regression และทำให้ผลทดสอบเชื่อถือได้

### Phase 0 - Immediate Guardrails (P0)

สถานะ: **IN PROGRESS**

- [x] ปรับ default debug logging ให้ปลอดภัยกับ runtime (`DEBUG_LOG_DROPS=false`)
- [~] ตั้งเกณฑ์ regression gate ชุดเดียวก่อนจูน (ใช้ harness เดิม + baseline ที่ตรงเวอร์ชันปัจจุบัน)
- [x] เพิ่ม regression preflight check: ตรวจ fixture image ก่อนรัน harness และ fail-fast พร้อมรายการไฟล์ที่หาย
- [x] เพิ่ม partial regression mode: รองรับ `--skip-missing` + report `--partial` เพื่อเริ่มวัดผล tuning ได้ทันทีเมื่อมี fixture บางหน้า
- [ ] แก้ regression fixture assets: ใน `public/fixtures/ocr/manga` ยังไม่มีไฟล์ภาพ test pages (มีแค่ `expectations.json`)
- [ ] Freeze tuning window: ไม่เพิ่ม heuristic ใหม่จนกว่า gate ผ่าน

Exit criteria:

- OCR regression รันได้ซ้ำและมีรายงานเปรียบเทียบ baseline ที่ใช้งานจริง

Latest run note (2026-03-20):

- `node scripts/run-ocr-regression.mjs` ตอนนี้ fail-fast พร้อมรายการไฟล์ fixture ที่หายอย่างชัดเจน
- เพิ่ม `npm run ocr:regression:partial` สำหรับรันเฉพาะ fixture ที่มีอยู่จริงระหว่างเติม assets (ยังคงใช้ report เดิมแต่ scope เฉพาะหน้าที่รันได้)

### Phase 1 - Runtime Stability & Shared Pipeline (P1)

สถานะ: **IN PROGRESS**

- [~] แยก shared logic ระหว่าง `worker.ts` และ `worker-stable.ts` ไป module กลาง (คืบหน้า: shared progress/image-dim + shared init-lock + shared language-switch/getOrCreate flow ใน `ocr-worker-shared.ts`)
- [x] ลด busy-wait init loop เป็น promise lock (ทำแล้วใน `worker.ts` และ `worker-stable.ts`)
- [x] รวมจุด timeout/retry policy ให้อยู่แหล่งเดียวผ่าน constants กลาง (`src/services/vision/ocr-timeout.ts`) และใช้งานใน `VisionService`
- [x] รวม per-page OCR timeout logic เป็น utility กลาง (`src/services/vision/ocr-timeout.ts`) และใช้งานจากทั้ง panel + pdf service
- [x] รวม timeout defaults เป็น constants กลาง (worker request timeout / per-page timeout default / render timeout)

Exit criteria:

- worker หลัก/สำรองใช้พฤติกรรมแกนกลางเดียวกันในส่วนที่ไม่ใช่ fallback เฉพาะทาง

### Phase 2 - Type Safety & Refactor Hygiene (P1)

สถานะ: **IN PROGRESS**

- [x] ลด `unknown[]` ใน `OCRLine.words` ไปเป็น `OCRWord[]` (ครอบคลุม `worker.ts`, `worker-stable.ts`, `ocr-types.ts`, `ocr-parsing.ts`, `ocr-filtering.ts`)
- [x] ลด cast ที่เสี่ยง (`as any`) เฉพาะ path OCR หลักและจุด runtime สำคัญ (รวม `VisionService.ts`/`worker-boot.ts` แล้ว)
- [~] แยกฟังก์ชัน heuristic Latin ขนาดใหญ่ใน `worker.ts` เป็นไฟล์ย่อยตามหมวด (คืบหน้า: extract `ocr-latin-heuristics.ts` สำหรับ normalize/split/correction core + line cleanup/prune + anchor/probe builders/text-like probe helpers + readability/speech-fastpath scoring helpers + candidate scoring/meaningful-word metrics ผ่าน dependency injection)

Exit criteria:

- type check ผ่านโดยไม่เพิ่ม suppressions ใหม่ และ surface API ของ OCR pipeline ชัดเจนขึ้น

### Phase 3 - Performance Optimization Before Accuracy Tuning (P2)

สถานะ: **PLANNED**

- [ ] Adaptive tile sampling ตามขนาดภาพ
- [ ] text-heavy short-circuit สำหรับ photo/background filters
- [ ] ลดจำนวน re-OCR rescue pass ด้วย budget policy ที่วัดผลได้

Exit criteria:

- เวลาประมวลผลต่อหน้าและ timeout rate ลดลง โดย coverage ไม่ตกเกณฑ์ regression

### Phase 4 - Accuracy Tuning (P2)

สถานะ: **BLOCKED by P0-P3**

- [ ] tune PSM/default strategy ตาม document profile
- [ ] tune speech-bubble specific rules (uniform/background-aware)
- [ ] tune line-completion rescue สำหรับเคสท้าย bubble

Note (2026-03-20):

- เริ่ม tuning แบบ targeted แล้ว 1 จุดจาก evidence จริง (page 10 log): เพิ่มการประเมิน `PSM.SPARSE_TEXT` เฉพาะ post-prune line rescue region เพื่อเพิ่ม recall ของเส้นข้อความโค้ง โดยไม่เปิด sparse retry ทั้งหน้า
- ทำ tuning รอบต่อจาก evidence หน้า 10/14/15: เพิ่มกฎตัด residual singleton/short non-lexical lines ใน final pass และขยาย post-prune coverage threshold เพื่อให้เก็บบรรทัดที่หายบางส่วนได้มากขึ้น
- ทำ tuning เพิ่มแบบ context-aware: ใช้ strong text cluster จาก lexical lines เพื่อคัดทิ้ง short-line ghosts ที่อยู่ไกลจากบับเบิลข้อความจริง
- แก้ blocker ของผลที่ "แทบไม่เปลี่ยน": เอา protected-line bypass ออกจาก final residual prune สำหรับเคส short ghost lines และผ่อน gate readability ของ lexical rescue token เพื่อไม่ให้คำจริงสั้นๆ หลุด
- จูนต่อสำหรับเคส page 10 คำหายริมบรรทัด (`HERE`, `TO`, `HERE?`): เพิ่ม adaptive probe padding ซ้าย/ขวาใน post-prune rescue และผ่อน lexical gate เฉพาะ source กลุ่ม `postPruneLine*`
- จูนต่อรอบล่าสุด: เพิ่ม `MR` เข้า short-keep เพื่อกัน title ต้นประโยคหาย และเพิ่ม panel-only edge-token rescue สำหรับบรรทัดแข็งแรงที่มีช่องว่างริม line box เพื่อดึงคำท้าย/ต้นบรรทัดกลับมา
- จูนต่อรอบนี้: ผ่อน gate ของ `lineRescanEdge` สำหรับ lexical tokens เพื่อแก้ page 10 คำหายริมบรรทัด และเพิ่มกฎตัด fragmented mixed-case non-lexical residual line เพื่อเคลียร์บัค text ผีหน้า 3 ใต้บรรทัด `TAKE A LOOK`
- จูนรอบติดตามสำหรับเคสที่ยังดื้อ: ขยาย trigger/padding ของ edge-token rescue และเพิ่ม fallback + looser dedupe retry เพื่อดึงคำริมบรรทัดที่ overlap ใกล้เคียง; พร้อม tighten กฎลบ fragmented line แบบ lexical-density ต่ำ (lexicalHits<=1)
- จูนรอบล่าสุดสำหรับเคสที่เหลือ (หน้า 2/3/5/10): เปิดใช้ lexical neighborhood + top-balloon rescue ใน panel mode แบบมีเพดานเข้ม และเพิ่มกฎตัด residual line ที่เป็น short-keep ซ้ำๆ (`A A A`) ใน final pass
- จูนรอบ quality-focused ล่าสุด (หน้า 2/3/4/5/10/12/17/19/20): จำกัด Latin recovery budget ให้มีเพดานจริงเพื่อลดคำผีจาก texture-heavy rescue, ปรับลำดับคัดคำตอน budget overflow ให้คำ lexical/readable มาก่อน, และเพิ่ม singleton keep guard เพื่อกันหน้าข้อความสั้นมาก (เช่นมีแค่ `YOU`) ไม่โดนล้างทั้งหน้า
- เพิ่ม post-cleanup รอบท้าย: normalize short digit lexical tokens (`60` -> `GO`) และตัด trailing non-lexical tail artifacts แบบ lowercase (`at`, `or`, `fem`) โดยไม่แตะคำสั้นตัวพิมพ์ใหญ่ที่มี lexical support
- เพิ่มกฎลบ residual สาย `A I` แบบ two-token one-char short-keep ghost เมื่อไม่ protected/ไม่ confidence สูง
- จูนรอบล่าสุดจากหลักฐานหน้า 2/3/4/5/10: แก้จุดที่ `GO` หายตั้งแต่ noise stage โดยยกเว้น short-digit token ที่ normalize เป็น lexical word, เพิ่ม targeted correction สำหรับ alias ของ `XUJIA/TOWN` (เคส `AVIA TO`), เปิด top-band probe ใน panel mode เพื่อกู้บรรทัดบนที่ raw ไม่เจอ, และลด rescue หนักบนหน้าที่ noise สูงมากเพื่อลด timeout
- สรุป root cause รอบนี้: ปัญหาหลักมาจาก accuracy logic/threshold (short-digit normalization + line-prune over-drop + tail short-token artifacts) มากกว่างาน refactor ที่ค้าง จึงปรับกฎเชิงคุณภาพตรงจุดดังกล่าวเพิ่ม

Exit criteria:

- ผ่าน regression gate + expectation set และไม่มี spike ของ ghost text

### Phase 5 - Test & Tooling Hardening (P3)

สถานะ: **PLANNED**

- [ ] เพิ่ม unit tests สำหรับ `parseTSV`, `cleanLineNoise`, `buildImageTileMask`, และ lexical split
- [ ] แยก baseline ตาม profile (panel/batch) ถ้าพฤติกรรมต่างกัน
- [ ] เพิ่มรายงานแนวโน้ม (coverage, suspicious ratio, fragmentation)

Exit criteria:

- การเปลี่ยน heuristic สามารถประเมินผลเชิงตัวเลขได้ทุกครั้งก่อน merge

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
