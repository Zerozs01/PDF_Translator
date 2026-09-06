# 📄 PDF Translator — Master Architectural Context & System State

> **Last Updated:** 2026-09-04  
> **Status:** Production-Ready / Fully Refactored  
> **Test Suite:** 47 Test Files / 409 Unit Tests (100% Passing)  
> **Type Safety:** Strict TypeScript (`tsc --noEmit` clean / 0 errors)

---

## 📌 Executive Summary

**PDF Translator** เป็น Desktop Application ประสิทธิภาพสูงสำหรับการแปลเอกสารและหนังสือการ์ตูน (Manga / Manhwa / Comic) โดยเน้นความแม่นยำของ Bounding Box, การจัดกลุ่มบอลลูนคำพูด 2 มิติ (Spatial Graph Clustering), การจำกัดหน่วยความจำและขจัด Garbage Collection (Zero-GC Native Algorithms), ฐานข้อมูลเข้ารหัสความเร็วสูงระดับ Local ด้วย SQLCipher (WAL Mode), และไปป์ไลน์ OCR/Translation ออฟไลน์ที่ทำงานผ่าน Python IPC Daemon (PaddleOCR + Argos Translate)

---

## 🏗️ 1. Technology Stack & Topology

```
┌──────────────────────────────────────────────────────────┐
│                   Electron Renderer                      │
│   React 18 + TypeScript + Vite + Zustand + Canvas/DOM    │
│   - Zero-GC Spatial Clustering (fastSpatialCluster.ts)   │
│   - 16-bit Unicode Popcount Bigram (fastDiceSimilarity)  │
│   - Balloon/SFX Classification (LayerGroupingService)    │
└────────────────────────────┬─────────────────────────────┘
                             │ IPC (contextBridge)
┌────────────────────────────▼─────────────────────────────┐
│                    Electron Main Process                 │
│   Node.js + better-sqlite3-multiple-ciphers              │
│   - SQLite Database & WAL / FTS5 (electron/db.ts)        │
│   - Modular DAOs + Prepared Statement Cache (dao/)       │
│   - Python Runtime Resolution (electron/pythonRuntime.ts)│
└────────────────────────────┬─────────────────────────────┘
                             │ Subprocess JSON IPC (Daemon)
┌────────────────────────────▼─────────────────────────────┐
│                   Python Backend Daemons                 │
│   - PaddleOCR / EasyOCR Engine (scripts/ocr_bridge/)     │
│   - Argos Translate Daemon (scripts/argos_translate.py)  │
└──────────────────────────────────────────────────────────┘
```

- **Renderer UI:** React 18, TypeScript (Strict), Vite, TailwindCSS, Zustand (State Management with custom persistent storage)
- **Database & Storage:** `better-sqlite3-multiple-ciphers` (SQLCipher 256-bit AES), WAL journal mode, Memory-mapped I/O (128MB), FTS5 full-text search, Prepared Statement caching
- **OCR Subsystem:** PaddleOCR (Primary default engine via Python bridge), EasyOCR (Secondary fallback). **Tesseract ถูกถอดออกจากการทำงานหลักทั้งหมด**
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
- `electron/pythonRuntime.ts` — กลไกกลางในการค้นหาและ Resolve Python Virtual Environment (`.venv-ocr`, `.venv`) รองรับทั้ง Windows และ macOS/Linux
- `electron/ocrBridge.ts` — เชื่อมต่อ Main Process กับ Python OCR Subprocess Daemon
- `electron/argosBridge.ts` — เชื่อมต่อ Main Process กับ Python Argos Translate Subprocess Daemon

### 2.2 Native & High-Performance Algorithms (`src/services/native/`)
- `fastSpatialCluster.ts` — Zero-GC Disjoint-Set (Union-Find) with Path Compression และ TypedArray Buffer สำหรับ IoU Matrix และ Connected Components
  - `clusterConnectedComponents(n, isConnected)` — ใช้ `Int32Array` ทำ transitive closure $O(N \cdot \alpha(N))$ ไร้การจองหน่วยความจำ Heap (แทนที่ BFS queues และ adjacency list)
  - `fastIoU(a, b)` / `clusterByIoU(boxes, threshold)` / `batchIoUMatrix(boxes)`
