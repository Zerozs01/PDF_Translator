# Thai Repair Rule Patterns for OCR Translation Output

## TL;DR

ไฟล์นี้คือชุดกฎซ่อมข้อความภาษาไทยหลังการแปล สำหรับ OCR translation pipeline ที่ใช้:

- Argos Translate
- Electron
- TypeScript
- PaddleOCR
- EasyOCR
- Tesseract

เป้าหมายของไฟล์นี้คือ:

1. ซ่อม output ภาษาไทยที่แปลแข็งหรือผิดรูปแบบ
2. ลดผลกระทบจาก OCR noise ที่หลุดมาถึงชั้น translation
3. คุม punctuation, spacing, placeholder restore, และ wording cleanup
4. ทำให้ output เหมาะกับ UI / overlay / document mode
5. ใช้เป็นฐานสำหรับ rule engine แบบ deterministic

ไฟล์นี้ **ไม่ใช่** grammar rewrite engine เต็มรูปแบบ
และ **ไม่ควร** ใช้เพื่อเดาความหมายใหม่ทั้งประโยค

---

# 1) Core Principle

## 1.1 Repair layer มีหน้าที่อะไร

Repair layer มีไว้เพื่อ:
- cleanup
- normalize
- smooth output
- reduce obvious literal artifacts
- improve readability

Repair layer **ไม่มีหน้าที่**:
- rewrite ทั้งประโยคใหม่
- ตีความแทน model
- เติมข้อมูลที่ต้นฉบับไม่มี
- เดาสาระใหม่จาก context ที่ไม่พอ

## 1.2 Golden Rule

ซ่อมเฉพาะสิ่งที่ **deterministic พอ** และ **ความเสี่ยงต่ำ**

ถ้ากฎไหนอาจทำให้ความหมายเพี้ยนง่าย:
- อย่าใช้แบบ auto
- ให้ mark เป็น warning หรือส่งไป manual review

---

# 2) Rule Execution Order

ลำดับสำคัญมาก

## Correct order

1. placeholder integrity check
2. whitespace normalization
3. punctuation normalization
4. symbol cleanup
5. Thai spacing cleanup
6. duplicate fragment cleanup
7. literal-structure repair
8. UI shortening rules
9. final validation

## Why

ถ้าทำ Thai wording repair ก่อน restore/cleanup:
- pattern matching จะพัง
- placeholder อาจถูกแก้ผิด
- glossary อาจชนกับ spacing noise

---

# 3) Suggested Rule Schema

```ts
export type RepairMode = 'ui' | 'overlay' | 'document' | 'verification'

export interface ThaiRepairRule {
  id: string
  category:
    | 'placeholder'
    | 'whitespace'
    | 'punctuation'
    | 'symbol'
    | 'duplicate'
    | 'literal-structure'
    | 'ui-shortening'
    | 'cleanup'
  description: string
  pattern: string
  replacement: string
  flags?: string[]
  mode?: RepairMode[]
  priority: number
  enabled: boolean
  notes?: string
}
```

---

# 4) Placeholder Repair Rules

## 4.1 Goal

ตรวจสอบว่า placeholder ที่ใช้ป้องกัน token สำคัญถูก restore ครบ

## 4.2 Rules

### Rule: broken placeholder spacing

```yaml
- id: placeholder-fix-spaces
  category: placeholder
  description: รวม placeholder ที่ถูกแยกด้วยช่องว่างกลับเป็นรูปแบบเดิม
  pattern: "__\s*([A-Z]+)\s*_\s*(\d+)\s*__"
  replacement: "__$1_$2__"
  priority: 100
  enabled: true
```

### Rule: orphan placeholder markers

```yaml
- id: placeholder-orphan-markers
  category: placeholder
  description: ตรวจจับ placeholder ที่เสียรูปเกินกว่าจะ restore อัตโนมัติ
  pattern: "__[^_\s]+$|^[^_\s]+__"
  replacement: "$0"
  flags:
    - BROKEN_PLACEHOLDER_RESTORE
  priority: 99
  enabled: true
```

---

# 5) Whitespace Normalization Rules

## 5.1 Remove repeated spaces

```yaml
- id: ws-collapse-multi-space
  category: whitespace
  description: รวมช่องว่างซ้ำหลายตัวให้เหลือตัวเดียว
  pattern: "[ \t]{2,}"
  replacement: " "
  priority: 95
  enabled: true
```

## 5.2 Trim line edges

```yaml
- id: ws-trim-edges
  category: whitespace
  description: ลบช่องว่างหัวท้ายประโยค
  pattern: "^\s+|\s+$"
  replacement: ""
  priority: 95
  enabled: true
```

## 5.3 Remove space before punctuation

