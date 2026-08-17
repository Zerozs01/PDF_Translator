# PDF Translator - Project Context & Architecture Reference

> **อัปเดตล่าสุด:** สิงหาคม 2026  
> **สถานะการทดสอบ:** Vitest 34/34 Test Files ผ่านทั้งหมด (324/324 Tests Passed ✅)

---

## 📌 1. ภาพรวมโปรเจกต์ (Project Overview)

**PDF Translator** คือแอปพลิเคชัน Desktop สำหรับแปลเอกสาร PDF, มังงะ, มังฮวา และรูปภาพ ด้วยเทคโนโลยี AI/OCR ออฟไลน์และออนไลน์:
- **Frontend:** React 18 + TypeScript (Strict) + Vite + TailwindCSS + Zustand
- **Desktop Host:** Electron (Context Isolation, Secure IPC, Native FS)
- **Database:** SQLite (`better-sqlite3`) พร้อมโหมด WAL, FTS5 Full-Text Search และ Memory-Mapped I/O
- **OCR Engine (Python Sidecar):** PaddleOCR, EasyOCR, Manga-OCR (รองรับ DirectML บน AMD/Intel/NVIDIA GPUs)
- **Translation Engine:** Argos Translate (NMT ออฟไลน์ผ่าน CTranslate2) และ Google Gemini API (คลาวด์)

---

## 🏛️ 2. สถาปัตยกรรมระบบและ Data Flow (System Architecture)

```mermaid
flowchart TD
    User([ผู้ใช้]) --> UI[React UI / UploadScreen / Viewer]
    
    subgraph FrontendState [Zustand State Stores]
        ProjectStore[useProjectStore\n(Active Doc, Page, Lang)]
        OCRStore[useOCRTextLayerStore\n(OCR Cache, Text Boxes)]
        LayerStore[useLayerStore\n(Interactive Text Layers)]
        QueueStore[useBackgroundQueueStore\n(Batch Jobs & Progress)]
    end

    subgraph DesktopHost [Electron Main Process]
        IPC[IPC Handlers]
        DB[(SQLite Database\npdf_translator.db)]
        PythonBridge[OCR / Argos Bridge]
    end

    subgraph Sidecar [Python Engines]
        Paddle[PaddleOCR / EasyOCR]
        Argos[Argos Translate Engine]
    end

    UI --> FrontendState
    FrontendState <--> IPC
    IPC <--> DB
    IPC <--> PythonBridge
    PythonBridge <--> Sidecar
```

---

## 📂 3. โครงสร้างโฟลเดอร์หลัก (Key Directories & File Map)

