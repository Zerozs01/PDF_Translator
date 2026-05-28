# 🚀 แผนการปรับปรุงโปรเจกต์ PDF_Translator (Phased Improvement Plan)

แผนการนี้ถูกออกแบบมาเพื่อยกระดับความปลอดภัย ประสิทธิภาพ และประสบการณ์การใช้งาน (UX) ของแอปพลิเคชัน โดยแบ่งเป็น 4 เฟสตามระดับความสำคัญ (Priority)

---

## 🔴 Phase 1: Security & Core Performance (ความสำคัญสูงสุด - ต้องทำทันที)
**เป้าหมาย:** ปิดช่องโหว่ด้านความปลอดภัยของ Electron และแก้ปัญหาคอขวดของการสื่อสารข้ามโปรเซส (IPC)

- [ ] **1.1 Electron Security Hardening**
  - **ไฟล์ที่เกี่ยวข้อง:** `electron/main.ts`, `electron/preload.ts`
  - **งานที่ต้องทำ:** - บังคับใช้ `contextIsolation: true` และ `nodeIntegration: false` ใน `BrowserWindow`
    - ตรวจสอบ `preload.ts` ให้ Expose เฉพาะ API ที่จำเป็นผ่าน `contextBridge` ห้าม Expose `ipcRenderer.invoke` ตรงๆ โดยไม่กรอง Channel
- [ ] **1.2 IPC Payload Optimization (ลดคอขวดการส่งข้อมูล)**
  - **ไฟล์ที่เกี่ยวข้อง:** `electron/ocrBridge.ts`, `scripts/external_ocr_bridge.py`
  - **งานที่ต้องทำ:**
    - เปลี่ยนการส่งข้อมูลรูปภาพขนาดใหญ่ (เช่น หน้า PDF เต็มหน้า) จากการส่งผ่าน Base64 string ทาง IPC เป็นการส่ง `File Path` (บันทึกรูปลง Temp folder แล้วส่ง Path ให้ Python อ่าน) หรือใช้ Shared Memory/Stream
    - ปรับแก้ Python script ให้รับและคืนค่าเป็นโครงสร้าง JSON ที่เล็กลง (ส่งเฉพาะพิกัดและข้อความ)

---

## 🟠 Phase 2: Resource Management & Bundle Size (ความสำคัญระดับสูง)
**เป้าหมาย:** ลดขนาดของแอปพลิเคชัน (Installer) และจัดการการใช้หน่วยความจำไม่ให้แอปค้างเมื่อเปิด PDF ไฟล์ใหญ่

- [ ] **2.1 Lazy/On-Demand Model Downloader**
  - **ไฟล์ที่เกี่ยวข้อง:** `scripts/download-tessdata.js`, `scripts/download-paddle-thai-models.py`
  - **งานที่ต้องทำ:**
    - นำโมเดลภาษา (Tesseract/PaddleOCR) และโมเดลแปลภาษา (Argos) ที่ไม่ค่อยได้ใช้ออกจาก Bundle เริ่มต้น
    - สร้าง UI ในฝั่ง React เพื่อให้ผู้ใช้กด "ดาวน์โหลดโมเดล" เมื่อต้องการใช้ภาษานั้นๆ (ทำ Progress bar แจ้งสถานะ)
- [ ] **2.2 Canvas & Layer Memory Optimization**
  - **ไฟล์ที่เกี่ยวข้อง:** `src/components/PDF/PDFCanvas.tsx`, `src/components/Layers/InteractiveLayerOverlay.tsx`
  - **งานที่ต้องทำ:**
    - ทำความสะอาด (Cleanup) Memory เมื่อผู้ใช้เปลี่ยนหน้า PDF ป้องกัน Memory Leak จากการสร้าง Canvas ซ้อนทับกันหลายชั้น
    - ใช้งาน `requestAnimationFrame` หรือ `Debounce` ในระหว่างการ Scroll/Zoom เพื่อลดภาระการ Render ของ React

---

## 🟡 Phase 3: Error Handling & UX (ความสำคัญระดับปานกลาง)
**เป้าหมาย:** สร้างระบบสำรองเมื่อ AI ทำงานพลาด และทำให้ผู้ใช้รู้สถานะการทำงานของแอปเสมอ

- [ ] **3.1 Graceful Degradation สำหรับระบบ OCR**
  - **ไฟล์ที่เกี่ยวข้อง:** `src/services/vision/ocr-fallback.ts`, `src/services/vision/ocr-timeout.ts`
  - **งานที่ต้องทำ:**
    - หาก PaddleOCR พังหรือไม่ตอบสนอง ให้มีระบบ Fallback กลับไปใช้ Tesseract อัตโนมัติ (หรือสลับเป็น Engine ที่เบากว่า)
    - เพิ่ม Timeout สำหรับการรัน Python Script หากค้างเกิน 30 วินาที ให้ Terminate Process แล้วแจ้ง Error ที่เป็นมิตรทางหน้าจอ
- [ ] **3.2 Global Loading State & Feedback**
  - **ไฟล์ที่เกี่ยวข้อง:** `src/stores/useUIStore.ts`, UI Components
  - **งานที่ต้องทำ:**
    - เพิ่ม Global Overlay หรือ Toast Notification เพื่อบอกผู้ใช้ว่ากำลัง "สกัดข้อความ (OCR)..." หรือ "กำลังแปลภาษา..." ป้องกันผู้ใช้กดปุ่มซ้ำจนระบบรันคำสั่งซ้อนกัน

---

## 🟢 Phase 4: Advanced Features & Testing (ความสำคัญระดับเสริมประสิทธิภาพ)
**เป้าหมาย:** เตรียมพร้อมสำหรับการบำรุงรักษาระยะยาวและฟีเจอร์ขั้นสูง

- [ ] **4.1 Translation Deduplication & Caching**
  - **ไฟล์ที่เกี่ยวข้อง:** `src/services/translation/translationBatchService.ts`, `src/App.translationDedupe.test.ts`
  - **งานที่ต้องทำ:**
    - เก็บ Cache ประโยคที่เคยแปลไปแล้ว (Local SQLite หรือ IndexedDB) หากเจอประโยคเดิมในหน้าอื่น ให้ดึงจาก Cache แทนการรันโมเดล Argos ใหม่ เพื่อประหยัด CPU/เวลา
- [ ] **4.2 End-to-End (E2E) Testing Setup**
  - **ไฟล์ที่เกี่ยวข้อง:** `package.json`, โฟลเดอร์ `tests/`
  - **งานที่ต้องทำ:**
    - พิจารณาเพิ่ม Playwright หรือ Cypress เพื่อทดสอบ Flow การทำงานตั้งแต่: อัปโหลด PDF -> รัน OCR -> แปลภาษา -> แสดงผล บนสภาพแวดล้อมจำลองของ Electron (ปัจจุบันมี Vitest และ Storybook แล้ว ซึ่งดีมาก)