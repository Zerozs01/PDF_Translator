# Argos Pair Config Templates for EN / JA / KO / ES -> TH

## TL;DR

ไฟล์นี้เป็นชุด template config สำหรับ language pair แต่ละคู่ที่ใช้กับระบบแปล OCR โดยอิง schema จาก `translation_rule_engine_schema.md`

เป้าหมายคือ:

1. แยก behavior ตามคู่ภาษาอย่างชัดเจน
2. ปรับ segmentation, glossary bias, repair policy, และ validation sensitivity ให้เหมาะกับแต่ละภาษา
3. ลดการยัด logic ภาษาไว้ใน code
4. ทำให้ benchmark และ tuning ต่อคู่ภาษาได้เป็นระบบ
5. ใช้เป็น baseline production profile สำหรับ `EN / JA / KO / ES -> TH`

ไฟล์นี้ออกแบบมาสำหรับระบบที่ใช้:

- Argos Translate
- Electron
- TypeScript
- PaddleOCR
- EasyOCR
- Tesseract

---

# 1) Why Pair Templates Must Be Separate

## 1.1 ปัญหาถ้าใช้ config เดียวกับทุกภาษา

แต่ละภาษามี failure mode คนละแบบ:

- **EN -> TH**: passive voice, noun stack, literal error messages
- **JA -> TH**: subject omission, tail-heavy meaning, politeness nuance
- **KO -> TH**: honorific endings, compound nouns, omitted subject
- **ES -> TH**: verb inflection density, adjective order, idioms

ถ้าใช้กฎชุดเดียวกับทุกคู่ภาษา:
- repair ผิดจุด
- validation ไม่แม่น
- glossary bias แปลก
- over-repair หรือ under-repair ง่าย

## 1.2 เป้าหมายของ pair templates

แต่ละ template ต้องระบุ:

- segmentation bias
- allowed risk profile
- default glossary domains
- repair rules ที่ควรเปิด
- repair rules ที่ควรปิด
- validation sensitivity
- OCR confidence thresholds
- overlay/document mode preferences

---

# 2) Template Design Principles

## 2.1 Conservative by default

ทุก pair template ควรเริ่มจาก config ที่ปลอดภัยก่อน:
- เปิดกฎ safe rules เป็นหลัก
- ปิด high-risk rewrite ไว้ก่อน
- ใช้ flags เยอะกว่าการเดาแก้เอง

## 2.2 Pair-specific, not model-specific

template นี้ผูกกับ **language pair** เป็นหลัก ไม่ใช่ผูกกับ OCR engine หรือ Argos internals

## 2.3 Context-aware overrides

template ต้องรองรับ override ตาม:
- mode
- domain
- OCR confidence
- line count
- overlay constraints

---

# 3) Shared Base Template

## 3.1 Base profile

```yaml
baseProfile:
  targetLang: th
  protectedTokenPolicy:
    preserveUnknownUrls: true
    preserveEmails: true
    preservePaths: true
    preserveVersionStrings: true
    preserveCodeLikeTokens: true

  scoringPolicy:
    useQualityScore: true

  defaultValidationFlags:
    - BROKEN_PLACEHOLDER_RESTORE
    - RESIDUAL_SOURCE_FRAGMENT
    - LANGUAGE_MISMATCH
    - OUTPUT_TOO_LONG_FOR_OVERLAY

  defaultRepairPolicy:
    allowSafeRules: true
    allowMediumRiskRules: false
    allowHighRiskRules: false

  defaultThresholds:
    ocrConfidenceNormal: 0.90
    ocrConfidenceCautious: 0.75
    ocrConfidenceLow: 0.50
```

## 3.2 Shared glossary domains

```yaml
sharedGlossaryDomains:
  - product
  - ui
  - error
  - system
  - technical
```

---

# 4) EN -> TH Template

## 4.1 Pair summary

ภาษาอังกฤษไปไทยเป็นคู่ที่คาดว่าจะนิ่งสุดในกลุ่มนี้ แต่ยังมีปัญหาบ่อยเรื่อง:

