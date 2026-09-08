# 🏛️ Master System Architecture & Process Flowcharts

> **Last Updated:** 2026-09-08  
> **Status:** Synchronized with [context.md](file:///c:/App/Electron/PDF_Translator/context.md) & [AI_MANIFEST.md](file:///c:/App/Electron/PDF_Translator/documents/AI_MANIFEST.md)  
> **Test Suite:** 31 Test Files / 372 Tests (100% Passing) | Strict TypeScript Clean

---

## 📌 1. Executive Summary & Core Principles

**PDF Translator** เป็น Desktop Application ประสิทธิภาพสูงที่ออกแบบมาสำหรับการแปลเอกสารและหนังสือการ์ตูน (Manga / Manhwa / Comic) โดยผสานสถาปัตยกรรม 3 ชั้น (Electron Renderer + Node.js Main Process + Python IPC Daemons) เพื่อตอบสนองความต้องการด้านความเร็ว ความแม่นยำ และความเป็นส่วนตัว:

1. **Spatial Graph Clustering:** จัดกลุ่มกล่องข้อความ 2 มิติ (Speech Balloons) ป้องกันการรวมข้อความข้ามช่องคำพูดและแยกแยะประเภท Dialogue, SFX, และ Narration
2. **Zero-GC High-Throughput Algorithms:** อัลกอริทึม Disjoint-Set Union บน `Int32Array` ([fastSpatialCluster.ts](file:///c:/App/Electron/PDF_Translator/src/services/native/fastSpatialCluster.ts)) และ 65,536-bit Bitset Bigram Popcount ([fastDiceSimilarity.ts](file:///c:/App/Electron/PDF_Translator/src/services/native/fastDiceSimilarity.ts)) ป้องกัน Garbage Collection Pauses
3. **Encrypted Local Storage:** ฐานข้อมูลระดับ Local ด้วย SQLCipher (256-bit AES) ผ่าน `better-sqlite3-multiple-ciphers` พร้อม WAL journal mode, 128MB Memory-mapped I/O, FTS5 Full-text Search, และ Prepared Statement Cache
4. **Offline IPC Daemons:** ไปป์ไลน์ OCR และ NMT ทำงานแบบ Subprocess Long-running Daemons ผ่าน JSON Lines IPC ([external_ocr_bridge.py](file:///c:/App/Electron/PDF_Translator/scripts/external_ocr_bridge.py) สำหรับ PaddleOCR/EasyOCR และ [argos_translate_bridge.py](file:///c:/App/Electron/PDF_Translator/scripts/argos_translate_bridge.py) สำหรับ Argos Translate)

---

## 🏗️ 2. System Topology & Process Boundaries

```mermaid
flowchart TB
    subgraph UI_Layer["🖥️ Electron Renderer (React 18 + Zustand + Vite)"]
        UI_View["PDF Canvas & Interactive Overlay\n(PDFCanvas / PDFPageOverlay)"]
        UI_Stores["Zustand State Stores\n(useLayerStore, useProjectStore, useOCRStore, useQueueStore)"]
        UI_Native["Zero-GC Native Algorithms\n(fastSpatialCluster, fastDiceSimilarity)"]
        UI_Grouping["Spatial Balloon Grouping\n(LayerGroupingService, balloonAwareGrouping)"]
    end

    subgraph Main_Layer["⚙️ Electron Main Process (Node.js)"]
        Main_IPC["IPC Handler Hub (88 Handlers)\nelectron/ipc/"]
        Main_DB["SQLCipher Database (WAL Mode + FTS5)\nelectron/db.ts"]
        Main_DAOs["Prepared Statement DAOs\n(DocumentDAO, OCRCacheDAO, TranslationDAO, etc.)"]
        Main_PyBridge["Python Daemon Managers\n(ocrBridge.ts, argosBridge.ts)"]
    end

    subgraph Daemon_Layer["🐍 Python Subprocess Daemons"]
        Daemon_OCR["OCR Daemon (scripts/external_ocr_bridge.py)\nPaddleOCR (Primary) / EasyOCR (Fallback)"]
        Daemon_NMT["Translation Daemon (scripts/argos_translate_bridge.py)\nArgos Translate / CTranslate2 M2M100"]
    end

    UI_View <--> UI_Stores
    UI_Stores <--> UI_Grouping
    UI_Grouping <--> UI_Native
    UI_Stores <== "IPC contextBridge (window.electronAPI)" ==> Main_IPC

    Main_IPC <--> Main_DAOs
    Main_DAOs <--> Main_DB
    Main_IPC <--> Main_PyBridge

    Main_PyBridge <== "JSON Lines IPC (stdin/stdout)" ==> Daemon_OCR
    Main_PyBridge <== "JSON Lines IPC (stdin/stdout)" ==> Daemon_NMT
```

---

## 🔄 3. End-to-End Processing Flowcharts

### 3.1 ภาพรวมกระบวนการทำงานทั้งระบบ (Full Lifecycle Flowchart)

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 ผู้ใช้งาน
    participant Renderer as 🖥️ Renderer UI
    participant Main as ⚙️ Electron Main
    participant DB as 💾 SQLite (SQLCipher)
    participant PyOCR as 🐍 Python OCR Daemon
    participant PyNMT as 🐍 Python NMT Daemon
    participant Cloud as ☁️ Gemini AI (Optional)

    User->>Renderer: ลากไฟล์ PDF หรือรูปภาพเข้ามา (Drop / Open File)
    Renderer->>Main: window.electronAPI.db.getOrCreateDocument()
    Main->>DB: ตรวจสอบหรือสร้างเอกสารในฐานข้อมูล
    DB-->>Main: คืนค่า documentId
    Main-->>Renderer: documentId & File Identity Ready

    Note over Renderer: ผู้ใช้เลือกหน้า หรือเริ่มประมวลผล (Foreground หรือ Background Queue)

    Renderer->>Main: window.electronAPI.ocr.processPage(image, engine, options)
    Main->>DB: ตรวจสอบ OCR Cache (OCRCacheDAO)
    alt แคช OCR มีอยู่แล้วใน DB
        DB-->>Main: คืนค่าแคช OCR (Fast Cache Hit)
    else แคชไม่มีใน DB
        Main->>PyOCR: ส่ง JSON Payload ขอทำ OCR (PaddleOCR/EasyOCR)
        PyOCR-->>Main: คืนค่า BBoxes, Text, Confidence
        Main->>DB: บันทึกลงตาราง ocr_cache_engine
    end
    Main-->>Renderer: OCR Result (Lines, BBoxes, Words)

    Note over Renderer: 🧩 กรอง Ghost/Noise -> Zero-GC Clustering -> จัดกลุ่มบอลลูนคำพูด (LayerGroupingService)

    alt โหมดแปลออฟไลน์ (Offline Mode)
        Renderer->>Main: window.electronAPI.translation.translateBatch(items, source, target)
        Main->>PyNMT: ส่งประโยคเข้า Argos Translate Daemon
        PyNMT-->>Main: ผลการแปลภาษา
        Main-->>Renderer: Translated Results
    else โหมด AI (Gemini Mode)
        Renderer->>Cloud: แปลผ่าน Gemini API (Context-aware Prompting)
        Cloud-->>Renderer: Translated Results
    end

    Note over Renderer: 🎨 จัดวางข้อความลง TextLayer -> ปรับฟอนต์ไทยอัตโนมัติ -> แสดงผลบน Interactive Canvas Overlay
    Renderer-->>User: แสดงผลหน้าเอกสารที่แปลแล้วแบบ Interactive
```

---

### 3.2 กระบวนการจัดกลุ่มข้อความและบอลลูนคำพูด (OCR & Spatial Layout Reconstruction)

```mermaid
flowchart TD
    Start(["📥 Raw OCR Results จาก Python Bridge"]) --> Sanitize["1. BBox Sanitization & Normalization\n(ตรวจสอบขอบเขตพิกัด 0-1, คลีนอักขระแปลกปลอม)"]
    Sanitize --> GhostFilter["2. Ghost Line & Garbage Filtering\n(ocrGhostGate / ghostFilter.ts)\n- กรองลายน้ำ, noise, ฟองสบู่อากาศ, ขอบหน้ากระดาษ"]
    GhostFilter --> QuadAngle["3. Quad Coordinate & Angle Detection\n(ตรวจจับข้อความเอียงแนวทแยง / แนวตั้ง CJK)"]
    QuadAngle --> SpatialUnion["4. Zero-GC Spatial Clustering (fastSpatialCluster.ts)\n- คำนวณ IoU Matrix ด้วย TypedArrays\n- Disjoint-Set Union เชื่อมโยงบรรทัดที่มี Horizontal Overlap >= 50%"]
    SpatialUnion --> BalloonAware["5. Balloon-Aware Boundary Enforcement\n(balloonAwareGroupingService.ts)\n- แยกคอลัมน์ซ้าย-ขวา ป้องกันการรวมข้อความข้ามบอลลูน\n- ดักจับ Ellipsis (...) และ Dialogue Boundary"]
    BalloonAware --> TypeClass["6. Semantic Classification\n- แยกแยะประเภท: Dialogue, SFX, หรือ Narration"]
    TypeClass --> LayerBuild["7. Build Text Layers & Groups (buildLayerGroupsFromOCR)\n- สร้าง LayerStore State (BBox, Rotation, Font Scale)"]
    LayerBuild --> Done(["✨ เข้าสู่ useLayerStore พร้อมสำหรับการแปลและเรนเดอร์"])
```

---

### 3.3 กระบวนการแปลภาษาและลำดับชั้นของแคช (Multi-Tier Translation Flow)

```mermaid
flowchart TD
    Req(["📝 Request แปลกลุ่มข้อความ (Prepared Groups)"]) --> CheckMem["1. ตรวจสอบ In-Memory Cache ใน useOCRTextLayerStore\n(Key: ver:v64|ocr:...|src:...|dst:...|mode:...)"]
    CheckMem -- "Cache Hit" --> ApplyMem["นำผลการแปลมาใช้ทันที (0ms Latency)"]
    CheckMem -- "Cache Miss" --> CheckSentenceDB["2. ตรวจสอบ Sentence Cache ใน SQLite DB\n(ตาราง sentence_translation_cache)"]

    CheckSentenceDB -- "พบครบทุกประโยค" --> MergeDB["รวมผลจาก DB -> บันทึกลง Memory Cache"]
    CheckSentenceDB -- "มีประโยคใหม่ที่ยังไม่เคยแปล" --> ExecTrans["3. ส่งประโยคที่ขาดเข้า Translation Engine"]

    ExecTrans --> EngineBranch{"เลือก Engine"}
    EngineBranch -- "Offline (Default)" --> ArgosNMT["Argos Translate Daemon\n(scripts/argos_translate_bridge.py)"]
    EngineBranch -- "AI" --> GeminiNMT["Google Gemini API\n(Context & Safety Protected)"]

    ArgosNMT --> GuardCheck["4. Translation Quality & Safety Guards\n- Boilerplate Hallucination Guard\n- CJK/Hangul Untranslated Carryover Guard\n- Thai Carryover Guard"]
    GeminiNMT --> GuardCheck

    GuardCheck -- "ตรวจพบ Carryover / ล้มเหลว" --> Fallback["เปิดระบบ Fallback\n(Conversational Fallback Dictionary / Gemini Auto-retry)"]
    GuardCheck -- "ผลการแปลสมบูรณ์" --> SaveDB["5. บันทึกผลลัพธ์ลง SQLite DB\n- ตาราง ocr_translation_cache (ระดับหน้า)\n- ตาราง sentence_translation_cache (ระดับประโยค)"]
    Fallback --> SaveDB

    SaveDB --> SyncLayer["6. Synchronize ไปยัง useLayerStore\n(mergeLayersAndGroups รักษาตำแหน่งที่ผู้ใช้แก้ไข)"]
    MergeDB --> SyncLayer
    ApplyMem --> SyncLayer
    SyncLayer --> RenderOverlay(["🎨 เรนเดอร์บน PDFPageOverlay ด้วย OverlayFontPreset"])
```

---

### 3.4 สถาปัตยกรรมคิวงานเบื้องหลัง (Background Queue Processor Lifecycle)

```mermaid
stateDiagram-v2
    [*] --> Initialized: App Startup
    Initialized --> Restoring: readPersistedQueue() จาก localStorage
    Restoring --> Ready: โหลดงานค้างเดิมกลับเข้า Store (status = 'queued')

    state Ready {
        [*] --> Idle
        Idle --> Enqueued: ผู้ใช้สั่งแปลทุกหน้า / ทำ OCR ทั้งเล่ม (addJob)
        Enqueued --> Processing: getNextPendingJob() เลือกงานที่มี priority สูงสุด
        
        state Processing {
            [*] --> RenderPageImage: เรนเดอร์หน้าเอกสารเป็น Buffer
            RenderPageImage --> RunOCR: สั่งรัน OCR ผ่าน Daemon
            RunOCR --> SaveDB: บันทึกแคช OCR ลง DB ทันที
            SaveDB --> RunTranslate: แปลภาษาตามโหมดที่กำหนด
            RunTranslate --> SaveTransDB: บันทึกแคชคำแปลลง DB ทันที
            SaveTransDB --> CheckNextPage: มีหน้าถัดไปหรือไม่?
            CheckNextPage --> RenderPageImage: ยังมีหน้าเหลือ (Loop)
            CheckNextPage --> Completed: ประมวลผลครบทุกหน้า
        }

        Processing --> Paused: ผู้ใช้กด Pause หรือหน้าหลัก Foreground ทำงานอยู่ (isPausedForForeground)
        Paused --> Processing: ผู้ใช้กด Resume หรือ Foreground เสร็จสิ้น
        Processing --> Cancelled: ผู้ใช้สั่ง Cancel Job
    }

    Completed --> PersistState: persistQueue() อัปเดต localStorage
    Cancelled --> PersistState
    Paused --> PersistState
```

---

## 🗄️ 4. Data Layer & SQLite Schema Architecture

ฐานข้อมูลใช้ **SQLCipher 256-bit AES** โดยเปิดใช้งาน **WAL (Write-Ahead Logging)** และ Memory-Mapped I/O 128MB เพื่อรองรับ Concurrency สูงระหว่าง Foreground Canvas และ Background Queue:

```mermaid
erDiagram
    documents ||--o{ document_tags : has
    tags ||--o{ document_tags : tagged_with
    projects ||--o{ documents : contains
    documents ||--o{ ocr_cache_engine : caches_ocr
    documents ||--o{ ocr_translation_cache : caches_translation
    glossary_entries ||--o{ documents : optional_link

    documents {
        int id PK
        text filename
        text filepath UK
        text title
        int total_pages
        int file_size
        int is_favorite
        int project_id FK
        text created_at
        text updated_at
    }

    projects {
        int id PK
        text name
        int parent_id FK
        text color
        int sort_order
    }

    tags {
        int id PK
        text name UK
        text color
    }

    ocr_cache_engine {
        int id PK
        int document_id FK
        int page_number
        text ocr_engine
        text ocr_language
        text result_json
        text updated_at
    }

    ocr_translation_cache {
        int id PK
        int document_id FK
        int page_number
        text cache_key
        text translated_data
        text updated_at
    }

    sentence_translation_cache {
        int id PK
        text source_hash UK
        text source_text
        text translated_text
        text source_lang
        text target_lang
        text engine
    }

    glossary_entries {
        int id PK
        text source_text
        text target_text
        text source_lang
        text target_lang
        text type
        int is_active
    }
```

---

## ⚡ 5. Native & High-Performance Optimization (Zero-GC)

ใน Hot Paths ที่ต้องวนลูปคำนวณมากกว่า 10,000 ครั้งต่อหน้าเอกสาร ระบบหลีกเลี่ยงการสร้าง JavaScript Objects ใน Heap เพื่อขจัดปัญหา V8 Garbage Collection Stutter:

### 5.1 Zero-GC Connected Components ([fastSpatialCluster.ts](file:///c:/App/Electron/PDF_Translator/src/services/native/fastSpatialCluster.ts))
- ใช้ `Int32Array(n)` ทำ Disjoint-Set Union (Union-Find) พร้อม Path Compression
- Transitive Closure มีความซับซ้อนระดับ $O(N \cdot \alpha(N))$ โดย $\alpha$ คือ Inverse Ackermann Function
- ไม่มีการสร้าง Array หรือ Queue ชั่วคราว (Typed Buffer Pool ถูกนำกลับมาใช้ซ้ำ 100%)

### 5.2 65,536-bit Typed Bitset Similarity ([fastDiceSimilarity.ts](file:///c:/App/Electron/PDF_Translator/src/services/native/fastDiceSimilarity.ts))
- ใช้ Bitset Pool ขนาดคงที่ `Uint32Array(2048)` รองรับ Space ได้ถึง 65,536 Bigram Hashes
- คำนวณความเหมือนของข้อความ (Sørensen–Dice Coefficient) โดยใช้ **Brian Kernighan's popcount** บน bitwise AND (`a & b`)
- ใช้สมการ Hash: `((char1 * 31) ^ char2) & 0xFFFF` เพื่อรองรับรหัสภาษาไทย (`\u0E00-\u0E7F`) และ CJK โดยไม่เกิด Hash Collision

---

## 🏷️ 6. Versioning Contracts & System Keys

| สัญญาข้อมูล (Contract) | ค่าเวอร์ชันปัจจุบัน | แหล่งอ้างอิงความจริง (Source of Truth) |
|---|---|---|
| **Translation Cache Version** | `v64` | `OCR_TRANSLATION_CACHE_VERSION` ใน [useOCRTextLayerStore.ts](file:///c:/App/Electron/PDF_Translator/src/stores/useOCRTextLayerStore.ts) |
| **OCR Algorithm Version** | `230` | `OCR_ALGORITHM_VERSION` ใน [ocrVersion.ts](file:///c:/App/Electron/PDF_Translator/src/services/vision/ocrVersion.ts) |
| **OCR Raw Engine Version** | `7` | `OCR_RAW_VERSION` ใน [ocrVersion.ts](file:///c:/App/Electron/PDF_Translator/src/services/vision/ocrVersion.ts) |

### รูปแบบโครงสร้าง Cache Key
```text
ver:v64|ocr:paddleocr|ocrLang:eng|src:en|dst:th|mode:manga|translator:offline
```
- ระบบจะยอมรับเฉพาะแคชที่ `ver:v{N}` โดยที่ $N \ge 40$ เท่านั้น แคชเวอร์ชันเก่ากว่าจะถูก Invalidate อัตโนมัติ
- แคชของแต่ละ Engine ถูกแยกออกจากกันในระดับ Database Partitioning ทำให้การล้างแคช Engine หนึ่งไม่กระทบแคชของ Engine อื่น
