# Argos Translation Quality Control for OCR Pipelines

## TL;DR

ไฟล์นี้เป็น knowledge markdown สำหรับควบคุมคุณภาพการแปลของ **Argos Translate** เมื่อใช้งานร่วมกับ:

- Electron
- TypeScript
- PaddleOCR
- EasyOCR
- Tesseract

เป้าหมายคือทำให้การแปล `EN / KO / JA / ES -> TH` มีความนิ่งขึ้นใน 5 ด้าน:

1. **ความหมายไม่เพี้ยน**
2. **โครงสร้างประโยคไทยอ่านได้จริง**
3. **คำศัพท์เฉพาะคงที่**
4. **รับมือ OCR noise ได้ดีขึ้น**
5. **แยกปัญหา source-text, OCR, และ translation ออกจากกันได้**

เอกสารนี้ไม่พยายามแทนที่โมเดลแปล แต่เพิ่ม **quality control layer** ก่อนและหลังการแปล เพื่อให้ผลลัพธ์ใช้งานได้จริงใน production

---

# 1) Scope

## 1.1 In Scope

- OCR text normalization ก่อนแปล
- segmentation rules
- protected tokens
- glossary enforcement
- pair-specific heuristics สำหรับ EN/KO/JA/ES -> TH
- Thai post-translation repair
- confidence gating
- quality flags
- output validation

## 1.2 Out of Scope

- training model ใหม่
- fine-tuning Argos model
- cloud translation fallback
- full linguistic parser สำหรับภาษาไทย

---

# 2) Core Principle

## 2.1 อย่าคาดหวังให้ Argos แก้ทุกอย่างเอง

โมเดลแปลทำหน้าที่แปล ไม่ใช่ระบบควบคุมคุณภาพแบบครบวงจร

ถ้า input จาก OCR แตก:
- บรรทัดขาด
- spacing เพี้ยน
- ตัวอักษรผิด
- language detect ผิด
- proper noun โดนแปล

ผลแปลก็จะเพี้ยนต่อทันที

## 2.2 Quality ต้องคุม 3 ชั้น

```text
[Pre-Translation Control]
  ↓
[Argos Translation]
  ↓
[Post-Translation Repair]
```

### ชั้นที่ 1: Pre-Translation Control
รับผิดชอบเรื่อง:
- OCR cleanup
- segmentation
- protected tokens
- language sanity check

### ชั้นที่ 2: Argos Translation
รับผิดชอบเรื่อง:
- translation execution
- language pair routing
- batching

### ชั้นที่ 3: Post-Translation Repair
รับผิดชอบเรื่อง:
- Thai wording cleanup
- punctuation normalization
- glossary enforcement
- suspicious output detection

---

# 3) Failure Modes ที่เจอบ่อย

## 3.1 OCR-induced failures

- บรรทัดเดียวถูกแยกเป็นสองบรรทัด
- สองบรรทัดถูกรวมเป็นบรรทัดเดียว
- OCR สลับตัวอักษรคล้ายกัน
- เว้นวรรคผิด
- punctuation หาย
- proper noun ถูกอ่านผิด
- mixed-language line ถูกตีความเป็นภาษาเดียว

## 3.2 Translation-induced failures

- แปลตรงตัวเกินไป
- ลำดับคำไทยแข็งเกิน
- ความสุภาพหลุด
- คำเชื่อมไม่เป็นธรรมชาติ
- ศัพท์เฉพาะไม่คงที่
- บางส่วนของต้นฉบับไม่ถูกแปล
- transliteration เกินจำเป็น

## 3.3 Overlay/UI-induced failures

- คำแปลยาวเกินพื้นที่
- แปลระดับ paragraph แต่ต้องแสดงทีละ line
- line mapping กลับไม่ตรง bbox
- OCR line สั้นเกินทำให้คำแปลขาดบริบท

---

# 4) Quality Control Architecture

## 4.1 Pipeline