- passive voice
- noun stack
- machine-translated error messages
- instruction sentence ที่แข็งเกิน
- article/determiner artifacts

## 4.2 Recommended config

```yaml
enToTh:
  pair:
    sourceLang: en
    targetLang: th

  segmentation:
    default: block
    overlay: line
    ui: line
    document: block
    verification: block

  glossary:
    enabledDomains:
      - product
      - ui
      - error
      - system
      - technical
      - document
    bias:
      ui: strong
      technical: medium
      document: medium

  repairPolicy:
    allowSafeRules: true
    allowMediumRiskRules: true
    allowHighRiskRules: false
    preferredRules:
      - lit-passive-found
      - lit-selected-file
      - lit-cannot-be-saved
      - lit-file-was-not-found
    blockedRules: []

  validation:
    residualSourceFragmentSensitivity: medium
    literalStructureSensitivity: high
    termConsistencySensitivity: high
    overlayLengthSensitivity: medium

  thresholds:
    ocrConfidenceNormal: 0.90
    ocrConfidenceCautious: 0.75
    ocrConfidenceLow: 0.50

  modeOverrides:
    ui:
      segmentation: line
      brevityBias: high
      allowShorteningRules: true
    overlay:
      segmentation: line
      brevityBias: high
      allowShorteningRules: true
    document:
      segmentation: block
      brevityBias: low
      allowShorteningRules: false
    verification:
      segmentation: block
      brevityBias: low
      allowShorteningRules: false
      reduceRepairAggression: true
```

## 4.3 Notes

- EN -> TH เปิด medium-risk repair ได้มากกว่าคู่อื่น
- แต่ยังไม่ควรเปิด high-risk semantic rewrite แบบกว้าง ๆ
- เหมาะกับ UI/error/document translation มากสุดใน 4 คู่

---

# 5) JA -> TH Template

## 5.1 Pair summary

ภาษาญี่ปุ่นไปไทยมีความเสี่ยงสูงกว่าภาษาอังกฤษเพราะ:

- ประธานมักถูกละไว้
- ความหมายสำคัญอยู่ท้ายประโยค
- ระดับความสุภาพส่งผลต่อ nuance
- context ต่อบรรทัดมีผลมาก
- segment สั้นแต่บรรทุกความหมายสูง

## 5.2 Recommended config

```yaml
jaToTh:
  pair:
    sourceLang: ja
    targetLang: th

  segmentation:
    default: hybrid
    overlay: line
    ui: line
    document: hybrid
    verification: hybrid

  glossary:
    enabledDomains:
      - product
      - ui
      - error
      - system
      - technical
    bias:
      ui: strong
      technical: medium
      document: low

  repairPolicy:
    allowSafeRules: true
    allowMediumRiskRules: false
    allowHighRiskRules: false
    preferredRules:
      - lit-cannot-be-saved
    blockedRules:
      - lit-passive-found
      - lit-selected-file

  validation:
    residualSourceFragmentSensitivity: high
    literalStructureSensitivity: medium
    termConsistencySensitivity: high
    overlayLengthSensitivity: high
    ambiguitySensitivity: high

  thresholds:
    ocrConfidenceNormal: 0.92
    ocrConfidenceCautious: 0.78
    ocrConfidenceLow: 0.55

  modeOverrides:
    ui:
      segmentation: line
      brevityBias: medium
      allowShorteningRules: false
    overlay:
      segmentation: line
      brevityBias: medium
      allowShorteningRules: false
    document:
      segmentation: hybrid
      brevityBias: low
      allowShorteningRules: false
    verification:
      segmentation: hybrid
      brevityBias: low
      allowShorteningRules: false
      reduceRepairAggression: true
```

## 5.3 Notes

- JA -> TH ไม่ควร aggressive repair ง่าย เพราะเสี่ยงเดาประธาน/intent เกินจริง
- เหมาะกับ hybrid segmentation มากกว่า block ล้วนหรือ line ล้วน
- ควรให้ validation sensitivity สูงกว่าคู่ EN -> TH

