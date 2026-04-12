**TL;DR**

ปัญหาจริงไม่ใช่แค่ OCR แม่นหรือไม่แม่น แต่คือ **pipeline มึงยังใช้ “text box list” เป็นตัวแทนโครงสร้างการอ่านของหน้า** ซึ่งผิดสำหรับมังงะโดยเฉพาะกรณี:

* กล่องข้อความเอียง
* หลายกล่องอยู่ใน balloon เดียว
* หลาย balloon อยู่ใน panel เดียว
* ลำดับการอ่านไม่ใช่ sort ตาม `y -> x` ตรงๆ

ทางแก้ที่ถูกคือเปลี่ยนจาก

`detect text -> sort boxes -> OCR -> translate`

เป็น

`panel/balloon-aware layout analysis -> assign text boxes to balloon groups -> order inside balloon -> order balloons by reading flow -> OCR -> translate per balloon/group`

---

# สิ่งที่เห็นจากภาพ

ใช่ ผมเห็นปัญหาชัด:

1. **OCR detect ได้บางส่วน แต่ order พัง**

   * `사진 뭐냐?` ควรมาก่อน `개변태인거 티내는 거임?`
   * แต่ระบบน่าจะ sort ตามตำแหน่ง row-based หรือ top-left based เลยทำให้ข้ามกลุ่ม

2. **มีกล่องข้อความหลายอันใน balloon เดียว**

   * ถ้า translate ทีละ box หรือรวมตาม row จะเสียบริบททันที
   * เช่นประโยคที่ควรอยู่ด้วยกันโดนแยกไปคนละกลุ่ม

3. **กล่องเอียง / rotated text**

   * detector อาจหาเจอ แต่ recognizer รับ crop ที่ยังเอียง ทำให้ confidence ตก
   * หรือ angle normalization ยังไม่ดีพอ

4. **มังงะไม่ใช่ document OCR**

   * document OCR ปกติใช้ top-to-bottom / left-to-right ได้บ้าง
   * แต่มังงะต้องมี **reading-order model** ของตัวเอง

---

# Root cause ที่แท้จริง

## 1) PaddleOCR ไม่ได้แก้ “semantic reading order” ให้มึง

PaddleOCR เก่งที่ detection + recognition ระดับหนึ่ง แต่ **ไม่ได้เข้าใจว่า box ไหนอยู่ balloon เดียวกัน** หรือควรอ่านก่อนหลังแบบมังงะ

ต่อให้ detect ครบ 100% ถ้า sort ผิด ผลแปลก็ยังพัง

---

## 2) มึงกำลังใช้ unit ผิด

ตอนนี้ unit ที่ส่งเข้า translator น่าจะเป็นประมาณนี้:

* line
* text box
* OCR fragment

แต่หน่วยที่ควรแปลจริงคือ:

* **balloon group**
* หรืออย่างน้อย **utterance block**

เพราะ translation ต้องการ context ในระดับประโยค/คำพูด ไม่ใช่ชิ้น fragment กระจัดกระจาย

---

## 3) การ sort แบบ row-major ใช้กับ manga ไม่ได้

สิ่งที่ codex เคยเสนอให้มึง “อ่านจากซ้ายไปขวาแล้วรวมกลุ่ม textbox balloon เดียวก่อน” นั้นแนวคิดถูกครึ่งหนึ่ง แต่ยังไม่พอ

เพราะมังงะแต่ละภาษาอ่านไม่เหมือนกัน:

* อังกฤษ: ซ้าย -> ขวา
* ญี่ปุ่น/เกาหลีในงานมังงะบางเลย์เอาต์: อาจผสม top-down, right-to-left, panel-priority
* บางหน้ามี inset, aside box, narration box, vertical stack

ดังนั้นต้องมี **heuristic ที่ configurable ตาม language/layout mode**

---

# วิธีแก้ที่ถูกต้อง

## แนวทางที่ดีที่สุด

สร้าง **Layout-aware OCR pipeline** แบบนี้:

### Stage 1: Preprocess

* grayscale / adaptive threshold
* denoise เบาๆ
* keep original + binarized version ไว้ทั้งคู่
* deskew per text region ไม่ใช่ deskew ทั้งหน้าอย่างเดียว

### Stage 2: Detect text regions

ใช้ PaddleOCR detect ได้ แต่ต้องเก็บ:

* quadrilateral box
* score
* angle estimate
* crop image

### Stage 3: Normalize rotated text crop

ก่อน recognize:

* หา rotation จาก quadrilateral / minAreaRect
* rotate crop ให้ baseline ตรง
* expand margin รอบกล่อง 5–15%
* ทำ recognition บน crop ที่ straighten แล้ว

อันนี้สำคัญมาก เพราะหลายเคส detect เจอแต่ recognize พังเพราะ crop ยังเอียง