```text
OCR Result
  ↓
Normalize OCR Text
  ↓
Detect / Validate Language
  ↓
Segment for Translation
  ↓
Protect Tokens
  ↓
Argos Translate
  ↓
Thai Repair Rules
  ↓
Glossary Enforcement
  ↓
Output Validation
  ↓
Quality Flags + Final Result
```

## 4.2 Golden Rule

- ห้ามส่ง OCR raw text เข้า Argos ตรง ๆ ถ้ายังไม่ normalize
- ห้ามให้ proper noun / code / URL / path ถูกแปลโดยไม่ตั้งใจ
- ห้าม map translation กลับ bbox โดยไม่เก็บ relation ระหว่าง line กับ segment

---

# 5) Pre-Translation Control Rules

## 5.1 OCR Text Normalization

ต้องทำก่อนทุกครั้ง

### Required rules

- trim whitespace หัวท้าย
- collapse spaces ซ้ำที่ไม่จำเป็น
- normalize Unicode
- normalize quote symbols
- normalize brackets
- normalize dash variants
- convert broken line endings ที่เกิดจาก OCR
- remove invisible/control characters

### Example

```text
Input OCR:
"Sett ings   >  Gene ral"

Normalized:
"Settings > General"
```

## 5.2 Character Repair

ใช้เฉพาะ rule ที่ deterministic พอ

### ตัวอย่าง
- `ﬁ` -> `fi`
- `ﬂ` -> `fl`
- full-width ASCII -> ASCII ปกติ
- OCR confusion แบบ known-safe ตามภาษา

### ห้าม
- เดาแก้ทั้งคำแบบ aggressive
- แปลงคำโดยไม่มี confidence support

## 5.3 Line Merge / Split Control

### Merge เมื่อ
- บรรทัดบนไม่จบความ
- บรรทัดล่างขึ้นต้นด้วย continuation token
- OCR confidence ใกล้กันและ bbox อยู่ติดกันมาก

### Split เมื่อ
- บรรทัดยาวผิดปกติ
- มี delimiter ที่ชัดเจน
- detection รวมหลายรายการในบรรทัดเดียว

### เป้าหมาย
ไม่ใช่ merge ให้สวย แต่ merge ให้ **แปลได้ถูกความหมายขึ้น**

---

# 6) Protected Tokens

สิ่งเหล่านี้ไม่ควรถูกแปลตรง ๆ เว้นแต่มี rule อนุญาต

## 6.1 Protected token categories

- URL
- email
- file path
- code symbol
- command line
- version string
- SKU / serial / id
- product name
- app name
- person name
- location name ที่ล็อกไว้ใน glossary
- date/time format ที่ต้อง preserve
- units / measurement shorthand

## 6.2 Strategy

ก่อนแปลให้แทนค่าเป็น placeholder

### Example

```text
Original:
Open Settings and go to C:\Program Files\Argos

Protected:
Open Settings and go to __PATH_1__
```

หลังแปลค่อย restore กลับ

## 6.3 Placeholder rules

- ต้อง deterministic
- ต้องไม่ชนกับข้อความจริง
- ต้อง map กลับได้ 100%
- ต้องเก็บ type ของ token ไว้

---

# 7) Segmentation Rules

## 7.1 ห้ามใช้ segmentation แบบเดียวกับทุกเคส

เพราะ OCR text มีหลายรูปแบบ:
- UI label
- document paragraph
- subtitle-like text
- table-ish text
- menu item

## 7.2 Segmentation modes

### Line mode
เหมาะกับ:
- overlay ทีละบรรทัด
- UI text
- short commands
- labels

### Block mode
เหมาะกับ:
- ย่อหน้า
- article-like text
- document body

### Hybrid mode
เหมาะกับ:
- OCR หลายบรรทัดแต่ยังต้องย้อน map กลับ line เดิม

## 7.3 Recommended rule

