# 🚀 MangaTranslate Rebirth

**Next-Gen Local OCR & Manga Translation Engine**
แอปพลิเคชันเวอร์ชันยกเครื่องใหม่ (Rebirth) ที่สร้างขึ้นเพื่อแก้ปัญหาความล่าช้าและการแยกแยะองค์ประกอบภาพที่ไม่แม่นยำ โดยเน้นการประมวลผลแบบ Offline 100% และมี UI ที่ยืดหยุ่นสูงสุด

## 🎯 Vision & Goals

- **Zero-Latency UI:** โครงสร้างที่แยกการประมวลผลหนักๆ ออกจาก Main Thread เพื่อให้แอปตอบสนองทันทีที่เปิด
- **Edge-to-Edge Workspace:** UI แบบ File Explorer ที่พับ Sidebar ได้สนิท (Zero Margin) เพื่อเพิ่มพื้นที่ให้ Canvas มากที่สุด
- **Ghost-Free Segmentation:** ใช้สถาปัตยกรรม Hybrid (YOLOv8-seg + OpenCV Refinement) เพื่อลด Noise และ "ไฟล์ผี" ที่ไม่ต้องการ
- **Contextual Gemini Translation:** ระบบส่ง Prompt ที่มีความฉลาดตามประเภทเอกสาร (มังงะ/วิชาการ/ทางการ)

## 🛠 Tech Stack (The Clean Core)

- **Runtime:** Electron + Vite (For speed and modern HMR)
- **Frontend:** React (Functional Components + Hooks)
- **Styling:** Tailwind CSS + Framer Motion (For smooth transitions)
- **State Management:** Zustand (Fast, Minimalist)
- **AI Core:** - ONNX Runtime Web (YOLOv8-seg)
  - OpenCV.js (Contour Analysis)
  - Tesseract.js (Local OCR)
- **API:** Google Gemini API (Strategic Translation)

## 🏗️ Project Structure (New Architecture)

```text
/
├── electron/               # Main process & Preload scripts
├── src/
│   ├── components/         # Atomic UI Components
│   ├── hooks/              # Canvas Logic & Sidebar States
│   ├── services/           # Backend Logic (OCR, Vision, Gemini)
│   │   └── vision/         # Web Workers for Image Processing
│   ├── stores/             # Zustand Stores
│   ├── types/              # TypeScript Interfaces (Strict Mode)
│   └── App.tsx             # Main Shell with Toggle Sidebar
└── public/                 # Models & WASM binaries

```

## 🚀 How to Start (From Scratch)

1.**Initialize Project**

```bash
# เริ่มต้นสร้างโฟลเดอร์ใหม่และลง Vite
npm create vite@latest . -- --template react-ts
npm install

```

2.**Install Core Dependencies**

```bash
npm install electron electron-vite-plugin lucide-react zustand
npm install -D tailwindcss postcss autoprefixer electron-builder
npx tailwindcss init -p

```

3.**Environment Setup**

สร้างไฟล์ `.env` ที่ Root:

```env
VITE_GEMINI_API_KEY=your_api_key_here

```

## 🤝 Roadmap

- [ ] **Phase 1:** UI Shell & Toggle Sidebar (Feat/ui-shell)
- [ ] **Phase 2:** Canvas Engine & Image Loading (Feat/canvas)
- [ ] **Phase 3:** Vision Worker & YOLO Integration (Feat/vision)
- [ ] **Phase 4:** Advanced Segmentation V3 (Feat/segmentation)
- [ ] **Phase 5:** Gemini Translation Bridge (Feat/translate)

```
