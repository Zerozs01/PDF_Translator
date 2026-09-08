# 📄 PDF Translator — Master Architectural Context & System State

> **Last Updated:** 2026-09-08  
> **Status:** Production-Ready / Fully Refactored & Performance-Optimized  
> **Test Suite:** 31 Test Files / 372 Unit Tests (100% Passing)  
> **Type Safety:** Strict TypeScript (`tsc --noEmit` clean / 0 errors)

---

## 📌 Executive Summary

**PDF Translator** เป็น Desktop Application ประสิทธิภาพสูงสำหรับการแปลเอกสารและหนังสือการ์ตูน (Manga / Manhwa / Comic) โดยเน้นความแม่นยำของ Bounding Box, การจัดกลุ่มบอลลูนคำพูด 2 มิติ (Spatial Graph Clustering), การจำกัดหน่วยความจำและขจัด Garbage Collection (Zero-GC Native Algorithms), ฐานข้อมูลเข้ารหัสความเร็วสูงระดับ Local ด้วย SQLCipher (WAL Mode), และไปป์ไลน์ OCR/Translation ออฟไลน์ที่ทำงานผ่าน Python IPC Daemons (PaddleOCR + Argos Translate)

---

## 🏗️ 1. Technology Stack & Topology

```
┌──────────────────────────────────────────────────────────┐
│                   Electron Renderer                      │
│   React 18 + TypeScript + Vite + Zustand + Canvas/DOM    │
│   - Zero-GC Spatial Clustering (fastSpatialCluster.ts)   │
│   - 16-bit Unicode Popcount Bigram (fastDiceSimilarity)  │
│   - Zero-GC Pooled SFX Levenshtein (sfxDictionaryService)│
│   - Balloon/SFX Classification (LayerGroupingService)    │
│   - Reusable Headless Canvas Queue & PDF.js Lifecycle    │
└────────────────────────────┬─────────────────────────────┘
                             │ IPC (contextBridge)
┌────────────────────────────▼─────────────────────────────┐
│                    Electron Main Process                 │
│   Node.js + better-sqlite3-multiple-ciphers              │
│   - SQLite Database & WAL / FTS5 (electron/db.ts)        │
│   - Modular DAOs + Prepared Statement Cache (dao/)       │
│   - Modular OCR Subsystem (ocrBridge / Daemon / Temp)    │
│   - Zero-Spawn Native Liveness Watchdog (process.kill 0) │
│   - Unified Python Resolution (electron/pythonRuntime.ts)│
└────────────────────────────┬─────────────────────────────┘
                             │ Subprocess JSON Lines IPC (Daemon)
┌────────────────────────────▼─────────────────────────────┐
│                   Python Backend Daemons                 │
│   - PaddleOCR / EasyOCR Engine (scripts/ocr_bridge/)     │
│   - Argos Translate Daemon (scripts/argos_translate.py)  │
└──────────────────────────────────────────────────────────┘
```

- **Renderer UI:** React 18, TypeScript (Strict), Vite, TailwindCSS, Zustand (State Management with custom persistent storage)
- **Database & Storage:** `better-sqlite3-multiple-ciphers` (SQLCipher 256-bit AES), WAL journal mode, Memory-mapped I/O (128MB), FTS5 full-text search, Prepared Statement caching
- **OCR Subsystem:** PaddleOCR (Primary default engine via Python bridge), EasyOCR (Secondary automatic fallback). **Tesseract ถูกถอดออกจากการทำงานหลักทั้งหมด**
- **Translation Subsystem:** Argos Translate (Offline NMT Daemon via Python bridge), Direct Phrase Dictionaries (English, Korean, Japanese, Chinese, Spanish, French), Dynamic User Glossary & Translation Memory

---

## 🧩 2. Core Architecture & Directory Layout

