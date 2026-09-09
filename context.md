# Architecture Context & Index (L1)

## 1. System High-Level
- Summary: แอปพลิเคชันเดสก์ท็อปสำหรับการแปลเอกสารและมังงะ/มันฮวาแบบออฟไลน์ 100% พร้อมระบบจัดกลุ่มบอลลูนคำพูดและฐานข้อมูลเข้ารหัส
- Core Stack:
  - Frontend: React 19, TypeScript (Strict), Vite, TailwindCSS v4
  - Backend: Electron 39 (Node.js)
  - Database: SQLite via better-sqlite3-multiple-ciphers (SQLCipher, WAL, FTS5)
  - State: Zustand (5.x) with custom persistent storage
  - Auth: Local Passphrase / PIN with PBKDF2 key derivation
  - IPC: Electron contextBridge + Modular typed IPC channels
  - Python Daemons: Subprocess JSONL bridge for PaddleOCR / EasyOCR and Argos Translate
- Key Entry Points:
  - Client / UI: src/main.tsx -> src/App.tsx
  - Server / Main Process: electron/main.ts (Preload: electron/preload.ts)
  - Models / Schemas: src/types/index.ts, src/types/electron.d.ts, electron/db.ts

## 2. Architecture & Data Flow
User Interaction -> React Component / Canvas -> Zustand Store / Hook -> IPC Bridge -> Electron Main / DAO / Python Subprocess -> SQLite / Canvas
- Global State:
  - src/stores/useProjectStore.ts (Active document, pages, zoom, app modes)
  - src/stores/useOCRTextLayerStore.ts (OCR bounding boxes, lines, detection engine cache)
  - src/stores/useLayerStore.ts (Translated layers, positions, balloon groups)
  - src/stores/useBackgroundQueueStore.ts (Batch background OCR and translation tasks)
  - src/stores/useGlossaryStore.ts (User custom dictionary, terms, SFX overrides)
  - src/stores/useFileBrowserStore.ts (Project tree, file management, favorites)
  - src/stores/useExportStore.ts (Export queue, modal state, output parameters)
  - src/stores/useAuthStore.ts (Session lock state, auth status)
  - src/stores/useUIStore.ts (Sidebar toggles, modals, viewer layout state)
- Shared Modules / Services:
  - src/services/ocr/ (Background OCR pipeline, text normalization, heuristics)
  - src/services/translation/ (Translation orchestration, offline NMT, dictionaries)
  - src/services/layers/ & src/services/layout/ (Spatial grouping, balloon detection)
  - src/services/native/ (Zero-GC Union-Find clustering, bigram popcount similarity)
  - src/services/pdf/ (PDF.js rendering, text layer, searchable PDF generator)
  - electron/dao/ (Data access objects with prepared statement caching)

## 3. Directory Map (Critical Only)
- electron/ -> จัดการวงจรชีวิต Main Process, การเข้ารหัสฐานข้อมูล, และ Subprocess Bridges
- electron/ipc/ -> ตัวจัดการ IPC รายโมดูล (DB, OCR, Translation, Auth, Export, FS)
- electron/dao/ -> โมดูล Data Access Object พร้อมระบบ Prepared Statement Caching
- scripts/ -> สคริปต์ Python OCR Bridge, Argos NMT Bridge, และการทดสอบ Benchmark
- src/components/ -> React UI Components (Viewer, PDF Canvas, Layers, Export, Modals)
- src/hooks/ -> Custom React Hooks ควบคุม Business Flow (Translation, Export, Queue Sync)
- src/services/ -> Business Logic หลัก (OCR, Translation, Layout, Native Buffers, PDF)
- src/stores/ -> Zustand Stores จัดการ State ส่วนกลางและการบันทึกค่าถาวร
- src/types/ -> TypeScript Type Definitions, IPC Contracts, และ Data Schemas
- src/export/ -> Headless Canvas Compositing และการเรนเดอร์เอกสารสำหรับพิมพ์/ส่งออก
- documents/ -> เอกสารสถาปัตยกรรมฉบับเต็ม, บันทึกการเพิ่มประสิทธิภาพ, และ Knowledge Base

## 4. Feature-to-File Routing
- OCR Processing & Lifecycle
  - Primary: src/services/ocr/BackgroundQueueProcessor.ts
  - Secondary: electron/ocrBridge.ts, electron/ocrDaemonManager.ts, src/services/ocr/ocrTextNormalizer.ts
  - Scope: ควบคุมคิว OCR เบื้องหลังและสื่อสารกับ Python Daemon
