# PDF Translator - Project Context & Architecture Reference

> **อัปเดตล่าสุด:** สิงหาคม 2026  
> **สถานะการทดสอบ:** Vitest 39/39 Test Files ผ่านทั้งหมด (355/355 Tests Passed 100% ✅)  
> **TypeScript Strict Check:** `pnpm exec tsc --noEmit` 0 Errors (Exit Code 0 ✅)

---

## 📌 1. ภาพรวมโปรเจกต์ (Project Overview)

**PDF Translator** คือแอปพลิเคชัน Desktop ประสิทธิภาพสูงสำหรับแปลเอกสาร PDF, มังงะ, มังฮวา, นิยาย และรูปภาพ ด้วยเทคโนโลยี AI/OCR แบบออฟไลน์และออนไลน์:
- **Frontend:** React 18 + Strict TypeScript + Vite + TailwindCSS + Zustand + React.memo
- **Desktop Host:** Electron (Context Isolation, Secure IPC, Native File System, SQLite Native Bridge)
- **Database:** SQLite (`better-sqlite3`) พร้อมโหมด WAL (Write-Ahead Logging), FTS5 Full-Text Search และ Memory-Mapped I/O
- **OCR Engine (Python Sidecar):** PaddleOCR, EasyOCR, Manga-OCR (รองรับ DirectML เร่งความเร็วบน AMD/Intel/NVIDIA GPUs)
- **Translation Engine:** Argos Translate (NMT ออฟไลน์ผ่าน CTranslate2) และ Google Gemini API (คลาวด์)
- **Export Engine:** High-Fidelity Hidden Window Print PDF Export + Scalable Vector Text Layer

---

## 🏛️ 2. สถาปัตยกรรมระบบและ Data Flow (System Architecture)

```mermaid
flowchart TD
    User([ผู้ใช้]) --> UI[React UI / UploadScreen / Workspace Editor]
    
    subgraph FrontendState [Zustand State Stores & Granular Selectors]
        ProjectStore[useProjectStore\n(Active Doc, Page, Lang, Profile)]
        OCRStore[useOCRTextLayerStore\n(OCR Cache, Text Boxes, Search)]
        LayerStore[useLayerStore\n(Interactive Text Layers, Groups)]
        QueueStore[useBackgroundQueueStore\n(Batch Jobs & Sync)]
        UIStore[useUIStore\n(Zoom, Pan, Split View, Active Tool)]
    end

    subgraph Orchestrator [App Coordinator & Custom Hooks]
        DocTranslationHook[useDocumentTranslation\n(Single Page & Batch AI/Offline)]
        ExportModalHook[useDocumentExportModalState\n(Scope, Quality & Quick Translate)]
        QueueSyncHook[useBackgroundQueueSync\n(FIFO Delegation & Lock Sync)]
    end

    subgraph DesktopHost [Electron Main Process - Domain IPC Handlers]
        IPC_OCR[ipc/ocr.ts]
        IPC_DB[ipc/database.ts]
        IPC_Translation[ipc/translation.ts]
        IPC_Export[ipc/export.ts]
        DB[(SQLite Database\npdf_translator.db)]
    end

    subgraph Sidecar [Python Sidecar Engines]
        Paddle[PaddleOCR / EasyOCR / MangaOCR]
        Argos[Argos Translate Engine - CTranslate2]
    end

    UI --> FrontendState
    FrontendState <--> Orchestrator
    Orchestrator <--> DesktopHost
    DesktopHost <--> DB
    DesktopHost <--> Sidecar
```

---

## 📂 3. โครงสร้างโฟลเดอร์หลักหลัง Refactoring (Key Directories & File Map)