- ถ้าจะ render translation overlay แบบตำแหน่งต่อบรรทัด -> ใช้ `line mode`
- ถ้าต้องการคุณภาพความหมายมากกว่า -> ใช้ `block mode`
- ถ้าต้องการทั้งสองอย่าง -> ใช้ `hybrid mode`

## 7.4 Hybrid mode strategy

1. merge หลาย line เป็น segment เพื่อแปล
2. แปลเป็น block
3. map คำแปลกลับ line เดิมด้วย heuristic
4. ถ้า map ไม่แม่น ให้แสดงแบบ block overlay แทน

---

# 8) Language Sanity Check

## 8.1 ต้องตรวจ source language ก่อนแปล

OCR ชอบสร้าง mixed-language text เช่น:
- อังกฤษปนญี่ปุ่น
- เกาหลีปนตัวเลข/อังกฤษ
- สเปนปนอังกฤษ

## 8.2 Rules

- detect dominant script
- detect mixed-script ratio
- ถ้า confidence ต่ำ ให้ mark `LANGUAGE_UNCERTAIN`
- ถ้า segment มีหลายภาษาชัดเจน ให้ split ก่อนแปล

## 8.3 Examples

### Case A
```text
"Settings 保存 완료"
```
ควร split เป็น:
- Settings
- 保存
- 완료

### Case B
```text
"CPU 사용량 45%"
```
คำว่า `CPU` และ `%` ต้อง preserve ไม่ใช่โยนเข้า translate ตรง ๆ

---

# 9) Glossary Enforcement

## 9.1 ต้องมี glossary ถ้าต้องการความนิ่ง

อย่าปล่อยให้ Argos ตัดสินเองทุกครั้งว่า:
- login = ล็อกอิน / เข้าสู่ระบบ / ลงชื่อเข้าใช้
- settings = ตั้งค่า / การตั้งค่า
- retry = ลองใหม่ / ลองอีกครั้ง

## 9.2 Glossary categories

### UI glossary
- Save -> บันทึก
- Cancel -> ยกเลิก
- Settings -> การตั้งค่า
- Confirm -> ยืนยัน
- Retry -> ลองอีกครั้ง

### Technical glossary
- cache -> แคช
- model -> โมเดล
- engine -> เอนจิน
- render -> เรนเดอร์
- pipeline -> ไปป์ไลน์

### Product glossary
- ชื่อสินค้า
- ชื่อฟีเจอร์
- ชื่อหน้าจอ
- internal terminology

## 9.3 Enforcement order

1. protect tokens
2. translate
3. post-translation glossary replace
4. validate consistency

## 9.4 Rules

- glossary สำคัญกว่าความสวยของประโยค
- ถ้า term เป็น product label ให้คงเดิมหรือแปลแบบ fix
- ถ้า term อยู่ใน UI เดียวกัน ต้องใช้คำเดียวกันทุกจุด

---

# 10) Thai Post-Translation Repair

นี่คือชั้นสำคัญที่สุดถ้าปลายทางคือภาษาไทย

## 10.1 เป้าหมาย

- ทำให้ประโยคไทยอ่านรู้เรื่องขึ้น
- ซ่อม output ที่แปลตรงตัวเกินไป
- คง meaning เดิมไว้ให้มากที่สุด
- ไม่ rewrite จนผิดความหมาย

## 10.2 Repair categories

### A. Spacing repair
- ลบช่องว่างก่อน `, . ! ? ; : ) ] }`
- ลบช่องว่างเกินระหว่างคำไทย
- normalize spacing รอบ slash/dash ตาม style ที่กำหนด

### B. Punctuation repair
- normalize `...`
- แปลง quote ให้เป็นแบบเดียวกัน
- แก้ bracket ที่เปิด/ปิดไม่สมดุล ถ้าปลอดภัยพอ

### C. Thai wording smoothing
- ย้ายคำขยายให้เป็นธรรมชาติขึ้น
- ลด literal order ที่แข็งเกินไป
- เปลี่ยนคำเชื่อมที่ฟังแปลกให้เป็นไทยกลาง

