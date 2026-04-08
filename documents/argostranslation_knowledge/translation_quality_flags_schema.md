# Translation Quality Flags Schema for Argos OCR Translation Pipeline

## TL;DR

ไฟล์นี้กำหนดมาตรฐานกลางสำหรับ **quality flags** ที่ใช้ใน OCR translation pipeline เพื่อให้ทุกชั้นของระบบใช้ภาษาเดียวกันในการรายงานปัญหา, ความเสี่ยง, และสถานะคุณภาพของผลลัพธ์

เป้าหมายของไฟล์นี้คือ:

1. ทำให้ชื่อ flag และความหมาย **คงที่**
2. แยก severity, source stage, และ recommended action ให้ชัด
3. ใช้ร่วมกันได้กับ OCR, glossary, repair, validation, และ scoring layers
4. ทำให้ debug, benchmark, และ UI diagnostics สื่อสารตรงกัน
5. ลดการตั้งชื่อ flag สุ่ม ๆ ใน codebase

ไฟล์นี้ออกแบบมาเพื่อใช้กับ:

- Argos Translate
- Electron
- TypeScript
- PaddleOCR
- EasyOCR
- Tesseract

---

# 1) Why a Flags Schema Must Exist

## 1.1 ปัญหาถ้าไม่มี schema กลาง

ถ้าไม่มีมาตรฐานกลางสำหรับ flags คุณจะเจอปัญหาพวกนี้:

- ชื่อ flag ซ้ำความหมายกัน เช่น `LOW_CONF`, `LOW_CONFIDENCE`, `LOW_OCR_CONFIDENCE`
- บาง flag เป็น error จริง บาง flag เป็นแค่ warning แต่ชื่อเหมือนกัน
- UI ไม่รู้ว่าควรโชว์อะไรกับ user
- scoring layer ไม่รู้ว่าควรหักคะแนนเท่าไร
- benchmark เปรียบเทียบข้ามเวอร์ชันไม่ได้
- debug trace อ่านยาก เพราะ flag ความหมายซ้อนกัน

## 1.2 เป้าหมายของ flags schema

flags schema ต้องทำให้ระบบ:

- deterministic
- interpretable
- stage-aware
- severity-aware
- action-oriented
- benchmark-friendly

---

# 2) Core Principles

## 2.1 Flag != Exception

flag ไม่ได้แปลว่าระบบต้องหยุดเสมอไป

flag มีไว้เพื่อ:
- บอกความเสี่ยง
- บอก anomaly
- บอกสถานะที่ควรตรวจต่อ
- บอกว่าคะแนนคุณภาพควรถูกปรับลง

exception มีไว้สำหรับกรณีที่ระบบทำงานต่อไม่ได้จริง

## 2.2 Flags must be stable

ชื่อ flag ต้อง:
- สั้นพอ
- ชัด
- ไม่กำกวม
- ใช้ซ้ำได้ทุก layer
- backward-compatible เท่าที่ทำได้

## 2.3 One flag, one meaning

อย่าใช้ flag เดียวแทนหลายความหมาย

ตัวอย่างที่ไม่ดี:
- `BAD_OUTPUT`
- `BROKEN_TEXT`
- `UNKNOWN_ERROR`

พวกนี้ไม่มีค่าในการ debug

---

# 3) Flag Taxonomy

## 3.1 High-level categories

```ts
export type QualityFlagCategory =
  | 'ocr-confidence'
  | 'ocr-structure'
  | 'language'
  | 'placeholder'
  | 'glossary'
  | 'repair'
  | 'validation'
  | 'overlay'
  | 'length'
  | 'consistency'
  | 'semantic-risk'
  | 'system'
```

## 3.2 Severity levels

```ts
export type QualityFlagSeverity =
  | 'info'
  | 'warning'
  | 'error'
  | 'fatal'
```

### Guidance
- `info` = บันทึกไว้เฉย ๆ ไม่กระทบหนัก
- `warning` = ใช้งานได้แต่ควรระวัง
- `error` = คุณภาพน่าสงสัยมากหรือควร review
- `fatal` = chain ควรหยุดหรือ result ไม่ควรถูกเชื่อถือ

## 3.3 Source stage

```ts
export type QualityFlagSourceStage =
  | 'ocr'
  | 'pre-normalization'
  | 'protected-token'
  | 'glossary'
  | 'translation'
  | 'repair'
  | 'validation'
  | 'scoring'
  | 'runtime'
```

---

# 4) Master Flag Schema