---

# 6) KO -> TH Template

## 6.1 Pair summary

ภาษาเกาหลีไปไทยมีลักษณะคล้ายญี่ปุ่นบางส่วน แต่มีจุดเฉพาะเพิ่ม เช่น:

- honorific / polite endings
- compound nouns ติดกันแน่น
- omitted subjects
- instruction phrasing ที่อาจออกมาตรงเกิน
- technical setting screens เจอบ่อยใน OCR use cases

## 6.2 Recommended config

```yaml
koToTh:
  pair:
    sourceLang: ko
    targetLang: th

  segmentation:
    default: hybrid
    overlay: line
    ui: line
    document: hybrid
    verification: hybrid

  glossary:
    enabledDomains:
      - product
      - ui
      - error
      - system
      - technical
    bias:
      ui: strong
      technical: strong
      document: low

  repairPolicy:
    allowSafeRules: true
    allowMediumRiskRules: false
    allowHighRiskRules: false
    preferredRules:
      - lit-cannot-be-saved
    blockedRules:
      - lit-passive-found

  validation:
    residualSourceFragmentSensitivity: high
    literalStructureSensitivity: medium
    termConsistencySensitivity: high
    overlayLengthSensitivity: high
    ambiguitySensitivity: high

  thresholds:
    ocrConfidenceNormal: 0.92
    ocrConfidenceCautious: 0.78
    ocrConfidenceLow: 0.55

  modeOverrides:
    ui:
      segmentation: line
      brevityBias: medium
      allowShorteningRules: false
    overlay:
      segmentation: line
      brevityBias: high
      allowShorteningRules: false
    document:
      segmentation: hybrid
      brevityBias: low
      allowShorteningRules: false
    verification:
      segmentation: hybrid
      brevityBias: low
      allowShorteningRules: false
      reduceRepairAggression: true
```

## 6.3 Notes

- KO -> TH ควร bias ไปทาง technical glossary สูง เพราะ setting/help UI จากเกาหลีชอบมี compound terms ที่ถ้าปล่อย model ล้วนจะไม่นิ่ง
- repair layer ควร conservative ใกล้เคียง JA -> TH

---

# 7) ES -> TH Template

## 7.1 Pair summary

ภาษาสเปนไปไทยมีปัญหาหลักคือ:

- verb inflection หนาแน่น
- gender/number agreement ที่ไทยไม่แสดงตรง
- adjective order ไม่เหมือนไทย
- idiom / phrase-based meaning
- error/status text บางชุด literal ง่าย

## 7.2 Recommended config

```yaml
esToTh:
  pair:
    sourceLang: es
    targetLang: th

  segmentation:
    default: block
    overlay: line
    ui: line
    document: block
    verification: block

  glossary:
    enabledDomains:
      - product
      - ui
      - error
      - system
      - technical
      - document
    bias:
      ui: strong
      technical: medium
      document: medium

  repairPolicy:
    allowSafeRules: true
    allowMediumRiskRules: true
    allowHighRiskRules: false
    preferredRules:
      - lit-cannot-be-saved
    blockedRules: []

  validation:
    residualSourceFragmentSensitivity: medium
    literalStructureSensitivity: medium
    termConsistencySensitivity: high
    overlayLengthSensitivity: medium
    idiomSensitivity: high

  thresholds:
    ocrConfidenceNormal: 0.90
    ocrConfidenceCautious: 0.76
    ocrConfidenceLow: 0.52

  modeOverrides:
    ui:
      segmentation: line
      brevityBias: high
      allowShorteningRules: true
    overlay:
      segmentation: line
      brevityBias: high
      allowShorteningRules: true
    document:
      segmentation: block
      brevityBias: low
      allowShorteningRules: false
    verification:
      segmentation: block
      brevityBias: low
      allowShorteningRules: false
      reduceRepairAggression: true
```

## 7.3 Notes

