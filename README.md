# PDF Translator

แอปพลิเคชันเดสก์ท็อปสำหรับการแปลเอกสาร PDF และมังงะ/มันฮวาแบบออฟไลน์ 100% ขับเคลื่อนด้วย **Tauri 2.x** และ **Rust Native Engine** พร้อมระบบจัดกลุ่มบอลลูนคำพูด 2 มิติ และฐานข้อมูล SQLite เข้ารหัสความเร็วสูง

---

## Overview
- **What it does:** แก้ปัญหาการแปลเอกสารและการ์ตูนที่ล่าช้าและเสี่ยงต่อข้อมูลรั่วไหล โดยประมวลผลด้วย OCR ออฟไลน์ (PaddleOCR/EasyOCR) ผสานการจัดกลุ่มบอลลูนคำพูด 2 มิติ (Spatial Clustering) และแปลภาษาด้วย NMT ออฟไลน์ (Argos Translate) พร้อมวางเลเยอร์คำแปลทับข้อความเดิมได้อย่างแนบเนียนโดยไม่ต้องส่งข้อมูลออกนอกเครื่อง
- **Performance & Footprint:** ยกระดับประสิทธิภาพด้วย Rust Engine ทำให้กินหน่วยความจำขณะ Idle เพียง ~40MB (ลดลง 82% จาก Electron เดิม) และโหลดหน้าเอกสารได้เร็วกว่าเดิมกว่า 4 เท่าผ่าน Custom Binary Streaming Protocol

---

## Key Features
- **Native PDF Engine (Rust + Pdfium):** เรนเดอร์และประมวลผลหน้าเอกสารแบบ Multi-threaded พร้อมระบบ Bounded LRU Cache ป้องกันปัญหา Out-of-Memory
- **Custom Protocol Streaming:** สตรีมภาพหน้าเอกสารและ Thumbnail สู่ Frontend ด้วย Zero-Copy ผ่านโปรโตคอล `pdf-page://`
- **Offline OCR Engine:** ตรวจจับและอ่านข้อความจากไฟล์ PDF และรูปภาพด้วย PaddleOCR และ EasyOCR แบบออฟไลน์ 100% ผ่าน Python Sidecar Daemon
- **Spatial Balloon Clustering:** รวมกลุ่มและแยกแยะกล่องข้อความ คำพูดตัวละคร และ Sound Effects (SFX) อัตโนมัติ
- **Local NMT Translation:** แปลภาษาแบบออฟไลน์ด้วย Argos Translate พร้อมคลังพจนานุกรมคำสั้นและสแลงเฉพาะทาง
- **High-Performance SQLite:** จัดเก็บข้อมูลและแคชผลลัพธ์ผ่าน Rusqlite (WAL mode) ในตัวเครื่องอย่างปลอดภัย
- **High-Fidelity Document Export:** ส่งออกเอกสารเป็นไฟล์ PDF พร้อมฝังเลเยอร์ข้อความแปลและฟอนต์ TrueType สมบูรณ์

---

## Tech Stack
- **Desktop Shell & Backend:** Tauri 2.x, Rust (1.77+), Tokio, Rusqlite, Pdfium Render, Rayon
- **Frontend UI:** React 19, TypeScript (Strict), Vite, Zustand (5.x), TailwindCSS v4, Lucide React
- **Sidecar Runtime:** Python 3.10+ (PaddleOCR, EasyOCR, Argos Translate) ผ่าน JSONL stdio IPC

---

## Project Structure
```text
PDF_Translator/
├── src-tauri/          # Tauri 2.x & Rust Native Backend
│   ├── binaries/       # Native Dependencies (pdfium.dll, pdfium-x86_64-pc-windows-msvc.dll)
│   ├── capabilities/   # Security capabilities & permissions
│   ├── resources/      # Bundled assets (OCR models, dictionaries)
│   ├── src/            # Rust source code
│   │   ├── commands/   # Tauri IPC Commands (Database, Sidecar, PDF)
│   │   ├── core/       # Native Engine (SQLite Manager, Process Manager, PDF Rasterizer/Cache/Reconstructor)
│   │   └── protocol/   # Custom Protocol Handler (pdf-page://)
│   ├── Cargo.toml      # Rust dependencies & metadata
│   └── tauri.conf.json # Tauri 2.x configuration & bundler settings
├── src/                # React frontend application
│   ├── components/     # UI components (Viewer, PDF Canvas, Overlays, Layer panels, Modals)
│   ├── hooks/          # Application lifecycle & translation/export orchestration hooks
│   ├── services/       # Core business logic (bridge, OCR pipeline, layout grouping)
│   ├── stores/         # Zustand global state stores
│   └── types/          # TypeScript contracts & data types
├── scripts/            # Python OCR & Argos translation daemons, setup & benchmark scripts
├── public/             # Static web assets & test fixtures
├── BENCHMARK_REPORT.md # Performance Baseline & Regression Matrix
└── context.md          # L1 Master Index & feature-to-file routing for AI coding agents
```

---

## Prerequisites & Setup

### 1. เครื่องมือที่จำเป็น (Toolchains)
- **Node.js:** >= 20.0.0 (`pnpm` แนะนำ)
- **Rust:** Rust toolchain >= 1.77 (`rustup default stable-x86_64-pc-windows-msvc`)
- **Python:** Python 3.10+ สำหรับ OCR & NMT
- **Webview2:** ติดตั้งมาพร้อมกับ Windows 10/11 เป็นมาตรฐาน

### 2. การติดตั้ง dependencies และเตรียมสภาพแวดล้อม
```bash
# ติดตั้ง Node dependencies
pnpm install

# เตรียมสภาพแวดล้อม Python และดาวน์โหลดโมเดล OCR
pnpm run ocr:bootstrap
```

### 3. รันโปรเจกต์ใน Development Mode
```bash
# เริ่มต้น Tauri Dev Server (Vite HMR + Tauri Native Shell)
pnpm run dev
```

### 4. คอมไพล์โปรดักชันแพ็กเกจ (Production Bundling)
```bash
# ตรวจสอบ Typecheck และ Build Frontend
pnpm run build

# สร้าง Standalone Installer / Binary สำหรับ Production
pnpm run package
```

### 5. รันชุดทดสอบ (Testing)
```bash
# รัน Frontend Unit Tests (30 ไฟล์, 383 เคส)
pnpm test

# รัน Rust Native Engine Tests (5 เคส)
cd src-tauri && cargo test
```