### 3.1 Frontend (`src/`)
- [`src/App.tsx`](file:///c:/App/Electron/PDF_Translator/src/App.tsx): Main Application Shell, Layout Orchestration, Translation Coordination
- [`src/stores/`](file:///c:/App/Electron/PDF_Translator/src/stores/):
  - [`useProjectStore.ts`](file:///c:/App/Electron/PDF_Translator/src/stores/useProjectStore.ts): ข้อมูลโปรเจกต์ที่เปิดอยู่ (`documentId`, `currentPage`, `last_page`, `fileUrl`)
  - [`useOCRTextLayerStore.ts`](file:///c:/App/Electron/PDF_Translator/src/stores/useOCRTextLayerStore.ts): OCR & Translation Cache ประจำเอกสารที่เปิดอยู่
  - [`useLayerStore.ts`](file:///c:/App/Electron/PDF_Translator/src/stores/useLayerStore.ts): จัดการ Text Layer, Grouping, Bounding Box บนหน้าจอ
  - [`useBackgroundQueueStore.ts`](file:///c:/App/Electron/PDF_Translator/src/stores/useBackgroundQueueStore.ts): จัดการคิวงานแปลพื้นหลัง (Batch Queue)
- [`src/components/`](file:///c:/App/Electron/PDF_Translator/src/components/):
  - [`PDF/PDFCanvas.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/PDF/PDFCanvas.tsx): ตัวเรนเดอร์ PDF ต่อเนื่อง/หน้าเดี่ยว + IntersectionObserver + Text Overlay
  - [`Image/ImageCanvas.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Image/ImageCanvas.tsx): ตัวเรนเดอร์รูปภาพเดี่ยว
  - [`Home/UploadScreen.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Home/UploadScreen.tsx): หน้าโฮม คลังเอกสาร และรายการงานในคิว
  - [`Layers/InteractiveLayerOverlay.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Layers/InteractiveLayerOverlay.tsx): ปฏิสัมพันธ์กล่องข้อความ (Drag, Resize, Edit)
- [`src/services/`](file:///c:/App/Electron/PDF_Translator/src/services/):
  - [`ocr/BackgroundQueueProcessor.ts`](file:///c:/App/Electron/PDF_Translator/src/services/ocr/BackgroundQueueProcessor.ts): ตัวประมวลผลงานแปลพื้นหลัง (แยกจาก Active Document)
  - [`ocr/ocrTextNormalizer.ts`](file:///c:/App/Electron/PDF_Translator/src/services/ocr/ocrTextNormalizer.ts): คลีนและซ่อมแซมคำผิดจาก OCR ก่อนเข้าตัวแปล
  - [`translation/translationCoordinator.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/translationCoordinator.ts): รวมกลุ่มประโยค, ตรวจสอบพจนานุกรม และประสานงาน Engine แปล
  - [`translation/offlineTranslationService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/offlineTranslationService.ts): ระบบแปลออฟไลน์และ Phrase Lookups
  - [`translation/sfxDictionaryService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/sfxDictionaryService.ts): พจนานุกรมเสียงเอฟเฟกต์ (SFX) และเสียงคราง
  - [`translation/thaiConversationalGlossary.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/thaiConversationalGlossary.ts): บทสนทนาแสลงและประโยคมังงะ 20+
  - [`layout/balloonAwareGroupingService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/layout/balloonAwareGroupingService.ts): รวมกลุ่มบรรทัดข้อความในบอลลูนคำพูดเดียวกัน
  - [`pdf/PdfPrintExportService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/pdf/PdfPrintExportService.ts): ส่งออก PDF คุณภาพสูงผ่าน Hidden Electron Window

### 3.2 Desktop Host (`electron/`)
- [`electron/main.ts`](file:///c:/App/Electron/PDF_Translator/electron/main.ts): Electron Entrypoint & IPC Handler Registration
- [`electron/db.ts`](file:///c:/App/Electron/PDF_Translator/electron/db.ts): SQLite Data Access Objects (DAO) สำหรับ Documents, OCR, Cache, Sentence Dictionary
- [`electron/preload.ts`](file:///c:/App/Electron/PDF_Translator/electron/preload.ts): Context Bridge & Type-safe IPC Wrappers
- [`electron/ocrBridge.ts`](file:///c:/App/Electron/PDF_Translator/electron/ocrBridge.ts) & [`electron/argosBridge.ts`](file:///c:/App/Electron/PDF_Translator/electron/argosBridge.ts): ควบคุมกระบวนการ Sidecar Python

---

## 🛠️ 4. การแก้ไขปัญหาสำคัญล่าสุด (Recent Key Bug Fixes & Resolutions)

### 1. การแยก In-Memory Store ระหว่างเอกสาร (Cross-Document Cache Leak Fix)
- **ปัญหา:** เมื่อเปิดไฟล์ที่ 1 อยู่ แล้วสั่ง Offline All Pages บนไฟล์ที่ 2 งานพื้นหลังของไฟล์ที่ 2 เข้าไปอัปเดต `useOCRTextLayerStore` และ `useLayerStore` ของหน้าเดียวกัน ทำให้ UI และแคชของไฟล์ที่ 1 โดนเขียนทับ
- **การแก้ปัญหา:** เพิ่ม Guard `isActiveDoc` (`matchedDocId === activeDocId`) ใน `runCurrentPageTranslation` ใน [`src/App.tsx`](file:///c:/App/Electron/PDF_Translator/src/App.tsx) เพื่อให้งานพื้นหลังบันทึกผลลงเฉพาะ SQLite DB เท่านั้น ไม่แตะต้อง In-Memory Store ของไฟล์ที่เปิดอยู่

### 2. การจำหน้าสุดท้ายที่เคยเปิด (Last Page Restoration & Scroll Lock Fix)
- **ปัญหา:** เมื่อเปิดไฟล์เดิม `IntersectionObserver` ของ Page 1 สั่ง `setPage(1)` ทันทีขณะโหลด ทำให้ `last_page` ใน SQLite ถูกบันทึกทับเป็น 1 เสมอ
- **การแก้ปัญหา:**
  - เพิ่ม `isProgrammaticScrollRef = true` บน Mount เมื่อ `currentPage > 1` ใน [`src/components/PDF/PDFCanvas.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/PDF/PDFCanvas.tsx) เพื่อล็อคไม่ให้ Observer หน้า 1 สั่ง `setPage(1)`
  - สั่ง Scroll ไปยัง `currentPage` ที่จำไว้ทันทีเมื่อเรนเดอร์สำเร็จ
  - ใน `loadProject` ([`src/stores/useProjectStore.ts`](file:///c:/App/Electron/PDF_Translator/src/stores/useProjectStore.ts)) กู้คืน `doc.last_page` จาก SQLite กลับเข้าสู่ state

### 3. การรีเซ็ตคิว All Pages ให้เริ่มจากหน้า 1 (Queue Sequence Fix)
- **ปัญหา:** เมื่อยกเลิกคิวแล้วกด Offline All Pages ใหม่ คิวเริ่มต่อจากหน้าที่ค้างแทนที่จะเริ่มจากหน้า 1
- **การแก้ปัญหา:** ใน [`src/services/ocr/BackgroundQueueProcessor.ts`](file:///c:/App/Electron/PDF_Translator/src/services/ocr/BackgroundQueueProcessor.ts) กำหนด `pageNumbers` ของงาน `_all` ให้เป็น `1..totalPages` เสมอ และรีเซ็ต `currentPage = 1` เมื่อกด Clear Cache Document

### 4. การขยายพจนานุกรมมังงะและเสียงเอฟเฟกต์ (SFX & 20+ Manga Dictionary)
- เพิ่มคำศัพท์, เสียงคราง, SFX และ Regex ซ่อมคำผิดกว่า 150+ รายการใน [`ocrTextNormalizer.ts`](file:///c:/App/Electron/PDF_Translator/src/services/ocr/ocrTextNormalizer.ts), [`sfxDictionaryService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/sfxDictionaryService.ts), และ [`offlineTranslationService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/offlineTranslationService.ts)

---

## 🧪 5. การตรวจสอบและทดสอบ (Testing & Standards)

- **รันชุดการทดสอบทั้งหมด:**
  ```powershell
  pnpm vitest run
  ```
- **รันเฉพาะส่วน Translation & Grouping:**
  ```powershell
  pnpm vitest run src/services/translation/ src/App.translationDedupe.test.ts
  ```
- **ผลลัพธ์ปัจจุบัน:** ผ่านสมบูรณ์ **34/34 Test Files (324/324 Tests Passed)**