- ES -> TH โดยรวมเปิด medium-risk repair ได้มากกว่า JA/KO แต่ควรระวัง idiomatic meaning
- เหมาะกับ block segmentation สำหรับ document มากกว่าคู่ JA/KO

---

# 8) Cross-Pair Comparison Matrix

## 8.1 Risk posture

```yaml
riskProfile:
  enToTh:
    repairAggression: medium
    validationSensitivity: medium-high
  jaToTh:
    repairAggression: low
    validationSensitivity: high
  koToTh:
    repairAggression: low
    validationSensitivity: high
  esToTh:
    repairAggression: medium
    validationSensitivity: medium-high
```

## 8.2 Segmentation bias

```yaml
segmentationBias:
  enToTh: block
  jaToTh: hybrid
  koToTh: hybrid
  esToTh: block
```

## 8.3 Glossary dependence

```yaml
glossaryDependence:
  enToTh: medium
  jaToTh: high
  koToTh: high
  esToTh: medium
```

---

# 9) Mode Profiles by Pair

## 9.1 UI profile summary

```yaml
uiModeByPair:
  enToTh:
    segmentation: line
    brevityBias: high
    allowShorteningRules: true
  jaToTh:
    segmentation: line
    brevityBias: medium
    allowShorteningRules: false
  koToTh:
    segmentation: line
    brevityBias: medium
    allowShorteningRules: false
  esToTh:
    segmentation: line
    brevityBias: high
    allowShorteningRules: true
```

## 9.2 Verification profile summary

```yaml
verificationModeByPair:
  enToTh:
    reduceRepairAggression: true
  jaToTh:
    reduceRepairAggression: true
  koToTh:
    reduceRepairAggression: true
  esToTh:
    reduceRepairAggression: true
```

---

# 10) Pair-Specific Validation Rules

## 10.1 EN -> TH

ควรเน้น flags:
- TOO_LITERAL_STRUCTURE
- TERM_INCONSISTENT
- OUTPUT_TOO_LONG_FOR_OVERLAY

## 10.2 JA -> TH

ควรเน้น flags:
- LANGUAGE_MISMATCH
- POSSIBLE_FRAGMENT
- RESIDUAL_SOURCE_FRAGMENT
- TERM_INCONSISTENT

## 10.3 KO -> TH

ควรเน้น flags:
- LANGUAGE_MISMATCH
- POSSIBLE_FRAGMENT
- RESIDUAL_SOURCE_FRAGMENT
- TERM_INCONSISTENT

## 10.4 ES -> TH

ควรเน้น flags:
- TOO_LITERAL_STRUCTURE
- TERM_INCONSISTENT
- POSSIBLE_FRAGMENT

---

# 11) Pair-Specific Repair Enablement Map

## 11.1 Suggested map

```yaml
repairEnablement:
  lit-passive-found:
    enToTh: true
    jaToTh: false
    koToTh: false
    esToTh: false

  lit-selected-file:
    enToTh: true
    jaToTh: false
    koToTh: false
    esToTh: false

  lit-cannot-be-saved:
    enToTh: true
    jaToTh: true
    koToTh: true
    esToTh: true

  ui-shorten-please-check:
    enToTh: true
    jaToTh: false
    koToTh: false
    esToTh: true

  th-remove-space-between-thai:
    enToTh: false
    jaToTh: false
    koToTh: false
    esToTh: false
```

---

# 12) OCR Confidence Policy by Pair

## 12.1 Why it differs

คู่อย่าง JA/KO มักมีความเสี่ยงสูงกว่าเมื่อ OCR เพี้ยน เพราะหนึ่งบรรทัดสั้น ๆ อาจหาย nuance สำคัญทันที

## 12.2 Template

```yaml
ocrConfidencePolicy:
  enToTh:
    lowConfidenceDisablesMediumRepair: false
    lowConfidenceDisablesHighRepair: true
  jaToTh:
    lowConfidenceDisablesMediumRepair: true
    lowConfidenceDisablesHighRepair: true
  koToTh:
    lowConfidenceDisablesMediumRepair: true
    lowConfidenceDisablesHighRepair: true
  esToTh:
    lowConfidenceDisablesMediumRepair: false
    lowConfidenceDisablesHighRepair: true
```