### 2.1 Backend / Electron Layer (`electron/`)
- `electron/db.ts` — ตัวจัดการ Database Lifecycle, รหัสผ่าน SQLCipher, SQLite PRAGMAs (WAL, page_size=4096, cache_size=-64000, mmap_size=128MB), FTS5 Virtual Table, Triggers, และ Database Schema Migrations
- `electron/dao/` — Modular Data Access Objects พร้อม Prepared Statement Caching:
  - `DocumentDAO.ts` — CRUD, FTS5 Search, Startup Batch Hydration, Cache Size, Favorites, Tags
  - `ProjectDAO.ts` — โครงสร้างโฟลเดอร์/โปรเจกต์ต้นไม้ (Tree structure) และสถิติเอกสารในโปรเจกต์
  - `TagDAO.ts` — ป้ายกำกับและสีสำหรับเอกสาร (Many-to-Many)
  - `OCRCacheDAO.ts` — แคชผลลัพธ์ OCR แยกตามเลขหน้าและ Engine (`ocr_cache_engine`)
  - `TranslationDAO.ts` — `TranslationCacheDAO` (แคชผลการแปลระดับหน้า) และ `SentenceTranslationDAO` (แคชคำแปลระดับประโยคข้ามเอกสาร)
  - `GlossaryDAO.ts` — คำศัพท์เฉพาะและ SFX ของผู้ใช้
  - `BenchmarkDAO.ts` — ประวัติการทดสอบ Benchmark และผลลัพธ์ Baseline vs Improved
  - `index.ts` — Barrel export พร้อมฟังก์ชัน `initAllDAOs(db)` สำหรับผูก Connection
- `electron/pythonRuntime.ts` — รวมศูนย์การค้นหาและ Resolve Python Virtual Environment (`.venv-ocr`, `.venv`) ผ่าน `loadLocalEnv()` และ `getDefaultPythonSearchRoots()` รองรับทั้ง Windows และ macOS/Linux
- `electron/ocrBridge.ts` — Clean Orchestration Facade จัดการ Retry, Automatic Engine Fallback (PaddleOCR -> EasyOCR), และรักษา API เดิมสำหรับ Main Process 100%
- `electron/ocrBridgeTypes.ts` — ศูนย์รวม Interface, Types, Engine Status, Request Payload, และ Stderr Regex Filters
- `electron/ocrTempManager.ts` — จัดการ OCR Temporary Image Files พร้อมระบบป้องกัน Directory Traversal และฟังก์ชันทำความสะอาดไฟล์ขยะตกค้าง (`cleanupOrphanedOcrTempFiles`)
- `electron/ocrDaemonManager.ts` — จัดการ Lifecycle ของ Python OCR Daemon, Queue Serialization, Stdout Buffer, Stderr Filter, และ Watchdog ตรวจจับ Liveness ด้วย `process.kill(pid, 0)` Native Win32 API (<0.1ms, 0 process spawn ขณะ Idle)
- `electron/argosBridge.ts` — เชื่อมต่อ Main Process กับ Python Argos Translate Subprocess Daemon

### 2.2 Native & High-Performance Algorithms (`src/services/native/` & `src/services/translation/`)
- `fastSpatialCluster.ts` — Zero-GC Disjoint-Set (Union-Find) with Path Compression และ TypedArray Buffer สำหรับ IoU Matrix และ Connected Components
  - `clusterConnectedComponents(n, isConnected)` — ใช้ `Int32Array` ทำ transitive closure $O(N \cdot \alpha(N))$ ไร้การจองหน่วยความจำ Heap (แทนที่ BFS queues และ adjacency list)
  - `fastIoU(a, b)` / `clusterByIoU(boxes, threshold)` / `batchIoUMatrix(boxes)`
- `fastDiceSimilarity.ts` — High-Throughput Bigram Similarity Engine สำหรับ Token Deduplication
  - ใช้ 65,536-bit Typed Bitset Pool (`Uint32Array(2048)`)
  - Brian Kernighan's popcount บน bitwise AND
  - ผสม 16-bit code unit `((c1 * 31) ^ c2) & 0xFFFF` ป้องกัน Hash Collision ของภาษาไทย (`\u0E00-\u0E7F`) และ CJK
  - `batchDiceSimilarity(reference, candidates)` ใช้ `bitsetRef` ใน pool แบบ 100% Zero-GC