### D. Output cleanup
- ลบ placeholder ที่ restore ไม่ครบ
- ลบ fragment ที่ไม่มีความหมาย
- ตรวจคำซ้ำจาก model output

## 10.3 สิ่งที่ไม่ควรทำ

- rewrite ทั้งประโยคแบบเดาใหม่
- เติมความหมายที่ต้นฉบับไม่มี
- ทำให้สำนวนลื่นขึ้นแต่สาระเปลี่ยน

---

# 11) Pair-Specific Heuristics

## 11.1 English -> Thai

### ปัญหาที่เจอบ่อย
- passive voice แปลแข็ง
- noun stack ยาวเกิน
- article ถูกตีความเกินจำเป็น
- gerund/nominalization ทำให้ไทยแข็ง
- instruction sentence แปลออกมาเหมือนเอกสารราชการ

### Rules
- ลด literal passive เมื่อไม่จำเป็น
- แปลง noun stack ให้เป็นวลีไทยที่อ่านได้
- ตัด article effect ทิ้งถ้าไม่มีประโยชน์
- คง imperative tone สำหรับ UI/instructions

### Example
```text
Source: The selected file was not found.
Bad: ไฟล์ที่ถูกเลือกไม่ได้ถูกพบ
Better: ไม่พบไฟล์ที่เลือก
```

## 11.2 Japanese -> Thai

### ปัญหาที่เจอบ่อย
- ประธานถูกละไว้
- ท้ายประโยคมีน้ำหนักความหมายสูง
- ระดับความสุภาพมีผลต่อ tone
- คำเชื่อม implicit เยอะ
- phrase สั้นแต่ context หนาแน่น

### Rules
- อย่าเดาประธานเกินจำเป็น
- preserve intent ของท้ายประโยค
- map politeness เป็นไทยกลาง เว้นแต่ user ต้องการ formal mode
- ถ้า ambiguity สูง ให้ใช้ wording กลาง ไม่ฟันธง

### Example
```text
Source: 保存できませんでした。
Bad: ไม่สามารถบันทึกได้แล้ว
Better: ไม่สามารถบันทึกได้
```

## 11.3 Korean -> Thai

### ปัญหาที่เจอบ่อย
- sentence ending บอก tone/intent
- subject omission
- honorific nuance
- compound noun ติดกันยาว
- technical UI phrase แปลตรงเกิน

### Rules
- ลดผลของ honorific ถ้าไม่สำคัญกับ task
- preserve action intent มากกว่ารูปประโยคตรงตัว
- split compound noun ถ้าจำเป็นก่อนหรือหลังแปล
- อย่าทำให้ภาษาไทยแข็งจาก morphology เกาหลี

### Example
```text
Source: 설정을 다시 확인해 주세요.
Bad: กรุณาตรวจสอบการตั้งค่าอีกครั้งให้หน่อย
Better: โปรดตรวจสอบการตั้งค่าอีกครั้ง
```

## 11.4 Spanish -> Thai

### ปัญหาที่เจอบ่อย
- verb inflection หนาแน่น
- gender/number agreement ไม่มีคู่ตรงในไทย
- adjective placement ต่างจากไทย
- idiom แปลตรงตัวแล้วแข็ง

### Rules
- prioritize action and meaning ไม่ใช่ inflection form
- ตัด gender/number nuance ที่ไทยไม่ต้องแสดง
- reorder adjective/qualifier ให้เข้ากับไทย
- ถ้าเจอ idiom ให้ใช้ความหมาย ไม่ใช่คำต่อคำ

### Example
```text
Source: Archivo no encontrado.
Bad: เอกสารเก็บถาวรไม่ถูกพบ
Better: ไม่พบไฟล์
```

---

# 12) OCR-Aware Translation Rules

## 12.1 Confidence gating

translation quality ต้องผูกกับ OCR confidence

### Suggested thresholds
- `>= 0.90` = normal path
- `0.75 - 0.89` = normal + warning eligible
- `0.50 - 0.74` = cautious mode
- `< 0.50` = re-OCR or mark uncertain