```yaml
- id: ws-remove-before-punct
  category: whitespace
  description: ลบช่องว่างก่อนเครื่องหมายวรรคตอน
  pattern: "\s+([,.;:!?\)\]\}])"
  replacement: "$1"
  priority: 94
  enabled: true
```

## 5.4 Normalize space after punctuation

```yaml
- id: ws-space-after-latin-punct
  category: whitespace
  description: เติมช่องว่างหลัง punctuation แบบละตินเมื่อจำเป็น
  pattern: "([,.;:!?])(\S)"
  replacement: "$1 $2"
  priority: 70
  enabled: false
  notes: ใช้เฉพาะโหมด document/verification และต้องระวังภาษาไทยที่ไม่ต้องเว้นแบบอังกฤษ
```

---

# 6) Punctuation Normalization Rules

## 6.1 Normalize ellipsis

```yaml
- id: punct-ellipsis
  category: punctuation
  description: รวมจุดหลายตัวเป็น ...
  pattern: "\.{4,}"
  replacement: "..."
  priority: 92
  enabled: true
```

## 6.2 Normalize duplicate punctuation

```yaml
- id: punct-duplicate-basic
  category: punctuation
  description: ลดเครื่องหมายซ้ำเกินความจำเป็น
  pattern: "([!?]){2,}"
  replacement: "$1"
  priority: 90
  enabled: true
```

## 6.3 Fix mixed punctuation spacing

```yaml
- id: punct-mixed-spacing
  category: punctuation
  description: ลบ spacing แปลกระหว่าง punctuation ต่อเนื่อง
  pattern: "([!?.,])\s+([!?.,])"
  replacement: "$1$2"
  priority: 88
  enabled: true
```

## 6.4 Normalize brackets spacing

```yaml
- id: punct-bracket-inner-space
  category: punctuation
  description: ลบช่องว่างด้านในวงเล็บที่ไม่จำเป็น
  pattern: "\(\s+|\s+\)"
  replacement: ""
  priority: 86
  enabled: true
```

---

# 7) Symbol Cleanup Rules

## 7.1 Normalize dashes

```yaml
- id: symbol-normalize-dash
  category: symbol
  description: แปลง dash หลากหลายแบบให้เป็น -
  pattern: "[‐‑‒–—―]+"
  replacement: "-"
  priority: 85
  enabled: true
```

## 7.2 Normalize quotes

```yaml
- id: symbol-normalize-quotes
  category: symbol
  description: แปลง quote หลากหลายแบบให้เป็นแบบมาตรฐาน
  pattern: "[“”„‟]"
  replacement: "\""
  priority: 82
  enabled: true
```

## 7.3 Normalize apostrophes

```yaml
- id: symbol-normalize-apostrophe
  category: symbol
  description: แปลง apostrophe หลากหลายแบบให้เป็น '
  pattern: "[‘’‚‛]"
  replacement: "'"
  priority: 82
  enabled: true
```

---

# 8) Thai Spacing Cleanup Rules

> ภาษาไทยไม่มีหลักเว้นวรรคเหมือนอังกฤษ ต้องซ่อมแบบระวังมาก

## 8.1 Remove spaces between Thai characters

```yaml
- id: th-remove-space-between-thai
  category: cleanup
  description: ลบช่องว่างที่แทรกระหว่างอักษรไทยอย่างผิดปกติ
  pattern: "([ก-๙])\s+([ก-๙])"
  replacement: "$1$2"
  priority: 93
  enabled: false
  notes: เสี่ยงรวมคำผิด ควรใช้เฉพาะกรณี OCR spacing noise ชัดเจน หรือใช้ heuristic เพิ่ม
```

## 8.2 Remove spaces before Thai tone/marks

```yaml
- id: th-remove-space-before-mark
  category: cleanup
  description: ลบช่องว่างก่อนวรรณยุกต์หรือเครื่องหมายไทยที่หลุด
  pattern: "([ก-๙])\s+([่-๋็์ํ])"
  replacement: "$1$2"
  priority: 94
  enabled: true
```

## 8.3 Remove spaces around Thai punctuation style if configured

```yaml
- id: th-normalize-thai-punct-spacing
  category: cleanup
  description: ลบช่องว่างรอบ punctuation ที่ไม่ต้องมีในไทย
  pattern: "\s*([ๆฯ])\s*"
  replacement: "$1"
  priority: 80
  enabled: true
```

---

# 9) Duplicate / Fragment Cleanup Rules

## 9.1 Remove direct duplicated word

```yaml
- id: dup-direct-word
  category: duplicate
  description: ลบคำซ้ำติดกันโดยไม่จำเป็น
  pattern: "\b(\S+)\s+\1\b"
  replacement: "$1"
  priority: 78
  enabled: true
```

## 9.2 Remove duplicated Thai phrase (conservative)

