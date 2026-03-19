# 🚀 MangaTranslate Rebirth

## Next-Gen Local OCR & Manga Translation Engine

แอปพลิเคชันเวอร์ชันยกเครื่องใหม่ (Rebirth) ที่สร้างขึ้นเพื่อแก้ปัญหาความล่าช้าและการแยกแยะองค์ประกอบภาพที่ไม่แม่นยำ โดยเน้นการประมวลผลแบบ Offline 100% และมี UI ที่ยืดหยุ่นสูงสุด

> 📋 ดู [CHANGELOG.md](./CHANGELOG.md) สำหรับประวัติการอัปเดต

## 🎯 Vision & Goals

- **Zero-Latency UI:** โครงสร้างที่แยกการประมวลผลหนักๆ ออกจาก Main Thread เพื่อให้แอปตอบสนองทันทีที่เปิด
- **Edge-to-Edge Workspace:** UI แบบ File Explorer ที่พับ Sidebar ได้สนิท (Zero Margin) เพื่อเพิ่มพื้นที่ให้ Canvas มากที่สุด
- **Ghost-Free Segmentation:** ใช้สถาปัตยกรรม Hybrid (YOLOv8-seg + OpenCV Refinement) เพื่อลด Noise และ "ไฟล์ผี" ที่ไม่ต้องการ
- **Contextual Gemini Translation:** ระบบส่ง Prompt ที่มีความฉลาดตามประเภทเอกสาร (มังงะ/วิชาการ/ทางการ)

## � Security Features

- ✅ **Secure API Key Storage:** Gemini API Key เก็บใน Main Process ไม่ expose ที่ Frontend
- ✅ **IPC Whitelist:** เฉพาะ channels ที่อนุญาตเท่านั้นที่สามารถเรียกได้จาก Renderer
- ✅ **Input Validation:** ทุก IPC handler มี validation และ sanitization
- ✅ **Electron Best Practices:** contextIsolation, sandbox, webSecurity enabled

## �🛠 Tech Stack (The Clean Core)

| Layer         | Technology                              |
| ------------- | --------------------------------------- |
| **Runtime** | Electron + Vite |
| **Frontend** | React (Functional Components + Hooks) |
| **Styling** | Tailwind CSS |
| **State** | Zustand (Fast, Minimalist) |
| **AI/OCR** | Tesseract.js (Local OCR) |
| **Translation** | Google Gemini API (via Secure IPC) |
| **Database** | better-sqlite3 (WAL Mode) |
| **PDF** | react-pdf + pdf-lib |

## 🏗️ Project Structure

```text
/
├── electron/               # Main process & Preload scripts
│   ├── main.ts            # IPC handlers, Gemini API (secure)
│   ├── preload.ts         # Whitelist-based API exposure
│   └── db.ts              # SQLite with WAL & Indexes
├── src/
│   ├── components/         # React UI Components
│   │   ├── ErrorBoundary.tsx  # Error handling
│   │   ├── Home/           # Upload screen
│   │   ├── Layout/         # Sidebar components
│   │   ├── OCR/            # OCR Text Layer panel
│   │   └── PDF/            # PDF viewer canvas
│   ├── services/           # Business Logic
│   │   ├── dbService.ts    # Database operations
│   │   ├── pdf/            # PDF processing
│   │   └── vision/         # OCR Web Workers
│   ├── stores/             # Zustand Stores
│   │   ├── useProjectStore.ts
│   │   ├── useUIStore.ts
│   │   ├── useSegmentationStore.ts
│   │   └── useOCRTextLayerStore.ts
│   ├── types/              # TypeScript Types
│   │   ├── index.ts        # Core types
│   │   └── electron.d.ts   # Electron API declarations
│   └── App.tsx             # Main Shell
└── public/                 # Static assets
```

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Setup

สร้างไฟล์ `.env` ที่ Root:

```env
GEMINI_API_KEY=your_api_key_here
```

> ⚠️ **SECURITY:** ไฟล์ `.env` อยู่ใน `.gitignore` - อย่า commit ไฟล์นี้!

### 3. Development

```bash
npm run dev
```

### 4. Build for Production

```bash
npm run build
```

## 🤝 Roadmap

- [x] **Phase 1:** UI Shell & Toggle Sidebar
- [x] **Phase 2:** Canvas Engine & Image Loading
- [x] **Phase 3:** OCR Text Layer Integration
- [x] **Phase 4:** Security Hardening (v1.1.0)
- [ ] **Phase 5:** Vision Worker & YOLO Integration
- [ ] **Phase 6:** Advanced Segmentation V3
- [ ] **Phase 7:** Gemini Translation Bridge (Advanced)

See `Roadmap.md` in this folder for the active OCR roadmap and code-status audit.

## 📝 Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) - สรุปสถาปัตยกรรม (ดูฉบับเต็มที่ root)
- [OCR_OPTIMIZATION.md](./OCR_OPTIMIZATION.md) - แนวทางจูน OCR และจุดที่กินเวลา
- [LOCAL_TESSDATA.md](./LOCAL_TESSDATA.md) - ตั้งค่า OCR ภาษาแบบออฟไลน์
- [Roadmap.md](./Roadmap.md) - แผน OCR หลัก + สถานะเทียบโค้ดจริง
- [CHANGELOG.md](./CHANGELOG.md) - ประวัติเอกสารในโฟลเดอร์นี้
  
> เอกสารฉบับเต็มอยู่ที่ root: `ARCHITECTURE.md`, `CHANGELOG.md`

## 🐛 Known Issues

ดู [Issues](https://github.com/Zerozs01/PDF_Translator/issues) บน GitHub

## 📜 License

ISC License