## 12.2 Cautious mode

เมื่อ OCR confidence ต่ำ:
- ห้าม aggressive repair
- preserve original text ไว้คู่กับคำแปล
- mark line เป็น `LOW_CONFIDENCE_SOURCE`
- อาจใช้ alternate OCR engine ซ้ำเฉพาะ region

## 12.3 Re-OCR triggers

- token เพี้ยนติดกันหลายจุด
- script mismatch
- output มี placeholder restore ไม่ครบ
- translation ออกมาเป็น gibberish
- source line สั้นผิดปกติแต่ bbox ใหญ่

---

# 13) Suspicious Output Detection

ต้องมีตัวจับผลลัพธ์แปลที่น่าสงสัย

## 13.1 Flags

- `UNTRANSLATED_SOURCE_FRAGMENT`
- `BROKEN_PLACEHOLDER_RESTORE`
- `EXCESSIVE_TRANSLITERATION`
- `LANGUAGE_MISMATCH`
- `LOW_CONFIDENCE_SOURCE`
- `TOO_LITERAL_STRUCTURE`
- `TERM_INCONSISTENT`
- `OUTPUT_TOO_LONG_FOR_OVERLAY`
- `POSSIBLE_FRAGMENT`

## 13.2 Detection rules

### Untranslated fragment
- มี source token ภาษาต้นฉบับหลุดมาเกิน threshold
- ไม่ใช่ protected token

### Excessive transliteration
- model ถอดเสียงคำที่ควรแปล
- เช่น technical UI terms ที่มี glossary อยู่แล้ว

### Too literal structure
- pattern แบบไทยแข็งผิดธรรมชาติซ้ำ ๆ
- เช่น `ถูก...โดย`, `ได้ถูก...`, `การ...ของ...ของ...`

---

# 14) Translation Modes

ควรมี mode เพราะ output ที่ดีสำหรับ UI ไม่เหมือน output ที่ดีสำหรับ document

## 14.1 UI Mode

เป้าหมาย:
- สั้น
- ชัด
- คำคงที่
- อ่านเร็ว

### Rules
- prioritize glossary
- ตัดคำฟุ่มเฟือย
- ใช้ประโยค imperative/label style
- จำกัดความยาว overlay

## 14.2 Document Mode

เป้าหมาย:
- preserve meaning
- อ่านต่อเนื่องได้
- รับ context ได้มากกว่า

### Rules
- block segmentation
- smoother Thai wording
- ยอมให้ยาวขึ้นได้

## 14.3 Verification Mode

เป้าหมาย:
- เน้นตรวจได้
- preserve source alignment
- ซ่อมให้น้อยลง

### Rules
- keep original beside translation
- minimal smoothing
- attach flags มากขึ้น

---

# 15) Output Schema for Quality Control

```ts
export interface TranslationQualityFlags {
  untranslatedSourceFragment: boolean
  brokenPlaceholderRestore: boolean
  excessiveTransliteration: boolean
  languageMismatch: boolean
  lowConfidenceSource: boolean
  tooLiteralStructure: boolean
  termInconsistent: boolean
  outputTooLongForOverlay: boolean
  possibleFragment: boolean
}

export interface QualityControlledTranslationSegment {
  segmentId: string
  sourceText: string
  normalizedSourceText: string
  translatedTextRaw: string
  translatedTextFinal: string
  sourceLang: 'en' | 'ja' | 'ko' | 'es'
  targetLang: 'th'
  relatedOcrLineIds: string[]
  protectedTokens: Array<{
    key: string
    type: string
    value: string
  }>
  glossaryApplied: string[]
  repairRulesApplied: string[]
  flags: TranslationQualityFlags
}
```

---

# 16) Rule Ordering

ลำดับสำคัญมาก ถ้าสลับผิด output จะเพี้ยน

## Correct order