---

# 13) Recommended Runtime Resolver Logic

## 13.1 Resolution order

```text
Select pair template
  ↓
Merge base profile
  ↓
Apply mode override
  ↓
Apply OCR-confidence restrictions
  ↓
Apply domain-specific bias
  ↓
Produce final runtime rule profile
```

## 13.2 Why merge order matters

ถ้าสลับลำดับผิด เช่น apply mode override ก่อน pair template:
- config บางส่วนจะโดนทับผิด
- pair-specific safety policy อาจหาย
- debug ยากมาก

---

# 14) Suggested Runtime Profile Schema

```ts
export interface PairRuntimeProfile {
  sourceLang: 'en' | 'ja' | 'ko' | 'es'
  targetLang: 'th'
  segmentation: 'line' | 'block' | 'hybrid'
  brevityBias: 'low' | 'medium' | 'high'
  allowShorteningRules: boolean
  allowSafeRules: boolean
  allowMediumRiskRules: boolean
  allowHighRiskRules: boolean
  enabledGlossaryDomains: string[]
  validationSensitivity: {
    residualSourceFragment: 'low' | 'medium' | 'high'
    literalStructure: 'low' | 'medium' | 'high'
    termConsistency: 'low' | 'medium' | 'high'
    overlayLength: 'low' | 'medium' | 'high'
    ambiguity?: 'low' | 'medium' | 'high'
    idiom?: 'low' | 'medium' | 'high'
  }
  thresholds: {
    ocrConfidenceNormal: number
    ocrConfidenceCautious: number
    ocrConfidenceLow: number
  }
  preferredRules: string[]
  blockedRules: string[]
}
```

---

# 15) Anti-Patterns

## ห้าม

- ใช้ template เดียวครอบทุกคู่ภาษา
- hardcode pair branching ในหลาย service
- เปิด medium/high-risk repair ทุกคู่เท่ากัน
- ใช้ segmentation แบบ block กับ JA/KO ทุกสถานการณ์
- เปิด shortening rules กับ JA/KO แบบ aggressive

## เพราะอะไร

จะทำให้:
- nuance หาย
- source meaning เพี้ยน
- overlay ดูสั้นแต่ผิดความหมาย
- benchmark ไม่สะท้อน reality ของแต่ละภาษา

---

# 16) Implementation Guidance

## 16.1 เริ่มจาก baseline นี้ก่อน

- EN -> TH = medium repair aggression
- JA -> TH = low repair aggression + hybrid segmentation
- KO -> TH = low repair aggression + hybrid segmentation
- ES -> TH = medium repair aggression

## 16.2 แล้วค่อย tune จาก dataset จริง

ให้ดูจาก:
- flag frequency
- term inconsistency rate
- overlay overflow rate
- residual source fragment rate
- manual review feedback

---

# 17) Final Recommendation

ถ้าระบบคุณรองรับหลายภาษาต้นทาง แต่ปลายทางเป็นไทยเหมือนกัน
คุณ **ต้อง** แยก pair templates

โดยสรุป:

- `EN -> TH` = เปิด repair ได้เยอะสุด
- `JA -> TH` = conservative สุด
- `KO -> TH` = conservative ใกล้ JA
- `ES -> TH` = กลาง ๆ ระหว่าง EN กับ JA/KO

ไฟล์นี้ควรใช้คู่กับ:
- `translation_rule_engine_schema.md`
- `translation_glossary_seed.md`
- `thai_repair_rule_patterns.md`
- `argos-translation-quality-control.md`

เพื่อให้ระบบแปล OCR ของคุณมี **runtime profile per language pair** ที่ใช้งานจริงได้ ไม่ใช่แค่มี rule กองรวมกันเฉย ๆ

