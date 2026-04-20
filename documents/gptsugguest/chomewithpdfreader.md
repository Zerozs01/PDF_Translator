## TL;DR

Chrome เร็วกว่า PaddleOCR ในการ “คัดลอกข้อความจาก PDF” เพราะ **หลายเคสมันไม่ได้ทำ OCR เลย** แต่ใช้ตัว parser ของ PDF เพื่อดึง **text layer / glyph / character position** ที่ฝังอยู่ในไฟล์ PDF โดยตรงผ่านเอนจินตระกูล PDFium ทำให้ได้ทั้งข้อความและตำแหน่งกรอบตัวอักษรแทบจะทันที ส่วนกรณี PDF ที่เป็นภาพสแกนจริง ๆ Chrome ปัจจุบันมี **OCR on-device** เพื่อทำให้ข้อความค้นหาและเลือกได้ โดยไม่ส่งไฟล์ออกจากเครื่อง ([Google Help][1])

## สรุปของจริง: Chrome ทำได้อย่างไร

### 1) กรณี PDF ปกติที่มี text layer อยู่แล้ว

อันนี้คือจุดที่คนเข้าใจผิดเยอะสุด

ถ้า PDF มีข้อความจริงฝังอยู่ในไฟล์ Chrome ไม่ต้องวิ่ง OCR แบบ Paddle เลย แต่ใช้เอนจิน PDFium โหลดหน้า, อ่าน character/glyph metadata, และดึงข้อความออกตรง ๆ ผ่าน API สำหรับ text extraction เช่น `FPDFText_LoadPage`, `FPDFText_GetText`, `FPDFText_GetRect`, `FPDFText_GetCharIndexAtPos` ทำให้มันรู้ได้ทั้ง:

* ตัวอักษรคืออะไร
* อยู่ตรงไหนบนหน้า
* selection box ควรอยู่ตรงไหน
* คลิกหรือ drag เลือกข้อความยังไง

นี่แหละเหตุผลที่มันไวมากและดูเหมือน “detect กล่องข้อความเก่ง” ทั้งที่จริงมันแค่อ่านโครงสร้าง PDF โดยตรง ไม่ได้เดาภาพจากพิกเซลแบบ OCR ([Pdfium][2])

### 2) กรณี PDF สแกนเป็นภาพ

ถ้าเป็นภาพล้วนจริง ๆ Chrome PDF viewer จะทำ OCR อัตโนมัติเพื่อแปลงให้ “ค้นหา เลือก คัดลอก” ได้ และ Google ระบุชัดว่าการแปลงนี้ทำ **บนเครื่องผู้ใช้** ไม่ส่งข้อมูลไป Google หรือ third party ([Google Help][1])

ฝั่ง Chromium มีร่องรอยชัดว่าระบบนี้ใช้แนวทางที่เรียกว่า **PDF Searchify** ร่วมกับ **Screen AI OCR**:

* Screen AI เป็น OCR service แบบ on-demand ([Chromium Git Repositories][3])
* PDF viewer มี interface สำหรับ `PerformOcr` บนภาพโดยตรง ([Chromium Git Repositories][4])
* มีโค้ดทดสอบ `PdfSearchifier` สำหรับเอา PDF ที่เป็นภาพมาใส่ข้อความกลับเข้าไปจนกลายเป็น searchable/selectable PDF ([Chromium Git Repositories][5])

## ทำไมมันถึงเร็วกว่าพวก OCR pipeline ทั่วไป

### เหตุผลหลักมี 4 ข้อ

#### 1. ไม่ OCR ถ้าไม่จำเป็น

นี่คือเหตุผลอันดับหนึ่ง
ถ้าเอกสารมี text layer อยู่แล้ว Chrome ข้าม OCR ไปเลย ดึง text object ตรงจาก PDF structure เร็วกว่าการ render ภาพ -> detect -> recognize หลายเท่า ([Pdfium][2])

#### 2. ทำงานระดับ character metadata ไม่ใช่ระดับ bitmap อย่างเดียว

PDFium ให้ข้อมูลตำแหน่งตัวอักษรและ rect ของข้อความได้โดยตรง ทำให้ selection/hit-testing เร็วมาก เช่นหา character ใกล้พิกัดเมาส์ หรือดึง bounding rect ของช่วงข้อความ ([Pdfium][2])

#### 3. OCR เฉพาะหน้าที่จำเป็น

ฝั่ง Chromium มีแนวโน้มชัดว่า OCR ถูกเปิดแบบ on-demand และผูกกับ use case PDF/searchability ไม่ใช่ยิงทั้งเอกสารแบบหนัก ๆ ตั้งแต่ต้นทั้งหมด ([Chromium Git Repositories][3])

