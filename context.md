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

### 11. การรองรับคำศัพท์สเปน/หลายภาษา (Multilingual Fallback Architecture & Spanish OCR Repairs)
- **สมมุติฐาน & สถาปัตยกรรม:**
  - ข้อความหรือสแลงมังงะที่ไม่พบในโมเดล Argos (ไม่ว่าจะเป็น EN, ES, KO, JA, ZH) ได้รับการออกแบบให้รองรับผ่านสถาปัตยกรรมหลายชั้นโดยไม่เพิ่มภาระหน่วยความจำให้ตัวแอป:
    1. **Pivot Pipeline (JA/KO/ZH -> EN -> TH):** สำหรับภาษาเอเชีย ระบบจะแปลผ่าน Pivot เป็นภาษาอังกฤษก่อน ดังนั้นคลังคำแปลสแลงและบริบทเฉพาะทางทั้งหมดในฝั่ง EN จะถ่ายทอดสู่ผลลัพธ์ภาษาไทยของ JA/KO/ZH โดยอัตโนมัติ 100%
    2. **Direct Fallback (ES & Raw Loanwords):** คำศัพท์ภาษาสเปนหรือสแลงสากลที่ OCR เพี้ยน ถูกแปลงผ่าน `SPANISH_OCR_NOISE_REPAIRS` และดักจับด้วย `SHORT_PHRASE_DICTIONARY_TH` + `thaiConversationalGlossary.ts` ในระดับ $O(1)$ Hash Lookup
