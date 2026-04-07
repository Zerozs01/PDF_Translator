# Translation Rule Engine Schema for Argos OCR Translation Pipeline

## TL;DR

ไฟล์นี้กำหนด schema กลางสำหรับ **translation rule engine** ที่ใช้ควบคุมคุณภาพการแปลใน OCR pipeline โดยเชื่อม 3 ส่วนเข้าด้วยกัน:

- glossary enforcement
- protected token handling
- Thai repair rules

เป้าหมายของ schema นี้คือ:

1. ทำให้กฎทั้งหมดอยู่ในรูปแบบ **config-driven**
2. แยก rule logic ออกจาก application code
3. ทำให้เปิด/ปิดกฎได้ตาม mode / language pair / domain
4. ทำให้ benchmark, debug, และ versioning ได้ง่าย
5. ทำให้ระบบโตต่อได้โดยไม่กลายเป็น if-else hell

ไฟล์นี้ออกแบบมาเพื่อใช้กับ:

- Electron
- TypeScript
- Argos Translate
- PaddleOCR
- EasyOCR
- Tesseract

---

# 1) Why This File Must Exist

## 1.1 ปัญหาถ้าไม่มี schema กลาง

ถ้าไม่มี schema กลาง คุณจะลงเอยด้วยสิ่งนี้:

- glossary hardcode ในหลายไฟล์
- regex repair rules กระจัดกระจาย
- config เปิด/ปิด rule ไม่เป็นระบบ
- pair-specific heuristics ปนกับ business logic
- debug ไม่รู้ว่า rule ไหนยิงไปบ้าง
- เพิ่มภาษาใหม่ทีหนึ่งต้องแก้หลายจุด

## 1.2 เป้าหมายของ rule engine

rule engine ต้องทำให้ระบบ:

- deterministic พอ
- inspectable
- configurable
- mode-aware
- language-aware
- benchmarkable

---

# 2) Rule Engine Responsibilities

## 2.1 In Scope

- load rule config
- validate config
- filter rules ตาม context
- apply rules ตาม priority/order
- track applied rules
- attach flags/warnings
- support dry-run/debug mode

## 2.2 Out of Scope

- OCR execution
- Argos model inference
- full semantic rewriting
- cloud fallback routing
- UI rendering

---

# 3) High-Level Execution Flow

```text
Input Segment
  ↓
Build Translation Context
  ↓
Protected Token Layer
  ↓
Glossary Layer
  ↓
Argos Translation
  ↓
Post-Translation Repair Layer
  ↓
Validation Layer
  ↓
Flags / Score / Final Output
```

## 3.1 Important rule

- glossary rules มีทั้ง pre-translation และ post-translation use case
- repair rules เป็น post-translation เป็นหลัก
- protected token layer ต้องมาก่อน translation
- validation layer ต้องอยู่ท้ายสุด

---

# 4) Core Concepts

## 4.1 Context

ทุก rule ต้องทำงานภายใต้ context ที่ชัดเจน เช่น:

- source language
- target language
- mode
- domain
- OCR confidence
- engine
- file type
- overlay constraints

## 4.2 Mode

```ts
export type TranslationMode =
  | 'ui'
  | 'overlay'
  | 'document'
  | 'verification'
```

## 4.3 Stage

```ts
export type RuleStage =
  | 'pre-normalization'
  | 'pre-protection'
  | 'pre-translation'
  | 'post-translation'
  | 'post-repair'
  | 'validation'
```

## 4.4 Action Type

```ts
export type RuleActionType =
  | 'replace'
  | 'preserve'
  | 'prefer'
  | 'flag'
  | 'skip'
```

---

# 5) Master Schema

## 5.1 Root config

```ts
export interface TranslationRuleEngineConfig {
  version: string
  name: string
  description?: string
  defaultMode: TranslationMode
  supportedPairs: LanguagePair[]
  protectedTokenConfig: ProtectedTokenConfig
  glossary: GlossaryConfig
  repair: RepairConfig
  validation: ValidationConfig
  heuristics: PairHeuristicConfig[]
  scoring?: QualityScoringConfig
  metadata?: Record<string, string>
}
```

## 5.2 Language pair

```ts
export interface LanguagePair {
  sourceLang: 'en' | 'ja' | 'ko' | 'es'
  targetLang: 'th'
}
```

---

# 6) Translation Context Schema