- `sfxDictionaryService.ts` — Zero-GC Sound Effects Engine
  - `getLevenshteinDistance(a, b)` ใช้โมดูล-เลเวล Reusable `Int32Array` Row Buffers (`rowBufferA`, `rowBufferB`) ขจัด GC churn ในการจับคู่ Fuzzy match
  - สลับสตริงให้อาร์กิวเมนต์ที่ 2 สั้นกว่าเสมอ (`b.length <= a.length`) เพื่อลดขนาด Buffer และจำนวนรอบของ inner loop
  - สร้าง `Map<string, string>` แบบ Lazy On-Demand (`getExactMap(lang, merged)`) ตามภาษาที่เรียกใช้จริง
  - พรีแคชสตริงที่ Normalize แล้วบน `_normSource` ระหว่างขั้นตอน deduplicate ลดการ allocate สตริงซ้ำๆ ในลูป
- `shortPhraseDictionaryService.ts` & `dictionaries/index.ts` — คลังคำสั้นและ Fallback Dictionary:
  - ใช้ `getDictionaryByLanguage(sourceLang)` ค้นหา Scoped Dictionary ตรงภาษาก่อน แล้วจึงค้นหาผ่าน `ARGOS_SHORT_PHRASE_LOOKUP_TH` Proxy
  - กำจัด fallback ซ้ำซ้อนของ `GENERAL_ENGLISH_DICTIONARY_TH` ออกทั้งหมด
  - รองรับการส่ง `sourceLang` ใน `systemicWordFallbackTranslate(text, sourceLang)`
- `translationCoordinator.ts` — จัดการคิวและแคชคำแปลสั้นระดับหน้า:
  - มี `phraseCache` พร้อมระบบ Invalidation อัตโนมัติตาม Reference ของ `useGlossaryStore.getState().entries`
  - มี `clearPhraseCache()` ป้องกันการแสดงผลลัพธ์คำแปลเดิมค้างหลังผู้ใช้แก้ไข Glossary

### 2.3 Background Queue & Headless Processing (`src/services/ocr/`)
- `BackgroundQueueProcessor.ts` — ระบบประมวลผลคิวเบื้องหลังสำหรับ OCR และแปลทั้งเล่ม:
  - **Reusable Headless Canvas Pool:** สลับใช้ Canvas Instance เดียว ปรับเปลี่ยนเฉพาะ `width`/`height` และคืน Backing buffer ทันที (`width = 0; height = 0`) เมื่อ abort หรือเกิดข้อผิดพลาด
  - **PDF.js Lifecycle Discipline:** สั่ง `page?.cleanup?.()` ในบล็อก `finally` ของ `renderHeadlessPage` ทุกหน้า ปลด Font caches, Glyph vectors, และ Decoded stream memory ของ PDF.js ทันที ป้องกัน Memory Accumulation ในเอกสาร 100+ หน้า
  - **2-Stage Prefetch Pipeline:** เรนเดอร์หน้าถัดไปแบบ Prefetch ใน background ล่วงหน้าขณะที่ Python Daemon กำลังประมวลผล OCR หน้าปัจจุบัน พร้อมระบบเคลียร์ stale prefetch อัตโนมัติเมื่อหน้าปัจจุบันเป็น DB Cache Hit
  - **Foreground On-Demand Single-Page OCR (`runSinglePageOCR`):** เมธอดสาธารณะสำหรับรัน OCR หน้าเดียวแบบ On-Demand รองรับทั้ง PDF และไฟล์รูปภาพ ตรวจสอบ SQLite Cache ก่อน หากแคชหลุดจะเรนเดอร์ Headless Page แล้วส่งเข้า OCR Daemon พร้อมบันทึกแคชและอัปเดต Zustand Store ทันที
  - **Unified Single-Page & Batch Architecture:** `useDocumentTranslation.ts` ใช้งาน `runSinglePageOCR` และดึง DB Cache โดยตรง ขจัดปัญหา Dead Event Protocol (`AUTO_OCR_REQUEST_EVENT`) ที่เคยทำให้การกดแปล Offline/AI หน้าเดียวค้าง 180 วินาที
  - **SRP Decomposed Methods:** ลูปประมวลผล `processJob()` ถูกแบ่งความรับผิดชอบอย่างชัดเจนออกเป็น `executePageOCR`, `syncPageLayers` (ปฏิบัติตามกฎ Cross-Document Isolation อย่างเคร่งครัด), และ `dispatchPageTranslation`
  - **Declarative Constraints Matrix:** ฟังก์ชัน `resolveRenderConstraints()` ใช้ Profile Lookup Table ยุบโค้ดซ้ำซ้อน 117 บรรทัดเหลือโครงสร้างที่อ่านง่ายและขยายได้สะดวก

