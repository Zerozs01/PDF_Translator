# PDF Translator - Project Context & Architecture Reference

> **อัปเดตล่าสุด:** สิงหาคม 2026  
> **สถานะการทดสอบ:** Vitest 42/42 Test Files ผ่านทั้งหมด (385/385 Tests Passed 100% ✅)  
> **TypeScript Strict Check:** `pnpm exec tsc --noEmit` 0 Errors (Exit Code 0 ✅)

---

## 📌 1. ภาพรวมโปรเจกต์ (Project Overview)

**PDF Translator** คือแอปพลิเคชัน Desktop ประสิทธิภาพสูงระดับ Native-Equivalent สำหรับแปลเอกสาร PDF, มังงะ, มังฮวา, นิยาย และรูปภาพ ด้วยเทคโนโลยี AI/OCR แบบออฟไลน์และออนไลน์:
- **Frontend:** React 18 + Strict TypeScript + Vite + TailwindCSS + Zustand + React.memo
- **Desktop Host:** Electron (Context Isolation, Secure IPC, Native File System, SQLite Native Bridge, Chromium GPU Rasterization, Zero-Copy Pipeline)
- **Database:** SQLite (`better-sqlite3`) พร้อม Modular DAOs, โหมด WAL (Write-Ahead Logging), FTS5 Full-Text Search และ Memory-Mapped I/O
- **Native Performance Layer:** Zero-GC TypedArray Spatial Clustering (`Float64Array` + `Int32Array` Union-Find), Bitset Dice Similarity (`Uint32Array` Pre-allocated Pool), Sub-millisecond Blank Page Detector
- **OCR Engine (Python Sidecar):** PaddleOCR, EasyOCR, Manga-OCR (รองรับ DirectML เร่งความเร็วบน AMD/Intel/NVIDIA GPUs)
- **Translation Engine:** Argos Translate (NMT ออฟไลน์ผ่าน CTranslate2) และ Google Gemini API (คลาวด์)
- **Export Engine:** High-Fidelity Hidden Window Print PDF Export + Scalable Vector Text Layer

---

## 🏛️ 2. สถาปัตยกรรมระบบและ Data Flow (System Architecture)

```mermaid
flowchart TD
    User([ผู้ใช้]) --> UI[React UI / UploadScreen / Workspace Editor / RightSidebar]
    
    subgraph FrontendState [Zustand State Stores & Granular Selectors]
        ProjectStore[useProjectStore\n(Active Doc, Page, Lang, Profile)]
        OCRStore[useOCRTextLayerStore\n(OCR Cache, Text Boxes, Search)]
        LayerStore[useLayerStore\n(Interactive Text Layers, Groups)]
        QueueStore[useBackgroundQueueStore\n(Batch Jobs & Sync)]
        UIStore[useUIStore\n(Zoom, Pan, Split View, Active Tool)]
    end

    subgraph NativePerfEngine [Zero-GC Native-Equivalent Engine]
        FastSpatial[fastSpatialCluster.ts\n(Float64Array IoU + Union-Find)]
        FastDice[fastDiceSimilarity.ts\n(Uint32Array Bitset Pool + Popcount)]
        BlankDetector[blankPageDetector.ts\n(Sub-ms Solid/Blank Page Skip)]
    end

    subgraph Orchestrator [App Coordinator & Custom Hooks]
        DocTranslationHook[useDocumentTranslation\n(Single Page & Batch AI/Offline)]
        ExportModalHook[useDocumentExportModalState\n(Scope, Quality & Quick Translate)]
        QueueSyncHook[useBackgroundQueueSync\n(FIFO Delegation & Lock Sync)]
    end

    subgraph DesktopHost [Electron Main Process - Domain IPC & DAOs]
        IPC_OCR[ipc/ocr.ts]
        IPC_DB[ipc/database.ts]
        IPC_Translation[ipc/translation.ts]
        IPC_Export[ipc/export.ts]
        DAO_Layer[DAO Layer: Document, Project, Tag, OCR, Translation, Glossary]
        DB[(SQLite Database\npdf_translator.db)]
    end

    subgraph Sidecar [Python Sidecar Engines]
        Paddle[PaddleOCR / EasyOCR / MangaOCR]
        Argos[Argos Translate Engine - CTranslate2]
    end

    UI --> FrontendState
    FrontendState <--> Orchestrator
    Orchestrator <--> NativePerfEngine
    Orchestrator <--> DesktopHost
    DesktopHost <--> DAO_Layer
    DAO_Layer <--> DB
    DesktopHost <--> Sidecar
```