```ts
export interface QualityFlagDefinition {
  code: string
  category: QualityFlagCategory
  severity: QualityFlagSeverity
  sourceStage: QualityFlagSourceStage
  description: string
  triggerSummary: string
  recommendedAction:
    | 'ignore'
    | 'log-only'
    | 'show-warning'
    | 'downgrade-score'
    | 'retry'
    | 're-ocr'
    | 'manual-review'
    | 'stop-pipeline'
  scorePenalty?: number
  uiVisible: boolean
  benchmarkRelevant: boolean
  notes?: string
}
```

## 4.1 Design rules

- `code` ต้องเป็น stable identifier
- `description` ใช้อธิบายความหมายของ flag
- `triggerSummary` ใช้บอกว่าเกิดจากอะไรแบบย่อ
- `recommendedAction` ต้องช่วย runtime/UI ตัดสินใจได้
- `scorePenalty` ต้องเป็น config-driven ได้ในภายหลัง

---

# 5) Runtime Flag Instance Schema

```ts
export interface QualityFlagInstance {
  code: string
  severity: QualityFlagSeverity
  sourceStage: QualityFlagSourceStage
  segmentId?: string
  page?: number
  lineIds?: string[]
  message?: string
  metadata?: Record<string, string | number | boolean>
}
```

## 5.1 ทำไมต้องแยก Definition กับ Instance

- Definition = ความหมายคงที่ของ flag
- Instance = การเกิดจริงใน job/segment/page ใด ๆ

ถ้าไม่แยก คุณจะผสม ontology กับ runtime event จนเละ

---

# 6) Canonical Flags

## 6.1 OCR Confidence Flags

```yaml
- code: LOW_CONFIDENCE_SOURCE
  category: ocr-confidence
  severity: warning
  sourceStage: ocr
  description: OCR confidence ต่ำกว่าระดับปกติ
  triggerSummary: OCR confidence ต่ำกว่าค่า normal threshold
  recommendedAction: downgrade-score
  scorePenalty: 0.08
  uiVisible: true
  benchmarkRelevant: true

- code: VERY_LOW_CONFIDENCE_SOURCE
  category: ocr-confidence
  severity: error
  sourceStage: ocr
  description: OCR confidence ต่ำมากจนผลแปลมีความเสี่ยงสูง
  triggerSummary: OCR confidence ต่ำกว่าค่า low threshold
  recommendedAction: re-ocr
  scorePenalty: 0.20
  uiVisible: true
  benchmarkRelevant: true
```

## 6.2 OCR Structure Flags

```yaml
- code: POSSIBLE_FRAGMENT
  category: ocr-structure
  severity: warning
  sourceStage: pre-normalization
  description: ข้อความดูเหมือน fragment หรือถูกตัดไม่ครบ
  triggerSummary: line/segment มีรูปแบบคล้ายข้อความขาดตอน
  recommendedAction: manual-review
  scorePenalty: 0.10
  uiVisible: true
  benchmarkRelevant: true

- code: POSSIBLE_BAD_LINE_MERGE
  category: ocr-structure
  severity: warning
  sourceStage: pre-normalization
  description: การ merge line อาจผิด
  triggerSummary: merge heuristic มีสัญญาณขัดแย้ง
  recommendedAction: retry
  scorePenalty: 0.08
  uiVisible: false
  benchmarkRelevant: true

- code: POSSIBLE_BAD_LINE_SPLIT
  category: ocr-structure
  severity: warning
  sourceStage: pre-normalization
  description: การ split line อาจผิด
  triggerSummary: split heuristic มีสัญญาณขัดแย้ง
  recommendedAction: retry
  scorePenalty: 0.08
  uiVisible: false
  benchmarkRelevant: true
```

## 6.3 Language Flags

```yaml
- code: LANGUAGE_MISMATCH
  category: language
  severity: error
  sourceStage: validation
  description: ภาษาในผลลัพธ์ไม่สอดคล้องกับคู่ภาษาที่คาดไว้
  triggerSummary: ตรวจพบ script/lang pattern ไม่ตรงกับ expected pair
  recommendedAction: manual-review
  scorePenalty: 0.18
  uiVisible: true
  benchmarkRelevant: true

- code: LANGUAGE_UNCERTAIN
  category: language
  severity: warning
  sourceStage: pre-normalization
  description: ตรวจภาษาไม่ชัดเจน
  triggerSummary: language detection confidence ต่ำหรือข้อความปนหลายภาษา
  recommendedAction: log-only
  scorePenalty: 0.06
  uiVisible: false
  benchmarkRelevant: true

- code: MIXED_SCRIPT_INPUT
  category: language
  severity: info
  sourceStage: pre-normalization
  description: ข้อความต้นทางมีหลาย script ปนกัน
  triggerSummary: พบหลาย script ใน segment เดียวกัน
  recommendedAction: log-only
  scorePenalty: 0.03
  uiVisible: false
  benchmarkRelevant: true
```