- Offline Translation Pipeline
  - Primary: src/services/translation/translationCoordinator.ts
  - Secondary: src/hooks/useDocumentTranslation.ts, src/services/translation/offlineTranslationService.ts, electron/argosBridge.ts
  - Scope: ประสานงานแปลออฟไลน์ กรองคำสแลง และเชื่อมต่อพจนานุกรม
- Text Layer Grouping & Balloon Detection
  - Primary: src/services/layers/LayerGroupingService.ts
  - Secondary: src/services/layout/balloonAwareGroupingService.ts, src/services/native/fastSpatialCluster.ts, src/services/layout/dialogueGroupingService.ts
  - Scope: จัดกลุ่มกล่องข้อความ 2 มิติและตรวจจับขอบเขตบอลลูน
- Canvas & Document Overlay Rendering
  - Primary: src/components/PDF/PDFCanvas.tsx
  - Secondary: src/components/PDF/PDFPageOverlay.tsx, src/components/Layers/InteractiveLayerOverlay.tsx, src/services/pdf/TextLayerService.ts
  - Scope: เรนเดอร์หน้า PDF และวาดเลเยอร์ข้อความแปลซ้อนทับ
- Layer Editing & Manipulation UI
  - Primary: src/components/Layers/LayerPanel.tsx
  - Secondary: src/stores/useLayerStore.ts, src/components/Layers/LayerInlineEditor.tsx, src/components/Layers/LayerSelectionBox.tsx
  - Scope: แผงควบคุมเลเยอร์ข้อความและการแก้ไขคำแปลแบบเรียลไทม์
- Database & Persistent Storage
  - Primary: electron/db.ts
  - Secondary: electron/dao/index.ts, electron/ipc/dbIpc.ts, src/services/dbService.ts
  - Scope: จัดการฐานข้อมูล SQLite เข้ารหัสและแคชข้อมูลคำแปล
- Document Export & Merging
  - Primary: src/hooks/useExportOrchestration.ts
  - Secondary: src/export/renderExportPrintPage.ts, electron/pdfExportService.ts, src/components/Export/DocumentExportModal.tsx
  - Scope: รวมภาพและเลเยอร์คำแปลส่งออกเป็น PDF/Image คุณภาพสูง
- Security & User Authentication
  - Primary: electron/authService.ts
  - Secondary: electron/ipc/authIpc.ts, src/stores/useAuthStore.ts, src/components/Auth/LoginScreen.tsx
  - Scope: จัดการรหัสผ่าน ปลดล็อกฐานข้อมูล และสิทธิ์เข้าถึงข้อมูล
- Project & Library Management
  - Primary: src/stores/useProjectStore.ts
  - Secondary: src/stores/useFileBrowserStore.ts, src/services/libraryService.ts, src/components/Home/UploadScreen.tsx
  - Scope: จัดการโครงการ ไฟล์เอกสาร รายการโปรด และสถานะการนำเข้า

## 5. High-Risk & Coupling Zones
- Shared State / Types: src/types/index.ts & src/types/electron.d.ts -> กระทบ: สัญญา IPC, Zustand Stores, และการทำงานร่วมกันทุกเลเยอร์
- API Contracts / IPC Channels: electron/preload.ts & electron/ipc/ -> กระทบ: การเรียกใช้ฟังก์ชันข้าม Process ระหว่าง Renderer และ Main
- Database Schema / Migrations: electron/db.ts -> ข้อควรระวัง: กระทบโครงสร้างตาราง SQLite, คีย์การเข้ารหัส SQLCipher, และ Data Integrity
- Spatial Clustering & Native Buffers: src/services/native/fastSpatialCluster.ts -> กระทบ: ประสิทธิภาพ Zero-GC และความแม่นยำในการจัดกลุ่มบอลลูน
- OCR & Translation Subprocess Bridges: scripts/external_ocr_bridge.py & scripts/argos_translate_bridge.py -> กระทบ: ไปป์ไลน์ JSONL IPC, ความเสถียรของ Daemon, และ Watchdog

## 6. Agent Navigation Rules
- เริ่มงานใหม่ด้วยการเทียบหา Feature ใน Routing Map เสมอ
- อ่านเฉพาะ Primary File ก่อน ห้ามอ่าน Secondary หรือ scan ทั้งโฟลเดอร์เว้นแต่ Primary จะมีข้อมูลไม่พอ
- Source Consistency:
  - หากพบ path ใน context.md ไม่ตรงกับ Codebase ให้ยึด Codebase เป็นหลัก และอัปเดต context.md ทันที
  - ห้ามแก้ไข โยกย้าย หรือสร้างไฟล์โค้ดใหม่ขึ้นมาเพียงเพื่อให้ตรงกับ context.md เด็ดขาด