### 2.4 Layout & Grouping Engine (`src/services/layers/` & `src/services/layout/`)
- `LayerGroupingService.ts` — ตัวจัดกลุ่มกล่องข้อความ 2 มิติ (Spatial Graph Clustering) แบ่งแยก Dialogue, SFX, และ Narration พร้อมการตรวจจับบอลลูนซ้อนทับ
- `balloonAwareGroupingService.ts` — วิเคราะห์รูปทรงและขอบเขตบอลลูนคำพูด manga/manhwa แยกคอลัมน์ซ้าย-ขวา ป้องกันการรวมข้อความข้ามบอลลูน

### 2.5 Canonical Documentation Architecture (`documents/`)
- เอกสารคู่มือ สถาปัตยกรรม และ Knowledge Base ทั้งหมดถูกจัดระเบียบรวมไว้ใน [documents/](file:///c:/App/Electron/PDF_Translator/documents/) ห้ามวางเกลื่อนที่ Root Directory (ที่ Root จะมีเพียง `context.md`, `README.md` และ Config ของโปรเจกต์เท่านั้น):
  - `documents/AI_MANIFEST.md` — Master AI Context Map, Common Workflows, และ System Manifest
  - `documents/ARCHITECTURE.md` — ภาพรวมสถาปัตยกรรมระบบ, Runtime Topology, Zero-GC Algorithms, และ DAOs
  - `documents/CHANGELOG.md` — บันทึกประวัติการเปลี่ยนแปลงทั้งหมดของแอปพลิเคชัน
  - `documents/Roadmap.md` — แผนงานพัฒนาปัจจุบันและงานตามลำดับความสำคัญ (P0–P5)
  - `documents/OCR_OPTIMIZATION.md` — กฎการจูน OCR, Normalization, Heuristics, และการควบคุมหน่วยความจำ
  - `documents/Knowledge.md` — กฎทอง สัจธรรมของระบบ และ Operating Principles
  - `documents/IMPROVEMENT_LOG.md` — ประวัติการปรับปรุง Optimization และประสิทธิภาพ
  - `documents/argostranslation_knowledge/` & `documents/image_processing_knowledge/` — เอกสารเฉพาะทางด้าน NMT และ Image Processing

---

## 🏷️ 3. Versioning & Cache Key Contracts

| Component | Current Version | Description |
|---|---|---|
| **Translation Cache** | `v64` | `OCR_TRANSLATION_CACHE_VERSION = 'v64'` ใน `useOCRTextLayerStore.ts` |
| **OCR Algorithm** | `230` | `OCR_ALGORITHM_VERSION = 230` ใน `ocrVersion.ts` |
| **OCR Raw Engine** | `7` | `OCR_RAW_VERSION = 7` ใน `ocrVersion.ts` |

### Cache Key Syntax
```text
ver:v64|ocr:paddleocr|ocrLang:eng|src:en|dst:th|mode:manga|translator:offline
```
- แคชคำแปลถูกตรวจสอบความถูกต้องโดย `ver:v{N}` โดยระบบจะกรองเอาเฉพาะแคชที่ `N >= 40`
- การเปลี่ยนหรือ Clear Engine จะไม่กระทบแคชของโมเดลอื่นเพราะแยกเก็บตาม `ocr_engine`

---

## 🔒 4. Golden Architectural Rules

1. **ห้ามแตะต้อง Git Repository โดยพลการ:** ห้ามสั่ง Commit, Revert หรือทำ Staged Changes โดยไม่ได้รับคำสั่งยืนยันชัดเจนจากผู้ใช้
2. **ห้ามคำสั่งทำลายล้าง (`rm -rf`, `dd`):** ตรวจสอบความปลอดภัยของ Path เสมอ
3. **No Legacy Tesseract Defaults:** ค่า Fallback Engine ทั้งหมดต้องเป็น `'paddleocr'` สำหรับ OCR และ `'offline'` สำหรับ Translation
4. **Zero-GC in Hot Paths:** ฟังก์ชันการจัดกลุ่มข้อความ, IoU คำนวณขอบเขต, Dice similarity, และ SFX Levenshtein Distance ที่ถูกเรียกซ้ำนับพันครั้งต่อหน้า ต้องใช้ TypedArray Buffer Pooling เพื่อป้องกัน Garbage Collection Spikes
5. **Cross-Document State Isolation:** การประมวลผลพื้นหลังของไฟล์ที่ไม่ได้เปิดอยู่ (non-active documents) ต้องบันทึกลง SQLite DB เท่านั้น ห้ามอัปเดต in-memory React/Zustand Store ของไฟล์ปัจจุบัน
6. **No Idle Web Workers & Daemons:** `VisionService.initialize()` ต้องไม่เปิด Web Worker Pool และ Health-Check Timer ค้างไว้ใน RAM โดยไร้ประโยชน์ และ Watchdog ของ Daemon ต้องไม่ spawn CLI process ซ้ำซ้อนขณะ Idle
7. **Canvas & PDF.js Lifecycle Discipline:** Headless Canvas ต้องถูกเคลียร์ Backing buffer (`width = 0; height = 0`) ทันทีเมื่อ abort/error และทุก `PDFPageProxy` ต้องสั่ง `page.cleanup()` ในบล็อก `finally` เสมอ
8. **Clean Root & Canonical Documentation:** เอกสารคู่มือ, changelog, และ technical deep dives ทั้งหมดต้องจัดเก็บอยู่ใน `documents/` เสมอ ห้ามวางไฟล์ `.md` กระจัดกระจายที่ Root โดยที่ Root จะมีเฉพาะ `context.md` (Master context) และ `README.md` (Repository entry) เท่านั้น

---

## 🔍 5. Architectural Scrutinize Notes & Watch-outs

1. **Page 5 Coordinate Shift Patch:**
   - ใน `LayerGroupingService.ts:459-488` มีโค้ดปรับพิกัดเฉพาะกรณี `if (ocrResult.pageNumber === 5)` สำหรับคำว่า `"AROUND ABOUT"`
   - **บริบท:** โค้ดส่วนนี้เป็น Regression Test Fixture Patch ของหน้าทดสอบ PaddleOCR coordinate drift หากต้องการนำออกในอนาคต ต้องปรับปรุง Test Fixture ใน `LayerGroupingService.test.ts:240-275` ควบคู่กัน
2. **Store Setter Boilerplate:**
   - ใน `useOCRTextLayerStore.ts` ใช้ `applyUpdatedPageOCR` เป็นฟังก์ชันกลางในการอัปเดต `allPagesOCR`, `ocrByPageEngine`, และ `currentPageOCR` ช่วยป้องกัน state inconsistency ระหว่างการเพิ่ม/ลบ/แก้ไขบรรทัด OCR
3. **Prepared Statements in DAOs:**
   - ทุก DAO ใน `electron/dao/` มี `stmtCache` เป็นของตนเองและถูกแคชผ่าน `getStmt(sql)` ทุกคำสั่ง (รวมถึง dynamic UPDATE permutations) ป้องกันการ Recompile SQL ในทุกรอบ IPC และรักษา `sentence_translation_cache` ไม่ให้ถูกลบเมื่อเคลียร์แคชระดับหน้า/ระดับไฟล์
4. **Resolved Dead Code & Purged Protocols:**
   - `tessdata` custom protocol handler: ลบออกจาก `electron/main.ts` เรียบร้อยแล้ว (ลด overhead ใน Main Process และขจัดโค้ดตกค้างของ Tesseract)
   - `useSegmentationStore`: ลบไฟล์และถอด subscriptions/renderers ที่ค้างอยู่ใน `PDFCanvas.tsx` และ `PDFPageOverlay.tsx` ออกเรียบร้อยแล้ว (ลด re-render overhead)
   - Uncalled Store Actions: `deleteOCRLine` ใน `useOCRTextLayerStore.ts` (ระบบใช้ `deleteLayer` + `deletedLineIndexesByPage` ใน `useLayerStore.ts` แทนเพื่อรักษา index mapping)
5. **System Connections & Wiring Status:**
   - **`loadPersistedQueue` ใน `useBackgroundQueueStore.ts`:** เชื่อมต่อเรียบร้อยแล้ว โดยโหลดค่าเริ่มต้นลง store ทันทีผ่าน `readPersistedQueue()` และเรียกซ้ำใน `App.tsx` on mount เพื่อกู้คืนคิวงานค้างหลังปิด-เปิดโปรแกรมใหม่
   - **`useAngleCls` ใน Viewer Settings:** เพิ่ม Checkbox สำหรับเปิด/ปิด Angle Classification ของ PaddleOCR ใน `OCREngineSelector.tsx` เรียบร้อยแล้ว
   - **`overlayThaiFontEnabled` ใน `useProjectStore.ts`:** ถูกควบคุมอัตโนมัติตาม `isThaiTargetLanguage` โดยผู้ใช้สามารถสลับระหว่างฟอนต์ไทยสวยงาม (`Mitr`, `Sarabun`, `SUPERMARKET` ฯลฯ) กับฟอนต์มาตรฐานของระบบผ่านตัวเลือก `System Thai (system-th)` ในแถบตั้งค่าได้โดยตรง
   - **Glossary Reactivity ใน `phraseCache`:** เชื่อมต่อการตรวจจับการเปลี่ยนแปลงของ `useGlossaryStore` เข้ากับ `cachedLookupShortPhraseTh` และ `clearPhraseCache` ใน `translationCoordinator.ts` เรียบร้อยแล้ว คำแปลที่ผู้ใช้แก้ไขจะมีผลทันทีโดยไม่ต้องรีสตาร์ตแอป
6. **Spanish Manga Translation & OCR Normalizer Pipeline (v65):**
   - ปรับปรุง `SPANISH_OCR_NOISE_REPAIRS` และ Dictionary ครอบคลุมชุดคำศัพท์/ประโยคสเปนชุดล่าสุด (Request 9 & 10) อย่างครบถ้วน เช่น `SUBMUNDO`, `DISFRACES`, `ESCAPE`, `YMENTIRAS.DELASSUYAS...`, `COLGANDO`, `OPORTUNIDAD`, `EXCITADAEN`, `PERDÖN`, `JODASx.AGUANTA UN` ฯลฯ
   - ป้องกันการตัดคำเพี้ยนใน `splitSpanishUppercaseCompounds`: บรรจุ `oportunidad`, `oportunidades`, `vigilancia`, `vigilante`, `vigilando`, `vigilar` ลงใน `SPANISH_COMPOUND_SPLIT_EXCLUSIONS` และ `quitatelo`, `quítatelo` ลงใน `SPANISH_LEGITIMATE_ENCLITICS`
   - **อัปเกรด `OCR_TRANSLATION_CACHE_VERSION = 'v65'`:** เพื่อ Invalidate แคชเดิมในฐานข้อมูล SQLite ที่เคยแปลค้างหรือแปลไม่สำเร็จ ทำให้เมื่อกด "Offline All Pages" หรือ "Offline Single Page" ระบบจะดึงคำแปลและกฎซ่อมข้อความใหม่ทั้งหมดมาแปลใหม่ทันทีโดยไม่ติดแคชเก่า
7. **Continuous Scroll & Comparison Mode Layer Sync:**
   - ใน `PDFCanvas.tsx`: ปลดล็อกเงื่อนไขบล็อก `isInteracting` ใน IntersectionObserver และ Scroll Tracker สำหรับ Continuous mode ทำให้การเลื่อนเมาส์บนจอ Split Comparison Mode (ไม่ว่าจะเลื่อนบน Canvas ซ้ายหรือขวา) สามารถตรวจจับหน้าและอัปเดต `currentPage` ใน `useProjectStore` ได้อย่างแม่นยำ
   - ใน `LayerPanel.tsx`: เพิ่ม Auto-Build Layers effect ตรวจจับการเปลี่ยนหน้าและเรียกสร้างเลเยอร์อัตโนมัติทันทีหากหน้านั้นยังไม่มีเลเยอร์ในสโตร์ แก้ไขปัญหาแผงควบคุมเลเยอร์ค้างอยู่ที่หน้าเดิมขณะเลื่อนอ่านแบบ Continuous Scroll
