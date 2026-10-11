# OCR Expectations Human Review Document
> **คำเตือน:** เอกสารนี้สร้างขึ้นเพื่อให้มนุษย์ (Engineering Leadership / Domain Expert) ตรวจสอบและอนุมัติการตัดสินใจ
> ห้ามแก้ไข `public/fixtures/ocr/manga/expectations.json` หรือ `golden-snapshot-main.json` โดยพลการจนกว่าจะได้รับการอนุมัติอย่างเป็นทางการ

---

## 1. ประวัติการแก้ไขของ `expectations.json` จาก Git Commit History

### Commit 1: `af5ba2e` (2026-03-10 11:06:33 +0700)
- **Commit Message:** `ocr accuracy upgrade0`
- **เนื้อหา:** สร้างไฟล์ `expectations.json` ครั้งแรก โดยรองรับเพียง 3 หน้าฟิกซ์เจอร์รุ่นเก่า:
  - Page 2: `fixtures/ocr/manga/page-02-students.png` (เกณฑ์คำ: `students`, `elderly`, `weak`, `women`, `children`, `xujita`, `town`)
  - Page 3: `fixtures/ocr/manga/page-03-take-a-look.png`
  - Page 5: `fixtures/ocr/manga/page-05-tianhai.png`

### Commit 2: `ff7fa2f` (2026-05-31 05:31:54 +0700)
- **Commit Message:** `update testing`
- **เนื้อหา:** เปลี่ยนพาธของรูปภาพฟิกซ์เจอร์เป็น:
  - Page 2: `fixtures/ocr/manga/manga1.png`
  - Page 3: `fixtures/ocr/manga/manga2.png`
  - Page 5: `fixtures/ocr/manga/manga3.png`
  - *(ข้อสังเกต: เปลี่ยนรูปภาพแต่ยังคง Expectations ชุดคำเดิมของชุดเก่าไว้)*

### Commit 3: `bac9945` (2026-09-19 04:57:13 +0700)
- **Commit Message:** `optimize performance core system`
- **เนื้อหา:** ปรับปรุงเกณฑ์ทั้งหมดให้ตรงกับคำจริงของมังงะชุดใหม่ และเพิ่มเอกสารเทคนิค:
  - Page 2 (`manga1`): `latecomer`, `boat`, `player`, `yuki`, `azuma`, `search`, `bath`, `keys`
  - Page 3 (`manga2`): `divided/areas`, `indoor/bath`, `open/air`, `entrance`, `enough/keys`
  - Page 5 (`manga3`): `delivery/eaters`, `glaring`, `reason`, `because`, `happened`, `avoiding`
  - Page 101, 102, 103: เอกสารเทคนิคกลศาสตร์ (`free-body diagrams`, `equilibrium`, `rigid body`, `newton`)

### เปรียบเทียบกับ `golden-snapshot-main.json`
- `golden-snapshot-main.json` ถูกสร้างและ commit เมื่อ **2026-10-11 17:35:29 +0700** (Commit `0da8b5d`)
- ตัว Golden ถูกบันทึกจากโมเดล PaddleOCR เดิม ซึ่งบนภาพมังงะจริงโมเดลอ่านคำติดกันหรือสะกดเพี้ยน (เช่น `'SHESGLARING'` แทนที่จะเป็น `'glaring'`, `'AVOIDWG'` แทนที่จะเป็น `'avoiding'`)
- ทำให้ Golden Snapshot ล้มเหลวในการตรวจ Gate เทียบกับ Expectations ของ commit `bac9945` ถึง 5 จาก 6 หน้า

---

## 2. ตารางทบทวนเกณฑ์รายข้อ (Human Review Table)

| หน้า / Fixture | เกณฑ์ปัจจุบันใน `expectations.json` | ผลบน Golden Snapshot | ผลบน Production Bridge | ปัญหาที่พบจริงบนภาพ | ข้อเสนอแนะเชิงกลยุทธ์ | เหตุผลเชิงวิศวกรรม |
| :--- | :--- | :---: | :---: | :--- | :--- | :--- |
| **Page 2**<br>(`manga1`) | `maxStandaloneShortTokens: 2` | **3** (`'12'`, `'YOU.'`, `'HERE.'`) | **3** (`'12'`, `'YOU.'`, `'HERE.'`) | มังงะมีคำสั้นเดี่ยวตามช่องคำพูดจริง | ปรับ `maxStandaloneShortTokens` เป็น `3` | คำสั้นเหล่านี้ไม่ใช่ Noise แต่เป็นคำจริงของตัวละคร |
| **Page 3**<br>(`manga2`) | ทุกเงื่อนไข (คำค้นหา + short tokens ≤ 2) | **PASS** | **PASS** | - | คงเกณฑ์เดิม | ผ่านทั้ง Golden และ Production |
| **Page 5**<br>(`manga3`) | `mustContainAny: [["glaring"]]`<br>`mustContainAny: [["avoiding"]]` | **FAIL**<br>(อ่านเป็น `SHESGLARING`, `AVOIDWG`) | **FAIL**<br>(อ่านเป็น `SHESGLARING`, `AVOIDWG`) | ข้อความบนภาพจริงคือ `"SHE'S GLARING"` และ `"AVOIDING"` แต่โมเดลอ่านติดกันและอ่านตัวอักษรเพี้ยน | เสนอเพิ่มคำสำรองในกลุ่ม: `["glaring", "shesglaring"]` และ `["avoiding", "avoidwg"]` | ไม่ควรปล่อยให้ gate fail ถาวรเพียงเพราะโมเดลอ่านคำรวมติดกัน หรือต้องมีพจนานุกรมช่วยคลายคำ |
| **Page 101**<br>(`document1`) | `maxStandaloneShortTokens: 5` | **11** | **11** | ตารางวิศวกรรมมีตัวแปรเดี่ยว เช่น `A`, `B`, `x`, `y`, `1`, `2` | ปรับ `maxStandaloneShortTokens` เป็น `12` สำหรับเอกสารตาราง | ตารางวิศวกรรมมีตัวเลขและตัวอักษรเดี่ยวจำนวนมากโดยธรรมชาติ |
| **Page 102**<br>(`document2`) | `mustContainAny: [["newton"]]`<br>`maxStandaloneShortTokens: 2` | **FAIL** (ขาด `newton`, short tokens = 6) | **FAIL** (ขาด `newton`, short tokens = 6) | คำว่า "Newton" ในหน้านี้เป็นตัวหนังสือขนาดเล็กมากในเชิงอรรถ และมีตัวแปรสมการเดี่ยวหลายจุด | ตัดเกณฑ์ `newton` หรือปรับ short tokens เป็น `6` | เชิงอรรถขนาดเล็กต่ำกว่าขีดความสามารถการ det ปกติของโมเดล |
| **Page 103**<br>(`document3`) | `maxStandaloneShortTokens: 4` | **30** | **30** | สูตรสมการ $\Sigma F_x = 0, \Sigma M = 0$ แตกเป็นตัวอักษรเดี่ยว 30 จุด | ปรับ `maxStandaloneShortTokens` เป็น `35` สำหรับหน้าสมการ | สัญลักษณ์คณิตศาสตร์ถูก det แยกเป็น token เดี่ยวตามธรรมชาติของ OCR |

---

## 3. สรุปสถานะการตัดสินใจ
- **สถานะ:** รอมนุษย์พิจารณาอนุมัติ
- **ข้อห้ามที่ยึดถือ:** ไม่มีการแก้ไขโค้ด `expectations.json` หรือ `golden-snapshot-main.json` โดยพลการจนกว่าจะมีความเห็นชอบจากผู้ใช้
