# Post-Mortem: DirectML Startup Hang on "Verifying..." & Worker Restart Thrashing Loop

- **Date:** 2026-10-14
- **Component:** OCR Engine / Process Manager / DirectML Hardware Discovery / Bootstrap Lifecycle
- **Impact Area:**
  - `scripts/external_ocr_bridge.py`
  - `src-tauri/src/core/process_manager.rs`
  - `src/services/ocr/ocrBackendBootstrap.ts`
  - `src/components/OCR/EngineSelector/OCREngineSelector.tsx`
  - `src/stores/useOCRTextLayerStore.ts`
  - `src/services/bridge/index.ts`
- **Status:** Resolved & Validated (34/34 Test Suites Passed, Cargo Check 0 Errors)

---

### 1. Summary
เมื่อเปิดแอปพลิเคชันหรือสลับตัวเลือกการเร่งความเร็วฮาร์ดแวร์ ผู้ใช้พบอาการค้างที่สถานะ `"Verifying..."` ของ UI เป็นเวลานานมากจนไม่สามารถกดเริ่มประมวลผล OCR ได้ และใน Terminal ปรากฏข้อความ `[ProcessManager] Spawning Python worker` ซ้ำซ้อนถึง 4 ครั้งติดกัน เกิดจาก 3 สาเหตุร่วมกัน: (1) `verify_dml_readiness` ใน `scripts/external_ocr_bridge.py` ทำการ instantiate โมเดล PaddleOCR ตัวเต็ม 3 โมเดลลง DirectML ซึ่งใช้เวลาถึง 15 วินาทีต่อรอบและพ่น debug log 2.7KB ลง stdout รบกวน JSON protocol, (2) `bootstrapOcrBackend` ถูกเรียกขนานกันจาก `App.tsx` และ `OCREngineSelector.tsx` ร่วมกับ `setOptions({ dmlAdapterName })` โดยที่ `set_ocr_backend` ใน Rust ขาด idempotency guard ส่งผลให้ Worker ถูก kill กลางคันและ respawn ซ้ำซ้อน 4 รอบ และ (3) `handleSelectDml` ใน UI ขาด timeout guard ทำให้ `isVerifyingDml` ค้าง แก้ไขโดยเปลี่ยนเป็น Lightweight DirectML Probe (< 0.8s), ทำ Worker idempotency ใน Rust, ใส่ Single-Flight Promise ให้กับ Bootstrap, และครอบ UI ด้วย 10s Timeout Guard

---

### 2. Symptom
1. **Terminal Log (Thrashing & Repeated Spawns):**
   ```text
   [ProcessManager] Spawning Python worker (exe: ...\python.exe, script: ...\external_ocr_bridge.py, backend: paddle, adapter: Some("AMD Radeon RX 6700 XT"))
   [ProcessManager] Spawning Python worker (exe: ...\python.exe, script: ...\external_ocr_bridge.py, backend: paddle, adapter: Some("AMD Radeon RX 6700 XT"))
   [Python stderr] [ocrBridge] PaddleOCR DirectML opt-in inactive (current backend: 'paddle'). Using Paddle Native CPU.
   [ProcessManager] Spawning Python worker (exe: ...\python.exe, script: ...\external_ocr_bridge.py, backend: paddle, adapter: Some("AMD Radeon RX 6700 XT"))
   [ProcessManager] Spawning Python worker (exe: ...\python.exe, script: ...\external_ocr_bridge.py, backend: paddle, adapter: Some("AMD Radeon RX 6700 XT"))
   [Python stderr] [ocrBridge] DirectML GPU backend enabled (adapter: AMD Radeon RX 6700 XT).
   [Python stderr] [ocrBridge] PaddleOCR DirectML (DmlExecutionProvider device_id=0, name=AMD Radeon RX 6700 XT) enabled successfully
   ```
2. **UI Symptom:**
   - ปุ่มเลือกคันเร่งฮาร์ดแวร์ค้างที่สถานะหมุนติ้ว `Verifying...` (ปุ่ม disabled ไม่สามารถกดเปลี่ยนสถานะหรือเริ่มงาน OCR ได้)
   - คอนโซล DevTools พบข้อความแจ้งเตือน:
     `index.ts:941 [Bridge] listAdapters warning: Process error: Python worker stdout closed unexpectedly`

---

### 3. Root Cause
1. **Heavy Model Instantiation in `verify_dml_readiness` (`scripts/external_ocr_bridge.py`):**
   ฟังก์ชัน `verify_dml_readiness` เดิมเรียก `get_paddle_ocr("en", "cpu_shared")` ซึ่งทำการโหลดโมเดล Detection, Recognition, และ Angle Classifier ขนาดเกือบ 300MB เข้า DirectML เพื่อคอมไพล์ DirectML Shaders บน AMD GPU การทำงานนี้ใช้เวลา 10–15 วินาทีต่อรอบ และ PaddleOCR พ่น debug text ยาว 2,779 bytes ลง `sys.stdout` ซึ่งทำให้ตัวถอดรหัส JSON Lines ของ Rust ทำงานล่าช้าและปฏิเสธบรรทัดดังกล่าว
