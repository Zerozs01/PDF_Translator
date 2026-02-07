# 🏛️ MangaTranslate Rebirth Architecture

เอกสารฉบับนี้อธิบายโครงสร้างระบบและ Workflow การประมวลผลของแอปพลิเคชัน เพื่อให้การพัฒนามีทิศทางที่ชัดเจนและจัดการ Edge Case ได้อย่างเป็นระบบ

## 1. High-Level Architecture

เราใช้สถาปัตยกรรมแบบ **Decoupled Service Layers** เพื่อแยก UI ออกจากงานคำนวณหนักๆ:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Renderer Process (React)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   App.tsx   │  │   Stores    │  │ Components  │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         └────────────────┼────────────────┘                      │
│                          │                                       │
│                    electronAPI                                   │
│                    (Whitelist)                                   │
└──────────────────────────┼───────────────────────────────────────┘
                           │ IPC (Secure)
┌──────────────────────────┼───────────────────────────────────────┐
│                     Main Process (Electron)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │   IPC       │  │   Gemini    │  │   SQLite    │              │
│  │  Handlers   │  │   API       │  │   (WAL)     │              │
│  └─────────────┘  └─────────────┘  └─────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

- **Renderer Process (React):** จัดการเฉพาะการแสดงผลและการตอบสนองของผู้ใช้ (UI/UX)
- **Vision Worker (Web Worker):** รัน Tesseract.js สำหรับถอดรหัสข้อความ (ไม่บล็อก Main Thread)
- **Main Process (Electron):** จัดการระบบไฟล์, DB และ Gemini API (Secure Proxy)

## 2. Security Architecture

### 2.1 IPC Security Model

เราใช้ **Whitelist-based IPC** เพื่อป้องกันการโจมตี:

```typescript
// preload.ts
const ALLOWED_INVOKE_CHANNELS = [
  'db:save-document',
  'db:get-document',
  'db:save-ocr',
  'db:get-ocr',
  'gemini:translate', // API key stays in main process
] as const;
```

### 2.2 API Key Protection

Gemini API Key **ไม่** expose ที่ Frontend:

```
❌ Before: Renderer → Gemini API (API key in bundle)
✅ After:  Renderer → IPC → Main Process → Gemini API (API key in env)
```

### 2.3 Input Validation

ทุก IPC handler มี validation:

```typescript
// main.ts
const sanitizePath = (filepath: string): string => {
  return filepath.replace(/\.\.\//g, '').replace(/\.\.\\/g, '');
};
```

### 2.4 Electron Security Settings

```typescript
webPreferences: {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
  webSecurity: true,
}
```

## 3. Smart Segmentation V3 Pipeline (แก้ปัญหาไฟล์ผี)

เพื่อกำจัด "Ghost Regions" เราจะไม่พึ่งพิงโมเดล AI เพียงอย่างเดียว แต่จะใช้ **Hybrid Validation Pipeline**:

1.  **AI Detection (YOLOv8-seg):**
    - ทำหน้าที่หา "Candidate Regions" (Panel, Balloon, Text).
    - ผลลัพธ์จะเป็น Bounding Box และ Confidence Score.

2.  **OpenCV Refinement (Contour Analysis):**
    - นำ ROI จาก YOLO มาทำ `thresholding` และ `findContours` ในระดับพิกเซล.
    - **Filter Logic:**
      - ถ้าพื้นที่ (Area) เล็กเกินไป -> ตัดทิ้ง.
      - ถ้าไม่มีความหนาแน่นของพิกเซลสีดำ (Text density) -> ตัดทิ้ง.
      - ถ้าขอบซ้อนทับกัน (Overlap) -> ใช้ระบบ Z-index จัดลำดับ.

3.  **Stability System:**
    - นำผลลัพธ์มาทำ "Non-Max Suppression" (NMS) อีกครั้ง

## 4. UI Shell: Zero-Edge Sidebar

โครงสร้างหน้าจอจะใช้ **CSS Grid + React State**:

- **Layout Structure:**
    - `[Sidebar (0-288px)] | [Workspace (Flexible)] | [Right Panel (320px)]`
- **State Control:**
    - ใช้ Zustand เก็บสถานะ `isSidebarOpen`
    - Sidebar พับเก็บได้ 100% ด้วย CSS transition

## 5. State Management (Zustand Stores)

```
┌────────────────────────────────────────────────────────────┐
│                        Stores                               │
├─────────────────┬──────────────────┬───────────────────────┤
│ useProjectStore │ useUIStore       │ useSegmentationStore  │
│                 │                  │                       │
│ • file          │ • isSidebarOpen  │ • regions             │
│ • fileUrl       │ • zoom           │ • isProcessing        │
│ • currentPage   │ • pan            │ • processRequest      │
│ • totalPages    │ • activeTool     │                       │
│ • viewMode      │                  │                       │
└─────────────────┴──────────────────┴───────────────────────┘
```

## 6. Database Schema (SQLite)

```sql
-- Documents table with B-Tree index
CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filepath TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  total_pages INTEGER DEFAULT 0,
  last_accessed INTEGER,
  created_at INTEGER
);
CREATE INDEX idx_documents_filepath ON documents(filepath);

-- OCR Cache with composite key
CREATE TABLE ocr_cache (
  document_id INTEGER,
  page_number INTEGER,
  ocr_data TEXT, -- JSON string of OCRPageResult
  updated_at INTEGER,
  PRIMARY KEY (document_id, page_number)
);
CREATE INDEX idx_ocr_cache_lookup ON ocr_cache(document_id, page_number);
```

**Performance Pragmas:**
- `journal_mode = WAL` (Concurrency)
- `synchronous = NORMAL` (Faster writes)
- `cache_size = -64000` (~64MB RAM)

## 7. Error Handling

### 7.1 React Error Boundary

```typescript
// src/components/ErrorBoundary.tsx
<ErrorBoundary>
  <App />
</ErrorBoundary>
```

### 7.2 IPC Error Handling

```typescript
ipcMain.handle('db:save-document', async (_, data) => {
  if (!isValidString(data.filepath)) {
    throw new Error('Invalid input');
  }
  // ...
});
```

## 8. Future Considerations

### 8.1 Migration Path

- Phase out legacy `window.ipcRenderer` → use `window.electronAPI`
- Add unit tests with Vitest
- Implement rate limiting for Gemini API

### 8.2 Performance

- Lazy load Vision Worker after 2s delay
- Code splitting for heavy components (react-pdf, tesseract.js)
- IndexedDB fallback for larger OCR cache

## 9. OCR Cache & File Source (2026-02-07)

- OCR cache auto-loads on page change when language, DPI, and `pageSegMode` match.
- Current Page button forces re-OCR (cache bypass) for accuracy after code changes.
- PDF rendering prefers in-memory `fileData` and clones buffers per `Document` to avoid detached `ArrayBuffer` errors.
- Native file open via `fs:open-file` guarantees real file paths for Recent files.