```yaml
- id: dup-thai-phrase-short
  category: duplicate
  description: ลบวลีไทยสั้นที่ซ้ำติดกัน
  pattern: "([ก-๙]{2,20})\s+\1"
  replacement: "$1"
  priority: 70
  enabled: false
  notes: เปิดใช้เฉพาะเมื่อมั่นใจว่าโมเดลชอบ duplicate จริง
```

## 9.3 Remove empty bracket artifacts

```yaml
- id: cleanup-empty-brackets
  category: cleanup
  description: ลบวงเล็บว่างที่หลงเหลือจาก repair/restore
  pattern: "\(\)|\[\]|\{\}"
  replacement: ""
  priority: 76
  enabled: true
```

---

# 10) Literal Structure Repair Rules

> หมวดนี้ต้องระวังที่สุด เพราะแตะเรื่องความหมายโดยตรง

## 10.1 Replace stiff passive pattern

```yaml
- id: lit-passive-found
  category: literal-structure
  description: ซ่อมโครงสร้างแบบ 'ไม่ได้ถูกพบ' ให้สั้นลง
  pattern: "ไม่ได้ถูกพบ"
  replacement: "ไม่พบ"
  priority: 74
  enabled: true
```

## 10.2 Replace selected-file literal pattern

```yaml
- id: lit-selected-file
  category: literal-structure
  description: ซ่อม pattern อังกฤษตรงตัวของ selected file
  pattern: "ไฟล์ที่ถูกเลือก"
  replacement: "ไฟล์ที่เลือก"
  priority: 74
  enabled: true
```

## 10.3 Replace cannot-be-saved overly literal pattern

```yaml
- id: lit-cannot-be-saved
  category: literal-structure
  description: ซ่อม pattern ที่แข็งเกินของการบันทึกไม่ได้
  pattern: "ไม่สามารถถูกบันทึกได้"
  replacement: "ไม่สามารถบันทึกได้"
  priority: 74
  enabled: true
```

## 10.4 Reduce excessive nominalization pattern

```yaml
- id: lit-nominalization-basic
  category: literal-structure
  description: ซ่อม nominalization บางรูปที่ฟังแข็ง
  pattern: "การทำการ"
  replacement: "การ"
  priority: 68
  enabled: true
```

## 10.5 Fix common machine-translated error phrase

```yaml
- id: lit-file-was-not-found
  category: literal-structure
  description: ซ่อมประโยค machine-translated ที่แข็งสำหรับ file not found
  pattern: "ไฟล์ที่ถูกเลือกไม่ได้ถูกพบ"
  replacement: "ไม่พบไฟล์ที่เลือก"
  priority: 80
  enabled: true
```

---

# 11) UI Shortening Rules

> ใช้เฉพาะโหมด UI/overlay เพื่อให้ข้อความไม่ยาวเกิน

## 11.1 Shorten formal request

```yaml
- id: ui-shorten-please-check
  category: ui-shortening
  description: ลดประโยคสุภาพยาวให้สั้นลงสำหรับ UI
  pattern: "โปรดตรวจสอบ([^\n]{0,40})อีกครั้ง"
  replacement: "ตรวจสอบ$1อีกครั้ง"
  priority: 66
  enabled: false
  mode:
    - ui
    - overlay
```

## 11.2 Shorten processing complete phrase

```yaml
- id: ui-shorten-process-complete
  category: ui-shortening
  description: ลดคำว่า เสร็จสิ้นการประมวลผล เป็น ประมวลผลเสร็จแล้ว
  pattern: "เสร็จสิ้นการประมวลผล"
  replacement: "ประมวลผลเสร็จแล้ว"
  priority: 64
  enabled: false
  mode:
    - ui
    - overlay
```

## 11.3 Simplify unavailable phrase

```yaml
- id: ui-shorten-unavailable
  category: ui-shortening
  description: ย่อ ไม่พร้อมใช้งาน ในบาง UI เป็น ใช้งานไม่ได้
  pattern: "ไม่พร้อมใช้งาน"
  replacement: "ใช้งานไม่ได้"
  priority: 60
  enabled: false
  mode:
    - ui
    - overlay
  notes: แล้วแต่ style guide ของแอป
```

---

# 12) Mode-Specific Guidance

## 12.1 UI Mode

เหมาะกับ:
- button labels
- menu items
- small dialog
- setting screens

Rule style:
- aggressive shortening ได้มากขึ้น
- prioritize consistency
- prioritize brevity
- avoid formal verbose Thai

## 12.2 Overlay Mode

เหมาะกับ:
- translated text overlay บนภาพ
- subtitle-like display

Rule style:
- ต้องคุม length มาก
- ห้าม rewrite เยอะจน map กลับ source ไม่ได้
- รักษา alignment พอประมาณ

## 12.3 Document Mode

เหมาะกับ:
- paragraph translation
- article/document body