## 6.4 Placeholder Flags

```yaml
- code: BROKEN_PLACEHOLDER_RESTORE
  category: placeholder
  severity: fatal
  sourceStage: protected-token
  description: ไม่สามารถ restore placeholder กลับเป็น token เดิมได้ครบ
  triggerSummary: พบ placeholder เสียรูปหรือ restore ไม่ครบ
  recommendedAction: stop-pipeline
  scorePenalty: 0.50
  uiVisible: true
  benchmarkRelevant: true

- code: PLACEHOLDER_COLLISION_RISK
  category: placeholder
  severity: error
  sourceStage: protected-token
  description: placeholder format อาจชนกับข้อความจริง
  triggerSummary: key pattern อาจซ้ำกับ content ปกติ
  recommendedAction: retry
  scorePenalty: 0.12
  uiVisible: false
  benchmarkRelevant: true
```

## 6.5 Glossary Flags

```yaml
- code: TERM_INCONSISTENT
  category: glossary
  severity: warning
  sourceStage: glossary
  description: คำศัพท์เดียวกันถูกใช้ไม่คงที่
  triggerSummary: term เดียวกันถูกแปลหลายรูปภายใน context เดียวกัน
  recommendedAction: downgrade-score
  scorePenalty: 0.10
  uiVisible: true
  benchmarkRelevant: true

- code: GLOSSARY_OVERRIDE_APPLIED
  category: glossary
  severity: info
  sourceStage: glossary
  description: มีการบังคับ glossary override กับผลแปล
  triggerSummary: glossary มีผลเปลี่ยนข้อความหลังแปล
  recommendedAction: log-only
  scorePenalty: 0.00
  uiVisible: false
  benchmarkRelevant: true

- code: GLOSSARY_CONFLICT_RESOLVED
  category: glossary
  severity: info
  sourceStage: glossary
  description: มีหลาย glossary entries ชนกันและระบบเลือกหนึ่งรายการตาม policy
  triggerSummary: exact/priority/preserve conflict ถูก resolve แล้ว
  recommendedAction: log-only
  scorePenalty: 0.00
  uiVisible: false
  benchmarkRelevant: true
```

## 6.6 Repair Flags

```yaml
- code: TOO_LITERAL_STRUCTURE
  category: repair
  severity: warning
  sourceStage: validation
  description: โครงสร้างประโยคยังแข็งหรือแปลตรงตัวเกินไป
  triggerSummary: พบ pattern ของ literal translation ที่ยังหลงเหลือ
  recommendedAction: downgrade-score
  scorePenalty: 0.08
  uiVisible: true
  benchmarkRelevant: true

- code: POSSIBLE_OVER_REPAIR
  category: repair
  severity: error
  sourceStage: repair
  description: repair layer อาจแก้ข้อความเกินจนเสี่ยงเปลี่ยนความหมาย
  triggerSummary: high-risk repair rules หลายตัวถูกใช้หรือผลลัพธ์เบี่ยงจากต้นฉบับมากเกิน threshold
  recommendedAction: manual-review
  scorePenalty: 0.16
  uiVisible: true
  benchmarkRelevant: true

- code: HIGH_RISK_REPAIR_SKIPPED
  category: repair
  severity: info
  sourceStage: repair
  description: ระบบข้าม high-risk repair rule ตาม safety policy
  triggerSummary: mode/confidence/context ไม่อนุญาตให้ใช้กฎเสี่ยงสูง
  recommendedAction: log-only
  scorePenalty: 0.00
  uiVisible: false
  benchmarkRelevant: true
```

## 6.7 Validation Flags

