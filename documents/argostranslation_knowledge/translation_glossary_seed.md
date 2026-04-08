# Translation Glossary Seed for Argos OCR Translation Pipeline

## TL;DR

ไฟล์นี้เป็น glossary seed ตั้งต้นสำหรับระบบแปลออฟไลน์ที่ใช้:

- Argos Translate
- Electron
- TypeScript
- PaddleOCR
- EasyOCR
- Tesseract

เป้าหมายของ glossary นี้คือ:

1. ทำให้คำแปล **คงที่**
2. ลดการแกว่งของคำแปลจาก model
3. ป้องกัน UI wording ไม่สม่ำเสมอ
4. ช่วยคุม technical terms, product labels, และ common OCR translation cases
5. ใช้เป็น seed สำหรับระบบ glossary enforcement ใน production

คู่ภาษาหลักที่ไฟล์นี้ออกแบบไว้:

- EN -> TH
- JA -> TH
- KO -> TH
- ES -> TH

> หมายเหตุ: ไฟล์นี้เป็น **seed glossary** ไม่ใช่ final glossary
> ต้องมีการขยายตาม domain, product, และ feedback จริงจากการใช้งาน

---

# 1) Glossary Design Principles

## 1.1 เป้าหมายของ glossary

Glossary มีไว้เพื่อ:

- บังคับคำแปลให้ **เสถียร**
- ลดปัญหา model แปลคำเดียวกันหลายแบบ
- คุม tone ให้เหมาะกับบริบท
- ป้องกันคำเฉพาะทางโดนแปลผิด
- ช่วยให้ UI/overlay/document translation ใช้คำตรงกัน

## 1.2 สิ่งที่ glossary ไม่ควรทำ

- rewrite ทั้งประโยค
- แก้ structure ทั้งหมดแทน model
- แทน grammar repair layer
- บังคับคำทุกคำแบบไม่ดู context

## 1.3 Priority Order

ลำดับความสำคัญของ glossary:

1. Protected tokens
2. Product / internal terms
3. UI glossary
4. Technical glossary
5. General glossary

---

# 2) Suggested Data Schema

```ts
export type GlossaryDomain =
  | 'ui'
  | 'technical'
  | 'system'
  | 'document'
  | 'error'
  | 'product'
  | 'location'
  | 'measurement'

export type GlossaryAction = 'replace' | 'preserve' | 'prefer'

export interface GlossaryEntry {
  id: string
  source: string
  target: string
  sourceLang: 'en' | 'ja' | 'ko' | 'es' | '*'
  targetLang: 'th'
  action: GlossaryAction
  domain: GlossaryDomain
  caseSensitive?: boolean
  exactMatch?: boolean
  priority: number
  notes?: string
  aliases?: string[]
}
```

---

# 3) Enforcement Rules

## 3.1 replace

ใช้เมื่อคำต้องถูกแปลเป็นรูปแบบ fix

ตัวอย่าง:
- Settings -> การตั้งค่า
- Save -> บันทึก
- Cancel -> ยกเลิก

## 3.2 preserve

ใช้เมื่อคำไม่ควรถูกแปล

ตัวอย่าง:
- Electron
- Argos Translate
- PaddleOCR
- EasyOCR
- Tesseract

## 3.3 prefer

ใช้เมื่อคำควรแปลแบบนี้เป็นหลัก แต่ยังยอมให้ context layer override ได้ในบางกรณี

ตัวอย่าง:
- Sign in -> เข้าสู่ระบบ
- Retry -> ลองอีกครั้ง

---

# 4) Seed Glossary: Protected / Preserve Terms

## 4.1 Product / Framework / Library Names

```yaml
- id: preserve-electron
  source: Electron
  target: Electron
  sourceLang: '*'
  targetLang: th
  action: preserve
  domain: product
  exactMatch: true
  priority: 100

- id: preserve-typescript
  source: TypeScript
  target: TypeScript
  sourceLang: '*'
  targetLang: th
  action: preserve
  domain: product
  exactMatch: true
  priority: 100

- id: preserve-argos
  source: Argos Translate
  target: Argos Translate
  sourceLang: '*'
  targetLang: th
  action: preserve
  domain: product
  exactMatch: true
  priority: 100

- id: preserve-paddleocr
  source: PaddleOCR
  target: PaddleOCR
  sourceLang: '*'
  targetLang: th
  action: preserve
  domain: product
  exactMatch: true
  priority: 100

- id: preserve-easyocr
  source: EasyOCR
  target: EasyOCR
  sourceLang: '*'
  targetLang: th
  action: preserve
  domain: product
  exactMatch: true
  priority: 100

- id: preserve-tesseract
  source: Tesseract
  target: Tesseract
  sourceLang: '*'
  targetLang: th
  action: preserve
  domain: product
  exactMatch: true
  priority: 100
```