2. **Worker Restart Loop & Missing Idempotency in Rust Core (`src-tauri/src/core/process_manager.rs`):**
   ฟังก์ชัน `set_ocr_backend(backend, adapter_name)` สั่ง `self.restart_worker().await` ทันทีทุกครั้งโดยไม่ได้ตรวจสอบว่า `backend` หรือ `adapter_name` มีค่าตรงกับสถานะปัจจุบันหรือไม่ ในขณะที่ `internal_reset()` จะทำการ `child.kill().await` และ drain pending oneshot channels ด้วย `"Process reset while awaiting response"` ทำให้ IPC request ใดๆ ที่กำลังรอผลจาก Worker ถูกตัดทิ้งทันที
3. **Concurrent Boot Race Condition:**
   `bootstrapOcrBackend` ถูกเรียกใช้งานพร้อมกัน 2 จุดตอนแอปพลิเคชันเมานต์:
   - `src/App.tsx` (`useEffect` on mount)
   - `src/components/OCR/EngineSelector/OCREngineSelector.tsx` (`useEffect` on mount)
   และใน `OCREngineSelector.tsx` มีการเรียก `setOptions({ dmlAdapterName: list[0].name })` ซึ่งไปกระตุ้น `useOCRTextLayerStore` ให้ส่ง `setBackend` ไปยัง Rust ซ้ำอีกระลอก ส่งผลให้ Worker ถูก kill และ spawn ซ้อนกัน 4 ครั้งตามลำดับ
4. **Missing UI Timeout Guard:**
   ใน `handleSelectDml` (`src/components/OCR/EngineSelector/OCREngineSelector.tsx`) ไม่มีการกำหนด timeout ให้กับ `verifyDmlReady` เมื่อเกิด Worker reset ขัดจังหวะ IPC channel ตัวแปร `isVerifyingDml` จึงติดค้างอยู่ที่ `true` จนกว่า timeout ฝั่ง Rust (60 วินาที) จะหมดเวลา

---

### 4. Why It Produced the Symptom
เมื่อแอปเริ่มบูต Worker #1 ถูกสร้างขึ้นพร้อมคำขอ `verify-dml-ready` ในขณะที่ Python กำลังคอมไพล์ Shaders อย่างหนักหน่วง คำขอ `setBackend` จากอีก Component หนึ่งก็มาถึง Rust จึงสั่ง kill Worker #1 ทิ้งกลางคัน คำขอเดิมจึงตกค้างและล้มเหลว จากนั้น Worker #2, #3, #4 ถูก spawn ต่อเนื่องกันเป็นลูกโซ่ และเมื่อผู้ใช้กดเลือก DirectML ใน UI ฟังก์ชัน `handleSelectDml` ต้องรอการ Verify ใหม่ที่ต้องใช้เวลาอีก 15 วินาทีบน Worker ตัวล่าสุด ประกอบกับ Rust channel timeout 60s ส่งผลให้ UI ล็อกปุ่มทั้งหมดอยู่ที่สถานะ `Verifying...` เป็นเวลานาน

---

### 5. Fix
1. **Lightweight DirectML Probe (`scripts/external_ocr_bridge.py`):**
   เปลี่ยน `verify_dml_readiness` จากการโหลดโมเดล PaddleOCR ทั้งก้อน มาเป็นการตรวจสอบ `DmlExecutionProvider` โดยสร้าง ONNX `InferenceSession` ขนาดเล็กผ่าน `onnxruntime.datasets` (`mul_1.onnx`) หรือ Minimal In-memory Graph ซึ่งลดเวลาการตรวจสอบจาก **15 วินาที เหลือเพียง < 0.8 วินาที** และสั่งปิด log level ของ `ppocr` และ `paddle` ไม่ให้เล็ดลอดออกทาง `stdout`
2. **Worker Idempotency Guard (`src-tauri/src/core/process_manager.rs`):**
   ปรับ `set_ocr_backend` ให้ตรวจสอบค่า `backend` และ `adapter_name` ปัจจุบัน หากตรงกับค่าเดิม หรือหากยังอยู่ในโหมด Native CPU แล้วมีการเปลี่ยนเฉพาะชื่อการ์ดจอ จะไม่สั่ง kill/restart worker โดยเด็ดขาด
3. **Single-Flight Bootstrap Promise (`src/services/ocr/ocrBackendBootstrap.ts`):**
   ใช้ Singleton In-flight Promise (`inFlightBootstrap`) เพื่อให้การเรียก `bootstrapOcrBackend` พร้อมกันจากหลายที่แชร์ Promise เดียวกันและรันการตรวจสอบเพียงครั้งเดียว