```yaml
- code: RESIDUAL_SOURCE_FRAGMENT
  category: validation
  severity: error
  sourceStage: validation
  description: ยังมี fragment ภาษาต้นทางหลงเหลือในผลลัพธ์โดยไม่ควรมี
  triggerSummary: ตรวจพบ source token/script ที่ไม่ใช่ protected token คงอยู่หลังแปล
  recommendedAction: manual-review
  scorePenalty: 0.18
  uiVisible: true
  benchmarkRelevant: true

- code: UNBALANCED_BRACKETS
  category: validation
  severity: warning
  sourceStage: validation
  description: วงเล็บหรือเครื่องหมายจับคู่ไม่สมดุล
  triggerSummary: bracket count ไม่สมดุลหลัง repair
  recommendedAction: show-warning
  scorePenalty: 0.06
  uiVisible: true
  benchmarkRelevant: true

- code: INVALID_OUTPUT_FORMAT
  category: validation
  severity: error
  sourceStage: validation
  description: output ไม่ผ่านรูปแบบที่กำหนด
  triggerSummary: schema/format validation ล้มเหลว
  recommendedAction: retry
  scorePenalty: 0.15
  uiVisible: false
  benchmarkRelevant: true
```

## 6.8 Overlay / Length Flags

```yaml
- code: OUTPUT_TOO_LONG_FOR_OVERLAY
  category: overlay
  severity: warning
  sourceStage: validation
  description: ข้อความแปลยาวเกินข้อจำกัดของ overlay
  triggerSummary: translated text ยาวเกิน overlay max length
  recommendedAction: show-warning
  scorePenalty: 0.09
  uiVisible: true
  benchmarkRelevant: true

- code: OUTPUT_MAY_OVERFLOW_UI
  category: length
  severity: info
  sourceStage: validation
  description: ข้อความอาจล้น UI container
  triggerSummary: estimated layout width/height เกิน threshold ที่คาดไว้
  recommendedAction: log-only
  scorePenalty: 0.03
  uiVisible: false
  benchmarkRelevant: true
```

## 6.9 Semantic Risk Flags

```yaml
- code: EXCESSIVE_TRANSLITERATION
  category: semantic-risk
  severity: warning
  sourceStage: validation
  description: ระบบถอดเสียงมากเกินกว่าที่ควรแปลความหมาย
  triggerSummary: ตรวจพบคำทับศัพท์มากเกิน threshold ใน context ที่ควรแปล
  recommendedAction: downgrade-score
  scorePenalty: 0.10
  uiVisible: true
  benchmarkRelevant: true

- code: AMBIGUITY_HIGH
  category: semantic-risk
  severity: warning
  sourceStage: validation
  description: segment มีความกำกวมสูงและผลแปลอาจคลาดเคลื่อน
  triggerSummary: pair-specific ambiguity heuristic แจ้งเตือน
  recommendedAction: manual-review
  scorePenalty: 0.09
  uiVisible: false
  benchmarkRelevant: true
```

## 6.10 System Flags

```yaml
- code: FALLBACK_ENGINE_USED
  category: system
  severity: info
  sourceStage: runtime
  description: ระบบใช้ fallback path แทน main path
  triggerSummary: OCR/translation/repair pipeline เปลี่ยนไปใช้ fallback strategy
  recommendedAction: log-only
  scorePenalty: 0.00
  uiVisible: false
  benchmarkRelevant: true

- code: RETRY_APPLIED
  category: system
  severity: info
  sourceStage: runtime
  description: ระบบ rerun บาง stage เพื่อพยายามปรับผลลัพธ์
  triggerSummary: retry policy ถูกใช้กับ segment/job นี้
  recommendedAction: log-only
  scorePenalty: 0.00
  uiVisible: false
  benchmarkRelevant: true

- code: QUALITY_SCORE_DOWNGRADED
  category: system
  severity: info
  sourceStage: scoring
  description: คะแนนคุณภาพถูกปรับลดจาก flags หรือ policy
  triggerSummary: scoring layer ใช้ penalties กับผลลัพธ์นี้
  recommendedAction: log-only
  scorePenalty: 0.00
  uiVisible: false
  benchmarkRelevant: true
```

---

# 7) Severity Policy

## 7.1 How severity should be interpreted

### info
- ไม่ถือว่าเป็นปัญหาหลัก
- ใช้เพื่อ trace behavior หรือ benchmark
- ปกติไม่ควรโชว์ user ทั่วไป

### warning
- ผลลัพธ์ยังอาจใช้ได้
- แต่มีความเสี่ยงบางด้าน
- เหมาะกับ show badge หรือ diagnostics view

### error
- ผลลัพธ์มีความเสี่ยงสูง
- ควรลดคะแนนชัดเจน
- UI ควรแสดงคำเตือนหรือ mark review

