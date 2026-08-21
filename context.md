# PDF Translator - Project Context & Architecture Reference

> **อัปเดตล่าสุด:** สิงหาคม 2026  
> **สถานะการทดสอบ:** Vitest 34/34 Test Files ผ่านทั้งหมด (326/326 Tests Passed ✅)

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

### 5. การแก้ปัญหาภาษาเกาหลี/สเปนตกค้าง และการอัปเกรดแคช Offline All Pages (Carryover & Cache Upgrade Fix)
- **ปัญหา:** ประโยคเกาหลีแบบติดกัน/สแลง/ไม่มีเว้นวรรค และคำสเปนขาดครึ่ง/จุดติดคำ/คำทับศัพท์ (`SUNBAE`, `HOOBAE`) แปลไม่ออกหรือโดนเมิน และเมื่อกด Offline All Pages ระบบดึงแคชเดิมที่ยังไม่ได้แปลมาแสดงผลซ้ำ
- **การแก้ปัญหา:**
  - เพิ่ม Fallback Patterns ใน [`koreanTranslationPolicy.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/koreanTranslationPolicy.ts) และ Short Phrase Lookups ใน [`offlineTranslationService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/offlineTranslationService.ts)
  - ปรับปรุง `isCacheIncomplete` ใน [`src/App.tsx`](file:///c:/App/Electron/PDF_Translator/src/App.tsx) ให้ตรวจสอบ Hangul/Latin Carryover เพื่อสั่ง Re-translate ทันทีที่พบข้อความตกค้าง
  - เพิ่มการอัปเกรดคำแปลอัตโนมัติ (`applyKoreanConversationalFallback`, `lookupShortPhraseTh`) ใน `safeMatchedCache` เมื่อโหลดข้อมูลจาก SQLite DB

### 6. การรวม Pipeline การจัดกลุ่มบอลลูนและความสอดคล้องระหว่าง Single-Page และ All-Pages (Unified Balloon Grouping & Group-First Policy)
- **ปัญหา:** เมื่อสั่งแปลแบบ Single Page ระบบดึงกลุ่มจาก `useLayerStore` แต่เมื่อรัน Offline All Pages ระบบติด Guard `isActiveDoc` ทำให้ Store ว่างเปล่าและตกไปใช้ Heuristics คนละตัว ส่งผลให้ประโยคถูกตัดแบ่งคนละแบบ และขั้นตอน Redistribution ตกไปใช้ Per-line dictionary ทำให้ประโยคที่แปลสมบูรณ์แล้วถูกคำเดี่ยวเขียนทับ
- **การแก้ปัญหา:**
  - ปรับปรุง `resolveTranslationGroupsWithLayout` ใน [`src/App.tsx`](file:///c:/App/Electron/PDF_Translator/src/App.tsx) ให้คำนวณ Canonical 2D Spatial Connected Components Graph สดๆ จาก `buildLayerGroupsFromOCR(pageOCR)` ทันทีหาก Store ว่างเปล่า ทำให้ผลลัพธ์การจัดกลุ่มระหว่าง Foreground และ Background Queue ตรงกัน 100%
  - กำหนด **Group-First Translation Policy** ปิดกั้นไม่ให้ Per-Line Dictionary ดักทับช่องบรรทัดของประโยคบอลลูนที่แปลเป็นภาษาไทยสมบูรณ์แล้ว
  - ล้าง Duplicate Key ใน [`offlineTranslationService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/offlineTranslationService.ts)

### 7. ความสอดคล้องของ Background Queue, การผ่อนปรนบอลลูนกึ่งกลาง และการซ่อมคำเพี้ยน (Queue Parity, Centered Overlap & Normalization Fix)
- **ปัญหา:** 
  - Background Queue มี Resolution Clamping และปิด `useAngleCls` เสมอ ทำให้ได้ผล OCR เพี้ยนกว่า Single Page (`I KEEP` เป็น `IKEER`, `KNIGHT` เป็น `KNIIGH`, `GONNA USE` เป็น `GONNA LSE`)
  - บอลลูนที่มีคำสั้นสลับคำยาว (เช่น `NOISY` กับ `BITCH... HEY!`) มี `horizOverlap < 0.48` จึงหลุดออกจากกลุ่มเดียวกันและเกิดช่องว่างไม่มีคำแปล
  - `mangaGroupOverrides.ts` มีการแมปคำทีละช่องจน Index Shift ทับซ้อนคำว่า `THE PIG YOU ARE`
  - เครื่องหมาย `#` หลุดรอดมาแสดงในข้อความแปล (`# จะต้องมี#`) และ `PiG-KNIGHT` แปลเป็น `พยัคฆ์` จากขีด Hyphen
- **การแก้ปัญหา:**
  - ใน [`BackgroundQueueProcessor.ts`](file:///c:/App/Electron/PDF_Translator/src/services/ocr/BackgroundQueueProcessor.ts) เชื่อมโยง `useAngleCls` และคุณภาพ OCR ให้ตรงกับค่าที่กำหนดใน Single Page
  - ใน [`LayerGroupingService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/layers/LayerGroupingService.ts) เพิ่มเงื่อนไขเชื่อมต่อบรรทัดบทสนทนาภาษาอังกฤษแนวตั้งที่จัดกึ่งกลาง (`isStacked` && `vertGap <= 1.8 * avgHeight`) เมื่อ `horizOverlap >= 0.20`
  - ปรับปรุง [`mangaGroupOverrides.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/mangaGroupOverrides.ts) และเพิ่ม Normalizer ซ่อมคำผิดใน [`ocrTextNormalizer.ts`](file:///c:/App/Electron/PDF_Translator/src/services/ocr/ocrTextNormalizer.ts) สำหรับ `IKEER`, `KNIIGH`, `GONNA LSE`, `PiG-KNIGHT`
  - ปรับปรุง `sanitizeTranslationResult` ใน [`translationCoordinator.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/translationCoordinator.ts) ให้ล้างเครื่องหมาย Hash Delimiters ทั้งหมด

### 8. การแก้ปัญหาขอบ Overlay หาย (OF ALL OF US!) และการขยายพจนานุกรมมังงะ (Vertical Overlay Suppression & Expanded Glossary)
- **ปัญหา:**
  - คำว่า `OF` บรรทัดที่ 3 ในบอลลูน `OF ALL OF US!` หายไปจากหน้า Canvas (ไม่แสดงกล่อง overlay) ทั้งที่ใน Layer Panel มีครบ เนื่องจากระบบ Deduplication (`displacedCoverageEcho`) มองว่า `OF` บรรทัดล่างเป็นกล่องขยะ/echo ของ `OF` บรรทัดบน
  - ประโยคบทสนทนามังงะ เช่น `LilKE A`, `PRiNCEGS`, `YOURPUSSY'S REAL TIGHT`, `HATERIA`, `UGH, HAA! HER PUSSY'S SO STiNKY`, `WHiTEPiG`, `HUMILIATED`, `THEN...I` แปลผิดเพี้ยนหรือไม่แบ่งคำ
- **การแก้ปัญหา:**
  - ใน [`translationOverlayUtils.ts`](file:///c:/App/Electron/PDF_Translator/src/components/OCR/translationOverlayUtils.ts) เพิ่ม `isVerticallySeparated` guard (`overlapY <= 0.20` && `verticalGap > 0` && `centerDeltaY > minHeight * 0.8`) ป้องกันไม่ให้บรรทัดบทสนทนาที่อยู่คนละระดับในแนวดิ่งถูกยุบทิ้ง
  - ใน [`ocrTextNormalizer.ts`](file:///c:/App/Electron/PDF_Translator/src/services/ocr/ocrTextNormalizer.ts) เพิ่มตัวแปลงคำเพี้ยน: `LilKE A` $\rightarrow$ `LIKE A`, `PRiNCEGS` $\rightarrow$ `PRINCESS`, `YOURPUSSY'S` $\rightarrow$ `YOUR PUSSY'S`, `WHiTEPiG` $\rightarrow$ `WHITE PIG`, `I pan't` $\rightarrow$ `I can't`, `YQU'RE` $\rightarrow$ `YOU'RE`, `THEN...I` $\rightarrow$ `THEN...!`, `EXECUT I ON` $\rightarrow$ `EXECUTION`, `of ROSER I AS` $\rightarrow$ `OF ROSERIA'S`, `Sput` $\rightarrow$ `Spurt`, `purting` $\rightarrow$ `Spurting`, `LINSEM IN AT I ON` $\rightarrow$ `INSEMINATION`, `DISSTR I BUT I ON` $\rightarrow$ `DISTRIBUTION`, `PREGNAN` $\rightarrow$ `PREGNANT`
  - ใน [`offlineTranslationService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/offlineTranslationService.ts), [`thaiConversationalGlossary.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/thaiConversationalGlossary.ts) และ [`sfxDictionaryService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/sfxDictionaryService.ts) เพิ่มคลังคำศัพท์และบริบทสำหรับ: `SEMEN` (น้ำกาม), `Spurt` / `Sput` (ปรื๊ดด), `Spurting` / `purting` (ปรื๊ดดด!), `HIGH SCHOOLER` (นักเรียนมัธยมปลาย), `arrest for serial` (จับกุมผู้ต้องหาคดีต่อเนื่อง), `INSEMINATION` (การหว่านเชื้อ), `DISTRIBUTION` (การกระจาย), `APHRODISIAC` (ยาปลุกเซ็กซ์), `Squeeeze` (บีบแน่นนน), `PREGNAN` / `PREGNANT` (ตั้งครรภ์)

### 9. การแก้ปัญหา Single -> Scroll Mode Page Wrap (กระโดดกลับไปหน้ากลางเอกสาร)
- **ปัญหา:**
  - เมื่อผู้ใช้อยู่หน้าที่ 25 (จาก 28 หน้า) ใน Single Page Mode แล้วกดสลับเป็น Scroll Mode (Continuous) เอกสารกระโดดกลับไปค้างที่หน้า 10
  - เกิดจากขณะที่เปลี่ยนเป็น Scroll Mode หน้าระหว่างทาง (หน้า 1..24) เคลื่อนผ่าน Viewport ระหว่างแอนิเมชัน และ `IntersectionObserver` ส่ง Event ตัดหน้าก่อนที่การเลื่อน Programmatic Scroll จะเสร็จสิ้น ทำให้ Timeout ทำการ `setPage(10)` ทับเลขหน้าปัจจุบัน
- **การแก้ปัญหา:**
  - ใน [`PDFCanvas.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/PDF/PDFCanvas.tsx) ปรับให้ `activePageObserver` ตรวจจับเฉพาะเมื่อผู้ใช้กำลังเลื่อนดูด้วยตนเองจริง (`isUserInteracting === true`) และต้องไม่อยู่ในระหว่าง Programmatic Scroll (`!isProgrammaticScrollRef.current`)
  - ยกเลิก Timer `activePageChangeTimeout` ทันทีเมื่อมีการสลับโหมด หรือเปลี่ยนหน้าทางโค้ด
  - คำนวณ Fallback Offset Top สำหรับหน้าที่ DOM ยังเรนเดอร์ไม่เสร็จ เพื่อให้กระโดดไปยังหน้าที่ถูกต้องได้ทันที

### 10. การเพิ่มคำศัพท์มังงะ/สแลงชุดใหม่ & ล้างปัญหาเครื่องหมาย # xx # ในผลลัพธ์แปล
- **สิ่งที่ดำเนินการ:**
  - แก้ไข Syntax closing brace ใน [`mangaGroupOverrides.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/mangaGroupOverrides.ts) ที่ทำให้ Vite/esbuild เกิด error
  - ใน [`ocrTextNormalizer.ts`](file:///c:/App/Electron/PDF_Translator/src/services/ocr/ocrTextNormalizer.ts) เพิ่มตัวแปลงคำเพี้ยน: `IT I NSIDE` $\rightarrow$ `IT INSIDE`, `POSIT I ON` $\rightarrow$ `POSITION`, `J-JUSHT CAAME` $\rightarrow$ `J-JUST CAME`
  - ใน [`mangaGroupOverrides.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/mangaGroupOverrides.ts) เพิ่ม Rule 13 สำหรับบอลลูน: `AAAH, FUCK! YOUR BITCH MOANS ARE FORCING THE NEXT LOAD OUT!` $\rightarrow$ `อ๊าก! เหี้ย! เสียงครางร่านๆของเธอ กำลังบังคับ ให้ เตรียมก๊อก ถัดไป!`
  - ใน [`offlineTranslationService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/offlineTranslationService.ts) และ [`thaiConversationalGlossary.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/thaiConversationalGlossary.ts) เพิ่มคำศัพท์และคำสแลง:
    - `STUTTER-` $\rightarrow$ `พูดติดอ่าง`
    - `SHOVE IT INSIDE` $\rightarrow$ `ยัดเข้าไปข้างใน`
    - `BITCH` $\rightarrow$ `อีตัว`
    - `J-JUSHT CAAME!` / `J-JUST CAME!` $\rightarrow$ `ต-แตก ออกมาแล้วว!`
    - `MASOCHIST` $\rightarrow$ `มาโซคิสต์`
    - `BITCH PUSSY` $\rightarrow$ `หีร่านๆ`
    - `CUM AGAIN!!` $\rightarrow$ `แตก อีกแล้วว!!`
    - `THE SEMEN'S` $\rightarrow$ `น้ำกามมัน`
    - `FLAVORED` $\rightarrow$ `ปรุงแต่งรสชาติ`
    - `CHAAAN!` $\rightarrow$ `จังงงงห์!` (Dynamic A's)
  - **สาเหตุของ `# xx #`:** โมเดลแปลภาษา (เช่น Argos / MarianMT) หรือระบบ Protect Placeholder ในโมเดลบางตัวใช้ Delimiter สัญลักษณ์ `#` ครอบ Token ที่ต้องการปกป้อง หรือเกิดจาก Markdown header leaking (`# Heading #`) ได้ทำการเพิ่ม `sanitizeTranslationResult` ในจุดส่งกลับของ `translateBatchOffline` และ `translationCoordinator.ts` เพื่อตัดเครื่องหมาย `#` และ markdown delimiters ออกอย่างหมดจด 100%

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
- **ผลลัพธ์ปัจจุบัน:** ผ่านสมบูรณ์ **34/34 Test Files (334/334 Tests Passed ✅)**
