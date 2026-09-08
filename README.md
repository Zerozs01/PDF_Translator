# 📄 PDF Translator

**Next-Gen Local OCR & Manga Translation Engine**  
Desktop Application ประสิทธิภาพสูงสำหรับการแปลเอกสารและหนังสือการ์ตูน (Manga / Manhwa / Comic) โดยเน้นความแม่นยำของ Bounding Box, การจัดกลุ่มบอลลูนคำพูด 2 มิติ (Spatial Graph Clustering), การประมวลผลไร้ Garbage Collection (Zero-GC Native Algorithms), ฐานข้อมูลเข้ารหัส SQLCipher, และไปป์ไลน์ OCR/Translation ออฟไลน์ 100% ผ่าน Python IPC Daemon

---

## ⚡ Quick Start (Windows)

### Prerequisites
- **Node.js:** LTS (v20+ or v22+)
- **Python:** 3.10+ (สำหรับ PaddleOCR / EasyOCR และ Argos Translate / M2M100)

### 1. Install Node Dependencies
```bash
pnpm install # or npm install
```

### 2. Bootstrap Python OCR & Translation Environment
สคริปต์นี้จะสร้าง `.venv-ocr`, ติดตั้ง PyTorch, PaddlePaddle, PaddleOCR, EasyOCR, และ Argos Translate พร้อมดาวน์โหลดโมเดลเริ่มต้นอัตโนมัติ:
```bash
npm run ocr:bootstrap
```

### 3. Launch Development Server
```bash
npm run dev
```

### 4. Run Tests & Build
```bash
npm run test          # Run Unit Tests (Vitest)
npm run test:e2e      # Run End-to-End Tests (Playwright)
npm run build         # Production Package via Electron-Builder
```

---

## 🏗️ Core Architecture & Features

- **OCR Engines:** PaddleOCR (Primary default engine via Python bridge), EasyOCR (Secondary fallback)
- **Translation Subsystem:** Argos Translate (Offline NMT Daemon), CTranslate2 / M2M100, Direct Phrase Dictionaries, Dynamic User Glossary & SFX Dictionary
- **Spatial Clustering:** Zero-GC Disjoint-Set Union-Find algorithm with Brian Kernighan popcount bitset deduplication
- **Encrypted Local Storage:** SQLCipher 256-bit AES (`better-sqlite3-multiple-ciphers`), WAL mode, Memory-mapped I/O (128MB), FTS5 full-text search

---

## 📚 Canonical Documentation

เอกสารทางเทคนิคและคู่มือการพัฒนาระบบทั้งหมดถูกจัดเก็บไว้อย่างเป็นระเบียบในโฟลเดอร์ [documents/](file:///c:/App/Electron/PDF_Translator/documents/):

- [documents/Readme.md](file:///c:/App/Electron/PDF_Translator/documents/Readme.md) — แผนผังเอกสารและข้อมูลรวมของโปรเจกต์
- [documents/AI_MANIFEST.md](file:///c:/App/Electron/PDF_Translator/documents/AI_MANIFEST.md) — Master AI Context Map & Technical Workflow
- [documents/ARCHITECTURE.md](file:///c:/App/Electron/PDF_Translator/documents/ARCHITECTURE.md) — Runtime Topology & Subsystem Architecture
- [documents/CHANGELOG.md](file:///c:/App/Electron/PDF_Translator/documents/CHANGELOG.md) — Full Application Changelog
- [documents/OCR_OPTIMIZATION.md](file:///c:/App/Electron/PDF_Translator/documents/OCR_OPTIMIZATION.md) — OCR Tuning, Heuristics, & Memory Controls
- [documents/Roadmap.md](file:///c:/App/Electron/PDF_Translator/documents/Roadmap.md) — Prioritized Implementation Tasks (P0–P5)
- [documents/Knowledge.md](file:///c:/App/Electron/PDF_Translator/documents/Knowledge.md) — System Design Principles & Rules
- [documents/IMPROVEMENT_LOG.md](file:///c:/App/Electron/PDF_Translator/documents/IMPROVEMENT_LOG.md) — Optimization & Performance History

> สรุปสถาปัตยกรรมระดับ Master และ Golden Architectural Rules ดูได้ที่ [context.md](file:///c:/App/Electron/PDF_Translator/context.md)