### Stage 4: Group text boxes into balloon groups

นี่คือส่วนที่ pipeline มึงขาด

ต้องทำ algorithm จัดกลุ่ม box ว่า box ไหนอยู่ balloon เดียวกัน โดยใช้ feature พวกนี้:

* ระยะห่างระหว่าง boxes
* การอยู่ในพื้นที่ล้อมเดียวกัน
* เส้นขอบ balloon / connected white region
* overlap กับ same speech region
* alignment และ continuity
* text size similarity

### Stage 5: Order lines inside each balloon

หลังได้ balloon group แล้ว ค่อย sort ภายใน group ตามกติกาของภาษา:

* Korean/English horizontal: top-to-bottom, then left-to-right
* Japanese vertical: right-to-left columns, top-to-bottom inside column
* Mixed mode: detect orientation ก่อน

### Stage 6: Order balloons in reading order

ใช้ panel-aware หรืออย่างน้อย balloon-center heuristic:

* manga RTL mode: top-to-bottom blocks, right-to-left within same band
* western LTR mode: top-to-bottom blocks, left-to-right within same band

### Stage 7: Translate per balloon group, not per fragment

ส่งข้อความรวมของแต่ละ balloon/group เข้า Argos ทีเดียว
แล้วค่อย map คำแปลกลับไป render ใน balloon นั้น

นี่แหละที่จะทำให้ context ไม่แตก

---

# วิธีทำ grouping ให้ใช้ได้จริง

## Option A — เร็วและคุ้มสุด: Heuristic grouping

เหมาะกับ Electron app ที่ต้องวิ่งเร็ว offline

### หลักการ

สร้าง graph ของ text boxes แล้วเชื่อม edge ถ้า “น่าจะอยู่กลุ่มเดียวกัน”

เช่น score จาก:

* distance ใกล้กัน
* มุมเอียงคล้ายกัน
* ขนาดตัวอักษรใกล้กัน
* อยู่ใน white connected region เดียวกัน
* ไม่มี panel border คั่น
* มี contour balloon ครอบร่วมกัน

จากนั้นใช้ connected components / clustering

### pseudo logic

```ts
type OcrBox = {
  id: string;
  quad: { x: number; y: number }[];
  cx: number;
  cy: number;
  width: number;
  height: number;
  angleDeg: number;
  text?: string;
  score: number;
};

function shouldLink(a: OcrBox, b: OcrBox): boolean {
  const dx = a.cx - b.cx;
  const dy = a.cy - b.cy;
  const dist = Math.hypot(dx, dy);

  const sizeScale = Math.max(a.height, b.height);
  const normalizedDist = dist / Math.max(sizeScale, 1);

  const angleDiff = Math.abs(a.angleDeg - b.angleDeg);
  const similarHeight = Math.min(a.height, b.height) / Math.max(a.height, b.height) > 0.6;

  const verticallyNear = Math.abs(a.cy - b.cy) < Math.max(a.height, b.height) * 2.2;
  const horizontallyNear = Math.abs(a.cx - b.cx) < Math.max(a.width, b.width) * 2.5;

  return (
    normalizedDist < 3.2 &&
    angleDiff < 20 &&
    similarHeight &&
    (verticallyNear || horizontallyNear)
  );
}
```

แต่แค่นี้ยังไม่พอ ต้องเสริม **balloon mask constraint**

---

## Option B — แม่นขึ้นเยอะ: Balloon region extraction

อันนี้แนะนำมากถ้ามึงเน้นมังงะ

### วิธี

1. แปลงภาพเป็น grayscale
2. threshold หา white speech regions
3. morphology close/open
4. หา connected components ของพื้นที่ขาวใหญ่
5. เอา OCR boxes ไป assign ว่าอยู่ใน region ไหน

ถ้า 3 box อยู่ใน white blob เดียวกัน ก็มีโอกาสสูงมากว่าเป็น balloon เดียวกัน

### ข้อดี

* แก้เคสหลายกล่องใน balloon เดียวได้ดีมาก
* ไม่ต้องพึ่ง sort แบบ row
* ใช้ offline ได้

### ข้อเสีย

* พังในหน้าที่ balloon open-border หรือพื้นหลังสว่างมาก
* ต้องมี fallback heuristic

---

## Option C — ดีสุดแต่หนัก: Comic layout / speech balloon segmentation model

ใช้โมเดลแยก

* panel detection
* speech balloon detection
* text association

ถ้าจะเอาให้เหนือ Chrome แบบจริงจังในสาย manga OCR อันนี้คือทางไป
แต่ต้นทุนสูงกว่าและ deployment บน Electron ยุ่งกว่า

---

# Architecture ที่ผมแนะนำจริง

## Minimum viable robust pipeline

ใช้ hybrid:

