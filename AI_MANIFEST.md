# AI Project Manifest & Context Map

> [!IMPORTANT]
> **คำสั่งสำหรับ AI (Self-Instruction):**
> เมื่อได้รับมอบหมายงานใหม่ ให้เริ่มจากการอ่านไฟล์นี้เพื่อหา Path ที่เกี่ยวข้องก่อนเสมอ ห้ามเดา Path เองเพื่อประหยัด Token และรักษาความแม่นยำในการระบุไฟล์

---

## 🛠️ Common Task Workflow (ทางลัดในการทำงาน)

เมื่อต้องแก้ไขปัญหาหรือพัฒนาฟีเจอร์ ให้จัดลำดับการเข้าถึงไฟล์ตามทิศทางนี้เป็นหลัก:

* **โจทย์ "OCR อ่านผิด / ผลลัพธ์เพี้ยน":**
  1. ตรวจสอบ [VisionService.ts](file:///c:/App/Electron/PDF_Translator/src/services/vision/VisionService.ts) (Orchestrator และคิวงาน)
  2. ตรวจสอบ [ocrTextNormalizer.ts](file:///c:/App/Electron/PDF_Translator/src/services/ocr/ocrTextNormalizer.ts) (ตัวจัดการ Regex คลีนและลดรูปข้อความ)
  3. ดู [ocr_orchestrator_flow.md](file:///c:/App/Electron/PDF_Translator/documents/image_processing_knowledge/ocr_orchestrator_flow.md) (สถาปัตยกรรมการประกอบคำ/การเลือก Engine)

* **โจทย์ "แปลภาษาผิด / ไม่ยอมใช้ Glossary":**
  1. ตรวจสอบ [translationCoordinator.ts](file:///c:/App/Electron/PDF_Translator/src/services/translation/translationCoordinator.ts) (ตัวประกอบข้อความแบบกลุ่ม/ประสานงานแปล)
  2. ตรวจสอบ [offlineTranslationService.ts](file:///c:/App/Electron/PDF_Translator/src/services/translation/offlineTranslationService.ts) (การเรียกตัวแปลภาษาออฟไลน์หลัก)
  3. ตรวจสอบโครงสร้างข้อมูลใน [useGlossaryStore.ts](file:///c:/App/Electron/PDF_Translator/src/stores/useGlossaryStore.ts) และตัวแปลง [sfxDictionaryService.ts](file:///c:/App/Electron/PDF_Translator/src/services/translation/sfxDictionaryService.ts)

* **โจทย์ "แอปกระตุก / UI ค้าง":**
  1. ตรวจสอบ [InteractiveLayerOverlay.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Layers/InteractiveLayerOverlay.tsx) (การวาดและ event handling กล่องข้อความจำนวนมาก)
  2. ตรวจสอบ [ocrBridge.ts](file:///c:/App/Electron/PDF_Translator/electron/ocrBridge.ts) (การส่งข้อมูลผ่าน IPC และความปลอดภัยในฝั่ง Main Process)

* **โจทย์ "Export PDF ช้า / UI ค้างตอนส่งออก":**
  1. ตรวจสอบ [pdfExportService.ts](file:///c:/App/Electron/PDF_Translator/electron/pdfExportService.ts) (Hidden BrowserWindow + `printToPDF` + stitch + `finally` destroy)
  2. ตรวจสอบ [pdfExportStaging.ts](file:///c:/App/Electron/PDF_Translator/electron/pdfExportStaging.ts) (เขียน payload ลง `%TEMP%` + ส่งแค่ path/protocol URL แทน base64 ยัด IPC)
  3. ตรวจสอบ [PdfPrintExportService.ts](file:///c:/App/Electron/PDF_Translator/src/services/pdf/PdfPrintExportService.ts) (ใช้ `sourceFilePath` ก่อน, fallback เป็น raw bytes)
  4. ตรวจสอบ [renderExportPrintPage.ts](file:///c:/App/Electron/PDF_Translator/src/export/renderExportPrintPage.ts) (DOM overlay + `@media print` zero margin)

* **โจทย์ "แอปพลิเคชันไม่ยอมเปิด / ติดล็อกอิน / บั๊กความปลอดภัย / รีเซ็ตระบบ":**
  1. ตรวจสอบ [authService.ts](file:///c:/App/Electron/PDF_Translator/electron/authService.ts) (ระบบ Hash, Salt และ safeStorage)
  2. ตรวจสอบ [AuthGuard.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Auth/AuthGuard.tsx) (ดักและปิดกั้น UI ทั้งหมดก่อนปลดล็อกสำเร็จ)
  3. ตรวจสอบ [useAuthStore.ts](file:///c:/App/Electron/PDF_Translator/src/stores/useAuthStore.ts) และ IPC Handles ใน [main.ts](file:///c:/App/Electron/PDF_Translator/electron/main.ts) (ช่องทางสื่อสารปลดล็อก/สลับโหมด/รีเซ็ตระบบ)

---

## 🗺️ Project Structure Index

### 1. Frontend Core (React App)
- **Application Shell & Orchestrator:** [src/App.tsx](file:///c:/App/Electron/PDF_Translator/src/App.tsx) — จัดการ logic การแปล, overlay rendering, และ line grouping/deduplication
- **Export Print Page (Hidden Renderer):** [src/export/renderExportPrintPage.ts](file:///c:/App/Electron/PDF_Translator/src/export/renderExportPrintPage.ts) — DOM overlay บนพื้นหลังโปร่งใส (หน่วย `pt` ตรง PDF page size) ไม่ใช้ pdf.js
- **Viewer & Workspace Layout:**
  - [src/components/Viewer/Toolbar.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Viewer/Toolbar.tsx) — ปุ่มควบคุมหน้าจอ `SplitViewToggle` สำหรับสลับระหว่าง Overlay และ Split view
  - [src/components/Viewer/WorkspaceContainer.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Viewer/WorkspaceContainer.tsx) — จัดการหน้าต่างแบ่งซีก (Split-Viewport) แสดงต้นฉบับคู่บทแปล
  - [src/hooks/useSyncScroll.ts](file:///c:/App/Electron/PDF_Translator/src/hooks/useSyncScroll.ts) — Hook ซิงโครไนซ์ตำแหน่งการเลื่อนของ Pane ซ้ายและขวา
- **Main Viewport & Canvas:**
  - [src/components/PDF/PDFCanvas.tsx](file:///c:/App/Electron/PDF_Translator/src/components/PDF/PDFCanvas.tsx) — เรนเดอร์หน้าเอกสาร PDF และจัดการ overlay text layers
  - [src/components/Image/ImageCanvas.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Image/ImageCanvas.tsx) — เรนเดอร์หน้าเอกสารรูปภาพ และจัดการการวาดตรวจจับคำ
- **Interactive Layers & Overlays:**
  - [src/components/Layers/InteractiveLayerOverlay.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Layers/InteractiveLayerOverlay.tsx) — ควบคุมปฏิสัมพันธ์กับ layer เช่น การเลือก, การย้ายตำแหน่ง, หรือการปรับขนาดกล่องข้อความ
- **Glossary UI Panel:**
  - [src/components/Layout/GlossarySidebarPanel.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Layout/GlossarySidebarPanel.tsx) — หน้าจอด้านข้าง (Sidebar Panel) สำหรับจัดการคำเฉพาะพจนานุกรม
  - [src/components/Layout/LeftSidebar.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Layout/LeftSidebar.tsx) — แถบเมนูด้านซ้ายที่ผูกแผงควบคุมหลักรวมถึง Glossary Panel
- **Security & Authentication UI:**
  - [src/components/Auth/AuthGuard.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Auth/AuthGuard.tsx) — ตัวควบคุมปิดกั้นการเรนเดอร์แอปหลักก่อนการ Unlock
  - [src/components/Auth/SetupScreen.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Auth/SetupScreen.tsx) — หน้าตั้งรหัสผ่านหลักและรหัส PIN รีเซ็ตระบบครั้งแรก
  - [src/components/Auth/LoginScreen.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Auth/LoginScreen.tsx) — หน้าจอป้อนรหัสผ่านปลดล็อกและทางเข้ารีเซ็ตระบบ
  - [src/components/Auth/EmergencyModal.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Auth/EmergencyModal.tsx) — ป๊อปอัปกรอก PIN ยืนยันเพื่อกู้คืน/รีเซ็ตระบบ
  - [src/components/Auth/SecuritySettings.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Auth/SecuritySettings.tsx) — วิดเจ็ตตั้งค่าเปลี่ยนแอปโหมด (Relax vs Security) ในหน้า Settings หลัก

### 2. Electron Core (Main Process)
- **IPC Main Handler:** [electron/main.ts](file:///c:/App/Electron/PDF_Translator/electron/main.ts) — จัดการการสื่อสารระหว่าง Renderer และ Main process
- **PDF Print Export (Level 2):** [electron/pdfExportService.ts](file:///c:/App/Electron/PDF_Translator/electron/pdfExportService.ts) — Hidden Window พิมพ์เฉพาะ overlay โปร่งใส → [pdfExportMerge.ts](file:///c:/App/Electron/PDF_Translator/electron/pdfExportMerge.ts) stamp ทับ Source PDF ด้วย `pdf-lib`
- **Preload API Wrapper:** [electron/preload.ts](file:///c:/App/Electron/PDF_Translator/electron/preload.ts) — กำหนด API ปลอดภัยที่อนุญาตให้ Renderer เรียกใช้งานระบบได้
- **Local SQLite Database Layer:** [electron/db.ts](file:///c:/App/Electron/PDF_Translator/electron/db.ts) — จัดการเชื่อมต่อเข้ารหัส SQLCipher, แคช OCR และคำแปล
- **IPC Files Access Bridge:** [electron/documentFileAccess.ts](file:///c:/App/Electron/PDF_Translator/electron/documentFileAccess.ts) — จัดการการอ่านเขียนไฟล์ผ่าน IPC (รวมถึงฟังก์ชัน zero-copy path สำหรับการ import ไฟล์ขนาดใหญ่)
- **Local Cryptography & safeStorage:** [electron/authService.ts](file:///c:/App/Electron/PDF_Translator/electron/authService.ts) — จัดการ Hash PBKDF2, จัดเก็บค่า Config และเข้ารหัส OS Keychain (Relax Mode)

### 3. OCR Engine & Processing Pipelines
- **OCR Electron Bridge:** [electron/ocrBridge.ts](file:///c:/App/Electron/PDF_Translator/electron/ocrBridge.ts) — สื่อสารประสานงานระบบ OCR ฝั่ง Main Process
- **OCR Main Orchestrator (Frontend):** [src/services/vision/VisionService.ts](file:///c:/App/Electron/PDF_Translator/src/services/vision/VisionService.ts) — จัดการคิวงาน, worker lifecycle (Tesseract-free layout segmentation), และการรวมผลลัพธ์ของ OCR
- **Python OCR Pipeline (Daemon/External):** [scripts/external_ocr_bridge.py](file:///c:/App/Electron/PDF_Translator/scripts/external_ocr_bridge.py) — รันโมเดล OCR ภายนอก (เช่น PaddleOCR/EasyOCR) ทำงานเป็น Daemon เพื่อลดเวลาบูตระบบ
- **OCR Geometry Normalization:** [src/services/ocr/ocrSafetyLineDedup.ts](file:///c:/App/Electron/PDF_Translator/src/services/ocr/ocrSafetyLineDedup.ts) — จัดการความเสถียรของกล่องข้อความ คำที่ซ้อนทับกัน และการขจัดสถิติ ghost lines

### 4. Translation & Glossary Services
- **SFX & Glossary Translation Logic:** [src/services/translation/sfxDictionaryService.ts](file:///c:/App/Electron/PDF_Translator/src/services/translation/sfxDictionaryService.ts) — จัดการและแปลคำเฉพาะ เสียงเอฟเฟกต์ (SFX) ภาษาไทยตามพจนานุกรมของผู้ใช้
- **Offline Translator (Argos):** [src/services/translation/offlineTranslationService.ts](file:///c:/App/Electron/PDF_Translator/src/services/translation/offlineTranslationService.ts) — ตัวแปลภาษาออฟไลน์หลักและ routing patterns
- **Translation Coordinator:** [src/services/translation/translationCoordinator.ts](file:///c:/App/Electron/PDF_Translator/src/services/translation/translationCoordinator.ts) — ประสานงานจัดส่งชุดคำแปลแบบ batch และเกลี่ยข้อความกลับเข้า index เดิม

### 5. Zustand State Stores
- **Glossary Store:** [src/stores/useGlossaryStore.ts](file:///c:/App/Electron/PDF_Translator/src/stores/useGlossaryStore.ts) — จัดเก็บและควบคุมข้อมูล Custom Glossary ของผู้ใช้
- **OCR Text Layer Store:** [src/stores/useOCRTextLayerStore.ts](file:///c:/App/Electron/PDF_Translator/src/stores/useOCRTextLayerStore.ts) — จัดการแคช OCR และแคชคำแปลในแต่หน้าและแต่ละโมเดล
- **Layer Control Store:** [src/stores/useLayerStore.ts](file:///c:/App/Electron/PDF_Translator/src/stores/useLayerStore.ts) — ควบคุมการแก้ไขสไตล์, ขนาด, และพิกัดตำแหน่งของกล่องข้อความ
- **Project Store:** [src/stores/useProjectStore.ts](file:///c:/App/Electron/PDF_Translator/src/stores/useProjectStore.ts) — จัดการข้อมูลโปรเจกต์และไฟล์ PDF ปัจจุบัน
- **UI Store:** [src/stores/useUIStore.ts](file:///c:/App/Electron/PDF_Translator/src/stores/useUIStore.ts) — จัดการสถานะการซูม/แพน แถบข้าง และสลับโหมด Split View / Overlay
- **Security & Authentication Store:** [src/stores/useAuthStore.ts](file:///c:/App/Electron/PDF_Translator/src/stores/useAuthStore.ts) — จัดการสถานะ Unlock, โหมดความปลอดภัยของแอป และเชื่อมต่อ IPC API คีย์หลักของระบบ

---

## 📚 Documents & Knowledge Base Index

### 🏢 Architecture & Overview
- [documents/ARCHITECTURE.md](file:///c:/App/Electron/PDF_Translator/documents/ARCHITECTURE.md) — ภาพรวมสถาปัตยกรรมหลักของระบบ, Runtime Topology, ข้อมูล Cache และ Flow การแปล
- [documents/Knowledge.md](file:///c:/App/Electron/PDF_Translator/documents/Knowledge.md) — สรุปกฎเหล็ก (Golden Rules) ด้าน Geometry, Cache, และกลไกของแอปพลิเคชัน
- [documents/Roadmap.md](file:///c:/App/Electron/PDF_Translator/documents/Roadmap.md) — บันทึก Roadmap การพัฒนาฟีเจอร์หลัก (P0 ถึง P5) และสิ่งที่ทำเสร็จแล้ว
- [documents/CHANGELOG.md](file:///c:/App/Electron/PDF_Translator/documents/CHANGELOG.md) — ประวัติการเปลี่ยนแปลงรายละเอียดเอกสารความรู้และฟีเจอร์ภายในโฟลเดอร์ `documents/`

### 👁️ Image & OCR Processing
- [documents/OCR_OPTIMIZATION.md](file:///c:/App/Electron/PDF_Translator/documents/OCR_OPTIMIZATION.md) — เทคนิคการปรับปรุงความเร็วและความแม่นยำของ OCR
- [documents/image_processing_knowledge/electron_ocr_runtime_architecture.md](file:///c:/App/Electron/PDF_Translator/documents/image_processing_knowledge/electron_ocr_runtime_architecture.md) — โครงสร้างและ IPC Contract ระหว่าง Node.js และ Python OCR
- [documents/image_processing_knowledge/ocr_engine_selection_policy.md](file:///c:/App/Electron/PDF_Translator/documents/image_processing_knowledge/ocr_engine_selection_policy.md) — นโยบายการเลือกใช้ OCR Engine ให้เหมาะสมกับชนิดของหน้าเอกสาร
- [documents/image_processing_knowledge/ocr_preprocessing_rules.md](file:///c:/App/Electron/PDF_Translator/documents/image_processing_knowledge/ocr_preprocessing_rules.md) — กฎการบีบอัดและปรับคุณภาพภาพก่อนส่งให้ OCR Engine
- [documents/image_processing_knowledge/ocr_candidate_selection_rules.md](file:///c:/App/Electron/PDF_Translator/documents/image_processing_knowledge/ocr_candidate_selection_rules.md) — กฎการคัดเลือกข้อความและแยกแยะกล่องคำศัพท์
- [documents/image_processing_knowledge/ocr_orchestrator_flow.md](file:///c:/App/Electron/PDF_Translator/documents/image_processing_knowledge/ocr_orchestrator_flow.md) — ลำดับการทำงานของคิวประมวลผลและการรวมผลลัพธ์จากหลาย Engine
- [documents/image_processing_knowledge/ocr_output_schema.md](file:///c:/App/Electron/PDF_Translator/documents/image_processing_knowledge/ocr_output_schema.md) — โครงสร้างข้อมูล JSON สัญญาระหว่าง Engine และแอปพลิเคชันหลัก

### 🌐 Translation Pipeline & Argos Translate
- [documents/argostranslation_knowledge/argos_translation_knowledge.md](file:///c:/App/Electron/PDF_Translator/documents/argostranslation_knowledge/argos_translation_knowledge.md) — ข้อมูลความรู้การใช้งานและข้อจำกัดของ Argos Translate
- [documents/argostranslation_knowledge/argos_translation_quality_control.md](file:///c:/App/Electron/PDF_Translator/documents/argostranslation_knowledge/argos_translation_quality_control.md) — กลไกการประเมินคุณภาพคำแปลและการควบคุมผลลัพธ์
- [documents/argostranslation_knowledge/argos_pair_config_templates.md](file:///c:/App/Electron/PDF_Translator/documents/argostranslation_knowledge/argos_pair_config_templates.md) — การตั้งค่าคู่ภาษาและค่า Glossary Bias ต่างๆ
- [documents/argostranslation_knowledge/thai_repair_rule_patterns.md](file:///c:/App/Electron/PDF_Translator/documents/argostranslation_knowledge/thai_repair_rule_patterns.md) — กฎและ regex สำหรับการซ่อมแซมประโยคภาษาไทยที่แปลไม่สมบูรณ์
- [documents/argostranslation_knowledge/translation_glossary_seed.md](file:///c:/App/Electron/PDF_Translator/documents/argostranslation_knowledge/translation_glossary_seed.md) — รายชื่อศัพท์ตั้งต้น (Seed) สำหรับระบบจัดระบบพจนานุกรมในโปรเจกต์

### ⚙️ System Handoffs & Upgrades
- [documents/PIPELINE_HANDOFF_2026_05_09.md](file:///c:/App/Electron/PDF_Translator/documents/PIPELINE_HANDOFF_2026_05_09.md) — รายละเอียดการส่งต่อระบบและโครงสร้างปรับแต่งตอนแปลออฟไลน์
- [documents/Optimize_Plan/upgrade5.1.md](file:///c:/App/Electron/PDF_Translator/documents/Optimize_Plan/upgrade5.1.md) — แผนปรับปรุงและตรวจสอบประสิทธิภาพ GPU, Daemon และ Zero-copy IPC

---

## ✅ Document Sync Notes (บันทึกการปรับปรุงเอกสาร)

เอกสารทั้งหมดได้รับการตรวจสอบและปรับปรุงให้ตรงกับโค้ดปัจจุบันในวันที่ 2026-06-13:

1. **`OCR_ALGORITHM_VERSION`:** ปรับปรุงใน [ARCHITECTURE.md](file:///c:/App/Electron/PDF_Translator/documents/ARCHITECTURE.md#L41) ให้เป็นเวอร์ชันปัจจุบันคือ `214` ตรงกับ [ocrVersion.ts](file:///c:/App/Electron/PDF_Translator/src/services/vision/ocrVersion.ts#L1)
2. **`OCR_TRANSLATION_CACHE_VERSION`:** ปรับปรุงใน [ARCHITECTURE.md](file:///c:/App/Electron/PDF_Translator/documents/ARCHITECTURE.md#L48) ให้เป็นเวอร์ชันปัจจุบันคือ `'v48'` ตรงกับ [useOCRTextLayerStore.ts](file:///c:/App/Electron/PDF_Translator/src/stores/useOCRTextLayerStore.ts#L42)
3. **`Custom Glossary` System:** เพิ่มรายละเอียดของ `useGlossaryStore.ts` และ `GlossarySidebarPanel.tsx` ในโครงสร้างสถาปัตยกรรมของ [ARCHITECTURE.md](file:///c:/App/Electron/PDF_Translator/documents/ARCHITECTURE.md) เรียบร้อยแล้ว
4. **Roadmap Progress (P4 & P5):** อัปเดตสถานะของ P4 (Performance) และ P5 (Glossary Pipeline Integration) ใน [Roadmap.md](file:///c:/App/Electron/PDF_Translator/documents/Roadmap.md) เป็น **Completed** เรียบร้อยแล้ว
5. **Phase 7 Advanced Local Security:** อัปเดตสัญญาระบบความปลอดภัยแบบ Secure-by-default, การเข้ารหัส DB ด้วย SQLCipher (`better-sqlite3-multiple-ciphers`), ระบบ Offline Setup/Login, Relax (Keychain) vs Security App Modes และ Reset System wipe data ลงใน manifest นี้แล้วในวันที่ 2026-06-12
6. **All Pages / Background Queue Alignment:** อัปเดตเอกสารสถาปัตยกรรมการแปลและการจัดกลุ่ม เพิ่มรายละเอียดการผูกฟังก์ชัน `splitAggressiveMergedLines` และ `filterGhostOcrData` ใน [BackgroundQueueProcessor.ts](file:///c:/App/Electron/PDF_Translator/src/services/ocr/BackgroundQueueProcessor.ts) เพื่อแก้ไขปัญหาคำแปลเหลื่อมดัชนี (Index Drift) เมื่อแปลในแบบ Background / All Pages ในวันที่ 2026-06-13
7. **OCR Model Profile Persistence Alignment:** ปรับปรุงและบันทึกสถาปัตยกรรมการจำโมเดลและโปรไฟล์ OCR รายไฟล์ (per-file) โดยแก้ไขจุดที่คีย์ `fileKey` ในการดึงค่า (`loadProject`) และการบันทึกค่า (`subscribe`) ไม่ตรงกันเมื่อรันในสภาพแวดล้อม Production (ซึ่งระบบจะมีการสลับพาธเพื่อความเข้ากันได้ของ OCR Cache) ในวันที่ 2026-06-13
8. **PaddleOCR Cold Start & Memory Optimization:** ปรับปรุงประสิทธิภาพของ OCR Daemon และหน่วยความจำของ Main process โดยทำระบบ Lazy Loading (เอาตัว prewarm ตอนบูตออก), เพิ่มฟังก์ชัน `cleanup_memory` (สั่ง GC และ CUDA cache empty ใน Python หลังทำงานเสร็จ), เพิ่มระบบ Idle Process Lifecycle (ปิดตัวเองหลังไม่มีงานวิ่ง 5 นาที หรือเมื่อปิด Workspace) และสร้างระบบตรวจสอบประสิทธิภาพผ่าน `--benchmark-memory-leak` วัดหน่วยความจำเริ่มต้น RSS ได้ 109.82 MB (เป้าหมาย < 120MB) ในวันที่ 2026-06-13
9. **The Tesseract Purge:** ลบ Tesseract dependencies, assets และ fallback logic ออกจากโปรเจกต์อย่างสมบูรณ์เพื่อทำให้ตัวแอปพลิเคชันมีขนาดเบาลงและมีความเสถียรมากขึ้นโดยอิงเฉพาะ PaddleOCR และ EasyOCR เป็นหลักในวันที่ 2026-06-13
10. **AuthGuard Bypass in Harness:** เพิ่มการตรวจสอบ query param `ocr_harness=1` เพื่อ bypass AuthGuard ในระหว่างรัน regression test ใน Playwright เพื่อไม่ให้แอปพลิเคชันค้างในระบบ CI/CD ในวันที่ 2026-06-13
11. **Benchmark & EasyOCR RAW Integration:** ปรับปรุงระบบประเมินเปรียบเทียบให้รองรับการรัน EasyOCR ในโหมดเปรียบเทียบ RAW vs FULL โดยสร้างฟังก์ชัน `run_easyocr_raw` ใน Python bridge daemon และขยายสัญญาณส่ง IPC จากฝั่ง UI ไปยัง main process สำเร็จในวันที่ 2026-06-13
12. **Raw OCR Parsing & Confidence Fix:** แก้ไขบั๊กโครงสร้างใน `run_paddleocr_raw` ที่ดึงข้อมูลผ่านคีย์ `predict()` เปล่าๆ ทำให้คำที่แสกนได้กลายเป็น 0 ในระหว่างประมวลผลโมเดลที่ใช้ `ocr()` ในฝั่ง Python พร้อมทั้งเพิ่มฟังก์ชันคำนวณเฉลี่ยค่าความมั่นใจ (Average Confidence) ของ RAW pass ทั้งของ Paddle และ Easy ในวันที่ 2026-06-13
13. **Split-View & Sync-Scroll:** เพิ่มฟังก์ชัน Side-by-Side Split View เพื่อให้ผู้ใช้สามารถตรวจสอบ Original OCR เคียงคู่กับบทแปลแบบเรียลไทม์ โดยรองรับการซิงโครไนซ์ตำแหน่งการเลื่อน (Synchronized Scrolling) และพิกัดซูมแบบ 60fps Zero-Latency ข้ามหน้าต่าง และจะปิดการแบ่งช่องแสดงผลโดยอัตโนมัติเมื่อเปลี่ยนหน้าหรือปิดไฟล์ถัดไปในวันที่ 2026-06-13


## 🛠️ Common Task Workflow (ทางลัดในการทำงาน)

เมื่อคุณต้องแก้ปัญหาเหล่านี้ ให้ใช้ Workflow การเข้าถึงไฟล์ตามลำดับนี้:

* **โจทย์ "OCR อ่านผิด / ผลลัพธ์เพี้ยน":**
  1. ตรวจสอบ [VisionService.ts](file:///c:/App/Electron/PDF_Translator/src/services/vision/VisionService.ts) (Orchestrator)
  2. ตรวจสอบ [ocrTextNormalizer.ts](file:///c:/App/Electron/PDF_Translator/src/services/ocr/ocrTextNormalizer.ts) (Normalizer)
  3. ดู [ocr_orchestrator_flow.md](file:///c:/App/Electron/PDF_Translator/documents/image_processing_knowledge/ocr_orchestrator_flow.md) (Flow logic)

* **โจทย์ "แปลภาษาผิด / ไม่ยอมใช้ Glossary":**
  1. ดู [translationCoordinator.ts](file:///c:/App/Electron/PDF_Translator/src/services/translation/translationCoordinator.ts) (Coordinator)
  2. ตรวจสอบ [offlineTranslationService.ts](file:///c:/App/Electron/PDF_Translator/src/services/translation/offlineTranslationService.ts) (Engine)
  3. ตรวจสอบข้อมูลใน [useGlossaryStore.ts](file:///c:/App/Electron/PDF_Translator/src/stores/useGlossaryStore.ts) (User Data)

* **โจทย์ "แอปกระตุก / UI ค้าง":**
  1. ดู [InteractiveLayerOverlay.tsx](file:///c:/App/Electron/PDF_Translator/src/components/Layers/InteractiveLayerOverlay.tsx) (Renderer)
  2. ดู [ocrBridge.ts](file:///c:/App/Electron/PDF_Translator/electron/ocrBridge.ts) (Bridge/IPC Load)