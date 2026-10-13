# Post-Mortem: DirectML UI Badge Fallback to "Paddle CPU" & Stale Runtime Anomaly

- **Date:** 2026-10-12
- **Component:** OCR Engine / Python Bridge / UI Inspection
- **Impact Area:** [scripts/external_ocr_bridge.py](file:///c:/App/Electron/PDF_Translator/scripts/external_ocr_bridge.py), [src/components/OCR/ResultTree/OCRResultTree.tsx](file:///c:/App/Electron/PDF_Translator/src/components/OCR/ResultTree/OCRResultTree.tsx)
- **Status:** Resolved & Validated

---

### 1. Summary
ผู้ใช้พบความผิดปกติในหน้า UI ตรวจสอบผลลัพธ์ OCR ของมังงะ/เอกสารจริง (`Test dojin.pdf` หน้า 2) โดยแสดง Badge เป็น `Paddle CPU` และแสดง `runtime 21.8s` ทั้งที่ terminal logs ยืนยันว่า PaddleOCR DirectML (`DmlExecutionProvider` บน AMD Radeon RX 6700 XT) ถูก spawn และเปิดใช้งานสำเร็จ เกิดจาก 2 ปัจจัยร่วมกัน: (1) เมทาดาทา `activeBackend` และ `activeProviders` ใน [scripts/external_ocr_bridge.py](file:///c:/App/Electron/PDF_Translator/scripts/external_ocr_bridge.py) ตกหล่นระหว่างการประมวลผล Dual-pass (Inverted) และ Tall-image chunking ทำให้ UI fallback เป็น `Paddle CPU` และ (2) ผลลัพธ์หน้า 2 ดึงมาจาก SQLite cache เก่าที่เคยบันทึกไว้ในรอบ CPU แก้ไขโดยการส่งต่อ metadata ให้ครบถ้วนทุก processing pass

---

### 2. Symptom
- **Terminal Log:**
  ```text
  [ProcessManager] Spawning Python worker (... backend: ort_dml, adapter: Some("AMD Radeon RX 6700 XT"))
  [Python stderr] [ocrBridge] PaddleOCR DirectML (DmlExecutionProvider device_id=0, name=AMD Radeon RX 6700 XT) enabled successfully
  ```
- **UI Observation:**
  - Result Header: `Result - P 2`, `runtime 21.8s`
  - Engine Badge: แสดง `Paddle CPU` สีเทา แทนที่จะเป็น `DirectML` สีเขียว
  - Queue Widget: `Test dojin.pdf Offline All Pages (7/28 หน้า 25%, Runtime: 90s)` ทำให้เกิดข้อสงสัยว่า DirectML ทำงานจริงหรือไม่ หรือระบบแอบ fallback ไปใช้ CPU ทั้งหมด

---

### 3. Root Cause
1. **Metadata Stripping in Dual-Pass & Chunked Pass:**
   ใน [scripts/external_ocr_bridge.py](file:///c:/App/Electron/PDF_Translator/scripts/external_ocr_bridge.py) ฟังก์ชัน `run_paddleocr_pass` จะบันทึก `activeBackend` (`"ort_dml"` หรือ `"paddle"`) และ `activeProviders` ลงใน `debug` dictionary อย่างถูกต้อง แต่เมื่อรูปภาพเข้าเงื่อนไขมังงะ:
   - `should_try_inverted_paddle_pass` (Dual pass: original + inverted variant)
   - `chunk_tall_image_for_paddle` (Tall image chunking)
   
   ตัวรวมผลลัพธ์ (`merged["debug"]` บรรทัด 4838-4845 และ 4908-4936) มีการ reconstruct dictionary ใหม่ โดยคัดลอกเฉพาะ `profile`, `qualityProfile`, `runtimeMs`, `dropCounts`, `droppedWords` และ `timingsMs` **แต่ไม่ได้คัดลอก `activeBackend` และ `activeProviders` จาก `original_result["debug"]` หรือ `chunk_results` เข้าไปด้วย**

2. **UI Evaluation Fallback:**
   ใน [src/components/OCR/ResultTree/OCRResultTree.tsx](file:///c:/App/Electron/PDF_Translator/src/components/OCR/ResultTree/OCRResultTree.tsx) บรรทัด 82–98:
   ```typescript
   const debugObj = previewSourceOCR?.debug as any;
   const activeBackend = debugObj?.activeBackend;
   const providers = debugObj?.activeProviders;
   const isDml =
     activeBackend === 'ort_dml' ||
     (providers?.rec && Array.isArray(providers.rec) && providers.rec.includes('DmlExecutionProvider'));
   ```
   เนื่องจาก `activeBackend` และ `providers` เป็น `undefined` ตัวแปร `isDml` จึงเป็น `false` ส่งผลให้ UI เรนเดอร์ Badge `Paddle CPU` เสมอ

3. **Stale SQLite Persistence:**
   ใน [src/services/ocr/BackgroundQueueProcessor.ts](file:///c:/App/Electron/PDF_Translator/src/services/ocr/BackgroundQueueProcessor.ts) มีระบบแคช `dbService.getOCR(job.documentId, pageNum, job.engine)` ซึ่งหน้า 2 ถูกประมวลผลไว้ตั้งแต่ตอนที่ระบบยังเป็น Paddle CPU เดิม เมื่อเปิดเอกสารขึ้นมาระบบจึงโหลดข้อมูลเก่าที่มี `runtimeMs = 21800` (21.8s) จาก SQLite ทันทีโดยไม่ได้ยิง OCR ซ้ำ

---

### 4. Why It Produced the Symptom
- การประมวลผลจริงใน Python bridge วิ่งผ่าน DirectML บน AMD GPU ปกติ (สังเกตจาก log stdout/stderr ของ ONNX Runtime DmlExecutionProvider)
- แต่การสูญหายของ metadata ระหว่างขั้นตอน merge ของภาพประเภทมังงะ ทำให้ contract ข้อมูลฝั่ง TypeScript ไม่ได้รับ field ยืนยัน hardware backend จึงแสดงผลย้อนแย้งกับ log ใน terminal

---

### 5. Fix
แก้ไข [scripts/external_ocr_bridge.py](file:///c:/App/Electron/PDF_Translator/scripts/external_ocr_bridge.py) ใน 2 จุดสำคัญ:
1. **Chunked Pass Metadata Propagation (บรรทัด ~4844):**
   ```python
   "activeBackend": (chunk_results[0][0].get("debug") or {}).get("activeBackend") if chunk_results else ("ort_dml" if bool(GLOBAL_USE_DML) else "paddle"),
   "activeProviders": (chunk_results[0][0].get("debug") or {}).get("activeProviders") if chunk_results else {},
   ```
2. **Dual-Pass Inverted Metadata Propagation (บรรทัด ~4917):**
   ```python
   "activeBackend": (original_result.get("debug") or {}).get("activeBackend") or ("ort_dml" if bool(GLOBAL_USE_DML) else "paddle"),
   "activeProviders": (original_result.get("debug") or {}).get("activeProviders") or {},
   ```

---

### 6. How It Was Found
1. **Tracing Payload:** ตรวจสอบโครงสร้างของ payload ที่ส่งออกจาก `run_paddleocr` ด้วยคำสั่ง CLI แยก พบว่าภาพธรรมดา (single pass) มี `activeBackend: "ort_dml"` แต่เมื่อทดสอบผ่าน logic dual-pass ฟิลด์ดังกล่าวหายไป
2. **Database Cache Check:** ตรวจสอบ workflow ใน [src/services/ocr/BackgroundQueueProcessor.ts](file:///c:/App/Electron/PDF_Translator/src/services/ocr/BackgroundQueueProcessor.ts) พบ `Cache Hit` บนหน้าเดิม ทำให้เข้าใจสาเหตุที่ runtime แสดง 21.8s

---

### 7. Why It Slipped Through
- **Unit Test Coverage Gap:** เทสต์ก่อนหน้า (T4/T5 benchmark) มุ่งเน้นทดสอบภาพทดสอบประเภทเอกสารข้อความทั่วไป (`document1.png`, `document2.png`, `document3.png`) ซึ่งไม่เคยทริกเกอร์ `should_try_inverted_paddle_pass` จึงผ่านทางเดิน single-pass มาโดยตลอด และไม่พบว่า dual-pass ขาด metadata

---

### 8. Validation
ทดสอบรันด้วย Python worker จริงบนภาพมังงะ `public/fixtures/ocr/manga/manga1.png` ด้วย `OCR_BACKEND=ort_dml` บนการ์ดจอ AMD Radeon RX 6700 XT:
- `activeBackend`: `"ort_dml"`
- `activeProviders`:
  ```json
  {
    "det": ["DmlExecutionProvider", "CPUExecutionProvider"],
    "rec": ["DmlExecutionProvider", "CPUExecutionProvider"]
  }
  ```
- `runtimeMs`: **551.9 ms (0.55 วินาที)** เทียบกับ Pure CPU เดิมที่ใช้ **12.68 วินาที** (ลดลง ~23 เท่า)
- ทดสอบใน UI: เมื่อกด `Clear Cache P2` แล้วรันใหม่ หน้าจอจะแสดง Badge `DirectML` สีเขียว พร้อมเวลารันระดับ < 1 วินาทีอย่างถูกต้อง

---

### 9. Action Items / Follow-ups
1. **Automated Assertion:** เพิ่ม regression test ใน `tests/test_dml_cpu_precision.py` เพื่อ assert ว่าทุก pass (single, dual-inverted, chunked) ต้องมี `activeBackend` และ `activeProviders` ใน `debug` เสมอ
2. **Cache Invalidation Indicator:** พิจารณาเพิ่ม metadata `engineBackend` ลงใน SQLite cache เพื่อให้ระบบตรวจจับได้เมื่อผู้ใช้สลับโหมดฮาร์ดแวร์ หรือมีปุ่ม Re-OCR ที่แจ้งเตือนเมื่อแสดงผลจาก Cache เก่า
