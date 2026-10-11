# OCR Pipeline Performance & Verification Report

**Environment Snapshot & Tested Hardware Provenance:**
- OS: Windows 11 (64-bit)
- Tested GPU: AMD Radeon RX 6700 XT 12GB (Gigabyte Gaming OC)
  - Device PNP ID: `PCI\VEN_1002&DEV_73DF&SUBSYS_23311458&REV_C5`
  - Adapter LUID: `Low=68666, High=0 (0x0000000000010C3A)`
  - Driver Version: `32.0.21045.5002`
- RAM: 32 GB
- Python venv: `.venv-ocr` (Python 3.11.9)
- Date Verified: 2026-10-11 / 2026-10-12

---

## 0. Configuration & Environment Variables Reference

| Variable | Values | Default | Purpose & Fail-Closed Behavior |
|---|---|---|---|
| `OCR_BACKEND` | `paddle` \| `ort_dml` | `paddle` | เลือก Backend หลัก โดยค่าเริ่มต้นเป็น Native Paddle C++ (A) สำหรับ Production |
| `OCR_DISABLE_DML` | `0` \| `1` | `0` | สั่งปิด DirectML ทันทีในระดับ Bridge เพื่อบังคับ fallback ไปใช้ Native Paddle CPU |
| `OCR_DML_ADAPTER_NAME` | string | unset | ระบุชื่อ GPU adapter ที่ต้องการบังคับใช้ หากไม่พบจะ Fail-Closed ไปยัง Native Paddle CPU ทันที |
| `OCR_DML_ADAPTER_LUID` | string / hex | unset | ระบุ DXGI LUID ของ GPU adapter หากไม่พบจะ Fail-Closed ไปยัง Native Paddle CPU ทันที |
| `OCR_DML_DEVICE_ID` | integer | unset | บังคับ device_id ของ DirectML หากระบุไม่ถูกต้องจะ Fail-Closed ไปยัง Native Paddle CPU |

---

## 1. Summary of Verification Tasks (V1 – V8)

| Task | สถานะ | ข้อค้นพบหลักและตัวเลขจริง |
|---|---|---|
| **V1: Environment Snapshot** | **CONFIRMED** | `paddleocr==2.8.1`, `paddlepaddle==3.4.0`, `paddlex==3.6.1`, `onnxruntime-directml==1.23.0`, `paddle2onnx==1.3.1`, `numpy==1.26.4` (บันทึก snapshot ไว้ที่ `docs/ocr-env-snapshot.txt`) |
| **V2: Version Mismatch & Code Path** | **CONFIRMED (Critical Bug)** | - `lang="th"`: **พัง 100% ทุก path** เพราะ `paddleocr<=2.8.1` ไม่มี Thai ใน dict (ต้องใช้ PaddleOCR 3.x / PaddleX)<br>- ภาษาอื่นๆ (`japan`, `korean`, `en`): Constructor ผ่าน แต่ **ignore** `text_detection_model_name='PP-OCRv5_server_det'` โดยเงียบๆ แล้วถอยไปใช้ `ch_PP-OCRv4_det_infer` |
| **V3: DirectML Execution** | **CONFIRMED (12.4x Speedup)** | DirectML **ทำงานจริง** และวิ่งบน AMD RX 6700 XT ผ่าน `onnxruntime-directml` + `model.onnx`:<br>- **DML (GPU): 0.755s** (52 boxes)<br>- **Pure CPU: 9.359s** (52 boxes)<br>- **Speedup: 12.40 เท่า** (สมมติฐาน F8 ที่ว่า GPU ~0% ถูกหักล้างด้วยผลรันจริง) |
| **V4: Cold Start vs Steady State** | **CONFIRMED** | - **Cold start (Subprocess CLI spawn + imports + load model):** 13.38s<br>- **Steady state (In-memory worker with DML):** 0.46s – 0.75s ต่อหน้า (เร็วขึ้น ~95% เมื่อใช้ daemon worker) |
| **V5: Memory Footprint (RAM)** | **CONFIRMED** | - Python RSS เริ่มต้น: ~379 MB<br>- หลังโหลดโมเดล: ~449 MB<br>- ระหว่าง/หลังทำ Inference: ~489 MB (~500 MB per worker process)<br>(ตัวเลข 8MB น่าจะเป็น subprocess ชั่วคราว ไม่ใช่ OCR worker จริง) |
| **V6: Pipeline Bottleneck** | **CONFIRMED** | Bottleneck หลักไม่ใช่เวลา OCR (0.46s บน GPU) แต่เป็น:<br>1) Translation network call บล็อก loop หน้าถัดไปใน `BackgroundQueueProcessor.ts`<br>2) Playwright harness ติด `AuthGuard` ทำให้รัน regression ไม่ผ่าน |
| **V7: oneDNN Status** | **CONFIRMED** | **ห้ามเปิด oneDNN กับ Paddle inference CPU**: จะทำให้เกิด crash ทันที: `ConvertPirAttribute2RuntimeAttribute not support [pir::ArrayAttribute<pir::DoubleAttribute>]`<br>แต่ ONNX Runtime DirectML ไม่ได้รับผลกระทบเพราะ bypass Paddle graph ทั้งหมด |
| **V8: Recognition Batch Size** | **CONFIRMED (22.5% Faster)** | วัดบน `manga1.png` (52 boxes):<br>- `batch_size = 6`: **0.594s**<br>- `batch_size = 16`: **0.460s** (เร็วขึ้น 22.5% โดย boxes = 52 เท่าเดิม)<br>- `batch_size = 32`: **0.689s** (ช้าลงเพราะ tensor padding overhead)<br>→ **Optimal batch_size = 16** |