---

# 5) Seed Glossary: Core UI Terms

## 5.1 Buttons / Actions

```yaml
- id: ui-save
  source: Save
  target: บันทึก
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 90

- id: ui-cancel
  source: Cancel
  target: ยกเลิก
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 90

- id: ui-confirm
  source: Confirm
  target: ยืนยัน
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 90

- id: ui-close
  source: Close
  target: ปิด
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 90

- id: ui-open
  source: Open
  target: เปิด
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 90

- id: ui-delete
  source: Delete
  target: ลบ
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 90

- id: ui-remove
  source: Remove
  target: นำออก
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 90

- id: ui-edit
  source: Edit
  target: แก้ไข
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 90

- id: ui-retry
  source: Retry
  target: ลองอีกครั้ง
  sourceLang: en
  targetLang: th
  action: prefer
  domain: ui
  exactMatch: true
  priority: 90

- id: ui-refresh
  source: Refresh
  target: รีเฟรช
  sourceLang: en
  targetLang: th
  action: prefer
  domain: ui
  exactMatch: true
  priority: 85

- id: ui-reset
  source: Reset
  target: รีเซ็ต
  sourceLang: en
  targetLang: th
  action: prefer
  domain: ui
  exactMatch: true
  priority: 85
```

## 5.2 Navigation / State

```yaml
- id: ui-settings
  source: Settings
  target: การตั้งค่า
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 95

- id: ui-preferences
  source: Preferences
  target: การตั้งค่า
  sourceLang: en
  targetLang: th
  action: prefer
  domain: ui
  exactMatch: true
  priority: 85

- id: ui-general
  source: General
  target: ทั่วไป
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 85

- id: ui-home
  source: Home
  target: หน้าหลัก
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 85

- id: ui-back
  source: Back
  target: ย้อนกลับ
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 85

- id: ui-next
  source: Next
  target: ถัดไป
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 85

- id: ui-previous
  source: Previous
  target: ก่อนหน้า
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 85

- id: ui-continue
  source: Continue
  target: ดำเนินการต่อ
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 85

- id: ui-search
  source: Search
  target: ค้นหา
  sourceLang: en
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 90
```

## 5.3 Authentication

```yaml
- id: ui-sign-in
  source: Sign in
  target: เข้าสู่ระบบ
  sourceLang: en
  targetLang: th
  action: prefer
  domain: ui
  exactMatch: true
  priority: 95
  aliases:
    - Log in
    - Login

- id: ui-sign-out
  source: Sign out
  target: ออกจากระบบ
  sourceLang: en
  targetLang: th
  action: prefer
  domain: ui
  exactMatch: true
  priority: 95
  aliases:
    - Log out
    - Logout
```

---

# 6) Seed Glossary: Error / Status Terms

```yaml
- id: err-error
  source: Error
  target: ข้อผิดพลาด
  sourceLang: en
  targetLang: th
  action: replace
  domain: error
  exactMatch: true
  priority: 90

- id: err-warning
  source: Warning
  target: คำเตือน
  sourceLang: en
  targetLang: th
  action: replace
  domain: error
  exactMatch: true
  priority: 90

- id: err-failed
  source: Failed
  target: ล้มเหลว
  sourceLang: en
  targetLang: th
  action: prefer
  domain: error
  exactMatch: true
  priority: 88

- id: err-not-found
  source: Not found
  target: ไม่พบ
  sourceLang: en
  targetLang: th
  action: replace
  domain: error
  exactMatch: true
  priority: 95

- id: err-unavailable
  source: Unavailable
  target: ไม่พร้อมใช้งาน
  sourceLang: en
  targetLang: th
  action: replace
  domain: error
  exactMatch: true
  priority: 88

- id: err-unsupported
  source: Unsupported
  target: ไม่รองรับ
  sourceLang: en
  targetLang: th
  action: replace
  domain: error
  exactMatch: true
  priority: 88

- id: status-loading
  source: Loading
  target: กำลังโหลด
  sourceLang: en
  targetLang: th
  action: replace
  domain: system
  exactMatch: true
  priority: 90

- id: status-processing
  source: Processing
  target: กำลังประมวลผล
  sourceLang: en
  targetLang: th
  action: replace
  domain: system
  exactMatch: true
  priority: 90

- id: status-completed
  source: Completed
  target: เสร็จสิ้น
  sourceLang: en
  targetLang: th
  action: prefer
  domain: system
  exactMatch: true
  priority: 88
```

---

# 7) Seed Glossary: OCR / Translation Technical Terms