Rule style:
- smoothing ได้มากกว่า UI
- ลด literal artifacts แบบระวัง
- ไม่ shorten เกินจำเป็น

## 12.4 Verification Mode

เหมาะกับ:
- review source-to-target
- QA/debug

Rule style:
- cleanup อย่างเดียว
- ลด rewriting ให้น้อยที่สุด
- preserve source alignment

---

# 13) Rule Safety Levels

## Safe

ใช้ auto ได้:
- whitespace cleanup
- punctuation cleanup
- quote/dash normalization
- placeholder spacing fix
- empty bracket cleanup

## Medium Risk

ใช้ได้ถ้ามี context/mode support:
- duplicate phrase removal
- UI shortening
- Thai spacing merge บางกรณี

## High Risk

อย่าเปิด auto ทั้งหมดถ้ายังไม่มี benchmark:
- literal structure rewrite
- Thai word merging กว้าง ๆ
- semantic shortening
- passive-to-active rewrite หลายรูปแบบ

---

# 14) Validation Rules

หลัง repair ต้องตรวจอีกครั้ง

## 14.1 Required checks

- placeholder restore ครบไหม
- มี bracket ไม่สมดุลไหม
- มี source language หลุดมาแบบไม่ควรไหม
- length เกิน overlay limit ไหม
- มี punctuation แปลกติดกันไหม
- มี duplicated token ที่เหลือไหม

## 14.2 Flag examples

- BROKEN_PLACEHOLDER_RESTORE
- UNBALANCED_BRACKETS
- RESIDUAL_SOURCE_FRAGMENT
- OUTPUT_TOO_LONG_FOR_OVERLAY
- POSSIBLE_OVER_REPAIR

---

# 15) Implementation Notes

## 15.1 อย่า hardcode ทุกกฎลงโค้ดทันที

ควรโหลดจาก config เช่น:
- YAML
- JSON
- TOML

เพื่อให้:
- ปรับกฎได้โดยไม่ต้อง rebuild ทั้งระบบ
- เปิด/ปิดตาม mode ได้
- benchmark A/B test ได้

## 15.2 Recommended execution API

```ts
export interface ThaiRepairInput {
  text: string
  mode: 'ui' | 'overlay' | 'document' | 'verification'
  flags?: string[]
}

export interface ThaiRepairOutput {
  originalText: string
  repairedText: string
  appliedRuleIds: string[]
  flags: string[]
}
```

---

# 16) Starter Ruleset Recommendation

ถ้าจะเริ่มใช้งานจริง ให้เปิดแค่กฎกลุ่มนี้ก่อน:

### เปิดทันที
- placeholder-fix-spaces
- ws-collapse-multi-space
- ws-trim-edges
- ws-remove-before-punct
- punct-ellipsis
- punct-duplicate-basic
- punct-mixed-spacing
- symbol-normalize-dash
- symbol-normalize-quotes
- symbol-normalize-apostrophe
- th-remove-space-before-mark
- cleanup-empty-brackets
- lit-passive-found
- lit-selected-file
- lit-cannot-be-saved
- lit-file-was-not-found

### ปิดไว้ก่อนจนกว่าจะ benchmark
- th-remove-space-between-thai
- dup-thai-phrase-short
- ui-shorten-please-check
- ui-shorten-process-complete
- ui-shorten-unavailable

---

# 17) Anti-Patterns

## ห้าม

- ใช้ repair layer แก้ทุกความผิดของ model
- ซ่อมเชิง semantic แบบเดาเอง
- เปิดทุก rule พร้อมกันตั้งแต่วันแรก
- ใช้ rule เดียวกับทุก mode
- ไม่เก็บ appliedRuleIds
- ไม่ track flags หลัง repair

## เพราะอะไร

สุดท้ายคุณจะไม่รู้ว่า:
- พังเพราะ Argos
- พังเพราะ OCR
- พังเพราะ repair rule
- หรือพังเพราะ glossary enforcement

---

# 18) Final Recommendation

repair layer ที่ดีต้อง:

- deterministic
- configurable
- benchmarkable
- mode-aware
- conservative by default

ถ้าจะให้ระบบดูดีขึ้นเร็วที่สุด:

1. เริ่มจาก cleanup rules ที่ปลอดภัย
2. ค่อยเพิ่ม literal repair เฉพาะ pattern ที่เจอบ่อยจริง
3. เปิด shortening rules เฉพาะ UI/overlay
4. benchmark ก่อนขยาย rule set

เป้าหมายของไฟล์นี้ไม่ใช่ทำให้ภาษาไทย “สวยที่สุด”
แต่คือทำให้ output “นิ่งขึ้น อ่านได้ขึ้น และพังน้อยลง” โดยไม่เสี่ยงเปลี่ยนความหมายมากเกินไป