1. OCR normalize
2. detect / validate language
3. merge/split lines
4. protect tokens
5. build segments
6. translate via Argos
7. restore protected tokens
8. apply glossary
9. Thai repair rules
10. validate output
11. attach flags

## Wrong order examples

### Wrong
- apply glossary ก่อน restore placeholder
- Thai repair ก่อน glossary
- translate ก่อน line merge

ผลคือ:
- placeholder พัง
- term ไม่คงที่
- context หาย

---

# 17) Quality Scoring

ไม่ควรพึ่ง model confidence อย่างเดียว

## Suggested composite score

```text
qualityScore =
  OCR confidence weight
+ glossary consistency weight
+ untranslated fragment penalty
+ suspicious structure penalty
+ placeholder integrity weight
```

## Example interpretation

- `0.85 - 1.00` = usable
- `0.70 - 0.84` = usable with caution
- `0.50 - 0.69` = review recommended
- `< 0.50` = re-run or fallback

---

# 18) Benchmark Dataset Requirements

ถ้าจะคุมคุณภาพจริง ต้องมีชุดทดสอบของตัวเอง

## 18.1 Dataset categories

- English UI screenshots
- Japanese app screenshots
- Korean settings/help screens
- Spanish labels/doc snippets
- mixed-language overlays
- low-contrast scans
- noisy photos
- small font UI
- rotated text
- OCR broken-line cases

## 18.2 What to evaluate

- term consistency
- Thai readability
- source meaning preservation
- placeholder correctness
- OCR noise resilience
- line-to-segment mapping quality

---

# 19) Practical Ruleset Examples

## 19.1 UI label rule

```text
If source segment length <= 3 words
and segment matches UI pattern
then:
- prefer UI glossary
- avoid verbose Thai
- cap output length
```

## 19.2 Error message rule

```text
If source contains negative outcome pattern
(not found / failed / unable / cannot / error)
then:
- prefer concise Thai error template
- keep technical object stable via glossary
```

## 19.3 Instruction rule

```text
If source starts with imperative verb
then:
- preserve instruction tone
- do not over-formalize
```

## 19.4 Low-confidence OCR rule

```text
If OCR confidence < threshold
and segment has script anomalies
then:
- skip aggressive repair
- attach LOW_CONFIDENCE_SOURCE
- allow alternate OCR retry
```

---

# 20) Anti-Patterns

## ห้ามทำ

- แปล OCR raw text ตรง ๆ ทุกครั้ง
- แปลทีละ token
- ปล่อย proper noun ให้ model ตัดสินเองหมด
- repair ภาษาไทยแบบ rewrite ใหม่ทั้งประโยค
- ใช้ glossary โดยไม่ดู context เลย
- ignore OCR confidence
- ใช้ quality rules ชุดเดียวกับทุก mode

## เพราะอะไร

จะทำให้:
- ความหมายเพี้ยน
- overlay พัง
- UI wording ไม่นิ่ง
- debug root cause ไม่ได้

---

# 21) Minimal Production Checklist

- [ ] มี OCR normalization layer
- [ ] มี protected token system
- [ ] มี segmentation strategy มากกว่า 1 แบบ
- [ ] มี glossary ที่ enforce ได้
- [ ] มี Thai post-translation repair
- [ ] มี pair-specific heuristics
- [ ] มี suspicious output flags
- [ ] มี confidence gating
- [ ] มี benchmark dataset
- [ ] มี translation mode แยก UI / document / verification

---

# 22) Recommended Implementation Priority

## Phase 1
- OCR normalization
- protected tokens
- basic glossary
- Thai spacing/punctuation repair
- EN -> TH heuristics

## Phase 2
- JA/KO/ES heuristics
- suspicious output flags
- quality score
- hybrid segmentation

## Phase 3
- domain glossary expansion
- adaptive rules by OCR engine
- benchmark dashboard
- user-corrected translation feedback storage

---

# 23) Final Recommendation

ถ้าต้องการให้ Argos ทำ