### fatal
- result path ควรถูกหยุด, discard, หรือ fallback
- ไม่ควรเชื่อถือ output นั้นแบบปกติ

---

# 8) Recommended Actions Policy

## 8.1 Action semantics

```ts
export type RecommendedAction =
  | 'ignore'
  | 'log-only'
  | 'show-warning'
  | 'downgrade-score'
  | 'retry'
  | 're-ocr'
  | 'manual-review'
  | 'stop-pipeline'
```

## 8.2 Runtime behavior suggestions

- `ignore` = ไม่ทำอะไรเพิ่ม
- `log-only` = บันทึก trace/metrics
- `show-warning` = ส่งขึ้น UI diagnostics
- `downgrade-score` = ลด quality score
- `retry` = rerun stage เดิมหรือ stage ที่เกี่ยวข้อง
- `re-ocr` = กลับไป OCR ใหม่หรือ alternate OCR engine
- `manual-review` = mark ให้ user/QA ดู
- `stop-pipeline` = หยุด chain หรือตัดผลลัพธ์นั้นทิ้ง

---

# 9) Flag Groups for UI / Diagnostics

## 9.1 User-visible group

ควรมีแค่ flags ที่ user เข้าใจหรือมีผลต่อการใช้งานจริง:

- LOW_CONFIDENCE_SOURCE
- VERY_LOW_CONFIDENCE_SOURCE
- LANGUAGE_MISMATCH
- BROKEN_PLACEHOLDER_RESTORE
- TERM_INCONSISTENT
- TOO_LITERAL_STRUCTURE
- RESIDUAL_SOURCE_FRAGMENT
- UNBALANCED_BRACKETS
- OUTPUT_TOO_LONG_FOR_OVERLAY
- EXCESSIVE_TRANSLITERATION

## 9.2 Internal-only group

flags สำหรับ debug/benchmark:

- GLOSSARY_OVERRIDE_APPLIED
- GLOSSARY_CONFLICT_RESOLVED
- HIGH_RISK_REPAIR_SKIPPED
- FALLBACK_ENGINE_USED
- RETRY_APPLIED
- QUALITY_SCORE_DOWNGRADED
- MIXED_SCRIPT_INPUT
- POSSIBLE_BAD_LINE_MERGE
- POSSIBLE_BAD_LINE_SPLIT

---

# 10) Pair-Specific Flag Bias

## 10.1 EN -> TH

ควรเฝ้าพิเศษ:
- TOO_LITERAL_STRUCTURE
- TERM_INCONSISTENT
- OUTPUT_TOO_LONG_FOR_OVERLAY

## 10.2 JA -> TH

ควรเฝ้าพิเศษ:
- LANGUAGE_MISMATCH
- POSSIBLE_FRAGMENT
- RESIDUAL_SOURCE_FRAGMENT
- AMBIGUITY_HIGH

## 10.3 KO -> TH

ควรเฝ้าพิเศษ:
- LANGUAGE_MISMATCH
- POSSIBLE_FRAGMENT
- RESIDUAL_SOURCE_FRAGMENT
- AMBIGUITY_HIGH

## 10.4 ES -> TH

ควรเฝ้าพิเศษ:
- TOO_LITERAL_STRUCTURE
- TERM_INCONSISTENT
- POSSIBLE_FRAGMENT
- EXCESSIVE_TRANSLITERATION

---

# 11) Scoring Integration Rules

## 11.1 Basic policy

- info flags ปกติไม่ควรหักคะแนน ยกเว้นมีเหตุผลชัด
- warning flags ควรหักเล็กถึงกลาง
- error flags ควรหักกลางถึงหนัก
- fatal flags ควรทำให้ score ตกหนักหรือ discard result

## 11.2 Example aggregation policy

```text
finalScore = baseScore
  - sum(flag penalties)
  - conflict penalty
  - confidence penalty
```

## 11.3 Important rule

อย่าหักคะแนนซ้ำซ้อนเกินไปจาก flags ที่เป็นอาการของปัญหาเดียวกัน

ตัวอย่าง:
- `VERY_LOW_CONFIDENCE_SOURCE`
- `POSSIBLE_FRAGMENT`
- `RESIDUAL_SOURCE_FRAGMENT`

สามตัวนี้อาจมี root cause เดียวกันจาก OCR เพี้ยนหนัก

ควรมี grouping policy เพื่อ cap total penalty บางกลุ่ม

---

# 12) Suggested Flag Grouping for Penalty Capping

