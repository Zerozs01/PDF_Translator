# PDF Translator
แอปพลิเคชันเดสก์ท็อปสำหรับการแปลเอกสาร PDF และมังงะ/มันฮวาแบบออฟไลน์ 100% พร้อมระบบจัดกลุ่มบอลลูนคำพูดและฐานข้อมูลเข้ารหัสความเร็วสูง

## Overview
- **What it does:** แก้ปัญหาการแปลเอกสารและการ์ตูนที่ล่าช้าและข้อมูลรั่วไหล โดยประมวลผลด้วย OCR ออฟไลน์ (PaddleOCR/EasyOCR) ผสานการจัดกลุ่มบอลลูนคำพูด 2 มิติ (Spatial Clustering) และแปลภาษาด้วย NMT ออฟไลน์ (Argos Translate) พร้อมวางเลเยอร์คำแปลทับข้อความเดิมได้อย่างแนบเนียนโดยไม่ต้องส่งข้อมูลออกนอกเครื่อง
- **Target Audience:** ผู้อ่านและนักแปลเอกสาร/มังงะ (End-users) ที่ต้องการความปลอดภัยและความเป็นส่วนตัวของข้อมูล, นักพัฒนา (Developers) ที่ต้องการศึกษาหรือต่อยอดระบบ Local Document Processing Pipeline

## Key Features
- **Offline OCR Engine:** ตรวจจับและอ่านข้อความจากไฟล์ PDF และรูปภาพด้วย PaddleOCR และ EasyOCR แบบออฟไลน์ 100%
- **Spatial Balloon Clustering:** รวมกลุ่มและแยกแยะกล่องข้อความ คำพูดตัวละคร และ Sound Effects (SFX) อัตโนมัติ
- **Local NMT Translation:** แปลภาษาแบบออฟไลน์ด้วย Argos Translate พร้อมคลังพจนานุกรมคำสั้นและสแลงเฉพาะทาง
- **Interactive Layer Editing:** ปรับแต่ง แก้ไขข้อความ เปลี่ยนฟอนต์ และปรับตำแหน่งเลเยอร์คำแปลแบบเรียลไทม์
- **Encrypted Local Storage:** บันทึกและแคชผลลัพธ์ด้วย SQLite เข้ารหัสระดับ 256-bit AES (SQLCipher) ในโหมด WAL
- **High-Fidelity Document Export:** ส่งออกเอกสารเป็นไฟล์ PDF หรือรูปภาพความละเอียดสูงพร้อมฝังเลเยอร์ข้อความแปล

## Tech Stack
- **Core:** Electron 39, React 19, TypeScript (Strict), Vite, Node.js
- **State / Storage:** Zustand (5.x), SQLite via better-sqlite3-multiple-ciphers (SQLCipher, WAL, FTS5)
- **Styling / UI:** TailwindCSS v4, Lucide React
- **Key Libraries:** pdfjs-dist (PDF Rendering), pdf-lib (PDF Modification), Python IPC Bridge (PaddleOCR, EasyOCR, Argos Translate)

## High-Level Architecture
ระบบทำงานด้วยสถาปัตยกรรมแบบ 3 เลเยอร์ โดย Client UI (React/Zustand) สื่อสารกับ Electron Main Process ผ่าน Typed IPC channels (`contextBridge`) และ Main Process ทำหน้าที่จัดการฐานข้อมูล SQLite เข้ารหัส พร้อมควบคุม Background Daemons (Python Subprocess) สำหรับประมวลผล OCR และ NMT ผ่าน JSONL IPC

## Project Structure
```text
PDF_Translator/
├── electron/         # Electron main process, modular IPC handlers, DAOs, and SQLite setup
├── scripts/          # Python OCR & Argos translation daemons, setup & benchmark scripts
├── src/              # React frontend application source code
│   ├── components/   # UI components (Viewer, PDF Canvas, Overlays, Layer panels, Modals)
│   ├── hooks/        # Application lifecycle & translation/export orchestration hooks
│   ├── services/     # Core business logic (OCR pipeline, NMT, layout grouping, native algorithms)
│   ├── stores/       # Zustand global stores with custom persistence
│   └── types/        # TypeScript type contracts and Electron IPC definitions
├── documents/        # In-depth architectural documentation and knowledge base
└── context.md        # L1 Master Index & feature-to-file routing for AI coding agents
```

## Prerequisites
- **Runtime:** Node.js >= 20.0.0, Python 3.10+
- **Package Manager:** `pnpm` (แนะนำตาม lockfile) หรือ `npm`
- **Operating System:** Windows 10/11 (แนะนำสำหรับการรันสคริปต์อัตโนมัติ)

## Getting Started

### 1. Installation
```bash
# ติดตั้ง Node dependencies
pnpm install
# หรือ npm install
```

### 2. Environment Setup
```bash
# สร้าง .venv-ocr และติดตั้งโมเดล PaddleOCR, EasyOCR และ Argos Translate
npm run ocr:bootstrap
```

Required & Optional Variables (ยืนยันจาก Codebase):
- `OCR_PYTHON_PATH`: พาธไปยัง Python executable สำหรับรัน OCR Daemon (ค่าเริ่มต้นถูกตั้งอัตโนมัติในสคริปต์ dev ให้ชี้ไปที่ `.venv-ocr`)
- `GEMINI_API_KEY`: API Key สำหรับทางเลือกการแปลผ่านโมเดล Gemini ออนไลน์ (Optional)
- `OCR_USE_ZLUDA`: กำหนดเป็น `1` หากต้องการเปิดใช้งานการเร่งความเร็วด้วย AMD GPU ผ่าน ZLUDA (Optional)
- `ZLUDA_PATH`: พาธไปยังโฟลเดอร์หรือไฟล์ `zluda.exe` เมื่อเปิดใช้งาน ZLUDA (Optional)

### 3. Running Development
```bash
# เริ่มต้น Vite Dev Server และเปิดหน้าต่าง Electron App
npm run dev
```

### 4. Build & Package
```bash
# Compile TypeScript, Bundle Frontend ด้วย Vite และแพ็กเกจเป็นไฟล์ติดตั้งผ่าน Electron-Builder
npm run build
```

คำสั่งทดสอบและตรวจสอบคุณภาพ:
```bash
npm run test          # รัน Unit Tests ด้วย Vitest
npm run test:e2e      # รัน End-to-End Tests ด้วย Playwright
```

## Documentation
- `context.md` — L1 Architecture & Feature Routing Index สำหรับ AI Coding Agents (ชี้เป้า Primary/Secondary files สำหรับการแก้ไขฟีเจอร์)
- `documents/` — รายละเอียดสถาปัตยกรรมเชิงลึก, เอกสาร Knowledge Base, คู่มือการจูน OCR, และ Roadmaps