4. **Store Sync Optimization (`src/stores/useOCRTextLayerStore.ts`):**
   ปรับเงื่อนไขใน `setOptions` ให้ยิง IPC `setBackend` ไปยัง Rust เฉพาะเมื่อตัวแปร `backend` เปลี่ยนจริง หรือเมื่อเปิดใช้ `ort_dml` แล้วมีการสลับ GPU เท่านั้น
5. **UI Timeout Safety Guard (`src/components/OCR/EngineSelector/OCREngineSelector.tsx`):**
   ครอบ `verifyDmlReady` ใน `handleSelectDml` ด้วย `Promise.race` และ Timeout 10 วินาที เพื่อการันตีว่า `isVerifyingDml` จะปลดล็อกคืนสู่สถานะปกติเสมอ
6. **Bridge Handover Transient Retry (`src/services/bridge/index.ts`):**
   เพิ่มการ Retry 1 ครั้ง (หน่วงเวลา 400ms) ใน `listAdapters` หากพบจังหวะเปลี่ยนผ่านของ Worker ทำให้ไม่มี error warning แสดงใน Console ระหว่างการบูต

---

### 6. How It Was Found
- **Trace logs:** ตรวจพบว่า ProcessManager สั่ง `Spawning Python worker` ถึง 4 ครั้งติดกันทั้งที่มีคำสั่งเปิดแอปเพียงครั้งเดียว
- **IPC Inspection:** ตรวจสอบพบ stdout ของ Python ใน stdio server mode มีข้อความ `[ppocr DEBUG: Namespace(...)]` ยาวกว่า 2.7KB แทรกก่อนหน้า JSON Response
- **Micro-benchmark:** ทดสอบรัน `get_paddle_ocr` ใน DirectML mode พบว่าใช้เวลา 14.8–15.2 วินาที ขณะที่ ONNX session probe ปกติใช้เวลาเพียง 0.47–0.83 วินาที
- **Hypothesis Disproved:** เดิมสงสัยว่าไดรเวอร์ AMD DirectML หรือ ONNX Runtime ใน `.venv-ocr` ขัดข้อง แต่เมื่อรันสคริปต์เดี่ยวพบว่า DirectML รันได้ปกติ ปัญหาแท้จริงคือ Worker ถูก ProcessManager สั่งรีสตาร์ตขัดจังหวะซ้ำซ้อน

---

### 7. Why It Slipped Through
- **Unit Test Mock Isolation:** ชุดทดสอบ Unit Test (`ocrBackendBootstrap.test.ts`, `DirectMLFallbackAndConcurrency.test.ts`) ใช้ Mock Bridge ที่ตอบกลับทันที (0ms) จึงไม่พบ Race Condition ระหว่างการโหลดโมเดลจริงที่ใช้เวลานานถึง 15 วินาที
- **Fresh Boot vs. Warm State:** การทดสอบก่อนหน้ามักรันผ่าน Worker ที่เปิดค้างไว้แล้ว จึงไม่พบจังหวะ Boot Handover ระหว่าง Native CPU กับ Auto-promoted GPU DirectML

---

### 8. Validation
- **DirectML Verification Latency:** ลดลงจาก ~15 วินาที เหลือ **0.83 วินาที** (เร็วขึ้นกว่า 18 เท่า)
- **Zero Stdout Pollution:** ทดสอบผ่าน `external_ocr_bridge.py --stdio-server` ผลลัพธ์บรรทัดแรกเป็น JSON สะอาด 100% ไม่มี debug string ปะปน
- **Worker Spawn Count:** เปิดแอปพลิเคชัน รันการ spawn worker เพียงรอบเดียวตามด้วยรอบ auto-promote (รวม 2 รอบแทนที่จะเป็น 4 รอบซ้ำซ้อน) และไม่เกิด crash/kill กลางคัน
- **Unit Tests:** `pnpm test` ผ่านครบ **34/34 Test Suites (401/401 Tests Passed)**
- **Rust Core:** `cargo check` ผ่าน **0 Errors**

---

### 9. Action Items
- [x] ทำ Fast DirectML Probe ใน `scripts/external_ocr_bridge.py`
- [x] ทำ Worker Idempotency ใน `src-tauri/src/core/process_manager.rs`
- [x] เพิ่ม Single-Flight Promise ใน `src/services/ocr/ocrBackendBootstrap.ts`
- [x] เพิ่ม 10s Timeout Guard ใน `src/components/OCR/EngineSelector/OCREngineSelector.tsx`
- [x] เพิ่ม Transient Retry ใน `src/services/bridge/index.ts`
- [x] อัปเดต `context.md` ให้สะท้อนสถาปัตยกรรม Startup Lifecycle และ Fast Probe ล่าสุด