### 3.1 Frontend (`src/`)
- [`src/App.tsx`](file:///c:/App/Electron/PDF_Translator/src/App.tsx): **Clean Orchestrator Shell (535 บรรทัด / ลดลง 86.2%)** ประสานงานระหว่าง Hooks, Stores และ Layouts
- [`src/hooks/`](file:///c:/App/Electron/PDF_Translator/src/hooks/):
  - [`useDocumentTranslation.ts`](file:///c:/App/Electron/PDF_Translator/src/hooks/useDocumentTranslation.ts): จัดการ Pipeline การแปล Single-page และ Batch (AI / Offline)
  - [`useDocumentExportModalState.ts`](file:///c:/App/Electron/PDF_Translator/src/hooks/useDocumentExportModalState.ts): จัดการ State และการคำนวณ Scope/Time ในกล่อง Export
  - [`useBackgroundQueueSync.ts`](file:///c:/App/Electron/PDF_Translator/src/hooks/useBackgroundQueueSync.ts): ซิงค์คิวงานพื้นหลัง, Lock Sync และ Delegate เมื่อสลับหน้า
  - [`useExportOrchestration.ts`](file:///c:/App/Electron/PDF_Translator/src/hooks/useExportOrchestration.ts): ประสานงานการส่งออกไฟล์ PDF/Image
  - [`useExportCacheHydration.ts`](file:///c:/App/Electron/PDF_Translator/src/hooks/useExportCacheHydration.ts): โหลด OCR/Translation Cache เข้าสู่แคชสำหรับการ Export
  - [`useExportOcrResolvers.ts`](file:///c:/App/Electron/PDF_Translator/src/hooks/useExportOcrResolvers.ts): คำนวณ Bounding Box และ Overlay Size
  - [`useSyncScroll.ts`](file:///c:/App/Electron/PDF_Translator/src/hooks/useSyncScroll.ts): ซิงค์การเลื่อนหน้าจอระหว่าง Original และ Translated ในโหมด Split View
- [`src/components/`](file:///c:/App/Electron/PDF_Translator/src/components/):
  - **Layout & Toolbars:**
    - [`Layout/AppHeaderToolbar.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Layout/AppHeaderToolbar.tsx): Titlebar ด้านบนสไตล์ Google Docs พร้อมระบบควบคุมฟอนต์และ OCR Profiles (`React.memo`)
    - [`Layout/CompactTopToolbar.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Layout/CompactTopToolbar.tsx): แถบควบคุมภาษาและปุ่มแปลด่วน
    - [`Layout/LeftSidebar.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Layout/LeftSidebar.tsx): แถบ Thumbnail Gallery, Pages List และ Layer Control
    - [`Layout/RightSidebar.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Layout/RightSidebar.tsx): แถบตั้งค่า OCR, Engine และพจนานุกรม
  - **Queue & Modals:**
    - [`Queue/BackgroundQueueBadge.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Queue/BackgroundQueueBadge.tsx): Floating Queue Pill แสดงสถานะคิวขณะอยู่ในหน้า Preview (`React.memo`)
    - [`Queue/BackgroundQueuePanel.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Queue/BackgroundQueuePanel.tsx): Drawer จัดการและดูรายละเอียดคิวงาน OCR/แปลที่มุมขวาล่าง (`React.memo`)
    - [`Export/DocumentExportModal.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Export/DocumentExportModal.tsx): กล่องส่งออกไฟล์ PDF/ภาพ พร้อม Console แปลด่วน (`React.memo`)
  - **Canvas & Viewers:**
    - [`Viewer/WorkspaceContainer.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Viewer/WorkspaceContainer.tsx): คอนเทนเนอร์จัดการ Split/Single Viewport (`React.memo`)
    - [`PDF/PDFCanvas.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/PDF/PDFCanvas.tsx): ตัวเรนเดอร์ PDF รองรับ Continuous Scroll Mode ระดับ 60/120 FPS พร้อม Hardware Acceleration
    - [`Image/ImageCanvas.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Image/ImageCanvas.tsx): ตัวเรนเดอร์ภาพเดี่ยวพร้อม Direct GPU Transforms
    - [`Home/UploadScreen.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Home/UploadScreen.tsx): หน้า Home คลังเอกสาร การจัดระเบียบโฟลเดอร์ และแท็ก
    - [`Layers/InteractiveLayerOverlay.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Layers/InteractiveLayerOverlay.tsx): ตัวจัดการกล่องข้อความแปล (Drag, Resize, Rotate, Text Wrap)
- [`src/services/translation/`](file:///c:/App/Electron/PDF_Translator/src/services/translation/):
  - [`translatableLineCollector.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/translatableLineCollector.ts): คัดกรองและเรียงลำดับบรรทัดข้อความที่ต้องการแปล
  - [`translationBridge.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/translationBridge.ts): ฟังก์ชัน Wrapper สื่อสารกับ IPC ฝั่ง Electron
  - [`translationLineResolver.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/translationLineResolver.ts): คัดเลือก Source Text ที่ดีที่สุดและ Cross-Engine Fallback
  - [`technicalGlossary.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/technicalGlossary.ts): ปกป้องและแทนที่ศัพท์เทคนิค/สแลงภาษาไทย
  - [`translationGrouping.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/translationGrouping.ts): รวมกลุ่มบรรทัดข้อความในบอลลูนคำพูดตามระยะเชิงพื้นที่ 2D
  - [`geminiPromptBuilder.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/geminiPromptBuilder.ts): สร้าง Prompt และ Safety Directives สำหรับ Gemini API
  - [`translationCoordinator.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/translationCoordinator.ts): ประสานงานการแปลและตัด Delimiter ที่ผิดเพี้ยน
  - [`offlineTranslationService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/offlineTranslationService.ts): ระบบแปลออฟไลน์และ Short Phrase Lookups $O(1)$
  - [`sfxDictionaryService.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/sfxDictionaryService.ts): พจนานุกรมเสียงเอฟเฟกต์ (SFX) และเสียงคราง
  - [`koreanTranslationPolicy.ts`](file:///c:/App/Electron/PDF_Translator/src/services/translation/koreanTranslationPolicy.ts): กฎการแปลและ Fallback ภาษาเกาหลี/สแลงเฉพาะทาง

### 3.2 Desktop Host (`electron/`)
- [`electron/main.ts`](file:///c:/App/Electron/PDF_Translator/electron/main.ts): **Clean Entrypoint (311 บรรทัด / ลดลง 84.0%)**
- [`electron/ipc/`](file:///c:/App/Electron/PDF_Translator/electron/ipc/): แยก IPC Handlers ตามโดเมน:
  - `ocr.ts`: ควบคุม Sidecar OCR และ Prewarm Engine
  - `translation.ts`: ควบคุม Argos Offline Translation
  - `database.ts`: จัดการ Documents, Projects, Tags, Cache
  - `export.ts`: สั่งพิมพ์ PDF ผ่าน Headless Chromium Window
  - `window.ts`: ควบคุม Window State, Fullscreen, Titlebar
  - `dialog.ts`: จัดการ Open File / Folder Dialogs
  - `gemini.ts`: จัดการ Secure Storage สำหรับ Gemini API Key
  - `library.ts`: จัดการ Metadata และสถิติคลังเอกสาร
- [`electron/db.ts`](file:///c:/App/Electron/PDF_Translator/electron/db.ts): SQLite DAO Layer

---

## ⚡ 4. การปรับปรุงประสิทธิภาพเชิงลึก (Deep Performance Optimizations & 60/120 FPS Scrolling)

### 4.1 Granular Zustand Selectors & React.memo
- ขจัดปัญหา Wholesale Store Subscription (`useProjectStore()`, `useSegmentationStore()`) โดยเปลี่ยนมาใช้ Granular Selector ดึงเฉพาะ State Slice ที่ใช้งาน
- ห่อหุ้ม `React.memo` ให้กับทุกส่วนประกอบหลัก: `AppHeaderToolbar`, `BackgroundQueueBadge`, `BackgroundQueuePanel`, `DocumentExportModal`, `WorkspaceContainer`, `DocumentRenderer`, และ `PDFPageContainer` ป้องกันการ Re-render แบบลูกโซ่ขณะเลื่อนหน้าจอหรือลากแก้ไขกล่องข้อความ

### 4.2 ขจัดปัญหา Snap Conflict ใน Continuous Scroll Mode
- **ปัญหาเดิม:** เมื่อผู้ใช้เลื่อนหน้าจอข้ามเส้นแบ่งหน้า `IntersectionObserver` จะตรวจจับว่าเข้าสู่หน้าใหม่ และเรียก `setPage(newPage)` ซึ่งเคยทำให้ Effect ภายใน `PDFCanvas` เข้าใจผิดว่าเป็นการคลิกเปลี่ยนหน้า และสั่ง `setPan(targetX, targetY)` ดึงหน้าจอกระตุกกลับไปที่ขอบบนของหน้านั้นทันที
- **การแก้ไข:** ปรับให้ `setPan` ทำงานเฉพาะตอนที่มีการสั่งเปลี่ยนหน้าแบบเจาะจง (Programmatic Navigation เช่น คลิก Thumbnail หรือพิมพ์เลขหน้า) เท่านั้น เมื่อผู้ใช้เลื่อนหน้าจออิสระ ระบบจะไม่เข้ามากระตุกหรือแย่งตำแหน่ง Pan

### 4.3 Direct GPU Hardware Acceleration (`translate3d`)
- เปลี่ยนการคำนวณตำแหน่ง 2D `translate(x, y)` มาเป็น **`translate3d(x, y, 0px)`**
- กำหนด `backface-visibility: hidden` และ `will-change: transform`
- บังคับให้ Electron/Chromium Compositor ดึง Canvas ของทั้ง PDF และ Image ขึ้นไปประมวลผลบน **Dedicated GPU VRAM Texture Layer** โดยตรง ลดภาระ CPU ในการคำนวณ Sub-pixel Rasterization ในทุกๆ Frame

### 4.4 ตัด CSS Transition Fighting (Zero Animation Latency)
- ตัด `transition: transform 0.1s ease-out` บน Canvas Content Div ในระหว่างการเลื่อนด้วย Wheel หรือ Drag เพื่อไม่ให้ CSS Transition ขัดจังหวะกับ `requestAnimationFrame` ทำให้ Canvas เคลื่อนที่ตามเมาส์/Trackpad แบบ **1:1 Native Direct Response** ทันที

### 4.5 Virtualize / Mount Overlay เฉพาะหน้าที่อยู่ในระยะมองเห็น
- ปรับให้ Mount `<PDFPageOverlay>` เฉพาะหน้าที่อยู่ในระยะมองเห็น (`isVisible = true`) เมื่อหน้าเลื่อนพ้นสายตา React จะ Unmount กิ่ง Overlay ออกจาก DOM Tree ช่วยลด Node ข้อความ, Event Listener, และการคำนวณ Typography ลงกว่า **90%**

### 4.6 Debounce Active Page Detection (250ms + startTransition)
- ปรับจังหวะการบันทึกหน้าปัจจุบันขณะเลื่อนผ่าน `IntersectionObserver` ให้ใช้ `React.startTransition` ร่วมกับ Debounce 250ms เพื่อไม่ให้ Main Thread ถูกขัดจังหวะด้วยการ Re-render Toolbar รอบนอกขณะกำลังเลื่อนหน้าจอ

---

## 🛠️ 5. สรุปการแก้ไขปัญหาสำคัญในอดีต (Key Bug Fixes & Resolutions Reference)

1. **Cross-Document Cache Leak:** เพิ่ม Guard `isActiveDoc` ป้องกันงานแปลพื้นหลังเขียนทับ In-Memory Store ของไฟล์ที่กำลังเปิดอยู่
2. **Last Page Restoration & Scroll Lock:** เพิ่ม `isProgrammaticScrollRef` ป้องกัน Observer หน้า 1 สั่ง `setPage(1)` ทับหน้าเดิมขณะเปิดไฟล์
3. **Unified Balloon Grouping & Group-First Policy:** รวม Heuristics การจัดกลุ่มประโยค 2D ระหว่าง Single Page และ All Pages ให้ตรงกัน 100% พร้อมปิดกั้น Per-Line Dictionary ไม่ให้เขียนทับประโยคที่แปลสมบูรณ์แล้ว
4. **Manga Dictionary & SFX Expansions:** รองรับคำสแลง บทสนทนา 20+ และเสียงเอฟเฟกต์กว่า 300+ รูปแบบ
5. **Korean & Multilingual Fallback Architecture:** รองรับการซ่อมคำผิดจาก OCR ภาษาเกาหลี สเปน และภาษาเอเชียผ่าน Pivot Pipeline (JA/KO/ZH $\rightarrow$ EN $\rightarrow$ TH)
6. **File Explorer Parity Multi-Select:** รองรับ Ctrl+Click, Shift+Click Range Selection และ Drag & Drop ลง Subfolder
7. **F11 Fullscreen & Clean Titlebar:** รองรับปุ่ม F11 สลับโหมดเต็มจอ และออกแบบ Titlebar ไร้รอยต่อ

---

## 🧪 6. มาตรฐานและการทดสอบ (Testing & Standards)

- **รันชุดการทดสอบทั้งหมด:**
  ```powershell
  pnpm vitest run
  ```
  *(สถานะปัจจุบัน: 39/39 Test Files Passed, 355/355 Unit & Integration Tests Passed 100%)*

- **รันตรวจสอบ Type เชิงลึก:**
  ```powershell
  pnpm exec tsc --noEmit
  ```
  *(สถานะปัจจุบัน: 0 Errors / Exit Code 0)*