### A. Detect text with PaddleOCR

* เก็บ polygon box
* อย่าเชื่อ sort output ของมัน

### B. For each detected box

* rotate crop ให้ตรงก่อน recognize
* recognize ใหม่บน normalized crop

### C. Balloon grouping

ลำดับ fallback:

1. **balloon connected-region assignment**
2. ถ้าไม่ได้ -> **proximity graph clustering**
3. ถ้ายังไม่ได้ -> **same local panel zone clustering**

### D. Reading order

แยก 2 ระดับ:

* order ภายใน balloon
* order ระหว่าง balloons

### E. Translation

* translate ต่อ balloon/group
* ไม่ใช่ต่อ line fragment

### F. Rendering

* render translated block per balloon
* auto-wrap ตาม polygon/ellipse region

---

# เรื่อง rotated text ต้องแก้ยังไง

## อย่าหวัง angle classifier อย่างเดียว

หลาย implementation ของ OCR angle classifier แค่ช่วย 0/180 หรือ coarse orientation
แต่งานมังงะมี:

* 12°
* 25°
* 40°
* skew จาก perspective
* curved placement

ดังนั้นต้องทำ **region rectification เอง**

## วิธีที่ควรทำ

สำหรับแต่ละ quad box:

1. คำนวณมุมของ edge หลัก
2. rotate image patch ให้แนวนอน
3. crop ใหม่ด้วย margin
4. optional: upscale 1.5–2x ถ้าตัวเล็ก
5. OCR recognition บน patch นี้

### หลักที่สำคัญ

* ใช้ **quad/polygon** ไม่ใช่แค่ AABB
* ถ้าใช้ axis-aligned crop อย่างเดียว มึงกำลังทำ recognition บนภาพที่เสียข้อมูล

---

# Reading order ที่ควรใช้

## อย่า sort แบบเดียวทั้งระบบ

ต้องมี `readingMode`

```ts
type ReadingMode =
  | "ltr-horizontal"
  | "rtl-horizontal"
  | "ttb-vertical-jp"
  | "auto";
```

## สำหรับมังงะ

อย่างน้อยมี 2 ชั้น:

### 1. Page zone / panel order

* ถ้า manga mode: เริ่มจากขวาบน -> ซ้ายล่าง โดยประมาณ
* ถ้า western mode: ซ้ายบน -> ขวาล่าง

### 2. Balloon order inside panel

* sort ตาม center point + overlap bands
* กลุ่มที่อยู่ใกล้กันในแนวตั้งให้ถือเป็น band เดียวก่อน

### 3. Line order inside balloon

* horizontal text: top -> bottom
* vertical text: right column -> left column, top -> bottom

---

# วิธี sort ที่ดีกว่า row-major

แทนที่จะ:

```ts
boxes.sort((a, b) => a.y - b.y || a.x - b.x);
```

ให้ทำแบบนี้:

## Step 1: cluster into bands

* รวม boxes ที่มี vertical overlap กันเป็น band เดียว
* หรือรวมตาม panel / balloon ก่อน

## Step 2: sort band ตาม reading mode

## Step 3: sort items ใน band ตาม reading mode

แต่นี่ก็ยังแค่ครึ่งทาง
ทางที่ถูกกว่าคือ **sort หลัง group เป็น balloon แล้ว**

---

# โครงสร้างข้อมูลที่ควรเปลี่ยน

ตอนนี้มึงน่าจะมีแค่ `ocrLines[]` หรือ `ocrBlocks[]`

ควรเปลี่ยนเป็นแบบนี้:

```ts
type TextLine = {
  id: string;
  text: string;
  quad: Point[];
  confidence: number;
  angleDeg: number;
};

type BalloonGroup = {
  id: string;
  panelId?: string;
  regionPolygon?: Point[];
  lineIds: string[];
  orderedLineIds: string[];
  combinedSourceText: string;
  translatedText?: string;
  readingOrder: number;
};

type PageLayout = {
  pageNumber: number;
  readingMode: "ltr-horizontal" | "rtl-horizontal" | "ttb-vertical-jp" | "auto";
  lines: TextLine[];
  balloons: BalloonGroup[];
};
```

พอมี structure แบบนี้ การแปลและ render จะนิ่งขึ้นเยอะ

---

# สิ่งที่ควรทำกับ Argos Translation

Argos ไม่ได้ฉลาดพอจะเดาความสัมพันธ์ของ fragment กระจัดกระจายให้มึงเอง
เพราะงั้นต้อง feed input ให้ดี

## ห้าม

* ส่งทีละ line แบบหลุดบริบท
* ส่ง text ที่ถูก sort ผิด
* ส่งหลาย balloon มารวมกัน

## ควร