```yaml
- id: tech-cache
  source: cache
  target: แคช
  sourceLang: en
  targetLang: th
  action: prefer
  domain: technical
  exactMatch: true
  priority: 80

- id: tech-model
  source: model
  target: โมเดล
  sourceLang: en
  targetLang: th
  action: prefer
  domain: technical
  exactMatch: true
  priority: 80

- id: tech-engine
  source: engine
  target: เอนจิน
  sourceLang: en
  targetLang: th
  action: prefer
  domain: technical
  exactMatch: true
  priority: 80

- id: tech-render
  source: render
  target: เรนเดอร์
  sourceLang: en
  targetLang: th
  action: prefer
  domain: technical
  exactMatch: true
  priority: 75

- id: tech-pipeline
  source: pipeline
  target: ไปป์ไลน์
  sourceLang: en
  targetLang: th
  action: prefer
  domain: technical
  exactMatch: true
  priority: 75

- id: tech-overlay
  source: overlay
  target: โอเวอร์เลย์
  sourceLang: en
  targetLang: th
  action: prefer
  domain: technical
  exactMatch: true
  priority: 75

- id: tech-bounding-box
  source: bounding box
  target: กรอบขอบเขต
  sourceLang: en
  targetLang: th
  action: prefer
  domain: technical
  exactMatch: true
  priority: 75

- id: tech-confidence
  source: confidence
  target: ความเชื่อมั่น
  sourceLang: en
  targetLang: th
  action: replace
  domain: technical
  exactMatch: true
  priority: 82

- id: tech-segment
  source: segment
  target: เซกเมนต์
  sourceLang: en
  targetLang: th
  action: prefer
  domain: technical
  exactMatch: true
  priority: 75

- id: tech-normalization
  source: normalization
  target: การปรับให้อยู่ในรูปแบบมาตรฐาน
  sourceLang: en
  targetLang: th
  action: prefer
  domain: technical
  exactMatch: true
  priority: 72
```

---

# 8) Seed Glossary: File / Document Terms

```yaml
- id: doc-file
  source: File
  target: ไฟล์
  sourceLang: en
  targetLang: th
  action: replace
  domain: document
  exactMatch: true
  priority: 90

- id: doc-folder
  source: Folder
  target: โฟลเดอร์
  sourceLang: en
  targetLang: th
  action: replace
  domain: document
  exactMatch: true
  priority: 88

- id: doc-document
  source: Document
  target: เอกสาร
  sourceLang: en
  targetLang: th
  action: replace
  domain: document
  exactMatch: true
  priority: 88

- id: doc-page
  source: Page
  target: หน้า
  sourceLang: en
  targetLang: th
  action: replace
  domain: document
  exactMatch: true
  priority: 85

- id: doc-image
  source: Image
  target: รูปภาพ
  sourceLang: en
  targetLang: th
  action: replace
  domain: document
  exactMatch: true
  priority: 85

- id: doc-export
  source: Export
  target: ส่งออก
  sourceLang: en
  targetLang: th
  action: replace
  domain: document
  exactMatch: true
  priority: 85

- id: doc-import
  source: Import
  target: นำเข้า
  sourceLang: en
  targetLang: th
  action: replace
  domain: document
  exactMatch: true
  priority: 85
```

---

# 9) Seed Glossary: OCR Workflow Terms

```yaml
- id: ocr-detect-text
  source: Detect text
  target: ตรวจจับข้อความ
  sourceLang: en
  targetLang: th
  action: replace
  domain: system
  exactMatch: true
  priority: 88

- id: ocr-recognize-text
  source: Recognize text
  target: รู้จำข้อความ
  sourceLang: en
  targetLang: th
  action: replace
  domain: system
  exactMatch: true
  priority: 88

- id: ocr-translate-text
  source: Translate text
  target: แปลข้อความ
  sourceLang: en
  targetLang: th
  action: replace
  domain: system
  exactMatch: true
  priority: 88

- id: ocr-source-language
  source: Source language
  target: ภาษาต้นทาง
  sourceLang: en
  targetLang: th
  action: replace
  domain: system
  exactMatch: true
  priority: 88

- id: ocr-target-language
  source: Target language
  target: ภาษาปลายทาง
  sourceLang: en
  targetLang: th
  action: replace
  domain: system
  exactMatch: true
  priority: 88
```

---

# 10) Seed Glossary: Japanese -> Thai

> หมวดนี้เน้นคำที่เจอบ่อยใน UI/document ไม่ใช่ศัพท์ญี่ปุ่นทั้งหมด