```ts
export interface TranslationRuleContext {
  jobId: string
  segmentId: string
  sourceText: string
  normalizedSourceText: string
  translatedTextRaw?: string
  translatedTextFinal?: string
  sourceLang: 'en' | 'ja' | 'ko' | 'es'
  targetLang: 'th'
  mode: TranslationMode
  domain?:
    | 'ui'
    | 'technical'
    | 'system'
    | 'document'
    | 'error'
    | 'product'
    | 'location'
    | 'measurement'
  ocrEngine?: 'paddleocr' | 'easyocr' | 'tesseract'
  ocrConfidence?: number
  fileType?: 'image' | 'pdf' | 'screenshot' | 'scan'
  lineCount?: number
  overlayMaxLength?: number
  flags: string[]
  appliedRuleIds: string[]
  debug?: boolean
}
```

## 6.1 ทำไม context ต้องละเอียด

เพราะ rule เดียวกันอาจใช้ได้ใน `document mode` แต่ไม่ควรใช้ใน `overlay mode`

ตัวอย่าง:
- shorten rule เหมาะกับ overlay
- literal repair บางตัวเหมาะกับ document มากกว่า
- low-confidence source ควรปิด aggressive repair

---

# 7) Protected Token Schema

## 7.1 Root config

```ts
export interface ProtectedTokenConfig {
  enabled: boolean
  preserveUnknownUrls: boolean
  preserveEmails: boolean
  preservePaths: boolean
  preserveVersionStrings: boolean
  preserveCodeLikeTokens: boolean
  customPatterns: ProtectedTokenPattern[]
}
```

## 7.2 Pattern schema

```ts
export interface ProtectedTokenPattern {
  id: string
  description: string
  pattern: string
  tokenType:
    | 'url'
    | 'email'
    | 'path'
    | 'version'
    | 'code'
    | 'product'
    | 'person'
    | 'location'
    | 'custom'
  priority: number
  enabled: boolean
}
```

## 7.3 Runtime token map

```ts
export interface ProtectedTokenMatch {
  key: string
  type: string
  originalValue: string
  startIndex: number
  endIndex: number
}
```

---

# 8) Glossary Schema

## 8.1 Root config

```ts
export interface GlossaryConfig {
  enabled: boolean
  caseInsensitiveDefault: boolean
  conflictPolicy: 'priority' | 'exact-first' | 'preserve-first'
  entries: GlossaryEntry[]
}
```

## 8.2 Entry schema

```ts
export interface GlossaryEntry {
  id: string
  source: string
  target: string
  sourceLang: 'en' | 'ja' | 'ko' | 'es' | '*'
  targetLang: 'th'
  action: 'replace' | 'preserve' | 'prefer'
  domain?:
    | 'ui'
    | 'technical'
    | 'system'
    | 'document'
    | 'error'
    | 'product'
    | 'location'
    | 'measurement'
  exactMatch?: boolean
  caseSensitive?: boolean
  aliases?: string[]
  stage?: RuleStage[]
  priority: number
  enabled: boolean
  conditions?: RuleCondition[]
  notes?: string
}
```

## 8.3 Conditions

```ts
export interface RuleCondition {
  field:
    | 'mode'
    | 'domain'
    | 'sourceLang'
    | 'targetLang'
    | 'ocrConfidence'
    | 'fileType'
    | 'lineCount'
  operator: 'eq' | 'neq' | 'in' | 'not-in' | 'gte' | 'lte' | 'gt' | 'lt'
  value: string | number | string[] | number[]
}
```

---

# 9) Repair Rule Schema

## 9.1 Root config

```ts
export interface RepairConfig {
  enabled: boolean
  stopOnFatalFlag: boolean
  rules: RepairRule[]
}
```

## 9.2 Repair rule

```ts
export interface RepairRule {
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
  stage: 'post-translation' | 'post-repair'
  pattern: string
  replacement: string
  flags?: string[]
  modes?: TranslationMode[]
  conditions?: RuleCondition[]
  priority: number
  enabled: boolean
  riskLevel?: 'safe' | 'medium' | 'high'
  notes?: string
}
```

## 9.3 Design rule

- ทุก repair rule ต้อง declare `riskLevel`
- rule ที่เป็น `high` ไม่ควรเปิด auto ทุก mode
- repair rules ต้อง sortable ด้วย `priority`

---

# 10) Validation Rule Schema

## 10.1 Root config

```ts
export interface ValidationConfig {
  enabled: boolean
  rules: ValidationRule[]
}
```

## 10.2 Validation rule

```ts
export interface ValidationRule {
  id: string
  description: string
  stage: 'validation'
  type:
    | 'regex-flag'
    | 'length-limit'
    | 'placeholder-integrity'
    | 'unbalanced-brackets'
    | 'residual-source-fragment'
    | 'term-consistency'
  pattern?: string
  maxLength?: number
  modes?: TranslationMode[]
  conditions?: RuleCondition[]
  flag: string
  priority: number
  enabled: boolean
}
```