* รวมข้อความต่อ balloon/group
* join ด้วย newline ภายในกลุ่ม
* translate ต่อกลุ่ม
* เก็บ alignment ระหว่าง source line กับ translated block ไว้สำหรับ render

เช่น:

```ts
const source = orderedLines.map(x => x.text.trim()).join("\n");
const translated = await translateOffline(source, "ko", "th");
```

---

# ข้อเสนอแบบ production-grade

## 1. เพิ่ม “Layout Analysis Layer”

แยก module ชัดๆ:

* `textDetectionService`
* `textRecognitionService`
* `balloonGroupingService`
* `readingOrderService`
* `translationService`
* `overlayRenderService`

อย่ายัดทุกอย่างไว้ใน OCR panel ตัวเดียว ไม่งั้นเดี๋ยว maintain ไม่ไหว

---

## 2. เก็บ intermediate artifacts ไว้ debug

เวลาผิด มึงต้องรู้ว่าพังตรงไหน:

* raw detected boxes
* normalized crops
* balloon clusters
* final reading order indices
* pre-translation text per balloon

ทำ debug overlay เปิด/ปิดได้
อันนี้ช่วยมาก

---

## 3. ให้ user override ได้

ต่อให้ heuristic ดีแค่ไหน มันก็มีหน้าประหลาดเสมอ
ควรมี:

* merge/split balloon group
* drag reorder group
* choose reading mode per page
* re-run OCR on selected region only

อันนี้ practical กว่าไล่แก้ heuristic จนตาย

---

# สิ่งที่ไม่ควรเสียเวลาเกินไป

## อย่าไปหวัง fix ด้วย post-sort string logic อย่างเดียว

เช่นพยายามเอา language model มาเดาว่าอันไหนควรอยู่ก่อนหลัง
มันช่วยได้บ้าง แต่เป็นปลายเหตุ

ถ้า grouping/layout ยังผิด ต่อให้ translator เก่งขึ้นก็ยังมั่ว

---

# DB error ที่เห็นในภาพ

พวกนี้:

* `Failed to persist total pages`
* `Failed to persist page activity`

น่าจะ **ไม่ใช่ root cause ของ OCR order**
แต่ควรแก้ เพราะมันทำให้ cache/state เพี้ยนและ debug ยาก

โดยเฉพาะถ้ามี logic แนว:

* recently cleared cache
* skip cache read
* page activity debounce

มันอาจทำให้ผล OCR/state ใน UI ไม่ตรงกับ internal result

สรุป: ไม่ใช่ต้นเหตุหลักของ order ผิด แต่เป็น **noise ที่ควรล้างออก**

---

# แผนแก้แบบคุ้มสุด

## Phase 1 — แก้ให้เห็นผลเร็ว

1. ใช้ quad-based crop rotation ก่อน OCR recognition
2. เลิก sort OCR result แบบ `y/x`
3. ทำ grouping ด้วย proximity + size + angle similarity
4. translate ต่อ group ไม่ใช่ต่อ box

## Phase 2 — ยกระดับจริง

1. เพิ่ม balloon connected-region extraction
2. แยก order ภายใน balloon กับระหว่าง balloon
3. รองรับ reading mode ต่อภาษา/ต่อหน้า

## Phase 3 — ระดับใช้งานจริงหนักๆ

1. panel detection
2. manual correction UI
3. confidence-based fallback engine

   * PaddleOCR
   * EasyOCR / Tesseract เฉพาะ region ที่ fail

---

# คำตอบตรงๆ

ใช่ มึงเข้าใจปัญหาถูกแล้ว:

**ต้อง “รวมกล่องข้อความที่เป็น balloon เดียวกันก่อน” แล้วค่อยเรียงลำดับ balloon ถัดไป**
ไม่ใช่เอา OCR boxes ทั้งหน้ามา sort แบบ row-major แล้วโยนเข้า translator

นั่นคือสาเหตุที่คำแปลตีความบริบทผิด

---

# สรุปที่ควรทำตอนนี้

**โซลูชันที่เหมาะสุดสำหรับ stack ของมึงตอนนี้คือ:**

* ใช้ PaddleOCR สำหรับ detect ต่อได้
* ทำ **rotation normalization per box**
* เพิ่ม **balloon grouping layer**
* แยก **line order in balloon** ออกจาก **balloon order on page**
* ส่งเข้า Argos เป็น **balloon-level text**
* เพิ่ม UI ให้ merge/split/reorder manual ได้

นี่คือทางที่ถูกและ scalable
ไม่ใช่แค่ patch ให้ผ่านเคสนี้

ถ้ามึงต้องการ ผมร่างต่อให้ได้เลยเป็น **algorithm + TypeScript data model + pseudocode สำหรับ `groupTextBoxesIntoBalloons()` และ `sortBalloonReadingOrder()`** แบบเอาไปลง Electron/Vite ได้ตรงๆ.