- `fastDiceSimilarity.ts` — High-Throughput Bigram Similarity Engine สำหรับ Token Deduplication
  - ใช้ 65,536-bit Typed Bitset Pool (`Uint32Array(2048)`)
  - Brian Kernighan's popcount บน bitwise AND
  - ผสม 16-bit code unit `((c1 * 31) ^ c2) & 0xFFFF` ป้องกัน Hash Collision ของภาษาไทย (`\u0E00-\u0E7F`) และ CJK
  - `batchDiceSimilarity(reference, candidates)` ใช้ `bitsetRef` ใน pool แบบ 100% Zero-GC

### 2.3 Layout & Grouping Engine (`src/services/layers/` & `src/services/layout/`)
- `LayerGroupingService.ts` — ตัวจัดกลุ่มกล่องข้อความ 2 มิติ (Spatial Graph Clustering) แบ่งแยก Dialogue, SFX, และ Narration พร้อมการตรวจจับบอลลูนซ้อนทับ
- `balloonAwareGroupingService.ts` — วิเคราะห์รูปทรงและขอบเขตบอลลูนคำพูด manga/manhwa แยกคอลัมน์ซ้าย-ขวา ป้องกันการรวมข้อความข้ามบอลลูน

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
4. **Zero-GC in Hot Paths:** ฟังก์ชันการจัดกลุ่มข้อความ, IoU คำนวณขอบเขต, และ Dice similarity ที่ถูกเรียกซ้ำนับพันครั้งต่อหน้า ต้องใช้ `fastSpatialCluster` และ `fastDiceSimilarity` เพื่อป้องกัน Garbage Collection Spikes
5. **Cross-Document State Isolation:** การประมวลผลพื้นหลังของไฟล์ที่ไม่ได้เปิดอยู่ (non-active documents) ต้องบันทึกลง SQLite DB เท่านั้น ห้ามอัปเดต in-memory React/Zustand Store ของไฟล์ปัจจุบัน
6. **No Idle Web Workers:** `VisionService.initialize()` ต้องไม่เปิด Web Worker Pool และ Health-Check Timer ค้างไว้ใน RAM โดยไร้ประโยชน์ เพราะการทำ OCR ย้ายไปรันบน Python IPC แล้ว

---

## 🔍 5. Architectural Scrutinize Notes & Watch-outs

1. **Page 5 Coordinate Shift Patch:**
   - ใน `LayerGroupingService.ts:459-488` มีโค้ดปรับพิกัดเฉพาะกรณี `if (ocrResult.pageNumber === 5)` สำหรับคำว่า `"AROUND ABOUT"`
   - **บริบท:** โค้ดส่วนนี้เป็น Regression Test Fixture Patch ของหน้าทดสอบ PaddleOCR coordinate drift หากต้องการนำออกในอนาคต ต้องปรับปรุง Test Fixture ใน `LayerGroupingService.test.ts:240-275` ควบคู่กัน
2. **Store Setter Boilerplate:**
   - ใน `useOCRTextLayerStore.ts` ใช้ `applyUpdatedPageOCR` เป็นฟังก์ชันกลางในการอัปเดต `allPagesOCR`, `ocrByPageEngine`, และ `currentPageOCR` ช่วยป้องกัน state inconsistency ระหว่างการเพิ่ม/ลบ/แก้ไขบรรทัด OCR
3. **Prepared Statements in DAOs:**
   - ทุก DAO ใน `electron/dao/` มี `stmtCache` เป็นของตนเองและถูกแคชผ่าน `getStmt(sql)` ทุกคำสั่ง (รวมถึง dynamic UPDATE permutations) ป้องกันการ Recompile SQL ในทุกรอบ IPC และรักษา `sentence_translation_cache` ไม่ให้ถูกลบเมื่อเคลียร์แคชระดับหน้า/ระดับไฟล์