---

# 11) Pair Heuristic Schema

## 11.1 Root object

```ts
export interface PairHeuristicConfig {
  sourceLang: 'en' | 'ja' | 'ko' | 'es'
  targetLang: 'th'
  enabled: boolean
  rules: PairHeuristicRule[]
}
```

## 11.2 Rule object

```ts
export interface PairHeuristicRule {
  id: string
  description: string
  stage: RuleStage
  category:
    | 'segmentation'
    | 'glossary-bias'
    | 'repair-bias'
    | 'warning'
    | 'routing'
  action: 'prefer' | 'flag' | 'skip'
  conditions?: RuleCondition[]
  effects: PairHeuristicEffect[]
  priority: number
  enabled: boolean
}
```

## 11.3 Effects

```ts
export interface PairHeuristicEffect {
  type:
    | 'enable-rule'
    | 'disable-rule'
    | 'add-flag'
    | 'set-mode-bias'
    | 'set-segmentation'
    | 'set-risk-threshold'
  target: string
  value?: string | number | boolean
}
```

---

# 12) Quality Scoring Schema

## 12.1 Root config

```ts
export interface QualityScoringConfig {
  enabled: boolean
  weights: {
    ocrConfidence: number
    glossaryConsistency: number
    placeholderIntegrity: number
    repairPenalty: number
    suspiciousFlagPenalty: number
  }
  thresholds: {
    usable: number
    caution: number
    review: number
  }
}
```

## 12.2 Why score must be config-driven

เพราะแต่ละโปรดักต์ให้น้ำหนักไม่เหมือนกัน:

- app ที่เน้น UI translation อาจให้น้ำหนัก brevity สูง
- app ที่เน้น document verification อาจให้น้ำหนัก alignment สูง

---

# 13) Runtime Result Schema

```ts
export interface TranslationRuleEngineResult {
  segmentId: string
  sourceText: string
  normalizedSourceText: string
  translatedTextRaw: string
  translatedTextFinal: string
  protectedTokens: ProtectedTokenMatch[]
  appliedGlossaryEntryIds: string[]
  appliedRepairRuleIds: string[]
  appliedValidationRuleIds: string[]
  flags: string[]
  qualityScore?: number
  debugTrace?: RuleDebugTrace[]
}
```

## 13.1 Debug trace

```ts
export interface RuleDebugTrace {
  stage: RuleStage | 'protection'
  ruleId: string
  before: string
  after: string
  changed: boolean
  flagsAdded?: string[]
}
```

---

# 14) Rule Matching Semantics

## 14.1 Matching order

กฎทั้งหมดต้องผ่านการ filter ด้วยลำดับนี้:

1. stage match
2. enabled = true
3. language pair match
4. mode match
5. conditions match
6. sort by priority desc
7. apply in deterministic order

## 14.2 Conflict resolution

### Glossary
- preserve ชนะ replace
- exactMatch ชนะ partial
- higher priority ชนะ lower
- sourceLang-specific ชนะ wildcard

### Repair
- priority สูงทำก่อน
- ถ้ากฎก่อนทำให้ pattern กฎหลังไม่ match ถือว่าเป็น expected behavior
- high-risk rule ควรถูก block ถ้ามี `LOW_CONFIDENCE_SOURCE`

### Validation
- validation ไม่ควร mutate text
- validation มีไว้เพิ่ม flag เท่านั้น

---

# 15) Example YAML Config

## 15.1 Minimal root

```yaml
version: "1.0.0"
name: "argos-thai-rule-engine"
defaultMode: document
supportedPairs:
  - sourceLang: en
    targetLang: th
  - sourceLang: ja
    targetLang: th
  - sourceLang: ko
    targetLang: th
  - sourceLang: es
    targetLang: th
```

## 15.2 Protected token config

```yaml
protectedTokenConfig:
  enabled: true
  preserveUnknownUrls: true
  preserveEmails: true
  preservePaths: true
  preserveVersionStrings: true
  preserveCodeLikeTokens: true
  customPatterns:
    - id: protect-product-code
      description: Protect internal product codes
      pattern: "[A-Z]{2,10}-\\d{2,6}"
      tokenType: custom
      priority: 90
      enabled: true
```

## 15.3 Repair config sample