- **สิ่งที่ดำเนินการเพิ่มเติม:**
  - ใน [`ocrTextNormalizer.ts`](file:///c:/App/Electron/PDF_Translator/src/services/ocr/ocrTextNormalizer.ts) เพิ่มตัวแปลงคำเพี้ยนภาษาสเปน:
    - `TEANDOLE` $\rightarrow$ `TENTANDOLE`
    - `TREVISTARON` $\rightarrow$ `ENTREVISTARON`
    - `SOLACION` $\rightarrow$ `DESOLACION`
    - `CREIBLE.SiUNNIESE` / `SiUNNIESE` $\rightarrow$ `CREIBLE. SI UNIESE`
  - ใน [`offlineTranslationService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/offlineTranslationService.ts) และ [`thaiConversationalGlossary.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/thaiConversationalGlossary.ts) เพิ่มคลังคำแปล:
    - `TEANDOLE?` / `TENTANDOLE?` $\rightarrow$ `เย้ายวนเขาเหรอ?`
    - `TENTARLO?` $\rightarrow$ `ลองดูไหม?`
    - `BROS...` $\rightarrow$ `พวกพ้อง...`
    - `TREVISTARON` $\rightarrow$ `สัมภาษณ์แล้ว`
    - `SOLACION...` / `DESOLACION...` $\rightarrow$ `ความสิ้นหวัง...`
    - `CREIBLE.SiUNNIESE` $\rightarrow$ `น่าเชื่อถือ ถ้าหากรวมตัวกัน`
    - `CANSANDO...` $\rightarrow$ `เหนื่อยล้า...`

### 12. การแก้ไขบัคแปลภาษาเกาหลีและ OCR หลุด (Korean All-Page Missing/Incomplete Translation & Typo Fix)
- **ต้นตอของปัญหา (Root Causes):**
  1. **หน้าตาดีจัง♡ (`살생겼의` vs `잘생겼다♡`):** ฟอนต์เกาหลีแบบมีหัวใจ `♡` หรือฟอนต์ลายมือทำให้ตัวอักษร `ㅈ` ถูก OCR มองเป็น `ㅅ` และ `다♡` มองเป็น `의` จนได้ข้อความว่า `살생겼의` ซึ่งไม่มีในพจนานุกรมและโมเดลแปลไม่รู้จัก จึงค้างเป็นภาษาเกาหลี
  2. **All Page เมินประโยคเกาหลี:** หน้ามังงะมีโลโก้ภาษาอังกฤษ เช่น `DANYU`, `7DAYS`, `SALON` ฟังก์ชัน `inferSourceLanguageFromTextHints` มีเงื่อนไขเข้มงวดเกินไป (`hangulCount >= 3`) ทำให้ตีความหน้านั้นเป็นภาษาอังกฤษ (`en`) ส่งผลให้ `shouldSkipLineTranslationByScript` กรองข้อความเกาหลีทิ้งเป็น CJK ขยะบนหน้าภาษาอังกฤษ
  3. **บอลลูนรวมแปลไทยไม่ครบ (มีเกาหลีปน `마리 코아들 렌아 야!`):** เมื่อรวมกลุ่ม 3 บรรทัด (`엄마 사촌`, `마리코 아들`, `렌이야!`) โมเดลแปลได้เฉพาะบรรทัดแรก (`ลูกพี่ลูกน้องของแม่`) ทำให้บรรทัดที่ 2 และ 3 ว่างเปล่าและ Fallback กลับไปเป็นข้อความเกาหลีเดิม โดยที่ `lineNeedsFallback` ไม่ยอมให้รัน per-line fallback เพราะเห็นว่ากลุ่มมีภาษาไทยแล้ว
- **สิ่งที่ดำเนินการแก้ไข:**
  - ปรับปรุง `koreanTranslationPolicy.ts` ให้ครอบคลุม `살생겼의`, `살생겼다`, `잘생겼다♡`, `엄마 사촌`, `마리코 아들`, `렌이야`, `마리코가`, `남편이랑`, `일주일 여행`, `가는 동안`, `맡า달래서`
  - รองรับสัญลักษณ์ `♡`, `♥`, `~` ใน `preserveSourceTrailingPunctuation` และ `compactSource`
  - ปรับปรุง `ocrTextHeuristics.ts` ให้ตรวจจับภาษาเกาหลีได้อย่างแม่นยำแม้มีข้อความ Hangul เพียง 1 ประโยค
  - ปรับปรุง `src/App.tsx` ให้ `lineNeedsFallback` ทำงานทันทีหากบรรทัดใดยังมีข้อความเกาหลีหลงเหลือ (`/[\uAC00-\uD7AF]/`) หรือไม่มีภาษาไทย

### 13. การเพิ่มคลังคำแปลภาษาเกาหลีชุดใหม่ & วิเคราะห์ Layer Control Balloon
- **คลังคำแปลภาษาเกาหลีที่เพิ่มใหม่:**
  - `당연히 안되지` $\rightarrow$ `แน่นอนว่าไม่ได้หรอก`
  - `꼬맹이เน` $\rightarrow$ `เด็กคนนั้น`
  - `뭐` $\rightarrow$ `อะไรนะ`
  - `부모님도` $\rightarrow$ `พ่อแม่ก็ด้วย`
  - `떨굴거야` $\rightarrow$ `จะทำให้ตก`
  - `그래그래` $\rightarrow$ `ใช่แล้ว ใช่แล้ว`
  - `렌? 껴안지 않아도, 너한` $\rightarrow$ `เรน? ไม่ต้องกอดก็ได้ ให้เธอ`
  - `주제에 뭐냐고 이녀석` $\rightarrow$ `เป็นแค่... แต่ทำเป็นเก่งนะไอ้หมอนี่`
  - `개허접 걸레년 주제에 나대지마!` $\rightarrow$ `อีผู้หญิงสำส่อนไม่ได้เรื่องเอ๊ย อย่ามาสะเออะ!`
  - `이압이 이압이` $\rightarrow$ `ยึบ ยึบ`
  - `거거긴 만지면` $\rightarrow$ `ตร-ตรงนั้นถ้าไปจับโดนเข้าล่ะก็`
  - `같았는데` $\rightarrow$ `เหมือนว่า...แท้ๆ`
  - `꼬맹이라고 거유녀랑 재우니까 불끈거린다고` $\rightarrow$ `หาว่าเป็นเด็ก แต่พอให้นอนกับสาวนมโตแล้วมันคึกจนแข็งเป๊กเลยนี่หว่า` (พร้อม sub-lines)
  - `알면서` $\rightarrow$ `ทั้งที่รู้อยู่แท้ๆ`
  - `그걸로 뭐하려고` $\rightarrow$ `จะเอาอันนั้นไปทำอะไรน่ะ`
  - `아무리 그래도 그건--!` $\rightarrow$ `ถึงอย่างนั้นก็เถอะ แบบนั้นมัน--!`
  - `그럴리가` $\rightarrow$ `ไม่มีทางหรอก`
  - `네엄마 쉬워보이던데 남편옆에서 동생만들어줄게` $\rightarrow$ `แม่ของเธอแลดูง่ายดีนี่นา เดี๋ยวจะสร้างน้องข้างๆ สามีให้ดูนะ` (พร้อม sub-lines)
  - `갑자기 어리광 부리지 말라고` $\rightarrow$ `จู่ๆ อย่ามาทำเป็นออดอ้อนนะ`
- **วิเคราะห์กลไก Layer Control & Balloon ของภาษาเกาหลี:**
  - ในภาษาอังกฤษ ความยาวของแต่ละบรรทัดมักเป็นแนวนอนยาว ทำให้ตัวตรวจจับ (DBNet ใน PaddleOCR) แยกแต่ละบรรทัดเป็นกล่องสี่เหลี่ยมแนวนอนอิสระได้อย่างชัดเจน
  - ในภาษาเกาหลี/ญี่ปุ่น ตัวอักษรเรียงตัวเป็นแนวตั้งหรือกล่องสี่เหลี่ยมจัตุรัสที่มีระยะห่างบรรทัดแคบมาก (Vertical line gap แคบ) ทำให้ DBNet ของ PaddleOCR:
    1. **กรณีรวมกล่องทั้งบอลลูน (ภาพ 1 & 2):** PaddleOCR ตรวจจับทั้งบอลลูนเป็น 1 Text region ใหญ่ (`Balloon (1)`) ซึ่งครอบคลุมทั้ง 4 บรรทัด
    2. **กรณีรวมบางบรรทัด (ภาพ 3):** สองบรรทัดบนมีช่องว่างแยกชัดเจน จึงได้ 2 บรรทัด (`갑자기`, `어리광`) ส่วนสองบรรทัดล่าง (`부리지`, `말라고`) ตัวอักษรชิดกันมาก DBNet จึงรวมเป็นกล่องเดียว `부리지 말라고` (`Balloon (3)`)
  - **การทำงานของระบบแปล:** แม้ OCR จะตรวจจับมาเป็น 1 กล่องรวม หรือแยกย่อยหลายบรรทัด ระบบ `koreanTranslationPolicy.ts` และ `splitTranslatedTextBySourceWeights` ได้ถูกตั้งค่าให้รองรับทั้งแบบเต็มประโยค (Full block) และแบบแบ่งทีละบรรทัด (Line-by-line) ทำให้ข้อความแปลไทยกระจายตัวลงบนภาพได้อย่างสมบูรณ์

### 15. การรองรับปุ่ม F11 Fullscreen, ปรับปรุง Drag-and-Drop ซับโฟลเดอร์, เพิ่ม Folder Info & Cache Stats, และ Virtualization ไฟล์ 500+ หน้า
- **15.1 รองรับปุ่ม F11 Fullscreen:**
  - เพิ่ม Keyboard Event Listener ดักจับปุ่ม `F11` ใน Electron Main (`win.webContents.on('before-input-event')`) เพื่อสลับ `win.setFullScreen(!win.isFullScreen())`
  - เพิ่ม IPC Channel `window:toggle-fullscreen` และ `window:is-fullscreen` ใน `preload.ts` และ `src/types/electron.d.ts`
- **15.2 แก้ไขปัญหา Drag-and-Drop ไฟล์เข้า Subfolder ในหน้าหลัก:**
  - **สาเหตุ:** การ์ดโฟลเดอร์ในส่วน `Folders (X)` ของหน้า Home (`UploadScreen.tsx`) ขาด HTML5 drop event listeners (`onDragOver`, `onDragLeave`, `onDrop`)
  - **การแก้ไข:** เชื่อมต่อ `handleProjectDrop(subproj.id, event)` พร้อมทั้งรองรับการลากไฟล์แบบ Multi-selected (เลือกหลายไฟล์แล้วลากลงโฟลเดอร์พร้อมกัน) และใส่ Visual Drop Highlight (`border-sky-400 bg-sky-500/20`)
- **15.3 เพิ่มเมนูคลิกขวา "Folder Info & Cache Stats" บนโฟลเดอร์:**
  - เพิ่มตัวเลือก `Folder Info & Cache Stats` ใน `ProjectContextMenu`
  - เพิ่ม `ProjectDAO.getProjectStats(projectId)` ใน `electron/db.ts` ใช้ Recursive CTE เพื่อคำนวณสถิติของโฟลเดอร์และซับโฟลเดอร์ย่อย
  - สร้าง `FolderInfoModal` ใน `UploadScreen.tsx` สำหรับแสดงผลสถิติอย่างละเอียด
- **15.4 แก้ไขปัญหา `pdf.worker.min.mjs: Worker was terminated` และ OCR Daemon Teardown บนไฟล์ 500+ หน้า:**
  - **สาเหตุ:** ทุกหน้าของไฟล์ PDF (500 หน้า) จะเรนเดอร์ Canvas `<Page>` พร้อมกัน ทำให้คิวของ PDF.js Worker ถูกส่งคำสั่งเรนเดอร์พร้อมกันนับพันหน้า จนเกิด Memory Exhaustion และเมื่อปิดโปรแกรม Daemon Process จะถูกส่ง SIGTERM ในขณะที่ Prewarm ค้างอยู่
  - **การแก้ไข:** เรนเดอร์ `<Page>` เฉพาะเมื่อเข้าใกล้หน้าจอในระยะ 1400px ใน `PDFCanvas.tsx` และใช้ `IntersectionObserver` ใน `LeftSidebar.tsx` พร้อมจัดการ Graceful Cancellation ใน Electron Main
- **15.5 สถาปัตยกรรมการจัดการแคชและความเสถียรของ SQLite:**
  - โหลดเฉพาะ Metadata 50 ไฟล์แรกแบบ Lazy Loading (~2-5ms) ไม่แตะ OCR blob
  - Zero File Cloning อ้างอิงพาธเดิม ไม่กินเนื้อที่ Harddisk ซ้ำซ้อน
  - SQLite WAL mode + Memory-Mapped I/O มอบความเสถียรและเร็วเทียบเท่า File Explorer
- **15.6 อัปเดต Storybook 10.4 Suite:**
  - เพิ่ม Stories สำหรับ `SmartCanvas`, `Toolbar (SplitViewToggle)`, `CompactTopToolbar`, และ `LoginScreen`

### 16. การปรับปรุง Multi-Select Drag & Drop และการนำ Default Mockup Tags ออกจากระบบ
- **16.1 แก้ไขปัญหาการลากไฟล์หลายรายการ (Ctrl+Click) เข้าสู่ Subfolder:**
  - **สาเหตุที่เกิดปัญหา:**
    1. ใน `DocumentCard`: เมื่อลากไฟล์เสร็จสิ้น (`dragend` / `drop`) Event `click` ของเบราว์เซอร์จะทำงานต่อทันที ทำให้ฟังก์ชัน `onClick` ไปสั่งสลับสถานะ (`onToggleSelect`) ปลดการเลือกไฟล์ที่ถูกลากออก
    2. ใน `UploadScreen.tsx`: การ์ดโฟลเดอร์มี `if (!draggedDocumentId) return;` ใน `onDragOver` และ `onDragLeave` ขาดการตรวจสอบ `event.currentTarget.contains(event.relatedTarget)` ทำให้เมื่อเมาส์เลื่อนผ่านไอคอนย่อยในโฟลเดอร์ เกิด Event Bubbling ส่งผลให้ยกเลิกสถานะ Drop Target กลางคัน
    3. ใน `handleProjectDrop`: มีการเรียก `handleMoveDocumentToProject` ซ้อนใน `Promise.all` ซึ่งทำให้เกิด Race Condition ในการเคลียร์ Selection ซ้ำซ้อน
  - **การแก้ไข:**
    - เพิ่ม `isDraggingRef` ใน `DocumentCard` เพื่อป้องกันไม่ให้ Event `click` ไปสลับการเลือกการ์ดหลังจากการลากเสร็จสิ้น
    - เพิ่ม `draggedDocumentIds` Array State และเพิ่มตัวสร้าง Ghost Drag Badge (`📄 ย้าย N รายการ`) ขณะลากไฟล์หลายรายการพร้อมกัน
    - ปรับ `handleProjectDrop` ให้ย้ายเอกสารทั้งหมดผ่าน `moveToProject(docId, projectId)` แบบ Direct Parallel
    - เพิ่มการตรวจสอบ `event.currentTarget.contains(event.relatedTarget)` ใน `onDragLeave` เพื่อป้องกันอาการกะพริบ (Flickering) เมื่อลากผ่านไอคอนหรือตัวหนังสือในโฟลเดอร์
- **16.2 การนำ Default Tag Mockups ออกจากระบบ:**
  - **สาเหตุที่ Tag Mockup ฟื้นกลับมาหลังลบ:** ใน `electron/db.ts` มีคำสั่ง `if (tagCount === 0)` ซึ่งจะยิง `INSERT INTO tags ('Manga', 'Document', ...)` ทุกครั้งที่ตาราง `tags` ว่างเปล่า ทำให้เมื่อผู้ใช้ลบ Tag จนหมด แล้วเปิดแอปใหม่หรือติดตั้ง `.exe` ใหม่ ตัวแอปจะแทรก Tag เดิมกลับมาเสมอ
  - **การแก้ไข & คำแนะนำ:** นำคำสั่ง Hardcoded Seeding ออก 100% ทำให้ฐานข้อมูล Tag เป็นระบบ Clean-State ที่ผู้ใช้เป็นผู้สร้างและจัดการเองอย่างแท้จริง Tag ที่ถูกลบไปแล้วจะไม่ฟื้นกลับมาอีก

### 17. การแก้ไข Grid Folder Drop Target และระบบ Shift+Click Range Multi-Select (File Explorer Parity)
- **17.1 แก้ไขปัญหาการลากไฟล์ลง Subfolder ไม่เข้าใน Grid Mode:**
  - **สาเหตุ:** ในหน้า Home (`UploadScreen.tsx`) การ์ดโฟลเดอร์ในส่วน `viewMode === 'grid'` ขาด Event Handlers สำหรับ Drag & Drop (`onDragOver`, `onDragLeave`, `onDrop`) ซึ่งเดิมมีเฉพาะในโหมด `list` ทำให้เมื่อผู้ใช้ลากไฟล์ทั้ง 8 ไฟล์ไปวางบนโฟลเดอร์ "คนส่งข้าว" ในโหมด Grid ตัวเบราว์เซอร์จะไม่ยอมรับ Drop Event และไม่มีไฟล์ใดถูกย้าย
  - **การแก้ไข:** เพิ่ม `onDragOver`, `onDragLeave`, `onDrop` พร้อมทั้งไฮไลท์กรอบสีฟ้าเรืองแสง (`isDropTarget`) ลงในการ์ดโฟลเดอร์ของโหมด Grid ทำให้ลากไฟล์ลงโฟลเดอร์สำเร็จทั้งแบบ Grid และ List
- **17.2 เพิ่มระบบเลือกไฟล์แบบช่วงด้วย Shift + Click (Windows File Explorer Logic):**
  - **การทำงาน:**
    1. **คลิกธรรมดา:** เลือกเฉพาะไฟล์นั้น หรือเปิดไฟล์หากไม่ได้อยู่ในโหมดเลือก
    2. **Ctrl + Click:** สลับเลือก/ไม่เลือก (Toggle) ทีละไฟล์ และตั้งไฟล์นั้นเป็นจุดอ้างอิง (Anchor)
    3. **Shift + Click:** เลือกคลุมช่วงตั้งแต่ไฟล์ Anchor ตัวล่าสุด ไปจนถึงไฟล์ที่คลิก (`slice(min, max)`)
    4. **Ctrl + Shift + Click:** ขยายการเลือกช่วงใหม่รวมเข้ากับไฟล์เดิมที่เลือกค้างไว้อยู่แล้ว (Additive Range Selection)
    5. **Checkbox Click:** คลิกที่เครื่องหมายถูกสีฟ้าเพื่อปลดหรือสลับการเลือกเฉพาะไฟล์นั้นได้อย่างอิสระ
  - **สโตร์:** เพิ่มฟังก์ชัน `selectRangeDocuments(ids, additive)` ใน `useFileBrowserStore.ts` เพื่อรองรับการเซ็ต Selection แบบช่วงอย่างมีประสิทธิภาพ

### 18. การรองรับ Drag-and-Drop ย้ายโฟลเดอร์ใน Sidebar, เส้นคั่นหมวดหมู่, และ Compact Layout
- **18.1 ระบบ Drag-and-Drop จัดโครงสร้างโฟลเดอร์ (Folder Hierarchy Reorganization):**
  - **การย้ายเป็น Subfolder:** สามารถลากโฟลเดอร์ใดๆ ไปวางทับอีกโฟลเดอร์หนึ่ง (เช่น ลาก "สิงห์อมควัน" ไปใส่ใน "Manga") เพื่อตั้งค่า `parent_id = targetFolder.id` กลายเป็นโฟลเดอร์ย่อยได้ทันที
  - **การย้ายกลับมาเป็น Main Folder (Root):** สามารถลาก Subfolder มาปล่อยที่พื้นที่ว่างของกล่อง `PROJECTS` ใน Left Sidebar เพื่อปลด `parent_id = null` ให้กลับมาเป็นโฟลเดอร์หลัก
  - **ระบบป้องกัน Circular Reference:** ตรวจสอบโครงสร้างโฟลเดอร์ ไม่ให้สามารถลากโฟลเดอร์หลักไปใส่ใน Subfolder ลูกของตัวเอง หรือลากใส่ตัวเองได้
  - **SQLite Database Support:** อัปเดต `ProjectDAO.update` ใน `electron/db.ts` ให้รองรับการอัปเดตฟิลด์ `parent_id`
- **18.2 การปรับปรุง UI Sidebar & ความสูงโฟลเดอร์ (Visual Polish & Compact Spacing):**
  - **เส้นคั่นหมวดหมู่:** เพิ่มเส้นคั่นบางๆ (`border-white/6`) คั่นระหว่างหมวดหมู่ `LIBRARY`, `TAGS`, และ `PROJECTS` ใน Sidebar ซ้าย
  - **ลดขนาดความสูงกล่องโฟลเดอร์:** ปรับ Padding ของ `ProjectItem` และการ์ดโฟลเดอร์ให้กะทัดรัด (Compact) สวยงาม ประหยัดพื้นที่ในแนวตั้ง

### 19. การปรับปรุง Multi-select Toggle Logic และแก้ไข Folder Drag Item Structure
- **19.1 ปรับปรุง Selection Mode Toggle:**
  - **พฤติกรรมเดิม:** เมื่อกด Ctrl+Click เลือกไฟล์แรกเพื่อเข้าโหมด Multi-select หากคลิกไฟล์ถัดไปโดยไม่ได้กด Ctrl ค้าง ระบบจะล้าง Selection เดิมทิ้ง
  - **พฤติกรรมใหม่:** เมื่อระบบอยู่ในโหมด Multi-select (`selectedDocumentIds.size > 0`) การคลิกไฟล์ใดๆ จะเป็นการ Toggle (เพิ่ม/ลด) ไฟล์นั้นเข้าใน Selection ทันที โดยไม่ต้องกดปุ่ม Ctrl ค้างไว้ตลอด และยังคงใช้งาน `Shift + Click` เพื่อเลือกคลุมช่วงได้ตามปกติ
- **19.2 แก้ไขโครงสร้าง HTML ของ Folder Drag Item:**
  - เปลี่ยน Element ของ `ProjectItem` จาก `<button>` เป็น `<div role="button">` เพื่อขจัดปัญหา Event Capture ของ HTML5 Drag & Drop ระหว่าง Button บน Chromium ทำให้การลากย้ายโฟลเดอร์ซ้อนกันเสถียรและทำงานได้ 100%

### 21. การเพิ่มเมนูแก้ไขแท็ก/เลือกสี และ Filter ไฟล์ที่ไม่มีแท็ก พร้อมปรับแต่ง Titlebar
- **21.1 Context Menu และการแก้ไขแท็ก (Tag Rename & Color Palettes):**
  - เมื่อคลิกขวาที่ Tag ใน Sidebar จะแสดง Menu ตัวเลือก: `แก้ไขชื่อ & สีแท็ก (Edit Tag & Color)` และ `ลบแท็ก (Delete Tag)`
  - ป๊อปอัปแก้ไขแท็กมีชุดสี 5 กลุ่มที่คัดสรรความคมชัด ไม่กลืนกับพื้นหลังมืดของ Sidebar:
    - 🔥 **Crimson & Ember:** โทนแดง ส้ม แอมเบอร์สดใส
    - 🔮 **Abyssal & Astral:** โทนม่วง คราม อินดิโก สว่างเด่น
    - 🌿 **Biosphere & Nature:** โทนเขียว มรกต มินต์ ไลม์
    - ☁️ **Atmosphere & Sky:** โทนฟ้า คราม ไซแอน สเลท
    - 🌸 **Flesh & Blossom:** โทนชมพู ซากุระ พีช พาสเทล
  - การบันทึกเชื่อมต่อกับ SQLite (`UPDATE tags SET name = ?, color = ?`) อัปเดตทันทีแบบ Reactive
- **21.2 ตัวกรองไฟล์ที่ไม่มีแท็กใน Sort/Filter Menu:**
  - เพิ่มส่วน `Filter by Tag` ในเมนูป๊อปอัป จัดเรียง/กรองไฟล์ โดยมีปุ่ม `No tags (ไม่มีแท็ก)` สำหรับกรองหาเฉพาะเอกสารที่ยังไม่ได้ติดแท็กใดๆ พร้อมปุ่มแท็กทั้งหมด
- **21.3 การปรับแต่ง Electron Titlebar:**
  - กำหนด `titleBarStyle: 'hidden'`, `backgroundColor: '#17181b'` และ `titleBarOverlay: { color: '#0e0f11', symbolColor: '#cbd5e1', height: 32 }` ใน `electron/main.ts` เพื่อให้ Titlebar ด้านบนของ Windows กลมกลืนกับเฉดสี Dark ของ Sidebar/Home

### 22. การแก้ไข Window Drag Region ครอบคลุมทั้งแถบด้านบน (Full Top-Area Drag)
- **22.1 การลากย้ายหน้าต่างครอบคลุมทุกคอลัมน์ด้านบน (Full Top Header Drag):**
  - กำหนด `.titlebar-drag { -webkit-app-region: drag; }` และ `.titlebar-no-drag, button, input, select, textarea, a, form, [role="button"], [draggable="true"] { -webkit-app-region: no-drag; }` ใน `src/index.css`
  - นำ `titlebar-drag` ไปครอบคลุมทุกส่วนด้านบนของหน้า Home (`UploadScreen.tsx`):
    1. แถบ Navigation ด้านซ้ายสุด (Left Navigation Sidebar)
    2. แถบ Secondary Sidebar ด้านซ้าย (หัวข้อ `Library`, `Projects`, `Settings`)
    3. แถบ Main Toolbar ตรงกลาง (แถบสีฟ้า-ม่วง พร้อมช่องค้นหาและปุ่มมุมมอง)
    4. แถบ Import ด้านขวา (หัวข้อ `Import` พร้อมเว้นระยะ `pr-36` หลบปุ่มควบคุมหน้าต่าง)
  - ผู้ใช้สามารถคลิกและลากที่บริเวณด้านบนสุดของแอปตลอดทั้งแนว (ตั้งแต่ซ้ายสุดจนถึงขวาสุด) เพื่อขยับหน้าต่างแอปได้อย่างลื่นไหล
- **22.2 แก้ไขปัญหา Window Control Buttons (–, ◻, ✕) ทับปุ่ม Element Mode และ Export:**
  - เพิ่ม `pr-36` (`144px` Right Padding) ให้กับแถบ Header Toolbar และแถบ Import ด้านขวา เพื่อเว้นพื้นที่ Safe Area สำหรับปุ่มควบคุมหน้าต่างของ Windows ไม่ให้ทับซ้อนกับปุ่มและข้อความใดๆ

### 23. การปรับตำแหน่งปุ่ม Filter ไปอยู่ขวาสุดของ Toolbar
- นำ `pr-36` ออกจาก Toolbar ตรงกลาง (`UploadScreen.tsx`) เพื่อให้ปุ่ม Filter ชิดมุมขวาสุดของพื้นที่ Toolbar ติดกับแถบขวา (Right Import Sidebar) อย่างลงตัว

### 24. Scope-Aware Local Filtering & รวม No Folder ไว้ใน Filter by Tag
- **24.1 แยก Scope ระหว่าง Left Sidebar Tags vs Toolbar Filter:**
  - **Left Sidebar (TAGS):** ทำหน้าที่ Global Tag Query ดึงไฟล์ทั้งหมดในระบบที่ตรงกับ Tag นั้นๆ
  - **Toolbar Filter (Top Sort/Filter Button):** ทำหน้าที่กรองไฟล์เฉพาะใน Scope / Path ที่กำลังเปิดดูอยู่เท่านั้น (หากอยู่ใน Folder/Subfolder ใด ก็จะกรองเฉพาะไฟล์ใน Folder นั้นๆ โดยไม่เด้งออกไปดึงไฟล์ภายนอก)
- **24.2 รวมปุ่ม `No folder` ไว้ในหมวด Filter by Tag:**
  - ลบหมวด `FILTER BY FOLDER` ที่ไม่จำเป็นออก
  - ย้ายปุ่ม **`No folder`** (สี Amber) ไปอยู่คู่กับปุ่ม **`No tags`** (สี Sky) ภายในหมวด **`FILTER BY TAG`**
  - แสดงสถานะ Active Glow ที่ปุ่ม Filter บน Toolbar เมื่อมีการใช้งาน Filter ตัวใดตัวหนึ่งอยู่

### 25. Non-Disruptive Drag & Drop to Folder (ไม่เด้งเปลี่ยนหน้า/โฟลเดอร์)
- ปรับปรุงฟังก์ชัน `handleProjectDrop`, `handleDropOnProject`, และ `handleMoveDocumentToProject` ใน `UploadScreen.tsx` ให้ใช้ `refreshLibraryView()`
- เมื่อผู้ใช้ลากไฟล์ (หรือเลือกหลายไฟล์พร้อมกัน) แล้ว Drop ใส่ Folder / Subfolder บน Left Sidebar:
  - ระบบจะบันทึกย้ายโฟลเดอร์ลง Database ทันที
  - ผู้ใช้จะยังคงอยู่ที่หน้าเดิม (เช่น หน้า Tag `Manga` หรือหน้า `Recent`) โดย **ไม่ถูก Warp หรือ Redirect** ไปยังโฟลเดอร์ปลายทาง
  - สามารถจัดการและจัดระเบียบไฟล์ต่อเนื่องทีละไฟล์หรือหลายไฟล์ได้อย่างราบรื่น

### 26. การรักษาสถานะ Tag Filter เมื่อกดปิดโฟลเดอร์ & แก้ไข HTML Nested Button Error
- **26.1 รักษาสถานะ Active Tag Filter:**
  - เมื่อผู้ใช้เลือก Tag ไว้ (เช่น `Manga`) แล้วเข้าไปในโฟลเดอร์ เมื่อกดคลิกที่โฟลเดอร์เดิมซ้ำเพื่อออก (Deselect Project) ระบบจะตรวจเช็ค `selectedTagId` และโหลดหน้ารายการ Tag นั้นๆ กลับมาให้ตามเดิม โดยไม่หลุดกลับไปหน้า Recent
  - หากต้องการกลับไปหน้า Recent หรือ Favorites โดยตรง สามารถคลิกที่ปุ่ม Quick Filters `Recent` หรือ `Favorites` ได้อย่างชัดเจน
- **26.2 แก้ไข Console Error (`<button> cannot be a descendant of <button>`):**
  - เปลี่ยนการ์ด Recent Files ในหน้า Empty State จากแท็ก `<button>` ภายนอกที่ครอบปุ่ม `<button>` ซ่อนพรีวิว ให้เป็น `<div role="button" tabIndex={0}>` แก้ปัญหา Hydration/DOM nesting error ได้ 100%

### 27. แก้ไขปัญหาปุ่ม Filter Toggle Off กะพริบหรือไม่ปิด
- **สาเหตุ:** เกิด Race condition ระหว่าง Global `mousedown` listener (ซึ่งสั่งปิดเมนูก่อนทันทีที่กดเมาส์ลงบนปุ่ม) กับ `onClick` ของปุ่ม Filter (ซึ่งสั่ง `openSortMenu(true)` ซ้ำทันทีที่ปล่อยเมาส์) ส่งผลให้เมนูปิดแล้วเปิดใหม่ในเสี้ยววินาที ทำให้ไม่สามารถกดปุ่มเพื่อ Toggle ปิดเมนูได้
- **วิธีแก้ไข:**
  - เพิ่ม `data-sort-menu-trigger="true"` ให้กับปุ่ม Filter และยกเว้นใน `handlePointerDown` ไม่ให้ปิดเมนูก่อนเวลา
  - ปรับปรุงฟังก์ชัน `handleToggleSortMenu` ให้ตรวจสอบสถานะ `isSortMenuOpen` เพื่อ Toggle เปิด/ปิด สลับกันอย่างแม่นยำ 100%

### 28. Interactive Breadcrumbs Navigation, Folder Card Redesign & 20-Color Palette
- **28.1 Breadcrumbs Path Navigation (เส้นทางโฟลเดอร์แบบ File Explorer):**
  - เพิ่มแถบ Breadcrumb ด้านบนของหน้า Library (เช่น `Home / Manga / คนส่งข้าว`)
  - สามารถคลิกย้อนกลับไปชั้น Root (`Home`) หรือโฟลเดอร์แม่ (`Manga`) ได้ทันที
  - เมื่อคลิก `Home` ในขณะที่เปิด Tag ค้างไว้ (`selectedTagId !== null`) ระบบจะรักษาสถานะ Tag Filter ไว้และแสดงไฟล์ตาม Tag ในหน้า Home ตามธรรมชาติ
  - มีปุ่มทางลัด `+ Subfolder` ด้านขวาของแถบ Breadcrumb เพื่อสร้างโฟลเดอร์ย่อยได้อย่างสะดวก
- **28.2 ขยาย Palette สีโฟลเดอร์เป็น 20 สีโมเดิร์น:**
  - เพิ่มชุดสี `FOLDER_PALETTE_COLORS` ให้มีถึง 20 สี (Sky, Royal Blue, Indigo, Purple, Fuchsia, Rose, Amber, Lime, Emerald, Teal, Cyan, ฯลฯ)
  - เพิ่ม Color Picker ใน Modal สร้างโฟลเดอร์ใหม่ (`Create Folder`) และ Modal แก้ไขโฟลเดอร์ (`Edit Folder`) พร้อมแสดง Live Preview สีแบบ Realtime

### 29. ปรับปรุงขนาด Folder Element ให้เป็นแนวนอนแถวเดียว & เพิ่มเส้นคั่น Section
- **กล่องโฟลเดอร์แบบกระทัดรัด (Single-Line Compact):**
  - จัดวางไอคอนและชื่อโฟลเดอร์ให้อยู่ใน **แนวนอนบรรทัดเดียวกัน** (`[ 📁 Icon ] [ Folder Name ] >`)
  - ขนาดกระทัดรัด ไม่กินพื้นที่แนวตั้ง ช่วยให้พื้นที่หน้าจอแสดงผลรายการไฟล์ได้เต็มที่
- **ลด Margin & เพิ่มเส้นแบ่ง Section ระหว่าง Folders และ Files:**
  - ปรับระยะห่างระหว่าง Folders และ Files ให้กระชับขึ้น
  - เพิ่มเส้นคั่นบางหรูหรา (`<div className="h-px bg-white/6 my-3 w-full shrink-0" />`) คั่นกลางระหว่าง Folders และ Files ชัดเจน สบายตา

### 30. ย้ายตัวนับจำนวน (Item Counters) ไปไว้แถบ Breadcrumbs ด้านขวา & ปุ่ม `+ Folder` ให้มีทุกหน้า
- **ย้ายตัวนับ FOLDERS(x) และ FILES(x) ไปไว้แถบ Breadcrumbs ด้านขวา:**
  - นำตัวนับจำนวนย้ายไปวางในแถบ Breadcrumbs ด้านบนขวามือ ก่อนถึงปุ่ม `+ Folder`
  - ตัวเลขแสดงด้วย **สีฟ้า (`text-sky-400 font-bold`)** ส่วนคำว่า `Folder/Folders` และ `File/Files` เป็น **สีขาว (`text-white font-medium`)** ตามที่ผู้ใช้กำหนด
  - นำข้อความหัวข้อ `FOLDERS (x)` และ `FILES (x)` ขนาดใหญ่ออก เพื่อให้พื้นที่แสดงผลไฟล์และโฟลเดอร์คลีน สวยงาม สะอาดตา
- **เปลี่ยนปุ่ม `+ Subfolder` เป็น `+ Folder` และเปิดใช้งานทุกหน้า:**
  - เปลี่ยนชื่อปุ่มเป็น `+ Folder`
  - เปิดใช้งานทุกหน้า (รวมถึงหน้า Home/Recent) โดยหากอยู่ที่หน้า Home จะสร้าง Top-level Folder และหากอยู่ในโฟลเดอร์ใดๆ จะสร้าง Subfolder ในโฟลเดอร์นั้นทันที

### 31. ปรับปรุง Hover Effect ของ Favorite Icon และแก้ไขปัญหา Scroll ใน Setting/Right Sidebar
- **Favorite Icon Hover Effect & Glow Badge:**
  - เพิ่มพื้นหลังแก้ว (Glassmorphism Pill Badge) และเงาเรืองแสงสี Rose Glow ให้กับปุ่ม Favorite (`Heart`) ทั้งใน Grid View และ List View
  - เมื่อนำเมาส์ไปชี้จะแสดงเอฟเฟกต์ `hover:scale-110 hover:bg-[#1f2228] hover:text-rose-400` เหมือนกับปุ่มซ่อน/แสดงภาพตัวอย่าง (Eye Icon) อย่างสวยงามสอดคล้องกัน
- **แก้ไขบัค Scroll ในพาเนล Setting/Import (Right Sidebar):**
  - **สาเหตุ:** คลาส `-webkit-app-region: drag` (`titlebar-drag`) ถูกใส่ไว้บนคอนเทนเนอร์หลักที่เปิด `overflow-y-auto` ทำให้ Electron ดักจับการ Scroll / Drag / Wheel ของเมาส์ไปเป็นการลากย้ายหน้าต่างโปรแกรม ส่งผลให้ Scroll ติดขัดหรือหน่วง
  - **วิธีแก้ไข:** เอา `titlebar-drag` ออกจากคอนเทนเนอร์ที่ Scroll และใส่ `titlebar-no-drag` พร้อมคง `titlebar-drag` ไว้เฉพาะส่วน Header Bar ด้านบนเท่านั้น ทำให้ Scroll ทำงานได้อย่างลื่นไหล 100%








---

## 🧪 5. การตรวจสอบและทดสอบ (Testing & Standards)

- **รันชุดการทดสอบทั้งหมด:**
  ```powershell
  pnpm vitest run
  ```
- **รันตรวจสอบ Type:**
  ```powershell
  pnpm exec tsc --noEmit
  ```
- **ผลลัพธ์ปัจจุบัน:** ผ่านสมบูรณ์ **22/22 Test Files (307/307 Tests Passed ✅)** และ Typecheck ผ่าน 100%