---

## 📂 3. โครงสร้างโฟลเดอร์หลักหลัง Refactoring & Modularization (Key Directories & File Map)

### 3.1 Frontend (`src/`)
- [`src/App.tsx`](file:///c:/App/Electron/PDF_Translator/src/App.tsx): **Clean Orchestrator Shell (535 บรรทัด / ลดลง 86.2%)** ประสานงานระหว่าง Hooks, Stores และ Layouts
- [`src/services/native/`](file:///c:/App/Electron/PDF_Translator/src/services/native/): **Zero-GC & Native-Equivalent Engines**
  - [`fastSpatialCluster.ts`](file:///c:/App/Electron/PDF_Translator/src/services/native/fastSpatialCluster.ts): Flat `Float64Array` IoU matrix และ `Int32Array` Disjoint-Set / Union-Find สำหรับการจัดกลุ่มเชิงพื้นที่ 2D โดยไร้ Memory Allocations
  - [`fastDiceSimilarity.ts`](file:///c:/App/Electron/PDF_Translator/src/services/native/fastDiceSimilarity.ts): Bitset Bigram Dice Coefficient (`Uint32Array` pool) พร้อม Kernighan Popcount เร่งความเร็วคำนวณข้อความ 5-20x
- [`src/services/vision/`](file:///c:/App/Electron/PDF_Translator/src/services/vision/):
  - [`blankPageDetector.ts`](file:///c:/App/Electron/PDF_Translator/src/services/vision/blankPageDetector.ts): ตรวจจับหน้าว่างเปล่า/สีพื้นล้วนใน < 0.5ms เพื่อข้าม OCR & Translation ทันที (0ms)
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
    - [`Layout/RightSidebar.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/Layout/RightSidebar.tsx): แถบตั้งค่า OCR, Engine, พจนานุกรม และผลลัพธ์ OCR Text Layer
  - **OCR Sub-Components:**
    - [`OCR/OCRTextLayerPanel.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/OCR/OCRTextLayerPanel.tsx): ควบคุม OCR Actions, Clear Cache, Re-OCR All (Ignore Cache)
    - [`OCR/EngineSelector/OCREngineSelector.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/OCR/EngineSelector/OCREngineSelector.tsx): แถบเลือกโมเดล OCR พร้อม Copper Theme และ Quick Pill Buttons (Fast ⚡ / Best ✨ / Benchmark 📊)
    - [`OCR/ResultTree/OCRResultTree.tsx`](file:///c:/App/Electron/PDF_Translator/src/components/OCR/ResultTree/OCRResultTree.tsx): แสดงผล OCR Block / Line Tree พร้อมปุ่ม Search & Expand/Collapse All
    - [`OCR/overlay/overlayDedup.ts`](file:///c:/App/Electron/PDF_Translator/src/components/OCR/overlay/overlayDedup.ts): จัดการ Deduplication เชื่อมต่อกับ Native Fast Engines
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

### 3.2 Desktop Host & Database DAOs (`electron/`)
- [`electron/main.ts`](file:///c:/App/Electron/PDF_Translator/electron/main.ts): **Clean Entrypoint พร้อม Chromium GPU Flags & V8 Tuning**
- [`electron/dao/`](file:///c:/App/Electron/PDF_Translator/electron/dao/): **Modular Domain DAOs (Phase 3.2)**
  - [`DocumentDAO.ts`](file:///c:/App/Electron/PDF_Translator/electron/dao/DocumentDAO.ts): จัดการเอกสาร, หน้า, สถิติ, การจัดระเบียบคลัง
  - [`ProjectDAO.ts`](file:///c:/App/Electron/PDF_Translator/electron/dao/ProjectDAO.ts): จัดการโปรเจกต์, โฟลเดอร์ย่อย, และการจัดกลุ่ม
  - [`TagDAO.ts`](file:///c:/App/Electron/PDF_Translator/electron/dao/TagDAO.ts): จัดการแท็กและความสัมพันธ์กับเอกสาร
  - [`OCRDAO.ts`](file:///c:/App/Electron/PDF_Translator/electron/dao/OCRDAO.ts): จัดการบันทึก/ค้นหาผลลัพธ์ OCR และแคชเชิงพื้นที่
  - [`TranslationDAO.ts`](file:///c:/App/Electron/PDF_Translator/electron/dao/TranslationDAO.ts): จัดการแคชคำแปลทั้งระดับบรรทัดและประโยค
  - [`GlossaryDAO.ts`](file:///c:/App/Electron/PDF_Translator/electron/dao/GlossaryDAO.ts): จัดการคลังศัพท์เฉพาะทางและพจนานุกรม
- [`electron/ipc/`](file:///c:/App/Electron/PDF_Translator/electron/ipc/): แยก IPC Handlers ตามโดเมน (OCR, Translation, Database, Export, Window, Dialog, Gemini, Library)
- [`electron/db.ts`](file:///c:/App/Electron/PDF_Translator/electron/db.ts): SQLite Connection & Migration Coordinator

---

## ⚡ 4. การปรับปรุงประสิทธิภาพเชิงลึก (Deep Performance & Native-Equivalent Optimizations)

### 4.1 Chromium GPU Rasterization & Zero-Copy Compositor
- **Flags ที่เปิดใช้งานใน `electron/main.ts`:**
  - `enable-gpu-rasterization`: สั่งให้ GPU รับผิดชอบงาน Tile Rasterization แทน CPU
  - `enable-zero-copy`: ข้ามขั้นตอน Buffer Copy ระหว่าง Main Process และ Compositor ช่วยประหยัดแบนด์วิดท์หน่วยความจำ
  - `enable-accelerated-2d-canvas`: บังคับให้การเรนเดอร์ PDF Canvas Overlay วิ่งตรงผ่าน GPU Pipelines
  - `disable-frame-rate-limit`: ใช้ OS Hardware VSync เพื่อให้การเคลื่อนไหวไหลลื่นระดับ 60/120/144 Hz
  - `js-flags: --max-old-space-size=1024`: ควบคุมขนาด V8 Heap ไม่ให้ขยายตัวเกินจำเป็น และกระตุ้น Garbage Collection ให้ทำงานอย่างมีประสิทธิภาพ

### 4.2 Zero-GC TypedArray Spatial Clustering (`fastSpatialCluster.ts`)
- ใช้ Flat `Float64Array` ในการเก็บ Bounding Box Coordinates (4 floats ต่อ Box)
- คำนวณ IoU (Intersection over Union) โดยตรงจาก Array Index โดยไม่สร้าง Object Wrapper ชั่วคราว
- ใช้อัลกอริทึม Disjoint-Set / Union-Find บน `Int32Array` พร้อม Path Compression และ Union by Rank ทำให้การจัดกลุ่มข้อความ $O(n \cdot \alpha(n))$ ไร้การจองหน่วยความจำชั่วคราว (Zero GC Pauses)

### 4.3 High-Throughput Bitset Dice Similarity (`fastDiceSimilarity.ts`)
- ใช้ Pre-allocated `Uint32Array(2048)` Pool แทนการสร้าง `Set<string>` ใหม่ในทุกๆ รอบการเปรียบเทียบ
- เข้ารหัส Character Bigram เป็นตำแหน่ง Bit บน 65,536-bit Vector
- หาจุดตัด (Intersection Overlap) ด้วย Brian Kernighan's Bitwise Popcount ($O(\text{set bits})$) เพิ่มความเร็วการทำ Overlay Deduplication ขึ้น 5–20 เท่า

### 4.4 Pure Blank & Solid Color Page Fast Detector (`blankPageDetector.ts`)
- สแกนพิกเซลเปรียบเทียบความเบี่ยงเบนสีสูงสุด (Max Color Deviation) บน Offscreen Canvas ขนาด $128 \times 128$ (< 0.5ms)
- หากความเบี่ยงเบน $\le 4$ $\rightarrow$ ตีเป็นหน้าว่างเปล่า/สีพื้นล้วนทันที ข้ามการแปลง Blob, IPC Transfer, DBNet Detection และ Translation ทั้งหมดลงเหลือ 0ms
- ป้องกัน False Positives: หน้าที่มีรูปภาพ ลายเส้น หรือตัวหนังสือแม้แต่ตัวเดียวจะข้ามการตรวจสอบและเข้าสู่กระบวนการ OCR ปกติ

### 4.5 Granular Zustand Selectors & React.memo
- ขจัดปัญหา Wholesale Store Subscription โดยเปลี่ยนมาใช้ Granular Selector ดึงเฉพาะ State Slice ที่จำเป็น
- ห่อหุ้ม `React.memo` ให้กับทุกส่วนประกอบหลักเพื่อป้องกันการ Re-render แบบลูกโซ่ขณะเลื่อนหน้าจอหรือแก้ไขข้อความ

### 4.6 Direct GPU Hardware Acceleration (`translate3d`)
- เปลี่ยนการคำนวณตำแหน่ง 2D `translate(x, y)` มาเป็น **`translate3d(x, y, 0px)`**
- กำหนด `backface-visibility: hidden` และ `will-change: transform`
- บังคับให้ Compositor ดึง Canvas ขึ้นไปประมวลผลบน **Dedicated GPU VRAM Texture Layer** โดยตรง

### 4.7 Virtualize / Mount Overlay เฉพาะหน้าที่อยู่ในระยะมองเห็น
- Mount `<PDFPageOverlay>` เฉพาะหน้าที่อยู่ในระยะมองเห็น (`isVisible = true`) เมื่อพ้นสายตาจะ Unmount ออกจาก DOM Tree ช่วยลด Node ข้อความ, Event Listener, และการคำนวณ Typography ลงกว่า **90%**

---

## 🛠️ 5. สรุปการแก้ไขปัญหาสำคัญในอดีต (Key Bug Fixes & Resolutions Reference)

1. **Cross-Document Cache Leak:** เพิ่ม Guard `isActiveDoc` ป้องกันงานแปลพื้นหลังเขียนทับ In-Memory Store ของไฟล์ที่กำลังเปิดอยู่
2. **Last Page Restoration & Scroll Lock:** เพิ่ม `isProgrammaticScrollRef` ป้องกัน Observer หน้า 1 สั่ง `setPage(1)` ทับหน้าเดิมขณะเปิดไฟล์
3. **Unified Balloon Grouping & Group-First Policy:** รวม Heuristics การจัดกลุ่มประโยค 2D ระหว่าง Single Page และ All Pages ให้ตรงกัน 100% พร้อมปิดกั้น Per-Line Dictionary ไม่ให้เขียนทับประโยคที่แปลสมบูรณ์แล้ว
4. **Manga Dictionary & SFX Expansions:** รองรับคำสแลง บทสนทนา 20+ และเสียงเอฟเฟกต์กว่า 300+ รูปแบบ
5. **Korean & Multilingual Fallback Architecture:** รองรับการซ่อมคำผิดจาก OCR ภาษาเกาหลี สเปน และภาษาเอเชียผ่าน Pivot Pipeline (JA/KO/ZH $\rightarrow$ EN $\rightarrow$ TH)
6. **File Explorer Parity Multi-Select:** รองรับ Ctrl+Click, Shift+Click Range Selection และ Drag & Drop ลง Subfolder
7. **F11 Fullscreen & Clean Titlebar:** รองรับปุ่ม F11 สลับโหมดเต็มจอ และออกแบบ Titlebar ไร้รอยต่อ
8. **Right Sidebar UX/UI & Quality Switcher:** คืนค่า Copper Theme Header, Pill Buttons ควบคุม OCR (สลับโหมด Fast ⚡ / Best ✨ ได้ทันที) พร้อมปุ่ม Benchmark แยก
9. **Vitest Process Teardown Stabilization:** ตั้งค่า `teardownTimeout` และ `hookTimeout` ป้องกัน Vitest Process ค้างเมื่อรันเทสต์ครบทั้งหมด
10. **Sub-millisecond Blank Page Skip:** ติดตั้งตัวตรวจจับหน้าว่างเปล่า/สีพื้นล้วน ข้ามการประมวลผล OCR & Translation ที่ไม่จำเป็น

---

## 🧪 6. มาตรฐานและการทดสอบ (Testing & Standards)

- **รันชุดการทดสอบทั้งหมด:**
  ```powershell
  pnpm vitest run
  ```
  *(สถานะปัจจุบัน: 42/42 Test Files Passed, 385/385 Unit & Integration Tests Passed 100% ✅)*

- **รันตรวจสอบ Type เชิงลึก:**
  ```powershell
  pnpm exec tsc --noEmit
  ```
  *(สถานะปัจจุบัน: 0 Errors / Exit Code 0 ✅)*