```yaml
repair:
  enabled: true
  stopOnFatalFlag: false
  rules:
    - id: lit-file-was-not-found
      category: literal-structure
      description: Fix literal Thai machine-translated file-not-found phrase
      stage: post-repair
      pattern: "ไฟล์ที่ถูกเลือกไม่ได้ถูกพบ"
      replacement: "ไม่พบไฟล์ที่เลือก"
      priority: 80
      enabled: true
      riskLevel: safe
```

---

# 16) TypeScript Engine Interface

## 16.1 Main API

```ts
export interface TranslationRuleEngine {
  loadConfig(config: TranslationRuleEngineConfig): void
  validateConfig(): ValidationIssue[]
  process(context: TranslationRuleContext): TranslationRuleEngineResult
  dryRun(context: TranslationRuleContext): TranslationRuleEngineResult
}
```

## 16.2 Validation issue

```ts
export interface ValidationIssue {
  level: 'error' | 'warning'
  message: string
  path?: string
}
```

---

# 17) Recommended Module Structure

```text
src/
  translation/
    rule-engine/
      engine.ts
      config-loader.ts
      config-validator.ts
      context-builder.ts
      stages/
        protected-token.stage.ts
        glossary.stage.ts
        repair.stage.ts
        validation.stage.ts
      resolvers/
        condition-resolver.ts
        conflict-resolver.ts
      scoring/
        quality-score.ts
      types/
        rule-engine.types.ts
```

---

# 18) Validation Rules for the Config Itself

## 18.1 Required config checks

- duplicate rule id ห้ามมี
- duplicate glossary id ห้ามมี
- invalid regex ต้อง reject
- unsupported mode ต้อง reject
- unsupported language pair ต้อง reject
- invalid condition operator ต้อง reject
- negative priority ต้อง reject
- validation rule ห้ามมี replacement field

## 18.2 Why strict validation matters

ถ้า config เสียแล้วปล่อยผ่าน:
- debug ยากมาก
- benchmark ไม่น่าเชื่อถือ
- behavior ไม่ deterministic

---

# 19) Safety Policies

## 19.1 Conservative by default

ค่า default ของระบบควรเป็น:
- repair high-risk = disabled unless explicitly enabled
- low OCR confidence = reduce aggressive rules
- overlay mode = stricter max length
- verification mode = minimal mutation

## 19.2 Fatal flags

ตัวอย่าง fatal-ish flags:
- BROKEN_PLACEHOLDER_RESTORE
- LANGUAGE_MISMATCH
- RESIDUAL_SOURCE_FRAGMENT

ถ้ามี flag พวกนี้:
- อาจหยุด chain บาง stage
- หรือ downgrade quality score แรง

---

# 20) Benchmarking Guidance

## 20.1 What to log

- segmentId
- sourceLang
- mode
- appliedRuleIds
- flags
- qualityScore
- before/after text
- OCR confidence

## 20.2 Why

เพราะถ้า output ดีขึ้น/แย่ลง คุณต้อง trace ได้ว่าเกิดจาก:
- glossary
- repair rule
- validation
- pair heuristic

---

# 21) Anti-Patterns

## ห้าม

- hardcode regex repair rules ใน UI layer
- ผสม glossary enforcement กับ renderer formatting
- ใช้ if-else language pair logic กระจัดกระจายทั่ว codebase
- ปล่อยให้ rule order ขึ้นกับ insertion order แบบไม่กำหนด
- ใช้ schema ที่ไม่มี version

## เพราะอะไร

เมื่อระบบโตขึ้น คุณจะ:
- maintenance ไม่ไหว
- benchmark ไม่ได้
- rollback ยาก
- diff config ไม่ชัด

---

# 22) Migration Strategy

## Phase 1

- เอา glossary seed เข้า schema นี้
- เอา thai repair rules เข้า schema นี้
- ทำ config validator
- ทำ dry-run engine

## Phase 2

- ทำ pair heuristics config
- ทำ scoring config
- ทำ debug trace UI/log export

## Phase 3

- เพิ่ม profile per product/domain
- เพิ่ม rule packs แยกตาม use case
- เพิ่ม benchmark automation

---

# 23) Final Recommendation

ถ้าคุณต้องการให้ระบบแปล OCR ของคุณโตแบบไม่พัง:

- ต้องมี `translation_rule_engine_schema.md`
- ต้องให้ทุก rule เป็น config-driven
- ต้องแยก `stage`, `mode`, `conditions`, `priority`, และ `riskLevel` ให้ชัด
- ต้อง log `appliedRuleIds` และ `flags` ทุกครั้ง

เอกสารนี้คือจุดเปลี่ยนจาก
**“มีเอกสารแนวคิด”**
ไปสู่
**“มีระบบ rule engine ที่ implement ได้จริง”**