---

## 2. Detailed Technical Evidence

### 2.1 V1: Package Versions
บันทึกเต็มอยู่ที่ `docs/ocr-env-snapshot.txt`:
```
paddleocr: 2.8.1
paddlepaddle: 3.4.0
paddlex: 3.6.1
onnxruntime-directml: 1.23.0
paddle2onnx: 1.3.1
numpy: 1.26.4
```

### 2.2 V2: Version Mismatch Error Trace
เมื่อเรียก `get_paddle_ocr('th', 'cpu_cjk')` ใน `external_ocr_bridge.py`:
```
AssertionError: param lang must in dict_keys(['ch', 'en', 'korean', 'japan', 'chinese_cht', 'ta', 'te', 'ka', 'latin', 'arabic', 'cyrillic', 'devanagari']), but got th
```
- ใน `external_ocr_bridge.py` บรรทัด 3693–3696 มีการระบุ `th_PP-OCRv5_mobile_rec` และ `PP-OCRv5_server_det` ซึ่งเป็นโมเดลของ PaddleOCR 3.x / PaddleX
- แต่ `scripts/bootstrap_ocr_env.ps1` ติดตั้ง `paddleocr<=2.8.1` จึงทำให้พังทันทีสำหรับภาษาไทย

### 2.3 V3: DirectML vs Pure CPU Benchmark
รันบน fixture `public/fixtures/ocr/manga/manga1.png`:
```
DirectML (GPU) time: 0.755s, boxes: 52
Pure CPU time:        9.359s, boxes: 52
Speedup from DML:     12.40x
```
Providers ที่ InferenceSession ได้รับ:
- Detector: `['DmlExecutionProvider', 'CPUExecutionProvider']`
- Recognizer: `['DmlExecutionProvider', 'CPUExecutionProvider']`

### 2.4 V8: Recognition Batch Size Comparison
```
rec_batch_num= 6 -> 0.594s (boxes=52)
rec_batch_num=16 -> 0.460s (boxes=52)
rec_batch_num=32 -> 0.689s (boxes=52)
```

---

## 3. Next Action Roadmap (P1 – P3)

### Phase P1: แก้ปัญหา Version Mismatch & Thai OCR Support
- **ทางเลือกที่ 1 (Recommended):** สวิตช์ไปใช้ `paddlex` (ซึ่งติดตั้งเวอร์ชัน 3.6.1 ไว้อยู่แล้ว และมีโมเดล `th_PP-OCRv5_mobile_rec` ดาวน์โหลดไว้พร้อมแล้วใน `~/.paddlex/`) หรืออัปเกรด `paddleocr>=3.x`
- **ทางเลือกที่ 2:** แมปภาษาไทยใน PaddleOCR 2.8.1 โดยใช้ custom `rec_model_dir` และ `rec_char_dict_path` โดยกำหนด `lang='latin'` หรือ `'en'` เพื่อเลี่ยง assertion check

### Phase P2: ปลดล็อก Concurrency ของ Translation ออกจาก OCR Loop
- แก้ไข `src/services/ocr/BackgroundQueueProcessor.ts`: แยก `dispatchPageTranslation` ออกมาเป็น non-blocking background queue หรือ pool concurrency (2–3 jobs) ไม่ให้หน่วง OCR loop หน้าถัดไป

### Phase P3: Publish ผลลัพธ์ต่อหน้าทันที (Per-Page UI Streaming)
- แก้ไขปัญหาผลลัพธ์ไม่ขึ้น UI หาก active document ไม่ตรง และปล่อย text layer ทันทีที่แต่ละหน้าทำ OCR เสร็จโดยไม่ต้องรอ translation จบทั้งชุด