```ts
export interface FlagPenaltyGroup {
  id: string
  memberCodes: string[]
  maxPenalty: number
}
```

## Example

```yaml
- id: ocr-root-risk
  memberCodes:
    - LOW_CONFIDENCE_SOURCE
    - VERY_LOW_CONFIDENCE_SOURCE
    - POSSIBLE_FRAGMENT
    - POSSIBLE_BAD_LINE_MERGE
    - POSSIBLE_BAD_LINE_SPLIT
  maxPenalty: 0.25

- id: translation-output-risk
  memberCodes:
    - TOO_LITERAL_STRUCTURE
    - EXCESSIVE_TRANSLITERATION
    - TERM_INCONSISTENT
    - RESIDUAL_SOURCE_FRAGMENT
  maxPenalty: 0.30
```

---

# 13) Recommended TypeScript Registry

```ts
export interface QualityFlagRegistry {
  version: string
  definitions: QualityFlagDefinition[]
}
```

## Helper API

```ts
export interface QualityFlagService {
  getDefinition(code: string): QualityFlagDefinition | undefined
  createInstance(code: string, input?: Partial<QualityFlagInstance>): QualityFlagInstance
  getUserVisibleFlags(flags: QualityFlagInstance[]): QualityFlagInstance[]
  getBenchmarkRelevantFlags(flags: QualityFlagInstance[]): QualityFlagInstance[]
}
```

---

# 14) Validation Rules for the Flags Registry

## Required checks

- duplicate `code` ห้ามมี
- invalid severity ห้ามมี
- invalid category ห้ามมี
- invalid sourceStage ห้ามมี
- invalid recommendedAction ห้ามมี
- `scorePenalty` ต้องไม่ติดลบ
- fatal flag ควรมี recommendedAction เป็น `stop-pipeline`, `retry`, `re-ocr`, หรือ `manual-review`
- `uiVisible = true` ต้องมี description ที่ user-friendly พอ

---

# 15) Anti-Patterns

## ห้าม

- ตั้งชื่อ flag แบบกว้างไร้ความหมาย เช่น `BAD_OUTPUT`
- ใช้ severity ไม่คงที่สำหรับ code เดิม
- ใช้ flag เดียวแทนหลายปัญหา
- ให้ UI โชว์ internal-only flags ทั้งหมด
- ให้ scoring layer hardcode special cases เต็มไปหมดโดยไม่อิง registry

## เพราะอะไร

สุดท้ายคุณจะได้ระบบที่:
- trace ไม่ได้
- tune ไม่ได้
- benchmark ไม่ได้
- user diagnostics มั่ว

---

# 16) Minimal Production Flag Set

ถ้าจะเริ่มใช้งานจริงเร็ว ๆ ให้เริ่มจากชุดนี้ก่อน:

### Core warnings/errors
- LOW_CONFIDENCE_SOURCE
- VERY_LOW_CONFIDENCE_SOURCE
- POSSIBLE_FRAGMENT
- LANGUAGE_MISMATCH
- BROKEN_PLACEHOLDER_RESTORE
- TERM_INCONSISTENT
- TOO_LITERAL_STRUCTURE
- RESIDUAL_SOURCE_FRAGMENT
- UNBALANCED_BRACKETS
- OUTPUT_TOO_LONG_FOR_OVERLAY
- EXCESSIVE_TRANSLITERATION

### Core info/internal
- GLOSSARY_OVERRIDE_APPLIED
- HIGH_RISK_REPAIR_SKIPPED
- FALLBACK_ENGINE_USED
- RETRY_APPLIED
- QUALITY_SCORE_DOWNGRADED

---

# 17) Final Recommendation

flags schema ที่ดีต้อง:

- stable
- explicit
- stage-aware
- severity-aware
- action-oriented
- compatible กับ scoring/UI/benchmark

ถ้าคุณออกแบบส่วนนี้ดีตั้งแต่ต้น:
- debug จะง่ายขึ้นมาก
- benchmark จะมีความหมาย
- diagnostics จะไม่มั่ว
- และการขยายระบบในอนาคตจะไม่พังเพราะ naming chaos

ไฟล์นี้ควรใช้คู่กับ:
- `translation_rule_engine_schema.md`
- `argos_pair_config_templates.md`
- `argos-translation-quality-control.md`
- `thai_repair_rule_patterns.md`
- `translation_glossary_seed.md`

เพื่อให้ระบบมี **ภาษากลางสำหรับรายงานคุณภาพ** ที่สอดคล้องกันทั้ง pipeline