#### 4. เป้าหมายของมันคือ “interactive text”

Chrome ไม่ได้สนใจแค่อ่านข้อความออกมาเป็น string แต่สนใจให้ผู้ใช้:

* ไฮไลต์ได้
* ค้นหาได้
* คัดลอกได้
* คลิก selection ได้ตรงตำแหน่ง

เพราะงั้น pipeline มันถูกออกแบบให้ได้ **text + geometry + interaction mapping** ตั้งแต่แรก ([Google Help][1])

---

## ถ้าจะเอาแนวคิดนี้ไปใช้กับ Electron app ของนาย

### แนวทางที่ถูก

อย่าเอา Chrome มาเลียนแบบแบบ “OCR ทั้งหมดด้วย Paddle”
มันผิดตั้งแต่สถาปัตยกรรม

ให้ทำเป็น **hybrid pipeline** แบบนี้:

### Stage A: ตรวจชนิดของหน้า PDF ก่อน

แยกให้ได้ว่าหน้านั้นเป็น:

* **Digital text page**: มี text object อยู่แล้ว
* **Scanned image page**: เป็น bitmap ล้วน
* **Hybrid page**: มีทั้ง text layer และ image/annotation

### Stage B: เลือก engine ตามชนิดหน้า

* ถ้าเป็น **digital text page**
  ใช้ **PDF parser/text extractor** ดึง text + bbox โดยตรง
  ไม่ต้อง OCR

* ถ้าเป็น **scanned image page**
  ค่อยส่งเข้า OCR เช่น PaddleOCR

* ถ้าเป็น **hybrid page**
  ใช้ text layer เป็นหลัก แล้ว OCR เฉพาะ region ที่ไม่มี text object

นี่คือแนวที่ใกล้ Chrome ที่สุด และเป็นทางที่ถูกเชิง performance/accuracy

---

## อัลกอริทึมที่ควรเสนอทีม

### Pipeline ที่ผมแนะนำ

#### 1. PDF Preflight

ต่อหน้า:

* parse page objects
* check ว่ามี text object ไหม
* count text chars / glyphs
* count image objects
* estimate text coverage ratio

**output**

```ts
type PageMode = 'digital-text' | 'scanned-image' | 'hybrid';
```

#### 2. Native Text Extraction Path

ถ้า `digital-text`:

* extract text runs
* extract char/word bounding boxes
* reconstruct lines / paragraphs
* build selectable overlay

ไม่ต้อง render เป็น image ก่อน
ไม่ต้อง Paddle
ตรงนี้จะเร็วสุด

#### 3. OCR Fallback Path

ถ้า `scanned-image`:

* render page image ตาม DPI ที่เหมาะสม
* preprocess เฉพาะที่จำเป็น
* detect orientation / skew
* OCR
* build invisible text layer overlay หรือ selectable boxes

#### 4. Hybrid Merge Path

ถ้า `hybrid`:

* เก็บ native text layer ก่อน
* ทำ mask บริเวณที่มี text object แล้ว
* OCR เฉพาะโซนที่ยังไม่มี text
* merge result โดยใช้ coordinate system เดียวกัน

#### 5. Unified Interaction Layer

สุดท้าย normalize ทุกอย่างเป็น schema เดียว:

```ts
type TextSpan = {
  page: number;
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
  source: 'native-pdf' | 'ocr';
  confidence?: number;
  rotation?: number;
};
```

---

## ถามว่า Electron เอาอะไรมาใช้ได้บ้าง

### ตัวเลือกที่ practical สุด

#### ทางเลือก A: ใช้ PDF.js + text layer

เหมาะถ้าอยากทำเร็วและ integrate ง่ายใน Electron
แต่ความลึกบางอย่างอาจไม่เท่า PDFium

#### ทางเลือก B: ใช้ PDFium binding/native module

อันนี้ใกล้ Chrome สุดในเชิงแนวคิด
แต่ complexity สูงกว่าเรื่อง native build, ABI, packaging

#### ทางเลือก C: ใช้ hybrid

* PDF.js/PDFium สำหรับ text extraction
* PaddleOCR สำหรับ fallback OCR
* overlay layer ของตัวเองสำหรับ selection/copy/translate

อันนี้คือคำตอบที่ดีที่สุดสำหรับแอปนาย

---

## สิ่งที่ไม่ควรทำ

### 1) อย่า OCR ทุกหน้า

โง่และเปลืองมาก
ทั้งช้า ทั้งแม่นน้อยลงใน PDF ที่มี text layer อยู่แล้ว

