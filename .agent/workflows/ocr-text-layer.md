---
description: OCR Text Layer Overlay - สร้าง Searchable PDF ด้วย Tesseract.js
---

# 🔍 OCR Text Layer Overlay Feature

เป้าหมาย: สร้าง invisible text layer บน PDF เพื่อให้ user สามารถ select/copy ข้อความได้ เหมือน PDF24

## ✅ Implementation Status

### Phase 1: Enhanced OCR Engine ✅
- [x] 1.1 ปรับ `worker.ts` ให้ดึงข้อมูล word-level bounding boxes
- [x] 1.2 เพิ่ม DPI option สำหรับ render PDF ก่อน OCR (default: 300)
- [x] 1.3 สร้าง Interface สำหรับ OCR Word Data (`OCRWord`)
- [x] 1.4 เพิ่ม progress callback สำหรับ real-time updates

### Phase 2: PDF Text Layer Service ✅
- [x] 2.1 สร้าง `src/services/pdf/TextLayerService.ts`
- [x] 2.2 Implement `addTextLayerToPage()` - เพิ่ม invisible text ตาม bbox
- [x] 2.3 Implement `createSearchablePDF()` - รวม text layer กับ PDF เดิม
- [x] 2.4 Handle coordinate transformation (PDF coords vs Image coords)

### Phase 3: UI Integration ✅
- [x] 3.1 เพิ่ม "Text Layer" tab ใน RightSidebar
- [x] 3.2 เพิ่ม Language Selector (12 ภาษา)
- [x] 3.3 เพิ่ม Quality Profile (Fast/Balanced/Best)
- [x] 3.4 แสดง Progress Bar แบบ real-time

### Phase 4: Export & Save ✅
- [x] 4.1 Implement "Download Searchable PDF" function
- [x] 4.2 แสดง success message หลังเสร็จสิ้น

## 📦 Files Created/Modified

```
src/
├── types/index.ts              # Added OCR types (OCRWord, OCRLine, etc.)
├── services/
│   ├── vision/
│   │   ├── VisionService.ts    # Added ocrForTextLayer() + progress callback
│   │   └── worker.ts           # Added OCR_FOR_TEXT_LAYER handler + progress
│   └── pdf/
│       ├── index.ts            # Export barrel
│       ├── TextLayerService.ts # PDF text layer manipulation
│       └── SearchablePDFService.ts # Main pipeline orchestrator
├── stores/
│   └── useOCRTextLayerStore.ts # Zustand store for OCR state
└── components/
    ├── OCR/
    │   └── OCRTextLayerPanel.tsx # UI Component
    └── Layout/
        └── RightSidebar.tsx     # Updated with Text Layer tab
```

## 🎮 วิธีใช้งาน

1. เปิด PDF ในแอป
2. ไปที่ tab "Text Layer" ที่ Right Sidebar
3. เลือกภาษาของเอกสาร (เช่น English, Korean, Japanese)
4. เลือก Quality Profile (แนะนำ Best สำหรับความแม่นยำสูงสุด)
5. กด "Create Searchable PDF"
6. รอจนเสร็จ แล้วกด "Download Searchable PDF"
7. เปิดไฟล์ที่ดาวน์โหลดด้วย PDF reader แล้วลอง select/copy ข้อความ

## 🌍 Supported Languages

| Code | Language |
|------|----------|
| eng | English |
| jpn | Japanese |
| jpn_vert | Japanese (Vertical) |
| kor | Korean |
| chi_sim | Chinese (Simplified) |
| chi_tra | Chinese (Traditional) |
| tha | Thai |
| vie | Vietnamese |
| deu | German |
| fra | French |
| spa | Spanish |
| rus | Russian |

## 🔧 Quality Profiles

| Profile | DPI | Use Case |
|---------|-----|----------|
| Fast | 150 | Quick preview |
| Balanced | 200 | Standard documents |
| Best | 300 | High accuracy (recommended) |

## 🔬 Technical Details

### Algorithm: Word-Level Text Overlay

```typescript
async function createTextLayer(page: PDFPage, ocrWords: OCRWord[], scale: number) {
  const { height } = page.getSize();
  
  for (const word of ocrWords) {
    // Transform image coords → PDF coords
    const pdfX = word.bbox.x0 / scale;
    const pdfY = height - (word.bbox.y1 / scale); // PDF origin is bottom-left
    const wordWidth = (word.bbox.x1 - word.bbox.x0) / scale;
    const wordHeight = (word.bbox.y1 - word.bbox.y0) / scale;
    
    // Calculate font size to fit word in bbox
    const fontSize = estimateFontSize(word.text, wordWidth, wordHeight);
    
    // Draw invisible text
    page.drawText(word.text, {
      x: pdfX,
      y: pdfY,
      size: fontSize,
      font: font,
      color: rgb(0, 0, 0),
      opacity: 0, // Invisible but selectable!
    });
  }
}
```

### Key Success Factors

1. **DPI Match** - ใช้ DPI เดียวกันตอน render และ OCR
2. **Coordinate System** - PDF ใช้ bottom-left origin, Image ใช้ top-left
3. **Font Scaling** - ปรับขนาด font ให้พอดีกับ bounding box
4. **Word-Level Precision** - ใช้ word-level bbox ไม่ใช่ block/line level
