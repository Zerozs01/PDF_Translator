# Project Documentation

`documents/` is the canonical working documentation repository for **PDF Translator**.

All content here is kept in sync with the current codebase and Master Architectural Context in [context.md](file:///c:/App/Electron/PDF_Translator/context.md).

---

## 📌 Current System Snapshot

- **OCR Algorithm Version:** `230`
- **OCR Raw Engine Version:** `7`
- **Translation Cache Version:** `v64`
- **Active OCR Engines:** `paddleocr` (Primary default via Python IPC), `easyocr` (Secondary fallback)
- **Active Translation Engines:** Argos Translate (Offline NMT Daemon), CTranslate2 / M2M100
- **OCR Profiles:** `pipelineProfile = panel | export`, `ocrQualityProfile = fast | balanced | best`
- **Translation Modes:** `adaptive | manga | manhwa | official`

---

## 📚 Canonical Files in `documents/`

- [AI_MANIFEST.md](file:///c:/App/Electron/PDF_Translator/documents/AI_MANIFEST.md) — Master AI Context Map, Common Workflows, และ Index สำหรับ AI Assistants
- [ARCHITECTURE.md](file:///c:/App/Electron/PDF_Translator/documents/ARCHITECTURE.md) — สถาปัตยกรรมระบบ, Runtime Topology, Zero-GC Algorithms, และ DAO Subsystems
- [CHANGELOG.md](file:///c:/App/Electron/PDF_Translator/documents/CHANGELOG.md) — ประวัติการเปลี่ยนแปลงฟีเจอร์และแก้ไขบักของแอปพลิเคชันทั้งหมด
- [IMPROVEMENT_LOG.md](file:///c:/App/Electron/PDF_Translator/documents/IMPROVEMENT_LOG.md) — บันทึกการปรับปรุงประสิทธิภาพและ Optimization Log
- [Knowledge.md](file:///c:/App/Electron/PDF_Translator/documents/Knowledge.md) — กฎทอง หลักการออกแบบ และ Operating Principles
- [OCR_OPTIMIZATION.md](file:///c:/App/Electron/PDF_Translator/documents/OCR_OPTIMIZATION.md) — กฎการจูน OCR, Normalization, Heuristics, และการควบคุมหน่วยความจำ
- [Roadmap.md](file:///c:/App/Electron/PDF_Translator/documents/Roadmap.md) — รายการงานที่กำลังดำเนินการและแผนงานตามลำดับความสำคัญ (P0 - P5)

### Specialized Knowledge Directories
- `documents/argostranslation_knowledge/` — เอกสารเชิงลึกสำหรับระบบแปลภาษาออฟไลน์ Argos Translate, Glossary Seeds, และ Repair Patterns
- `documents/image_processing_knowledge/` — กฎการประมวลผลภาพ, Classifier Rules, BBox Normalization, และ IPC Schemas

---

## 🛠️ Frequently Used Commands

```bash
npm run dev                    # Start Vite + Electron development server
npm run test                   # Run unit test suite (Vitest)
npm run test:e2e               # Run end-to-end tests (Playwright)
npm run ocr:bootstrap          # Bootstrap Python virtual environment (.venv-ocr)
npm run ocr:regression         # Run OCR regression test suite
npm run ocr:gate               # Run OCR benchmark matrix verification gate
npm run build                  # Compile TypeScript, build renderer and package Electron app
```