### 2) อย่าใช้ OCR output เป็น source of truth เสมอ

ถ้ามี native text อยู่แล้ว native text ควรชนะ OCR ทุกครั้ง
เพราะ OCR มี error จาก font, blur, skew, low contrast

### 3) อย่าผูก selection กับ OCR line อย่างเดียว

ควรเก็บเป็น word/char boxes
ไม่งั้น drag selection, search highlight, copy with layout จะห่วย

---

## Trade-off

### แนว Chrome-like hybrid

**ข้อดี**

* เร็วมากใน digital PDFs
* แม่นกว่า OCR-only
* UX ดี เพราะ selection/copy/search ตรงตำแหน่ง
* ลด CPU มาก

**ข้อเสีย**

* implementation ซับซ้อนขึ้น
* ต้องมี page classification
* ต้อง merge 2 source: native text + OCR
* coordinate mapping ต้องแม่น

### OCR-only แบบ Paddle ทั้งหมด

**ข้อดี**

* pipeline เดียว
* ใช้ได้กับภาพทุกชนิด

**ข้อเสีย**

* ช้ากว่า
* พังกับ PDF ที่มี text layer อยู่แล้วเพราะทำงานซ้ำซ้อน
* selection/copy/search คุณภาพด้อยกว่า
* ใช้ resource หนักกว่า

---

## ข้อเสนอที่เอาไปพูดกับทีมได้เลย

### ข้อสรุปเชิงสถาปัตยกรรม

> Chrome PDF viewer เร็วไม่ใช่เพราะ OCR แรงกว่า PaddleOCR เป็นหลัก แต่เพราะมันใช้ PDF-native text extraction ก่อนเสมอเมื่อเอกสารมี text layer และใช้ OCR เฉพาะกรณี PDF สแกนที่เป็นภาพจริง ๆ พร้อมสร้าง selectable/searchable text overlay กลับเข้าไป ดังนั้น Electron app ควรออกแบบเป็น hybrid pipeline: native PDF text extraction first, OCR fallback second, merged into a unified selectable text model.

---

## เวอร์ชันสั้นมากสำหรับเสนอทีม

1. **แยกก่อนว่า PDF หน้านี้มี text layer หรือไม่**
2. **ถ้ามี ให้ดึง text+bbox จาก PDF โดยตรง**
3. **ถ้าไม่มี ค่อย OCR**
4. **ถ้ามีทั้งคู่ ให้ merge และ OCR เฉพาะส่วนที่ไม่มี text**
5. **ทำ overlay schema กลางสำหรับ copy/search/highlight/translate**

---

## สิ่งที่ผมแนะนำเพิ่ม beyond question

สำหรับแอปนายที่มี OCR + แปล + overlay:

* ใช้ **native text extraction เป็น first-class path**
* OCR เฉพาะ fallback
* เก็บ text object ระดับ **word/char bbox**
* ทำ **reading-order reconstruction** แยกจาก OCR engine
* รองรับ **invisible text layer injection** สำหรับเอกสารสแกน
* ทำ benchmark 3 metric แยก:

  * time-to-first-selectable-text
  * copy accuracy
  * bbox alignment accuracy

เพราะถ้านายวัดแค่ OCR accuracy จะหลอกตัวเองได้ง่ายมาก

ถ้าต้องการ ผมสรุปต่อให้ได้เป็น **technical design doc สำหรับ Electron implementation** แบบมี module breakdown, data flow, และ pseudo-code เลย.

[1]: https://support.google.com/chrome/answer/16215622?co=GENIE.Platform%3DDesktop&hl=th "จัดการ PDF ใน Chrome - คอมพิวเตอร์ - Google Chrome ความช่วยเหลือ"
[2]: https://pdfium.googlesource.com/pdfium/%2B/main/public/fpdf_text.h?utm_source=chatgpt.com "public/fpdf_text.h - pdfium - Git at Google"
[3]: https://chromium.googlesource.com/chromium/src/%2B/lkgr/chrome/browser/screen_ai/ "chrome/browser/screen_ai - chromium/src - Git at Google"
[4]: https://chromium.googlesource.com/chromium/src/%2B/master/pdf/pdf_view_web_plugin.h "pdf/pdf_view_web_plugin.h - chromium/src - Git at Google"
[5]: https://chromium.googlesource.com/chromium/src/%2B/refs/tags/142.0.7440.1/chrome/services/pdf/pdf_searchifier_unittest.cc "chrome/services/pdf/pdf_searchifier_unittest.cc - chromium/src - Git at Google"