```yaml
- id: ja-save
  source: 保存
  target: บันทึก
  sourceLang: ja
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 92

- id: ja-cancel
  source: キャンセル
  target: ยกเลิก
  sourceLang: ja
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 92

- id: ja-settings
  source: 設定
  target: การตั้งค่า
  sourceLang: ja
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 95

- id: ja-error
  source: エラー
  target: ข้อผิดพลาด
  sourceLang: ja
  targetLang: th
  action: replace
  domain: error
  exactMatch: true
  priority: 90

- id: ja-not-found
  source: 見つかりません
  target: ไม่พบ
  sourceLang: ja
  targetLang: th
  action: replace
  domain: error
  exactMatch: false
  priority: 90

- id: ja-confirm
  source: 確認
  target: ยืนยัน
  sourceLang: ja
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 88
```

---

# 11) Seed Glossary: Korean -> Thai

```yaml
- id: ko-save
  source: 저장
  target: บันทึก
  sourceLang: ko
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 92

- id: ko-cancel
  source: 취소
  target: ยกเลิก
  sourceLang: ko
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 92

- id: ko-settings
  source: 설정
  target: การตั้งค่า
  sourceLang: ko
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 95

- id: ko-error
  source: 오류
  target: ข้อผิดพลาด
  sourceLang: ko
  targetLang: th
  action: replace
  domain: error
  exactMatch: true
  priority: 90

- id: ko-confirm
  source: 확인
  target: ยืนยัน
  sourceLang: ko
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 88

- id: ko-retry
  source: 다시 시도
  target: ลองอีกครั้ง
  sourceLang: ko
  targetLang: th
  action: replace
  domain: ui
  exactMatch: false
  priority: 88
```

---

# 12) Seed Glossary: Spanish -> Thai

```yaml
- id: es-save
  source: Guardar
  target: บันทึก
  sourceLang: es
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 92

- id: es-cancel
  source: Cancelar
  target: ยกเลิก
  sourceLang: es
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 92

- id: es-settings
  source: Configuración
  target: การตั้งค่า
  sourceLang: es
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 95

- id: es-error
  source: Error
  target: ข้อผิดพลาด
  sourceLang: es
  targetLang: th
  action: replace
  domain: error
  exactMatch: true
  priority: 90

- id: es-not-found
  source: No encontrado
  target: ไม่พบ
  sourceLang: es
  targetLang: th
  action: replace
  domain: error
  exactMatch: false
  priority: 90

- id: es-confirm
  source: Confirmar
  target: ยืนยัน
  sourceLang: es
  targetLang: th
  action: replace
  domain: ui
  exactMatch: true
  priority: 88
```

---

# 13) Conflict Resolution Rules

## 13.1 เมื่อคำชนกันหลาย entry

ใช้กฎนี้:

1. `preserve` ชนะ `replace`
2. `product` ชนะ `ui`
3. exactMatch ชนะ partial match
4. priority สูงกว่าชนะ
5. sourceLang ตรงชนะ wildcard

## 13.2 Example

คำว่า `Settings` และ `General Settings`

- ถ้ามี exact match สำหรับ `General Settings` ให้ใช้ก่อน
- ถ้าไม่มี ค่อยแตกเป็น `General` + `Settings`

---

# 14) Context Rules

## 14.1 UI context

- ใช้คำสั้น
- ใช้คำคงที่
- หลีกเลี่ยงคำยาวแบบเอกสาร

## 14.2 Technical context

- preserve technical terms บางตัว
- ใช้คำทับศัพท์อย่างคงที่
- ห้ามสลับคำเรียกเองตามอารมณ์ model

## 14.3 Error context

- เน้นกระชับ
- วัตถุของปัญหาต้องชัด
- หลีกเลี่ยงประโยคแข็งแบบ literal translation

---

# 15) Anti-Patterns

## ห้าม

- ใช้ glossary แทน grammar repair
- บังคับ term เดียวกับทุก context
- แปลชื่อ product/library/framework
- ปล่อยให้ synonyms แกว่งในหน้า UI เดียวกัน
- ใช้ partial replace แบบไม่ป้องกัน false match

---

# 16) Minimal Starter Pack Recommendation

ถ้าจะเริ่มใช้งานจริงทันที ให้เริ่มจาก 5 กลุ่มนี้ก่อน:

1. product preserve terms
2. core UI terms
3. authentication terms
4. error/status terms
5. OCR/translation technical terms

จากนั้นค่อยเพิ่ม:
- Japanese UI terms
- Korean UI terms
- Spanish UI terms
- domain-specific glossary
- user-corrected terminology

---

# 17) Final Recommendation

Glossary ที่ดีไม่ใช่ glossary ที่ยาวที่สุด
แต่คือ glossary ที่:

- จัด priority ถูก
- enforce ได้จริง
- แยก context ชัด
- ไม่ชนกับ protected token layer
- ไม่ทำหน้าที่เกินขอบเขตของมัน

ใช้ไฟล์นี้เป็น **seed glossary v1** แล้วค่อยต่อยอดจากผลทดสอบจริงและ user feedback

